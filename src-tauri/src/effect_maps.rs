use crate::cache_utils::GEOMETRY_KEYS;
use crate::image_processing::{
    GeometryParams, get_geometry_params_from_json, is_geometry_identity, warp_image_geometry,
};
use crate::relight::RELIGHT_NORMAL_MAP_KEY;
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use image::imageops::{FilterType, resize, thumbnail};
use image::{DynamicImage, GrayImage, Luma, Rgb, Rgb32FImage, Rgba, RgbaImage};
use rayon::prelude::*;
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::sync::{Arc, Mutex};

pub const SOURCE_SPACE_MAP_PREFIX: &str = "data:image/png;space=source;base64,";

const MAP_CACHE_CAPACITY: usize = 4;

static LUMA_MAP_CACHE: Mutex<Vec<(u64, Arc<GrayImage>)>> = Mutex::new(Vec::new());
static RGBA_MAP_CACHE: Mutex<Vec<(u64, Arc<RgbaImage>)>> = Mutex::new(Vec::new());

pub fn encode_source_space_map(image: &DynamicImage) -> Result<String, String> {
    let mut buf = std::io::Cursor::new(Vec::new());
    image
        .write_to(&mut buf, image::ImageFormat::Png)
        .map_err(|e| e.to_string())?;
    Ok(format!(
        "{}{}",
        SOURCE_SPACE_MAP_PREFIX,
        BASE64.encode(buf.get_ref())
    ))
}

pub fn is_source_space_map(data_url: &str) -> bool {
    data_url.starts_with(SOURCE_SPACE_MAP_PREFIX)
}

pub fn effect_map_key(data_url: &str, adjustments: &serde_json::Value) -> u64 {
    let mut hasher = DefaultHasher::new();
    data_url.hash(&mut hasher);

    if is_source_space_map(data_url) {
        for key in GEOMETRY_KEYS {
            if let Some(val) = adjustments.get(key) {
                key.hash(&mut hasher);
                val.to_string().hash(&mut hasher);
            }
        }
    }

    hasher.finish()
}

pub fn resolve_luma_map(data_url: &str, adjustments: &serde_json::Value) -> Option<Arc<GrayImage>> {
    cached_map(
        &LUMA_MAP_CACHE,
        effect_map_key(data_url, adjustments),
        || {
            let map = decode_data_url(data_url)?;
            Some(if is_source_space_map(data_url) {
                warp_effect_map(&map, adjustments).into_luma8()
            } else {
                map.into_luma8()
            })
        },
    )
}

pub fn resolve_rgba_map(data_url: &str, adjustments: &serde_json::Value) -> Option<Arc<RgbaImage>> {
    cached_map(
        &RGBA_MAP_CACHE,
        effect_map_key(data_url, adjustments),
        || {
            let map = decode_data_url(data_url)?.into_rgba8();
            if !is_source_space_map(data_url) {
                return Some(map);
            }

            let alpha = GrayImage::from_fn(map.width(), map.height(), |x, y| {
                Luma([map.get_pixel(x, y)[3]])
            });
            let warped_rgb =
                warp_effect_map(&DynamicImage::ImageRgba8(map), adjustments).into_rgb8();
            let warped_alpha =
                warp_effect_map(&DynamicImage::ImageLuma8(alpha), adjustments).into_luma8();

            let (width, height) = warped_rgb.dimensions();
            let rotations = local_warp_rotations(width, height, adjustments);

            Some(RgbaImage::from_fn(width, height, |x, y| {
                let [r, g, b] = warped_rgb.get_pixel(x, y).0;
                let (r, g) = match &rotations {
                    Some(rotations) => rotate_normal(r, g, rotations[(y * width + x) as usize]),
                    None => (r, g),
                };
                Rgba([r, g, b, warped_alpha.get_pixel(x, y)[0]])
            }))
        },
    )
}

