//! Import (Plan item 64, `docs/IMPORT_PLAN.md`).
//!
//! Photos are copied, or moved, into a destination folder, optionally into
//! date subfolders, under names from the shared filename template. A name
//! that is already taken gets a number or is skipped (the import's choice);
//! a file that fails is reported and the others still import. The import can
//! be cancelled between files and ends with a report of what happened.
//!
//! Sources are folders, single files, or memory cards and cameras mounted as
//! drives (a `DCIM` folder); the dialog lists their photos by capture time
//! (`scan_import_source`) with small previews (`generate_import_thumbnail`).

use std::collections::{BTreeSet, HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::sync::atomic::Ordering;
use std::time::Instant;

use chrono::{Datelike, NaiveDateTime};
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use sysinfo::Disks;
use tauri::{AppHandle, Emitter, Manager, ipc::Response};
use walkdir::WalkDir;

use crate::AppState;
#[cfg(target_os = "android")]
use crate::android_integration::{
    is_android_content_uri, read_android_content_uri, resolve_android_content_uri_name,
};
use crate::app_settings::load_settings;
use crate::app_state::{cancel_task, start_cancellable_task};
use crate::exif_processing;
use crate::file_management::{
    encode_thumbnail, generate_filename_from_template, generate_thumbnail_data,
    get_cached_thumbnail_image, original_file_name, parse_virtual_path,
    remember_original_file_name, sanitize_filename_suffix,
};
use crate::formats::is_supported_image_file;
use crate::gpu_processing::get_or_init_gpu_context;

/// The highest number tried after a taken name (`IMG_1-9999`).
const MAX_NAME_SUFFIX: usize = 9999;

/// Threads that read capture times while a source is listed (a card or disk gains little from more).
const IMPORT_SCAN_THREADS: usize = 4;

/// Files larger than this (e.g. 850 MB scan TIFFs) are decoded for a preview one at a time,
/// so a grid of them never holds several full-size decodes in memory at once.
const LARGE_IMPORT_FILE_BYTES: u64 = 256 * 1024 * 1024;
static LARGE_IMPORT_DECODE: Mutex<()> = Mutex::new(());

/// The long side of a preview in the Import dialog's grid (twice its tile, for sharp screens).
const IMPORT_THUMBNAIL_SIZE: u32 = 400;

/// A photo an import source holds.
#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ImportCandidate {
    pub path: String,
    /// The capture time as the camera recorded it (`YYYY-MM-DDTHH:MM:SS`; else the file's time).
    pub capture_time: String,
}

/// A memory card or camera mounted as a drive.
#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ImportVolume {
    /// The drive's name, e.g. `EOS_DIGITAL`.
    pub name: String,
    /// Its `DCIM` folder.
    pub path: String,
}

fn is_hidden(name: &std::ffi::OsStr) -> bool {
    name.to_string_lossy().starts_with('.')
}

/// The supported photos in `sources`: folders (and, when `recursive`, their
/// subfolders) and single files, each once, leaving out hidden files and
/// folders. Stops early, with what it has, once `is_current` turns false.
fn find_import_files(
    sources: &[PathBuf],
    recursive: bool,
    is_current: impl Fn() -> bool,
) -> Vec<PathBuf> {
    let mut seen = HashSet::new();
    let mut files = Vec::new();
    for source in sources {
        if source.is_dir() {
            let walker = WalkDir::new(source)
                .max_depth(if recursive { usize::MAX } else { 1 })
                .into_iter()
                .filter_entry(|entry| entry.depth() == 0 || !is_hidden(entry.file_name()));
            for entry in walker.filter_map(Result::ok) {
                if !is_current() {
                    return files;
                }
                if entry.file_type().is_file() && is_supported_image_file(entry.path()) {
                    let path = entry.into_path();
                    if seen.insert(path.clone()) {
                        files.push(path);
                    }
                }
            }
        } else if source.is_file() && is_supported_image_file(source) && seen.insert(source.clone())
        {
            files.push(source.clone());
        }
    }
    files
}

