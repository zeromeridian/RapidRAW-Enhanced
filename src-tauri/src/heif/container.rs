//! Reads what the HEIF container says about the primary image: its colour box (`colr`) and
//! its transforms (`clap`, `irot`, `imir`), in the order the file lists them. The platform
//! decoders return the coded image without these, so every platform applies them the same
//! way here.

use anyhow::{Result, anyhow};
use image::{DynamicImage, imageops};

/// The colour information of a `colr` box.
#[derive(Clone, Debug, PartialEq)]
pub enum ColourInfo {
    /// An embedded ICC profile (`prof` or `rICC`).
    Icc(Vec<u8>),
    /// Coding-independent code points (`nclx`, ITU-T H.273).
    Nclx { primaries: u8, transfer: u8 },
}

/// A transformative item property, applied in file order.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Transform {
    /// Clean aperture: a crop of `width` × `height` whose centre is offset from the image
    /// centre by (`offset_x`, `offset_y`) pixels.
    CleanAperture {
        width: f64,
        height: f64,
        offset_x: f64,
        offset_y: f64,
    },
    /// Anticlockwise rotation in quarter turns (0–3).
    Rotate(u8),
    /// Mirror about the vertical axis (left–right) when false, the horizontal axis when true.
    Mirror { horizontal_axis: bool },
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct ContainerInfo {
    pub colour: Option<ColourInfo>,
    pub transforms: Vec<Transform>,
    /// The coded size from `ispe`, used to tell whether a decoder already cropped.
    pub coded_size: Option<(u32, u32)>,
}

struct IsoBox<'a> {
    kind: [u8; 4],
    payload: &'a [u8],
}

/// The boxes directly inside `data`; stops at the first malformed one.
fn boxes(data: &[u8]) -> Vec<IsoBox<'_>> {
    let mut out = Vec::new();
    let mut pos = 0usize;
    while pos + 8 <= data.len() {
        let size32 = be_u32(data, pos).unwrap_or(0) as u64;
        let kind: [u8; 4] = data[pos + 4..pos + 8].try_into().unwrap_or_default();
        let (header, size) = match size32 {
            0 => (8, (data.len() - pos) as u64),
            1 => match be_u64(data, pos + 8) {
                Some(large) => (16, large),
                None => break,
            },
            n => (8, n),
        };
        let Some(end) = usize::try_from(size)
            .ok()
            .and_then(|size| pos.checked_add(size))
            .filter(|&end| size >= header as u64 && end <= data.len())
        else {
            break;
        };
        out.push(IsoBox {
            kind,
            payload: &data[pos + header..end],
        });
        pos = end;
    }
    out
}

fn find<'a>(list: &[IsoBox<'a>], kind: &[u8; 4]) -> Option<&'a [u8]> {
    list.iter().find(|b| &b.kind == kind).map(|b| b.payload)
}

fn be_u16(data: &[u8], pos: usize) -> Option<u16> {
    Some(u16::from_be_bytes(data.get(pos..pos + 2)?.try_into().ok()?))
}

fn be_u32(data: &[u8], pos: usize) -> Option<u32> {
    Some(u32::from_be_bytes(data.get(pos..pos + 4)?.try_into().ok()?))
}

fn be_u64(data: &[u8], pos: usize) -> Option<u64> {
    Some(u64::from_be_bytes(data.get(pos..pos + 8)?.try_into().ok()?))
}

/// The id of an item field that is 16 bits in version 0 boxes and 32 bits otherwise.
fn item_id(data: &[u8], pos: usize, wide: bool) -> Option<(u32, usize)> {
    if wide {
        Some((be_u32(data, pos)?, pos + 4))
    } else {
        Some((be_u16(data, pos)? as u32, pos + 2))
    }
}

/// Property indices (1-based into `ipco`) per item, in `ipma` order.
fn associations(ipma: &[u8]) -> Vec<(u32, Vec<usize>)> {
    let mut out = Vec::new();
    let (Some(&version), Some(flags)) = (ipma.first(), be_u32(ipma, 0)) else {
        return out;
    };
    let wide_index = flags & 1 == 1;
    let Some(count) = be_u32(ipma, 4) else {
        return out;
    };
    let mut pos = 8;
    for _ in 0..count {
        let Some((id, next)) = item_id(ipma, pos, version >= 1) else {
            break;
        };
        let Some(&n) = ipma.get(next) else { break };
        pos = next + 1;
        let mut indices = Vec::with_capacity(n as usize);
        for _ in 0..n {
            let index = if wide_index {
                let Some(v) = be_u16(ipma, pos) else { break };
                pos += 2;
                (v & 0x7fff) as usize
            } else {
                let Some(&v) = ipma.get(pos) else { break };
                pos += 1;
                (v & 0x7f) as usize
            };
            indices.push(index);
        }
        out.push((id, indices));
    }
    out
}

