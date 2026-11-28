use crate::ai_processing::{
    AiDepthMaskParameters, AiForegroundMaskParameters, AiSkyMaskParameters, AiSubjectMaskParameters,
};
use base64::{Engine as _, engine::general_purpose};
use image::{DynamicImage, GenericImageView, GrayImage, ImageFormat, Luma, Rgba, RgbaImage};
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::collections::hash_map::DefaultHasher;
use std::f32::consts::PI;
use std::hash::{Hash, Hasher};
use std::io::Cursor;
use std::sync::Arc; // Required for parallel rasterization
use tauri::Manager;

use crate::app_state::AppState;
use crate::get_cached_full_warped_image;

#[derive(serde::Serialize, serde::Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(crate = "serde")]
#[serde(rename_all = "camelCase")]
pub enum SubMaskMode {
    Additive,
    Subtractive,
    Intersect,
}

#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
#[serde(crate = "serde")]
#[serde(rename_all = "camelCase")]
pub struct SubMask {
    pub id: String,
    #[serde(rename = "type")]
    pub mask_type: String,
    pub visible: bool,
    #[serde(default)]
    pub invert: bool,
    #[serde(default = "default_opacity")]
    pub opacity: f32,
    #[serde(deserialize_with = "deserialize_sub_mask_mode")]
    pub mode: SubMaskMode,
    pub parameters: Value,
}

fn default_opacity() -> f32 {
    100.0
}

/// Reads a sub-mask mode, taking `Additive` for a value that is not a mode. Before 1.85.2,
/// dropping a mask tool onto a component saved the drop position (a number) as its mode,
/// which made the photo's whole mask list unreadable.
fn deserialize_sub_mask_mode<'de, D>(deserializer: D) -> Result<SubMaskMode, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let value = Value::deserialize(deserializer)?;
    Ok(SubMaskMode::deserialize(value).unwrap_or(SubMaskMode::Additive))
}

#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
#[serde(crate = "serde")]
#[serde(rename_all = "camelCase")]
pub struct MaskDefinition {
    pub id: String,
    pub name: String,
    pub visible: bool,
    pub invert: bool,
    #[serde(default = "default_opacity")]
    pub opacity: f32,
    #[serde(default)]
    pub blend_mode: String,
    pub adjustments: Value,
    pub sub_masks: Vec<SubMask>,
}

impl MaskDefinition {
    pub fn requires_warped_image(&self) -> bool {
        self.sub_masks
            .iter()
            .any(|sm| sm.mask_type == "color" || sm.mask_type == "luminance")
    }
}

#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
#[serde(crate = "serde")]
#[serde(rename_all = "camelCase")]
pub struct PatchData {
    pub color: String,
    pub mask: String,
}

