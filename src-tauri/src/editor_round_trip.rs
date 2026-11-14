//! Lightroom-style **Edit In** round trip for external editors.
//!
//! A rendered copy is staged in the app cache and opened in the editor. Only
//! when the editor saves into that staging folder is the result copied beside
//! the source (`<stem>-Edit.<ext>`) and added to the Library, so abandoned
//! edits leave nothing behind. However the editor saves (back into the render,
//! or Save As under another name or format), each image file it writes there
//! gets its own copy, and later saves of that file replace the same copy.
//! Whether the editor opens it in a new window or a tab does not matter. Sessions are
//! kept in the catalog, so a save made while ThisIsRAW was closed is picked up
//! on the next launch, and end once they have seen no new save for
//! [`RETENTION`]. Ending a session deletes only its staging folder.
//!
//! Edit Original opens a non-RAW file itself and watches it in place.
//!
//! An editor that quits with an error right after it was started (for example
//! a launcher that cannot open the file) ends its session and reports why,
//! instead of leaving it waiting for a save.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Child;
use std::sync::{LazyLock, Mutex};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager};

use crate::AppState;
use crate::app_settings::ExternalEditFormat;
use crate::export_processing::{
    ExportAdjustmentsMode, ExportSettings, TiffBitDepth, export_images_impl,
};
use crate::file_management::{
    copy_file_atomically, modified_nanos, open_external_editor, parse_virtual_path,
};
use crate::formats::is_supported_image_file;
use crate::library_catalog::{self, EditorRoundTripRow, StagedFileRow};

const STAGING_FOLDER: &str = "external-edits";
const EDIT_SUFFIX: &str = "-Edit";
const SAVED_EVENT: &str = "editor-round-trip-saved";
const FAILED_EVENT: &str = "editor-round-trip-failed";
/// Editors write a save in several steps. A file counts as saved once two
/// consecutive polls see the same size and modification time. Polling, rather
/// than change notifications, also works on network volumes.
const POLL_INTERVAL: Duration = Duration::from_millis(1500);
const RETENTION: Duration = Duration::from_secs(7 * 24 * 60 * 60);
/// A launcher (macOS `open`, a wrapper script) hands the file over and exits;
/// only a failure within this time counts as the editor not starting.
const LAUNCH_WINDOW: Duration = Duration::from_secs(10);

