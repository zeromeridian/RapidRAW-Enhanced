use std::sync::Arc;
use std::time::Instant;

use half::f16;
use image::{DynamicImage, GenericImageView, ImageBuffer, Luma, Rgba};
use std::num::NonZero;

#[cfg(not(any(target_os = "android", target_os = "linux")))]
use tauri::Manager;
use wgpu::util::{DeviceExt, TextureDataOrder};

use crate::image_processing::{AllAdjustments, GpuContext, MAX_MASKS};
use crate::lut_processing::Lut;
use crate::{AppState, GpuImageCache};

#[derive(Clone, Copy, Debug)]
pub struct Roi {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum RenderOutputPrecision {
    #[default]
    EightBit,
    SixteenBit,
}

/// A render that returns, instead of finished pixels, the colour a targeted adjustment
/// reads at its stage of `shader.wgsl` (its `SAMPLE_PROBE_*` constants).
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SampleProbe {
    /// Hue, saturation and value before the colour mixer.
    Hsl,
    /// Red, green, blue and luma before the global tone curve.
    Curve,
    /// Red, green, blue and luma before the mask tone curves.
    MaskCurve,
    /// The perceptual hue, saturation and luma Point Color selects by, after the colour mixer.
    PointColor,
}

impl SampleProbe {
    const COUNT: usize = 4;

    fn index(self) -> usize {
        self as usize
    }

    /// The shader's `SAMPLE_PROBE` value; 0 is the normal render.
    fn shader_value(self) -> f64 {
        (self.index() + 1) as f64
    }
}

pub struct RenderRequest<'a> {
    pub adjustments: AllAdjustments,
    pub mask_bitmaps: &'a [ImageBuffer<Luma<u8>, Vec<u8>>],
    pub lut: Option<Arc<Lut>>,
    pub roi: Option<Roi>,
    pub motion_blur: crate::motion_blur::MotionBlurs,
    pub probe: Option<SampleProbe>,
}

fn flare_generation_amount(adjustments: &AllAdjustments) -> f32 {
    adjustments.mask_adjustments[..(adjustments.mask_count as usize).min(MAX_MASKS)]
        .iter()
        .fold(adjustments.global.flare_amount, |amount, mask| {
            amount.max(mask.flare_amount)
        })
        .max(0.0)
}

#[repr(C)]
#[derive(Debug, Copy, Clone, bytemuck::Pod, bytemuck::Zeroable)]
pub struct DisplayTransform {
    pub rect: [f32; 4],
    pub clip: [f32; 4],
    pub window: [f32; 2],
    pub image_size: [f32; 2],
    pub texture_size: [f32; 2],
    pub pixelated: f32,
    pub _pad: f32,
    pub bg_primary: [f32; 4],
    pub bg_secondary: [f32; 4],
}

pub struct WgpuDisplay {
    pub surface: wgpu::Surface<'static>,
    pub config: wgpu::SurfaceConfiguration,
    pub pipeline: wgpu::RenderPipeline,
    pub bind_group_layout: wgpu::BindGroupLayout,
    pub sampler: wgpu::Sampler,
    pub transform_buffer: wgpu::Buffer,
    pub latest_transform: DisplayTransform,
    pub current_bind_group: Option<wgpu::BindGroup>,
    pub is_visible: bool,
    /// Keeps the last presented frame on screen: while set, nothing is presented, so a new photo can finish
    /// rendering behind the previous one and appear only once the frontend has moved the display to it.
    pub hold_frame: bool,
}

impl WgpuDisplay {
    pub fn render(&mut self, device: &wgpu::Device, queue: &wgpu::Queue) {
        if self.hold_frame {
            return;
        }
        let output = match self.surface.get_current_texture() {
            wgpu::CurrentSurfaceTexture::Success(tex)
            | wgpu::CurrentSurfaceTexture::Suboptimal(tex) => tex,
            wgpu::CurrentSurfaceTexture::Outdated | wgpu::CurrentSurfaceTexture::Lost => {
                self.surface.configure(device, &self.config);
                match self.surface.get_current_texture() {
                    wgpu::CurrentSurfaceTexture::Success(tex)
                    | wgpu::CurrentSurfaceTexture::Suboptimal(tex) => tex,
                    _ => panic!("Failed to acquire surface texture"),
                }
            }
            _ => return,
        };
        let view = output
            .texture
            .create_view(&wgpu::TextureViewDescriptor::default());
        let mut encoder =
            device.create_command_encoder(&wgpu::CommandEncoderDescriptor { label: None });
        {
            let mut rpass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: None,
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &view,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color {
                            r: if self.is_visible {
                                self.latest_transform.bg_primary[0] as f64
                            } else {
                                0.0
                            },
                            g: if self.is_visible {
                                self.latest_transform.bg_primary[1] as f64
                            } else {
                                0.0
                            },
                            b: if self.is_visible {
                                self.latest_transform.bg_primary[2] as f64
                            } else {
                                0.0
                            },
                            a: if self.is_visible {
                                self.latest_transform.bg_primary[3] as f64
                            } else {
                                0.0
                            },
                        }),
                        store: wgpu::StoreOp::Store,
                    },
                    depth_slice: None,
                })],
                depth_stencil_attachment: None,
                timestamp_writes: None,
                occlusion_query_set: None,
                multiview_mask: NonZero::new(0),
            });
            let clip_x1 = self.latest_transform.clip[0].max(0.0);
            let clip_y1 = self.latest_transform.clip[1].max(0.0);
            let clip_x2 = (self.latest_transform.clip[0] + self.latest_transform.clip[2]).max(0.0);
            let clip_y2 = (self.latest_transform.clip[1] + self.latest_transform.clip[3]).max(0.0);

            let final_clip_x = clip_x1.floor() as u32;
            let final_clip_y = clip_y1.floor() as u32;
            let final_clip_w = (clip_x2.ceil() as u32).saturating_sub(final_clip_x);
            let final_clip_h = (clip_y2.ceil() as u32).saturating_sub(final_clip_y);

            let max_x = self.config.width;
            let max_y = self.config.height;

            if self.is_visible
                && let Some(bind_group) = &self.current_bind_group
                && final_clip_x < max_x
                && final_clip_y < max_y
            {
                let clamped_width = final_clip_w.min(max_x - final_clip_x);
                let clamped_height = final_clip_h.min(max_y - final_clip_y);

                if clamped_width > 0 && clamped_height > 0 {
                    rpass.set_scissor_rect(
                        final_clip_x,
                        final_clip_y,
                        clamped_width,
                        clamped_height,
                    );

                    rpass.set_pipeline(&self.pipeline);
                    rpass.set_bind_group(0, bind_group, &[]);
                    rpass.draw(0..4, 0..1);
                }
            }
        }
        queue.submit(Some(encoder.finish()));
        queue.present(output);
    }
}

pub fn get_or_init_gpu_context(
    state: &tauri::State<AppState>,
    _app_handle: &tauri::AppHandle,
) -> Result<GpuContext, String> {
    #[cfg(not(any(target_os = "android", target_os = "linux")))]
    let app_handle = _app_handle;

    let mut context_lock = state.gpu_context.lock().unwrap();
    if let Some(context) = &*context_lock {
        return Ok(context.clone());
    }

    #[allow(unused_mut)]
    let mut instance_desc = wgpu::InstanceDescriptor::new_without_display_handle_from_env();

    #[cfg(target_os = "windows")]
    if std::env::var("WGPU_BACKEND").is_err() {
        instance_desc.backends = wgpu::Backends::PRIMARY;
    }

    let flag_path = state.gpu_crash_flag_path.lock().unwrap().clone();
    if let Some(p) = &flag_path {
        if let Some(parent) = p.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let _ = std::fs::write(p, "initializing_gpu");
    }

    let instance = wgpu::Instance::new(instance_desc);

    #[cfg(not(any(target_os = "android", target_os = "linux")))]
    let surface_opt = {
        let settings = crate::app_settings::load_settings(app_handle.clone()).unwrap_or_default();
        let use_wgpu_renderer = settings.use_wgpu_renderer.unwrap_or(true);

        if use_wgpu_renderer {
            if let Some(window) = app_handle.get_webview_window("main") {
                match instance.create_surface(window) {
                    Ok(surface) => Some(surface),
                    Err(e) => {
                        log::warn!(
                            "Failed to create surface, falling back to compute-only: {}",
                            e
                        );
                        if let Some(p) = &flag_path {
                            let _ = std::fs::remove_file(p);
                        }
                        None
                    }
                }
            } else {
                None
            }
        } else {
            None
        }
    };

    #[cfg(any(target_os = "android", target_os = "linux"))]
    let surface_opt: Option<wgpu::Surface> = None;

    let adapter = pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions {
        power_preference: wgpu::PowerPreference::HighPerformance,
        compatible_surface: surface_opt.as_ref(),
        ..Default::default()
    }))
    .map_err(|e| {
        if let Some(p) = &flag_path {
            let _ = std::fs::remove_file(p);
        }
        format!("Failed to find a wgpu adapter: {}", e)
    })?;

    let mut required_features = wgpu::Features::empty();
    if adapter
        .features()
        .contains(wgpu::Features::TEXTURE_ADAPTER_SPECIFIC_FORMAT_FEATURES)
    {
        required_features |= wgpu::Features::TEXTURE_ADAPTER_SPECIFIC_FORMAT_FEATURES;
    }

    let limits = adapter.limits();

    let (device, queue) = pollster::block_on(adapter.request_device(&wgpu::DeviceDescriptor {
        label: Some("Processing Device"),
        required_features,
        required_limits: limits.clone(),
        experimental_features: wgpu::ExperimentalFeatures::default(),
        memory_hints: wgpu::MemoryHints::Performance,
        trace: wgpu::Trace::Off,
    }))
    .map_err(|e| {
        if let Some(p) = &flag_path {
            let _ = std::fs::remove_file(p);
        }
        e.to_string()
    })?;

    if let Some(p) = &flag_path {
        let _ = std::fs::remove_file(p);
    }

    #[cfg(not(any(target_os = "android", target_os = "linux")))]
    let display_opt = if let Some(surface) = surface_opt {
        let window = app_handle
            .get_webview_window("main")
            .ok_or("Failed to get main window")?;

        let swapchain_caps = surface.get_capabilities(&adapter);
        let swapchain_format = swapchain_caps
            .formats
            .iter()
            .copied()
            .find(|f| !f.is_srgb())
            .unwrap_or(swapchain_caps.formats[0]);

        let alpha_mode = if cfg!(target_os = "windows")
            && swapchain_caps
                .alpha_modes
                .contains(&wgpu::CompositeAlphaMode::Opaque)
        {
            wgpu::CompositeAlphaMode::Opaque
        } else if swapchain_caps
            .alpha_modes
            .contains(&wgpu::CompositeAlphaMode::PreMultiplied)
        {
            wgpu::CompositeAlphaMode::PreMultiplied
        } else if swapchain_caps
            .alpha_modes
            .contains(&wgpu::CompositeAlphaMode::PostMultiplied)
        {
            wgpu::CompositeAlphaMode::PostMultiplied
        } else {
            swapchain_caps.alpha_modes[0]
        };

        let size = window
            .inner_size()
            .unwrap_or(tauri::PhysicalSize::new(1280, 720));
        let config = wgpu::SurfaceConfiguration {
            width: size.width.max(1),
            height: size.height.max(1),
            format: swapchain_format,
            color_space: wgpu::SurfaceColorSpace::Auto,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
            present_mode: wgpu::PresentMode::Fifo,
            alpha_mode,
            view_formats: vec![],
            desired_maximum_frame_latency: 2,
        };
        surface.configure(&device, &config);

        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("Display Shader"),
            source: wgpu::ShaderSource::Wgsl(include_str!("shaders/display.wgsl").into()),
        });

        let bind_group_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("Display BGL"),
            entries: &[
                wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::VERTEX | wgpu::ShaderStages::FRAGMENT,
                    count: None,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Uniform,
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 1,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    count: None,
                    ty: wgpu::BindingType::Texture {
                        sample_type: wgpu::TextureSampleType::Float { filterable: true },
                        view_dimension: wgpu::TextureViewDimension::D2,
                        multisampled: false,
                    },
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 2,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    count: None,
                    ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                },
            ],
        });

        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("Display Pipeline Layout"),
            bind_group_layouts: &[Some(&bind_group_layout)],
            immediate_size: 0,
        });

        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("Display Pipeline"),
            layout: Some(&pipeline_layout),
            vertex: wgpu::VertexState {
                module: &shader,
                entry_point: Some("vs_main"),
                buffers: &[],
                compilation_options: Default::default(),
            },
            fragment: Some(wgpu::FragmentState {
                module: &shader,
                entry_point: Some("fs_main"),
                targets: &[Some(wgpu::ColorTargetState {
                    format: swapchain_format,
                    blend: Some(wgpu::BlendState::PREMULTIPLIED_ALPHA_BLENDING),
                    write_mask: wgpu::ColorWrites::ALL,
                })],
                compilation_options: Default::default(),
            }),
            primitive: wgpu::PrimitiveState {
                topology: wgpu::PrimitiveTopology::TriangleStrip,
                ..Default::default()
            },
            depth_stencil: None,
            multisample: wgpu::MultisampleState::default(),
            multiview_mask: NonZero::new(0),
            cache: None,
        });

        let transform_buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("Transform Buffer"),
            size: std::mem::size_of::<DisplayTransform>() as u64,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("Display Sampler"),
            address_mode_u: wgpu::AddressMode::ClampToEdge,
            address_mode_v: wgpu::AddressMode::ClampToEdge,
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            ..Default::default()
        });

        Some(WgpuDisplay {
            surface,
            config,
            pipeline,
            bind_group_layout,
            transform_buffer,
            latest_transform: DisplayTransform {
                rect: [0.0, 0.0, 100.0, 100.0],
                clip: [0.0, 0.0, 10000.0, 10000.0],
                window: [1280.0, 720.0],
                image_size: [100.0, 100.0],
                texture_size: [100.0, 100.0],
                pixelated: 0.0,
                _pad: 0.0,
                bg_primary: [24.0 / 255.0, 24.0 / 255.0, 24.0 / 255.0, 1.0],
                bg_secondary: [35.0 / 255.0, 35.0 / 255.0, 35.0 / 255.0, 1.0],
            },
            sampler,
            current_bind_group: None,
            is_visible: true,
            hold_frame: false,
        })
    } else {
        None
    };

    #[cfg(any(target_os = "android", target_os = "linux"))]
    let display_opt = None;

    let new_context = GpuContext {
        device: Arc::new(device),
        queue: Arc::new(queue),
        limits,
        display: Arc::new(std::sync::Mutex::new(display_opt)),
        pipelines: Arc::new(std::sync::OnceLock::new()),
    };
    *context_lock = Some(new_context.clone());
    Ok(new_context)
}

