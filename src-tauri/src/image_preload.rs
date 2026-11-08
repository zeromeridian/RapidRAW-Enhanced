//! Decodes the photos next to the one open in Develop into the decoded-image
//! cache at lowered priority, so stepping to them skips the decode.

use crate::app_settings::load_settings;
use crate::app_state::AppState;
use crate::cache_utils::DecodeFingerprint;
use crate::file_management::{is_cloud_placeholder, parse_virtual_path};
use crate::image_loader::decode_pristine;
use std::path::Path;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Condvar, Mutex, MutexGuard, OnceLock};
use std::time::Duration;
use tauri::{AppHandle, Manager};

/// The next and the previous photo.
const MAX_PRELOAD_TARGETS: usize = 2;
/// Lets the open photo's first renders run before a preload competes with them.
const START_DELAY: Duration = Duration::from_millis(300);

struct Running {
    path: String,
    cancel: Arc<AtomicUsize>,
}

impl Running {
    fn cancel(&self) {
        self.cancel.store(1, Ordering::SeqCst);
    }
}

#[derive(Default)]
struct PreloadState {
    /// Source path of the photo open in Develop.
    current: Option<String>,
    /// Bumped by every load and every new request, which restarts the start delay.
    ticket: u64,
    targets: Vec<String>,
    running: Option<Running>,
}

impl PreloadState {
    fn take_target(&mut self) -> Option<(String, Arc<AtomicUsize>)> {
        if self.targets.is_empty() {
            return None;
        }
        let path = self.targets.remove(0);
        let cancel = Arc::new(AtomicUsize::new(0));
        self.running = Some(Running {
            path: path.clone(),
            cancel: Arc::clone(&cancel),
        });
        Some((path, cancel))
    }
}

#[derive(Default)]
pub struct ImagePreloader {
    state: Mutex<PreloadState>,
    changed: Condvar,
    pool: OnceLock<Option<rayon::ThreadPool>>,
}

impl ImagePreloader {
    fn lock(&self) -> MutexGuard<'_, PreloadState> {
        self.state.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn pool(&self) -> Option<&rayon::ThreadPool> {
        self.pool
            .get_or_init(|| {
                rayon::ThreadPoolBuilder::new()
                    .stack_size(8 * 1024 * 1024)
                    .thread_name(|index| format!("image-preload-{index}"))
                    .start_handler(|_| set_current_thread_background(true))
                    .build()
                    .ok()
            })
            .as_ref()
    }

    /// Runs `work` and its parallel loops on the preload pool.
    fn in_background<R: Send>(&self, work: impl FnOnce() -> R + Send) -> R {
        match self.pool() {
            Some(pool) => pool.install(work),
            None => work(),
        }
    }

    fn set_background(&self, background: bool) {
        if let Some(pool) = self.pool() {
            pool.spawn_broadcast(move |_| set_current_thread_background(background));
        }
    }

    /// Called when Develop opens a photo. Cancels preloading any other photo;
    /// returns true when this photo is being preloaded, which then continues at
    /// normal priority and is awaited with [`Self::wait_until_decoded`].
    pub fn begin_load(&self, source_path: &str) -> bool {
        let mut state = self.lock();
        state.ticket += 1;
        state.current = Some(source_path.to_string());
        state.targets.clear();
        let adopted = match &state.running {
            Some(running) if running.path == source_path => true,
            Some(running) => {
                running.cancel();
                false
            }
            None => false,
        };
        if adopted {
            self.set_background(false);
        }
        self.changed.notify_all();
        adopted
    }

    pub fn wait_until_decoded(&self, source_path: &str) {
        let mut state = self.lock();
        while state
            .running
            .as_ref()
            .is_some_and(|running| running.path == source_path)
        {
            state = self.changed.wait(state).unwrap_or_else(|e| e.into_inner());
        }
    }

