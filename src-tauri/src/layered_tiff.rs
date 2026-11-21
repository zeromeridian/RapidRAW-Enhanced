//! Photoshop-style layered TIFF for **Open as Layers**: a 16-bit RGB TIFF
//! whose main image is the flattened result, with one layer per photo in tag
//! 37724 (`ImageSourceData`), as Photoshop writes it (Adobe's *Photoshop TIFF
//! Technical Notes* and the PSD specification; checked against Photo Craft's
//! reader, `craft-psd` `tiff.rs`). Editors without layer support, and
//! ThisIsRAW itself, show the flattened image.
//!
//! The tag holds `"Adobe Photoshop Document Data Block\0"` and one `Lr16`
//! block: the PSD layer info of the 16-bit layers. Its integers follow the
//! file's byte order and its four-character codes are stored reversed in an
//! Intel-order file (`MIB8`, `61rL`); the samples inside the channel data stay
//! big-endian, as in a PSD. The `tiff` encoder writes native byte order, so
//! this module does too.
//!
//! The layers share a canvas that fits the largest photo, each centred; the
//! area no layer covers is transparent. Each rendered photo is read once:
//! its channels are streamed into the file and it is painted into the
//! flattened image before the next one is read.

use std::fs::File;
use std::io::{BufWriter, Seek, Write};
use std::path::{Path, PathBuf};

use little_exif::ifd::ExifTagGroup;
use little_exif::metadata::Metadata;
use tiff::Directory;
use tiff::decoder::ifd::Entry;
use tiff::encoder::colortype::RGB16;
use tiff::encoder::{DirectoryEncoder, TiffEncoder, TiffKindStandard};
use tiff::tags::{ExtraSamples, Tag, Type};

use crate::tiff_metadata::{write_main_ifd, write_sub_ifd};

const SIGNATURE: &[u8; 36] = b"Adobe Photoshop Document Data Block\0";
const TAG_IMAGE_SOURCE_DATA: u16 = 37724;
/// Photoshop's channel ids: the layer's transparency, then red, green, blue.
const CHANNEL_IDS: [i16; 4] = [-1, 0, 1, 2];
/// A classic TIFF addresses at most 4 GiB; this leaves room for the tags.
const MAX_FILE_BYTES: u64 = u32::MAX as u64 - (1 << 24);

/// One photo of the layered file: its rendered 16-bit copy and layer name.
pub struct LayerSource {
    pub name: String,
    pub image: PathBuf,
}

/// Where a layer sits on the canvas.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Placement {
    left: u32,
    top: u32,
    width: u32,
    height: u32,
}

impl Placement {
    fn pixels(self) -> u64 {
        u64::from(self.width) * u64::from(self.height)
    }

    /// The bytes of one channel's data: compression, then 16-bit samples.
    fn channel_bytes(self) -> u64 {
        2 + self.pixels() * 2
    }
}

/// The canvas that fits the largest layer and each layer centred on it.
fn layout(sizes: &[(u32, u32)]) -> ((u32, u32), Vec<Placement>) {
    let width = sizes.iter().map(|size| size.0).max().unwrap_or(0);
    let height = sizes.iter().map(|size| size.1).max().unwrap_or(0);
    let placements = sizes
        .iter()
        .map(|&(w, h)| Placement {
            left: (width - w) / 2,
            top: (height - h) / 2,
            width: w,
            height: h,
        })
        .collect();
    ((width, height), placements)
}

/// Photoshop data in the file's byte order (see the module documentation).
#[derive(Default)]
struct PsdBytes(Vec<u8>);

impl PsdBytes {
    fn bytes(&mut self, bytes: &[u8]) {
        self.0.extend_from_slice(bytes);
    }

    fn code(&mut self, code: &[u8; 4]) {
        if cfg!(target_endian = "little") {
            self.0.extend(code.iter().rev());
        } else {
            self.0.extend_from_slice(code);
        }
    }

    fn u16(&mut self, value: u16) {
        self.bytes(&value.to_ne_bytes());
    }

    fn i16(&mut self, value: i16) {
        self.bytes(&value.to_ne_bytes());
    }

    fn u32(&mut self, value: u32) {
        self.bytes(&value.to_ne_bytes());
    }

    fn i32(&mut self, value: i32) {
        self.bytes(&value.to_ne_bytes());
    }