static SESSIONS: LazyLock<Mutex<Vec<EditorRoundTripRow>>> = LazyLock::new(Default::default);
/// Files opened with Edit Original and the stamp last reported for each. They
/// are watched until ThisIsRAW quits.
static ORIGINALS: LazyLock<Mutex<HashMap<String, FileStamp>>> = LazyLock::new(Default::default);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct FileStamp {
    len: u64,
    modified: u64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct RoundTripFailed {
    source_path: String,
    message: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct RoundTripSaved {
    source_path: String,
    output_path: String,
    /// The first save of this copy, which the Library has not listed yet.
    is_new: bool,
}

fn round_trip_export_settings() -> ExportSettings {
    ExportSettings {
        jpeg_quality: 100,
        tiff_bit_depth: TiffBitDepth::Sixteen,
        dpi: None,
        resize: None,
        border: None,
        pad: None,
        keep_metadata: true,
        inherit_all_exif: false,
        preserve_timestamps: false,
        strip_gps: false,
        filename_template: None,
        filename_suffix: None,
        watermark: None,
        export_masks: false,
        preserve_folders: false,
        export_to_source_folder: false,
        subfolder: None,
    }
}

/// Renders `source_path` with its current adjustments into a new staging
/// folder, opens it in the editor, and starts watching for saves.
#[tauri::command]
pub async fn start_editor_round_trip(
    source_path: String,
    editor_path: String,
    format: ExternalEditFormat,
    current_edit_path: Option<String>,
    current_edit_adjustments: Option<Value>,
    state: tauri::State<'_, AppState>,
    app_handle: AppHandle,
) -> Result<(), String> {
    let (extension, output_format) = match format {
        ExternalEditFormat::Tiff => ("tif", "tiff"),
        ExternalEditFormat::Jpeg => ("jpg", "jpeg"),
    };
    let id = uuid::Uuid::new_v4().to_string();
    let staging_dir = staging_root(&app_handle)?.join(&id);
    fs::create_dir_all(&staging_dir)
        .map_err(|error| format!("Could not create the external-edit folder: {error}"))?;
    let (physical_source, _) = parse_virtual_path(&source_path);
    let stem = physical_source
        .file_stem()
        .unwrap_or_default()
        .to_string_lossy();
    let staged_file = staging_dir.join(format!("{stem}{EDIT_SUFFIX}.{extension}"));

    let (completion_tx, completion_rx) = tokio::sync::oneshot::channel();
    let rendered = async {
        export_images_impl(
            vec![source_path.clone()],
            staged_file.to_string_lossy().into_owned(),
            true,
            Vec::new(),
            round_trip_export_settings(),
            output_format.to_owned(),
            ExportAdjustmentsMode::UseSidecars {
                active_path: current_edit_path,
                active_adjustments: current_edit_adjustments,
            },
            state,
            app_handle.clone(),
            false,
            Some(completion_tx),
        )
        .await?;
        match completion_rx.await {
            Ok(Ok(())) => {}
            Ok(Err(_)) => return Err("Could not render the copy for the external editor".into()),
            Err(_) => return Err("The external edit was cancelled".into()),
        }
        let stamp = file_stamp(&staged_file)
            .ok_or_else(|| "The copy for the external editor was not written".to_string())?;
        let editor = open_external_editor(editor_path, staged_file.to_string_lossy().into_owned())?;
        Ok::<_, String>((stamp, editor))
    }
    .await;
    let (stamp, editor) = match rendered {
        Ok(rendered) => rendered,
        Err(error) => {
            let _ = fs::remove_dir_all(&staging_dir);
            return Err(error);
        }
    };

    let session = EditorRoundTripRow {
        id: id.clone(),
        source_path: source_path.clone(),
        staging_dir: staging_dir.to_string_lossy().into_owned(),
        files: vec![StagedFileRow {
            path: staged_file.to_string_lossy().into_owned(),
            len: stamp.len,
            modified: stamp.modified,
            destination: None,
        }],
        created_at: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |duration| duration.as_secs() as i64),
    };
    if let Err(error) = library_catalog::save_editor_round_trip(&app_handle, &session) {
        log::warn!("External edit will not survive a restart: {error}");
    }
    SESSIONS.lock().unwrap().push(session);
    watch_launch(editor, app_handle, source_path, move |app_handle| {
        // Keep a session that already received a save.
        let is_unsaved = SESSIONS
            .lock()
            .unwrap()
            .iter()
            .any(|session| session.id == id && !has_copy(session, |_| true));
        if is_unsaved {
            end_session(app_handle, &id);
        }
        is_unsaved
    });
    Ok(())
}

/// Waits for the started editor process in the background, so it never lingers
/// as a zombie, and reports it when it fails within [`LAUNCH_WINDOW`] and
/// `on_failure` confirms nothing was saved yet.
fn watch_launch(
    mut editor: Child,
    app_handle: AppHandle,
    source_path: String,
    on_failure: impl FnOnce(&AppHandle) -> bool + Send + 'static,
) {
    let started = Instant::now();
    thread::spawn(move || {
        let Ok(status) = editor.wait() else { return };
        if status.success() || started.elapsed() > LAUNCH_WINDOW || !on_failure(&app_handle) {
            return;
        }
        log::warn!("External editor for {source_path} quit right after starting ({status})");
        let _ = app_handle.emit(
            FAILED_EVENT,
            RoundTripFailed {
                source_path,
                message: format!("The external editor quit right after starting ({status})"),
            },
        );
    });
}

/// Opens a file itself in the editor and refreshes its thumbnail whenever the
/// editor saves it.
#[tauri::command]
pub fn start_editing_original(
    path: String,
    editor_path: String,
    app_handle: AppHandle,
) -> Result<(), String> {
    let (physical, _) = parse_virtual_path(&path);
    let stamp =
        file_stamp(&physical).ok_or_else(|| format!("{} was not found", physical.display()))?;
    let physical = physical.to_string_lossy().into_owned();
    let editor = open_external_editor(editor_path, physical.clone())?;

    // A round trip saving into this file would overwrite the direct edits.
    let replaced: Vec<String> = SESSIONS
        .lock()
        .unwrap()
        .iter()
        .filter(|session| has_copy(session, |destination| destination == physical))
        .map(|session| session.id.clone())
        .collect();
    for id in replaced {
        end_session(&app_handle, &id);
    }
    ORIGINALS.lock().unwrap().insert(physical.clone(), stamp);
    watch_launch(editor, app_handle, path, move |_| {
        ORIGINALS.lock().unwrap().remove(&physical);
        true
    });
    Ok(())
}

/// An editor installed in its standard location, offered in Settings.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectedEditor {
    name: &'static str,
    path: String,
    format: ExternalEditFormat,
}

