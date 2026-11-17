//! What a render starts from: an image prepared on the CPU (patched, not warped) plus the
//! stages that turn it into the main shader's input on the GPU (upstream `15a9ff2e`;
//! `docs/GPU_COMPUTE_PLAN.md`). The GPU runs the geometry warp, a working-size downscale,
//! relight, fog and lens blur, then the frame (orientation, flips, rotation, crop) and the
//! output downscale. The same stages run on the CPU when the GPU ones fail (`render_on_cpu`),
//! and are the reference the GPU stages are tested against.

use std::borrow::Cow;
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::sync::Arc;

use image::{DynamicImage, GenericImageView};
use serde_json::Value;

use crate::fog::Fog;
use crate::gpu_compute::{Bind, Grid, Group, IMAGE_FORMAT, Out, Slot};
use crate::image_processing::{
    Crop, GeometryParams, GpuContext, WarpModel, apply_coarse_rotation, apply_flip, apply_rotation,
    crop_rect, downscale_f32_image, fitted_size, get_geometry_params_from_json,
    is_geometry_identity, warp_image_geometry,
};
use crate::lens_blur::LensBlur;
use crate::relight::Relight;

const FRAME_ROTATE: u32 = 1;
const WARP_LENS: u32 = 1;
const WARP_PTLENS: u32 = 2;
const WARP_TCA: u32 = 4;
const WARP_VIGNETTE: u32 = 8;
const WARP_DISTORTION: u32 = 16;

/// The parameters of every stage in `shaders/transform.wgsl` (its `Params`).
#[repr(C)]
#[derive(Debug, Default, Copy, Clone, bytemuck::Pod, bytemuck::Zeroable)]
pub(crate) struct TransformParams {
    grid: Grid,
    inverse_x: [f32; 4],
    inverse_y: [f32; 4],
    inverse_z: [f32; 4],
    center: [f32; 2],
    half_diagonal: f32,
    max_radius_sq_inv: f32,
    distortion: f32,
    lens_amount: f32,
    auto_crop_scale: f32,
    vignette_amount: f32,
    lens_k: [f32; 4],
    vignette_k: [f32; 4],
    tca: [f32; 2],
    warp_flags: u32,
    orientation: u32,
    rotation: [f32; 4],
    rotation_offset: [f32; 2],
    crop_origin: [u32; 2],
    oriented_size: [u32; 2],
    flip: [u32; 2],
    grain: [u32; 4],
}

impl TransformParams {
    /// `tf_grain`: blocks every `stride` pixels, `blocks` of them, luma encoded for RAWs.
    pub(crate) fn grain(stride: u32, blocks: (u32, u32), is_raw: bool) -> Self {
        Self {
            grid: Grid::new(blocks),
            grain: [stride, blocks.0, blocks.1, is_raw as u32],
            ..Default::default()
        }
    }
}

/// Orientation, flips, fine rotation and crop, applied in that order. The crop is in the
/// pixels of the image it frames.
#[derive(Clone, Debug, Default)]
pub struct Frame {
    pub orientation_steps: u8,
    pub flip_horizontal: bool,
    pub flip_vertical: bool,
    pub rotation: f32,
    pub crop: Option<Crop>,
}

impl Frame {
    pub fn from_adjustments(adjustments: &Value) -> Self {
        // Like `apply_coarse_rotation`, which ignores steps other than 1–3.
        let orientation_steps = match adjustments["orientationSteps"].as_u64() {
            Some(steps @ 1..=3) => steps as u8,
            _ => 0,
        };
        Self {
            orientation_steps,
            flip_horizontal: adjustments["flipHorizontal"].as_bool().unwrap_or(false),
            flip_vertical: adjustments["flipVertical"].as_bool().unwrap_or(false),
            rotation: adjustments["rotation"].as_f64().unwrap_or(0.0) as f32,
            crop: serde_json::from_value(adjustments["crop"].clone()).ok(),
        }
    }

    fn oriented_size(&self, (w, h): (u32, u32)) -> (u32, u32) {
        if self.orientation_steps % 2 == 1 {
            (h, w)
        } else {
            (w, h)
        }
    }

    fn rotates(&self) -> bool {
        self.rotation % 360.0 != 0.0
    }

    fn crop_rect(&self, oriented: (u32, u32)) -> (u32, u32, u32, u32) {
        self.crop
            .as_ref()
            .and_then(|crop| crop_rect(crop, oriented))
            .unwrap_or((0, 0, oriented.0, oriented.1))
    }

    /// The size of an image of `size` once framed.
    pub fn size(&self, size: (u32, u32)) -> (u32, u32) {
        let (_, _, w, h) = self.crop_rect(self.oriented_size(size));
        (w, h)
    }

    fn is_identity(&self, size: (u32, u32)) -> bool {
        self.orientation_steps == 0
            && !self.flip_horizontal
            && !self.flip_vertical
            && !self.rotates()
            && self.crop_rect(size) == (0, 0, size.0, size.1)
    }