/// Lists the photos in `paths` (folders, with subfolders when `recursive`,
/// or files) in capture order, then by path. A newer scan stops this one,
/// which then returns what it found so far (the dialog ignores it). Capture
/// times are read on a pool of the scan's own, so thumbnail or metadata
/// work on the shared rayon pool cannot hold it up.
#[tauri::command]
pub async fn scan_import_source(
    paths: Vec<String>,
    recursive: bool,
    app_handle: AppHandle,
) -> Result<Vec<ImportCandidate>, String> {
    let scan = app_handle
        .state::<AppState>()
        .import_scan_generation
        .fetch_add(1, Ordering::SeqCst)
        + 1;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app_handle.state::<AppState>();
        let is_current = || state.import_scan_generation.load(Ordering::SeqCst) == scan;
        let started = Instant::now();
        let sources: Vec<PathBuf> = paths.iter().map(PathBuf::from).collect();
        let files = find_import_files(&sources, recursive, is_current);
        let listed_ms = started.elapsed().as_millis();
        let pool = rayon::ThreadPoolBuilder::new()
            .num_threads(IMPORT_SCAN_THREADS)
            .build()
            .map_err(|error| error.to_string())?;
        let mut candidates: Vec<ImportCandidate> = pool.install(|| {
            files
                .par_iter()
                .filter(|_| is_current())
                .map(|path| ImportCandidate {
                    path: path.to_string_lossy().into_owned(),
                    capture_time: exif_processing::get_creation_date_from_path(path)
                        .format("%Y-%m-%dT%H:%M:%S")
                        .to_string(),
                })
                .collect()
        });
        candidates.sort_by(|a, b| {
            a.capture_time
                .cmp(&b.capture_time)
                .then_with(|| a.path.cmp(&b.path))
        });
        log::info!(
            "[import] {} photos in {paths:?} (subfolders: {recursive}): listed in {listed_ms} ms, \
             dated in {} ms{}",
            candidates.len(),
            started.elapsed().as_millis() - listed_ms,
            if is_current() { "" } else { " (superseded)" }
        );
        Ok(candidates)
    })
    .await
    .map_err(|error| error.to_string())?
}

/// The mounted drives with a `DCIM` folder: memory cards, and cameras that
/// connect as a drive (USB mass storage). Cameras that connect only over
/// PTP/MTP are not drives and are not listed (`IMPORT_PLAN.md` decision 14).
#[tauri::command]
pub async fn list_import_volumes() -> Result<Vec<ImportVolume>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let disks = Disks::new_with_refreshed_list();
        let mut seen = HashSet::new();
        disks
            .list()
            .iter()
            .filter_map(|disk| {
                let mount = disk.mount_point();
                let dcim = mount.join("DCIM");
                if !dcim.is_dir() || !seen.insert(mount.to_path_buf()) {
                    return None;
                }
                // macOS and Windows name the volume; Linux names the device (`/dev/sdb1`).
                let label = disk.name().to_string_lossy().into_owned();
                let name = if !label.is_empty() && !label.starts_with("/dev/") {
                    label
                } else {
                    mount.file_name().map_or_else(
                        || mount.to_string_lossy().into_owned(),
                        |name| name.to_string_lossy().into_owned(),
                    )
                };
                Some(ImportVolume {
                    name,
                    path: dcim.to_string_lossy().into_owned(),
                })
            })
            .collect()
    })
    .await
    .map_err(|error| error.to_string())
}