fn read_texture_data_roi(
    device: &wgpu::Device,
    queue: &wgpu::Queue,
    texture: &wgpu::Texture,
    origin: wgpu::Origin3d,
    size: wgpu::Extent3d,
    bytes_per_pixel: u32,
) -> Result<Vec<u8>, String> {
    let unpadded_bytes_per_row = bytes_per_pixel * size.width;
    let align = wgpu::COPY_BYTES_PER_ROW_ALIGNMENT;
    let padded_bytes_per_row = (unpadded_bytes_per_row + align - 1) & !(align - 1);
    let output_buffer_size = (padded_bytes_per_row * size.height) as u64;

    let output_buffer = device.create_buffer(&wgpu::BufferDescriptor {
        label: Some("Readback Buffer"),
        size: output_buffer_size,
        usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
        mapped_at_creation: false,
    });

    let mut encoder =
        device.create_command_encoder(&wgpu::CommandEncoderDescriptor { label: None });
    encoder.copy_texture_to_buffer(
        wgpu::TexelCopyTextureInfo {
            texture,
            mip_level: 0,
            origin,
            aspect: wgpu::TextureAspect::All,
        },
        wgpu::TexelCopyBufferInfo {
            buffer: &output_buffer,
            layout: wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(padded_bytes_per_row),
                rows_per_image: Some(size.height),
            },
        },
        size,
    );

    queue.submit(Some(encoder.finish()));
    let buffer_slice = output_buffer.slice(..);
    let (tx, rx) = std::sync::mpsc::channel();
    buffer_slice.map_async(wgpu::MapMode::Read, move |result| {
        let _ = tx.send(result);
    });
    device
        .poll(wgpu::PollType::Wait {
            submission_index: None,
            timeout: Some(std::time::Duration::from_secs(60)),
        })
        .map_err(|e| format!("Failed while polling mapped GPU buffer: {}", e))?;
    let map_result = rx
        .recv()
        .map_err(|e| format!("Failed receiving GPU map result: {}", e))?;
    map_result.map_err(|e| e.to_string())?;

    let padded_data = buffer_slice
        .get_mapped_range()
        .map_err(|e| format!("Failed to get mapped GPU buffer range: {}", e))?
        .to_vec();
    output_buffer.unmap();

    if padded_bytes_per_row == unpadded_bytes_per_row {
        Ok(padded_data)
    } else {
        let mut unpadded_data = Vec::with_capacity((unpadded_bytes_per_row * size.height) as usize);
        for chunk in padded_data.chunks(padded_bytes_per_row as usize) {
            unpadded_data.extend_from_slice(&chunk[..unpadded_bytes_per_row as usize]);
        }
        Ok(unpadded_data)
    }
}

fn to_rgba_f16(img: &DynamicImage) -> Vec<f16> {
    let rgba_f32 = img.to_rgba32f();
    rgba_f32.into_raw().into_iter().map(f16::from_f32).collect()
}

#[repr(C)]
#[derive(Debug, Copy, Clone, bytemuck::Pod, bytemuck::Zeroable)]
struct BlurParams {
    radius: u32,
    tile_offset_x: u32,
    tile_offset_y: u32,
    input_width: u32,
    input_height: u32,
    /// The tile's output rectangle in image coordinates (end exclusive). The vertical pass
    /// stores only these pixels, at their image position, so the blurs of every tile can
    /// stay in the blur textures together and be reused while the input does not change.
    output_start_x: u32,
    output_start_y: u32,
    output_end_x: u32,
    output_end_y: u32,
    _pad1: u32,
    _pad2: u32,
    _pad3: u32,
}

/// What the blur textures of a [`GpuProcessor`] currently hold: the blurs of one input
/// texture over one render region. The blurs depend on nothing else, so a render with the
/// same key (e.g. every tick of a slider drag) reuses them instead of running the passes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct BlurCacheKey {
    input_generation: u64,
    bounds: (u32, u32, u32, u32),
}

/// Gives every uploaded input texture its own [`crate::app_state::GpuImageCache::generation`].
static NEXT_INPUT_GENERATION: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);

/// Motion blurred inputs and mask results kept per processor (an interactive and a final input).
const MOTION_CACHE_ENTRIES: usize = 2;

/// The texture the main shader reads: the uploaded input, or its motion-blurred copy.
struct RenderInput<'a> {
    texture_view: &'a wgpu::TextureView,
    width: u32,
    height: u32,
    /// Identifies the texture's contents for the blur cache.
    generation: u64,
}

impl<'a> RenderInput<'a> {
    fn from_cache(cache: &'a crate::app_state::GpuImageCache) -> Self {
        Self {
            texture_view: &cache.texture_view,
            width: cache.width,
            height: cache.height,
            generation: cache.generation,
        }
    }
}

/// A motion-blurred input; `mask_view` holds the masks blurred along with it, when any are.
struct MotionBlurred {
    _texture: wgpu::Texture,
    view: wgpu::TextureView,
    mask_view: Option<wgpu::TextureView>,
    generation: u64,
}

#[repr(C)]
#[derive(Debug, Copy, Clone, bytemuck::Pod, bytemuck::Zeroable)]
struct FlareParams {
    amount: f32,
    is_raw: u32,
    exposure: f32,
    brightness: f32,
    contrast: f32,
    whites: f32,
    aspect_ratio: f32,
    _pad: f32,
}

/// Size-independent GPU state (shaders, pipelines, layouts, samplers, placeholder textures),
/// built once per GPU context. A `GpuProcessor` is recreated whenever an image needs larger
/// working textures (zooming in, a portrait after landscapes, a full-size export); it shares
/// these instead of compiling every pipeline again.
pub struct GpuPipelines {
    blur_bgl: wgpu::BindGroupLayout,
    h_blur_pipeline: wgpu::ComputePipeline,
    v_blur_pipeline: wgpu::ComputePipeline,
    flare_bgl_0: wgpu::BindGroupLayout,
    flare_bgl_1: wgpu::BindGroupLayout,
    flare_threshold_pipeline: wgpu::ComputePipeline,
    flare_ghosts_pipeline: wgpu::ComputePipeline,
    flare_sampler: wgpu::Sampler,
    main_bgl_entries: Vec<wgpu::BindGroupLayoutEntry>,
    main_bgl: wgpu::BindGroupLayout,
    main_pipeline_layout: wgpu::PipelineLayout,
    main_shader_module: wgpu::ShaderModule,
    main_pipeline: wgpu::ComputePipeline,
    sample_probes: [std::sync::OnceLock<wgpu::ComputePipeline>; SampleProbe::COUNT],
    high_precision: std::sync::OnceLock<HighPrecisionPipeline>,
    motion_blur: std::sync::OnceLock<crate::motion_blur::MotionBlurPipelines>,
    dummy_blur_view: wgpu::TextureView,
    dummy_lut_view: wgpu::TextureView,
    dummy_lut_sampler: wgpu::Sampler,
}

struct HighPrecisionPipeline {
    bgl: wgpu::BindGroupLayout,
    pipeline: wgpu::ComputePipeline,
}

pub struct GpuProcessor {
    context: GpuContext,
    pipelines: Arc<GpuPipelines>,
    blur_params_buffer: wgpu::Buffer,

    flare_params_buffer: wgpu::Buffer,
    flare_threshold_view: wgpu::TextureView,
    flare_ghosts_view: wgpu::TextureView,
    flare_final_view: wgpu::TextureView,

    high_precision_tile: std::sync::OnceLock<HighPrecisionTile>,
    tile_output_size: wgpu::Extent3d,
    adjustments_buffer: wgpu::Buffer,
    ping_pong_view: wgpu::TextureView,
    sharpness_blur_view: wgpu::TextureView,
    tonal_blur_view: wgpu::TextureView,
    clarity_blur_view: wgpu::TextureView,
    structure_blur_view: wgpu::TextureView,
    /// What the four blur textures hold; `None` until a render has filled them all.
    blur_cache: std::sync::Mutex<Option<BlurCacheKey>>,
    /// Motion-blurred inputs by `motion_blur::cache_key`, newest last.
    motion_cache: std::sync::Mutex<Vec<(u64, Arc<MotionBlurred>)>>,
    /// The grain level of each input texture (by generation), measured once per upload.
    motion_grain: std::sync::Mutex<Vec<(u64, f32)>>,

