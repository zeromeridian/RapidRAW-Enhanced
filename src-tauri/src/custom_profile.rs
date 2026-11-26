//! Custom profiles, as Adobe Camera Raw creates them (Plan item 83, `docs/COLOR_PROFILES_PLAN.md`).
//!
//! A look is baked from a photo's settings into a 3D table on linear light (plus, optionally,
//! the photo's tone curve), saved in the user's profile folder and embedded in every edit that
//! uses it, so the edit renders the same on a machine without the file. The shader applies it
//! after White Balance and Brightness (`apply_profile`): the table neither clips nor caps a
//! value, so every later adjustment works on the look's whole result.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, LazyLock, Mutex};

use base64::{Engine as _, engine::general_purpose};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager};

use crate::AppState;
use crate::image_processing::{AllAdjustments, GpuContext, get_all_adjustments_from_json};

/// The edit's profile (`ProfileData`) and its Amount (0–200, default 100).
pub const PROFILE_KEY: &str = "profile";
pub const PROFILE_AMOUNT_KEY: &str = "profileAmount";
/// The profile tool's eye (`sectionVisibility`).
const PROFILE_GROUP: &str = "profile";

const FORMAT_VERSION: u32 = 1;
const FILE_FORMAT: &str = "ThisIsRAW custom profile";
const FILE_EXTENSION: &str = "tirprofile";
const DEFAULT_LATTICE_SIZE: u32 = 33;
const MAX_LATTICE_SIZE: u32 = 65;
const MAX_AMOUNT: f32 = 2.0;
/// Tables kept decoded, newest last: enough for a photo and the previews around it.
const TABLE_CACHE_SIZE: usize = 4;

/// The adjustment keys a profile can bake: the stages from Exposure to the tone mapper that act
/// on each pixel alone (shader `bake_profile`), and the tone curve, which the profile carries.
pub const BAKEABLE_KEYS: &[&str] = &[
    "exposure",
    "temperature",
    "tint",
    "brightness",
    "contrast",
    "highlights",
    "shadows",
    "whites",
    "blacks",
    "hsl",
    "pointColors",
    "hue",
    "saturation",
    "vibrance",
    "colorGrading",
    "curves",
];

/// How the table is indexed: linear light in even log2 steps, from `stops_below` stops under
/// 1.0 to `stops_above` stops over it (shader `profile_shaper_encode`). Saved with each
/// profile, so a later change of the default does not change older profiles.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Shaper {
    pub stops_below: f32,
    pub stops_above: f32,
}

impl Default for Shaper {
    fn default() -> Self {
        Self {
            stops_below: 16.0,
            stops_above: 8.0,
        }
    }
}

/// A profile as its file and the edit store it.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ProfileData {
    pub version: u32,
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub group: String,
    /// Choosing the profile turns on Black & White, like Adobe's B&W profiles.
    #[serde(default)]
    pub monochrome: bool,
    pub size: u32,
    pub shaper: Shaper,
    /// The table: shaper-encoded RGB per lattice point (red fastest), as little-endian u16,
    /// zstd-compressed and base64-encoded.
    pub table: String,
    /// The tone curve's `luma`, `red`, `green` and `blue` points, as the edit's `curves`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub curves: Option<Value>,
}

/// The shader's view of the edit's profile: what the uniforms need, read without decoding
/// the table.
pub struct RenderSettings {
    /// 0 (no profile, or its eye off) to `MAX_AMOUNT`.
    pub amount: f32,
    pub shaper: Shaper,
    curves: Option<Value>,
}

impl RenderSettings {
    pub fn from_adjustments(adjustments: &Value) -> Self {
        let profile = adjustments
            .get(PROFILE_KEY)
            .filter(|value| value.is_object());
        let amount = match profile {
            Some(_) if crate::adjustment_utils::is_group_visible(adjustments, PROFILE_GROUP) => {
                (adjustments[PROFILE_AMOUNT_KEY].as_f64().unwrap_or(100.0) as f32 / 100.0)
                    .clamp(0.0, MAX_AMOUNT)
            }
            _ => 0.0,
        };
        let profile = profile.filter(|_| amount > 0.0);
        Self {
            amount,
            shaper: profile
                .and_then(|profile| serde_json::from_value(profile["shaper"].clone()).ok())
                .unwrap_or_default(),
            curves: profile.and_then(|profile| profile.get("curves").cloned()),
        }
    }

    /// The profile's points of one tone-curve channel (none without a profile).
    pub fn curve(&self, channel: &str) -> Vec<Value> {
        self.curves
            .as_ref()
            .and_then(|curves| curves.get(channel))
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default()
    }
}