#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
#[serde(crate = "serde")]
#[serde(rename_all = "camelCase")]
pub struct AiPatchDefinition {
    pub id: String,
    pub name: String,
    pub visible: bool,
    pub invert: bool,
    pub prompt: String,
    #[serde(default)]
    pub patch_data: Option<PatchData>,
    #[serde(default = "default_opacity")]
    pub opacity: f32,
    pub sub_masks: Vec<SubMask>,
}

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct GrowFeatherParameters {
    #[serde(default)]
    grow: f32,
    #[serde(default)]
    feather: f32,
}

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct RadialMaskParameters {
    center_x: f64,
    center_y: f64,
    radius_x: f64,
    radius_y: f64,
    rotation: f32,
    feather: f32,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
struct LinearMaskParameters {
    start_x: f64,
    start_y: f64,
    end_x: f64,
    end_y: f64,
    #[serde(default = "default_range")]
    range: f32,
}

fn default_range() -> f32 {
    50.0
}

impl Default for LinearMaskParameters {
    fn default() -> Self {
        Self {
            start_x: 0.0,
            start_y: 0.0,
            end_x: 0.0,
            end_y: 0.0,
            range: default_range(),
        }
    }
}

#[derive(Serialize, Deserialize, Debug, Clone)]
struct Point {
    x: f64,
    y: f64,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
struct BrushLine {
    tool: String,
    brush_size: f32,
    points: Vec<Point>,
    #[serde(default = "default_brush_feather")]
    feather: f32,
}

fn default_brush_feather() -> f32 {
    0.5
}

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct BrushMaskParameters {
    #[serde(default)]
    lines: Vec<BrushLine>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
struct FlowLine {
    tool: String,
    brush_size: f32,
    points: Vec<Point>,
    #[serde(default = "default_brush_feather")]
    feather: f32,
    #[serde(default = "default_line_flow")]
    flow: f32,
}

fn default_line_flow() -> f32 {
    10.0
}

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct FlowMaskParameters {
    #[serde(default)]
    lines: Vec<FlowLine>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
struct ParametricMaskParameters {
    target_x: f64,
    target_y: f64,
    #[serde(default = "default_tolerance")]
    tolerance: f32,
    #[serde(default)]
    grow: f32,
    #[serde(default)]
    feather: f32,
    #[serde(default)]
    rotation: f32,
    #[serde(default)]
    flip_horizontal: bool,
    #[serde(default)]
    flip_vertical: bool,
    #[serde(default)]
    orientation_steps: u8,
}

fn default_tolerance() -> f32 {
    20.0
}

impl Default for ParametricMaskParameters {
    fn default() -> Self {
        Self {
            target_x: 0.0,
            target_y: 0.0,
            tolerance: default_tolerance(),
            grow: 0.0,
            feather: 35.0,
            rotation: 0.0,
            flip_horizontal: false,
            flip_vertical: false,
            orientation_steps: 0,
        }
    }
}

/// A Luminance mask's tone range in percent (0 black, 100 white). Masks made before `1.42.0`
/// have none and keep selecting by Tolerance around the picked tone.
#[derive(Deserialize, Debug, Clone, Copy)]
#[serde(rename_all = "camelCase")]
struct LuminanceRangeParameters {
    min_luminance: f32,
    max_luminance: f32,
    #[serde(default)]
    min_fade: f32,
    #[serde(default)]
    max_fade: f32,
}

/// Rec. 601 luma of a source pixel in 0–255, the tone a Luminance mask selects by.
fn pixel_luma(pixel: Rgba<u8>) -> f32 {
    0.299 * pixel[0] as f32 + 0.587 * pixel[1] as f32 + 0.114 * pixel[2] as f32
}

fn source_pixel_at(warped: &DynamicImage, x: f64, y: f64) -> Option<Rgba<u8>> {
    let (x, y) = (x.round() as i64, y.round() as i64);
    let (width, height) = warped.dimensions();
    (x >= 0 && y >= 0 && x < width as i64 && y < height as i64)
        .then(|| warped.get_pixel(x as u32, y as u32))
}

/// Grows (`pick` = `max`) or shrinks (`min`) a mask: each pixel takes the `pick` of the
/// square of side `2k + 1` around it, clipped at the image edges. A row pass then a column
/// pass, each over rows in parallel (upstream `15a9ff2e`); the result is exact, so the
/// order of the work does not matter.
fn grayscale_square_filter(image: &GrayImage, k: u8, pick: fn(u8, u8) -> u8) -> GrayImage {
    let (width, height) = image.dimensions();
    if width == 0 || height == 0 {
        return image.clone();
    }
    let (w, h, r) = (width as usize, height as usize, k as usize);
    let window = |center: usize, len: usize| center.saturating_sub(r)..=(center + r).min(len - 1);

    let mut rows = vec![0u8; w * h];
    rows.par_chunks_exact_mut(w)
        .zip(image.as_raw().par_chunks_exact(w))
        .for_each(|(out, row)| {
            for (x, value) in out.iter_mut().enumerate() {
                let taps = &row[window(x, w)];
                *value = taps[1..].iter().fold(taps[0], |a, &b| pick(a, b));
            }
        });

    let mut filtered = vec![0u8; w * h];
    filtered
        .par_chunks_exact_mut(w)
        .enumerate()
        .for_each(|(y, out)| {
            let taps = window(y, h);
            out.copy_from_slice(&rows[taps.start() * w..][..w]);
            for yi in taps.skip(1) {
                for (o, &t) in out.iter_mut().zip(&rows[yi * w..][..w]) {
                    *o = pick(*o, t);
                }
            }
        });

    GrayImage::from_raw(width, height, filtered).expect("mask buffer size")
}

/// imageproc's `gaussian_blur_f32` on a mask, computed the same way (its kernel cut at 2σ,
/// edges clamped, the row pass stored as `u8`, values truncated), so the result is
/// bit-identical, but over rows in parallel (upstream `15a9ff2e`'s `gaussian_blur_mask`).
fn gaussian_blur_mask(mask: &GrayImage, sigma: f32) -> GrayImage {
    let (w, h) = (mask.width() as usize, mask.height() as usize);
    if w == 0 || h == 0 {
        return mask.clone();
    }
    let kernel = gaussian_kernel(sigma);
    let radius = kernel.len() / 2;
    let tap = |center: usize, offset: usize, len: usize| {
        (center + offset).saturating_sub(radius).min(len - 1)
    };

    let mut rows = vec![0u8; w * h];
    rows.par_chunks_exact_mut(w)
        .zip(mask.as_raw().par_chunks_exact(w))
        .for_each(|(out, row)| {
            for (x, value) in out.iter_mut().enumerate() {
                let mut acc = 0.0f32;
                for (i, k) in kernel.iter().enumerate() {
                    acc += row[tap(x, i, w)] as f32 * k;
                }
                *value = saturate_u8(acc);
            }
        });

    let mut blurred = vec![0u8; w * h];
    blurred
        .par_chunks_exact_mut(w)
        .enumerate()
        .for_each(|(y, out)| {
            let mut acc = vec![0.0f32; w];
            for (i, k) in kernel.iter().enumerate() {
                for (a, &v) in acc.iter_mut().zip(&rows[tap(y, i, h) * w..][..w]) {
                    *a += v as f32 * k;
                }
            }
            for (value, a) in out.iter_mut().zip(acc) {
                *value = saturate_u8(a);
            }
        });

    GrayImage::from_raw(w as u32, h as u32, blurred).expect("mask buffer size")
}

/// imageproc's normalised Gaussian kernel: radius `ceil(2σ)`, the same density formula.
fn gaussian_kernel(sigma: f32) -> Vec<f32> {
    let radius = (2.0 * sigma).ceil() as usize;
    let pdf =
        |x: f32| (sigma * (2.0 * PI).sqrt()).recip() * (-x.powi(2) / (2.0 * sigma.powi(2))).exp();
    let mut kernel = vec![0.0f32; 2 * radius + 1];
    for i in 0..=radius {
        let value = pdf(i as f32);
        kernel[radius + i] = value;
        kernel[radius - i] = value;
    }
    let sum: f32 = kernel.iter().sum();
    kernel.iter_mut().for_each(|k| *k /= sum);
    kernel
}

/// imageproc's `Clamp<f32> for u8`: truncates, saturating at 0 and 255 (NaN gives 0).
fn saturate_u8(value: f32) -> u8 {
    if value < 255.0 {
        if value > 0.0 { value as u8 } else { 0 }
    } else {
        255
    }
}

fn apply_grow_and_feather(mask: &mut GrayImage, grow: f32, feather: f32, width: u32, height: u32) {
    let base_dimension = width.min(height) as f32;

    if grow.abs() > 0.01 {
        const MAX_GROW_PERCENTAGE: f32 = 0.01;
        let grow_pixels = (grow / 100.0) * base_dimension * MAX_GROW_PERCENTAGE;

        let amount = grow_pixels.abs().round() as u8;

        if amount > 0 {
            let pick: fn(u8, u8) -> u8 = if grow_pixels > 0.0 { u8::max } else { u8::min };
            *mask = grayscale_square_filter(mask, amount, pick);
        }
    }

    if feather > 0.0 {
        const MAX_FEATHER_SIGMA_PERCENTAGE: f32 = 0.005;
        let sigma = (feather / 100.0) * base_dimension * MAX_FEATHER_SIGMA_PERCENTAGE;

        if sigma > 0.01 {
            *mask = gaussian_blur_mask(mask, sigma);
        }
    }
}

fn stroke_bounds(
    points: &[Point],
    width: u32,
    height: u32,
    radius: f32,
    scale: f32,
    crop_offset: (f32, f32),
) -> Option<(u32, u32, u32, u32)> {
    if width == 0 || height == 0 || points.is_empty() {
        return None;
    }

    let mut min_x = f32::INFINITY;
    let mut min_y = f32::INFINITY;
    let mut max_x = f32::NEG_INFINITY;
    let mut max_y = f32::NEG_INFINITY;
    let r_pad = radius.ceil() + 2.0;

    for p in points {
        let px = p.x as f32 * scale - crop_offset.0;
        let py = p.y as f32 * scale - crop_offset.1;

        min_x = min_x.min(px - r_pad);
        min_y = min_y.min(py - r_pad);
        max_x = max_x.max(px + r_pad);
        max_y = max_y.max(py + r_pad);
    }

    if max_x < 0.0 || max_y < 0.0 || min_x > (width - 1) as f32 || min_y > (height - 1) as f32 {
        return None;
    }

    let min_x = min_x.floor().max(0.0).min((width - 1) as f32) as u32;
    let min_y = min_y.floor().max(0.0).min((height - 1) as f32) as u32;
    let max_x = max_x.ceil().max(0.0).min((width - 1) as f32) as u32;
    let max_y = max_y.ceil().max(0.0).min((height - 1) as f32) as u32;

    if min_x > max_x || min_y > max_y {
        None
    } else {
        Some((min_x, min_y, max_x, max_y))
    }
}

#[allow(clippy::too_many_arguments)]
fn render_stroke_layer_parallel(
    points: &[Point],
    radius: f32,
    feather: f32,
    scale: f32,
    crop_offset: (f32, f32),
    layer_offset: (f32, f32),
    bb_w: u32,
    bb_h: u32,
) -> GrayImage {
    let mut out_pixels = vec![0u8; (bb_w * bb_h) as usize];
    if points.is_empty() || radius <= 0.0 {
        return GrayImage::from_raw(bb_w, bb_h, out_pixels).unwrap();
    }

    struct Segment {
        x1: f32,
        y1: f32,
        dx: f32,
        dy: f32,
        len_sq: f32,
        bounds_left: i32,
        bounds_right: i32,
        bounds_top: i32,
        bounds_bottom: i32,
    }

    let mut segments = Vec::with_capacity(points.len().saturating_sub(1));
    for pair in points.windows(2) {
        let x1 = pair[0].x as f32 * scale - crop_offset.0 - layer_offset.0;
        let y1 = pair[0].y as f32 * scale - crop_offset.1 - layer_offset.1;
        let x2 = pair[1].x as f32 * scale - crop_offset.0 - layer_offset.0;
        let y2 = pair[1].y as f32 * scale - crop_offset.1 - layer_offset.1;

        let left = ((x1.min(x2) - radius).floor() as i32).max(0);
        let right = ((x1.max(x2) + radius).ceil() as i32).min(bb_w as i32 - 1);
        let top = ((y1.min(y2) - radius).floor() as i32).max(0);
        let bottom = ((y1.max(y2) + radius).ceil() as i32).min(bb_h as i32 - 1);

        if left > right || top > bottom {
            continue;
        }

        let dx = x2 - x1;
        let dy = y2 - y1;
        let len_sq = dx * dx + dy * dy;

        segments.push(Segment {
            x1,
            y1,
            dx,
            dy,
            len_sq,
            bounds_left: left,
            bounds_right: right,
            bounds_top: top,
            bounds_bottom: bottom,
        });
    }

    let mut single_point = None;
    if segments.is_empty() && !points.is_empty() {
        let x1 = points[0].x as f32 * scale - crop_offset.0 - layer_offset.0;
        let y1 = points[0].y as f32 * scale - crop_offset.1 - layer_offset.1;
        let left = ((x1 - radius).floor() as i32).max(0);
        let right = ((x1 + radius).ceil() as i32).min(bb_w as i32 - 1);
        let top = ((y1 - radius).floor() as i32).max(0);
        let bottom = ((y1 + radius).ceil() as i32).min(bb_h as i32 - 1);
        if left <= right && top <= bottom {
            single_point = Some((x1, y1, left, right, top, bottom));
        }
    }

    let feather_amount = feather.clamp(0.0, 1.0);
    let inner_radius = radius * (1.0 - feather_amount);
    let feather_range = (radius - inner_radius).max(0.01);
    let radius_sq = radius * radius;
    let inner_radius_sq = inner_radius * inner_radius;

    out_pixels
        .par_chunks_mut(bb_w as usize)
        .enumerate()
        .for_each(|(y, row)| {
            let py = y as f32;
            let y_i32 = y as i32;

            let mut active_segments = Vec::new();
            for seg in &segments {
                if y_i32 >= seg.bounds_top && y_i32 <= seg.bounds_bottom {
                    active_segments.push(seg);
                }
            }

            let is_point_active = if let Some(pt) = &single_point {
                y_i32 >= pt.4 && y_i32 <= pt.5
            } else {
                false
            };

            if active_segments.is_empty() && !is_point_active {
                return;
            }

            for (x, pixel) in row.iter_mut().enumerate() {
                let px = x as f32;
                let x_i32 = x as i32;

                let mut min_dist_sq = radius_sq + 1.0;

                for seg in &active_segments {
                    if x_i32 >= seg.bounds_left && x_i32 <= seg.bounds_right {
                        let dist_sq = if seg.len_sq < 0.0001 {
                            (px - seg.x1) * (px - seg.x1) + (py - seg.y1) * (py - seg.y1)
                        } else {
                            let t = (((px - seg.x1) * seg.dx + (py - seg.y1) * seg.dy)
                                / seg.len_sq)
                                .clamp(0.0, 1.0);
                            let proj_x = seg.x1 + t * seg.dx;
                            let proj_y = seg.y1 + t * seg.dy;
                            (px - proj_x) * (px - proj_x) + (py - proj_y) * (py - proj_y)
                        };
                        if dist_sq < min_dist_sq {
                            min_dist_sq = dist_sq;
                        }
                    }
                }

                if is_point_active {
                    let pt = single_point.as_ref().unwrap();
                    if x_i32 >= pt.2 && x_i32 <= pt.3 {
                        let dist_sq = (px - pt.0) * (px - pt.0) + (py - pt.1) * (py - pt.1);
                        if dist_sq < min_dist_sq {
                            min_dist_sq = dist_sq;
                        }
                    }
                }

                if min_dist_sq <= radius_sq {
                    let intensity = if min_dist_sq <= inner_radius_sq {
                        1.0
                    } else {
                        let dist = min_dist_sq.sqrt();
                        let t = ((dist - inner_radius) / feather_range).clamp(0.0, 1.0);
                        1.0 - (t * t * (3.0 - 2.0 * t))
                    };
                    *pixel = (intensity * 255.0).round() as u8;
                }
            }
        });

    GrayImage::from_raw(bb_w, bb_h, out_pixels).unwrap()
}

fn generate_radial_bitmap(
    params_value: &Value,
    width: u32,
    height: u32,
    scale: f32,
    crop_offset: (f32, f32),
) -> GrayImage {
    let params: RadialMaskParameters =
        serde::Deserialize::deserialize(params_value).unwrap_or_default();
    let mut mask = GrayImage::new(width, height);

    let center_x = (params.center_x as f32 * scale - crop_offset.0) as i32;
    let center_y = (params.center_y as f32 * scale - crop_offset.1) as i32;
    let radius_x = params.radius_x as f32 * scale;
    let radius_y = params.radius_y as f32 * scale;
    let rotation_rad = params.rotation * PI / 180.0;
    let cos_rot = rotation_rad.cos();
    let sin_rot = rotation_rad.sin();
    let inner_bound = 1.0 - params.feather.clamp(0.0, 1.0);

    mask.par_chunks_mut(width.max(1) as usize)
        .enumerate()
        .for_each(|(y, row)| {
            for (x, pixel) in row.iter_mut().enumerate() {
                let dx = x as f32 - center_x as f32;
                let dy = y as f32 - center_y as f32;

                let rot_dx = dx * cos_rot + dy * sin_rot;
                let rot_dy = -dx * sin_rot + dy * cos_rot;

                let norm_x = rot_dx / radius_x.max(0.01);
                let norm_y = rot_dy / radius_y.max(0.01);

                let dist = (norm_x.powi(2) + norm_y.powi(2)).sqrt();

                let intensity = 1.0 - (dist - inner_bound) / (1.0 - inner_bound).max(0.01);
                *pixel = (intensity.clamp(0.0, 1.0) * 255.0) as u8;
            }
        });

    mask
}

fn generate_linear_bitmap(
    params_value: &Value,
    width: u32,
    height: u32,
    scale: f32,
    crop_offset: (f32, f32),
) -> GrayImage {
    let params: LinearMaskParameters =
        serde::Deserialize::deserialize(params_value).unwrap_or_default();
    let mut mask = GrayImage::new(width, height);

    let start_x = params.start_x as f32 * scale - crop_offset.0;
    let start_y = params.start_y as f32 * scale - crop_offset.1;
    let end_x = params.end_x as f32 * scale - crop_offset.0;
    let end_y = params.end_y as f32 * scale - crop_offset.1;
    let range = params.range * scale;

    let line_vec_x = end_x - start_x;
    let line_vec_y = end_y - start_y;

    let len_sq = line_vec_x.powi(2) + line_vec_y.powi(2);

    if len_sq < 0.01 {
        return mask;
    }

    let perp_vec_x = -line_vec_y / len_sq.sqrt();
    let perp_vec_y = line_vec_x / len_sq.sqrt();

    let half_width = range.max(0.01);

    mask.par_chunks_mut(width.max(1) as usize)
        .enumerate()
        .for_each(|(y_u, row)| {
            for (x_u, pixel) in row.iter_mut().enumerate() {
                let pixel_vec_x = x_u as f32 - start_x;
                let pixel_vec_y = y_u as f32 - start_y;

                let dist_perp = pixel_vec_x * perp_vec_x + pixel_vec_y * perp_vec_y;

                let t = dist_perp / half_width;

                let intensity = 0.5 - t * 0.5;
                *pixel = (intensity.clamp(0.0, 1.0) * 255.0) as u8;
            }
        });

    mask
}

fn generate_brush_bitmap(
    params_value: &Value,
    width: u32,
    height: u32,
    scale: f32,
    crop_offset: (f32, f32),
) -> GrayImage {
    let params: BrushMaskParameters =
        serde::Deserialize::deserialize(params_value).unwrap_or_default();
    let mut final_mask = GrayImage::new(width, height);

    for line in &params.lines {
        if line.points.is_empty() {
            continue;
        }

        let is_eraser = line.tool == "eraser";
        let radius = (line.brush_size * scale / 2.0).max(0.0);
        let feather = line.feather.clamp(0.0, 1.0);

        let Some((min_x, min_y, max_x, max_y)) =
            stroke_bounds(&line.points, width, height, radius, scale, crop_offset)
        else {
            continue;
        };

        let bb_w = max_x - min_x + 1;
        let bb_h = max_y - min_y + 1;
        let layer_offset = (min_x as f32, min_y as f32);

        let line_mask = render_stroke_layer_parallel(
            &line.points,
            radius,
            feather,
            scale,
            crop_offset,
            layer_offset,
            bb_w,
            bb_h,
        );

        for y in 0..bb_h {
            for x in 0..bb_w {
                let src_val = line_mask.get_pixel(x, y)[0] as f32 / 255.0;
                if src_val <= 0.0 {
                    continue;
                }

                let abs_x = min_x + x;
                let abs_y = min_y + y;
                let dst_pixel = final_mask.get_pixel_mut(abs_x, abs_y);
                let dst_val = dst_pixel[0] as f32 / 255.0;

                let blended = if is_eraser {
                    dst_val * (1.0 - src_val)
                } else {
                    dst_val + src_val - dst_val * src_val
                };

                dst_pixel[0] = (blended.clamp(0.0, 1.0) * 255.0).round() as u8;
            }
        }
    }

    final_mask
}

fn generate_flow_bitmap(
    params_value: &Value,
    width: u32,
    height: u32,
    scale: f32,
    crop_offset: (f32, f32),
) -> GrayImage {
    let params: FlowMaskParameters =
        serde::Deserialize::deserialize(params_value).unwrap_or_default();
    let mut final_mask = GrayImage::new(width, height);

    for line in &params.lines {
        if line.points.is_empty() {
            continue;
        }

        let is_eraser = line.tool == "eraser";
        let flow_per_stroke = (line.flow.clamp(0.0, 100.0) / 100.0) * 255.0;
        let radius = (line.brush_size * scale / 2.0).max(0.0);
        let feather = line.feather.clamp(0.0, 1.0);

        let Some((min_x, min_y, max_x, max_y)) =
            stroke_bounds(&line.points, width, height, radius, scale, crop_offset)
        else {
            continue;
        };

        let bb_w = max_x - min_x + 1;
        let bb_h = max_y - min_y + 1;
        let layer_offset = (min_x as f32, min_y as f32);

        let line_mask = render_stroke_layer_parallel(
            &line.points,
            radius,
            feather,
            scale,
            crop_offset,
            layer_offset,
            bb_w,
            bb_h,
        );

        for y in 0..bb_h {
            for x in 0..bb_w {
                let stroke_pixel = line_mask.get_pixel(x, y)[0] as f32;
                if stroke_pixel <= 0.0 {
                    continue;
                }

                let abs_x = min_x + x;
                let abs_y = min_y + y;
                let pixel = final_mask.get_pixel_mut(abs_x, abs_y);

                let c_norm = pixel[0] as f32 / 255.0;
                let delta = ((stroke_pixel / 255.0) * flow_per_stroke).round();
                let d_norm = (delta / 255.0).clamp(0.0, 1.0);

                let next = if is_eraser {
                    c_norm * (1.0 - d_norm)
                } else {
                    c_norm + d_norm - c_norm * d_norm
                };

                pixel[0] = (next.clamp(0.0, 1.0) * 255.0).round() as u8;
            }
        }
    }

    final_mask
}

pub struct TransformParams {
    pub rotation: f32,
    pub flip_horizontal: bool,
    pub flip_vertical: bool,
    pub orientation_steps: u8,
    pub width: u32,
    pub height: u32,
    pub scale: f32,
    pub crop_offset: (f32, f32),
}

fn generate_ai_bitmap_from_full_mask(
    full_mask_image: &GrayImage,
    tf: &TransformParams,
) -> GrayImage {
    transform_full_mask(full_mask_image, tf, false)
}

/// Maps a full-image map (such as a depth map) into the render frame like an AI mask, but
/// output pixels outside the source take the nearest edge value instead of 0.
pub fn generate_edge_clamped_bitmap(full_map: &GrayImage, tf: &TransformParams) -> GrayImage {
    transform_full_mask(full_map, tf, true)
}

fn transform_full_mask(
    full_mask_image: &GrayImage,
    tf: &TransformParams,
    clamp_edges: bool,
) -> GrayImage {
    let (full_mask_w, full_mask_h) = full_mask_image.dimensions();
    let mut final_mask = GrayImage::new(tf.width, tf.height);

    let angle_rad = tf.rotation.to_radians();
    let cos_a = angle_rad.cos();
    let sin_a = angle_rad.sin();

    let (coarse_rotated_w, coarse_rotated_h) = if tf.orientation_steps % 2 == 1 {
        (full_mask_h, full_mask_w)
    } else {
        (full_mask_w, full_mask_h)
    };

    let scaled_coarse_rotated_w = coarse_rotated_w as f32 * tf.scale;
    let scaled_coarse_rotated_h = coarse_rotated_h as f32 * tf.scale;
    let center_x = scaled_coarse_rotated_w / 2.0;
    let center_y = scaled_coarse_rotated_h / 2.0;

    for y_out in 0..tf.height {
        for x_out in 0..tf.width {
            let x_uncrop = x_out as f32 + tf.crop_offset.0;
            let y_uncrop = y_out as f32 + tf.crop_offset.1;

            let x_centered = x_uncrop - center_x;
            let y_centered = y_uncrop - center_y;

            let x_unrotated = x_centered * cos_a + y_centered * sin_a + center_x;
            let y_unrotated = -x_centered * sin_a + y_centered * cos_a + center_y;

            let x_unflipped = if tf.flip_horizontal {
                scaled_coarse_rotated_w - x_unrotated
            } else {
                x_unrotated
            };
            let y_unflipped = if tf.flip_vertical {
                scaled_coarse_rotated_h - y_unrotated
            } else {
                y_unrotated
            };

            let (x_unrotated_coarse, y_unrotated_coarse) = match tf.orientation_steps {
                0 => (x_unflipped, y_unflipped),
                1 => (y_unflipped, scaled_coarse_rotated_w - x_unflipped),
                2 => (
                    scaled_coarse_rotated_w - x_unflipped,
                    scaled_coarse_rotated_h - y_unflipped,
                ),
                3 => (scaled_coarse_rotated_h - y_unflipped, x_unflipped),
                _ => (x_unflipped, y_unflipped),
            };

            let x_src = x_unrotated_coarse / tf.scale;
            let y_src = y_unrotated_coarse / tf.scale;

            if clamp_edges
                || (x_src >= 0.0
                    && x_src < full_mask_w as f32
                    && y_src >= 0.0
                    && y_src < full_mask_h as f32)
            {
                let x = (x_src.max(0.0) as u32).min(full_mask_w - 1);
                let y = (y_src.max(0.0) as u32).min(full_mask_h - 1);
                final_mask.put_pixel(x_out, y_out, *full_mask_image.get_pixel(x, y));
            }
        }
    }

    final_mask
}

pub fn generate_ai_bitmap_from_base64(data_url: &str, tf: &TransformParams) -> Option<GrayImage> {
    let b64_data = if let Some(idx) = data_url.find(',') {
        &data_url[idx + 1..]
    } else {
        data_url
    };

    let decoded_bytes = general_purpose::STANDARD.decode(b64_data).ok()?;
    let full_mask_image = image::load_from_memory(&decoded_bytes).ok()?.to_luma8();

    Some(generate_ai_bitmap_from_full_mask(&full_mask_image, tf))
}

fn generate_ai_sky_bitmap(
    params_value: &Value,
    width: u32,
    height: u32,
    scale: f32,
    crop_offset: (f32, f32),
) -> Option<GrayImage> {
    let params: AiSkyMaskParameters = serde::Deserialize::deserialize(params_value).ok()?;
    let grow_feather: GrowFeatherParameters =
        serde::Deserialize::deserialize(params_value).unwrap_or_default();
    let data_url = params.mask_data_base64?;

    let tf = TransformParams {
        rotation: params.rotation.unwrap_or(0.0),
        flip_horizontal: params.flip_horizontal.unwrap_or(false),
        flip_vertical: params.flip_vertical.unwrap_or(false),
        orientation_steps: params.orientation_steps.unwrap_or(0),
        width,
        height,
        scale,
        crop_offset,
    };
    let mut mask = generate_ai_bitmap_from_base64(&data_url, &tf)?;

    apply_grow_and_feather(
        &mut mask,
        grow_feather.grow,
        grow_feather.feather,
        width,
        height,
    );

    Some(mask)
}

/// Strength of a range mask at `value`: full between `min` and `max`, easing to zero over
/// `min_fade` below and `max_fade` above. All in percent, as the range bar shows them.
fn range_band_weight(min: f32, max: f32, min_fade: f32, max_fade: f32, value: f32) -> f32 {
    fn smoothstep(edge0: f32, edge1: f32, x: f32) -> f32 {
        let t = ((x - edge0) / (edge1 - edge0).max(0.0001)).clamp(0.0, 1.0);
        t * t * (3.0 - 2.0 * t)
    }

    smoothstep(min - min_fade, min, value) * (1.0 - smoothstep(max, max + max_fade, value))
}

/// Mask strength at a nearness in percent (100 nearest): the depth range with its fades, scaled
/// by the nearness itself unless the mask has `full_strength` (masks made before `1.41.5`).
fn ai_depth_mask_weight(params: &AiDepthMaskParameters, nearness: f32) -> f32 {
    let band = range_band_weight(
        params.min_depth,
        params.max_depth,
        params.min_fade,
        params.max_fade,
        nearness,
    );
    if params.full_strength {
        band
    } else {
        band * (nearness / 100.0)
    }
}

fn generate_ai_depth_bitmap(
    params_value: &Value,
    width: u32,
    height: u32,
    scale: f32,
    crop_offset: (f32, f32),
) -> Option<GrayImage> {
    let params: AiDepthMaskParameters = serde::Deserialize::deserialize(params_value).ok()?;
    let grow_feather: GrowFeatherParameters =
        serde::Deserialize::deserialize(params_value).unwrap_or_default();
    let data_url = params.mask_data_base64.as_deref()?;

    let tf = TransformParams {
        rotation: params.rotation.unwrap_or(0.0),
        flip_horizontal: params.flip_horizontal.unwrap_or(false),
        flip_vertical: params.flip_vertical.unwrap_or(false),
        orientation_steps: params.orientation_steps.unwrap_or(0),
        width,
        height,
        scale,
        crop_offset,
    };

    let depth_map = generate_ai_bitmap_from_base64(data_url, &tf)?;

    let (w, h) = depth_map.dimensions();
    let mut mask = GrayImage::new(w, h);

    for (x, y, p) in depth_map.enumerate_pixels() {
        let weight = ai_depth_mask_weight(&params, (p[0] as f32 / 255.0) * 100.0);
        mask.put_pixel(x, y, Luma([(weight * 255.0) as u8]));
    }

    if params.feather > 0.0 {
        mask = image::imageops::blur(&mask, params.feather * 0.1);
    }

    apply_grow_and_feather(
        &mut mask,
        grow_feather.grow,
        grow_feather.feather,
        width,
        height,
    );

    Some(mask)
}

fn generate_ai_foreground_bitmap(
    params_value: &Value,
    width: u32,
    height: u32,
    scale: f32,
    crop_offset: (f32, f32),
) -> Option<GrayImage> {
    let params: AiForegroundMaskParameters = serde::Deserialize::deserialize(params_value).ok()?;
    let grow_feather: GrowFeatherParameters =
        serde::Deserialize::deserialize(params_value).unwrap_or_default();
    let data_url = params.mask_data_base64?;

    let tf = TransformParams {
        rotation: params.rotation.unwrap_or(0.0),
        flip_horizontal: params.flip_horizontal.unwrap_or(false),
        flip_vertical: params.flip_vertical.unwrap_or(false),
        orientation_steps: params.orientation_steps.unwrap_or(0),
        width,
        height,
        scale,
        crop_offset,
    };
    let mut mask = generate_ai_bitmap_from_base64(&data_url, &tf)?;

    apply_grow_and_feather(
        &mut mask,
        grow_feather.grow,
        grow_feather.feather,
        width,
        height,
    );

    Some(mask)
}

fn generate_ai_subject_bitmap(
    params_value: &Value,
    width: u32,
    height: u32,
    scale: f32,
    crop_offset: (f32, f32),
) -> Option<GrayImage> {
    let params: AiSubjectMaskParameters = serde::Deserialize::deserialize(params_value).ok()?;
    let grow_feather: GrowFeatherParameters =
        serde::Deserialize::deserialize(params_value).unwrap_or_default();
    let data_url = params.mask_data_base64?;

    let tf = TransformParams {
        rotation: params.rotation.unwrap_or(0.0),
        flip_horizontal: params.flip_horizontal.unwrap_or(false),
        flip_vertical: params.flip_vertical.unwrap_or(false),
        orientation_steps: params.orientation_steps.unwrap_or(0),
        width,
        height,
        scale,
        crop_offset,
    };
    let mut mask = generate_ai_bitmap_from_base64(&data_url, &tf)?;

    apply_grow_and_feather(
        &mut mask,
        grow_feather.grow,
        grow_feather.feather,
        width,
        height,
    );

    Some(mask)
}

fn generate_color_bitmap(
    params_value: &Value,
    width: u32,
    height: u32,
    scale: f32,
    crop_offset: (f32, f32),
    warped_image: Option<&image::DynamicImage>,
) -> Option<GrayImage> {
    let params: ParametricMaskParameters = serde::Deserialize::deserialize(params_value).ok()?;
    let warped = warped_image?;
    let (full_w, full_h) = warped.dimensions();

    let ref_pixel = source_pixel_at(warped, params.target_x, params.target_y)?;
    let ref_r = ref_pixel[0] as f32;
    let ref_g = ref_pixel[1] as f32;
    let ref_b = ref_pixel[2] as f32;

    let mut mask = GrayImage::new(width, height);

    let angle_rad = params.rotation * PI / 180.0;
    let cos_a = angle_rad.cos();
    let sin_a = angle_rad.sin();

    let (coarse_rotated_w, coarse_rotated_h) = if params.orientation_steps % 2 == 1 {
        (full_h, full_w)
    } else {
        (full_w, full_h)
    };

    let scaled_coarse_rotated_w = coarse_rotated_w as f32 * scale;
    let scaled_coarse_rotated_h = coarse_rotated_h as f32 * scale;
    let center_x = scaled_coarse_rotated_w / 2.0;
    let center_y = scaled_coarse_rotated_h / 2.0;

    let tolerance_sq = (params.tolerance * 2.55).max(1.0).powi(2) * 3.0;
    let inv_scale = 1.0 / scale;

    for y_out in 0..height {
        let y_uncrop = y_out as f32 + crop_offset.1;
        let y_centered = y_uncrop - center_y;
        let y_sin = y_centered * sin_a;
        let y_cos = y_centered * cos_a;

        for x_out in 0..width {
            let x_uncrop = x_out as f32 + crop_offset.0;
            let x_centered = x_uncrop - center_x;

            let x_unrotated = x_centered * cos_a + y_sin + center_x;
            let y_unrotated = -x_centered * sin_a + y_cos + center_y;

            let x_unflipped = if params.flip_horizontal {
                scaled_coarse_rotated_w - x_unrotated
            } else {
                x_unrotated
            };
            let y_unflipped = if params.flip_vertical {
                scaled_coarse_rotated_h - y_unrotated
            } else {
                y_unrotated
            };

            let (x_unrotated_coarse, y_unrotated_coarse) = match params.orientation_steps {
                0 => (x_unflipped, y_unflipped),
                1 => (y_unflipped, scaled_coarse_rotated_w - x_unflipped),
                2 => (
                    scaled_coarse_rotated_w - x_unflipped,
                    scaled_coarse_rotated_h - y_unflipped,
                ),
                3 => (scaled_coarse_rotated_h - y_unflipped, x_unflipped),
                _ => (x_unflipped, y_unflipped),
            };

            if x_unrotated_coarse >= 0.0 && y_unrotated_coarse >= 0.0 {
                let x_src = (x_unrotated_coarse * inv_scale) as u32;
                let y_src = (y_unrotated_coarse * inv_scale) as u32;

                if x_src < full_w && y_src < full_h {
                    let pixel = warped.get_pixel(x_src, y_src);
                    let dist_sq = (pixel[0] as f32 - ref_r).powi(2)
                        + (pixel[1] as f32 - ref_g).powi(2)
                        + (pixel[2] as f32 - ref_b).powi(2);

                    if dist_sq <= tolerance_sq {
                        let intensity = 1.0 - (dist_sq.sqrt() / tolerance_sq.sqrt());
                        mask.put_pixel(x_out, y_out, Luma([(intensity * 255.0) as u8]));
                    }
                }
            }
        }
    }

    apply_grow_and_feather(&mut mask, params.grow, params.feather, width, height);
    Some(mask)
}

fn generate_luminance_bitmap(
    params_value: &Value,
    width: u32,
    height: u32,
    scale: f32,
    crop_offset: (f32, f32),
    warped_image: Option<&image::DynamicImage>,
) -> Option<GrayImage> {
    let params: ParametricMaskParameters = serde::Deserialize::deserialize(params_value).ok()?;
    let warped = warped_image?;
    let (full_w, full_h) = warped.dimensions();

    let range: Option<LuminanceRangeParameters> =
        serde::Deserialize::deserialize(params_value).ok();
    let luma_weight: Box<dyn Fn(f32) -> f32> = match range {
        Some(r) => Box::new(move |luma| {
            range_band_weight(
                r.min_luminance,
                r.max_luminance,
                r.min_fade,
                r.max_fade,
                luma / 2.55,
            )
        }),
        None => {
            let ref_luma = pixel_luma(source_pixel_at(warped, params.target_x, params.target_y)?);
            let tolerance_val = (params.tolerance * 2.55).max(1.0);
            Box::new(move |luma| {
                let dist = (luma - ref_luma).abs();
                if dist <= tolerance_val {
                    1.0 - (dist / tolerance_val)
                } else {
                    0.0
                }
            })
        }
    };

    let mut mask = GrayImage::new(width, height);

    let angle_rad = params.rotation * PI / 180.0;
    let cos_a = angle_rad.cos();
    let sin_a = angle_rad.sin();

    let (coarse_rotated_w, coarse_rotated_h) = if params.orientation_steps % 2 == 1 {
        (full_h, full_w)
    } else {
        (full_w, full_h)
    };

    let scaled_coarse_rotated_w = coarse_rotated_w as f32 * scale;
    let scaled_coarse_rotated_h = coarse_rotated_h as f32 * scale;
    let center_x = scaled_coarse_rotated_w / 2.0;
    let center_y = scaled_coarse_rotated_h / 2.0;

    let inv_scale = 1.0 / scale;

    for y_out in 0..height {
        let y_uncrop = y_out as f32 + crop_offset.1;
        let y_centered = y_uncrop - center_y;
        let y_sin = y_centered * sin_a;
        let y_cos = y_centered * cos_a;

        for x_out in 0..width {
            let x_uncrop = x_out as f32 + crop_offset.0;
            let x_centered = x_uncrop - center_x;

            let x_unrotated = x_centered * cos_a + y_sin + center_x;
            let y_unrotated = -x_centered * sin_a + y_cos + center_y;

            let x_unflipped = if params.flip_horizontal {
                scaled_coarse_rotated_w - x_unrotated
            } else {
                x_unrotated
            };
            let y_unflipped = if params.flip_vertical {
                scaled_coarse_rotated_h - y_unrotated
            } else {
                y_unrotated
            };

            let (x_unrotated_coarse, y_unrotated_coarse) = match params.orientation_steps {
                0 => (x_unflipped, y_unflipped),
                1 => (y_unflipped, scaled_coarse_rotated_w - x_unflipped),
                2 => (
                    scaled_coarse_rotated_w - x_unflipped,
                    scaled_coarse_rotated_h - y_unflipped,
                ),
                3 => (scaled_coarse_rotated_h - y_unflipped, x_unflipped),
                _ => (x_unflipped, y_unflipped),
            };

            if x_unrotated_coarse >= 0.0 && y_unrotated_coarse >= 0.0 {
                let x_src = (x_unrotated_coarse * inv_scale) as u32;
                let y_src = (y_unrotated_coarse * inv_scale) as u32;

                if x_src < full_w && y_src < full_h {
                    let intensity = luma_weight(pixel_luma(warped.get_pixel(x_src, y_src)));
                    if intensity > 0.0 {
                        mask.put_pixel(x_out, y_out, Luma([(intensity * 255.0) as u8]));
                    }
                }
            }
        }
    }

    apply_grow_and_feather(&mut mask, params.grow, params.feather, width, height);
    Some(mask)
}

fn generate_all_bitmap(width: u32, height: u32) -> GrayImage {
    GrayImage::from_pixel(width, height, Luma([255]))
}

fn generate_sub_mask_bitmap(
    sub_mask: &SubMask,
    width: u32,
    height: u32,
    scale: f32,
    crop_offset: (f32, f32),
    warped_image: Option<&DynamicImage>,
) -> Option<GrayImage> {
    if !sub_mask.visible {
        return None;
    }

    match sub_mask.mask_type.as_str() {
        "radial" => Some(generate_radial_bitmap(
            &sub_mask.parameters,
            width,
            height,
            scale,
            crop_offset,
        )),
        "linear" => Some(generate_linear_bitmap(
            &sub_mask.parameters,
            width,
            height,
            scale,
            crop_offset,
        )),
        "brush" | "clone" | "heal" => Some(generate_brush_bitmap(
            &sub_mask.parameters,
            width,
            height,
            scale,
            crop_offset,
        )),
        "flow" => Some(generate_flow_bitmap(
            &sub_mask.parameters,
            width,
            height,
            scale,
            crop_offset,
        )),
        "color" => generate_color_bitmap(
            &sub_mask.parameters,
            width,
            height,
            scale,
            crop_offset,
            warped_image,
        ),
        "luminance" => generate_luminance_bitmap(
            &sub_mask.parameters,
            width,
            height,
            scale,
            crop_offset,
            warped_image,
        ),
        "ai-subject" => {
            generate_ai_subject_bitmap(&sub_mask.parameters, width, height, scale, crop_offset)
        }
        "ai-foreground" => {
            generate_ai_foreground_bitmap(&sub_mask.parameters, width, height, scale, crop_offset)
        }
        "ai-sky" | "ai-text" => {
            generate_ai_sky_bitmap(&sub_mask.parameters, width, height, scale, crop_offset)
        }
        "ai-depth" => {
            generate_ai_depth_bitmap(&sub_mask.parameters, width, height, scale, crop_offset)
        }
        "quick-eraser" => {
            generate_ai_subject_bitmap(&sub_mask.parameters, width, height, scale, crop_offset)
        }
        "all" => Some(generate_all_bitmap(width, height)),
        _ => None,
    }
}

pub fn generate_mask_bitmap(
    mask_def: &MaskDefinition,
    width: u32,
    height: u32,
    scale: f32,
    crop_offset: (f32, f32),
    warped_image: Option<&DynamicImage>,
) -> Option<GrayImage> {
    combine_mask_bitmap(mask_def, width, height, |sub_mask| {
        generate_sub_mask_bitmap(sub_mask, width, height, scale, crop_offset, warped_image)
            .map(Arc::new)
    })
}

/// A component's or mask's invert, then opacity, applied to one value.
fn shade(value: u8, invert: bool, opacity: f32) -> u8 {
    let value = if invert { 255 - value } else { value };
    let multiplier = (opacity / 100.0).clamp(0.0, 1.0);
    if multiplier < 1.0 {
        (value as f32 * multiplier) as u8
    } else {
        value
    }
}

/// Combines a mask's components, drawn by `component` (`None` for a component without a
/// bitmap: hidden, or an AI mask not generated yet). A visible mask none of whose components
/// has a bitmap is empty, inverted or not (Plan item 90: an inverted mask whose AI parts were
/// not made yet covered the whole photo); `None` only for a hidden mask.
fn combine_mask_bitmap(
    mask_def: &MaskDefinition,
    width: u32,
    height: u32,
    mut component: impl FnMut(&SubMask) -> Option<Arc<GrayImage>>,
) -> Option<GrayImage> {
    if !mask_def.visible {
        return None;
    }

    // The first component that produces a bitmap is the base, whatever its mode (as in
    // Lightroom Classic); the later ones combine with it by their mode.
    let mut base: Option<GrayImage> = None;

    for sub_mask in &mask_def.sub_masks {
        let Some(sub_bitmap) = component(sub_mask) else {
            continue;
        };
        let (invert, opacity) = (sub_mask.invert, sub_mask.opacity);

        let Some(final_mask) = base.as_mut() else {
            let mut layer = GrayImage::new(width, height);
            layer
                .par_iter_mut()
                .zip(sub_bitmap.par_iter())
                .for_each(|(dst, &src)| *dst = shade(src, invert, opacity));
            base = Some(layer);
            continue;
        };

        let combine: fn(u8, u8) -> u8 = match sub_mask.mode {
            SubMaskMode::Additive => u8::max,
            SubMaskMode::Subtractive => u8::saturating_sub,
            SubMaskMode::Intersect => u8::min,
        };
        final_mask
            .par_iter_mut()
            .zip(sub_bitmap.par_iter())
            .for_each(|(dst, &src)| *dst = combine(*dst, shade(src, invert, opacity)));
    }

    // An empty mask rather than none: renders pair the bitmaps with the visible masks by position.
    let Some(mut final_mask) = base else {
        return Some(GrayImage::new(width, height));
    };
    let (invert, opacity) = (mask_def.invert, mask_def.opacity);
    if invert || opacity < 100.0 {
        final_mask
            .par_iter_mut()
            .for_each(|value| *value = shade(*value, invert, opacity));
    }

    Some(final_mask)
}

#[tauri::command]
pub async fn generate_mask_overlay(
    mask_def: serde_json::Value,
    width: u32,
    height: u32,
    scale: f32,
    crop_offset: (f32, f32),
    js_adjustments: Option<serde_json::Value>,
    app_handle: tauri::AppHandle,
) -> Result<String, String> {
    crate::blocking_command::run_blocking(move || {
        generate_mask_overlay_blocking(
            mask_def,
            width,
            height,
            scale,
            crop_offset,
            js_adjustments,
            app_handle.state::<AppState>(),
        )
    })
    .await
}

/// The tone a Luminance mask reads at a picked point (`x`, `y` as in its `targetX`/`targetY`),
/// in percent, or `None` outside the photo.
#[tauri::command]
pub async fn sample_mask_luminance(
    mut js_adjustments: serde_json::Value,
    x: f64,
    y: f64,
    app_handle: tauri::AppHandle,
) -> Result<Option<f32>, String> {
    crate::blocking_command::run_blocking(move || {
        let state = app_handle.state::<AppState>();
        crate::adjustment_utils::hydrate_adjustments(&state, &mut js_adjustments);
        let warped = get_cached_full_warped_image(&state, &js_adjustments)?;
        Ok(source_pixel_at(&warped, x, y).map(|pixel| pixel_luma(pixel) / 2.55))
    })
    .await
}

fn generate_mask_overlay_blocking(
    mut mask_def: serde_json::Value,
    width: u32,
    height: u32,
    scale: f32,
    crop_offset: (f32, f32),
    mut js_adjustments: Option<serde_json::Value>,
    state: tauri::State<'_, AppState>,
) -> Result<String, String> {
    if let Some(ref mut adj) = js_adjustments {
        crate::adjustment_utils::hydrate_adjustments(&state, adj);
    }

    if let Some(sub_masks) = mask_def.get_mut("subMasks").and_then(|v| v.as_array_mut()) {
        let mut cache = state.patch_cache.lock().unwrap();
        crate::adjustment_utils::hydrate_sub_masks(sub_masks, &mut cache);
    }

    let parsed_mask_def: MaskDefinition = serde_json::from_value(mask_def)
        .map_err(|e| format!("Failed to parse hydrated mask_def: {}", e))?;

    let scaled_crop_offset = (crop_offset.0 * scale, crop_offset.1 * scale);

    let gray_mask = match &js_adjustments {
        Some(adjustments) => get_cached_or_generate_mask(
            &state,
            &parsed_mask_def,
            width,
            height,
            scale,
            scaled_crop_offset,
            adjustments,
        ),
        None => generate_mask_bitmap(
            &parsed_mask_def,
            width,
            height,
            scale,
            scaled_crop_offset,
            None,
        ),
    };

    if let Some(gray_mask) = gray_mask {
        mask_overlay_data_url(&gray_mask)
    } else {
        Ok("".to_string())
    }
}

/// A mask's strength as the Develop overlay shows it: red, half opaque at full strength, as a
/// PNG data URL. Also Zone Color Grading's mask preview (`generate_zone_tint_overlay`).
pub fn mask_overlay_data_url(gray_mask: &GrayImage) -> Result<String, String> {
    let (width, height) = gray_mask.dimensions();
    let mut rgba_mask = RgbaImage::new(width, height);
    for (x, y, pixel) in gray_mask.enumerate_pixels() {
        let intensity = pixel[0];
        let alpha = (intensity as f32 * 0.5) as u8;
        rgba_mask.put_pixel(x, y, Rgba([255, 0, 0, alpha]));
    }

    let mut buf = Cursor::new(Vec::new());
    rgba_mask
        .write_to(&mut buf, ImageFormat::Png)
        .map_err(|e| e.to_string())?;

    let base64_str = general_purpose::STANDARD.encode(buf.get_ref());
    Ok(format!("data:image/png;base64,{}", base64_str))
}

pub fn resolve_warped_image_for_masks(
    state: &tauri::State<AppState>,
    adjustments: &serde_json::Value,
    masks: &[MaskDefinition],
) -> Option<Arc<DynamicImage>> {
    if masks.iter().any(|m| m.requires_warped_image()) {
        get_cached_full_warped_image(state, adjustments).ok()
    } else {
        None
    }
}

/// Mask bitmaps kept up to a byte budget; past it, the least recently used go first.
pub struct BitmapCache {
    entries: HashMap<u64, (Arc<GrayImage>, u64)>,
    bytes: usize,
    budget: usize,
    clock: u64,
}

impl BitmapCache {
    fn new(budget: usize) -> Self {
        Self {
            entries: HashMap::new(),
            bytes: 0,
            budget,
            clock: 0,
        }
    }

    fn get(&mut self, key: u64) -> Option<Arc<GrayImage>> {
        self.clock += 1;
        let (bitmap, used) = self.entries.get_mut(&key)?;
        *used = self.clock;
        Some(Arc::clone(bitmap))
    }

    fn insert(&mut self, key: u64, bitmap: Arc<GrayImage>) {
        let size = bitmap.len();
        if size > self.budget {
            return;
        }
        self.clock += 1;
        if let Some((old, _)) = self.entries.insert(key, (bitmap, self.clock)) {
            self.bytes -= old.len();
        }
        self.bytes += size;
        while self.bytes > self.budget {
            let Some(oldest) = self
                .entries
                .iter()
                .min_by_key(|(_, (_, used))| *used)
                .map(|(key, _)| *key)
            else {
                break;
            };
            if let Some((old, _)) = self.entries.remove(&oldest) {
                self.bytes -= old.len();
            }
        }
    }
}

/// Byte budget of each mask cache: about 58 masks or components at a 2560 × 1707 preview,
/// or five at 45 MP for an export. The old cache held 50 masks of any size.
const MASK_CACHE_BUDGET: usize = 256 << 20;

/// The editor's mask bitmaps: whole masks, and each component on its own, so that editing
/// one component leaves the others as drawn.
pub struct MaskCaches {
    masks: BitmapCache,
    components: BitmapCache,
}

impl Default for MaskCaches {
    fn default() -> Self {
        Self {
            masks: BitmapCache::new(MASK_CACHE_BUDGET),
            components: BitmapCache::new(MASK_CACHE_BUDGET),
        }
    }
}

impl MaskCaches {
    pub fn clear(&mut self) {
        *self = Self::default();
    }
}

fn hash_placement(
    hasher: &mut DefaultHasher,
    width: u32,
    height: u32,
    scale: f32,
    crop_offset: (f32, f32),
) {
    width.hash(hasher);
    height.hash(hasher);
    scale.to_bits().hash(hasher);
    crop_offset.0.to_bits().hash(hasher);
    crop_offset.1.to_bits().hash(hasher);
}

/// Identifies a mask bitmap rendered at a given size and placement. `geometry` is the
/// photo's geometry hash when a component reads the warped photo (Color, Luminance).
fn mask_cache_key(
    def: &MaskDefinition,
    width: u32,
    height: u32,
    scale: f32,
    crop_offset: (f32, f32),
    geometry: Option<u64>,
) -> u64 {
    let mut hasher = DefaultHasher::new();

    // Everything but the mask's adjustments, which do not shape its bitmap. Destructured,
    // so a new field cannot be left out of the key unnoticed.
    let MaskDefinition {
        id,
        name,
        visible,
        invert,
        opacity,
        blend_mode,
        adjustments: _,
        sub_masks,
    } = def;
    crate::cache_utils::hash_json(
        &(id, name, visible, invert, opacity, blend_mode, sub_masks),
        &mut hasher,
    );
    hash_placement(&mut hasher, width, height, scale, crop_offset);
    geometry.hash(&mut hasher);

    hasher.finish()
}

/// Identifies a component's bitmap as drawn, before its invert, opacity and mode are
/// applied, so toggling or changing those reuses it.
fn sub_mask_cache_key(
    sub_mask: &SubMask,
    width: u32,
    height: u32,
    scale: f32,
    crop_offset: (f32, f32),
    geometry: Option<u64>,
) -> u64 {
    let mut hasher = DefaultHasher::new();

    // Destructured, so a new field cannot be left out of the key unnoticed.
    let SubMask {
        id: _,
        mask_type,
        visible: _,
        invert: _,
        opacity: _,
        mode: _,
        parameters,
    } = sub_mask;
    crate::cache_utils::hash_json(&(mask_type, parameters), &mut hasher);
    hash_placement(&mut hasher, width, height, scale, crop_offset);
    geometry.hash(&mut hasher);

    hasher.finish()
}

fn reads_warped_image(sub_mask: &SubMask) -> bool {
    sub_mask.mask_type == "color" || sub_mask.mask_type == "luminance"
}

/// `generate_mask_bitmap` through the editor's caches: a cached mask is returned as is, and a
/// changed mask redraws only its changed components.
pub fn get_cached_or_generate_mask(
    state: &tauri::State<AppState>,
    def: &MaskDefinition,
    width: u32,
    height: u32,
    scale: f32,
    crop_offset: (f32, f32),
    adjustments: &serde_json::Value,
) -> Option<GrayImage> {
    let geometry = def
        .requires_warped_image()
        .then(|| crate::cache_utils::calculate_geometry_hash(adjustments));
    let key = mask_cache_key(def, width, height, scale, crop_offset, geometry);
    if let Some(bitmap) = state.mask_cache.lock().unwrap().masks.get(key) {
        return Some(Arc::unwrap_or_clone(bitmap));
    }

    let mut warped_image: Option<Option<Arc<DynamicImage>>> = None;
    let generated = combine_mask_bitmap(def, width, height, |sub_mask| {
        if !sub_mask.visible {
            return None;
        }
        let component_geometry = geometry.filter(|_| reads_warped_image(sub_mask));
        let component_key = sub_mask_cache_key(
            sub_mask,
            width,
            height,
            scale,
            crop_offset,
            component_geometry,
        );
        if let Some(bitmap) = state
            .mask_cache
            .lock()
            .unwrap()
            .components
            .get(component_key)
        {
            return Some(bitmap);
        }

        let warped = warped_image
            .get_or_insert_with(|| {
                resolve_warped_image_for_masks(state, adjustments, std::slice::from_ref(def))
            })
            .as_deref();
        let bitmap = Arc::new(generate_sub_mask_bitmap(
            sub_mask,
            width,
            height,
            scale,
            crop_offset,
            warped,
        )?);
        state
            .mask_cache
            .lock()
            .unwrap()
            .components
            .insert(component_key, Arc::clone(&bitmap));
        Some(bitmap)
    });

    if let Some(bitmap) = &generated {
        state
            .mask_cache
            .lock()
            .unwrap()
            .masks
            .insert(key, Arc::new(bitmap.clone()));
    }

    generated
}

#[cfg(test)]
mod tests {
    use super::{
        BitmapCache, LinearMaskParameters, MaskDefinition, RadialMaskParameters, SubMask,
        SubMaskMode, ai_depth_mask_weight, gaussian_blur_mask, generate_linear_bitmap,
        generate_luminance_bitmap, generate_mask_bitmap, generate_radial_bitmap,
        grayscale_square_filter, mask_cache_key, sub_mask_cache_key,
    };
    use crate::ai_processing::AiDepthMaskParameters;
    use image::{DynamicImage, GrayImage, Luma, RgbImage};
    use serde_json::{Value, json};
    use std::f32::consts::PI;
    use std::sync::Arc;

    /// Masks that stress a feather or grow: hard edges, a thin line, a lone dot, content at
    /// the borders, noise, and images narrower than the kernel.
    fn test_masks() -> Vec<GrayImage> {
        let mut seed = 0x2545_f491_u32;
        let mut noise = move || {
            seed = seed.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
            (seed >> 24) as u8
        };
        vec![
            GrayImage::from_fn(97, 61, |x, _| image::Luma([if x < 40 { 255 } else { 0 }])),
            GrayImage::from_fn(97, 61, |x, y| image::Luma([if x == y { 255 } else { 0 }])),
            GrayImage::from_fn(64, 64, |x, y| {
                image::Luma([if (x, y) == (31, 32) { 255 } else { 0 }])
            }),
            GrayImage::from_fn(50, 40, |x, y| {
                image::Luma([if x == 0 || y == 39 { 255 } else { 17 }])
            }),
            GrayImage::from_fn(83, 57, |_, _| image::Luma([noise()])),
            GrayImage::from_fn(3, 2, |x, y| image::Luma([(x * 90 + y * 40) as u8])),
            GrayImage::from_pixel(1, 1, image::Luma([200])),
        ]
    }

    #[test]
    fn mask_feather_matches_imageproc_bit_for_bit() {
        for (n, mask) in test_masks().iter().enumerate() {
            for sigma in [0.02, 0.4, 1.0, 2.5, 7.9, 40.0] {
                let expected = imageproc::filter::gaussian_blur_f32(mask, sigma);
                assert_eq!(
                    gaussian_blur_mask(mask, sigma).into_raw(),
                    expected.into_raw(),
                    "mask {n}, sigma {sigma}"
                );
            }
        }
    }

    #[test]
    fn mask_grow_and_shrink_take_the_square_window_around_each_pixel() {
        for (n, mask) in test_masks().iter().enumerate() {
            let (w, h) = mask.dimensions();
            for k in [1u8, 2, 5, 70] {
                for (pick, name) in [(u8::max as fn(u8, u8) -> u8, "grow"), (u8::min, "shrink")] {
                    let filtered = grayscale_square_filter(mask, k, pick);
                    for (x, y, value) in filtered.enumerate_pixels() {
                        let r = u32::from(k);
                        let expected = (y.saturating_sub(r)..=(y + r).min(h - 1))
                            .flat_map(|yi| {
                                (x.saturating_sub(r)..=(x + r).min(w - 1))
                                    .map(move |xi| mask.get_pixel(xi, yi)[0])
                            })
                            .reduce(pick)
                            .unwrap();
                        assert_eq!(value[0], expected, "mask {n}, {name} {k}, ({x}, {y})");
                    }
                }
            }
        }
    }

    /// A one-row grey ramp: pixel `x` has the tone `x` (0–255).
    fn grey_ramp() -> DynamicImage {
        DynamicImage::ImageRgb8(RgbImage::from_fn(256, 1, |x, _| {
            image::Rgb([x as u8, x as u8, x as u8])
        }))
    }

    fn luminance_row(params: serde_json::Value) -> Vec<u8> {
        generate_luminance_bitmap(&params, 256, 1, 1.0, (0.0, 0.0), Some(&grey_ramp()))
            .unwrap()
            .into_raw()
    }

    #[test]
    fn luminance_masks_without_a_range_keep_the_tolerance_selection() {
        let row = luminance_row(json!({ "targetX": 128.0, "targetY": 0.0, "tolerance": 20.0 }));
        // The selection before `1.42.0`: linear falloff over the tolerance around the pick.
        let tolerance = 20.0f32 * 2.55;
        let luma = |v: f32| 0.299 * v + 0.587 * v + 0.114 * v;
        for (x, &value) in row.iter().enumerate() {
            let dist = (luma(x as f32) - luma(128.0)).abs();
            let expected = if dist <= tolerance {
                ((1.0 - dist / tolerance) * 255.0) as u8
            } else {
                0
            };
            assert_eq!(value, expected, "tone {x}");
        }
    }

    #[test]
    fn luminance_ranges_select_tones_with_fades() {
        let row = luminance_row(json!({
            "targetX": -10000.0, "targetY": -10000.0,
            "minLuminance": 40.0, "maxLuminance": 60.0, "minFade": 10.0, "maxFade": 0.0,
        }));
        let at = |percent: f32| row[(percent * 2.55).round() as usize];
        assert_eq!(at(50.0), 255);
        assert_eq!(at(40.0), 255);
        assert_eq!(at(59.0), 255);
        assert_eq!(at(25.0), 0);
        assert_eq!(at(65.0), 0);
        assert!(at(35.0) > 0 && at(35.0) < 255);
    }

    #[test]
    fn full_strength_depth_masks_cover_far_ranges_fully() {
        let far: AiDepthMaskParameters = serde_json::from_value(json!({
            "minDepth": 2.0, "maxDepth": 18.0, "minFade": 2.0, "maxFade": 12.0,
        }))
        .unwrap();
        // Masks without the flag (before `1.41.5`) keep upstream's nearness scaling.
        assert!((ai_depth_mask_weight(&far, 10.0) - 0.1).abs() < 1e-6);

        let far = AiDepthMaskParameters {
            full_strength: true,
            ..far
        };
        assert_eq!(ai_depth_mask_weight(&far, 10.0), 1.0);
        assert_eq!(ai_depth_mask_weight(&far, 2.0), 1.0);
        assert_eq!(ai_depth_mask_weight(&far, 40.0), 0.0);
        let fading = ai_depth_mask_weight(&far, 24.0);
        assert!(fading > 0.0 && fading < 1.0);
    }

    fn mask(adjustments: serde_json::Value, brush_data: &str) -> MaskDefinition {
        serde_json::from_value(json!({
            "id": "m1",
            "name": "Mask",
            "visible": true,
            "invert": false,
            "adjustments": adjustments,
            "subMasks": [{
                "id": "s1",
                "type": "brush",
                "visible": true,
                "mode": "additive",
                "parameters": { "maskDataBase64": brush_data },
            }],
        }))
        .unwrap()
    }

    #[test]
    fn sub_mask_modes_that_are_not_a_mode_read_as_additive() {
        let masks: Vec<MaskDefinition> = serde_json::from_value(json!([{
            "id": "m1",
            "name": "Mask",
            "visible": true,
            "invert": false,
            "adjustments": {},
            "subMasks": [
                { "id": "s1", "type": "radial", "visible": true, "mode": "subtractive", "parameters": {} },
                { "id": "s2", "type": "radial", "visible": true, "mode": 1, "parameters": {} },
                { "id": "s3", "type": "radial", "visible": true, "mode": "sideways", "parameters": {} },
                { "id": "s4", "type": "radial", "visible": true, "mode": "intersect", "parameters": {} },
            ],
        }]))
        .unwrap();

        let modes: Vec<SubMaskMode> = masks[0].sub_masks.iter().map(|s| s.mode).collect();
        assert_eq!(
            modes,
            [
                SubMaskMode::Subtractive,
                SubMaskMode::Additive,
                SubMaskMode::Additive,
                SubMaskMode::Intersect,
            ]
        );
    }

    /// The tone of a 4 × 2 mask built from "all" components, given as
    /// `(mode, visible, invert, opacity)`; every pixel has the same tone.
    fn all_components_tone(components: &[(&str, bool, bool, f32)]) -> u8 {
        let sub_masks: Vec<_> = components
            .iter()
            .enumerate()
            .map(|(n, &(mode, visible, invert, opacity))| {
                json!({
                    "id": format!("s{n}"), "type": "all", "visible": visible,
                    "invert": invert, "opacity": opacity, "mode": mode, "parameters": {},
                })
            })
            .collect();
        let mask: MaskDefinition = serde_json::from_value(json!({
            "id": "m1", "name": "Mask", "visible": true, "invert": false,
            "adjustments": {}, "subMasks": sub_masks,
        }))
        .unwrap();
        let bitmap = generate_mask_bitmap(&mask, 4, 2, 1.0, (0.0, 0.0), None).unwrap();
        let tone = bitmap.get_pixel(0, 0)[0];
        assert!(bitmap.pixels().all(|p| p[0] == tone));
        tone
    }

    #[test]
    fn an_inverted_mask_without_any_bitmap_has_no_effect() {
        let mask = |sub_masks: Value| -> MaskDefinition {
            serde_json::from_value(json!({
                "id": "m1", "name": "Mask", "visible": true, "invert": true,
                "adjustments": {}, "subMasks": sub_masks,
            }))
            .unwrap()
        };
        // Pasted or applied from a preset: its AI part is not made for this photo yet.
        let not_made = mask(json!([{
            "id": "s1", "type": "ai-depth", "visible": true, "mode": "additive",
            "parameters": { "minDepth": 20.0, "maxDepth": 80.0, "maskDataBase64": null },
        }]));
        let hidden = mask(json!([{
            "id": "s1", "type": "all", "visible": false, "mode": "additive", "parameters": {},
        }]));
        // Still a bitmap, as renders pair bitmaps with the visible masks by position.
        for definition in [not_made, hidden, mask(json!([]))] {
            let bitmap = generate_mask_bitmap(&definition, 4, 2, 1.0, (0.0, 0.0), None).unwrap();
            assert!(bitmap.pixels().all(|p| p[0] == 0));
        }
    }

    #[test]
    fn the_first_component_is_the_base_whatever_its_mode() {
        assert_eq!(
            all_components_tone(&[("subtractive", true, false, 100.0)]),
            255
        );
        assert_eq!(
            all_components_tone(&[("intersect", true, false, 40.0)]),
            102
        );
        assert_eq!(
            all_components_tone(&[
                ("subtractive", true, false, 60.0),
                ("subtractive", true, false, 20.0),
            ]),
            102
        );
    }

    #[test]
    fn hiding_the_first_component_makes_the_next_visible_one_the_base() {
        assert_eq!(
            all_components_tone(&[
                ("additive", false, false, 100.0),
                ("subtractive", true, false, 40.0),
            ]),
            102
        );
        assert_eq!(all_components_tone(&[("additive", false, false, 100.0)]), 0);
    }

    #[test]
    fn later_components_combine_by_their_mode() {
        let tone = |second: &str| {
            all_components_tone(&[("additive", true, false, 60.0), (second, true, false, 20.0)])
        };
        assert_eq!(tone("additive"), 153);
        assert_eq!(tone("subtractive"), 102);
        assert_eq!(tone("intersect"), 51);
        // Subtracting a component from itself leaves nothing; opacity 0 changes nothing.
        let itself = ("subtractive", true, false, 60.0);
        assert_eq!(
            all_components_tone(&[("additive", true, false, 60.0), itself]),
            0
        );
        for mode in ["additive", "subtractive"] {
            assert_eq!(
                all_components_tone(&[("additive", true, false, 60.0), (mode, true, false, 0.0)]),
                153
            );
        }
        // A component's invert applies before it becomes the base.
        assert_eq!(all_components_tone(&[("additive", true, true, 100.0)]), 0);
    }

    #[test]
    fn mask_cache_key_ignores_adjustments_but_follows_the_bitmap_and_size() {
        let key = |def: &MaskDefinition, width, offset, geometry| {
            mask_cache_key(def, width, 50, 1.0, (offset, 0.0), geometry)
        };
        let base = key(&mask(json!({ "exposure": 0 }), "AAAA"), 100, 0.0, None);

        let other_adjustments = mask(json!({ "exposure": 2 }), "AAAA");
        assert_eq!(base, key(&other_adjustments, 100, 0.0, None));

        let other_bitmap = mask(json!({ "exposure": 0 }), "BBBB");
        assert_ne!(base, key(&other_bitmap, 100, 0.0, None));
        let same = mask(json!({ "exposure": 0 }), "AAAA");
        assert_ne!(base, key(&same, 200, 0.0, None));
        assert_ne!(base, key(&same, 100, 1.0, None));
        assert_ne!(base, key(&same, 100, 0.0, Some(7)));
    }

    fn radial_sub_mask(mode: &str, center_x: f64, feather: f32) -> SubMask {
        serde_json::from_value(json!({
            "id": format!("radial-{center_x}"), "type": "radial", "visible": true,
            "mode": mode, "parameters": {
                "centerX": center_x, "centerY": 41.0, "radiusX": 37.0, "radiusY": 23.0,
                "rotation": 17.0, "feather": feather,
            },
        }))
        .unwrap()
    }

    #[test]
    fn a_component_key_ignores_what_is_applied_after_drawing() {
        let key = |sub_mask: &SubMask| sub_mask_cache_key(sub_mask, 90, 60, 1.0, (0.0, 0.0), None);
        let radial = radial_sub_mask("additive", 40.0, 0.5);
        let shaded = SubMask {
            id: "another".into(),
            visible: false,
            invert: true,
            opacity: 30.0,
            mode: SubMaskMode::Subtractive,
            ..radial.clone()
        };
        assert_eq!(key(&radial), key(&shaded));
        assert_ne!(key(&radial), key(&radial_sub_mask("additive", 41.0, 0.5)));
        assert_ne!(key(&radial), key(&radial_sub_mask("additive", 40.0, 0.6)));
        assert_ne!(
            key(&radial),
            sub_mask_cache_key(&radial, 90, 60, 1.0, (0.0, 0.0), Some(1))
        );
    }

    #[test]
    fn the_bitmap_cache_drops_the_least_recently_used_past_its_budget() {
        let bitmap = || Arc::new(GrayImage::new(10, 10));
        let mut cache = BitmapCache::new(300);
        cache.insert(1, bitmap());
        cache.insert(2, bitmap());
        cache.insert(3, bitmap());
        assert!(cache.get(1).is_some());
        cache.insert(4, bitmap());
        assert!(cache.get(2).is_none(), "2 was used least recently");
        assert!(cache.get(1).is_some() && cache.get(3).is_some() && cache.get(4).is_some());
        cache.insert(4, bitmap());
        assert_eq!(cache.bytes, 300);
        cache.insert(5, Arc::new(GrayImage::new(20, 20)));
        assert!(cache.get(5).is_none(), "larger than the whole budget");
        assert_eq!(cache.bytes, 300);
    }

    /// The radial loop before `1.94.0`.
    fn reference_radial(params: &Value, width: u32, height: u32, scale: f32) -> GrayImage {
        let params: RadialMaskParameters = serde::Deserialize::deserialize(params).unwrap();
        let center_x = (params.center_x as f32 * scale) as i32;
        let center_y = (params.center_y as f32 * scale) as i32;
        let radius_x = params.radius_x as f32 * scale;
        let radius_y = params.radius_y as f32 * scale;
        let rotation_rad = params.rotation * PI / 180.0;
        GrayImage::from_fn(width, height, |x, y| {
            let dx = x as f32 - center_x as f32;
            let dy = y as f32 - center_y as f32;
            let rot_dx = dx * rotation_rad.cos() + dy * rotation_rad.sin();
            let rot_dy = -dx * rotation_rad.sin() + dy * rotation_rad.cos();
            let norm_x = rot_dx / radius_x.max(0.01);
            let norm_y = rot_dy / radius_y.max(0.01);
            let dist = (norm_x.powi(2) + norm_y.powi(2)).sqrt();
            let inner_bound = 1.0 - params.feather.clamp(0.0, 1.0);
            let intensity = 1.0 - (dist - inner_bound) / (1.0 - inner_bound).max(0.01);
            Luma([(intensity.clamp(0.0, 1.0) * 255.0) as u8])
        })
    }

    /// The linear loop before `1.94.0`.
    fn reference_linear(params: &Value, width: u32, height: u32) -> GrayImage {
        let params: LinearMaskParameters = serde::Deserialize::deserialize(params).unwrap();
        let (sx, sy) = (params.start_x as f32, params.start_y as f32);
        let (lx, ly) = (params.end_x as f32 - sx, params.end_y as f32 - sy);
        let len = (lx.powi(2) + ly.powi(2)).sqrt();
        let (px, py) = (-ly / len, lx / len);
        GrayImage::from_fn(width, height, |x, y| {
            let dist_perp = (x as f32 - sx) * px + (y as f32 - sy) * py;
            let intensity = 0.5 - dist_perp / params.range.max(0.01) * 0.5;
            Luma([(intensity.clamp(0.0, 1.0) * 255.0) as u8])
        })
    }

    #[test]
    fn parallel_gradients_draw_the_same_pixels_as_the_old_loops() {
        for (width, height) in [(97, 61), (1, 1), (3, 200)] {
            for sub_mask in [
                radial_sub_mask("additive", 40.0, 0.5),
                radial_sub_mask("additive", -5.0, 0.0),
            ] {
                let drawn =
                    generate_radial_bitmap(&sub_mask.parameters, width, height, 1.3, (0.0, 0.0));
                let reference = reference_radial(&sub_mask.parameters, width, height, 1.3);
                assert_eq!(
                    drawn.into_raw(),
                    reference.into_raw(),
                    "radial {width} × {height}"
                );
            }
            let linear =
                json!({ "startX": 10.0, "startY": 5.0, "endX": 70.0, "endY": 50.0, "range": 23.0 });
            let drawn = generate_linear_bitmap(&linear, width, height, 1.0, (0.0, 0.0));
            assert_eq!(
                drawn.into_raw(),
                reference_linear(&linear, width, height).into_raw(),
                "linear {width} × {height}"
            );
        }
    }

    #[test]
    fn parallel_combining_matches_the_pixel_loop() {
        let (width, height) = (97, 61);
        let layers: Vec<SubMask> = [
            ("subtractive", 30.0, 0.7, true, 100.0),
            ("additive", 60.0, 0.4, false, 55.0),
            ("intersect", 45.0, 1.0, true, 80.0),
            ("subtractive", 70.0, 0.2, false, 100.0),
        ]
        .iter()
        .map(|&(mode, center_x, feather, invert, opacity)| SubMask {
            invert,
            opacity,
            ..radial_sub_mask(mode, center_x, feather)
        })
        .collect();

        for (invert, opacity) in [(false, 100.0), (true, 100.0), (false, 35.0), (true, 70.0)] {
            let def = MaskDefinition {
                id: "m".into(),
                name: "Mask".into(),
                visible: true,
                invert,
                opacity,
                blend_mode: String::new(),
                adjustments: json!({}),
                sub_masks: layers.clone(),
            };
            // The `1.93.0` loop: invert, opacity, then the first as base, the rest by mode.
            let mut expected: Option<GrayImage> = None;
            for sub_mask in &def.sub_masks {
                let mut layer = reference_radial(&sub_mask.parameters, width, height, 1.0);
                for p in layer.pixels_mut() {
                    if sub_mask.invert {
                        p[0] = 255 - p[0];
                    }
                    if sub_mask.opacity < 100.0 {
                        p[0] = (p[0] as f32 * (sub_mask.opacity / 100.0)) as u8;
                    }
                }
                let Some(base) = expected.as_mut() else {
                    expected = Some(layer);
                    continue;
                };
                for (x, y, p) in base.enumerate_pixels_mut() {
                    let s = layer.get_pixel(x, y)[0];
                    p[0] = match sub_mask.mode {
                        SubMaskMode::Additive => p[0].max(s),
                        SubMaskMode::Subtractive => p[0].saturating_sub(s),
                        SubMaskMode::Intersect => p[0].min(s),
                    };
                }
            }
            let mut expected = expected.unwrap();
            for p in expected.pixels_mut() {
                if invert {
                    p[0] = 255 - p[0];
                }
                if opacity < 100.0 {
                    p[0] = (p[0] as f32 * (opacity / 100.0)) as u8;
                }
            }

            let combined =
                generate_mask_bitmap(&def, width, height, 1.0, (0.0, 0.0), None).unwrap();
            assert_eq!(
                combined.into_raw(),
                expected.into_raw(),
                "invert {invert}, opacity {opacity}"
            );
        }
    }
}
