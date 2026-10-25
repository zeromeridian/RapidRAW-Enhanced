use crate::AppState;
use crate::adjustment_utils::is_effect_enabled;
use crate::app_settings::AppSettings;
use crate::fog::FOG_KEYS;
use crate::lens_blur::LENS_BLUR_KEYS;
use crate::relight::RELIGHT_KEYS;
use image::DynamicImage;
use std::collections::HashMap;
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::path::Path;
use std::sync::Arc;
use std::time::SystemTime;

pub const GEOMETRY_KEYS: &[&str] = &[
    "transformDistortion",
    "transformVertical",
    "transformHorizontal",
    "transformRotate",
    "transformAspect",
    "transformScale",
    "transformXOffset",
    "transformYOffset",
    "transformConstrainCrop",
    "lensDistortionAmount",
    "lensVignetteAmount",
    "lensTcaAmount",
    "lensDistortionParams",
    "lensMaker",
    "lensModel",
    "lensDistortionEnabled",
    "lensTcaEnabled",
    "lensVignetteEnabled",
];

pub fn calculate_thumbnail_base_hash(adjustments: &serde_json::Value) -> u64 {
    let mut hasher = DefaultHasher::new();

    calculate_geometry_hash(adjustments).hash(&mut hasher);
    calculate_effects_hash(adjustments).hash(&mut hasher);

    hasher.finish()
}

fn hash_effect_keys(adjustments: &serde_json::Value, keys: &[&str], hasher: &mut DefaultHasher) {
    for key in keys {
        if let Some(val) = adjustments.get(*key) {
            key.hash(hasher);
            match val.as_str() {
                Some(s) => s.hash(hasher),
                None => val.to_string().hash(hasher),
            }
        }
    }
}

/// Hashes every input of the post-warp spatial effect stage
/// (`adjustment_utils::apply_spatial_effects`).
pub fn calculate_effects_hash(adjustments: &serde_json::Value) -> u64 {
    let mut hasher = DefaultHasher::new();

    for (enabled_key, keys) in [
        ("relightEnabled", RELIGHT_KEYS),
        ("fogEnabled", FOG_KEYS),
        ("lensBlurEnabled", LENS_BLUR_KEYS),
    ] {
        let enabled = is_effect_enabled(adjustments, enabled_key);
        enabled.hash(&mut hasher);
        if enabled {
            hash_effect_keys(adjustments, keys, &mut hasher);
        }
    }

    if is_effect_enabled(adjustments, "fogEnabled") {
        adjustments["orientationSteps"].as_u64().hash(&mut hasher);
        adjustments["flipHorizontal"].as_bool().hash(&mut hasher);
        adjustments["flipVertical"].as_bool().hash(&mut hasher);
    }

    hasher.finish()
}

fn hash_ai_denoise(adjustments: &serde_json::Value, hasher: &mut DefaultHasher) {
    let enabled = crate::ai_denoise::is_enabled(adjustments);
    enabled.hash(hasher);
    if enabled {
        hash_effect_keys(adjustments, &["aiDenoiseAmount", "aiDenoiseDetail"], hasher);
        crate::ai_denoise::cache_epoch().hash(hasher);
    }
}

pub fn calculate_geometry_hash(adjustments: &serde_json::Value) -> u64 {
    let mut hasher = DefaultHasher::new();

    hash_ai_denoise(adjustments, &mut hasher);

    if let Some(patches) = adjustments.get("aiPatches") {
        patches.to_string().hash(&mut hasher);
    }

    adjustments["orientationSteps"].as_u64().hash(&mut hasher);

    for key in GEOMETRY_KEYS {
        if let Some(val) = adjustments.get(key) {
            key.hash(&mut hasher);
            val.to_string().hash(&mut hasher);
        }
    }

    hasher.finish()
}

pub fn calculate_visual_hash(path: &str, adjustments: &serde_json::Value) -> u64 {
    let mut hasher = DefaultHasher::new();
    path.hash(&mut hasher);

    if let Some(obj) = adjustments.as_object() {
        for (key, value) in obj {
            if GEOMETRY_KEYS.contains(&key.as_str()) {
                continue;
            }

            match key.as_str() {
                "crop" | "rotation" | "orientationSteps" | "flipHorizontal" | "flipVertical" => (),
                _ => {
                    key.hash(&mut hasher);
                    value.to_string().hash(&mut hasher);
                }
            }
        }
    }

    hasher.finish()
}

