use memmap2::{Mmap, MmapOptions};
use std::borrow::Cow;
use std::collections::hash_map::DefaultHasher;
use std::collections::{HashMap, HashSet};
use std::fmt;
use std::fs::{self, OpenOptions};
use std::hash::{Hash, Hasher};
use std::io::{Cursor, Write};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;

use anyhow::Result;
use base64::{Engine as _, engine::general_purpose};
use chrono::{DateTime, Utc};
use image::codecs::jpeg::JpegEncoder;
use image::{DynamicImage, GenericImageView, ImageBuffer, Luma};
use rayon::prelude::*;
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sysinfo::Disks;
use tauri::{AppHandle, Emitter, Manager};
use uuid::Uuid;
use walkdir::WalkDir;

use crate::AppState;
use crate::PendingMetadata;
#[cfg(target_os = "android")]
use crate::android_integration::*;
use crate::app_settings::*;
use crate::exif_processing;
use crate::formats::{is_raw_file, is_supported_image_file};
use crate::gpu_processing;
use crate::image_loader;
use crate::image_processing::GpuContext;
use crate::image_processing::{
    Crop, ImageMetadata, XmpStackMetadata, apply_coarse_rotation, apply_cpu_default_raw_processing,
    apply_crop, apply_flip, apply_geometry_warp, apply_rotation, auto_results_to_json,
    get_all_adjustments_from_json, perform_auto_analysis,
};
use crate::mask_generation::MaskDefinition;
use crate::preset_converter;
use crate::tagging::{COLOR_TAG_PREFIX, FLAG_TAG_PREFIX};

pub const THUMBNAIL_RENDERER_VERSION: &str = "gpu-adjustments-v1";

fn resolve_thumbnail_cache_dir(app_handle: &AppHandle) -> std::result::Result<PathBuf, String> {
    let cache_dir = app_handle
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?;
    let thumb_cache_dir = cache_dir.join("thumbnails");
    if !thumb_cache_dir.exists() {
        fs::create_dir_all(&thumb_cache_dir).map_err(|e| e.to_string())?;
    }
    Ok(thumb_cache_dir)
}

fn emit_thumbnail_cache_setup_error(app_handle: &AppHandle, path: &str, reason: &str) {
    let _ = app_handle.emit(
        "thumbnail-generation-error",
        serde_json::json!({ "path": path, "reason": reason }),
    );
}

fn compute_thumbnail_cache_hash(path_str: &str, adjustments_bytes: &[u8]) -> Option<String> {
    let (source_path, _) = parse_virtual_path(path_str);

    let img_mod_time = fs::metadata(&source_path)
        .ok()?
        .modified()
        .ok()?
        .duration_since(std::time::UNIX_EPOCH)
        .ok()?
        .as_secs();

    let mut hasher = blake3::Hasher::new();
    hasher.update(THUMBNAIL_RENDERER_VERSION.as_bytes());
    hasher.update(path_str.as_bytes());
    hasher.update(&img_mod_time.to_le_bytes());
    hasher.update(adjustments_bytes);
    Some(hasher.finalize().to_hex().to_string())
}

struct ImageFileMetadata {
    is_edited: bool,
    tags: Option<Vec<String>>,
    rating: u8,
    is_raw: bool,
    copy_name_suffix: Option<String>,
    xmp_stack: Option<XmpStackMetadata>,
}

fn resolve_image_metadata(
    image_path: &Path,
    sidecar_path: &Path,
    enable_xmp_sync: bool,
    include_app_xmp: bool,
    settings: &AppSettings,
) -> ImageFileMetadata {
    let mut metadata = crate::exif_processing::load_sidecar(sidecar_path);

    if enable_xmp_sync
        && sync_metadata_from_xmp(image_path, &mut metadata, include_app_xmp, false)
        && let Ok(json) = serde_json::to_string_pretty(&metadata)
    {
        let _ = fs::write(sidecar_path, json);
    }

    let is_raw = crate::formats::is_raw_file(image_path);
    let tm_override = crate::image_processing::resolve_tonemapper_override(settings, is_raw);
    let is_edited =
        crate::image_processing::is_image_edited(&metadata.adjustments, is_raw, tm_override);
    ImageFileMetadata {
        is_edited,
        tags: metadata.tags,
        rating: metadata.rating,
        is_raw,
        copy_name_suffix: metadata.copy_name_suffix,
        xmp_stack: metadata.xmp_stack,
    }
}

fn emit_image_metadata_loaded(
    app_handle: &AppHandle,
    path: &str,
    rating: u8,
    is_edited: bool,
    tags: &Option<Vec<String>>,
    xmp_stack: &Option<XmpStackMetadata>,
) {
    let _ = app_handle.emit(
        "image-metadata-loaded",
        serde_json::json!({
            "path": path,
            "rating": rating,
            "is_edited": is_edited,
            "tags": tags,
            "xmpStack": xmp_stack
        }),
    );
}

fn enqueue_metadata(
    app_handle: &AppHandle,
    virtual_path: String,
    image_path: PathBuf,
    sidecar_path: PathBuf,
) {
    let state = app_handle.state::<crate::AppState>();
    let manager = &state.metadata_manager;

    let mut pending = manager.pending.lock().unwrap();
    if !pending.insert(sidecar_path.clone()) {
        return;
    }
    drop(pending);

    manager.queue.lock().unwrap().push_back(PendingMetadata {
        virtual_path,
        image_path,
        sidecar_path,
    });
    manager.cvar.notify_one();
}

fn clear_pending_metadata(app_handle: &AppHandle) {
    let state = app_handle.state::<crate::AppState>();
    let manager = &state.metadata_manager;
    let cancelled_sidecars: Vec<PathBuf> = manager
        .queue
        .lock()
        .unwrap()
        .drain(..)
        .map(|item| item.sidecar_path)
        .collect();
    if cancelled_sidecars.is_empty() {
        return;
    }

    // Keep entries owned by workers in `pending`: they cannot be cancelled and
    // removing them would allow the same sidecar to be scheduled twice by a
    // rapid folder switch. Only queued items are safe to release.
    let mut pending = manager.pending.lock().unwrap();
    for sidecar_path in cancelled_sidecars {
        pending.remove(&sidecar_path);
    }
}

// Not compute-heavy — these threads mostly block waiting on iCloud to
// materialize a file, not burning CPU — so a small fixed pool is enough and
// doesn't need a user-facing setting the way thumbnail_worker_threads does.
const METADATA_WORKER_THREADS: usize = 4;
const RECURSIVE_BACKGROUND_METADATA_THRESHOLD: usize = 500;

fn should_defer_metadata(image_count: usize) -> bool {
    image_count >= RECURSIVE_BACKGROUND_METADATA_THRESHOLD
}

pub fn start_metadata_workers(app_handle: tauri::AppHandle) {
    let state = app_handle.state::<crate::AppState>();
    let manager = state.metadata_manager.clone();

    for _ in 0..METADATA_WORKER_THREADS {
        let app_clone = app_handle.clone();
        let manager_clone = manager.clone();

        std::thread::spawn(move || {
            let mut settings = load_settings(app_clone.clone()).unwrap_or_default();
            loop {
                let (item, resumed_from_idle) = {
                    let mut queue = manager_clone.queue.lock().unwrap();
                    let mut resumed_from_idle = false;
                    while queue.is_empty() {
                        resumed_from_idle = true;
                        queue = manager_clone.cvar.wait(queue).unwrap();
                    }
                    (queue.pop_front().unwrap(), resumed_from_idle)
                };

                if resumed_from_idle {
                    settings = load_settings(app_clone.clone()).unwrap_or_default();
                }
                let enable_xmp_sync = settings.enable_xmp_sync.unwrap_or(false);

                let metadata = resolve_image_metadata(
                    &item.image_path,
                    &item.sidecar_path,
                    enable_xmp_sync,
                    !item.virtual_path.contains("?vc="),
                    &settings,
                );

                emit_image_metadata_loaded(
                    &app_clone,
                    &item.virtual_path,
                    metadata.rating,
                    metadata.is_edited,
                    &metadata.tags,
                    &metadata.xmp_stack,
                );

                manager_clone
                    .pending
                    .lock()
                    .unwrap()
                    .remove(&item.sidecar_path);
            }
        });
    }
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Preset {
    pub id: String,
    pub name: String,
    pub adjustments: Value,
    #[serde(rename = "includeMasks", skip_serializing_if = "Option::is_none")]
    pub include_masks: Option<bool>,
    #[serde(
        rename = "includeCropTransform",
        skip_serializing_if = "Option::is_none"
    )]
    pub include_crop_transform: Option<bool>,
    #[serde(rename = "presetType", skip_serializing_if = "Option::is_none")]
    pub preset_type: Option<String>,
}

#[derive(Serialize)]
struct ExportPresetFile<'a> {
    creator: &'a str,
    presets: &'a [PresetItem],
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct PresetFolder {
    pub id: String,
    pub name: String,
    pub children: Vec<Preset>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub enum PresetItem {
    Preset(Preset),
    Folder(PresetFolder),
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct PresetFile {
    pub presets: Vec<PresetItem>,
}

#[derive(Debug)]
pub enum ReadFileError {
    Io(std::io::Error),
    Locked,
    Empty,
    NotFound,
    Invalid,
}

impl fmt::Display for ReadFileError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ReadFileError::Io(err) => write!(f, "IO error: {}", err),
            ReadFileError::Locked => write!(f, "File is locked"),
            ReadFileError::Empty => write!(f, "File is empty"),
            ReadFileError::NotFound => write!(f, "File not found"),
            ReadFileError::Invalid => write!(f, "Invalid file"),
        }
    }
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ImageFile {
    pub path: String,
    modified: u64,
    is_edited: bool,
    rating: u8,
    tags: Option<Vec<String>>,
    exif: Option<HashMap<String, String>>,
    is_virtual_copy: bool,
    is_cloud_placeholder: bool,
    is_raw: bool,
    group_id: Option<String>,
    #[serde(rename = "xmpStack")]
    xmp_stack: Option<XmpStackMetadata>,
}

fn make_group_key(source_path: &Path) -> String {
    let parent = source_path.parent().unwrap_or(Path::new(""));
    let stem = source_path.file_stem().unwrap_or_default();
    format!("{}/{}", parent.to_string_lossy(), stem.to_string_lossy())
}