/// The small colour + depth (and, for Relight, normal) grid behind the 3D depth view.
///
/// `map_key` names an effect map in `adjustments`; `map_data` is a depth mask's own map instead.
/// Layout (little endian): width, height, has-normals as `u32`, then one RGBA texel per cell
/// (colour, nearness 0–255 in alpha), then for Relight one RGBA texel per cell of the normal map.
pub fn build_depth_preview(
    image: &DynamicImage,
    is_raw: bool,
    adjustments: &serde_json::Value,
    map_key: Option<&str>,
    map_data: Option<&str>,
    max_size: u32,
) -> Option<Vec<u8>> {
    let data_url = match map_data {
        Some(data) => data,
        None => adjustments[map_key?].as_str()?,
    };
    if data_url.is_empty() {
        return None;
    }
    let with_normals = map_data.is_none() && map_key == Some(RELIGHT_NORMAL_MAP_KEY);

    let fit = |(mw, mh): (u32, u32)| {
        let scale = (max_size as f32 / mw.max(mh) as f32).min(1.0);
        (
            ((mw as f32 * scale).round() as u32).max(2),
            ((mh as f32 * scale).round() as u32).max(2),
        )
    };
    let (map, (w, h)) = if map_data.is_some() {
        let decoded = decode_data_url(data_url)?;
        let depth = if is_source_space_map(data_url) {
            warp_effect_map(&decoded, adjustments)
        } else {
            decoded
        }
        .into_luma8();
        let (w, h) = fit(depth.dimensions());
        (DynamicImage::ImageLuma8(thumbnail(&depth, w, h)), (w, h))
    } else if with_normals {
        let normals = resolve_rgba_map(data_url, adjustments)?;
        let (w, h) = fit(normals.dimensions());
        (
            DynamicImage::ImageRgba8(resize(&*normals, w, h, FilterType::Triangle)),
            (w, h),
        )
    } else {
        let depth = resolve_luma_map(data_url, adjustments)?;
        let (w, h) = fit(depth.dimensions());
        (
            DynamicImage::ImageLuma8(resize(&*depth, w, h, FilterType::Triangle)),
            (w, h),
        )
    };

    // Downscale first: the RAW curve and the warp then run on a few thousand pixels.
    let sampled = image.resize_exact(w * 2, h * 2, FilterType::Nearest);
    let source = crate::image_processing::build_full_source_image(&sampled, is_raw);
    let color = warp_effect_map(&source, adjustments)
        .resize_exact(w, h, FilterType::Triangle)
        .into_rgb8();

    let mut out = Vec::with_capacity(12 + (w * h) as usize * if with_normals { 8 } else { 4 });
    for value in [w, h, with_normals as u32] {
        out.extend_from_slice(&value.to_le_bytes());
    }
    match &map {
        DynamicImage::ImageRgba8(normals) => {
            // The normal map's alpha is distance; the grid stores nearness like a depth map.
            for (c, n) in color.pixels().zip(normals.pixels()) {
                out.extend_from_slice(&[c[0], c[1], c[2], 255 - n[3]]);
            }
            for n in normals.pixels() {
                out.extend_from_slice(&[n[0], n[1], n[2], 255]);
            }
        }
        _ => {
            for (c, d) in color.pixels().zip(map.to_luma8().pixels()) {
                out.extend_from_slice(&[c[0], c[1], c[2], d[0]]);
            }
        }
    }
    Some(out)
}

fn effect_map_geometry_params(adjustments: &serde_json::Value) -> GeometryParams {
    let mut params = get_geometry_params_from_json(adjustments);
    params.lens_vignette_enabled = false;
    params.lens_tca_enabled = false;
    params
}

fn warp_effect_map(map: &DynamicImage, adjustments: &serde_json::Value) -> DynamicImage {
    let params = effect_map_geometry_params(adjustments);

    if is_geometry_identity(&params) {
        map.clone()
    } else {
        warp_image_geometry(map, params)
    }
}

fn local_warp_rotations(
    width: u32,
    height: u32,
    adjustments: &serde_json::Value,
) -> Option<Vec<(f32, f32)>> {
    let params = effect_map_geometry_params(adjustments);
    if is_geometry_identity(&params) {
        return None;
    }

    let coords = Rgb32FImage::from_fn(width, height, |x, y| Rgb([x as f32, y as f32, 1.0]));
    let warped = warp_image_geometry(&DynamicImage::ImageRgb32F(coords), params).into_rgb32f();
    let (w, h) = (width as usize, height as usize);
    let src = warped.as_raw();
    let source_at = |x: usize, y: usize| {
        let i = (y * w + x) * 3;
        [src[i], src[i + 1], src[i + 2]]
    };

    Some(
        (0..w * h)
            .into_par_iter()
            .map(|i| {
                let (x, y) = (i % w, i / w);
                let (x0, x1) = (x.saturating_sub(1), (x + 1).min(w - 1));
                let (y0, y1) = (y.saturating_sub(1), (y + 1).min(h - 1));
                if x0 == x1 || y0 == y1 {
                    return (1.0, 0.0);
                }

                let (left, right) = (source_at(x0, y), source_at(x1, y));
                let (top, bottom) = (source_at(x, y0), source_at(x, y1));
                if [left, right, top, bottom].iter().any(|p| p[2] < 0.999) {
                    return (1.0, 0.0);
                }

                let (dx, dy) = ((x1 - x0) as f32, (y1 - y0) as f32);
                let k00 = (right[0] - left[0]) / dx;
                let k10 = (right[1] - left[1]) / dx;
                let k01 = (bottom[0] - top[0]) / dy;
                let k11 = (bottom[1] - top[1]) / dy;

                let (sin, cos) = (-(k10 - k01).atan2(k00 + k11)).sin_cos();
                (cos, sin)
            })
            .collect(),
    )
}

