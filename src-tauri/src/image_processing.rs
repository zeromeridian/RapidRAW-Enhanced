use std::sync::Arc;
use bytemuck::{Pod, Zeroable};
use image::{DynamicImage, GenericImageView, Rgba};
use imageproc::geometric_transformations::{rotate_about_center, Interpolation};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::f32::consts::PI;

pub use crate::gpu_processing::{get_or_init_gpu_context, process_and_get_dynamic_image};
use crate::{AppState, mask_generation::MaskDefinition};

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ImageMetadata {
    pub version: u32,
    pub rating: u8,
    pub adjustments: Value,
}

impl Default for ImageMetadata {
    fn default() -> Self {
        ImageMetadata {
            version: 1,
            rating: 0,
            adjustments: Value::Null,
        }
    }
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy)]
pub struct Crop {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

pub fn apply_rotation(image: &DynamicImage, rotation_degrees: f32) -> DynamicImage {
    if rotation_degrees % 360.0 == 0.0 {
        return image.clone();
    }

    let rgba_image = image.to_rgba8();
    
    let rotated = rotate_about_center(
        &rgba_image,
        rotation_degrees * PI / 180.0,
        Interpolation::Bilinear,
        Rgba([0u8, 0, 0, 0]),
    );

    DynamicImage::ImageRgba8(rotated)
}

pub fn apply_crop(mut image: DynamicImage, crop_value: &Value) -> DynamicImage {
    if crop_value.is_null() {
        return image;
    }
    if let Ok(crop) = serde_json::from_value::<Crop>(crop_value.clone()) {
        let x = crop.x.round() as u32;
        let y = crop.y.round() as u32;
        let width = crop.width.round() as u32;
        let height = crop.height.round() as u32;

        if width > 0 && height > 0 {
            let (img_w, img_h) = image.dimensions();
            if x < img_w && y < img_h {
                let new_width = (img_w - x).min(width);
                let new_height = (img_h - y).min(height);
                if new_width > 0 && new_height > 0 {
                    image = image.crop_imm(x, y, new_width, new_height);
                }
            }
        }
    }
    image
}


#[derive(Serialize, Deserialize, Debug, Clone, Copy, Pod, Zeroable, Default)]
#[repr(C)]
pub struct Point {
    x: f32,
    y: f32,
    _pad1: f32,
    _pad2: f32,
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, Pod, Zeroable, Default)]
#[repr(C)]
pub struct HslColor {
    hue: f32,
    saturation: f32,
    luminance: f32,
    _pad: f32,
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, Pod, Zeroable, Default)]
#[repr(C)]
pub struct GlobalAdjustments {
    pub exposure: f32,
    pub contrast: f32,
    pub highlights: f32,
    pub shadows: f32,
    pub whites: f32,
    pub blacks: f32,
    pub saturation: f32,
    pub temperature: f32,
    pub tint: f32,
    pub vibrance: f32,
    
    pub sharpness: f32,
    pub luma_noise_reduction: f32,
    pub color_noise_reduction: f32,
    pub clarity: f32,
    pub dehaze: f32,
    pub structure: f32,
    pub vignette_amount: f32,
    pub vignette_midpoint: f32,
    pub vignette_roundness: f32,
    pub vignette_feather: f32,
    pub grain_amount: f32,
    pub grain_size: f32,
    pub grain_roughness: f32,
    _pad1: f32,

    pub hsl: [HslColor; 8],
    pub luma_curve: [Point; 16],
    pub red_curve: [Point; 16],
    pub green_curve: [Point; 16],
    pub blue_curve: [Point; 16],
    pub luma_curve_count: u32,
    pub red_curve_count: u32,
    pub green_curve_count: u32,
    pub blue_curve_count: u32,
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, Pod, Zeroable, Default)]
#[repr(C)]
pub struct MaskAdjustments {
    pub exposure: f32,
    pub contrast: f32,
    pub highlights: f32,
    pub shadows: f32,
    pub whites: f32,
    pub blacks: f32,
    pub saturation: f32,
    pub temperature: f32,
    pub tint: f32,
    pub vibrance: f32,
    
