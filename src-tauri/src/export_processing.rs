use std::borrow::Cow;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use image::codecs::jpeg::{JpegEncoder, PixelDensity};
use image::codecs::png::PngEncoder;
use image::{
    DynamicImage, GenericImageView, GrayImage, ImageBuffer, ImageEncoder, ImageFormat, Luma,
    imageops,
};
use jxl_encoder::{
    LosslessConfig, LossyConfig, PixelLayout,
    api::{calibrated_jxl_quality, quality_to_distance},
};
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::Emitter;
use tauri::Manager;

use crate::AppState;
use crate::exif_processing;
use crate::file_management::{
    apply_default_lens_profile, generate_filename_from_template, parse_virtual_path,
    read_file_mapped, sanitize_filename_suffix, unique_output_path_avoiding,
};
use crate::formats::is_raw_file;
use crate::image_loader::{BaseSize, load_base_image_from_bytes, prepare_base_image};
use crate::image_processing::{
    AllAdjustments, Crop, GpuContext, RenderOutputPrecision, RenderRequest, downscale_f32_image,
    get_all_adjustments_from_json, get_or_init_gpu_context, process_and_get_dynamic_image,
    process_and_get_dynamic_image_with_precision, resolve_tonemapper_override_from_handle,
};
use crate::lut_processing::{
    convert_image_to_cube_lut, generate_identity_lut_image, get_or_load_lut,
};
use crate::mask_generation::{MaskDefinition, generate_mask_bitmap};
use crate::tiff_metadata::{TiffSamples, encode_tiff_with_metadata};

use crate::cache_utils::{calculate_full_job_hash, calculate_transform_hash};
use crate::{
    apply_all_transformations, generate_transformed_preview, get_cached_or_generate_mask,
    hydrate_adjustments, load_settings, resolve_warped_image_for_masks,
};

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq, Default)]
#[serde(try_from = "u8", into = "u8")]
pub enum TiffBitDepth {
    Eight = 8,
    #[default]
    Sixteen = 16,
}

impl TryFrom<u8> for TiffBitDepth {
    type Error = String;

    fn try_from(value: u8) -> Result<Self, Self::Error> {
        match value {
            8 => Ok(Self::Eight),
            16 => Ok(Self::Sixteen),
            _ => Err(format!(
                "Invalid TIFF bit depth '{}'; expected 8 or 16.",
                value
            )),
        }
    }
}

