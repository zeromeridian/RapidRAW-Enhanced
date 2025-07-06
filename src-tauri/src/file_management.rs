use std::collections::HashMap;
use std::fs;
use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::thread;

use anyhow::Result;
use base64::{engine::general_purpose, Engine as _};
use image::codecs::jpeg::JpegEncoder;
use image::{DynamicImage, GenericImageView, ImageBuffer, Luma};
use rayon::prelude::*;
use serde::Serialize;
use tauri::{Emitter, Manager};

use crate::image_processing::{
    apply_crop, get_all_adjustments_from_json, GpuContext, ImageMetadata, Crop, apply_rotation,
};
use crate::mask_generation::{MaskDefinition, generate_mask_bitmap};
use crate::raw_processing;
use crate::{gpu_processing, AppState};
use crate::formats::{is_raw_file, is_supported_image_file};

const THUMBNAIL_WIDTH: u32 = 720;

#[derive(Serialize, Debug, Clone)]
pub struct ImageFile {
    path: String,
    modified: u64,
}

#[tauri::command]
pub fn list_images_in_dir(path: String) -> Result<Vec<ImageFile>, String> {
    let entries = fs::read_dir(path)
        .map_err(|e| e.to_string())?
        .filter_map(std::result::Result::ok)
        .map(|entry| entry.path())
        .filter(|path| {
            !path
                .file_name()
                .and_then(|s| s.to_str())
                .map_or(false, |s| s.starts_with('.'))
        })
        .filter(|path| path.is_file())
        .filter(|path| {
            path.to_str().map_or(false, is_supported_image_file)
        })
        .map(|path| {
            let modified = fs::metadata(&path)
                .ok()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .unwrap_or(0);
            ImageFile {
                path: path.to_string_lossy().into_owned(),
                modified,
            }
        })
        .collect();
    Ok(entries)
}

#[derive(Serialize, Debug)]
pub struct FolderNode {
    pub name: String,
    pub path: String,
    pub children: Vec<FolderNode>,
}

fn scan_dir_recursive(path: &Path) -> Result<Vec<FolderNode>, std::io::Error> {
    let mut children = Vec::new();

    let entries = match fs::read_dir(path) {
        Ok(entries) => entries,
        Err(e) => {
            eprintln!("Could not scan directory '{}': {}", path.display(), e);
            return Ok(Vec::new());
        }
    };

    for entry in entries.filter_map(std::result::Result::ok) {
        let current_path = entry.path();
        let is_hidden = current_path
            .file_name()
            .and_then(|s| s.to_str())
            .map_or(false, |s| s.starts_with('.'));

        if current_path.is_dir() && !is_hidden {
            let sub_children = scan_dir_recursive(&current_path)?;
            children.push(FolderNode {
                name: current_path
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .into_owned(),
                path: current_path.to_string_lossy().into_owned(),
                children: sub_children,
            });
        }
    }

    children.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));

    Ok(children)
}


fn get_folder_tree_sync(path: String) -> Result<FolderNode, String> {
    let root_path = Path::new(&path);
    let name = root_path
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .into_owned();
    let children = scan_dir_recursive(root_path).map_err(|e| e.to_string())?;
    Ok(FolderNode {
        name,
        path,
        children,
    })
}

#[tauri::command]
pub async fn get_folder_tree(path: String) -> Result<FolderNode, String> {
    match tauri::async_runtime::spawn_blocking(move || get_folder_tree_sync(path)).await {
        Ok(Ok(folder_node)) => Ok(folder_node),
        Ok(Err(e)) => Err(e),
        Err(e) => Err(format!("Failed to execute folder tree task: {}", e)),
    }
}

pub fn get_sidecar_path(image_path: &str) -> PathBuf {
    let path = PathBuf::from(image_path);
    let original_filename = path.file_name().unwrap_or_default().to_string_lossy();
    let new_filename = format!("{}.rrdata", original_filename);
    path.with_file_name(new_filename)
}

fn apply_flip(image: DynamicImage, horizontal: bool, vertical: bool) -> DynamicImage {
    let mut img = image;
    if horizontal {
        img = img.fliph();
    }
    if vertical {
        img = img.flipv();
    }
    img
}