/// The first item a `dimg` reference of `from` points to (the first tile of a grid).
fn first_derived_source(iref: &[u8], from: u32) -> Option<u32> {
    let wide = *iref.first()? >= 1;
    for reference in boxes(iref.get(4..)?) {
        if &reference.kind != b"dimg" {
            continue;
        }
        let (id, pos) = item_id(reference.payload, 0, wide)?;
        if id != from {
            continue;
        }
        let count = be_u16(reference.payload, pos)?;
        if count > 0 {
            return item_id(reference.payload, pos + 2, wide).map(|(id, _)| id);
        }
    }
    None
}

fn parse_colour(payload: &[u8]) -> Option<ColourInfo> {
    match payload.get(..4)? {
        b"prof" | b"rICC" => Some(ColourInfo::Icc(payload[4..].to_vec())),
        b"nclx" => Some(ColourInfo::Nclx {
            primaries: u8::try_from(be_u16(payload, 4)?).unwrap_or(2),
            transfer: u8::try_from(be_u16(payload, 6)?).unwrap_or(2),
        }),
        _ => None,
    }
}

fn signed_fraction(payload: &[u8], pos: usize) -> Option<f64> {
    let n = be_u32(payload, pos)? as i32;
    let d = be_u32(payload, pos + 4)?;
    (d != 0).then(|| n as f64 / d as f64)
}

fn fraction(payload: &[u8], pos: usize) -> Option<f64> {
    let n = be_u32(payload, pos)?;
    let d = be_u32(payload, pos + 4)?;
    (d != 0).then(|| n as f64 / d as f64)
}

fn parse_transform(property: &IsoBox<'_>) -> Option<Transform> {
    let payload = property.payload;
    match &property.kind {
        b"irot" => Some(Transform::Rotate(payload.first()? & 0b11)),
        b"imir" => Some(Transform::Mirror {
            horizontal_axis: payload.first()? & 1 == 1,
        }),
        b"clap" => Some(Transform::CleanAperture {
            width: fraction(payload, 0)?,
            height: fraction(payload, 8)?,
            offset_x: signed_fraction(payload, 16)?,
            offset_y: signed_fraction(payload, 24)?,
        }),
        _ => None,
    }
}

/// Reads the primary image's colour and transforms. Fails when `bytes` is not an ISO media
/// file with a `meta` box, which every HEIF image has.
pub fn parse(bytes: &[u8]) -> Result<ContainerInfo> {
    let top = boxes(bytes);
    let meta = find(&top, b"meta")
        .and_then(|meta| meta.get(4..))
        .ok_or_else(|| anyhow!("Not a HEIF file: no meta box"))?;
    let meta = boxes(meta);

    let primary = find(&meta, b"pitm").and_then(|pitm| {
        let wide = *pitm.first()? >= 1;
        item_id(pitm, 4, wide).map(|(id, _)| id)
    });
    let (Some(primary), Some(iprp)) = (primary, find(&meta, b"iprp")) else {
        return Ok(ContainerInfo::default());
    };
    let iprp = boxes(iprp);
    let properties = find(&iprp, b"ipco").map(boxes).unwrap_or_default();
    let associations: Vec<(u32, Vec<usize>)> = iprp
        .iter()
        .filter(|b| &b.kind == b"ipma")
        .flat_map(|b| associations(b.payload))
        .collect();
    let properties_of = |item: u32| -> Vec<&IsoBox<'_>> {
        associations
            .iter()
            .filter(|(id, _)| *id == item)
            .flat_map(|(_, indices)| indices.iter())
            .filter_map(|&index| index.checked_sub(1).and_then(|i| properties.get(i)))
            .collect()
    };
    let colour_of = |item: u32| -> Option<ColourInfo> {
        let colours: Vec<ColourInfo> = properties_of(item)
            .into_iter()
            .filter(|p| &p.kind == b"colr")
            .filter_map(|p| parse_colour(p.payload))
            .collect();
        // An ICC profile describes the colours fully; prefer it over code points.
        colours
            .iter()
            .find(|c| matches!(c, ColourInfo::Icc(_)))
            .or(colours.first())
            .cloned()
    };

    let primary_properties = properties_of(primary);
    let colour = colour_of(primary).or_else(|| {
        let tile = find(&meta, b"iref").and_then(|iref| first_derived_source(iref, primary))?;
        colour_of(tile)
    });
    let transforms = primary_properties
        .iter()
        .filter_map(|p| parse_transform(p))
        .collect();
    let coded_size = primary_properties
        .iter()
        .find(|p| &p.kind == b"ispe")
        .and_then(|p| Some((be_u32(p.payload, 4)?, be_u32(p.payload, 8)?)));

    Ok(ContainerInfo {
        colour,
        transforms,
        coded_size,
    })
}

