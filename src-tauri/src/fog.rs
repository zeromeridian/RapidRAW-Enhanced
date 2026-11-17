//! Fog: a depth map, refined by a guided filter, turned into atmospheric haze tinted by the
//! scene's far colour, with patches, a height falloff and a glow around bright areas.
//! `prepare` reads the edit once for both versions: `encode` on the GPU (upstream `15a9ff2e`,
//! `shaders/fog.wgsl`, plus the fork's Fog Feather), `apply_on_cpu` as the fallback, for
//! thumbnails, and as the reference the GPU result is tested against.

use image::{DynamicImage, GenericImageView, GrayImage};
use rayon::prelude::*;
use std::borrow::Cow;
use std::hash::{Hash, Hasher};
use std::sync::Arc;

use crate::gpu_compute::{
    Bind, ComputeEncoder, F32X4, Grid, Group, IMAGE_FORMAT, Out, RGB_MODE, Slot,
};
use crate::relight::{RelightTap, build_guided_model, build_relight_guide, relight_luma};

pub const FOG_DEPTH_MAP_KEY: &str = "fogDepthMap";

pub const FOG_KEYS: &[&str] = &[
    "fogAmount",
    "fogStart",
    "fogFeather",
    "fogDensity",
    "fogHeight",
    "fogVariation",
    "fogGlow",
    "fogTemperature",
    "fogTint",
    FOG_DEPTH_MAP_KEY,
];

/// `build_guided_model`'s regularisation.
const GUIDE_EPS: f32 = 2.0e-3;
/// The disparity the nearest fog distance is measured from.
const NEAR: f32 = 0.1;
/// The longest side of the low-resolution copy the fog colour, scatter and glow come from.
const LOW_LONG_SIDE: f32 = 384.0;

/// How far past `start` the fog has risen: `max(0, x)` with the corner at 0
/// rounded over `±knee`, so the fog fades in instead of starting abruptly.
/// With `knee` 0 it is the plain ramp older edits render with. Mirrored in `fog.wgsl`.
#[inline(always)]
fn feathered_onset(x: f32, knee: f32) -> f32 {
    if x >= knee {
        x
    } else if x <= -knee {
        0.0
    } else {
        (x + knee) * (x + knee) / (4.0 * knee)
    }
}

#[inline(always)]
fn fog_hash(x: i32, y: i32) -> f32 {
    let mut h = (x as u32).wrapping_mul(0x8da6_b343) ^ (y as u32).wrapping_mul(0xd816_3841);
    h = (h ^ (h >> 13)).wrapping_mul(0x85eb_ca6b);
    h ^= h >> 16;
    h as f32 / u32::MAX as f32
}

fn fog_noise(x: f32, y: f32) -> f32 {
    let mut value = 0.0f32;
    let mut amplitude = 0.5f32;
    let mut frequency = 1.0f32;
    for octave in 0..4 {
        let (px, py) = (x * frequency + octave as f32 * 17.3, y * frequency);
        let (ix, iy) = (px.floor() as i32, py.floor() as i32);
        let (fx, fy) = (px - ix as f32, py - iy as f32);
        let (sx, sy) = (fx * fx * (3.0 - 2.0 * fx), fy * fy * (3.0 - 2.0 * fy));
        let top = fog_hash(ix, iy) + (fog_hash(ix + 1, iy) - fog_hash(ix, iy)) * sx;
        let bot = fog_hash(ix, iy + 1) + (fog_hash(ix + 1, iy + 1) - fog_hash(ix, iy + 1)) * sx;
        value += (top + (bot - top) * sy) * amplitude;
        amplitude *= 0.5;
        frequency *= 2.0;
    }
    value / 0.9375
}

