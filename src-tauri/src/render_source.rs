//! What a render starts from: an image prepared on the CPU plus the stages that turn it into
//! the main shader's input on the GPU (upstream `15a9ff2e`; `docs/GPU_COMPUTE_PLAN.md`).
//! The GPU runs lens blur, then the frame (orientation, flips, rotation, crop) and the output
//! downscale; the geometry warp, relight and fog still run on the CPU before
//! (`adjustment_utils::apply_warp_relight_and_fog`). The same stages run on the CPU when the
//! GPU ones fail (`render_on_cpu`), and are the reference the GPU stages are tested against.

use std::borrow::Cow;
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::sync::Arc;

use image::{DynamicImage, GenericImageView};
use serde_json::Value;

use crate::gpu_compute::{Bind, Grid, Group, IMAGE_FORMAT, Out, Slot};
use crate::image_processing::{
    Crop, GpuContext, apply_coarse_rotation, apply_flip, apply_rotation, crop_rect,
    downscale_f32_image, fitted_size,
};
use crate::lens_blur::LensBlur;

const FRAME_ROTATE: u32 = 1;

/// The parameters of every stage in `shaders/transform.wgsl` (its `Params`).
#[repr(C)]
#[derive(Debug, Default, Copy, Clone, bytemuck::Pod, bytemuck::Zeroable)]
pub(crate) struct TransformParams {
    grid: Grid,
    orientation: u32,
    _pad: [u32; 3],
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

/// The spatial effects the GPU runs before the frame, read from an edit for an image of one
/// size (the effects scale with it).
#[derive(Clone, Default)]
pub struct Effects {
    lens_blur: Option<Arc<LensBlur>>,
}

impl Effects {
    pub fn prepare(adjustments: &Value, size: (u32, u32)) -> Self {
        Self {
            lens_blur: crate::lens_blur::prepare(adjustments, size).map(Arc::new),
        }
    }

    fn hash_into(&self, hasher: &mut impl Hasher) {
        self.lens_blur.is_some().hash(hasher);
        if let Some(job) = &self.lens_blur {
            job.hash_into(hasher);
        }
    }

    fn encode(&self, enc: &mut crate::gpu_compute::ComputeEncoder, src: Slot) -> Slot {
        let Some(job) = &self.lens_blur else {
            return src;
        };
        let blurred = enc.texture("Lens Blur Output", src.size, IMAGE_FORMAT);
        crate::lens_blur::encode(enc, job, &src, &blurred);
        blurred.detach()
    }

    fn apply_on_cpu<'a>(&self, image: Cow<'a, DynamicImage>) -> Cow<'a, DynamicImage> {
        match &self.lens_blur {
            Some(job) => job.apply_on_cpu(image),
            None => image,
        }
    }
}

/// An image for the main shader: `image` (already warped, relit and fogged), then `effects`,
/// then `frame`, then shrunk to fit `output_fit` when that is smaller.
pub struct RenderSource<'a> {
    pub image: &'a DynamicImage,
    /// Identifies `image`'s pixels; renders of the same id and stages reuse their GPU input.
    pub id: u64,
    pub effects: Effects,
    pub frame: Frame,
    pub output_fit: Option<(u32, u32)>,
}

impl<'a> RenderSource<'a> {
    pub fn new(image: &'a DynamicImage, id: u64, frame: Frame) -> Self {
        Self {
            image,
            id,
            effects: Effects::default(),
            frame,
            output_fit: None,
        }
    }

    /// `image` rendered as it is.
    pub fn plain(image: &'a DynamicImage, id: u64) -> Self {
        Self::new(image, id, Frame::default())
    }

    /// `image` with the effects and frame `adjustments` say, the crop in `image`'s pixels.
    pub fn edited(image: &'a DynamicImage, id: u64, adjustments: &Value) -> Self {
        Self::new(image, id, Frame::from_adjustments(adjustments))
            .with_effects(Effects::prepare(adjustments, image.dimensions()))
    }

    /// With `effects`, prepared for `image`'s size.
    pub fn with_effects(self, effects: Effects) -> Self {
        Self { effects, ..self }
    }

    /// Shrunk to fit inside `target`.
    pub fn fitted(self, target: (u32, u32)) -> Self {
        Self {
            output_fit: Some(target),
            ..self
        }
    }

