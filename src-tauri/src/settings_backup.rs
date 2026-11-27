//! Back Up / Restore Settings: the user files of the data folder (settings, presets, LUTs,
//! profiles, albums and, when ticked, the library catalog) in one `.zip`. A restore replaces
//! them all after saving the current state as a safety backup, but keeps this machine's
//! storage locations and hardware choices (`MACHINE_SETTINGS`).

use std::fs;
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager};
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

const BACKUP_FORMAT: &str = "ThisIsRAW settings backup";
const BACKUP_VERSION: u32 = 1;
const MANIFEST_FILE: &str = "manifest.json";
const SETTINGS_FILE: &str = "settings.json";
const CATALOG_FILE: &str = "library-catalog.sqlite3";
/// The data folder's user folders, backed up and restored whole.
const USER_FOLDERS: &[&str] = &["presets", "luts", "profiles", "albums"];
/// Settings that describe this machine rather than the user's work; a restore keeps them.
const MACHINE_SETTINGS: &[&str] = &[
    "catalogDirectory",
    "modelsDirectory",
    "processingBackend",
    "aiProvider",
    "aiGpuAcceleration",
    "linuxGpuOptimization",
];
/// Safety backups written before each restore, in the data folder; the newest are kept.
const SAFETY_FOLDER: &str = "restore-backups";
const SAFETY_BACKUPS_KEPT: usize = 3;
const STAGING_FOLDER: &str = ".restore-staging";

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Manifest {
    format: String,
    version: u32,
    app_version: String,
    created: String,
    includes_catalog: bool,
}

fn data_dir(app_handle: &AppHandle) -> Result<PathBuf, String> {
    app_handle
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())
}

fn zip_error(error: zip::result::ZipError) -> String {
    error.to_string()
}

fn io_error(error: io::Error) -> String {
    error.to_string()
}

fn add_file<W: Write + io::Seek>(
    writer: &mut ZipWriter<W>,
    name: &str,
    bytes: &[u8],
) -> Result<(), String> {
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
    writer.start_file(name, options).map_err(zip_error)?;
    writer.write_all(bytes).map_err(io_error)
}

/// Adds every file below `folder`, named `<prefix>/<relative path>` with `/` separators on
/// every platform.
fn add_folder<W: Write + io::Seek>(
    writer: &mut ZipWriter<W>,
    folder: &Path,
    prefix: &str,
) -> Result<(), String> {
    if !folder.is_dir() {
        return Ok(());
    }
    for entry in walkdir::WalkDir::new(folder).sort_by_file_name() {
        let entry = entry.map_err(|error| error.to_string())?;
        if !entry.file_type().is_file() {
            continue;
        }
        let relative = entry
            .path()
            .strip_prefix(folder)
            .map_err(|error| error.to_string())?;
        let parts: Vec<String> = relative
            .components()
            .map(|part| part.as_os_str().to_string_lossy().into_owned())
            .collect();
        let bytes = fs::read(entry.path()).map_err(io_error)?;
        add_file(writer, &format!("{prefix}/{}", parts.join("/")), &bytes)?;
    }
    Ok(())
}

