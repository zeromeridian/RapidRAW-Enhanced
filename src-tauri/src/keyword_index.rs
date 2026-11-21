//! A library-wide index of user keywords and AI tags, kept in the library catalog.
//!
//! `.tirdata` sidecars and XMP remain authoritative; the index is rebuilt incrementally from
//! their modification times and only speeds up the Keyword List and keyword views.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;

use rayon::prelude::*;
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use walkdir::WalkDir;

use crate::embedded_xmp::can_embed_xmp;
use crate::file_management::{
    is_cloud_placeholder, modified_nanos, parse_sidecar_filename, parse_virtual_path,
    resolve_xmp_path, sync_metadata_from_xmp,
};
use crate::formats::is_supported_image_file;
use crate::library_catalog::{self, KeywordIndexEntry};
use crate::tagging::{KEYWORD_PATH_SEPARATOR, PathTags, USER_TAG_PREFIX, is_ai_tag};

const KEYWORD_INDEX_UPDATED_EVENT: &str = "keyword-index-updated";
const WRITE_BATCH_SIZE: usize = 500;
/// Scan reads are blocking file I/O, often on network volumes. They run on their own small pool
/// so they cannot occupy the global Rayon pool that rendering and other commands share.
const SCAN_THREADS: usize = 4;

static IS_SCANNING: AtomicBool = AtomicBool::new(false);
static PENDING_SCOPES: Mutex<Vec<ScanScope>> = Mutex::new(Vec::new());

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