/// A decoded table, ready for the GPU: shaper-encoded RGB per lattice point, red fastest.
pub struct ProfileTable {
    pub size: u32,
    pub data: Vec<f32>,
}

/// Decoded tables by the hash of their stored text, newest last.
type TableCache = Mutex<Vec<(blake3::Hash, Arc<ProfileTable>)>>;

static TABLE_CACHE: LazyLock<TableCache> = LazyLock::new(Default::default);

/// The table of the edit's profile when the profile is on, decoded once and then cached.
pub fn table_for_adjustments(adjustments: &Value) -> Option<Arc<ProfileTable>> {
    if RenderSettings::from_adjustments(adjustments).amount <= 0.0 {
        return None;
    }
    let profile = &adjustments[PROFILE_KEY];
    let encoded = profile["table"].as_str()?;
    let size = profile["size"].as_u64()? as u32;
    let key = blake3::hash(encoded.as_bytes());

    let mut cache = TABLE_CACHE.lock().unwrap();
    if let Some(index) = cache.iter().position(|(hash, _)| *hash == key) {
        let entry = cache.remove(index);
        let table = entry.1.clone();
        cache.push(entry);
        return Some(table);
    }
    let table = match decode_table(encoded, size) {
        Ok(data) => Arc::new(ProfileTable { size, data }),
        Err(error) => {
            log::warn!("Ignoring an unreadable custom profile: {}", error);
            return None;
        }
    };
    if cache.len() >= TABLE_CACHE_SIZE {
        cache.remove(0);
    }
    cache.push((key, table.clone()));
    Some(table)
}

fn table_len(size: u32) -> Result<usize, String> {
    if !(2..=MAX_LATTICE_SIZE).contains(&size) {
        return Err(format!("Unsupported profile table size {}", size));
    }
    Ok((size as usize).pow(3) * 3)
}

/// `values` (shaper-encoded, 0–1) as stored in a profile.
fn encode_table(values: &[f32]) -> Result<String, String> {
    let bytes: Vec<u8> = values
        .iter()
        .flat_map(|value| ((value.clamp(0.0, 1.0) * 65535.0).round() as u16).to_le_bytes())
        .collect();
    let compressed = zstd::encode_all(bytes.as_slice(), 19).map_err(|e| e.to_string())?;
    Ok(general_purpose::STANDARD.encode(compressed))
}

fn decode_table(encoded: &str, size: u32) -> Result<Vec<f32>, String> {
    let expected = table_len(size)?;
    let compressed = general_purpose::STANDARD
        .decode(encoded)
        .map_err(|e| e.to_string())?;
    let bytes = zstd::decode_all(compressed.as_slice()).map_err(|e| e.to_string())?;
    if bytes.len() != expected * 2 {
        return Err(format!(
            "Profile table holds {} bytes, expected {}",
            bytes.len(),
            expected * 2
        ));
    }
    Ok(bytes
        .chunks_exact(2)
        .map(|pair| u16::from_le_bytes([pair[0], pair[1]]) as f32 / 65535.0)
        .collect())
}

