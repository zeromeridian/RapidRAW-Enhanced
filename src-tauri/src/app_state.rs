use std::collections::{HashMap, HashSet, VecDeque};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::mpsc::Sender;
use std::sync::{Arc, Condvar, Mutex};

use image::DynamicImage;
use serde::{Deserialize, Serialize};
use sysinfo::Disks;
use tokio::sync::Mutex as TokioMutex;
use tokio::task::JoinHandle;
use wgpu::{Texture, TextureView};

use crate::ai_processing::AiState;
use crate::cache_utils::DecodedImageCache;
use crate::gpu_processing::GpuProcessor;
use crate::image_processing::GpuContext;
use crate::launch_request::ExternalEditSession;
use crate::lens_correction::LensDatabase;
use crate::lut_processing::Lut;

#[derive(Serialize, Deserialize)]
pub struct WindowState {
    pub width: u32,
    pub height: u32,
    pub x: i32,
    pub y: i32,
    pub maximized: bool,
    pub fullscreen: bool,
}

#[derive(Clone)]
pub struct LoadedImage {
    pub path: String,
    pub image: Arc<DynamicImage>,
    pub is_raw: bool,
}

/// The editor preview before its GPU stages (`lib::prepare_preview_source`): the patched image
/// shrunk for upload, and the warp, working size, effects and frame the GPU applies to it.
#[derive(Clone)]
pub struct PreviewSource {
    pub image: Arc<DynamicImage>,
    pub id: u64,
    pub warp: Option<crate::image_processing::GeometryParams>,
    pub working_fit: Option<(u32, u32)>,
    pub effects: crate::render_source::Effects,
    pub frame: crate::render_source::Frame,
    /// Preview pixels per photo pixel, for the framed (not fitted) preview.
    pub scale: f32,
    pub unscaled_crop_offset: (f32, f32),
}

impl PreviewSource {
    pub fn render_source(&self) -> crate::render_source::RenderSource<'_> {
        crate::render_source::RenderSource::new(&self.image, self.id, self.frame.clone())
            .with_warp(self.warp)
            .with_working_fit(self.working_fit)
            .with_effects(self.effects.clone())
    }
}

/// A thumbnail's patched photo, shrunk for upload (`file_management::generate_thumbnail_data`);
/// the warp, effects and frame run on it on the GPU.
#[derive(Clone)]
pub struct ThumbnailBase {
    /// `cache_utils::calculate_patch_hash` of the edit it was made for.
    pub hash: u64,
    pub image: DynamicImage,
    /// Its pixels per photo pixel (the crop's units).
    pub scale: f32,
    /// Not shrunk: no larger base exists.
    pub is_full_size: bool,
}

#[derive(Clone)]
pub struct CachedPreview {
    pub preview: PreviewSource,
    pub transform_hash: u64,
    pub preview_dim: u32,
}

pub struct GpuImageCache {
    pub texture: Texture,
    pub texture_view: TextureView,
    pub width: u32,
    pub height: u32,
    /// `RenderSource::key` of the image and stages this texture holds.
    pub source_key: u64,
    /// Unique per upload, so a processor can tell whether its cached blurs are of this
    /// texture (see `gpu_processing::BlurCacheKey`).
    pub generation: u64,
}

pub struct GpuProcessorState {
    pub processor: GpuProcessor,
    pub width: u32,
    pub height: u32,
}

/// The GPU state of one kind of render: a processor (with its cached blurs) and the sources
/// uploaded for it, most recently used first. Thumbnails have their own, so updating one does
/// not evict the editor's source and blurs.
#[derive(Default)]
pub struct GpuLane {
    pub processor: Mutex<Option<GpuProcessorState>>,
    pub sources: Mutex<Vec<GpuImageCache>>,
}

impl GpuLane {
    pub fn clear_sources(&self) {
        self.sources
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clear();
    }
}