    /// The frame applied on the CPU.
    pub fn apply_on_cpu<'a>(&self, image: Cow<'a, DynamicImage>) -> Cow<'a, DynamicImage> {
        let oriented = apply_coarse_rotation(image, self.orientation_steps);
        let flipped = apply_flip(oriented, self.flip_horizontal, self.flip_vertical);
        let rotated = apply_rotation(flipped, self.rotation);
        let size = rotated.dimensions();
        match self.crop_rect(size) {
            rect if rect == (0, 0, size.0, size.1) => rotated,
            (x, y, w, h) => Cow::Owned(rotated.crop_imm(x, y, w, h)),
        }
    }

    fn encode(&self, enc: &mut crate::gpu_compute::ComputeEncoder, src: &Slot, dst: &Slot) {
        let oriented = self.oriented_size(src.size);
        let (x, y, _, _) = self.crop_rect(oriented);
        let (sin, cos) = (self.rotation * std::f32::consts::PI / 180.0).sin_cos();
        let center = [oriented.0 as f32 / 2.0, oriented.1 as f32 / 2.0];
        let params = TransformParams {
            grid: Grid::new(dst.size)
                .with_src(src.size)
                .with_flags(if self.rotates() { FRAME_ROTATE } else { 0 }),
            orientation: self.orientation_steps as u32,
            rotation: [cos, sin, -sin, cos],
            rotation_offset: [
                center[0] - (cos * center[0] + sin * center[1]),
                center[1] - (-sin * center[0] + cos * center[1]),
            ],
            crop_origin: [x, y],
            oriented_size: [oriented.0, oriented.1],
            flip: [self.flip_horizontal as u32, self.flip_vertical as u32],
            ..Default::default()
        };
        enc.run(
            Group::Transform,
            "tf_frame",
            &params,
            dst.size,
            Out::F16(&dst.view),
            Bind::reading(&[&src.view]),
        );
    }
}

/// The edit's geometry warp, `None` when it leaves the image as it is.
pub fn warp_of(adjustments: &Value) -> Option<GeometryParams> {
    let params = get_geometry_params_from_json(adjustments);
    (!is_geometry_identity(&params)).then_some(params)
}

/// `tf_warp`: `src` warped into `dst` of the same size.
fn warp(
    enc: &mut crate::gpu_compute::ComputeEncoder,
    geometry: &GeometryParams,
    src: &Slot,
    dst: &Slot,
) {
    let model = WarpModel::new(geometry, src.size.0, src.size.1);
    let column = |c: usize| {
        [
            model.inverse[(0, c)],
            model.inverse[(1, c)],
            model.inverse[(2, c)],
            0.0,
        ]
    };
    let warp_flags = [
        (model.has_lens_correction, WARP_LENS),
        (model.is_ptlens, WARP_PTLENS),
        (model.has_tca, WARP_TCA),
        (model.has_vignetting, WARP_VIGNETTE),
        (model.k_distortion.abs() > 1e-5, WARP_DISTORTION),
    ]
    .iter()
    .filter(|(on, _)| *on)
    .fold(0, |flags, (_, flag)| flags | flag);
    let [k1, k2, k3] = model.lens_k.map(|k| k as f32);
    let [v1, v2, v3] = model.vignette_k.map(|k| k as f32);
    let params = TransformParams {
        grid: Grid::new(dst.size),
        inverse_x: column(0),
        inverse_y: column(1),
        inverse_z: column(2),
        center: [model.cx, model.cy],
        half_diagonal: model.half_diagonal as f32,
        max_radius_sq_inv: model.max_radius_sq_inv as f32,
        distortion: model.k_distortion as f32,
        lens_amount: model.lens_amount as f32,
        auto_crop_scale: model.auto_crop_scale,
        vignette_amount: model.vignette_amount as f32,
        lens_k: [k1, k2, k3, 0.0],
        vignette_k: [v1, v2, v3, 0.0],
        tca: [model.vr, model.vb],
        warp_flags,
        ..Default::default()
    };
    enc.run(
        Group::Transform,
        "tf_warp",
        &params,
        dst.size,
        Out::F16(&dst.view),
        Bind::reading(&[&src.view]),
    );
}

fn downscale(enc: &mut crate::gpu_compute::ComputeEncoder, src: &Slot, dst: &Slot) {
    let params = TransformParams {
        grid: Grid::new(dst.size).with_src(src.size),
        ..Default::default()
    };
    enc.run(
        Group::Transform,
        "tf_downscale",
        &params,
        dst.size,
        Out::F16(&dst.view),
        Bind::reading(&[&src.view]),
    );
}

/// The spatial effects the GPU runs before the frame, relight, fog, then lens blur, read from
/// an edit for an image of one size (the effects scale with it).
#[derive(Clone, Default)]
pub struct Effects {
    relight: Option<Arc<Relight>>,
    fog: Option<Arc<Fog>>,
    lens_blur: Option<Arc<LensBlur>>,
}

impl Effects {
    pub fn prepare(adjustments: &Value, size: (u32, u32)) -> Self {
        Self {
            relight: crate::relight::prepare(adjustments, size).map(Arc::new),
            fog: crate::fog::prepare(adjustments, size).map(Arc::new),
            lens_blur: crate::lens_blur::prepare(adjustments, size).map(Arc::new),
        }
    }

    fn hash_into(&self, hasher: &mut impl Hasher) {
        self.relight.is_some().hash(hasher);
        if let Some(job) = &self.relight {
            job.hash_into(hasher);
        }
        self.fog.is_some().hash(hasher);
        if let Some(job) = &self.fog {
            job.hash_into(hasher);
        }
        self.lens_blur.is_some().hash(hasher);
        if let Some(job) = &self.lens_blur {
            job.hash_into(hasher);
        }
    }