    pub tile_output_texture: wgpu::Texture,
    pub tile_output_texture_view: wgpu::TextureView,
    pub working_texture: wgpu::Texture,
    pub working_texture_view: wgpu::TextureView,
    pub output_texture: wgpu::Texture,
    pub output_texture_view: wgpu::TextureView,
}

struct HighPrecisionTile {
    texture: wgpu::Texture,
    view: wgpu::TextureView,
}

enum RenderedPixels {
    U8(Vec<u8>),
    U16(Vec<u16>),
}

/// The image-processing shader with the constants it shares with Rust.
pub(crate) fn image_shader_source() -> String {
    format!(
        "{}\n{}",
        crate::tone_mapping::natural_wgsl_constants(),
        include_str!("shaders/shader.wgsl")
    )
}

fn high_precision_shader_source() -> String {
    image_shader_source().replace("rgba8unorm, write>", "rgba16float, write>")
}

const FLARE_MAP_SIZE: u32 = 512;

impl GpuPipelines {
    pub(crate) fn new(device: &wgpu::Device) -> Self {
        const MAX_MASK_BINDINGS: u32 = 1;

        let blur_shader_module = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("Blur Shader"),
            source: wgpu::ShaderSource::Wgsl(include_str!("shaders/blur.wgsl").into()),
        });

        let blur_bgl = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("Blur BGL"),
            entries: &[
                wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::COMPUTE,
                    ty: wgpu::BindingType::Texture {
                        sample_type: wgpu::TextureSampleType::Float { filterable: false },
                        view_dimension: wgpu::TextureViewDimension::D2,
                        multisampled: false,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 1,
                    visibility: wgpu::ShaderStages::COMPUTE,
                    ty: wgpu::BindingType::StorageTexture {
                        access: wgpu::StorageTextureAccess::WriteOnly,
                        format: wgpu::TextureFormat::Rgba16Float,
                        view_dimension: wgpu::TextureViewDimension::D2,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 2,
                    visibility: wgpu::ShaderStages::COMPUTE,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Uniform,
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
            ],
        });

        let blur_pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("Blur Pipeline Layout"),
            bind_group_layouts: &[Some(&blur_bgl)],
            immediate_size: 0,
        });

        let h_blur_pipeline = device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
            label: Some("Horizontal Blur Pipeline"),
            layout: Some(&blur_pipeline_layout),
            module: &blur_shader_module,
            entry_point: Some("horizontal_blur"),
            compilation_options: Default::default(),
            cache: None,
        });

        let v_blur_pipeline = device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
            label: Some("Vertical Blur Pipeline"),
            layout: Some(&blur_pipeline_layout),
            module: &blur_shader_module,
            entry_point: Some("vertical_blur"),
            compilation_options: Default::default(),
            cache: None,
        });

        let flare_shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("Flare Shader"),
            source: wgpu::ShaderSource::Wgsl(include_str!("shaders/flare.wgsl").into()),
        });

        let flare_bgl_0 = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("Flare BGL 0"),
            entries: &[
                wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::COMPUTE,
                    ty: wgpu::BindingType::Texture {
                        sample_type: wgpu::TextureSampleType::Float { filterable: true },
                        view_dimension: wgpu::TextureViewDimension::D2,
                        multisampled: false,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 1,
                    visibility: wgpu::ShaderStages::COMPUTE,
                    ty: wgpu::BindingType::StorageTexture {
                        access: wgpu::StorageTextureAccess::WriteOnly,
                        format: wgpu::TextureFormat::Rgba16Float,
                        view_dimension: wgpu::TextureViewDimension::D2,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 2,
                    visibility: wgpu::ShaderStages::COMPUTE,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Uniform,
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 3,
                    visibility: wgpu::ShaderStages::COMPUTE,
                    ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                    count: None,
                },
            ],
        });

        let flare_bgl_1 = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("Flare BGL 1"),
            entries: &[
                wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::COMPUTE,
                    ty: wgpu::BindingType::Texture {
                        sample_type: wgpu::TextureSampleType::Float { filterable: false },
                        view_dimension: wgpu::TextureViewDimension::D2,
                        multisampled: false,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 1,
                    visibility: wgpu::ShaderStages::COMPUTE,
                    ty: wgpu::BindingType::StorageTexture {
                        access: wgpu::StorageTextureAccess::WriteOnly,
                        format: wgpu::TextureFormat::Rgba16Float,
                        view_dimension: wgpu::TextureViewDimension::D2,
                    },
                    count: None,
                },
            ],
        });

        let flare_threshold_layout =
            device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                label: Some("Flare Threshold Layout"),
                bind_group_layouts: &[Some(&flare_bgl_0)],
                immediate_size: 0,
            });

        let flare_ghosts_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("Flare Ghosts Layout"),
            bind_group_layouts: &[Some(&flare_bgl_0), Some(&flare_bgl_1)],
            immediate_size: 0,
        });

        let flare_threshold_pipeline =
            device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
                label: Some("Flare Threshold Pipeline"),
                layout: Some(&flare_threshold_layout),
                module: &flare_shader,
                entry_point: Some("threshold_main"),
                compilation_options: Default::default(),
                cache: None,
            });

        let flare_ghosts_pipeline =
            device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
                label: Some("Flare Ghosts Pipeline"),
                layout: Some(&flare_ghosts_layout),
                module: &flare_shader,
                entry_point: Some("ghosts_main"),
                compilation_options: Default::default(),
                cache: None,
            });

        let flare_sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("Flare Sampler"),
            address_mode_u: wgpu::AddressMode::ClampToEdge,
            address_mode_v: wgpu::AddressMode::ClampToEdge,
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            ..Default::default()
        });

        let shader_module = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("Image Processing Shader"),
            source: wgpu::ShaderSource::Wgsl(image_shader_source().into()),
        });

        let mut bind_group_layout_entries = vec![
            wgpu::BindGroupLayoutEntry {
                binding: 0,
                visibility: wgpu::ShaderStages::COMPUTE,
                ty: wgpu::BindingType::Texture {
                    sample_type: wgpu::TextureSampleType::Float { filterable: true },
                    view_dimension: wgpu::TextureViewDimension::D2,
                    multisampled: false,
                },
                count: None,
            },
            wgpu::BindGroupLayoutEntry {
                binding: 1,
                visibility: wgpu::ShaderStages::COMPUTE,
                ty: wgpu::BindingType::StorageTexture {
                    access: wgpu::StorageTextureAccess::WriteOnly,
                    format: wgpu::TextureFormat::Rgba8Unorm,
                    view_dimension: wgpu::TextureViewDimension::D2,
                },
                count: None,
            },
            wgpu::BindGroupLayoutEntry {
                binding: 2,
                visibility: wgpu::ShaderStages::COMPUTE,
                ty: wgpu::BindingType::Buffer {
                    ty: wgpu::BufferBindingType::Storage { read_only: true },
                    has_dynamic_offset: false,
                    min_binding_size: None,
                },
                count: None,
            },
        ];

        bind_group_layout_entries.push(wgpu::BindGroupLayoutEntry {
            binding: 3,
            visibility: wgpu::ShaderStages::COMPUTE,
            ty: wgpu::BindingType::Texture {
                sample_type: wgpu::TextureSampleType::Float { filterable: false },
                view_dimension: wgpu::TextureViewDimension::D2Array,
                multisampled: false,
            },
            count: None,
        });

        bind_group_layout_entries.push(wgpu::BindGroupLayoutEntry {
            binding: 3 + MAX_MASK_BINDINGS,
            visibility: wgpu::ShaderStages::COMPUTE,
            ty: wgpu::BindingType::Texture {
                sample_type: wgpu::TextureSampleType::Float { filterable: false },
                view_dimension: wgpu::TextureViewDimension::D3,
                multisampled: false,
            },
            count: None,
        });
        bind_group_layout_entries.push(wgpu::BindGroupLayoutEntry {
            binding: 4 + MAX_MASK_BINDINGS,
            visibility: wgpu::ShaderStages::COMPUTE,
            ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::NonFiltering),
            count: None,
        });

        bind_group_layout_entries.push(wgpu::BindGroupLayoutEntry {
            binding: 5 + MAX_MASK_BINDINGS,
            visibility: wgpu::ShaderStages::COMPUTE,
            ty: wgpu::BindingType::Texture {
                sample_type: wgpu::TextureSampleType::Float { filterable: false },
                view_dimension: wgpu::TextureViewDimension::D2,
                multisampled: false,
            },
            count: None,
        });
        bind_group_layout_entries.push(wgpu::BindGroupLayoutEntry {
            binding: 6 + MAX_MASK_BINDINGS,
            visibility: wgpu::ShaderStages::COMPUTE,
            ty: wgpu::BindingType::Texture {
                sample_type: wgpu::TextureSampleType::Float { filterable: false },
                view_dimension: wgpu::TextureViewDimension::D2,
                multisampled: false,
            },
            count: None,
        });
        bind_group_layout_entries.push(wgpu::BindGroupLayoutEntry {
            binding: 7 + MAX_MASK_BINDINGS,
            visibility: wgpu::ShaderStages::COMPUTE,
            ty: wgpu::BindingType::Texture {
                sample_type: wgpu::TextureSampleType::Float { filterable: false },
                view_dimension: wgpu::TextureViewDimension::D2,
                multisampled: false,
            },
            count: None,
        });
        bind_group_layout_entries.push(wgpu::BindGroupLayoutEntry {
            binding: 8 + MAX_MASK_BINDINGS,
            visibility: wgpu::ShaderStages::COMPUTE,
            ty: wgpu::BindingType::Texture {
                sample_type: wgpu::TextureSampleType::Float { filterable: false },
                view_dimension: wgpu::TextureViewDimension::D2,
                multisampled: false,
            },
            count: None,
        });

        bind_group_layout_entries.push(wgpu::BindGroupLayoutEntry {
            binding: 9 + MAX_MASK_BINDINGS,
            visibility: wgpu::ShaderStages::COMPUTE,
            ty: wgpu::BindingType::Texture {
                sample_type: wgpu::TextureSampleType::Float { filterable: true },
                view_dimension: wgpu::TextureViewDimension::D2,
                multisampled: false,
            },
            count: None,
        });
        bind_group_layout_entries.push(wgpu::BindGroupLayoutEntry {
            binding: 10 + MAX_MASK_BINDINGS,
            visibility: wgpu::ShaderStages::COMPUTE,
            ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
            count: None,
        });

        let main_bgl = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("Main BGL"),
            entries: &bind_group_layout_entries,
        });

        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("Pipeline Layout"),
            bind_group_layouts: &[Some(&main_bgl)],
            immediate_size: 0,
        });

        let main_pipeline = device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
            label: Some("Compute Pipeline"),
            layout: Some(&pipeline_layout),
            module: &shader_module,
            entry_point: Some("main"),
            compilation_options: Default::default(),
            cache: None,
        });

        let dummy_texture_desc = wgpu::TextureDescriptor {
            label: Some("Dummy Texture"),
            size: wgpu::Extent3d {
                width: 1,
                height: 1,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba16Float,
            usage: wgpu::TextureUsages::TEXTURE_BINDING,
            view_formats: &[],
        };
        let dummy_blur_texture = device.create_texture(&dummy_texture_desc);
        let dummy_blur_view = dummy_blur_texture.create_view(&Default::default());

        let dummy_lut_texture = device.create_texture(&wgpu::TextureDescriptor {
            dimension: wgpu::TextureDimension::D3,
            ..dummy_texture_desc
        });
        let dummy_lut_view = dummy_lut_texture.create_view(&Default::default());
        let dummy_lut_sampler = device.create_sampler(&wgpu::SamplerDescriptor::default());

        Self {
            blur_bgl,
            h_blur_pipeline,
            v_blur_pipeline,
            flare_bgl_0,
            flare_bgl_1,
            flare_threshold_pipeline,
            flare_ghosts_pipeline,
            flare_sampler,
            main_bgl_entries: bind_group_layout_entries,
            main_bgl,
            main_pipeline_layout: pipeline_layout,
            main_shader_module: shader_module,
            main_pipeline,
            sample_probes: Default::default(),
            high_precision: std::sync::OnceLock::new(),
            motion_blur: std::sync::OnceLock::new(),
            dummy_blur_view,
            dummy_lut_view,
            dummy_lut_sampler,
        }
    }

    /// A sample probe's pipeline, compiled on first use (only targeted adjustments need it).
    fn sample_probe(&self, device: &wgpu::Device, probe: SampleProbe) -> &wgpu::ComputePipeline {
        self.sample_probes[probe.index()].get_or_init(|| {
            device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
                label: Some("Sample Probe Pipeline"),
                layout: Some(&self.main_pipeline_layout),
                module: &self.main_shader_module,
                entry_point: Some("main"),
                compilation_options: wgpu::PipelineCompilationOptions {
                    constants: &[("SAMPLE_PROBE", probe.shader_value())],
                    ..Default::default()
                },
                cache: None,
            })
        })
    }

    /// The 16-bit output pipeline, compiled on first use (only 16-bit exports need it).
    fn high_precision(&self, device: &wgpu::Device) -> &HighPrecisionPipeline {
        self.high_precision.get_or_init(|| {
            let mut bind_group_layout_entries = self.main_bgl_entries.clone();
            bind_group_layout_entries[1].ty = wgpu::BindingType::StorageTexture {
                access: wgpu::StorageTextureAccess::WriteOnly,
                format: wgpu::TextureFormat::Rgba16Float,
                view_dimension: wgpu::TextureViewDimension::D2,
            };
            let high_precision_bgl =
                device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                    label: Some("High Precision Main BGL"),
                    entries: &bind_group_layout_entries,
                });
            let high_precision_pipeline_layout =
                device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                    label: Some("High Precision Pipeline Layout"),
                    bind_group_layouts: &[Some(&high_precision_bgl)],
                    immediate_size: 0,
                });
            let high_precision_shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
                label: Some("High Precision Image Processing Shader"),
                source: wgpu::ShaderSource::Wgsl(high_precision_shader_source().into()),
            });
            let high_precision_pipeline =
                device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
                    label: Some("High Precision Compute Pipeline"),
                    layout: Some(&high_precision_pipeline_layout),
                    module: &high_precision_shader,
                    entry_point: Some("main"),
                    compilation_options: wgpu::PipelineCompilationOptions {
                        constants: &[("HIGH_PRECISION_OUTPUT", 1.0)],
                        ..Default::default()
                    },
                    cache: None,
                });
            HighPrecisionPipeline {
                bgl: high_precision_bgl,
                pipeline: high_precision_pipeline,
            }
        })
    }
}