fn rotate_normal(r: u8, g: u8, (cos, sin): (f32, f32)) -> (u8, u8) {
    let nx = r as f32 / 127.5 - 1.0;
    let ny = 1.0 - g as f32 / 127.5;
    let rotated_x = cos * nx - sin * ny;
    let rotated_y = sin * nx + cos * ny;
    let pack = |v: f32| ((v + 1.0) * 127.5).round().clamp(0.0, 255.0) as u8;
    (pack(rotated_x), pack(-rotated_y))
}

fn decode_data_url(data_url: &str) -> Option<DynamicImage> {
    let b64_data = match data_url.find(',') {
        Some(idx) => &data_url[idx + 1..],
        None => data_url,
    };
    let decoded = BASE64.decode(b64_data).ok()?;
    image::load_from_memory(&decoded).ok()
}

fn cached_map<T>(
    cache: &Mutex<Vec<(u64, Arc<T>)>>,
    key: u64,
    build: impl FnOnce() -> Option<T>,
) -> Option<Arc<T>> {
    if let Some((_, map)) = cache
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .iter()
        .find(|(k, _)| *k == key)
    {
        return Some(Arc::clone(map));
    }

    let map = Arc::new(build()?);

    let mut cache_lock = cache.lock().unwrap_or_else(|e| e.into_inner());
    if cache_lock.len() >= MAP_CACHE_CAPACITY {
        cache_lock.remove(0);
    }
    cache_lock.push((key, Arc::clone(&map)));

    Some(map)
}

#[cfg(test)]
mod tests {
    use super::{build_depth_preview, encode_source_space_map, rotate_normal};
    use image::{DynamicImage, GrayImage, Luma, Rgb, RgbImage, Rgba, RgbaImage};

    fn header(bytes: &[u8]) -> [u32; 3] {
        [0, 1, 2].map(|i| u32::from_le_bytes(bytes[i * 4..i * 4 + 4].try_into().unwrap()))
    }

    #[test]
    fn depth_preview_packs_colour_with_nearness_and_fits_the_size() {
        let image = DynamicImage::ImageRgb8(RgbImage::from_pixel(64, 32, Rgb([200, 100, 50])));
        let depth = GrayImage::from_fn(32, 16, |x, _| Luma([if x < 16 { 40 } else { 220 }]));
        let map = encode_source_space_map(&DynamicImage::ImageLuma8(depth)).unwrap();
        let adjustments = serde_json::json!({ "fogDepthMap": map });

        let bytes = build_depth_preview(&image, false, &adjustments, Some("fogDepthMap"), None, 16)
            .unwrap();
        assert_eq!(header(&bytes), [16, 8, 0]);
        assert_eq!(bytes.len(), 12 + 16 * 8 * 4);
        let texel = |x: usize, y: usize| &bytes[12 + (y * 16 + x) * 4..12 + (y * 16 + x) * 4 + 4];
        assert_eq!(texel(0, 0), [200, 100, 50, 40]);
        assert_eq!(texel(15, 7), [200, 100, 50, 220]);

        // A depth mask sends its own map; an empty or missing map gives nothing.
        let mask = serde_json::json!({});
        let own = encode_source_space_map(&DynamicImage::ImageLuma8(GrayImage::new(8, 4))).unwrap();
        assert_eq!(
            header(&build_depth_preview(&image, false, &mask, None, Some(&own), 16).unwrap()),
            [8, 4, 0]
        );
        assert!(build_depth_preview(&image, false, &mask, Some("fogDepthMap"), None, 16).is_none());
        assert!(build_depth_preview(&image, false, &mask, None, Some(""), 16).is_none());
    }

    #[test]
    fn relight_preview_appends_normals_and_turns_distance_into_nearness() {
        let image = DynamicImage::ImageRgb8(RgbImage::from_pixel(8, 8, Rgb([10, 20, 30])));
        let normals = RgbaImage::from_pixel(8, 8, Rgba([128, 64, 255, 200]));
        let map = encode_source_space_map(&DynamicImage::ImageRgba8(normals)).unwrap();
        let adjustments = serde_json::json!({ "relightNormalMap": map });

        let bytes = build_depth_preview(
            &image,
            false,
            &adjustments,
            Some("relightNormalMap"),
            None,
            64,
        )
        .unwrap();
        assert_eq!(header(&bytes), [8, 8, 1]);
        assert_eq!(bytes.len(), 12 + 8 * 8 * 8);
        assert_eq!(&bytes[12..16], [10, 20, 30, 255 - 200]);
        assert_eq!(
            &bytes[12 + 8 * 8 * 4..12 + 8 * 8 * 4 + 4],
            [128, 64, 255, 255]
        );
    }

    #[test]
    fn rotate_normal_turns_encoded_vectors_in_image_space() {
        assert_eq!(rotate_normal(255, 128, (1.0, 0.0)), (255, 128));
        // A quarter turn maps +x onto +y, which the green channel encodes as up (g = 0).
        assert_eq!(rotate_normal(255, 128, (0.0, 1.0)), (128, 0));
    }
}
