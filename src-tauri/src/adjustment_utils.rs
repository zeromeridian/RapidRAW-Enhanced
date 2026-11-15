use image::DynamicImage;
use std::borrow::Cow;
use std::collections::HashMap;

use crate::app_state::AppState;
use crate::image_processing::{
    Crop, IntoCowImage, apply_coarse_rotation, apply_crop, apply_flip, apply_geometry_warp,
    apply_rotation,
};

pub fn hydrate_sub_masks(
    sub_masks: &mut Vec<serde_json::Value>,
    cache: &mut HashMap<String, serde_json::Value>,
) {
    for sub_mask in sub_masks {
        let id = sub_mask
            .get("id")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();

        if id.is_empty() {
            continue;
        }

        if let Some(params) = sub_mask
            .get_mut("parameters")
            .and_then(|p| p.as_object_mut())
        {
            let keys_to_check = ["mask_data_base64", "maskDataBase64"];
            for key in keys_to_check {
                if params.contains_key(key) {
                    let val = params.get(key).unwrap();
                    if !val.is_null() {
                        cache.insert(id.clone(), val.clone());
                    } else {
                        if let Some(cached_data) = cache.get(&id) {
                            params.insert(key.to_string(), cached_data.clone());
                        }
                    }
                }
            }
        }
    }
}

pub fn hydrate_adjustments(state: &tauri::State<AppState>, adjustments: &mut serde_json::Value) {
    let mut cache = state.patch_cache.lock().unwrap();

    if let Some(patches) = adjustments
        .get_mut("aiPatches")
        .and_then(|v| v.as_array_mut())
    {
        for patch in patches {
            let id = patch
                .get("id")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string();

            if !id.is_empty() {
                let has_data = patch.get("patchData").is_some_and(|v| !v.is_null());

                if has_data {
                    if let Some(data) = patch.get("patchData") {
                        cache.insert(id.clone(), data.clone());
                    }
                } else {
                    if let Some(cached_data) = cache.get(&id) {
                        patch["patchData"] = cached_data.clone();
                    }
                }
            }

            if let Some(sub_masks) = patch.get_mut("subMasks").and_then(|v| v.as_array_mut()) {
                hydrate_sub_masks(sub_masks, &mut cache);
            }
        }
    }

    if let Some(masks) = adjustments.get_mut("masks").and_then(|v| v.as_array_mut()) {
        for mask_container in masks {
            if let Some(sub_masks) = mask_container
                .get_mut("subMasks")
                .and_then(|v| v.as_array_mut())
            {
                hydrate_sub_masks(sub_masks, &mut cache);
            }
        }
    }
}

/// The section eyes saved before `1.66.0` and the tool groups each one hid. Edits now store one
/// eye per tool group in `sectionVisibility`; a group without its own key follows its old eye,
/// so older edits, presets and XMP render exactly as they did. Mirrors `LEGACY_VISIBILITY_GROUPS`
/// in `src/utils/adjustments.ts`.
pub const LEGACY_VISIBILITY_GROUPS: &[(&str, &[&str])] = &[
    ("basic", &["tone"]),
    ("curves", &["curves"]),
    (
        "color",
        &[
            "blackAndWhite",
            "whiteBalance",
            "colorPresence",
            "hue",
            "colorGrading",
            "colorMixer",
            "colorCalibration",
        ],
    ),
    (
        "details",
        &[
            "presence",
            "sharpening",
            "noiseReduction",
            "aiDenoise",
            "chromaticAberration",
        ],
    ),
    (
        "effects",
        &[
            "glow",
            "halation",
            "lightFlares",
            "lensBlur",
            "relight",
            "fog",
            "lut",
            "gaussianBlur",
            "motionBlur",
            "vignette",
            "grain",
        ],
    ),
];

/// Whether a tool group's eye is on: its own key, else the old section eye that covered it,
/// else shown. Panels outside the Adjustments sections (`zoneTint`) have only their own key.
pub fn is_group_visible(adjustments: &serde_json::Value, group: &str) -> bool {
    let Some(visibility) = adjustments.get("sectionVisibility") else {
        return true;
    };
    let eye = |key: &str| visibility.get(key).and_then(serde_json::Value::as_bool);
    eye(group)
        .or_else(|| {
            LEGACY_VISIBILITY_GROUPS
                .iter()
                .find(|(_, groups)| groups.contains(&group))
                .and_then(|(legacy, _)| eye(legacy))
        })
        .unwrap_or(true)
}

