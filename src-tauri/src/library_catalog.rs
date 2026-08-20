use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::{LazyLock, Mutex, OnceLock, mpsc};
use std::thread;
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{Connection, OptionalExtension, params, params_from_iter};
use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::file_management::{FolderNode, ImageFile, THUMBNAIL_RENDERER_VERSION};

const THUMBNAIL_BATCH_SIZE: usize = 256;
const THUMBNAIL_LOOKUP_BATCH_SIZE: usize = 500;
static THUMBNAIL_WRITER: OnceLock<mpsc::Sender<(String, String)>> = OnceLock::new();
static CATALOG_OPERATION_LOCK: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogFolderSnapshot {
    images: Vec<ImageFile>,
    thumbnails: HashMap<String, String>,
    updated_at: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogMoveResult {
    database_path: String,
    directory: Option<String>,
}

fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or_default()
}

fn database_path(app_handle: &AppHandle) -> Result<PathBuf, String> {
    let settings = crate::app_settings::load_settings(app_handle.clone()).unwrap_or_default();
    let directory = match settings
        .catalog_directory
        .as_deref()
        .map(str::trim)
        .filter(|directory| !directory.is_empty())
    {
        Some(directory) => PathBuf::from(directory),
        None => app_handle
            .path()
            .app_data_dir()
            .map_err(|error| error.to_string())?,
    };
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    Ok(directory.join("library-catalog.sqlite3"))
}