/// Finds editors that ThisIsRAW can set up without a file picker. Settings
/// lists them; nothing is added until the user chooses to.
#[tauri::command]
pub fn detect_external_editors() -> Vec<DetectedEditor> {
    photo_craft_candidates(|name| std::env::var_os(name))
        .into_iter()
        .find(|path| path.exists())
        .map(|path| DetectedEditor {
            name: "Photo Craft",
            path: path.to_string_lossy().into_owned(),
            format: ExternalEditFormat::Tiff,
        })
        .into_iter()
        .collect()
}

/// Photo Craft's install locations (`packaging/` in its repository, checked
/// at `v0.19.0`), most common first. The Linux Flatpak is not supported yet.
fn photo_craft_candidates(env: impl Fn(&str) -> Option<std::ffi::OsString>) -> Vec<PathBuf> {
    #[cfg(target_os = "macos")]
    {
        std::iter::once(PathBuf::from("/"))
            .chain(env("HOME").map(PathBuf::from))
            .map(|root| root.join("Applications").join("PhotoCraft.app"))
            .collect()
    }
    #[cfg(target_os = "windows")]
    {
        // The MSI installs into Program Files, or into
        // `%LOCALAPPDATA%\Programs` when installed for one user.
        [
            env("ProgramFiles").map(PathBuf::from),
            env("LOCALAPPDATA").map(|folder| PathBuf::from(folder).join("Programs")),
        ]
        .into_iter()
        .flatten()
        .map(|root| {
            root.join("ArtCraft")
                .join("PhotoCraft")
                .join("photocraft.exe")
        })
        .collect()
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        env("PATH")
            .map(|path| {
                std::env::split_paths(&path)
                    .map(|folder| folder.join("photocraft"))
                    .collect()
            })
            .unwrap_or_default()
    }
}

/// The total size of all staging folders.
#[tauri::command]
pub fn get_editor_round_trip_cache_size(app_handle: AppHandle) -> Result<u64, String> {
    Ok(folder_size(&staging_root(&app_handle)?))
}

/// Ends every session. Copies already saved beside their sources are kept.
#[tauri::command]
pub fn clear_editor_round_trips(app_handle: AppHandle) -> Result<(), String> {
    let ids: Vec<String> = SESSIONS
        .lock()
        .unwrap()
        .iter()
        .map(|session| session.id.clone())
        .collect();
    for id in ids {
        end_session(&app_handle, &id);
    }
    match fs::remove_dir_all(staging_root(&app_handle)?) {
        Err(error) if error.kind() != std::io::ErrorKind::NotFound => {
            Err(format!("Could not clear the external-edit folder: {error}"))
        }
        _ => Ok(()),
    }
}