    pub sharpness: f32,
    pub luma_noise_reduction: f32,
    pub color_noise_reduction: f32,
    pub clarity: f32,
    pub dehaze: f32,
    pub structure: f32,
    
    _pad1: f32,
    _pad2: f32,
    _pad3: f32,
    _pad4: f32,

    pub hsl: [HslColor; 8],
    pub luma_curve: [Point; 16],
    pub red_curve: [Point; 16],
    pub green_curve: [Point; 16],
    pub blue_curve: [Point; 16],
    pub luma_curve_count: u32,
    pub red_curve_count: u32,
    pub green_curve_count: u32,
    pub blue_curve_count: u32,
}

#[derive(Debug, Clone, Copy, Pod, Zeroable, Default)]
#[repr(C)]
pub struct AllAdjustments {
    pub global: GlobalAdjustments,
    pub mask_adjustments: [MaskAdjustments; 16],
    pub mask_count: u32,
    pub tile_offset_x: u32,
    pub tile_offset_y: u32,
    _pad1: u32,
}

struct AdjustmentScales {
    exposure: f32,
    contrast: f32,
    highlights: f32,
    shadows: f32,
    whites: f32,
    blacks: f32,
    saturation: f32,
    temperature: f32,
    tint: f32,
    vibrance: f32,
    
    sharpness: f32,
    luma_noise_reduction: f32,
    color_noise_reduction: f32,
    clarity: f32,
    dehaze: f32,
    structure: f32,

    vignette_amount: f32,
    vignette_midpoint: f32,
    vignette_roundness: f32,
    vignette_feather: f32,
    grain_amount: f32,
    grain_size: f32,
    grain_roughness: f32,

    hsl_hue_multiplier: f32,
    hsl_saturation: f32,
    hsl_luminance: f32,
}

const SCALES: AdjustmentScales = AdjustmentScales {
    exposure: 25.0,
    contrast: 500.0,
    highlights: 200.0,
    shadows: 2000.0,
    whites: 30.0,
    blacks: 800.0,
    saturation: 100.0,
    temperature: 50.0,
    tint: 250.0,
    vibrance: 100.0,
    
    sharpness: 20.0,
    luma_noise_reduction: 100.0,
    color_noise_reduction: 100.0,
    clarity: 200.0,
    dehaze: 1000.0,
    structure: 200.0,

    vignette_amount: 100.0,
    vignette_midpoint: 100.0,
    vignette_roundness: 100.0,
    vignette_feather: 100.0,
    grain_amount: 200.0,
    grain_size: 50.0,
    grain_roughness: 100.0,

    hsl_hue_multiplier: 0.3,
    hsl_saturation: 100.0,
    hsl_luminance: 100.0,
};

fn parse_hsl_adjustments(js_hsl: &serde_json::Value) -> [HslColor; 8] {
    let mut hsl_array = [HslColor::default(); 8];
    if let Some(hsl_map) = js_hsl.as_object() {
        let color_map = [
            ("reds", 0), ("oranges", 1), ("yellows", 2), ("greens", 3),
            ("aquas", 4), ("blues", 5), ("purples", 6), ("magentas", 7),
        ];
        for (name, index) in color_map.iter() {
            if let Some(color_data) = hsl_map.get(*name) {
                hsl_array[*index] = HslColor {
                    hue: color_data["hue"].as_f64().unwrap_or(0.0) as f32 * SCALES.hsl_hue_multiplier,
                    saturation: color_data["saturation"].as_f64().unwrap_or(0.0) as f32 / SCALES.hsl_saturation,
                    luminance: color_data["luminance"].as_f64().unwrap_or(0.0) as f32 / SCALES.hsl_luminance,
                    _pad: 0.0,
                };
            }
        }
    }
    hsl_array
}