impl GpuProcessor {
    pub fn new(context: GpuContext, max_width: u32, max_height: u32) -> Result<Self, String> {
        let pipelines = context.pipelines();
        let device = &context.device;

        let blur_params_buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("Blur Params Buffer"),
            size: std::mem::size_of::<BlurParams>() as u64,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        let flare_params_buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("Flare Params Buffer"),
            size: std::mem::size_of::<FlareParams>() as u64,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        let flare_tex_desc = wgpu::TextureDescriptor {
            label: Some("Flare Tex"),
            size: wgpu::Extent3d {
                width: FLARE_MAP_SIZE,
                height: FLARE_MAP_SIZE,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba16Float,
            usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::STORAGE_BINDING,
            view_formats: &[],
        };

        let flare_threshold_texture = device.create_texture(&flare_tex_desc);
        let flare_threshold_view = flare_threshold_texture.create_view(&Default::default());
        let flare_ghosts_texture = device.create_texture(&flare_tex_desc);
        let flare_ghosts_view = flare_ghosts_texture.create_view(&Default::default());
        let flare_final_texture = device.create_texture(&flare_tex_desc);
        let flare_final_view = flare_final_texture.create_view(&Default::default());

        let adjustments_buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("Adjustments Buffer"),
            size: std::mem::size_of::<AllAdjustments>() as u64,
            usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        let max_tile_size = wgpu::Extent3d {
            width: max_width,
            height: max_height,
            depth_or_array_layers: 1,
        };

        let reusable_texture_desc = wgpu::TextureDescriptor {
            label: None,
            size: max_tile_size,
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba16Float,
            usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::STORAGE_BINDING,
            view_formats: &[],
        };

        let ping_pong_texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("Ping Pong Texture"),
            ..reusable_texture_desc
        });
        let ping_pong_view = ping_pong_texture.create_view(&Default::default());

