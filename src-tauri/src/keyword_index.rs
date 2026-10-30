//! A library-wide index of user keywords and AI tags, kept in the library catalog.
//!
//! `.tirdata` sidecars and XMP remain authoritative; the index is rebuilt incrementally from
//! their modification times and only speeds up the Keyword List and keyword views.

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::UNIX_EPOCH;

use rayon::prelude::*;
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use walkdir::WalkDir;

use crate::file_management::{
    is_cloud_placeholder, parse_sidecar_filename, parse_virtual_path, resolve_xmp_path,
    sync_metadata_from_xmp,
};
use crate::formats::is_supported_image_file;
use crate::library_catalog::{self, KeywordIndexEntry};
use crate::tagging::{KEYWORD_PATH_SEPARATOR, PathTags, USER_TAG_PREFIX, is_ai_tag};

const KEYWORD_INDEX_UPDATED_EVENT: &str = "keyword-index-updated";
const WRITE_BATCH_SIZE: usize = 500;

static IS_SCANNING: AtomicBool = AtomicBool::new(false);
static RESCAN_REQUESTED: AtomicBool = AtomicBool::new(false);
static SCAN_ROOTS: Mutex<Vec<String>> = Mutex::new(Vec::new());

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KeywordCount {
    keyword: String,
    count: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KeywordIndex {
    /// User keyword paths, without the `user:` prefix.
    keywords: Vec<KeywordCount>,
    ai_tags: Vec<KeywordCount>,
    is_scanning: bool,
}

fn is_keyword_tag(tag: &str) -> bool {
    tag.starts_with(USER_TAG_PREFIX) || is_ai_tag(tag)
}

/// The index key of an image or one of its virtual copies.
fn source_key(source_path: &Path, copy_id: Option<&str>) -> String {
    let source = source_path.to_string_lossy();
    match copy_id {
        Some(id) => format!("{source}?vc={id}"),
        None => source.into_owned(),
    }
}

/// The index key of a library path: the image or virtual copy, without the copy's display name.
fn entry_key(virtual_path: &str) -> String {
    match virtual_path.rsplit_once("?vc=") {
        Some((source, copy)) => format!("{source}?vc={}", copy.split('&').next().unwrap_or(copy)),
        None => virtual_path.to_string(),
    }
}

fn modified_nanos(path: &Path) -> u128 {
    fs::metadata(path)
        .and_then(|metadata| metadata.modified())
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_nanos())
        .unwrap_or(0)
}

/// Changes whenever the sidecar, the XMP file, or the XMP sync setting changes.
fn index_stamp(source_path: &Path, sidecar_path: &Path, enable_xmp_sync: bool) -> String {
    let xmp_modified = enable_xmp_sync
        .then(|| resolve_xmp_path(source_path))
        .flatten()
        .map_or(0, |xmp_path| modified_nanos(&xmp_path));
    format!(
        "{}:{}:{}",
        u8::from(enable_xmp_sync),
        modified_nanos(sidecar_path),
        xmp_modified
    )
}

fn keyword_tags(tags: Option<Vec<String>>) -> Vec<String> {
    tags.unwrap_or_default()
        .into_iter()
        .filter(|tag| is_keyword_tag(tag))
        .collect()
}

/// Reads an image's tags as the library listing resolves them, without writing anything.
fn read_entry(
    source_path: &Path,
    sidecar_path: &Path,
    key: String,
    is_virtual_copy: bool,
    enable_xmp_sync: bool,
    stamp: String,
) -> KeywordIndexEntry {
    let mut metadata = crate::exif_processing::load_sidecar(sidecar_path);
    if enable_xmp_sync {
        sync_metadata_from_xmp(source_path, &mut metadata, !is_virtual_copy, false);
    }

    let image_path = match metadata
        .copy_name_suffix
        .as_deref()
        .filter(|suffix| is_virtual_copy && !suffix.is_empty())
    {
        Some(suffix) => format!("{key}&name={suffix}"),
        None => key.clone(),
    };
    KeywordIndexEntry {
        key,
        image_path,
        stamp,
        tags: keyword_tags(metadata.tags),
    }
}