fn convert_points_to_aligned(frontend_points: Vec<serde_json::Value>) -> [Point; 16] {
    let mut aligned_points = [Point::default(); 16];
    for (i, point) in frontend_points.iter().enumerate().take(16) {
        if let (Some(x), Some(y)) = (point["x"].as_f64(), point["y"].as_f64()) {
            aligned_points[i] = Point { x: x as f32, y: y as f32, _pad1: 0.0, _pad2: 0.0 };
        }
    }
    aligned_points
}

fn get_global_adjustments_from_json(js_adjustments: &serde_json::Value) -> GlobalAdjustments {
    if js_adjustments.is_null() {
        return GlobalAdjustments::default();
    }
    let curves_obj = js_adjustments.get("curves").cloned().unwrap_or_default();
    let luma_points: Vec<serde_json::Value> = curves_obj["luma"].as_array().cloned().unwrap_or_default();
    let red_points: Vec<serde_json::Value> = curves_obj["red"].as_array().cloned().unwrap_or_default();
    let green_points: Vec<serde_json::Value> = curves_obj["green"].as_array().cloned().unwrap_or_default();
    let blue_points: Vec<serde_json::Value> = curves_obj["blue"].as_array().cloned().unwrap_or_default();

    GlobalAdjustments {
        exposure: js_adjustments["exposure"].as_f64().unwrap_or(0.0) as f32 / SCALES.exposure,
        contrast: js_adjustments["contrast"].as_f64().unwrap_or(0.0) as f32 / SCALES.contrast,
        highlights: js_adjustments["highlights"].as_f64().unwrap_or(0.0) as f32 / SCALES.highlights,
        shadows: js_adjustments["shadows"].as_f64().unwrap_or(0.0) as f32 / SCALES.shadows,
        whites: js_adjustments["whites"].as_f64().unwrap_or(0.0) as f32 / SCALES.whites,
        blacks: js_adjustments["blacks"].as_f64().unwrap_or(0.0) as f32 / SCALES.blacks,
        saturation: js_adjustments["saturation"].as_f64().unwrap_or(0.0) as f32 / SCALES.saturation,
        temperature: js_adjustments["temperature"].as_f64().unwrap_or(0.0) as f32 / SCALES.temperature,
        tint: js_adjustments["tint"].as_f64().unwrap_or(0.0) as f32 / SCALES.tint,
        vibrance: js_adjustments["vibrance"].as_f64().unwrap_or(0.0) as f32 / SCALES.vibrance,
        sharpness: js_adjustments["sharpness"].as_f64().unwrap_or(0.0) as f32 / SCALES.sharpness,
        luma_noise_reduction: js_adjustments["lumaNoiseReduction"].as_f64().unwrap_or(0.0) as f32 / SCALES.luma_noise_reduction,
        color_noise_reduction: js_adjustments["colorNoiseReduction"].as_f64().unwrap_or(0.0) as f32 / SCALES.color_noise_reduction,
        clarity: js_adjustments["clarity"].as_f64().unwrap_or(0.0) as f32 / SCALES.clarity,
        dehaze: js_adjustments["dehaze"].as_f64().unwrap_or(0.0) as f32 / SCALES.dehaze,
        structure: js_adjustments["structure"].as_f64().unwrap_or(0.0) as f32 / SCALES.structure,
        vignette_amount: js_adjustments["vignetteAmount"].as_f64().unwrap_or(0.0) as f32 / SCALES.vignette_amount,
        vignette_midpoint: js_adjustments["vignetteMidpoint"].as_f64().unwrap_or(50.0) as f32 / SCALES.vignette_midpoint,
        vignette_roundness: js_adjustments["vignetteRoundness"].as_f64().unwrap_or(0.0) as f32 / SCALES.vignette_roundness,
        vignette_feather: js_adjustments["vignetteFeather"].as_f64().unwrap_or(50.0) as f32 / SCALES.vignette_feather,
        grain_amount: js_adjustments["grainAmount"].as_f64().unwrap_or(0.0) as f32 / SCALES.grain_amount,
        grain_size: js_adjustments["grainSize"].as_f64().unwrap_or(50.0) as f32 / SCALES.grain_size,
        grain_roughness: js_adjustments["grainRoughness"].as_f64().unwrap_or(50.0) as f32 / SCALES.grain_roughness,
        _pad1: 0.0,

        hsl: parse_hsl_adjustments(&js_adjustments.get("hsl").cloned().unwrap_or_default()),
        luma_curve: convert_points_to_aligned(luma_points.clone()),
        red_curve: convert_points_to_aligned(red_points.clone()),
        green_curve: convert_points_to_aligned(green_points.clone()),
        blue_curve: convert_points_to_aligned(blue_points.clone()),
        luma_curve_count: luma_points.len() as u32,
        red_curve_count: red_points.len() as u32,
        green_curve_count: green_points.len() as u32,
        blue_curve_count: blue_points.len() as u32,
    }
}