pub fn calculate_transform_hash(adjustments: &serde_json::Value) -> u64 {
    let mut hasher = DefaultHasher::new();

    let orientation_steps = adjustments["orientationSteps"].as_u64().unwrap_or(0);
    orientation_steps.hash(&mut hasher);

    let rotation = adjustments["rotation"].as_f64().unwrap_or(0.0);
    (rotation.to_bits()).hash(&mut hasher);

    let flip_h = adjustments["flipHorizontal"].as_bool().unwrap_or(false);
    flip_h.hash(&mut hasher);

    let flip_v = adjustments["flipVertical"].as_bool().unwrap_or(false);
    flip_v.hash(&mut hasher);

    calculate_effects_hash(adjustments).hash(&mut hasher);
    hash_ai_denoise(adjustments, &mut hasher);

    if let Some(crop_val) = adjustments.get("crop")
        && !crop_val.is_null()
    {
        crop_val.to_string().hash(&mut hasher);
    }

    for key in GEOMETRY_KEYS {
        if let Some(val) = adjustments.get(key) {
            key.hash(&mut hasher);
            val.to_string().hash(&mut hasher);
        }
    }

    if let Some(patches_val) = adjustments.get("aiPatches")
        && let Some(patches_arr) = patches_val.as_array()
    {
        patches_arr.len().hash(&mut hasher);

        for patch in patches_arr {
            if let Some(id) = patch.get("id").and_then(|v| v.as_str()) {
                id.hash(&mut hasher);
            }

            let is_visible = patch
                .get("visible")
                .and_then(|v| v.as_bool())
                .unwrap_or(true);
            is_visible.hash(&mut hasher);

            if let Some(patch_data) = patch.get("patchData") {
                let color_len = patch_data
                    .get("color")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .len();
                color_len.hash(&mut hasher);

                let mask_len = patch_data
                    .get("mask")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .len();
                mask_len.hash(&mut hasher);
            } else {
                let data_len = patch
                    .get("patchDataBase64")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .len();
                data_len.hash(&mut hasher);
            }

            if let Some(sub_masks_val) = patch.get("subMasks") {
                sub_masks_val.to_string().hash(&mut hasher);
            }

            let invert = patch
                .get("invert")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            invert.hash(&mut hasher);
        }
    }

    hasher.finish()
}

pub fn calculate_full_job_hash(path: &str, adjustments: &serde_json::Value) -> u64 {
    let mut hasher = DefaultHasher::new();
    path.hash(&mut hasher);
    adjustments.to_string().hash(&mut hasher);
    hasher.finish()
}

/// Every setting `load_base_image_from_bytes` reads, so caches of decoded pixels can key on it.
/// The text is stable across builds, which on-disk cache keys rely on.
pub fn raw_decode_settings_key(settings: &AppSettings) -> String {
    format!(
        "{:?}|{}|{:?}|{:?}|{:?}",
        settings.raw_highlight_compression,
        settings.linear_raw_mode,
        settings.raw_preprocessing_color_nr,
        settings.raw_preprocessing_sharpening,
        settings.apply_preprocessing_to_non_raws,
    )
}

/// A path alone goes stale: files are rewritten in place and raw settings change the pixels.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DecodeFingerprint {
    len: u64,
    modified: Option<SystemTime>,
    settings_hash: u64,
}

impl DecodeFingerprint {
    pub fn for_file(path: &Path, settings: &AppSettings) -> Option<Self> {
        let metadata = std::fs::metadata(path).ok()?;
        let mut hasher = DefaultHasher::new();
        raw_decode_settings_key(settings).hash(&mut hasher);
        Some(Self {
            len: metadata.len(),
            modified: metadata.modified().ok(),
            settings_hash: hasher.finish(),
        })
    }
}

struct DecodedEntry {
    path: String,
    fingerprint: DecodeFingerprint,
    image: Arc<DynamicImage>,
    exif: HashMap<String, String>,
}

pub struct DecodedImageCache {
    capacity: usize,
    items: Vec<DecodedEntry>,
}

impl DecodedImageCache {
    pub fn new(capacity: usize) -> Self {
        Self {
            capacity,
            items: Vec::with_capacity(capacity),
        }
    }