/// A small JPEG of the photo at `path` for the Import dialog's grid: its
/// Library thumbnail when one is cached (a photo already in the Library),
/// else made like one (the embedded preview of an unedited RAW), not cached.
#[tauri::command]
pub async fn generate_import_thumbnail(
    path: String,
    app_handle: AppHandle,
) -> Result<Response, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if let Some(cached) = get_cached_thumbnail_image(&path, &app_handle) {
            return encode_thumbnail(&cached, IMPORT_THUMBNAIL_SIZE)
                .map(Response::new)
                .map_err(|error| error.to_string());
        }
        let is_large =
            fs::metadata(&path).is_ok_and(|metadata| metadata.len() > LARGE_IMPORT_FILE_BYTES);
        let _turn = is_large.then(|| {
            LARGE_IMPORT_DECODE
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
        });
        let state = app_handle.state::<AppState>();
        let gpu_context = get_or_init_gpu_context(&state, &app_handle).ok();
        let image = generate_thumbnail_data(&path, gpu_context.as_ref(), None, &app_handle)
            .map_err(|error| error.to_string())?;
        encode_thumbnail(&image, IMPORT_THUMBNAIL_SIZE)
            .map(Response::new)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

/// What happens to a photo whose new name is already taken in the destination.
#[derive(Serialize, Deserialize, Debug, Clone, Copy, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ImportNameClash {
    /// Import it as `name-1`, `name-2`, …
    #[default]
    AddSuffix,
    /// Leave it out.
    Skip,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ImportSettings {
    pub filename_template: String,
    /// The Custom Texts for `{text}`, `{text2}`, `{text3}`.
    #[serde(default)]
    pub filename_texts: Vec<String>,
    pub organize_by_date: bool,
    /// The date subfolders, see `date_subfolder`.
    pub date_folder_format: String,
    /// Move: the sources go to the Trash once copied.
    pub delete_after_import: bool,
    #[serde(default)]
    pub name_clash: ImportNameClash,
    /// January to December in the app's language, for `MMMM`; English when absent.
    #[serde(default)]
    pub month_names: Vec<String>,
}

/// The subfolders `pattern` gives a photo taken at `date`: `YYYY` is the year,
/// `MM` and `DD` the month and day as two digits, `MMMM` the month's name
/// (`month_names`, January first; English when missing). `/` or `\` starts
/// a subfolder; other text is kept as typed, without characters that cannot
/// be in a name on every platform. Empty parts, `.` and `..` are left out.
pub fn date_subfolder(pattern: &str, date: NaiveDateTime, month_names: &[String]) -> PathBuf {
    let month_name = month_names
        .get(date.month0() as usize)
        .map(|name| name.trim())
        .filter(|name| !name.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| date.format("%B").to_string());
    let mut path = PathBuf::new();
    for part in pattern.split(['/', '\\']) {
        let mut name = String::new();
        let mut rest = part;
        while !rest.is_empty() {
            if let Some(after) = rest.strip_prefix("YYYY") {
                name.push_str(&format!("{:04}", date.year()));
                rest = after;
            } else if let Some(after) = rest.strip_prefix("MMMM") {
                name.push_str(&month_name);
                rest = after;
            } else if let Some(after) = rest.strip_prefix("MM") {
                name.push_str(&format!("{:02}", date.month()));
                rest = after;
            } else if let Some(after) = rest.strip_prefix("DD") {
                name.push_str(&format!("{:02}", date.day()));
                rest = after;
            } else {
                let character = rest.chars().next().unwrap_or_default();
                name.push(character);
                rest = &rest[character.len_utf8()..];
            }
        }
        let name = sanitize_filename_suffix(&name);
        if !name.is_empty() && name != "." && name != ".." {
            path.push(name);
        }
    }
    path
}

/// The folder (inside the destination) a photo taken at `date` goes to.
fn destination_folder(
    destination: &Path,
    settings: &ImportSettings,
    date: NaiveDateTime,
) -> PathBuf {
    if settings.organize_by_date {
        destination.join(date_subfolder(
            &settings.date_folder_format,
            date,
            &settings.month_names,
        ))
    } else {
        destination.to_path_buf()
    }
}

/// The files of one shot that import together, such as `IMG_1.CR3` and
/// `IMG_1.JPG`: the source folder and stem, lowercased.
fn partner_key(source: &Path) -> String {
    let folder = source.parent().unwrap_or_else(|| Path::new(""));
    let stem = source.file_stem().unwrap_or_default();
    format!("{}/{}", folder.to_string_lossy(), stem.to_string_lossy()).to_lowercase()
}