fn get_composited_image_for_thumb(path: &str, current_adjustments: &serde_json::Value) -> anyhow::Result<DynamicImage> {
    let file_bytes = fs::read(path)?;
    let mut base_image = if is_raw_file(path) {
        raw_processing::develop_raw_image(&file_bytes, true)?
    } else {
        image::load_from_memory(&file_bytes)?
    };

    if let Some(patches_val) = current_adjustments.get("aiPatches") {
        if let Some(patches_arr) = patches_val.as_array() {
            for patch_obj in patches_arr {
                if let Some(b64_data) = patch_obj.get("patchDataBase64").and_then(|v| v.as_str()) {
                    let png_bytes = base64::engine::general_purpose::STANDARD.decode(b64_data)?;
                    let patch_layer = image::load_from_memory(&png_bytes)?;
                    image::imageops::overlay(&mut base_image, &patch_layer, 0, 0);
                }
            }
        }
    }
    Ok(base_image)
}

pub fn generate_thumbnail_data(
    path_str: &str,
    gpu_context: Option<&GpuContext>,
) -> anyhow::Result<DynamicImage> {
    let sidecar_path = get_sidecar_path(path_str);
    let metadata: Option<ImageMetadata> = fs::read_to_string(sidecar_path)
        .ok()
        .and_then(|content| serde_json::from_str(&content).ok());

    let adjustments = metadata.as_ref().map_or(serde_json::Value::Null, |m| m.adjustments.clone());
    let base_image = get_composited_image_for_thumb(path_str, &adjustments)?;
    let original_dims = base_image.dimensions();

    if let (Some(context), Some(meta)) = (gpu_context, metadata) {
        if !meta.adjustments.is_null() {
            const THUMBNAIL_PROCESSING_DIM: u32 = 1280;
            let (full_w, full_h) = original_dims;

            let (processing_base, scale_for_gpu) =
                if full_w > THUMBNAIL_PROCESSING_DIM || full_h > THUMBNAIL_PROCESSING_DIM {
                    let base = base_image.thumbnail(THUMBNAIL_PROCESSING_DIM, THUMBNAIL_PROCESSING_DIM);
                    let scale = if full_w > 0 { base.width() as f32 / full_w as f32 } else { 1.0 };
                    (base, scale)
                } else {
                    (base_image.clone(), 1.0)
                };

            let rotation_degrees = meta.adjustments["rotation"].as_f64().unwrap_or(0.0) as f32;
            let flip_horizontal = meta.adjustments["flipHorizontal"].as_bool().unwrap_or(false);
            let flip_vertical = meta.adjustments["flipVertical"].as_bool().unwrap_or(false);

            let flipped_image = apply_flip(processing_base, flip_horizontal, flip_vertical);
            let rotated_image = apply_rotation(&flipped_image, rotation_degrees);

            let crop_data: Option<Crop> = serde_json::from_value(meta.adjustments["crop"].clone()).ok();
            let scaled_crop_json = if let Some(c) = &crop_data {
                serde_json::to_value(Crop {
                    x: c.x * scale_for_gpu as f64,
                    y: c.y * scale_for_gpu as f64,
                    width: c.width * scale_for_gpu as f64,
                    height: c.height * scale_for_gpu as f64,
                }).unwrap_or(serde_json::Value::Null)
            } else {
                serde_json::Value::Null
            };

            let cropped_preview = apply_crop(rotated_image, &scaled_crop_json);
            let (preview_w, preview_h) = cropped_preview.dimensions();

            let unscaled_crop_offset = crop_data.map_or((0.0, 0.0), |c| (c.x as f32, c.y as f32));

            let mask_definitions: Vec<MaskDefinition> = meta.adjustments.get("masks")
                .and_then(|m| serde_json::from_value(m.clone()).ok())
                .unwrap_or_else(Vec::new);

            let mask_bitmaps: Vec<ImageBuffer<Luma<u8>, Vec<u8>>> = mask_definitions.iter()
                .filter_map(|def| generate_mask_bitmap(def, preview_w, preview_h, scale_for_gpu, (unscaled_crop_offset.0 * scale_for_gpu, unscaled_crop_offset.1 * scale_for_gpu)))
                .collect();

            let gpu_adjustments = get_all_adjustments_from_json(&meta.adjustments);

            if let Ok(processed_image) = gpu_processing::process_and_get_dynamic_image(context, &cropped_preview, gpu_adjustments, &mask_bitmaps) {
                return Ok(processed_image);
            } else {
                return Ok(cropped_preview);
            }
        }
    }

    Ok(base_image)
}

