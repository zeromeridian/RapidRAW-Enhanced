//! Where the downloaded AI models live. They stay out of the data folder, which holds only
//! user files worth backing up: by default in a sibling folder `<identifier>.models` of the
//! local data folder (macOS `~/Library/Application Support`, Linux `~/.local/share`, Windows
//! `%LOCALAPPDATA%`, so never in the roaming profile), or in the folder chosen in Settings
//! (`models_directory`), which may sit on an external drive.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, Manager, State};

use crate::app_state::AppState;

/// The folder of the models before they left the data folder.
const LEGACY_MODELS_FOLDER: &str = "models";

fn default_models_dir(app_handle: &AppHandle) -> Result<PathBuf, String> {
    let local_data = app_handle
        .path()
        .app_local_data_dir()
        .map_err(|error| error.to_string())?;
    let parent = local_data
        .parent()
        .ok_or_else(|| format!("{} has no parent folder", local_data.display()))?;
    Ok(parent.join(format!("{}.models", app_handle.config().identifier)))
}

fn configured_models_dir(app_handle: &AppHandle) -> Option<PathBuf> {
    crate::app_settings::load_settings(app_handle.clone())
        .ok()?
        .models_directory
        .as_deref()
        .map(str::trim)
        .filter(|directory| !directory.is_empty())
        .map(PathBuf::from)
}

/// The models folder in use, whether or not it exists.
fn current_models_dir(app_handle: &AppHandle) -> Result<PathBuf, String> {
    match configured_models_dir(app_handle) {
        Some(directory) => Ok(directory),
        None => default_models_dir(app_handle),
    }
}

/// The folder to read and download models in. The default folder is created when missing;
/// a chosen folder is not, since a missing one usually means its drive is unplugged, and
/// creating it would quietly fill another disk.
pub fn models_dir(app_handle: &AppHandle) -> Result<PathBuf, String> {
    match configured_models_dir(app_handle) {
        Some(directory) if directory.is_dir() => Ok(directory),
        Some(directory) => Err(format!(
            "The AI models folder {} is not available. Connect its drive, or choose another \
             folder or Use Default in Settings → Storage.",
            directory.display()
        )),
        None => {
            let directory = default_models_dir(app_handle)?;
            fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
            Ok(directory)
        }
    }
}

/// Moves one file, copying it when a rename is impossible (another drive). A file already at
/// the target wins: the downloader checks its hash and replaces it when it is damaged.
fn move_file(source: &Path, target: &Path) -> io::Result<()> {
    if target.exists() {
        return fs::remove_file(source);
    }
    if fs::rename(source, target).is_ok() {
        return Ok(());
    }
    let temporary = target.with_extension("move.tmp");
    let copied = fs::copy(source, &temporary).and_then(|_| fs::rename(&temporary, target));
    if copied.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    copied?;
    fs::remove_file(source)
}

/// Moves the files named in `filenames` (or every file when `None`) from `source` to `target`.
/// A file that cannot be moved is left behind and simply downloaded again where needed.
fn move_model_files(source: &Path, target: &Path, filenames: Option<&[&str]>) {
    let Ok(entries) = fs::read_dir(source) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let wanted = filenames.is_none_or(|names| names.iter().any(|known| name == *known));
        if !wanted || !entry.file_type().is_ok_and(|file_type| file_type.is_file()) {
            continue;
        }
        if let Err(error) = move_file(&entry.path(), &target.join(&name)) {
            log::warn!(
                "Could not move AI model {} to {}: {}",
                entry.path().display(),
                target.display(),
                error
            );
        }
    }
}

