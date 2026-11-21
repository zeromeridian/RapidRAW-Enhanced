//! Lightroom-style **Edit In** round trip for external editors.
//!
//! **Open in** renders a hidden working copy beside the source
//! (`.<stem>-Edit.<ext>`; hidden files are not listed, `formats.rs`) and
//! opens it in the editor; **Open as Layers** does the same with one layered
//! TIFF of several photos (`layered_tiff.rs`), beside the first. As in
//! Lightroom Classic with Photoshop, nothing shows in the Library until the
//! editor saves: each settled save of the working copy is copied to
//! `<stem>-Edit.<ext>` beside the source (`-Edit-2`, … when taken), which is
//! added to the Library stacked with the source, and later saves replace that
//! copy. As the working copy sits in the photo's own folder, an editor whose
//! Save asks for a location (Photo Craft) opens its dialog there. Sessions are
//! kept in the catalog, so a save made while ThisIsRAW was closed is picked
//! up on the next launch, and end once they have seen no new save for
//! [`RETENTION`]; ending one deletes only its working copy. Whether the editor
//! opens it in a new window or a tab does not matter.
//!
//! Versions before 1.109.0 staged the copy in the app cache, where an editor
//! whose Save asks for a location never saved; [`finish_staged_sessions`]
//! copies out what such sessions still hold, once, and removes them.
//!
//! Edit Original opens a non-RAW file itself and watches it in place.
//!
//! An editor that quits with an error right after it was started (for example
//! a launcher that cannot open the file) ends an unsaved session and reports
//! why, instead of leaving it waiting for a save.

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
    ExportAdjustmentsMode, ExportSettings, SRGB_ICC_PROFILE, TiffBitDepth, export_images_impl,
};
use crate::file_management::{
    copy_file_atomically, modified_nanos, open_external_editor, parse_virtual_path,
};
use crate::formats::is_supported_image_file;
use crate::layered_tiff::{LayerSource, write_layered_tiff};
use crate::library_catalog::{self, EditorRoundTripRow, StagedFileRow};

/// The app-cache folder older versions staged their copies in, and Open as
/// Layers renders its layers in before it writes the layered file.
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

/// Open round trips: each watches its working copies (`files`).
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
    /// A new copy, which the Library has not listed yet.
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
        filename_texts: Vec::new(),
        filename_suffix: None,
        watermark: None,
        export_masks: false,
        preserve_folders: false,
        export_to_source_folder: false,
        subfolder: None,
    }
}

/// Renders `source_path` with its current adjustments to `output` and waits
/// until the file is written.
async fn render_copy(
    source_path: &str,
    output: &Path,
    output_format: &str,
    adjustments_mode: ExportAdjustmentsMode,
    state: tauri::State<'_, AppState>,
    app_handle: &AppHandle,
) -> Result<(), String> {
    let (completion_tx, completion_rx) = tokio::sync::oneshot::channel();
    export_images_impl(
        vec![source_path.to_owned()],
        output.to_string_lossy().into_owned(),
        true,
        Vec::new(),
        round_trip_export_settings(),
        output_format.to_owned(),
        adjustments_mode,
        Default::default(),
        state,
        app_handle.clone(),
        false,
        Some(completion_tx),
    )
    .await?;
    match completion_rx.await {
        Ok(Ok(())) if output.is_file() => Ok(()),
        Ok(_) => Err("Could not render the copy for the external editor".into()),
        Err(_) => Err("The external edit was cancelled".into()),
    }
}

/// Renders `source_path` with its current adjustments into a hidden working
/// copy beside it, opens that in the editor, and starts watching for saves.
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
    let working = working_copy_path(&source_path, extension);
    let adjustments_mode = ExportAdjustmentsMode::UseSidecars {
        active_path: current_edit_path,
        active_adjustments: current_edit_adjustments,
    };
    let rendered = render_copy(
        &source_path,
        &working,
        output_format,
        adjustments_mode,
        state,
        &app_handle,
    )
    .await;
    if let Err(error) = rendered {
        // The name was free, so anything there is this render's partial file.
        let _ = fs::remove_file(&working);
        return Err(error);
    }
    start_session(&app_handle, source_path, working, editor_path)
}