fn encode_thumbnail(image: &DynamicImage) -> Result<Vec<u8>> {
    let thumbnail = image.thumbnail(THUMBNAIL_WIDTH, THUMBNAIL_WIDTH);
    let mut buf = Cursor::new(Vec::new());
    let mut encoder = JpegEncoder::new_with_quality(&mut buf, 75);
    encoder.encode_image(&thumbnail.to_rgba8())?;
    Ok(buf.into_inner())
}

#[tauri::command]
pub fn generate_thumbnails(
    paths: Vec<String>,
    app_handle: tauri::AppHandle,
) -> Result<HashMap<String, String>, String> {
    let cache_dir = app_handle
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?;
    let thumb_cache_dir = cache_dir.join("thumbnails");
    if !thumb_cache_dir.exists() {
        fs::create_dir_all(&thumb_cache_dir).map_err(|e| e.to_string())?;
    }

    let state = app_handle.state::<AppState>();
    let gpu_context = gpu_processing::get_or_init_gpu_context(&state).ok();

    let thumbnails: HashMap<String, String> = paths
        .par_iter()
        .filter_map(|path_str| {
            let original_path = Path::new(path_str);
            let sidecar_path = get_sidecar_path(path_str);

            let img_mod_time = fs::metadata(original_path)
                .ok()?
                .modified()
                .ok()?
                .duration_since(std::time::UNIX_EPOCH)
                .ok()?
                .as_secs();
            let sidecar_mod_time = fs::metadata(&sidecar_path)
                .ok()
                .and_then(|m| m.modified().ok())
                .map(|t| t.duration_since(std::time::UNIX_EPOCH).unwrap().as_secs())
                .unwrap_or(0);

            let mut hasher = blake3::Hasher::new();
            hasher.update(path_str.as_bytes());
            hasher.update(&img_mod_time.to_le_bytes());
            hasher.update(&sidecar_mod_time.to_le_bytes());
            let hash = hasher.finalize();
            let cache_filename = format!("{}.jpg", hash.to_hex());
            let cache_path = thumb_cache_dir.join(cache_filename);

            if cache_path.exists() {
                if let Ok(data) = fs::read(&cache_path) {
                    let base64_str = general_purpose::STANDARD.encode(&data);
                    return Some((
                        path_str.clone(),
                        format!("data:image/jpeg;base64,{}", base64_str),
                    ));
                }
            }

            if let Ok(thumb_image) = generate_thumbnail_data(path_str, gpu_context.as_ref()) {
                if let Ok(thumb_data) = encode_thumbnail(&thumb_image) {
                    let _ = fs::write(&cache_path, &thumb_data);
                    let base64_str = general_purpose::STANDARD.encode(&thumb_data);
                    return Some((
                        path_str.clone(),
                        format!("data:image/jpeg;base64,{}", base64_str),
                    ));
                }
            }
            None
        })
        .collect();

    Ok(thumbnails)
}