/// The pixel rectangle (left, top, width, height) of a clean aperture, as libheif rounds it.
fn clean_aperture_rect(
    (image_width, image_height): (u32, u32),
    width: f64,
    height: f64,
    offset_x: f64,
    offset_y: f64,
) -> Option<(u32, u32, u32, u32)> {
    let side = |image: u32, size: f64, offset: f64| -> Option<(u32, u32)> {
        let size = size.round();
        let start = (offset + (image as f64 - 1.0) / 2.0 - (size - 1.0) / 2.0).round();
        (size >= 1.0 && start >= 0.0 && start + size <= image as f64)
            .then_some((start as u32, size as u32))
    };
    let (left, crop_width) = side(image_width, width, offset_x)?;
    let (top, crop_height) = side(image_height, height, offset_y)?;
    Some((left, top, crop_width, crop_height))
}

/// Applies the container's transforms to the coded image a platform decoder returned.
pub fn apply_transforms(mut image: DynamicImage, info: &ContainerInfo) -> DynamicImage {
    for transform in &info.transforms {
        image = match *transform {
            Transform::CleanAperture {
                width,
                height,
                offset_x,
                offset_y,
            } => {
                // A decoder that already cropped returns less than the coded size.
                let size = (image.width(), image.height());
                match clean_aperture_rect(size, width, height, offset_x, offset_y) {
                    Some((x, y, w, h)) if info.coded_size.is_none_or(|coded| coded == size) => {
                        image.crop_imm(x, y, w, h)
                    }
                    _ => image,
                }
            }
            Transform::Rotate(1) => DynamicImage::from(imageops::rotate270(&image.to_rgb32f())),
            Transform::Rotate(2) => DynamicImage::from(imageops::rotate180(&image.to_rgb32f())),
            Transform::Rotate(3) => DynamicImage::from(imageops::rotate90(&image.to_rgb32f())),
            Transform::Rotate(_) => image,
            Transform::Mirror {
                horizontal_axis: false,
            } => image.fliph(),
            Transform::Mirror {
                horizontal_axis: true,
            } => image.flipv(),
        };
    }
    image
}

#[cfg(test)]
pub(super) mod tests {
    use super::*;
    use image::{GenericImageView, Rgb, RgbImage};

    pub fn iso_box(kind: &[u8; 4], payload: &[u8]) -> Vec<u8> {
        let mut out = ((payload.len() + 8) as u32).to_be_bytes().to_vec();
        out.extend_from_slice(kind);
        out.extend_from_slice(payload);
        out
    }

    fn full_box(kind: &[u8; 4], version: u8, flags: u32, payload: &[u8]) -> Vec<u8> {
        let mut body = ((version as u32) << 24 | flags).to_be_bytes().to_vec();
        body.extend_from_slice(payload);
        iso_box(kind, &body)
    }

    /// A minimal HEIF header: item 1 is primary and has `properties` (1-based in order).
    pub fn heif_with(properties: &[Vec<u8>]) -> Vec<u8> {
        let ipco = iso_box(b"ipco", &properties.concat());
        let mut ipma = 1u32.to_be_bytes().to_vec();
        ipma.extend_from_slice(&1u16.to_be_bytes());
        ipma.push(properties.len() as u8);
        ipma.extend((1..=properties.len() as u8).map(|i| 0x80 | i));
        let iprp = iso_box(b"iprp", &[ipco, full_box(b"ipma", 0, 0, &ipma)].concat());
        let pitm = full_box(b"pitm", 0, 0, &1u16.to_be_bytes());
        let meta = full_box(b"meta", 0, 0, &[pitm, iprp].concat());
        [iso_box(b"ftyp", b"heic\0\0\0\0mif1heic"), meta].concat()
    }