    fn request(&self, anchor: &str, paths: Vec<String>, limit: usize) {
        let mut state = self.lock();
        if state.current.as_deref() != Some(anchor) {
            return;
        }
        let mut targets: Vec<String> = Vec::with_capacity(limit);
        for path in paths {
            if targets.len() == limit {
                break;
            }
            if path != anchor && !targets.contains(&path) {
                targets.push(path);
            }
        }
        if state.targets == targets {
            return;
        }
        if let Some(running) = &state.running
            && !targets.contains(&running.path)
        {
            running.cancel();
        }
        state.ticket += 1;
        state.targets = targets;
        self.changed.notify_all();
    }

    /// Blocks until a target is due: requested, and unchanged for the start delay.
    fn next_target(&self) -> (String, Arc<AtomicUsize>) {
        let mut state = self.lock();
        loop {
            if state.targets.is_empty() {
                state = self.changed.wait(state).unwrap_or_else(|e| e.into_inner());
                continue;
            }
            let ticket = state.ticket;
            state = self
                .changed
                .wait_timeout_while(state, START_DELAY, |s| s.ticket == ticket)
                .unwrap_or_else(|e| e.into_inner())
                .0;
            if state.ticket == ticket
                && let Some(target) = state.take_target()
            {
                return target;
            }
        }
    }

    fn finish(&self) {
        self.lock().running = None;
        self.changed.notify_all();
    }
}

fn preload(app_handle: &AppHandle, app_state: &AppState, path: &str, cancel: Arc<AtomicUsize>) {
    let source_path = Path::new(path);
    // Reading a cloud placeholder would start its download.
    if is_cloud_placeholder(source_path) {
        return;
    }
    let settings = load_settings(app_handle.clone()).unwrap_or_default();
    let Some(fingerprint) = DecodeFingerprint::for_file(source_path, &settings) else {
        return;
    };
    let cache = || {
        app_state
            .decoded_image_cache
            .lock()
            .unwrap_or_else(|e| e.into_inner())
    };
    if cache().contains(path, &fingerprint) {
        return;
    }
    let preloader = &app_state.image_preloader;
    preloader.set_background(true);
    match preloader.in_background(|| decode_pristine(path, &settings, Some((cancel, 0)))) {
        Ok((image, exif)) => cache().insert(path.to_string(), fingerprint, Arc::new(image), exif),
        Err(e) if !e.contains("cancelled") => log::debug!("Preloading '{}' failed: {}", path, e),
        Err(_) => {}
    }
}

pub fn start_preload_worker(app_handle: AppHandle) {
    let spawned = std::thread::Builder::new()
        .name("image-preloader".to_string())
        .spawn(move || {
            let app_state = app_handle.state::<AppState>();
            let preloader = &app_state.image_preloader;
            loop {
                let (path, cancel) = preloader.next_target();
                preload(&app_handle, &app_state, &path, cancel);
                preloader.finish();
            }
        });
    if let Err(e) = spawned {
        log::error!("Failed to start image preload worker: {}", e);
    }
}

/// Preloads `paths` while `anchor` is open in Develop; an empty list cancels.
#[tauri::command]
pub fn preload_images(anchor: String, paths: Vec<String>, state: tauri::State<'_, AppState>) {
    let source = |path: &str| parse_virtual_path(path).0.to_string_lossy().to_string();
    let capacity = state
        .decoded_image_cache
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .capacity();
    // The open photo keeps its cache slot, so preloading never adds memory.
    let limit = MAX_PRELOAD_TARGETS.min(capacity.saturating_sub(1));
    state.image_preloader.request(
        &source(&anchor),
        paths.iter().map(|path| source(path)).collect(),
        limit,
    );
}

#[cfg(target_os = "windows")]
fn set_current_thread_background(background: bool) {
    use windows::Win32::System::Threading::{
        GetCurrentThread, SetThreadPriority, SetThreadPriorityBoost, THREAD_PRIORITY_LOWEST,
        THREAD_PRIORITY_NORMAL,
    };
    let priority = if background {
        THREAD_PRIORITY_LOWEST
    } else {
        THREAD_PRIORITY_NORMAL
    };
    unsafe {
        let thread = GetCurrentThread();
        let _ = SetThreadPriority(thread, priority);
        let _ = SetThreadPriorityBoost(thread, background);
    }
}