/// Resumes the catalog's sessions and polls their staging folders and the
/// files opened with Edit Original.
pub fn start_watcher(app_handle: AppHandle) {
    thread::spawn(move || {
        match library_catalog::load_editor_round_trips(&app_handle) {
            Ok(rows) => SESSIONS.lock().unwrap().extend(rows),
            Err(error) => log::warn!("Could not resume external edits: {error}"),
        }
        if let Ok(root) = staging_root(&app_handle) {
            remove_orphaned_staging(&root, SystemTime::now());
        }

        // Files with an unhandled change, keyed by path, and the stamp the
        // previous poll saw.
        let mut unsettled: HashMap<String, FileStamp> = HashMap::new();
        loop {
            let now = SystemTime::now();
            let sessions = SESSIONS.lock().unwrap().clone();
            let originals = ORIGINALS.lock().unwrap().clone();
            let mut changed: HashMap<String, FileStamp> = HashMap::new();
            for mut session in sessions {
                let staging_dir = Path::new(&session.staging_dir);
                let saves: Vec<_> = saved_files(staging_dir)
                    .into_iter()
                    .filter(|save| !is_handled(&session, save))
                    .collect();
                if saves.is_empty() {
                    if !staging_dir.is_dir() || is_expired(&session, now) {
                        end_session(&app_handle, &session.id);
                    }
                    continue;
                }
                for save in saves {
                    let key = save.0.to_string_lossy().into_owned();
                    if !is_settled(&unsettled, &key, save.1) {
                        changed.insert(key, save.1);
                    } else if let Err(error) = promote(&app_handle, &mut session, &save) {
                        // For example a file the editor still has locked on
                        // Windows; the next poll retries.
                        log::warn!("Could not save external edit: {error}");
                        changed.insert(key, save.1);
                    }
                }
            }
            for (path, handled) in originals {
                let Some(stamp) = file_stamp(Path::new(&path)) else {
                    ORIGINALS.lock().unwrap().remove(&path);
                    continue;
                };
                if stamp == handled {
                    continue;
                }
                if !is_settled(&unsettled, &path, stamp) {
                    changed.insert(path, stamp);
                } else {
                    ORIGINALS.lock().unwrap().insert(path.clone(), stamp);
                    let _ = app_handle.emit(
                        SAVED_EVENT,
                        RoundTripSaved {
                            source_path: path.clone(),
                            output_path: path,
                            is_new: false,
                        },
                    );
                }
            }
            unsettled = changed;
            thread::sleep(POLL_INTERVAL);
        }
    });
}

fn staging_root(app_handle: &AppHandle) -> Result<PathBuf, String> {
    app_handle
        .path()
        .app_cache_dir()
        .map(|cache| cache.join(STAGING_FOLDER))
        .map_err(|error| error.to_string())
}

/// Forgets a session and deletes its staging folder.
fn end_session(app_handle: &AppHandle, id: &str) {
    let removed = {
        let mut sessions = SESSIONS.lock().unwrap();
        sessions
            .iter()
            .position(|session| session.id == id)
            .map(|index| sessions.remove(index))
    };
    let Some(session) = removed else { return };
    if let Err(error) = fs::remove_dir_all(&session.staging_dir)
        && error.kind() != std::io::ErrorKind::NotFound
    {
        log::warn!("Could not remove external-edit folder: {error}");
    }
    if let Err(error) = library_catalog::delete_editor_round_trip(app_handle, id) {
        log::warn!("Could not forget external edit: {error}");
    }
}

/// Deletes staging folders that no session owns, for example after the catalog
/// was moved, once they are older than [`RETENTION`].
fn remove_orphaned_staging(root: &Path, now: SystemTime) {
    let Ok(entries) = fs::read_dir(root) else {
        return;
    };
    let sessions = SESSIONS.lock().unwrap().clone();
    for path in entries.filter_map(Result::ok).map(|entry| entry.path()) {
        let owned = sessions
            .iter()
            .any(|session| Path::new(&session.staging_dir) == path);
        let is_old = fs::metadata(&path)
            .and_then(|metadata| metadata.modified())
            .is_ok_and(|modified| {
                now.duration_since(modified)
                    .is_ok_and(|age| age > RETENTION)
            });
        if !owned && is_old && path.is_dir() {
            let _ = fs::remove_dir_all(&path);
        }
    }
}

fn folder_size(path: &Path) -> u64 {
    let Ok(entries) = fs::read_dir(path) else {
        return 0;
    };
    entries
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let metadata = entry.metadata().ok()?;
            Some(if metadata.is_dir() {
                folder_size(&entry.path())
            } else {
                metadata.len()
            })
        })
        .sum()
}

/// No save has been handled for [`RETENTION`]. The last handled file is the
/// render itself until the editor saves.
fn is_expired(session: &EditorRoundTripRow, now: SystemTime) -> bool {
    let last_handled = session
        .files
        .iter()
        .map(|file| file.modified)
        .max()
        .unwrap_or_default();
    now.duration_since(UNIX_EPOCH + Duration::from_nanos(last_handled))
        .is_ok_and(|age| age > RETENTION)
}

/// Whether the previous poll saw the file at `key` with the same stamp.
fn is_settled(unsettled: &HashMap<String, FileStamp>, key: &str, stamp: FileStamp) -> bool {
    unsettled.get(key) == Some(&stamp)
}

/// Whether one of the session's copies beside the source matches `filter`.
fn has_copy(session: &EditorRoundTripRow, filter: impl Fn(&str) -> bool) -> bool {
    session
        .files
        .iter()
        .filter_map(|file| file.destination.as_deref())
        .any(filter)
}