fn fog_downsample(raw: &[f32], w: usize, h: usize, dw: usize, dh: usize) -> [Vec<f32>; 3] {
    let mut planes = [
        vec![0.0f32; dw * dh],
        vec![0.0f32; dw * dh],
        vec![0.0f32; dw * dh],
    ];
    let [r, g, b] = &mut planes;
    r.par_chunks_exact_mut(dw)
        .zip(g.par_chunks_exact_mut(dw))
        .zip(b.par_chunks_exact_mut(dw))
        .enumerate()
        .for_each(|(dy, ((r_row, g_row), b_row))| {
            let sy0 = dy * h / dh;
            let sy1 = ((dy + 1) * h / dh).clamp(sy0 + 1, h);
            for dx in 0..dw {
                let sx0 = dx * w / dw;
                let sx1 = ((dx + 1) * w / dw).clamp(sx0 + 1, w);
                let mut acc = [0.0f32; 3];
                for sy in sy0..sy1 {
                    for sx in sx0..sx1 {
                        let i = (sy * w + sx) * 3;
                        acc[0] += raw[i];
                        acc[1] += raw[i + 1];
                        acc[2] += raw[i + 2];
                    }
                }
                let inv = 1.0 / ((sy1 - sy0) * (sx1 - sx0)) as f32;
                r_row[dx] = acc[0] * inv;
                g_row[dx] = acc[1] * inv;
                b_row[dx] = acc[2] * inv;
            }
        });
    planes
}

fn fog_blur(planes: &mut [Vec<f32>; 3], w: usize, h: usize, radius: usize) {
    for plane in planes.iter_mut() {
        crate::lens_blur::dof_box_filter(plane, w, h, 1, radius);
        crate::lens_blur::dof_box_filter(plane, w, h, 1, radius);
    }
}

/// The size of the low-resolution copy of an image of `(w, h)`.
fn low_size((w, h): (u32, u32)) -> (u32, u32) {
    let scale = (LOW_LONG_SIDE / w.max(h) as f32).min(1.0);
    (
        ((w as f32 * scale).round() as u32).max(2),
        ((h as f32 * scale).round() as u32).max(2),
    )
}

/// The guided filter's radius on a depth map of `(dw, dh)`.
fn guide_radius((dw, dh): (u32, u32)) -> u32 {
    ((dw.max(dh) as f32 * 0.01).round() as u32).max(2)
}

/// The radii of the scatter (`soft`) and glow blurs on the low-resolution copy.
fn low_blur_radii((lw, lh): (u32, u32)) -> (u32, u32) {
    let long = lw.max(lh) as f32;
    (
        ((long * 0.02).round() as u32).max(1),
        ((long * 0.06).round() as u32).max(1),
    )
}

/// A fog read from an edit for an image of one size.
pub struct Fog {
    depth_map: Arc<GrayImage>,
    map_key: u64,
    /// The tint's RGB, then its luma.
    tint: [f32; 4],
    amount: f32,
    start: f32,
    /// Half-width of Fog Feather's rounded onset (`feathered_onset`).
    knee: f32,
    density: f32,
    height: f32,
    variation: f32,
    glow: f32,
    orientation: u32,
    flip_h: bool,
    flip_v: bool,
    display_aspect: f32,
}

/// The fog `adjustments` ask for on an image of `(w, h)`, or `None` when it would leave the
/// image unchanged.
pub fn prepare(adjustments: &serde_json::Value, (w, h): (u32, u32)) -> Option<Fog> {
    if !crate::adjustment_utils::is_tool_enabled(adjustments, "fog", "fogEnabled") {
        return None;
    }
    let depth_b64 = adjustments[FOG_DEPTH_MAP_KEY]
        .as_str()
        .filter(|map| !map.is_empty())?;

    let get = |key: &str, default: f64| {
        (adjustments[key].as_f64().unwrap_or(default) as f32 / 100.0).clamp(0.0, 1.0)
    };
    let amount = get("fogAmount", 50.0);
    if amount <= 0.0 {
        return None;
    }
    let depth_map = crate::effect_maps::resolve_luma_map(depth_b64, adjustments)?;
    if depth_map.width() < 2 || depth_map.height() < 2 || w < 2 || h < 2 {
        return None;
    }

    let temperature = adjustments["fogTemperature"].as_f64().unwrap_or(0.0) as f32 / 100.0;
    let tint_shift = adjustments["fogTint"].as_f64().unwrap_or(0.0) as f32 / 100.0;
    let tint = [
        1.0 + 0.45 * temperature + 0.15 * tint_shift,
        1.0 - 0.35 * tint_shift,
        1.0 - 0.45 * temperature + 0.15 * tint_shift,
    ]
    .map(|c| c.max(0.0));
    let orientation = (adjustments["orientationSteps"].as_u64().unwrap_or(0) % 4) as u32;

    Some(Fog {
        map_key: crate::effect_maps::effect_map_key(depth_b64, adjustments),
        depth_map,
        tint: [tint[0], tint[1], tint[2], plain_luma(tint).max(1e-3)],
        amount,
        start: get("fogStart", 0.0).min(0.99),
        knee: get("fogFeather", 0.0) * 0.5,
        density: 0.5 + get("fogDensity", 50.0) * 7.5,
        height: get("fogHeight", 0.0) * 6.0,
        variation: get("fogVariation", 25.0),
        glow: get("fogGlow", 25.0) * 1.5,
        orientation,
        flip_h: adjustments["flipHorizontal"].as_bool().unwrap_or(false),
        flip_v: adjustments["flipVertical"].as_bool().unwrap_or(false),
        display_aspect: if orientation % 2 == 1 {
            h as f32 / w as f32
        } else {
            w as f32 / h as f32
        },
    })
}