fn extension_of(path: &Path) -> String {
    path.extension()
        .map(|extension| extension.to_string_lossy().into_owned())
        .unwrap_or_default()
}

fn file_name(stem: &str, suffix: usize, extension: &str) -> String {
    let stem = if suffix == 0 {
        stem.to_string()
    } else {
        format!("{stem}-{suffix}")
    };
    if extension.is_empty() {
        stem
    } else {
        format!("{stem}.{extension}")
    }
}

/// A destination path, lowercased: macOS and Windows compare names
/// case-insensitively, and Linux is treated the same so every platform names
/// the same import alike.
fn path_key(path: &Path) -> String {
    path.to_string_lossy().to_lowercase()
}

/// Gives every imported photo a free name in its folder. With Add suffix, the
/// files of one shot take the same number, so `IMG_1.CR3` and `IMG_1.JPG`
/// become `IMG_1-1.CR3` and `IMG_1-1.JPG` even if only one of the names was
/// taken. Names handed out in this import count as taken.
struct ImportNamePlanner {
    clash: ImportNameClash,
    /// The extensions of every shot (`partner_key`) in the import.
    shot_extensions: HashMap<String, Vec<String>>,
    /// Every name handed out, and the shot it went to.
    claimed: HashMap<String, String>,
    /// The number a shot took, per destination folder and stem.
    shot_suffixes: HashMap<(String, PathBuf, String), usize>,
}

impl ImportNamePlanner {
    fn new<P: AsRef<Path>>(clash: ImportNameClash, sources: impl IntoIterator<Item = P>) -> Self {
        let mut shot_extensions: HashMap<String, Vec<String>> = HashMap::new();
        for source in sources {
            let source = source.as_ref();
            let extensions = shot_extensions.entry(partner_key(source)).or_default();
            let extension = extension_of(source);
            if !extensions
                .iter()
                .any(|known| known.eq_ignore_ascii_case(&extension))
            {
                extensions.push(extension);
            }
        }
        Self {
            clash,
            shot_extensions,
            claimed: HashMap::new(),
            shot_suffixes: HashMap::new(),
        }
    }

    /// The path for a file of `shot` named `stem` + `extension` in `folder`,
    /// and whether it got a number; `None` when it is skipped or no number up
    /// to `MAX_NAME_SUFFIX` is free. `exists` tells whether a path is taken
    /// on disk.
    fn plan(
        &mut self,
        shot: &str,
        folder: &Path,
        stem: &str,
        extension: &str,
        exists: impl Fn(&Path) -> bool,
    ) -> Option<(PathBuf, bool)> {
        let is_free = |claimed: &HashMap<String, String>, path: &Path| {
            claimed
                .get(&path_key(path))
                .is_none_or(|owner| owner == shot)
                && !exists(path)
        };
        let path_for =
            |suffix: usize, extension: &str| folder.join(file_name(stem, suffix, extension));

        if self.clash == ImportNameClash::Skip {
            let path = path_for(0, extension);
            if !is_free(&self.claimed, &path) {
                return None;
            }
            self.claimed.insert(path_key(&path), shot.to_string());
            return Some((path, false));
        }

        let mut extensions = self.shot_extensions.get(shot).cloned().unwrap_or_default();
        if !extensions
            .iter()
            .any(|known| known.eq_ignore_ascii_case(extension))
        {
            extensions.push(extension.to_string());
        }
        let key = (shot.to_string(), folder.to_path_buf(), stem.to_string());
        let first = self.shot_suffixes.get(&key).copied().unwrap_or(0);
        let suffix = (first..=MAX_NAME_SUFFIX).find(|&suffix| {
            extensions
                .iter()
                .all(|extension| is_free(&self.claimed, &path_for(suffix, extension)))
        })?;
        for extension in &extensions {
            self.claimed
                .insert(path_key(&path_for(suffix, extension)), shot.to_string());
        }
        self.shot_suffixes.insert(key, suffix);
        Some((path_for(suffix, extension), suffix > 0))
    }
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ImportedFile {
    pub source: String,
    pub destination: String,
    /// The template's name was taken, so a number was added.
    pub suffixed: bool,
}

#[derive(Serialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ImportIssueKind {
    /// Skipped: its name is taken (Skip), or no number was free.
    NameTaken,
    /// Not imported.
    Failed,
    /// Imported, but the source could not be removed (Move).
    SourceKept,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ImportIssue {
    pub source: String,
    pub kind: ImportIssueKind,
    /// The error, for `Failed` and `SourceKept`.
    pub message: Option<String>,
}

/// What an import did, sent with `import-complete`.
#[derive(Serialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct ImportReport {
    /// The destination root, as chosen.
    pub destination: String,
    pub total: usize,
    pub imported: Vec<ImportedFile>,
    pub issues: Vec<ImportIssue>,
    /// Files left out because the import was cancelled.
    pub not_started: usize,
    pub cancelled: bool,
    pub moved: bool,
    /// The folders photos were imported into.
    pub folders: Vec<String>,
    pub elapsed_ms: u64,
}

