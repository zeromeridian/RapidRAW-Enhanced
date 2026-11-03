//! Lightroom-style **Edit In** round trip for external editors.
//!
//! A rendered copy is staged in the app cache and opened in the editor. Only
//! when the editor saves into that staging folder is the result copied beside
//! the source (`<stem>-Edit.<ext>`) and added to the Library, so abandoned
//! edits leave nothing behind. Later saves replace the same copy. Sessions are
//! kept in the catalog, so a save made while ThisIsRAW was closed is picked up
//! on the next launch.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager};

use crate::AppState;
use crate::export_processing::{
    ExportAdjustmentsMode, ExportSettings, TiffBitDepth, export_images_impl,
};
use crate::file_management::{
    copy_file_atomically, modified_nanos, open_external_editor, parse_virtual_path,
};
use crate::formats::is_supported_image_file;
use crate::library_catalog::{self, EditorRoundTripRow};

const STAGING_FOLDER: &str = "external-edits";
const EDIT_SUFFIX: &str = "-Edit";
const SAVED_EVENT: &str = "editor-round-trip-saved";
/// Editors write a save in several steps. A file counts as saved once two
/// consecutive polls see the same size and modification time. Polling, rather
/// than change notifications, also works on network volumes.
const POLL_INTERVAL: Duration = Duration::from_millis(1500);

static SESSIONS: LazyLock<Mutex<Vec<EditorRoundTripRow>>> = LazyLock::new(Default::default);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct FileStamp {
    len: u64,
    modified: u64,
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
    format: String,
    current_edit_path: Option<String>,
    current_edit_adjustments: Option<Value>,
    state: tauri::State<'_, AppState>,
    app_handle: AppHandle,
) -> Result<(), String> {
    let extension = match format.as_str() {
        "tiff" => "tif",
        "jpeg" => "jpg",
        _ => return Err(format!("Unsupported external-edit format: {format}")),
    };
    let id = uuid::Uuid::new_v4().to_string();
    let staging_dir = app_handle
        .path()
        .app_cache_dir()
        .map_err(|error| error.to_string())?
        .join(STAGING_FOLDER)
        .join(&id);
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
            format,
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
        open_external_editor(editor_path, staged_file.to_string_lossy().into_owned())?;
        Ok::<_, String>(stamp)
    }
    .await;
    let stamp = match rendered {
        Ok(stamp) => stamp,
        Err(error) => {
            let _ = fs::remove_dir_all(&staging_dir);
            return Err(error);
        }
    };

    let session = EditorRoundTripRow {
        id,
        source_path,
        staging_dir: staging_dir.to_string_lossy().into_owned(),
        destination: None,
        saved_file: staged_file.to_string_lossy().into_owned(),
        saved_len: stamp.len,
        saved_modified: stamp.modified,
        created_at: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |duration| duration.as_secs() as i64),
    };
    if let Err(error) = library_catalog::save_editor_round_trip(&app_handle, &session) {
        log::warn!("External edit will not survive a restart: {error}");
    }
    SESSIONS.lock().unwrap().push(session);
    Ok(())
}

/// Resumes the catalog's sessions and polls their staging folders.
pub fn start_watcher(app_handle: AppHandle) {
    thread::spawn(move || {
        match library_catalog::load_editor_round_trips(&app_handle) {
            Ok(rows) => SESSIONS.lock().unwrap().extend(
                rows.into_iter()
                    .filter(|row| Path::new(&row.staging_dir).is_dir()),
            ),
            Err(error) => log::warn!("Could not resume external edits: {error}"),
        }

        let mut unsettled: HashMap<String, (PathBuf, FileStamp)> = HashMap::new();
        loop {
            thread::sleep(POLL_INTERVAL);
            let sessions = SESSIONS.lock().unwrap().clone();
            unsettled.retain(|id, _| sessions.iter().any(|session| &session.id == id));
            for session in sessions {
                let Some(latest) = latest_saved_file(Path::new(&session.staging_dir)) else {
                    unsettled.remove(&session.id);
                    continue;
                };
                if is_handled(&session, &latest) {
                    unsettled.remove(&session.id);
                } else if unsettled.get(&session.id) != Some(&latest) {
                    unsettled.insert(session.id.clone(), latest);
                } else {
                    // A failure (for example a file the editor still has
                    // locked on Windows) stays unsettled and retries next poll.
                    match promote(&app_handle, session, &latest) {
                        Ok(id) => {
                            unsettled.remove(&id);
                        }
                        Err(error) => log::warn!("Could not save external edit: {error}"),
                    }
                }
            }
        }
    });
}

fn file_stamp(path: &Path) -> Option<FileStamp> {
    let metadata = fs::metadata(path).ok()?;
    metadata.is_file().then(|| FileStamp {
        len: metadata.len(),
        modified: modified_nanos(path),
    })
}

