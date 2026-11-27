use crate::android_integration::is_android_content_uri;
#[cfg(target_os = "android")]
use crate::android_integration::{
    get_android_cached_lut_path, read_android_content_uri, resolve_android_content_uri_name,
};
use anyhow::anyhow;
use image::{DynamicImage, GenericImageView, Rgb, Rgb32FImage};
use serde::Serialize;
use std::fs::{File, copy, create_dir_all, read_dir};
use std::io::{BufRead, BufReader, Cursor};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use base64::{Engine as _, engine::general_purpose};
use mozjpeg_rs::{Encoder, Preset};
use tauri::{AppHandle, Manager, State};

use crate::AppState;
use crate::image_processing::{
    RenderRequest, get_all_adjustments_from_json, process_and_get_dynamic_image,
    resolve_tonemapper_override_from_handle,
};

#[derive(Debug, Clone)]
pub struct Lut {
    pub size: u32,
    pub data: Vec<f32>,
}

#[derive(Debug, Clone, Serialize)]
pub struct LutEntry {
    pub name: String,
    pub path: String,
    /// The subfolder of `luts/` it is in (Looks → LUTs' group); empty for `luts/` itself.
    pub group: String,
    /// Its path inside `luts/` with `/` separators, which keeps favourites apart across groups.
    pub id: String,
}

/// LUTs moved by `move_luts_to_group`, and the folder listed afterwards.
#[derive(Serialize)]
pub struct MovedLuts {
    pub entries: Vec<LutEntry>,
    /// `(from, to)` paths, so an edit or favourite naming a moved LUT can follow it.
    pub moved: Vec<(String, String)>,
}

#[derive(Serialize)]
pub struct LutParseResult {
    pub size: u32,
    /// The table for the edit to embed (`lutData`), so the look travels with the photo.
    pub data: Option<String>,
}

#[derive(Serialize)]
pub struct LutPreview {
    pub path: String,
    pub thumb: Option<String>,
}

pub fn get_luts_dir(app_data_dir: &Path) -> anyhow::Result<PathBuf> {
    let luts_dir = app_data_dir.join("luts");
    if !luts_dir.exists() {
        create_dir_all(&luts_dir)?;
    }
    Ok(luts_dir)
}

/// LUT file types the browser lists and `load_lut` can read: text LUTs and
/// HALD images.
const SUPPORTED_LUT_EXTENSIONS: &[&str] = &["cube", "3dl", "png", "jpg", "jpeg", "tif", "tiff"];

fn is_lut_file(path: &Path) -> bool {
    let extension = path
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_lowercase();
    path.is_file() && SUPPORTED_LUT_EXTENSIONS.contains(&extension.as_str())
}

/// The LUT files directly in `dir`, listed as members of `group`.
fn luts_in_folder(dir: &Path, group: &str) -> anyhow::Result<Vec<LutEntry>> {
    let mut entries = Vec::new();
    for entry in read_dir(dir)? {
        let path = entry?.path();
        if !is_lut_file(&path) {
            continue;
        }
        let file_name = path
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or_default()
            .to_string();
        entries.push(LutEntry {
            name: path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("LUT")
                .to_string(),
            path: path.to_string_lossy().into_owned(),
            group: group.to_string(),
            id: if group.is_empty() {
                file_name
            } else {
                format!("{group}/{file_name}")
            },
        });
    }
    Ok(entries)
}

/// The group folders of `luts/`: its subfolders, one level (Plan item 86, decisions L1–L2).
fn group_folders(dir: &Path) -> anyhow::Result<Vec<PathBuf>> {
    Ok(read_dir(dir)?
        .filter_map(|entry| entry.ok().map(|entry| entry.path()))
        .filter(|path| {
            path.is_dir()
                && path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .is_some_and(|name| !name.starts_with('.'))
        })
        .collect())
}

/// The LUTs in `dir` (`luts/`) and in its group subfolders, by group, then name.
pub fn list_luts_in_dir(dir: &Path) -> anyhow::Result<Vec<LutEntry>> {
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let mut entries = luts_in_folder(dir, "")?;
    for folder in group_folders(dir)? {
        let group = folder
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or_default()
            .to_string();
        entries.extend(luts_in_folder(&folder, &group)?);
    }
    entries.sort_by_key(|entry| (entry.group.to_lowercase(), entry.name.to_lowercase()));
    Ok(entries)
}