/// A photo to import, read far enough to name it.
struct ImportSource {
    /// The name the template and the extension come from.
    name: String,
    date: NaiveDateTime,
    kind: ImportSourceKind,
}

enum ImportSourceKind {
    File {
        path: PathBuf,
        sidecar: PathBuf,
    },
    #[cfg(target_os = "android")]
    Bytes(Vec<u8>),
}

fn read_source(source: &str) -> Result<ImportSource, String> {
    #[cfg(target_os = "android")]
    if is_android_content_uri(source) {
        let name = resolve_android_content_uri_name(source)?;
        let bytes = read_android_content_uri(source)?;
        let date = exif_processing::get_creation_date_from_bytes(&name, &bytes);
        return Ok(ImportSource {
            name,
            date,
            kind: ImportSourceKind::Bytes(bytes),
        });
    }
    let (path, sidecar) = parse_virtual_path(source);
    if !path.exists() {
        return Err(format!("Source file not found: {source}"));
    }
    Ok(ImportSource {
        name: source.to_string(),
        date: exif_processing::get_creation_date_from_path(&path),
        kind: ImportSourceKind::File { path, sidecar },
    })
}

/// Puts the source in the Trash, or deletes it where there is no Trash.
fn remove_source(path: &Path) -> Result<(), String> {
    #[cfg(any(target_os = "windows", target_os = "macos", target_os = "linux"))]
    if let Err(trash_error) = trash::delete(path) {
        log::warn!(
            "Failed to trash source file {}: {}. Deleting permanently.",
            path.display(),
            trash_error
        );
    } else {
        return Ok(());
    }
    fs::remove_file(path).map_err(|error| error.to_string())
}

/// One import's fixed inputs and the names it has handed out.
struct ImportRun<'a> {
    destination: &'a Path,
    settings: &'a ImportSettings,
    total: usize,
    enable_xmp_sync: bool,
    planner: ImportNamePlanner,
}