pub struct PreviewJob {
    pub adjustments: serde_json::Value,
    pub is_interactive: bool,
    /// Shrinks an interactive frame further (0–1), e.g. while a mask shape is dragged.
    pub interactive_scale: Option<f32>,
    pub target_resolution: Option<u32>,
    pub roi: Option<(f32, f32, f32, f32)>,
    pub compute_analytics: bool,
    pub compute_waveform: bool,
    pub active_waveform_channel: Option<String>,
    pub responder: tokio::sync::oneshot::Sender<Vec<u8>>,
}

/// Crop's uncropped preview of `loaded_image`, the photo open when it was requested.
pub struct UncroppedPreviewJob {
    pub adjustments: serde_json::Value,
    pub loaded_image: LoadedImage,
    pub context: GpuContext,
}

pub struct AnalyticsJob {
    pub path: String,
    pub image: Arc<DynamicImage>,
    pub compute_waveform: bool,
    pub active_waveform_channel: Option<String>,
    /// The image carries the clipping-warning overlay (see `HistogramData`).
    pub clipping_overlay: bool,
}

pub struct AnalyticsConfig {
    pub path: String,
    pub compute_waveform: bool,
    pub active_waveform_channel: Option<String>,
    pub clipping_overlay: bool,
    pub sender: Sender<AnalyticsJob>,
}

pub struct ThumbnailProgressTracker {
    pub total: usize,
    pub completed: usize,
}

pub struct ThumbnailManager {
    /// Missing thumbnails requested by the currently visible Library/filmstrip.
    pub queue: Mutex<VecDeque<String>>,
    /// Low-priority work created only by an explicit folder refresh.
    pub refresh_queue: Mutex<VecDeque<String>>,
    pub cvar: Condvar,
    pub processing_now: Mutex<HashSet<String>>,
    active_context: Mutex<Option<String>>,
    active_context_generation: AtomicUsize,
    active_paths: Mutex<HashSet<String>>,
    pub rotational_disk: AtomicBool,
    pub io_gate: Mutex<()>,
    live_update_generation: AtomicUsize,
    latest_live_update: Mutex<HashMap<String, usize>>,
}

impl ThumbnailManager {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            queue: Mutex::new(VecDeque::new()),
            refresh_queue: Mutex::new(VecDeque::new()),
            cvar: Condvar::new(),
            processing_now: Mutex::new(HashSet::new()),
            active_context: Mutex::new(None),
            active_context_generation: AtomicUsize::new(0),
            active_paths: Mutex::new(HashSet::new()),
            rotational_disk: AtomicBool::new(false),
            io_gate: Mutex::new(()),
            live_update_generation: AtomicUsize::new(0),
            latest_live_update: Mutex::new(HashMap::new()),
        })
    }

    pub fn begin_live_update(&self, path: &str) -> usize {
        let generation = self
            .live_update_generation
            .fetch_add(1, std::sync::atomic::Ordering::Relaxed)
            + 1;
        self.latest_live_update
            .lock()
            .unwrap()
            .insert(path.to_string(), generation);
        generation
    }

    pub fn activate_context(&self, context_id: String) -> bool {
        let mut active_context = self.active_context.lock().unwrap();
        if active_context.as_deref() == Some(context_id.as_str()) {
            return false;
        }

        *active_context = Some(context_id);
        self.active_context_generation
            .fetch_add(1, std::sync::atomic::Ordering::AcqRel);
        self.queue.lock().unwrap().clear();
        self.active_paths.lock().unwrap().clear();
        true
    }

    pub fn register_active_paths(&self, paths: impl Iterator<Item = String>) {
        self.active_paths.lock().unwrap().extend(paths);
    }

    pub fn is_active_path(&self, path: &str) -> bool {
        self.active_paths.lock().unwrap().contains(path)
    }

    pub fn foreground_generation(&self) -> usize {
        self.active_context_generation
            .load(std::sync::atomic::Ordering::Acquire)
    }

    pub fn is_current_foreground_generation(&self, generation: usize) -> bool {
        self.foreground_generation() == generation
    }

    pub fn is_latest_live_update(&self, path: &str, generation: usize) -> bool {
        self.latest_live_update.lock().unwrap().get(path).copied() == Some(generation)
    }

    pub fn finish_live_update(&self, path: &str, generation: usize) {
        let mut latest = self.latest_live_update.lock().unwrap();
        if latest.get(path).copied() == Some(generation) {
            latest.remove(path);
        }
    }
}