    fn encode(&self, enc: &mut crate::gpu_compute::ComputeEncoder, src: Slot) -> Slot {
        let relit = self.relight.as_ref().map(|job| {
            let relit = enc.texture("Relight Output", src.size, IMAGE_FORMAT);
            crate::relight::encode(enc, job, &src, &relit);
            relit
        });
        let input = relit.as_deref().unwrap_or(&src);
        let fogged = self.fog.as_ref().map(|job| {
            let fogged = enc.texture("Fog Output", src.size, IMAGE_FORMAT);
            crate::fog::encode(enc, job, input, &fogged);
            fogged
        });
        let Some(job) = &self.lens_blur else {
            // The relight output returns to the pool when fog follows it.
            return match (fogged, relit) {
                (Some(fogged), _) => fogged.detach(),
                (None, Some(relit)) => relit.detach(),
                (None, None) => src,
            };
        };
        let input = fogged.as_deref().or(relit.as_deref()).unwrap_or(&src);
        let blurred = enc.texture("Lens Blur Output", src.size, IMAGE_FORMAT);
        crate::lens_blur::encode(enc, job, input, &blurred);
        // The relight and fog outputs return to the pool here.
        blurred.detach()
    }

    /// The effects on the CPU: the fallback, and for the renders that never reach the GPU
    /// stages (thumbnails, the Before view).
    pub fn apply_on_cpu<'a>(&self, image: Cow<'a, DynamicImage>) -> Cow<'a, DynamicImage> {
        let relit = match &self.relight {
            Some(job) => job.apply_on_cpu(image),
            None => image,
        };
        let fogged = match &self.fog {
            Some(job) => job.apply_on_cpu(relit),
            None => relit,
        };
        match &self.lens_blur {
            Some(job) => job.apply_on_cpu(fogged),
            None => fogged,
        }
    }
}

/// An image for the main shader: `image` warped by `warp`, shrunk to fit `working_fit` when
/// that is smaller, then `effects`, then `frame`, then shrunk to fit `output_fit` when that is
/// smaller.
pub struct RenderSource<'a> {
    pub image: &'a DynamicImage,
    /// Identifies `image`'s pixels; renders of the same id and stages reuse their GPU input.
    pub id: u64,
    pub warp: Option<GeometryParams>,
    pub working_fit: Option<(u32, u32)>,
    pub effects: Effects,
    pub frame: Frame,
    pub output_fit: Option<(u32, u32)>,
}

impl<'a> RenderSource<'a> {
    pub fn new(image: &'a DynamicImage, id: u64, frame: Frame) -> Self {
        Self {
            image,
            id,
            warp: None,
            working_fit: None,
            effects: Effects::default(),
            frame,
            output_fit: None,
        }
    }

    /// `image` rendered as it is.
    pub fn plain(image: &'a DynamicImage, id: u64) -> Self {
        Self::new(image, id, Frame::default())
    }

    /// `image` with the warp, effects and frame `adjustments` say, the crop in `image`'s
    /// pixels.
    pub fn edited(image: &'a DynamicImage, id: u64, adjustments: &Value) -> Self {
        Self::new(image, id, Frame::from_adjustments(adjustments))
            .with_warp(warp_of(adjustments))
            .with_effects(Effects::prepare(adjustments, image.dimensions()))
    }

    /// With `warp` first.
    pub fn with_warp(self, warp: Option<GeometryParams>) -> Self {
        Self { warp, ..self }
    }

    /// Shrunk to fit inside `target` after the warp, before the effects.
    pub fn with_working_fit(self, target: Option<(u32, u32)>) -> Self {
        Self {
            working_fit: target,
            ..self
        }
    }

    /// With `effects`, prepared for the working size (`working_size`).
    pub fn with_effects(self, effects: Effects) -> Self {
        Self { effects, ..self }
    }

    /// The size the effects run at and the frame starts from.
    pub fn working_size(&self) -> (u32, u32) {
        let size = self.image.dimensions();
        self.working_fit
            .and_then(|target| fitted_size(size, target))
            .unwrap_or(size)
    }

    /// Shrunk to fit inside `target`.
    pub fn fitted(self, target: (u32, u32)) -> Self {
        Self {
            output_fit: Some(target),
            ..self
        }
    }

    /// The crop's origin in working pixels, which masks are positioned from.
    pub fn crop_offset(&self) -> (f32, f32) {
        self.frame
            .crop
            .map_or((0.0, 0.0), |c| (c.x as f32, c.y as f32))
    }

    /// The size after the frame, before `output_fit`.
    pub fn framed_size(&self) -> (u32, u32) {
        self.frame.size(self.working_size())
    }

    /// The size of the main shader's input.
    pub fn size(&self) -> (u32, u32) {
        let framed = self.framed_size();
        self.output_fit
            .and_then(|target| fitted_size(framed, target))
            .unwrap_or(framed)
    }

    /// Identifies the rendered input: the image and every stage on it.
    pub fn key(&self) -> u64 {
        let mut hasher = DefaultHasher::new();
        (
            self.id,
            format!("{:?}", self.warp),
            self.working_fit,
            format!("{:?}", self.frame),
            self.output_fit,
        )
            .hash(&mut hasher);
        self.effects.hash_into(&mut hasher);
        hasher.finish()
    }

    /// Uploads `image` and runs the stages on the GPU.
    pub fn render(&self, context: &GpuContext) -> Result<Slot, String> {
        let working_size = self.working_size();
        let framed_size = self.framed_size();
        let output_size = self.size();
        crate::gpu_compute::encode(context, |enc| {
            let source = crate::gpu_compute::upload_image(context, self.image);
            let warped = match &self.warp {
                Some(geometry) => {
                    let warped = enc.texture("Warped Source", source.size, IMAGE_FORMAT);
                    warp(enc, geometry, &source, &warped);
                    warped.detach()
                }
                None => source,
            };
            let working = if working_size == warped.size {
                warped
            } else {
                let working = enc.texture("Working Source", working_size, IMAGE_FORMAT);
                downscale(enc, &warped, &working);
                working.detach()
            };
            let effected = self.effects.encode(enc, working);
            let framed = if self.frame.is_identity(working_size) {
                effected
            } else {
                let framed = enc.texture("Framed Source", framed_size, IMAGE_FORMAT);
                self.frame.encode(enc, &effected, &framed);
                framed.detach()
            };
            if output_size == framed_size {
                return framed;
            }
            let fitted = enc.texture("Fitted Source", output_size, IMAGE_FORMAT);
            downscale(enc, &framed, &fitted);
            fitted.detach()
        })
    }