/// Writes the backup to `target`, through a temporary file so a failed backup leaves no
/// partial `.zip`.
fn write_backup(
    app_handle: &AppHandle,
    target: &Path,
    include_catalog: bool,
) -> Result<(), String> {
    let data = data_dir(app_handle)?;
    let temporary = target.with_extension("zip.part");
    let catalog_copy = data.join(format!(".backup-catalog-{}.sqlite3", std::process::id()));
    let result = (|| {
        let mut writer = ZipWriter::new(fs::File::create(&temporary).map_err(io_error)?);

        let settings = crate::app_settings::load_settings(app_handle.clone())?;
        let settings_json = serde_json::to_vec_pretty(&settings).map_err(|e| e.to_string())?;
        add_file(&mut writer, SETTINGS_FILE, &settings_json)?;
        for folder in USER_FOLDERS {
            add_folder(&mut writer, &data.join(folder), folder)?;
        }
        let includes_catalog =
            include_catalog && crate::library_catalog::back_up_catalog(app_handle, &catalog_copy)?;
        if includes_catalog {
            add_file(
                &mut writer,
                CATALOG_FILE,
                &fs::read(&catalog_copy).map_err(io_error)?,
            )?;
        }

        let manifest = Manifest {
            format: BACKUP_FORMAT.to_string(),
            version: BACKUP_VERSION,
            app_version: app_handle.package_info().version.to_string(),
            created: chrono::Local::now().to_rfc3339(),
            includes_catalog,
        };
        let manifest_json = serde_json::to_vec_pretty(&manifest).map_err(|e| e.to_string())?;
        add_file(&mut writer, MANIFEST_FILE, &manifest_json)?;
        writer
            .finish()
            .map_err(zip_error)?
            .sync_all()
            .map_err(io_error)?;
        fs::rename(&temporary, target).map_err(io_error)
    })();
    let _ = fs::remove_file(&catalog_copy);
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

fn read_manifest(archive: &mut ZipArchive<fs::File>) -> Result<Manifest, String> {
    let not_a_backup = || "This file is not a ThisIsRAW settings backup.".to_string();
    let mut text = String::new();
    archive
        .by_name(MANIFEST_FILE)
        .map_err(|_| not_a_backup())?
        .read_to_string(&mut text)
        .map_err(io_error)?;
    let manifest: Manifest = serde_json::from_str(&text).map_err(|_| not_a_backup())?;
    if manifest.format != BACKUP_FORMAT {
        return Err(not_a_backup());
    }
    if manifest.version > BACKUP_VERSION {
        return Err(format!(
            "This backup was made by a newer ThisIsRAW ({}). Update ThisIsRAW to restore it.",
            manifest.app_version
        ));
    }
    Ok(manifest)
}

/// Whether an archive entry is one a restore writes: the settings, the catalog or a file in
/// a user folder. Anything else (and any path leaving the folder) is ignored.
fn is_restorable(relative: &Path) -> bool {
    let mut components = relative.components();
    match components
        .next()
        .and_then(|first| first.as_os_str().to_str())
    {
        Some(SETTINGS_FILE | CATALOG_FILE) => components.next().is_none(),
        Some(folder) => USER_FOLDERS.contains(&folder) && components.next().is_some(),
        None => false,
    }
}

/// Extracts the restorable entries into `staging`.
fn extract(archive: &mut ZipArchive<fs::File>, staging: &Path) -> Result<(), String> {
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(zip_error)?;
        let Some(relative) = entry.enclosed_name() else {
            continue;
        };
        if !entry.is_file() || !is_restorable(&relative) {
            continue;
        }
        let target = staging.join(&relative);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(io_error)?;
        }
        let mut file = fs::File::create(&target).map_err(io_error)?;
        io::copy(&mut entry, &mut file).map_err(io_error)?;
    }
    Ok(())
}

/// The backup's settings with this machine's `MACHINE_SETTINGS` kept.
fn merge_machine_settings(mut restored: Value, current: &Value) -> Value {
    if let (Some(restored), Some(current)) = (restored.as_object_mut(), current.as_object()) {
        for key in MACHINE_SETTINGS {
            match current.get(*key) {
                Some(value) => restored.insert((*key).to_string(), value.clone()),
                None => restored.remove(*key),
            };
        }
    }
    restored
}

/// The safety backup's path, dropping the oldest beyond `SAFETY_BACKUPS_KEPT`.
fn next_safety_backup(data: &Path) -> Result<PathBuf, String> {
    let folder = data.join(SAFETY_FOLDER);
    fs::create_dir_all(&folder).map_err(io_error)?;
    let mut existing: Vec<PathBuf> = fs::read_dir(&folder)
        .map_err(io_error)?
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| path.extension().is_some_and(|extension| extension == "zip"))
        .collect();
    existing.sort();
    let surplus = (existing.len() + 1).saturating_sub(SAFETY_BACKUPS_KEPT);
    for old in existing.into_iter().take(surplus) {
        let _ = fs::remove_file(old);
    }
    let stamp = chrono::Local::now().format("%Y-%m-%d %H%M%S");
    Ok(folder.join(format!("Before restore {stamp}.zip")))
}

fn restore(app_handle: &AppHandle, backup: &Path) -> Result<(), String> {
    let mut archive =
        ZipArchive::new(fs::File::open(backup).map_err(io_error)?).map_err(zip_error)?;
    let manifest = read_manifest(&mut archive)?;
    if archive.by_name(SETTINGS_FILE).is_err() {
        return Err("This backup holds no settings.".to_string());
    }

    let data = data_dir(app_handle)?;
    let safety_backup = next_safety_backup(&data)?;
    write_backup(app_handle, &safety_backup, true)?;

    let staging = data.join(STAGING_FOLDER);
    let _ = fs::remove_dir_all(&staging);
    let result = (|| -> Result<(), String> {
        fs::create_dir_all(&staging).map_err(io_error)?;
        extract(&mut archive, &staging)?;

        let restored: Value =
            serde_json::from_slice(&fs::read(staging.join(SETTINGS_FILE)).map_err(io_error)?)
                .map_err(|error| format!("The backup's settings cannot be read: {error}"))?;
        let current = serde_json::to_value(crate::app_settings::load_settings(app_handle.clone())?)
            .map_err(|error| error.to_string())?;
        let settings = serde_json::from_value(merge_machine_settings(restored, &current))
            .map_err(|error| format!("The backup's settings cannot be read: {error}"))?;

        for folder in USER_FOLDERS {
            let live = data.join(folder);
            if live.exists() {
                fs::remove_dir_all(&live).map_err(io_error)?;
            }
            let staged = staging.join(folder);
            if staged.is_dir() {
                fs::rename(&staged, &live).map_err(io_error)?;
            }
        }
        crate::app_settings::save_settings(settings, app_handle.clone())?;

        // Without a catalog in the backup, this machine's catalog stays.
        let catalog = staging.join(CATALOG_FILE);
        if manifest.includes_catalog && catalog.is_file() {
            crate::library_catalog::restore_catalog(app_handle, &catalog)?;
        }
        Ok(())
    })();
    let _ = fs::remove_dir_all(&staging);
    result.map_err(|error| {
        format!(
            "{error}. The state before the restore is saved in {}.",
            safety_backup.display()
        )
    })
}