/// The folder of `group` in `luts_dir`, created when needed; `luts_dir` itself for no group.
pub fn lut_group_dir(luts_dir: &Path, group: &str) -> Result<PathBuf, String> {
    let group = group.trim();
    if group.is_empty() {
        return Ok(luts_dir.to_path_buf());
    }
    let name = crate::naming::clean_file_stem(group);
    if name.is_empty() || name.starts_with('.') {
        return Err(format!("'{group}' cannot be a group name"));
    }
    let dir = luts_dir.join(name);
    create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// Whether `path` is a file in `luts_dir` or in one of its group folders.
fn is_in_luts_dir(luts_dir: &Path, path: &Path) -> bool {
    let Ok(luts_dir) = luts_dir.canonicalize() else {
        return false;
    };
    path.parent()
        .and_then(|parent| parent.canonicalize().ok())
        .is_some_and(|parent| {
            parent == luts_dir || parent.parent().is_some_and(|above| above == luts_dir)
        })
}

/// Moves the LUT files at `paths` into `group`'s folder (renamed `name (n)` on a clash) and
/// removes group folders the move left empty. Returns `(from, to)` for each moved file.
pub fn move_luts_in(
    luts_dir: &Path,
    paths: &[String],
    group: &str,
) -> Result<Vec<(String, String)>, String> {
    let target = lut_group_dir(luts_dir, group)?;
    let mut moved = Vec::new();
    for path in paths {
        let source = Path::new(path);
        if !is_lut_file(source) || !is_in_luts_dir(luts_dir, source) {
            return Err(format!("'{path}' is not a LUT in the LUT folder"));
        }
        let parent = source.parent().map(Path::to_path_buf);
        if parent.as_deref() == Some(target.as_path()) {
            continue;
        }
        let stem = source.file_stem().and_then(|s| s.to_str()).unwrap_or("LUT");
        let extension = source
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("cube");
        let destination = unique_destination(&target, stem, extension);
        std::fs::rename(source, &destination).map_err(|e| e.to_string())?;
        moved.push((path.clone(), destination.to_string_lossy().into_owned()));
        if let Some(parent) = parent.filter(|parent| parent != luts_dir) {
            // Only an empty folder is removed; one still holding files stays.
            let _ = std::fs::remove_dir(parent);
        }
    }
    Ok(moved)
}

/// A LUT moved since an edit stored its path (Looks → LUTs' groups are subfolders of `luts/`):
/// the file of the same name in `luts/` or one of its groups.
fn find_moved_lut(path: &Path) -> Option<PathBuf> {
    let file_name = path.file_name()?;
    let luts_dir = path
        .ancestors()
        .skip(1)
        .take(2)
        .find(|dir| dir.file_name().is_some_and(|name| name == "luts"))?;
    std::iter::once(luts_dir.to_path_buf())
        .chain(group_folders(luts_dir).ok()?)
        .map(|dir| dir.join(file_name))
        .find(|candidate| candidate.is_file())
}

/// `stem.extension` in `dir`, or the first free `stem (n).extension`; also names custom profiles.
pub(crate) fn unique_destination(dir: &Path, stem: &str, extension: &str) -> PathBuf {
    let mut candidate = dir.join(format!("{}.{}", stem, extension));
    let mut suffix = 1;
    while candidate.exists() && suffix < 1000 {
        candidate = dir.join(format!("{} ({}).{}", stem, suffix, extension));
        suffix += 1;
    }
    candidate
}

/// Copies the LUT files at `source_paths` into `dir` (`luts/` or a group folder).
pub fn import_luts_to_dir(dir: &Path, source_paths: &[String]) -> anyhow::Result<()> {
    for source in source_paths {
        if let Err(error) = parse_lut_file(source) {
            log::warn!("Skipping invalid LUT '{}': {}", source, error);
            continue;
        }

        #[cfg(target_os = "android")]
        if is_android_content_uri(source) {
            if let Err(error) = import_android_lut(source) {
                log::error!("Failed to import LUT from '{}': {}", source, error);
            }
            continue;
        }

        let source_path = Path::new(source);
        let stem = source_path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("LUT");
        let extension = source_path
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("cube")
            .to_lowercase();
        let destination = unique_destination(dir, stem, &extension);
        if let Err(error) = copy(source_path, &destination) {
            log::error!("Failed to copy LUT '{}': {}", source, error);
        }
    }
    Ok(())
}

#[cfg(target_os = "android")]
fn import_android_lut(source: &str) -> anyhow::Result<()> {
    let resolved_name = resolve_android_content_uri_name(source)
        .map_err(|e| anyhow!("Failed to resolve content URI: {}", e))?;
    let stem = Path::new(&resolved_name)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("LUT")
        .to_string();
    let extension = Path::new(&resolved_name)
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("cube")
        .to_lowercase();
    let bytes = read_android_content_uri(source)
        .map_err(|e| anyhow!("Failed to read content URI: {}", e))?;

    let cache_path = get_android_cached_lut_path(source, &extension)?;
    let cache_dir = cache_path
        .parent()
        .ok_or_else(|| anyhow!("Invalid cache path"))?
        .to_path_buf();
    let destination = unique_destination(&cache_dir, &stem, &extension);
    std::fs::write(&destination, &bytes)?;
    Ok(())
}

fn parse_cube(reader: impl BufRead) -> anyhow::Result<Lut> {
    let mut size: Option<u32> = None;
    let mut data: Vec<f32> = Vec::new();
    let mut line_num = 0;

    for line in reader.lines() {
        line_num += 1;
        let line = line?;
        let trimmed = line.trim();

        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }

        let parts: Vec<&str> = trimmed.split_whitespace().collect();
        if parts.is_empty() {
            continue;
        }

        match parts[0].to_uppercase().as_str() {
            "TITLE" | "DOMAIN_MIN" | "DOMAIN_MAX" => continue,

            "LUT_3D_SIZE" => {
                if parts.len() < 2 {
                    return Err(anyhow!(
                        "Malformed LUT_3D_SIZE on line {}: '{}'",
                        line_num,
                        line
                    ));
                }
                size = Some(parts[1].parse().map_err(|e| {
                    anyhow!(
                        "Failed to parse LUT_3D_SIZE on line {}: '{}'. Error: {}",
                        line_num,
                        line,
                        e
                    )
                })?);
            }
            _ => {
                if size.is_some() {
                    if parts.len() < 3 {
                        return Err(anyhow!(
                            "Invalid data line on line {}: '{}'. Expected 3 float values, found {}",
                            line_num,
                            line,
                            parts.len()
                        ));
                    }
                    let r: f32 = parts[0].parse().map_err(|e| {
                        anyhow!(
                            "Failed to parse R value on line {}: '{}'. Error: {}",
                            line_num,
                            line,
                            e
                        )
                    })?;
                    let g: f32 = parts[1].parse().map_err(|e| {
                        anyhow!(
                            "Failed to parse G value on line {}: '{}'. Error: {}",
                            line_num,
                            line,
                            e
                        )
                    })?;
                    let b: f32 = parts[2].parse().map_err(|e| {
                        anyhow!(
                            "Failed to parse B value on line {}: '{}'. Error: {}",
                            line_num,
                            line,
                            e
                        )
                    })?;
                    data.push(r);
                    data.push(g);
                    data.push(b);
                }
            }
        }
    }

    let lut_size = size.ok_or(anyhow!("LUT_3D_SIZE not found in .cube file"))?;
    let expected_len = (lut_size * lut_size * lut_size * 3) as usize;
    if data.len() != expected_len {
        return Err(anyhow!(
            "LUT data size mismatch. Expected {} float values (for size {}), but found {}. The file may be corrupt or incomplete.",
            expected_len,
            lut_size,
            data.len()
        ));
    }

    Ok(Lut {
        size: lut_size,
        data,
    })
}