    fn pad_to(&mut self, start: usize, multiple: usize) {
        let len = self.0.len() - start;
        self.0.resize(start + len.next_multiple_of(multiple), 0);
    }
}

fn to_u32(value: u64) -> Result<u32, String> {
    u32::try_from(value).map_err(|_| "The layered file would exceed 4 GB".to_string())
}

fn to_i32(value: u32) -> Result<i32, String> {
    i32::try_from(value).map_err(|_| "A layer is too large for a layered TIFF".to_string())
}

/// The layer count and records of the `Lr16` block, bottom layer first, as
/// [`layout`] places them. A negative count marks the flattened image's
/// extra sample as its transparency.
fn layer_records(layers: &[(&str, Placement)], has_merged_alpha: bool) -> Result<Vec<u8>, String> {
    let mut out = PsdBytes::default();
    let count = i16::try_from(layers.len()).map_err(|_| "Too many layers".to_string())?;
    out.i16(if has_merged_alpha { -count } else { count });
    for &(name, placement) in layers {
        out.i32(to_i32(placement.top)?);
        out.i32(to_i32(placement.left)?);
        out.i32(to_i32(placement.top + placement.height)?);
        out.i32(to_i32(placement.left + placement.width)?);
        out.u16(CHANNEL_IDS.len() as u16);
        for id in CHANNEL_IDS {
            out.i16(id);
            out.u32(to_u32(placement.channel_bytes())?);
        }
        out.code(b"8BIM");
        out.code(b"norm");
        // Opacity, clipping (base), flags (bit 3: bit 4 is valid; visible),
        // filler.
        out.bytes(&[255, 0, 0b1000, 0]);

        let mut extra = PsdBytes::default();
        // No layer mask, no blending ranges.
        extra.u32(0);
        extra.u32(0);
        // The legacy name: Pascal string, padded to 4 with its length byte.
        let legacy: Vec<u8> = name
            .chars()
            .map(|c| if c.is_ascii() { c as u8 } else { b'_' })
            .take(255)
            .collect();
        let start = extra.0.len();
        extra.bytes(&[legacy.len() as u8]);
        extra.bytes(&legacy);
        extra.pad_to(start, 4);
        // The full name (`luni`): UTF-16 units after their count.
        let units: Vec<u16> = name.encode_utf16().collect();
        let mut unicode = PsdBytes::default();
        unicode.u32(units.len() as u32);
        for unit in units {
            unicode.u16(unit);
        }
        unicode.pad_to(0, 4);
        extra.code(b"8BIM");
        extra.code(b"luni");
        extra.u32(unicode.0.len() as u32);
        extra.bytes(&unicode.0);

        out.u32(extra.0.len() as u32);
        out.bytes(&extra.0);
    }
    Ok(out.0)
}

/// Writes `layers` (top layer first) as a layered TIFF at `output`, with
/// `metadata` (EXIF and GPS) and `icc` in its main image. The file is
/// written through a temporary file, so a failure leaves nothing behind.
pub fn write_layered_tiff(
    output: &Path,
    layers: &[LayerSource],
    metadata: Option<&Metadata>,
    icc: &[u8],
) -> Result<(), String> {
    let sizes = layers
        .iter()
        .map(|layer| {
            image::image_dimensions(&layer.image)
                .map_err(|error| format!("Could not read a rendered layer: {error}"))
        })
        .collect::<Result<Vec<_>, _>>()?;
    let ((width, height), placements) = layout(&sizes);
    let has_merged_alpha = !placements
        .iter()
        .any(|placement| placement.width == width && placement.height == height);

    // Photoshop lists the bottom layer first.
    let bottom_up: Vec<(&LayerSource, Placement)> = layers.iter().zip(placements).rev().collect();
    let named: Vec<(&str, Placement)> = bottom_up
        .iter()
        .map(|(layer, placement)| (layer.name.as_str(), *placement))
        .collect();
    let records = layer_records(&named, has_merged_alpha)?;
    let channel_data: u64 = named
        .iter()
        .map(|(_, placement)| placement.channel_bytes() * CHANNEL_IDS.len() as u64)
        .sum();
    let block_len = (records.len() as u64 + channel_data).next_multiple_of(4);
    let samples = if has_merged_alpha { 4 } else { 3 };
    let flattened = u64::from(width) * u64::from(height) * samples * 2;
    if SIGNATURE.len() as u64 + 12 + block_len + flattened > MAX_FILE_BYTES {
        return Err(
            "The layered file would exceed the 4 GB a TIFF can hold; select fewer or smaller photos"
                .to_string(),
        );
    }

    crate::file_management::replace_file_atomically(output, |file| {
        write_file(
            file,
            &bottom_up,
            (width, height),
            has_merged_alpha,
            &records,
            to_u32(block_len).map_err(std::io::Error::other)?,
            metadata,
            icc,
        )
        .map_err(std::io::Error::other)
    })
}