impl ImportRun<'_> {
    /// Imports photo number `index`; `Ok(None)` when its name is taken and it
    /// is skipped. A Move whose source stays behind adds a `SourceKept` issue.
    fn import_one(
        &mut self,
        source: &str,
        index: usize,
        issues: &mut Vec<ImportIssue>,
    ) -> Result<Option<ImportedFile>, String> {
        let settings = self.settings;
        let ImportSource { name, date, kind } = read_source(source)?;
        let folder = destination_folder(self.destination, settings, date);
        let stem = generate_filename_from_template(
            &settings.filename_template,
            &name,
            index + 1,
            self.total,
            Some(date),
            &settings.filename_texts,
        );
        let (shot, extension) = match &kind {
            ImportSourceKind::File { path, .. } => (partner_key(path), extension_of(path)),
            #[cfg(target_os = "android")]
            ImportSourceKind::Bytes(_) => (source.to_string(), extension_of(Path::new(&name))),
        };
        let Some((target, suffixed)) =
            self.planner
                .plan(&shot, &folder, &stem, &extension, Path::exists)
        else {
            return Ok(None);
        };

        fs::create_dir_all(&folder)
            .map_err(|error| format!("Failed to create destination folder: {error}"))?;
        match kind {
            ImportSourceKind::File { path, sidecar } => {
                fs::copy(&path, &target).map_err(|error| error.to_string())?;
                if sidecar.exists() {
                    let (_, target_sidecar) = parse_virtual_path(&target.to_string_lossy());
                    fs::copy(&sidecar, &target_sidecar).map_err(|error| error.to_string())?;
                }
                // A copy imported under a new name remembers the camera's (owner 2026-11-16).
                if target.file_stem() != path.file_stem()
                    && let Err(error) = remember_original_file_name(
                        &target,
                        &original_file_name(&path),
                        self.enable_xmp_sync,
                    )
                {
                    log::warn!(
                        "Could not record the original name of {}: {error}",
                        target.display()
                    );
                }
                if settings.delete_after_import {
                    let removed = remove_source(&path).and_then(|()| {
                        if sidecar.exists() {
                            remove_source(&sidecar)
                        } else {
                            Ok(())
                        }
                    });
                    if let Err(error) = removed {
                        issues.push(ImportIssue {
                            source: source.to_string(),
                            kind: ImportIssueKind::SourceKept,
                            message: Some(error),
                        });
                    }
                }
            }
            #[cfg(target_os = "android")]
            ImportSourceKind::Bytes(bytes) => {
                fs::write(&target, bytes).map_err(|error| error.to_string())?;
                if settings.delete_after_import {
                    log::info!(
                        "Skipping delete_after_import for Android content URI source: {source}"
                    );
                }
            }
        }
        Ok(Some(ImportedFile {
            source: source.to_string(),
            destination: target.to_string_lossy().into_owned(),
            suffixed,
        }))
    }
}

/// Imports `source_paths` into `destination_folder`, reporting
/// `import-start`, `import-progress` per file and `import-complete` with the
/// `ImportReport` (`import-error` if the task itself dies). Fails at once
/// while another import runs.
#[tauri::command]
pub async fn import_files(
    source_paths: Vec<String>,
    destination_folder: String,
    settings: ImportSettings,
    app_handle: AppHandle,
) -> Result<(), String> {
    let state = app_handle.state::<AppState>();
    let cancellation_token = start_cancellable_task(
        &state.import_task_token,
        "An import is already in progress.",
    )?;
    let task_slot = state.import_task_token.clone();
    let total = source_paths.len();
    let _ = app_handle.emit("import-start", serde_json::json!({ "total": total }));
    let enable_xmp_sync = load_settings(app_handle.clone())
        .map(|settings| settings.enable_xmp_sync.unwrap_or(false))
        .unwrap_or(false);
    let task_app_handle = app_handle.clone();

    let task = tauri::async_runtime::spawn_blocking(move || {
        let app_handle = task_app_handle;
        let started = Instant::now();
        let destination = PathBuf::from(&destination_folder);
        let mut run = ImportRun {
            destination: &destination,
            settings: &settings,
            total,
            enable_xmp_sync,
            planner: ImportNamePlanner::new(
                settings.name_clash,
                source_paths
                    .iter()
                    .map(|source| parse_virtual_path(source).0),
            ),
        };
        let mut report = ImportReport {
            destination: destination_folder.clone(),
            total,
            moved: settings.delete_after_import,
            ..ImportReport::default()
        };
        let mut folders = BTreeSet::new();

        for (index, source) in source_paths.iter().enumerate() {
            if cancellation_token.load(Ordering::SeqCst) {
                report.cancelled = true;
                report.not_started = total - index;
                break;
            }
            let _ = app_handle.emit(
                "import-progress",
                serde_json::json!({ "current": index, "total": total, "path": source }),
            );
            match run.import_one(source, index, &mut report.issues) {
                Ok(Some(imported)) => {
                    if let Some(folder) = Path::new(&imported.destination).parent() {
                        folders.insert(folder.to_string_lossy().into_owned());
                    }
                    report.imported.push(imported);
                }
                Ok(None) => report.issues.push(ImportIssue {
                    source: source.clone(),
                    kind: ImportIssueKind::NameTaken,
                    message: None,
                }),
                Err(error) => {
                    log::warn!("Failed to import {source}: {error}");
                    report.issues.push(ImportIssue {
                        source: source.clone(),
                        kind: ImportIssueKind::Failed,
                        message: Some(error),
                    });
                }
            }
        }

        report.folders = folders.into_iter().collect();
        report.elapsed_ms = started.elapsed().as_millis() as u64;
        report
    })
    .await;
    *task_slot.lock().unwrap() = None;
    match task {
        Ok(report) => {
            let _ = app_handle.emit(
                "import-progress",
                serde_json::json!({ "current": total, "total": total, "path": "" }),
            );
            let _ = app_handle.emit("import-complete", report);
            Ok(())
        }
        Err(error) => {
            let message = format!("Import task failed: {error}");
            let _ = app_handle.emit("import-error", &message);
            Err(message)
        }
    }
}