fn parse_3dl(reader: impl BufRead) -> anyhow::Result<Lut> {
    let mut data: Vec<f32> = Vec::new();

    for line in reader.lines() {
        let line = line?;
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        let parts: Vec<&str> = trimmed.split_whitespace().collect();
        if parts.len() == 3 {
            let r: f32 = parts[0].parse()?;
            let g: f32 = parts[1].parse()?;
            let b: f32 = parts[2].parse()?;
            data.push(r);
            data.push(g);
            data.push(b);
        }
    }

    let total_values = data.len();
    if total_values == 0 {
        return Err(anyhow!("No data found in 3DL file"));
    }
    let num_entries = total_values / 3;
    let size = (num_entries as f64).cbrt().round() as u32;

    if size * size * size != num_entries as u32 {
        return Err(anyhow!(
            "Invalid 3DL LUT data size: the number of entries ({}) is not a perfect cube.",
            num_entries
        ));
    }

    Ok(Lut { size, data })
}

fn parse_hald(image: DynamicImage) -> anyhow::Result<Lut> {
    let (width, height) = image.dimensions();
    if width != height {
        return Err(anyhow!(
            "HALD image must be square, but dimensions are {}x{}",
            width,
            height
        ));
    }

    let total_pixels = width * height;
    let size = (total_pixels as f64).cbrt().round() as u32;

    if size * size * size != total_pixels {
        return Err(anyhow!(
            "Invalid HALD image dimensions: total pixels ({}) is not a perfect cube.",
            total_pixels
        ));
    }

    let mut data = Vec::with_capacity((total_pixels * 3) as usize);
    let rgb_image = image.to_rgb8();

    for pixel in rgb_image.pixels() {
        data.push(pixel[0] as f32 / 255.0);
        data.push(pixel[1] as f32 / 255.0);
        data.push(pixel[2] as f32 / 255.0);
    }

    Ok(Lut { size, data })
}

