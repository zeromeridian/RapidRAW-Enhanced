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

/// How the table is stored (`encode_table`): 1, its values as they are (`1.112.x`); 2, their
/// steps from "no change", interleaved (`1.113.0`); 3, the same steps zigzag-coded, channel by
/// channel (`1.114.0`). Every version still loads.
pub(crate) const FORMAT_VERSION: u32 = 3;
const FILE_FORMAT: &str = "ThisIsRAW custom profile";
const FILE_EXTENSION: &str = "tirprofile";
const DEFAULT_LATTICE_SIZE: u32 = 33;
const MAX_LATTICE_SIZE: u32 = 65;
const MAX_AMOUNT: f32 = 2.0;
/// Tables kept decoded, newest last: enough for a photo and the previews around it.
const TABLE_CACHE_SIZE: usize = 4;

/// The edit's tone curve and Zone Editor block, which a profile carries as they are (they act
/// after the tone mapper, outside the table) and applies before the photo's own.
const CURVES_KEY: &str = "curves";
const ZONE_TINT_KEY: &str = "zoneTint";

/// The adjustment keys a profile can bake: every stage from Exposure to the tone mapper that
/// acts on each pixel alone (shader `bake_profile`), the photo's current profile, and the
/// tone curve and Zone Editor, which the profile carries.
pub const BAKEABLE_KEYS: &[&str] = &[
    PROFILE_KEY,
    PROFILE_AMOUNT_KEY,
    "exposure",
    "temperature",
    "tint",
    "brightness",
    "contrast",
    "highlights",
    "shadows",
    "whites",
    "blacks",
    "colorCalibration",
    "hsl",
    "pointColors",
    "hue",
    "saturation",
    "vibrance",
    "colorGrading",
    CURVES_KEY,
    ZONE_TINT_KEY,
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
    /// A Zone Editor block, as the edit's `zoneTint`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub zone_tint: Option<Value>,
    /// How often Update Profile has baked it again; photos keep the revision they were given.
    #[serde(default)]
    pub revision: u32,
    /// The ticked settings it was baked from, as the photo's edit held them, so Edit Profile can
    /// put them back on the sliders. Only the profile's file keeps it; edits embed the profile
    /// without it (profiles from `1.112.x` have none and can only be renamed).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub recipe: Option<Value>,
}

/// The shader's view of the edit's profile: what the uniforms need, read without decoding
/// the table.
pub struct RenderSettings {
    /// 0 (no profile, or its eye off) to `MAX_AMOUNT`.
    pub amount: f32,
    pub shaper: Shaper,
    curves: Option<Value>,
    zone_tint: Option<Value>,
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
            curves: profile.and_then(|profile| profile.get(CURVES_KEY).cloned()),
            zone_tint: profile.and_then(|profile| profile.get(ZONE_TINT_KEY).cloned()),
        }
    }

    /// The profile's Zone Editor for the shader (off without a profile).
    pub fn zone_tint(&self) -> crate::zone_tint::ZoneTintSettings {
        crate::zone_tint::ZoneTintSettings::from_json(self.zone_tint.as_ref(), true)
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
    let version = profile["version"].as_u64().unwrap_or(1) as u32;
    let table = match decode_table(encoded, size, version) {
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
        return Err(format!("Unsupported table size {}", size));
    }
    Ok((size as usize).pow(3) * 3)
}

fn quantize(value: f32) -> u16 {
    (value.clamp(0.0, 1.0) * 65535.0).round() as u16
}

/// The value of the table's `index`th entry (RGB interleaved, red fastest) when the profile
/// changes nothing: the lattice point's own shaper-encoded channel.
fn identity_entry(index: usize, size: usize) -> u16 {
    let point = index / 3;
    let axis = [point % size, point / size % size, point / (size * size)][index % 3];
    quantize(axis as f32 / (size - 1) as f32)
}

/// Whether the entry before `index` along red is the same channel of the lattice point next to
/// it (not the last point of the previous row).
fn has_red_neighbour(index: usize, size: usize) -> bool {
    !(index / 3).is_multiple_of(size)
}

/// A step (two's complement in 16 bits) with small sizes first, either sign: 0, −1, 1, −2, …
fn zigzag(step: u16) -> u16 {
    let signed = step as i16;
    ((signed << 1) ^ (signed >> 15)) as u16
}

fn unzigzag(code: u16) -> u16 {
    (code >> 1) ^ 0u16.wrapping_sub(code & 1)
}

