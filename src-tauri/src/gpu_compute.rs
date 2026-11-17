//! Compute passes that prepare a photo on the GPU before the main shader (upstream
//! `15a9ff2e`, ported in steps; `docs/GPU_COMPUTE_PLAN.md`). Every pass shares one bind-group
//! layout, so a stage is a WGSL entry point plus its parameter struct. Intermediate textures
//! come from a small pool, so a render reuses the textures of the previous one.

use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};

use half::f16;
use half::slice::HalfFloatSliceExt;
use image::DynamicImage;
use rayon::prelude::*;
use wgpu::util::DeviceExt;

use crate::image_processing::GpuContext;

/// The format of every image a stage hands to the next, and of the main shader's input.
pub const IMAGE_FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Rgba16Float;
const WORKGROUP: u32 = 8;
/// Pooled textures kept between renders: at most this many bytes ...
const POOL_KEEP_BYTES: u64 = 768 << 20;
/// ... used within this many of the latest encodes.
const POOL_KEEP_ENCODES: u64 = 4;
const COMMON_SOURCE: &str = include_str!("shaders/compute_common.wgsl");

/// The first member of every stage's parameters (`Grid` in `compute_common.wgsl`). The
/// underscored fields are reserved for the stages still to come, at upstream's offsets.
#[repr(C)]
#[derive(Debug, Default, Copy, Clone, bytemuck::Pod, bytemuck::Zeroable)]
pub struct Grid {
    dst: [u32; 2],
    src: [u32; 2],
    _radius: u32,
    _channel: u32,
    flags: u32,
    _eps: f32,
}

impl Grid {
    pub fn new(dst: (u32, u32)) -> Self {
        Self {
            dst: [dst.0, dst.1],
            ..Default::default()
        }
    }

    pub fn with_src(self, src: (u32, u32)) -> Self {
        Self {
            src: [src.0, src.1],
            ..self
        }
    }

    pub fn with_flags(self, flags: u32) -> Self {
        Self { flags, ..self }
    }
}

/// A WGSL file of stages, compiled together with `compute_common.wgsl` on first use.
#[derive(Clone, Copy)]
pub enum Group {
    Transform,
}

impl Group {
    const ALL: [Group; 1] = [Group::Transform];

    fn source(self) -> (&'static str, &'static [&'static str]) {
        match self {
            Group::Transform => (
                include_str!("shaders/transform.wgsl"),
                &["tf_frame", "tf_downscale", "tf_grain"],
            ),
        }
    }
}

pub struct ComputePipelines {
    layout: wgpu::PipelineLayout,
    bgl: wgpu::BindGroupLayout,
    groups: [OnceLock<HashMap<&'static str, wgpu::ComputePipeline>>; Group::ALL.len()],
    dummy_f16: wgpu::TextureView,
    dummy_scratch: wgpu::Buffer,
    pool: Mutex<Vec<Slot>>,
    encodes: AtomicU64,
}

impl ComputePipelines {
    pub fn new(device: &wgpu::Device) -> Self {
        let entry = |binding: u32, ty: wgpu::BindingType| wgpu::BindGroupLayoutEntry {
            binding,
            visibility: wgpu::ShaderStages::COMPUTE,
            ty,
            count: None,
        };
        // Binding numbers follow upstream's layout, so later stages slot in unchanged.
        let entries = [
            entry(
                0,
                wgpu::BindingType::Texture {
                    sample_type: wgpu::TextureSampleType::Float { filterable: false },
                    view_dimension: wgpu::TextureViewDimension::D2,
                    multisampled: false,
                },
            ),
            entry(
                7,
                wgpu::BindingType::Buffer {
                    ty: wgpu::BufferBindingType::Uniform,
                    has_dynamic_offset: false,
                    min_binding_size: None,
                },
            ),
            entry(
                9,
                wgpu::BindingType::StorageTexture {
                    access: wgpu::StorageTextureAccess::WriteOnly,
                    format: IMAGE_FORMAT,
                    view_dimension: wgpu::TextureViewDimension::D2,
                },
            ),
            entry(
                11,
                wgpu::BindingType::Buffer {
                    ty: wgpu::BufferBindingType::Storage { read_only: false },
                    has_dynamic_offset: false,
                    min_binding_size: None,
                },
            ),
        ];
        let bgl = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("Compute BGL"),
            entries: &entries,
        });
        let layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("Compute Layout"),
            bind_group_layouts: &[Some(&bgl)],
            immediate_size: 0,
        });

        let dummy_f16 = device
            .create_texture(&wgpu::TextureDescriptor {
                label: Some("Compute Dummy"),
                size: wgpu::Extent3d {
                    width: 1,
                    height: 1,
                    depth_or_array_layers: 1,
                },
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format: IMAGE_FORMAT,
                usage: wgpu::TextureUsages::STORAGE_BINDING,
                view_formats: &[],
            })
            .create_view(&Default::default());
        let dummy_scratch = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("Compute Dummy Buffer"),
            size: 16,
            usage: wgpu::BufferUsages::STORAGE,
            mapped_at_creation: false,
        });

        Self {
            layout,
            bgl,
            groups: Default::default(),
            dummy_f16,
            dummy_scratch,
            pool: Mutex::new(Vec::new()),
            encodes: AtomicU64::new(0),
        }
    }

    /// Compiles every group now, so the first edit does not wait for it.
    pub fn warm(&self, device: &wgpu::Device) {
        for group in Group::ALL {
            self.compiled(device, group);
        }
    }

    fn pipeline(&self, device: &wgpu::Device, group: Group, entry: &str) -> &wgpu::ComputePipeline {
        &self.compiled(device, group)[entry]
    }

    fn compiled(
        &self,
        device: &wgpu::Device,
        group: Group,
    ) -> &HashMap<&'static str, wgpu::ComputePipeline> {
        self.groups[group as usize].get_or_init(|| {
            let (source, entries) = group.source();
            let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
                label: Some("Compute Shader"),
                source: wgpu::ShaderSource::Wgsl(format!("{}\n{}", source, COMMON_SOURCE).into()),
            });
            entries
                .iter()
                .map(|&name| {
                    let pipeline =
                        device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
                            label: Some(name),
                            layout: Some(&self.layout),
                            module: &shader,
                            entry_point: Some(name),
                            compilation_options: Default::default(),
                            cache: None,
                        });
                    (name, pipeline)
                })
                .collect()
        })
    }
}