/// **Open as Layers**: renders each of `source_paths` (the first is the top
/// layer) with its current adjustments, one after another, into a temporary
/// folder, writes them as one layered 16-bit TIFF (with the first photo's
/// EXIF) into a hidden working copy beside the first photo, opens that in the
/// editor, and starts watching for saves; its copy is stacked with the first
/// photo.
#[tauri::command]
pub async fn start_layered_round_trip(
    source_paths: Vec<String>,
    editor_path: String,
    current_edit_path: Option<String>,
    current_edit_adjustments: Option<Value>,
    state: tauri::State<'_, AppState>,
    app_handle: AppHandle,
) -> Result<(), String> {
    let [top, _, ..] = source_paths.as_slice() else {
        return Err("Open as Layers needs at least two photos".into());
    };
    let top = top.clone();
    let renders = staging_root(&app_handle)?.join(uuid::Uuid::new_v4().to_string());
    fs::create_dir_all(&renders)
        .map_err(|error| format!("Could not create the external-edit folder: {error}"))?;
    let working = working_copy_path(&top, "tif");
    let adjustments_mode = ExportAdjustmentsMode::UseSidecars {
        active_path: current_edit_path,
        active_adjustments: current_edit_adjustments,
    };

    let written = async {
        let mut layers = Vec::with_capacity(source_paths.len());
        for (index, source_path) in source_paths.iter().enumerate() {
            let image = renders.join(format!("{index}.tif"));
            render_copy(
                source_path,
                &image,
                "tiff",
                adjustments_mode.clone(),
                state.clone(),
                &app_handle,
            )
            .await?;
            let (physical, _) = parse_virtual_path(source_path);
            layers.push(LayerSource {
                name: physical
                    .file_stem()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .into_owned(),
                image,
            });
        }
        let (physical_top, _) = parse_virtual_path(&top);
        let working = working.clone();
        tokio::task::spawn_blocking(move || {
            let metadata = crate::exif_processing::collect_export_metadata(
                &physical_top.to_string_lossy(),
                false,
                false,
                true,
            );
            write_layered_tiff(&working, &layers, metadata.as_ref(), SRGB_ICC_PROFILE)
        })
        .await
        .map_err(|error| format!("Could not write the layered file: {error}"))?
    }
    .await;
    let _ = fs::remove_dir_all(&renders);
    written?;
    start_session(&app_handle, top, working, editor_path)
}

/// The free hidden `.<stem>-Edit.<extension>` name beside the photo at
/// `source_path`.
fn working_copy_path(source_path: &str, extension: &str) -> PathBuf {
    let (source, _) = parse_virtual_path(source_path);
    let stem = source.file_stem().unwrap_or_default().to_string_lossy();
    free_destination(
        source.parent().unwrap_or(Path::new("")),
        &format!(".{stem}{EDIT_SUFFIX}"),
        extension,
    )
}