        let sharpness_blur_texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("Sharpness Blur Texture"),
            ..reusable_texture_desc
        });
        let sharpness_blur_view = sharpness_blur_texture.create_view(&Default::default());

        let tonal_blur_texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("Tonal Blur Texture"),
            ..reusable_texture_desc
        });
        let tonal_blur_view = tonal_blur_texture.create_view(&Default::default());

        let clarity_blur_texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("Clarity Blur Texture"),
            ..reusable_texture_desc
        });
        let clarity_blur_view = clarity_blur_texture.create_view(&Default::default());

        let structure_blur_texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("Structure Blur Texture"),
            ..reusable_texture_desc
        });
        let structure_blur_view = structure_blur_texture.create_view(&Default::default());

        let tile_output_texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("Tile Output Texture"),
            size: max_tile_size,
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8Unorm,
            usage: wgpu::TextureUsages::TEXTURE_BINDING
                | wgpu::TextureUsages::STORAGE_BINDING
                | wgpu::TextureUsages::COPY_SRC,
            view_formats: &[],
        });
        let tile_output_texture_view = tile_output_texture.create_view(&Default::default());

        let working_texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("Working Output Texture"),
            size: max_tile_size,
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8Unorm,
            usage: wgpu::TextureUsages::TEXTURE_BINDING
                | wgpu::TextureUsages::STORAGE_BINDING
                | wgpu::TextureUsages::COPY_DST
                | wgpu::TextureUsages::COPY_SRC,
            view_formats: &[],
        });
        let working_texture_view = working_texture.create_view(&Default::default());

        let output_texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("Full Output Texture"),
            size: max_tile_size,
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8Unorm,
            usage: wgpu::TextureUsages::TEXTURE_BINDING
                | wgpu::TextureUsages::STORAGE_BINDING
                | wgpu::TextureUsages::COPY_DST
                | wgpu::TextureUsages::COPY_SRC,
            view_formats: &[],
        });
        let output_texture_view = output_texture.create_view(&Default::default());

        Ok(Self {
            context,
            pipelines,
            blur_params_buffer,
            flare_params_buffer,
            flare_threshold_view,
            flare_ghosts_view,
            flare_final_view,
            high_precision_tile: std::sync::OnceLock::new(),
            tile_output_size: max_tile_size,
            adjustments_buffer,
            ping_pong_view,
            sharpness_blur_view,
            tonal_blur_view,
            clarity_blur_view,
            structure_blur_view,
            blur_cache: std::sync::Mutex::new(None),
            motion_cache: std::sync::Mutex::new(Vec::new()),
            motion_grain: std::sync::Mutex::new(Vec::new()),
            tile_output_texture,
            tile_output_texture_view,
            working_texture,
            working_texture_view,
            output_texture,
            output_texture_view,
        })
    }

    /// The mask bitmaps as one texture array (at least two layers, as the shader binds an array).
    fn mask_texture_view(
        &self,
        mask_bitmaps: &[ImageBuffer<Luma<u8>, Vec<u8>>],
        width: u32,
        height: u32,
    ) -> wgpu::TextureView {
        let mask_layer_count = mask_bitmaps.len().clamp(2, MAX_MASKS) as u32;
        let buffer_size = (width as usize) * (height as usize) * (mask_layer_count as usize);
        let mut mask_texture_data = Vec::with_capacity(buffer_size);
        for mask_bitmap in mask_bitmaps.iter().take(MAX_MASKS) {
            mask_texture_data.extend_from_slice(mask_bitmap.as_raw());
        }
        mask_texture_data.resize(buffer_size, 0);
        let mask_texture = self.context.device.create_texture_with_data(
            &self.context.queue,
            &wgpu::TextureDescriptor {
                label: Some("Full Mask Texture Array"),
                size: wgpu::Extent3d {
                    width,
                    height,
                    depth_or_array_layers: mask_layer_count,
                },
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format: wgpu::TextureFormat::R8Unorm,
                // COPY_SRC: motion blur copies the masks before blurring them with the image.
                usage: wgpu::TextureUsages::TEXTURE_BINDING
                    | wgpu::TextureUsages::COPY_DST
                    | wgpu::TextureUsages::COPY_SRC,
                view_formats: &[],
            },
            TextureDataOrder::MipMajor,
            &mask_texture_data,
        );
        mask_texture.create_view(&wgpu::TextureViewDescriptor {
            dimension: Some(wgpu::TextureViewDimension::D2Array),
            ..Default::default()
        })
    }

    /// Runs the request's motion blurs on `input` (cached per input, masks, depth and blur
    /// settings), or `None` when there is nothing to blur.
    fn motion_blurred(
        &self,
        input: &GpuImageCache,
        base_image: &DynamicImage,
        request: &RenderRequest,
        mask_view: &wgpu::TextureView,
    ) -> Result<Option<Arc<MotionBlurred>>, String> {
        let motion = &request.motion_blur;
        if motion.blurs.is_empty() {
            return Ok(None);
        }

        let mask_key = {
            let mut hasher = blake3::Hasher::new();
            for mask in request.mask_bitmaps {
                hasher.update(&mask.width().to_le_bytes());
                hasher.update(&mask.height().to_le_bytes());
                hasher.update(mask.as_raw());
            }
            u64::from_le_bytes(hasher.finalize().as_bytes()[..8].try_into().unwrap())
        };
        let key = crate::motion_blur::cache_key(
            input.generation,
            mask_key,
            motion.depth.as_deref(),
            &motion.blurs,
        );
        let mut cache = self.motion_cache.lock().unwrap_or_else(|e| e.into_inner());
        if let Some((_, blurred)) = cache.iter().find(|(k, _)| *k == key) {
            return Ok(Some(Arc::clone(blurred)));
        }

        let is_raw = request.adjustments.global.is_raw_image;
        let grain = {
            let mut grains = self.motion_grain.lock().unwrap_or_else(|e| e.into_inner());
            match grains
                .iter()
                .find(|(generation, _)| *generation == input.generation)
            {
                Some((_, grain)) => *grain,
                None => {
                    let grain = crate::motion_blur::estimate_grain(base_image, is_raw == 1);
                    if grains.len() >= MOTION_CACHE_ENTRIES {
                        grains.remove(0);
                    }
                    grains.push((input.generation, grain));
                    grain
                }
            }
        };
        let device = &self.context.device;
        let pipelines = self
            .pipelines
            .motion_blur
            .get_or_init(|| crate::motion_blur::MotionBlurPipelines::new(device));
        let depth = motion.depth.as_deref().map(|map| {
            (
                pipelines.upload_depth(device, &self.context.queue, map),
                map,
            )
        });

        let Some(output) = crate::motion_blur::render(
            &self.context,
            pipelines,
            &input.texture_view,
            (input.width, input.height),
            is_raw,
            grain,
            &motion.blurs,
            request.mask_bitmaps,
            mask_view,
            depth.as_ref().map(|(view, map)| (view, *map)),
        )?
        else {
            return Ok(None);
        };
        let blurred = Arc::new(MotionBlurred {
            _texture: output.texture,
            view: output.view,
            mask_view: output.mask_view,
            generation: NEXT_INPUT_GENERATION.fetch_add(1, std::sync::atomic::Ordering::Relaxed),
        });
        if cache.len() >= MOTION_CACHE_ENTRIES {
            cache.remove(0);
        }
        cache.push((key, Arc::clone(&blurred)));
        Ok(Some(blurred))
    }

    fn high_precision_tile(&self) -> &HighPrecisionTile {
        self.high_precision_tile.get_or_init(|| {
            let texture = self
                .context
                .device
                .create_texture(&wgpu::TextureDescriptor {
                    label: Some("High Precision Tile Output Texture"),
                    size: self.tile_output_size,
                    mip_level_count: 1,
                    sample_count: 1,
                    dimension: wgpu::TextureDimension::D2,
                    format: wgpu::TextureFormat::Rgba16Float,
                    usage: wgpu::TextureUsages::TEXTURE_BINDING
                        | wgpu::TextureUsages::STORAGE_BINDING
                        | wgpu::TextureUsages::COPY_SRC,
                    view_formats: &[],
                });
            let view = texture.create_view(&Default::default());
            HighPrecisionTile { texture, view }
        })
    }

    fn run(
        &self,
        input: RenderInput,
        mask_texture_view: &wgpu::TextureView,
        request: RenderRequest,
        skip_cpu_readback: bool,
        output_to_display: bool,
        output_precision: RenderOutputPrecision,
    ) -> Result<(RenderedPixels, u32, u32, u32, u32), String> {
        let input_texture_view = input.texture_view;
        let (width, height) = (input.width, input.height);
        let device = &self.context.device;
        let queue = &self.context.queue;
        let scale = (width.min(height) as f32) / 1080.0;
        const MAX_MASK_BINDINGS: u32 = 1;

        if output_precision == RenderOutputPrecision::SixteenBit
            && (skip_cpu_readback || output_to_display)
        {
            return Err(
                "High-precision GPU output is only supported for CPU-readback renders.".to_string(),
            );
        }
        if request.probe.is_some()
            && (skip_cpu_readback
                || output_to_display
                || output_precision != RenderOutputPrecision::EightBit)
        {
            return Err("Sample probes are only supported for 8-bit CPU-readback renders.".into());
        }

        let high_precision_tile = if output_precision == RenderOutputPrecision::SixteenBit {
            Some(self.high_precision_tile())
        } else {
            None
        };
        let (output_pipeline, output_bgl, output_tile_texture, output_tile_view, bytes_per_pixel) =
            if let Some(high_precision_tile) = high_precision_tile {
                let high_precision = self.pipelines.high_precision(&self.context.device);
                (
                    &high_precision.pipeline,
                    &high_precision.bgl,
                    &high_precision_tile.texture,
                    &high_precision_tile.view,
                    8,
                )
            } else {
                (
                    match request.probe {
                        Some(probe) => self.pipelines.sample_probe(device, probe),
                        None => &self.pipelines.main_pipeline,
                    },
                    &self.pipelines.main_bgl,
                    &self.tile_output_texture,
                    &self.tile_output_texture_view,
                    4,
                )
            };

        let bounds = request.roi.unwrap_or(Roi {
            x: 0,
            y: 0,
            width,
            height,
        });
        let out_width = bounds.width;
        let out_height = bounds.height;
        let (lut_texture_view, lut_sampler) = if let Some(lut_arc) = &request.lut {
            let lut_data = &lut_arc.data;
            let size = lut_arc.size;
            let mut rgba_lut_data_f16 = Vec::with_capacity(lut_data.len() / 3 * 4);
            for chunk in lut_data.chunks_exact(3) {
                rgba_lut_data_f16.push(f16::from_f32(chunk[0]));
                rgba_lut_data_f16.push(f16::from_f32(chunk[1]));
                rgba_lut_data_f16.push(f16::from_f32(chunk[2]));
                rgba_lut_data_f16.push(f16::ONE);
            }
            let lut_texture = device.create_texture_with_data(
                queue,
                &wgpu::TextureDescriptor {
                    label: Some("LUT 3D Texture"),
                    size: wgpu::Extent3d {
                        width: size,
                        height: size,
                        depth_or_array_layers: size,
                    },
                    mip_level_count: 1,
                    sample_count: 1,
                    dimension: wgpu::TextureDimension::D3,
                    format: wgpu::TextureFormat::Rgba16Float,
                    usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
                    view_formats: &[],
                },
                TextureDataOrder::MipMajor,
                bytemuck::cast_slice(&rgba_lut_data_f16),
            );
            let view = lut_texture.create_view(&Default::default());
            let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
                address_mode_u: wgpu::AddressMode::ClampToEdge,
                address_mode_v: wgpu::AddressMode::ClampToEdge,
                address_mode_w: wgpu::AddressMode::ClampToEdge,
                mag_filter: wgpu::FilterMode::Nearest,
                min_filter: wgpu::FilterMode::Nearest,
                ..Default::default()
            });
            (view, sampler)
        } else {
            (
                self.pipelines.dummy_lut_view.clone(),
                self.pipelines.dummy_lut_sampler.clone(),
            )
        };

        let adjustments = request.adjustments;
        let flare_amount = flare_generation_amount(&adjustments);
        if flare_amount > 0.0 {
            let mut encoder = device.create_command_encoder(&Default::default());

            let aspect_ratio = if height > 0 {
                width as f32 / height as f32
            } else {
                1.0
            };
            let f_params = FlareParams {
                amount: flare_amount,
                is_raw: adjustments.global.is_raw_image,
                exposure: adjustments.global.exposure,
                brightness: adjustments.global.brightness,
                contrast: adjustments.global.contrast,
                whites: adjustments.global.whites,
                aspect_ratio,
                _pad: 0.0,
            };
            queue.write_buffer(&self.flare_params_buffer, 0, bytemuck::bytes_of(&f_params));

            let bg0 = device.create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some("Flare BG0"),
                layout: &self.pipelines.flare_bgl_0,
                entries: &[
                    wgpu::BindGroupEntry {
                        binding: 0,
                        resource: wgpu::BindingResource::TextureView(input_texture_view),
                    },
                    wgpu::BindGroupEntry {
                        binding: 1,
                        resource: wgpu::BindingResource::TextureView(&self.flare_threshold_view),
                    },
                    wgpu::BindGroupEntry {
                        binding: 2,
                        resource: self.flare_params_buffer.as_entire_binding(),
                    },
                    wgpu::BindGroupEntry {
                        binding: 3,
                        resource: wgpu::BindingResource::Sampler(&self.pipelines.flare_sampler),
                    },
                ],
            });

            {
                let mut cpass = encoder.begin_compute_pass(&Default::default());
                cpass.set_pipeline(&self.pipelines.flare_threshold_pipeline);
                cpass.set_bind_group(0, &bg0, &[]);
                cpass.dispatch_workgroups(FLARE_MAP_SIZE / 16, FLARE_MAP_SIZE / 16, 1);
            }

            let bg0_ghosts = device.create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some("Flare BG0 Ghosts"),
                layout: &self.pipelines.flare_bgl_0,
                entries: &[
                    wgpu::BindGroupEntry {
                        binding: 0,
                        resource: wgpu::BindingResource::TextureView(input_texture_view),
                    },
                    wgpu::BindGroupEntry {
                        binding: 1,
                        resource: wgpu::BindingResource::TextureView(&self.flare_final_view),
                    },
                    wgpu::BindGroupEntry {
                        binding: 2,
                        resource: self.flare_params_buffer.as_entire_binding(),
                    },
                    wgpu::BindGroupEntry {
                        binding: 3,
                        resource: wgpu::BindingResource::Sampler(&self.pipelines.flare_sampler),
                    },
                ],
            });

            let bg1 = device.create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some("Flare BG1"),
                layout: &self.pipelines.flare_bgl_1,
                entries: &[
                    wgpu::BindGroupEntry {
                        binding: 0,
                        resource: wgpu::BindingResource::TextureView(&self.flare_threshold_view),
                    },
                    wgpu::BindGroupEntry {
                        binding: 1,
                        resource: wgpu::BindingResource::TextureView(&self.flare_ghosts_view),
                    },
                ],
            });

            {
                let mut cpass = encoder.begin_compute_pass(&Default::default());
                cpass.set_pipeline(&self.pipelines.flare_ghosts_pipeline);
                cpass.set_bind_group(0, &bg0_ghosts, &[]);
                cpass.set_bind_group(1, &bg1, &[]);
                cpass.dispatch_workgroups(FLARE_MAP_SIZE / 16, FLARE_MAP_SIZE / 16, 1);
            }

            queue.submit(Some(encoder.finish()));
        }

        const TILE_SIZE: u32 = 2048;
        const TILE_OVERLAP: u32 = 128;

        let output_len = if skip_cpu_readback {
            0
        } else {
            (out_width * out_height * 4) as usize
        };
        let mut final_pixels = match output_precision {
            RenderOutputPrecision::EightBit => RenderedPixels::U8(vec![0u8; output_len]),
            RenderOutputPrecision::SixteenBit => RenderedPixels::U16(vec![0u16; output_len]),
        };

        let blur_cache_key = BlurCacheKey {
            input_generation: input.generation,
            bounds: (bounds.x, bounds.y, bounds.width, bounds.height),
        };
        let blurs_are_cached = {
            let mut blur_cache = self.blur_cache.lock().unwrap();
            let cached = *blur_cache == Some(blur_cache_key);
            if !cached {
                // Cleared until every tile below has refreshed its part.
                *blur_cache = None;
            }
            cached
        };

        let start_tile_x = bounds.x / TILE_SIZE;
        let start_tile_y = bounds.y / TILE_SIZE;
        let end_tile_x = (bounds.x + bounds.width).div_ceil(TILE_SIZE);
        let end_tile_y = (bounds.y + bounds.height).div_ceil(TILE_SIZE);

        for tile_y in start_tile_y..end_tile_y {
            for tile_x in start_tile_x..end_tile_x {
                let x_start_unclamped = tile_x * TILE_SIZE;
                let y_start_unclamped = tile_y * TILE_SIZE;

                let x_start = x_start_unclamped.max(bounds.x);
                let y_start = y_start_unclamped.max(bounds.y);
                let x_end = (x_start_unclamped + TILE_SIZE)
                    .min(bounds.x + bounds.width)
                    .min(width);
                let y_end = (y_start_unclamped + TILE_SIZE)
                    .min(bounds.y + bounds.height)
                    .min(height);

                let tile_width = x_end - x_start;
                let tile_height = y_end - y_start;

                let input_x_start = (x_start as i32 - TILE_OVERLAP as i32).max(0) as u32;
                let input_y_start = (y_start as i32 - TILE_OVERLAP as i32).max(0) as u32;
                let input_x_end = (x_end + TILE_OVERLAP).min(width);
                let input_y_end = (y_end + TILE_OVERLAP).min(height);
                let input_width = input_x_end - input_x_start;
                let input_height = input_y_end - input_y_start;

                let input_texture_size = wgpu::Extent3d {
                    width: input_width,
                    height: input_height,
                    depth_or_array_layers: 1,
                };

                let run_blur = |base_radius: f32, output_view: &wgpu::TextureView| {
                    let radius = (base_radius * scale).ceil().max(1.0) as u32;

                    let params = BlurParams {
                        radius,
                        tile_offset_x: input_x_start,
                        tile_offset_y: input_y_start,
                        input_width,
                        input_height,
                        output_start_x: x_start,
                        output_start_y: y_start,
                        output_end_x: x_end,
                        output_end_y: y_end,
                        _pad1: 0,
                        _pad2: 0,
                        _pad3: 0,
                    };
                    queue.write_buffer(&self.blur_params_buffer, 0, bytemuck::bytes_of(&params));

                    let mut blur_encoder = device.create_command_encoder(&Default::default());

                    let h_blur_bg = device.create_bind_group(&wgpu::BindGroupDescriptor {
                        label: Some("H-Blur BG"),
                        layout: &self.pipelines.blur_bgl,
                        entries: &[
                            wgpu::BindGroupEntry {
                                binding: 0,
                                resource: wgpu::BindingResource::TextureView(input_texture_view),
                            },
                            wgpu::BindGroupEntry {
                                binding: 1,
                                resource: wgpu::BindingResource::TextureView(&self.ping_pong_view),
                            },
                            wgpu::BindGroupEntry {
                                binding: 2,
                                resource: self.blur_params_buffer.as_entire_binding(),
                            },
                        ],
                    });

                    {
                        let mut cpass = blur_encoder.begin_compute_pass(&Default::default());
                        cpass.set_pipeline(&self.pipelines.h_blur_pipeline);
                        cpass.set_bind_group(0, &h_blur_bg, &[]);
                        cpass.dispatch_workgroups(input_width.div_ceil(256), input_height, 1);
                    }

                    let v_blur_bg = device.create_bind_group(&wgpu::BindGroupDescriptor {
                        label: Some("V-Blur BG"),
                        layout: &self.pipelines.blur_bgl,
                        entries: &[
                            wgpu::BindGroupEntry {
                                binding: 0,
                                resource: wgpu::BindingResource::TextureView(&self.ping_pong_view),
                            },
                            wgpu::BindGroupEntry {
                                binding: 1,
                                resource: wgpu::BindingResource::TextureView(output_view),
                            },
                            wgpu::BindGroupEntry {
                                binding: 2,
                                resource: self.blur_params_buffer.as_entire_binding(),
                            },
                        ],
                    });

                    {
                        let mut cpass = blur_encoder.begin_compute_pass(&Default::default());
                        cpass.set_pipeline(&self.pipelines.v_blur_pipeline);
                        cpass.set_bind_group(0, &v_blur_bg, &[]);
                        cpass.dispatch_workgroups(input_width, input_height.div_ceil(256), 1);
                    }

                    queue.submit(Some(blur_encoder.finish()));
                };

                if !blurs_are_cached {
                    run_blur(1.0, &self.sharpness_blur_view);
                    run_blur(3.5, &self.tonal_blur_view);
                    run_blur(8.0, &self.clarity_blur_view);
                    run_blur(40.0, &self.structure_blur_view);
                }

                let mut main_encoder = device.create_command_encoder(&Default::default());

                let mut tile_adjustments = adjustments;
                tile_adjustments.tile_offset_x = input_x_start;
                tile_adjustments.tile_offset_y = input_y_start;
                queue.write_buffer(
                    &self.adjustments_buffer,
                    0,
                    bytemuck::bytes_of(&tile_adjustments),
                );

                let mut bind_group_entries = vec![
                    wgpu::BindGroupEntry {
                        binding: 0,
                        resource: wgpu::BindingResource::TextureView(input_texture_view),
                    },
                    wgpu::BindGroupEntry {
                        binding: 1,
                        resource: wgpu::BindingResource::TextureView(output_tile_view),
                    },
                    wgpu::BindGroupEntry {
                        binding: 2,
                        resource: self.adjustments_buffer.as_entire_binding(),
                    },
                ];
                bind_group_entries.push(wgpu::BindGroupEntry {
                    binding: 3,
                    resource: wgpu::BindingResource::TextureView(mask_texture_view),
                });
                bind_group_entries.push(wgpu::BindGroupEntry {
                    binding: 3 + MAX_MASK_BINDINGS,
                    resource: wgpu::BindingResource::TextureView(&lut_texture_view),
                });
                bind_group_entries.push(wgpu::BindGroupEntry {
                    binding: 4 + MAX_MASK_BINDINGS,
                    resource: wgpu::BindingResource::Sampler(&lut_sampler),
                });

                bind_group_entries.push(wgpu::BindGroupEntry {
                    binding: 5 + MAX_MASK_BINDINGS,
                    resource: wgpu::BindingResource::TextureView(&self.sharpness_blur_view),
                });
                bind_group_entries.push(wgpu::BindGroupEntry {
                    binding: 6 + MAX_MASK_BINDINGS,
                    resource: wgpu::BindingResource::TextureView(&self.tonal_blur_view),
                });
                bind_group_entries.push(wgpu::BindGroupEntry {
                    binding: 7 + MAX_MASK_BINDINGS,
                    resource: wgpu::BindingResource::TextureView(&self.clarity_blur_view),
                });
                bind_group_entries.push(wgpu::BindGroupEntry {
                    binding: 8 + MAX_MASK_BINDINGS,
                    resource: wgpu::BindingResource::TextureView(&self.structure_blur_view),
                });

                bind_group_entries.push(wgpu::BindGroupEntry {
                    binding: 9 + MAX_MASK_BINDINGS,
                    resource: wgpu::BindingResource::TextureView(if flare_amount > 0.0 {
                        &self.flare_ghosts_view
                    } else {
                        &self.pipelines.dummy_blur_view
                    }),
                });
                bind_group_entries.push(wgpu::BindGroupEntry {
                    binding: 10 + MAX_MASK_BINDINGS,
                    resource: wgpu::BindingResource::Sampler(&self.pipelines.flare_sampler),
                });

                let bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
                    label: Some("Tile Bind Group"),
                    layout: output_bgl,
                    entries: &bind_group_entries,
                });

                {
                    let mut compute_pass = main_encoder.begin_compute_pass(&Default::default());
                    compute_pass.set_pipeline(output_pipeline);
                    compute_pass.set_bind_group(0, &bind_group, &[]);
                    compute_pass.dispatch_workgroups(
                        input_width.div_ceil(8),
                        input_height.div_ceil(8),
                        1,
                    );
                }

                let crop_x_start = x_start - input_x_start;
                let crop_y_start = y_start - input_y_start;

                if output_to_display {
                    main_encoder.copy_texture_to_texture(
                        wgpu::TexelCopyTextureInfo {
                            texture: &self.tile_output_texture,
                            mip_level: 0,
                            origin: wgpu::Origin3d {
                                x: crop_x_start,
                                y: crop_y_start,
                                z: 0,
                            },
                            aspect: wgpu::TextureAspect::All,
                        },
                        wgpu::TexelCopyTextureInfo {
                            texture: &self.working_texture,
                            mip_level: 0,
                            origin: wgpu::Origin3d {
                                x: x_start,
                                y: y_start,
                                z: 0,
                            },
                            aspect: wgpu::TextureAspect::All,
                        },
                        wgpu::Extent3d {
                            width: tile_width,
                            height: tile_height,
                            depth_or_array_layers: 1,
                        },
                    );
                }

                queue.submit(Some(main_encoder.finish()));

                if !skip_cpu_readback {
                    let processed_tile_data = read_texture_data_roi(
                        device,
                        queue,
                        output_tile_texture,
                        wgpu::Origin3d::ZERO,
                        input_texture_size,
                        bytes_per_pixel,
                    )?;

                    match &mut final_pixels {
                        RenderedPixels::U8(final_pixels) => {
                            for row in 0..tile_height {
                                let final_y = y_start + row - bounds.y;
                                let final_x = x_start - bounds.x;
                                let final_row_offset = (final_y * out_width + final_x) as usize * 4;
                                let source_y = crop_y_start + row;
                                let source_row_offset =
                                    (source_y * input_width + crop_x_start) as usize * 4;
                                let copy_bytes = (tile_width * 4) as usize;

                                final_pixels[final_row_offset..final_row_offset + copy_bytes]
                                    .copy_from_slice(
                                        &processed_tile_data
                                            [source_row_offset..source_row_offset + copy_bytes],
                                    );
                            }
                        }
                        RenderedPixels::U16(final_pixels) => {
                            for row in 0..tile_height {
                                let final_y = y_start + row - bounds.y;
                                let final_x = x_start - bounds.x;
                                let final_row_offset = (final_y * out_width + final_x) as usize * 4;
                                let source_y = crop_y_start + row;
                                let source_pixel_offset =
                                    (source_y * input_width + crop_x_start) as usize;

                                for sample in 0..(tile_width as usize * 4) {
                                    let source_byte_offset = (source_pixel_offset * 4 + sample) * 2;
                                    let bits = u16::from_ne_bytes([
                                        processed_tile_data[source_byte_offset],
                                        processed_tile_data[source_byte_offset + 1],
                                    ]);
                                    let value = f16::from_bits(bits).to_f32();
                                    final_pixels[final_row_offset + sample] = if value.is_finite() {
                                        (value.clamp(0.0, 1.0) * u16::MAX as f32).round() as u16
                                    } else {
                                        0
                                    };
                                }
                            }
                        }
                    }
                }
            }
        }

        // Every tile has stored its blurs, so the next render of this input and region
        // can reuse them. A failed tile returned above and leaves the cache empty.
        *self.blur_cache.lock().unwrap() = Some(blur_cache_key);

        Ok((final_pixels, out_width, out_height, bounds.x, bounds.y))
    }
}

