//! Relight: point, spot and directional lights shading a surface (an AI normal map with its
//! depth, refined by guided filters on the photo), with soft shadows marched over the depth.
//! `prepare` reads the edit once for both versions: `encode` on the GPU (upstream `15a9ff2e`,
//! `shaders/relight.wgsl`), `apply_on_cpu` as the fallback, for thumbnails and the Before view,
//! and as the reference the GPU result is tested against.

use image::{DynamicImage, GenericImageView, RgbaImage};
use rayon::prelude::*;
use std::borrow::Cow;
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::sync::{Arc, Mutex};

use crate::gpu_compute::{Bind, ComputeEncoder, F32X4, Grid, Group, IMAGE_FORMAT, Out, Slot, Tex};

#[derive(Clone)]
struct RelightCache {
    key: u64,
    nw: usize,
    nh: usize,
    surface_models: Arc<Vec<(Vec<f32>, Vec<f32>)>>,
    shadow_inputs: Option<Arc<ShadowInputs>>,
    shadow_models: Vec<(u64, Arc<GuidedModel>)>,
}

static RELIGHT_CACHE: Mutex<Option<RelightCache>> = Mutex::new(None);

pub const RELIGHT_NORMAL_MAP_KEY: &str = "relightNormalMap";

pub const RELIGHT_KEYS: &[&str] = &[
    "relightLights",
    "relightAmbient",
    "relightSoftness",
    "relightShine",
    "relightShadows",
    "relightShadowSoftness",
    RELIGHT_NORMAL_MAP_KEY,
];

/// The guided filters' regularisation.
const EPS: f32 = 2.0e-3;
/// The longest side of the depth the shadows are marched over.
const SHADOW_LONG_SIDE: f32 = 2048.0;
/// A light's kind in its GPU data (`relight.wgsl`).
const POINT: f32 = 0.0;
const SPOT: f32 = 1.0;
const DIRECTIONAL: f32 = 2.0;

enum RelightKind {
    Point,
    Spot {
        beam: [f32; 3],
        outer: f32,
        inner: f32,
    },
    Directional {
        dir: [f32; 3],
    },
}

struct RelightLight {
    kind: RelightKind,
    pos: [f32; 3],
    color: [f32; 3],
    radius2: f32,
}

impl RelightLight {
    /// The light as `relight.wgsl` reads it from `data`: four vec4 (kind and position;
    /// colour and squared radius; direction or beam and the cone's outer cosine; its inner).
    fn to_gpu(&self) -> [f32; 16] {
        let (kind, vector, outer, inner) = match self.kind {
            RelightKind::Point => (POINT, [0.0; 3], 0.0, 0.0),
            RelightKind::Spot { beam, outer, inner } => (SPOT, beam, outer, inner),
            RelightKind::Directional { dir } => (DIRECTIONAL, dir, 0.0, 0.0),
        };
        let [x, y, z] = self.pos;
        let [r, g, b] = self.color;
        let [vx, vy, vz] = vector;
        [
            kind,
            x,
            y,
            z,
            r,
            g,
            b,
            self.radius2,
            vx,
            vy,
            vz,
            outer,
            inner,
            0.0,
            0.0,
            0.0,
        ]
    }
}

