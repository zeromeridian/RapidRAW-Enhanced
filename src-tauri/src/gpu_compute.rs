//! Compute passes that prepare a photo on the GPU before the main shader (upstream
//! `15a9ff2e`, ported in steps; `docs/GPU_COMPUTE_PLAN.md`). Every pass shares one bind-group
//! layout, so a stage is a WGSL entry point plus its parameter struct. Intermediate textures
//! come from a small pool, so a render reuses the textures of the previous one.

use std::cell::RefCell;
use std::collections::HashMap;
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
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
/// An effect's working planes: four channels, or one.
pub const F32X4: wgpu::TextureFormat = wgpu::TextureFormat::Rgba32Float;
pub const R32: wgpu::TextureFormat = wgpu::TextureFormat::R32Float;
/// `box_h`/`box_v` keep the input's third and fourth channels.
pub const KEEP_ZW: u32 = 1;
/// `area_down` averages the RGB instead of the square-root luma.
pub const RGB_MODE: u32 = 2;
const WORKGROUP: u32 = 8;
/// Input textures a stage can read (`t0`–`t5`).
const INPUTS: usize = 6;
/// The layered `F32X4` texture a stage can read (`layers`, `ComputeEncoder::layered`).
const LAYERS_BINDING: u32 = 6;
/// Pooled textures kept between renders: at most this many bytes ...
const POOL_KEEP_BYTES: u64 = 768 << 20;
/// ... used within this many of the latest encodes.
const POOL_KEEP_ENCODES: u64 = 4;
/// Uploaded effect maps (`cached_map`) kept between renders.
const MAP_CACHE_ENTRIES: usize = 6;
const MAP_CACHE_BYTES: u64 = 256 << 20;
const COMMON_SOURCE: &str = include_str!("shaders/compute_common.wgsl");
/// The parameters of the stages in `compute_common.wgsl` itself (`Group::Common`).
const COMMON_PARAMS: &str =
    "struct Params { grid: Grid }\n@group(0) @binding(7) var<uniform> params: Params;\n";

/// The first member of every stage's parameters (`Grid` in `compute_common.wgsl`).
#[repr(C)]
#[derive(Debug, Default, Copy, Clone, bytemuck::Pod, bytemuck::Zeroable)]
pub struct Grid {
    pub dst: [u32; 2],
    pub src: [u32; 2],
    pub radius: u32,
    pub channel: u32,
    pub flags: u32,
    pub eps: f32,
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
    Common,
    Transform,
    Relight,
    Fog,
    LensBlur,
}

impl Group {
    const ALL: [Group; 5] = [
        Group::Common,
        Group::Transform,
        Group::Relight,
        Group::Fog,
        Group::LensBlur,
    ];