/// Linux refuses lowering nice again without privileges, so an awaited preload
/// stays at nice 10; that only matters while other work contends for the CPU.
#[cfg(any(target_os = "linux", target_os = "android"))]
fn set_current_thread_background(background: bool) {
    unsafe {
        let tid = libc::syscall(libc::SYS_gettid) as libc::id_t;
        libc::setpriority(libc::PRIO_PROCESS, tid, if background { 10 } else { 0 });
    }
}

#[cfg(any(target_os = "macos", target_os = "ios"))]
fn set_current_thread_background(background: bool) {
    let class = if background {
        libc::qos_class_t::QOS_CLASS_UTILITY
    } else {
        libc::qos_class_t::QOS_CLASS_USER_INITIATED
    };
    unsafe {
        libc::pthread_set_qos_class_self_np(class, 0);
    }
}

#[cfg(not(any(
    target_os = "windows",
    target_os = "linux",
    target_os = "android",
    target_os = "macos",
    target_os = "ios"
)))]
fn set_current_thread_background(_background: bool) {}

#[cfg(test)]
mod tests {
    use super::*;

    fn paths(names: &[&str]) -> Vec<String> {
        names.iter().map(|name| name.to_string()).collect()
    }

    fn opened(path: &str) -> ImagePreloader {
        let preloader = ImagePreloader::default();
        assert!(!preloader.begin_load(path));
        preloader
    }

    #[test]
    fn requests_keep_only_the_open_photos_distinct_neighbours() {
        let preloader = opened("b");
        preloader.request("a", paths(&["c"]), 2);
        assert!(preloader.lock().targets.is_empty());

        preloader.request("b", paths(&["c", "b", "c", "a", "d"]), 2);
        assert_eq!(preloader.lock().targets, paths(&["c", "a"]));

        let opened_small_cache = opened("b");
        opened_small_cache.request("b", paths(&["c", "a"]), 0);
        assert!(opened_small_cache.lock().targets.is_empty());
    }

    #[test]
    fn opening_the_preloading_photo_keeps_its_decode_and_others_cancel_it() {
        let preloader = opened("b");
        preloader.request("b", paths(&["c", "a"]), 2);
        let (_, cancel_c) = preloader.lock().take_target().unwrap();

        assert!(preloader.begin_load("c"));
        assert_eq!(cancel_c.load(Ordering::SeqCst), 0);
        assert!(preloader.lock().targets.is_empty());

        preloader.finish();
        preloader.request("c", paths(&["d", "b"]), 2);
        let (_, cancel_d) = preloader.lock().take_target().unwrap();
        assert!(!preloader.begin_load("a"));
        assert_eq!(cancel_d.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn a_new_request_cancels_only_an_unwanted_decode() {
        let preloader = opened("b");
        preloader.request("b", paths(&["c", "a"]), 2);
        let (_, cancel_c) = preloader.lock().take_target().unwrap();

        preloader.request("b", paths(&["c", "z"]), 2);
        assert_eq!(cancel_c.load(Ordering::SeqCst), 0);
        preloader.request("b", Vec::new(), 2);
        assert_eq!(cancel_c.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn waiting_for_a_preloaded_photo_ends_when_its_decode_finishes() {
        let preloader = Arc::new(opened("b"));
        preloader.request("b", paths(&["c"]), 2);
        preloader.lock().take_target().unwrap();
        assert!(preloader.begin_load("c"));

        let waiter = {
            let preloader = Arc::clone(&preloader);
            std::thread::spawn(move || preloader.wait_until_decoded("c"))
        };
        std::thread::sleep(Duration::from_millis(20));
        assert!(!waiter.is_finished());
        preloader.finish();
        waiter.join().unwrap();
    }
}