/// A 3D table's `values` (0–1, RGB per lattice point, red fastest: a profile's shaper-encoded
/// table, or a finishing LUT, `lut_processing::lut_for_adjustments`) as they are stored
/// (`FORMAT_VERSION` 3, exact to 16 bits; values outside 0–1 are clamped): each entry's
/// distance from "no change", then that distance's step from its neighbour along red,
/// zigzag-coded so small steps of either sign stay small, red, green and blue channels one
/// after another, low bytes first and high bytes after. A look leaves small, repetitive numbers
/// there, which zstd packs far tighter than the values themselves (version 1: the values;
/// version 2: interleaved, two's complement steps).
pub(crate) fn encode_table(values: &[f32], size: u32) -> Result<String, String> {
    let size_usize = size as usize;
    if values.len() != table_len(size)? {
        return Err("The table does not match its size".to_string());
    }
    let residuals: Vec<u16> = values
        .iter()
        .enumerate()
        .map(|(index, value)| quantize(*value).wrapping_sub(identity_entry(index, size_usize)))
        .collect();
    let step = |index: usize| {
        if has_red_neighbour(index, size_usize) {
            residuals[index].wrapping_sub(residuals[index - 3])
        } else {
            residuals[index]
        }
    };
    let codes: Vec<u16> = (0..3)
        .flat_map(|channel| (channel..residuals.len()).step_by(3))
        .map(|index| zigzag(step(index)))
        .collect();
    let bytes: Vec<u8> = codes
        .iter()
        .map(|code| code.to_le_bytes()[0])
        .chain(codes.iter().map(|code| code.to_le_bytes()[1]))
        .collect();
    let compressed = zstd::encode_all(bytes.as_slice(), 19).map_err(|e| e.to_string())?;
    Ok(general_purpose::STANDARD.encode(compressed))
}

/// A stored table back to its values, in any `FORMAT_VERSION` (`encode_table`).
pub(crate) fn decode_table(encoded: &str, size: u32, version: u32) -> Result<Vec<f32>, String> {
    if version > FORMAT_VERSION {
        return Err(format!(
            "The profile was made by a newer ThisIsRAW (format {version})"
        ));
    }
    let expected = table_len(size)?;
    let compressed = general_purpose::STANDARD
        .decode(encoded)
        .map_err(|e| e.to_string())?;
    let bytes = zstd::decode_all(compressed.as_slice()).map_err(|e| e.to_string())?;
    if bytes.len() != expected * 2 {
        return Err(format!(
            "The table holds {} bytes, expected {}",
            bytes.len(),
            expected * 2
        ));
    }
    let to_value = |quantized: u16| quantized as f32 / 65535.0;
    if version <= 1 {
        return Ok(bytes
            .chunks_exact(2)
            .map(|pair| to_value(u16::from_le_bytes([pair[0], pair[1]])))
            .collect());
    }
    let (low, high) = bytes.split_at(expected);
    let size_usize = size as usize;
    let points = expected / 3;
    let mut residuals = vec![0u16; expected];
    for index in 0..expected {
        let step = if version == 2 {
            u16::from_le_bytes([low[index], high[index]])
        } else {
            let stored = (index % 3) * points + index / 3;
            unzigzag(u16::from_le_bytes([low[stored], high[stored]]))
        };
        residuals[index] = if has_red_neighbour(index, size_usize) {
            residuals[index - 3].wrapping_add(step)
        } else {
            step
        };
    }
    Ok(residuals
        .iter()
        .enumerate()
        .map(|(index, residual)| to_value(residual.wrapping_add(identity_entry(index, size_usize))))
        .collect())
}