fn plain_luma(c: [f32; 3]) -> f32 {
    0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}

impl Fog {
    /// Identifies what this fog does, for `RenderSource::key`.
    pub fn hash_into(&self, hasher: &mut impl Hasher) {
        self.map_key.hash(hasher);
        (self.orientation, self.flip_h, self.flip_v).hash(hasher);
        for value in self.tint.into_iter().chain([
            self.amount,
            self.start,
            self.knee,
            self.density,
            self.height,
            self.variation,
            self.glow,
            self.display_aspect,
        ]) {
            value.to_bits().hash(hasher);
        }
    }

    /// Where `(u, v)` (0–1 in the unrotated image) lands once oriented and flipped.
    fn to_display(&self, u: f32, v: f32) -> (f32, f32) {
        let (mut x, mut y) = match self.orientation {
            1 => (1.0 - v, u),
            2 => (1.0 - u, 1.0 - v),
            3 => (v, 1.0 - u),
            _ => (u, v),
        };
        if self.flip_h {
            x = 1.0 - x;
        }
        if self.flip_v {
            y = 1.0 - y;
        }
        (x, y)
    }

    /// The fog on the CPU, on an image of the size it was prepared for.
    pub fn apply_on_cpu<'a>(&self, image: Cow<'a, DynamicImage>) -> Cow<'a, DynamicImage> {
        let start_time = std::time::Instant::now();
        let (w, h) = image.dimensions();
        let (dw, dh) = (
            self.depth_map.width() as usize,
            self.depth_map.height() as usize,
        );
        let (wu, hu) = (w as usize, h as usize);
        let mut out = image.into_owned().into_rgb32f();

        let disparity: Vec<f32> = self
            .depth_map
            .pixels()
            .map(|p| p[0] as f32 / 255.0)
            .collect();
        let guide = build_relight_guide(out.as_raw(), wu, hu, dw, dh);
        let radius = guide_radius((dw as u32, dh as u32)) as usize;
        let model = build_guided_model(&guide, &disparity, dw, dh, radius, GUIDE_EPS);

        let noise: Vec<f32> = (0..dw * dh)
            .into_par_iter()
            .map(|i| {
                let (x, y) = self.to_display(
                    ((i % dw) as f32 + 0.5) / dw as f32,
                    ((i / dw) as f32 + 0.5) / dh as f32,
                );
                fog_noise(x * 3.0 * self.display_aspect, y * 8.0)
            })
            .collect();

        let (lw, lh) = low_size((w, h));
        let (soft_radius, bloom_radius) = low_blur_radii((lw, lh));
        let (lw, lh) = (lw as usize, lh as usize);
        let low = fog_downsample(out.as_raw(), wu, hu, lw, lh);

        let (far_sum, far_weight, mean_sum) = (0..lw * lh)
            .into_par_iter()
            .map(|i| {
                let tap = RelightTap::new(
                    ((i % lw) as f32 + 0.5) / lw as f32,
                    ((i / lw) as f32 + 0.5) / lh as f32,
                    dw,
                    dh,
                );
                let weight = ((0.3 - tap.sample(&disparity)) / 0.3).clamp(0.0, 1.0);
                let rgb = [low[0][i], low[1][i], low[2][i]];
                (rgb.map(|c| c * weight), weight, rgb)
            })
            .reduce(
                || ([0.0; 3], 0.0, [0.0; 3]),
                |a, b| {
                    (
                        [a.0[0] + b.0[0], a.0[1] + b.0[1], a.0[2] + b.0[2]],
                        a.1 + b.1,
                        [a.2[0] + b.2[0], a.2[1] + b.2[1], a.2[2] + b.2[2]],
                    )
                },
            );
        let mean_rgb = mean_sum.map(|c| c / (lw * lh) as f32);
        let far_rgb = if far_weight > 1.0 {
            far_sum.map(|c| c / far_weight)
        } else {
            mean_rgb
        };
        let far_luma = plain_luma(far_rgb).max(1e-4);
        let atmosphere = far_luma.max(plain_luma(mean_rgb));
        let fog_rgb = [0, 1, 2].map(|c| {
            let chroma = far_rgb[c].max(0.0) / far_luma;
            (chroma + (1.0 - chroma) * 0.4) * atmosphere * self.tint[c] / self.tint[3]
        });

        let mut soft = low.clone();
        fog_blur(&mut soft, lw, lh, soft_radius as usize);

        let glow = self.glow;
        let mut bloom = low;
        if glow > 0.0 {
            let [bloom_r, bloom_g, bloom_b] = &mut bloom;
            bloom_r
                .par_iter_mut()
                .zip(bloom_g.par_iter_mut())
                .zip(bloom_b.par_iter_mut())
                .for_each(|((r, g), b)| {
                    let l = plain_luma([*r, *g, *b]);
                    let t = ((l - atmosphere * 0.8) / (atmosphere * 1.7)).clamp(0.0, 1.0);
                    let k = t * t * (3.0 - 2.0 * t);
                    *r *= k;
                    *g *= k;
                    *b *= k;
                });
            fog_blur(&mut bloom, lw, lh, bloom_radius as usize);
        }

        let z_near = 1.0 / (1.0 + NEAR);
        let z_range = 1.0 / NEAR - z_near;
        let norm = 1.0 - (-self.density).exp();

        out.par_chunks_exact_mut(wu * 3)
            .enumerate()
            .for_each(|(y, row)| {
                let v = (y as f32 + 0.5) / h as f32;
                for x in 0..wu {
                    let i = x * 3;
                    let u = (x as f32 + 0.5) / w as f32;
                    let depth_tap = RelightTap::new(u, v, dw, dh);
                    let d = depth_tap
                        .guided(&model, relight_luma(row[i], row[i + 1], row[i + 2]))
                        .clamp(0.0, 1.0);
                    let distance = (1.0 / (d + NEAR) - z_near) / z_range;
                    let t = (feathered_onset(distance - self.start, self.knee)
                        / (1.0 - self.start))
                        .clamp(0.0, 1.0);

                    let up = 1.0 - self.to_display(u, v).1;
                    let patches = (1.0
                        + 1.6 * self.variation * (depth_tap.sample(&noise) * 2.0 - 1.0))
                        .max(0.0);
                    let optical = self.density * t * (-self.height * up).exp() * patches;
                    let fog = (self.amount * (1.0 - (-optical).exp()) / norm).clamp(0.0, 1.0);
                    if fog <= 0.0 {
                        continue;
                    }

                    let low_tap = RelightTap::new(u, v, lw, lh);
                    for c in 0..3 {
                        let scattered = fog_rgb[c] + (low_tap.sample(&soft[c]) - fog_rgb[c]) * 0.35;
                        let halo = if glow > 0.0 {
                            low_tap.sample(&bloom[c]) * glow
                        } else {
                            0.0
                        };
                        row[i + c] = row[i + c] * (1.0 - fog) + (scattered + halo) * fog;
                    }
                }
            });

        log::info!("fog ({}x{}) took {:.2?}", w, h, start_time.elapsed());

        Cow::Owned(DynamicImage::ImageRgb32F(out))
    }
}