    /// The same stages on the CPU: the fallback when the GPU ones fail.
    pub fn render_on_cpu(&self) -> Cow<'a, DynamicImage> {
        let warped = match self.warp {
            Some(geometry) => Cow::Owned(warp_image_geometry(self.image, geometry)),
            None => Cow::Borrowed(self.image),
        };
        let working = match self.working_fit {
            Some((w, h)) if self.working_size() != warped.dimensions() => {
                Cow::Owned(downscale_f32_image(&warped, w, h))
            }
            _ => warped,
        };
        let effected = self.effects.apply_on_cpu(working);
        let framed = self.frame.apply_on_cpu(effected);
        match self.output_fit {
            Some((w, h)) if self.size() != framed.dimensions() => {
                Cow::Owned(downscale_f32_image(&framed, w, h))
            }
            _ => framed,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn transform_params_match_the_shader() {
        let module = crate::gpu_compute::group_module(Group::Transform);
        assert_eq!(
            crate::gpu_compute::struct_span(&module, "Params"),
            size_of::<TransformParams>()
        );
    }

    #[test]
    fn the_cpu_render_runs_warp_shrink_relight_fog_then_lens_blur_before_the_frame() {
        let image = scene(120, 90);
        let adjustments = relight(fog(lens_blur(json!({
            "orientationSteps": 1,
            "transformVertical": 20,
            "transformDistortion": 30,
        }))));
        let working = (80, 80);
        let working_size = fitted_size(image.dimensions(), working).expect("a smaller size");
        let source = RenderSource::edited(&image, 0, &adjustments)
            .with_working_fit(Some(working))
            .with_effects(Effects::prepare(&adjustments, working_size));
        let geometry = warp_of(&adjustments).expect("a warp");
        let warped = warp_image_geometry(&image, geometry);
        let shrunk = downscale_f32_image(&warped, working.0, working.1);
        assert_eq!(shrunk.dimensions(), working_size);
        let relight = crate::relight::prepare(&adjustments, working_size).expect("relit");
        let relit = relight.apply_on_cpu(Cow::Owned(shrunk));
        let fog = crate::fog::prepare(&adjustments, working_size).expect("fog on");
        let fogged = fog.apply_on_cpu(relit);
        let blur = crate::lens_blur::prepare(&adjustments, working_size).expect("blur on");
        let blurred = blur.apply_on_cpu(fogged);
        let expected = Frame::from_adjustments(&adjustments).apply_on_cpu(blurred);
        let rendered = source.render_on_cpu().to_rgb32f();
        let expected = expected.to_rgb32f();
        assert_eq!(rendered.dimensions(), expected.dimensions());
        // Fog's colour is a parallel sum, whose order (and last bits) varies between runs;
        // relight's brightening and lens blur's highlight weighting magnify them (seen up to
        // 1.24e-5 relative). Effects in another order differ by far more than this limit.
        let worst = rendered
            .as_raw()
            .iter()
            .zip(expected.as_raw())
            .map(|(a, b)| (a - b).abs() / b.abs().max(1.0))
            .fold(0.0f32, f32::max);
        assert!(worst <= 1e-4, "worst {worst}");
    }

    fn ramp(width: u32, height: u32) -> DynamicImage {
        DynamicImage::ImageRgb32F(image::ImageBuffer::from_fn(width, height, |x, y| {
            let ripple = ((x * 7 + y * 13) % 31) as f32 / 31.0;
            image::Rgb([
                x as f32 / width as f32,
                y as f32 / height as f32,
                ripple * 1.5,
            ])
        }))
    }

    /// Frames worth comparing: each orientation with flips, fine rotations and crops.
    fn frames() -> Vec<Value> {
        let mut frames = vec![json!({})];
        for steps in 0..4 {
            frames.push(json!({ "orientationSteps": steps, "flipHorizontal": steps % 2 == 0 }));
        }
        frames.extend([
            json!({ "flipVertical": true, "rotation": 7.5 }),
            json!({ "orientationSteps": 1, "rotation": -33.2,
                    "crop": { "x": 12.4, "y": 30.6, "width": 140.2, "height": 90.0 } }),
            json!({ "orientationSteps": 3, "flipHorizontal": true, "rotation": 180.0 }),
            json!({ "crop": { "x": 250.0, "y": 0.0, "width": 400.0, "height": 400.0 } }),
        ]);
        frames
    }

    #[test]
    fn sizes_match_what_the_cpu_frame_produces() {
        let image = ramp(301, 197);
        for adjustments in frames() {
            let source = RenderSource::edited(&image, 0, &adjustments);
            assert_eq!(
                source.render_on_cpu().dimensions(),
                source.size(),
                "{adjustments}"
            );
            let fitted = RenderSource::edited(&image, 0, &adjustments).fitted((64, 64));
            assert_eq!(
                fitted.render_on_cpu().dimensions(),
                fitted.size(),
                "{adjustments}"
            );
            let mut warped = adjustments.clone();
            warped["transformVertical"] = json!(25);
            let working =
                RenderSource::edited(&image, 0, &warped).with_working_fit(Some((150, 99)));
            assert_eq!(
                working.render_on_cpu().dimensions(),
                working.size(),
                "{warped}"
            );
        }
    }

    #[test]
    fn keys_differ_by_image_and_stages() {
        let image = ramp(8, 8);
        let plain = RenderSource::plain(&image, 1).key();
        assert_eq!(RenderSource::plain(&image, 1).key(), plain);
        assert_ne!(RenderSource::plain(&image, 2).key(), plain);
        assert_ne!(RenderSource::plain(&image, 1).fitted((4, 4)).key(), plain);
        assert_ne!(
            RenderSource::edited(&image, 1, &json!({ "rotation": 1.0 })).key(),
            plain
        );
        let warped = RenderSource::edited(&image, 1, &json!({ "transformVertical": 10 })).key();
        assert_ne!(warped, plain);
        assert_ne!(
            RenderSource::edited(&image, 1, &json!({ "transformVertical": 11 })).key(),
            warped
        );
        assert_ne!(
            RenderSource::plain(&image, 1)
                .with_working_fit(Some((4, 4)))
                .key(),
            plain
        );

        let image = ramp(64, 48);
        let blurred = lens_blur(json!({}));
        let key = RenderSource::edited(&image, 1, &blurred).key();
        assert_ne!(key, RenderSource::plain(&image, 1).key());
        assert_eq!(RenderSource::edited(&image, 1, &blurred).key(), key);
        assert_ne!(
            RenderSource::edited(&image, 1, &lens_blur(json!({ "lensBlurAmount": 70 }))).key(),
            key
        );

        let fogged = fog(json!({}));
        let key = RenderSource::edited(&image, 1, &fogged).key();
        assert_ne!(key, RenderSource::plain(&image, 1).key());
        assert_eq!(RenderSource::edited(&image, 1, &fogged).key(), key);
        for change in [
            json!({ "fogFeather": 30 }),
            json!({ "fogGlow": 0 }),
            json!({ "flipVertical": true }),
        ] {
            assert_ne!(
                RenderSource::edited(&image, 1, &fog(change.clone())).key(),
                key,
                "{change}"
            );
        }

        let relit = relight(json!({}));
        let key = RenderSource::edited(&image, 1, &relit).key();
        assert_ne!(key, RenderSource::plain(&image, 1).key());
        assert_eq!(RenderSource::edited(&image, 1, &relit).key(), key);
        for change in [
            json!({ "relightAmbient": -20 }),
            json!({ "relightShadows": true }),
            json!({ "relightLights": [light(json!({ "x": 0.7 }))] }),
            json!({ "relightLights": [light(json!({ "visible": false }))], "relightAmbient": 10 }),
        ] {
            assert_ne!(
                RenderSource::edited(&image, 1, &relight(change.clone())).key(),
                key,
                "{change}"
            );
        }
    }

    /// A depth map as the AI depth tool stores it: far on the left, near on the right, and a
    /// near block standing in front.
    fn depth_map_url(width: u32, height: u32) -> String {
        use base64::Engine as _;
        let map = image::GrayImage::from_fn(width, height, |x, y| {
            let block =
                (width / 3..width / 2).contains(&x) && (height / 4..height / 2).contains(&y);
            image::Luma([if block { 240 } else { (x * 255 / width) as u8 }])
        });
        let mut png = std::io::Cursor::new(Vec::new());
        DynamicImage::ImageLuma8(map)
            .write_to(&mut png, image::ImageFormat::Png)
            .expect("encode the depth map");
        format!(
            "data:image/png;base64,{}",
            base64::engine::general_purpose::STANDARD.encode(png.get_ref())
        )
    }

    /// A normal map as the AI relight tool stores it (RGB the normal, alpha the depth): a flat
    /// far background, a dome, and a near block standing in front that casts shadows.
    fn normal_map_url(width: u32, height: u32) -> String {
        use base64::Engine as _;
        let map = image::RgbaImage::from_fn(width, height, |x, y| {
            let (u, v) = (x as f32 / width as f32, y as f32 / height as f32);
            let (dx, dy) = ((u - 0.6) / 0.25, (v - 0.55) / 0.3);
            let r2 = dx * dx + dy * dy;
            let block = (0.15..0.35).contains(&u) && (0.3..0.6).contains(&v);
            let (normal, depth) = if block {
                ([0.0, 0.0, -1.0], 0.85)
            } else if r2 < 1.0 {
                (
                    [dx * 0.8, dy * 0.8, -(1.0 - r2 * 0.64).sqrt()],
                    0.35 + 0.3 * (1.0 - r2),
                )
            } else {
                ([0.1 * u, -0.1 * v, -1.0], 0.2 * v)
            };
            let channel = |c: f32| (c.clamp(0.0, 1.0) * 255.0).round() as u8;
            image::Rgba([
                channel((normal[0] + 1.0) / 2.0),
                channel((1.0 - normal[1]) / 2.0),
                channel((1.0 - normal[2]) / 2.0),
                channel(depth),
            ])
        });
        let mut png = std::io::Cursor::new(Vec::new());
        DynamicImage::ImageRgba8(map)
            .write_to(&mut png, image::ImageFormat::Png)
            .expect("encode the normal map");
        format!(
            "data:image/png;base64,{}",
            base64::engine::general_purpose::STANDARD.encode(png.get_ref())
        )
    }

    /// A warm point light, with `overrides`.
    fn light(overrides: Value) -> Value {
        let mut light = json!({
            "type": "point",
            "x": 0.35,
            "y": 0.3,
            "depth": 70,
            "intensity": 60,
            "radius": 40,
            "color": "#ffd9a0",
        });
        for (key, value) in overrides.as_object().expect("an object") {
            light[key] = value.clone();
        }
        light
    }

    /// Relight on with one `light`, with `overrides` (an edit, so it can be combined).
    fn relight(overrides: Value) -> Value {
        let mut adjustments = json!({
            "relightEnabled": true,
            "relightNormalMap": normal_map_url(128, 96),
            "relightLights": [light(json!({}))],
            "relightAmbient": -30,
            "relightSoftness": 25,
        });
        for (key, value) in overrides.as_object().expect("an object") {
            adjustments[key] = value.clone();
        }
        adjustments
    }

    /// Lens blur on, with `overrides`.
    fn lens_blur(overrides: Value) -> Value {
        let mut adjustments = json!({
            "lensBlurEnabled": true,
            "lensBlurAmount": 100,
            "lensBlurDepthMap": depth_map_url(160, 105),
            "lensBlurMinDepth": 30,
            "lensBlurMaxDepth": 60,
        });
        for (key, value) in overrides.as_object().expect("an object") {
            adjustments[key] = value.clone();
        }
        adjustments
    }

    /// Fog on, with `overrides` (an edit, so fog and lens blur can be combined).
    fn fog(overrides: Value) -> Value {
        let mut adjustments = json!({
            "fogEnabled": true,
            "fogAmount": 80,
            "fogDepthMap": depth_map_url(96, 64),
            "fogStart": 10,
            "fogDensity": 60,
            "fogHeight": 20,
            "fogVariation": 40,
            "fogGlow": 50,
        });
        for (key, value) in overrides.as_object().expect("an object") {
            adjustments[key] = value.clone();
        }
        adjustments
    }

    /// The RGBA half floats of `slot`.
    fn read_back(context: &GpuContext, slot: &Slot) -> Vec<f32> {
        let (w, h) = slot.size;
        let bytes = crate::gpu_processing::read_texture_data_roi(
            &context.device,
            &context.queue,
            &slot.texture,
            wgpu::Origin3d::ZERO,
            wgpu::Extent3d {
                width: w,
                height: h,
                depth_or_array_layers: 1,
            },
            8,
        )
        .expect("read back");
        bytemuck::cast_slice::<u8, half::f16>(&bytes)
            .iter()
            .map(|v| v.to_f32())
            .collect()
    }

    /// How the GPU render of a source differs from the CPU one, per value and relative to it
    /// where it is above 1: the largest difference, the mean one, and the mean signed one
    /// (`bias`, negative when the GPU comes out lower). `flips` counts the pixels black on one
    /// side only, which the other numbers leave out: a warped source that lies within f32
    /// rounding of the image's edge is black on one side and the edge colour on the other.
    struct Difference {
        worst: f32,
        mean: f32,
        bias: f32,
        flips: usize,
    }

    fn gpu_cpu_difference(context: &GpuContext, source: &RenderSource) -> Difference {
        let gpu = read_back(context, &source.render(context).expect("GPU stages"));
        let cpu = crate::gpu_compute::rgba_halves(&source.render_on_cpu());
        assert_eq!(gpu.len(), cpu.len());
        let is_black = |rgb: [f32; 3]| rgb == [0.0; 3];
        let mut flips = 0;
        let mut errors = Vec::with_capacity(gpu.len());
        for (g, c) in gpu.chunks_exact(4).zip(cpu.chunks_exact(4)) {
            let c = [c[0].to_f32(), c[1].to_f32(), c[2].to_f32()];
            if is_black([g[0], g[1], g[2]]) != is_black(c) {
                flips += 1;
                continue;
            }
            errors.extend((0..3).map(|i| (g[i] - c[i]) / c[i].abs().max(1.0)));
        }
        let count = errors.len() as f32;
        Difference {
            worst: errors.iter().map(|e| e.abs()).fold(0.0f32, f32::max),
            mean: errors.iter().map(|e| e.abs()).sum::<f32>() / count,
            bias: errors.iter().sum::<f32>() / count,
            flips,
        }
    }

    /// The edge flips (`Difference::flips`) a source may show: none without a warp, and at most
    /// one pixel in a thousand with one.
    fn flip_limit(source: &RenderSource) -> usize {
        match source.warp {
            Some(_) => {
                let (w, h) = source.size();
                (w * h / 1000) as usize
            }
            None => 0,
        }
    }

    /// Compares `source` on the GPU and the CPU, prints the numbers under `name`, and records
    /// a failure when they pass the limits, so a run reports every case.
    fn compare(
        context: &GpuContext,
        name: &str,
        source: &RenderSource,
        failures: &mut Vec<String>,
    ) {
        let Difference {
            worst,
            mean,
            bias,
            flips,
        } = gpu_cpu_difference(context, source);
        eprintln!("{name}: worst {worst:.2e}, mean {mean:.2e}, bias {bias:+.2e}, flips {flips}");
        if worst > 2e-3 || mean > mean_limit(source) || flips > flip_limit(source) {
            failures.push(format!(
                "{name}: worst {worst}, mean {mean}, bias {bias}, flips {flips}"
            ));
        }
    }

    /// The largest mean difference an effect may show. A fine rotation resamples the effect's
    /// half-float output, a second rounding the CPU (f32 until the end) does not have; it adds
    /// about 1.2e-4 to the mean whatever the effect (owner's Mac run, 2026-11-17).
    fn mean_limit(source: &RenderSource) -> f32 {
        if source.frame.rotates() { 3e-4 } else { 2e-4 }
    }

    /// The GPU stages render what the CPU ones do, within half-float rounding (decision 1 in
    /// `GPU_COMPUTE_PLAN.md`: the final 8-bit output may move by under a quarter step).
    #[test]
    fn gpu_frame_and_downscale_match_the_cpu() {
        let Some(context) = crate::gpu_processing::headless_gpu_context() else {
            eprintln!("No GPU adapter; skipping the GPU frame comparison.");
            return;
        };
        let image = ramp(301, 197);
        for adjustments in frames() {
            for fit in [None, Some((120, 120))] {
                let mut source = RenderSource::edited(&image, 0, &adjustments);
                source.output_fit = fit;
                let Difference {
                    worst,
                    mean,
                    bias,
                    flips,
                } = gpu_cpu_difference(&context, &source);
                eprintln!(
                    "frame {adjustments} {fit:?}: worst {worst:.2e}, mean {mean:.2e}, bias {bias:+.2e}, flips {flips}"
                );
                // Two half-float roundings of values up to 1.5.
                assert!(worst <= 2e-3, "{adjustments} {fit:?}: worst {worst}");
                assert_eq!(flips, 0, "{adjustments} {fit:?}");
            }
        }
    }

    /// A photo-like test image: gradients, hard edges and a few highlights above 1, which the
    /// bokeh energy weighting brightens.
    fn scene(width: u32, height: u32) -> DynamicImage {
        DynamicImage::ImageRgb32F(image::ImageBuffer::from_fn(width, height, |x, y| {
            let checker = ((x / 23 + y / 17) % 2) as f32;
            let highlight = x % 97 == 40 && y % 61 == 30;
            let lift = if highlight { 2.5 } else { 0.0 };
            image::Rgb([
                0.15 + 0.6 * x as f32 / width as f32 + lift,
                0.1 + 0.5 * checker + lift,
                0.8 * y as f32 / height as f32 + lift,
            ])
        }))
    }

    /// Lens blur on the GPU renders what the CPU version does (decision 3: the shader follows
    /// the fork's CPU result). Every shape, with and without diffusion, small kernels (under
    /// 3.5 working pixels, a full disc of taps) and large ones (golden-angle taps, smoothed above
    /// 7), the skipped case where almost nothing blurs, and with a frame after it.
    #[test]
    fn gpu_lens_blur_matches_the_cpu() {
        let Some(context) = crate::gpu_processing::headless_gpu_context() else {
            eprintln!("No GPU adapter; skipping the GPU lens blur comparison.");
            return;
        };
        let cases = [
            json!({}),
            json!({ "lensBlurShape": "hexagon" }),
            json!({ "lensBlurShape": "octagon", "lensBlurDiffusion": 40 }),
            json!({ "lensBlurShape": "ring", "lensBlurDiffusion": 100 }),
            json!({ "lensBlurDiffusion": 25, "lensBlurMinFade": 40, "lensBlurMaxFade": 5 }),
            json!({ "lensBlurAmount": 20 }),
            json!({ "lensBlurMinDepth": 0, "lensBlurMaxDepth": 100 }),
            json!({ "orientationSteps": 1, "rotation": 4.0,
                    "crop": { "x": 20.0, "y": 30.0, "width": 300.0, "height": 500.0 } }),
        ];
        let mut failures = Vec::new();
        for (width, height) in [(640, 420), (203, 151)] {
            let image = scene(width, height);
            for overrides in &cases {
                let adjustments = lens_blur(overrides.clone());
                let source = RenderSource::edited(&image, 0, &adjustments);
                assert!(source.effects.lens_blur.is_some(), "{overrides}");
                let name = format!("lens blur {width}x{height} {overrides}");
                compare(&context, &name, &source, &mut failures);
            }
        }
        assert!(failures.is_empty(), "{}", failures.join("\n"));
    }

    /// Fog on the GPU renders what the CPU version does: Fog Feather (the fork's, not in
    /// upstream's shader), with and without glow, height and patches, every orientation with
    /// flips (noise and height follow the display), warm and tinted fog, a late start, a
    /// low-resolution copy at full size (the small image), fog then lens blur, and a frame.
    #[test]
    fn gpu_fog_matches_the_cpu() {
        let Some(context) = crate::gpu_processing::headless_gpu_context() else {
            eprintln!("No GPU adapter; skipping the GPU fog comparison.");
            return;
        };
        let cases = [
            json!({}),
            json!({ "fogFeather": 60 }),
            json!({ "fogGlow": 0, "fogHeight": 0, "fogVariation": 0 }),
            json!({ "fogHeight": 80, "fogVariation": 100, "fogDensity": 100 }),
            json!({ "orientationSteps": 1, "flipHorizontal": true }),
            json!({ "orientationSteps": 2, "fogFeather": 25 }),
            json!({ "orientationSteps": 3, "flipVertical": true }),
            json!({ "fogTemperature": 60, "fogTint": -40, "fogAmount": 100 }),
            json!({ "fogStart": 70, "fogFeather": 100 }),
            lens_blur(json!({ "lensBlurDiffusion": 30 })),
            json!({ "rotation": -6.0,
                    "crop": { "x": 10.0, "y": 20.0, "width": 300.0, "height": 200.0 } }),
        ];
        let mut failures = Vec::new();
        for (width, height) in [(640, 420), (203, 151)] {
            let image = scene(width, height);
            for overrides in &cases {
                let adjustments = fog(overrides.clone());
                let source = RenderSource::edited(&image, 0, &adjustments);
                assert!(source.effects.fog.is_some(), "{overrides}");
                let name = format!("fog {width}x{height} {overrides}");
                compare(&context, &name, &source, &mut failures);
            }
        }
        assert!(failures.is_empty(), "{}", failures.join("\n"));
    }

    /// Relight on the GPU renders what the CPU version does: point, spot and directional
    /// lights, ambient only, shine and softness, shadows with and without softening, several
    /// coloured lights casting shadows, orientations (relight follows the unrotated image),
    /// relight then fog and lens blur, and a frame.
    #[test]
    fn gpu_relight_matches_the_cpu() {
        let Some(context) = crate::gpu_processing::headless_gpu_context() else {
            eprintln!("No GPU adapter; skipping the GPU relight comparison.");
            return;
        };
        let lights = |lights: Vec<Value>| json!({ "relightLights": lights });
        let cases = [
            json!({}),
            json!({ "relightLights": [], "relightAmbient": 40 }),
            lights(vec![light(
                json!({ "type": "spot", "cone": 30, "feather": 60,
                                      "angle": 200, "elevation": 40 }),
            )]),
            lights(vec![light(
                json!({ "type": "directional", "angle": 60, "elevation": 30 }),
            )]),
            json!({ "relightShine": 70, "relightSoftness": 5 }),
            json!({ "relightShadows": true, "relightShadowSoftness": 0 }),
            json!({ "relightShadows": true, "relightShadowSoftness": 40 }),
            json!({
                "relightShadows": true,
                "relightLights": [
                    light(json!({ "color": "#80a0ff", "temperature": -40, "x": 0.8 })),
                    light(json!({ "type": "directional", "tint": 30, "elevation": 20 })),
                    light(json!({ "type": "spot", "intensity": 120, "depth": 10, "y": 0.8 })),
                    light(json!({ "visible": false, "intensity": 400 })),
                ],
            }),
            json!({ "orientationSteps": 1, "flipHorizontal": true }),
            fog(lens_blur(json!({ "relightShadows": true }))),
            json!({ "rotation": 5.0,
                    "crop": { "x": 15.0, "y": 25.0, "width": 320.0, "height": 210.0 } }),
        ];
        let mut failures = Vec::new();
        for (width, height) in [(640, 420), (203, 151)] {
            let image = scene(width, height);
            for overrides in &cases {
                let adjustments = relight(overrides.clone());
                let source = RenderSource::edited(&image, 0, &adjustments);
                assert!(source.effects.relight.is_some(), "{overrides}");
                let name = format!("relight {width}x{height} {overrides}");
                compare(&context, &name, &source, &mut failures);
            }
        }
        assert!(failures.is_empty(), "{}", failures.join("\n"));
    }

    /// A lens profile's coefficients (`lensDistortionParams`).
    fn lens_profile(profile: Value) -> Value {
        json!({ "lensDistortionParams": profile })
    }

    /// The geometry warp on the GPU renders what the CPU version does: every perspective
    /// slider, Guided Perspective, Constrain Crop, manual distortion both ways, both lens
    /// profile models, TCA (black outside the image, the fork's rule), lens vignetting, then
    /// everything at once with a supersampled shrink, the effects and a frame after it.
    #[test]
    fn gpu_warp_matches_the_cpu() {
        let Some(context) = crate::gpu_processing::headless_gpu_context() else {
            eprintln!("No GPU adapter; skipping the GPU warp comparison.");
            return;
        };
        let guides = json!({
            "enabled": true,
            "lines": [
                { "type": "vertical", "p1": { "x": 0.2, "y": 0.1 }, "p2": { "x": 0.26, "y": 0.9 } },
                { "type": "vertical", "p1": { "x": 0.8, "y": 0.1 }, "p2": { "x": 0.73, "y": 0.9 } },
            ],
        });
        let everything = json!({
            "transformVertical": 15,
            "transformRotate": -2.0,
            "transformDistortion": -20,
            "lensDistortionParams": { "k1": -0.06, "tca_vr": 1.0015, "vig_k1": -0.25 },
            "orientationSteps": 1,
            "rotation": 3.0,
            "crop": { "x": 20.0, "y": 25.0, "width": 250.0, "height": 330.0 },
        });
        let cases = [
            json!({ "transformVertical": 30 }),
            json!({ "transformHorizontal": -25, "transformRotate": 3.5 }),
            json!({ "transformAspect": 20, "transformScale": 90,
                    "transformXOffset": 10, "transformYOffset": -8 }),
            json!({ "guidedPerspective": guides }),
            json!({ "transformVertical": -20, "transformConstrainCrop": true }),
            json!({ "transformDistortion": 40 }),
            json!({ "transformDistortion": -40 }),
            lens_profile(json!({ "k1": -0.08, "k2": 0.02, "k3": 0.004 })),
            json!({ "lensDistortionAmount": 70,
                    "lensDistortionParams": { "model": 1, "k1": 0.01, "k2": -0.04, "k3": 0.02 } }),
            json!({ "transformScale": 92,
                    "lensDistortionParams": { "tca_vr": 1.002, "tca_vb": 0.998 } }),
            json!({ "lensVignetteAmount": 80,
                    "lensDistortionParams": { "vig_k1": -0.3, "vig_k2": 0.05 } }),
            everything.clone(),
        ];
        let mut failures = Vec::new();
        for (width, height) in [(640, 420), (203, 151)] {
            let image = scene(width, height);
            for adjustments in &cases {
                let source = RenderSource::edited(&image, 0, adjustments);
                assert!(source.warp.is_some(), "{adjustments}");
                let name = format!("warp {width}x{height} {adjustments}");
                compare(&context, &name, &source, &mut failures);
            }
            // The editor preview's order: warped at twice the size, shrunk, then the effects.
            let adjustments = relight(fog(lens_blur(everything.clone())));
            let working = (width / 2, height / 2);
            let working_size = fitted_size((width, height), working).expect("a smaller size");
            let source = RenderSource::edited(&image, 0, &adjustments)
                .with_working_fit(Some(working))
                .with_effects(Effects::prepare(&adjustments, working_size));
            let name = format!("warp {width}x{height} supersampled with effects");
            compare(&context, &name, &source, &mut failures);
        }
        assert!(failures.is_empty(), "{}", failures.join("\n"));
    }
}