pub fn parse_lut_file(path_str: &str) -> anyhow::Result<Lut> {
    if path_str.starts_with(r"\\") || path_str.starts_with("//") {
        return Err(anyhow!("Network paths (UNC) are not allowed for LUTs"));
    }

    let path = std::path::Path::new(path_str);
    // Only a ".." path component is traversal; file names may contain "..".
    if path
        .components()
        .any(|component| component == std::path::Component::ParentDir)
    {
        return Err(anyhow!("Directory traversal (..) is not allowed"));
    }

    if let Some(std::path::Component::Prefix(prefix)) = path.components().next() {
        match prefix.kind() {
            std::path::Prefix::UNC(_, _)
            | std::path::Prefix::VerbatimUNC(_, _)
            | std::path::Prefix::DeviceNS(_) => {
                return Err(anyhow!("Device/UNC prefix paths are not allowed"));
            }
            _ => {}
        }
    }

    let (extension, bytes): (String, Option<Vec<u8>>) =
        if cfg!(target_os = "android") && is_android_content_uri(path_str) {
            #[cfg(target_os = "android")]
            {
                let resolved_name = resolve_android_content_uri_name(path_str)
                    .unwrap_or_else(|_| path_str.to_string());
                let ext = Path::new(&resolved_name)
                    .extension()
                    .and_then(|s| s.to_str())
                    .unwrap_or("cube")
                    .to_lowercase();
                let uri_bytes = read_android_content_uri(path_str).map_err(|e| anyhow!("{}", e))?;
                (ext, Some(uri_bytes))
            }
            #[cfg(not(target_os = "android"))]
            {
                (String::new(), None)
            }
        } else {
            let ext = Path::new(path_str)
                .extension()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_lowercase();
            (ext, None)
        };

    match extension.as_str() {
        "cube" => {
            if let Some(b) = bytes {
                parse_cube(BufReader::new(Cursor::new(b)))
            } else {
                let file = File::open(path_str)?;
                parse_cube(BufReader::new(file))
            }
        }
        "3dl" => {
            if let Some(b) = bytes {
                parse_3dl(BufReader::new(Cursor::new(b)))
            } else {
                let file = File::open(path_str)?;
                parse_3dl(BufReader::new(file))
            }
        }
        "png" | "jpg" | "jpeg" | "tif" | "tiff" => {
            let img = if let Some(b) = bytes {
                image::load_from_memory(&b)?
            } else {
                image::open(path_str)?
            };
            parse_hald(img)
        }
        _ => Err(anyhow!("Unsupported LUT file format: {}", extension)),
    }
}