fn file_stamp(path: &Path) -> Option<FileStamp> {
    let metadata = fs::metadata(path).ok()?;
    metadata.is_file().then(|| FileStamp {
        len: metadata.len(),
        modified: modified_nanos(path),
    })
}

fn is_hidden(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.starts_with('.'))
}

/// The visible entries of `dir`.
fn visible_entries(dir: &Path) -> Vec<PathBuf> {
    fs::read_dir(dir)
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| !is_hidden(path))
        .collect()
}

/// The images in the staging folder and its subfolders (editors that export
/// into a folder of their own): the render and everything the editor saved.
/// Hidden files and folders and files ThisIsRAW cannot open, such as editor
/// temporaries and PSDs, are ignored.
fn saved_files(staging_dir: &Path) -> Vec<(PathBuf, FileStamp)> {
    let entries = visible_entries(staging_dir);
    let nested: Vec<PathBuf> = entries
        .iter()
        .filter(|path| path.is_dir())
        .flat_map(|dir| visible_entries(dir))
        .collect();
    entries
        .into_iter()
        .chain(nested)
        .filter(|path| is_supported_image_file(path))
        .filter_map(|path| file_stamp(&path).map(|stamp| (path, stamp)))
        .collect()
}

fn is_handled(session: &EditorRoundTripRow, (file, stamp): &(PathBuf, FileStamp)) -> bool {
    session.files.iter().any(|handled| {
        Path::new(&handled.path) == file
            && handled.len == stamp.len
            && handled.modified == stamp.modified
    })
}

/// The saved file's name beside the source (`<stem>-Edit.<ext>` for the
/// render, the chosen name after a Save As), with `-2`, `-3`, … when taken.
fn free_destination(source_path: &str, saved_file: &Path) -> PathBuf {
    let (source, _) = parse_virtual_path(source_path);
    let folder = source.parent().unwrap_or(Path::new(""));
    let stem = saved_file.file_stem().unwrap_or_default().to_string_lossy();
    let extension = saved_file.extension().unwrap_or_default().to_string_lossy();
    (1u32..)
        .map(|number| {
            let counter = if number == 1 {
                String::new()
            } else {
                format!("-{number}")
            };
            folder.join(format!("{stem}{counter}.{extension}"))
        })
        .find(|candidate| !candidate.exists())
        .expect("an unused file name exists")
}

/// Copies a settled save beside the source, records it in the session and the
/// catalog, and tells the Library.
fn promote(
    app_handle: &AppHandle,
    session: &mut EditorRoundTripRow,
    save: &(PathBuf, FileStamp),
) -> Result<(), String> {
    let (output_path, is_new) = copy_save(session, save)?;
    if let Err(error) = library_catalog::save_editor_round_trip(app_handle, session) {
        log::warn!("Could not record external edit: {error}");
    }
    if let Some(entry) = SESSIONS
        .lock()
        .unwrap()
        .iter_mut()
        .find(|entry| entry.id == session.id)
    {
        *entry = session.clone();
    }
    let _ = app_handle.emit(
        SAVED_EVENT,
        RoundTripSaved {
            source_path: session.source_path.clone(),
            output_path,
            is_new,
        },
    );
    Ok(())
}