    fn source(self) -> (&'static str, &'static [&'static str]) {
        match self {
            Group::Common => (
                COMMON_PARAMS,
                &["box_h", "box_v", "area_down", "gf_pack", "gf_coeffs"],
            ),
            Group::Transform => (
                include_str!("shaders/transform.wgsl"),
                &["tf_frame", "tf_downscale", "tf_grain"],
            ),
            Group::Relight => (
                include_str!("shaders/relight.wgsl"),
                &["rl_merge", "rl_depth", "rl_shadow", "rl_apply"],
            ),
            Group::Fog => (
                include_str!("shaders/fog.wgsl"),
                &["fog_noise_map", "fog_stats", "fog_bloom", "fog_apply"],
            ),
            Group::LensBlur => (
                include_str!("shaders/lens_blur.wgsl"),
                &[
                    "lb_luma",
                    "lb_guide",
                    "lb_pack",
                    "lb_coeffs",
                    "lb_coc",
                    "lb_median_h",
                    "lb_median_v",
                    "lb_down",
                    "lb_tiles",
                    "lb_gather",
                    "lb_accum",
                    "lb_lin",
                    "lb_bloom",
                    "lb_final",
                ],
            ),
        }
    }
}

pub struct ComputePipelines {
    layout: wgpu::PipelineLayout,
    bgl: wgpu::BindGroupLayout,
    groups: [OnceLock<HashMap<&'static str, wgpu::ComputePipeline>>; Group::ALL.len()],
    dummy_view: wgpu::TextureView,
    dummy_layers: wgpu::TextureView,
    dummy_f32: wgpu::TextureView,
    dummy_f16: wgpu::TextureView,
    dummy_r32: wgpu::TextureView,
    dummy_scratch: wgpu::Buffer,
    dummy_data: wgpu::Buffer,
    pool: Mutex<Vec<Slot>>,
    /// Uploaded effect maps by `cached_map` key, least recently used first.
    maps: Mutex<Vec<(u64, Slot)>>,
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
        let storage = |format| wgpu::BindingType::StorageTexture {
            access: wgpu::StorageTextureAccess::WriteOnly,
            format,
            view_dimension: wgpu::TextureViewDimension::D2,
        };
        let buffer = |ty| wgpu::BindingType::Buffer {
            ty,
            has_dynamic_offset: false,
            min_binding_size: None,
        };
        let sampled = |view_dimension| wgpu::BindingType::Texture {
            sample_type: wgpu::TextureSampleType::Float { filterable: false },
            view_dimension,
            multisampled: false,
        };
        // Binding numbers follow upstream's layout, so later stages slot in unchanged.
        let mut entries: Vec<wgpu::BindGroupLayoutEntry> = (0..INPUTS as u32)
            .map(|binding| entry(binding, sampled(wgpu::TextureViewDimension::D2)))
            .collect();
        entries.extend([
            entry(LAYERS_BINDING, sampled(wgpu::TextureViewDimension::D2Array)),
            entry(7, buffer(wgpu::BufferBindingType::Uniform)),
            entry(8, storage(F32X4)),
            entry(9, storage(IMAGE_FORMAT)),
            entry(10, storage(R32)),
            entry(
                11,
                buffer(wgpu::BufferBindingType::Storage { read_only: false }),
            ),
            entry(
                12,
                buffer(wgpu::BufferBindingType::Storage { read_only: true }),
            ),
        ]);
        let bgl = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("Compute BGL"),
            entries: &entries,
        });
        let layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("Compute Layout"),
            bind_group_layouts: &[Some(&bgl)],
            immediate_size: 0,
        });

        let dummy_texture = |format, usage| {
            device.create_texture(&wgpu::TextureDescriptor {
                label: Some("Compute Dummy"),
                size: wgpu::Extent3d {
                    width: 1,
                    height: 1,
                    depth_or_array_layers: 1,
                },
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format,
                usage,
                view_formats: &[],
            })
        };
        let dummy = |format, usage| dummy_texture(format, usage).create_view(&Default::default());
        let dummy_buffer = || {
            device.create_buffer(&wgpu::BufferDescriptor {
                label: Some("Compute Dummy Buffer"),
                size: 16,
                usage: wgpu::BufferUsages::STORAGE,
                mapped_at_creation: false,
            })
        };
        let written = wgpu::TextureUsages::STORAGE_BINDING;

        Self {
            layout,
            bgl,
            groups: Default::default(),
            dummy_view: dummy(F32X4, wgpu::TextureUsages::TEXTURE_BINDING),
            dummy_layers: layers_view(&dummy_texture(F32X4, wgpu::TextureUsages::TEXTURE_BINDING)),
            dummy_f32: dummy(F32X4, written),
            dummy_f16: dummy(IMAGE_FORMAT, written),
            dummy_r32: dummy(R32, written),
            dummy_scratch: dummy_buffer(),
            dummy_data: dummy_buffer(),
            pool: Mutex::new(Vec::new()),
            maps: Mutex::new(Vec::new()),
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

/// A view of every layer of `texture`, even when it has only one.
fn layers_view(texture: &wgpu::Texture) -> wgpu::TextureView {
    texture.create_view(&wgpu::TextureViewDescriptor {
        dimension: Some(wgpu::TextureViewDimension::D2Array),
        ..Default::default()
    })
}

/// A texture read by later stages or, in `IMAGE_FORMAT`, by the main shader.
#[derive(Clone)]
pub struct Slot {
    pub texture: wgpu::Texture,
    pub view: wgpu::TextureView,
    pub size: (u32, u32),
    format: wgpu::TextureFormat,
    /// The layers of a `ComputeEncoder::layered` texture (`view` shows them all).
    layers: Option<u32>,
    last_encode: u64,
}

impl Slot {
    /// A slot for `texture`; `layers` for a `ComputeEncoder::layered` one, whose view shows
    /// every layer (even when there is only one, as `layers` in WGSL expects).
    fn new(
        texture: wgpu::Texture,
        size: (u32, u32),
        format: wgpu::TextureFormat,
        layers: Option<u32>,
    ) -> Self {
        Self {
            view: match layers {
                Some(_) => layers_view(&texture),
                None => texture.create_view(&Default::default()),
            },
            texture,
            size,
            format,
            layers,
            last_encode: 0,
        }
    }

    fn bytes(&self) -> u64 {
        let texel = match self.format {
            F32X4 => 16,
            IMAGE_FORMAT => 8,
            _ => 4,
        };
        self.size.0 as u64 * self.size.1 as u64 * texel * self.layers.unwrap_or(1) as u64
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

/// The texture a stage writes (`out_f32`, `out_f16` or `out_r32`), if any.
#[derive(Clone, Copy)]
pub enum Out<'a> {
    F32(&'a wgpu::TextureView),
    F16(&'a wgpu::TextureView),
    R32(&'a wgpu::TextureView),
    None,
}

/// What else a stage binds: the textures it reads (`t0`, `t1`, … in order), a layered texture
/// (`layers`), the buffer it counts or writes results into (`scratch`) and the read-only values
/// it takes (`data`), and how many workgroups it runs when not one per 8×8 pixels (`groups`).
#[derive(Clone, Copy)]
pub struct Bind<'a> {
    inputs: &'a [&'a wgpu::TextureView],
    layers: Option<&'a wgpu::TextureView>,
    scratch: Option<&'a wgpu::Buffer>,
    data: Option<&'a wgpu::Buffer>,
    groups: Option<(u32, u32)>,
}

impl<'a> Bind<'a> {
    pub fn reading(inputs: &'a [&'a wgpu::TextureView]) -> Self {
        assert!(
            inputs.len() <= INPUTS,
            "a stage reads at most {INPUTS} textures"
        );
        Self {
            inputs,
            layers: None,
            scratch: None,
            data: None,
            groups: None,
        }
    }

    /// With `layers`, a `ComputeEncoder::layered` texture, when there is one.
    pub fn with_layers(self, layers: Option<&'a Slot>) -> Self {
        Self {
            layers: layers.map(|slot| &slot.view),
            ..self
        }
    }

    /// Runs `groups` workgroups, for a stage that is not one invocation per pixel.
    pub fn with_groups(self, groups: (u32, u32)) -> Self {
        Self {
            groups: Some(groups),
            ..self
        }
    }

    pub fn with_scratch(self, scratch: &'a wgpu::Buffer) -> Self {
        Self {
            scratch: Some(scratch),
            ..self
        }
    }

    pub fn with_data(self, data: Option<&'a wgpu::Buffer>) -> Self {
        Self { data, ..self }
    }
}

pub struct ComputeEncoder<'a> {
    device: &'a wgpu::Device,
    queue: &'a wgpu::Queue,
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
        queue: &context.queue,
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
        // A map uploaded by the failed encode may be incomplete.
        pipelines
            .maps
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clear();
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
    Slot::new(texture, size, IMAGE_FORMAT, None)
}

impl<'a> ComputeEncoder<'a> {
    /// A texture for one stage's output, from the pool when one of this size and format is
    /// free.
    pub fn texture(
        &self,
        label: &'static str,
        size: (u32, u32),
        format: wgpu::TextureFormat,
    ) -> Tex {
        self.pooled(label, size, format, None)
    }

    /// An `F32X4` texture of `layers` layers of `size`, which stages read as `layers`
    /// (`Bind::with_layers`) and which are filled by copying textures into them.
    pub fn layered(&self, label: &'static str, size: (u32, u32), layers: u32) -> Tex {
        self.pooled(label, size, F32X4, Some(layers.max(1)))
    }

    fn pooled(
        &self,
        label: &'static str,
        size: (u32, u32),
        format: wgpu::TextureFormat,
        layers: Option<u32>,
    ) -> Tex {
        let reused = {
            let mut free = self.free.borrow_mut();
            free.iter()
                .rposition(|slot| {
                    slot.size == size && slot.format == format && slot.layers == layers
                })
                .map(|index| free.swap_remove(index))
        };
        let mut slot = reused.unwrap_or_else(|| {
            let texture = self.device.create_texture(&wgpu::TextureDescriptor {
                label: Some(label),
                size: wgpu::Extent3d {
                    width: size.0,
                    height: size.1,
                    depth_or_array_layers: layers.unwrap_or(1),
                },
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format,
                usage: wgpu::TextureUsages::TEXTURE_BINDING
                    | wgpu::TextureUsages::STORAGE_BINDING
                    | wgpu::TextureUsages::COPY_SRC
                    | wgpu::TextureUsages::COPY_DST,
                view_formats: &[],
            });
            Slot::new(texture, size, format, layers)
        });
        slot.last_encode = self.encode_index;
        Tex {
            slot: Some(slot),
            free: Rc::clone(&self.free),
        }
    }

    /// Copies `src` into layer `layer` of `layers` (`layered`, the same size and format).
    pub fn copy_to_layer(&mut self, src: &Slot, layers: &Slot, layer: u32) {
        debug_assert!(src.size == layers.size && src.format == layers.format);
        self.encoder.copy_texture_to_texture(
            src.texture.as_image_copy(),
            wgpu::TexelCopyTextureInfo {
                texture: &layers.texture,
                mip_level: 0,
                origin: wgpu::Origin3d {
                    x: 0,
                    y: 0,
                    z: layer,
                },
                aspect: wgpu::TextureAspect::All,
            },
            wgpu::Extent3d {
                width: src.size.0,
                height: src.size.1,
                depth_or_array_layers: 1,
            },
        );
    }

    /// An effect map uploaded as `format` (`R32`, or `F32X4` with four values per texel), kept
    /// between renders by `name` and `map_key` (`effect_maps::effect_map_key`), so moving a
    /// slider does not upload it again.
    pub fn cached_map(
        &self,
        name: &'static str,
        map_key: u64,
        size: (u32, u32),
        format: wgpu::TextureFormat,
        values: impl FnOnce() -> Vec<f32>,
    ) -> Slot {
        let key = {
            let mut hasher = DefaultHasher::new();
            (name, map_key, size, format).hash(&mut hasher);
            hasher.finish()
        };
        let mut maps = self
            .pipelines
            .maps
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        if let Some(index) = maps.iter().position(|(k, _)| *k == key) {
            let entry = maps.remove(index);
            let slot = entry.1.clone();
            maps.push(entry);
            return slot;
        }
        let texture = self.device.create_texture_with_data(
            self.queue,
            &wgpu::TextureDescriptor {
                label: Some(name),
                size: wgpu::Extent3d {
                    width: size.0,
                    height: size.1,
                    depth_or_array_layers: 1,
                },
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format,
                usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
                view_formats: &[],
            },
            wgpu::util::TextureDataOrder::MipMajor,
            bytemuck::cast_slice(&values()),
        );
        let slot = Slot::new(texture, size, format, None);
        let mut bytes: u64 = maps.iter().map(|(_, map)| map.bytes()).sum();
        while !maps.is_empty()
            && (maps.len() >= MAP_CACHE_ENTRIES || bytes + slot.bytes() > MAP_CACHE_BYTES)
        {
            bytes -= maps.remove(0).1.bytes();
        }
        maps.push((key, slot.clone()));
        slot
    }

    pub fn buffer(&self, label: &'static str, bytes: &[u8]) -> wgpu::Buffer {
        self.device
            .create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some(label),
                contents: bytes,
                usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_SRC,
            })
    }

    /// Runs `entry` of `group` over `dst` (one invocation per pixel or block).
    pub fn run<P: bytemuck::Pod>(
        &mut self,
        group: Group,
        entry: &str,
        params: &P,
        dst: (u32, u32),
        out: Out,
        bind: Bind,
    ) {
        let pipes = self.pipelines;
        let uniform = self
            .device
            .create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some("Compute Params"),
                contents: bytemuck::bytes_of(params),
                usage: wgpu::BufferUsages::UNIFORM,
            });
        fn view(binding: u32, view: &wgpu::TextureView) -> wgpu::BindGroupEntry<'_> {
            wgpu::BindGroupEntry {
                binding,
                resource: wgpu::BindingResource::TextureView(view),
            }
        }
        let (f32_out, f16_out, r32_out) = match out {
            Out::F32(v) => (v, &pipes.dummy_f16, &pipes.dummy_r32),
            Out::F16(v) => (&pipes.dummy_f32, v, &pipes.dummy_r32),
            Out::R32(v) => (&pipes.dummy_f32, &pipes.dummy_f16, v),
            Out::None => (&pipes.dummy_f32, &pipes.dummy_f16, &pipes.dummy_r32),
        };
        let mut entries: Vec<wgpu::BindGroupEntry> = (0..INPUTS)
            .map(|i| {
                view(
                    i as u32,
                    bind.inputs.get(i).copied().unwrap_or(&pipes.dummy_view),
                )
            })
            .collect();
        entries.extend([
            view(LAYERS_BINDING, bind.layers.unwrap_or(&pipes.dummy_layers)),
            wgpu::BindGroupEntry {
                binding: 7,
                resource: uniform.as_entire_binding(),
            },
            view(8, f32_out),
            view(9, f16_out),
            view(10, r32_out),
            wgpu::BindGroupEntry {
                binding: 11,
                resource: bind
                    .scratch
                    .unwrap_or(&pipes.dummy_scratch)
                    .as_entire_binding(),
            },
            wgpu::BindGroupEntry {
                binding: 12,
                resource: bind.data.unwrap_or(&pipes.dummy_data).as_entire_binding(),
            },
        ]);
        let bind_group = self.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("Compute BG"),
            layout: &pipes.bgl,
            entries: &entries,
        });
        let mut pass = self.encoder.begin_compute_pass(&Default::default());
        pass.set_pipeline(pipes.pipeline(self.device, group, entry));
        pass.set_bind_group(0, &bind_group, &[]);
        let groups = bind
            .groups
            .unwrap_or((dst.0.div_ceil(WORKGROUP), dst.1.div_ceil(WORKGROUP)));
        pass.dispatch_workgroups(groups.0, groups.1, 1);
    }

    /// `passes` box blurs of `radius` (horizontal, then vertical, clamped at the edges) into
    /// `F32X4` textures; `flags` `KEEP_ZW` blurs only the first two channels. The CPU
    /// counterpart is `lens_blur::dof_box_filter`.
    pub fn blur(&mut self, src: Tex, radius: u32, passes: u32, flags: u32) -> Tex {
        let size = src.size;
        if radius == 0 || size.0 < 2 || size.1 < 2 {
            return src;
        }
        let grid = Grid {
            radius,
            flags,
            ..Grid::new(size)
        };
        let mut current = src;
        for _ in 0..passes {
            let across = self.texture("Compute Box", size, F32X4);
            let out = self.texture("Compute Box", size, F32X4);
            self.run(
                Group::Common,
                "box_h",
                &grid,
                size,
                Out::F32(&across.view),
                Bind::reading(&[&current.view]),
            );
            self.run(
                Group::Common,
                "box_v",
                &grid,
                size,
                Out::F32(&out.view),
                Bind::reading(&[&across.view]),
            );
            current = out;
        }
        current
    }

    /// `src` shrunk to `size` by averaging blocks into an `F32X4` texture: the RGB with
    /// `RGB_MODE`, else the square-root luma in the first channel.
    pub fn area_down(&mut self, src: &Slot, size: (u32, u32), flags: u32) -> Tex {
        let out = self.texture("Compute Area", size, F32X4);
        self.run(
            Group::Common,
            "area_down",
            &Grid::new(size).with_src(src.size).with_flags(flags),
            size,
            Out::F32(&out.view),
            Bind::reading(&[&src.view]),
        );
        out
    }

    /// A guided filter of channel `channel` of `p` by `guide`'s first (the same size): its
    /// slope and offset per texel, which `guided` in WGSL applies. The CPU counterpart is
    /// `relight::build_guided_model`.
    pub fn guided_model(
        &mut self,
        guide: &Slot,
        p: &Slot,
        channel: u32,
        radius: u32,
        eps: f32,
    ) -> Tex {
        let size = guide.size;
        let grid = Grid {
            channel,
            eps,
            ..Grid::new(size)
        };
        let packed = self.texture("Compute Guided", size, F32X4);
        self.run(
            Group::Common,
            "gf_pack",
            &grid,
            size,
            Out::F32(&packed.view),
            Bind::reading(&[&guide.view, &p.view]),
        );
        let means = self.blur(packed, radius, 1, 0);
        let coeffs = self.texture("Compute Guided", size, F32X4);
        self.run(
            Group::Common,
            "gf_coeffs",
            &grid,
            size,
            Out::F32(&coeffs.view),
            Bind::reading(&[&means.view]),
        );
        self.blur(coeffs, radius, 1, 0)
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

    /// `store_half` in `compute_common.wgsl` rounds to the half float the CPU's conversion
    /// gives (ties to even), as a value a half float holds exactly: its arithmetic here.
    #[test]
    fn store_half_rounds_like_the_cpu_conversion() {
        let store_half = |v: f32| {
            let bits = v.to_bits();
            f32::from_bits((bits + 0x0fff + ((bits >> 13) & 1)) & 0xffff_e000)
        };
        let step = f16::EPSILON.to_f32();
        let mut values = vec![
            0.0f32,
            1.0,
            1.0 + step / 2.0,
            1.0 + step * 1.5,
            2.0 - step / 4.0,
        ];
        values.extend(
            (0..20_000)
                .map(|i| 6.2e-5 * 1.0011f32.powi(i))
                .take_while(|v| *v < 6.0e4),
        );
        for v in values.iter().flat_map(|v| [*v, -*v]) {
            let rounded = store_half(v);
            let expected = f16::from_f32(v).to_f32();
            assert_eq!(rounded, expected, "{v}");
            assert_eq!(
                f16::from_f32(rounded).to_f32(),
                rounded,
                "{v} is a half float"
            );
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