/// Stops the running import after the file it is copying; false when none runs.
#[tauri::command]
pub fn cancel_import(app_handle: AppHandle) -> bool {
    cancel_task(&app_handle.state::<AppState>().import_task_token)
}

/// The folder (relative to the destination) the first photo would go to, for
/// the dialog's example; empty without date subfolders or a photo.
#[tauri::command]
pub async fn preview_import_folder(
    path: Option<String>,
    pattern: String,
    month_names: Vec<String>,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(path) = path else {
            return String::new();
        };
        let (path, _) = parse_virtual_path(&path);
        let date = exif_processing::get_creation_date_from_path(&path);
        date_subfolder(&pattern, date, &month_names)
            .to_string_lossy()
            .into_owned()
    })
    .await
    .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::NaiveDate;
    use std::collections::HashSet;

    fn date() -> NaiveDateTime {
        NaiveDate::from_ymd_opt(2026, 3, 7)
            .unwrap()
            .and_hms_opt(9, 30, 0)
            .unwrap()
    }

    #[test]
    fn date_subfolder_fills_the_tokens() {
        let none: Vec<String> = Vec::new();
        assert_eq!(
            date_subfolder("YYYY/YYYY-MM/YYYY-MM-DD", date(), &none),
            PathBuf::from("2026").join("2026-03").join("2026-03-07")
        );
        assert_eq!(
            date_subfolder("YYYY/MM-DD", date(), &none),
            PathBuf::from("2026").join("03-07")
        );
        assert_eq!(
            date_subfolder("YYYY\\MMMM\\DD", date(), &none),
            PathBuf::from("2026").join("March").join("07")
        );
        let german: Vec<String> = [
            "Januar",
            "Februar",
            "März",
            "April",
            "Mai",
            "Juni",
            "Juli",
            "August",
            "September",
            "Oktober",
            "November",
            "Dezember",
        ]
        .map(String::from)
        .to_vec();
        assert_eq!(
            date_subfolder("YYYY/MMMM", date(), &german),
            PathBuf::from("2026").join("März")
        );
    }

    #[test]
    fn date_subfolder_keeps_text_and_drops_unsafe_parts() {
        let none: Vec<String> = Vec::new();
        assert_eq!(
            date_subfolder("Shoots YYYY/../DD: day//", date(), &none),
            PathBuf::from("Shoots 2026").join("07 day")
        );
        assert_eq!(date_subfolder("", date(), &none), PathBuf::new());
        assert_eq!(date_subfolder("100%", date(), &none), PathBuf::from("100"));
    }

    #[test]
    fn a_scan_finds_supported_photos_once_and_skips_hidden_ones() {
        let folder = tempfile::tempdir().unwrap();
        let root = folder.path();
        for name in [
            "IMG_1.CR3",
            "IMG_1.JPG",
            "notes.txt",
            "._IMG_1.JPG",
            ".hidden.jpg",
            "100CANON/IMG_2.CR3",
            ".Trashes/IMG_3.JPG",
        ] {
            let path = root.join(name);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(path, b"").unwrap();
        }
        let names = |files: Vec<PathBuf>| -> Vec<String> {
            let mut names: Vec<String> = files
                .iter()
                .map(|file| {
                    file.strip_prefix(root)
                        .unwrap()
                        .to_string_lossy()
                        .replace('\\', "/")
                })
                .collect();
            names.sort();
            names
        };
        assert_eq!(
            names(find_import_files(&[root.to_path_buf()], false, || true)),
            ["IMG_1.CR3", "IMG_1.JPG"]
        );
        let single = root.join("IMG_1.JPG");
        assert_eq!(
            names(find_import_files(
                &[root.to_path_buf(), single],
                true,
                || true
            )),
            ["100CANON/IMG_2.CR3", "IMG_1.CR3", "IMG_1.JPG"]
        );
        assert!(find_import_files(&[root.to_path_buf()], true, || false).is_empty());
    }

    fn planner(clash: ImportNameClash, sources: &[&str]) -> ImportNamePlanner {
        ImportNamePlanner::new(clash, sources.iter().map(|source| Path::new(*source)))
    }

    #[test]
    fn a_shot_takes_one_number_for_all_its_files() {
        let folder = Path::new("/dest");
        let taken: HashSet<PathBuf> = [folder.join("IMG_1.JPG")].into();
        let exists = |path: &Path| taken.contains(path);
        let mut planner = planner(
            ImportNameClash::AddSuffix,
            &["/card/IMG_1.CR3", "/card/IMG_1.JPG", "/card/IMG_2.CR3"],
        );
        let shot = partner_key(Path::new("/card/IMG_1.CR3"));
        assert_eq!(
            planner.plan(&shot, folder, "IMG_1", "CR3", exists),
            Some((folder.join("IMG_1-1.CR3"), true))
        );
        assert_eq!(
            planner.plan(&shot, folder, "IMG_1", "JPG", exists),
            Some((folder.join("IMG_1-1.JPG"), true))
        );
        let other = partner_key(Path::new("/card/IMG_2.CR3"));
        assert_eq!(
            planner.plan(&other, folder, "IMG_2", "CR3", exists),
            Some((folder.join("IMG_2.CR3"), false))
        );
    }

    #[test]
    fn names_given_out_count_as_taken_case_insensitively() {
        let folder = Path::new("/dest");
        let exists = |_: &Path| false;
        let mut planner = planner(
            ImportNameClash::AddSuffix,
            &["/a/one.jpg", "/b/two.JPG", "/b/three.jpg"],
        );
        let first = partner_key(Path::new("/a/one.jpg"));
        let second = partner_key(Path::new("/b/two.JPG"));
        assert_eq!(
            planner.plan(&first, folder, "shoot", "jpg", exists),
            Some((folder.join("shoot.jpg"), false))
        );
        assert_eq!(
            planner.plan(&second, folder, "Shoot", "JPG", exists),
            Some((folder.join("Shoot-1.JPG"), true))
        );
    }

    #[test]
    fn skip_leaves_out_taken_names() {
        let folder = Path::new("/dest");
        let taken: HashSet<PathBuf> = [folder.join("IMG_1.CR3")].into();
        let exists = |path: &Path| taken.contains(path);
        let mut planner = planner(
            ImportNameClash::Skip,
            &["/card/IMG_1.CR3", "/card/IMG_1.JPG"],
        );
        let shot = partner_key(Path::new("/card/IMG_1.CR3"));
        assert_eq!(planner.plan(&shot, folder, "IMG_1", "CR3", exists), None);
        assert_eq!(
            planner.plan(&shot, folder, "IMG_1", "JPG", exists),
            Some((folder.join("IMG_1.JPG"), false))
        );
        let other = partner_key(Path::new("/card/other.JPG"));
        assert_eq!(planner.plan(&other, folder, "IMG_1", "JPG", exists), None);
    }
}