    pub fn set_capacity(&mut self, capacity: usize) {
        self.capacity = capacity;
        while self.items.len() > self.capacity {
            self.items.remove(0);
        }
    }

    pub fn contains(&self, path: &str, fingerprint: &DecodeFingerprint) -> bool {
        self.items
            .iter()
            .any(|e| e.path == path && e.fingerprint == *fingerprint)
    }

    pub fn get(
        &mut self,
        path: &str,
        fingerprint: &DecodeFingerprint,
    ) -> Option<(Arc<DynamicImage>, HashMap<String, String>)> {
        let pos = self.items.iter().position(|e| e.path == path)?;
        let entry = self.items.remove(pos);
        if entry.fingerprint != *fingerprint {
            return None;
        }
        let result = (Arc::clone(&entry.image), entry.exif.clone());
        self.items.push(entry);
        Some(result)
    }

    pub fn clear(&mut self) {
        self.items.clear();
    }

    pub fn insert(
        &mut self,
        path: String,
        fingerprint: DecodeFingerprint,
        image: Arc<DynamicImage>,
        exif: HashMap<String, String>,
    ) {
        if let Some(pos) = self.items.iter().position(|e| e.path == path) {
            self.items.remove(pos);
        } else if self.items.len() >= self.capacity {
            self.items.remove(0);
        }
        self.items.push(DecodedEntry {
            path,
            fingerprint,
            image,
            exif,
        });
    }
}

#[tauri::command]
pub fn clear_image_caches(state: tauri::State<AppState>) {
    if let Ok(mut decoded_cache) = state.decoded_image_cache.lock() {
        decoded_cache.clear();
    }
    if let Ok(mut gpu_cache) = state.gpu_image_cache.lock() {
        *gpu_cache = None;
    }
    if let Ok(mut preview_cache) = state.cached_preview.lock() {
        *preview_cache = None;
    }
    if let Ok(mut warped_cache) = state.full_warped_cache.lock() {
        *warped_cache = None;
    }
    clear_preview_stage_caches(&state);
}

pub fn clear_preview_stage_caches(state: &AppState) {
    for cache in [
        &state.patched_warped_cache,
        &state.working_cache,
        &state.effects_cache,
    ] {
        *cache.lock().unwrap_or_else(|e| e.into_inner()) = None;
    }
    *state
        .full_transformed_cache
        .lock()
        .unwrap_or_else(|e| e.into_inner()) = None;
}

#[tauri::command]
pub fn clear_session_caches(state: tauri::State<AppState>) {
    if let Ok(mut patch_cache) = state.patch_cache.lock() {
        patch_cache.clear();
    }
    if let Ok(mut mask_cache) = state.mask_cache.lock() {
        mask_cache.clear();
    }
    if let Ok(mut geometry_cache) = state.geometry_cache.lock() {
        geometry_cache.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fingerprint(len: u64) -> DecodeFingerprint {
        DecodeFingerprint {
            len,
            modified: None,
            settings_hash: 0,
        }
    }

    #[test]
    fn decoded_cache_drops_entries_whose_fingerprint_changed() {
        let mut cache = DecodedImageCache::new(2);
        cache.insert(
            "a.raf".to_string(),
            fingerprint(1),
            Arc::new(DynamicImage::new_rgb8(1, 1)),
            HashMap::new(),
        );

        assert!(cache.contains("a.raf", &fingerprint(1)));
        assert!(cache.get("a.raf", &fingerprint(1)).is_some());
        assert!(!cache.contains("a.raf", &fingerprint(2)));
        assert!(cache.get("a.raf", &fingerprint(2)).is_none());
        assert!(!cache.contains("a.raf", &fingerprint(1)));
    }

    #[test]
    fn decode_fingerprint_tracks_raw_preprocessing_settings() {
        let path = std::env::temp_dir().join("thisisraw-decode-fingerprint-test");
        std::fs::write(&path, b"x").unwrap();
        let settings = AppSettings::default();
        let changed = AppSettings {
            raw_preprocessing_sharpening: Some(0.9),
            ..AppSettings::default()
        };

        let base = DecodeFingerprint::for_file(&path, &settings);
        assert!(base.is_some());
        assert_eq!(base, DecodeFingerprint::for_file(&path, &settings));
        assert_ne!(base, DecodeFingerprint::for_file(&path, &changed));
        let _ = std::fs::remove_file(&path);
    }
}