/// Opens the rendered `working` copy in the editor and records the session,
/// which watches it for saves. The editor's Save dialog suggests the hidden
/// name; the session also watches the visible `<stem>-Edit.<ext>` it would
/// copy a save to, so taking the dot off there saves the copy directly.
fn start_session(
    app_handle: &AppHandle,
    source_path: String,
    working: PathBuf,
    editor_path: String,
) -> Result<(), String> {
    let stamp = file_stamp(&working)
        .ok_or_else(|| "The copy for the external editor was not written".to_string())?;
    let editor = match open_external_editor(editor_path, working.to_string_lossy().into_owned()) {
        Ok(editor) => editor,
        Err(error) => {
            let _ = fs::remove_file(&working);
            return Err(error);
        }
    };
    let id = uuid::Uuid::new_v4().to_string();
    let session = EditorRoundTripRow {
        id: id.clone(),
        source_path: source_path.clone(),
        staging_dir: working
            .parent()
            .unwrap_or(Path::new(""))
            .to_string_lossy()
            .into_owned(),
        files: vec![
            StagedFileRow {
                path: working.to_string_lossy().into_owned(),
                len: stamp.len,
                modified: stamp.modified,
                destination: None,
            },
            // Not there yet: its first appearance is a save.
            StagedFileRow {
                path: copy_path(&source_path, &working)
                    .to_string_lossy()
                    .into_owned(),
                len: 0,
                modified: 0,
                destination: None,
            },
        ],
        created_at: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |duration| duration.as_secs() as i64),
    };
    if let Err(error) = library_catalog::save_editor_round_trip(app_handle, &session) {
        log::warn!("External edit will not survive a restart: {error}");
    }
    SESSIONS.lock().unwrap().push(session);
    watch_launch(editor, app_handle.clone(), source_path, move |app_handle| {
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

/// Resumes the catalog's sessions (finishing those of older versions) and
/// polls their working copies and the files opened with Edit Original.
pub fn start_watcher(app_handle: AppHandle) {
    thread::spawn(move || {
        let sessions =
            library_catalog::load_editor_round_trips(&app_handle).unwrap_or_else(|error| {
                log::warn!("Could not resume external edits: {error}");
                Vec::new()
            });
        let staging = staging_root(&app_handle).ok();
        let (staged, current): (Vec<_>, Vec<_>) = sessions.into_iter().partition(|session| {
            staging
                .as_deref()
                .is_some_and(|root| Path::new(&session.staging_dir).starts_with(root))
        });
        SESSIONS.lock().unwrap().extend(current);
        finish_staged_sessions(&app_handle, staged);

        // Files with an unhandled change, keyed by path, and the stamp the
        // previous poll saw.
        let mut unsettled: HashMap<String, FileStamp> = HashMap::new();
        loop {
            let now = SystemTime::now();
            let sessions = SESSIONS.lock().unwrap().clone();
            let originals = ORIGINALS.lock().unwrap().clone();
            let mut changed: HashMap<String, FileStamp> = HashMap::new();
            for mut session in sessions {
                let saves = changed_working_copies(&session);
                if saves.is_empty() {
                    if is_expired(&session, now) {
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

/// The working copies of `session` that changed since it last handled them.
/// A working copy that is missing for a moment (an editor that deletes it
/// before writing the save) is simply not reported.
fn changed_working_copies(session: &EditorRoundTripRow) -> Vec<(PathBuf, FileStamp)> {
    session
        .files
        .iter()
        .filter_map(|file| {
            let path = PathBuf::from(&file.path);
            let stamp = file_stamp(&path)?;
            (stamp.len != file.len || stamp.modified != file.modified).then_some((path, stamp))
        })
        .collect()
}

/// Forgets a session and deletes its hidden working copies; a copy saved
/// under its visible name stays.
fn end_session(app_handle: &AppHandle, id: &str) {
    let removed = {
        let mut sessions = SESSIONS.lock().unwrap();
        sessions
            .iter()
            .position(|session| session.id == id)
            .map(|index| sessions.remove(index))
    };
    let Some(session) = removed else { return };
    for file in session
        .files
        .iter()
        .filter(|file| is_hidden(Path::new(&file.path)))
    {
        if let Err(error) = fs::remove_file(&file.path)
            && error.kind() != std::io::ErrorKind::NotFound
        {
            log::warn!("Could not remove an external edit's working copy: {error}");
        }
    }
    if let Err(error) = library_catalog::delete_editor_round_trip(app_handle, id) {
        log::warn!("Could not forget external edit: {error}");
    }
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

/// Whether one of the session's copies beside the source matches `filter`.
fn has_copy(session: &EditorRoundTripRow, filter: impl Fn(&str) -> bool) -> bool {
    session
        .files
        .iter()
        .filter_map(|file| file.destination.as_deref())
        .any(filter)
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

/// Copies every save that a session of a version before 1.109.0 still holds
/// in its app-cache staging folder beside its source, as those versions did,
/// then forgets the session and deletes its folder. A session whose copy
/// fails (its source folder is offline, say) is kept for the next launch.
/// Staging folders no session owns are deleted.
fn finish_staged_sessions(app_handle: &AppHandle, sessions: Vec<EditorRoundTripRow>) {
    let mut kept = Vec::new();
    for mut session in sessions {
        let saves: Vec<_> = saved_files(Path::new(&session.staging_dir))
            .into_iter()
            .filter(|save| !is_handled(&session, save))
            .collect();
        let mut is_done = true;
        for save in saves {
            match copy_save(&mut session, &save) {
                Ok((output_path, is_new)) => {
                    let _ = app_handle.emit(
                        SAVED_EVENT,
                        RoundTripSaved {
                            source_path: session.source_path.clone(),
                            output_path,
                            is_new,
                        },
                    );
                }
                Err(error) => {
                    log::warn!("Could not save an older external edit: {error}");
                    is_done = false;
                }
            }
        }
        if !is_done {
            kept.push(PathBuf::from(&session.staging_dir));
        } else if let Err(error) =
            library_catalog::delete_editor_round_trip(app_handle, &session.id)
        {
            log::warn!("Could not forget an older external edit: {error}");
            kept.push(PathBuf::from(&session.staging_dir));
        }
    }
    if let Ok(root) = staging_root(app_handle) {
        remove_staging_except(&root, &kept);
    }
}

/// Deletes every folder in `root` but `kept`.
fn remove_staging_except(root: &Path, kept: &[PathBuf]) {
    let Ok(entries) = fs::read_dir(root) else {
        return;
    };
    for path in entries.filter_map(Result::ok).map(|entry| entry.path()) {
        if path.is_dir() && !kept.contains(&path) {
            let _ = fs::remove_dir_all(&path);
        }
    }
}

/// Whether the previous poll saw the file at `key` with the same stamp.
fn is_settled(unsettled: &HashMap<String, FileStamp>, key: &str, stamp: FileStamp) -> bool {
    unsettled.get(key) == Some(&stamp)
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

/// The images in a staging folder and its subfolders (editors that export
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

/// `<stem>.<extension>` in `folder`, with `-2`, `-3`, … when taken.
fn free_destination(folder: &Path, stem: &str, extension: &str) -> PathBuf {
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

/// Keeps external edits of renamed photos going (`renames`: physical old →
/// new paths): sessions follow their source and the copies their saves
/// update, and Edit Original keeps watching a renamed original.
pub fn follow_renames(app_handle: &AppHandle, renames: &HashMap<String, String>) {
    for session in SESSIONS.lock().unwrap().iter_mut() {
        let source_path = crate::rename::renamed_path(&session.source_path, renames);
        let mut changed = source_path != session.source_path;
        session.source_path = source_path;
        for file in &mut session.files {
            if let Some(new) = file.destination.as_ref().and_then(|d| renames.get(d)) {
                file.destination = Some(new.clone());
                changed = true;
            }
        }
        if changed && let Err(error) = library_catalog::save_editor_round_trip(app_handle, session)
        {
            log::warn!("Could not record a renamed external edit: {error}");
        }
    }
    let mut originals = ORIGINALS.lock().unwrap();
    for (old, new) in renames {
        if let Some(stamp) = originals.remove(old) {
            originals.insert(new.clone(), stamp);
        }
    }
}

/// The free name beside the photo at `source_path` that a save of `saved` is
/// copied to: its name without a hidden working copy's leading dot.
fn copy_path(source_path: &str, saved: &Path) -> PathBuf {
    let (source, _) = parse_virtual_path(source_path);
    free_destination(
        source.parent().unwrap_or(Path::new("")),
        saved
            .file_stem()
            .unwrap_or_default()
            .to_string_lossy()
            .trim_start_matches('.'),
        &saved.extension().unwrap_or_default().to_string_lossy(),
    )
}

/// Records a save: copies it beside the source, replacing the copy an earlier
/// save of the same file made, unless it was saved there under a visible name
/// already, which makes it the copy itself. Returns the copy's path and
/// whether the Library has yet to list it.
fn copy_save(
    session: &mut EditorRoundTripRow,
    (file, stamp): &(PathBuf, FileStamp),
) -> Result<(String, bool), String> {
    let path = file.to_string_lossy().into_owned();
    let (source, _) = parse_virtual_path(&session.source_path);
    let is_copy_itself = !is_hidden(file) && file.parent() == source.parent();
    let destination = if is_copy_itself {
        file.clone()
    } else {
        session
            .files
            .iter()
            .find(|handled| handled.path == path)
            .and_then(|handled| handled.destination.as_deref())
            .map_or_else(|| copy_path(&session.source_path, file), PathBuf::from)
    };
    let output_path = destination.to_string_lossy().into_owned();
    let is_new = !has_copy(session, |copy| copy == output_path);
    if !is_copy_itself {
        copy_file_atomically(file, &destination)?;
    }

    record_handled(session, &path, *stamp, &output_path);
    // The copy just written is watched too when it carries the visible name;
    // it must not count as another save.
    if !is_copy_itself
        && session.files.iter().any(|file| file.path == output_path)
        && let Some(copy_stamp) = file_stamp(&destination)
    {
        record_handled(session, &output_path, copy_stamp, &output_path);
    }
    Ok((output_path, is_new))
}

/// Marks `path` handled at `stamp`, with the copy its saves update.
fn record_handled(session: &mut EditorRoundTripRow, path: &str, stamp: FileStamp, copy: &str) {
    let handled = StagedFileRow {
        path: path.to_owned(),
        len: stamp.len,
        modified: stamp.modified,
        destination: Some(copy.to_owned()),
    };
    match session.files.iter_mut().find(|entry| entry.path == path) {
        Some(entry) => *entry = handled,
        None => session.files.push(handled),
    }
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

        // Save, then Save As to JPEG and to a second TIFF name.
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
    fn only_kept_staging_folders_survive() {
        let root = tempfile::tempdir().unwrap();
        let (kept, finished) = (root.path().join("kept"), root.path().join("finished"));
        for folder in [&kept, &finished] {
            fs::create_dir(folder).unwrap();
            fs::write(folder.join("IMG_1-Edit.tif"), b"render").unwrap();
        }

        remove_staging_except(root.path(), std::slice::from_ref(&kept));
        assert!(kept.is_dir());
        assert!(!finished.exists());
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
    fn working_copies_are_hidden_and_count_up_past_existing_ones() {
        let folder = tempfile::tempdir().unwrap();
        let source = folder.path().join("IMG_1.CR3");
        let source_path = format!("{}?vc=2", source.display());
        assert_eq!(
            working_copy_path(&source_path, "tif"),
            folder.path().join(".IMG_1-Edit.tif")
        );
        assert!(!is_supported_image_file(working_copy_path(
            &source_path,
            "tif"
        )));

        fs::write(folder.path().join(".IMG_1-Edit.tif"), b"").unwrap();
        fs::write(folder.path().join(".IMG_1-Edit-2.tif"), b"").unwrap();
        assert_eq!(
            working_copy_path(&source_path, "tif"),
            folder.path().join(".IMG_1-Edit-3.tif")
        );
        assert_eq!(
            working_copy_path(&source_path, "jpg"),
            folder.path().join(".IMG_1-Edit.jpg")
        );
        assert_eq!(
            free_destination(folder.path(), "Sunset", "tif"),
            folder.path().join("Sunset.tif")
        );
    }

    #[test]
    fn only_a_saved_working_copy_becomes_a_visible_copy() {
        let folder = tempfile::tempdir().unwrap();
        let source = folder.path().join("IMG_1.CR3");
        let working = folder.path().join(".IMG_1-Edit.tif");
        fs::write(&working, b"render").unwrap();
        let mut session = session_for(&working, file_stamp(&working).unwrap());
        session.source_path = source.to_string_lossy().into_owned();
        assert!(changed_working_copies(&session).is_empty());

        // The editor saves; its copy loses the dot. A copy already there
        // (another photo's, or an earlier edit's) is kept.
        fs::write(folder.path().join("IMG_1-Edit.tif"), b"earlier").unwrap();
        fs::write(&working, b"saved").unwrap();
        let saves = changed_working_copies(&session);
        assert_eq!(saves.len(), 1);
        let (copy, is_new) = copy_save(&mut session, &saves[0]).unwrap();
        assert!(is_new);
        assert_eq!(PathBuf::from(&copy), folder.path().join("IMG_1-Edit-2.tif"));
        assert_eq!(fs::read(&copy).unwrap(), b"saved");
        assert!(changed_working_copies(&session).is_empty());

        // The next save replaces that copy; a missing working copy is no save.
        fs::write(&working, b"saved again").unwrap();
        let saves = changed_working_copies(&session);
        assert_eq!(
            copy_save(&mut session, &saves[0]).unwrap(),
            (copy.clone(), false)
        );
        assert_eq!(fs::read(&copy).unwrap(), b"saved again");
        fs::remove_file(&working).unwrap();
        assert!(changed_working_copies(&session).is_empty());
    }

    /// A session as `start_session` records it: the working copy and the
    /// visible name its saves are copied to, not there yet.
    fn session_with_copy_name(folder: &Path) -> (EditorRoundTripRow, PathBuf, PathBuf) {
        let source = folder.join("IMG_1.CR3");
        let working = folder.join(".IMG_1-Edit.tif");
        fs::write(&working, b"render").unwrap();
        let mut session = session_for(&working, file_stamp(&working).unwrap());
        session.source_path = source.to_string_lossy().into_owned();
        let copy = copy_path(&session.source_path, &working);
        session.files.push(StagedFileRow {
            path: copy.to_string_lossy().into_owned(),
            len: 0,
            modified: 0,
            destination: None,
        });
        (session, working, copy)
    }

    #[test]
    fn saving_under_the_visible_name_makes_that_file_the_copy() {
        let folder = tempfile::tempdir().unwrap();
        let (mut session, working, copy) = session_with_copy_name(folder.path());
        assert_eq!(copy, folder.path().join("IMG_1-Edit.tif"));
        assert!(changed_working_copies(&session).is_empty());

        // The dot taken off in the editor's Save dialog.
        fs::write(&copy, b"saved").unwrap();
        let saves = changed_working_copies(&session);
        assert_eq!(saves, vec![(copy.clone(), file_stamp(&copy).unwrap())]);
        let expected = copy.to_string_lossy().into_owned();
        assert_eq!(
            copy_save(&mut session, &saves[0]).unwrap(),
            (expected.clone(), true)
        );
        assert_eq!(fs::read(&working).unwrap(), b"render");
        assert!(changed_working_copies(&session).is_empty());

        fs::write(&copy, b"saved again").unwrap();
        let saves = changed_working_copies(&session);
        assert_eq!(
            copy_save(&mut session, &saves[0]).unwrap(),
            (expected, false)
        );

        // Ending the session deletes only the hidden working copy.
        let hidden: Vec<&str> = session
            .files
            .iter()
            .map(|file| file.path.as_str())
            .filter(|path| is_hidden(Path::new(path)))
            .collect();
        assert_eq!(hidden, vec![working.to_string_lossy()]);
    }

    #[test]
    fn a_save_under_the_hidden_name_is_copied_once() {
        let folder = tempfile::tempdir().unwrap();
        let (mut session, working, copy) = session_with_copy_name(folder.path());
        fs::write(&working, b"saved").unwrap();
        let saves = changed_working_copies(&session);
        assert_eq!(saves.len(), 1);
        let (output, is_new) = copy_save(&mut session, &saves[0]).unwrap();
        assert_eq!((PathBuf::from(output), is_new), (copy.clone(), true));
        assert_eq!(fs::read(&copy).unwrap(), b"saved");
        // The copy it wrote is not another save.
        assert!(changed_working_copies(&session).is_empty());
    }

    #[test]
    fn sessions_expire_after_a_week_without_a_save() {
        let saved = UNIX_EPOCH + Duration::from_secs(1_800_000_000);
        let session = session_for(
            Path::new("/photos/.IMG_1-Edit.tif"),
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
}