impl From<TiffBitDepth> for u8 {
    fn from(value: TiffBitDepth) -> Self {
        value as u8
    }
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub enum ResizeMode {
    LongEdge,
    ShortEdge,
    Width,
    Height,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ResizeOptions {
    pub mode: ResizeMode,
    pub value: u32,
    pub dont_enlarge: bool,
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
#[allow(clippy::enum_variant_names)]
pub enum BorderBasis {
    #[default]
    LongEdge,
    ShortEdge,
    EachEdge,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BorderOptions {
    #[serde(default)]
    pub basis: BorderBasis,
    pub horizontal_percent: f32,
    pub vertical_percent: f32,
    pub color: String,
}

impl BorderOptions {
    fn rgb(&self) -> [u8; 3] {
        parse_hex_color(&self.color).unwrap_or([0, 0, 0])
    }
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PadOptions {
    pub ratio_width: f32,
    pub ratio_height: f32,
    pub color: String,
}

impl PadOptions {
    fn rgb(&self) -> [u8; 3] {
        parse_hex_color(&self.color).unwrap_or([0, 0, 0])
    }
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ExportSettings {
    pub jpeg_quality: u8,
    #[serde(default)]
    pub tiff_bit_depth: TiffBitDepth,
    pub resize: Option<ResizeOptions>,
    #[serde(default)]
    pub border: Option<BorderOptions>,
    #[serde(default)]
    pub pad: Option<PadOptions>,
    pub keep_metadata: bool,
    #[serde(default)]
    pub inherit_all_exif: bool,
    #[serde(default)]
    pub preserve_timestamps: bool,
    pub strip_gps: bool,
    pub filename_template: Option<String>,
    /// The Custom Text for `{text}`.
    #[serde(default)]
    pub filename_text: Option<String>,
    #[serde(default)]
    pub filename_suffix: Option<String>,
    pub watermark: Option<WatermarkSettings>,
    #[serde(default)]
    pub export_masks: bool,
    #[serde(default)]
    pub preserve_folders: bool,
    #[serde(default)]
    pub export_to_source_folder: bool,
    #[serde(default)]
    pub subfolder: Option<String>,
    #[serde(default)]
    pub dpi: Option<u16>,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
struct CompletedExport {
    source_path: String,
    output_path: String,
}

#[derive(Clone)]
pub(crate) enum ExportAdjustmentsMode {
    UseSidecars {
        active_path: Option<String>,
        active_adjustments: Option<Value>,
    },
    GlobalOverride(Value),
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub enum WatermarkAnchor {
    TopLeft,
    TopCenter,
    TopRight,
    CenterLeft,
    Center,
    CenterRight,
    BottomLeft,
    BottomCenter,
    BottomRight,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WatermarkSettings {
    pub path: String,
    pub anchor: WatermarkAnchor,
    pub scale: f32,
    pub spacing: f32,
    pub opacity: f32,
}

fn apply_watermark(
    base_image: &mut DynamicImage,
    watermark_settings: &WatermarkSettings,
) -> Result<(), String> {
    let watermark_img = image::open(&watermark_settings.path)
        .map_err(|e| format!("Failed to open watermark image: {}", e))?;

    let (base_w, base_h) = base_image.dimensions();
    let base_min_dim = base_w.min(base_h) as f32;

    let watermark_scale_factor =
        (base_min_dim * (watermark_settings.scale / 100.0)) / watermark_img.width().max(1) as f32;
    let new_wm_w = (watermark_img.width() as f32 * watermark_scale_factor).round() as u32;
    let new_wm_h = (watermark_img.height() as f32 * watermark_scale_factor).round() as u32;

    if new_wm_w == 0 || new_wm_h == 0 {
        return Ok(());
    }

    let scaled_watermark =
        watermark_img.resize_exact(new_wm_w, new_wm_h, image::imageops::FilterType::Lanczos3);
    let opacity_factor = (watermark_settings.opacity / 100.0).clamp(0.0, 1.0);

    let spacing_pixels = (base_min_dim * (watermark_settings.spacing / 100.0)) as i64;
    let (wm_w, wm_h) = scaled_watermark.dimensions();

    let x = match watermark_settings.anchor {
        WatermarkAnchor::TopLeft | WatermarkAnchor::CenterLeft | WatermarkAnchor::BottomLeft => {
            spacing_pixels
        }
        WatermarkAnchor::TopCenter | WatermarkAnchor::Center | WatermarkAnchor::BottomCenter => {
            (base_w as i64 - wm_w as i64) / 2
        }
        WatermarkAnchor::TopRight | WatermarkAnchor::CenterRight | WatermarkAnchor::BottomRight => {
            base_w as i64 - wm_w as i64 - spacing_pixels
        }
    };

    let y = match watermark_settings.anchor {
        WatermarkAnchor::TopLeft | WatermarkAnchor::TopCenter | WatermarkAnchor::TopRight => {
            spacing_pixels
        }
        WatermarkAnchor::CenterLeft | WatermarkAnchor::Center | WatermarkAnchor::CenterRight => {
            (base_h as i64 - wm_h as i64) / 2
        }
        WatermarkAnchor::BottomLeft
        | WatermarkAnchor::BottomCenter
        | WatermarkAnchor::BottomRight => base_h as i64 - wm_h as i64 - spacing_pixels,
    };

    if matches!(
        base_image,
        DynamicImage::ImageRgb16(_) | DynamicImage::ImageRgba16(_)
    ) {
        let mut base_rgba = base_image.to_rgba16();
        let mut watermark_rgba = scaled_watermark.to_rgba16();
        for pixel in watermark_rgba.pixels_mut() {
            pixel[3] = (pixel[3] as f32 * opacity_factor).round() as u16;
        }
        image::imageops::overlay(&mut base_rgba, &watermark_rgba, x, y);
        *base_image = DynamicImage::ImageRgba16(base_rgba);
    } else if matches!(
        base_image,
        DynamicImage::ImageRgb32F(_) | DynamicImage::ImageRgba32F(_)
    ) {
        let mut base_rgba = base_image.to_rgba32f();
        let mut watermark_rgba = scaled_watermark.to_rgba32f();
        for pixel in watermark_rgba.pixels_mut() {
            pixel[3] *= opacity_factor;
        }
        image::imageops::overlay(&mut base_rgba, &watermark_rgba, x, y);
        *base_image = DynamicImage::ImageRgba32F(base_rgba);
    } else {
        let mut base_rgba = base_image.to_rgba8();
        let mut watermark_rgba = scaled_watermark.to_rgba8();
        for pixel in watermark_rgba.pixels_mut() {
            pixel[3] = (pixel[3] as f32 * opacity_factor).round() as u8;
        }
        image::imageops::overlay(&mut base_rgba, &watermark_rgba, x, y);
        *base_image = DynamicImage::ImageRgba8(base_rgba);
    }

    Ok(())
}

const PAD_RATIO_EPSILON: f64 = 0.001;
const MAX_PAD_DIMENSION: u32 = 65_535;
const MAX_BORDER_PERCENT: f64 = 100.0;

#[derive(Debug, Clone, Copy)]
pub(crate) struct ExportGeometry {
    pub canvas_w: u32,
    pub canvas_h: u32,
    pub photo_w: u32,
    pub photo_h: u32,
    pub offset_x: u32,
    pub offset_y: u32,
    pub border_x: u32,
    pub border_y: u32,
}

impl ExportGeometry {
    fn has_border(&self) -> bool {
        self.border_x > 0 || self.border_y > 0
    }

    fn is_identity(&self) -> bool {
        self.canvas_w == self.photo_w && self.canvas_h == self.photo_h
    }
}

fn calculate_resize_target(
    current_w: u32,
    current_h: u32,
    resize_opts: &ResizeOptions,
) -> (u32, u32) {
    if resize_opts.dont_enlarge {
        let exceeds = match resize_opts.mode {
            ResizeMode::LongEdge => current_w.max(current_h) > resize_opts.value,
            ResizeMode::ShortEdge => current_w.min(current_h) > resize_opts.value,
            ResizeMode::Width => current_w > resize_opts.value,
            ResizeMode::Height => current_h > resize_opts.value,
        };
        if !exceeds {
            return (current_w, current_h);
        }
    }

    let fix_width = match resize_opts.mode {
        ResizeMode::LongEdge => current_w >= current_h,
        ResizeMode::ShortEdge => current_w <= current_h,
        ResizeMode::Width => true,
        ResizeMode::Height => false,
    };

    let value = resize_opts.value;
    if fix_width {
        let h = (value as f32 * (current_h as f32 / current_w as f32)).round() as u32;
        (value, h)
    } else {
        let w = (value as f32 * (current_w as f32 / current_h as f32)).round() as u32;
        (w, value)
    }
}

fn parse_hex_color(hex: &str) -> Option<[u8; 3]> {
    let raw = hex.trim().trim_start_matches('#');
    let normalized: String = match raw.len() {
        3 => raw.chars().flat_map(|c| [c, c]).collect(),
        6 => raw.to_string(),
        8 => raw[..6].to_string(),
        _ => return None,
    };
    Some([
        u8::from_str_radix(&normalized[0..2], 16).ok()?,
        u8::from_str_radix(&normalized[2..4], 16).ok()?,
        u8::from_str_radix(&normalized[4..6], 16).ok()?,
    ])
}

fn calculate_pad_target(current_w: u32, current_h: u32, pad: &PadOptions) -> Option<(u32, u32)> {
    if current_w == 0 || current_h == 0 {
        return None;
    }

    let ratio_w = pad.ratio_width as f64;
    let ratio_h = pad.ratio_height as f64;
    if !ratio_w.is_finite() || !ratio_h.is_finite() || ratio_w <= 0.0 || ratio_h <= 0.0 {
        return None;
    }

    let target_ratio = ratio_w / ratio_h;
    let original_ratio = current_w as f64 / current_h as f64;
    if (original_ratio - target_ratio).abs() < PAD_RATIO_EPSILON {
        return None;
    }

    let (new_w, new_h) = if original_ratio > target_ratio {
        (current_w, (current_w as f64 / target_ratio).round() as u32)
    } else {
        ((current_h as f64 * target_ratio).round() as u32, current_h)
    };

    let new_w = new_w.max(current_w);
    let new_h = new_h.max(current_h);

    if new_w > MAX_PAD_DIMENSION || new_h > MAX_PAD_DIMENSION {
        log::warn!(
            "Pad target {}x{} exceeds the maximum supported dimension; skipping padding.",
            new_w,
            new_h
        );
        return None;
    }

    if new_w == current_w && new_h == current_h {
        return None;
    }

    Some((new_w, new_h))
}

fn calculate_border_thickness(
    src_w: u32,
    src_h: u32,
    border: &BorderOptions,
) -> Option<(u32, u32)> {
    if src_w == 0 || src_h == 0 {
        return None;
    }

    let horizontal = border.horizontal_percent as f64;
    let vertical = border.vertical_percent as f64;
    if !horizontal.is_finite() || !vertical.is_finite() {
        return None;
    }

    if horizontal < 0.0
        || vertical < 0.0
        || horizontal > MAX_BORDER_PERCENT
        || vertical > MAX_BORDER_PERCENT
    {
        log::warn!(
            "Border percentages {}/{} are outside 0..={}; skipping border.",
            horizontal,
            vertical,
            MAX_BORDER_PERCENT
        );
        return None;
    }

    let (basis_x, basis_y) = match border.basis {
        BorderBasis::LongEdge => {
            let edge = src_w.max(src_h) as f64;
            (edge, edge)
        }
        BorderBasis::ShortEdge => {
            let edge = src_w.min(src_h) as f64;
            (edge, edge)
        }
        BorderBasis::EachEdge => (src_w as f64, src_h as f64),
    };

    let border_x = (basis_x * horizontal / 100.0).round() as u32;
    let border_y = (basis_y * vertical / 100.0).round() as u32;

    if border_x == 0 && border_y == 0 {
        return None;
    }

    let bordered_w = src_w.saturating_add(border_x.saturating_mul(2));
    let bordered_h = src_h.saturating_add(border_y.saturating_mul(2));
    if bordered_w > MAX_PAD_DIMENSION || bordered_h > MAX_PAD_DIMENSION {
        log::warn!(
            "Bordered size {}x{} exceeds the maximum supported dimension; skipping border.",
            bordered_w,
            bordered_h
        );
        return None;
    }

    Some((border_x, border_y))
}

fn compute_export_geometry(
    src_w: u32,
    src_h: u32,
    settings: &ExportSettings,
) -> Option<ExportGeometry> {
    let border = settings
        .border
        .as_ref()
        .and_then(|border| calculate_border_thickness(src_w, src_h, border));
    let (border_src_x, border_src_y) = border.unwrap_or((0, 0));

    let bordered_w = src_w.saturating_add(border_src_x.saturating_mul(2));
    let bordered_h = src_h.saturating_add(border_src_y.saturating_mul(2));

    let pad_target = settings
        .pad
        .as_ref()
        .and_then(|pad| calculate_pad_target(bordered_w, bordered_h, pad));

    if border.is_none() && pad_target.is_none() {
        return None;
    }

    let (canvas_w, canvas_h) = pad_target.unwrap_or((bordered_w, bordered_h));

    Some(compute_fused_geometry(
        src_w,
        src_h,
        border_src_x,
        border_src_y,
        canvas_w,
        canvas_h,
        settings.resize.as_ref(),
    ))
}

#[allow(clippy::too_many_arguments)]
fn compute_fused_geometry(
    src_w: u32,
    src_h: u32,
    border_src_x: u32,
    border_src_y: u32,
    canvas_w: u32,
    canvas_h: u32,
    resize_opts: Option<&ResizeOptions>,
) -> ExportGeometry {
    let (final_w, final_h) = match resize_opts {
        Some(opts) => calculate_resize_target(canvas_w, canvas_h, opts),
        None => (canvas_w, canvas_h),
    };

    let photo_w =
        ((src_w as f64 * final_w as f64 / canvas_w as f64).round() as u32).clamp(1, final_w.max(1));
    let photo_h =
        ((src_h as f64 * final_h as f64 / canvas_h as f64).round() as u32).clamp(1, final_h.max(1));

    let border_x = ((border_src_x as f64 * final_w as f64 / canvas_w as f64).round() as u32)
        .min(final_w.saturating_sub(photo_w) / 2);
    let border_y = ((border_src_y as f64 * final_h as f64 / canvas_h as f64).round() as u32)
        .min(final_h.saturating_sub(photo_h) / 2);

    ExportGeometry {
        canvas_w: final_w,
        canvas_h: final_h,
        photo_w,
        photo_h,
        offset_x: (final_w - photo_w) / 2,
        offset_y: (final_h - photo_h) / 2,
        border_x,
        border_y,
    }
}

fn compute_export_output_size(src_w: u32, src_h: u32, settings: &ExportSettings) -> (u32, u32) {
    match compute_export_geometry(src_w, src_h, settings) {
        Some(geometry) => (geometry.canvas_w, geometry.canvas_h),
        None => match &settings.resize {
            Some(opts) => calculate_resize_target(src_w, src_h, opts),
            None => (src_w, src_h),
        },
    }
}

trait SolidFill: image::Pixel + 'static {
    fn from_rgb8(color: [u8; 3]) -> Self;
}

impl SolidFill for image::Rgb<u8> {
    fn from_rgb8([r, g, b]: [u8; 3]) -> Self {
        image::Rgb([r, g, b])
    }
}

impl SolidFill for image::Rgba<u8> {
    fn from_rgb8([r, g, b]: [u8; 3]) -> Self {
        image::Rgba([r, g, b, u8::MAX])
    }
}

impl SolidFill for image::Rgb<u16> {
    fn from_rgb8([r, g, b]: [u8; 3]) -> Self {
        image::Rgb([r as u16 * 257, g as u16 * 257, b as u16 * 257])
    }
}

impl SolidFill for image::Rgba<u16> {
    fn from_rgb8([r, g, b]: [u8; 3]) -> Self {
        image::Rgba([r as u16 * 257, g as u16 * 257, b as u16 * 257, u16::MAX])
    }
}

impl SolidFill for image::Rgb<f32> {
    fn from_rgb8([r, g, b]: [u8; 3]) -> Self {
        image::Rgb([r as f32 / 255.0, g as f32 / 255.0, b as f32 / 255.0])
    }
}

impl SolidFill for image::Rgba<f32> {
    fn from_rgb8([r, g, b]: [u8; 3]) -> Self {
        image::Rgba([r as f32 / 255.0, g as f32 / 255.0, b as f32 / 255.0, 1.0])
    }
}

fn fill_rect<P>(
    canvas: &mut ImageBuffer<P, Vec<P::Subpixel>>,
    x: u32,
    y: u32,
    width: u32,
    height: u32,
    fill: P,
) where
    P: image::Pixel + 'static,
    P::Subpixel: 'static,
{
    if width == 0 || height == 0 {
        return;
    }

    let x_end = x.saturating_add(width).min(canvas.width());
    let y_end = y.saturating_add(height).min(canvas.height());
    for row in y..y_end {
        for col in x..x_end {
            canvas.put_pixel(col, row, fill);
        }
    }
}

fn fill_border_frame<P>(
    canvas: &mut ImageBuffer<P, Vec<P::Subpixel>>,
    geometry: &ExportGeometry,
    fill: P,
) where
    P: image::Pixel + 'static,
    P::Subpixel: 'static,
{
    let box_x = geometry.offset_x.saturating_sub(geometry.border_x);
    let box_y = geometry.offset_y.saturating_sub(geometry.border_y);
    let box_w = geometry
        .photo_w
        .saturating_add(geometry.border_x.saturating_mul(2));

    fill_rect(canvas, box_x, box_y, box_w, geometry.border_y, fill);
    fill_rect(
        canvas,
        box_x,
        geometry.offset_y.saturating_add(geometry.photo_h),
        box_w,
        geometry.border_y,
        fill,
    );
    fill_rect(
        canvas,
        box_x,
        geometry.offset_y,
        geometry.border_x,
        geometry.photo_h,
        fill,
    );
    fill_rect(
        canvas,
        geometry.offset_x.saturating_add(geometry.photo_w),
        geometry.offset_y,
        geometry.border_x,
        geometry.photo_h,
        fill,
    );
}

fn place_photo_on_canvas<P>(
    src: &ImageBuffer<P, Vec<P::Subpixel>>,
    geometry: &ExportGeometry,
    outer_fill: P,
    border_fill: Option<P>,
) -> ImageBuffer<P, Vec<P::Subpixel>>
where
    P: image::Pixel + 'static,
    P::Subpixel: 'static,
{
    let mut canvas = ImageBuffer::from_pixel(geometry.canvas_w, geometry.canvas_h, outer_fill);

    if let Some(fill) = border_fill
        && geometry.has_border()
    {
        fill_border_frame(&mut canvas, geometry, fill);
    }

    imageops::replace(
        &mut canvas,
        src,
        geometry.offset_x as i64,
        geometry.offset_y as i64,
    );
    canvas
}

fn compose_image_on_canvas(
    image: &DynamicImage,
    geometry: &ExportGeometry,
    pad_color: [u8; 3],
    border_color: [u8; 3],
) -> DynamicImage {
    fn compose<P: SolidFill>(
        src: &ImageBuffer<P, Vec<P::Subpixel>>,
        geometry: &ExportGeometry,
        pad_color: [u8; 3],
        border_color: [u8; 3],
    ) -> ImageBuffer<P, Vec<P::Subpixel>>
    where
        P::Subpixel: 'static,
    {
        place_photo_on_canvas(
            src,
            geometry,
            P::from_rgb8(pad_color),
            Some(P::from_rgb8(border_color)),
        )
    }

    match image {
        DynamicImage::ImageRgb8(buffer) => {
            DynamicImage::ImageRgb8(compose(buffer, geometry, pad_color, border_color))
        }
        DynamicImage::ImageRgba8(buffer) => {
            DynamicImage::ImageRgba8(compose(buffer, geometry, pad_color, border_color))
        }
        DynamicImage::ImageRgb16(buffer) => {
            DynamicImage::ImageRgb16(compose(buffer, geometry, pad_color, border_color))
        }
        DynamicImage::ImageRgba16(buffer) => {
            DynamicImage::ImageRgba16(compose(buffer, geometry, pad_color, border_color))
        }
        DynamicImage::ImageRgb32F(buffer) => {
            DynamicImage::ImageRgb32F(compose(buffer, geometry, pad_color, border_color))
        }
        DynamicImage::ImageRgba32F(buffer) => {
            DynamicImage::ImageRgba32F(compose(buffer, geometry, pad_color, border_color))
        }
        other => DynamicImage::ImageRgba8(compose(
            &other.to_rgba8(),
            geometry,
            pad_color,
            border_color,
        )),
    }
}

fn relative_dir_is_safe(rel_dir: &Path) -> bool {
    rel_dir.components().all(|component| {
        matches!(
            component,
            std::path::Component::Normal(_) | std::path::Component::CurDir
        )
    })
}

#[cfg(windows)]
fn component_matches(left: std::path::Component<'_>, right: std::path::Component<'_>) -> bool {
    left.as_os_str()
        .to_string_lossy()
        .eq_ignore_ascii_case(&right.as_os_str().to_string_lossy())
}

#[cfg(not(windows))]
fn component_matches(left: std::path::Component<'_>, right: std::path::Component<'_>) -> bool {
    left == right
}

fn strip_prefix_preserving_source_case(source_path: &Path, base_path: &Path) -> Option<PathBuf> {
    let source_components: Vec<_> = source_path.components().collect();
    let base_components: Vec<_> = base_path.components().collect();

    if base_components.len() > source_components.len() {
        return None;
    }

    if !source_components
        .iter()
        .zip(base_components.iter())
        .all(|(source, base)| component_matches(*source, *base))
    {
        return None;
    }

    Some(source_components[base_components.len()..].iter().collect())
}

fn relative_export_dir_for_preserved_folders(
    source_path: &Path,
    base_origin_folders: &[String],
) -> Option<PathBuf> {
    base_origin_folders
        .iter()
        .filter_map(|base| {
            let base_path = Path::new(base);
            strip_prefix_preserving_source_case(source_path, base_path)
                .map(|rel_path| (base_path.components().count(), rel_path))
        })
        .max_by_key(|(component_count, _)| *component_count)
        .and_then(|(_, rel_path)| {
            let rel_dir = rel_path.parent().unwrap_or_else(|| Path::new(""));
            if relative_dir_is_safe(rel_dir) {
                Some(rel_dir.to_path_buf())
            } else {
                None
            }
        })
}

fn apply_export_geometry(
    mut image: DynamicImage,
    export_settings: &ExportSettings,
) -> Result<(DynamicImage, ExportGeometry), String> {
    let (src_w, src_h) = image.dimensions();

    match compute_export_geometry(src_w, src_h, export_settings) {
        None => {
            if let Some(resize_opts) = &export_settings.resize {
                let (target_w, target_h) = calculate_resize_target(src_w, src_h, resize_opts);

                if target_w != src_w || target_h != src_h {
                    image = image.resize(target_w, target_h, imageops::FilterType::Lanczos3);
                }
            }

            let (width, height) = image.dimensions();
            Ok((
                image,
                ExportGeometry {
                    canvas_w: width,
                    canvas_h: height,
                    photo_w: width,
                    photo_h: height,
                    offset_x: 0,
                    offset_y: 0,
                    border_x: 0,
                    border_y: 0,
                },
            ))
        }
        Some(geometry) => {
            if geometry.photo_w != src_w || geometry.photo_h != src_h {
                image = image.resize_exact(
                    geometry.photo_w,
                    geometry.photo_h,
                    imageops::FilterType::Lanczos3,
                );
            }

            let pad_color = export_settings
                .pad
                .as_ref()
                .map(|pad| pad.rgb())
                .unwrap_or([0, 0, 0]);
            let border_color = export_settings
                .border
                .as_ref()
                .map(|border| border.rgb())
                .unwrap_or([0, 0, 0]);

            Ok((
                compose_image_on_canvas(&image, &geometry, pad_color, border_color),
                geometry,
            ))
        }
    }
}

fn apply_export_geometry_and_watermark(
    image: DynamicImage,
    export_settings: &ExportSettings,
) -> Result<(DynamicImage, ExportGeometry), String> {
    let (mut image, geometry) = apply_export_geometry(image, export_settings)?;

    if let Some(watermark_settings) = &export_settings.watermark {
        apply_watermark(&mut image, watermark_settings)?;
    }
    Ok((image, geometry))
}

fn apply_export_resize_and_watermark(
    image: DynamicImage,
    export_settings: &ExportSettings,
) -> Result<DynamicImage, String> {
    Ok(apply_export_geometry_and_watermark(image, export_settings)?.0)
}

fn load_export_source(
    source_path_str: &str,
    settings: &crate::app_settings::AppSettings,
) -> Result<DynamicImage, String> {
    match read_file_mapped(Path::new(source_path_str)) {
        Ok(mmap) => load_base_image_from_bytes(&mmap, source_path_str, false, settings, None)
            .map_err(|e| format!("Failed to load from mmap: {}", e)),
        Err(_) => {
            let bytes = fs::read(source_path_str).map_err(|e| e.to_string())?;
            load_base_image_from_bytes(&bytes, source_path_str, false, settings, None)
                .map_err(|e| format!("Failed to load from bytes: {}", e))
        }
    }
}

/// The folder beside the source image, plus an optional subfolder. Only plain
/// folder names are used, so the subfolder can never leave the source folder.
fn source_export_dir(source_path: &Path, subfolder: Option<&str>) -> PathBuf {
    let mut dir = source_path
        .parent()
        .unwrap_or_else(|| Path::new(""))
        .to_path_buf();
    if let Some(subfolder) = subfolder {
        dir.extend(Path::new(subfolder.trim()).components().filter_map(
            |component| match component {
                std::path::Component::Normal(name) => Some(name),
                _ => None,
            },
        ));
    }
    dir
}

fn ensure_export_not_cancelled(cancellation_token: &AtomicBool) -> Result<(), String> {
    if cancellation_token.load(Ordering::SeqCst) {
        Err("Export cancelled".to_string())
    } else {
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ExportCancellationRequest {
    Requested,
    AlreadyRequested,
    NoActiveTask,
}

struct ExportTaskGuard {
    task_token: Arc<Mutex<Option<Arc<AtomicBool>>>>,
    cancellation_token: Arc<AtomicBool>,
    app_handle: Option<tauri::AppHandle>,
}

impl ExportTaskGuard {
    fn new(
        task_token: Arc<Mutex<Option<Arc<AtomicBool>>>>,
        cancellation_token: Arc<AtomicBool>,
    ) -> Self {
        Self {
            task_token,
            cancellation_token,
            app_handle: None,
        }
    }

    fn with_app_handle(
        task_token: Arc<Mutex<Option<Arc<AtomicBool>>>>,
        cancellation_token: Arc<AtomicBool>,
        app_handle: tauri::AppHandle,
    ) -> Self {
        let mut guard = Self::new(task_token, cancellation_token);
        guard.app_handle = Some(app_handle);
        guard
    }
}

fn register_export_task(
    task_token: &Mutex<Option<Arc<AtomicBool>>>,
) -> Result<Arc<AtomicBool>, String> {
    let mut active_token = task_token.lock().unwrap();
    if active_token.is_some() {
        return Err("An export is already in progress.".to_string());
    }

    let cancellation_token = Arc::new(AtomicBool::new(false));
    *active_token = Some(Arc::clone(&cancellation_token));
    Ok(cancellation_token)
}

fn request_export_cancellation<F>(
    task_token: &Mutex<Option<Arc<AtomicBool>>>,
    on_requested: F,
) -> ExportCancellationRequest
where
    F: FnOnce(),
{
    let active_token = task_token.lock().unwrap();
    let Some(cancellation_token) = active_token.as_ref() else {
        return ExportCancellationRequest::NoActiveTask;
    };

    if cancellation_token.swap(true, Ordering::SeqCst) {
        ExportCancellationRequest::AlreadyRequested
    } else {
        on_requested();
        ExportCancellationRequest::Requested
    }
}

fn finish_export_task<F>(
    task_token: &Mutex<Option<Arc<AtomicBool>>>,
    cancellation_token: &Arc<AtomicBool>,
    on_finish: F,
) -> bool
where
    F: FnOnce(bool),
{
    let mut active_token = task_token.lock().unwrap();
    let Some(current_token) = active_token.as_ref() else {
        return false;
    };
    if !Arc::ptr_eq(current_token, cancellation_token) {
        return false;
    }

    let cancelled = cancellation_token.load(Ordering::SeqCst);
    *active_token = None;

    on_finish(cancelled);
    true
}

impl Drop for ExportTaskGuard {
    fn drop(&mut self) {
        let app_handle = self.app_handle.clone();
        let _ = finish_export_task(
            &self.task_token,
            &self.cancellation_token,
            |cancelled| match (cancelled, app_handle) {
                (true, Some(app_handle)) => {
                    let _ = app_handle.emit("export-cancelled", ());
                }
                (false, Some(app_handle)) => {
                    let _ = app_handle.emit("export-error", "Export task terminated unexpectedly");
                }
                _ => {}
            },
        );
    }
}

/// A prepared base shrunk to the GPU limit and transformed by the edit, with
/// the scale from decoded-photo pixels (crop, masks) onto it.
struct ExportFrame<'a> {
    image: Cow<'a, DynamicImage>,
    crop_offset: (f32, f32),
    scale: f32,
    render_extent: f32,
}

/// `base_scale` is the prepared base's size over the decoded photo's: 2 with
/// Super Resolution, else 1.
fn transform_for_export<'a>(
    base_image: &'a DynamicImage,
    base_scale: f32,
    js_adjustments: &Value,
    context: &GpuContext,
) -> ExportFrame<'a> {
    let (fitted, fit_scale) = crate::gpu_processing::fit_to_gpu(context, base_image);
    let scale = base_scale * fit_scale;
    let render_extent = crate::motion_blur::render_extent(&fitted, 1.0);
    let adjustments = crate::image_processing::with_crop_scaled(js_adjustments, scale);
    let (image, crop_offset) = apply_all_transformations(fitted, &adjustments);
    ExportFrame {
        image,
        crop_offset,
        scale,
        render_extent,
    }
}

/// The exported size of a render that is `size` in decoded-photo pixels:
/// enlarged by Super Resolution, then shrunk like `transform_for_export`
/// when the prepared base (`base_size` decoded) exceeds the GPU limit.
fn scale_to_export_pixels(
    (width, height): (u32, u32),
    (base_w, base_h): (u32, u32),
    adjustments: &Value,
    context: &GpuContext,
) -> (u32, u32) {
    let factor = crate::ai_upscale::factor(adjustments);
    let scale = factor as f32
        * crate::gpu_processing::gpu_fit_scale(context, base_w * factor, base_h * factor);
    let scaled = |v: u32| ((v as f32 * scale).round() as u32).max(1);
    (scaled(width), scaled(height))
}

#[allow(clippy::too_many_arguments)]
fn process_image_for_export_pipeline(
    path: &str,
    base_image: &DynamicImage,
    base_scale: f32,
    js_adjustments: &Value,
    context: &GpuContext,
    state: &tauri::State<AppState>,
    is_raw: bool,
    debug_tag: &str,
    app_handle: &tauri::AppHandle,
    output_precision: RenderOutputPrecision,
) -> Result<DynamicImage, String> {
    let frame = transform_for_export(base_image, base_scale, js_adjustments, context);
    let (img_w, img_h) = frame.image.dimensions();

    let mask_definitions: Vec<MaskDefinition> = js_adjustments
        .get("masks")
        .and_then(|m| serde::Deserialize::deserialize(m).ok())
        .unwrap_or_default();

    let warped_image = resolve_warped_image_for_masks(state, js_adjustments, &mask_definitions);
    let mask_bitmaps: Vec<ImageBuffer<Luma<u8>, Vec<u8>>> = mask_definitions
        .iter()
        .filter_map(|def| {
            generate_mask_bitmap(
                def,
                img_w,
                img_h,
                frame.scale,
                frame.crop_offset,
                warped_image.as_deref(),
            )
        })
        .collect();

    let tm_override = resolve_tonemapper_override_from_handle(app_handle, is_raw);
    let mut all_adjustments = get_all_adjustments_from_json(js_adjustments, is_raw, tm_override);
    crate::baseline_exposure::apply_natural_exposure(&mut all_adjustments, path);
    all_adjustments.global.show_clipping = 0;

    let lut_path = js_adjustments["lutPath"].as_str();
    let lut = lut_path.and_then(|p| get_or_load_lut(state, p).ok());

    let unique_hash = calculate_full_job_hash(path, js_adjustments);

    process_and_get_dynamic_image_with_precision(
        context,
        state,
        frame.image.as_ref(),
        unique_hash,
        RenderRequest {
            adjustments: all_adjustments,
            mask_bitmaps: &mask_bitmaps,
            lut,
            roi: None,
            probe: None,
            motion_blur: crate::motion_blur::MotionBlurs::new(
                js_adjustments,
                (img_w, img_h),
                frame.crop_offset,
                frame.render_extent,
            ),
        },
        debug_tag,
        output_precision,
    )
}

fn render_output_precision(
    output_format: &str,
    export_settings: &ExportSettings,
) -> RenderOutputPrecision {
    if matches!(output_format.to_lowercase().as_str(), "tif" | "tiff")
        && export_settings.tiff_bit_depth == TiffBitDepth::Sixteen
    {
        RenderOutputPrecision::SixteenBit
    } else {
        RenderOutputPrecision::EightBit
    }
}

fn set_timestamps_from_exif(src: &Path, dst: &Path) {
    let capture_dt =
        exif_processing::local_instant(exif_processing::get_creation_date_from_path(src));
    let ft = filetime::FileTime::from_unix_time(
        capture_dt.timestamp(),
        capture_dt.timestamp_subsec_nanos(),
    );
    if let Err(e) = filetime::set_file_times(dst, ft, ft) {
        log::warn!("Could not set timestamps on '{}': {}", dst.display(), e);
    }
}

fn save_image_with_metadata(
    image: &DynamicImage,
    output_path: &std::path::Path,
    source_path_str: &str,
    export_settings: &ExportSettings,
) -> Result<(), String> {
    let extension = output_path
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_lowercase();

    let tiff_metadata = (export_settings.keep_metadata
        && matches!(extension.as_str(), "tif" | "tiff"))
    .then(|| {
        exif_processing::collect_export_metadata(
            source_path_str,
            export_settings.strip_gps,
            export_settings.inherit_all_exif,
            true,
        )
    })
    .flatten();
    let mut image_bytes =
        encode_image_to_bytes(image, &extension, export_settings, tiff_metadata.as_ref())?;

    exif_processing::write_image_with_metadata(
        &mut image_bytes,
        source_path_str,
        &extension,
        export_settings.keep_metadata,
        export_settings.strip_gps,
        export_settings.inherit_all_exif,
        export_settings.dpi,
    )?;

    #[cfg(target_os = "android")]
    {
        let file_name = output_path
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or_else(|| "Missing Android export file name".to_string())?;
        crate::android_integration::save_image_bytes_to_android_gallery(
            file_name,
            mime_type_for_extension(&extension),
            &image_bytes,
        )?;
    }

    #[cfg(not(target_os = "android"))]
    fs::write(output_path, image_bytes).map_err(|e| e.to_string())?;

    Ok(())
}

#[cfg(target_os = "android")]
pub fn mime_type_for_extension(extension: &str) -> &'static str {
    match extension {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "gif" => "image/gif",
        "tif" | "tiff" => "image/tiff",
        "jxl" => "image/jxl",
        _ => "application/octet-stream",
    }
}

#[allow(clippy::too_many_arguments)]
fn process_image_for_export(
    path: &str,
    base_image: &DynamicImage,
    base_scale: f32,
    js_adjustments: &Value,
    export_settings: &ExportSettings,
    context: &GpuContext,
    state: &tauri::State<AppState>,
    is_raw: bool,
    app_handle: &tauri::AppHandle,
    output_format: &str,
) -> Result<DynamicImage, String> {
    let processed_image = process_image_for_export_pipeline(
        path,
        base_image,
        base_scale,
        js_adjustments,
        context,
        state,
        is_raw,
        "process_image_for_export",
        app_handle,
        render_output_precision(output_format, export_settings),
    )?;

    apply_export_resize_and_watermark(processed_image, export_settings)
}

fn build_single_mask_adjustments(all: &AllAdjustments, mask_index: usize) -> AllAdjustments {
    let mut single = AllAdjustments {
        global: all.global,
        mask_adjustments: all.mask_adjustments,
        mask_count: 1,
        tile_offset_x: all.tile_offset_x,
        tile_offset_y: all.tile_offset_y,
        mask_atlas_cols: all.mask_atlas_cols,
    };
    single.mask_adjustments[0] = all.mask_adjustments[mask_index];
    for i in 1..single.mask_adjustments.len() {
        single.mask_adjustments[i] = Default::default();
    }
    single
}

fn encode_grayscale_to_png(bitmap: &GrayImage) -> Result<Vec<u8>, String> {
    let mut buf = Vec::new();
    let mut cursor = Cursor::new(&mut buf);
    bitmap
        .write_to(&mut cursor, ImageFormat::Png)
        .map_err(|e| e.to_string())?;
    Ok(buf)
}

/// Exports are sRGB-encoded; tagging them lets color-managed apps read them correctly.
const SRGB_ICC_PROFILE: &[u8] = include_bytes!("../icc/sRGB-v2-magic.icc");

/// Encodes an export. A TIFF gets `tiff_metadata` written by its encoder; the other formats
/// get their metadata afterwards from `exif_processing::write_image_with_metadata`.
fn encode_image_to_bytes(
    image: &DynamicImage,
    output_format: &str,
    export_settings: &ExportSettings,
    tiff_metadata: Option<&little_exif::metadata::Metadata>,
) -> Result<Vec<u8>, String> {
    let jpeg_quality = export_settings.jpeg_quality;
    let mut image_bytes = Vec::new();
    let mut cursor = Cursor::new(&mut image_bytes);

    match output_format.to_lowercase().as_str() {
        "jxl" => {
            let (width, height) = image.dimensions();
            let has_alpha = image.color().has_alpha();

            let jxl_data = if jpeg_quality == 100 {
                // Tree learning peaks near 300 B/px (about 10 GB for 36 MP) and is
                // about 15x slower; without it, files are about 50% larger.
                let config = LosslessConfig::new().with_tree_learning(false);
                if has_alpha {
                    let rgba = image.to_rgba8();
                    config
                        .encode(rgba.as_raw(), width, height, PixelLayout::Rgba8)
                        .map_err(|e| format!("Failed to encode lossless JXL: {}", e))?
                } else {
                    let rgb = image.to_rgb8();
                    config
                        .encode(rgb.as_raw(), width, height, PixelLayout::Rgb8)
                        .map_err(|e| format!("Failed to encode lossless JXL: {}", e))?
                }
            } else {
                let jxl_quality = calibrated_jxl_quality(jpeg_quality as f32);
                let distance = quality_to_distance(jxl_quality);

                if has_alpha {
                    let rgba = image.to_rgba8();
                    LossyConfig::new(distance)
                        .encode(rgba.as_raw(), width, height, PixelLayout::Rgba8)
                        .map_err(|e| format!("Failed to encode lossy JXL: {}", e))?
                } else {
                    let rgb = image.to_rgb8();
                    LossyConfig::new(distance)
                        .encode(rgb.as_raw(), width, height, PixelLayout::Rgb8)
                        .map_err(|e| format!("Failed to encode lossy JXL: {}", e))?
                }
            };

            return Ok(jxl_data);
        }
        "webp" => {
            let encoder = webp::Encoder::from_image(image)
                .map_err(|_| "Failed to create WebP encoder".to_string())?;
            let webp_mem = encoder.encode(jpeg_quality as f32);
            return Ok(webp_mem.to_vec());
        }
        "jpg" | "jpeg" => {
            let rgb_image = image.to_rgb8();
            let mut encoder = JpegEncoder::new_with_quality(&mut cursor, jpeg_quality);
            encoder
                .set_icc_profile(SRGB_ICC_PROFILE.to_vec())
                .map_err(|e| e.to_string())?;
            if let Some(dpi) = export_settings.dpi {
                encoder.set_pixel_density(PixelDensity::dpi(dpi));
            }
            rgb_image
                .write_with_encoder(encoder)
                .map_err(|e| e.to_string())?;
        }
        "png" => {
            let image_to_encode = if image.as_rgb32f().is_some() {
                DynamicImage::ImageRgb16(image.to_rgb16())
            } else {
                image.clone()
            };

            let mut encoder = PngEncoder::new(&mut cursor);
            encoder
                .set_icc_profile(SRGB_ICC_PROFILE.to_vec())
                .map_err(|e| e.to_string())?;
            image_to_encode
                .write_with_encoder(encoder)
                .map_err(|e| e.to_string())?;
            if let Some(dpi) = export_settings.dpi {
                insert_png_phys_chunk(&mut image_bytes, dpi);
            }
        }
        "tif" | "tiff" => {
            let samples = match export_settings.tiff_bit_depth {
                TiffBitDepth::Eight => TiffSamples::Eight,
                TiffBitDepth::Sixteen => TiffSamples::Sixteen,
            };
            return encode_tiff_with_metadata(
                image,
                samples,
                tiff_metadata,
                Some(SRGB_ICC_PROFILE),
                export_settings.dpi,
            );
        }
        "avif" => {
            image
                .write_to(&mut cursor, image::ImageFormat::Avif)
                .map_err(|e| e.to_string())?;
        }
        _ => return Err(format!("Unsupported file format: {}", output_format)),
    };
    Ok(image_bytes)
}

/// Inserts a PNG pHYs chunk (pixels per metre) right after IHDR.
fn insert_png_phys_chunk(image_bytes: &mut Vec<u8>, dpi: u16) {
    const IHDR_END: usize = 33;
    if image_bytes.len() < IHDR_END || &image_bytes[12..16] != b"IHDR" {
        return;
    }

    let pixels_per_meter = (f64::from(dpi) / 0.0254).round() as u32;
    let mut data = Vec::with_capacity(9);
    data.extend_from_slice(&pixels_per_meter.to_be_bytes());
    data.extend_from_slice(&pixels_per_meter.to_be_bytes());
    data.push(1);

    let mut crc = crc32fast::Hasher::new();
    crc.update(b"pHYs");
    crc.update(&data);

    let mut chunk = Vec::with_capacity(data.len() + 12);
    chunk.extend_from_slice(&(data.len() as u32).to_be_bytes());
    chunk.extend_from_slice(b"pHYs");
    chunk.extend_from_slice(&data);
    chunk.extend_from_slice(&crc.finalize().to_be_bytes());
    image_bytes.splice(IHDR_END..IHDR_END, chunk);
}

#[allow(clippy::too_many_arguments)]
fn export_masks_for_image(
    base_image: &DynamicImage,
    base_scale: f32,
    js_adjustments: &Value,
    export_settings: &ExportSettings,
    output_path_obj: &std::path::Path,
    source_path_str: &str,
    context: &Arc<GpuContext>,
    state: &tauri::State<AppState>,
    is_raw: bool,
    app_handle: &tauri::AppHandle,
    cancellation_token: &AtomicBool,
) -> Result<(), String> {
    ensure_export_not_cancelled(cancellation_token)?;
    let frame = transform_for_export(base_image, base_scale, js_adjustments, context);
    let transformed_image = &frame.image;
    ensure_export_not_cancelled(cancellation_token)?;
    let (img_w, img_h) = transformed_image.dimensions();
    let mask_definitions: Vec<MaskDefinition> = js_adjustments
        .get("masks")
        .and_then(|m| serde::Deserialize::deserialize(m).ok())
        .unwrap_or_default();

    let warped_image = resolve_warped_image_for_masks(state, js_adjustments, &mask_definitions);
    let mut mask_bitmaps = Vec::with_capacity(mask_definitions.len());
    for definition in &mask_definitions {
        ensure_export_not_cancelled(cancellation_token)?;
        if let Some(bitmap) = generate_mask_bitmap(
            definition,
            img_w,
            img_h,
            frame.scale,
            frame.crop_offset,
            warped_image.as_deref(),
        ) {
            mask_bitmaps.push(bitmap);
        }
        ensure_export_not_cancelled(cancellation_token)?;
    }

    if !mask_bitmaps.is_empty() {
        let tm_override = resolve_tonemapper_override_from_handle(app_handle, is_raw);
        let mut all_adjustments =
            get_all_adjustments_from_json(js_adjustments, is_raw, tm_override);
        crate::baseline_exposure::apply_natural_exposure(&mut all_adjustments, source_path_str);
        let lut_path = js_adjustments["lutPath"].as_str();
        let lut = lut_path.and_then(|p| get_or_load_lut(state, p).ok());
        let unique_hash = calculate_full_job_hash(source_path_str, js_adjustments);
        let output_dir = output_path_obj.parent().unwrap_or(output_path_obj);
        let stem = output_path_obj
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("export");
        let extension = output_path_obj
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("jpg");

        for (i, _) in mask_bitmaps.iter().enumerate() {
            ensure_export_not_cancelled(cancellation_token)?;
            let single_adjustments = build_single_mask_adjustments(&all_adjustments, i);
            let full_white_mask = ImageBuffer::from_fn(img_w, img_h, |_, _| Luma([255u8]));
            let single_bitmaps: Vec<ImageBuffer<Luma<u8>, Vec<u8>>> = vec![full_white_mask];

            let processed = process_and_get_dynamic_image_with_precision(
                context,
                state,
                transformed_image.as_ref(),
                unique_hash,
                RenderRequest {
                    adjustments: single_adjustments,
                    mask_bitmaps: &single_bitmaps,
                    lut: lut.clone(),
                    roi: None,
                    probe: None,
                    motion_blur: Default::default(),
                },
                "export_mask_image",
                render_output_precision(extension, export_settings),
            )?;
            ensure_export_not_cancelled(cancellation_token)?;

            let (with_options, geometry) =
                apply_export_geometry_and_watermark(processed, export_settings)?;

            let alpha_scaled = if mask_bitmaps[i].width() == geometry.photo_w
                && mask_bitmaps[i].height() == geometry.photo_h
            {
                mask_bitmaps[i].clone()
            } else {
                imageops::resize(
                    &mask_bitmaps[i],
                    geometry.photo_w,
                    geometry.photo_h,
                    imageops::FilterType::Lanczos3,
                )
            };

            let alpha_resized: GrayImage = if geometry.is_identity() {
                alpha_scaled
            } else {
                place_photo_on_canvas(&alpha_scaled, &geometry, Luma([0u8]), None)
            };
            ensure_export_not_cancelled(cancellation_token)?;

            let mask_image_path =
                output_dir.join(format!("{}_mask_{}_image.{}", stem, i, extension));
            let mask_alpha_path = output_dir.join(format!("{}_mask_{}_alpha.png", stem, i));

            save_image_with_metadata(
                &with_options,
                &mask_image_path,
                source_path_str,
                export_settings,
            )?;
            ensure_export_not_cancelled(cancellation_token)?;

            if export_settings.preserve_timestamps {
                set_timestamps_from_exif(Path::new(source_path_str), &mask_image_path);
            }

            let alpha_bytes = encode_grayscale_to_png(&alpha_resized)?;
            ensure_export_not_cancelled(cancellation_token)?;
            #[cfg(target_os = "android")]
            {
                let file_name = mask_alpha_path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .ok_or_else(|| "Missing Android mask export file name".to_string())?;
                crate::android_integration::save_image_bytes_to_android_gallery(
                    file_name,
                    "image/png",
                    &alpha_bytes,
                )?;
            }

            #[cfg(not(target_os = "android"))]
            fs::write(&mask_alpha_path, alpha_bytes).map_err(|e| e.to_string())?;
            ensure_export_not_cancelled(cancellation_token)?;
        }
    }
    Ok(())
}

fn export_adjustments_as_lut(
    js_adjustments: &Value,
    source_path_str: &str,
    context: &Arc<GpuContext>,
    state: &tauri::State<AppState>,
    app_handle: &tauri::AppHandle,
    cancellation_token: &AtomicBool,
) -> Result<Vec<u8>, String> {
    ensure_export_not_cancelled(cancellation_token)?;
    let lut_size = 33;
    let identity_image = generate_identity_lut_image(lut_size);

    let tm_override = resolve_tonemapper_override_from_handle(app_handle, false);
    let mut all_adjustments = get_all_adjustments_from_json(js_adjustments, false, tm_override);

    all_adjustments.global.show_clipping = 0;
    all_adjustments.global.vignette_amount = 0.0;
    all_adjustments.global.grain_amount = 0.0;
    all_adjustments.global.sharpness = 0.0;
    all_adjustments.global.clarity = 0.0;
    all_adjustments.global.dehaze = 0.0;
    all_adjustments.global.structure = 0.0;
    all_adjustments.global.centré = 0.0;
    all_adjustments.global.glow_amount = 0.0;
    all_adjustments.global.halation_amount = 0.0;
    all_adjustments.global.flare_amount = 0.0;
    all_adjustments.global.luma_noise_reduction = 0.0;
    all_adjustments.global.color_noise_reduction = 0.0;
    all_adjustments.global.chromatic_aberration_red_cyan = 0.0;
    all_adjustments.global.chromatic_aberration_blue_yellow = 0.0;

    let lut_path = js_adjustments["lutPath"].as_str();
    let lut = lut_path.and_then(|p| get_or_load_lut(state, p).ok());
    let unique_hash = calculate_full_job_hash(source_path_str, js_adjustments);

    let processed_lut = process_and_get_dynamic_image(
        context,
        state,
        &identity_image,
        unique_hash,
        RenderRequest {
            adjustments: all_adjustments,
            mask_bitmaps: &[],
            lut,
            roi: None,
            probe: None,
            motion_blur: Default::default(),
        },
        "export_lut",
    )?;
    ensure_export_not_cancelled(cancellation_token)?;

    let cube_lut = convert_image_to_cube_lut(&processed_lut, lut_size)?;
    ensure_export_not_cancelled(cancellation_token)?;
    Ok(cube_lut)
}

/// The template when the export settings name none (owner 2026-11-16: no special case for
/// the Settings suffix; it is simply added after the name).
const DEFAULT_FILENAME_TEMPLATE: &str = "{filename}_edited";

/// What to do with an export whose file already exists. The Export panel asks
/// before anything is written; any clash nobody was asked about is renamed.
#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ExportConflictResolution {
    Overwrite,
    Skip,
    Rename,
}

/// An existing file that a planned export would replace.
#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ExportConflict {
    pub source_path: String,
    pub output_path: String,
}

/// Where a batch goes, shared by the clash check and the export so both plan
/// the same files.
struct ExportDestination<'a> {
    output_folder_or_file: &'a Path,
    is_explicit_file_path: bool,
    base_origin_folders: &'a [String],
    export_settings: &'a ExportSettings,
    output_format: &'a str,
}

impl ExportDestination<'_> {
    /// One exact file the user chose (save dialog, Edit In): written as asked.
    fn is_single_file(&self, total_paths: usize) -> bool {
        self.is_explicit_file_path
            && total_paths == 1
            && !self.export_settings.export_to_source_folder
    }
}

/// Virtual copies are numbered per source in export order (`_VC01`, `_VC02`),
/// so a copy never takes its original's name; their ids are hex, not numbers.
fn virtual_copy_numbers(paths: &[String]) -> Vec<Option<usize>> {
    let mut counts: HashMap<PathBuf, usize> = HashMap::new();
    paths
        .iter()
        .map(|path| {
            path.contains("?vc=").then(|| {
                let count = counts.entry(parse_virtual_path(path).0).or_default();
                *count += 1;
                *count
            })
        })
        .collect()
}

/// The file each photo would be written to, before clashes are resolved.
fn planned_output_paths(paths: &[String], destination: &ExportDestination) -> Vec<PathBuf> {
    let total_paths = paths.len();
    let output = destination.output_folder_or_file;
    if destination.is_single_file(total_paths) {
        return vec![output.to_path_buf()];
    }
    let settings = destination.export_settings;
    let suffix = settings
        .filename_suffix
        .as_deref()
        .map(sanitize_filename_suffix)
        .filter(|suffix| !suffix.is_empty());
    let template = settings
        .filename_template
        .as_deref()
        .unwrap_or(DEFAULT_FILENAME_TEMPLATE);
    let text = settings.filename_text.as_deref();
    let copy_numbers = virtual_copy_numbers(paths);

    paths
        .par_iter()
        .zip(copy_numbers)
        .enumerate()
        .map(|(index, (path, copy_number))| {
            let (source_path, _) = parse_virtual_path(path);
            let mut stem =
                generate_filename_from_template(template, path, index + 1, total_paths, None, text);
            if let Some(copy_number) = copy_number {
                stem = format!("{stem}_VC{copy_number:02}");
            }
            if let Some(suffix) = &suffix {
                stem.push_str(suffix);
            }
            let file_name = format!("{stem}.{}", destination.output_format);
            let dir = if settings.export_to_source_folder {
                source_export_dir(&source_path, settings.subfolder.as_deref())
            } else if settings.preserve_folders {
                relative_export_dir_for_preserved_folders(
                    &source_path,
                    destination.base_origin_folders,
                )
                .map_or_else(|| output.to_path_buf(), |rel_dir| output.join(rel_dir))
            } else {
                output.to_path_buf()
            };
            dir.join(file_name)
        })
        .collect()
}

/// Existing files the batch would replace, once per file. A photo's own
/// source and a name an earlier photo of the batch already takes are not
/// asked about: those always get a free name.
fn find_conflicts(paths: &[String], destination: &ExportDestination) -> Vec<ExportConflict> {
    if destination.is_single_file(paths.len()) {
        return Vec::new();
    }
    let mut planned_so_far = HashSet::new();
    paths
        .iter()
        .zip(planned_output_paths(paths, destination))
        .filter(|(path, output_path)| {
            planned_so_far.insert(output_path.clone())
                && output_path.exists()
                && *output_path != parse_virtual_path(path).0
        })
        .map(|(path, output_path)| ExportConflict {
            source_path: path.clone(),
            output_path: output_path.to_string_lossy().into_owned(),
        })
        .collect()
}

/// The final file of each photo (`None`: skipped). A name goes to the first
/// photo of the batch that wants it; an existing file follows the user's
/// choice for it. Every other clash, including a photo's own source and
/// exports nobody is asked about (the command line), gets the first free
/// `stem_N` name, so nothing is replaced unless the user chose it.
fn resolve_output_paths(
    paths: &[String],
    planned: Vec<PathBuf>,
    destination: &ExportDestination,
    resolutions: &HashMap<String, ExportConflictResolution>,
) -> Vec<Option<PathBuf>> {
    if destination.is_single_file(paths.len()) {
        return planned.into_iter().map(Some).collect();
    }
    let mut claimed: HashSet<PathBuf> = HashSet::new();
    paths
        .iter()
        .zip(planned)
        .map(|(path, output_path)| {
            let resolution = if claimed.contains(&output_path) {
                ExportConflictResolution::Rename
            } else if !output_path.exists() {
                ExportConflictResolution::Overwrite
            } else if output_path == parse_virtual_path(path).0 {
                ExportConflictResolution::Rename
            } else {
                resolutions
                    .get(output_path.to_string_lossy().as_ref())
                    .copied()
                    .unwrap_or(ExportConflictResolution::Rename)
            };
            let output_path = match resolution {
                ExportConflictResolution::Skip => return None,
                ExportConflictResolution::Overwrite => output_path,
                ExportConflictResolution::Rename => free_output_path(&output_path, &claimed),
            };
            claimed.insert(output_path.clone());
            Some(output_path)
        })
        .collect()
}

fn free_output_path(output_path: &Path, claimed: &HashSet<PathBuf>) -> PathBuf {
    let dir = output_path.parent().unwrap_or_else(|| Path::new(""));
    let stem = output_path
        .file_stem()
        .map(|stem| stem.to_string_lossy())
        .unwrap_or_default();
    let extension = output_path
        .extension()
        .map(|extension| extension.to_string_lossy())
        .unwrap_or_default();
    unique_output_path_avoiding(dir, &stem, &extension, |path| claimed.contains(path))
}

/// Counts one more photo as done (exported, failed or skipped).
fn emit_export_progress(
    app_handle: &tauri::AppHandle,
    progress_counter: &AtomicUsize,
    total_paths: usize,
    path: &str,
) {
    let current = progress_counter.fetch_add(1, Ordering::SeqCst) + 1;
    let _ = app_handle.emit(
        "batch-export-progress",
        serde_json::json!({ "current": current, "total": total_paths, "path": path }),
    );
}

#[tauri::command]
pub async fn find_export_conflicts(
    paths: Vec<String>,
    output_folder_or_file: String,
    is_explicit_file_path: bool,
    base_origin_folders: Vec<String>,
    export_settings: ExportSettings,
    output_format: String,
) -> Result<Vec<ExportConflict>, String> {
    tokio::task::spawn_blocking(move || {
        find_conflicts(
            &paths,
            &ExportDestination {
                output_folder_or_file: Path::new(&output_folder_or_file),
                is_explicit_file_path,
                base_origin_folders: &base_origin_folders,
                export_settings: &export_settings,
                output_format: &output_format,
            },
        )
    })
    .await
    .map_err(|error| format!("Could not check the export files: {error}"))
}

#[allow(clippy::too_many_arguments)]
pub(crate) async fn export_images_impl(
    paths: Vec<String>,
    output_folder_or_file: String,
    is_explicit_file_path: bool,
    base_origin_folders: Vec<String>,
    export_settings: ExportSettings,
    output_format: String,
    adjustments_mode: ExportAdjustmentsMode,
    conflict_resolutions: HashMap<String, ExportConflictResolution>,
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
    track_created_images: bool,
    completion_tx: Option<tokio::sync::oneshot::Sender<Result<(), usize>>>,
) -> Result<(), String> {
    let cancellation_token = register_export_task(&state.export_task_token)?;
    let task_guard = ExportTaskGuard::with_app_handle(
        Arc::clone(&state.export_task_token),
        Arc::clone(&cancellation_token),
        app_handle.clone(),
    );
    tokio::time::sleep(std::time::Duration::from_millis(10)).await;

    if cancellation_token.load(Ordering::SeqCst) {
        return Ok(());
    }

    let context = match get_or_init_gpu_context(&state, &app_handle) {
        Ok(context) => context,
        Err(_) if cancellation_token.load(Ordering::SeqCst) => return Ok(()),
        Err(error) => return Err(error),
    };

    if cancellation_token.load(Ordering::SeqCst) {
        return Ok(());
    }

    let context = Arc::new(context);
    let progress_counter = Arc::new(AtomicUsize::new(0));

    let available_cores = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(1);

    let mut sys = sysinfo::System::new();
    sys.refresh_memory();

    let available_ram_gb = sys.available_memory() as f64 / 1024.0 / 1024.0 / 1024.0;
    let ram_based_limit = (available_ram_gb / 4.0).floor() as usize;

    let num_threads = if paths.len() == 1 {
        1
    } else {
        available_cores.min(ram_based_limit).clamp(1, 4)
    };

    log::info!(
        "Batch Export: {} cores, {:.1} GB free RAM -> {} threads",
        available_cores,
        available_ram_gb,
        num_threads
    );

    let _export_task = tokio::spawn(async move {
        let _task_guard = task_guard;
        let output_folder_path = std::path::Path::new(&output_folder_or_file);
        let total_paths = paths.len();
        let settings = load_settings(app_handle.clone()).unwrap_or_default();

        let output_paths = {
            let destination = ExportDestination {
                output_folder_or_file: output_folder_path,
                is_explicit_file_path,
                base_origin_folders: &base_origin_folders,
                export_settings: &export_settings,
                output_format: &output_format,
            };
            let planned = planned_output_paths(&paths, &destination);
            resolve_output_paths(&paths, planned, &destination, &conflict_resolutions)
        };

        let semaphore = Arc::new(tokio::sync::Semaphore::new(num_threads));
        let mut join_handles = Vec::new();

        for (image_path_str, output_path) in paths.into_iter().zip(output_paths) {
            if cancellation_token.load(Ordering::SeqCst) {
                break;
            }
            let Some(output_path) = output_path else {
                emit_export_progress(&app_handle, &progress_counter, total_paths, &image_path_str);
                continue;
            };
            let permit = semaphore.clone().acquire_owned().await.unwrap();
            if cancellation_token.load(Ordering::SeqCst) {
                drop(permit);
                break;
            }

            let app_handle_clone = app_handle.clone();
            let context_clone = Arc::clone(&context);
            let progress_counter_clone = Arc::clone(&progress_counter);
            let export_settings = export_settings.clone();
            let output_format = output_format.clone();
            let settings = settings.clone();
            let cancellation_token_clone = Arc::clone(&cancellation_token);
            let adjustments_mode = adjustments_mode.clone();

            let handle = tokio::task::spawn_blocking(move || {
                ensure_export_not_cancelled(&cancellation_token_clone)?;

                let state = app_handle_clone.state::<AppState>();
                let (source_path, sidecar_path) = parse_virtual_path(&image_path_str);
                let source_path_str = source_path.to_string_lossy().to_string();

                let is_current_edit = match &adjustments_mode {
                    ExportAdjustmentsMode::UseSidecars { active_path, .. } => {
                        Some(&image_path_str) == active_path.as_ref()
                    }
                    ExportAdjustmentsMode::GlobalOverride(_) => false,
                };

                let load_sidecar_adjustments = || {
                    let mut metadata = crate::exif_processing::load_sidecar(&sidecar_path);
                    apply_default_lens_profile(
                        &mut metadata.adjustments,
                        &metadata.exif,
                        &source_path,
                        &settings,
                        &app_handle_clone,
                    );
                    metadata.adjustments
                };
                let mut js_adjustments = match &adjustments_mode {
                    ExportAdjustmentsMode::UseSidecars {
                        active_adjustments, ..
                    } => match active_adjustments {
                        Some(adj) if is_current_edit => adj.clone(),
                        _ => load_sidecar_adjustments(),
                    },
                    ExportAdjustmentsMode::GlobalOverride(adj) => adj.clone(),
                };

                hydrate_adjustments(&state, &mut js_adjustments);
                let is_raw = is_raw_file(&source_path_str);

                if output_path == source_path {
                    return Err(format!(
                        "Export would overwrite its source image: {}",
                        source_path.display()
                    ));
                }
                if let Some(dir) = output_path.parent() {
                    std::fs::create_dir_all(dir).map_err(|e| {
                        format!(
                            "Failed to create export subdirectory '{}': {}",
                            dir.display(),
                            e
                        )
                    })?;
                }

                let extension = output_format.to_lowercase();

                let result: Result<(), String> = (|| {
                    if extension == "cube" {
                        let cube_bytes = export_adjustments_as_lut(
                            &js_adjustments,
                            &source_path_str,
                            &context_clone,
                            &state,
                            &app_handle_clone,
                            &cancellation_token_clone,
                        )?;
                        ensure_export_not_cancelled(&cancellation_token_clone)?;
                        #[cfg(target_os = "android")]
                        {
                            let file_name = output_path
                                .file_name()
                                .and_then(|name| name.to_str())
                                .ok_or_else(|| "Missing Android LUT file name".to_string())?;
                            crate::android_integration::save_file_bytes_to_android_downloads(
                                file_name,
                                "application/octet-stream",
                                &cube_bytes,
                            )?;
                        }
                        #[cfg(not(target_os = "android"))]
                        fs::write(&output_path, cube_bytes).map_err(|e| e.to_string())?;
                        ensure_export_not_cancelled(&cancellation_token_clone)?;
                        return Ok(());
                    }

                    let current_original = is_current_edit
                        .then(|| crate::get_original_image(&state).ok())
                        .flatten()
                        .map(|(image, _)| image);
                    let decoded_base = match current_original {
                        Some(image) => image,
                        None => Arc::new(load_export_source(&source_path_str, &settings)?),
                    };
                    ensure_export_not_cancelled(&cancellation_token_clone)?;
                    crate::ai_denoise::ensure_ready_blocking(
                        &app_handle_clone,
                        &decoded_base,
                        &source_path_str,
                        &js_adjustments,
                    )?;
                    ensure_export_not_cancelled(&cancellation_token_clone)?;
                    crate::ai_upscale::ensure_ready_blocking(
                        &app_handle_clone,
                        &decoded_base,
                        &source_path_str,
                        &js_adjustments,
                    )?;
                    let base_image = prepare_base_image(
                        &decoded_base,
                        &source_path_str,
                        &js_adjustments,
                        BaseSize::Upscaled,
                    )
                    .map_err(|e| format!("Failed to prepare base image: {}", e))?
                    .into_owned();
                    let base_scale = crate::ai_upscale::scale_between(&decoded_base, &base_image);
                    drop(decoded_base);
                    ensure_export_not_cancelled(&cancellation_token_clone)?;

                    let mut main_export_adjustments = js_adjustments.clone();
                    if export_settings.export_masks
                        && let Some(obj) = main_export_adjustments.as_object_mut()
                    {
                        obj.insert("masks".to_string(), serde_json::json!([]));
                    }

                    let actual_output_format = output_path
                        .extension()
                        .and_then(|extension| extension.to_str())
                        .unwrap_or(output_format.as_str());

                    let final_image = process_image_for_export(
                        &source_path_str,
                        &base_image,
                        base_scale,
                        &main_export_adjustments,
                        &export_settings,
                        &context_clone,
                        &state,
                        is_raw,
                        &app_handle_clone,
                        actual_output_format,
                    )?;
                    ensure_export_not_cancelled(&cancellation_token_clone)?;
                    save_image_with_metadata(
                        &final_image,
                        &output_path,
                        &source_path_str,
                        &export_settings,
                    )?;
                    ensure_export_not_cancelled(&cancellation_token_clone)?;

                    if export_settings.preserve_timestamps {
                        set_timestamps_from_exif(Path::new(&source_path_str), &output_path);
                    }
                    ensure_export_not_cancelled(&cancellation_token_clone)?;

                    if export_settings.export_masks {
                        export_masks_for_image(
                            &base_image,
                            base_scale,
                            &js_adjustments,
                            &export_settings,
                            &output_path,
                            &source_path_str,
                            &context_clone,
                            &state,
                            is_raw,
                            &app_handle_clone,
                            &cancellation_token_clone,
                        )?;
                    }

                    Ok(())
                })();

                if !cancellation_token_clone.load(Ordering::SeqCst) {
                    emit_export_progress(
                        &app_handle_clone,
                        &progress_counter_clone,
                        total_paths,
                        &image_path_str,
                    );
                }

                drop(permit);
                if cancellation_token_clone.load(Ordering::SeqCst) {
                    Err("Export cancelled".to_string())
                } else {
                    result.map(|_| CompletedExport {
                        source_path: image_path_str,
                        output_path: output_path.to_string_lossy().into_owned(),
                    })
                }
            });

            join_handles.push(handle);
        }

        let mut results = Vec::new();
        for handle in join_handles {
            match handle.await {
                Ok(res) => results.push(res),
                Err(e) => results.push(Err(format!("Thread crashed: {}", e))),
            }
        }

        let mut completed_exports = Vec::new();
        let mut errors = Vec::new();
        for result in results {
            match result {
                Ok(completed_export) => completed_exports.push(completed_export),
                Err(error) => errors.push(error),
            }
        }
        let error_count = errors.len();
        let export_state = app_handle.state::<AppState>();
        let finalized = finish_export_task(
            &export_state.export_task_token,
            &cancellation_token,
            |cancelled| {
                if cancelled {
                    log::info!("Batch export cancelled and worker cleanup completed");
                    let _ = app_handle.emit("export-cancelled", ());
                    return;
                }

                for error in &errors {
                    log::error!("Export error: {}", error);
                    if total_paths == 1 {
                        let _ = app_handle.emit("export-error", error.clone());
                    }
                }

                if error_count > 0 && total_paths > 1 {
                    let _ = app_handle.emit(
                        "export-error",
                        format!("{error_count} of {total_paths} exports failed"),
                    );
                } else if error_count == 0 {
                    let _ = app_handle.emit(
                        "batch-export-progress",
                        serde_json::json!({ "current": total_paths, "total": total_paths, "path": "" }),
                    );
                    let exports = if track_created_images {
                        completed_exports
                    } else {
                        Vec::new()
                    };
                    let _ = app_handle
                        .emit("export-complete", serde_json::json!({ "exports": exports }));
                }
            },
        );

        if !finalized {
            log::warn!("Ignoring terminal events from a stale export task");
        }

        if let Some(tx) = completion_tx {
            if error_count > 0 {
                let _ = tx.send(Err(error_count));
            } else {
                let _ = tx.send(Ok(()));
            }
        }
    });

    Ok(())
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn export_images(
    paths: Vec<String>,
    output_folder_or_file: String,
    is_explicit_file_path: bool,
    base_origin_folders: Vec<String>,
    export_settings: ExportSettings,
    output_format: String,
    track_created_images: Option<bool>,
    current_edit_path: Option<String>,
    current_edit_adjustments: Option<Value>,
    conflict_resolutions: Option<HashMap<String, ExportConflictResolution>>,
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    export_images_impl(
        paths,
        output_folder_or_file,
        is_explicit_file_path,
        base_origin_folders,
        export_settings,
        output_format,
        ExportAdjustmentsMode::UseSidecars {
            active_path: current_edit_path,
            active_adjustments: current_edit_adjustments,
        },
        conflict_resolutions.unwrap_or_default(),
        state,
        app_handle,
        track_created_images.unwrap_or(false),
        None,
    )
    .await
}

pub async fn run_headless_export(
    session: crate::launch_request::HeadlessExportSession,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    println!("Starting headless export...");
    let state = app_handle.state::<crate::AppState>();

    let source_path = std::path::Path::new(&session.source);
    if !source_path.exists() {
        return Err(format!("Source path does not exist: {}", session.source));
    }

    let mut paths = Vec::new();
    if source_path.is_dir() {
        let images = crate::file_management::list_images_recursive(
            session.source.clone(),
            app_handle.clone(),
        )
        .await?;
        paths = images.into_iter().map(|img| img.path).collect();
    } else {
        paths.push(session.source.clone());
    }

    if paths.is_empty() {
        return Err("No supported images found at the source path.".to_string());
    }

    let output_path = std::path::Path::new(&session.output);
    let is_explicit_file_path =
        paths.len() == 1 && output_path.extension().is_some() && !output_path.is_dir();

    if is_explicit_file_path {
        if let Some(parent) = output_path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create output parent directory: {}", e))?;
        }
    } else {
        std::fs::create_dir_all(&session.output)
            .map_err(|e| format!("Failed to create output directory: {}", e))?;
    }

    println!("Found {} images to export. Processing...", paths.len());

    let export_settings = ExportSettings {
        jpeg_quality: session.quality,
        tiff_bit_depth: TiffBitDepth::default(),
        dpi: None,
        resize: None,
        border: None,
        pad: None,
        keep_metadata: session.keep_metadata,
        inherit_all_exif: false,
        preserve_timestamps: true,
        strip_gps: false,
        filename_template: None,
        filename_text: None,
        filename_suffix: None,
        watermark: None,
        export_masks: false,
        preserve_folders: true,
        export_to_source_folder: false,
        subfolder: None,
    };

    let mut custom_adjustments = None;
    if let Some(adj_path) = &session.adjustments_override {
        let content = std::fs::read_to_string(adj_path)
            .map_err(|e| format!("Failed to read adjustments file: {}", e))?;
        let json: serde_json::Value = serde_json::from_str(&content)
            .map_err(|e| format!("Failed to parse adjustments JSON: {}", e))?;
        custom_adjustments = Some(json);
        println!(
            "Loaded custom adjustments to override sidecars from: {}",
            adj_path
        );
    }

    let (tx, rx) = tokio::sync::oneshot::channel();

    let mode = if let Some(adj) = custom_adjustments {
        ExportAdjustmentsMode::GlobalOverride(adj)
    } else {
        ExportAdjustmentsMode::UseSidecars {
            active_path: None,
            active_adjustments: None,
        }
    };

    export_images_impl(
        paths,
        session.output,
        is_explicit_file_path,
        vec![session.source],
        export_settings,
        session.format,
        mode,
        HashMap::new(),
        state.clone(),
        app_handle.clone(),
        false,
        Some(tx),
    )
    .await?;

    match rx.await {
        Ok(Ok(())) => Ok(()),
        Ok(Err(errors)) => Err(format!("Export completed with {} errors.", errors)),
        Err(_) => Err("Export task panicked or was cancelled.".to_string()),
    }
}

#[tauri::command]
pub fn cancel_export(
    state: tauri::State<AppState>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    match request_export_cancellation(&state.export_task_token, || {
        let _ = app_handle.emit("export-cancelling", ());
    }) {
        ExportCancellationRequest::Requested => {
            log::info!("Export cancellation requested; workers will stop at the next checkpoint");
        }
        ExportCancellationRequest::AlreadyRequested => {
            log::info!("Export cancellation was already requested");
        }
        ExportCancellationRequest::NoActiveTask => {
            return Err("No export task is currently running.".to_string());
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn estimate_export_sizes(
    paths: Vec<String>,
    export_settings: ExportSettings,
    output_format: String,
    current_edit_path: Option<String>,
    current_edit_adjustments: Option<Value>,
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
) -> Result<usize, String> {
    if output_format.to_lowercase() == "cube" {
        return Ok(1_050_000 * paths.len());
    }

    if paths.is_empty() {
        return Ok(0);
    }

    let first_path = &paths[0];
    let (source_path, sidecar_path) = parse_virtual_path(first_path);
    let source_path_str = source_path.to_string_lossy().to_string();

    let context = get_or_init_gpu_context(&state, &app_handle)?;
    let is_current_edit = Some(first_path) == current_edit_path.as_ref();
    let is_raw = is_raw_file(&source_path_str);
    let settings = load_settings(app_handle.clone()).unwrap_or_default();

    let single_image_extrapolated_size: usize = if is_current_edit
        && current_edit_adjustments.is_some()
    {
        let loaded_image = state
            .original_image
            .lock()
            .unwrap()
            .clone()
            .ok_or("No original image loaded")?;
        let mut adjustments_clone = current_edit_adjustments.clone().unwrap();
        hydrate_adjustments(&state, &mut adjustments_clone);

        let new_transform_hash = calculate_transform_hash(&adjustments_clone);
        let cached_preview_lock = state.cached_preview.lock().unwrap();
        let preview_dim = settings.editor_preview_resolution.unwrap_or(1920);

        let (preview_image, scale, unscaled_crop_offset) = if let Some(cached) =
            &*cached_preview_lock
        {
            if cached.transform_hash == new_transform_hash && cached.preview_dim == preview_dim {
                let img = Arc::clone(&cached.image);
                let s = cached.scale;
                let offset = cached.unscaled_crop_offset;
                drop(cached_preview_lock);
                let owned_img = Arc::try_unwrap(img).unwrap_or_else(|arc| (*arc).clone());
                (owned_img, s, offset)
            } else {
                drop(cached_preview_lock);
                generate_transformed_preview(
                    &state,
                    &loaded_image,
                    &adjustments_clone,
                    preview_dim,
                )?
            }
        } else {
            drop(cached_preview_lock);
            generate_transformed_preview(&state, &loaded_image, &adjustments_clone, preview_dim)?
        };

        let (img_w, img_h) = preview_image.dimensions();
        let mask_definitions: Vec<MaskDefinition> = adjustments_clone
            .get("masks")
            .and_then(|m| serde::Deserialize::deserialize(m).ok())
            .unwrap_or_default();

        let scaled_crop_offset = (
            unscaled_crop_offset.0 * scale,
            unscaled_crop_offset.1 * scale,
        );

        let mask_bitmaps: Vec<ImageBuffer<Luma<u8>, Vec<u8>>> = mask_definitions
            .iter()
            .filter_map(|def| {
                get_cached_or_generate_mask(
                    &state,
                    def,
                    img_w,
                    img_h,
                    scale,
                    scaled_crop_offset,
                    &adjustments_clone,
                )
            })
            .collect();

        let tm_override = resolve_tonemapper_override_from_handle(&app_handle, is_raw);
        let mut all_adjustments =
            get_all_adjustments_from_json(&adjustments_clone, is_raw, tm_override);
        crate::baseline_exposure::apply_natural_exposure(&mut all_adjustments, &source_path_str);
        all_adjustments.global.show_clipping = 0;

        let lut = adjustments_clone["lutPath"]
            .as_str()
            .and_then(|p| get_or_load_lut(&state, p).ok());
        let unique_hash =
            calculate_full_job_hash(&loaded_image.path, &adjustments_clone).wrapping_add(1);

        let processed_preview = process_and_get_dynamic_image_with_precision(
            &context,
            &state,
            &preview_image,
            unique_hash,
            RenderRequest {
                adjustments: all_adjustments,
                mask_bitmaps: &mask_bitmaps,
                lut,
                roi: None,
                probe: None,
                motion_blur: crate::motion_blur::MotionBlurs::new(
                    &adjustments_clone,
                    (img_w, img_h),
                    scaled_crop_offset,
                    crate::motion_blur::render_extent(&loaded_image.image, scale),
                ),
            },
            "estimate_export_size",
            render_output_precision(&output_format, &export_settings),
        )?;

        let preview_bytes =
            encode_image_to_bytes(&processed_preview, &output_format, &export_settings, None)?;
        let preview_byte_size = preview_bytes.len();

        let (transformed_full_res, _) =
            apply_all_transformations(&loaded_image.image, &adjustments_clone);
        let (full_w, full_h) = scale_to_export_pixels(
            transformed_full_res.dimensions(),
            loaded_image.image.dimensions(),
            &adjustments_clone,
            &context,
        );

        let (final_full_w, final_full_h) =
            compute_export_output_size(full_w, full_h, &export_settings);

        let (processed_preview_w, processed_preview_h) = processed_preview.dimensions();
        let pixel_ratio = if processed_preview_w > 0 && processed_preview_h > 0 {
            (final_full_w as f64 * final_full_h as f64)
                / (processed_preview_w as f64 * processed_preview_h as f64)
        } else {
            1.0
        };

        (preview_byte_size as f64 * pixel_ratio) as usize
    } else {
        let metadata = crate::exif_processing::load_sidecar(&sidecar_path);
        let mut js_adjustments = metadata.adjustments;

        const ESTIMATE_DIM: u32 = 1280;

        let file_slice: Vec<u8>;
        let mmap_guard;
        let file_data: &[u8] = match read_file_mapped(Path::new(&source_path_str)) {
            Ok(mmap) => {
                mmap_guard = Some(mmap);
                mmap_guard.as_ref().unwrap()
            }
            Err(_) => {
                file_slice = fs::read(&source_path_str).map_err(|io_err| io_err.to_string())?;
                &file_slice
            }
        };

        let original_image =
            load_base_image_from_bytes(file_data, &source_path_str, true, &settings, None)
                .map_err(|e| e.to_string())?;

        let raw_scale_factor = if is_raw {
            crate::raw_processing::get_fast_demosaic_scale_factor(
                file_data,
                original_image.width(),
                original_image.height(),
            )
        } else {
            1.0
        };

        if let Some(crop_val) = js_adjustments.get_mut("crop")
            && let Ok(c) = serde_json::from_value::<Crop>(crop_val.clone())
        {
            *crop_val = serde_json::to_value(Crop {
                x: c.x * raw_scale_factor as f64,
                y: c.y * raw_scale_factor as f64,
                width: c.width * raw_scale_factor as f64,
                height: c.height * raw_scale_factor as f64,
            })
            .unwrap_or(serde_json::Value::Null);
        }

        let (transformed_shrunk_res, unscaled_crop_offset) =
            apply_all_transformations(Cow::Borrowed(&original_image), &js_adjustments);
        let (shrunk_w, shrunk_h) = transformed_shrunk_res.dimensions();

        let preview_base = if shrunk_w > ESTIMATE_DIM || shrunk_h > ESTIMATE_DIM {
            downscale_f32_image(transformed_shrunk_res.as_ref(), ESTIMATE_DIM, ESTIMATE_DIM)
        } else {
            transformed_shrunk_res.into_owned()
        };

        let (preview_w, preview_h) = preview_base.dimensions();
        let gpu_scale = if shrunk_w > 0 {
            preview_w as f32 / shrunk_w as f32
        } else {
            1.0
        };
        let total_scale = gpu_scale * raw_scale_factor;

        let mask_definitions: Vec<MaskDefinition> = js_adjustments
            .get("masks")
            .and_then(|m| serde::Deserialize::deserialize(m).ok())
            .unwrap_or_default();
        let scaled_crop_offset = (
            unscaled_crop_offset.0 * gpu_scale,
            unscaled_crop_offset.1 * gpu_scale,
        );

        let mask_bitmaps: Vec<ImageBuffer<Luma<u8>, Vec<u8>>> = mask_definitions
            .iter()
            .filter_map(|def| {
                get_cached_or_generate_mask(
                    &state,
                    def,
                    preview_w,
                    preview_h,
                    total_scale,
                    scaled_crop_offset,
                    &js_adjustments,
                )
            })
            .collect();

        let tm_override = resolve_tonemapper_override_from_handle(&app_handle, is_raw);
        let mut all_adjustments =
            get_all_adjustments_from_json(&js_adjustments, is_raw, tm_override);
        crate::baseline_exposure::apply_natural_exposure(&mut all_adjustments, &source_path_str);
        all_adjustments.global.show_clipping = 0;

        let lut = js_adjustments["lutPath"]
            .as_str()
            .and_then(|p| get_or_load_lut(&state, p).ok());
        let unique_hash =
            calculate_full_job_hash(&source_path_str, &js_adjustments).wrapping_add(1);

        let processed_preview = process_and_get_dynamic_image_with_precision(
            &context,
            &state,
            &preview_base,
            unique_hash,
            RenderRequest {
                adjustments: all_adjustments,
                mask_bitmaps: &mask_bitmaps,
                lut,
                roi: None,
                probe: None,
                motion_blur: crate::motion_blur::MotionBlurs::new(
                    &js_adjustments,
                    (preview_w, preview_h),
                    scaled_crop_offset,
                    crate::motion_blur::render_extent(&original_image, gpu_scale),
                ),
            },
            "estimate_batch_export_size",
            render_output_precision(&output_format, &export_settings),
        )?;

        let preview_bytes =
            encode_image_to_bytes(&processed_preview, &output_format, &export_settings, None)?;
        let single_image_estimated_size = preview_bytes.len();

        let full_size = |w: u32| (w as f32 / raw_scale_factor).round() as u32;
        let (full_w, full_h) = scale_to_export_pixels(
            (full_size(shrunk_w), full_size(shrunk_h)),
            (
                full_size(original_image.width()),
                full_size(original_image.height()),
            ),
            &js_adjustments,
            &context,
        );

        let (final_full_w, final_full_h) =
            compute_export_output_size(full_w, full_h, &export_settings);

        let (processed_preview_w, processed_preview_h) = processed_preview.dimensions();
        let pixel_ratio = if processed_preview_w > 0 && processed_preview_h > 0 {
            (final_full_w as f64 * final_full_h as f64)
                / (processed_preview_w as f64 * processed_preview_h as f64)
        } else {
            1.0
        };

        (single_image_estimated_size as f64 * pixel_ratio) as usize
    };

    Ok(single_image_extrapolated_size * paths.len())
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{ColorType, Rgba};

    fn legacy_export_settings_json() -> serde_json::Value {
        serde_json::json!({
            "jpegQuality": 90,
            "resize": null,
            "keepMetadata": true,
            "stripGps": false,
            "filenameTemplate": null,
            "watermark": null
        })
    }

    #[test]
    fn legacy_export_settings_default_tiff_to_sixteen_bit() {
        let settings: ExportSettings =
            serde_json::from_value(legacy_export_settings_json()).expect("legacy settings");
        assert_eq!(settings.tiff_bit_depth, TiffBitDepth::Sixteen);
    }

    #[test]
    fn tiff_bit_depth_serializes_as_number_and_rejects_invalid_values() {
        assert_eq!(
            serde_json::to_value(TiffBitDepth::Eight).expect("serialize"),
            serde_json::json!(8)
        );
        assert_eq!(
            serde_json::to_value(TiffBitDepth::Sixteen).expect("serialize"),
            serde_json::json!(16)
        );

        let mut invalid = legacy_export_settings_json();
        invalid["tiffBitDepth"] = serde_json::json!(12);
        let error = serde_json::from_value::<ExportSettings>(invalid)
            .expect_err("invalid TIFF bit depth must fail");
        assert!(error.to_string().contains("expected 8 or 16"));
    }

    #[test]
    fn tiff_encoder_writes_real_rgb8_and_rgb16() {
        let samples = vec![1, 258, 4095, 65535, 65534, 32769, 12345, 60000];
        let source = DynamicImage::ImageRgba16(
            ImageBuffer::<Rgba<u16>, Vec<u16>>::from_raw(2, 1, samples)
                .expect("synthetic RGBA16 image"),
        );

        let settings = |tiff_bit_depth| ExportSettings {
            tiff_bit_depth,
            ..serde_json::from_value(legacy_export_settings_json()).expect("legacy settings")
        };

        let encoded_8 =
            encode_image_to_bytes(&source, "tiff", &settings(TiffBitDepth::Eight), None)
                .expect("encode RGB8 TIFF");
        let decoded_8 = image::load_from_memory_with_format(&encoded_8, ImageFormat::Tiff)
            .expect("decode RGB8 TIFF");
        assert_eq!(decoded_8.color(), ColorType::Rgb8);
        assert_eq!(decoded_8.to_rgb8(), source.to_rgb8());

        let encoded_16 =
            encode_image_to_bytes(&source, "tiff", &settings(TiffBitDepth::Sixteen), None)
                .expect("encode RGB16 TIFF");
        let decoded_16 = image::load_from_memory_with_format(&encoded_16, ImageFormat::Tiff)
            .expect("decode RGB16 TIFF");
        assert_eq!(decoded_16.color(), ColorType::Rgb16);
        assert_eq!(
            decoded_16.to_rgb16().into_raw(),
            vec![1, 258, 4095, 65534, 32769, 12345]
        );
    }

    #[test]
    fn source_export_dir_keeps_subfolders_inside_the_source_folder() {
        let source = Path::new("photos").join("2026").join("IMG_1.CR3");
        let base = Path::new("photos").join("2026");
        assert_eq!(source_export_dir(&source, None), base);
        assert_eq!(source_export_dir(&source, Some("  ")), base);
        assert_eq!(
            source_export_dir(&source, Some("exports/web")),
            base.join("exports").join("web")
        );
        assert_eq!(
            source_export_dir(&source, Some("/../exports")),
            base.join("exports")
        );
    }

    fn export_settings(changes: serde_json::Value) -> ExportSettings {
        let mut json = legacy_export_settings_json();
        if let (Some(json), Some(changes)) = (json.as_object_mut(), changes.as_object()) {
            json.extend(changes.clone());
        }
        serde_json::from_value(json).expect("export settings")
    }

    fn file_names(paths: &[Option<PathBuf>]) -> Vec<Option<String>> {
        paths
            .iter()
            .map(|path| {
                path.as_ref()
                    .map(|path| path.file_name().unwrap().to_string_lossy().into_owned())
            })
            .collect()
    }

    #[test]
    fn virtual_copies_are_numbered_per_source_whatever_their_id() {
        let paths = [
            "a.raw",
            "a.raw?vc=1f3a9c",
            "b.raw?vc=000123",
            "a.raw?vc=abcdef",
        ]
        .map(String::from);
        assert_eq!(
            virtual_copy_numbers(&paths),
            vec![None, Some(1), Some(1), Some(2)]
        );
    }

    #[test]
    fn export_clashes_follow_the_choice_and_never_overwrite_unasked() {
        let folder = tempfile::tempdir().expect("temp dir");
        let output = folder.path().join("out");
        fs::create_dir_all(&output).unwrap();
        fs::write(output.join("a_edited.jpg"), b"earlier export").unwrap();
        let source = |dir: &str| folder.path().join(dir).join("a.raw");
        let paths = vec![
            source("one").to_string_lossy().into_owned(),
            format!("{}?vc=4be2f0", source("one").display()),
            source("two").to_string_lossy().into_owned(),
        ];
        let settings = export_settings(serde_json::json!({}));
        let destination = ExportDestination {
            output_folder_or_file: &output,
            is_explicit_file_path: false,
            base_origin_folders: &[],
            export_settings: &settings,
            output_format: "jpg",
        };
        let existing = output.join("a_edited.jpg").to_string_lossy().into_owned();

        let conflicts = find_conflicts(&paths, &destination);
        assert_eq!(
            conflicts,
            vec![ExportConflict {
                source_path: paths[0].clone(),
                output_path: existing.clone(),
            }]
        );

        let resolve = |choice: Option<ExportConflictResolution>| {
            let resolutions = choice
                .map(|choice| HashMap::from([(existing.clone(), choice)]))
                .unwrap_or_default();
            let planned = planned_output_paths(&paths, &destination);
            file_names(&resolve_output_paths(
                &paths,
                planned,
                &destination,
                &resolutions,
            ))
        };
        let names = |names: [Option<&str>; 3]| names.map(|name| name.map(String::from)).to_vec();
        assert_eq!(
            resolve(None),
            names([
                Some("a_edited_1.jpg"),
                Some("a_edited_VC01.jpg"),
                Some("a_edited_2.jpg")
            ])
        );
        assert_eq!(
            resolve(Some(ExportConflictResolution::Overwrite)),
            names([
                Some("a_edited.jpg"),
                Some("a_edited_VC01.jpg"),
                Some("a_edited_1.jpg")
            ])
        );
        assert_eq!(
            resolve(Some(ExportConflictResolution::Skip)),
            names([None, Some("a_edited_VC01.jpg"), None])
        );
    }

    #[test]
    fn an_export_beside_its_source_never_takes_the_source_name() {
        let folder = tempfile::tempdir().expect("temp dir");
        let source = folder.path().join("photo.jpg");
        fs::write(&source, b"source").unwrap();
        let paths = vec![source.to_string_lossy().into_owned()];
        let settings = export_settings(serde_json::json!({
            "filenameTemplate": "{original_filename}",
            "exportToSourceFolder": true
        }));
        let destination = ExportDestination {
            output_folder_or_file: Path::new(""),
            is_explicit_file_path: false,
            base_origin_folders: &[],
            export_settings: &settings,
            output_format: "jpg",
        };
        assert!(find_conflicts(&paths, &destination).is_empty());
        let resolutions = HashMap::from([(
            source.to_string_lossy().into_owned(),
            ExportConflictResolution::Overwrite,
        )]);
        let planned = planned_output_paths(&paths, &destination);
        assert_eq!(
            resolve_output_paths(&paths, planned, &destination, &resolutions),
            vec![Some(folder.path().join("photo_1.jpg"))]
        );
    }

    #[test]
    fn a_chosen_file_is_written_as_chosen() {
        let folder = tempfile::tempdir().expect("temp dir");
        let chosen = folder.path().join("chosen.tif");
        fs::write(&chosen, b"earlier").unwrap();
        let paths = vec![folder.path().join("a.raw").to_string_lossy().into_owned()];
        let settings = export_settings(serde_json::json!({}));
        let destination = ExportDestination {
            output_folder_or_file: &chosen,
            is_explicit_file_path: true,
            base_origin_folders: &[],
            export_settings: &settings,
            output_format: "tif",
        };
        assert!(find_conflicts(&paths, &destination).is_empty());
        let planned = planned_output_paths(&paths, &destination);
        assert_eq!(
            resolve_output_paths(&paths, planned, &destination, &HashMap::new()),
            vec![Some(chosen)]
        );
    }

    #[test]
    fn exports_record_requested_dpi() {
        let source =
            DynamicImage::ImageRgb8(ImageBuffer::from_pixel(4, 3, image::Rgb([10, 20, 30])));
        let settings = ExportSettings {
            dpi: Some(300),
            ..serde_json::from_value(legacy_export_settings_json()).expect("legacy settings")
        };

        let tiff_bytes =
            encode_image_to_bytes(&source, "tiff", &settings, None).expect("encode TIFF");
        let mut decoder =
            tiff::decoder::Decoder::new(Cursor::new(&tiff_bytes)).expect("decode TIFF");
        let x_resolution = decoder
            .get_tag_u32_vec(tiff::tags::Tag::XResolution)
            .expect("XResolution tag");
        assert_eq!(x_resolution, vec![300, 1]);
        assert_eq!(
            decoder
                .get_tag_u8_vec(tiff::tags::Tag::IccProfile)
                .expect("ICC profile tag"),
            SRGB_ICC_PROFILE
        );

        let png_bytes = encode_image_to_bytes(&source, "png", &settings, None).expect("encode PNG");
        let phys = png_bytes
            .windows(4)
            .position(|window| window == b"pHYs")
            .expect("pHYs chunk");
        assert_eq!(
            &png_bytes[phys + 4..phys + 13],
            &[0, 0, 46, 35, 0, 0, 46, 35, 1]
        );
        image::load_from_memory_with_format(&png_bytes, ImageFormat::Png).expect("valid PNG");

        let jpeg_bytes =
            encode_image_to_bytes(&source, "jpeg", &settings, None).expect("encode JPEG");
        assert_eq!(&jpeg_bytes[6..11], b"JFIF\0");
        assert_eq!(&jpeg_bytes[13..18], &[1, 1, 44, 1, 44]);
    }

    #[test]
    fn tiff_export_metadata_keeps_requested_dpi_and_profile() {
        let folder = tempfile::tempdir().expect("temp dir");
        let source_path = folder.path().join("source.jpg");
        let source =
            DynamicImage::ImageRgb8(ImageBuffer::from_pixel(4, 3, image::Rgb([10, 20, 30])));
        source.save(&source_path).expect("write source");
        let settings = ExportSettings {
            dpi: Some(300),
            ..serde_json::from_value(legacy_export_settings_json()).expect("legacy settings")
        };

        let metadata = exif_processing::collect_export_metadata(
            source_path.to_str().unwrap(),
            false,
            false,
            true,
        );
        let tiff_bytes = encode_image_to_bytes(&source, "tiff", &settings, metadata.as_ref())
            .expect("encode TIFF");

        let mut decoder =
            tiff::decoder::Decoder::new(Cursor::new(&tiff_bytes)).expect("decode TIFF");
        assert_eq!(
            decoder
                .get_tag_u32_vec(tiff::tags::Tag::XResolution)
                .expect("XResolution tag"),
            vec![300, 1]
        );
        assert_eq!(
            decoder
                .get_tag_u8_vec(tiff::tags::Tag::IccProfile)
                .expect("ICC profile tag"),
            SRGB_ICC_PROFILE
        );
        let written = little_exif::metadata::Metadata::new_from_vec(
            &tiff_bytes,
            little_exif::filetype::FileExtension::TIFF,
        )
        .expect("read TIFF metadata");
        assert!(written.into_iter().any(|tag| matches!(
            tag,
            little_exif::exif_tag::ExifTag::Software(value) if value == "ThisIsRAW"
        )));
    }

    #[test]
    fn resize_preserves_synthetic_sixteen_bit_samples() {
        let source = DynamicImage::ImageRgba16(ImageBuffer::from_fn(4, 4, |x, y| {
            let value = 1000 + (x + y * 4) as u16 * 997;
            Rgba([value, value + 1, value + 2, u16::MAX])
        }));
        let mut settings: ExportSettings =
            serde_json::from_value(legacy_export_settings_json()).expect("settings");
        settings.resize = Some(ResizeOptions {
            mode: ResizeMode::Width,
            value: 3,
            dont_enlarge: false,
        });

        let resized = apply_export_resize_and_watermark(source, &settings).expect("resize");
        assert_eq!(resized.color(), ColorType::Rgba16);
        assert!(
            resized
                .to_rgba16()
                .pixels()
                .flat_map(|pixel| pixel.0[..3].iter().copied())
                .any(|sample| sample % 257 != 0)
        );
    }
}