pub fn get_all_adjustments_from_json(js_adjustments: &serde_json::Value) -> AllAdjustments {
    let global = get_global_adjustments_from_json(js_adjustments);
    let mut mask_adjustments = [MaskAdjustments::default(); 16];
    let mut mask_count = 0;

    let mask_definitions: Vec<MaskDefinition> = js_adjustments.get("masks")
        .and_then(|m| serde_json::from_value(m.clone()).ok())
        .unwrap_or_else(Vec::new);

    for (i, mask_def) in mask_definitions.iter().filter(|m| m.visible).enumerate().take(16) {
        let adj = &mask_def.adjustments;
        let curves_obj = adj.get("curves").cloned().unwrap_or_default();
        let luma_points: Vec<serde_json::Value> = curves_obj["luma"].as_array().cloned().unwrap_or_default();
        let red_points: Vec<serde_json::Value> = curves_obj["red"].as_array().cloned().unwrap_or_default();
        let green_points: Vec<serde_json::Value> = curves_obj["green"].as_array().cloned().unwrap_or_default();
        let blue_points: Vec<serde_json::Value> = curves_obj["blue"].as_array().cloned().unwrap_or_default();

        mask_adjustments[i] = MaskAdjustments {
            exposure: adj["exposure"].as_f64().unwrap_or(0.0) as f32 / SCALES.exposure,
            contrast: adj["contrast"].as_f64().unwrap_or(0.0) as f32 / SCALES.contrast,
            highlights: adj["highlights"].as_f64().unwrap_or(0.0) as f32 / SCALES.highlights,
            shadows: adj["shadows"].as_f64().unwrap_or(0.0) as f32 / SCALES.shadows,
            whites: adj["whites"].as_f64().unwrap_or(0.0) as f32 / SCALES.whites,
            blacks: adj["blacks"].as_f64().unwrap_or(0.0) as f32 / SCALES.blacks,
            saturation: adj["saturation"].as_f64().unwrap_or(0.0) as f32 / SCALES.saturation,
            temperature: adj["temperature"].as_f64().unwrap_or(0.0) as f32 / SCALES.temperature,
            tint: adj["tint"].as_f64().unwrap_or(0.0) as f32 / SCALES.tint,
            vibrance: adj["vibrance"].as_f64().unwrap_or(0.0) as f32 / SCALES.vibrance,
            
            sharpness: adj["sharpness"].as_f64().unwrap_or(0.0) as f32 / SCALES.sharpness,
            luma_noise_reduction: adj["lumaNoiseReduction"].as_f64().unwrap_or(0.0) as f32 / SCALES.luma_noise_reduction,
            color_noise_reduction: adj["colorNoiseReduction"].as_f64().unwrap_or(0.0) as f32 / SCALES.color_noise_reduction,
            clarity: adj["clarity"].as_f64().unwrap_or(0.0) as f32 / SCALES.clarity,
            dehaze: adj["dehaze"].as_f64().unwrap_or(0.0) as f32 / SCALES.dehaze,
            structure: adj["structure"].as_f64().unwrap_or(0.0) as f32 / SCALES.structure,
            
            _pad1: 0.0, _pad2: 0.0, _pad3: 0.0, _pad4: 0.0,

            hsl: parse_hsl_adjustments(&adj.get("hsl").cloned().unwrap_or_default()),
            luma_curve: convert_points_to_aligned(luma_points.clone()),
            red_curve: convert_points_to_aligned(red_points.clone()),
            green_curve: convert_points_to_aligned(green_points.clone()),
            blue_curve: convert_points_to_aligned(blue_points.clone()),
            luma_curve_count: luma_points.len() as u32,
            red_curve_count: red_points.len() as u32,
            green_curve_count: green_points.len() as u32,
            blue_curve_count: blue_points.len() as u32,
        };
        mask_count += 1;
    }

    AllAdjustments {
        global,
        mask_adjustments,
        mask_count,
        tile_offset_x: 0,
        tile_offset_y: 0,
        _pad1: 0,
    }
}