#[allow(clippy::too_many_arguments)]
fn write_file(
    file: &mut File,
    bottom_up: &[(&LayerSource, Placement)],
    (width, height): (u32, u32),
    has_merged_alpha: bool,
    records: &[u8],
    block_len: u32,
    metadata: Option<&Metadata>,
    icc: &[u8],
) -> Result<(), String> {
    let tiff_error = |error: tiff::TiffError| format!("Could not write the layered TIFF: {error}");
    let mut encoder = TiffEncoder::new(BufWriter::new(file)).map_err(tiff_error)?;
    let exif_ifd = write_sub_ifd(&mut encoder, metadata, ExifTagGroup::EXIF)?;
    let gps_ifd = write_sub_ifd(&mut encoder, metadata, ExifTagGroup::GPS)?;
    let mut image = encoder
        .new_image::<RGB16>(width, height)
        .map_err(tiff_error)?;
    if has_merged_alpha {
        image
            .extra_samples(&[ExtraSamples::UnassociatedAlpha])
            .map_err(tiff_error)?;
    }
    write_main_ifd(image.encoder(), metadata, exif_ifd, gps_ifd, Some(icc))?;

    let samples = if has_merged_alpha { 4 } else { 3 };
    let mut flattened = vec![0u16; width as usize * height as usize * samples];
    write_layer_data(
        image.encoder(),
        bottom_up,
        records,
        block_len,
        |pixels, placement| paint(&mut flattened, width, samples, pixels, placement),
    )?;

    let mut written = 0;
    while image.next_strip_sample_count() > 0 {
        let count = image.next_strip_sample_count() as usize;
        image
            .write_strip(&flattened[written..written + count])
            .map_err(tiff_error)?;
        written += count;
    }
    image.finish().map_err(tiff_error)
}

/// Streams the 37724 tag's data into the file and adds the tag to the image
/// directory. `paint` gets each layer's pixels once they are written.
fn write_layer_data<W: Write + Seek>(
    directory: &mut DirectoryEncoder<'_, W, TiffKindStandard>,
    bottom_up: &[(&LayerSource, Placement)],
    records: &[u8],
    block_len: u32,
    mut paint: impl FnMut(&[u16], Placement),
) -> Result<(), String> {
    let tiff_error = |error: tiff::TiffError| format!("Could not write the layered TIFF: {error}");
    let mut write = |bytes: &[u8]| directory.write_data(bytes).map_err(tiff_error);
    // Values start on a word boundary.
    if write(&[])? % 2 == 1 {
        write(&[0])?;
    }
    let start = write(SIGNATURE)?;
    let mut header = PsdBytes::default();
    header.code(b"8BIM");
    header.code(b"Lr16");
    header.u32(block_len);
    write(&header.0)?;
    write(records)?;
    let mut written = records.len() as u64;

    let mut chunk = Vec::new();
    for (layer, placement) in bottom_up {
        let pixels = image::open(&layer.image)
            .map_err(|error| format!("Could not read a rendered layer: {error}"))?
            .into_rgb16();
        if pixels.dimensions() != (placement.width, placement.height) {
            return Err("A rendered layer changed while the layered file was written".into());
        }
        for (index, id) in CHANNEL_IDS.into_iter().enumerate() {
            let mut compression = PsdBytes::default();
            compression.u16(0);
            write(&compression.0)?;
            for row in pixels.as_raw().chunks_exact(placement.width as usize * 3) {
                chunk.clear();
                if id < 0 {
                    chunk.resize(placement.width as usize * 2, 0xff);
                } else {
                    let channel = index - 1;
                    chunk.extend(
                        row.chunks_exact(3)
                            .flat_map(|pixel| pixel[channel].to_be_bytes()),
                    );
                }
                write(&chunk)?;
            }
        }
        written += placement.channel_bytes() * CHANNEL_IDS.len() as u64;
        paint(pixels.as_raw(), *placement);
    }
    let padding = u64::from(block_len) - written;
    write(&vec![0; padding as usize])?;

    let data_len = SIGNATURE.len() as u64 + 12 + u64::from(block_len);
    let mut tag = Directory::empty();
    tag.extend([(
        Tag::Unknown(TAG_IMAGE_SOURCE_DATA),
        Entry::new(
            Type::UNDEFINED,
            to_u32(data_len)?,
            to_u32(start)?.to_ne_bytes(),
        ),
    )]);
    directory.extend_from(&tag);
    Ok(())
}