/// The newest image the editor saved into the staging folder. Hidden files
/// and files ThisIsRAW cannot open, such as editor temporaries and PSDs, are
/// ignored.
fn latest_saved_file(staging_dir: &Path) -> Option<(PathBuf, FileStamp)> {
    fs::read_dir(staging_dir)
        .ok()?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| {
            !path
                .file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.starts_with('.'))
                && is_supported_image_file(path)
        })
        .filter_map(|path| file_stamp(&path).map(|stamp| (path, stamp)))
        .max_by_key(|(_, stamp)| stamp.modified)
}

fn is_handled(session: &EditorRoundTripRow, (file, stamp): &(PathBuf, FileStamp)) -> bool {
    Path::new(&session.saved_file) == file
        && session.saved_len == stamp.len
        && session.saved_modified == stamp.modified
}

/// `<stem>-Edit.<ext>` beside the source, or `-Edit-2`, `-Edit-3`, … when taken.
fn free_destination(source_path: &str, extension: &str) -> PathBuf {
    let (source, _) = parse_virtual_path(source_path);
    let folder = source.parent().unwrap_or(Path::new(""));
    let stem = source.file_stem().unwrap_or_default().to_string_lossy();
    (1u32..)
        .map(|number| {
            let counter = if number == 1 {
                String::new()
            } else {
                format!("-{number}")
            };
            folder.join(format!("{stem}{EDIT_SUFFIX}{counter}.{extension}"))
        })
        .find(|candidate| !candidate.exists())
        .expect("an unused file name exists")
}

/// Copies a settled save beside the source, replacing this session's earlier
/// copy unless the editor changed the file type. Returns the session id.
fn promote(
    app_handle: &AppHandle,
    mut session: EditorRoundTripRow,
    (file, stamp): &(PathBuf, FileStamp),
) -> Result<String, String> {
    let extension = file
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or_default();
    let previous = session
        .destination
        .as_deref()
        .map(PathBuf::from)
        .filter(|destination| {
            destination
                .extension()
                .and_then(|extension| extension.to_str())
                == Some(extension)
        });
    let is_new = previous.is_none();
    let destination = previous.unwrap_or_else(|| free_destination(&session.source_path, extension));
    copy_file_atomically(file, &destination)?;

    let output_path = destination.to_string_lossy().into_owned();
    session.destination = Some(output_path.clone());
    session.saved_file = file.to_string_lossy().into_owned();
    session.saved_len = stamp.len;
    session.saved_modified = stamp.modified;
    if let Err(error) = library_catalog::save_editor_round_trip(app_handle, &session) {
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
            source_path: session.source_path,
            output_path,
            is_new,
        },
    );
    Ok(session.id)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn session_for(staged_file: &Path, stamp: FileStamp) -> EditorRoundTripRow {
        EditorRoundTripRow {
            id: "session".to_owned(),
            source_path: "/photos/IMG_1.CR3".to_owned(),
            staging_dir: staged_file.parent().unwrap().to_string_lossy().into_owned(),
            destination: None,
            saved_file: staged_file.to_string_lossy().into_owned(),
            saved_len: stamp.len,
            saved_modified: stamp.modified,
            created_at: 0,
        }
    }

    #[test]
    fn latest_saved_file_ignores_hidden_and_unreadable_files() {
        let staging = tempfile::tempdir().unwrap();
        let staged = staging.path().join("IMG_1-Edit.tif");
        fs::write(&staged, b"render").unwrap();
        fs::write(staging.path().join(".IMG_1-Edit.tif.tmp"), b"partial").unwrap();
        fs::write(staging.path().join("IMG_1-Edit.psd"), b"layers").unwrap();

        let (latest, stamp) = latest_saved_file(staging.path()).unwrap();
        assert_eq!(latest, staged);
        assert_eq!(stamp.len, 6);
    }

    #[test]
    fn only_a_changed_save_is_unhandled() {
        let staging = tempfile::tempdir().unwrap();
        let staged = staging.path().join("IMG_1-Edit.tif");
        fs::write(&staged, b"render").unwrap();
        let rendered = latest_saved_file(staging.path()).unwrap();
        let session = session_for(&staged, rendered.1);
        assert!(is_handled(&session, &rendered));

        fs::write(&staged, b"saved by the editor").unwrap();
        assert!(!is_handled(
            &session,
            &latest_saved_file(staging.path()).unwrap()
        ));
    }

    #[test]
    fn free_destination_counts_up_past_existing_copies() {
        let folder = tempfile::tempdir().unwrap();
        let source = folder.path().join("IMG_1.CR3");
        let source_path = format!("{}?vc=2", source.display());
        assert_eq!(
            free_destination(&source_path, "tif"),
            folder.path().join("IMG_1-Edit.tif")
        );

        fs::write(folder.path().join("IMG_1-Edit.tif"), b"").unwrap();
        fs::write(folder.path().join("IMG_1-Edit-2.tif"), b"").unwrap();
        assert_eq!(
            free_destination(&source_path, "tif"),
            folder.path().join("IMG_1-Edit-3.tif")
        );
        assert_eq!(
            free_destination(&source_path, "jpg"),
            folder.path().join("IMG_1-Edit.jpg")
        );
    }
}
