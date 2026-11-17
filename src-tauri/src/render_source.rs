//! What a render starts from: an image prepared on the CPU plus the stages that turn it into
//! the main shader's input on the GPU (upstream `15a9ff2e`; `docs/GPU_COMPUTE_PLAN.md`).
//! Step 1 runs the frame (orientation, flips, rotation, crop) and the output downscale on the
//! GPU; the geometry warp and the spatial effects still run on the CPU before
//! (`adjustment_utils::apply_warp_and_effects`). The same stages run on the CPU when the GPU
//! ones fail (`render_on_cpu`), and are the reference the GPU stages are tested against.

use std::borrow::Cow;
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};

use image::{DynamicImage, GenericImageView};
use serde_json::Value;

use crate::gpu_compute::{Grid, Group, Out, Slot};
use crate::image_processing::{
    Crop, GpuContext, apply_coarse_rotation, apply_flip, apply_rotation, crop_rect,
    downscale_f32_image, fitted_size,
};

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
            &src.view,
            Out::F16(&dst.view),
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
        &src.view,
        Out::F16(&dst.view),
    );
}

/// An image for the main shader: `image` (already warped and with its spatial effects), then
/// `frame`, then shrunk to fit `output_fit` when that is smaller.
pub struct RenderSource<'a> {
    pub image: &'a DynamicImage,
    /// Identifies `image`'s pixels; renders of the same id and stages reuse their GPU input.
    pub id: u64,
    pub frame: Frame,
    pub output_fit: Option<(u32, u32)>,
}

impl<'a> RenderSource<'a> {
    pub fn new(image: &'a DynamicImage, id: u64, frame: Frame) -> Self {
        Self {
            image,
            id,
            frame,
            output_fit: None,
        }
    }

    /// `image` rendered as it is.
    pub fn plain(image: &'a DynamicImage, id: u64) -> Self {
        Self::new(image, id, Frame::default())
    }

    /// `image` framed as `adjustments` say, its crop in `image`'s pixels.
    pub fn edited(image: &'a DynamicImage, id: u64, adjustments: &Value) -> Self {
        Self::new(image, id, Frame::from_adjustments(adjustments))
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
        hasher.finish()
    }

    /// Uploads `image` and runs the stages on the GPU.
    pub fn render(&self, context: &GpuContext) -> Result<Slot, String> {
        let source_size = self.image.dimensions();
        let framed_size = self.framed_size();
        let output_size = self.size();
        crate::gpu_compute::encode(context, |enc| {
            let source = crate::gpu_compute::upload_image(context, self.image);
            let framed = if self.frame.is_identity(source_size) {
                source
            } else {
                let framed = enc.texture("Framed Source", framed_size);
                self.frame.encode(enc, &source, &framed);
                framed.detach()
            };
            if output_size == framed_size {
                return framed;
            }
            let fitted = enc.texture("Fitted Source", output_size);
            downscale(enc, &framed, &fitted);
            fitted.detach()
        })
    }

    /// The same stages on the CPU: the fallback when the GPU ones fail.
    pub fn render_on_cpu(&self) -> Cow<'a, DynamicImage> {
        let framed = self.frame.apply_on_cpu(Cow::Borrowed(self.image));
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
                let gpu = read_back(&context, &source.render(&context).expect("GPU stages"));
                let cpu = crate::gpu_compute::rgba_halves(&source.render_on_cpu());
                assert_eq!(gpu.len(), cpu.len(), "{adjustments} {fit:?}");
                let worst = gpu
                    .chunks_exact(4)
                    .zip(cpu.chunks_exact(4))
                    .flat_map(|(g, c)| (0..3).map(move |i| (g[i] - c[i].to_f32()).abs()))
                    .fold(0.0f32, f32::max);
                // Two half-float roundings of values up to 1.5.
                assert!(worst <= 2e-3, "{adjustments} {fit:?}: worst {worst}");
            }
        }
    }
}