fn assign_group_ids(files: &mut [ImageFile], settings: &crate::app_settings::AppSettings) {
    let require_matching_exif = settings.require_matching_exif.unwrap_or(false);
    let group_edited_files = settings.group_edited_files.unwrap_or(true);

    #[derive(Clone)]
    struct Candidate {
        index: usize,
        source_path: PathBuf,
        key: String,
    }

    let candidates: Vec<Candidate> = files
        .iter()
        .enumerate()
        .filter(|(_, file)| !file.is_virtual_copy && (group_edited_files || !file.is_edited))
        .map(|(index, file)| {
            let (source_path, _) = parse_virtual_path(&file.path);
            let key = make_group_key(&source_path);
            Candidate {
                index,
                source_path,
                key,
            }
        })
        .collect();

    let mut stem_groups: HashMap<String, Vec<Candidate>> = HashMap::new();
    for candidate in candidates {
        stem_groups
            .entry(candidate.key.clone())
            .or_default()
            .push(candidate);
    }

    if require_matching_exif {
        let groupable_paths: Vec<PathBuf> = stem_groups
            .values()
            .filter(|candidates| candidates.len() >= 2)
            .flat_map(|candidates| candidates.iter().map(|c| c.source_path.clone()))
            .collect();
        let exif_dates: HashMap<PathBuf, Option<chrono::DateTime<chrono::Utc>>> = groupable_paths
            .par_iter()
            .map(|p| {
                (
                    p.clone(),
                    crate::exif_processing::try_get_exif_creation_date(p),
                )
            })
            .collect();

        stem_groups.retain(|_, candidates| {
            if candidates.len() < 2 {
                return false;
            }
            let first = exif_dates
                .get(&candidates[0].source_path)
                .copied()
                .flatten();
            if first.is_none() {
                return false;
            }
            candidates
                .iter()
                .skip(1)
                .all(|c| exif_dates.get(&c.source_path).copied().flatten() == first)
        });
    } else {
        stem_groups.retain(|_, candidates| candidates.len() >= 2);
    }

    for (key, candidates) in stem_groups {
        for candidate in candidates {
            files[candidate.index].group_id = Some(key.clone());
        }
    }
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ImportSettings {
    pub filename_template: String,
    pub organize_by_date: bool,
    pub date_folder_format: String,
    pub delete_after_import: bool,
}

pub(crate) fn sanitize_filename_suffix(suffix: &str) -> String {
    suffix
        .trim()
        .chars()
        .filter(|character| {
            !character.is_control()
                && !matches!(
                    character,
                    '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' | '&' | '%' | '#'
                )
        })
        .collect()
}

pub fn parse_virtual_path(virtual_path: &str) -> (PathBuf, PathBuf) {
    let (source_path_str, copy_id) = if let Some((base, id)) = virtual_path.rsplit_once("?vc=") {
        (
            base.to_string(),
            Some(id.split('&').next().unwrap_or(id).to_string()),
        )
    } else {
        (virtual_path.to_string(), None)
    };

    let source_path = PathBuf::from(source_path_str);

    let sidecar_filename = if let Some(id) = copy_id {
        format!(
            "{}.{}.tirdata",
            source_path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy(),
            id
        )
    } else {
        format!(
            "{}.tirdata",
            source_path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
        )
    };

    let sidecar_path = source_path.with_file_name(sidecar_filename);
    (source_path, sidecar_path)
}

fn validate_plus_document(document: &Value) -> Result<(), String> {
    let object = document
        .as_object()
        .ok_or_else(|| "Plus document must be an object.".to_string())?;
    if object.get("mode").and_then(Value::as_str) != Some("layered") {
        return Err("Plus persistence accepts layered documents only.".to_string());
    }
    if object.get("documentVersion").and_then(Value::as_u64) != Some(1) {
        return Err("Unsupported Plus document version.".to_string());
    }
    if object
        .get("id")
        .and_then(Value::as_str)
        .is_none_or(str::is_empty)
        || object
            .get("anchorPath")
            .and_then(Value::as_str)
            .is_none_or(str::is_empty)
        || !object.get("layers").is_some_and(Value::is_array)
    {
        return Err("Plus document is missing required layered-document fields.".to_string());
    }
    Ok(())
}

fn write_sidecar_atomically(sidecar_path: &Path, metadata: &ImageMetadata) -> Result<(), String> {
    let parent = sidecar_path.parent().ok_or_else(|| {
        format!(
            "Sidecar has no parent directory: {}",
            sidecar_path.display()
        )
    })?;
    let serialized = serde_json::to_vec_pretty(metadata).map_err(|error| error.to_string())?;
    let mut temporary =
        tempfile::NamedTempFile::new_in(parent).map_err(|error| error.to_string())?;
    temporary
        .write_all(&serialized)
        .map_err(|error| error.to_string())?;
    temporary
        .as_file()
        .sync_all()
        .map_err(|error| error.to_string())?;
    temporary
        .persist(sidecar_path)
        .map_err(|error| error.error.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn load_plus_document(path: String) -> Result<Option<Value>, String> {
    let (_, sidecar_path) = parse_virtual_path(&path);
    Ok(crate::exif_processing::load_sidecar(&sidecar_path).plus_document)
}

#[tauri::command]
pub fn save_plus_document(path: String, document: Value) -> Result<(), String> {
    if !path.contains("?vc=") {
        return Err("Layered documents must be saved to a virtual copy.".to_string());
    }
    validate_plus_document(&document)?;
    let (_, sidecar_path) = parse_virtual_path(&path);
    let mut metadata = crate::exif_processing::load_sidecar(&sidecar_path);
    metadata.plus_document = Some(document);
    write_sidecar_atomically(&sidecar_path, &metadata)
}

fn parse_sidecar_filename(file_name: &str) -> Option<(String, Option<String>)> {
    let base = file_name.strip_suffix(".tirdata")?;
    if base.len() >= 7 && base.as_bytes()[base.len() - 7] == b'.' {
        let id = &base[base.len() - 6..];
        if id.chars().all(|character| character.is_ascii_hexdigit()) {
            return Some((base[..base.len() - 7].to_string(), Some(id.to_string())));
        }
    }
    Some((base.to_string(), None))
}

#[cfg(test)]
mod output_naming_tests {
    use super::{
        apply_preset_adjustments_to_path, collect_preset_batch_folder_paths,
        compute_thumbnail_cache_hash, extract_app_xmp_value, extract_xmp_stack,
        import_rapidraw_sidecars, load_plus_document, parse_sidecar_filename, parse_virtual_path,
        read_xmp_from_folder, sanitize_filename_suffix, save_plus_document, set_app_xmp_value,
        sync_metadata_from_xmp, sync_metadata_to_xmp,
    };
    use crate::app_settings::AppSettings;
    use crate::image_processing::ImageMetadata;
    use std::fs;
    use std::path::PathBuf;
    use std::sync::atomic::AtomicBool;

    #[test]
    fn sanitizes_suffix_without_adding_or_removing_valid_separators() {
        assert_eq!(sanitize_filename_suffix("  _web-copy  "), "_web-copy");
        assert_eq!(sanitize_filename_suffix("_bad/name?"), "_badname");
    }

    #[test]
    fn virtual_copy_display_name_does_not_change_its_sidecar_path() {
        let (source, sidecar) = parse_virtual_path("/photos/image.raw?vc=abc123&name=_select");

        assert_eq!(source, PathBuf::from("/photos/image.raw"));
        assert_eq!(sidecar, PathBuf::from("/photos/image.raw.abc123.tirdata"));
    }

    #[test]
    fn tirdata_names_distinguish_primary_and_virtual_copy_sidecars() {
        assert_eq!(
            parse_sidecar_filename("image.jpg.abc123.tirdata"),
            Some(("image.jpg".to_string(), Some("abc123".to_string())))
        );
        assert_eq!(
            parse_sidecar_filename("image.jpg.tirdata"),
            Some(("image.jpg".to_string(), None))
        );
        assert_eq!(parse_sidecar_filename("image.jpg"), None);
    }

    #[test]
    fn plus_document_persistence_is_virtual_copy_only_and_preserves_unknown_fields() {
        let folder = tempfile::tempdir().unwrap();
        let source = folder.path().join("image.raw");
        fs::write(&source, b"raw").unwrap();
        let virtual_path = format!("{}?vc=plus01", source.display());
        let document = serde_json::json!({
            "mode": "layered",
            "documentVersion": 1,
            "id": "composition-1",
            "anchorPath": source,
            "layers": [],
            "futureField": { "kept": true }
        });

        assert!(save_plus_document(virtual_path.clone(), document.clone()).is_ok());
        assert_eq!(load_plus_document(virtual_path).unwrap(), Some(document));
        assert!(
            save_plus_document(source.to_string_lossy().into_owned(), serde_json::json!({}))
                .is_err()
        );
    }

    #[test]
    fn thumbnail_cache_hash_changes_with_persisted_adjustments() {
        let folder = tempfile::tempdir().unwrap();
        let image = folder.path().join("image.jpg");
        fs::write(&image, b"image bytes").unwrap();
        let image_path = image.to_string_lossy();

        let original = compute_thumbnail_cache_hash(&image_path, b"{}").unwrap();
        let edited = compute_thumbnail_cache_hash(&image_path, br#"{"brightness":0.5}"#).unwrap();

        assert_ne!(original, edited);
    }

    #[test]
    fn rapidraw_sidecar_import_is_validated_non_destructive_and_never_overwrites() {
        let folder = tempfile::tempdir().unwrap();
        let rapidraw_sidecar = folder.path().join("image.jpg.rrdata");
        let this_is_raw_sidecar = folder.path().join("image.jpg.tirdata");
        let invalid_sidecar = folder.path().join("broken.jpg.rrdata");
        let rapidraw_exif = folder.path().join("image.jpg.rrexif");
        let initial_metadata = ImageMetadata {
            rating: 4,
            ..ImageMetadata::default()
        };
        let initial_json = serde_json::to_string(&initial_metadata).unwrap();
        fs::write(&rapidraw_sidecar, &initial_json).unwrap();
        fs::write(&invalid_sidecar, "not json").unwrap();
        fs::write(&rapidraw_exif, "legacy").unwrap();

        let first = import_rapidraw_sidecars(folder.path().to_string_lossy().into_owned()).unwrap();
        assert_eq!(first.imported, 1);
        assert_eq!(first.skipped, 0);
        assert_eq!(first.invalid, 1);
        assert_eq!(first.failed, 0);
        assert_eq!(
            fs::read_to_string(&this_is_raw_sidecar).unwrap(),
            initial_json
        );

        let changed_json = serde_json::to_string(&ImageMetadata {
            rating: 1,
            ..ImageMetadata::default()
        })
        .unwrap();
        fs::write(&rapidraw_sidecar, &changed_json).unwrap();
        let second =
            import_rapidraw_sidecars(folder.path().to_string_lossy().into_owned()).unwrap();
        assert_eq!(second.imported, 0);
        assert_eq!(second.skipped, 1);
        assert_eq!(second.invalid, 1);
        assert_eq!(second.failed, 0);
        assert_eq!(
            fs::read_to_string(&this_is_raw_sidecar).unwrap(),
            initial_json
        );
        assert_eq!(fs::read_to_string(&rapidraw_sidecar).unwrap(), changed_json);
        assert_eq!(fs::read_to_string(&rapidraw_exif).unwrap(), "legacy");
    }

    #[test]
    fn preset_batch_folder_discovery_respects_recursion_and_virtual_copies() {
        let folder = tempfile::tempdir().unwrap();
        let image = folder.path().join("image.jpg");
        fs::write(&image, []).unwrap();
        fs::write(folder.path().join("image.jpg.tirdata"), "{}").unwrap();
        fs::write(folder.path().join("image.jpg.abc123.tirdata"), "{}").unwrap();

        let nested = folder.path().join("nested");
        fs::create_dir(&nested).unwrap();
        let nested_image = nested.join("nested.jpg");
        fs::write(&nested_image, []).unwrap();

        let folder_path = folder.path().to_string_lossy().into_owned();
        let cancellation_token = AtomicBool::new(false);
        let (direct, direct_failures) = collect_preset_batch_folder_paths(
            std::slice::from_ref(&folder_path),
            false,
            &cancellation_token,
        );
        assert_eq!(direct_failures, 0);
        assert!(direct.contains(image.to_string_lossy().as_ref()));
        assert!(direct.contains(&format!("{}?vc=abc123", image.to_string_lossy())));
        assert!(!direct.contains(nested_image.to_string_lossy().as_ref()));

        let (recursive, recursive_failures) = collect_preset_batch_folder_paths(
            &[folder_path.clone(), nested.to_string_lossy().into_owned()],
            true,
            &cancellation_token,
        );
        assert_eq!(recursive_failures, 0);
        assert!(recursive.contains(nested_image.to_string_lossy().as_ref()));
        assert_eq!(
            recursive.len(),
            3,
            "overlapping folders must be deduplicated"
        );
    }

    #[test]
    fn preset_batch_merges_adjustments_and_round_trips_through_xmp() {
        let folder = tempfile::tempdir().unwrap();
        let image = folder.path().join("image.jpg");
        fs::write(&image, []).unwrap();
        let existing = ImageMetadata {
            adjustments: serde_json::json!({ "exposure": 1.0, "contrast": 12.0 }),
            rating: 4,
            tags: Some(vec!["user:keep".to_string()]),
            ..ImageMetadata::default()
        };
        fs::write(
            folder.path().join("image.jpg.tirdata"),
            serde_json::to_string_pretty(&existing).unwrap(),
        )
        .unwrap();
        let settings = AppSettings {
            enable_xmp_sync: Some(true),
            create_xmp_if_missing: Some(true),
            ..AppSettings::default()
        };

        apply_preset_adjustments_to_path(
            image.to_string_lossy().as_ref(),
            &serde_json::json!({ "exposure": 2.5, "saturation": 18.0 }),
            &settings,
            None,
        )
        .unwrap();

        let merged = crate::exif_processing::load_sidecar(&folder.path().join("image.jpg.tirdata"));
        assert_eq!(merged.adjustments["exposure"], 2.5);
        assert_eq!(merged.adjustments["contrast"], 12.0);
        assert_eq!(merged.adjustments["saturation"], 18.0);
        assert_eq!(merged.rating, 4);
        assert_eq!(merged.tags.as_deref().unwrap(), ["user:keep".to_string()]);

        let mut imported = ImageMetadata::default();
        assert!(sync_metadata_from_xmp(&image, &mut imported, true, true));
        assert_eq!(imported.adjustments["exposure"], 2.5);
        assert_eq!(imported.adjustments["contrast"], 12.0);
        assert_eq!(imported.adjustments["saturation"], 18.0);
    }

    #[test]
    fn app_xmp_fields_round_trip_and_clear() {
        let mut xmp = "<rdf:Description>\n</rdf:Description>".to_string();
        set_app_xmp_value(&mut xmp, "Flag", Some("rejected"));
        set_app_xmp_value(&mut xmp, "StackId", Some("stack-123"));
        set_app_xmp_value(&mut xmp, "StackOrder", Some("2"));
        set_app_xmp_value(&mut xmp, "StackCover", Some("true"));
        set_app_xmp_value(&mut xmp, "StackCollapsed", Some("false"));

        assert_eq!(
            extract_app_xmp_value(&xmp, "Flag").as_deref(),
            Some("rejected")
        );
        let stack = extract_xmp_stack(&xmp).expect("stack metadata should parse");
        assert_eq!(stack.id, "stack-123");
        assert_eq!(stack.order, 2);
        assert!(stack.is_cover);
        assert!(!stack.collapsed);

        set_app_xmp_value(&mut xmp, "Flag", None);
        assert!(extract_app_xmp_value(&xmp, "Flag").is_none());
    }

    #[test]
    fn automatic_geometry_round_trips_through_xmp() {
        let folder = tempfile::tempdir().unwrap();
        let image = folder.path().join("building.raw");
        fs::write(&image, []).unwrap();
        fs::write(
            image.with_extension("xmp"),
            "<rdf:Description>\n</rdf:Description>",
        )
        .unwrap();

        let source = ImageMetadata {
            adjustments: serde_json::json!({
                "transformAutoMode": "auto",
                "transformRotate": -1.25,
                "transformVertical": 18.5,
                "transformHorizontal": -7.75,
                "transformConstrainCrop": true
            }),
            ..ImageMetadata::default()
        };
        sync_metadata_to_xmp(&image, &source, false, true);

        let xmp = fs::read_to_string(image.with_extension("xmp")).unwrap();
        assert_eq!(
            extract_app_xmp_value(&xmp, "AutoGeometryMode").as_deref(),
            Some("auto")
        );
        assert_eq!(
            extract_app_xmp_value(&xmp, "ConstrainCrop").as_deref(),
            Some("true")
        );

        let mut imported = ImageMetadata::default();
        assert!(sync_metadata_from_xmp(&image, &mut imported, true, true));
        assert_eq!(imported.adjustments["transformAutoMode"], "auto");
        assert_eq!(imported.adjustments["transformRotate"], -1.25);
        assert_eq!(imported.adjustments["transformVertical"], 18.5);
        assert_eq!(imported.adjustments["transformHorizontal"], -7.75);
        assert_eq!(imported.adjustments["transformConstrainCrop"], true);
    }

    #[test]
    fn guided_geometry_lines_and_solution_round_trip_through_xmp() {
        let folder = tempfile::tempdir().unwrap();
        let image = folder.path().join("guided.raw");
        fs::write(&image, []).unwrap();
        fs::write(
            image.with_extension("xmp"),
            "<rdf:Description>\n</rdf:Description>",
        )
        .unwrap();

        let source = ImageMetadata {
            adjustments: serde_json::json!({
                "transformAutoMode": "guided",
                "transformRotate": -0.75,
                "transformVertical": 21.5,
                "transformHorizontal": -8.25,
                "transformConstrainCrop": true,
                "transformGuides": {
                    "vertical": [
                        { "id": "v1", "x1": 0.2, "y1": 0.1, "x2": 0.25, "y2": 0.9 },
                        { "id": "v2", "x1": 0.8, "y1": 0.1, "x2": 0.75, "y2": 0.9 }
                    ],
                    "horizontal": []
                }
            }),
            ..ImageMetadata::default()
        };
        sync_metadata_to_xmp(&image, &source, false, true);

        let xmp = fs::read_to_string(image.with_extension("xmp")).unwrap();
        assert_eq!(
            extract_app_xmp_value(&xmp, "AutoGeometryMode").as_deref(),
            Some("guided")
        );
        assert_eq!(
            extract_app_xmp_value(&xmp, "TransformHorizontal").as_deref(),
            Some("-8.25")
        );

        let mut imported = ImageMetadata::default();
        assert!(sync_metadata_from_xmp(&image, &mut imported, true, true));
        assert_eq!(imported.adjustments, source.adjustments);
    }

    #[test]
    fn mask_order_and_blend_modes_round_trip_through_xmp() {
        let folder = tempfile::tempdir().unwrap();
        let image = folder.path().join("layers.raw");
        fs::write(&image, []).unwrap();
        fs::write(
            image.with_extension("xmp"),
            "<rdf:Description>\n</rdf:Description>",
        )
        .unwrap();

        let source = ImageMetadata {
            adjustments: serde_json::json!({
                "masks": [
                    { "id": "top", "blendMode": "overlay" },
                    { "id": "bottom", "blendMode": "multiply" }
                ]
            }),
            ..ImageMetadata::default()
        };
        sync_metadata_to_xmp(&image, &source, false, true);

        let mut imported = ImageMetadata::default();
        assert!(sync_metadata_from_xmp(&image, &mut imported, true, true));
        assert_eq!(imported.adjustments["masks"], source.adjustments["masks"]);
    }

    #[test]
    fn forced_folder_xmp_read_overwrites_metadata_recursively() {
        let folder = tempfile::tempdir().unwrap();
        let image = folder.path().join("image.jpg");
        let sidecar = folder.path().join("image.jpg.tirdata");
        fs::write(&image, []).unwrap();
        fs::write(
            image.with_extension("xmp"),
            r#"<rdf:Description>
 <xmp:Rating>5</xmp:Rating>
 <xmp:Label>Blue</xmp:Label>
 <rr:Flag>rejected</rr:Flag>
 <dc:subject><rdf:Bag><rdf:li>user:xmp</rdf:li></rdf:Bag></dc:subject>
</rdf:Description>"#,
        )
        .unwrap();

        let existing = ImageMetadata {
            rating: 2,
            tags: Some(vec![
                "color:green".to_string(),
                "flag:selected".to_string(),
                "user:local".to_string(),
            ]),
            ..ImageMetadata::default()
        };
        fs::write(&sidecar, serde_json::to_string_pretty(&existing).unwrap()).unwrap();

        let nested = folder.path().join("nested");
        fs::create_dir(&nested).unwrap();
        let nested_image = nested.join("nested.jpg");
        fs::write(&nested_image, []).unwrap();
        fs::write(
            nested.join("nested.jpg.xmp"),
            "<rdf:Description><xmp:Rating>4</xmp:Rating></rdf:Description>",
        )
        .unwrap();

        let files_read =
            read_xmp_from_folder(folder.path().to_string_lossy().into_owned()).unwrap();
        assert_eq!(files_read, 2);

        let imported = crate::exif_processing::load_sidecar(&sidecar);
        assert_eq!(imported.rating, 5);
        assert_eq!(
            imported.tags.unwrap(),
            ["user:xmp", "color:blue", "flag:rejected"]
        );
        let nested_metadata =
            crate::exif_processing::load_sidecar(&nested.join("nested.jpg.tirdata"));
        assert_eq!(nested_metadata.rating, 4);
    }

    #[test]
    fn large_folders_defer_metadata_loading() {
        assert!(!super::should_defer_metadata(499));
        assert!(super::should_defer_metadata(500));
        assert!(super::should_defer_metadata(30_000));
    }
}

#[tauri::command]
pub async fn read_exif_for_paths(
    paths: Vec<String>,
) -> Result<HashMap<String, HashMap<String, String>>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let exif_data: HashMap<String, HashMap<String, String>> = paths
            .par_iter()
            .filter_map(|virtual_path| {
                let (source_path, _) = parse_virtual_path(virtual_path);
                let source_path_str = source_path.to_string_lossy().to_string();

                let map = if let Some(sidecar_exif) =
                    crate::exif_processing::read_sidecar_exif(&source_path)
                {
                    sidecar_exif
                } else if is_cloud_placeholder(&source_path) {
                    HashMap::new()
                } else if let Ok(mmap) = read_file_mapped(&source_path) {
                    crate::exif_processing::read_exif_data(&source_path_str, &mmap)
                } else if let Ok(bytes) = fs::read(&source_path) {
                    crate::exif_processing::read_exif_data(&source_path_str, &bytes)
                } else {
                    HashMap::new()
                };

                if map.is_empty() {
                    None
                } else {
                    Some((virtual_path.clone(), map))
                }
            })
            .collect();

        Ok(exif_data)
    })
    .await
    .unwrap_or_else(|e| Err(format!("Task failed: {}", e)))
}

#[tauri::command]
pub async fn update_exif_fields(
    paths: Vec<String>,
    updates: HashMap<String, String>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        paths.par_iter().for_each(|path| {
            let original_path = Path::new(&path);
            let primary_path = crate::exif_processing::get_primary_sidecar_path(original_path);
            let temp_metadata = crate::exif_processing::load_sidecar(&primary_path);

            let mut exif_data = temp_metadata.exif.unwrap_or_else(|| {
                if let Some(existing) = crate::exif_processing::read_sidecar_exif(original_path) {
                    existing
                } else if let Ok(mmap) = read_file_mapped(original_path) {
                    crate::exif_processing::read_exif_data_from_bytes(path, &mmap)
                } else if let Ok(bytes) = fs::read(original_path) {
                    crate::exif_processing::read_exif_data_from_bytes(path, &bytes)
                } else {
                    HashMap::new()
                }
            });

            for (k, v) in &updates {
                let trimmed = v.trim();
                if trimmed.is_empty() {
                    exif_data.remove(k);
                } else {
                    exif_data.insert(k.clone(), trimmed.to_string());
                }
            }

            let mut final_metadata = crate::exif_processing::load_sidecar(&primary_path);

            final_metadata.exif = Some(exif_data);
            if let Ok(json) = serde_json::to_string_pretty(&final_metadata) {
                let _ = std::fs::write(&primary_path, json);
            }
        });
        Ok(())
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

fn match_disk_kind(disks: &Disks, canonical: &Path) -> Option<bool> {
    let mut best_match: Option<(&Path, bool)> = None;

    for disk in disks.list() {
        let mount_point = disk.mount_point();
        if canonical.starts_with(mount_point) {
            let is_longer_match = best_match
                .map(|(current, _)| mount_point.as_os_str().len() > current.as_os_str().len())
                .unwrap_or(true);
            if is_longer_match {
                best_match = Some((mount_point, disk.kind() == sysinfo::DiskKind::HDD));
            }
        }
    }

    best_match.map(|(_, is_hdd)| is_hdd)
}

fn update_rotational_disk_flag(path: &str, app_handle: &AppHandle) {
    let state = app_handle.state::<crate::AppState>();
    let Ok(canonical) = Path::new(path).canonicalize() else {
        return;
    };

    let cached_match = {
        let cache = state.disks_cache.lock().unwrap();
        cache
            .as_ref()
            .and_then(|disks| match_disk_kind(disks, &canonical))
    };

    match cached_match {
        Some(is_hdd) => {
            state
                .thumbnail_manager
                .rotational_disk
                .store(is_hdd, Ordering::Relaxed);
        }
        None => {
            if !state.disks_cache_refreshing.swap(true, Ordering::Relaxed) {
                let refresh_app_handle = app_handle.clone();
                thread::spawn(move || {
                    let disks = Disks::new_with_refreshed_list();
                    let state = refresh_app_handle.state::<crate::AppState>();
                    *state.disks_cache.lock().unwrap() = Some(disks);
                    state.disks_cache_refreshing.store(false, Ordering::Relaxed);
                });
            }
        }
    }
}

#[tauri::command]
pub fn list_images_in_dir(path: String, app_handle: AppHandle) -> Result<Vec<ImageFile>, String> {
    clear_pending_metadata(&app_handle);
    let settings = load_settings(app_handle.clone()).unwrap_or_default();
    let enable_xmp_sync = settings.enable_xmp_sync.unwrap_or(false);

    update_rotational_disk_flag(&path, &app_handle);

    let entries = fs::read_dir(&path).map_err(|e| e.to_string())?;
    let mut images = Vec::new();
    let mut sidecars_by_filename: HashMap<String, Vec<Option<String>>> = HashMap::new();

    for entry in entries.filter_map(Result::ok) {
        let entry_path = entry.path();
        let file_name = entry
            .file_name()
            .into_string()
            .unwrap_or_else(|os| os.to_string_lossy().into_owned());

        if let Some((source_filename, copy_id)) = parse_sidecar_filename(&file_name) {
            sidecars_by_filename
                .entry(source_filename)
                .or_default()
                .push(copy_id);
        } else if is_supported_image_file(&file_name) {
            images.push((file_name, entry_path));
        }
    }

    let tasks: Vec<_> = images
        .into_iter()
        .map(|(file_name, path_buf)| {
            let sidecars = sidecars_by_filename
                .remove(&file_name)
                .unwrap_or_else(|| vec![None]);
            let path_str = path_buf.to_string_lossy().into_owned();
            (path_str, file_name, path_buf, sidecars)
        })
        .collect();
    let defer_physical_metadata = should_defer_metadata(tasks.len());
    let process_task = |(path_str, file_name, path_buf, sidecars): (
        String,
        String,
        PathBuf,
        Vec<Option<String>>,
    )| {
        let modified = fs::metadata(&path_buf)
            .ok()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0);

        let is_cloud_placeholder = is_cloud_placeholder(&path_buf);

        let mut file_results = Vec::with_capacity(sidecars.len());

        for copy_id_opt in sidecars {
            let (mut virtual_path, is_virtual_copy, sidecar_filename) = match copy_id_opt {
                Some(id) => (
                    format!("{}?vc={}", path_str, id),
                    true,
                    format!("{}.{}.tirdata", file_name, id),
                ),
                None => (path_str.clone(), false, format!("{}.tirdata", file_name)),
            };

            let sidecar_path = path_buf.with_file_name(sidecar_filename);

            let xmp_path = enable_xmp_sync
                .then(|| resolve_xmp_path(&path_buf))
                .flatten();
            let xmp_is_placeholder = xmp_path
                .as_deref()
                .is_some_and(crate::file_management::is_cloud_placeholder);
            let sidecar_is_placeholder =
                crate::file_management::is_cloud_placeholder(&sidecar_path);

            let has_persisted_metadata = sidecar_path.is_file() || xmp_path.is_some();
            let metadata =
                if (!is_virtual_copy && defer_physical_metadata && has_persisted_metadata)
                    || sidecar_is_placeholder
                    || xmp_is_placeholder
                {
                    enqueue_metadata(
                        &app_handle,
                        virtual_path.clone(),
                        path_buf.clone(),
                        sidecar_path.clone(),
                    );
                    ImageFileMetadata {
                        is_edited: false,
                        tags: None,
                        rating: 0,
                        is_raw: crate::formats::is_raw_file(&path_buf),
                        copy_name_suffix: None,
                        xmp_stack: None,
                    }
                } else {
                    resolve_image_metadata(
                        &path_buf,
                        &sidecar_path,
                        enable_xmp_sync,
                        !is_virtual_copy,
                        &settings,
                    )
                };

            if is_virtual_copy
                && let Some(copy_suffix) = metadata
                    .copy_name_suffix
                    .as_deref()
                    .filter(|suffix| !suffix.is_empty())
            {
                virtual_path.push_str("&name=");
                virtual_path.push_str(copy_suffix);
            }

            file_results.push(ImageFile {
                path: virtual_path,
                modified,
                is_edited: metadata.is_edited,
                tags: metadata.tags,
                exif: None,
                is_virtual_copy,
                is_raw: metadata.is_raw,
                group_id: None,
                rating: metadata.rating,
                is_cloud_placeholder,
                xmp_stack: metadata.xmp_stack,
            });
        }

        file_results
    };

    let mut result_list: Vec<ImageFile> = if defer_physical_metadata {
        tasks.into_iter().flat_map(process_task).collect()
    } else {
        tasks.into_par_iter().flat_map(process_task).collect()
    };

    assign_group_ids(&mut result_list, &settings);
    if let Err(error) = crate::library_catalog::save_folder_snapshot(
        &app_handle,
        &path,
        false,
        enable_xmp_sync,
        &result_list,
    ) {
        eprintln!("Failed to update library catalog for {path}: {error}");
    }
    Ok(result_list)
}

fn list_images_recursive_sync(
    path: String,
    app_handle: AppHandle,
) -> Result<Vec<ImageFile>, String> {
    clear_pending_metadata(&app_handle);
    let settings = load_settings(app_handle.clone()).unwrap_or_default();
    let enable_xmp_sync = settings.enable_xmp_sync.unwrap_or(false);

    update_rotational_disk_flag(&path, &app_handle);

    let root_path = Path::new(&path);
    let mut images = Vec::new();

    let mut sidecars_by_path: HashMap<PathBuf, Vec<Option<String>>> = HashMap::new();

    for entry in WalkDir::new(root_path).into_iter().filter_map(Result::ok) {
        let entry_path = entry.path();
        if !entry_path.is_file() {
            continue;
        }

        let file_name = entry_path.file_name().unwrap_or_default().to_string_lossy();
        if let Some((source_filename, copy_id)) = parse_sidecar_filename(&file_name) {
            if let Some(parent) = entry_path.parent() {
                sidecars_by_path
                    .entry(parent.join(source_filename))
                    .or_default()
                    .push(copy_id);
            }
        } else if is_supported_image_file(entry_path.to_string_lossy().as_ref()) {
            images.push(entry_path.to_path_buf());
        }
    }

    let tasks: Vec<_> = images
        .into_iter()
        .map(|path_buf| {
            let sidecars = sidecars_by_path
                .remove(&path_buf)
                .unwrap_or_else(|| vec![None]);
            let path_str = path_buf.to_string_lossy().into_owned();
            let file_name = path_buf
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .into_owned();
            (path_str, file_name, path_buf, sidecars)
        })
        .collect();
    let defer_physical_metadata = should_defer_metadata(tasks.len());

    let process_task = |(path_str, file_name, path_buf, sidecars): (
        String,
        String,
        PathBuf,
        Vec<Option<String>>,
    )| {
        let modified = fs::metadata(&path_buf)
            .ok()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0);

        let is_cloud_placeholder = is_cloud_placeholder(&path_buf);

        let mut file_results = Vec::with_capacity(sidecars.len());

        for copy_id_opt in sidecars {
            let (mut virtual_path, is_virtual_copy, sidecar_filename) = match copy_id_opt {
                Some(id) => (
                    format!("{}?vc={}", path_str, id),
                    true,
                    format!("{}.{}.tirdata", file_name, id),
                ),
                None => (path_str.clone(), false, format!("{}.tirdata", file_name)),
            };

            let sidecar_path = path_buf.with_file_name(sidecar_filename);

            let xmp_path = enable_xmp_sync
                .then(|| resolve_xmp_path(&path_buf))
                .flatten();
            let xmp_is_placeholder = xmp_path
                .as_deref()
                .is_some_and(crate::file_management::is_cloud_placeholder);
            let sidecar_is_placeholder =
                crate::file_management::is_cloud_placeholder(&sidecar_path);

            // A missing primary sidecar already has known default metadata. Do not
            // enqueue tens of thousands of no-op filesystem reads for a new large
            // library; only persisted metadata (or XMP that may be imported) needs
            // to be resolved by the background workers.
            let has_persisted_metadata = sidecar_path.is_file() || xmp_path.is_some();
            let metadata =
                if (!is_virtual_copy && defer_physical_metadata && has_persisted_metadata)
                    || sidecar_is_placeholder
                    || xmp_is_placeholder
                {
                    enqueue_metadata(
                        &app_handle,
                        virtual_path.clone(),
                        path_buf.clone(),
                        sidecar_path.clone(),
                    );
                    ImageFileMetadata {
                        is_edited: false,
                        tags: None,
                        rating: 0,
                        is_raw: crate::formats::is_raw_file(&path_buf),
                        copy_name_suffix: None,
                        xmp_stack: None,
                    }
                } else {
                    resolve_image_metadata(
                        &path_buf,
                        &sidecar_path,
                        enable_xmp_sync,
                        !is_virtual_copy,
                        &settings,
                    )
                };

            if is_virtual_copy
                && let Some(copy_suffix) = metadata
                    .copy_name_suffix
                    .as_deref()
                    .filter(|suffix| !suffix.is_empty())
            {
                virtual_path.push_str("&name=");
                virtual_path.push_str(copy_suffix);
            }

            file_results.push(ImageFile {
                path: virtual_path,
                modified,
                is_edited: metadata.is_edited,
                tags: metadata.tags,
                exif: None,
                is_virtual_copy,
                is_raw: metadata.is_raw,
                group_id: None,
                rating: metadata.rating,
                is_cloud_placeholder,
                xmp_stack: metadata.xmp_stack,
            });
        }

        file_results
    };

    // Large recursive libraries already defer persisted metadata to a bounded
    // worker pool. Reconciliation is dominated by filesystem calls (including
    // macOS placeholder lstat checks), so spreading it over every Rayon thread
    // only saturates the machine and starves the WebKit UI process.
    let mut result_list: Vec<ImageFile> = if defer_physical_metadata {
        tasks.into_iter().flat_map(process_task).collect()
    } else {
        tasks.into_par_iter().flat_map(process_task).collect()
    };

    assign_group_ids(&mut result_list, &settings);
    if let Err(error) = crate::library_catalog::save_folder_snapshot(
        &app_handle,
        &path,
        true,
        enable_xmp_sync,
        &result_list,
    ) {
        eprintln!("Failed to update library catalog for {path}: {error}");
    }
    Ok(result_list)
}