/// Changes whenever the sidecar, the XMP file or embedded XMP, or the XMP sync setting changes.
fn index_stamp(source_path: &Path, sidecar_path: &Path, enable_xmp_sync: bool) -> String {
    // Embedded XMP changes with the image itself.
    let xmp_modified = if enable_xmp_sync {
        let sidecar_xmp = resolve_xmp_path(source_path).map_or(0, |path| modified_nanos(&path));
        let embedded_xmp = if can_embed_xmp(source_path) {
            modified_nanos(source_path)
        } else {
            0
        };
        sidecar_xmp.max(embedded_xmp)
    } else {
        0
    };
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
    if enable_xmp_sync && !is_virtual_copy {
        sync_metadata_from_xmp(source_path, &mut metadata, false);
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

/// A part of the library to bring the index up to date with (Plan item 71): a folder, alone or
/// with every folder below it. A library root's first scan is remembered, so it is not repeated.
#[derive(Clone, Debug, PartialEq)]
struct ScanScope {
    folder: PathBuf,
    recursive: bool,
    is_library_root: bool,
}

impl ScanScope {
    /// Whether the index entry `key` belongs to this scope.
    fn contains(&self, key: &str) -> bool {
        let base = key.split_once("?vc=").map_or(key, |(base, _)| base);
        let path = Path::new(base);
        if self.recursive {
            path.starts_with(&self.folder)
        } else {
            path.parent() == Some(self.folder.as_path())
        }
    }
}

/// Every image and virtual copy in `root` (and below it when `recursive`), with its sidecar.
fn library_entries(root: &Path, recursive: bool) -> Vec<(PathBuf, Option<String>)> {
    let mut images = Vec::new();
    let mut copies = Vec::new();
    let walk = WalkDir::new(root).max_depth(if recursive { usize::MAX } else { 1 });
    for entry in walk.into_iter().filter_map(Result::ok) {
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

/// The index keys in `stored` that belong to `scopes` but whose image is gone (not in `seen`).
/// Entries outside the scanned scopes, or under a folder that is not there right now (an
/// unmounted disk), are kept.
fn removed_keys(
    stored: impl IntoIterator<Item = String>,
    seen: &HashSet<String>,
    scopes: &[ScanScope],
) -> Vec<String> {
    stored
        .into_iter()
        .filter(|key| !seen.contains(key) && scopes.iter().any(|scope| scope.contains(key)))
        .collect()
}

/// Brings the index up to date with `scopes`: reads the sidecars whose stamp changed, saving
/// as it goes so a quit keeps what was read, then removes the entries of images that are gone.
fn scan_scopes(app_handle: &AppHandle, scopes: &[ScanScope]) -> Result<(), String> {
    let settings = crate::app_settings::load_settings(app_handle.clone()).unwrap_or_default();
    let enable_xmp_sync = settings.enable_xmp_sync.unwrap_or(false);
    let stored = library_catalog::load_keyword_index_stamps(app_handle)?;

    let scopes: Vec<ScanScope> = scopes
        .iter()
        .filter(|scope| scope.folder.is_dir())
        .cloned()
        .collect();
    let entries: Vec<(PathBuf, Option<String>)> = scopes
        .iter()
        .flat_map(|scope| library_entries(&scope.folder, scope.recursive))
        .collect();

    let scan_pool = rayon::ThreadPoolBuilder::new()
        .num_threads(SCAN_THREADS)
        .build()
        .map_err(|error| error.to_string())?;
    for batch in entries.chunks(WRITE_BATCH_SIZE) {
        let changed: Vec<KeywordIndexEntry> = scan_pool.install(|| {
            batch
                .par_iter()
                .filter_map(|(source_path, copy_id)| {
                    let key = source_key(source_path, copy_id.as_deref());
                    let (_, sidecar_path) = parse_virtual_path(&key);
                    // Reading a cloud placeholder would download it; keep what the index has.
                    if is_cloud_placeholder(&sidecar_path)
                        || (enable_xmp_sync
                            && resolve_xmp_path(source_path)
                                .is_some_and(|xmp| is_cloud_placeholder(&xmp)))
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
                .collect()
        });
        if !changed.is_empty() {
            library_catalog::write_keyword_index(app_handle, &changed, &[])?;
        }
    }

    let seen: HashSet<String> = entries
        .iter()
        .map(|(source_path, copy_id)| source_key(source_path, copy_id.as_deref()))
        .collect();
    let removed = removed_keys(stored.into_keys(), &seen, &scopes);
    for batch in removed.chunks(WRITE_BATCH_SIZE) {
        library_catalog::write_keyword_index(app_handle, &[], batch)?;
    }

    let scanned_roots: Vec<String> = scopes
        .iter()
        .filter(|scope| scope.is_library_root)
        .map(|scope| scope.folder.to_string_lossy().into_owned())
        .collect();
    library_catalog::mark_keyword_indexed_roots(app_handle, &scanned_roots)
}

/// Queues `scopes` for the background scan, which works through the queue on one thread.
fn request_scan(app_handle: &AppHandle, scopes: Vec<ScanScope>) {
    if scopes.is_empty() {
        return;
    }
    {
        let mut pending = PENDING_SCOPES.lock().unwrap();
        for scope in scopes {
            if !pending.contains(&scope) {
                pending.push(scope);
            }
        }
    }
    if IS_SCANNING.swap(true, Ordering::SeqCst) {
        return;
    }
    let _ = app_handle.emit(KEYWORD_INDEX_UPDATED_EVENT, ());
    let app_handle = app_handle.clone();
    thread::spawn(move || {
        loop {
            let scopes = std::mem::take(&mut *PENDING_SCOPES.lock().unwrap());
            if !scopes.is_empty() {
                if let Err(error) = scan_scopes(&app_handle, &scopes) {
                    log::warn!("Keyword index scan failed: {error}");
                }
                let _ = app_handle.emit(KEYWORD_INDEX_UPDATED_EVENT, ());
                continue;
            }
            IS_SCANNING.store(false, Ordering::SeqCst);
            // A request between the take above and the store would otherwise be lost.
            if PENDING_SCOPES.lock().unwrap().is_empty() || IS_SCANNING.swap(true, Ordering::SeqCst)
            {
                break;
            }
        }
        let _ = app_handle.emit(KEYWORD_INDEX_UPDATED_EVENT, ());
    });
}

/// The library roots, as the Library shows them (`rootFolders`, else the last root).
fn library_roots(app_handle: &AppHandle) -> Vec<PathBuf> {
    let settings = crate::app_settings::load_settings(app_handle.clone()).unwrap_or_default();
    if settings.root_folders.is_empty() {
        settings
            .last_root_path
            .into_iter()
            .map(PathBuf::from)
            .collect()
    } else {
        settings.root_folders.iter().map(PathBuf::from).collect()
    }
}

/// Scans the library roots that were never scanned (the first time, or a root added since);
/// `rescan_all` (the Keyword List's Rescan Keywords) scans every root. The index is otherwise
/// kept up to date by opened folders and ThisIsRAW's own edits, so a launch reads nothing.
#[tauri::command]
pub fn refresh_keyword_index(
    root_paths: Vec<String>,
    rescan_all: Option<bool>,
    app_handle: AppHandle,
) -> Result<(), String> {
    let indexed = if rescan_all.unwrap_or(false) {
        HashSet::new()
    } else {
        library_catalog::keyword_indexed_roots(&app_handle)?
    };
    let scopes = root_paths
        .into_iter()
        .filter(|root| !indexed.contains(&library_catalog::catalog_path_key(Path::new(root))))
        .map(|root| ScanScope {
            folder: PathBuf::from(root),
            recursive: true,
            is_library_root: true,
        })
        .collect();
    request_scan(&app_handle, scopes);
    Ok(())
}

/// Re-reads the keywords of an opened folder inside the library (with its subfolders when it
/// was listed with them), so changes made by other apps show up.
pub fn refresh_opened_folder(app_handle: &AppHandle, folder: &str, recursive: bool) {
    let folder = PathBuf::from(folder);
    if !library_roots(app_handle)
        .iter()
        .any(|root| folder.starts_with(root))
    {
        return;
    }
    request_scan(
        app_handle,
        vec![ScanScope {
            folder,
            recursive,
            is_library_root: false,
        }],
    );
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
    // A scan running now may have read these sidecars before the edit: read their folders again.
    if IS_SCANNING.load(Ordering::SeqCst) {
        let paths: Vec<String> = updates.iter().map(|(path, _)| path.clone()).collect();
        let scopes = crate::file_management::parent_folders(&paths)
            .into_iter()
            .map(|folder| ScanScope {
                folder,
                recursive: false,
                is_library_root: false,
            })
            .collect();
        request_scan(app_handle, scopes);
    }
    let _ = app_handle.emit(KEYWORD_INDEX_UPDATED_EVENT, ());
}

/// Moves the entries of renamed images and their virtual copies to the new
/// paths (`renames`: physical old → new paths), without waiting for a scan.
pub fn follow_renames(app_handle: &AppHandle, renames: &HashMap<String, String>) {
    let stored = match library_catalog::load_keyword_index_stamps(app_handle) {
        Ok(stored) => stored,
        Err(error) => {
            log::warn!("Could not update the keyword index after a rename: {error}");
            return;
        }
    };
    let settings = crate::app_settings::load_settings(app_handle.clone()).unwrap_or_default();
    let enable_xmp_sync = settings.enable_xmp_sync.unwrap_or(false);

    let mut removed = Vec::new();
    let mut entries = Vec::new();
    for key in stored.into_keys() {
        let base = key
            .split_once("?vc=")
            .map_or(key.as_str(), |(base, _)| base);
        let Some(new_base) = renames.get(base) else {
            continue;
        };
        let new_key = format!("{new_base}{}", &key[base.len()..]);
        let (source_path, sidecar_path) = parse_virtual_path(&new_key);
        let stamp = index_stamp(&source_path, &sidecar_path, enable_xmp_sync);
        let is_virtual_copy = new_key.len() > new_base.len();
        entries.push(read_entry(
            &source_path,
            &sidecar_path,
            new_key,
            is_virtual_copy,
            enable_xmp_sync,
            stamp,
        ));
        removed.push(key);
    }
    if entries.is_empty() {
        return;
    }
    if let Err(error) = library_catalog::write_keyword_index(app_handle, &entries, &removed) {
        log::warn!("Could not update the keyword index after a rename: {error}");
        return;
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

/// `tag` spelled as the library already spells it. A user keyword takes, for its longest leading
/// path that matches an indexed keyword path apart from case, that keyword's spelling; its other
/// levels stay as typed. Other tags are returned unchanged.
pub fn existing_keyword_spelling(app_handle: &AppHandle, tag: &str) -> String {
    if !tag.starts_with(USER_TAG_PREFIX) {
        return tag.to_string();
    }
    match library_catalog::keyword_tag_counts(app_handle) {
        Ok(counts) => spell_like_indexed(tag, &counts),
        Err(error) => {
            log::warn!("Could not read the keyword index to match a keyword's case: {error}");
            tag.to_string()
        }
    }
}

/// `existing_keyword_spelling` over indexed `(tag, image count)` pairs. When an indexed path
/// has several spellings, the one on the most images wins (then the first in code-point order),
/// so a library-wide spelling beats a stray variant.
fn spell_like_indexed(tag: &str, counts: &[(String, usize)]) -> String {
    let Some(typed) = tag.strip_prefix(USER_TAG_PREFIX) else {
        return tag.to_string();
    };
    let mut indexed: Vec<(&str, usize)> = counts
        .iter()
        .filter_map(|(tag, count)| Some((tag.strip_prefix(USER_TAG_PREFIX)?, *count)))
        .collect();
    indexed.sort_by(|left, right| right.1.cmp(&left.1).then_with(|| left.0.cmp(right.0)));

    // Every indexed keyword path and parent path, lowercased → its preferred spelling.
    let mut spellings: HashMap<String, &str> = HashMap::new();
    for (path, _) in indexed {
        let ends = path
            .match_indices(KEYWORD_PATH_SEPARATOR)
            .map(|(index, _)| index)
            .chain([path.len()]);
        for end in ends {
            spellings
                .entry(path[..end].to_lowercase())
                .or_insert(&path[..end]);
        }
    }

    let ends = typed
        .match_indices(KEYWORD_PATH_SEPARATOR)
        .map(|(index, _)| index)
        .chain([typed.len()]);
    let matched = ends
        .rev()
        .find_map(|end| Some((end, *spellings.get(&typed[..end].to_lowercase())?)));
    match matched {
        Some((end, spelling)) => format!("{USER_TAG_PREFIX}{spelling}{}", &typed[end..]),
        None => tag.to_string(),
    }
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
    use std::fs;

    #[test]
    fn virtual_copy_names_do_not_change_the_entry_key() {
        assert_eq!(entry_key("/photos/a.raw"), "/photos/a.raw");
        assert_eq!(
            entry_key("/photos/a.raw?vc=abc123&name=_select"),
            "/photos/a.raw?vc=abc123"
        );
    }

    #[test]
    fn typed_keywords_take_the_spelling_the_library_already_uses() {
        let counts = [
            ("user:places|germany|Berlin", 3),
            ("user:Places|Germany", 1),
            ("user:Family", 5),
            ("user:family", 2),
            ("sky", 9),
        ]
        .map(|(tag, count)| (tag.to_string(), count));
        let spell = |tag: &str| spell_like_indexed(tag, &counts);

        // The most used spelling wins, for the keyword and for each of its parents.
        assert_eq!(spell("user:FAMILY"), "user:Family");
        assert_eq!(
            spell("user:Places|Germany|berlin"),
            "user:places|germany|Berlin"
        );
        // Unknown levels keep the case they were typed in, below a known parent.
        assert_eq!(
            spell("user:PLACES|Germany|Mitte"),
            "user:places|germany|Mitte"
        );
        assert_eq!(spell("user:Holidays|Spain"), "user:Holidays|Spain");
        // Only user keywords change; a parent name alone is not a whole-path match.
        assert_eq!(spell("Sky"), "Sky");
        assert_eq!(spell("user:Place"), "user:Place");
    }

    #[test]
    fn only_keyword_tags_are_indexed() {
        let tags = ["sky", "user:places|berlin", "color:red", "flag:selected"]
            .map(String::from)
            .to_vec();
        assert_eq!(keyword_tags(Some(tags)), ["sky", "user:places|berlin"]);
    }

    fn scope(folder: &str, recursive: bool) -> ScanScope {
        ScanScope {
            folder: PathBuf::from(folder),
            recursive,
            is_library_root: false,
        }
    }

    #[test]
    fn a_scan_removes_only_gone_images_inside_what_it_scanned() {
        let stored = || {
            vec![
                "/a/x.jpg".to_string(),
                "/a/sub/y.jpg".to_string(),
                "/b/z.jpg".to_string(),
            ]
        };
        let seen = HashSet::new();

        // No scopes (no roots yet, or every root unmounted): nothing is removed.
        assert!(removed_keys(stored(), &seen, &[]).is_empty());

        let mut removed = removed_keys(stored(), &seen, &[scope("/a", true)]);
        removed.sort();
        assert_eq!(removed, ["/a/sub/y.jpg", "/a/x.jpg"]);

        // One folder alone leaves its subfolders and other folders alone.
        assert_eq!(
            removed_keys(stored(), &seen, &[scope("/a", false)]),
            ["/a/x.jpg"]
        );
    }

    #[test]
    fn a_folder_scope_holds_its_images_and_their_virtual_copies() {
        let folder = scope("/a", false);
        assert!(folder.contains("/a/x.jpg"));
        assert!(folder.contains("/a/x.jpg?vc=abc123"));
        assert!(!folder.contains("/a/sub/y.jpg"));
        assert!(!folder.contains("/ab/x.jpg"));
        assert!(scope("/a", true).contains("/a/sub/y.jpg"));
    }

    #[test]
    fn a_folder_alone_lists_only_its_own_images() {
        let temporary = tempfile::tempdir().unwrap();
        let root = temporary.path();
        fs::write(root.join("a.jpg"), b"").unwrap();
        fs::create_dir(root.join("sub")).unwrap();
        fs::write(root.join("sub").join("b.jpg"), b"").unwrap();

        assert_eq!(library_entries(root, false), [(root.join("a.jpg"), None)]);
        assert_eq!(library_entries(root, true).len(), 2);
    }

    #[test]
    fn library_entries_include_virtual_copies_of_existing_images() {
        let temporary = tempfile::tempdir().unwrap();
        let root = temporary.path();
        fs::write(root.join("a.jpg"), b"").unwrap();
        fs::write(root.join("a.jpg.tirdata"), b"{}").unwrap();
        fs::write(root.join("a.jpg.abc123.tirdata"), b"{}").unwrap();
        fs::write(root.join("gone.jpg.def456.tirdata"), b"{}").unwrap();

        let mut entries = library_entries(root, true);
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