#[tauri::command]
pub fn generate_thumbnails_progressive(
    paths: Vec<String>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    let cache_dir = app_handle
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?;
    let thumb_cache_dir = cache_dir.join("thumbnails");
    if !thumb_cache_dir.exists() {
        fs::create_dir_all(&thumb_cache_dir).map_err(|e| e.to_string())?;
    }

    let app_handle_clone = app_handle.clone();
    let total_count = paths.len();
    let completed_count = Arc::new(AtomicUsize::new(0));

    thread::spawn(move || {
        let state = app_handle.state::<AppState>();
        let gpu_context = gpu_processing::get_or_init_gpu_context(&state).ok();

        paths.par_iter().for_each(|path_str| {
            let result = (|| -> Option<(String, u8)> {
                let original_path = Path::new(path_str);
                let sidecar_path = get_sidecar_path(path_str);

                let img_mod_time = fs::metadata(original_path)
                    .ok()?
                    .modified()
                    .ok()?
                    .duration_since(std::time::UNIX_EPOCH)
                    .ok()?
                    .as_secs();

                let (sidecar_mod_time, rating) = if let Ok(content) = fs::read_to_string(&sidecar_path) {
                    let mod_time = fs::metadata(&sidecar_path)
                        .ok()
                        .and_then(|m| m.modified().ok())
                        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                        .map(|d| d.as_secs())
                        .unwrap_or(0);
                    let rating_val = serde_json::from_str::<ImageMetadata>(&content)
                        .ok()
                        .map(|m| m.rating)
                        .unwrap_or(0);
                    (mod_time, rating_val)
                } else {
                    (0, 0)
                };

                let mut hasher = blake3::Hasher::new();
                hasher.update(path_str.as_bytes());
                hasher.update(&img_mod_time.to_le_bytes());
                hasher.update(&sidecar_mod_time.to_le_bytes());
                let hash = hasher.finalize();
                let cache_filename = format!("{}.jpg", hash.to_hex());
                let cache_path = thumb_cache_dir.join(cache_filename);

                if cache_path.exists() {
                    if let Ok(data) = fs::read(&cache_path) {
                        let base64_str = general_purpose::STANDARD.encode(&data);
                        return Some((format!("data:image/jpeg;base64,{}", base64_str), rating));
                    }
                }

                if let Ok(thumb_image) = generate_thumbnail_data(path_str, gpu_context.as_ref()) {
                    if let Ok(thumb_data) = encode_thumbnail(&thumb_image) {
                        let _ = fs::write(&cache_path, &thumb_data);
                        let base64_str = general_purpose::STANDARD.encode(&thumb_data);
                        return Some((format!("data:image/jpeg;base64,{}", base64_str), rating));
                    }
                }
                None
            })();

            if let Some((thumbnail_data, rating)) = result {
                let _ = app_handle_clone.emit(
                    "thumbnail-generated",
                    serde_json::json!({ "path": path_str, "data": thumbnail_data, "rating": rating }),
                );
            }

            let completed = completed_count.fetch_add(1, Ordering::Relaxed) + 1;
            let _ = app_handle_clone.emit(
                "thumbnail-progress",
                serde_json::json!({ "completed": completed, "total": total_count }),
            );
        });

        let _ = app_handle_clone.emit("thumbnail-generation-complete", true);
    });

    Ok(())
}