/// Every image and virtual copy under `root`, with its sidecar.
fn library_entries(root: &Path) -> Vec<(PathBuf, Option<String>)> {
    let mut images = Vec::new();
    let mut copies = Vec::new();
    for entry in WalkDir::new(root).into_iter().filter_map(Result::ok) {
        let path = entry.path();
        if !entry.file_type().is_file() {
            continue;
        }
        let file_name = path.file_name().unwrap_or_default().to_string_lossy();
        if let Some((source_name, Some(copy_id))) = parse_sidecar_filename(&file_name) {
            if let Some(parent) = path.parent() {
                copies.push((parent.join(source_name), Some(copy_id)));
            }
        } else if is_supported_image_file(path) {
            images.push((path.to_path_buf(), None));
        }
    }
    let image_set: HashSet<&PathBuf> = images.iter().map(|(path, _)| path).collect();
    let copies: Vec<_> = copies
        .into_iter()
        .filter(|(source, _)| image_set.contains(source))
        .collect();
    images.extend(copies);
    images
}

fn scan_library(app_handle: &AppHandle, root_paths: &[String]) -> Result<(), String> {
    let settings = crate::app_settings::load_settings(app_handle.clone()).unwrap_or_default();
    let enable_xmp_sync = settings.enable_xmp_sync.unwrap_or(false);
    let stored = library_catalog::load_keyword_index_stamps(app_handle)?;

    let entries: Vec<(PathBuf, Option<String>)> = root_paths
        .iter()
        .map(Path::new)
        .filter(|root| root.is_dir())
        .flat_map(library_entries)
        .collect();

    let changed: Vec<KeywordIndexEntry> = entries
        .par_iter()
        .filter_map(|(source_path, copy_id)| {
            let key = source_key(source_path, copy_id.as_deref());
            let (_, sidecar_path) = parse_virtual_path(&key);
            // Reading a cloud placeholder would download it; keep what the index already has.
            if is_cloud_placeholder(&sidecar_path)
                || (enable_xmp_sync
                    && resolve_xmp_path(source_path).is_some_and(|xmp| is_cloud_placeholder(&xmp)))
            {
                return None;
            }
            let stamp = index_stamp(source_path, &sidecar_path, enable_xmp_sync);
            (stored.get(&key) != Some(&stamp)).then(|| {
                read_entry(
                    source_path,
                    &sidecar_path,
                    key,
                    copy_id.is_some(),
                    enable_xmp_sync,
                    stamp,
                )
            })
        })
        .collect();

    let seen: HashSet<String> = entries
        .iter()
        .map(|(source_path, copy_id)| source_key(source_path, copy_id.as_deref()))
        .collect();
    let removed: Vec<String> = stored
        .into_keys()
        .filter(|key| !seen.contains(key))
        .collect();

    for batch in changed.chunks(WRITE_BATCH_SIZE) {
        library_catalog::write_keyword_index(app_handle, batch, &[])?;
    }
    for batch in removed.chunks(WRITE_BATCH_SIZE) {
        library_catalog::write_keyword_index(app_handle, &[], batch)?;
    }
    Ok(())
}

/// Brings the index up to date with the library roots in the background. A request during a
/// scan runs one more scan afterwards, with the latest roots.
#[tauri::command]
pub fn refresh_keyword_index(root_paths: Vec<String>, app_handle: AppHandle) {
    *SCAN_ROOTS.lock().unwrap() = root_paths;
    if IS_SCANNING.swap(true, Ordering::SeqCst) {
        RESCAN_REQUESTED.store(true, Ordering::SeqCst);
        return;
    }
    let _ = app_handle.emit(KEYWORD_INDEX_UPDATED_EVENT, ());
    thread::spawn(move || {
        loop {
            RESCAN_REQUESTED.store(false, Ordering::SeqCst);
            let root_paths = SCAN_ROOTS.lock().unwrap().clone();
            if let Err(error) = scan_library(&app_handle, &root_paths) {
                log::warn!("Keyword index scan failed: {error}");
            }
            if RESCAN_REQUESTED.load(Ordering::SeqCst) {
                continue;
            }
            IS_SCANNING.store(false, Ordering::SeqCst);
            // A request between the check above and the store would otherwise be lost.
            if !RESCAN_REQUESTED.load(Ordering::SeqCst) || IS_SCANNING.swap(true, Ordering::SeqCst)
            {
                break;
            }
        }
        let _ = app_handle.emit(KEYWORD_INDEX_UPDATED_EVENT, ());
    });
}