#[tauri::command]
pub async fn list_images_recursive(
    path: String,
    app_handle: AppHandle,
) -> Result<Vec<ImageFile>, String> {
    tauri::async_runtime::spawn_blocking(move || list_images_recursive_sync(path, app_handle))
        .await
        .map_err(|error| format!("Recursive image scan task failed: {error}"))?
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum AlbumItem {
    Album {
        id: String,
        name: String,
        icon: Option<String>,
        images: Vec<String>,
    },
    Group {
        id: String,
        name: String,
        icon: Option<String>,
        children: Vec<AlbumItem>,
    },
}

fn get_albums_path(app_handle: &AppHandle) -> Result<PathBuf, String> {
    let data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    let albums_dir = data_dir.join("albums");
    if !albums_dir.exists() {
        fs::create_dir_all(&albums_dir).map_err(|e| e.to_string())?;
    }
    Ok(albums_dir.join("albums.json"))
}

pub fn sort_album_tree(items: &mut [AlbumItem]) {
    items.sort_by(|a, b| {
        let get_sort_key = |item: &AlbumItem| match item {
            AlbumItem::Group { name, .. } => (0, name.to_lowercase()),
            AlbumItem::Album { name, .. } => (1, name.to_lowercase()),
        };

        let key_a = get_sort_key(a);
        let key_b = get_sort_key(b);

        key_a.cmp(&key_b)
    });

    for item in items.iter_mut() {
        if let AlbumItem::Group { children, .. } = item {
            sort_album_tree(children);
        }
    }
}

#[tauri::command]
pub fn get_albums(app_handle: AppHandle) -> Result<Vec<AlbumItem>, String> {
    let path = get_albums_path(&app_handle)?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let content = fs::read_to_string(path).map_err(|e| e.to_string())?;
    let mut items: Vec<AlbumItem> = serde_json::from_str(&content).map_err(|e| e.to_string())?;
    sort_album_tree(&mut items);
    Ok(items)
}

#[tauri::command]
pub fn save_albums(mut tree: Vec<AlbumItem>, app_handle: AppHandle) -> Result<(), String> {
    let path = get_albums_path(&app_handle)?;
    sort_album_tree(&mut tree);
    let json_string = serde_json::to_string_pretty(&tree).map_err(|e| e.to_string())?;
    fs::write(path, json_string).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn add_to_album(
    album_id: String,
    paths: Vec<String>,
    app_handle: AppHandle,
) -> Result<(), String> {
    let mut tree = get_albums(app_handle.clone())?;

    fn add_recursive(items: &mut [AlbumItem], target_id: &str, paths_to_add: &Vec<String>) -> bool {
        for item in items.iter_mut() {
            #[allow(clippy::collapsible_match)]
            match item {
                AlbumItem::Album { id, images, .. } if id == target_id => {
                    for p in paths_to_add {
                        if !images.contains(p) {
                            images.push(p.clone());
                        }
                    }
                    return true;
                }
                AlbumItem::Group { children, .. } => {
                    if add_recursive(children, target_id, paths_to_add) {
                        return true;
                    }
                }
                _ => {}
            }
        }
        false
    }

    if add_recursive(&mut tree, &album_id, &paths) {
        save_albums(tree, app_handle)?;
    }
    Ok(())
}

fn sync_album_path_changes(
    app_handle: &AppHandle,
    renames: Option<&HashMap<String, String>>,
    deletions: Option<&HashSet<String>>,
    folder_rename: Option<(&str, &str)>,
) {
    if let Ok(mut tree) = get_albums(app_handle.clone()) {
        let mut changed = false;

        fn process_nodes(
            nodes: &mut [AlbumItem],
            renames: Option<&HashMap<String, String>>,
            deletions: Option<&HashSet<String>>,
            folder_rename: Option<(&str, &str)>,
            changed: &mut bool,
        ) {
            for node in nodes.iter_mut() {
                match node {
                    AlbumItem::Album { images, .. } => {
                        let mut new_images = Vec::new();

                        for img in images.drain(..) {
                            let mut current_img = img;

                            if let Some((old_folder, new_folder)) = folder_rename {
                                let img_path = Path::new(&current_img);
                                let old_path = Path::new(old_folder);
                                if let Ok(stripped) = img_path.strip_prefix(old_path) {
                                    let new_img_path = Path::new(new_folder).join(stripped);
                                    current_img = new_img_path.to_string_lossy().into_owned();
                                    *changed = true;
                                }
                            }

                            if let Some(r) = renames {
                                if let Some(new_path) = r.get(&current_img) {
                                    current_img = new_path.clone();
                                    *changed = true;
                                } else if let Some((base_path, vc_id)) =
                                    current_img.rsplit_once("?vc=")
                                    && let Some(new_base) = r.get(base_path)
                                {
                                    current_img = format!("{}?vc={}", new_base, vc_id);
                                    *changed = true;
                                }
                            }

                            let mut is_deleted = false;
                            if let Some(d) = deletions {
                                if d.contains(&current_img) {
                                    is_deleted = true;
                                } else {
                                    let img_path = Path::new(&current_img);
                                    for del_path_str in d {
                                        let del_path = Path::new(del_path_str);
                                        if img_path.starts_with(del_path) {
                                            is_deleted = true;
                                            break;
                                        }

                                        if let Some((base_path, _)) =
                                            current_img.rsplit_once("?vc=")
                                            && base_path == del_path_str
                                        {
                                            is_deleted = true;
                                            break;
                                        }
                                    }
                                }
                            }

                            if !is_deleted {
                                new_images.push(current_img);
                            } else {
                                *changed = true;
                            }
                        }
                        *images = new_images;
                    }
                    AlbumItem::Group { children, .. } => {
                        process_nodes(children, renames, deletions, folder_rename, changed);
                    }
                }
            }
        }

        process_nodes(&mut tree, renames, deletions, folder_rename, &mut changed);

        if changed {
            let _ = save_albums(tree, app_handle.clone());
        }
    }
}

#[tauri::command]
pub fn get_album_images(
    paths: Vec<String>,
    app_handle: AppHandle,
) -> Result<Vec<ImageFile>, String> {
    let settings = load_settings(app_handle.clone()).unwrap_or_default();
    let enable_xmp_sync = settings.enable_xmp_sync.unwrap_or(false);

    let mut result_list: Vec<ImageFile> = paths
        .into_par_iter()
        .filter_map(|virtual_path| {
            let (source_path, sidecar_path) = parse_virtual_path(&virtual_path);
            if !source_path.exists() {
                return None;
            }

            let modified = fs::metadata(&source_path)
                .ok()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .unwrap_or(0);

            let is_virtual_copy = virtual_path.contains("?vc=");
            let is_cloud_placeholder = is_cloud_placeholder(&source_path);

            let xmp_is_placeholder = enable_xmp_sync
                && resolve_xmp_path(&source_path)
                    .is_some_and(|p| crate::file_management::is_cloud_placeholder(&p));

            let metadata = if crate::file_management::is_cloud_placeholder(&sidecar_path)
                || xmp_is_placeholder
            {
                enqueue_metadata(
                    &app_handle,
                    virtual_path.clone(),
                    source_path.clone(),
                    sidecar_path.clone(),
                );
                ImageFileMetadata {
                    is_edited: false,
                    tags: None,
                    rating: 0,
                    is_raw: crate::formats::is_raw_file(&source_path),
                    copy_name_suffix: None,
                    xmp_stack: None,
                }
            } else {
                resolve_image_metadata(
                    &source_path,
                    &sidecar_path,
                    enable_xmp_sync,
                    !is_virtual_copy,
                    &settings,
                )
            };

            Some(ImageFile {
                path: virtual_path.clone(),
                modified,
                is_edited: metadata.is_edited,
                tags: metadata.tags,
                exif: None,
                is_virtual_copy,
                is_raw: metadata.is_raw,
                group_id: None,
                rating: metadata.rating,
                is_cloud_placeholder,
                xmp_stack: metadata.xmp_stack,
            })
        })
        .collect();

    assign_group_ids(&mut result_list, &settings);
    Ok(result_list)
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FolderNode {
    pub name: String,
    pub path: String,
    pub children: Vec<FolderNode>,
    pub is_dir: bool,
    pub image_count: usize,
    pub contains_images: bool,
    pub has_subdirs: bool,
    pub modified: u64,
    pub created: u64,
}

fn has_subdirs(path: &Path) -> bool {
    if let Ok(entries) = std::fs::read_dir(path) {
        for entry in entries.filter_map(Result::ok) {
            if let Ok(file_type) = entry.file_type()
                && file_type.is_dir()
            {
                let name = entry.file_name();
                if !name.to_string_lossy().starts_with('.') {
                    return true;
                }
            }
        }
    }
    false
}

fn contains_supported_image(path: &Path) -> bool {
    WalkDir::new(path)
        .into_iter()
        .filter_map(Result::ok)
        .any(|entry| entry.file_type().is_file() && is_supported_image_file(entry.path()))
}

fn scan_dir_lazy(
    path: &Path,
    expanded_folders: &HashSet<&str>,
    show_image_counts: bool,
    detect_images: bool,
    prefetch_one_level: bool,
) -> Result<(Vec<FolderNode>, usize, bool), std::io::Error> {
    let mut children_folders = Vec::new();
    let mut current_dir_image_count = 0;
    let mut current_dir_contains_images = false;

    let entries = match std::fs::read_dir(path) {
        Ok(entries) => entries,
        Err(e) => {
            log::warn!("Could not scan directory '{}': {}", path.display(), e);
            return Ok((Vec::new(), 0, false));
        }
    };

    for entry in entries.filter_map(Result::ok) {
        let current_path = entry.path();
        let (file_type, modified, created) = match entry.metadata() {
            Ok(meta) => {
                let ft = meta.file_type();
                let mod_time = meta.modified().unwrap_or(std::time::SystemTime::UNIX_EPOCH);
                let cre_time = meta.created().unwrap_or(mod_time);

                (
                    ft,
                    mod_time
                        .duration_since(std::time::SystemTime::UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_secs(),
                    cre_time
                        .duration_since(std::time::SystemTime::UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_secs(),
                )
            }
            Err(_) => continue,
        };

        let file_name = entry.file_name();
        let name_str = file_name.to_string_lossy();

        if name_str.starts_with('.') {
            continue;
        }

        if file_type.is_dir() {
            let path_str = current_path.to_string_lossy().into_owned();
            let is_expanded = expanded_folders.contains(path_str.as_str());

            let should_scan = is_expanded || prefetch_one_level;
            let next_prefetch = is_expanded;

            let (grand_children, sub_dir_own_images, sub_dir_contains_images) = if should_scan {
                scan_dir_lazy(
                    &current_path,
                    expanded_folders,
                    show_image_counts,
                    detect_images,
                    next_prefetch,
                )?
            } else {
                let count = if show_image_counts {
                    WalkDir::new(&current_path)
                        .into_iter()
                        .filter_map(Result::ok)
                        .filter(|e| {
                            e.file_type().is_file()
                                && crate::formats::is_supported_image_file(e.path())
                        })
                        .count()
                } else {
                    0
                };
                let contains_images =
                    count > 0 || (detect_images && contains_supported_image(&current_path));
                (Vec::new(), count, contains_images)
            };

            let has_any_subdirs = if should_scan {
                grand_children.iter().any(|c| c.is_dir)
            } else {
                has_subdirs(&current_path)
            };

            let grand_children_sum: usize = grand_children.iter().map(|c| c.image_count).sum();
            let total_child_count = sub_dir_own_images + grand_children_sum;
            let contains_images =
                sub_dir_contains_images || grand_children.iter().any(|child| child.contains_images);

            children_folders.push(FolderNode {
                name: name_str.into_owned(),
                path: path_str,
                children: grand_children,
                is_dir: true,
                image_count: total_child_count,
                contains_images,
                has_subdirs: has_any_subdirs,
                modified,
                created,
            });
        } else if file_type.is_file() && crate::formats::is_supported_image_file(&current_path) {
            current_dir_contains_images = true;
            if show_image_counts {
                current_dir_image_count += 1;
            }
        }
    }

    children_folders.sort_by_key(|a| a.name.to_lowercase());

    Ok((
        children_folders,
        current_dir_image_count,
        current_dir_contains_images,
    ))
}

fn get_folder_tree_sync(
    path: String,
    expanded_folders: Vec<String>,
    show_image_counts: bool,
    detect_images: bool,
) -> Result<FolderNode, String> {
    let root_path = Path::new(&path);
    if !root_path.is_dir() {
        return Err(format!("Directory does not exist: {}", path));
    }

    let (modified, created) = root_path
        .metadata()
        .map(|m| {
            let mod_time = m.modified().unwrap_or(std::time::SystemTime::UNIX_EPOCH);
            let cre_time = m.created().unwrap_or(mod_time);
            (
                mod_time
                    .duration_since(std::time::SystemTime::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_secs(),
                cre_time
                    .duration_since(std::time::SystemTime::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_secs(),
            )
        })
        .unwrap_or((0, 0));

    let expanded_set: HashSet<&str> = expanded_folders.iter().map(|s| s.as_str()).collect();

    let (children, own_count, own_contains_images) = scan_dir_lazy(
        root_path,
        &expanded_set,
        show_image_counts,
        detect_images,
        true,
    )
    .map_err(|e| e.to_string())?;

    let children_sum: usize = children.iter().map(|c| c.image_count).sum();
    let has_subdirs = children.iter().any(|c| c.is_dir);
    let contains_images = own_contains_images || children.iter().any(|child| child.contains_images);

    let name = match root_path.file_name() {
        Some(n) => n.to_string_lossy().into_owned(),
        None => {
            let trimmed = path.trim_end_matches(&['/', '\\'][..]);
            if trimmed.is_empty() {
                path.clone()
            } else {
                trimmed.to_string()
            }
        }
    };

    Ok(FolderNode {
        name,
        path: path.clone(),
        children,
        is_dir: true,
        image_count: own_count + children_sum,
        contains_images,
        has_subdirs,
        modified,
        created,
    })
}

#[tauri::command]
pub async fn get_folder_children(
    path: String,
    show_image_counts: bool,
    hide_empty_folders: bool,
) -> Result<Vec<FolderNode>, String> {
    match tauri::async_runtime::spawn_blocking(move || {
        let root_path = Path::new(&path);
        if !root_path.is_dir() {
            return Err(format!("Directory does not exist: {}", path));
        }
        let empty_set = HashSet::new();
        let (children, _, _) = scan_dir_lazy(
            root_path,
            &empty_set,
            show_image_counts,
            hide_empty_folders,
            false,
        )
        .map_err(|e| e.to_string())?;

        Ok(children)
    })
    .await
    {
        Ok(Ok(children)) => Ok(children),
        Ok(Err(e)) => Err(e),
        Err(e) => Err(format!("Task failed: {}", e)),
    }
}

#[tauri::command]
pub async fn get_folder_tree(
    path: String,
    expanded_folders: Vec<String>,
    show_image_counts: bool,
    hide_empty_folders: bool,
    app_handle: AppHandle,
) -> Result<FolderNode, String> {
    let task_path = path.clone();
    match tauri::async_runtime::spawn_blocking(move || {
        get_folder_tree_sync(
            task_path,
            expanded_folders,
            show_image_counts,
            hide_empty_folders,
        )
    })
    .await
    {
        Ok(Ok(folder_node)) => {
            if let Err(error) = crate::library_catalog::save_folder_tree_snapshots(
                &app_handle,
                std::slice::from_ref(&folder_node),
                show_image_counts,
                hide_empty_folders,
            ) {
                log::warn!("Failed to cache folder tree for {path}: {error}");
            }
            Ok(folder_node)
        }
        Ok(Err(e)) => Err(e),
        Err(e) => Err(format!("Failed to execute folder tree task: {}", e)),
    }
}

#[tauri::command]
pub async fn get_pinned_folder_trees(
    paths: Vec<String>,
    expanded_folders: Vec<String>,
    show_image_counts: bool,
    hide_empty_folders: bool,
    app_handle: AppHandle,
) -> Result<Vec<FolderNode>, String> {
    let result = tauri::async_runtime::spawn_blocking(move || {
        let results: Vec<Result<FolderNode, String>> = paths
            .par_iter()
            .map(|path| {
                get_folder_tree_sync(
                    path.clone(),
                    expanded_folders.clone(),
                    show_image_counts,
                    hide_empty_folders,
                )
            })
            .collect();

        let mut folder_nodes = Vec::new();
        for result in results {
            match result {
                Ok(node) => folder_nodes.push(node),
                Err(e) => log::warn!("Failed to get tree for pinned folder: {}", e),
            }
        }
        folder_nodes
    })
    .await;

    match result {
        Ok(nodes) => {
            if let Err(error) = crate::library_catalog::save_folder_tree_snapshots(
                &app_handle,
                &nodes,
                show_image_counts,
                hide_empty_folders,
            ) {
                log::warn!("Failed to cache folder trees: {error}");
            }
            Ok(nodes)
        }
        Err(e) => Err(format!("Task failed: {}", e)),
    }
}

/// Checks if the given path exists and is an iCloud placeholder file on macOS.
#[cfg(target_os = "macos")]
pub fn is_cloud_placeholder(path: &Path) -> bool {
    use std::os::unix::ffi::OsStrExt;
    const SF_DATALESS: u32 = 0x4000_0000;

    let c_path = match std::ffi::CString::new(path.as_os_str().as_bytes()) {
        Ok(p) => p,
        Err(_) => return false,
    };
    let mut stat_buf: libc::stat = unsafe { std::mem::zeroed() };
    let ret = unsafe { libc::lstat(c_path.as_ptr(), &mut stat_buf) };
    ret == 0 && (stat_buf.st_flags & SF_DATALESS) != 0
}

#[cfg(not(target_os = "macos"))]
pub fn is_cloud_placeholder(_path: &Path) -> bool {
    false
}

pub fn read_file_mapped(path: &Path) -> Result<Mmap, ReadFileError> {
    if !path.is_file() {
        return Err(ReadFileError::Invalid);
    }
    if !path.exists() {
        return Err(ReadFileError::NotFound);
    }
    if path.metadata().map_err(ReadFileError::Io)?.len() == 0 {
        return Err(ReadFileError::Empty);
    }
    let file = fs::File::open(path).map_err(ReadFileError::Io)?;
    if file.try_lock_shared().is_err() {
        return Err(ReadFileError::Locked);
    }
    let mmap = unsafe {
        MmapOptions::new()
            .len(file.metadata().map_err(ReadFileError::Io)?.len() as usize)
            .map(&file)
            .map_err(ReadFileError::Io)?
    };
    Ok(mmap)
}

fn find_embedded_jpeg(exif: &exif::Exif, ifd: exif::In) -> Option<&[u8]> {
    let offset = exif
        .get_field(exif::Tag::JPEGInterchangeFormat, ifd)?
        .value
        .get_uint(0)? as usize;
    let len = exif
        .get_field(exif::Tag::JPEGInterchangeFormatLength, ifd)?
        .value
        .get_uint(0)? as usize;
    exif.buf().get(offset..offset + len)
}

fn apply_exif_orientation(img: DynamicImage, orientation: u32) -> DynamicImage {
    match orientation {
        2 => img.fliph(),
        3 => img.rotate180(),
        4 => img.flipv(),
        5 => img.rotate90().fliph(),
        6 => img.rotate90(),
        7 => img.rotate270().fliph(),
        8 => img.rotate270(),
        _ => img,
    }
}

fn try_load_embedded_raw_preview(source_path: &Path, target_res: u32) -> Option<DynamicImage> {
    let mmap = read_file_mapped(source_path).ok()?;
    let exif = exif_processing::read_exif(&mmap)?;

    let (jpeg_bytes, ifd) = find_embedded_jpeg(&exif, exif::In::PRIMARY)
        .map(|b| (b, exif::In::PRIMARY))
        .or_else(|| {
            find_embedded_jpeg(&exif, exif::In::THUMBNAIL).map(|b| (b, exif::In::THUMBNAIL))
        })?;

    let img = image::load_from_memory_with_format(jpeg_bytes, image::ImageFormat::Jpeg).ok()?;

    if img.width().max(img.height()) < (target_res as f32 * 0.95) as u32 {
        return None;
    }

    let orientation = exif
        .get_field(exif::Tag::Orientation, ifd)
        .and_then(|f| f.value.get_uint(0))
        .unwrap_or(1);

    Some(apply_exif_orientation(img, orientation))
}

pub fn generate_thumbnail_data(
    path_str: &str,
    gpu_context: Option<&GpuContext>,
    preloaded_image: Option<&DynamicImage>,
    app_handle: &AppHandle,
) -> anyhow::Result<DynamicImage> {
    let (source_path, sidecar_path) = parse_virtual_path(path_str);
    let source_path_str = source_path.to_string_lossy().to_string();
    let is_raw = is_raw_file(&source_path_str);

    let metadata: Option<ImageMetadata> = if is_cloud_placeholder(&sidecar_path) {
        enqueue_metadata(
            app_handle,
            path_str.to_string(),
            source_path.clone(),
            sidecar_path.clone(),
        );
        None
    } else {
        fs::read_to_string(&sidecar_path)
            .ok()
            .and_then(|content| serde_json::from_str(&content).ok())
    };

    let adjustments = metadata
        .as_ref()
        .map_or(serde_json::Value::Null, |m| m.adjustments.clone());

    if !adjustments.is_null() && gpu_context.is_none() {
        anyhow::bail!(
            "An adjusted thumbnail requires the shared GPU renderer; refusing to publish an unprocessed fallback"
        );
    }

    let settings = load_settings(app_handle.clone()).unwrap_or_default();
    let always_decode_raw = settings.always_decode_raw_thumbnails.unwrap_or(false);

    if is_raw && adjustments.is_null() && preloaded_image.is_none() && !always_decode_raw {
        let target_res = settings.thumbnail_resolution.unwrap_or(720);
        if let Some(preview) = try_load_embedded_raw_preview(&source_path, target_res) {
            return Ok(preview);
        }
    }

    if let (Some(context), Some(meta)) = (gpu_context, metadata)
        && !meta.adjustments.is_null()
    {
        let state = app_handle.state::<AppState>();
        let target_res = settings.thumbnail_resolution.unwrap_or(720);

        let base_cache_hash = crate::cache_utils::calculate_thumbnail_base_hash(&meta.adjustments);

        let crop_data: Option<Crop> = serde_json::from_value(meta.adjustments["crop"].clone()).ok();

        let cached_base: Option<(DynamicImage, f32)> = {
            let cache = state.thumbnail_geometry_cache.lock().unwrap();
            if let Some((cached_hash, img, scale)) = cache.get(path_str) {
                let mut sufficient_resolution = true;
                if let Some(c) = &crop_data
                    && c.width > 0.0
                    && c.height > 0.0
                {
                    let final_crop_max_dim =
                        (c.width as f32 * *scale).max(c.height as f32 * *scale);
                    if final_crop_max_dim < (target_res as f32 * 0.95) {
                        sufficient_resolution = false;
                    }
                }

                if *cached_hash == base_cache_hash && sufficient_resolution {
                    Some((img.clone(), *scale))
                } else {
                    None
                }
            } else {
                None
            }
        };

        let (processing_base, total_scale) = if let Some(hit) = cached_base {
            hit
        } else {
            let mut raw_scale_factor = 1.0f32;

            let composite_image = if let Some(img) = preloaded_image {
                image_loader::composite_patches_on_image(img, &adjustments)?
            } else {
                let mmap_guard;
                let vec_guard;

                let file_slice: &[u8] = match read_file_mapped(&source_path) {
                    Ok(mmap) => {
                        mmap_guard = Some(mmap);
                        mmap_guard.as_ref().unwrap()
                    }
                    Err(e) => {
                        if preloaded_image.is_none() {
                            log::warn!("Fallback read for {}: {}", source_path_str, e);
                        }
                        let bytes = fs::read(&source_path).map_err(|io_err| {
                            anyhow::anyhow!(
                                "Fallback read failed for {}: {}",
                                source_path_str,
                                io_err
                            )
                        })?;
                        vec_guard = Some(bytes);
                        vec_guard.as_ref().unwrap()
                    }
                };

                let img = image_loader::load_and_composite(
                    file_slice,
                    &source_path_str,
                    &adjustments,
                    true,
                    &settings,
                    None,
                )?;

                if is_raw {
                    raw_scale_factor = crate::raw_processing::get_fast_demosaic_scale_factor(
                        file_slice,
                        img.width(),
                        img.height(),
                    );
                }
                img
            };

            let warped_image =
                apply_geometry_warp(Cow::Borrowed(&composite_image), &meta.adjustments);

            let blurred_image = crate::lens_blur::apply_lens_blur(warped_image, &meta.adjustments);

            let orientation_steps =
                meta.adjustments["orientationSteps"].as_u64().unwrap_or(0) as u8;
            let coarse_rotated_image = apply_coarse_rotation(blurred_image, orientation_steps);

            let (full_w, full_h) = coarse_rotated_image.dimensions();

            let mut processing_dim = target_res;
            if let Some(c) = &crop_data
                && c.width > 0.0
                && c.height > 0.0
            {
                let crop_max_dim_loaded = c.width.max(c.height) * raw_scale_factor as f64;
                let full_max_dim = full_w.max(full_h) as f64;
                if crop_max_dim_loaded > 0.0 {
                    processing_dim = ((target_res as f64 * full_max_dim / crop_max_dim_loaded)
                        .round() as u32)
                        .min(full_w.max(full_h));
                }
            }

            let (base, gpu_scale) = if full_w > processing_dim || full_h > processing_dim {
                let base = crate::image_processing::downscale_f32_image(
                    &coarse_rotated_image,
                    processing_dim,
                    processing_dim,
                );
                let scale = if full_w > 0 {
                    base.width() as f32 / full_w as f32
                } else {
                    1.0
                };
                (base, scale)
            } else {
                (coarse_rotated_image.into_owned(), 1.0)
            };

            let total_scale = gpu_scale * raw_scale_factor;

            let mut cache = state.thumbnail_geometry_cache.lock().unwrap();
            if cache.len() > 30 {
                cache.clear();
            }
            cache.insert(
                path_str.to_string(),
                (base_cache_hash, base.clone(), total_scale),
            );

            (base, total_scale)
        };

        let rotation_degrees = meta.adjustments["rotation"].as_f64().unwrap_or(0.0) as f32;
        let flip_horizontal = meta.adjustments["flipHorizontal"]
            .as_bool()
            .unwrap_or(false);
        let flip_vertical = meta.adjustments["flipVertical"].as_bool().unwrap_or(false);

        let flipped_image = apply_flip(Cow::Owned(processing_base), flip_horizontal, flip_vertical);
        let rotated_image = apply_rotation(flipped_image, rotation_degrees);

        let scaled_crop_json = if let Some(c) = &crop_data {
            serde_json::to_value(Crop {
                x: c.x * total_scale as f64,
                y: c.y * total_scale as f64,
                width: c.width * total_scale as f64,
                height: c.height * total_scale as f64,
            })
            .unwrap_or(serde_json::Value::Null)
        } else {
            serde_json::Value::Null
        };

        let cropped_preview = apply_crop(rotated_image, &scaled_crop_json);
        let (preview_w, preview_h) = cropped_preview.dimensions();
        let unscaled_crop_offset = crop_data.map_or((0.0, 0.0), |c| (c.x as f32, c.y as f32));

        let mask_definitions: Vec<MaskDefinition> = meta
            .adjustments
            .get("masks")
            .and_then(|m| serde_json::from_value(m.clone()).ok())
            .unwrap_or_else(Vec::new);

        let mask_bitmaps: Vec<ImageBuffer<Luma<u8>, Vec<u8>>> = mask_definitions
            .iter()
            .filter_map(|def| {
                crate::get_cached_or_generate_mask(
                    &state,
                    def,
                    preview_w,
                    preview_h,
                    total_scale,
                    (
                        unscaled_crop_offset.0 * total_scale,
                        unscaled_crop_offset.1 * total_scale,
                    ),
                    &meta.adjustments,
                )
            })
            .collect();

        let tm_override = crate::image_processing::resolve_tonemapper_override(&settings, is_raw);
        let gpu_adjustments = get_all_adjustments_from_json(&meta.adjustments, is_raw, tm_override);
        let lut_path = meta.adjustments["lutPath"].as_str();
        let lut = lut_path.and_then(|p| {
            let mut cache = state.lut_cache.lock().unwrap();
            if let Some(cached_lut) = cache.get(p) {
                return Some(cached_lut.clone());
            }
            if let Ok(loaded_lut) = crate::lut_processing::parse_lut_file(p) {
                let arc_lut = Arc::new(loaded_lut);
                cache.insert(p.to_string(), arc_lut.clone());
                return Some(arc_lut);
            }
            None
        });

        let mut hasher = DefaultHasher::new();
        path_str.hash(&mut hasher);
        meta.adjustments.to_string().hash(&mut hasher);
        let unique_hash = hasher.finish();

        if let Ok(processed_image) = gpu_processing::process_and_get_dynamic_image(
            context,
            &state,
            cropped_preview.as_ref(),
            unique_hash,
            gpu_processing::RenderRequest {
                adjustments: gpu_adjustments,
                mask_bitmaps: &mask_bitmaps,
                lut,
                roi: None,
            },
            "generate_thumbnail_data",
        ) {
            return Ok(processed_image);
        } else {
            return Ok(cropped_preview.into_owned());
        }
    }

    let mut final_image = if let Some(img) = preloaded_image {
        image_loader::composite_patches_on_image(img, &adjustments)?
    } else {
        match read_file_mapped(&source_path) {
            Ok(mmap) => image_loader::load_and_composite(
                &mmap,
                &source_path_str,
                &adjustments,
                true,
                &settings,
                None,
            )?,
            Err(e) => {
                log::warn!("Fallback read for {}: {}", source_path_str, e);
                let bytes = fs::read(&source_path)?;
                image_loader::load_and_composite(
                    &bytes,
                    &source_path_str,
                    &adjustments,
                    true,
                    &settings,
                    None,
                )?
            }
        }
    };

    if adjustments.is_null() {
        let default_tm = if is_raw {
            settings.default_raw_tonemapper.as_deref().unwrap_or("agx")
        } else {
            settings
                .default_non_raw_tonemapper
                .as_deref()
                .unwrap_or("basic")
        };
        if default_tm == "agx" {
            if !is_raw {
                final_image = crate::image_processing::apply_srgb_to_linear(final_image);
            }
            crate::image_processing::apply_cpu_agx_tonemap(&mut final_image);
        } else if is_raw {
            apply_cpu_default_raw_processing(&mut final_image);
        }
    }

    let fallback_orientation_steps = adjustments["orientationSteps"].as_u64().unwrap_or(0) as u8;
    Ok(apply_coarse_rotation(Cow::Owned(final_image), fallback_orientation_steps).into_owned())
}

fn encode_thumbnail(image: &DynamicImage, target_width: u32) -> Result<Vec<u8>> {
    let thumbnail = crate::image_processing::downscale_f32_image(image, target_width, target_width);
    let mut buf = Cursor::new(Vec::new());
    let mut encoder = JpegEncoder::new_with_quality(&mut buf, 75);
    encoder.encode_image(&thumbnail.to_rgb8())?;
    Ok(buf.into_inner())
}

fn thumbnail_adjustments_bytes(sidecar_path: &Path) -> Vec<u8> {
    fs::read_to_string(sidecar_path)
        .ok()
        .and_then(|content| serde_json::from_str::<ImageMetadata>(&content).ok())
        .and_then(|metadata| serde_json::to_vec(&metadata.adjustments).ok())
        .unwrap_or_default()
}

pub fn get_cached_thumbnail_image(path_str: &str, app_handle: &AppHandle) -> Option<DynamicImage> {
    let (_, sidecar_path) = parse_virtual_path(path_str);
    let cache_hash =
        compute_thumbnail_cache_hash(path_str, &thumbnail_adjustments_bytes(&sidecar_path))?;
    let cache_path = resolve_thumbnail_cache_dir(app_handle)
        .ok()?
        .join(format!("{cache_hash}.jpg"));
    image::open(cache_path).ok()
}

fn generate_single_thumbnail_and_cache(
    path_str: &str,
    thumb_cache_dir: &Path,
    gpu_context: Option<&GpuContext>,
    preloaded_image: Option<&DynamicImage>,
    force_regenerate: bool,
    app_handle: &AppHandle,
    settings: &AppSettings,
) -> Option<(String, u8, bool)> {
    let (source_path, sidecar_path) = parse_virtual_path(path_str);

    let (rating, is_edited, adjustments_bytes) = if is_cloud_placeholder(&sidecar_path) {
        enqueue_metadata(
            app_handle,
            path_str.to_string(),
            source_path.clone(),
            sidecar_path.clone(),
        );
        (0, false, Vec::new())
    } else if let Ok(content) = fs::read_to_string(&sidecar_path) {
        if let Ok(meta) = serde_json::from_str::<ImageMetadata>(&content) {
            let is_raw = crate::formats::is_raw_file(path_str);
            let tm = crate::image_processing::resolve_tonemapper_override(settings, is_raw);

            (
                meta.rating,
                crate::image_processing::is_image_edited(&meta.adjustments, is_raw, tm),
                serde_json::to_vec(&meta.adjustments).unwrap_or_default(),
            )
        } else {
            (0, false, Vec::new())
        }
    } else {
        (0, false, Vec::new())
    };

    let cache_hash = compute_thumbnail_cache_hash(path_str, &adjustments_bytes)?;

    let cache_filename = format!("{}.jpg", cache_hash);
    let cache_path = thumb_cache_dir.join(cache_filename);

    if !force_regenerate && cache_path.exists() {
        return Some((cache_path.to_string_lossy().into_owned(), rating, is_edited));
    }

    if is_cloud_placeholder(&source_path) {
        return None;
    }

    let target_width = settings.thumbnail_resolution.unwrap_or(720);

    // Every adjusted thumbnail must use the same GPU adjustment pipeline as
    // Develop. Callers may pass a context to reuse it across a batch; otherwise
    // initialize the shared application context here so no regeneration path
    // can silently publish the old incomplete CPU fallback.
    let initialized_gpu_context = if gpu_context.is_none() {
        let state = app_handle.state::<AppState>();
        gpu_processing::get_or_init_gpu_context(&state, app_handle).ok()
    } else {
        None
    };
    let gpu_context = gpu_context.or(initialized_gpu_context.as_ref());

    match generate_thumbnail_data(path_str, gpu_context, preloaded_image, app_handle) {
        Ok(thumb_image) => match encode_thumbnail(&thumb_image, target_width) {
            Ok(thumb_data) => {
                if let Err(error) = fs::write(&cache_path, &thumb_data) {
                    log::warn!("Failed to write thumbnail cache for '{path_str}': {error}");
                    return None;
                }
                return Some((cache_path.to_string_lossy().into_owned(), rating, is_edited));
            }
            Err(error) => log::warn!("Failed to encode thumbnail for '{path_str}': {error}"),
        },
        Err(error) => log::warn!("Failed to render thumbnail for '{path_str}': {error}"),
    }
    None
}

fn prefetch_source_file(path_str: &str) {
    let (source_path, _) = parse_virtual_path(path_str);
    #[cfg(target_os = "linux")]
    if let Ok(file) = fs::File::open(&source_path) {
        use std::os::fd::AsRawFd;
        // Trigger OS readahead without allocating and copying an entire RAW
        // file into a temporary userspace buffer that is immediately dropped.
        unsafe {
            libc::posix_fadvise(file.as_raw_fd(), 0, 0, libc::POSIX_FADV_WILLNEED);
        }
    }
    #[cfg(target_os = "macos")]
    if let Ok(file) = fs::File::open(&source_path) {
        use std::os::fd::AsRawFd;
        // F_RDAHEAD is the macOS equivalent: it enables kernel readahead
        // without copying the complete file into a discarded Vec.
        unsafe {
            libc::fcntl(file.as_raw_fd(), libc::F_RDAHEAD, 1);
        }
    }
    #[cfg(not(any(target_os = "linux", target_os = "macos")))]
    let _ = source_path;
}

pub fn start_thumbnail_workers(app_handle: tauri::AppHandle) {
    let state = app_handle.state::<crate::AppState>();
    let manager = state.thumbnail_manager.clone();
    let settings = load_settings(app_handle.clone()).unwrap_or_default();
    let thread_count = settings.thumbnail_worker_threads.unwrap_or(4).clamp(1, 16);

    for worker_index in 0..thread_count {
        let app_clone = app_handle.clone();
        let manager_clone = manager.clone();
        let worker_settings = settings.clone();

        std::thread::spawn(move || {
            loop {
                let (path_to_process, foreground_generation): (String, Option<usize>) = {
                    let mut queue = manager_clone.queue.lock().unwrap();
                    while queue.is_empty()
                        && (worker_index != 0
                            || manager_clone.refresh_queue.lock().unwrap().is_empty())
                    {
                        queue = manager_clone.cvar.wait(queue).unwrap();
                    }
                    let (path, generation) = if let Some(path) = queue.pop_back() {
                        (path, Some(manager_clone.foreground_generation()))
                    } else {
                        // Only one worker services explicit refreshes, leaving
                        // the rest immediately available to the active folder.
                        let path = manager_clone
                            .refresh_queue
                            .lock()
                            .unwrap()
                            .pop_back()
                            .expect("the refresh queue was checked above");
                        (path, None)
                    };

                    let mut processing = manager_clone.processing_now.lock().unwrap();
                    if processing.contains(&path) {
                        let state = app_clone.state::<crate::AppState>();
                        increment_thumbnail_progress(&state, &app_clone);
                        continue;
                    }
                    processing.insert(path.clone());
                    (path, generation)
                };

                let state = app_clone.state::<crate::AppState>();
                let gpu_context =
                    crate::gpu_processing::get_or_init_gpu_context(&state, &app_clone).ok();

                if let Ok(cache_dir) = get_thumb_cache_dir(&app_clone) {
                    if manager_clone.rotational_disk.load(Ordering::Relaxed) {
                        let _io_permit = manager_clone.io_gate.lock().unwrap();
                        prefetch_source_file(&path_to_process);
                    }

                    let result = generate_single_thumbnail_and_cache(
                        &path_to_process,
                        &cache_dir,
                        gpu_context.as_ref(),
                        None,
                        false,
                        &app_clone,
                        &worker_settings,
                    );

                    let may_publish = foreground_generation.is_some_and(|generation| {
                        manager_clone.is_current_foreground_generation(generation)
                    }) || (foreground_generation.is_none()
                        && manager_clone.is_active_path(&path_to_process));
                    if may_publish && let Some((thumbnail_path, rating, is_edited)) = result {
                        emit_thumbnail_generated(
                            &app_clone,
                            &path_to_process,
                            &thumbnail_path,
                            rating,
                            is_edited,
                        );
                    } else if let Some((thumbnail_path, _, _)) = result
                        && let Err(error) = crate::library_catalog::record_thumbnail(
                            &app_clone,
                            &path_to_process,
                            &thumbnail_path,
                        )
                    {
                        log::warn!(
                            "Failed to catalog refreshed thumbnail for '{}': {}",
                            path_to_process,
                            error
                        );
                    }
                    increment_thumbnail_progress(&state, &app_clone);
                }
                manager_clone
                    .processing_now
                    .lock()
                    .unwrap()
                    .remove(&path_to_process);
            }
        });
    }
}

#[tauri::command]
pub fn update_thumbnail_queue(
    paths: Vec<String>,
    context_id: String,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    let state = app_handle.state::<crate::AppState>();

    state.thumbnail_manager.activate_context(context_id);

    let mut queue = state.thumbnail_manager.queue.lock().unwrap();

    if paths.is_empty() {
        state.thumbnail_manager.cvar.notify_all();
        return Ok(());
    }

    let mut unique_paths = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for path in paths {
        if seen.insert(path.clone()) {
            unique_paths.push(path);
        }
    }

    unique_paths.truncate(500);
    state
        .thumbnail_manager
        .register_active_paths(unique_paths.iter().cloned());

    queue.retain(|p| !seen.contains(p));

    while queue.len() + unique_paths.len() > 500 {
        queue.pop_front();
    }

    if state
        .thumbnail_manager
        .rotational_disk
        .load(Ordering::Relaxed)
    {
        unique_paths.sort();
        for path in unique_paths.into_iter().rev() {
            queue.push_back(path);
        }
    } else {
        // Workers pop from the back, so reverse insertion preserves the
        // frontend's visible-first request order.
        for path in unique_paths.into_iter().rev() {
            queue.push_back(path);
        }
    }

    let queue_len = queue.len();
    drop(queue);

    let mut tracker = state.thumbnail_progress.lock().unwrap();
    tracker.total = tracker.completed + queue_len;

    let current = tracker.completed;
    let total = tracker.total;
    drop(tracker);

    let _ = app_handle.emit(
        "thumbnail-progress",
        serde_json::json!({ "current": current, "total": total }),
    );

    state.thumbnail_manager.cvar.notify_all();
    Ok(())
}

#[tauri::command]
pub async fn refresh_folder_thumbnails(
    folder_paths: Vec<String>,
    include_subfolders: bool,
    app_handle: tauri::AppHandle,
) -> Result<usize, String> {
    let (paths, failures) = tauri::async_runtime::spawn_blocking(move || {
        let cancellation_token = AtomicBool::new(false);
        collect_preset_batch_folder_paths(&folder_paths, include_subfolders, &cancellation_token)
    })
    .await
    .map_err(|error| format!("Thumbnail refresh discovery failed: {error}"))?;

    if failures > 0 {
        log::warn!("Thumbnail refresh skipped {failures} inaccessible entries");
    }

    let state = app_handle.state::<crate::AppState>();
    let foreground = state.thumbnail_manager.queue.lock().unwrap();
    let processing = state.thumbnail_manager.processing_now.lock().unwrap();
    let mut refresh_queue = state.thumbnail_manager.refresh_queue.lock().unwrap();
    let already_queued: HashSet<String> = refresh_queue.iter().cloned().collect();
    let mut additions: Vec<String> = paths
        .into_iter()
        .filter(|path| {
            !foreground.contains(path)
                && !processing.contains(path)
                && !already_queued.contains(path)
        })
        .collect();
    additions.sort();
    let added = additions.len();
    refresh_queue.extend(additions.into_iter().rev());
    drop(refresh_queue);
    drop(processing);
    drop(foreground);

    add_to_thumbnail_queue(&state, added, &app_handle);
    state.thumbnail_manager.cvar.notify_all();
    Ok(added)
}

pub fn add_to_thumbnail_queue(state: &AppState, count: usize, app_handle: &AppHandle) {
    let mut tracker = state.thumbnail_progress.lock().unwrap();
    tracker.total += count;
    let current = tracker.completed;
    let total = tracker.total;
    drop(tracker);

    let _ = app_handle.emit(
        "thumbnail-progress",
        serde_json::json!({ "current": current, "total": total }),
    );
}

pub fn increment_thumbnail_progress(state: &AppState, app_handle: &AppHandle) {
    let mut tracker = state.thumbnail_progress.lock().unwrap();
    tracker.completed += 1;
    let current = tracker.completed;
    let total = tracker.total;

    if current >= total {
        tracker.total = 0;
        tracker.completed = 0;
        drop(tracker);

        let _ = app_handle.emit(
            "thumbnail-progress",
            serde_json::json!({ "current": 0, "total": 0 }),
        );
        let _ = app_handle.emit("thumbnail-generation-complete", true);
    } else {
        drop(tracker);
        let _ = app_handle.emit(
            "thumbnail-progress",
            serde_json::json!({ "current": current, "total": total }),
        );
    }
}

fn emit_thumbnail_generated(
    app_handle: &AppHandle,
    path: &str,
    thumbnail_path: &str,
    rating: u8,
    is_edited: bool,
) {
    if let Err(error) = crate::library_catalog::record_thumbnail(app_handle, path, thumbnail_path) {
        eprintln!("Failed to update thumbnail catalog for {path}: {error}");
    }
    let _ = app_handle.emit(
        "thumbnail-generated",
        serde_json::json!({ "path": path, "thumbnailPath": thumbnail_path, "rating": rating, "is_edited": is_edited }),
    );
}

#[tauri::command]
pub async fn regenerate_thumbnails(
    paths: Vec<String>,
    app_handle: AppHandle,
) -> Result<usize, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let settings = load_settings(app_handle.clone()).unwrap_or_default();
        let thumb_cache_dir = resolve_thumbnail_cache_dir(&app_handle)?;
        let mut generated = 0;
        let mut seen = HashSet::new();

        for path in paths {
            if !seen.insert(path.clone()) {
                continue;
            }
            if let Some((thumbnail_path, rating, is_edited)) = generate_single_thumbnail_and_cache(
                &path,
                &thumb_cache_dir,
                None,
                None,
                true,
                &app_handle,
                &settings,
            ) {
                emit_thumbnail_generated(&app_handle, &path, &thumbnail_path, rating, is_edited);
                generated += 1;
            } else {
                log::warn!("Failed to regenerate thumbnail for '{path}'");
            }
            thread::yield_now();
        }

        Ok(generated)
    })
    .await
    .map_err(|error| format!("Thumbnail regeneration task failed: {error}"))?
}

pub fn resolve_lens_params_in_adjustments(
    adjustments: &mut Value,
    exif_data: &Option<HashMap<String, String>>,
    lens_db: Option<&crate::lens_correction::LensDatabase>,
) {
    if let Some(map) = adjustments.as_object_mut() {
        let mode = map
            .get("lensCorrectionMode")
            .and_then(|v| v.as_str())
            .unwrap_or("manual");

        if mode == "auto" {
            if let Some(exif) = exif_data {
                let exif_maker = exif.get("Make").map(|s| s.as_str()).unwrap_or("");
                let exif_model = exif.get("LensModel").map(|s| s.as_str()).unwrap_or("");
                if let Some(db) = lens_db {
                    if let Some((detected_maker, detected_model)) =
                        crate::lens_correction::find_best_lens_match(db, exif_maker, exif_model)
                    {
                        map.insert(
                            "lensMaker".to_string(),
                            serde_json::to_value(&detected_maker).unwrap(),
                        );
                        map.insert(
                            "lensModel".to_string(),
                            serde_json::to_value(&detected_model).unwrap(),
                        );
                    } else {
                        map.remove("lensMaker");
                        map.remove("lensModel");
                    }
                }
            } else {
                map.remove("lensMaker");
                map.remove("lensModel");
            }
        }

        if let Some(db) = lens_db {
            let has_valid_lens = match (
                map.get("lensMaker").and_then(|v| v.as_str()),
                map.get("lensModel").and_then(|v| v.as_str()),
            ) {
                (Some(maker), Some(model)) if !maker.is_empty() && !model.is_empty() => {
                    let mut focal_length = 50.0;
                    let mut aperture = None;
                    let mut distance = None;

                    if let Some(exif) = exif_data {
                        if let Some(fl_str) = exif
                            .get("FocalLength")
                            .or(exif.get("FocalLengthIn35mmFilm"))
                            && let Ok(fl) = fl_str.replace(" mm", "").trim().parse::<f32>()
                        {
                            focal_length = fl;
                        }
                        if let Some(ap_str) = exif.get("ApertureValue").or(exif.get("FNumber"))
                            && let Ok(ap) = ap_str.replace("f/", "").trim().parse::<f32>()
                        {
                            aperture = Some(ap);
                        }
                        if let Some(dist_str) = exif.get("SubjectDistance")
                            && let Ok(dist) = dist_str.replace(" m", "").trim().parse::<f32>()
                        {
                            distance = Some(dist);
                        }
                    }

                    if let Some(params) = crate::lens_correction::resolve_lens_params(
                        db,
                        maker,
                        model,
                        focal_length,
                        aperture,
                        distance,
                    ) {
                        map.insert(
                            "lensDistortionParams".to_string(),
                            serde_json::to_value(params).unwrap(),
                        );
                        true
                    } else {
                        false
                    }
                }
                _ => false,
            };

            if !has_valid_lens {
                map.remove("lensDistortionParams");
            }
        }
    }
}

#[tauri::command]
pub fn get_supported_file_types() -> Result<serde_json::Value, String> {
    let raw_extensions: Vec<&str> = crate::formats::RAW_EXTENSIONS
        .iter()
        .map(|(ext, _)| *ext)
        .collect();
    let non_raw_extensions: Vec<&str> = crate::formats::NON_RAW_EXTENSIONS.to_vec();

    Ok(serde_json::json!({
        "raw": raw_extensions,
        "nonRaw": non_raw_extensions
    }))
}

#[tauri::command]
pub fn create_folder(path: String) -> Result<(), String> {
    let path_obj = Path::new(&path);
    if let (Some(parent), Some(new_folder_name_os)) = (path_obj.parent(), path_obj.file_name())
        && let Some(new_folder_name) = new_folder_name_os.to_str()
        && parent.exists()
    {
        for entry in fs::read_dir(parent).map_err(|e| e.to_string())? {
            if let Ok(entry) = entry
                && entry.file_name().to_string_lossy().to_lowercase()
                    == new_folder_name.to_lowercase()
            {
                return Err("A folder with that name already exists.".to_string());
            }
        }
    }
    fs::create_dir_all(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn rename_folder(path: String, new_name: String, app_handle: AppHandle) -> Result<(), String> {
    let p = Path::new(&path);
    if !p.is_dir() {
        return Err("Path is not a directory.".to_string());
    }
    if let Some(parent) = p.parent() {
        for entry in fs::read_dir(parent).map_err(|e| e.to_string())? {
            if let Ok(entry) = entry
                && entry.file_name().to_string_lossy().to_lowercase() == new_name.to_lowercase()
                && entry.path() != p
            {
                return Err("A folder with that name already exists.".to_string());
            }
        }
        let new_path = parent.join(&new_name);
        fs::rename(p, &new_path).map_err(|e| e.to_string())?;

        let new_folder_str = new_path.to_string_lossy().into_owned();
        sync_album_path_changes(&app_handle, None, None, Some((&path, &new_folder_str)));

        Ok(())
    } else {
        Err("Could not determine parent directory.".to_string())
    }
}

#[tauri::command]
pub fn delete_folder(path: String, app_handle: AppHandle) -> Result<(), String> {
    #[cfg(any(target_os = "windows", target_os = "macos", target_os = "linux"))]
    {
        if let Err(trash_error) = trash::delete(&path) {
            log::warn!(
                "Failed to move folder to trash: {}. Falling back to permanent delete.",
                trash_error
            );
            fs::remove_dir_all(&path).map_err(|e| e.to_string())?;
        }
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        fs::remove_dir_all(&path).map_err(|e| e.to_string())?;
    }

    let mut deletions = HashSet::new();
    deletions.insert(path);
    sync_album_path_changes(&app_handle, None, Some(&deletions), None);

    Ok(())
}

#[tauri::command]
pub fn duplicate_file(
    path: String,
    target_album_id: Option<String>,
    copy_name_suffix: Option<String>,
    app_handle: AppHandle,
) -> Result<String, String> {
    let (source_path, source_sidecar_path) = parse_virtual_path(&path);
    if !source_path.is_file() {
        return Err("Source path is not a file.".to_string());
    }

    let parent = source_path
        .parent()
        .ok_or("Could not get parent directory")?;
    let stem = source_path
        .file_stem()
        .and_then(|s| s.to_str())
        .ok_or("Could not get file stem")?;
    let extension = source_path
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("");

    let mut counter = 1;
    let mut dest_path;
    let configured_suffix = copy_name_suffix
        .as_deref()
        .map(sanitize_filename_suffix)
        .filter(|suffix| !suffix.is_empty());
    loop {
        let base_stem = if let Some(suffix) = &configured_suffix {
            format!("{}{}", stem, suffix)
        } else {
            format!("{}_copy", stem)
        };
        let new_stem = if counter == 1 {
            base_stem
        } else {
            format!("{}_{}", base_stem, counter - 1)
        };
        dest_path = parent.join(format!("{}.{}", new_stem, extension));
        if !dest_path.exists() {
            break;
        }
        counter += 1;
    }

    fs::copy(&source_path, &dest_path).map_err(|e| e.to_string())?;

    if source_sidecar_path.exists()
        && let Some(dest_str) = dest_path.to_str()
    {
        let (_, dest_sidecar_path) = parse_virtual_path(dest_str);
        fs::copy(&source_sidecar_path, &dest_sidecar_path).map_err(|e| e.to_string())?;
    }

    let dest_path_str = dest_path.to_string_lossy().into_owned();

    if let Some(album_id) = target_album_id {
        let _ = add_to_album(album_id, vec![dest_path_str.clone()], app_handle);
    }

    Ok(dest_path_str)
}

fn find_all_associated_files(source_image_path: &Path) -> Result<Vec<PathBuf>, String> {
    let mut associated_files = vec![source_image_path.to_path_buf()];

    let parent_dir = source_image_path
        .parent()
        .ok_or("Could not determine parent directory")?;
    let source_filename = source_image_path
        .file_name()
        .ok_or("Could not get source filename")?
        .to_string_lossy();

    let primary_sidecar_name = format!("{}.tirdata", source_filename);
    let virtual_copy_prefix = format!("{}.", source_filename);

    if let Ok(entries) = fs::read_dir(parent_dir) {
        for entry in entries.filter_map(Result::ok) {
            let entry_path = entry.path();
            if !entry_path.is_file() {
                continue;
            }

            let entry_os_filename = entry.file_name();
            let entry_filename = entry_os_filename.to_string_lossy();

            if entry_filename == primary_sidecar_name
                || (entry_filename.starts_with(&virtual_copy_prefix)
                    && entry_filename.ends_with(".tirdata"))
            {
                associated_files.push(entry_path);
            }
        }
    }

    Ok(associated_files)
}

#[tauri::command]
pub fn copy_files(source_paths: Vec<String>, destination_folder: String) -> Result<(), String> {
    let dest_path = Path::new(&destination_folder);
    if !dest_path.is_dir() {
        return Err(format!(
            "Destination is not a folder: {}",
            destination_folder
        ));
    }

    let unique_source_images: HashSet<PathBuf> = source_paths
        .iter()
        .map(|p| parse_virtual_path(p).0)
        .collect();

    for source_image_path in unique_source_images {
        let all_files_to_copy = find_all_associated_files(&source_image_path)?;

        let source_parent = source_image_path
            .parent()
            .ok_or("Could not get parent directory")?;
        if source_parent == dest_path {
            let stem = source_image_path
                .file_stem()
                .and_then(|s| s.to_str())
                .ok_or("Could not get file stem")?;
            let extension = source_image_path
                .extension()
                .and_then(|s| s.to_str())
                .unwrap_or("");

            let mut counter = 1;
            let new_base_path = loop {
                let new_stem = format!("{}_copy_{}", stem, counter);
                let temp_path = source_parent.join(format!("{}.{}", new_stem, extension));
                if !temp_path.exists() {
                    break temp_path;
                }
                counter += 1;
            };
            let new_filename = new_base_path.file_name().unwrap().to_string_lossy();

            for original_file in all_files_to_copy {
                let original_full_filename = original_file.file_name().unwrap().to_string_lossy();
                let source_base_filename = source_image_path.file_name().unwrap().to_string_lossy();
                let new_dest_filename =
                    original_full_filename.replacen(&*source_base_filename, &new_filename, 1);
                let final_dest_path = dest_path.join(new_dest_filename);

                fs::copy(&original_file, &final_dest_path).map_err(|e| e.to_string())?;
            }
        } else {
            for file_to_copy in all_files_to_copy {
                if let Some(file_name) = file_to_copy.file_name() {
                    let dest_file_path = dest_path.join(file_name);
                    fs::copy(&file_to_copy, &dest_file_path).map_err(|e| e.to_string())?;
                }
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub fn move_files(
    source_paths: Vec<String>,
    destination_folder: String,
    app_handle: AppHandle,
) -> Result<(), String> {
    let dest_path = Path::new(&destination_folder);
    if !dest_path.is_dir() {
        return Err(format!(
            "Destination is not a folder: {}",
            destination_folder
        ));
    }

    let unique_source_images: HashSet<PathBuf> = source_paths
        .iter()
        .map(|p| parse_virtual_path(p).0)
        .collect();

    let mut all_files_to_trash = Vec::new();
    let mut renames = HashMap::new();

    for source_image_path in unique_source_images {
        let source_parent = source_image_path
            .parent()
            .ok_or("Could not get parent directory")?;
        if source_parent == dest_path {
            return Err("Cannot move files into the same folder they are already in.".to_string());
        }

        let files_to_move = find_all_associated_files(&source_image_path)?;

        for file_to_move in &files_to_move {
            if let Some(file_name) = file_to_move.file_name() {
                let dest_file_path = dest_path.join(file_name);
                if dest_file_path.exists() {
                    return Err(format!(
                        "File already exists at destination: {}",
                        dest_file_path.display()
                    ));
                }
            }
        }

        for file_to_move in &files_to_move {
            if let Some(file_name) = file_to_move.file_name() {
                let dest_file_path = dest_path.join(file_name);
                fs::copy(file_to_move, &dest_file_path).map_err(|e| e.to_string())?;
            }
        }

        let dest_image_path = dest_path.join(source_image_path.file_name().unwrap());
        renames.insert(
            source_image_path.to_string_lossy().into_owned(),
            dest_image_path.to_string_lossy().into_owned(),
        );

        all_files_to_trash.extend(files_to_move);
    }

    #[cfg(any(target_os = "windows", target_os = "macos", target_os = "linux"))]
    if !all_files_to_trash.is_empty()
        && let Err(trash_error) = trash::delete_all(&all_files_to_trash)
    {
        log::warn!(
            "Failed to move source files to trash: {}. Falling back to permanent delete.",
            trash_error
        );
        for path in all_files_to_trash {
            if path.is_file() {
                fs::remove_file(&path).map_err(|e| {
                    format!("Failed to delete source file {}: {}", path.display(), e)
                })?;
            }
        }
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    for path in all_files_to_trash {
        if path.is_file() {
            fs::remove_file(&path)
                .map_err(|e| format!("Failed to delete source file {}: {}", path.display(), e))?;
        }
    }

    sync_album_path_changes(&app_handle, Some(&renames), None, None);

    Ok(())
}

#[tauri::command]
pub fn save_metadata_and_update_thumbnail(
    path: String,
    adjustments: Value,
    app_handle: AppHandle,
    state: tauri::State<AppState>,
) -> Result<(), String> {
    let (source_path, sidecar_path) = parse_virtual_path(&path);

    let mut metadata = crate::exif_processing::load_sidecar(&sidecar_path);

    let mut final_adjustments = adjustments;
    {
        let lens_db_guard = state.lens_db.lock().unwrap();
        resolve_lens_params_in_adjustments(
            &mut final_adjustments,
            &metadata.exif,
            lens_db_guard.as_deref(),
        );
    }

    metadata.adjustments = final_adjustments;

    let json_string = serde_json::to_string_pretty(&metadata).map_err(|e| e.to_string())?;
    std::fs::write(&sidecar_path, json_string).map_err(|e| e.to_string())?;

    if let Ok(settings) = load_settings(app_handle.clone())
        && settings.enable_xmp_sync.unwrap_or(false)
    {
        let create_if_missing = settings.create_xmp_if_missing.unwrap_or(false);
        sync_metadata_to_xmp(
            &source_path,
            &metadata,
            create_if_missing,
            !path.contains("?vc="),
        );
    }

    let loaded_image_lock = state.original_image.lock().unwrap();
    let preloaded_image_option = if let Some(loaded_image) = loaded_image_lock.as_ref() {
        if loaded_image.path == path {
            Some(loaded_image.image.clone())
        } else {
            None
        }
    } else {
        None
    };
    drop(loaded_image_lock);

    let gpu_context = gpu_processing::get_or_init_gpu_context(&state, &app_handle).ok();
    let app_handle_clone = app_handle.clone();
    let path_clone = path.clone();
    let live_update_generation = state.thumbnail_manager.begin_live_update(&path);

    add_to_thumbnail_queue(&state, 1, &app_handle);

    thread::spawn(move || {
        let state = app_handle_clone.state::<AppState>();

        // Slider changes can autosave faster than a thumbnail can be rendered.
        // Briefly coalesce them and let only the newest update for this image
        // consume rendering resources or publish a grid thumbnail.
        thread::sleep(std::time::Duration::from_millis(250));
        if !state
            .thumbnail_manager
            .is_latest_live_update(&path_clone, live_update_generation)
        {
            increment_thumbnail_progress(&state, &app_handle_clone);
            return;
        }

        let settings = load_settings(app_handle_clone.clone()).unwrap_or_default();

        let thumb_cache_dir = match resolve_thumbnail_cache_dir(&app_handle_clone) {
            Ok(dir) => dir,
            Err(e) => {
                log::warn!(
                    "Unable to initialize thumbnail cache directory for '{}': {}",
                    path_clone,
                    e
                );
                emit_thumbnail_cache_setup_error(&app_handle_clone, &path_clone, &e);
                state
                    .thumbnail_manager
                    .finish_live_update(&path_clone, live_update_generation);
                increment_thumbnail_progress(&state, &app_handle_clone);
                return;
            }
        };

        let result = generate_single_thumbnail_and_cache(
            &path_clone,
            &thumb_cache_dir,
            gpu_context.as_ref(),
            preloaded_image_option.as_deref(),
            true,
            &app_handle_clone,
            &settings,
        );

        if state
            .thumbnail_manager
            .is_latest_live_update(&path_clone, live_update_generation)
            && let Some((thumbnail_path, rating, is_edited)) = result
        {
            emit_thumbnail_generated(
                &app_handle_clone,
                &path_clone,
                &thumbnail_path,
                rating,
                is_edited,
            );
        }

        state
            .thumbnail_manager
            .finish_live_update(&path_clone, live_update_generation);

        increment_thumbnail_progress(&state, &app_handle_clone);
    });

    Ok(())
}

#[tauri::command]
pub async fn apply_adjustments_to_paths(
    paths: Vec<String>,
    adjustments: Value,
    app_handle: AppHandle,
) -> Result<(), String> {
    let state = app_handle.state::<AppState>();
    add_to_thumbnail_queue(&state, paths.len(), &app_handle);

    tauri::async_runtime::spawn_blocking(move || {
        let settings = load_settings(app_handle.clone()).unwrap_or_default();
        let enable_xmp_sync = settings.enable_xmp_sync.unwrap_or(false);
        let create_xmp_if_missing = settings.create_xmp_if_missing.unwrap_or(false);

        let lens_db = app_handle
            .state::<AppState>()
            .lens_db
            .lock()
            .unwrap()
            .clone();

        paths.par_iter().for_each(|path| {
            let (_, sidecar_path) = parse_virtual_path(path);

            let mut existing_metadata = crate::exif_processing::load_sidecar(&sidecar_path);

            let mut new_adjustments = existing_metadata.adjustments;
            if new_adjustments.is_null() {
                new_adjustments = serde_json::json!({});
            }

            if let (Some(new_map), Some(pasted_map)) =
                (new_adjustments.as_object_mut(), adjustments.as_object())
            {
                for (k, v) in pasted_map {
                    new_map.insert(k.clone(), v.clone());
                }
            }

            resolve_lens_params_in_adjustments(
                &mut new_adjustments,
                &existing_metadata.exif,
                lens_db.as_deref(),
            );

            existing_metadata.adjustments = new_adjustments;

            if let Ok(json_string) = serde_json::to_string_pretty(&existing_metadata) {
                let _ = std::fs::write(&sidecar_path, json_string);
            }

            if enable_xmp_sync {
                let source_path = parse_virtual_path(path).0;
                sync_metadata_to_xmp(
                    &source_path,
                    &existing_metadata,
                    create_xmp_if_missing,
                    !path.contains("?vc="),
                );
            }
        });

        let state = app_handle.state::<AppState>();
        let thumb_cache_dir = match resolve_thumbnail_cache_dir(&app_handle) {
            Ok(dir) => dir,
            Err(e) => {
                log::warn!("Unable to initialize thumbnail cache directory: {}", e);
                for path in &paths {
                    emit_thumbnail_cache_setup_error(&app_handle, path, &e);
                }
                for _ in 0..paths.len() {
                    increment_thumbnail_progress(&state, &app_handle);
                }
                return;
            }
        };

        let gpu_context = gpu_processing::get_or_init_gpu_context(&state, &app_handle).ok();

        paths.par_iter().for_each(|path_str| {
            let result = generate_single_thumbnail_and_cache(
                path_str,
                &thumb_cache_dir,
                gpu_context.as_ref(),
                None,
                true,
                &app_handle,
                &settings,
            );

            if let Some((thumbnail_path, rating, is_edited)) = result {
                emit_thumbnail_generated(&app_handle, path_str, &thumbnail_path, rating, is_edited);
            }

            increment_thumbnail_progress(&state, &app_handle);
        });
    });

    Ok(())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyPresetBatchRequest {
    paths: Vec<String>,
    folders: Vec<String>,
    include_subfolders: bool,
    adjustments: Value,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PresetBatchProgress {
    job_id: String,
    stage: &'static str,
    current: usize,
    total: usize,
    failed: usize,
    cancelled: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PresetBatchResult {
    job_id: String,
    applied: usize,
    failed: usize,
    total: usize,
    cancelled: bool,
}

fn emit_preset_batch_progress(app_handle: &AppHandle, progress: PresetBatchProgress) {
    let _ = app_handle.emit("preset-batch-progress", progress);
}

fn collect_preset_batch_folder_paths(
    folders: &[String],
    include_subfolders: bool,
    cancellation_token: &AtomicBool,
) -> (HashSet<String>, usize) {
    let mut physical_images = HashSet::new();
    let mut sidecars_by_path: HashMap<PathBuf, Vec<Option<String>>> = HashMap::new();
    let mut failed = 0;

    for folder in folders {
        if cancellation_token.load(Ordering::Relaxed) {
            break;
        }
        let folder_path = Path::new(folder);
        if !folder_path.is_dir() {
            failed += 1;
            continue;
        }

        let max_depth = if include_subfolders { usize::MAX } else { 1 };
        for entry in WalkDir::new(folder_path)
            .min_depth(1)
            .max_depth(max_depth)
            .follow_links(false)
        {
            if cancellation_token.load(Ordering::Relaxed) {
                break;
            }
            let entry = match entry {
                Ok(entry) => entry,
                Err(_) => {
                    failed += 1;
                    continue;
                }
            };
            if !entry.file_type().is_file() {
                continue;
            }

            let entry_path = entry.path();
            let file_name = entry.file_name().to_string_lossy();
            if let Some((source_filename, copy_id)) = parse_sidecar_filename(&file_name) {
                if let Some(parent) = entry_path.parent() {
                    sidecars_by_path
                        .entry(parent.join(source_filename))
                        .or_default()
                        .push(copy_id);
                }
            } else if is_supported_image_file(entry_path.to_string_lossy().as_ref()) {
                physical_images.insert(entry_path.to_path_buf());
            }
        }
    }

    let mut paths = HashSet::new();
    for image_path in physical_images {
        let image_path_string = image_path.to_string_lossy().into_owned();
        paths.insert(image_path_string.clone());
        if let Some(sidecars) = sidecars_by_path.remove(&image_path) {
            for copy_id in sidecars.into_iter().flatten() {
                paths.insert(format!("{image_path_string}?vc={copy_id}"));
            }
        }
    }

    (paths, failed)
}

fn apply_preset_adjustments_to_path(
    path: &str,
    adjustments: &Value,
    settings: &AppSettings,
    lens_db: Option<&crate::lens_correction::LensDatabase>,
) -> Result<(), String> {
    let (source_path, sidecar_path) = parse_virtual_path(path);
    if !source_path.is_file() || !is_supported_image_file(source_path.to_string_lossy().as_ref()) {
        return Err(format!(
            "Image is unavailable or unsupported: {}",
            source_path.display()
        ));
    }
    let mut existing_metadata = crate::exif_processing::load_sidecar(&sidecar_path);
    if existing_metadata.adjustments.is_null() {
        existing_metadata.adjustments = serde_json::json!({});
    }

    let existing_map = existing_metadata
        .adjustments
        .as_object_mut()
        .ok_or_else(|| format!("Invalid adjustments in {}", sidecar_path.display()))?;
    let preset_map = adjustments
        .as_object()
        .ok_or_else(|| "Preset adjustments must be an object".to_string())?;
    for (key, value) in preset_map {
        existing_map.insert(key.clone(), value.clone());
    }

    resolve_lens_params_in_adjustments(
        &mut existing_metadata.adjustments,
        &existing_metadata.exif,
        lens_db,
    );
    let json_string =
        serde_json::to_string_pretty(&existing_metadata).map_err(|error| error.to_string())?;
    fs::write(&sidecar_path, json_string)
        .map_err(|error| format!("Failed to write {}: {error}", sidecar_path.display()))?;

    if settings.enable_xmp_sync.unwrap_or(false) {
        sync_metadata_to_xmp(
            &source_path,
            &existing_metadata,
            settings.create_xmp_if_missing.unwrap_or(false),
            !path.contains("?vc="),
        );
    }
    Ok(())
}

#[tauri::command]
pub async fn apply_preset_batch(
    request: ApplyPresetBatchRequest,
    app_handle: AppHandle,
) -> Result<PresetBatchResult, String> {
    if !request.adjustments.is_object() {
        return Err("Preset adjustments must be an object".to_string());
    }

    let state = app_handle.state::<AppState>();
    let cancellation_token = {
        let mut active_token = state.preset_batch_task_token.lock().unwrap();
        if active_token.is_some() {
            return Err("A preset batch is already running".to_string());
        }
        let token = Arc::new(AtomicBool::new(false));
        *active_token = Some(token.clone());
        token
    };
    let task_token = state.preset_batch_task_token.clone();
    let job_id = Uuid::new_v4().to_string();
    let task_job_id = job_id.clone();
    let task_app_handle = app_handle.clone();

    let task = tauri::async_runtime::spawn_blocking(move || {
        emit_preset_batch_progress(
            &task_app_handle,
            PresetBatchProgress {
                job_id: task_job_id.clone(),
                stage: "discovering",
                current: 0,
                total: 0,
                failed: 0,
                cancelled: false,
            },
        );

        let mut paths: HashSet<String> = request.paths.into_iter().collect();
        let (folder_paths, discovery_failed) = collect_preset_batch_folder_paths(
            &request.folders,
            request.include_subfolders,
            &cancellation_token,
        );
        paths.extend(folder_paths);
        let mut paths: Vec<String> = paths.into_iter().collect();
        paths.sort();
        let total = paths.len();
        let settings = load_settings(task_app_handle.clone()).unwrap_or_default();
        let lens_db = task_app_handle
            .state::<AppState>()
            .lens_db
            .lock()
            .unwrap()
            .clone();
        let thumb_cache_dir = (total > 0)
            .then(|| resolve_thumbnail_cache_dir(&task_app_handle))
            .transpose()?;
        let mut applied = 0;
        let mut process_failed = 0;

        for path in paths {
            if cancellation_token.load(Ordering::Relaxed) {
                break;
            }
            match apply_preset_adjustments_to_path(
                &path,
                &request.adjustments,
                &settings,
                lens_db.as_deref(),
            ) {
                Ok(()) => {
                    applied += 1;
                    let _ = task_app_handle.emit(
                        "preset-batch-image-applied",
                        serde_json::json!({ "path": path }),
                    );
                    if let Some((thumbnail_path, rating, is_edited)) =
                        generate_single_thumbnail_and_cache(
                            &path,
                            thumb_cache_dir
                                .as_deref()
                                .expect("non-empty batches have a cache directory"),
                            None,
                            None,
                            true,
                            &task_app_handle,
                            &settings,
                        )
                    {
                        emit_thumbnail_generated(
                            &task_app_handle,
                            &path,
                            &thumbnail_path,
                            rating,
                            is_edited,
                        );
                    }
                }
                Err(error) => {
                    process_failed += 1;
                    log::warn!("Failed to apply preset to '{}': {}", path, error);
                }
            }

            emit_preset_batch_progress(
                &task_app_handle,
                PresetBatchProgress {
                    job_id: task_job_id.clone(),
                    stage: "applying",
                    current: applied + process_failed,
                    total,
                    failed: discovery_failed + process_failed,
                    cancelled: false,
                },
            );
            thread::yield_now();
        }

        let cancelled = cancellation_token.load(Ordering::Relaxed);
        let failed = discovery_failed + process_failed;
        emit_preset_batch_progress(
            &task_app_handle,
            PresetBatchProgress {
                job_id: task_job_id.clone(),
                stage: "complete",
                current: applied + process_failed,
                total,
                failed,
                cancelled,
            },
        );
        Ok(PresetBatchResult {
            job_id: task_job_id,
            applied,
            failed,
            total,
            cancelled,
        })
    })
    .await;
    *task_token.lock().unwrap() = None;
    task.map_err(|error| format!("Preset batch task failed: {error}"))?
}

#[tauri::command]
pub fn cancel_preset_batch(app_handle: AppHandle) -> bool {
    let state = app_handle.state::<AppState>();
    let active_token = state.preset_batch_task_token.lock().unwrap();
    if let Some(token) = active_token.as_ref() {
        !token.swap(true, Ordering::Relaxed)
    } else {
        false
    }
}

#[tauri::command]
pub async fn reset_adjustments_for_paths(
    paths: Vec<String>,
    app_handle: AppHandle,
) -> Result<(), String> {
    let state = app_handle.state::<AppState>();
    add_to_thumbnail_queue(&state, paths.len(), &app_handle);

    tauri::async_runtime::spawn_blocking(move || {
        let settings = load_settings(app_handle.clone()).unwrap_or_default();
        let enable_xmp_sync = settings.enable_xmp_sync.unwrap_or(false);
        let create_xmp_if_missing = settings.create_xmp_if_missing.unwrap_or(false);

        paths.par_iter().for_each(|path| {
            let (_, sidecar_path) = parse_virtual_path(path);

            let mut existing_metadata = crate::exif_processing::load_sidecar(&sidecar_path);

            existing_metadata.adjustments = serde_json::json!({});

            if let Ok(json_string) = serde_json::to_string_pretty(&existing_metadata) {
                let _ = std::fs::write(&sidecar_path, json_string);
            }

            if enable_xmp_sync {
                let source_path = parse_virtual_path(path).0;
                sync_metadata_to_xmp(
                    &source_path,
                    &existing_metadata,
                    create_xmp_if_missing,
                    !path.contains("?vc="),
                );
            }
        });

        let state = app_handle.state::<AppState>();
        let thumb_cache_dir = match resolve_thumbnail_cache_dir(&app_handle) {
            Ok(dir) => dir,
            Err(e) => {
                log::warn!("Unable to initialize thumbnail cache directory: {}", e);
                for path in &paths {
                    emit_thumbnail_cache_setup_error(&app_handle, path, &e);
                }
                for _ in 0..paths.len() {
                    increment_thumbnail_progress(&state, &app_handle);
                }
                return;
            }
        };

        let gpu_context = gpu_processing::get_or_init_gpu_context(&state, &app_handle).ok();

        paths.par_iter().for_each(|path_str| {
            let result = generate_single_thumbnail_and_cache(
                path_str,
                &thumb_cache_dir,
                gpu_context.as_ref(),
                None,
                true,
                &app_handle,
                &settings,
            );

            if let Some((thumbnail_path, rating, is_edited)) = result {
                emit_thumbnail_generated(&app_handle, path_str, &thumbnail_path, rating, is_edited);
            }

            increment_thumbnail_progress(&state, &app_handle);
        });
    });

    Ok(())
}

#[tauri::command]
pub async fn apply_auto_adjustments_to_paths(
    paths: Vec<String>,
    app_handle: AppHandle,
) -> Result<(), String> {
    let state = app_handle.state::<AppState>();
    add_to_thumbnail_queue(&state, paths.len(), &app_handle);

    tauri::async_runtime::spawn_blocking(move || {
        let settings = load_settings(app_handle.clone()).unwrap_or_default();
        let enable_xmp_sync = settings.enable_xmp_sync.unwrap_or(false);
        let create_xmp_if_missing = settings.create_xmp_if_missing.unwrap_or(false);

        let state = app_handle.state::<AppState>();
        let thumb_cache_dir = match resolve_thumbnail_cache_dir(&app_handle) {
            Ok(dir) => dir,
            Err(e) => {
                log::warn!("Unable to initialize thumbnail cache directory: {}", e);
                for path in &paths {
                    emit_thumbnail_cache_setup_error(&app_handle, path, &e);
                }
                for _ in 0..paths.len() {
                    increment_thumbnail_progress(&state, &app_handle);
                }
                return;
            }
        };

        let gpu_context = gpu_processing::get_or_init_gpu_context(&state, &app_handle).ok();

        paths.par_iter().for_each(|path| {
            let loaded_image: Option<DynamicImage> = (|| -> Result<DynamicImage, String> {
                let (source_path, sidecar_path) = parse_virtual_path(path);
                let source_path_str = source_path.to_string_lossy().to_string();

                let file_bytes = fs::read(&source_path).map_err(|e| e.to_string())?;
                let image = image_loader::load_base_image_from_bytes(
                    &file_bytes,
                    &source_path_str,
                    true,
                    &settings,
                    None,
                )
                .map_err(|e| e.to_string())?;

                let auto_results = perform_auto_analysis(&image);
                let auto_adjustments_json = auto_results_to_json(&auto_results);

                let mut existing_metadata = crate::exif_processing::load_sidecar(&sidecar_path);

                if existing_metadata.adjustments.is_null() {
                    existing_metadata.adjustments = serde_json::json!({});
                }

                if let (Some(existing_map), Some(auto_map)) = (
                    existing_metadata.adjustments.as_object_mut(),
                    auto_adjustments_json.as_object(),
                ) {
                    for (k, v) in auto_map {
                        if k == "sectionVisibility" {
                            if let Some(existing_vis_val) = existing_map.get_mut(k) {
                                if let (Some(existing_vis), Some(auto_vis)) =
                                    (existing_vis_val.as_object_mut(), v.as_object())
                                {
                                    for (vis_k, vis_v) in auto_vis {
                                        existing_vis.insert(vis_k.clone(), vis_v.clone());
                                    }
                                }
                            } else {
                                existing_map.insert(k.clone(), v.clone());
                            }
                        } else {
                            existing_map.insert(k.clone(), v.clone());
                        }
                    }
                }

                if let Ok(json_string) = serde_json::to_string_pretty(&existing_metadata) {
                    let _ = std::fs::write(&sidecar_path, json_string);
                }

                if enable_xmp_sync {
                    sync_metadata_to_xmp(
                        &source_path,
                        &existing_metadata,
                        create_xmp_if_missing,
                        !path.contains("?vc="),
                    );
                }
                Ok(image)
            })()
            .map_err(|e| eprintln!("Failed to apply auto adjustments to {}: {}", path, e))
            .ok();

            let result = generate_single_thumbnail_and_cache(
                path,
                &thumb_cache_dir,
                gpu_context.as_ref(),
                loaded_image.as_ref(),
                true,
                &app_handle,
                &settings,
            );

            if let Some((thumbnail_path, rating, is_edited)) = result {
                emit_thumbnail_generated(&app_handle, path, &thumbnail_path, rating, is_edited);
            }

            increment_thumbnail_progress(&state, &app_handle);
        });
    });

    Ok(())
}

#[tauri::command]
pub fn set_color_label_for_paths(
    paths: Vec<String>,
    color: Option<String>,
    app_handle: AppHandle,
) -> Result<(), String> {
    let settings = load_settings(app_handle.clone()).unwrap_or_default();
    let enable_xmp_sync = settings.enable_xmp_sync.unwrap_or(false);
    let create_xmp_if_missing = settings.create_xmp_if_missing.unwrap_or(false);

    paths.par_iter().for_each(|path| {
        let (_, sidecar_path) = parse_virtual_path(path);

        let mut metadata = crate::exif_processing::load_sidecar(&sidecar_path);

        let mut tags = metadata.tags.unwrap_or_default();
        tags.retain(|tag| !tag.starts_with(COLOR_TAG_PREFIX));

        if let Some(c) = &color
            && !c.is_empty()
        {
            tags.push(format!("{}{}", COLOR_TAG_PREFIX, c));
        }

        if tags.is_empty() {
            metadata.tags = None;
        } else {
            metadata.tags = Some(tags);
        }

        if let Ok(json_string) = serde_json::to_string_pretty(&metadata) {
            let _ = std::fs::write(&sidecar_path, json_string);
        }

        if enable_xmp_sync {
            let source_path = parse_virtual_path(path).0;
            sync_metadata_to_xmp(
                &source_path,
                &metadata,
                create_xmp_if_missing,
                !path.contains("?vc="),
            );
        }
    });

    Ok(())
}

#[tauri::command]
pub fn set_rating_for_paths(
    paths: Vec<String>,
    rating: u8,
    app_handle: AppHandle,
) -> Result<(), String> {
    let settings = load_settings(app_handle.clone()).unwrap_or_default();
    let enable_xmp_sync = settings.enable_xmp_sync.unwrap_or(false);
    let create_xmp_if_missing = settings.create_xmp_if_missing.unwrap_or(false);

    paths.par_iter().for_each(|path| {
        let (_, sidecar_path) = parse_virtual_path(path);

        let mut metadata = crate::exif_processing::load_sidecar(&sidecar_path);

        metadata.rating = rating;

        if let Ok(json_string) = serde_json::to_string_pretty(&metadata) {
            let _ = std::fs::write(&sidecar_path, json_string);
        }

        if enable_xmp_sync {
            let source_path = parse_virtual_path(path).0;
            sync_metadata_to_xmp(
                &source_path,
                &metadata,
                create_xmp_if_missing,
                !path.contains("?vc="),
            );
        }
    });

    Ok(())
}

#[tauri::command]
pub fn load_metadata(path: String, app_handle: AppHandle) -> Result<ImageMetadata, String> {
    let settings = load_settings(app_handle).unwrap_or_default();
    let enable_xmp_sync = settings.enable_xmp_sync.unwrap_or(false);

    let (source_path, sidecar_path) = parse_virtual_path(&path);
    let mut metadata = crate::exif_processing::load_sidecar(&sidecar_path);

    if enable_xmp_sync
        && sync_metadata_from_xmp(&source_path, &mut metadata, !path.contains("?vc="), false)
        && let Ok(json) = serde_json::to_string_pretty(&metadata)
    {
        let _ = fs::write(&sidecar_path, json);
    }

    Ok(metadata)
}

fn get_presets_path(app_handle: &AppHandle) -> Result<std::path::PathBuf, String> {
    let presets_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("presets");

    if !presets_dir.exists() {
        fs::create_dir_all(&presets_dir).map_err(|e| e.to_string())?;
    }

    Ok(presets_dir.join("presets.json"))
}

#[tauri::command]
pub fn load_presets(app_handle: AppHandle) -> Result<Vec<PresetItem>, String> {
    let path = get_presets_path(&app_handle)?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let content = fs::read_to_string(path).map_err(|e| e.to_string())?;
    serde_json::from_str(&content).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_presets(presets: Vec<PresetItem>, app_handle: AppHandle) -> Result<(), String> {
    let path = get_presets_path(&app_handle)?;
    let json_string = serde_json::to_string_pretty(&presets).map_err(|e| e.to_string())?;
    fs::write(path, json_string).map_err(|e| e.to_string())
}

fn get_internal_library_root_path(app_handle: &AppHandle) -> Result<std::path::PathBuf, String> {
    #[cfg(not(target_os = "android"))]
    {
        let library_dir = app_handle
            .path()
            .app_data_dir()
            .map_err(|e| e.to_string())?
            .join("library");

        if !library_dir.exists() {
            fs::create_dir_all(&library_dir).map_err(|e| e.to_string())?;
        }
        Ok(library_dir)
    }
    #[cfg(target_os = "android")]
    {
        crate::android_integration::get_android_internal_library_root()
    }
}

#[tauri::command]
pub fn get_or_create_internal_library_root(app_handle: AppHandle) -> Result<String, String> {
    let library_root = get_internal_library_root_path(&app_handle)?;

    Ok(library_root.to_string_lossy().to_string())
}

#[tauri::command]
pub fn handle_import_presets_from_file(
    file_path: String,
    app_handle: AppHandle,
) -> Result<Vec<PresetItem>, String> {
    let content =
        fs::read_to_string(file_path).map_err(|e| format!("Failed to read preset file: {}", e))?;
    let imported_preset_file: PresetFile = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse preset file: {}", e))?;

    let mut current_presets = load_presets(app_handle.clone())?;

    let mut current_names: HashSet<String> = current_presets
        .iter()
        .map(|item| match item {
            PresetItem::Preset(p) => p.name.clone(),
            PresetItem::Folder(f) => f.name.clone(),
        })
        .collect();

    for mut imported_item in imported_preset_file.presets {
        let (current_name, _new_id) = match &mut imported_item {
            PresetItem::Preset(p) => {
                p.id = Uuid::new_v4().to_string();
                (p.name.clone(), p.id.clone())
            }
            PresetItem::Folder(f) => {
                f.id = Uuid::new_v4().to_string();
                for child in &mut f.children {
                    child.id = Uuid::new_v4().to_string();
                }
                (f.name.clone(), f.id.clone())
            }
        };

        let mut new_name = current_name.clone();
        let mut counter = 1;
        while current_names.contains(&new_name) {
            new_name = format!("{} ({})", current_name, counter);
            counter += 1;
        }

        match &mut imported_item {
            PresetItem::Preset(p) => p.name = new_name.clone(),
            PresetItem::Folder(f) => f.name = new_name.clone(),
        }

        current_names.insert(new_name);
        current_presets.push(imported_item);
    }

    save_presets(current_presets.clone(), app_handle)?;
    Ok(current_presets)
}

#[tauri::command]
pub fn handle_import_legacy_presets_from_file(
    file_path: String,
    app_handle: AppHandle,
) -> Result<Vec<PresetItem>, String> {
    let content = fs::read_to_string(&file_path)
        .map_err(|e| format!("Failed to read legacy preset file: {}", e))?;

    let xmp_content = if file_path.to_lowercase().ends_with(".lrtemplate") {
        let re = Regex::new(r#"(?s)s.xmp = "(.*)""#).unwrap();
        if let Some(caps) = re.captures(&content) {
            caps.get(1)
                .map(|m| m.as_str().replace(r#"\""#, r#"""#))
                .unwrap_or(content)
        } else {
            content
        }
    } else {
        content
    };

    let converted_preset = preset_converter::convert_xmp_to_preset(&xmp_content)?;

    let mut current_presets = load_presets(app_handle.clone())?;

    let current_names: HashSet<String> = current_presets
        .iter()
        .flat_map(|item| match item {
            PresetItem::Preset(p) => vec![p.name.clone()],
            PresetItem::Folder(f) => {
                let mut names = vec![f.name.clone()];
                names.extend(f.children.iter().map(|c| c.name.clone()));
                names
            }
        })
        .collect();

    let mut new_name = converted_preset.name.clone();
    let mut counter = 1;
    while current_names.contains(&new_name) {
        new_name = format!("{} ({})", converted_preset.name, counter);
        counter += 1;
    }

    let mut final_preset = converted_preset;
    final_preset.name = new_name;

    current_presets.push(PresetItem::Preset(final_preset));

    save_presets(current_presets.clone(), app_handle)?;
    Ok(current_presets)
}

#[tauri::command]
pub fn handle_export_presets_to_file(
    presets_to_export: Vec<PresetItem>,
    file_path: String,
) -> Result<(), String> {
    let preset_file = ExportPresetFile {
        creator: "Anonymous",
        presets: &presets_to_export,
    };

    let json_string = serde_json::to_string_pretty(&preset_file)
        .map_err(|e| format!("Failed to serialize presets: {}", e))?;
    fs::write(file_path, json_string).map_err(|e| format!("Failed to write preset file: {}", e))
}

#[tauri::command]
pub fn save_community_preset(
    name: String,
    adjustments: Value,
    app_handle: AppHandle,
    include_masks: Option<bool>,
    include_crop_transform: Option<bool>,
    preset_type: Option<String>,
) -> Result<(), String> {
    let mut current_presets = load_presets(app_handle.clone())?;

    let community_folder_name = "Community";
    let community_folder_id = match current_presets.iter_mut().find(|item| {
        if let PresetItem::Folder(f) = item {
            f.name == community_folder_name
        } else {
            false
        }
    }) {
        Some(PresetItem::Folder(folder)) => folder.id.clone(),
        _ => {
            let new_folder_id = Uuid::new_v4().to_string();
            let new_folder = PresetItem::Folder(PresetFolder {
                id: new_folder_id.clone(),
                name: community_folder_name.to_string(),
                children: Vec::new(),
            });
            current_presets.insert(0, new_folder);
            new_folder_id
        }
    };

    let new_preset = Preset {
        id: Uuid::new_v4().to_string(),
        name,
        adjustments,
        include_masks,
        include_crop_transform,
        preset_type: preset_type.or(Some("style".to_string())),
    };

    if let Some(PresetItem::Folder(folder)) = current_presets.iter_mut().find(|item| {
        if let PresetItem::Folder(f) = item {
            f.id == community_folder_id
        } else {
            false
        }
    }) {
        folder.children.retain(|p| p.name != new_preset.name);
        folder.children.push(new_preset);
    }

    save_presets(current_presets, app_handle)
}

#[tauri::command]
pub fn clear_all_sidecars(root_path: String) -> Result<usize, String> {
    if !Path::new(&root_path).exists() {
        return Err(format!("Root path does not exist: {}", root_path));
    }

    let mut deleted_count = 0;
    let walker = WalkDir::new(root_path).into_iter();

    for entry in walker.filter_map(|e| e.ok()) {
        let path = entry.path();
        if path.is_file()
            && let Some(extension) = path.extension()
            && extension == "tirdata"
        {
            if fs::remove_file(path).is_ok() {
                deleted_count += 1;
            } else {
                eprintln!("Failed to delete sidecar file: {:?}", path);
            }
        }
    }

    Ok(deleted_count)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SidecarImportResult {
    imported: usize,
    skipped: usize,
    invalid: usize,
    failed: usize,
}

#[tauri::command]
pub fn import_rapidraw_sidecars(root_path: String) -> Result<SidecarImportResult, String> {
    let root = Path::new(&root_path);
    if !root.is_dir() {
        return Err(format!("Root path is not a directory: {root_path}"));
    }

    let mut result = SidecarImportResult {
        imported: 0,
        skipped: 0,
        invalid: 0,
        failed: 0,
    };

    for entry in WalkDir::new(root).follow_links(false) {
        let entry = match entry {
            Ok(entry) => entry,
            Err(_) => {
                result.failed += 1;
                continue;
            }
        };
        let source = entry.path();
        if !entry.file_type().is_file()
            || source.extension().and_then(|extension| extension.to_str()) != Some("rrdata")
        {
            continue;
        }

        let bytes = match fs::read(source) {
            Ok(bytes) => bytes,
            Err(_) => {
                result.failed += 1;
                continue;
            }
        };
        if serde_json::from_slice::<ImageMetadata>(&bytes).is_err() {
            result.invalid += 1;
            continue;
        }

        let destination = source.with_extension("tirdata");
        let mut destination_file = match OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&destination)
        {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                result.skipped += 1;
                continue;
            }
            Err(_) => {
                result.failed += 1;
                continue;
            }
        };

        if destination_file.write_all(&bytes).is_ok() {
            result.imported += 1;
        } else {
            let _ = fs::remove_file(destination);
            result.failed += 1;
        }
    }

    Ok(result)
}

#[tauri::command]
pub fn clear_thumbnail_cache(app_handle: AppHandle) -> Result<(), String> {
    let cache_dir = app_handle
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?;
    let thumb_cache_dir = cache_dir.join("thumbnails");

    if thumb_cache_dir.exists() {
        fs::remove_dir_all(&thumb_cache_dir)
            .map_err(|e| format!("Failed to remove thumbnail cache: {}", e))?;
    }

    fs::create_dir_all(&thumb_cache_dir)
        .map_err(|e| format!("Failed to recreate thumbnail cache directory: {}", e))?;

    crate::library_catalog::clear_thumbnail_index(&app_handle)?;

    Ok(())
}

#[tauri::command]
pub fn show_in_finder(path: String) -> Result<(), String> {
    let (source_path, _) = parse_virtual_path(&path);

    #[cfg(target_os = "windows")]
    {
        let source_path_str = source_path.to_string_lossy().to_string();
        Command::new("explorer")
            .args(["/select,", &source_path_str])
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "macos")]
    {
        let source_path_str = source_path.to_string_lossy().to_string();
        Command::new("open")
            .args(["-R", &source_path_str])
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "linux")]
    {
        if let Some(parent) = source_path.parent() {
            Command::new("xdg-open")
                .arg(parent)
                .spawn()
                .map_err(|e| e.to_string())?;
        } else {
            return Err("Could not get parent directory".into());
        }
    }

    #[cfg(target_os = "android")]
    {
        return Err("Show in File Manager is not natively supported via CLI on Android.".into());
    }

    #[cfg(target_os = "ios")]
    {
        return Err("Show in File Manager is not supported on iOS.".into());
    }

    Ok(())
}

#[tauri::command]
pub fn delete_files_from_disk(paths: Vec<String>, app_handle: AppHandle) -> Result<(), String> {
    let mut files_to_trash = HashSet::new();

    let mut deletions = HashSet::new();

    for path_str in paths {
        let (source_path, sidecar_path) = parse_virtual_path(&path_str);
        deletions.insert(path_str.clone());

        if path_str.contains("?vc=") {
            if sidecar_path.exists() {
                files_to_trash.insert(sidecar_path);
            }
        } else {
            if source_path.exists() {
                match find_all_associated_files(&source_path) {
                    Ok(associated_files) => {
                        for file in associated_files {
                            files_to_trash.insert(file);
                        }
                    }
                    Err(e) => {
                        log::warn!(
                            "Could not find associated files for {}: {}",
                            source_path.display(),
                            e
                        );
                    }
                }
            }
        }
    }

    if files_to_trash.is_empty() {
        return Ok(());
    }

    let final_paths_to_delete: Vec<PathBuf> = files_to_trash.into_iter().collect();
    #[cfg(any(target_os = "windows", target_os = "macos", target_os = "linux"))]
    if let Err(trash_error) = trash::delete_all(&final_paths_to_delete) {
        log::warn!(
            "Failed to move files to trash: {}. Falling back to permanent delete.",
            trash_error
        );
        for path in final_paths_to_delete {
            if path.is_file() {
                fs::remove_file(&path)
                    .map_err(|e| format!("Failed to delete file {}: {}", path.display(), e))?;
            } else if path.is_dir() {
                fs::remove_dir_all(&path)
                    .map_err(|e| format!("Failed to delete directory {}: {}", path.display(), e))?;
            }
        }
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    for path in final_paths_to_delete {
        if path.is_file() {
            fs::remove_file(&path)
                .map_err(|e| format!("Failed to delete file {}: {}", path.display(), e))?;
        } else if path.is_dir() {
            fs::remove_dir_all(&path)
                .map_err(|e| format!("Failed to delete directory {}: {}", path.display(), e))?;
        }
    }

    sync_album_path_changes(&app_handle, None, Some(&deletions), None);

    Ok(())
}

fn deletion_stem_for(filename: &str) -> Option<&str> {
    let image_filename = if filename.ends_with(".tirdata") {
        let without_sidecar = filename.trim_end_matches(".tirdata");
        if let Some(dot_pos) = without_sidecar.rfind('.') {
            let suffix = &without_sidecar[dot_pos + 1..];
            if suffix.len() == 6 && suffix.chars().all(|c| c.is_ascii_hexdigit()) {
                &without_sidecar[..dot_pos]
            } else {
                without_sidecar
            }
        } else {
            without_sidecar
        }
    } else if is_supported_image_file(filename) {
        filename
    } else {
        return None;
    };
    Path::new(image_filename)
        .file_stem()
        .and_then(|s| s.to_str())
}

#[tauri::command]
pub fn delete_files_with_associated(
    paths: Vec<String>,
    app_handle: AppHandle,
) -> Result<(), String> {
    if paths.is_empty() {
        return Ok(());
    }

    let mut stems_to_delete = HashSet::new();
    let mut parent_dirs = HashSet::new();
    let mut deletions = HashSet::new();

    for path_str in &paths {
        deletions.insert(path_str.clone());
        let (source_path, _) = parse_virtual_path(path_str);
        if let Some(stem) = source_path.file_stem().and_then(|s| s.to_str()) {
            stems_to_delete.insert(stem.to_string());
        }
        if let Some(parent) = source_path.parent() {
            parent_dirs.insert(parent.to_path_buf());
        }
    }

    if stems_to_delete.is_empty() {
        return Ok(());
    }

    let mut files_to_trash = HashSet::new();

    for parent_dir in parent_dirs {
        if let Ok(entries) = fs::read_dir(parent_dir) {
            for entry in entries.filter_map(Result::ok) {
                let entry_path = entry.path();
                if !entry_path.is_file() {
                    continue;
                }

                let entry_filename = entry.file_name();
                let entry_filename_str = entry_filename.to_string_lossy();

                if let Some(stem) = deletion_stem_for(&entry_filename_str)
                    && stems_to_delete.contains(stem)
                {
                    files_to_trash.insert(entry_path);
                }
            }
        }
    }

    if files_to_trash.is_empty() {
        return Ok(());
    }

    let final_paths_to_delete: Vec<PathBuf> = files_to_trash.into_iter().collect();
    #[cfg(any(target_os = "windows", target_os = "macos", target_os = "linux"))]
    if let Err(trash_error) = trash::delete_all(&final_paths_to_delete) {
        log::warn!(
            "Failed to move files to trash: {}. Falling back to permanent delete.",
            trash_error
        );
        for path in final_paths_to_delete {
            if path.is_file() {
                fs::remove_file(&path)
                    .map_err(|e| format!("Failed to delete file {}: {}", path.display(), e))?;
            }
        }
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    for path in final_paths_to_delete {
        if path.is_file() {
            fs::remove_file(&path)
                .map_err(|e| format!("Failed to delete file {}: {}", path.display(), e))?;
        }
    }

    sync_album_path_changes(&app_handle, None, Some(&deletions), None);

    Ok(())
}

pub fn get_thumb_cache_dir(app_handle: &AppHandle) -> Result<PathBuf, String> {
    let cache_dir = app_handle
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?;
    let thumb_cache_dir = cache_dir.join("thumbnails");
    if !thumb_cache_dir.exists() {
        fs::create_dir_all(&thumb_cache_dir).map_err(|e| e.to_string())?;
    }
    Ok(thumb_cache_dir)
}

#[tauri::command]
pub async fn import_files(
    source_paths: Vec<String>,
    destination_folder: String,
    settings: ImportSettings,
    app_handle: AppHandle,
) -> Result<(), String> {
    let total_files = source_paths.len();
    let _ = app_handle.emit("import-start", serde_json::json!({ "total": total_files }));

    tauri::async_runtime::spawn_blocking(move || {
        for (i, source_path_str) in source_paths.iter().enumerate() {
            let _ = app_handle.emit(
                "import-progress",
                serde_json::json!({ "current": i, "total": total_files, "path": source_path_str }),
            );

            let import_result: Result<(), String> = (|| {
                #[cfg(target_os = "android")]
                if is_android_content_uri(source_path_str) {
                    let resolved_name = resolve_android_content_uri_name(source_path_str)?;
                    let source_bytes = read_android_content_uri(source_path_str)?;
                    let source_name_path = Path::new(&resolved_name);
                    let file_date = exif_processing::get_creation_date_from_bytes(
                        &resolved_name,
                        &source_bytes,
                    );

                    let mut final_dest_folder = PathBuf::from(&destination_folder);
                    if settings.organize_by_date {
                        let date_format_str = settings
                            .date_folder_format
                            .replace("YYYY", "%Y")
                            .replace("MM", "%m")
                            .replace("DD", "%d");
                        let subfolder = file_date.format(&date_format_str).to_string();
                        final_dest_folder.push(subfolder);
                    }

                    fs::create_dir_all(&final_dest_folder)
                        .map_err(|e| format!("Failed to create destination folder: {}", e))?;

                    let new_stem = generate_filename_from_template(
                        &settings.filename_template,
                        source_name_path,
                        i + 1,
                        total_files,
                        &file_date,
                    );
                    let extension = source_name_path
                        .extension()
                        .and_then(|s| s.to_str())
                        .unwrap_or("");
                    let new_filename = format!("{}.{}", new_stem, extension);
                    let dest_file_path = final_dest_folder.join(new_filename);

                    if dest_file_path.exists() {
                        return Err(format!(
                            "File already exists at destination: {}",
                            dest_file_path.display()
                        ));
                    }

                    fs::write(&dest_file_path, source_bytes).map_err(|e| e.to_string())?;

                    if settings.delete_after_import {
                        log::info!(
                            "Skipping delete_after_import for Android content URI source: {}",
                            source_path_str
                        );
                    }

                    return Ok(());
                }

                let (source_path, source_sidecar) = parse_virtual_path(source_path_str);
                if !source_path.exists() {
                    return Err(format!("Source file not found: {}", source_path_str));
                }

                let file_date = exif_processing::get_creation_date_from_path(&source_path);

                let mut final_dest_folder = PathBuf::from(&destination_folder);
                if settings.organize_by_date {
                    let date_format_str = settings
                        .date_folder_format
                        .replace("YYYY", "%Y")
                        .replace("MM", "%m")
                        .replace("DD", "%d");
                    let subfolder = file_date.format(&date_format_str).to_string();
                    final_dest_folder.push(subfolder);
                }

                fs::create_dir_all(&final_dest_folder)
                    .map_err(|e| format!("Failed to create destination folder: {}", e))?;

                let new_stem = generate_filename_from_template(
                    &settings.filename_template,
                    &source_path,
                    i + 1,
                    total_files,
                    &file_date,
                );
                let extension = source_path
                    .extension()
                    .and_then(|s| s.to_str())
                    .unwrap_or("");
                let new_filename = format!("{}.{}", new_stem, extension);
                let dest_file_path = final_dest_folder.join(new_filename);

                if dest_file_path.exists() {
                    return Err(format!(
                        "File already exists at destination: {}",
                        dest_file_path.display()
                    ));
                }

                fs::copy(&source_path, &dest_file_path).map_err(|e| e.to_string())?;
                if source_sidecar.exists()
                    && let Some(dest_str) = dest_file_path.to_str()
                {
                    let (_, dest_sidecar) = parse_virtual_path(dest_str);
                    fs::copy(&source_sidecar, &dest_sidecar).map_err(|e| e.to_string())?;
                }

                if settings.delete_after_import {
                    #[cfg(any(target_os = "windows", target_os = "macos", target_os = "linux"))]
                    {
                        if let Err(trash_error) = trash::delete(&source_path) {
                            log::warn!(
                                "Failed to trash source file {}: {}. Deleting permanently.",
                                source_path.display(),
                                trash_error
                            );
                            fs::remove_file(&source_path).map_err(|e| e.to_string())?;
                        }
                        if source_sidecar.exists()
                            && let Err(trash_error) = trash::delete(&source_sidecar)
                        {
                            log::warn!(
                                "Failed to trash source sidecar {}: {}. Deleting permanently.",
                                source_sidecar.display(),
                                trash_error
                            );
                            fs::remove_file(&source_sidecar).map_err(|e| e.to_string())?;
                        }
                    }

                    #[cfg(not(any(
                        target_os = "windows",
                        target_os = "macos",
                        target_os = "linux"
                    )))]
                    {
                        fs::remove_file(&source_path).map_err(|e| e.to_string())?;
                        if source_sidecar.exists() {
                            fs::remove_file(&source_sidecar).map_err(|e| e.to_string())?;
                        }
                    }
                }

                Ok(())
            })();

            if let Err(e) = import_result {
                eprintln!("Failed to import {}: {}", source_path_str, e);
                let _ = app_handle.emit("import-error", e);
                return;
            }
        }

        let _ = app_handle.emit(
            "import-progress",
            serde_json::json!({ "current": total_files, "total": total_files, "path": "" }),
        );
        let _ = app_handle.emit("import-complete", ());
    });

    Ok(())
}

pub fn generate_filename_from_template(
    template: &str,
    original_path: &std::path::Path,
    sequence: usize,
    total: usize,
    file_date: &DateTime<Utc>,
) -> String {
    let stem = original_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("image");
    let sequence_str = format!(
        "{:0width$}",
        sequence,
        width = total.to_string().len().max(1)
    );
    let local_date = file_date.with_timezone(&chrono::Local);

    let mut result = template.to_string();
    result = result.replace("{original_filename}", stem);
    result = result.replace("{sequence}", &sequence_str);
    result = result.replace("{YYYY}", &local_date.format("%Y").to_string());
    result = result.replace("{MM}", &local_date.format("%m").to_string());
    result = result.replace("{DD}", &local_date.format("%d").to_string());
    result = result.replace("{hh}", &local_date.format("%H").to_string());
    result = result.replace("{mm}", &local_date.format("%M").to_string());

    result
}

#[tauri::command]
pub fn rename_files(
    paths: Vec<String>,
    name_template: String,
    app_handle: AppHandle,
) -> Result<Vec<String>, String> {
    if paths.is_empty() {
        return Ok(Vec::new());
    }

    let mut operations: HashMap<PathBuf, PathBuf> = HashMap::new();
    let mut final_new_paths = Vec::with_capacity(paths.len());
    let mut renames = HashMap::new();

    for (i, path_str) in paths.iter().enumerate() {
        let (original_path, _) = parse_virtual_path(path_str);
        if !original_path.exists() {
            return Err(format!("File not found: {}", path_str));
        }

        let parent = original_path
            .parent()
            .ok_or("Could not get parent directory")?;
        let extension = original_path
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("");

        let file_date = exif_processing::get_creation_date_from_path(&original_path);

        let new_stem = generate_filename_from_template(
            &name_template,
            &original_path,
            i + 1,
            paths.len(),
            &file_date,
        );
        let new_filename = format!("{}.{}", new_stem, extension);
        let new_path = parent.join(new_filename);

        if new_path.exists() && new_path != original_path {
            return Err(format!(
                "A file with the name {} already exists.",
                new_path.display()
            ));
        }

        operations.insert(original_path, new_path);
    }

    let mut sidecar_operations: HashMap<PathBuf, PathBuf> = HashMap::new();
    for (original_path, new_path) in &operations {
        let parent = original_path
            .parent()
            .ok_or("Could not get parent directory")?;
        let original_filename_str = original_path.file_name().unwrap().to_string_lossy();
        let new_filename_str = new_path.file_name().unwrap().to_string_lossy();

        if let Ok(entries) = fs::read_dir(parent) {
            for entry in entries.filter_map(Result::ok) {
                let entry_path = entry.path();
                let entry_os_filename = entry.file_name();
                let entry_filename = entry_os_filename.to_string_lossy();

                if entry_filename.starts_with(&format!("{}.", original_filename_str))
                    && entry_filename.ends_with(".tirdata")
                {
                    let new_sidecar_filename =
                        entry_filename.replacen(&*original_filename_str, &new_filename_str, 1);
                    let new_sidecar_path = parent.join(new_sidecar_filename);
                    sidecar_operations.insert(entry_path, new_sidecar_path);
                } else if entry_filename == format!("{}.tirdata", original_filename_str) {
                    let mut new_sidecar_name = new_path.file_name().unwrap().to_os_string();
                    new_sidecar_name.push(".tirdata");
                    let new_sidecar_path = new_path.with_file_name(new_sidecar_name);

                    sidecar_operations.insert(entry_path, new_sidecar_path);
                }
            }
        }
    }
    operations.extend(sidecar_operations);

    for (old_path, new_path) in operations {
        fs::rename(&old_path, &new_path).map_err(|e| {
            format!(
                "Failed to rename {} to {}: {}",
                old_path.display(),
                new_path.display(),
                e
            )
        })?;

        let old_str = old_path.to_string_lossy().into_owned();
        let new_str = new_path.to_string_lossy().into_owned();

        renames.insert(old_str, new_str.clone());

        if is_supported_image_file(&new_path) {
            final_new_paths.push(new_str);
        }
    }

    sync_album_path_changes(&app_handle, Some(&renames), None, None);

    Ok(final_new_paths)
}

#[tauri::command]
pub fn create_virtual_copy(
    source_virtual_path: String,
    target_album_id: Option<String>,
    copy_name_suffix: Option<String>,
    app_handle: AppHandle,
) -> Result<String, String> {
    let (source_path, source_sidecar_path) = parse_virtual_path(&source_virtual_path);

    let new_copy_id = Uuid::new_v4().to_string()[..6].to_string();
    let configured_suffix = copy_name_suffix
        .as_deref()
        .map(sanitize_filename_suffix)
        .filter(|suffix| !suffix.is_empty());
    let mut new_virtual_path = format!("{}?vc={}", source_path.to_string_lossy(), new_copy_id);
    let (_, new_sidecar_path) = parse_virtual_path(&new_virtual_path);

    let mut metadata = if source_sidecar_path.exists() {
        crate::exif_processing::load_sidecar(&source_sidecar_path)
    } else {
        ImageMetadata::default()
    };
    metadata.copy_name_suffix = configured_suffix.clone();
    let json_string = serde_json::to_string_pretty(&metadata).map_err(|e| e.to_string())?;
    fs::write(new_sidecar_path, json_string)
        .map_err(|e| format!("Failed to write virtual copy sidecar: {}", e))?;

    if let Some(suffix) = configured_suffix {
        new_virtual_path.push_str("&name=");
        new_virtual_path.push_str(&suffix);
    }

    if let Some(album_id) = target_album_id {
        let _ = add_to_album(album_id, vec![new_virtual_path.clone()], app_handle);
    }

    Ok(new_virtual_path)
}

pub fn extract_xmp_rating(content: &str) -> Option<u8> {
    if let Some(idx) = content.find("xmp:Rating=\"") {
        let start = idx + 12;
        let end = content[start..].find('"').map(|i| start + i)?;
        return content[start..end].parse().ok();
    }
    if let Some(idx) = content.find("<xmp:Rating>") {
        let start = idx + 12;
        let end = content[start..].find('<').map(|i| start + i)?;
        return content[start..end].parse().ok();
    }
    None
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct XmpImageStack {
    id: String,
    paths: Vec<String>,
    cover_path: String,
    collapsed: bool,
}

#[tauri::command]
pub fn sync_image_stacks_to_xmp(
    stacks: Vec<XmpImageStack>,
    affected_paths: Vec<String>,
    app_handle: AppHandle,
) -> Result<(), String> {
    let settings = load_settings(app_handle).unwrap_or_default();
    if !settings.enable_xmp_sync.unwrap_or(false) {
        return Ok(());
    }
    let create_xmp_if_missing = settings.create_xmp_if_missing.unwrap_or(false);

    affected_paths.par_iter().try_for_each(|path| {
        if path.contains("?vc=") {
            return Ok(());
        }

        let (source_path, sidecar_path) = parse_virtual_path(path);
        let mut metadata = crate::exif_processing::load_sidecar(&sidecar_path);
        metadata.xmp_stack = stacks.iter().find_map(|stack| {
            let physical_paths: Vec<&String> = stack
                .paths
                .iter()
                .filter(|member| !member.contains("?vc="))
                .collect();
            if physical_paths.len() < 2 {
                return None;
            }
            physical_paths
                .iter()
                .position(|member| *member == path)
                .map(|order| XmpStackMetadata {
                    id: stack.id.clone(),
                    order: order as u32,
                    is_cover: stack.cover_path == *path,
                    collapsed: stack.collapsed,
                })
        });

        let json = serde_json::to_string_pretty(&metadata)
            .map_err(|error| format!("Failed to serialize stack metadata for {path}: {error}"))?;
        fs::write(&sidecar_path, json)
            .map_err(|error| format!("Failed to save stack metadata for {path}: {error}"))?;
        sync_metadata_to_xmp(&source_path, &metadata, create_xmp_if_missing, true);
        Ok(())
    })
}

pub fn extract_xmp_label(content: &str) -> Option<String> {
    if let Some(idx) = content.find("xmp:Label=\"") {
        let start = idx + 11;
        let end = content[start..].find('"').map(|i| start + i)?;
        return Some(content[start..end].to_string());
    }
    if let Some(idx) = content.find("<xmp:Label>") {
        let start = idx + 11;
        let end = content[start..].find('<').map(|i| start + i)?;
        return Some(content[start..end].to_string());
    }
    None
}

pub fn extract_xmp_tags(content: &str) -> Vec<String> {
    let mut tags = Vec::new();
    if let Some(start_idx) = content.find("<dc:subject>")
        && let Some(end_idx) = content[start_idx..].find("</dc:subject>")
    {
        let subject_block = &content[start_idx..start_idx + end_idx];
        let mut current_idx = 0;
        while let Some(li_start) = subject_block[current_idx..].find("<rdf:li>") {
            let val_start = current_idx + li_start + 8;
            if let Some(li_end) = subject_block[val_start..].find("</rdf:li>") {
                tags.push(subject_block[val_start..val_start + li_end].to_string());
                current_idx = val_start + li_end + 9;
            } else {
                break;
            }
        }
    }
    tags
}

fn extract_app_xmp_value(content: &str, field: &str) -> Option<String> {
    let attribute = Regex::new(&format!(r#"rr:{field}\s*=\s*"([^"]*)""#)).ok()?;
    if let Some(captures) = attribute.captures(content) {
        return captures.get(1).map(|value| value.as_str().to_string());
    }

    let element = Regex::new(&format!(r#"<rr:{field}(?:\s+[^>]*)?>([^<]*)</rr:{field}>"#)).ok()?;
    element
        .captures(content)
        .and_then(|captures| captures.get(1))
        .map(|value| value.as_str().to_string())
}

fn extract_xmp_stack(content: &str) -> Option<XmpStackMetadata> {
    Some(XmpStackMetadata {
        id: extract_app_xmp_value(content, "StackId")?,
        order: extract_app_xmp_value(content, "StackOrder")?.parse().ok()?,
        is_cover: extract_app_xmp_value(content, "StackCover")? == "true",
        collapsed: extract_app_xmp_value(content, "StackCollapsed")? == "true",
    })
}

fn set_adjustment_value(metadata: &mut ImageMetadata, key: &str, value: Value) -> bool {
    if !metadata.adjustments.is_object() {
        metadata.adjustments = serde_json::json!({});
    }
    let adjustments = metadata.adjustments.as_object_mut().unwrap();
    if adjustments.get(key) == Some(&value) {
        return false;
    }
    adjustments.insert(key.to_string(), value);
    true
}

fn escape_xmp_text(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

fn set_app_xmp_value(content: &mut String, field: &str, value: Option<&str>) {
    let attribute = Regex::new(&format!(r#"\s*rr:{field}\s*=\s*"[^"]*""#)).unwrap();
    *content = attribute.replace_all(content, "").to_string();

    let element = Regex::new(&format!(
        r#"\s*<rr:{field}(?:\s+[^>]*)?>[^<]*</rr:{field}>"#
    ))
    .unwrap();
    *content = element.replace_all(content, "").to_string();

    if let Some(value) = value
        && let Some(last_index) = content.rfind("</rdf:Description>")
    {
        let node = format!(
            " <rr:{field} xmlns:rr=\"https://colrbent.com/ns/this-is-raw/1.0/\">{}</rr:{field}>\n",
            escape_xmp_text(value)
        );
        content.insert_str(last_index, &node);
    }
}

pub fn resolve_xmp_path(image_path: &Path) -> Option<PathBuf> {
    let filename = image_path.file_name()?.to_string_lossy();
    [
        image_path.with_extension("xmp"),
        image_path.with_extension("XMP"),
        image_path.with_file_name(format!("{filename}.xmp")),
        image_path.with_file_name(format!("{filename}.XMP")),
    ]
    .into_iter()
    .find(|candidate| candidate.is_file())
}

#[tauri::command]
pub fn read_xmp_from_folder(path: String) -> Result<usize, String> {
    let folder = Path::new(&path);
    if !folder.is_dir() {
        return Err(format!("Folder does not exist: {}", folder.display()));
    }

    let image_paths: Vec<PathBuf> = WalkDir::new(folder)
        .into_iter()
        .filter_map(|entry| entry.ok())
        .filter(|entry| entry.file_type().is_file() && is_supported_image_file(entry.path()))
        .map(|entry| entry.into_path())
        .filter(|entry| resolve_xmp_path(entry).is_some())
        .collect();

    image_paths.par_iter().try_for_each(|image_path| {
        let (_, sidecar_path) = parse_virtual_path(&image_path.to_string_lossy());
        let mut metadata = crate::exif_processing::load_sidecar(&sidecar_path);
        sync_metadata_from_xmp(image_path, &mut metadata, true, true);
        let json = serde_json::to_string_pretty(&metadata).map_err(|error| {
            format!(
                "Could not serialize XMP metadata for {}: {error}",
                image_path.display()
            )
        })?;
        fs::write(&sidecar_path, json).map_err(|error| {
            format!(
                "Could not save XMP metadata for {}: {error}",
                image_path.display()
            )
        })
    })?;

    Ok(image_paths.len())
}

pub fn sync_metadata_from_xmp(
    source_path: &Path,
    metadata: &mut ImageMetadata,
    include_app_fields: bool,
    force: bool,
) -> bool {
    let actual_xmp = resolve_xmp_path(source_path);

    let mut changed = false;

    if let Some(xmp_file) = actual_xmp
        && let Ok(content) = fs::read_to_string(&xmp_file)
    {
        let xmp_rating = extract_xmp_rating(&content).unwrap_or(0);
        if (force || (metadata.rating == 0 && xmp_rating != 0)) && metadata.rating != xmp_rating {
            let rating = xmp_rating;
            metadata.rating = rating;
            if let Some(obj) = metadata.adjustments.as_object_mut() {
                obj.insert("rating".to_string(), serde_json::json!(rating));
            } else {
                metadata.adjustments = serde_json::json!({"rating": rating});
            }
            changed = true;
        }

        let xmp_label = extract_xmp_label(&content);
        let xmp_tags = extract_xmp_tags(&content);
        let xmp_flag = include_app_fields
            .then(|| extract_app_xmp_value(&content, "Flag"))
            .flatten();

        let mut current_tags = if force {
            Vec::new()
        } else {
            metadata.tags.clone().unwrap_or_default()
        };
        let original_tags = current_tags.clone();
        let had_no_tags = metadata.tags.is_none();

        for tag in xmp_tags {
            if !current_tags.contains(&tag) {
                current_tags.push(tag);
            }
        }

        if let Some(label) = xmp_label {
            let label_tag = format!("{}{}", COLOR_TAG_PREFIX, label.to_lowercase());
            if !current_tags.contains(&label_tag) {
                current_tags.retain(|t| !t.starts_with(COLOR_TAG_PREFIX));
                current_tags.push(label_tag);
            }
        }

        if let Some(flag) = xmp_flag
            && matches!(
                flag.as_str(),
                "rejected" | "selected" | "deferred" | "unflagged"
            )
        {
            current_tags.retain(|tag| !tag.starts_with(FLAG_TAG_PREFIX));
            if flag != "unflagged" {
                current_tags.push(format!("{FLAG_TAG_PREFIX}{flag}"));
            }
        }

        if current_tags != original_tags
            || (had_no_tags && !current_tags.is_empty())
            || (force && metadata.tags.is_some() && current_tags.is_empty())
        {
            metadata.tags = (!current_tags.is_empty()).then_some(current_tags);
            changed = true;
        }

        if include_app_fields {
            if let Some(encoded_adjustments) = extract_app_xmp_value(&content, "Adjustments")
                && let Ok(bytes) = general_purpose::STANDARD.decode(encoded_adjustments)
                && let Ok(imported_adjustments) = serde_json::from_slice::<Value>(&bytes)
                && imported_adjustments.is_object()
                && (force || metadata.adjustments.is_null())
                && metadata.adjustments != imported_adjustments
            {
                metadata.adjustments = imported_adjustments;
                changed = true;
            }

            let xmp_stack = extract_xmp_stack(&content);
            if metadata.xmp_stack != xmp_stack {
                metadata.xmp_stack = xmp_stack;
                changed = true;
            }

            let should_import_auto_geometry = force
                || metadata
                    .adjustments
                    .get("transformAutoMode")
                    .and_then(Value::as_str)
                    .is_none();
            let mut imported_auto_geometry = false;
            let xmp_auto_mode = extract_app_xmp_value(&content, "AutoGeometryMode")
                .filter(|mode| matches!(mode.as_str(), "auto" | "level" | "vertical" | "guided"));
            if let Some(mode) = xmp_auto_mode
                && should_import_auto_geometry
            {
                imported_auto_geometry = true;
                changed |=
                    set_adjustment_value(metadata, "transformAutoMode", serde_json::json!(mode));
                let rotate = extract_app_xmp_value(&content, "TransformRotate")
                    .and_then(|value| value.parse::<f64>().ok())
                    .unwrap_or(0.0);
                let vertical = extract_app_xmp_value(&content, "TransformVertical")
                    .and_then(|value| value.parse::<f64>().ok())
                    .unwrap_or(0.0);
                let horizontal = extract_app_xmp_value(&content, "TransformHorizontal")
                    .and_then(|value| value.parse::<f64>().ok())
                    .unwrap_or(0.0);
                changed |=
                    set_adjustment_value(metadata, "transformRotate", serde_json::json!(rotate));
                changed |= set_adjustment_value(
                    metadata,
                    "transformVertical",
                    serde_json::json!(vertical),
                );
                changed |= set_adjustment_value(
                    metadata,
                    "transformHorizontal",
                    serde_json::json!(horizontal),
                );
            } else if force {
                changed |=
                    set_adjustment_value(metadata, "transformAutoMode", serde_json::Value::Null);
            }

            if let Some(constrain_crop) = extract_app_xmp_value(&content, "ConstrainCrop")
                .and_then(|value| value.parse::<bool>().ok())
                && (force
                    || imported_auto_geometry
                    || metadata.adjustments.get("transformConstrainCrop").is_none())
            {
                changed |= set_adjustment_value(
                    metadata,
                    "transformConstrainCrop",
                    serde_json::json!(constrain_crop),
                );
            }
        }
    }
    changed
}

pub fn sync_metadata_to_xmp(
    source_path: &Path,
    metadata: &ImageMetadata,
    create_if_missing: bool,
    include_app_fields: bool,
) {
    let xmp_path = source_path.with_extension("xmp");
    let xmp_path_upper = source_path.with_extension("XMP");

    let mut actual_xmp = if xmp_path.exists() {
        Some(xmp_path.clone())
    } else if xmp_path_upper.exists() {
        Some(xmp_path_upper.clone())
    } else {
        None
    };

    if actual_xmp.is_none() {
        if !create_if_missing {
            return;
        }
        let skeleton = r#"<?xml version="1.0" encoding="UTF-8"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="ThisIsRAW">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:xmp="http://ns.adobe.com/xap/1.0/"
    xmlns:dc="http://purl.org/dc/elements/1.1/">
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>"#;
        if let Err(e) = fs::write(&xmp_path, skeleton) {
            log::error!("Failed to create skeleton XMP: {}", e);
            return;
        }
        actual_xmp = Some(xmp_path);
    }

    if let Some(xmp_file) = actual_xmp
        && let Ok(mut content) = fs::read_to_string(&xmp_file)
    {
        let rating_str = metadata.rating.to_string();
        let re_rating_attr = Regex::new(r#"xmp:Rating\s*=\s*"[^"]*""#).unwrap();
        let re_rating_tag = Regex::new(r#"<xmp:Rating\s*>[^<]*</xmp:Rating>"#).unwrap();

        if re_rating_attr.is_match(&content) {
            content = re_rating_attr
                .replace(&content, format!("xmp:Rating=\"{}\"", rating_str))
                .to_string();
        } else if re_rating_tag.is_match(&content) {
            content = re_rating_tag
                .replace(&content, format!("<xmp:Rating>{}</xmp:Rating>", rating_str))
                .to_string();
        } else if let Some(last_index) = content.rfind("</rdf:Description>") {
            let (start, end) = content.split_at(last_index);
            content = format!("{} <xmp:Rating>{}</xmp:Rating>\n{}", start, rating_str, end);
        }

        let current_tags = metadata.tags.clone().unwrap_or_default();
        let mut label = None;
        let mut flag = None;
        let mut normal_tags = Vec::new();

        for t in current_tags {
            if let Some(color) = t.strip_prefix(COLOR_TAG_PREFIX) {
                let mut c = color.chars();
                let cap_color = match c.next() {
                    None => String::new(),
                    Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
                };
                label = Some(cap_color);
            } else if let Some(value) = t.strip_prefix(FLAG_TAG_PREFIX) {
                flag = Some(value.to_string());
            } else {
                normal_tags.push(t);
            }
        }

        if let Some(lbl) = label {
            let re_label_attr = Regex::new(r#"xmp:Label\s*=\s*"[^"]*""#).unwrap();
            let re_label_tag = Regex::new(r#"<xmp:Label\s*>[^<]*</xmp:Label>"#).unwrap();

            if re_label_attr.is_match(&content) {
                content = re_label_attr
                    .replace(&content, format!("xmp:Label=\"{}\"", lbl))
                    .to_string();
            } else if re_label_tag.is_match(&content) {
                content = re_label_tag
                    .replace(&content, format!("<xmp:Label>{}</xmp:Label>", lbl))
                    .to_string();
            } else if let Some(last_index) = content.rfind("</rdf:Description>") {
                let (start, end) = content.split_at(last_index);
                content = format!("{} <xmp:Label>{}</xmp:Label>\n{}", start, lbl, end);
            }
        } else {
            let re_label_attr = Regex::new(r#"\s*xmp:Label\s*=\s*"[^"]*""#).unwrap();
            let re_label_tag = Regex::new(r#"\s*<xmp:Label\s*>[^<]*</xmp:Label>"#).unwrap();
            content = re_label_attr.replace_all(&content, "").to_string();
            content = re_label_tag.replace_all(&content, "").to_string();
        }

        if include_app_fields {
            let adjustments_json = serde_json::to_vec(&metadata.adjustments).unwrap_or_default();
            let encoded_adjustments = general_purpose::STANDARD.encode(adjustments_json);
            set_app_xmp_value(&mut content, "AdjustmentsVersion", Some("1"));
            set_app_xmp_value(&mut content, "Adjustments", Some(&encoded_adjustments));

            set_app_xmp_value(
                &mut content,
                "Flag",
                Some(flag.as_deref().unwrap_or("unflagged")),
            );

            if let Some(stack) = &metadata.xmp_stack {
                set_app_xmp_value(&mut content, "StackId", Some(&stack.id));
                set_app_xmp_value(&mut content, "StackOrder", Some(&stack.order.to_string()));
                set_app_xmp_value(
                    &mut content,
                    "StackCover",
                    Some(if stack.is_cover { "true" } else { "false" }),
                );
                set_app_xmp_value(
                    &mut content,
                    "StackCollapsed",
                    Some(if stack.collapsed { "true" } else { "false" }),
                );
            } else {
                set_app_xmp_value(&mut content, "StackId", None);
                set_app_xmp_value(&mut content, "StackOrder", None);
                set_app_xmp_value(&mut content, "StackCover", None);
                set_app_xmp_value(&mut content, "StackCollapsed", None);
            }

            let auto_mode = metadata
                .adjustments
                .get("transformAutoMode")
                .and_then(Value::as_str)
                .filter(|mode| matches!(*mode, "auto" | "level" | "vertical" | "guided"));
            set_app_xmp_value(&mut content, "AutoGeometryMode", auto_mode);
            if auto_mode.is_some() {
                let rotate = metadata
                    .adjustments
                    .get("transformRotate")
                    .and_then(Value::as_f64)
                    .unwrap_or(0.0)
                    .to_string();
                let vertical = metadata
                    .adjustments
                    .get("transformVertical")
                    .and_then(Value::as_f64)
                    .unwrap_or(0.0)
                    .to_string();
                let horizontal = metadata
                    .adjustments
                    .get("transformHorizontal")
                    .and_then(Value::as_f64)
                    .unwrap_or(0.0)
                    .to_string();
                set_app_xmp_value(&mut content, "TransformRotate", Some(&rotate));
                set_app_xmp_value(&mut content, "TransformVertical", Some(&vertical));
                set_app_xmp_value(&mut content, "TransformHorizontal", Some(&horizontal));
            } else {
                set_app_xmp_value(&mut content, "TransformRotate", None);
                set_app_xmp_value(&mut content, "TransformVertical", None);
                set_app_xmp_value(&mut content, "TransformHorizontal", None);
            }

            let constrain_crop = metadata
                .adjustments
                .get("transformConstrainCrop")
                .and_then(Value::as_bool)
                .unwrap_or(false)
                .to_string();
            set_app_xmp_value(&mut content, "ConstrainCrop", Some(&constrain_crop));
        }

        let re_subject =
            Regex::new(r#"(?s)<dc:subject>\s*<rdf:Bag>.*?</rdf:Bag>\s*</dc:subject>"#).unwrap();
        if normal_tags.is_empty() {
            content = re_subject.replace_all(&content, "").to_string();
        } else {
            let mut bag = String::from("<dc:subject>\n    <rdf:Bag>\n");
            for t in normal_tags {
                bag.push_str(&format!("     <rdf:li>{}</rdf:li>\n", t));
            }
            bag.push_str("    </rdf:Bag>\n   </dc:subject>");

            if re_subject.is_match(&content) {
                content = re_subject.replace(&content, bag).to_string();
            } else if let Some(last_index) = content.rfind("</rdf:Description>") {
                let (start, end) = content.split_at(last_index);
                content = format!("{} {}\n  {}", start, bag, end);
            }
        }

        let _ = fs::write(&xmp_file, content);
    }
}