pub fn generate_identity_lut_image(size: u32) -> DynamicImage {
    let width = size;
    let height = size * size;
    let mut img = Rgb32FImage::new(width, height);

    for z in 0..size {
        for y in 0..size {
            for x in 0..size {
                let r = x as f32 / (size - 1) as f32;
                let g = y as f32 / (size - 1) as f32;
                let b = z as f32 / (size - 1) as f32;

                img.put_pixel(x, z * size + y, Rgb([r, g, b]));
            }
        }
    }

    DynamicImage::ImageRgb32F(img)
}

pub fn convert_image_to_cube_lut(image: &DynamicImage, size: u32) -> Result<Vec<u8>, String> {
    let f32_image = image.to_rgb32f();
    let mut out = String::new();

    out.push_str(&format!("LUT_3D_SIZE {}\n", size));
    out.push_str("DOMAIN_MIN 0.0 0.0 0.0\n");
    out.push_str("DOMAIN_MAX 1.0 1.0 1.0\n");

    for z in 0..size {
        for y in 0..size {
            for x in 0..size {
                let pixel = f32_image.get_pixel(x, z * size + y);
                out.push_str(&format!(
                    "{:.6} {:.6} {:.6}\n",
                    pixel[0].clamp(0.0, 1.0),
                    pixel[1].clamp(0.0, 1.0),
                    pixel[2].clamp(0.0, 1.0)
                ));
            }
        }
    }

    Ok(out.into_bytes())
}

pub fn get_or_load_lut(state: &AppState, path: &str) -> Result<Arc<Lut>, String> {
    let mut cache = state.lut_cache.lock().unwrap();
    if let Some(lut) = cache.get(path) {
        return Ok(lut.clone());
    }

    // An edit from before `1.115.1` holds only the path; its LUT may have moved to a group since.
    let lut = match parse_lut_file(path) {
        Err(error) if !Path::new(path).exists() => find_moved_lut(Path::new(path))
            .ok_or(error)
            .and_then(|moved| parse_lut_file(&moved.to_string_lossy())),
        result => result,
    }
    .map_err(|e| e.to_string())?;
    let arc_lut = Arc::new(lut);
    cache.insert(path.to_string(), arc_lut.clone());
    Ok(arc_lut)
}

/// The finishing LUT's table as an edit embeds it (`lutData`): `<format>:<table>`, the table
/// stored as custom profiles store theirs (`custom_profile::encode_table`), exact to 16 bits.
/// `None` for a LUT that does not fit that storage (larger than 65³).
fn embed_lut(lut: &Lut) -> Option<String> {
    let table = crate::custom_profile::encode_table(&lut.data, lut.size).ok()?;
    Some(format!(
        "{}:{}",
        crate::custom_profile::FORMAT_VERSION,
        table
    ))
}

fn unembed_lut(embedded: &str, size: u32) -> Result<Lut, String> {
    let (version, table) = embedded
        .split_once(':')
        .ok_or("The embedded LUT has no format")?;
    let version = version
        .parse()
        .map_err(|_| "The embedded LUT's format is unreadable")?;
    let data = crate::custom_profile::decode_table(table, size, version)?;
    Ok(Lut { size, data })
}

/// The edit's finishing LUT: the table it embeds (`lutData`), so it renders the same on every
/// machine, else the file at `lutPath` (edits from before `1.115.1`, or a LUT too large to embed).
pub fn lut_for_adjustments(state: &AppState, adjustments: &serde_json::Value) -> Option<Arc<Lut>> {
    let embedded = adjustments["lutData"].as_str();
    let size = adjustments["lutSize"].as_u64().map(|size| size as u32);
    if let (Some(embedded), Some(size)) = (embedded, size) {
        let key = format!("embedded:{}", blake3::hash(embedded.as_bytes()));
        if let Some(lut) = state.lut_cache.lock().unwrap().get(&key) {
            return Some(lut.clone());
        }
        match unembed_lut(embedded, size) {
            Ok(lut) => {
                let lut = Arc::new(lut);
                state.lut_cache.lock().unwrap().insert(key, lut.clone());
                return Some(lut);
            }
            Err(error) => log::warn!("Ignoring an unreadable embedded LUT: {}", error),
        }
    }
    adjustments["lutPath"]
        .as_str()
        .and_then(|path| get_or_load_lut(state, path).ok())
}

