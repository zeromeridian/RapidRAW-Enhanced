use std::collections::{HashMap, HashSet, VecDeque};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicUsize};
use std::sync::mpsc::Sender;
use std::sync::{Arc, Condvar, Mutex};

use image::{DynamicImage, GrayImage};
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

#[derive(Clone)]
pub struct CachedPreview {
    pub image: Arc<DynamicImage>,
    pub small_image: Arc<DynamicImage>,
    pub transform_hash: u64,
    pub scale: f32,
    pub unscaled_crop_offset: (f32, f32),
    pub preview_dim: u32,
    pub interactive_divisor: f32,
}

pub struct GpuImageCache {
    pub texture: Texture,
    pub texture_view: TextureView,
    pub width: u32,
    pub height: u32,
    pub transform_hash: u64,
}

pub struct GpuProcessorState {
    pub processor: GpuProcessor,
    pub width: u32,
    pub height: u32,
}

pub struct PreviewJob {
    pub adjustments: serde_json::Value,
    pub is_interactive: bool,
    pub target_resolution: Option<u32>,
    pub roi: Option<(f32, f32, f32, f32)>,
    pub compute_waveform: bool,
    pub active_waveform_channel: Option<String>,
    pub responder: tokio::sync::oneshot::Sender<Vec<u8>>,
}

pub struct AnalyticsJob {
    pub path: String,
    pub image: Arc<DynamicImage>,
    pub compute_waveform: bool,
    pub active_waveform_channel: Option<String>,
}

pub struct AnalyticsConfig {
    pub path: String,
    pub compute_waveform: bool,
    pub active_waveform_channel: Option<String>,
    pub sender: Sender<AnalyticsJob>,
}

pub struct ThumbnailProgressTracker {
    pub total: usize,
    pub completed: usize,
}

pub struct ThumbnailManager {
    pub queue: Mutex<VecDeque<String>>,
    pub cvar: Condvar,
    pub processing_now: Mutex<HashSet<String>>,
    pub rotational_disk: AtomicBool,
    pub io_gate: Mutex<()>,
    live_update_generation: AtomicUsize,
    latest_live_update: Mutex<HashMap<String, usize>>,
}

impl ThumbnailManager {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            queue: Mutex::new(VecDeque::new()),
            cvar: Condvar::new(),
            processing_now: Mutex::new(HashSet::new()),
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

pub type TransformedImageCache = (u64, Arc<DynamicImage>, (f32, f32));

pub struct AppState {
    pub window_setup_complete: AtomicBool,
    pub gpu_crash_flag_path: Mutex<Option<PathBuf>>,
    pub original_image: Mutex<Option<LoadedImage>>,
    pub cached_preview: Mutex<Option<CachedPreview>>,
    pub gpu_context: Mutex<Option<GpuContext>>,
    pub gpu_image_cache: Mutex<Option<GpuImageCache>>,
    pub gpu_processor: Mutex<Option<GpuProcessorState>>,
    pub ai_state: Mutex<Option<AiState>>,
    pub ai_init_lock: TokioMutex<()>,
    pub export_task_token: Arc<Mutex<Option<Arc<AtomicBool>>>>,
    pub preset_batch_task_token: Arc<Mutex<Option<Arc<AtomicBool>>>>,
    pub hdr_result: Arc<Mutex<Option<DynamicImage>>>,
    pub panorama_result: Arc<Mutex<Option<DynamicImage>>>,
    pub denoise_result: Arc<Mutex<Option<DynamicImage>>>,
    pub indexing_task_handle: Mutex<Option<JoinHandle<()>>>,
    pub indexing_generation: AtomicUsize,
    pub lut_cache: Mutex<HashMap<String, Arc<Lut>>>,
    pub initial_file_path: Mutex<Option<String>>,
    pub pending_edit_session: Mutex<Option<ExternalEditSession>>,
    pub thumbnail_cancellation_token: Arc<AtomicBool>,
    pub thumbnail_progress: Mutex<ThumbnailProgressTracker>,
    pub preview_worker_tx: Mutex<Option<Sender<PreviewJob>>>,
    pub analytics_worker_tx: Mutex<Option<Sender<AnalyticsJob>>>,
    pub mask_cache: Mutex<HashMap<u64, GrayImage>>,
    pub patch_cache: Mutex<HashMap<String, serde_json::Value>>,
    pub geometry_cache: Mutex<HashMap<u64, DynamicImage>>,
    pub thumbnail_geometry_cache: Mutex<HashMap<String, (u64, DynamicImage, f32)>>,
    pub lens_db: Mutex<Option<Arc<LensDatabase>>>,
    pub load_image_generation: Arc<AtomicUsize>,
    pub full_warped_cache: Mutex<Option<(u64, Arc<DynamicImage>)>>,
    pub full_transformed_cache: Mutex<Option<TransformedImageCache>>,
    pub decoded_image_cache: Mutex<DecodedImageCache>,
    pub thumbnail_manager: Arc<ThumbnailManager>,
    pub metadata_manager: Arc<MetadataManager>,
    pub disks_cache: Mutex<Option<Disks>>,
    pub disks_cache_refreshing: AtomicBool,
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
}