/// Writes a settings backup to `path`.
#[tauri::command]
pub async fn back_up_settings(
    path: String,
    include_catalog: bool,
    app_handle: AppHandle,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        write_backup(&app_handle, Path::new(&path), include_catalog)
    })
    .await
    .map_err(|error| error.to_string())?
}

/// Replaces the user files with the backup at `path`; the app relaunches afterwards so
/// every cache reads the restored files.
#[tauri::command]
pub async fn restore_settings(path: String, app_handle: AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || restore(&app_handle, Path::new(&path)))
        .await
        .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::{add_file, add_folder, extract, is_restorable, merge_machine_settings};
    use serde_json::json;
    use std::fs;
    use std::path::Path;
    use zip::{ZipArchive, ZipWriter};

    /// User folders survive a backup and restore with their subfolders, and entries outside
    /// them (or leaving the folder) are not written.
    #[test]
    fn folders_round_trip_through_the_zip() {
        let directory =
            std::env::temp_dir().join(format!("tir-settings-backup-{}", std::process::id()));
        let _ = fs::remove_dir_all(&directory);
        let luts = directory.join("data").join("luts");
        fs::create_dir_all(luts.join("Film")).unwrap();
        fs::write(luts.join("Film").join("warm.cube"), b"LUT").unwrap();
        let backup = directory.join("backup.zip");

        let mut writer = ZipWriter::new(fs::File::create(&backup).unwrap());
        add_folder(&mut writer, &luts, "luts").unwrap();
        add_file(&mut writer, "settings.json", b"{}").unwrap();
        add_file(&mut writer, "notes.txt", b"ignored").unwrap();
        add_file(&mut writer, "../escape.json", b"ignored").unwrap();
        writer.finish().unwrap();

        let staging = directory.join("staging");
        let mut archive = ZipArchive::new(fs::File::open(&backup).unwrap()).unwrap();
        extract(&mut archive, &staging).unwrap();

        assert_eq!(
            fs::read(staging.join("luts").join("Film").join("warm.cube")).unwrap(),
            b"LUT"
        );
        assert_eq!(fs::read(staging.join("settings.json")).unwrap(), b"{}");
        assert!(!staging.join("notes.txt").exists());
        assert!(!directory.join("escape.json").exists());
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn only_user_files_are_restored() {
        assert!(is_restorable(Path::new("settings.json")));
        assert!(is_restorable(Path::new("library-catalog.sqlite3")));
        assert!(is_restorable(Path::new("presets/presets.json")));
        assert!(is_restorable(Path::new("luts/Film/warm.cube")));
        assert!(!is_restorable(Path::new("presets")));
        assert!(!is_restorable(Path::new("settings.json/x")));
        assert!(!is_restorable(Path::new("manifest.json")));
        assert!(!is_restorable(Path::new("models/lama_fp16.onnx")));
        assert!(!is_restorable(Path::new("restore-backups/old.zip")));
    }

    #[test]
    fn a_restore_keeps_this_machines_locations_and_hardware() {
        let restored = json!({
            "theme": "light",
            "catalogDirectory": "/Volumes/Other/catalog",
            "aiProvider": "cuda",
            "modelsDirectory": "/Volumes/Other/models",
        });
        let current = json!({
            "theme": "dark",
            "catalogDirectory": "/Users/me/catalog",
            "aiProvider": "cpu",
            "aiGpuAcceleration": false,
        });

        let merged = merge_machine_settings(restored, &current);

        assert_eq!(merged["theme"], "light");
        assert_eq!(merged["catalogDirectory"], "/Users/me/catalog");
        assert_eq!(merged["aiProvider"], "cpu");
        assert_eq!(merged["aiGpuAcceleration"], false);
        assert!(merged.get("modelsDirectory").is_none());
    }
}