#[tauri::command]
pub fn list_luts(app_handle: AppHandle) -> Result<Vec<LutEntry>, String> {
    let data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    let luts_dir = get_luts_dir(&data_dir).map_err(|e| e.to_string())?;

    #[cfg(target_os = "android")]
    {
        combined_lut_list(&luts_dir).map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "android"))]
    {
        list_luts_in_dir(&luts_dir).map_err(|e| e.to_string())
    }
}

#[cfg(target_os = "android")]
fn get_lut_cache_dir() -> anyhow::Result<PathBuf> {
    let cache_path = get_android_cached_lut_path("_", "tmp")?;
    cache_path
        .parent()
        .ok_or_else(|| anyhow!("Invalid cache path"))
        .map(|p| p.to_path_buf())
}

#[cfg(target_os = "android")]
fn list_luts_in_cache() -> anyhow::Result<Vec<LutEntry>> {
    let cache_dir = get_lut_cache_dir()?;

    if !cache_dir.exists() {
        return Ok(Vec::new());
    }

    let mut entries: Vec<LutEntry> = Vec::new();
    for entry in read_dir(&cache_dir)? {
        let path = entry?.path();
        let extension = path
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_lowercase();
        if SUPPORTED_LUT_EXTENSIONS.contains(&extension.as_str()) {
            let name = path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("LUT")
                .to_string();
            entries.push(LutEntry {
                id: path
                    .file_name()
                    .and_then(|s| s.to_str())
                    .unwrap_or_default()
                    .to_string(),
                name,
                path: path.to_string_lossy().into_owned(),
                group: String::new(),
            });
        }
    }
    entries.sort_by_key(|a| a.name.to_lowercase());
    Ok(entries)
}

#[cfg(target_os = "android")]
fn combined_lut_list(luts_dir: &Path) -> anyhow::Result<Vec<LutEntry>> {
    let mut entries = list_luts_in_dir(luts_dir)?;
    if let Ok(cached) = list_luts_in_cache() {
        entries.extend(cached);
    }
    Ok(entries)
}

/// Copies LUT files into `luts/`, or into `group`'s folder when one is given.
#[tauri::command]
pub fn import_luts(
    app_handle: AppHandle,
    source_paths: Vec<String>,
    group: Option<String>,
) -> Result<Vec<LutEntry>, String> {
    let data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    let luts_dir = get_luts_dir(&data_dir).map_err(|e| e.to_string())?;
    let target = lut_group_dir(&luts_dir, group.as_deref().unwrap_or_default())?;
    import_luts_to_dir(&target, &source_paths).map_err(|e| e.to_string())?;

    #[cfg(target_os = "android")]
    {
        combined_lut_list(&luts_dir).map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "android"))]
    {
        list_luts_in_dir(&luts_dir).map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub fn remove_lut(app_handle: AppHandle, path: String) -> Result<Vec<LutEntry>, String> {
    let data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    let luts_dir = get_luts_dir(&data_dir).map_err(|e| e.to_string())?;
    let target_path = PathBuf::from(&path);

    #[cfg(target_os = "android")]
    {
        let cache_dir = get_lut_cache_dir().map_err(|e| e.to_string())?;
        if !target_path.starts_with(&luts_dir) && !target_path.starts_with(&cache_dir) {
            return Err(
                "Access denied: Cannot remove files outside the user LUT directory".to_string(),
            );
        }
    }
    #[cfg(not(target_os = "android"))]
    if !target_path.starts_with(&luts_dir) {
        return Err(
            "Access denied: Cannot remove files outside the user LUT directory".to_string(),
        );
    }

    if target_path.exists() {
        std::fs::remove_file(&target_path).map_err(|e| e.to_string())?;
        // A group folder left empty goes with its last LUT.
        if let Some(parent) = target_path.parent().filter(|parent| *parent != luts_dir) {
            let _ = std::fs::remove_dir(parent);
        }
    } else {
        return Err("LUT file not found".to_string());
    }

    #[cfg(target_os = "android")]
    {
        combined_lut_list(&luts_dir).map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "android"))]
    {
        list_luts_in_dir(&luts_dir).map_err(|e| e.to_string())
    }
}