    pub fn nclx(primaries: u16, transfer: u16) -> Vec<u8> {
        let mut payload = b"nclx".to_vec();
        payload.extend_from_slice(&primaries.to_be_bytes());
        payload.extend_from_slice(&transfer.to_be_bytes());
        payload.extend_from_slice(&1u16.to_be_bytes());
        payload.push(0x80);
        iso_box(b"colr", &payload)
    }

    fn ispe(width: u32, height: u32) -> Vec<u8> {
        full_box(
            b"ispe",
            0,
            0,
            &[width.to_be_bytes(), height.to_be_bytes()].concat(),
        )
    }

    #[test]
    fn reads_the_primary_items_colour_and_transforms_in_order() {
        let icc = iso_box(b"colr", b"prof-icc-bytes");
        let bytes = heif_with(&[
            nclx(12, 13),
            icc,
            ispe(4, 2),
            iso_box(b"irot", &[1]),
            iso_box(b"imir", &[1]),
        ]);
        let info = parse(&bytes).unwrap();

        assert_eq!(info.colour, Some(ColourInfo::Icc(b"-icc-bytes".to_vec())));
        assert_eq!(
            info.transforms,
            vec![
                Transform::Rotate(1),
                Transform::Mirror {
                    horizontal_axis: true
                }
            ]
        );
        assert_eq!(info.coded_size, Some((4, 2)));
    }

    #[test]
    fn reads_code_points_when_there_is_no_profile() {
        let info = parse(&heif_with(&[nclx(9, 16)])).unwrap();
        assert_eq!(
            info.colour,
            Some(ColourInfo::Nclx {
                primaries: 9,
                transfer: 16
            })
        );
    }

    #[test]
    fn rejects_files_without_a_meta_box() {
        assert!(parse(&iso_box(b"ftyp", b"heic")).is_err());
        assert!(parse(b"not an image").is_err());
    }

    fn marked_image() -> DynamicImage {
        // 3 × 2, the top-left pixel red.
        let mut image = RgbImage::new(3, 2);
        image.put_pixel(0, 0, Rgb([255, 0, 0]));
        DynamicImage::ImageRgb8(image)
    }

    fn red_at(image: &DynamicImage) -> (u32, u32) {
        let rgb = image.to_rgb8();
        let (x, y, _) = rgb.enumerate_pixels().find(|(_, _, p)| p[0] > 128).unwrap();
        (x, y)
    }

    #[test]
    fn rotation_is_anticlockwise_and_mirrors_follow_their_axis() {
        let info = |transforms| ContainerInfo {
            transforms,
            ..Default::default()
        };
        // A quarter turn anticlockwise moves the top-left corner to the bottom-left.
        let turned = apply_transforms(marked_image(), &info(vec![Transform::Rotate(1)]));
        assert_eq!(turned.dimensions(), (2, 3));
        assert_eq!(red_at(&turned), (0, 2));

        let left_right = apply_transforms(
            marked_image(),
            &info(vec![Transform::Mirror {
                horizontal_axis: false,
            }]),
        );
        assert_eq!(red_at(&left_right), (2, 0));

        let top_bottom = apply_transforms(
            marked_image(),
            &info(vec![Transform::Mirror {
                horizontal_axis: true,
            }]),
        );
        assert_eq!(red_at(&top_bottom), (0, 1));
    }

    #[test]
    fn clean_aperture_crops_only_an_uncropped_image() {
        let clap = Transform::CleanAperture {
            width: 2.0,
            height: 2.0,
            offset_x: -0.5,
            offset_y: 0.0,
        };
        let info = ContainerInfo {
            transforms: vec![clap],
            coded_size: Some((3, 2)),
            ..Default::default()
        };
        let cropped = apply_transforms(marked_image(), &info);
        assert_eq!(cropped.dimensions(), (2, 2));
        assert_eq!(red_at(&cropped), (0, 0));

        let already_cropped = DynamicImage::ImageRgb8(RgbImage::new(2, 2));
        assert_eq!(
            apply_transforms(already_cropped, &info).dimensions(),
            (2, 2)
        );
    }
}