#[tauri::command]
pub fn create_folder(path: String) -> Result<(), String> {
    let path_obj = Path::new(&path);
    if let (Some(parent), Some(new_folder_name_os)) = (path_obj.parent(), path_obj.file_name()) {
        if let Some(new_folder_name) = new_folder_name_os.to_str() {
            if parent.exists() {
                for entry in fs::read_dir(parent).map_err(|e| e.to_string())? {
                    if let Ok(entry) = entry {
                        if entry.file_name().to_string_lossy().to_lowercase() == new_folder_name.to_lowercase() {
                            return Err("A folder with that name already exists.".to_string());
                        }
                    }
                }
            }
        }
    }
    fs::create_dir_all(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn rename_folder(path: String, new_name: String) -> Result<(), String> {
    let p = Path::new(&path);
    if !p.is_dir() {
        return Err("Path is not a directory.".to_string());
    }
    if let Some(parent) = p.parent() {
        for entry in fs::read_dir(parent).map_err(|e| e.to_string())? {
            if let Ok(entry) = entry {
                if entry.file_name().to_string_lossy().to_lowercase() == new_name.to_lowercase() {
                    if entry.path() != p {
                        return Err("A folder with that name already exists.".to_string());
                    }
                }
            }
        }
        let new_path = parent.join(&new_name);
        fs::rename(p, new_path).map_err(|e| e.to_string())
    } else {
        Err("Could not determine parent directory.".to_string())
    }
}

#[tauri::command]
pub fn delete_folder(path: String) -> Result<(), String> {
    trash::delete(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn duplicate_file(path: String) -> Result<(), String> {
    let source_path = Path::new(&path);
    if !source_path.is_file() {
        return Err("Source path is not a file.".to_string());
    }

    let parent = source_path.parent().ok_or("Could not get parent directory")?;
    let stem = source_path.file_stem().and_then(|s| s.to_str()).ok_or("Could not get file stem")?;
    let extension = source_path.extension().and_then(|s| s.to_str()).unwrap_or("");

    let mut counter = 1;
    let mut dest_path;
    loop {
        let new_stem = if counter == 1 {
            format!("{}_copy", stem)
        } else {
            format!("{}_copy_{}", stem, counter - 1)
        };
        dest_path = parent.join(format!("{}.{}", new_stem, extension));
        if !dest_path.exists() {
            break;
        }
        counter += 1;
    }

    fs::copy(&source_path, &dest_path).map_err(|e| e.to_string())?;

    let sidecar_path = get_sidecar_path(&path);
    if sidecar_path.exists() {
        if let Some(dest_str) = dest_path.to_str() {
            let dest_sidecar_path = get_sidecar_path(dest_str);
            fs::copy(&sidecar_path, &dest_sidecar_path).map_err(|e| e.to_string())?;
        }
    }

    Ok(())
}

#[tauri::command]
pub fn copy_files(source_paths: Vec<String>, destination_folder: String) -> Result<(), String> {
    let dest_path = Path::new(&destination_folder);
    if !dest_path.is_dir() {
        return Err(format!("Destination is not a folder: {}", destination_folder));
    }

    for source_str in source_paths {
        let source_path = Path::new(&source_str);

        let canon_dest = fs::canonicalize(dest_path).map_err(|e| e.to_string())?;
        let canon_source_parent = source_path.parent().and_then(|p| fs::canonicalize(p).ok());

        if Some(canon_dest) == canon_source_parent {
            duplicate_file(source_str.clone())?;
        } else {
            if let Some(file_name) = source_path.file_name() {
                let dest_file_path = dest_path.join(file_name);

                fs::copy(&source_path, &dest_file_path).map_err(|e| e.to_string())?;

                let sidecar_path = get_sidecar_path(&source_str);
                if sidecar_path.exists() {
                    if let Some(dest_str) = dest_file_path.to_str() {
                        let dest_sidecar_path = get_sidecar_path(dest_str);
                        fs::copy(&sidecar_path, &dest_sidecar_path).map_err(|e| e.to_string())?;
                    }
                }
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub fn move_files(source_paths: Vec<String>, destination_folder: String) -> Result<(), String> {
    let dest_path = Path::new(&destination_folder);
    if !dest_path.is_dir() {
        return Err(format!("Destination is not a folder: {}", destination_folder));
    }

    let mut files_to_delete = Vec::new();
    let mut sidecars_to_delete = Vec::new();

    for source_str in &source_paths {
        let source_path = Path::new(source_str);
        if let Some(file_name) = source_path.file_name() {
            let dest_file_path = dest_path.join(file_name);

            if dest_file_path.exists() {
                return Err(format!("File already exists at destination: {}", dest_file_path.display()));
            }

            fs::copy(&source_path, &dest_file_path).map_err(|e| e.to_string())?;
            files_to_delete.push(source_path.to_path_buf());

            let sidecar_path = get_sidecar_path(source_str);
            if sidecar_path.exists() {
                if let Some(dest_str) = dest_file_path.to_str() {
                    let dest_sidecar_path = get_sidecar_path(dest_str);
                    fs::copy(&sidecar_path, &dest_sidecar_path).map_err(|e| e.to_string())?;
                    sidecars_to_delete.push(sidecar_path);
                }
            }
        }
    }

    trash::delete_all(&files_to_delete).map_err(|e| e.to_string())?;
    trash::delete_all(&sidecars_to_delete).map_err(|e| e.to_string())?;

    Ok(())
}