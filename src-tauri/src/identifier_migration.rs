use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

const OLD_IDENTIFIER: &str = "io.github.CyberTimon.RapidRAW";
const MIGRATION_MARKER: &str = ".identifier-migration-v1";
const CACHE_MIGRATION_MARKER: &str = ".identifier-cache-migration-v1";

fn old_sibling(path: &Path) -> Option<PathBuf> {
    path.parent().map(|parent| parent.join(OLD_IDENTIFIER))
}

fn copy_file_if_missing(source: &Path, target: &Path) -> Result<(), String> {
    if target.exists() {
        return Ok(());
    }
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let temporary = target.with_extension(format!("migration-{}.tmp", std::process::id()));
    if temporary.exists() {
        fs::remove_file(&temporary).map_err(|error| error.to_string())?;
    }
    let result = (|| {
        fs::copy(source, &temporary).map_err(|error| error.to_string())?;
        fs::rename(&temporary, target).map_err(|error| error.to_string())
    })();
    if result.is_err() {
        let _ = fs::remove_file(temporary);
    }
    result
}

fn copy_directory_contents(source: &Path, target: &Path) -> Result<(), String> {
    if !source.is_dir() {
        return Ok(());
    }
    fs::create_dir_all(target).map_err(|error| error.to_string())?;
    for entry in fs::read_dir(source).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let file_type = entry.file_type().map_err(|error| error.to_string())?;
        let source_path = entry.path();
        let target_path = target.join(entry.file_name());
        if file_type.is_dir() {
            copy_directory_contents(&source_path, &target_path)?;
        } else if file_type.is_file() {
            copy_file_if_missing(&source_path, &target_path)?;
        }
    }
    Ok(())
}

fn remap_path(path: &Path, directory_pairs: &[(PathBuf, PathBuf)]) -> Option<PathBuf> {
    directory_pairs.iter().find_map(|(old, new)| {
        path.strip_prefix(old)
            .ok()
            .map(|relative| new.join(relative))
    })
}

pub fn migrate_from_previous_identifier(app_handle: &AppHandle) -> Result<(), String> {
    let app_data = app_handle
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(&app_data).map_err(|error| error.to_string())?;
    let marker = app_data.join(MIGRATION_MARKER);
    if !marker.exists() {
        let candidates = [
            app_handle.path().app_data_dir(),
            app_handle.path().app_config_dir(),
            app_handle.path().app_local_data_dir(),
            app_handle.path().app_log_dir(),
        ];
        let mut seen = HashSet::new();
        let mut directory_pairs = Vec::new();
        for new_directory in candidates.into_iter().flatten() {
            if !seen.insert(new_directory.clone()) {
                continue;
            }
            let Some(old_directory) = old_sibling(&new_directory) else {
                continue;
            };
            if old_directory.is_dir() {
                copy_directory_contents(&old_directory, &new_directory)?;
                directory_pairs.push((old_directory, new_directory));
            }
        }

        let mut settings = crate::app_settings::load_settings(app_handle.clone())?;
        if let Some(configured_directory) = settings.catalog_directory.as_deref()
            && let Some(remapped) = remap_path(Path::new(configured_directory), &directory_pairs)
        {
            settings.catalog_directory = Some(remapped.to_string_lossy().into_owned());
            crate::app_settings::save_settings(settings, app_handle.clone())?;
        }

        fs::write(
            &marker,
            format!("Migrated non-destructively from {OLD_IDENTIFIER}.\n"),
        )
        .map_err(|error| error.to_string())?;
    }

    migrate_cache_in_background(app_handle.clone(), app_data);
    Ok(())
}

fn migrate_cache_in_background(app_handle: AppHandle, app_data: PathBuf) {
    std::thread::spawn(move || {
        let result = (|| -> Result<(), String> {
            let marker = app_data.join(CACHE_MIGRATION_MARKER);
            if marker.exists() {
                return Ok(());
            }
            let new_cache = app_handle
                .path()
                .app_cache_dir()
                .map_err(|error| error.to_string())?;
            let Some(old_cache) = old_sibling(&new_cache) else {
                return Ok(());
            };
            if !old_cache.is_dir() {
                return Ok(());
            }

            copy_directory_contents(&old_cache, &new_cache)?;

            let mut settings = crate::app_settings::load_settings(app_handle.clone())?;
            if let Some(configured_directory) = settings.catalog_directory.as_deref()
                && let Ok(relative) = Path::new(configured_directory).strip_prefix(&old_cache)
            {
                settings.catalog_directory =
                    Some(new_cache.join(relative).to_string_lossy().into_owned());
                crate::app_settings::save_settings(settings, app_handle.clone())?;
            }

            crate::library_catalog::rebase_thumbnail_paths(&app_handle, &old_cache, &new_cache)?;
            fs::write(
                marker,
                format!("Migrated cache non-destructively from {OLD_IDENTIFIER}.\n"),
            )
            .map_err(|error| error.to_string())
        })();
        if let Err(error) = result {
            eprintln!("Application identifier cache migration will be retried: {error}");
        }
    });
}