/// Looks → LUTs' Move to Group, Rename Group (every LUT of a group into the new name) and Delete
/// Group (into `luts/` itself: nothing is deleted).
#[tauri::command]
pub async fn move_luts_to_group(
    app_handle: AppHandle,
    paths: Vec<String>,
    group: String,
) -> Result<MovedLuts, String> {
    crate::blocking_command::run_blocking(move || {
        let data_dir = app_handle
            .path()
            .app_data_dir()
            .map_err(|e| e.to_string())?;
        let luts_dir = get_luts_dir(&data_dir).map_err(|e| e.to_string())?;
        let moved = move_luts_in(&luts_dir, &paths, &group)?;
        Ok(MovedLuts {
            entries: list_luts_in_dir(&luts_dir).map_err(|e| e.to_string())?,
            moved,
        })
    })
    .await
}

/// A small preview of the open photo for a browser swatch (a LUT, a custom profile), as a JPEG
/// data URL; `None` when it cannot be rendered.
pub(crate) fn render_swatch(
    context: &crate::image_processing::GpuContext,
    state: &State<AppState>,
    source: &crate::render_source::RenderSource,
    adjustments: crate::image_processing::AllAdjustments,
    lut: Option<Arc<Lut>>,
    profile: Option<Arc<crate::custom_profile::ProfileTable>>,
    caller_id: &str,
) -> Option<String> {
    let processed = process_and_get_dynamic_image(
        context,
        state,
        source,
        RenderRequest {
            adjustments,
            mask_bitmaps: &[],
            lut,
            profile,
            roi: None,
            probe: None,
            motion_blur: Default::default(),
        },
        caller_id,
    )
    .ok()?;

    let rgb = processed.to_rgb8();
    let (width, height) = rgb.dimensions();
    let bytes = Encoder::new(Preset::BaselineFastest)
        .quality(80)
        .encode_rgb(&rgb.into_vec(), width, height)
        .ok()?;
    Some(format!(
        "data:image/jpeg;base64,{}",
        general_purpose::STANDARD.encode(&bytes)
    ))
}

#[tauri::command]
pub fn generate_lut_previews(
    lut_paths: Vec<String>,
    size: u32,
    state: State<AppState>,
    app_handle: AppHandle,
) -> Result<Vec<LutPreview>, String> {
    let context = crate::image_processing::get_or_init_gpu_context(&state, &app_handle)?;
    let loaded_image = state
        .original_image
        .lock()
        .unwrap()
        .clone()
        .ok_or("No original image loaded for LUT previews")?;
    let is_raw = loaded_image.is_raw;

    let base_json = serde_json::json!({});
    let preview = crate::prepare_preview_source(&state, &context, &loaded_image, &base_json, size)?;
    let source = preview.render_source();

    let tm_override = resolve_tonemapper_override_from_handle(&app_handle, is_raw);
    let lut_json = serde_json::json!({
        "lutPath": "preview",
        "lutIntensity": 100,
        "sectionVisibility": { "effects": true }
    });
    let adjustments = get_all_adjustments_from_json(&lut_json, is_raw, tm_override);

    let previews = lut_paths
        .into_iter()
        .map(|path| {
            let thumb = get_or_load_lut(&state, &path).ok().and_then(|lut| {
                render_swatch(
                    &context,
                    &state,
                    &source,
                    adjustments,
                    Some(lut),
                    None,
                    "generate_lut_previews",
                )
            });
            LutPreview { path, thumb }
        })
        .collect();

    Ok(previews)
}