/// A texture of `IMAGE_FORMAT`, read by later stages or by the main shader.
#[derive(Clone)]
pub struct Slot {
    pub texture: wgpu::Texture,
    pub view: wgpu::TextureView,
    pub size: (u32, u32),
    last_encode: u64,
}

impl Slot {
    fn bytes(&self) -> u64 {
        self.size.0 as u64 * self.size.1 as u64 * 8
    }
}

/// A pooled texture of one encode; it returns to the pool when dropped unless detached.
pub struct Tex {
    slot: Option<Slot>,
    free: Rc<RefCell<Vec<Slot>>>,
}

impl Tex {
    pub fn detach(mut self) -> Slot {
        self.slot.take().expect("a pooled texture is detached once")
    }
}

impl std::ops::Deref for Tex {
    type Target = Slot;

    fn deref(&self) -> &Slot {
        self.slot
            .as_ref()
            .expect("a pooled texture is detached once")
    }
}

impl Drop for Tex {
    fn drop(&mut self) {
        if let Some(slot) = self.slot.take() {
            self.free.borrow_mut().push(slot);
        }
    }
}

/// What a stage writes: an image, or only a scratch buffer of results.
#[derive(Clone, Copy)]
pub enum Out<'a> {
    F16(&'a wgpu::TextureView),
    Scratch(&'a wgpu::Buffer),
}

pub struct ComputeEncoder<'a> {
    device: &'a wgpu::Device,
    pipelines: &'a ComputePipelines,
    encode_index: u64,
    pub encoder: wgpu::CommandEncoder,
    free: Rc<RefCell<Vec<Slot>>>,
}