/// Copies a save beside the source, replacing the copy an earlier save of the
/// same file made, and marks it handled. Returns the copy's path and whether
/// it is new.
fn copy_save(
    session: &mut EditorRoundTripRow,
    (file, stamp): &(PathBuf, FileStamp),
) -> Result<(String, bool), String> {
    let path = file.to_string_lossy().into_owned();
    let previous = session
        .files
        .iter()
        .find(|handled| handled.path == path)
        .and_then(|handled| handled.destination.clone());
    let is_new = previous.is_none();
    let destination = previous
        .map(PathBuf::from)
        .unwrap_or_else(|| free_destination(&session.source_path, file));
    copy_file_atomically(file, &destination)?;

    let output_path = destination.to_string_lossy().into_owned();
    let handled = StagedFileRow {
        path,
        len: stamp.len,
        modified: stamp.modified,
        destination: Some(output_path.clone()),
    };
    match session
        .files
        .iter_mut()
        .find(|entry| entry.path == handled.path)
    {
        Some(entry) => *entry = handled,
        None => session.files.push(handled),
    }
    Ok((output_path, is_new))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn session_for(staged_file: &Path, stamp: FileStamp) -> EditorRoundTripRow {
        EditorRoundTripRow {
            id: "session".to_owned(),
            source_path: "/photos/IMG_1.CR3".to_owned(),
            staging_dir: staged_file.parent().unwrap().to_string_lossy().into_owned(),
            files: vec![StagedFileRow {
                path: staged_file.to_string_lossy().into_owned(),
                len: stamp.len,
                modified: stamp.modified,
                destination: None,
            }],
            created_at: 0,
        }
    }

    fn unhandled(session: &EditorRoundTripRow) -> Vec<(PathBuf, FileStamp)> {
        saved_files(Path::new(&session.staging_dir))
            .into_iter()
            .filter(|save| !is_handled(session, save))
            .collect()
    }

    #[test]
    fn saved_files_ignore_hidden_and_unreadable_files() {
        let staging = tempfile::tempdir().unwrap();
        let staged = staging.path().join("IMG_1-Edit.tif");
        fs::write(&staged, b"render").unwrap();
        fs::write(staging.path().join(".IMG_1-Edit.tif.tmp"), b"partial").unwrap();
        fs::write(staging.path().join("IMG_1-Edit.psd"), b"layers").unwrap();

        let files = saved_files(staging.path());
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].0, staged);
        assert_eq!(files[0].1.len, 6);
    }

    #[test]
    fn saved_files_include_subfolders_but_not_hidden_ones() {
        let staging = tempfile::tempdir().unwrap();
        let staged = staging.path().join("IMG_1-Edit.tif");
        fs::write(&staged, b"render").unwrap();
        fs::create_dir(staging.path().join(".cache")).unwrap();
        fs::write(staging.path().join(".cache").join("IMG_1-Edit.jpg"), b"x").unwrap();
        fs::create_dir(staging.path().join("Exports")).unwrap();
        let exported = staging.path().join("Exports").join("IMG_1-Edit.jpg");
        fs::write(&exported, b"saved").unwrap();

        let mut files: Vec<PathBuf> = saved_files(staging.path())
            .into_iter()
            .map(|(path, _)| path)
            .collect();
        files.sort();
        assert_eq!(files, vec![exported, staged]);
    }

    #[test]
    fn only_a_changed_save_is_unhandled() {
        let staging = tempfile::tempdir().unwrap();
        let staged = staging.path().join("IMG_1-Edit.tif");
        fs::write(&staged, b"render").unwrap();
        let session = session_for(&staged, file_stamp(&staged).unwrap());
        assert!(unhandled(&session).is_empty());

        fs::write(&staged, b"saved by the editor").unwrap();
        assert_eq!(unhandled(&session).len(), 1);
    }

    #[test]
    fn each_saved_file_gets_its_own_copy_that_later_saves_replace() {
        let photos = tempfile::tempdir().unwrap();
        let staging = tempfile::tempdir().unwrap();
        let staged = staging.path().join("IMG_1-Edit.tif");
        fs::write(&staged, b"render").unwrap();
        let mut session = session_for(&staged, file_stamp(&staged).unwrap());
        session.source_path = photos.path().join("IMG_1.CR3").to_string_lossy().into();
        let copy_all = |session: &mut EditorRoundTripRow| {
            let mut copies: Vec<(String, bool)> = unhandled(session)
                .iter()
                .map(|save| copy_save(session, save).unwrap())
                .collect();
            copies.sort();
            copies
        };
        let copy = |name: &str| photos.path().join(name).to_string_lossy().into_owned();

        // Save, then Save As to JPEG and to a second TIFF name in one poll.
        fs::write(&staged, b"saved").unwrap();
        fs::write(staging.path().join("IMG_1-Edit.jpg"), b"jpeg").unwrap();
        fs::write(staging.path().join("IMG_1-Edit-bw.tif"), b"bw").unwrap();
        assert_eq!(
            copy_all(&mut session),
            vec![
                (copy("IMG_1-Edit-bw.tif"), true),
                (copy("IMG_1-Edit.jpg"), true),
                (copy("IMG_1-Edit.tif"), true),
            ]
        );
        assert!(unhandled(&session).is_empty());

        // Saving the first TIFF again replaces only its own copy.
        fs::write(&staged, b"saved again").unwrap();
        let replaced = copy_all(&mut session);
        assert_eq!(replaced.len(), 1);
        assert!(!replaced[0].1);
        assert_eq!(fs::read(&replaced[0].0).unwrap(), b"saved again");
        assert_eq!(fs::read_dir(photos.path()).unwrap().count(), 3);
    }

    #[test]
    fn a_save_settles_once_two_polls_agree() {
        let stamp = |len| FileStamp { len, modified: 1 };
        let polls = HashMap::from([("IMG_1-Edit.tif".to_owned(), stamp(1))]);
        assert!(!is_settled(&polls, "IMG_1-Edit.tif", stamp(2)));
        assert!(!is_settled(&polls, "IMG_1-Edit-bw.tif", stamp(1)));
        assert!(is_settled(&polls, "IMG_1-Edit.tif", stamp(1)));
    }

    #[test]
    fn sessions_expire_after_a_week_without_a_save() {
        let saved = UNIX_EPOCH + Duration::from_secs(1_800_000_000);
        let session = session_for(
            Path::new("/cache/external-edits/session/IMG_1-Edit.tif"),
            FileStamp {
                len: 1,
                modified: saved.duration_since(UNIX_EPOCH).unwrap().as_nanos() as u64,
            },
        );
        assert!(!is_expired(&session, saved + RETENTION));
        assert!(is_expired(
            &session,
            saved + RETENTION + Duration::from_secs(1)
        ));
    }

    #[test]
    fn only_old_unowned_staging_folders_are_removed() {
        let root = tempfile::tempdir().unwrap();
        let orphan = root.path().join("orphan");
        fs::create_dir(&orphan).unwrap();
        fs::write(orphan.join("IMG_1-Edit.tif"), b"render").unwrap();

        remove_orphaned_staging(root.path(), SystemTime::now());
        assert!(orphan.is_dir());
        remove_orphaned_staging(root.path(), SystemTime::now() + RETENTION * 2);
        assert!(!orphan.exists());
    }

    #[test]
    fn photo_craft_is_looked_for_in_its_install_locations() {
        let env = |name: &str| {
            let value = match name {
                "HOME" => "/Users/me",
                "ProgramFiles" => r"C:\Program Files",
                "LOCALAPPDATA" => r"C:\Users\me\AppData\Local",
                "PATH" => "/usr/local/bin:/usr/bin",
                _ => return None,
            };
            Some(std::ffi::OsString::from(value))
        };
        let expected: Vec<PathBuf> = if cfg!(target_os = "macos") {
            vec![
                "/Applications/PhotoCraft.app".into(),
                "/Users/me/Applications/PhotoCraft.app".into(),
            ]
        } else if cfg!(target_os = "windows") {
            vec![
                r"C:\Program Files\ArtCraft\PhotoCraft\photocraft.exe".into(),
                r"C:\Users\me\AppData\Local\Programs\ArtCraft\PhotoCraft\photocraft.exe".into(),
            ]
        } else {
            vec![
                "/usr/local/bin/photocraft".into(),
                "/usr/bin/photocraft".into(),
            ]
        };
        assert_eq!(photo_craft_candidates(env), expected);
        assert!(photo_craft_candidates(|_| None).len() <= 1);
    }

    #[test]
    fn free_destination_counts_up_past_existing_copies() {
        let folder = tempfile::tempdir().unwrap();
        let source = folder.path().join("IMG_1.CR3");
        let source_path = format!("{}?vc=2", source.display());
        let staged = |name: &str| Path::new("/cache/external-edits/session").join(name);
        assert_eq!(
            free_destination(&source_path, &staged("IMG_1-Edit.tif")),
            folder.path().join("IMG_1-Edit.tif")
        );

        fs::write(folder.path().join("IMG_1-Edit.tif"), b"").unwrap();
        fs::write(folder.path().join("IMG_1-Edit-2.tif"), b"").unwrap();
        assert_eq!(
            free_destination(&source_path, &staged("IMG_1-Edit.tif")),
            folder.path().join("IMG_1-Edit-3.tif")
        );
        assert_eq!(
            free_destination(&source_path, &staged("IMG_1-Edit.jpg")),
            folder.path().join("IMG_1-Edit.jpg")
        );
        assert_eq!(
            free_destination(&source_path, &staged("Sunset.tif")),
            folder.path().join("Sunset.tif")
        );
    }
}