fn open_at(path: PathBuf) -> Result<Connection, String> {
    let mut connection = Connection::open(path).map_err(|error| error.to_string())?;
    connection
        .busy_timeout(std::time::Duration::from_secs(2))
        .map_err(|error| error.to_string())?;
    connection
        .execute_batch(
            "PRAGMA journal_mode=WAL;
             PRAGMA synchronous=NORMAL;
             CREATE TABLE IF NOT EXISTS folder_snapshots (
                 cache_key TEXT PRIMARY KEY,
                 images_json TEXT NOT NULL,
                 updated_at INTEGER NOT NULL
             );
             CREATE TABLE IF NOT EXISTS thumbnail_index (
                 image_path TEXT PRIMARY KEY,
                 thumbnail_path TEXT NOT NULL,
                 updated_at INTEGER NOT NULL
             );
             CREATE TABLE IF NOT EXISTS folder_tree_snapshots (
                 cache_key TEXT PRIMARY KEY,
                 tree_json TEXT NOT NULL,
                 updated_at INTEGER NOT NULL
             );
             CREATE TABLE IF NOT EXISTS catalog_meta (
                 key TEXT PRIMARY KEY,
                 value TEXT NOT NULL
             );",
        )
        .map_err(|error| error.to_string())?;

    let stored_renderer_version = connection
        .query_row(
            "SELECT value FROM catalog_meta WHERE key='thumbnail_renderer_version'",
            [],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    if stored_renderer_version.as_deref() != Some(THUMBNAIL_RENDERER_VERSION) {
        let transaction = connection
            .transaction()
            .map_err(|error| error.to_string())?;
        transaction
            .execute("DELETE FROM thumbnail_index", [])
            .map_err(|error| error.to_string())?;
        transaction
            .execute(
                "INSERT INTO catalog_meta(key, value) VALUES ('thumbnail_renderer_version', ?1)
                 ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                [THUMBNAIL_RENDERER_VERSION],
            )
            .map_err(|error| error.to_string())?;
        transaction.commit().map_err(|error| error.to_string())?;
    }
    Ok(connection)
}

fn open(app_handle: &AppHandle) -> Result<Connection, String> {
    open_at(database_path(app_handle)?)
}

fn cache_key(path: &str, recursive: bool, xmp_sync: bool) -> String {
    format!(
        "{}|{}|{}",
        if recursive { "recursive" } else { "flat" },
        if xmp_sync { "xmp" } else { "sidecar" },
        normalized_path(path)
    )
}

fn normalized_path(path: &str) -> String {
    if cfg!(target_os = "windows") {
        path.replace('\\', "/").trim_end_matches('/').to_lowercase()
    } else {
        path.replace('\\', "/").trim_end_matches('/').to_owned()
    }
}

fn tree_cache_key(path: &str, show_image_counts: bool, hide_empty_folders: bool) -> String {
    format!(
        "{}|{}|{}",
        if show_image_counts {
            "counts"
        } else {
            "no-counts"
        },
        if hide_empty_folders {
            "hide-empty"
        } else {
            "show-empty"
        },
        normalized_path(path)
    )
}

pub fn save_folder_snapshot(
    app_handle: &AppHandle,
    path: &str,
    recursive: bool,
    xmp_sync: bool,
    images: &[ImageFile],
) -> Result<(), String> {
    let _operation = CATALOG_OPERATION_LOCK.lock().unwrap();
    let images_json = serde_json::to_string(images).map_err(|error| error.to_string())?;
    let timestamp = now();
    open(app_handle)?
        .execute(
            "INSERT INTO folder_snapshots(cache_key, images_json, updated_at)
             VALUES (?1, ?2, ?3)
             ON CONFLICT(cache_key) DO UPDATE SET images_json=excluded.images_json,
                 updated_at=excluded.updated_at",
            params![cache_key(path, recursive, xmp_sync), images_json, timestamp],
        )
        .map(|_| ())
        .map_err(|error| error.to_string())
}

pub fn record_thumbnail(
    app_handle: &AppHandle,
    image_path: &str,
    thumbnail_path: &str,
) -> Result<(), String> {
    let sender = THUMBNAIL_WRITER.get_or_init(|| {
        let (sender, receiver) = mpsc::channel::<(String, String)>();
        let writer_handle = app_handle.clone();
        thread::spawn(move || {
            while let Ok(first) = receiver.recv() {
                let mut batch = vec![first];
                while batch.len() < THUMBNAIL_BATCH_SIZE {
                    match receiver.recv_timeout(std::time::Duration::from_millis(10)) {
                        Ok(entry) => batch.push(entry),
                        Err(mpsc::RecvTimeoutError::Timeout) => break,
                        Err(mpsc::RecvTimeoutError::Disconnected) => break,
                    }
                }
                let _operation = CATALOG_OPERATION_LOCK.lock().unwrap();
                let Ok(mut connection) = open(&writer_handle) else {
                    continue;
                };
                let Ok(transaction) = connection.transaction() else {
                    continue;
                };
                for (image_path, thumbnail_path) in batch {
                    let _ = transaction.execute(
                        "INSERT INTO thumbnail_index(image_path, thumbnail_path, updated_at) VALUES (?1, ?2, ?3)
                         ON CONFLICT(image_path) DO UPDATE SET thumbnail_path=excluded.thumbnail_path, updated_at=excluded.updated_at",
                        params![image_path, thumbnail_path, now()],
                    );
                }
                let _ = transaction.commit();
            }
        });
        sender
    });
    sender
        .send((image_path.to_owned(), thumbnail_path.to_owned()))
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn load_catalog_folder(
    path: String,
    recursive: bool,
    xmp_sync: bool,
    app_handle: AppHandle,
) -> Result<Option<CatalogFolderSnapshot>, String> {
    let _operation = CATALOG_OPERATION_LOCK.lock().unwrap();
    let connection = open(&app_handle)?;
    let key = cache_key(&path, recursive, xmp_sync);
    let stored = connection
        .query_row(
            "SELECT images_json, updated_at FROM folder_snapshots WHERE cache_key=?1",
            [&key],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    let Some((images_json, updated_at)) = stored else {
        return Ok(None);
    };
    let images: Vec<ImageFile> =
        serde_json::from_str(&images_json).map_err(|error| error.to_string())?;
    let mut thumbnails = HashMap::new();
    for image_batch in images.chunks(THUMBNAIL_LOOKUP_BATCH_SIZE) {
        let placeholders = std::iter::repeat_n("?", image_batch.len())
            .collect::<Vec<_>>()
            .join(",");
        let query = format!(
            "SELECT image_path, thumbnail_path FROM thumbnail_index WHERE image_path IN ({placeholders})"
        );
        let mut statement = connection
            .prepare(&query)
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map(
                params_from_iter(image_batch.iter().map(|image| image.path.as_str())),
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
            )
            .map_err(|error| error.to_string())?;
        for row in rows.filter_map(Result::ok) {
            thumbnails.insert(row.0, row.1);
        }
    }
    Ok(Some(CatalogFolderSnapshot {
        images,
        thumbnails,
        updated_at,
    }))
}

pub fn save_folder_tree_snapshots(
    app_handle: &AppHandle,
    trees: &[FolderNode],
    show_image_counts: bool,
    hide_empty_folders: bool,
) -> Result<(), String> {
    let _operation = CATALOG_OPERATION_LOCK.lock().unwrap();
    let mut connection = open(app_handle)?;
    save_folder_tree_snapshots_to_connection(
        &mut connection,
        trees,
        show_image_counts,
        hide_empty_folders,
    )
}

fn save_folder_tree_snapshots_to_connection(
    connection: &mut Connection,
    trees: &[FolderNode],
    show_image_counts: bool,
    hide_empty_folders: bool,
) -> Result<(), String> {
    if trees.is_empty() {
        return Ok(());
    }

    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    let timestamp = now();
    for tree in trees {
        let tree_json = serde_json::to_string(tree).map_err(|error| error.to_string())?;
        transaction
            .execute(
                "INSERT INTO folder_tree_snapshots(cache_key, tree_json, updated_at)
                 VALUES (?1, ?2, ?3)
                 ON CONFLICT(cache_key) DO UPDATE SET tree_json=excluded.tree_json,
                     updated_at=excluded.updated_at",
                params![
                    tree_cache_key(&tree.path, show_image_counts, hide_empty_folders),
                    tree_json,
                    timestamp
                ],
            )
            .map_err(|error| error.to_string())?;
    }
    transaction.commit().map_err(|error| error.to_string())
}

fn load_folder_tree_snapshots_from_connection(
    connection: &Connection,
    paths: &[String],
    show_image_counts: bool,
    hide_empty_folders: bool,
) -> Result<Vec<FolderNode>, String> {
    let mut trees = Vec::with_capacity(paths.len());
    for path in paths {
        let stored = connection
            .query_row(
                "SELECT tree_json FROM folder_tree_snapshots WHERE cache_key=?1",
                [tree_cache_key(path, show_image_counts, hide_empty_folders)],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(|error| error.to_string())?;
        if let Some(tree_json) = stored {
            match serde_json::from_str(&tree_json) {
                Ok(tree) => trees.push(tree),
                Err(error) => {
                    log::warn!("Ignoring invalid cached folder tree for {path}: {error}")
                }
            }
        }
    }
    Ok(trees)
}

#[tauri::command]
pub async fn load_catalog_folder_trees(
    paths: Vec<String>,
    show_image_counts: bool,
    hide_empty_folders: bool,
    app_handle: AppHandle,
) -> Result<Vec<FolderNode>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _operation = CATALOG_OPERATION_LOCK.lock().unwrap();
        let connection = open(&app_handle)?;
        load_folder_tree_snapshots_from_connection(
            &connection,
            &paths,
            show_image_counts,
            hide_empty_folders,
        )
    })
    .await
    .map_err(|error| format!("Catalog folder-tree task failed: {error}"))?
}

pub fn clear_thumbnail_index(app_handle: &AppHandle) -> Result<(), String> {
    let _operation = CATALOG_OPERATION_LOCK.lock().unwrap();
    open(app_handle)?
        .execute("DELETE FROM thumbnail_index", [])
        .map(|_| ())
        .map_err(|error| error.to_string())
}

pub fn rebase_thumbnail_paths(
    app_handle: &AppHandle,
    old_cache_directory: &std::path::Path,
    new_cache_directory: &std::path::Path,
) -> Result<(), String> {
    let _operation = CATALOG_OPERATION_LOCK.lock().unwrap();
    let mut connection = open(app_handle)?;
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    let mut statement = transaction
        .prepare("SELECT image_path, thumbnail_path FROM thumbnail_index")
        .map_err(|error| error.to_string())?;
    let entries = statement
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|error| error.to_string())?
        .filter_map(Result::ok)
        .collect::<Vec<_>>();
    drop(statement);
    for (image_path, thumbnail_path) in entries {
        let thumbnail_path = PathBuf::from(thumbnail_path);
        let Ok(relative) = thumbnail_path.strip_prefix(old_cache_directory) else {
            continue;
        };
        let rebased = new_cache_directory.join(relative);
        transaction
            .execute(
                "UPDATE thumbnail_index SET thumbnail_path=?1 WHERE image_path=?2",
                params![rebased.to_string_lossy(), image_path],
            )
            .map_err(|error| error.to_string())?;
    }
    transaction.commit().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn get_catalog_location(app_handle: AppHandle) -> Result<String, String> {
    database_path(&app_handle).map(|path| path.to_string_lossy().into_owned())
}

fn copy_catalog(source: &std::path::Path, target: &std::path::Path) -> Result<(), String> {
    let parent = target
        .parent()
        .ok_or_else(|| "The selected catalog location is invalid.".to_string())?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let temporary = parent.join(format!(".library-catalog-{}.moving", std::process::id()));
    if temporary.exists() {
        fs::remove_file(&temporary).map_err(|error| error.to_string())?;
    }
    let result = (|| {
        fs::copy(source, &temporary).map_err(|error| error.to_string())?;
        fs::File::open(&temporary)
            .and_then(|file| file.sync_all())
            .map_err(|error| error.to_string())?;
        fs::rename(&temporary, target).map_err(|error| error.to_string())
    })();
    if result.is_err() {
        let _ = fs::remove_file(temporary);
    }
    result
}

fn remove_catalog_files(path: &std::path::Path) {
    let _ = fs::remove_file(path);
    for suffix in ["-wal", "-shm"] {
        let side_file = PathBuf::from(format!("{}{suffix}", path.to_string_lossy()));
        let _ = fs::remove_file(side_file);
    }
}

#[tauri::command]
pub fn move_library_catalog(
    directory: Option<String>,
    app_handle: AppHandle,
) -> Result<CatalogMoveResult, String> {
    let _operation = CATALOG_OPERATION_LOCK.lock().unwrap();
    let source = database_path(&app_handle)?;
    let mut settings = crate::app_settings::load_settings(app_handle.clone())?;
    let requested_directory = directory
        .as_deref()
        .map(str::trim)
        .filter(|directory| !directory.is_empty());
    let target_directory = match requested_directory {
        Some(directory) => {
            let directory = PathBuf::from(directory);
            fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
            directory
                .canonicalize()
                .map_err(|error| error.to_string())?
        }
        None => app_handle
            .path()
            .app_data_dir()
            .map_err(|error| error.to_string())?,
    };
    fs::create_dir_all(&target_directory).map_err(|error| error.to_string())?;
    let target = target_directory.join("library-catalog.sqlite3");
    let configured_directory =
        requested_directory.map(|_| target_directory.to_string_lossy().into_owned());

    if source == target {
        settings.catalog_directory = configured_directory.clone();
        crate::app_settings::save_settings(settings, app_handle)?;
        return Ok(CatalogMoveResult {
            database_path: target.to_string_lossy().into_owned(),
            directory: configured_directory,
        });
    }
    if target.exists() {
        return Err(format!(
            "The selected folder already contains {}.",
            target.file_name().unwrap_or_default().to_string_lossy()
        ));
    }

    if source.exists() {
        let connection = open_at(source.clone())?;
        connection
            .execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")
            .map_err(|error| error.to_string())?;
        drop(connection);
        copy_catalog(&source, &target)?;
    } else {
        open_at(target.clone())?;
    }

    if let Err(error) = open_at(target.clone()) {
        remove_catalog_files(&target);
        return Err(format!(
            "The catalog could not be opened in the selected folder: {error}"
        ));
    }

    settings.catalog_directory = configured_directory.clone();
    if let Err(error) = crate::app_settings::save_settings(settings, app_handle.clone()) {
        remove_catalog_files(&target);
        return Err(error);
    }

    if source.exists() {
        if let Err(error) = fs::remove_file(&source) {
            eprintln!("Catalog moved, but the old copy could not be removed: {error}");
        }
        for suffix in ["-wal", "-shm"] {
            let side_file = PathBuf::from(format!("{}{suffix}", source.to_string_lossy()));
            let _ = fs::remove_file(side_file);
        }
    }

    Ok(CatalogMoveResult {
        database_path: target.to_string_lossy().into_owned(),
        directory: configured_directory,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_tree(path: &str) -> FolderNode {
        FolderNode {
            name: "Photos".to_owned(),
            path: path.to_owned(),
            children: Vec::new(),
            is_dir: true,
            image_count: 42,
            contains_images: true,
            has_subdirs: true,
            modified: 10,
            created: 5,
        }
    }

    #[test]
    fn folder_tree_snapshots_round_trip_and_keep_setting_variants_separate() {
        let temporary = tempfile::tempdir().unwrap();
        let mut connection = open_at(temporary.path().join("catalog.sqlite3")).unwrap();
        let path = "/photos".to_owned();

        save_folder_tree_snapshots_to_connection(&mut connection, &[test_tree(&path)], true, true)
            .unwrap();

        let restored = load_folder_tree_snapshots_from_connection(
            &connection,
            std::slice::from_ref(&path),
            true,
            true,
        )
        .unwrap();
        assert_eq!(restored.len(), 1);
        assert_eq!(restored[0].path, path);
        assert_eq!(restored[0].image_count, 42);

        let different_settings =
            load_folder_tree_snapshots_from_connection(&connection, &[path], false, true).unwrap();
        assert!(different_settings.is_empty());
    }

    #[test]
    fn renderer_upgrade_invalidates_legacy_thumbnail_index_once() {
        let temporary = tempfile::tempdir().unwrap();
        let catalog_path = temporary.path().join("catalog.sqlite3");
        let connection = open_at(catalog_path.clone()).unwrap();
        connection
            .execute(
                "INSERT INTO thumbnail_index(image_path, thumbnail_path, updated_at)
                 VALUES ('image.jpg', 'old.jpg', 1)",
                [],
            )
            .unwrap();
        connection
            .execute(
                "UPDATE catalog_meta SET value='legacy' WHERE key='thumbnail_renderer_version'",
                [],
            )
            .unwrap();
        drop(connection);

        let connection = open_at(catalog_path.clone()).unwrap();
        let count: i64 = connection
            .query_row("SELECT COUNT(*) FROM thumbnail_index", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 0);
        connection
            .execute(
                "INSERT INTO thumbnail_index(image_path, thumbnail_path, updated_at)
                 VALUES ('image.jpg', 'current.jpg', 2)",
                [],
            )
            .unwrap();
        drop(connection);

        let connection = open_at(catalog_path).unwrap();
        let count: i64 = connection
            .query_row("SELECT COUNT(*) FROM thumbnail_index", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 1);
    }
}