/// Records tags just written for library paths, so the Keyword List updates without a scan.
pub fn record_tags(app_handle: &AppHandle, updates: &[PathTags]) {
    let settings = crate::app_settings::load_settings(app_handle.clone()).unwrap_or_default();
    let enable_xmp_sync = settings.enable_xmp_sync.unwrap_or(false);
    let entries: Vec<KeywordIndexEntry> = updates
        .iter()
        .map(|(path, tags)| {
            let (source_path, sidecar_path) = parse_virtual_path(path);
            KeywordIndexEntry {
                key: entry_key(path),
                image_path: path.clone(),
                stamp: index_stamp(&source_path, &sidecar_path, enable_xmp_sync),
                tags: keyword_tags(tags.clone()),
            }
        })
        .collect();
    if let Err(error) = library_catalog::write_keyword_index(app_handle, &entries, &[]) {
        log::warn!("Could not update the keyword index: {error}");
        return;
    }
    if IS_SCANNING.load(Ordering::SeqCst) {
        RESCAN_REQUESTED.store(true, Ordering::SeqCst);
    }
    let _ = app_handle.emit(KEYWORD_INDEX_UPDATED_EVENT, ());
}

#[tauri::command]
pub fn get_keyword_index(app_handle: AppHandle) -> Result<KeywordIndex, String> {
    let mut keywords = Vec::new();
    let mut ai_tags = Vec::new();
    for (tag, count) in library_catalog::keyword_tag_counts(&app_handle)? {
        match tag.strip_prefix(USER_TAG_PREFIX) {
            Some(keyword) => keywords.push(KeywordCount {
                keyword: keyword.to_string(),
                count,
            }),
            None => ai_tags.push(KeywordCount {
                keyword: tag,
                count,
            }),
        }
    }
    Ok(KeywordIndex {
        keywords,
        ai_tags,
        is_scanning: IS_SCANNING.load(Ordering::SeqCst),
    })
}

/// The library images carrying a stored tag; a user keyword also matches its child keywords.
#[tauri::command]
pub fn get_keyword_image_paths(tag: String, app_handle: AppHandle) -> Result<Vec<String>, String> {
    let descendant_prefix = tag
        .starts_with(USER_TAG_PREFIX)
        .then(|| format!("{tag}{KEYWORD_PATH_SEPARATOR}"));
    library_catalog::keyword_image_paths(&app_handle, &tag, descendant_prefix.as_deref())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn virtual_copy_names_do_not_change_the_entry_key() {
        assert_eq!(entry_key("/photos/a.raw"), "/photos/a.raw");
        assert_eq!(
            entry_key("/photos/a.raw?vc=abc123&name=_select"),
            "/photos/a.raw?vc=abc123"
        );
    }

    #[test]
    fn only_keyword_tags_are_indexed() {
        let tags = ["sky", "user:places|berlin", "color:red", "flag:selected"]
            .map(String::from)
            .to_vec();
        assert_eq!(keyword_tags(Some(tags)), ["sky", "user:places|berlin"]);
    }

    #[test]
    fn library_entries_include_virtual_copies_of_existing_images() {
        let temporary = tempfile::tempdir().unwrap();
        let root = temporary.path();
        fs::write(root.join("a.jpg"), b"").unwrap();
        fs::write(root.join("a.jpg.tirdata"), b"{}").unwrap();
        fs::write(root.join("a.jpg.abc123.tirdata"), b"{}").unwrap();
        fs::write(root.join("gone.jpg.def456.tirdata"), b"{}").unwrap();

        let mut entries = library_entries(root);
        entries.sort();
        assert_eq!(
            entries,
            [
                (root.join("a.jpg"), None),
                (root.join("a.jpg"), Some("abc123".to_string())),
            ]
        );
    }
}