/// Copies an opaque RGB layer into the flattened image (`samples` per pixel:
/// RGB, or RGB and alpha).
fn paint(flattened: &mut [u16], width: u32, samples: usize, pixels: &[u16], at: Placement) {
    let row_len = width as usize * samples;
    for (y, row) in pixels.chunks_exact(at.width as usize * 3).enumerate() {
        let start = (at.top as usize + y) * row_len + at.left as usize * samples;
        let target = &mut flattened[start..start + at.width as usize * samples];
        for (out, pixel) in target.chunks_exact_mut(samples).zip(row.chunks_exact(3)) {
            out[..3].copy_from_slice(pixel);
            if samples == 4 {
                out[3] = u16::MAX;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn layers_are_centred_on_a_canvas_that_fits_the_largest() {
        let ((width, height), placements) = layout(&[(6, 4), (4, 6), (2, 2)]);
        assert_eq!((width, height), (6, 6));
        assert_eq!(
            placements,
            vec![
                Placement {
                    left: 0,
                    top: 1,
                    width: 6,
                    height: 4
                },
                Placement {
                    left: 1,
                    top: 0,
                    width: 4,
                    height: 6
                },
                Placement {
                    left: 2,
                    top: 2,
                    width: 2,
                    height: 2
                },
            ]
        );
    }

    fn read_i16(bytes: &[u8], at: usize) -> i16 {
        i16::from_ne_bytes([bytes[at], bytes[at + 1]])
    }

    fn read_i32(bytes: &[u8], at: usize) -> i32 {
        i32::from_ne_bytes(bytes[at..at + 4].try_into().unwrap())
    }

    fn read_u32(bytes: &[u8], at: usize) -> u32 {
        u32::from_ne_bytes(bytes[at..at + 4].try_into().unwrap())
    }

    fn code(bytes: &[u8], at: usize) -> [u8; 4] {
        let mut code: [u8; 4] = bytes[at..at + 4].try_into().unwrap();
        if cfg!(target_endian = "little") {
            code.reverse();
        }
        code
    }

    #[test]
    fn records_follow_photoshops_layout() {
        let placement = Placement {
            left: 1,
            top: 2,
            width: 3,
            height: 4,
        };
        let records = layer_records(&[("Rüe", placement)], true).unwrap();
        assert_eq!(read_i16(&records, 0), -1);
        // Top, left, bottom, right.
        let rect: Vec<i32> = (0..4).map(|i| read_i32(&records, 2 + i * 4)).collect();
        assert_eq!(rect, vec![2, 1, 6, 4]);
        assert_eq!(read_i16(&records, 18), 4);
        for (index, id) in CHANNEL_IDS.into_iter().enumerate() {
            let at = 20 + index * 6;
            assert_eq!(read_i16(&records, at), id);
            assert_eq!(read_u32(&records, at + 2), 2 + 3 * 4 * 2);
        }
        assert_eq!(&code(&records, 44), b"8BIM");
        assert_eq!(&code(&records, 48), b"norm");
        assert_eq!(&records[52..56], &[255, 0, 8, 0]);
        let extra_len = read_u32(&records, 56) as usize;
        assert_eq!(records.len(), 60 + extra_len);
        let extra = &records[60..];
        assert_eq!((read_u32(extra, 0), read_u32(extra, 4)), (0, 0));
        // "R_e" as a Pascal string padded to 4.
        assert_eq!(&extra[8..12], &[3, b'R', b'_', b'e']);
        assert_eq!(&code(extra, 12), b"8BIM");
        assert_eq!(&code(extra, 16), b"luni");
        let luni_len = read_u32(extra, 20) as usize;
        assert_eq!(luni_len % 4, 0);
        assert_eq!(extra.len(), 24 + luni_len);
        assert_eq!(read_u32(extra, 24), 3);
        let units: Vec<u16> = (0..3)
            .map(|i| u16::from_ne_bytes([extra[28 + i * 2], extra[29 + i * 2]]))
            .collect();
        assert_eq!(String::from_utf16(&units).unwrap(), "Rüe");
    }

    fn rendered(folder: &Path, name: &str, size: (u32, u32), value: u16) -> LayerSource {
        let image = image::ImageBuffer::from_pixel(size.0, size.1, image::Rgb([value; 3]));
        let path = folder.join(format!("{name}.tif"));
        image::DynamicImage::ImageRgb16(image).save(&path).unwrap();
        LayerSource {
            name: name.to_owned(),
            image: path,
        }
    }

    #[test]
    fn the_file_holds_the_flattened_image_and_every_layer() {
        let folder = tempfile::tempdir().unwrap();
        let top = rendered(folder.path(), "top", (2, 2), 1000);
        let bottom = rendered(folder.path(), "bottom", (4, 2), 2000);
        let output = folder.path().join("layers.tif");
        write_layered_tiff(&output, &[top, bottom], None, b"icc").unwrap();

        // The flattened image: the top layer centred over the bottom one, no
        // transparency since the bottom layer covers the canvas.
        let flattened = image::open(&output).unwrap();
        assert_eq!(flattened.color(), image::ColorType::Rgb16);
        let flattened = flattened.into_rgb16();
        let reds: Vec<u16> = flattened.pixels().map(|pixel| pixel[0]).collect();
        assert_eq!(reds, vec![2000, 1000, 1000, 2000, 2000, 1000, 1000, 2000]);

        let mut decoder = tiff::decoder::Decoder::new(File::open(&output).unwrap()).unwrap();
        assert_eq!(
            decoder.get_tag_u8_vec(Tag::IccProfile).unwrap(),
            b"icc".to_vec()
        );
        let data = decoder
            .get_tag_u8_vec(Tag::Unknown(TAG_IMAGE_SOURCE_DATA))
            .unwrap();
        assert!(data.starts_with(SIGNATURE));
        let block = &data[SIGNATURE.len()..];
        assert_eq!(&code(block, 0), b"8BIM");
        assert_eq!(&code(block, 4), b"Lr16");
        let len = read_u32(block, 8) as usize;
        assert_eq!(block.len(), 12 + len);
        assert_eq!(len % 4, 0);
        let info = &block[12..];
        // Two layers, bottom first; no merged transparency.
        assert_eq!(read_i16(info, 0), 2);
        let first_rect: Vec<i32> = (0..4).map(|i| read_i32(info, 2 + i * 4)).collect();
        assert_eq!(first_rect, vec![0, 0, 2, 4]);

        // The bottom layer's data follows both records: its transparency,
        // then red, as big-endian samples.
        let records_len = layer_records(
            &[
                ("bottom", layout(&[(4, 2)]).1[0]),
                (
                    "top",
                    Placement {
                        left: 1,
                        top: 0,
                        width: 2,
                        height: 2,
                    },
                ),
            ],
            false,
        )
        .unwrap()
        .len();
        let channels = &info[records_len..];
        assert_eq!(read_i16(channels, 0), 0);
        assert!(channels[2..18].iter().all(|&byte| byte == 0xff));
        assert_eq!(read_i16(channels, 18), 0);
        assert_eq!(&channels[20..22], &2000u16.to_be_bytes());
    }

    #[test]
    fn uncovered_canvas_is_transparent() {
        let folder = tempfile::tempdir().unwrap();
        let wide = rendered(folder.path(), "wide", (4, 2), 1000);
        let tall = rendered(folder.path(), "tall", (2, 4), 2000);
        let output = folder.path().join("layers.tif");
        write_layered_tiff(&output, &[wide, tall], None, b"icc").unwrap();

        let flattened = image::open(&output).unwrap().into_rgba16();
        assert_eq!(flattened.dimensions(), (4, 4));
        // A corner no layer covers, the tall layer's edge, the wide layer.
        assert_eq!(flattened.get_pixel(0, 0)[3], 0);
        assert_eq!(flattened.get_pixel(1, 0).0, [2000, 2000, 2000, u16::MAX]);
        assert_eq!(flattened.get_pixel(0, 1).0, [1000, 1000, 1000, u16::MAX]);
    }
}