/// Renders the profile's lattice through the bakeable stages (shader `bake_profile`) and
/// returns its shaper-encoded RGB values, red fastest.
fn bake_lattice(context: &GpuContext, bake: &Bake, size: u32) -> Result<Vec<f32>, String> {
    let device = &context.device;
    let adjustments = &bake.adjustments;
    // The photo's current profile when it is baked in; otherwise an unread placeholder.
    let placeholder = ProfileTable {
        size: 1,
        data: vec![0.0; 3],
    };
    let base_view = crate::gpu_processing::upload_profile_table(
        device,
        &context.queue,
        bake.base.as_deref().unwrap_or(&placeholder),
    );
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
                binding: 12,
                resource: wgpu::BindingResource::TextureView(&base_view),
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

/// What a new profile takes from the photo: the ticked keys of its edit (eyes kept, so a hidden
/// tool bakes nothing; masks and the Blend Pad left out) for the table, its current profile
/// when that is ticked, and the tone curve and Zone Editor it carries.
struct Bake {
    adjustments: AllAdjustments,
    /// The photo's current profile, baked into the new table at its Amount.
    base: Option<Arc<ProfileTable>>,
    shaper: Shaper,
    curves: Option<Value>,
    zone_tint: Option<Value>,
    /// Ticked keys left in the photo: its own curve or Zone Editor when the current profile,
    /// baked in, already carries one (a profile carries one of each).
    kept: Vec<String>,
}

impl Bake {
    fn new(edit: &Value, keys: &[String], is_raw: bool) -> Self {
        let is_ticked = |key: &str| {
            BAKEABLE_KEYS.contains(&key) && keys.iter().any(|ticked| ticked.as_str() == key)
        };
        let mut table_keys = serde_json::Map::new();
        for key in BAKEABLE_KEYS
            .iter()
            .filter(|key| is_ticked(key) && ![CURVES_KEY, ZONE_TINT_KEY].contains(key))
        {
            if let Some(value) = edit.get(*key) {
                table_keys.insert((*key).to_string(), value.clone());
            }
        }
        if let Some(visibility) = edit.get("sectionVisibility") {
            table_keys.insert("sectionVisibility".into(), visibility.clone());
        }
        let table_json = Value::Object(table_keys);

        let base = table_for_adjustments(&table_json);
        let base_profile = base.as_ref().map(|_| &edit[PROFILE_KEY]);
        // A new table must be indexed like the one baked into it.
        let shaper = if base.is_some() {
            RenderSettings::from_adjustments(&table_json).shaper
        } else {
            Shaper::default()
        };
        let mut adjustments = get_all_adjustments_from_json(&table_json, is_raw, None);
        adjustments.global.has_profile = u32::from(base.is_some());
        adjustments.global.profile_stops_below = shaper.stops_below;
        adjustments.global.profile_stops_above = shaper.stops_above;

        let mut kept = Vec::new();
        let mut carried = |key: &str, group: &str, is_active: fn(&Value) -> bool| {
            let from_base = base_profile
                .and_then(|profile| profile.get(key))
                .filter(|value| is_active(value));
            let from_photo = edit.get(key).filter(|value| {
                is_ticked(key)
                    && crate::adjustment_utils::is_group_visible(edit, group)
                    && is_active(value)
            });
            if from_base.is_some() && from_photo.is_some() {
                kept.push(key.to_string());
            }
            from_base.or(from_photo).cloned()
        };
        let curves = carried(CURVES_KEY, "curves", |curves| !is_identity_curve(curves));
        let zone_tint = carried(ZONE_TINT_KEY, ZONE_TINT_KEY, |zone_tint| {
            crate::zone_tint::ZoneTintSettings::from_json(Some(zone_tint), true).enabled == 1
        });

        Self {
            adjustments,
            base,
            shaper,
            curves,
            zone_tint,
            kept,
        }
    }
}

/// Whether every channel of `curves` (the edit's `curves`) leaves its tones as they are, as the
/// shader's `is_default_curve` judges it.
fn is_identity_curve(curves: &Value) -> bool {
    ["luma", "red", "green", "blue"].iter().all(|channel| {
        curves[*channel].as_array().is_none_or(|points| {
            let xy = |point: &Value| {
                (
                    point["x"].as_f64().unwrap_or(0.0),
                    point["y"].as_f64().unwrap_or(0.0),
                )
            };
            let is_at = |point: Option<&Value>, value: f64| {
                point
                    .map(xy)
                    .is_some_and(|(x, y)| (x - value).abs() < 0.1 && (y - value).abs() < 0.1)
            };
            points.len() < 2
                || (points.iter().map(xy).all(|(x, y)| (x - y).abs() <= 0.5)
                    && is_at(points.first(), 0.0)
                    && is_at(points.last(), 255.0))
        })
    })
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
    /// It keeps the settings it was baked from, so Edit Profile can reopen them.
    pub can_edit: bool,
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
                can_edit: profile.recipe.is_some(),
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
    /// The adjustment keys to bake (`BAKEABLE_KEYS`); the frontend resets them afterwards,
    /// apart from `CreatedProfile::kept_keys`.
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
    /// Ticked keys the profile could not take (`Bake::kept`); the photo keeps them.
    kept_keys: Vec<String>,
}

/// The ticked settings as the edit holds them, for Edit Profile (`ProfileData::recipe`); a
/// current profile among them is kept without its own recipe.
fn recipe_of(edit: &Value, keys: &[String]) -> Value {
    let mut recipe = serde_json::Map::new();
    for key in keys {
        if let Some(value) = edit.get(key) {
            let mut value = value.clone();
            if key == PROFILE_KEY
                && let Some(profile) = value.as_object_mut()
            {
                profile.remove("recipe");
            }
            recipe.insert(key.clone(), value);
        }
    }
    Value::Object(recipe)
}

/// Writes `profile` into the profile folder, named after it: at `previous` when that file
/// already has the name, else at a new free name, removing `previous`.
fn save_profile(
    dir: &Path,
    profile: &ProfileData,
    previous: Option<&Path>,
) -> Result<PathBuf, String> {
    let stem = crate::naming::clean_file_stem(&profile.name);
    let stem = if stem.is_empty() { "Profile" } else { &stem };
    let path = match previous {
        Some(previous) if previous.file_stem().is_some_and(|current| current == stem) => {
            previous.to_path_buf()
        }
        _ => crate::lut_processing::unique_destination(dir, stem, FILE_EXTENSION),
    };
    let file = ProfileFile {
        format: FILE_FORMAT.to_string(),
        profile: profile.clone(),
    };
    let text = serde_json::to_string_pretty(&file).map_err(|e| e.to_string())?;
    fs::write(&path, text).map_err(|e| e.to_string())?;
    if let Some(previous) = previous.filter(|previous| *previous != path) {
        fs::remove_file(previous).map_err(|e| e.to_string())?;
    }
    log::info!(
        "Saved custom profile '{}' revision {} ({} bytes of table) to {}",
        profile.name,
        profile.revision,
        profile.table.len(),
        path.display()
    );
    Ok(path)
}

/// Bakes the open photo's chosen settings into a profile and saves it: a new one, or a new
/// revision of `previous` (its file and id), which photos already using it do not follow.
fn bake_and_save(
    app_handle: &AppHandle,
    request: &CreateProfileRequest,
    previous: Option<(&Path, ProfileData)>,
) -> Result<CreatedProfile, String> {
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
    let context = crate::image_processing::get_or_init_gpu_context(&state, app_handle)?;
    let bake = Bake::new(&request.adjustments, &request.keys, is_raw);
    let values = bake_lattice(&context, &bake, DEFAULT_LATTICE_SIZE)?;

    let (previous_path, id, revision) = match previous {
        Some((path, profile)) => (Some(path), profile.id, profile.revision + 1),
        None => (None, uuid::Uuid::new_v4().to_string(), 0),
    };
    let profile = ProfileData {
        version: FORMAT_VERSION,
        id,
        name: name.to_string(),
        group: request.group.trim().to_string(),
        monochrome: request.monochrome,
        size: DEFAULT_LATTICE_SIZE,
        shaper: bake.shaper,
        table: encode_table(&values, DEFAULT_LATTICE_SIZE)?,
        curves: bake.curves,
        zone_tint: bake.zone_tint,
        revision,
        recipe: Some(recipe_of(&request.adjustments, &request.keys)),
    };
    let path = save_profile(&profiles_dir(app_handle)?, &profile, previous_path)?;
    Ok(CreatedProfile {
        path: path.to_string_lossy().into_owned(),
        profile,
        kept_keys: bake.kept,
    })
}

/// Bakes the open photo's chosen settings into a new profile in the profile folder.
#[tauri::command]
pub async fn create_custom_profile(
    request: CreateProfileRequest,
    app_handle: AppHandle,
) -> Result<CreatedProfile, String> {
    crate::blocking_command::run_blocking(move || bake_and_save(&app_handle, &request, None)).await
}

/// Bakes the open photo's chosen settings again into the profile at `path` (Update Profile).
#[tauri::command]
pub async fn update_custom_profile(
    path: String,
    request: CreateProfileRequest,
    app_handle: AppHandle,
) -> Result<CreatedProfile, String> {
    crate::blocking_command::run_blocking(move || {
        let path = profile_path_in(&profiles_dir(&app_handle)?, &path)?;
        let previous = read_profile_file(&path)?;
        bake_and_save(&app_handle, &request, Some((&path, previous)))
    })
    .await
}

/// Renames the profile at `path`, moves it to `group` and sets its Black & White flag; its look
/// stays as it is.
#[tauri::command]
pub async fn rename_custom_profile(
    path: String,
    name: String,
    group: String,
    monochrome: bool,
    app_handle: AppHandle,
) -> Result<Vec<ProfileEntry>, String> {
    crate::blocking_command::run_blocking(move || {
        let dir = profiles_dir(&app_handle)?;
        let path = profile_path_in(&dir, &path)?;
        let name = name.trim();
        if name.is_empty() {
            return Err("A profile needs a name".to_string());
        }
        let profile = ProfileData {
            name: name.to_string(),
            group: group.trim().to_string(),
            monochrome,
            ..read_profile_file(&path)?
        };
        save_profile(&dir, &profile, Some(&path))?;
        list_profiles_in(&dir)
    })
    .await
}

/// Adds a profile from elsewhere (a photo's edit, an imported file) to the profile folder,
/// after checking that its table loads; one whose id is already there becomes a profile of its
/// own, so choosing either never picks the other.
fn add_to_folder(dir: &Path, mut profile: ProfileData) -> Result<PathBuf, String> {
    decode_table(&profile.table, profile.size, profile.version)?;
    if list_profiles_in(dir)?
        .iter()
        .any(|entry| entry.id == profile.id)
    {
        profile.id = uuid::Uuid::new_v4().to_string();
    }
    save_profile(dir, &profile, None)
}

/// Save to my profiles: keeps a profile that only a photo's edit holds (from another machine,
/// or deleted from the folder) in the profile folder.
#[tauri::command]
pub async fn save_embedded_custom_profile(
    profile: ProfileData,
    app_handle: AppHandle,
) -> Result<Vec<ProfileEntry>, String> {
    crate::blocking_command::run_blocking(move || {
        let dir = profiles_dir(&app_handle)?;
        add_to_folder(&dir, profile)?;
        list_profiles_in(&dir)
    })
    .await
}

/// Copies `.tirprofile` files into the profile folder; files that are not profiles, or whose
/// table does not load, are skipped and named in the log.
#[tauri::command]
pub async fn import_custom_profiles(
    source_paths: Vec<String>,
    app_handle: AppHandle,
) -> Result<Vec<ProfileEntry>, String> {
    crate::blocking_command::run_blocking(move || {
        let dir = profiles_dir(&app_handle)?;
        for source in &source_paths {
            if let Err(error) = read_profile_file(Path::new(source))
                .and_then(|profile| add_to_folder(&dir, profile))
            {
                log::warn!("Skipping custom profile import {}: {}", source, error);
            }
        }
        list_profiles_in(&dir)
    })
    .await
}

/// Copies the profile at `path` to `destination`, a file the user chose, to share it.
#[tauri::command]
pub async fn export_custom_profile(
    path: String,
    destination: String,
    app_handle: AppHandle,
) -> Result<(), String> {
    crate::blocking_command::run_blocking(move || {
        let source = profile_path_in(&profiles_dir(&app_handle)?, &path)?;
        fs::copy(source, destination).map_err(|e| e.to_string())?;
        Ok(())
    })
    .await
}

/// Save as LUT (Create Profile's second target): the ticked settings of the open photo baked
/// into a `.cube` finishing LUT in the LUT folder, for Look → LUT on any photo. A LUT acts on
/// the finished photo, after every slider, so it matches JPEGs closely and RAW photos only
/// approximately. The photo itself is left as it is. Returns the new file's path.
#[tauri::command]
pub async fn save_settings_as_lut(
    request: CreateProfileRequest,
    app_handle: AppHandle,
) -> Result<String, String> {
    crate::blocking_command::run_blocking(move || {
        let name = request.name.trim();
        if name.is_empty() {
            return Err("A LUT needs a name".to_string());
        }
        let state = app_handle.state::<AppState>();
        let context = Arc::new(crate::image_processing::get_or_init_gpu_context(
            &state,
            &app_handle,
        )?);
        let mut edit = recipe_of(&request.adjustments, &request.keys);
        if let Some(visibility) = request.adjustments.get("sectionVisibility") {
            edit["sectionVisibility"] = visibility.clone();
        }
        edit["monochrome"] = request.monochrome.into();
        let cube = crate::export_processing::export_adjustments_as_lut(
            &edit,
            &context,
            &state,
            &std::sync::atomic::AtomicBool::new(false),
        )?;

        let data_dir = app_handle
            .path()
            .app_data_dir()
            .map_err(|e| e.to_string())?;
        let dir = crate::lut_processing::get_luts_dir(&data_dir).map_err(|e| e.to_string())?;
        let stem = crate::naming::clean_file_stem(name);
        let path = crate::lut_processing::unique_destination(
            &dir,
            if stem.is_empty() { "LUT" } else { &stem },
            "cube",
        );
        fs::write(&path, cube).map_err(|e| e.to_string())?;
        log::info!("Saved settings as LUT {}", path.display());
        Ok(path.to_string_lossy().into_owned())
    })
    .await
}

/// One profile's preview in the Profile browser's grid.
#[derive(Serialize)]
pub struct ProfilePreview {
    path: String,
    /// A JPEG data URL; `None` when the profile or the photo could not be rendered.
    thumb: Option<String>,
}

/// `edit` with `profile` as its base, as choosing it would make it (the frontend's
/// `withProfile`): the edit's Amount when it already has a profile, else 100, and the
/// profile's Black & White.
fn with_profile(edit: &Value, profile: &ProfileData) -> Value {
    let mut edit = edit.clone();
    let amount = if edit.get(PROFILE_KEY).is_some_and(Value::is_object) {
        edit[PROFILE_AMOUNT_KEY].as_f64().unwrap_or(100.0)
    } else {
        100.0
    };
    let mut embedded = serde_json::to_value(profile).unwrap_or_default();
    if let Some(embedded) = embedded.as_object_mut() {
        embedded.remove("recipe");
    }
    edit[PROFILE_KEY] = embedded;
    edit[PROFILE_AMOUNT_KEY] = amount.into();
    edit["monochrome"] = profile.monochrome.into();
    if let Some(visibility) = edit["sectionVisibility"].as_object_mut() {
        visibility.insert(PROFILE_GROUP.to_string(), true.into());
    }
    edit
}

/// Previews of the open photo with each profile at `paths` in place of its own, `size` pixels
/// on the long side, for the Profile browser's grid. Masks are left out to keep them quick.
#[tauri::command]
pub async fn generate_profile_previews(
    paths: Vec<String>,
    adjustments: Value,
    size: u32,
    app_handle: AppHandle,
) -> Result<Vec<ProfilePreview>, String> {
    crate::blocking_command::run_blocking(move || {
        let state = app_handle.state::<AppState>();
        let context = crate::image_processing::get_or_init_gpu_context(&state, &app_handle)?;
        let loaded_image = state
            .original_image
            .lock()
            .unwrap()
            .clone()
            .ok_or("No photo is open for profile previews")?;
        let mut edit = adjustments;
        edit["masks"] = Value::Array(Vec::new());
        let preview = crate::prepare_preview_source(&state, &context, &loaded_image, &edit, size)?;
        let source = preview.render_source();
        let tm_override = crate::image_processing::resolve_tonemapper_override_from_handle(
            &app_handle,
            loaded_image.is_raw,
        );
        let dir = profiles_dir(&app_handle)?;

        Ok(paths
            .into_iter()
            .map(|path| {
                let thumb = profile_path_in(&dir, &path)
                    .and_then(|file| read_profile_file(&file))
                    .ok()
                    .and_then(|profile| {
                        let edit = with_profile(&edit, &profile);
                        let mut all_adjustments =
                            get_all_adjustments_from_json(&edit, loaded_image.is_raw, tm_override);
                        crate::baseline_exposure::apply_natural_exposure(
                            &mut all_adjustments,
                            &loaded_image.path,
                        );
                        crate::lut_processing::render_swatch(
                            &context,
                            &state,
                            &source,
                            all_adjustments,
                            crate::lut_processing::lut_for_adjustments(&state, &edit),
                            table_for_adjustments(&edit),
                            "generate_profile_previews",
                        )
                    });
                ProfilePreview { path, thumb }
            })
            .collect())
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

    /// A smooth, strong look on a lattice of `size`: a lift, a channel cross-talk and a cast,
    /// as a baked profile has them.
    fn smooth_look(size: usize) -> Vec<f32> {
        (0..size.pow(3) * 3)
            .map(|index| {
                let point = index / 3;
                let rgb = [point % size, point / size % size, point / (size * size)]
                    .map(|axis| axis as f32 / (size - 1) as f32);
                let channel = rgb[index % 3];
                (channel + 0.04 * (3.0 * rgb[0] + 2.0 * rgb[1]).sin() + 0.02 * rgb[2] - 0.01)
                    .clamp(0.0, 1.0)
            })
            .collect()
    }

    /// The `1.112.x` storage, kept here to prove its tables still load.
    fn encode_version_1(values: &[f32]) -> String {
        let bytes: Vec<u8> = values
            .iter()
            .flat_map(|value| quantize(*value).to_le_bytes())
            .collect();
        general_purpose::STANDARD.encode(zstd::encode_all(bytes.as_slice(), 19).unwrap())
    }

    #[test]
    fn a_table_survives_encoding_exactly_to_sixteen_bits() {
        let size = 9;
        let values = smooth_look(size as usize);
        let encoded = encode_table(&values, size).unwrap();
        let decoded = decode_table(&encoded, size, FORMAT_VERSION).unwrap();
        assert_eq!(decoded.len(), values.len());
        for (a, b) in values.iter().zip(&decoded) {
            assert_eq!(quantize(*a), quantize(*b));
        }
        assert!(encode_table(&values, 4).is_err());
        assert!(decode_table(&encoded, 4, FORMAT_VERSION).is_err());
    }

    #[test]
    fn zigzag_coding_is_exact_for_every_step() {
        assert_eq!([0, 0xffff, 1, 0xfffe].map(zigzag), [0, 1, 2, 3]);
        assert!((0..=u16::MAX).all(|step| unzigzag(zigzag(step)) == step));
    }

    /// The `1.113.0` storage (version 2), kept here to prove its tables still load.
    fn encode_version_2(values: &[f32], size: usize) -> String {
        let residuals: Vec<u16> = values
            .iter()
            .enumerate()
            .map(|(index, value)| quantize(*value).wrapping_sub(identity_entry(index, size)))
            .collect();
        let steps: Vec<u16> = (0..residuals.len())
            .map(|index| {
                if has_red_neighbour(index, size) {
                    residuals[index].wrapping_sub(residuals[index - 3])
                } else {
                    residuals[index]
                }
            })
            .collect();
        let bytes: Vec<u8> = steps
            .iter()
            .map(|step| step.to_le_bytes()[0])
            .chain(steps.iter().map(|step| step.to_le_bytes()[1]))
            .collect();
        general_purpose::STANDARD.encode(zstd::encode_all(bytes.as_slice(), 19).unwrap())
    }

    #[test]
    fn version_1_and_2_tables_still_load() {
        let size = 5;
        let values = smooth_look(size as usize);
        for (version, encoded) in [
            (1, encode_version_1(&values)),
            (2, encode_version_2(&values, size as usize)),
        ] {
            let decoded = decode_table(&encoded, size, version).unwrap();
            for (a, b) in values.iter().zip(&decoded) {
                assert_eq!(quantize(*a), quantize(*b), "version {version}");
            }
        }
    }

    #[test]
    fn storing_steps_from_no_change_packs_a_look_tighter() {
        let size = DEFAULT_LATTICE_SIZE;
        let values = smooth_look(size as usize);
        let version_1 = encode_version_1(&values).len();
        let version_2 = encode_version_2(&values, size as usize).len();
        let current = encode_table(&values, size).unwrap().len();
        eprintln!(
            "33³ smooth look: version 1 {version_1} bytes, version 2 {version_2}, version 3 {current}"
        );
        assert!(
            current * 2 < version_1,
            "{current} is not under half of {version_1}"
        );
        assert!(
            current <= version_2,
            "{current} is larger than version 2's {version_2}"
        );
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

    fn keys(keys: &[&str]) -> Vec<String> {
        keys.iter().map(|key| key.to_string()).collect()
    }

    const BENT_CURVE: &str =
        r#"{ "luma": [{ "x": 0, "y": 0 }, { "x": 128, "y": 160 }, { "x": 255, "y": 255 }] }"#;

    /// A current profile as the edit embeds it: a valid 2³ table and a bent tone curve.
    fn base_profile() -> Value {
        json!({
            "version": FORMAT_VERSION,
            "id": "base",
            "name": "Base",
            "size": 2,
            "shaper": { "stopsBelow": 12.0, "stopsAbove": 6.0 },
            "table": encode_table(&[0.5; 24], 2).unwrap(),
            "curves": serde_json::from_str::<Value>(BENT_CURVE).unwrap(),
        })
    }

    #[test]
    fn the_bake_takes_only_the_chosen_keys() {
        let edit = json!({
            "exposure": 1.0,
            "contrast": 40,
            "clarity": 50,
            "colorCalibration": { "redHue": 20 },
            "masks": []
        });
        let bake = Bake::new(
            &edit,
            &keys(&["exposure", "clarity", "colorCalibration"]),
            true,
        );
        let global = bake.adjustments.global;
        assert!(global.exposure != 0.0);
        assert!(global.color_calibration.red_hue != 0.0);
        assert_eq!(global.contrast, 0.0);
        assert_eq!(global.clarity, 0.0, "Clarity is not bakeable");
        assert_eq!(global.has_profile, 0);
        assert!(bake.base.is_none() && bake.curves.is_none() && bake.kept.is_empty());
        assert_eq!(bake.shaper, Shaper::default());
    }

    #[test]
    fn a_current_profile_bakes_in_with_its_shaper_and_its_carried_curve_wins() {
        let photo_curve: Value =
            json!({ "luma": [{ "x": 0, "y": 0 }, { "x": 128, "y": 90 }, { "x": 255, "y": 255 }] });
        let edit = json!({ "profile": base_profile(), "profileAmount": 80, "curves": photo_curve });

        let bake = Bake::new(&edit, &keys(&["profile", "profileAmount", "curves"]), true);
        assert_eq!(bake.adjustments.global.has_profile, 1);
        assert_eq!(bake.adjustments.global.profile_amount, 0.8);
        assert_eq!(bake.shaper.stops_below, 12.0);
        assert_eq!(bake.adjustments.global.profile_stops_below, 12.0);
        assert!(bake.base.is_some());
        assert_eq!(
            bake.curves,
            Some(serde_json::from_str::<Value>(BENT_CURVE).unwrap())
        );
        assert_eq!(
            bake.kept,
            vec!["curves".to_string()],
            "the photo keeps its own curve"
        );

        let without_base = Bake::new(&edit, &keys(&["curves"]), true);
        assert!(without_base.base.is_none());
        assert_eq!(without_base.curves, Some(photo_curve));
        assert!(without_base.kept.is_empty());
    }

    #[test]
    fn the_recipe_keeps_the_ticked_settings_without_a_nested_recipe() {
        let mut current = base_profile();
        current["recipe"] = json!({ "exposure": 2.0 });
        let edit =
            json!({ "exposure": 0.5, "contrast": 30, "profile": current, "curveMode": "point" });
        let recipe = recipe_of(&edit, &keys(&["exposure", "profile", "curveMode", "hue"]));
        assert_eq!(recipe["exposure"], 0.5);
        assert_eq!(recipe["curveMode"], "point");
        assert!(recipe.get("contrast").is_none() && recipe.get("hue").is_none());
        assert_eq!(recipe["profile"]["id"], "base");
        assert!(recipe["profile"].get("recipe").is_none());
    }

    #[test]
    fn saving_follows_the_name_and_keeps_one_file() {
        let dir = std::env::temp_dir().join(format!("tir-profiles-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let mut profile: ProfileData = serde_json::from_value(base_profile()).unwrap();

        let first = save_profile(&dir, &profile, None).unwrap();
        assert_eq!(first.file_name().unwrap(), "Base.tirprofile");
        assert_eq!(save_profile(&dir, &profile, Some(&first)).unwrap(), first);
        assert_eq!(read_profile_file(&first).unwrap().name, "Base");

        profile.name = "Warm: Film".to_string();
        let renamed = save_profile(&dir, &profile, Some(&first)).unwrap();
        assert_eq!(renamed.file_name().unwrap(), "Warm_ Film.tirprofile");
        assert!(!first.exists());
        let entries = list_profiles_in(&dir).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].name, "Warm: Film");
        assert!(
            !entries[0].can_edit,
            "a profile without a recipe cannot be edited"
        );
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn adding_a_profile_keeps_ids_apart_and_refuses_a_broken_table() {
        let dir = std::env::temp_dir().join(format!("tir-profiles-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let profile: ProfileData = serde_json::from_value(base_profile()).unwrap();

        add_to_folder(&dir, profile.clone()).unwrap();
        add_to_folder(&dir, profile.clone()).unwrap();
        let entries = list_profiles_in(&dir).unwrap();
        assert_eq!(entries.len(), 2);
        assert_ne!(entries[0].id, entries[1].id);
        assert!(entries.iter().any(|entry| entry.id == "base"));

        let broken = ProfileData {
            table: "not a table".to_string(),
            ..profile.clone()
        };
        assert!(add_to_folder(&dir, broken).is_err());
        let newer = ProfileData {
            version: FORMAT_VERSION + 1,
            ..profile
        };
        assert!(add_to_folder(&dir, newer).is_err());
        assert_eq!(list_profiles_in(&dir).unwrap().len(), 2);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_preview_swaps_the_profile_in_as_choosing_it_would() {
        let mut profile: ProfileData = serde_json::from_value(base_profile()).unwrap();
        profile.monochrome = true;
        profile.recipe = Some(json!({ "exposure": 1.0 }));

        let bare = json!({ "exposure": 0.3, "sectionVisibility": { "profile": false } });
        let previewed = with_profile(&bare, &profile);
        assert_eq!(previewed["profile"]["id"], "base");
        assert!(previewed["profile"].get("recipe").is_none());
        assert_eq!(previewed["profileAmount"], 100.0);
        assert_eq!(previewed["monochrome"], true);
        assert_eq!(previewed["sectionVisibility"]["profile"], true);
        assert_eq!(previewed["exposure"], 0.3);
        assert_eq!(RenderSettings::from_adjustments(&previewed).amount, 1.0);

        let with_amount = json!({ "profile": base_profile(), "profileAmount": 60 });
        assert_eq!(with_profile(&with_amount, &profile)["profileAmount"], 60.0);
    }

    #[test]
    fn a_straight_curve_is_not_carried() {
        let straight = json!({ "luma": [{ "x": 0, "y": 0 }, { "x": 255, "y": 255 }], "red": [] });
        assert!(is_identity_curve(&straight));
        assert!(!is_identity_curve(
            &serde_json::from_str(BENT_CURVE).unwrap()
        ));
        let shifted = json!({ "luma": [{ "x": 10, "y": 10 }, { "x": 255, "y": 255 }] });
        assert!(
            !is_identity_curve(&shifted),
            "a raised first point clips the shadows"
        );
        let bake = Bake::new(&json!({ "curves": straight }), &keys(&["curves"]), true);
        assert!(bake.curves.is_none());
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

        let identity = bake_lattice(&context, &Bake::new(&json!({}), &[], true), size).unwrap();
        assert_eq!(identity.len(), (size as usize).pow(3) * 3);
        for (point, rgb) in identity.chunks_exact(3).enumerate() {
            let axes = [point % 9, point / 9 % 9, point / 81].map(|axis| node(axis as u32));
            // Judged against the colour's brightest channel, as the eye sees it: the colour
            // mixer's hue round trip (run even with no band set, as in every render) leaves
            // float noise that is large only relative to a channel many stops darker.
            let peak = axes.iter().fold(0f32, |peak, value| peak.max(*value));
            for (value, expected) in rgb.iter().zip(axes) {
                let error = (decode(shaper, *value) - expected).abs();
                assert!(
                    error <= 1e-4 * peak + 1e-7,
                    "point {point}: {} vs {expected}",
                    decode(shaper, *value)
                );
            }
        }

        let brighter = Bake::new(&json!({ "exposure": 1.0 }), &keys(&["exposure"]), true);
        let stops = brighter.adjustments.global.exposure;
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