#[inline(always)]
fn relight_smoothstep(e0: f32, e1: f32, x: f32) -> f32 {
    let t = ((x - e0) / (e1 - e0).max(1e-6)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

#[inline(always)]
pub(crate) fn relight_luma(r: f32, g: f32, b: f32) -> f32 {
    (0.2126 * r + 0.7152 * g + 0.0722 * b).max(0.0).sqrt()
}

pub(crate) struct RelightTap {
    i00: usize,
    i10: usize,
    i01: usize,
    i11: usize,
    wx: f32,
    wy: f32,
}

impl RelightTap {
    #[inline(always)]
    pub(crate) fn new(u: f32, v: f32, w: usize, h: usize) -> Self {
        let fx = (u * w as f32 - 0.5).clamp(0.0, (w - 1) as f32);
        let fy = (v * h as f32 - 0.5).clamp(0.0, (h - 1) as f32);
        let (x0, y0) = (fx.floor() as usize, fy.floor() as usize);
        let (x1, y1) = ((x0 + 1).min(w - 1), (y0 + 1).min(h - 1));
        Self {
            i00: y0 * w + x0,
            i10: y0 * w + x1,
            i01: y1 * w + x0,
            i11: y1 * w + x1,
            wx: fx - x0 as f32,
            wy: fy - y0 as f32,
        }
    }

    #[inline(always)]
    pub(crate) fn sample(&self, buf: &[f32]) -> f32 {
        let top = buf[self.i00] + (buf[self.i10] - buf[self.i00]) * self.wx;
        let bot = buf[self.i01] + (buf[self.i11] - buf[self.i01]) * self.wx;
        top + (bot - top) * self.wy
    }

    #[inline(always)]
    pub(crate) fn guided(&self, model: &(Vec<f32>, Vec<f32>), guide: f32) -> f32 {
        self.sample(&model.0) * guide + self.sample(&model.1)
    }
}

pub(crate) fn build_relight_guide(
    raw: &[f32],
    w: usize,
    h: usize,
    dw: usize,
    dh: usize,
) -> Vec<f32> {
    let mut guide = vec![0.0f32; dw * dh];
    guide
        .par_chunks_exact_mut(dw)
        .enumerate()
        .for_each(|(dy, row)| {
            let sy0 = dy * h / dh;
            let sy1 = ((dy + 1) * h / dh).clamp(sy0 + 1, h);
            for (dx, out) in row.iter_mut().enumerate() {
                let sx0 = dx * w / dw;
                let sx1 = ((dx + 1) * w / dw).clamp(sx0 + 1, w);
                let mut acc = 0.0f32;
                for sy in sy0..sy1 {
                    for sx in sx0..sx1 {
                        let i = (sy * w + sx) * 3;
                        acc += relight_luma(raw[i], raw[i + 1], raw[i + 2]);
                    }
                }
                *out = acc / ((sy1 - sy0) * (sx1 - sx0)) as f32;
            }
        });
    guide
}

pub(crate) struct GuideStats {
    radius: usize,
    mean_i: Vec<f32>,
    var_i: Vec<f32>,
}

impl GuideStats {
    pub(crate) fn new(guide: &[f32], w: usize, h: usize, radius: usize) -> Self {
        let mut mean_i = guide.to_vec();
        crate::lens_blur::dof_box_filter(&mut mean_i, w, h, 1, radius);
        let mut var_i: Vec<f32> = guide.iter().map(|g| g * g).collect();
        crate::lens_blur::dof_box_filter(&mut var_i, w, h, 1, radius);
        var_i
            .par_iter_mut()
            .zip(mean_i.par_iter())
            .for_each(|(v, m)| *v = (*v - m * m).max(0.0));
        Self {
            radius,
            mean_i,
            var_i,
        }
    }
}

pub(crate) fn build_guided_model(
    guide: &[f32],
    p: &[f32],
    w: usize,
    h: usize,
    radius: usize,
    eps: f32,
) -> (Vec<f32>, Vec<f32>) {
    let stats = GuideStats::new(guide, w, h, radius);
    build_guided_model_with(&stats, guide, p, w, h, eps)
}

pub(crate) fn build_guided_model_with(
    stats: &GuideStats,
    guide: &[f32],
    p: &[f32],
    w: usize,
    h: usize,
    eps: f32,
) -> (Vec<f32>, Vec<f32>) {
    let box_mean = |mut buf: Vec<f32>| {
        crate::lens_blur::dof_box_filter(&mut buf, w, h, 1, stats.radius);
        buf
    };

    let mean_p = box_mean(p.to_vec());
    let corr_ip = box_mean(guide.iter().zip(p).map(|(g, q)| g * q).collect());

    let (a, b): (Vec<f32>, Vec<f32>) = (0..w * h)
        .into_par_iter()
        .map(|i| {
            let mean_i = stats.mean_i[i];
            let a = (corr_ip[i] - mean_i * mean_p[i]) / (stats.var_i[i] + eps);
            (a, mean_p[i] - a * mean_i)
        })
        .unzip();

    (box_mean(a), box_mean(b))
}

/// The guided filter's radius on a normal map of `(nw, nh)`.
fn map_radius((nw, nh): (u32, u32)) -> u32 {
    ((nw.max(nh) as f32 * 0.006).round() as u32).max(2)
}

/// The size of the depth the shadows of an image of `(w, h)` are marched over.
fn shadow_size((w, h): (u32, u32)) -> (u32, u32) {
    let scale = (SHADOW_LONG_SIDE / w.max(h) as f32).min(1.0);
    (
        ((w as f32 * scale).round() as u32).max(2),
        ((h as f32 * scale).round() as u32).max(2),
    )
}

/// The guided filter's radius on shadows of `(sw, sh)`.
fn shadow_radius((sw, sh): (u32, u32)) -> u32 {
    ((sw.max(sh) as f32 * 0.003).round() as u32).max(2)
}

/// The radius of the two box blurs that soften shadows of `(sw, sh)`.
fn shadow_blur_radius((sw, sh): (u32, u32), shadow_softness: f32) -> u32 {
    (shadow_softness * sw.max(sh) as f32 * 0.02).round() as u32
}

/// A normal map pixel as the surface's normal (x, y, z) and depth.
fn surface_values(p: &image::Rgba<u8>) -> [f32; 4] {
    [
        p[0] as f32 / 127.5 - 1.0,
        1.0 - p[1] as f32 / 127.5,
        1.0 - p[2] as f32 / 127.5,
        p[3] as f32 / 255.0,
    ]
}

struct ShadowInputs {
    guide: Vec<f32>,
    depth: Vec<f32>,
    depth_range: [f32; 2],
    stats: GuideStats,
}

type GuidedModel = (Vec<f32>, Vec<f32>);

fn shadow_key(light: &RelightLight, shadow_softness: f32) -> u64 {
    let mut hasher = DefaultHasher::new();
    shadow_softness.to_bits().hash(&mut hasher);
    match light.kind {
        RelightKind::Directional { dir } => {
            0u8.hash(&mut hasher);
            dir.map(f32::to_bits).hash(&mut hasher);
        }
        _ => {
            1u8.hash(&mut hasher);
            light.pos.map(f32::to_bits).hash(&mut hasher);
        }
    }
    hasher.finish()
}

fn build_shadow_map(
    depth: &[f32],
    depth_range: [f32; 2],
    sw: usize,
    sh: usize,
    aspect: [f32; 2],
    light: &RelightLight,
    shadow_softness: f32,
) -> Vec<f32> {
    let mut shadow = vec![1.0f32; sw * sh];
    let (swf, shf) = (sw as f32, sh as f32);
    let z_lo = depth_range[0] + 0.01;
    let z_hi = depth_range[1] + 0.3;

    shadow
        .par_chunks_exact_mut(sw)
        .enumerate()
        .for_each(|(y, row)| {
            let v = (y as f32 + 0.5) / shf;
            let depth_row = &depth[y * sw..(y + 1) * sw];
            for (x, out) in row.iter_mut().enumerate() {
                let u = (x as f32 + 0.5) / swf;
                let p = [(u - 0.5) * aspect[0], (v - 0.5) * aspect[1], depth_row[x]];
                let ray = match light.kind {
                    RelightKind::Directional { dir } => {
                        let planar = (dir[0] * dir[0] + dir[1] * dir[1]).sqrt();
                        let len = (0.5 / planar.max(1e-3)).min(2.0);
                        [dir[0] * len, dir[1] * len, dir[2] * len]
                    }
                    _ => [
                        light.pos[0] - p[0],
                        light.pos[1] - p[1],
                        light.pos[2] - p[2],
                    ],
                };

                let (fx0, fy0) = (u * swf, v * shf);
                let (dx, dy) = (ray[0] / aspect[0] * swf, ray[1] / aspect[1] * shf);
                let rising = ray[2] >= 0.0;

                let jitter = (52.982_918
                    * (0.067_110_56 * x as f32 + 0.005_837_15 * y as f32).fract())
                .fract();
                let mut occlusion = 0.0f32;
                for k in 1..=64 {
                    let t = (k as f32 - jitter) * (1.0 / 64.0);
                    let fx = fx0 + dx * t;
                    let fy = fy0 + dy * t;
                    if !(0.0..swf).contains(&fx) || !(0.0..shf).contains(&fy) {
                        break;
                    }
                    let rz = p[2] + ray[2] * t;
                    if (rising && rz >= z_hi) || (!rising && rz <= z_lo) {
                        break;
                    }
                    let diff = rz - depth[fy as usize * sw + fx as usize];
                    if diff <= 0.01 || diff >= 0.3 {
                        continue;
                    }
                    occlusion = occlusion.max(
                        relight_smoothstep(0.01, 0.04, diff)
                            * (1.0 - relight_smoothstep(0.15, 0.3, diff)),
                    );
                    if occlusion >= 1.0 {
                        break;
                    }
                }
                *out = 1.0 - occlusion;
            }
        });

    let radius = shadow_blur_radius((sw as u32, sh as u32), shadow_softness) as usize;
    crate::lens_blur::dof_box_filter(&mut shadow, sw, sh, 1, radius);
    crate::lens_blur::dof_box_filter(&mut shadow, sw, sh, 1, radius);
    shadow
}

fn parse_light(l: &serde_json::Value, aspect: [f32; 2]) -> RelightLight {
    let get = |key: &str, default: f64| l[key].as_f64().unwrap_or(default) as f32;
    let temperature = get("temperature", 0.0) / 100.0;
    let tint = get("tint", 0.0) / 100.0;
    let base = l["color"]
        .as_str()
        .and_then(|c| u32::from_str_radix(c.trim_start_matches('#'), 16).ok())
        .map(|hex| [hex >> 16, hex >> 8, hex].map(|c| ((c & 255) as f32 / 255.0).powf(2.2)))
        .unwrap_or([1.0; 3]);
    let rgb = [
        base[0] * (1.0 + 0.45 * temperature + 0.15 * tint),
        base[1] * (1.0 - 0.35 * tint),
        base[2] * (1.0 - 0.45 * temperature + 0.15 * tint),
    ];
    let luma = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
    let strength = get("intensity", 60.0).max(0.0) / 100.0 * 4.0 / luma.max(1e-3);
    let radius = 0.05 + get("radius", 30.0) / 100.0 * 1.45;
    let angle = get("angle", 135.0).to_radians();
    let elevation = get("elevation", 60.0).clamp(-180.0, 180.0).to_radians();
    let (plane_x, plane_y) = (
        angle.cos() * elevation.cos(),
        -angle.sin() * elevation.cos(),
    );
    let kind = match l["type"].as_str().unwrap_or("point") {
        "directional" => RelightKind::Directional {
            dir: [plane_x, plane_y, -elevation.sin()],
        },
        "spot" => {
            let half = (5.0 + get("cone", 40.0).clamp(0.0, 100.0) / 100.0 * 80.0).to_radians();
            let feather = get("feather", 50.0).clamp(0.0, 100.0) / 100.0;
            RelightKind::Spot {
                beam: [plane_x, plane_y, elevation.sin()],
                outer: half.cos(),
                inner: (half * (1.0 - feather)).cos(),
            }
        }
        _ => RelightKind::Point,
    };
    RelightLight {
        kind,
        pos: [
            (get("x", 0.5) - 0.5) * aspect[0],
            (get("y", 0.5) - 0.5) * aspect[1],
            get("depth", 0.0) / 100.0 * 1.25 - 0.25,
        ],
        color: rgb.map(|c| c.max(0.0) * strength),
        radius2: radius * radius,
    }
}

/// A relight read from an edit for an image of one size.
pub struct Relight {
    normal_map: Arc<RgbaImage>,
    map_key: u64,
    lights: Vec<RelightLight>,
    ambient_gain: f32,
    softness: f32,
    shine: f32,
    shadows: bool,
    shadow_softness: f32,
    /// The image's sides over its longest one.
    aspect: [f32; 2],
}

/// The relight `adjustments` ask for on an image of `(w, h)`, or `None` when it would leave
/// the image unchanged.
pub fn prepare(adjustments: &serde_json::Value, (w, h): (u32, u32)) -> Option<Relight> {
    if !crate::adjustment_utils::is_tool_enabled(adjustments, "relight", "relightEnabled") {
        return None;
    }
    let normal_b64 = adjustments[RELIGHT_NORMAL_MAP_KEY]
        .as_str()
        .filter(|map| !map.is_empty())?;
    if w < 2 || h < 2 {
        return None;
    }

    let ambient = adjustments["relightAmbient"].as_f64().unwrap_or(0.0) as f32;
    let long_side = w.max(h) as f32;
    let aspect = [w as f32 / long_side, h as f32 / long_side];
    let lights: Vec<RelightLight> = adjustments["relightLights"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter(|l| l["visible"].as_bool().unwrap_or(true))
                .map(|l| parse_light(l, aspect))
                .collect()
        })
        .unwrap_or_default();
    if lights.is_empty() && ambient == 0.0 {
        return None;
    }

    let normal_map = crate::effect_maps::resolve_rgba_map(normal_b64, adjustments)?;
    if normal_map.width() < 2 || normal_map.height() < 2 {
        return None;
    }

    let percent = |key: &str, default: f64| {
        (adjustments[key].as_f64().unwrap_or(default) as f32 / 100.0).clamp(0.0, 1.0)
    };
    Some(Relight {
        map_key: crate::effect_maps::effect_map_key(normal_b64, adjustments),
        normal_map,
        lights,
        ambient_gain: (ambient / 50.0).exp2(),
        softness: percent("relightSoftness", 25.0),
        shine: percent("relightShine", 0.0),
        shadows: adjustments["relightShadows"].as_bool().unwrap_or(false),
        shadow_softness: percent("relightShadowSoftness", 15.0),
        aspect,
    })
}

impl Relight {
    /// Identifies what this relight does, for `RenderSource::key`.
    pub fn hash_into(&self, hasher: &mut impl Hasher) {
        self.map_key.hash(hasher);
        self.shadows.hash(hasher);
        let lights = self.lights.iter().flat_map(RelightLight::to_gpu);
        for value in lights.chain([
            self.ambient_gain,
            self.softness,
            self.shine,
            self.shadow_softness,
            self.aspect[0],
            self.aspect[1],
        ]) {
            value.to_bits().hash(hasher);
        }
    }

    /// Whether shadows are marched: asked for, with a light to cast them.
    fn casts_shadows(&self) -> bool {
        self.shadows && !self.lights.is_empty()
    }

    /// The relight on the CPU, on an image of the size it was prepared for.
    pub fn apply_on_cpu<'a>(&self, image: Cow<'a, DynamicImage>) -> Cow<'a, DynamicImage> {
        let start = std::time::Instant::now();
        let (w, h) = image.dimensions();
        let (wu, hu) = (w as usize, h as usize);
        let mut out = image.into_owned().into_rgb32f();

        let cache_key = {
            let mut hasher = DefaultHasher::new();
            self.map_key.hash(&mut hasher);
            (w, h).hash(&mut hasher);
            let raw = out.as_raw();
            for value in raw.iter().step_by((raw.len() / 4096).max(1)) {
                value.to_bits().hash(&mut hasher);
            }
            hasher.finish()
        };

        let cached = RELIGHT_CACHE
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .as_ref()
            .filter(|c| c.key == cache_key)
            .cloned();

        let mut cache = cached.unwrap_or_else(|| {
            let (nw, nh) = (
                self.normal_map.width() as usize,
                self.normal_map.height() as usize,
            );
            let map_guide = build_relight_guide(out.as_raw(), wu, hu, nw, nh);
            let radius = map_radius((nw as u32, nh as u32)) as usize;
            let surface_models = (0..4)
                .map(|c| {
                    let plane: Vec<f32> = self
                        .normal_map
                        .pixels()
                        .map(|p| surface_values(p)[c])
                        .collect();
                    build_guided_model(&map_guide, &plane, nw, nh, radius, EPS)
                })
                .collect();
            RelightCache {
                key: cache_key,
                nw,
                nh,
                surface_models: Arc::new(surface_models),
                shadow_inputs: None,
                shadow_models: Vec::new(),
            }
        });

        let (nw, nh) = (cache.nw, cache.nh);
        let (sw, sh) = shadow_size((w, h));
        let (sw, sh) = (sw as usize, sh as usize);

        if self.casts_shadows() && cache.shadow_inputs.is_none() {
            let shadow_guide = build_relight_guide(out.as_raw(), wu, hu, sw, sh);
            let depth: Vec<f32> = (0..sw * sh)
                .into_par_iter()
                .map(|i| {
                    let tap = RelightTap::new(
                        ((i % sw) as f32 + 0.5) / sw as f32,
                        ((i / sw) as f32 + 0.5) / sh as f32,
                        nw,
                        nh,
                    );
                    tap.guided(&cache.surface_models[3], shadow_guide[i])
                        .clamp(0.0, 1.0)
                })
                .collect();
            let depth_range = depth
                .par_iter()
                .fold(
                    || [f32::INFINITY, f32::NEG_INFINITY],
                    |[lo, hi], &d| [lo.min(d), hi.max(d)],
                )
                .reduce(
                    || [f32::INFINITY, f32::NEG_INFINITY],
                    |a, b| [a[0].min(b[0]), a[1].max(b[1])],
                );
            let radius = shadow_radius((sw as u32, sh as u32)) as usize;
            let stats = GuideStats::new(&shadow_guide, sw, sh, radius);
            cache.shadow_inputs = Some(Arc::new(ShadowInputs {
                guide: shadow_guide,
                depth,
                depth_range,
                stats,
            }));
        }

        let shadow_models: Vec<Arc<GuidedModel>> = match &cache.shadow_inputs {
            Some(inputs) if self.casts_shadows() => {
                let models: Vec<(u64, Arc<GuidedModel>)> = self
                    .lights
                    .iter()
                    .map(|light| {
                        let key = shadow_key(light, self.shadow_softness);
                        if let Some((_, model)) =
                            cache.shadow_models.iter().find(|(k, _)| *k == key)
                        {
                            return (key, model.clone());
                        }
                        let shadow = build_shadow_map(
                            &inputs.depth,
                            inputs.depth_range,
                            sw,
                            sh,
                            self.aspect,
                            light,
                            self.shadow_softness,
                        );
                        let model = build_guided_model_with(
                            &inputs.stats,
                            &inputs.guide,
                            &shadow,
                            sw,
                            sh,
                            EPS,
                        );
                        (key, Arc::new(model))
                    })
                    .collect();
                let shadow_models = models.iter().map(|(_, m)| m.clone()).collect();
                cache.shadow_models = models;
                shadow_models
            }
            _ => Vec::new(),
        };

        *RELIGHT_CACHE.lock().unwrap_or_else(|e| e.into_inner()) = Some(cache.clone());

        let surface_models = &cache.surface_models;
        let [aspect_x, aspect_y] = self.aspect;
        let (softness, shine) = (self.softness, self.shine);

        out.par_chunks_exact_mut(wu * 3)
            .enumerate()
            .for_each(|(y, row)| {
                let v = (y as f32 + 0.5) / h as f32;

                for x in 0..wu {
                    let u = (x as f32 + 0.5) / w as f32;
                    let guide = relight_luma(row[x * 3], row[x * 3 + 1], row[x * 3 + 2]);
                    let map_tap = RelightTap::new(u, v, nw, nh);
                    let shadow_tap = RelightTap::new(u, v, sw, sh);

                    let s = [0, 1, 2, 3].map(|c| map_tap.guided(&surface_models[c], guide));
                    let len = (s[0] * s[0] + s[1] * s[1] + s[2] * s[2]).sqrt().max(1e-6);
                    let n = [s[0] / len, s[1] / len, s[2] / len];
                    let p = [
                        (u - 0.5) * aspect_x,
                        (v - 0.5) * aspect_y,
                        s[3].clamp(0.0, 1.0),
                    ];

                    let mut gain = [self.ambient_gain; 3];
                    for (index, light) in self.lights.iter().enumerate() {
                        let (l, mut atten) = if let RelightKind::Directional { dir } = light.kind {
                            (dir, 1.0)
                        } else {
                            let d = [
                                light.pos[0] - p[0],
                                light.pos[1] - p[1],
                                light.pos[2] - p[2],
                            ];
                            let dist2 = (d[0] * d[0] + d[1] * d[1] + d[2] * d[2]).max(1e-8);
                            let inv = 1.0 / dist2.sqrt();
                            let l = [d[0] * inv, d[1] * inv, d[2] * inv];
                            let mut atten = light.radius2 / (light.radius2 + dist2);
                            if let RelightKind::Spot { beam, outer, inner } = light.kind {
                                let cos_beam = -(l[0] * beam[0] + l[1] * beam[1] + l[2] * beam[2]);
                                atten *= relight_smoothstep(outer, inner, cos_beam);
                            }
                            (l, atten)
                        };

                        if let Some(model) = shadow_models.get(index) {
                            atten *= shadow_tap.guided(model, guide).clamp(0.0, 1.0);
                        }

                        let ndl = n[0] * l[0] + n[1] * l[1] + n[2] * l[2];
                        let diffuse = ((ndl + softness) / (1.0 + softness)).max(0.0);

                        let specular = if shine > 0.0 && ndl > 0.0 {
                            let hz = l[2] - 1.0;
                            let hl = (l[0] * l[0] + l[1] * l[1] + hz * hz).sqrt().max(1e-6);
                            let ndh = ((n[0] * l[0] + n[1] * l[1] + n[2] * hz) / hl).max(0.0);
                            ndh.powf(8.0 + 56.0 * (1.0 - softness)) * shine * 2.0
                        } else {
                            0.0
                        };

                        let k = (diffuse + specular) * atten;
                        gain[0] += light.color[0] * k;
                        gain[1] += light.color[1] * k;
                        gain[2] += light.color[2] * k;
                    }

                    let i = x * 3;
                    row[i] *= gain[0].max(0.0);
                    row[i + 1] *= gain[1].max(0.0);
                    row[i + 2] *= gain[2].max(0.0);
                }
            });

        log::info!(
            "relight ({}x{}, {} lights) took {:.2?}",
            w,
            h,
            self.lights.len(),
            start.elapsed()
        );

        Cow::Owned(DynamicImage::ImageRgb32F(out))
    }
}

