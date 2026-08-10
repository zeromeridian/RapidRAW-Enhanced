use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::{OnceLock, mpsc};
use std::thread;
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{Connection, OptionalExtension, params};
use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::file_management::ImageFile;

const THUMBNAIL_BATCH_SIZE: usize = 256;
static THUMBNAIL_WRITER: OnceLock<mpsc::Sender<(String, String)>> = OnceLock::new();

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogFolderSnapshot {
    images: Vec<ImageFile>,
    thumbnails: HashMap<String, String>,
    updated_at: i64,
}

fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or_default()
}

fn database_path(app_handle: &AppHandle) -> Result<PathBuf, String> {
    let directory = app_handle
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    Ok(directory.join("library-catalog.sqlite3"))
}

fn open(app_handle: &AppHandle) -> Result<Connection, String> {
    let connection =
        Connection::open(database_path(app_handle)?).map_err(|error| error.to_string())?;
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
            let Ok(mut connection) = open(&writer_handle) else { return; };
            while let Ok(first) = receiver.recv() {
                let mut batch = vec![first];
                while batch.len() < THUMBNAIL_BATCH_SIZE {
                    match receiver.recv_timeout(std::time::Duration::from_millis(10)) {
                        Ok(entry) => batch.push(entry),
                        Err(mpsc::RecvTimeoutError::Timeout) => break,
                        Err(mpsc::RecvTimeoutError::Disconnected) => break,
                    }
                }
                let Ok(transaction) = connection.transaction() else { continue; };
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
    open(app_handle)?
        .execute("DELETE FROM thumbnail_index", [])
        .map(|_| ())
        .map_err(|error| error.to_string())
}