/// Records the stages `build` adds into one submission and waits for its errors, so a GPU
/// that runs out of memory or rejects a stage gives an `Err` the caller can fall back from.
pub fn encode<T>(
    context: &GpuContext,
    build: impl FnOnce(&mut ComputeEncoder) -> T,
) -> Result<T, String> {
    let device = &context.device;
    let pipelines = context.compute();
    let out_of_memory = device.push_error_scope(wgpu::ErrorFilter::OutOfMemory);
    let invalid = device.push_error_scope(wgpu::ErrorFilter::Validation);

    let free = std::mem::take(&mut *pipelines.pool.lock().unwrap_or_else(|e| e.into_inner()));
    let encode_index = pipelines.encodes.fetch_add(1, Ordering::Relaxed) + 1;
    let mut enc = ComputeEncoder {
        device,
        pipelines,
        encode_index,
        encoder: device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
            label: Some("Compute Encoder"),
        }),
        free: Rc::new(RefCell::new(free)),
    };
    let output = build(&mut enc);
    let ComputeEncoder { encoder, free, .. } = enc;
    context.queue.submit(Some(encoder.finish()));

    let invalid = pollster::block_on(invalid.pop());
    if let Some(error) = pollster::block_on(out_of_memory.pop()).or(invalid) {
        return Err(error.to_string());
    }

    let free = Rc::try_unwrap(free)
        .map(RefCell::into_inner)
        .unwrap_or_default();
    let mut pool = pipelines.pool.lock().unwrap_or_else(|e| e.into_inner());
    pool.extend(free);
    pool.retain(|slot| encode_index - slot.last_encode.min(encode_index) < POOL_KEEP_ENCODES);
    let mut kept = 0u64;
    let mut index = pool.len();
    while index > 0 {
        index -= 1;
        let bytes = pool[index].bytes();
        if kept + bytes > POOL_KEEP_BYTES {
            pool.remove(index);
        } else {
            kept += bytes;
        }
    }
    Ok(output)
}

/// `image` as RGBA half floats (alpha 1 when it has none), the layout of `IMAGE_FORMAT`.
pub fn rgba_halves(image: &DynamicImage) -> Vec<f16> {
    let convert = |src: &[f32], channels: usize, width: usize| {
        let mut halves = vec![f16::ZERO; src.len() / channels * 4];
        halves
            .par_chunks_exact_mut(width * 4)
            .zip(src.par_chunks_exact(width * channels))
            .for_each(|(out, row)| {
                let mut rgba = vec![1.0f32; width * 4];
                for (dst, px) in rgba
                    .as_chunks_mut::<4>()
                    .0
                    .iter_mut()
                    .zip(row.chunks_exact(channels))
                {
                    dst[..channels].copy_from_slice(px);
                }
                out.convert_from_f32_slice(&rgba);
            });
        halves
    };
    let width = image.width() as usize;
    match image {
        DynamicImage::ImageRgba32F(buffer) => convert(buffer.as_raw(), 4, width),
        DynamicImage::ImageRgb32F(buffer) => convert(buffer.as_raw(), 3, width),
        other if other.color().has_alpha() => convert(other.to_rgba32f().as_raw(), 4, width),
        other => convert(other.to_rgb32f().as_raw(), 3, width),
    }
}