/// Moves the models out of the data folder once, in the background. AI tools wait on the
/// models lock meanwhile, so none downloads a model that is still being moved.
pub fn migrate_legacy_models_dir(app_handle: &AppHandle) {
    let Ok(legacy) = app_handle
        .path()
        .app_data_dir()
        .map(|data| data.join(LEGACY_MODELS_FOLDER))
    else {
        return;
    };
    if !legacy.is_dir() {
        return;
    }
    let app_handle = app_handle.clone();
    std::thread::spawn(move || {
        let state = app_handle.state::<AppState>();
        let _models_lock = state.ai_init_lock.blocking_lock();
        let target = match default_models_dir(&app_handle).and_then(|target| {
            fs::create_dir_all(&target)
                .map(|_| target)
                .map_err(|e| e.to_string())
        }) {
            Ok(target) => target,
            Err(error) => {
                log::warn!("AI models stay in the data folder for now: {error}");
                return;
            }
        };
        move_model_files(&legacy, &target, None);
        if let Err(error) = fs::remove_dir_all(&legacy) {
            log::warn!("Could not remove {}: {}", legacy.display(), error);
        }
    });
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelsLocation {
    pub path: String,
    /// The chosen folder, `None` for the default.
    pub directory: Option<String>,
    pub available: bool,
}

fn models_location(app_handle: &AppHandle) -> Result<ModelsLocation, String> {
    let path = current_models_dir(app_handle)?;
    let directory = configured_models_dir(app_handle).map(|_| path.to_string_lossy().into_owned());
    Ok(ModelsLocation {
        available: directory.is_none() || path.is_dir(),
        path: path.to_string_lossy().into_owned(),
        directory,
    })
}

#[tauri::command]
pub fn get_models_location(app_handle: AppHandle) -> Result<ModelsLocation, String> {
    models_location(&app_handle)
}

/// Uses `directory` (or the default for `None`) for the AI models, moving the known model
/// files there from the current folder when it is reachable.
#[tauri::command]
pub async fn move_models_folder(
    directory: Option<String>,
    app_handle: AppHandle,
    state: State<'_, AppState>,
) -> Result<ModelsLocation, String> {
    let _models_lock = state.ai_init_lock.lock().await;
    let default = default_models_dir(&app_handle)?;
    let chosen = match directory
        .as_deref()
        .map(str::trim)
        .filter(|directory| !directory.is_empty())
    {
        Some(directory) => Some(
            Path::new(directory)
                .canonicalize()
                .map_err(|error| error.to_string())?,
        ),
        None => None,
    }
    .filter(|directory| *directory != default);
    let source = current_models_dir(&app_handle)?;
    let target = match &chosen {
        Some(directory) => directory.clone(),
        None => {
            fs::create_dir_all(&default).map_err(|error| error.to_string())?;
            default
        }
    };

    // Loaded sessions keep the old folder (and on Windows its files open); drop them so the
    // next use reads the new one.
    crate::ai_processing::reset_ai_sessions(&state.ai_state);
    if source != target && source.is_dir() {
        let (source, target) = (source.clone(), target.clone());
        tauri::async_runtime::spawn_blocking(move || {
            move_model_files(
                &source,
                &target,
                Some(crate::ai_processing::MODEL_FILENAMES),
            )
        })
        .await
        .map_err(|error| error.to_string())?;
    }

    let mut settings = crate::app_settings::load_settings(app_handle.clone())?;
    settings.models_directory = chosen.map(|directory| directory.to_string_lossy().into_owned());
    crate::app_settings::save_settings(settings, app_handle.clone())?;
    models_location(&app_handle)
}

#[cfg(test)]
mod tests {
    use super::move_model_files;
    use std::fs;
    use std::path::PathBuf;

    fn scratch_dir(name: &str) -> PathBuf {
        let directory =
            std::env::temp_dir().join(format!("tir-models-location-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&directory);
        fs::create_dir_all(directory.join("source")).unwrap();
        fs::create_dir_all(directory.join("target")).unwrap();
        directory
    }

    /// Moving between chosen folders takes only the model files, so a user's own files in a
    /// folder picked for the models stay where they are.
    #[test]
    fn only_known_model_files_move() {
        let directory = scratch_dir("known");
        let (source, target) = (directory.join("source"), directory.join("target"));
        fs::write(source.join("lama_fp16.onnx"), b"model").unwrap();
        fs::write(source.join("notes.txt"), b"mine").unwrap();

        move_model_files(&source, &target, Some(&["lama_fp16.onnx"]));

        assert_eq!(fs::read(target.join("lama_fp16.onnx")).unwrap(), b"model");
        assert!(!source.join("lama_fp16.onnx").exists());
        assert!(source.join("notes.txt").exists());
        assert!(!target.join("notes.txt").exists());
        let _ = fs::remove_dir_all(directory);
    }

    /// A model already in the target is kept and the moved copy dropped.
    #[test]
    fn a_model_already_in_the_target_wins() {
        let directory = scratch_dir("existing");
        let (source, target) = (directory.join("source"), directory.join("target"));
        fs::write(source.join("a.onnx"), b"old").unwrap();
        fs::write(target.join("a.onnx"), b"new").unwrap();

        move_model_files(&source, &target, None);

        assert_eq!(fs::read(target.join("a.onnx")).unwrap(), b"new");
        assert!(!source.join("a.onnx").exists());
        let _ = fs::remove_dir_all(directory);
    }
}