/// The parameters of every stage in `shaders/fog.wgsl` (its `Params`).
#[repr(C)]
#[derive(Debug, Default, Copy, Clone, bytemuck::Pod, bytemuck::Zeroable)]
struct Params {
    grid: Grid,
    tint: [f32; 4],
    amount: f32,
    start: f32,
    density: f32,
    height: f32,
    variation: f32,
    glow: f32,
    display_aspect: f32,
    norm: f32,
    near: f32,
    z_near: f32,
    z_range: f32,
    knee: f32,
    orientation: u32,
    flip_h: u32,
    flip_v: u32,
    _pad: u32,
    depth_size: [u32; 2],
    low_size: [u32; 2],
}

/// The fog on the GPU from `src` into `dst` (`IMAGE_FORMAT`, the same size), the steps of
/// `apply_on_cpu` in the same order.
pub fn encode(enc: &mut ComputeEncoder, job: &Fog, src: &Slot, dst: &Slot) {
    let full = src.size;
    let depth_size = job.depth_map.dimensions();
    let low_size = low_size(full);
    let (soft_radius, bloom_radius) = low_blur_radii(low_size);
    let z_near = 1.0 / (1.0 + NEAR);
    let params = Params {
        grid: Grid::new(full),
        tint: job.tint,
        amount: job.amount,
        start: job.start,
        density: job.density,
        height: job.height,
        variation: job.variation,
        glow: job.glow,
        display_aspect: job.display_aspect,
        norm: 1.0 - (-job.density).exp(),
        near: NEAR,
        z_near,
        z_range: 1.0 / NEAR - z_near,
        knee: job.knee,
        orientation: job.orientation,
        flip_h: job.flip_h as u32,
        flip_v: job.flip_v as u32,
        _pad: 0,
        depth_size: [depth_size.0, depth_size.1],
        low_size: [low_size.0, low_size.1],
    };
    let at = |size: (u32, u32)| Params {
        grid: Grid::new(size),
        ..params
    };

    // The depth refined by the photo (`build_guided_model`).
    let disparity = enc.cached_map("Fog Disparity", job.map_key, depth_size, || {
        job.depth_map
            .pixels()
            .map(|p| p[0] as f32 / 255.0)
            .collect()
    });
    let guide = enc.area_down(src, depth_size, 0);
    let model = enc.guided_model(&guide, &disparity, guide_radius(depth_size), GUIDE_EPS);
    drop(guide);

    let noise = enc.texture("Fog Noise", depth_size, F32X4);
    enc.run(
        Group::Fog,
        "fog_noise_map",
        &at(depth_size),
        depth_size,
        Out::F32(&noise.view),
        Bind::reading(&[]),
    );

    // The fog colour from the low-resolution copy, into `stats`.
    let low = enc.area_down(src, low_size, RGB_MODE);
    let stats = enc.buffer("Fog Stats", bytemuck::cast_slice(&[0u32; 4]));
    enc.run(
        Group::Fog,
        "fog_stats",
        &params,
        low_size,
        Out::None,
        Bind::reading(&[&low.view, &disparity.view])
            .with_scratch(&stats)
            .with_groups((1, 1)),
    );

    let bloom = (job.glow > 0.0).then(|| {
        let prepared = enc.texture("Fog Bloom", low_size, F32X4);
        enc.run(
            Group::Fog,
            "fog_bloom",
            &at(low_size),
            low_size,
            Out::F32(&prepared.view),
            Bind::reading(&[&low.view]).with_scratch(&stats),
        );
        enc.blur(prepared, bloom_radius, 2, 0)
    });
    let soft = enc.blur(low, soft_radius, 2, 0);

    debug_assert_eq!(dst.size, full);
    debug_assert_eq!(dst.texture.format(), IMAGE_FORMAT);
    enc.run(
        Group::Fog,
        "fog_apply",
        &params,
        full,
        Out::F16(&dst.view),
        Bind::reading(&[
            &src.view,
            &model.view,
            &noise.view,
            &soft.view,
            &bloom.as_ref().unwrap_or(&soft).view,
        ])
        .with_scratch(&stats),
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn params_match_the_shader() {
        let module = crate::gpu_compute::group_module(Group::Fog);
        assert_eq!(
            crate::gpu_compute::struct_span(&module, "Params"),
            size_of::<Params>()
        );
    }

    #[test]
    fn feathered_onset_without_feather_is_the_plain_ramp() {
        for x in [-0.5f32, -0.01, 0.0, 0.01, 0.3, 1.0] {
            assert_eq!(feathered_onset(x, 0.0), x.max(0.0));
        }
    }

    #[test]
    fn feathered_onset_rounds_the_corner_and_rejoins_the_ramp() {
        let knee = 0.2;
        assert_eq!(feathered_onset(-0.2, knee), 0.0);
        assert!(feathered_onset(-0.1, knee) > 0.0);
        assert!((feathered_onset(0.0, knee) - 0.05).abs() < 1e-6);
        assert_eq!(feathered_onset(0.2, knee), 0.2);
        assert_eq!(feathered_onset(0.5, knee), 0.5);
        let mut previous = 0.0;
        for i in 0..=40 {
            let value = feathered_onset(-0.2 + i as f32 * 0.01, knee);
            assert!(value >= previous);
            previous = value;
        }
    }
}
