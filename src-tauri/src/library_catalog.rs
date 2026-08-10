use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::{LazyLock, Mutex, OnceLock, mpsc};
use std::thread;
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{Connection, OptionalExtension, params};
use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::file_management::ImageFile;

const THUMBNAIL_BATCH_SIZE: usize = 256;
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
    let connection = Connection::open(path).map_err(|error| error.to_string())?;
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
             );",
        )
        .map_err(|error| error.to_string())?;
    Ok(connection)
}

fn open(app_handle: &AppHandle) -> Result<Connection, String> {
    open_at(database_path(app_handle)?)
}

fn cache_key(path: &str, recursive: bool, xmp_sync: bool) -> String {
    let normalized = if cfg!(target_os = "windows") {
        path.replace('\\', "/").trim_end_matches('/').to_lowercase()
    } else {
        path.replace('\\', "/").trim_end_matches('/').to_owned()
    };
    format!(
        "{}|{}|{}",
        if recursive { "recursive" } else { "flat" },
        if xmp_sync { "xmp" } else { "sidecar" },
        normalized
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
    let paths: std::collections::HashSet<&str> =
        images.iter().map(|image| image.path.as_str()).collect();
    let mut thumbnails = HashMap::new();
    let mut statement = connection
        .prepare("SELECT image_path, thumbnail_path FROM thumbnail_index")
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|error| error.to_string())?;
    for row in rows.filter_map(Result::ok) {
        if paths.contains(row.0.as_str()) {
            thumbnails.insert(row.0, row.1);
        }
    }
    Ok(Some(CatalogFolderSnapshot {
        images,
        thumbnails,
        updated_at,
    }))
}

pub fn clear_thumbnail_index(app_handle: &AppHandle) -> Result<(), String> {
    let _operation = CATALOG_OPERATION_LOCK.lock().unwrap();
    open(app_handle)?
        .execute("DELETE FROM thumbnail_index", [])
        .map(|_| ())
        .map_err(|error| error.to_string())
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