/// Renders the profile's lattice through the bakeable stages with `adjustments` (shader
/// `bake_profile`) and returns its shaper-encoded RGB values, red fastest.
fn bake_lattice(
    context: &GpuContext,
    adjustments: &AllAdjustments,
    size: u32,
) -> Result<Vec<f32>, String> {
    let device = &context.device;
    let module = device.create_shader_module(wgpu::ShaderModuleDescriptor {
        label: Some("Profile Bake Shader"),
        source: wgpu::ShaderSource::Wgsl(crate::gpu_processing::image_shader_source().into()),
    });
    let pipeline = device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
        label: Some("Profile Bake Pipeline"),
        layout: None,
        module: &module,
        entry_point: Some("bake_profile"),
        compilation_options: Default::default(),
        cache: None,
    });

    let adjustments_buffer = device.create_buffer(&wgpu::BufferDescriptor {
        label: Some("Profile Bake Adjustments"),
        size: std::mem::size_of::<AllAdjustments>() as u64,
        usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST,
        mapped_at_creation: false,
    });
    context
        .queue
        .write_buffer(&adjustments_buffer, 0, bytemuck::bytes_of(adjustments));
    let points = (size as u64).pow(3);
    let bytes = points * 16;
    let output = device.create_buffer(&wgpu::BufferDescriptor {
        label: Some("Profile Bake Output"),
        size: bytes,
        usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_SRC,
        mapped_at_creation: false,
    });
    let readback = device.create_buffer(&wgpu::BufferDescriptor {
        label: Some("Profile Bake Readback"),
        size: bytes,
        usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
        mapped_at_creation: false,
    });
    let bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
        label: Some("Profile Bake Bind Group"),
        layout: &pipeline.get_bind_group_layout(0),
        entries: &[
            wgpu::BindGroupEntry {
                binding: 2,
                resource: adjustments_buffer.as_entire_binding(),
            },
            wgpu::BindGroupEntry {
                binding: 13,
                resource: output.as_entire_binding(),
            },
        ],
    });

    let mut encoder = device.create_command_encoder(&Default::default());
    {
        let mut pass = encoder.begin_compute_pass(&Default::default());
        pass.set_pipeline(&pipeline);
        pass.set_bind_group(0, &bind_group, &[]);
        let groups = size.div_ceil(4);
        pass.dispatch_workgroups(groups, groups, groups);
    }
    encoder.copy_buffer_to_buffer(&output, 0, &readback, 0, bytes);
    context.queue.submit(Some(encoder.finish()));

    let (tx, rx) = std::sync::mpsc::channel();
    readback
        .slice(..)
        .map_async(wgpu::MapMode::Read, move |result| {
            let _ = tx.send(result);
        });
    device
        .poll(wgpu::PollType::Wait {
            submission_index: None,
            timeout: Some(std::time::Duration::from_secs(30)),
        })
        .map_err(|e| e.to_string())?;
    rx.recv()
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())?;
    let rgba: Vec<f32> = bytemuck::cast_slice(
        &readback
            .slice(..)
            .get_mapped_range()
            .map_err(|e| e.to_string())?,
    )
    .to_vec();
    readback.unmap();
    Ok(rgba
        .chunks_exact(4)
        .flat_map(|point| [point[0], point[1], point[2]])
        .collect())
}

/// The bake's adjustments: only `keys` of the photo's edit, its eyes kept (a hidden tool bakes
/// nothing), and the profile's shaper; masks, the Blend Pad and any current profile left out.
fn bake_adjustments(edit: &Value, keys: &[String], is_raw: bool, shaper: Shaper) -> AllAdjustments {
    let mut bake = serde_json::Map::new();
    for key in keys
        .iter()
        .filter(|key| BAKEABLE_KEYS.contains(&key.as_str()))
    {
        if let Some(value) = edit.get(key) {
            bake.insert(key.clone(), value.clone());
        }
    }
    if let Some(visibility) = edit.get("sectionVisibility") {
        bake.insert("sectionVisibility".into(), visibility.clone());
    }
    let mut adjustments = get_all_adjustments_from_json(&Value::Object(bake), is_raw, None);
    adjustments.global.has_profile = 0;
    adjustments.global.profile_stops_below = shaper.stops_below;
    adjustments.global.profile_stops_above = shaper.stops_above;
    adjustments
}

fn profiles_dir(app_handle: &AppHandle) -> Result<PathBuf, String> {
    let dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("profiles");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// A profile file inside the profile folder (no other path is read or deleted).
fn profile_path_in(dir: &Path, path: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(path);
    let is_inside = path
        .parent()
        .and_then(|parent| parent.canonicalize().ok())
        .zip(dir.canonicalize().ok())
        .is_some_and(|(parent, dir)| parent == dir);
    let is_profile = path
        .extension()
        .is_some_and(|extension| extension == FILE_EXTENSION);
    if is_inside && is_profile {
        Ok(path)
    } else {
        Err("Access denied: not a file in the profile folder".to_string())
    }
}

#[derive(Serialize, Deserialize)]
struct ProfileFile {
    format: String,
    profile: ProfileData,
}

fn read_profile_file(path: &Path) -> Result<ProfileData, String> {
    let text = fs::read_to_string(path).map_err(|e| e.to_string())?;
    let file: ProfileFile = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    if file.format != FILE_FORMAT {
        return Err(format!("{} is not a custom profile", path.display()));
    }
    Ok(file.profile)
}

/// A profile in the browser: what lists and groups it, without its table.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileEntry {
    pub path: String,
    pub id: String,
    pub name: String,
    pub group: String,
    pub monochrome: bool,
}

fn list_profiles_in(dir: &Path) -> Result<Vec<ProfileEntry>, String> {
    let mut entries: Vec<ProfileEntry> = fs::read_dir(dir)
        .map_err(|e| e.to_string())?
        .filter_map(|entry| entry.ok().map(|entry| entry.path()))
        .filter(|path| {
            path.extension()
                .is_some_and(|extension| extension == FILE_EXTENSION)
        })
        .filter_map(|path| match read_profile_file(&path) {
            Ok(profile) => Some(ProfileEntry {
                path: path.to_string_lossy().into_owned(),
                id: profile.id,
                name: profile.name,
                group: profile.group,
                monochrome: profile.monochrome,
            }),
            Err(error) => {
                log::warn!("Skipping custom profile {}: {}", path.display(), error);
                None
            }
        })
        .collect();
    entries.sort_by_key(|entry| (entry.group.to_lowercase(), entry.name.to_lowercase()));
    Ok(entries)
}