/// The parameters of every stage in `shaders/relight.wgsl` (its `Params`).
#[repr(C)]
#[derive(Debug, Default, Copy, Clone, bytemuck::Pod, bytemuck::Zeroable)]
struct Params {
    grid: Grid,
    aspect: [f32; 2],
    ambient_gain: f32,
    softness: f32,
    shine: f32,
    lights: u32,
    shadows: u32,
    _pad: u32,
    map_size: [u32; 2],
    shadow_size: [u32; 2],
}

/// The relight on the GPU from `src` into `dst` (`IMAGE_FORMAT`, the same size), the steps
/// of `apply_on_cpu` in the same order. Unlike the CPU version, which keeps the surface and
/// each light's shadow between renders, it rebuilds them every time (as upstream).
pub fn encode(enc: &mut ComputeEncoder, job: &Relight, src: &Slot, dst: &Slot) {
    let full = src.size;
    let map_size = job.normal_map.dimensions();
    let shadow_size = shadow_size(full);
    let shadows = job.casts_shadows();
    let params = Params {
        grid: Grid::new(full),
        aspect: job.aspect,
        ambient_gain: job.ambient_gain,
        softness: job.softness,
        shine: job.shine,
        lights: job.lights.len() as u32,
        shadows: shadows as u32,
        _pad: 0,
        map_size: [map_size.0, map_size.1],
        shadow_size: [shadow_size.0, shadow_size.1],
    };
    let at = |grid: Grid| Params { grid, ..params };

    // The surface refined by the photo: one guided model per normal channel and the depth,
    // merged into their slopes and their offsets.
    let normals = enc.cached_map("Relight Normals", job.map_key, map_size, F32X4, || {
        job.normal_map.pixels().flat_map(surface_values).collect()
    });
    let map_guide = enc.area_down(src, map_size, 0);
    let models: Vec<Tex> = (0..4)
        .map(|channel| enc.guided_model(&map_guide, &normals, channel, map_radius(map_size), EPS))
        .collect();
    drop(map_guide);
    let model_views: Vec<&wgpu::TextureView> = models.iter().map(|m| &m.view).collect();
    let surface: Vec<Tex> = (0..2)
        .map(|channel| {
            let merged = enc.texture("Relight Surface", map_size, F32X4);
            enc.run(
                Group::Relight,
                "rl_merge",
                &at(Grid {
                    channel,
                    ..Grid::new(map_size)
                }),
                map_size,
                Out::F32(&merged.view),
                Bind::reading(&model_views),
            );
            merged
        })
        .collect();
    drop(model_views);
    drop(models);

    let light_data: Vec<f32> = job.lights.iter().flat_map(RelightLight::to_gpu).collect();
    let lights = (!light_data.is_empty())
        .then(|| enc.buffer("Relight Lights", bytemuck::cast_slice(&light_data)));

    let shadow_layers = shadows.then(|| {
        let shadow_guide = enc.area_down(src, shadow_size, 0);
        let range = enc.buffer(
            "Relight Depth Range",
            bytemuck::cast_slice(&[u32::MAX, 0u32]),
        );
        let depth = enc.texture("Relight Depth", shadow_size, F32X4);
        enc.run(
            Group::Relight,
            "rl_depth",
            &at(Grid::new(shadow_size)),
            shadow_size,
            Out::F32(&depth.view),
            Bind::reading(&[&shadow_guide.view, &surface[0].view, &surface[1].view])
                .with_scratch(&range),
        );

        let radius = shadow_radius(shadow_size);
        let blur_radius = shadow_blur_radius(shadow_size, job.shadow_softness);
        let layers = enc.layered("Relight Shadows", shadow_size, job.lights.len() as u32);
        for index in 0..job.lights.len() as u32 {
            let shadow = enc.texture("Relight Shadow", shadow_size, F32X4);
            enc.run(
                Group::Relight,
                "rl_shadow",
                &at(Grid {
                    channel: index,
                    ..Grid::new(shadow_size)
                }),
                shadow_size,
                Out::F32(&shadow.view),
                Bind::reading(&[&depth.view])
                    .with_scratch(&range)
                    .with_data(lights.as_ref()),
            );
            let softened = enc.blur(shadow, blur_radius, 2, 0);
            let model = enc.guided_model(&shadow_guide, &softened, 0, radius, EPS);
            enc.copy_to_layer(&model, &layers, index);
        }
        layers
    });

    debug_assert_eq!(dst.size, full);
    debug_assert_eq!(dst.texture.format(), IMAGE_FORMAT);
    enc.run(
        Group::Relight,
        "rl_apply",
        &params,
        full,
        Out::F16(&dst.view),
        Bind::reading(&[&src.view, &surface[0].view, &surface[1].view])
            .with_layers(shadow_layers.as_deref())
            .with_data(lights.as_ref()),
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn params_match_the_shader() {
        let module = crate::gpu_compute::group_module(Group::Relight);
        assert_eq!(
            crate::gpu_compute::struct_span(&module, "Params"),
            size_of::<Params>()
        );
    }
}