#[derive(Clone)]
pub struct GpuContext {
    pub device: Arc<wgpu::Device>,
    pub queue: Arc<wgpu::Queue>,
    pub limits: wgpu::Limits,
}

#[derive(Serialize, Clone)]
pub struct HistogramData {
    red: Vec<u32>,
    green: Vec<u32>,
    blue: Vec<u32>,
    luma: Vec<u32>,
}

#[tauri::command]
pub fn generate_histogram(state: tauri::State<AppState>) -> Result<HistogramData, String> {
    let image = state.original_image.lock().unwrap().as_ref()
        .ok_or("No image loaded to generate histogram")?
        .image.clone();

    calculate_histogram_from_image(&image)
}

pub fn calculate_histogram_from_image(image: &DynamicImage) -> Result<HistogramData, String> {
    let preview = image.thumbnail(768, 768);
    
    let mut red = vec![0; 256];
    let mut green = vec![0; 256];
    let mut blue = vec![0; 256];
    let mut luma = vec![0; 256];

    for pixel in preview.to_rgb8().pixels() {
        let r = pixel[0] as usize;
        let g = pixel[1] as usize;
        let b = pixel[2] as usize;

        red[r] += 1;
        green[g] += 1;
        blue[b] += 1;

        let luma_val = (0.2126 * r as f32 + 0.7152 * g as f32 + 0.0722 * b as f32).round() as usize;
        let luma_idx = luma_val.min(255);
        
        luma[luma_idx] += 1;
    }

    apply_light_smoothing(&mut red);
    apply_light_smoothing(&mut green);
    apply_light_smoothing(&mut blue);
    apply_light_smoothing(&mut luma);

    normalize_histogram_range(&mut red, 0.75);
    normalize_histogram_range(&mut green, 0.75);
    normalize_histogram_range(&mut blue, 0.75);
    normalize_histogram_range(&mut luma, 0.75);

    Ok(HistogramData { red, green, blue, luma })
}

fn apply_light_smoothing(histogram: &mut Vec<u32>) {
    let original = histogram.clone();

    for i in 2..histogram.len() - 2 {
        let smoothed = (original[i - 2] as f32 * 0.1 + 
                       original[i - 1] as f32 * 0.2 + 
                       original[i] as f32 * 0.4 + 
                       original[i + 1] as f32 * 0.2 + 
                       original[i + 2] as f32 * 0.1).round() as u32;
        histogram[i] = smoothed;
    }
}

fn normalize_histogram_range(histogram: &mut Vec<u32>, max_range: f32) {
    if let Some(&max_val) = histogram.iter().max() {
        if max_val > 0 {
            let scale_factor = max_range;
            for value in histogram.iter_mut() {
                *value = (*value as f32 * scale_factor).round() as u32;
            }
        }
    }
}