#[tauri::command]
pub async fn list_custom_profiles(app_handle: AppHandle) -> Result<Vec<ProfileEntry>, String> {
    crate::blocking_command::run_blocking(move || list_profiles_in(&profiles_dir(&app_handle)?))
        .await
}

#[tauri::command]
pub async fn load_custom_profile(
    path: String,
    app_handle: AppHandle,
) -> Result<ProfileData, String> {
    crate::blocking_command::run_blocking(move || {
        read_profile_file(&profile_path_in(&profiles_dir(&app_handle)?, &path)?)
    })
    .await
}

#[tauri::command]
pub async fn delete_custom_profile(
    path: String,
    app_handle: AppHandle,
) -> Result<Vec<ProfileEntry>, String> {
    crate::blocking_command::run_blocking(move || {
        let dir = profiles_dir(&app_handle)?;
        fs::remove_file(profile_path_in(&dir, &path)?).map_err(|e| e.to_string())?;
        list_profiles_in(&dir)
    })
    .await
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateProfileRequest {
    name: String,
    #[serde(default)]
    group: String,
    /// The adjustment keys to bake (`BAKEABLE_KEYS`); the frontend resets them afterwards.
    keys: Vec<String>,
    monochrome: bool,
    /// The photo's edit.
    adjustments: Value,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatedProfile {
    path: String,
    profile: ProfileData,
}

/// Bakes the open photo's chosen settings into a new profile and saves it in the profile folder.
#[tauri::command]
pub async fn create_custom_profile(
    request: CreateProfileRequest,
    app_handle: AppHandle,
) -> Result<CreatedProfile, String> {
    crate::blocking_command::run_blocking(move || {
        let state = app_handle.state::<AppState>();
        let name = request.name.trim();
        if name.is_empty() {
            return Err("A profile needs a name".to_string());
        }
        let is_raw = state
            .original_image
            .lock()
            .unwrap()
            .as_ref()
            .is_none_or(|image| image.is_raw);
        let context = crate::image_processing::get_or_init_gpu_context(&state, &app_handle)?;
        let shaper = Shaper::default();
        let adjustments = bake_adjustments(&request.adjustments, &request.keys, is_raw, shaper);
        let values = bake_lattice(&context, &adjustments, DEFAULT_LATTICE_SIZE)?;

        let bakes_curves = request.keys.iter().any(|key| key == "curves")
            && crate::adjustment_utils::is_group_visible(&request.adjustments, "curves");
        let profile = ProfileData {
            version: FORMAT_VERSION,
            id: uuid::Uuid::new_v4().to_string(),
            name: name.to_string(),
            group: request.group.trim().to_string(),
            monochrome: request.monochrome,
            size: DEFAULT_LATTICE_SIZE,
            shaper,
            table: encode_table(&values)?,
            curves: request
                .adjustments
                .get("curves")
                .filter(|_| bakes_curves)
                .cloned(),
        };

        let dir = profiles_dir(&app_handle)?;
        let stem = crate::naming::clean_file_stem(name);
        let path = crate::lut_processing::unique_destination(
            &dir,
            if stem.is_empty() { "Profile" } else { &stem },
            FILE_EXTENSION,
        );
        let file = ProfileFile {
            format: FILE_FORMAT.to_string(),
            profile: profile.clone(),
        };
        let text = serde_json::to_string_pretty(&file).map_err(|e| e.to_string())?;
        fs::write(&path, text).map_err(|e| e.to_string())?;
        log::info!(
            "Saved custom profile '{}' ({} bytes of table) to {}",
            profile.name,
            profile.table.len(),
            path.display()
        );
        Ok(CreatedProfile {
            path: path.to_string_lossy().into_owned(),
            profile,
        })
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// `Shaper`'s encoding, as `profile_shaper_encode` and `_decode` in the shader.
    fn encode(shaper: Shaper, linear: f32) -> f32 {
        let stops = linear.max(2f32.powf(-shaper.stops_below)).log2();
        ((stops + shaper.stops_below) / (shaper.stops_below + shaper.stops_above)).clamp(0.0, 1.0)
    }

    fn decode(shaper: Shaper, encoded: f32) -> f32 {
        2f32.powf(encoded * (shaper.stops_below + shaper.stops_above) - shaper.stops_below)
    }

    #[test]
    fn the_shaper_round_trips_linear_light_across_its_range() {
        let shaper = Shaper::default();
        for linear in [0.001_f32, 0.18, 1.0, 2.5, 100.0] {
            let back = decode(shaper, encode(shaper, linear));
            assert!(
                (back / linear - 1.0).abs() < 1e-4,
                "{linear} came back as {back}"
            );
        }
    }

    #[test]
    fn a_table_survives_encoding_within_sixteen_bits() {
        let size = 3;
        let values: Vec<f32> = (0..27 * 3).map(|i| i as f32 / 80.0).collect();
        let encoded = encode_table(&values).unwrap();
        let decoded = decode_table(&encoded, size).unwrap();
        assert_eq!(decoded.len(), values.len());
        for (a, b) in values.iter().zip(&decoded) {
            assert!((a - b).abs() <= 0.5 / 65535.0 + f32::EPSILON);
        }
        assert!(decode_table(&encoded, 4).is_err());
    }

    #[test]
    fn a_profile_is_on_only_with_its_eye_and_a_positive_amount() {
        let profile =
            json!({ "size": 2, "table": "", "shaper": { "stopsBelow": 12.0, "stopsAbove": 6.0 } });
        let on =
            RenderSettings::from_adjustments(&json!({ "profile": profile, "profileAmount": 150 }));
        assert_eq!(on.amount, 1.5);
        assert_eq!(on.shaper.stops_below, 12.0);

        let hidden = json!({ "profile": profile, "sectionVisibility": { "profile": false } });
        assert_eq!(RenderSettings::from_adjustments(&hidden).amount, 0.0);
        let faded = json!({ "profile": profile, "profileAmount": 0 });
        assert_eq!(RenderSettings::from_adjustments(&faded).amount, 0.0);
        assert_eq!(
            RenderSettings::from_adjustments(&json!({ "profileAmount": 100 })).amount,
            0.0
        );
        assert_eq!(
            RenderSettings::from_adjustments(&json!({ "profile": profile, "profileAmount": 900 }))
                .amount,
            MAX_AMOUNT
        );
    }

    #[test]
    fn the_bake_takes_only_the_chosen_keys() {
        let edit = json!({ "exposure": 1.0, "contrast": 40, "clarity": 50, "masks": [] });
        let keys = vec!["exposure".to_string(), "clarity".to_string()];
        let adjustments = bake_adjustments(&edit, &keys, true, Shaper::default());
        assert!(adjustments.global.exposure != 0.0);
        assert_eq!(adjustments.global.contrast, 0.0);
        assert_eq!(adjustments.global.clarity, 0.0, "Clarity is not bakeable");
        assert_eq!(adjustments.global.has_profile, 0);
    }

    /// Bakes on the GPU when one is available: an empty bake is the identity, and Exposure
    /// baked in doubles light per stop without capping it.
    #[test]
    fn an_empty_bake_is_the_identity_and_exposure_stays_uncapped() {
        let Some(context) = crate::gpu_processing::headless_gpu_context() else {
            eprintln!("No GPU adapter; skipping the profile bake test.");
            return;
        };
        let shaper = Shaper::default();
        let size = 9;
        let node = |i: u32| decode(shaper, i as f32 / (size - 1) as f32);

        let identity = bake_lattice(
            &context,
            &bake_adjustments(&json!({}), &[], true, shaper),
            size,
        )
        .unwrap();
        assert_eq!(identity.len(), (size as usize).pow(3) * 3);
        for (index, value) in identity.iter().enumerate() {
            let point = index / 3;
            let axis = [point % 9, point / 9 % 9, point / 81][index % 3] as u32;
            let expected = encode(shaper, node(axis));
            assert!(
                (value - expected).abs() < 1e-4,
                "point {point}: {value} vs {expected}"
            );
        }

        let brighter = bake_adjustments(
            &json!({ "exposure": 1.0 }),
            &["exposure".to_string()],
            true,
            shaper,
        );
        let stops = brighter.global.exposure;
        let baked = bake_lattice(&context, &brighter, size).unwrap();
        // A grey node above 1.0 keeps its full value: no cap at white.
        let grey = 6;
        let index = (grey + size * (grey + size * grey)) as usize * 3;
        let out = decode(shaper, baked[index]);
        let expected = node(grey) * 2f32.powf(stops);
        assert!(
            node(grey) > 1.0 && (out / expected - 1.0).abs() < 1e-3,
            "{out} vs {expected}"
        );
    }
}