pub struct PendingMetadata {
    pub virtual_path: String,
    pub image_path: PathBuf,
    pub sidecar_path: PathBuf,
}

pub struct MetadataManager {
    pub queue: Mutex<VecDeque<PendingMetadata>>,
    pub cvar: Condvar,
    pub pending: Mutex<HashSet<PathBuf>>,
}

impl MetadataManager {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            queue: Mutex::new(VecDeque::new()),
            cvar: Condvar::new(),
            pending: Mutex::new(HashSet::new()),
        })
    }
}

pub struct AppState {
    /// `settings.json` as last loaded or saved; see `app_settings::settings_snapshot`.
    pub settings: Mutex<Option<Arc<crate::app_settings::AppSettings>>>,
    /// Fair (FIFO) turn for file commands; see `blocking_command::run_in_file_order`.
    pub file_command_order: TokioMutex<()>,
    pub window_setup_complete: AtomicBool,
    pub gpu_crash_flag_path: Mutex<Option<PathBuf>>,
    pub original_image: Mutex<Option<LoadedImage>>,
    pub cached_preview: Mutex<Option<CachedPreview>>,
    pub gpu_context: Mutex<Option<GpuContext>>,
    /// The editor's renders and everything else but thumbnails (exports, previews).
    pub editor_gpu: GpuLane,
    /// Library and filmstrip thumbnails (`generate_thumbnail_data`).
    pub thumbnail_gpu: GpuLane,
    pub ai_state: Mutex<Option<AiState>>,
    pub ai_init_lock: TokioMutex<()>,
    pub export_task_token: Arc<Mutex<Option<Arc<AtomicBool>>>>,
    pub preset_batch_task_token: Arc<Mutex<Option<Arc<AtomicBool>>>>,
    /// The running import's cancel flag (`photo_import::import_files`).
    pub import_task_token: Arc<Mutex<Option<Arc<AtomicBool>>>>,
    /// Bumped by every Import source listing; older listings stop (`photo_import::scan_import_source`).
    pub import_scan_generation: AtomicUsize,
    pub hdr_result: Arc<Mutex<Option<DynamicImage>>>,
    pub panorama_result: Arc<Mutex<Option<DynamicImage>>>,
    pub denoise_result: Arc<Mutex<Option<DynamicImage>>>,
    pub indexing_task_handle: Mutex<Option<JoinHandle<()>>>,
    pub indexing_generation: AtomicUsize,
    /// Bumped by every folder listing; older listings and their EXIF reads stop.
    pub library_scan_generation: AtomicUsize,
    pub lut_cache: Mutex<HashMap<String, Arc<Lut>>>,
    pub initial_file_path: Mutex<Option<String>>,
    pub pending_edit_session: Mutex<Option<ExternalEditSession>>,
    pub thumbnail_cancellation_token: Arc<AtomicBool>,
    pub thumbnail_progress: Mutex<ThumbnailProgressTracker>,
    pub preview_worker_tx: Mutex<Option<Sender<PreviewJob>>>,
    pub analytics_worker_tx: Mutex<Option<Sender<AnalyticsJob>>>,
    pub uncropped_preview_worker_tx: Mutex<Option<Sender<UncroppedPreviewJob>>>,
    pub mask_cache: Mutex<crate::mask_generation::MaskCaches>,
    pub patch_cache: Mutex<HashMap<String, serde_json::Value>>,
    pub geometry_cache: Mutex<HashMap<u64, DynamicImage>>,
    pub thumbnail_base_cache: Mutex<HashMap<String, ThumbnailBase>>,
    pub lens_db: Mutex<Option<Arc<LensDatabase>>>,
    pub load_image_generation: Arc<AtomicUsize>,
    pub full_warped_cache: Mutex<Option<(u64, Arc<DynamicImage>)>>,
    /// The editor's patched full-resolution base (`lib::prepare_preview_source`).
    pub patched_cache: Mutex<Option<(u64, Arc<DynamicImage>)>>,
    /// That base shrunk for upload to the GPU (`lib::prepare_preview_source`).
    pub upload_cache: Mutex<Option<(u64, Arc<DynamicImage>)>>,
    pub decoded_image_cache: Mutex<DecodedImageCache>,
    pub image_preloader: crate::image_preload::ImagePreloader,
    pub thumbnail_manager: Arc<ThumbnailManager>,
    pub metadata_manager: Arc<MetadataManager>,
    pub disks_cache: Mutex<Option<Disks>>,
    pub disks_cache_refreshing: AtomicBool,
}