pub fn process_and_get_dynamic_image(
    context: &GpuContext,
    state: &tauri::State<AppState>,
    base_image: &DynamicImage,
    transform_hash: u64,
    request: RenderRequest,
    caller_id: &str,
) -> Result<DynamicImage, String> {
    process_and_get_dynamic_image_inner(
        context,
        state,
        base_image,
        transform_hash,
        request,
        caller_id,
        RenderOutputPrecision::EightBit,
        false,
        None,
    )
}

pub fn process_and_get_dynamic_image_with_precision(
    context: &GpuContext,
    state: &tauri::State<AppState>,
    base_image: &DynamicImage,
    transform_hash: u64,
    request: RenderRequest,
    caller_id: &str,
    output_precision: RenderOutputPrecision,
) -> Result<DynamicImage, String> {
    process_and_get_dynamic_image_inner(
        context,
        state,
        base_image,
        transform_hash,
        request,
        caller_id,
        output_precision,
        false,
        None,
    )
}

#[allow(clippy::too_many_arguments)]
pub fn process_and_get_dynamic_image_with_analytics(
    context: &GpuContext,
    state: &tauri::State<AppState>,
    base_image: &DynamicImage,
    transform_hash: u64,
    request: RenderRequest,
    caller_id: &str,
    output_to_display: bool,
    analytics_config: Option<crate::AnalyticsConfig>,
) -> Result<DynamicImage, String> {
    process_and_get_dynamic_image_inner(
        context,
        state,
        base_image,
        transform_hash,
        request,
        caller_id,
        RenderOutputPrecision::EightBit,
        output_to_display,
        analytics_config,
    )
}