/// Uploads `image` as a texture stages and the main shader can read.
pub fn upload_image(context: &GpuContext, image: &DynamicImage) -> Slot {
    let size = (image.width(), image.height());
    let texture = context.device.create_texture_with_data(
        &context.queue,
        &wgpu::TextureDescriptor {
            label: Some("Source Image"),
            size: wgpu::Extent3d {
                width: size.0,
                height: size.1,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: IMAGE_FORMAT,
            usage: wgpu::TextureUsages::TEXTURE_BINDING
                | wgpu::TextureUsages::COPY_DST
                | wgpu::TextureUsages::COPY_SRC,
            view_formats: &[],
        },
        wgpu::util::TextureDataOrder::MipMajor,
        bytemuck::cast_slice(&rgba_halves(image)),
    );
    let view = texture.create_view(&Default::default());
    Slot {
        texture,
        view,
        size,
        last_encode: 0,
    }
}

impl<'a> ComputeEncoder<'a> {
    /// A texture for one stage's output, from the pool when one of this size is free.
    pub fn texture(&self, label: &'static str, size: (u32, u32)) -> Tex {
        let reused = {
            let mut free = self.free.borrow_mut();
            free.iter()
                .rposition(|slot| slot.size == size)
                .map(|index| free.swap_remove(index))
        };
        let mut slot = reused.unwrap_or_else(|| {
            let texture = self.device.create_texture(&wgpu::TextureDescriptor {
                label: Some(label),
                size: wgpu::Extent3d {
                    width: size.0,
                    height: size.1,
                    depth_or_array_layers: 1,
                },
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format: IMAGE_FORMAT,
                usage: wgpu::TextureUsages::TEXTURE_BINDING
                    | wgpu::TextureUsages::STORAGE_BINDING
                    | wgpu::TextureUsages::COPY_SRC,
                view_formats: &[],
            });
            let view = texture.create_view(&Default::default());
            Slot {
                texture,
                view,
                size,
                last_encode: 0,
            }
        });
        slot.last_encode = self.encode_index;
        Tex {
            slot: Some(slot),
            free: Rc::clone(&self.free),
        }
    }

    pub fn buffer(&self, label: &'static str, bytes: &[u8]) -> wgpu::Buffer {
        self.device
            .create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some(label),
                contents: bytes,
                usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_SRC,
            })
    }

    /// Runs `entry` of `group` over `dst` (one invocation per pixel or block) reading `input`.
    pub fn run<P: bytemuck::Pod>(
        &mut self,
        group: Group,
        entry: &str,
        params: &P,
        dst: (u32, u32),
        input: &wgpu::TextureView,
        out: Out,
    ) {
        let pipes = self.pipelines;
        let uniform = self
            .device
            .create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some("Compute Params"),
                contents: bytemuck::bytes_of(params),
                usage: wgpu::BufferUsages::UNIFORM,
            });
        let (output, scratch) = match out {
            Out::F16(view) => (view, &pipes.dummy_scratch),
            Out::Scratch(buffer) => (&pipes.dummy_f16, buffer),
        };
        let bind_group = self.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("Compute BG"),
            layout: &pipes.bgl,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: wgpu::BindingResource::TextureView(input),
                },
                wgpu::BindGroupEntry {
                    binding: 7,
                    resource: uniform.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 9,
                    resource: wgpu::BindingResource::TextureView(output),
                },
                wgpu::BindGroupEntry {
                    binding: 11,
                    resource: scratch.as_entire_binding(),
                },
            ],
        });
        let mut pass = self.encoder.begin_compute_pass(&Default::default());
        pass.set_pipeline(pipes.pipeline(self.device, group, entry));
        pass.set_bind_group(0, &bind_group, &[]);
        pass.dispatch_workgroups(dst.0.div_ceil(WORKGROUP), dst.1.div_ceil(WORKGROUP), 1);
    }
}

/// `group` parsed with the shared source exactly as `compiled` builds it, for tests that
/// check a stage's parameters against its WGSL struct.
#[cfg(test)]
pub(crate) fn group_module(group: Group) -> wgpu::naga::Module {
    let (source, _) = group.source();
    wgpu::naga::front::wgsl::parse_str(&format!("{}\n{}", source, COMMON_SOURCE))
        .expect("compute WGSL should parse")
}

/// The byte size of the WGSL struct `name` in `module`.
#[cfg(test)]
pub(crate) fn struct_span(module: &wgpu::naga::Module, name: &str) -> usize {
    module
        .types
        .iter()
        .find_map(|(_, ty)| match (&ty.name, &ty.inner) {
            (Some(n), wgpu::naga::TypeInner::Struct { span, .. }) if n == name => {
                Some(*span as usize)
            }
            _ => None,
        })
        .unwrap_or_else(|| panic!("{name} missing from the shader"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_group_validates_and_has_its_entry_points() {
        for group in Group::ALL {
            let module = group_module(group);
            wgpu::naga::valid::Validator::new(
                wgpu::naga::valid::ValidationFlags::all(),
                wgpu::naga::valid::Capabilities::all(),
            )
            .validate(&module)
            .expect("compute WGSL should validate");
            assert_eq!(struct_span(&module, "Grid"), size_of::<Grid>());
            for name in group.source().1 {
                assert!(
                    module.entry_points.iter().any(|entry| entry.name == *name),
                    "{name} missing"
                );
            }
        }
    }

    #[test]
    fn halves_keep_the_alpha_or_add_an_opaque_one() {
        let rgb = DynamicImage::ImageRgb32F(image::ImageBuffer::from_pixel(
            3,
            2,
            image::Rgb([0.25, 0.5, 2.0]),
        ));
        let halves = rgba_halves(&rgb);
        assert_eq!(halves.len(), 3 * 2 * 4);
        assert!(
            halves
                .chunks_exact(4)
                .all(|px| px.iter().map(|v| v.to_f32()).eq([0.25, 0.5, 2.0, 1.0]))
        );

        let rgba = DynamicImage::ImageRgba32F(image::ImageBuffer::from_pixel(
            2,
            2,
            image::Rgba([0.1, 0.2, 0.3, 0.0]),
        ));
        assert_eq!(rgba_halves(&rgba)[3].to_f32(), 0.0);
    }
}
