//! Tone-mapper names, their shader modes, the default for unedited images,
//! and the Natural tone curve.
//!
//! Natural renders RAW files the way Lightroom Classic's Adobe Standard
//! profile does at zero settings: one camera-independent curve, shaped like
//! Adobe's published default tone curve (the "ACR3" curve that Adobe
//! Standard profiles embed), extended over the decoder's highlight headroom
//! so bright skies roll off into white instead of clipping at linear 1.0.
//! Like Adobe's `RGBTone`, the curve is applied to the largest and smallest
//! channel in linear ProPhoto primaries and the middle channel is
//! interpolated between them, which keeps hue. Pixels whose every channel is
//! close to white blend toward neutral white.
//!
//! These constants are the single source of truth: the image shader receives
//! them through [`natural_wgsl_constants`], and the CPU path that renders
//! unedited thumbnails uses [`natural_tone_rgb`].

use std::sync::LazyLock;

use glam::{Mat3, Vec2, Vec3};
use image::DynamicImage;
use rayon::prelude::*;

pub const TONE_MAPPER_BASIC: &str = "basic";
pub const TONE_MAPPER_AGX: &str = "agx";
pub const TONE_MAPPER_NATURAL: &str = "natural";

pub const TONE_MAPPER_MODE_BASIC: u32 = 0;
pub const TONE_MAPPER_MODE_AGX: u32 = 1;
pub const TONE_MAPPER_MODE_NATURAL: u32 = 2;

/// Shader `tonemapper_mode` for a stored `toneMapper` name. Unknown names
/// render as Basic, as they always have.
pub fn tone_mapper_mode(name: &str) -> u32 {
    match name {
        TONE_MAPPER_AGX => TONE_MAPPER_MODE_AGX,
        TONE_MAPPER_NATURAL => TONE_MAPPER_MODE_NATURAL,
        _ => TONE_MAPPER_MODE_BASIC,
    }
}

/// Tone mapper for an image that has no edits yet. Edits saved without a
/// `toneMapper` key keep rendering as Basic; only unedited images use this.
pub fn default_tone_mapper(is_raw: bool) -> &'static str {
    if is_raw {
        TONE_MAPPER_NATURAL
    } else {
        TONE_MAPPER_BASIC
    }
}

/// Gives adjustments of an image without saved edits (`null`) the default
/// tone mapper explicitly, so the editor, presets and sidecars see it.
pub fn apply_default_tone_mapper(adjustments: &mut serde_json::Value, is_raw: bool) {
    let default = default_tone_mapper(is_raw);
    if adjustments.is_null() && default != TONE_MAPPER_BASIC {
        *adjustments = serde_json::json!({ "toneMapper": default });
    }
}

/// Scene-linear value that Natural maps to white. It matches the decoder's
/// default highlight headroom (`rawHighlightCompression`, 2.5).
pub const NATURAL_HEADROOM: f32 = 2.5;
/// Rational curve `x(x + B) / (x(Cx + D) + 1)`, normalised so that
/// `NATURAL_HEADROOM` maps to 1. Fitted (sRGB-encoded least squares) to
/// Adobe's default tone curve with the scene scaled by 1/1.6 (about -0.68 EV),
/// which puts scene mid-grey 0.18 at sRGB 130/255. Provisional until the fit
/// against Lightroom Classic reference exports (see docs/HANDOFF.md).
pub const NATURAL_CURVE_B: f32 = 0.071_452_37;
pub const NATURAL_CURVE_C: f32 = 6.436_48;
pub const NATURAL_CURVE_D: f32 = 0.906_852_5;
/// Tone-mapped value of the smallest channel at which a pixel starts to blend
/// toward neutral white; at 1.0 the blend is complete.
pub const NATURAL_WHITE_BLEND_START: f32 = 0.8;

const PRIMARIES_PROPHOTO: [Vec2; 3] = [
    Vec2::new(0.7347, 0.2653),
    Vec2::new(0.1596, 0.8404),
    Vec2::new(0.0366, 0.0001),
];

/// Linear sRGB (the pipeline space) to linear ProPhoto primaries, and back.
/// Both use the D65 white point so neutrals stay neutral.
static PIPE_TONE_MATRICES: LazyLock<(Mat3, Mat3)> = LazyLock::new(|| {
    let pipe_to_xyz = crate::image_processing::pipeline_rgb_to_xyz_matrix();
    let tone_to_xyz = crate::image_processing::primaries_to_xyz_matrix(
        &PRIMARIES_PROPHOTO,
        crate::image_processing::WP_D65,
    );
    let pipe_to_tone = tone_to_xyz.inverse() * pipe_to_xyz;
    (pipe_to_tone, pipe_to_tone.inverse())
});