    /// The crop's origin in `image`'s pixels, which masks are positioned from.
    pub fn crop_offset(&self) -> (f32, f32) {
        self.frame
            .crop
            .map_or((0.0, 0.0), |c| (c.x as f32, c.y as f32))
    }

    /// The size after the frame, before `output_fit`.
    pub fn framed_size(&self) -> (u32, u32) {
        self.frame.size(self.image.dimensions())
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
        (self.id, format!("{:?}", self.frame), self.output_fit).hash(&mut hasher);
        self.effects.hash_into(&mut hasher);
        hasher.finish()
    }

    /// Uploads `image` and runs the stages on the GPU.
    pub fn render(&self, context: &GpuContext) -> Result<Slot, String> {
        let source_size = self.image.dimensions();
        let framed_size = self.framed_size();
        let output_size = self.size();
        crate::gpu_compute::encode(context, |enc| {
            let source = crate::gpu_compute::upload_image(context, self.image);
            let effected = self.effects.encode(enc, source);
            let framed = if self.frame.is_identity(source_size) {
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
        let effected = self.effects.apply_on_cpu(Cow::Borrowed(self.image));
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
    fn the_cpu_render_runs_lens_blur_before_the_frame() {
        let image = scene(120, 90);
        let adjustments = lens_blur(json!({ "orientationSteps": 1 }));
        let source = RenderSource::edited(&image, 0, &adjustments);
        let blurred = crate::lens_blur::apply_lens_blur(Cow::Borrowed(&image), &adjustments);
        assert!(
            matches!(blurred, Cow::Owned(_)),
            "the test blur should change the image"
        );
        let expected = Frame::from_adjustments(&adjustments).apply_on_cpu(blurred);
        assert_eq!(
            source.render_on_cpu().to_rgb32f().as_raw(),
            expected.to_rgb32f().as_raw()
        );
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

        let image = ramp(64, 48);
        let blurred = lens_blur(json!({}));
        let key = RenderSource::edited(&image, 1, &blurred).key();
        assert_ne!(key, RenderSource::plain(&image, 1).key());
        assert_eq!(RenderSource::edited(&image, 1, &blurred).key(), key);
        assert_ne!(
            RenderSource::edited(&image, 1, &lens_blur(json!({ "lensBlurAmount": 70 }))).key(),
            key
        );
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

    /// The largest and the mean difference between the GPU and the CPU render of `source`,
    /// relative to the value where it is above 1.
    fn gpu_cpu_difference(context: &GpuContext, source: &RenderSource) -> (f32, f32) {
        let gpu = read_back(context, &source.render(context).expect("GPU stages"));
        let cpu = crate::gpu_compute::rgba_halves(&source.render_on_cpu());
        assert_eq!(gpu.len(), cpu.len());
        let errors: Vec<f32> = gpu
            .chunks_exact(4)
            .zip(cpu.chunks_exact(4))
            .flat_map(|(g, c)| {
                (0..3).map(move |i| {
                    let c = c[i].to_f32();
                    (g[i] - c).abs() / c.abs().max(1.0)
                })
            })
            .collect();
        let worst = errors.iter().copied().fold(0.0f32, f32::max);
        (worst, errors.iter().sum::<f32>() / errors.len() as f32)
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
                let (worst, _) = gpu_cpu_difference(&context, &source);
                // Two half-float roundings of values up to 1.5.
                assert!(worst <= 2e-3, "{adjustments} {fit:?}: worst {worst}");
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
        for (width, height) in [(640, 420), (203, 151)] {
            let image = scene(width, height);
            for overrides in &cases {
                let adjustments = lens_blur(overrides.clone());
                let source = RenderSource::edited(&image, 0, &adjustments);
                assert!(source.effects.lens_blur.is_some(), "{overrides}");
                let (worst, mean) = gpu_cpu_difference(&context, &source);
                eprintln!(
                    "lens blur {width}x{height} {overrides}: worst {worst:.2e}, mean {mean:.2e}"
                );
                assert!(
                    worst <= 2e-3 && mean <= 2e-4,
                    "{width}x{height} {overrides}: worst {worst}, mean {mean}"
                );
            }
        }
    }
}