/// Whether a toggled tool is on and its eye is on.
pub fn is_tool_enabled(adjustments: &serde_json::Value, group: &str, enabled_key: &str) -> bool {
    is_group_visible(adjustments, group) && adjustments[enabled_key].as_bool().unwrap_or(false)
}

/// Applies the CPU effects that operate on the geometry-warped image before
/// orientation, rotation, and crop.
pub fn apply_spatial_effects<'a>(
    warped_image: Cow<'a, DynamicImage>,
    adjustments: &serde_json::Value,
) -> Cow<'a, DynamicImage> {
    let relit_image = crate::relight::apply_relight(warped_image, adjustments);
    let fogged_image = crate::fog::apply_fog(relit_image, adjustments);
    crate::lens_blur::apply_lens_blur(fogged_image, adjustments)
}

/// Applies coarse orientation, flips, fine rotation, and crop.
pub fn apply_spatial_transformations<'a>(
    image: Cow<'a, DynamicImage>,
    adjustments: &serde_json::Value,
) -> (Cow<'a, DynamicImage>, (f32, f32)) {
    let orientation_steps = adjustments["orientationSteps"].as_u64().unwrap_or(0) as u8;
    let rotation_degrees = adjustments["rotation"].as_f64().unwrap_or(0.0) as f32;
    let flip_horizontal = adjustments["flipHorizontal"].as_bool().unwrap_or(false);
    let flip_vertical = adjustments["flipVertical"].as_bool().unwrap_or(false);

    let coarse_rotated_image = apply_coarse_rotation(image, orientation_steps);
    let flipped_image = apply_flip(coarse_rotated_image, flip_horizontal, flip_vertical);
    let rotated_image = apply_rotation(flipped_image, rotation_degrees);

    let crop_data: Option<Crop> = serde::Deserialize::deserialize(&adjustments["crop"]).ok();
    let crop_json = serde_json::to_value(crop_data).unwrap_or(serde_json::Value::Null);
    let cropped_image = apply_crop(rotated_image, &crop_json);

    let unscaled_crop_offset = crop_data.map_or((0.0, 0.0), |c| (c.x as f32, c.y as f32));

    (cropped_image, unscaled_crop_offset)
}

pub fn apply_all_transformations<'a, I: IntoCowImage<'a>>(
    image: I,
    adjustments: &serde_json::Value,
) -> (Cow<'a, DynamicImage>, (f32, f32)) {
    let start_time = std::time::Instant::now();
    let image = image.into_cow();
    let warped_image = apply_geometry_warp(image, adjustments);
    let effected_image = apply_spatial_effects(warped_image, adjustments);
    let transformed = apply_spatial_transformations(effected_image, adjustments);

    let total_duration = start_time.elapsed();
    log::info!("apply_all_transformations took {:.2?}", total_duration);

    transformed
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn a_group_eye_wins_over_the_old_section_eye_it_replaces() {
        let old = json!({ "sectionVisibility": { "color": false, "effects": true } });
        assert!(!is_group_visible(&old, "colorGrading"));
        assert!(!is_group_visible(&old, "whiteBalance"));
        assert!(is_group_visible(&old, "lut"));
        assert!(is_group_visible(&old, "tone"));

        let new =
            json!({ "sectionVisibility": { "color": false, "colorGrading": true, "lut": false } });
        assert!(is_group_visible(&new, "colorGrading"));
        assert!(!is_group_visible(&new, "whiteBalance"));
        assert!(!is_group_visible(&new, "lut"));

        assert!(is_group_visible(&json!({}), "relight"));
        assert!(!is_group_visible(
            &json!({ "sectionVisibility": { "zoneTint": false } }),
            "zoneTint"
        ));
        assert!(is_tool_enabled(
            &json!({ "fogEnabled": true }),
            "fog",
            "fogEnabled"
        ));
        assert!(!is_tool_enabled(
            &json!({ "fogEnabled": true, "sectionVisibility": { "effects": false } }),
            "fog",
            "fogEnabled"
        ));
    }

    #[test]
    fn every_tool_group_has_exactly_one_old_section_eye() {
        let mut groups: Vec<&str> = LEGACY_VISIBILITY_GROUPS
            .iter()
            .flat_map(|(_, groups)| groups.iter().copied())
            .collect();
        let count = groups.len();
        groups.sort_unstable();
        groups.dedup();
        assert_eq!(groups.len(), count);
        assert_eq!(count, 25);
    }
}