fn natural_curve_unnormalised(x: f32) -> f32 {
    x * (x + NATURAL_CURVE_B) / (x * (NATURAL_CURVE_C * x + NATURAL_CURVE_D) + 1.0)
}

/// Natural tone curve on one scene-linear value: 0 maps to 0, the headroom
/// and everything above it maps to 1.
pub fn natural_curve(x: f32) -> f32 {
    let x = x.clamp(0.0, NATURAL_HEADROOM);
    natural_curve_unnormalised(x) / natural_curve_unnormalised(NATURAL_HEADROOM)
}

fn smoothstep(edge0: f32, edge1: f32, x: f32) -> f32 {
    let t = ((x - edge0) / (edge1 - edge0)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

/// Natural tone mapping of one linear pipeline-RGB pixel, returning linear
/// display RGB in `[0, 1]`. Mirrors `natural_tonemap` in `shader.wgsl`.
pub fn natural_tone_rgb(rgb: Vec3) -> Vec3 {
    let (pipe_to_tone, tone_to_pipe) = *PIPE_TONE_MATRICES;
    let tone = (pipe_to_tone * rgb.max(Vec3::ZERO)).max(Vec3::ZERO);
    let max_c = tone.max_element();
    let min_c = tone.min_element();
    let max_out = natural_curve(max_c);
    let min_out = natural_curve(min_c);
    let position = (tone - Vec3::splat(min_c)) / (max_c - min_c).max(1.0e-6);
    let toned = Vec3::splat(min_out) + (max_out - min_out) * position;
    let white_blend = smoothstep(NATURAL_WHITE_BLEND_START, 1.0, min_out);
    let toned = toned.lerp(Vec3::splat(max_out), white_blend);
    (tone_to_pipe * toned).clamp(Vec3::ZERO, Vec3::ONE)
}

/// CPU twin of the shader's Natural branch for RAW images, used where an
/// unedited RAW is rendered without the GPU (thumbnails). `exposure_ev` is
/// the file's compensation (`baseline_exposure::natural_exposure_ev`). The
/// result is sRGB-encoded, like the other CPU default renderings.
pub fn apply_cpu_natural_tonemap(image: &mut DynamicImage, exposure_ev: f32) {
    let exposure = exposure_ev.exp2();
    let mut f32_image = image.to_rgb32f();
    f32_image.par_chunks_mut(3).for_each(|pixel| {
        let toned = natural_tone_rgb(Vec3::new(pixel[0], pixel[1], pixel[2]) * exposure);
        pixel.copy_from_slice(&toned.to_array());
    });
    *image = crate::image_processing::apply_linear_to_srgb(DynamicImage::ImageRgb32F(f32_image));
}

fn wgsl_mat3(m: Mat3) -> String {
    let values: Vec<String> = m.to_cols_array().iter().map(|v| format!("{v:?}")).collect();
    format!("mat3x3<f32>({})", values.join(", "))
}

/// WGSL declarations of the Natural constants, prepended to `shader.wgsl`.
pub fn natural_wgsl_constants() -> String {
    let (pipe_to_tone, tone_to_pipe) = *PIPE_TONE_MATRICES;
    format!(
        "const TONE_MAPPER_MODE_AGX: u32 = {TONE_MAPPER_MODE_AGX}u;\n\
         const TONE_MAPPER_MODE_NATURAL: u32 = {TONE_MAPPER_MODE_NATURAL}u;\n\
         const NATURAL_HEADROOM: f32 = {NATURAL_HEADROOM:?};\n\
         const NATURAL_CURVE_B: f32 = {NATURAL_CURVE_B:?};\n\
         const NATURAL_CURVE_C: f32 = {NATURAL_CURVE_C:?};\n\
         const NATURAL_CURVE_D: f32 = {NATURAL_CURVE_D:?};\n\
         const NATURAL_WHITE_BLEND_START: f32 = {NATURAL_WHITE_BLEND_START:?};\n\
         const NATURAL_PIPE_TO_TONE: mat3x3<f32> = {};\n\
         const NATURAL_TONE_TO_PIPE: mat3x3<f32> = {};\n",
        wgsl_mat3(pipe_to_tone),
        wgsl_mat3(tone_to_pipe),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn srgb_8bit(linear: f32) -> f32 {
        let encoded = if linear <= 0.003_130_8 {
            linear * 12.92
        } else {
            1.055 * linear.powf(1.0 / 2.4) - 0.055
        };
        encoded * 255.0
    }

    #[test]
    fn tone_mapper_names_resolve_to_shader_modes() {
        assert_eq!(tone_mapper_mode(TONE_MAPPER_BASIC), TONE_MAPPER_MODE_BASIC);
        assert_eq!(tone_mapper_mode(TONE_MAPPER_AGX), TONE_MAPPER_MODE_AGX);
        assert_eq!(
            tone_mapper_mode(TONE_MAPPER_NATURAL),
            TONE_MAPPER_MODE_NATURAL
        );
        assert_eq!(tone_mapper_mode("unknown"), TONE_MAPPER_MODE_BASIC);
        assert_eq!(default_tone_mapper(true), TONE_MAPPER_NATURAL);
        assert_eq!(default_tone_mapper(false), TONE_MAPPER_BASIC);
    }

    #[test]
    fn default_tone_mapper_fills_only_unedited_raw_adjustments() {
        let mut unedited_raw = serde_json::Value::Null;
        apply_default_tone_mapper(&mut unedited_raw, true);
        assert_eq!(
            unedited_raw,
            serde_json::json!({ "toneMapper": TONE_MAPPER_NATURAL })
        );

        let mut unedited_jpeg = serde_json::Value::Null;
        apply_default_tone_mapper(&mut unedited_jpeg, false);
        assert!(unedited_jpeg.is_null());

        let mut legacy_edit = serde_json::json!({ "exposure": 0.5 });
        apply_default_tone_mapper(&mut legacy_edit, true);
        assert_eq!(legacy_edit, serde_json::json!({ "exposure": 0.5 }));
    }

    #[test]
    fn natural_curve_maps_black_and_headroom_to_the_ends() {
        assert_eq!(natural_curve(0.0), 0.0);
        assert_eq!(natural_curve(-1.0), 0.0);
        assert!((natural_curve(NATURAL_HEADROOM) - 1.0).abs() < 1.0e-6);
        assert_eq!(
            natural_curve(NATURAL_HEADROOM * 4.0),
            natural_curve(NATURAL_HEADROOM)
        );
    }

    #[test]
    fn natural_curve_is_monotonic_and_continuous() {
        let steps = 100_000;
        let step = (NATURAL_HEADROOM * 1.2) / steps as f32;
        let mut previous = natural_curve(0.0);
        for i in 1..=steps {
            let value = natural_curve(i as f32 * step);
            assert!(value >= previous, "curve falls at x = {}", i as f32 * step);
            assert!(
                value - previous < 0.001,
                "curve jumps at x = {}",
                i as f32 * step
            );
            previous = value;
        }
    }

    #[test]
    fn natural_curve_places_mid_grey_and_keeps_highlight_room() {
        assert!((srgb_8bit(natural_curve(0.18)) - 130.0).abs() < 1.0);
        // Scene white (1.0) stays below display white, so highlights do not clip.
        assert!(srgb_8bit(natural_curve(1.0)) < 245.0);
        // The shadow slope stays open instead of crushing toward black.
        assert!(natural_curve(0.01) > 0.005);
    }

    #[test]
    fn natural_tone_keeps_neutrals_neutral_and_hue_order() {
        for grey in [0.01, 0.18, 0.7, 2.0] {
            let toned = natural_tone_rgb(Vec3::splat(grey));
            assert!((toned.x - toned.y).abs() < 1.0e-4 && (toned.y - toned.z).abs() < 1.0e-4);
            assert!((toned.x - natural_curve(grey)).abs() < 1.0e-4);
        }
        let sky = natural_tone_rgb(Vec3::new(0.2, 0.35, 0.8));
        assert!(sky.z > sky.y && sky.y > sky.x);
    }

    #[test]
    fn natural_tone_blends_clipped_highlights_to_white() {
        let clipped = natural_tone_rgb(Vec3::new(2.4, 2.0, 2.2));
        assert!(clipped.min_element() > 0.98);
    }

    #[test]
    fn wgsl_constants_carry_the_rust_values() {
        let wgsl = natural_wgsl_constants();
        assert!(wgsl.contains(&format!(
            "const NATURAL_CURVE_C: f32 = {NATURAL_CURVE_C:?};"
        )));
        assert!(wgsl.contains("const NATURAL_PIPE_TO_TONE: mat3x3<f32> = mat3x3<f32>("));
    }
}