#[tauri::command]
pub fn load_and_parse_lut(path: String, state: State<AppState>) -> Result<LutParseResult, String> {
    let lut = parse_lut_file(&path).map_err(|e| e.to_string())?;
    let result = LutParseResult {
        size: lut.size,
        data: embed_lut(&lut),
    };

    let mut cache = state.lut_cache.lock().unwrap();
    cache.insert(path, Arc::new(lut));

    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A 5³ `.cube` with a warm cast, as `parse_cube` reads it.
    fn warm_lut() -> Lut {
        let size = 5;
        let text: String = std::iter::once(format!("LUT_3D_SIZE {size}\n"))
            .chain((0..size * size * size).map(|index| {
                let [r, g, b] = [index % size, index / size % size, index / (size * size)]
                    .map(|axis| axis as f32 / (size - 1) as f32);
                format!("{} {} {}\n", (r * 1.05).min(1.0), g, b * 0.9)
            }))
            .collect();
        parse_cube(BufReader::new(Cursor::new(text))).unwrap()
    }

    #[test]
    fn an_embedded_lut_comes_back_to_sixteen_bits() {
        let lut = warm_lut();
        let embedded = embed_lut(&lut).unwrap();
        assert!(embedded.starts_with(&format!("{}:", crate::custom_profile::FORMAT_VERSION)));
        let back = unembed_lut(&embedded, lut.size).unwrap();
        assert_eq!(back.size, lut.size);
        for (a, b) in lut.data.iter().zip(&back.data) {
            assert!((a - b).abs() <= 0.5 / 65535.0 + f32::EPSILON);
        }
        assert!(unembed_lut("not a table", lut.size).is_err());
        assert!(unembed_lut(&embedded, lut.size + 1).is_err());
    }

    /// A temporary `luts/` folder with `warm.cube` in it and `cool.cube` in group `Film`.
    fn luts_folder() -> (PathBuf, PathBuf) {
        let root = std::env::temp_dir().join(format!("tir-luts-{}", uuid::Uuid::new_v4()));
        let luts = root.join("luts");
        std::fs::create_dir_all(luts.join("Film")).unwrap();
        std::fs::write(luts.join("warm.cube"), b"LUT").unwrap();
        std::fs::write(luts.join("Film").join("cool.cube"), b"LUT").unwrap();
        std::fs::write(luts.join("notes.txt"), b"not a LUT").unwrap();
        (root, luts)
    }

    #[test]
    fn luts_are_listed_with_their_group_folder() {
        let (root, luts) = luts_folder();
        let entries = list_luts_in_dir(&luts).unwrap();
        let listed: Vec<(&str, &str, &str)> = entries
            .iter()
            .map(|entry| (entry.group.as_str(), entry.name.as_str(), entry.id.as_str()))
            .collect();
        assert_eq!(
            listed,
            [
                ("", "warm", "warm.cube"),
                ("Film", "cool", "Film/cool.cube")
            ]
        );
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn moving_luts_between_groups_renames_clashes_and_drops_empty_groups() {
        let (root, luts) = luts_folder();
        let warm = luts.join("warm.cube").to_string_lossy().into_owned();
        let cool = luts
            .join("Film")
            .join("cool.cube")
            .to_string_lossy()
            .into_owned();

        let moved = move_luts_in(&luts, std::slice::from_ref(&warm), "Film").unwrap();
        assert_eq!(moved.len(), 1);
        assert!(luts.join("Film").join("warm.cube").is_file());

        std::fs::write(luts.join("cool.cube"), b"LUT").unwrap();
        move_luts_in(&luts, &[cool], "").unwrap();
        assert!(
            luts.join("cool (1).cube").is_file(),
            "a clash gets a number"
        );
        let warm_in_film = luts.join("Film").join("warm.cube");
        move_luts_in(&luts, &[warm_in_film.to_string_lossy().into_owned()], "").unwrap();
        assert!(
            !luts.join("Film").exists(),
            "the emptied group folder is gone"
        );

        assert!(
            move_luts_in(
                &luts,
                &[root.join("elsewhere.cube").to_string_lossy().into_owned()],
                "X"
            )
            .is_err()
        );
        assert!(lut_group_dir(&luts, "..").is_err());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_moved_lut_is_found_by_its_file_name() {
        let (root, luts) = luts_folder();
        assert_eq!(
            find_moved_lut(&luts.join("cool.cube")),
            Some(luts.join("Film").join("cool.cube"))
        );
        assert_eq!(
            find_moved_lut(&luts.join("Other").join("warm.cube")),
            Some(luts.join("warm.cube"))
        );
        assert_eq!(find_moved_lut(&luts.join("missing.cube")), None);
        assert_eq!(
            find_moved_lut(&root.join("warm.cube")),
            None,
            "only inside luts/"
        );
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_lut_larger_than_a_profile_table_is_not_embedded() {
        let lut = Lut {
            size: 66,
            data: vec![0.5; 66 * 66 * 66 * 3],
        };
        assert!(embed_lut(&lut).is_none());
    }
}