/// Marks a cancellable task (`AppState`'s preset batch or import) as running
/// and returns the flag that cancels it, or fails with `busy` while one runs.
/// The task empties `slot` when it ends.
pub fn start_cancellable_task(
    slot: &Mutex<Option<Arc<AtomicBool>>>,
    busy: &str,
) -> Result<Arc<AtomicBool>, String> {
    let mut active = slot.lock().unwrap();
    if active.is_some() {
        return Err(busy.to_string());
    }
    let token = Arc::new(AtomicBool::new(false));
    *active = Some(token.clone());
    Ok(token)
}

/// Asks the task running in `slot` to stop; false when none runs or it was asked already.
pub fn cancel_task(slot: &Mutex<Option<Arc<AtomicBool>>>) -> bool {
    slot.lock()
        .unwrap()
        .as_ref()
        .is_some_and(|token| !token.swap(true, Ordering::SeqCst))
}

#[cfg(test)]
mod cancellable_task_tests {
    use super::*;

    #[test]
    fn a_task_slot_takes_one_task_and_one_cancel() {
        let slot = Mutex::new(None);
        let token = start_cancellable_task(&slot, "busy").unwrap();
        assert_eq!(start_cancellable_task(&slot, "busy").unwrap_err(), "busy");
        assert!(cancel_task(&slot));
        assert!(!cancel_task(&slot));
        assert!(token.load(Ordering::SeqCst));
        *slot.lock().unwrap() = None;
        assert!(!cancel_task(&slot));
        assert!(start_cancellable_task(&slot, "busy").is_ok());
    }
}

#[cfg(test)]
mod thumbnail_manager_tests {
    use super::ThumbnailManager;

    #[test]
    fn only_the_latest_live_thumbnail_update_can_publish() {
        let manager = ThumbnailManager::new();
        let first = manager.begin_live_update("image.raw");
        let second = manager.begin_live_update("image.raw");

        assert!(!manager.is_latest_live_update("image.raw", first));
        assert!(manager.is_latest_live_update("image.raw", second));

        manager.finish_live_update("image.raw", first);
        assert!(manager.is_latest_live_update("image.raw", second));

        manager.finish_live_update("image.raw", second);
        assert!(!manager.is_latest_live_update("image.raw", second));
    }

    #[test]
    fn changing_context_discards_only_old_foreground_work() {
        let manager = ThumbnailManager::new();
        assert!(manager.activate_context("folder-a".to_string()));
        manager
            .queue
            .lock()
            .unwrap()
            .push_back("old.jpg".to_string());
        manager.register_active_paths(std::iter::once("old.jpg".to_string()));
        manager
            .refresh_queue
            .lock()
            .unwrap()
            .push_back("explicit.jpg".to_string());
        let old_generation = manager.foreground_generation();

        assert!(!manager.activate_context("folder-a".to_string()));
        assert_eq!(manager.queue.lock().unwrap().len(), 1);

        assert!(manager.activate_context("folder-b".to_string()));
        assert!(manager.queue.lock().unwrap().is_empty());
        assert!(!manager.is_active_path("old.jpg"));
        assert_eq!(manager.refresh_queue.lock().unwrap().len(), 1);
        assert!(!manager.is_current_foreground_generation(old_generation));
    }
}