#[allow(clippy::too_many_arguments)]
fn process_and_get_dynamic_image_inner(
    context: &GpuContext,
    state: &tauri::State<AppState>,
    base_image: &DynamicImage,
    transform_hash: u64,
    request: RenderRequest,
    caller_id: &str,
    output_precision: RenderOutputPrecision,
    output_to_display: bool,
    analytics_config: Option<crate::AnalyticsConfig>,
) -> Result<DynamicImage, String> {
    let start_time = Instant::now();
    let (width, height) = base_image.dimensions();
    let device = &context.device;
    let queue = &context.queue;

    let max_dim = context.limits.max_texture_dimension_2d;
    if width > max_dim || height > max_dim {
        return Err(format!(
            "Image dimensions ({}x{}) exceed the GPU texture limit ({}). The image could not be processed; try reducing its dimensions.",
            width, height, max_dim
        ));
    }

    let mut processor_lock = state.gpu_processor.lock().unwrap();
    let mut needs_new_processor = false;
    let new_width = (width + 255) & !255;
    let new_height = (height + 255) & !255;

    if let Some(p) = processor_lock.as_ref() {
        if p.width < width || p.height < height {
            needs_new_processor = true;
        }
    } else {
        needs_new_processor = true;
    }

    if needs_new_processor {
        log::info!(
            "Creating new GPU Processor for dimensions up to {}x{}",
            new_width,
            new_height
        );

        let old_processor = processor_lock.take();
        drop(old_processor);

        let _ = context.device.poll(wgpu::PollType::Wait {
            submission_index: None,
            timeout: Some(std::time::Duration::from_millis(500)),
        });

        let new_processor = GpuProcessor::new(context.clone(), new_width, new_height)?;

        *processor_lock = Some(crate::GpuProcessorState {
            processor: new_processor,
            width: new_width,
            height: new_height,
        });
    }

    let processor_state = processor_lock.as_ref().unwrap();
    let processor = &processor_state.processor;

    let mut cache_lock = state.gpu_image_cache.lock().unwrap();
    let mut needs_new_cache = false;

    if let Some(cache) = &*cache_lock {
        if cache.transform_hash != transform_hash || cache.width != width || cache.height != height
        {
            needs_new_cache = true;
        }
    } else {
        needs_new_cache = true;
    }

    if needs_new_cache {
        let old_cache = cache_lock.take();
        drop(old_cache);

        let _ = context.device.poll(wgpu::PollType::Wait {
            submission_index: None,
            timeout: Some(std::time::Duration::from_millis(500)),
        });

        let img_rgba_f16 = to_rgba_f16(base_image);
        let texture_size = wgpu::Extent3d {
            width,
            height,
            depth_or_array_layers: 1,
        };
        let texture = device.create_texture_with_data(
            queue,
            &wgpu::TextureDescriptor {
                label: Some("Input Texture"),
                size: texture_size,
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format: wgpu::TextureFormat::Rgba16Float,
                usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
                view_formats: &[],
            },
            TextureDataOrder::MipMajor,
            bytemuck::cast_slice(&img_rgba_f16),
        );
        let texture_view = texture.create_view(&Default::default());

        *cache_lock = Some(GpuImageCache {
            texture,
            texture_view,
            width,
            height,
            transform_hash,
            generation: NEXT_INPUT_GENERATION.fetch_add(1, std::sync::atomic::Ordering::Relaxed),
        });
    }

    let cache = cache_lock.as_ref().unwrap();

    let mask_view = processor.mask_texture_view(request.mask_bitmaps, width, height);
    let motion = processor.motion_blurred(cache, base_image, &request, &mask_view)?;
    let (input, mask_view) = match &motion {
        Some(blurred) => (
            RenderInput {
                texture_view: &blurred.view,
                width,
                height,
                generation: blurred.generation,
            },
            blurred.mask_view.as_ref().unwrap_or(&mask_view),
        ),
        None => (RenderInput::from_cache(cache), &mask_view),
    };

    let skip_readback = output_to_display;

    let (processed_pixels, out_w, out_h, out_x, out_y) = processor.run(
        input,
        mask_view,
        request,
        skip_readback,
        output_to_display,
        output_precision,
    )?;

    let mut final_encoder = device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
        label: Some("Final Passes Encoder"),
    });
    let mut submit_final_encoder = false;

    let mut async_readback_buffer: Option<wgpu::Buffer> = None;
    let mut async_padded_bpr: u32 = 0;
    let mut async_unpadded_bpr: u32 = 0;

    if analytics_config.is_some() && skip_readback {
        let unpadded_bytes_per_row = 4 * out_w;
        let align = wgpu::COPY_BYTES_PER_ROW_ALIGNMENT;
        let padded_bytes_per_row = (unpadded_bytes_per_row + align - 1) & !(align - 1);
        let output_buffer_size = (padded_bytes_per_row * out_h) as u64;

        let output_buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("Async Analytics Readback Buffer"),
            size: output_buffer_size,
            usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
            mapped_at_creation: false,
        });

        final_encoder.copy_texture_to_buffer(
            wgpu::TexelCopyTextureInfo {
                texture: &processor.working_texture,
                mip_level: 0,
                origin: wgpu::Origin3d {
                    x: out_x,
                    y: out_y,
                    z: 0,
                },
                aspect: wgpu::TextureAspect::All,
            },
            wgpu::TexelCopyBufferInfo {
                buffer: &output_buffer,
                layout: wgpu::TexelCopyBufferLayout {
                    offset: 0,
                    bytes_per_row: Some(padded_bytes_per_row),
                    rows_per_image: Some(out_h),
                },
            },
            wgpu::Extent3d {
                width: out_w,
                height: out_h,
                depth_or_array_layers: 1,
            },
        );

        async_readback_buffer = Some(output_buffer);
        async_padded_bpr = padded_bytes_per_row;
        async_unpadded_bpr = unpadded_bytes_per_row;
        submit_final_encoder = true;
    }

    if output_to_display {
        final_encoder.copy_texture_to_texture(
            wgpu::TexelCopyTextureInfo {
                texture: &processor.working_texture,
                mip_level: 0,
                origin: wgpu::Origin3d {
                    x: out_x,
                    y: out_y,
                    z: 0,
                },
                aspect: wgpu::TextureAspect::All,
            },
            wgpu::TexelCopyTextureInfo {
                texture: &processor.output_texture,
                mip_level: 0,
                origin: wgpu::Origin3d {
                    x: out_x,
                    y: out_y,
                    z: 0,
                },
                aspect: wgpu::TextureAspect::All,
            },
            wgpu::Extent3d {
                width: out_w,
                height: out_h,
                depth_or_array_layers: 1,
            },
        );
        submit_final_encoder = true;
    }

    if submit_final_encoder {
        queue.submit(Some(final_encoder.finish()));
    }

    if let Some(analytics) = analytics_config {
        if let Some(buffer) = async_readback_buffer {
            let output_buffer: wgpu::Buffer = buffer;
            let padded_bytes_per_row: u32 = async_padded_bpr;
            let unpadded_bytes_per_row: u32 = async_unpadded_bpr;
            let device_clone = context.device.clone();

            std::thread::spawn(move || {
                let buffer_slice = output_buffer.slice(..);
                let (tx, rx) = std::sync::mpsc::channel::<Result<(), wgpu::BufferAsyncError>>();

                buffer_slice.map_async(wgpu::MapMode::Read, move |result| {
                    let _ = tx.send(result);
                });

                if let Err(e) = device_clone.poll(wgpu::PollType::Wait {
                    submission_index: None,
                    timeout: Some(std::time::Duration::from_secs(60)),
                }) {
                    log::error!("Async analytics readback poll failed: {}", e);
                    return;
                }

                if let Ok(Ok(())) = rx.recv() {
                    let padded_data = match buffer_slice.get_mapped_range() {
                        Ok(range) => range.to_vec(),
                        Err(e) => {
                            log::error!("Failed to get mapped GPU buffer range: {}", e);
                            return;
                        }
                    };
                    output_buffer.unmap();

                    let mut unpadded_data =
                        Vec::with_capacity((unpadded_bytes_per_row * out_h) as usize);
                    if padded_bytes_per_row == unpadded_bytes_per_row {
                        unpadded_data = padded_data;
                    } else {
                        for chunk in padded_data.chunks(padded_bytes_per_row as usize) {
                            unpadded_data
                                .extend_from_slice(&chunk[..unpadded_bytes_per_row as usize]);
                        }
                    }

                    if let Some(img_buf) =
                        ImageBuffer::<Rgba<u8>, _>::from_raw(out_w, out_h, unpadded_data)
                    {
                        let dynamic_img = DynamicImage::ImageRgba8(img_buf);
                        let _ = analytics.sender.send(crate::AnalyticsJob {
                            path: analytics.path,
                            image: std::sync::Arc::new(dynamic_img),
                            compute_waveform: analytics.compute_waveform,
                            active_waveform_channel: analytics.active_waveform_channel,
                            clipping_overlay: analytics.clipping_overlay,
                        });
                    }
                }
            });
        } else {
            if let RenderedPixels::U8(pixels) = &processed_pixels {
                let pixels_clone = pixels.clone();
                std::thread::spawn(move || {
                    if let Some(img_buf) =
                        ImageBuffer::<Rgba<u8>, _>::from_raw(out_w, out_h, pixels_clone)
                    {
                        let dynamic_img = DynamicImage::ImageRgba8(img_buf);
                        let _ = analytics.sender.send(crate::AnalyticsJob {
                            path: analytics.path,
                            image: std::sync::Arc::new(dynamic_img),
                            compute_waveform: analytics.compute_waveform,
                            active_waveform_channel: analytics.active_waveform_channel,
                            clipping_overlay: analytics.clipping_overlay,
                        });
                    }
                });
            } else {
                log::warn!("Skipping analytics for a high-precision CPU readback");
            }
        }
    }

    if output_to_display
        && let Ok(mut display_lock) = context.display.lock()
        && let Some(display) = display_lock.as_mut()
    {
        display.latest_transform.image_size = [width as f32, height as f32];
        display.latest_transform.texture_size =
            [processor_state.width as f32, processor_state.height as f32];

        queue.write_buffer(
            &display.transform_buffer,
            0,
            bytemuck::bytes_of(&display.latest_transform),
        );

        let bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            layout: &display.bind_group_layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: display.transform_buffer.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: wgpu::BindingResource::TextureView(&processor.output_texture_view),
                },
                wgpu::BindGroupEntry {
                    binding: 2,
                    resource: wgpu::BindingResource::Sampler(&display.sampler),
                },
            ],
            label: None,
        });
        display.current_bind_group = Some(bind_group);
        display.render(device, queue);
    }

    if skip_readback {
        let duration = start_time.elapsed();
        let fps = 1.0 / duration.as_secs_f64();
        log::info!(
            "[{}] {}x{} native WGPU display updated in {:?} ({:.2} FPS)",
            caller_id,
            width,
            height,
            duration,
            fps
        );
        return Ok(DynamicImage::new_rgba8(0, 0));
    }

    let duration = start_time.elapsed();
    let fps = 1.0 / duration.as_secs_f64();
    log::info!(
        "[{}] {}x{} processed (ROI: {}x{}) on GPU in {:?} ({:.2} FPS)",
        caller_id,
        width,
        height,
        out_w,
        out_h,
        duration,
        fps
    );

    match processed_pixels {
        RenderedPixels::U8(pixels) => {
            let img_buf = ImageBuffer::<Rgba<u8>, Vec<u8>>::from_raw(out_w, out_h, pixels)
                .ok_or("Failed to create 8-bit image buffer from GPU data")?;
            Ok(DynamicImage::ImageRgba8(img_buf))
        }
        RenderedPixels::U16(pixels) => {
            let img_buf = ImageBuffer::<Rgba<u16>, Vec<u16>>::from_raw(out_w, out_h, pixels)
                .ok_or("Failed to create 16-bit image buffer from GPU data")?;
            Ok(DynamicImage::ImageRgba16(img_buf))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        SampleProbe, flare_generation_amount, high_precision_shader_source, image_shader_source,
    };
    use crate::image_processing::AllAdjustments;

    #[test]
    fn sample_probes_match_the_shader_constants() {
        let source = image_shader_source();
        assert!(source.contains("override SAMPLE_PROBE: u32 = 0u;"));
        for (probe, name) in [
            (SampleProbe::Hsl, "SAMPLE_PROBE_HSL"),
            (SampleProbe::Curve, "SAMPLE_PROBE_CURVE"),
            (SampleProbe::MaskCurve, "SAMPLE_PROBE_MASK_CURVE"),
            (SampleProbe::PointColor, "SAMPLE_PROBE_POINT_COLOR"),
        ] {
            let constant = format!("const {name}: u32 = {}u;", probe.shader_value());
            assert!(source.contains(&constant), "missing `{constant}`");
            assert!(source.contains(&format!("if (SAMPLE_PROBE == {name})")));
        }
        assert_eq!(
            serde_json::from_str::<SampleProbe>("\"maskCurve\"").unwrap(),
            SampleProbe::MaskCurve
        );
    }

    #[test]
    fn high_precision_shader_keeps_shared_transfer_and_changes_storage_format() {
        let source = high_precision_shader_source();
        assert!(source.contains("texture_storage_2d<rgba16float, write>"));
        assert!(!source.contains("texture_storage_2d<rgba8unorm, write>"));
        assert!(source.contains("override HIGH_PRECISION_OUTPUT: u32 = 0u"));
        assert!(source.contains("base_srgb = linear_to_srgb"));
    }

    #[test]
    fn mask_only_flare_activates_flare_generation() {
        let mut adjustments = AllAdjustments {
            mask_count: 1,
            ..Default::default()
        };
        adjustments.mask_adjustments[0].flare_amount = 0.65;

        assert_eq!(flare_generation_amount(&adjustments), 0.65);
    }

    /// A compute-only context, or `None` on machines without a usable GPU adapter.
    fn headless_gpu_context() -> Option<crate::image_processing::GpuContext> {
        let instance = wgpu::Instance::default();
        let adapter =
            pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions::default()))
                .ok()?;
        let limits = adapter.limits();
        let (device, queue) = pollster::block_on(adapter.request_device(&wgpu::DeviceDescriptor {
            required_limits: limits.clone(),
            ..Default::default()
        }))
        .ok()?;
        Some(crate::image_processing::GpuContext {
            device: std::sync::Arc::new(device),
            queue: std::sync::Arc::new(queue),
            limits,
            display: Default::default(),
            pipelines: Default::default(),
        })
    }

    fn upload_test_image(
        context: &crate::image_processing::GpuContext,
        image: &image::DynamicImage,
    ) -> crate::app_state::GpuImageCache {
        use wgpu::util::DeviceExt;
        let (width, height) = (image.width(), image.height());
        let texture = context.device.create_texture_with_data(
            &context.queue,
            &wgpu::TextureDescriptor {
                label: Some("Test Input Texture"),
                size: wgpu::Extent3d {
                    width,
                    height,
                    depth_or_array_layers: 1,
                },
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format: wgpu::TextureFormat::Rgba16Float,
                usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
                view_formats: &[],
            },
            wgpu::util::TextureDataOrder::MipMajor,
            bytemuck::cast_slice(&super::to_rgba_f16(image)),
        );
        let texture_view = texture.create_view(&Default::default());
        crate::app_state::GpuImageCache {
            texture,
            texture_view,
            width,
            height,
            transform_hash: 0,
            generation: super::NEXT_INPUT_GENERATION
                .fetch_add(1, std::sync::atomic::Ordering::Relaxed),
        }
    }

    #[test]
    fn reused_blurs_render_the_same_pixels_as_fresh_ones() {
        let Some(context) = headless_gpu_context() else {
            eprintln!("No GPU adapter; skipping the blur cache render test.");
            return;
        };
        // Wider than one 2048 px tile, so the blurs of two tiles share the blur textures.
        let (width, height) = (2600, 1500);
        let image =
            image::DynamicImage::ImageRgb32F(image::ImageBuffer::from_fn(width, height, |x, y| {
                let ripple = ((x * 7 + y * 13) % 97) as f32 / 97.0;
                image::Rgb([x as f32 / width as f32, y as f32 / height as f32, ripple])
            }));
        let input = upload_test_image(&context, &image);
        let processor =
            super::GpuProcessor::new(context, (width + 255) & !255, (height + 255) & !255)
                .expect("processor");

        let mut adjustments = AllAdjustments::default();
        adjustments.global.exposure = 0.3;
        adjustments.global.shadows = 40.0;
        adjustments.global.highlights = -30.0;
        adjustments.global.sharpness = 60.0;
        adjustments.global.clarity = 35.0;
        adjustments.global.structure = 45.0;
        adjustments.global.dehaze = 20.0;

        let mask_view = processor.mask_texture_view(&[], width, height);
        let render = |roi: Option<super::Roi>| -> Vec<u8> {
            let request = super::RenderRequest {
                adjustments,
                mask_bitmaps: &[],
                lut: None,
                roi,
                probe: None,
                motion_blur: Default::default(),
            };
            match processor
                .run(
                    super::RenderInput::from_cache(&input),
                    &mask_view,
                    request,
                    false,
                    false,
                    super::RenderOutputPrecision::EightBit,
                )
                .expect("render")
                .0
            {
                super::RenderedPixels::U8(pixels) => pixels,
                super::RenderedPixels::U16(_) => unreachable!("8-bit render"),
            }
        };
        let roi = Some(super::Roi {
            x: 1900,
            y: 300,
            width: 500,
            height: 900,
        });

        let fresh_full = render(None);
        assert_eq!(render(None), fresh_full, "reused blurs, whole image");
        let fresh_roi = render(roi);
        assert_eq!(render(roi), fresh_roi, "reused blurs, region");
        assert_eq!(render(None), fresh_full, "blurs refreshed after the region");
    }

    /// OKLab of a display sRGB pixel, for checking the shader's Zone Tint.
    fn srgb_to_oklab(pixel: &[u16]) -> [f32; 3] {
        let linear = |value: u16| crate::zone_tint::srgb_to_linear(value as f32 / u16::MAX as f32);
        crate::zone_tint::linear_srgb_to_oklab([
            linear(pixel[0]),
            linear(pixel[1]),
            linear(pixel[2]),
        ])
    }

    #[test]
    fn zone_tint_colours_its_zones_and_keeps_every_tone() {
        let Some(context) = headless_gpu_context() else {
            eprintln!("No GPU adapter; skipping the Zone Tint render test.");
            return;
        };
        // A grey ramp even in OKLab L (linear value = L³).
        let (width, height) = (1024, 4);
        let image =
            image::DynamicImage::ImageRgb32F(image::ImageBuffer::from_fn(width, height, |x, _| {
                let value = (x as f32 / (width - 1) as f32).powi(3);
                image::Rgb([value, value, value])
            }));
        let input = upload_test_image(&context, &image);
        let processor = super::GpuProcessor::new(context, width, 256).expect("processor");
        let mask_view = processor.mask_texture_view(&[], width, height);
        let render = |zone_tint: serde_json::Value| -> Vec<[f32; 3]> {
            let mut adjustments = AllAdjustments::default();
            adjustments.global.monochrome = 1;
            adjustments.global.zone_tint =
                crate::zone_tint::ZoneTintSettings::from_json(Some(&zone_tint), true);
            let request = super::RenderRequest {
                adjustments,
                mask_bitmaps: &[],
                lut: None,
                roi: None,
                probe: None,
                motion_blur: Default::default(),
            };
            match processor
                .run(
                    super::RenderInput::from_cache(&input),
                    &mask_view,
                    request,
                    false,
                    false,
                    super::RenderOutputPrecision::SixteenBit,
                )
                .expect("render")
                .0
            {
                super::RenderedPixels::U16(pixels) => pixels[..width as usize * 4]
                    .chunks(4)
                    .map(srgb_to_oklab)
                    .collect(),
                super::RenderedPixels::U8(_) => unreachable!("16-bit render"),
            }
        };
        let chroma = |lab: &[f32; 3]| lab[1].hypot(lab[2]);

        let plain = render(serde_json::json!({}));
        let mut zones = vec![serde_json::json!({}); 11];
        zones[7] = serde_json::json!({ "hue": 60, "strength": 100 });
        let zone_seven = render(serde_json::json!({ "zones": zones }));
        let all_zones = render(serde_json::json!({
            "zones": vec![serde_json::json!({ "hue": 200, "strength": 50 }); 11],
        }));

        let mut checked_peak = 0;
        for ((plain, seven), all) in plain.iter().zip(&zone_seven).zip(&all_zones) {
            let l = plain[0];
            assert!((seven[0] - l).abs() < 1e-3, "Zone VII tint moved L {l}");
            assert!((all[0] - l).abs() < 1e-3, "full tint moved L {l}");
            if (l - 0.7).abs() < 0.01 {
                // About 92 % of strength 100 (chroma 0.10) at the zone's centre.
                assert!(chroma(seven) > 0.08, "Zone VII centre at L {l}");
                checked_peak += 1;
            }
            if (l - 0.4).abs() < 0.02 {
                assert!(chroma(seven) < 2e-3, "Zone IV stays neutral at L {l}");
            }
            if (0.3..0.8).contains(&l) {
                assert!((chroma(all) - 0.05).abs() < 3e-3, "uniform tint at L {l}");
            }
            if !(0.005..=0.995).contains(&l) {
                assert!(
                    chroma(all) < 2e-3,
                    "Protect keeps the ends neutral at L {l}"
                );
            }
        }
        assert!(checked_peak > 0, "the ramp crosses Zone VII");

        // Luminance: Zone V up and Zone VI down by the most, at the narrowest softness, still
        // keeps every tone in order, and lifts Zone V's centre by about half a zone.
        let mut zones = vec![serde_json::json!({}); 11];
        zones[5] = serde_json::json!({ "luminance": 100 });
        zones[6] = serde_json::json!({ "luminance": -100 });
        let moved = render(serde_json::json!({ "softness": 0.02, "zones": zones }));
        for pair in moved.windows(2) {
            assert!(
                pair[1][0] >= pair[0][0] - 2e-3,
                "tones keep their order at L {}",
                pair[0][0]
            );
        }
        let mut checked_centre = 0;
        for (plain, moved) in plain.iter().zip(&moved) {
            let l = plain[0];
            assert!(
                chroma(moved) < 2e-3,
                "luminance alone stays neutral at L {l}"
            );
            if (l - 0.5).abs() < 0.005 {
                assert!((moved[0] - l - 0.05).abs() < 0.01, "Zone V lifted at L {l}");
                checked_centre += 1;
            }
        }
        assert!(checked_centre > 0, "the ramp crosses Zone V");
    }

    #[test]
    fn inactive_masks_do_not_activate_flare_generation() {
        let mut adjustments = AllAdjustments::default();
        adjustments.mask_adjustments[0].flare_amount = 0.65;

        assert_eq!(flare_generation_amount(&adjustments), 0.0);
    }
}
