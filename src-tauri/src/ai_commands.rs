use std::collections::HashMap;
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::io::Cursor;
use std::path::Path;
use std::sync::{Arc, Mutex};

use base64::{Engine as _, engine::general_purpose};
use image::{DynamicImage, GrayImage, ImageFormat};
use serde_json::Value;
use tauri::Manager;

use crate::adjustment_utils::SUB_MASK_DATA_KEYS;
use crate::ai_connector;
use crate::ai_processing::{
    AiDepthMaskParameters, AiForegroundMaskParameters, AiMaskModel, AiModels, AiSkyMaskParameters,
    AiState, AiSubjectMaskParameters, AiTextMaskParameters, CachedDepthMap, ESAM3_SKY_REFINE_EPS,
    ESAM3_SKY_SCORE_THRESHOLD, ESAM3_TEXT_REFINE_EPS, ESAM3_TEXT_SCORE_THRESHOLD, Esam3Features,
    ImageEmbeddings, generate_image_embeddings, get_or_init_ai_models, run_birefnet_model,
    run_depth_anything_model, run_esam3_decoder, run_esam3_image_encoder, run_esam3_zoomed_decoder,
    run_sam_decoder,
};
use crate::app_settings::{AppSettings, settings_snapshot};
use crate::app_state::AppState;
use crate::cache_utils::GEOMETRY_KEYS;
use crate::get_cached_full_warped_image;

const NO_FOREGROUND_FOUND: &str = "No foreground found";
const NO_SKY_FOUND: &str = "No sky found";
const NO_MATCH_FOUND: &str = "No match found for";

pub fn ai_cache_key(path: &str, adjustments: &serde_json::Value) -> String {
    let mut hasher = blake3::Hasher::new();
    hasher.update(path.as_bytes());
    let mut geo_hasher = DefaultHasher::new();
    for key in GEOMETRY_KEYS {
        if let Some(val) = adjustments.get(key) {
            key.hash(&mut geo_hasher);
            val.to_string().hash(&mut geo_hasher);
        }
    }
    hasher.update(&geo_hasher.finish().to_le_bytes());
    hasher.finalize().to_hex().to_string()
}

fn cached_esam3_features(
    ai_state: &Mutex<Option<AiState>>,
    models: &AiModels,
    cache_key: &str,
    warped_image: &DynamicImage,
) -> Result<Arc<Esam3Features>, String> {
    if let Some(cached) = ai_state
        .lock()
        .unwrap()
        .as_ref()
        .and_then(|s| s.esam3_features.clone())
        .filter(|cached| cached.path_hash == cache_key)
    {
        return Ok(cached);
    }

    let mut features = run_esam3_image_encoder(
        warped_image,
        &*models.esam3_image_encoder().map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    features.path_hash = cache_key.to_string();
    let features = Arc::new(features);

    if let Some(state) = ai_state.lock().unwrap().as_mut() {
        state.esam3_features = Some(features.clone());
    }
    Ok(features)
}

fn encode_to_base64_png(image: &GrayImage) -> Result<String, String> {
    let mut buf = Cursor::new(Vec::new());
    image
        .write_to(&mut buf, ImageFormat::Png)
        .map_err(|e| e.to_string())?;
    let base64_str = general_purpose::STANDARD.encode(buf.get_ref());
    Ok(format!("data:image/png;base64,{}", base64_str))
}

fn foreground_mask(models: &AiModels, warped_image: &DynamicImage) -> Result<GrayImage, String> {
    let mask = run_birefnet_model(
        warped_image,
        &*models.birefnet().map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    if mask.iter().all(|&v| v < 128) {
        return Err(NO_FOREGROUND_FOUND.to_string());
    }
    Ok(mask)
}

fn sky_mask(
    models: &AiModels,
    features: &Esam3Features,
    warped_image: &DynamicImage,
) -> Result<GrayImage, String> {
    let prompt = models.esam3_sky_prompt().map_err(|e| e.to_string())?;
    run_esam3_decoder(
        &*models.esam3_decoder().map_err(|e| e.to_string())?,
        features,
        &prompt,
        warped_image,
        ESAM3_SKY_SCORE_THRESHOLD,
        ESAM3_SKY_REFINE_EPS,
    )
    .map_err(|e| e.to_string())?
    .ok_or_else(|| NO_SKY_FOUND.to_string())
}

fn text_mask(
    models: &AiModels,
    features: &Esam3Features,
    warped_image: &DynamicImage,
    prompt: &str,
) -> Result<GrayImage, String> {
    let text_prompt = models
        .esam3_text_prompt(prompt)
        .map_err(|e| e.to_string())?;
    run_esam3_zoomed_decoder(
        &*models.esam3_image_encoder().map_err(|e| e.to_string())?,
        &*models.esam3_decoder().map_err(|e| e.to_string())?,
        features,
        &text_prompt,
        warped_image,
        ESAM3_TEXT_SCORE_THRESHOLD,
        ESAM3_TEXT_REFINE_EPS,
    )
    .map_err(|e| e.to_string())?
    .ok_or_else(|| format!("{} \"{}\"", NO_MATCH_FOUND, prompt.trim()))
}

fn depth_map(
    models: &AiModels,
    warped_image: &DynamicImage,
    path_hash: String,
) -> Result<CachedDepthMap, String> {
    let depth_image = run_depth_anything_model(
        warped_image,
        &*models.depth_anything().map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    Ok(CachedDepthMap {
        path_hash,
        depth_image,
        original_size: (warped_image.width(), warped_image.height()),
    })
}

/// The map a Depth mask stores: the model's depth at the photo's size, with sharp object
/// edges (see `snap_depth_edges`).
fn depth_mask(depth: &CachedDepthMap) -> GrayImage {
    let raw_depth_fullres = image::imageops::resize(
        &depth.depth_image,
        depth.original_size.0,
        depth.original_size.1,
        image::imageops::FilterType::Triangle,
    );
    // The ramp the model leaves is about two of its pixels wide, so the window covers three.
    let upscale = depth.original_size.0 as f32 / depth.depth_image.width().max(1) as f32;
    crate::ai_processing::snap_depth_edges(
        &raw_depth_fullres,
        (3.0 * upscale).ceil() as u32,
        DEPTH_EDGE_THRESHOLD,
    )
}

fn subject_embeddings(
    models: &AiModels,
    warped_image: &DynamicImage,
    path_hash: String,
) -> Result<ImageEmbeddings, String> {
    let mut embeddings = generate_image_embeddings(
        warped_image,
        &*models.sam_encoder().map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    embeddings.path_hash = path_hash;
    Ok(embeddings)
}

/// The photo's orientation an AI mask is drawn and made in; its parameters record it.
#[derive(Clone, Copy)]
struct MaskGeometry {
    rotation: f32,
    flip_horizontal: bool,
    flip_vertical: bool,
    orientation_steps: u8,
}

impl MaskGeometry {
    fn of(adjustments: &serde_json::Value) -> Self {
        Self {
            rotation: adjustments["rotation"].as_f64().unwrap_or(0.0) as f32,
            flip_horizontal: adjustments["flipHorizontal"].as_bool().unwrap_or(false),
            flip_vertical: adjustments["flipVertical"].as_bool().unwrap_or(false),
            orientation_steps: adjustments["orientationSteps"].as_u64().unwrap_or(0) as u8,
        }
    }
}

/// A Subject mask from the box drawn between `start_point` and `end_point` on the photo as
/// shown (rotated, flipped and turned by `geometry`).
fn subject_mask(
    models: &AiModels,
    embeddings: &ImageEmbeddings,
    start_point: (f64, f64),
    end_point: (f64, f64),
    geometry: MaskGeometry,
    refinement_image: Option<&DynamicImage>,
) -> Result<GrayImage, String> {
    let (img_w, img_h) = embeddings.original_size;
    let MaskGeometry {
        rotation,
        flip_horizontal,
        flip_vertical,
        orientation_steps,
    } = geometry;

    let (coarse_rotated_w, coarse_rotated_h) = if orientation_steps % 2 == 1 {
        (img_h as f64, img_w as f64)
    } else {
        (img_w as f64, img_h as f64)
    };

    let center = (coarse_rotated_w / 2.0, coarse_rotated_h / 2.0);

    let p1 = start_point;
    let p2 = (start_point.0, end_point.1);
    let p3 = end_point;
    let p4 = (end_point.0, start_point.1);

    let angle_rad = (rotation as f64).to_radians();
    let cos_a = angle_rad.cos();
    let sin_a = angle_rad.sin();

    let unrotate = |p: (f64, f64)| {
        let px = p.0 - center.0;
        let py = p.1 - center.1;
        let new_px = px * cos_a + py * sin_a + center.0;
        let new_py = -px * sin_a + py * cos_a + center.1;
        (new_px, new_py)
    };

    let unflip = |p: (f64, f64)| {
        let mut new_px = p.0;
        let mut new_py = p.1;
        if flip_horizontal {
            new_px = coarse_rotated_w - p.0;
        }
        if flip_vertical {
            new_py = coarse_rotated_h - p.1;
        }
        (new_px, new_py)
    };

    let un_coarse_rotate = |p: (f64, f64)| -> (f64, f64) {
        match orientation_steps {
            0 => p,
            1 => (p.1, img_h as f64 - p.0),
            2 => (img_w as f64 - p.0, img_h as f64 - p.1),
            3 => (img_w as f64 - p.1, p.0),
            _ => p,
        }
    };

    // The drawn box's corners in the embedded image, in order around it (rotated by `rotation`).
    let box_corners = [p1, p2, p3, p4].map(|p| un_coarse_rotate(unflip(unrotate(p))));

    run_sam_decoder(
        &*models.sam_decoder().map_err(|e| e.to_string())?,
        embeddings,
        box_corners,
        refinement_image,
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn generate_ai_foreground_mask(
    js_adjustments: serde_json::Value,
    rotation: f32,
    flip_horizontal: bool,
    flip_vertical: bool,
    orientation_steps: u8,
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
) -> Result<AiForegroundMaskParameters, String> {
    let models = get_or_init_ai_models(
        &app_handle,
        &state.ai_state,
        &state.ai_init_lock,
        AiMaskModel::Foreground,
    )
    .await
    .map_err(|e| e.to_string())?;

    let warped_image = get_cached_full_warped_image(&state, &js_adjustments)?;
    let base64_data = encode_to_base64_png(&foreground_mask(&models, &warped_image)?)?;

    Ok(AiForegroundMaskParameters {
        mask_data_base64: Some(base64_data),
        rotation: Some(rotation),
        flip_horizontal: Some(flip_horizontal),
        flip_vertical: Some(flip_vertical),
        orientation_steps: Some(orientation_steps),
    })
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn generate_ai_sky_mask(
    js_adjustments: serde_json::Value,
    path: String,
    rotation: f32,
    flip_horizontal: bool,
    flip_vertical: bool,
    orientation_steps: u8,
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
) -> Result<AiSkyMaskParameters, String> {
    let models = get_or_init_ai_models(
        &app_handle,
        &state.ai_state,
        &state.ai_init_lock,
        AiMaskModel::Sky,
    )
    .await
    .map_err(|e| e.to_string())?;

    let warped_image = get_cached_full_warped_image(&state, &js_adjustments)?;

    let features = cached_esam3_features(
        &state.ai_state,
        &models,
        &ai_cache_key(&path, &js_adjustments),
        &warped_image,
    )?;
    let base64_data = encode_to_base64_png(&sky_mask(&models, &features, &warped_image)?)?;

    Ok(AiSkyMaskParameters {
        mask_data_base64: Some(base64_data),
        rotation: Some(rotation),
        flip_horizontal: Some(flip_horizontal),
        flip_vertical: Some(flip_vertical),
        orientation_steps: Some(orientation_steps),
    })
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn generate_ai_text_mask(
    js_adjustments: serde_json::Value,
    path: String,
    prompt: String,
    rotation: f32,
    flip_horizontal: bool,
    flip_vertical: bool,
    orientation_steps: u8,
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
) -> Result<AiTextMaskParameters, String> {
    let models = get_or_init_ai_models(
        &app_handle,
        &state.ai_state,
        &state.ai_init_lock,
        AiMaskModel::Text,
    )
    .await
    .map_err(|e| e.to_string())?;

    let warped_image = get_cached_full_warped_image(&state, &js_adjustments)?;

    let features = cached_esam3_features(
        &state.ai_state,
        &models,
        &ai_cache_key(&path, &js_adjustments),
        &warped_image,
    )?;
    let base64_data =
        encode_to_base64_png(&text_mask(&models, &features, &warped_image, &prompt)?)?;

    Ok(AiTextMaskParameters {
        prompt,
        mask_data_base64: Some(base64_data),
        rotation: Some(rotation),
        flip_horizontal: Some(flip_horizontal),
        flip_vertical: Some(flip_vertical),
        orientation_steps: Some(orientation_steps),
    })
}

/// Depth difference (of 255) within the snap window that counts as an object edge; smooth
/// slopes such as a receding riverbed change less across the window.
const DEPTH_EDGE_THRESHOLD: u8 = 24;

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn generate_ai_depth_mask(
    js_adjustments: serde_json::Value,
    path: String,
    min_depth: f32,
    max_depth: f32,
    min_fade: f32,
    max_fade: f32,
    feather: f32,
    full_strength: Option<bool>,
    rotation: f32,
    flip_horizontal: bool,
    flip_vertical: bool,
    orientation_steps: u8,
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
) -> Result<AiDepthMaskParameters, String> {
    let models = get_or_init_ai_models(
        &app_handle,
        &state.ai_state,
        &state.ai_init_lock,
        AiMaskModel::Depth,
    )
    .await
    .map_err(|e| e.to_string())?;

    let path_hash = ai_cache_key(&path, &js_adjustments);

    let cached_depth = {
        let mut ai_state_lock = state.ai_state.lock().unwrap();
        let ai_state = ai_state_lock.as_mut().unwrap();

        match &ai_state.depth_map {
            Some(cached) if cached.path_hash == path_hash => cached.clone(),
            _ => {
                let warped_image = get_cached_full_warped_image(&state, &js_adjustments)?;
                let new_cache = depth_map(&models, &warped_image, path_hash)?;
                ai_state.depth_map = Some(new_cache.clone());
                new_cache
            }
        }
    };

    let base64_data = encode_to_base64_png(&depth_mask(&cached_depth))?;

    Ok(AiDepthMaskParameters {
        min_depth,
        max_depth,
        min_fade,
        max_fade,
        feather,
        full_strength: full_strength.unwrap_or(false),
        mask_data_base64: Some(base64_data),
        rotation: Some(rotation),
        flip_horizontal: Some(flip_horizontal),
        flip_vertical: Some(flip_vertical),
        orientation_steps: Some(orientation_steps),
    })
}

#[tauri::command]
pub async fn generate_full_image_depth_map(
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
) -> Result<String, String> {
    let models = get_or_init_ai_models(
        &app_handle,
        &state.ai_state,
        &state.ai_init_lock,
        AiMaskModel::Depth,
    )
    .await
    .map_err(|e| e.to_string())?;

    let (base_image, is_raw) = crate::get_original_image(&state)?;
    let source_image =
        crate::image_processing::build_full_source_image(base_image.as_ref(), is_raw);

    let depth_img = crate::ai_processing::run_depth_anything_model(
        source_image.as_ref(),
        &*models.depth_anything().map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;

    crate::effect_maps::encode_source_space_map(&image::DynamicImage::ImageLuma8(depth_img))
}

#[tauri::command]
pub async fn generate_relight_normal_map(
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
) -> Result<String, String> {
    let normal_model = crate::ai_processing::get_or_init_normal_model(
        &app_handle,
        &state.ai_state,
        &state.ai_init_lock,
    )
    .await
    .map_err(|e| e.to_string())?;

    let (base_image, is_raw) = crate::get_original_image(&state)?;
    let source_image =
        crate::image_processing::build_full_source_image(base_image.as_ref(), is_raw);

    let normal_img =
        crate::ai_processing::run_normal_model(source_image.as_ref(), normal_model.as_ref())
            .map_err(|e| e.to_string())?;

    crate::effect_maps::encode_source_space_map(&image::DynamicImage::ImageRgba8(normal_img))
}

/// Binary grid for the 3D depth view (layout in `effect_maps::build_depth_preview`).
#[tauri::command]
pub async fn get_depth_preview(
    js_adjustments: serde_json::Value,
    map_key: Option<String>,
    map_data: Option<String>,
    max_size: u32,
    state: tauri::State<'_, AppState>,
) -> Result<tauri::ipc::Response, String> {
    let (base_image, is_raw) = crate::get_original_image(&state)?;
    tauri::async_runtime::spawn_blocking(move || {
        crate::effect_maps::build_depth_preview(
            base_image.as_ref(),
            is_raw,
            &js_adjustments,
            map_key.as_deref(),
            map_data.as_deref(),
            max_size.clamp(16, 512),
        )
    })
    .await
    .map_err(|e| e.to_string())?
    .map(tauri::ipc::Response::new)
    .ok_or_else(|| "Depth map unavailable".to_string())
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn generate_ai_subject_mask(
    js_adjustments: serde_json::Value,
    path: String,
    start_point: (f64, f64),
    end_point: (f64, f64),
    rotation: f32,
    flip_horizontal: bool,
    flip_vertical: bool,
    orientation_steps: u8,
    skip_refinement: Option<bool>,
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
) -> Result<AiSubjectMaskParameters, String> {
    let models = get_or_init_ai_models(
        &app_handle,
        &state.ai_state,
        &state.ai_init_lock,
        AiMaskModel::Subject,
    )
    .await
    .map_err(|e| e.to_string())?;

    let path_hash = ai_cache_key(&path, &js_adjustments);

    let embeddings = {
        let mut ai_state_lock = state.ai_state.lock().unwrap();
        let ai_state = ai_state_lock.as_mut().unwrap();

        match &ai_state.embeddings {
            Some(cached) if cached.path_hash == path_hash => cached.clone(),
            _ => {
                let warped_image = get_cached_full_warped_image(&state, &js_adjustments)?;
                let new_embeddings = subject_embeddings(&models, &warped_image, path_hash)?;
                ai_state.embeddings = Some(new_embeddings.clone());
                new_embeddings
            }
        }
    };

    let refinement_image = if skip_refinement.unwrap_or(false) {
        None
    } else {
        Some(get_cached_full_warped_image(&state, &js_adjustments)?)
    };
    let geometry = MaskGeometry {
        rotation,
        flip_horizontal,
        flip_vertical,
        orientation_steps,
    };
    let mask_bitmap = subject_mask(
        &models,
        &embeddings,
        start_point,
        end_point,
        geometry,
        refinement_image.as_deref(),
    )?;
    let base64_data = encode_to_base64_png(&mask_bitmap)?;

    Ok(AiSubjectMaskParameters {
        start_x: start_point.0,
        start_y: start_point.1,
        end_x: end_point.0,
        end_y: end_point.1,
        mask_data_base64: Some(base64_data),
        rotation: Some(rotation),
        flip_horizontal: Some(flip_horizontal),
        flip_vertical: Some(flip_vertical),
        orientation_steps: Some(orientation_steps),
    })
}

#[tauri::command]
pub async fn precompute_ai_subject_mask(
    js_adjustments: serde_json::Value,
    path: String,
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    let models = get_or_init_ai_models(
        &app_handle,
        &state.ai_state,
        &state.ai_init_lock,
        AiMaskModel::Subject,
    )
    .await
    .map_err(|e| e.to_string())?;

    let path_hash = ai_cache_key(&path, &js_adjustments);

    let mut ai_state_lock = state.ai_state.lock().unwrap();
    let ai_state = ai_state_lock.as_mut().unwrap();

    if let Some(cached_embeddings) = &ai_state.embeddings
        && cached_embeddings.path_hash == path_hash
    {
        return Ok(());
    }

    let warped_image = get_cached_full_warped_image(&state, &js_adjustments)?;
    ai_state.embeddings = Some(subject_embeddings(&models, &warped_image, path_hash)?);

    Ok(())
}

#[tauri::command]
pub async fn check_ai_connector_status(app_handle: tauri::AppHandle) {
    let address = settings_snapshot(&app_handle)
        .ok()
        .and_then(|settings| settings.ai_connector_address.clone());
    let is_connected = if let Some(address) = address {
        ai_connector::check_status(&address).await.unwrap_or(false)
    } else {
        false
    };
    use tauri::Emitter;
    let _ = app_handle.emit(
        "ai-connector-status-update",
        serde_json::json!({ "connected": is_connected }),
    );
}

#[tauri::command]
pub async fn test_ai_connector_connection(address: String) -> Result<(), String> {
    match ai_connector::check_status(&address).await {
        Ok(true) => Ok(()),
        Ok(false) => Err("Server reachable but returned bad health status".to_string()),
        Err(e) => Err(e.to_string()),
    }
}

/// The parameters beside its bitmap that say which orientation of the photo an AI mask was made in.
const MASK_GEOMETRY_PARAMETERS: [&str; 4] = [
    "rotation",
    "flipHorizontal",
    "flipVertical",
    "orientationSteps",
];

/// The model an AI mask component is made with; other components have no AI bitmap.
fn ai_mask_model(mask_type: &str) -> Option<AiMaskModel> {
    match mask_type {
        "ai-subject" => Some(AiMaskModel::Subject),
        "ai-foreground" => Some(AiMaskModel::Foreground),
        "ai-sky" => Some(AiMaskModel::Sky),
        "ai-text" => Some(AiMaskModel::Text),
        "ai-depth" => Some(AiMaskModel::Depth),
        _ => None,
    }
}

/// The components of every mask in `adjustments` (AI edits are not copied between photos).
fn mask_components(adjustments: &Value) -> impl Iterator<Item = &Value> {
    adjustments
        .get("masks")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|mask| mask.get("subMasks").and_then(Value::as_array))
        .flatten()
}

fn mask_components_mut(adjustments: &mut Value) -> impl Iterator<Item = &mut Value> {
    adjustments
        .get_mut("masks")
        .and_then(Value::as_array_mut)
        .into_iter()
        .flatten()
        .filter_map(|mask| mask.get_mut("subMasks").and_then(Value::as_array_mut))
        .flatten()
}

fn has_mask_data(component: &Value) -> bool {
    SUB_MASK_DATA_KEYS.iter().any(|key| {
        component["parameters"]
            .get(*key)
            .is_some_and(|data| !data.is_null())
    })
}

/// What an AI component's bitmap is made from beside the photo: a Subject mask's drawn box,
/// a Text mask's words, nothing for the others. `None` when it cannot be made: not an AI
/// component, a Subject mask without a box, a Text mask without words.
fn ai_mask_inputs(component: &Value) -> Option<Value> {
    let mask_type = component["type"].as_str()?;
    ai_mask_model(mask_type)?;
    let parameters = &component["parameters"];
    match mask_type {
        "ai-subject" => {
            let corners = ["startX", "startY", "endX", "endY"].map(|key| parameters[key].as_f64());
            corners
                .iter()
                .all(Option::is_some)
                .then(|| serde_json::json!(corners))
        }
        "ai-text" => parameters["prompt"]
            .as_str()
            .map(str::trim)
            .filter(|prompt| !prompt.is_empty())
            .map(Value::from),
        _ => Some(Value::Null),
    }
}

/// Whether `fill_ai_mask_data` has a component to make in `adjustments`.
fn needs_ai_mask_data(adjustments: &Value) -> bool {
    mask_components(adjustments)
        .any(|component| !has_mask_data(component) && ai_mask_inputs(component).is_some())
}

/// Components whose parameters are pixels of the photo they were drawn on: the uncropped photo
/// after its quarter turns. Each records that size as `imageSize` (Plan item 91); without it
/// (made before `1.125.3`) its pixels are applied as they are.
const SIZED_MASK_TYPES: [&str; 3] = ["radial", "linear", "ai-subject"];
const MASK_X_PARAMETERS: [&str; 3] = ["centerX", "startX", "endX"];
const MASK_Y_PARAMETERS: [&str; 3] = ["centerY", "startY", "endY"];
/// Lengths follow the short side, as a new Linear mask's range does (`createMaskLogic`).
const MASK_LENGTH_PARAMETERS: [&str; 3] = ["radiusX", "radiusY", "range"];

/// The size a component's pixels refer to, when it records one.
fn mask_image_size(component: &Value) -> Option<(f64, f64)> {
    if !SIZED_MASK_TYPES.contains(&component["type"].as_str()?) {
        return None;
    }
    let size = &component["parameters"]["imageSize"];
    let positive = |key: &str| size[key].as_f64().filter(|value| *value > 0.0);
    Some((positive("width")?, positive("height")?))
}

/// Scales every shape component that records its `imageSize` to a photo of `size` (its
/// uncropped size after its quarter turns): positions per axis, lengths by the short side.
/// Mirrors `fitMasksToImage` in `maskUtils.ts`, which does this for the photo open in Develop.
fn fit_masks_to_image(adjustments: &mut Value, size: (u32, u32)) {
    let (width, height) = (f64::from(size.0), f64::from(size.1));
    for component in mask_components_mut(adjustments) {
        let Some((from_width, from_height)) = mask_image_size(component) else {
            continue;
        };
        let Some(parameters) = component
            .get_mut("parameters")
            .and_then(Value::as_object_mut)
        else {
            continue;
        };
        let factors = [
            (&MASK_X_PARAMETERS, width / from_width),
            (&MASK_Y_PARAMETERS, height / from_height),
            (
                &MASK_LENGTH_PARAMETERS,
                width.min(height) / from_width.min(from_height),
            ),
        ];
        for (keys, factor) in factors {
            for key in keys {
                if let Some(value) = parameters.get(*key).and_then(Value::as_f64) {
                    parameters.insert(key.to_string(), (value * factor).into());
                }
            }
        }
        parameters.insert(
            "imageSize".to_string(),
            serde_json::json!({ "width": size.0, "height": size.1 }),
        );
    }
}

fn has_sized_shapes(adjustments: &Value) -> bool {
    mask_components(adjustments).any(|component| mask_image_size(component).is_some())
}

/// Whether `prepare_masks_for_photo` has work in `adjustments`: AI parts to make, or (with
/// `fit_shapes`) shapes to fit.
pub fn masks_need_preparing(adjustments: &Value, fit_shapes: bool) -> bool {
    needs_ai_mask_data(adjustments) || (fit_shapes && has_sized_shapes(adjustments))
}

/// Gives every AI mask component in `adjustments` that has no bitmap the one `generate` makes
/// for this photo (Plan item 90: presets and copied settings carry no bitmaps). A component
/// that `previous`, the photo's edit before this change, holds with the same id, type and
/// inputs keeps its bitmap instead, so Auto Sync does not redo it for every slider change.
/// A component whose bitmap cannot be made stays without one and has no effect.
fn fill_ai_mask_data(
    adjustments: &mut Value,
    previous: &Value,
    mut generate: impl FnMut(&str, &Value, MaskGeometry) -> Result<GrayImage, String>,
) {
    let kept: HashMap<&str, &Value> = mask_components(previous)
        .filter(|component| has_mask_data(component))
        .filter_map(|component| Some((component["id"].as_str()?, component)))
        .collect();
    let geometry = MaskGeometry::of(adjustments);

    for component in mask_components_mut(adjustments) {
        if has_mask_data(component) {
            continue;
        }
        let Some(inputs) = ai_mask_inputs(component) else {
            continue;
        };
        let reused = component["id"]
            .as_str()
            .and_then(|id| kept.get(id))
            .filter(|old| {
                old["type"] == component["type"] && ai_mask_inputs(old).as_ref() == Some(&inputs)
            });
        let made = match reused {
            Some(_) => None,
            None => {
                let mask_type = component["type"].as_str().unwrap_or_default();
                Some(
                    generate(mask_type, &component["parameters"], geometry)
                        .and_then(|mask| encode_to_base64_png(&mask)),
                )
            }
        };
        let Some(parameters) = component
            .get_mut("parameters")
            .and_then(Value::as_object_mut)
        else {
            continue;
        };
        match (reused, made) {
            (Some(old), _) => {
                for key in SUB_MASK_DATA_KEYS.iter().chain(&MASK_GEOMETRY_PARAMETERS) {
                    if let Some(value) = old["parameters"].get(*key) {
                        parameters.insert(key.to_string(), value.clone());
                    }
                }
            }
            (None, Some(Ok(data))) => {
                for key in SUB_MASK_DATA_KEYS {
                    parameters.remove(key);
                }
                parameters.insert("maskDataBase64".to_string(), data.into());
                parameters.insert("rotation".to_string(), geometry.rotation.into());
                parameters.insert(
                    "flipHorizontal".to_string(),
                    geometry.flip_horizontal.into(),
                );
                parameters.insert("flipVertical".to_string(), geometry.flip_vertical.into());
                parameters.insert(
                    "orientationSteps".to_string(),
                    geometry.orientation_steps.into(),
                );
            }
            (None, Some(Err(error))) => log::warn!("AI mask not made for this photo: {error}"),
            (None, None) => {}
        }
    }
}

/// The photo at `path` (its file) decoded at full size, as the editor opens it.
fn load_base_image(path: &str, settings: &AppSettings) -> Result<DynamicImage, String> {
    let decode = |bytes: &[u8]| {
        crate::image_loader::load_base_image_from_bytes(bytes, path, false, settings, None)
            .map_err(|e| e.to_string())
    };
    match crate::file_management::read_file_mapped(Path::new(path)) {
        Ok(mapped) => decode(&mapped),
        Err(_) => decode(&std::fs::read(path).map_err(|e| e.to_string())?),
    }
}

/// AI models by kind, each loaded (and downloaded) on first use.
pub type AiModelLoader<'a> = dyn Fn(AiMaskModel) -> Result<Arc<AiModels>, String> + 'a;

/// One photo's inputs to its masks, each made at most once: the decoded photo, the photo as AI
/// masks see it, and what each model reads from it.
struct PhotoMaskInputs<'a> {
    path: &'a str,
    adjustments: Value,
    settings: &'a AppSettings,
    models: &'a AiModelLoader<'a>,
    base_image: Option<Arc<DynamicImage>>,
    warped_image: Option<Arc<DynamicImage>>,
    embeddings: Option<ImageEmbeddings>,
    features: Option<Esam3Features>,
    depth: Option<CachedDepthMap>,
}

impl PhotoMaskInputs<'_> {
    fn base_image(&mut self) -> Result<Arc<DynamicImage>, String> {
        if self.base_image.is_none() {
            self.base_image = Some(Arc::new(load_base_image(self.path, self.settings)?));
        }
        Ok(Arc::clone(self.base_image.as_ref().expect("set above")))
    }

    /// The photo with its geometry and lens profile, as `get_cached_full_warped_image` shows
    /// the photo open in the editor to AI masks.
    fn warped_image(&mut self) -> Result<Arc<DynamicImage>, String> {
        if self.warped_image.is_none() {
            let base_image = self.base_image()?;
            let source_image = crate::image_processing::build_full_source_image(
                &base_image,
                crate::formats::is_raw_file(self.path),
            );
            let with_profile =
                crate::lens_correction::with_lens_profile(self.path, &self.adjustments);
            let image =
                crate::image_processing::apply_geometry_warp(source_image, with_profile.as_ref())
                    .into_owned();
            self.warped_image = Some(Arc::new(image));
        }
        Ok(Arc::clone(self.warped_image.as_ref().expect("set above")))
    }

    fn mask(
        &mut self,
        mask_type: &str,
        parameters: &Value,
        geometry: MaskGeometry,
    ) -> Result<GrayImage, String> {
        let model = ai_mask_model(mask_type).ok_or("Not an AI mask")?;
        let models = (self.models)(model)?;
        let image = self.warped_image()?;
        match model {
            AiMaskModel::Foreground => foreground_mask(&models, &image),
            AiMaskModel::Sky | AiMaskModel::Text => {
                if self.features.is_none() {
                    let features = run_esam3_image_encoder(
                        &image,
                        &*models.esam3_image_encoder().map_err(|e| e.to_string())?,
                    )
                    .map_err(|e| e.to_string())?;
                    self.features = Some(features);
                }
                let features = self.features.as_ref().expect("set above");
                match model {
                    AiMaskModel::Sky => sky_mask(&models, features, &image),
                    _ => text_mask(
                        &models,
                        features,
                        &image,
                        parameters["prompt"].as_str().unwrap_or_default(),
                    ),
                }
            }
            AiMaskModel::Depth => {
                if self.depth.is_none() {
                    self.depth = Some(depth_map(&models, &image, String::new())?);
                }
                Ok(depth_mask(self.depth.as_ref().expect("set above")))
            }
            AiMaskModel::Subject => {
                let drawn: AiSubjectMaskParameters =
                    serde_json::from_value(parameters.clone()).map_err(|e| e.to_string())?;
                if self.embeddings.is_none() {
                    self.embeddings = Some(subject_embeddings(&models, &image, String::new())?);
                }
                subject_mask(
                    &models,
                    self.embeddings.as_ref().expect("set above"),
                    (drawn.start_x, drawn.start_y),
                    (drawn.end_x, drawn.end_y),
                    geometry,
                    Some(&image),
                )
            }
        }
    }
}

/// Fits the masks in `adjustments`, applied from a preset or another photo, to the photo whose
/// file is at `path`: with `fit_shapes`, shapes to its size (`fit_masks_to_image`, Plan item
/// 91), then its AI parts (`fill_ai_mask_data`, Plan item 90, with models from `models`). The
/// photo is decoded once, and only when needed.
pub fn prepare_masks_for_photo(
    path: &str,
    adjustments: &mut Value,
    previous: &Value,
    fit_shapes: bool,
    settings: &AppSettings,
    models: &AiModelLoader,
) {
    let mut inputs = PhotoMaskInputs {
        path,
        adjustments: Value::Null,
        settings,
        models,
        base_image: None,
        warped_image: None,
        embeddings: None,
        features: None,
        depth: None,
    };
    if fit_shapes && has_sized_shapes(adjustments) {
        match inputs.base_image() {
            Ok(image) => {
                let (width, height) = (image.width(), image.height());
                let turned = MaskGeometry::of(adjustments).orientation_steps % 2 == 1;
                let size = if turned {
                    (height, width)
                } else {
                    (width, height)
                };
                fit_masks_to_image(adjustments, size);
            }
            Err(error) => log::warn!("Masks not fitted to {path}: {error}"),
        }
    }
    if needs_ai_mask_data(adjustments) {
        inputs.adjustments = adjustments.clone();
        fill_ai_mask_data(adjustments, previous, |mask_type, parameters, geometry| {
            inputs.mask(mask_type, parameters, geometry)
        });
    }
}

/// The AI model loader of `prepare_masks_for_photo`; call it from a blocking thread.
pub fn blocking_ai_models(
    app_handle: &tauri::AppHandle,
) -> impl Fn(AiMaskModel) -> Result<Arc<AiModels>, String> + '_ {
    move |model| {
        let state = app_handle.state::<AppState>();
        tauri::async_runtime::block_on(get_or_init_ai_models(
            app_handle,
            &state.ai_state,
            &state.ai_init_lock,
            model,
        ))
        .map_err(|e| e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn edit(components: Value) -> Value {
        json!({ "rotation": 2.5, "orientationSteps": 1, "masks": [{ "id": "m", "subMasks": components }] })
    }

    fn data_of(adjustments: &Value, index: usize) -> &Value {
        &adjustments["masks"][0]["subMasks"][index]["parameters"]["maskDataBase64"]
    }

    #[test]
    fn ai_components_without_a_bitmap_are_made_for_the_photo() {
        let mut adjustments = edit(json!([
            { "id": "a", "type": "ai-depth", "parameters": { "minDepth": 5.0, "maskDataBase64": null } },
            { "id": "b", "type": "ai-subject", "parameters": {} },
            { "id": "c", "type": "ai-text", "parameters": { "prompt": "  " } },
            { "id": "d", "type": "linear", "parameters": { "startX": 1.0 } },
            { "id": "e", "type": "ai-sky", "parameters": { "maskDataBase64": "data:own" } },
            { "id": "f", "type": "ai-foreground", "parameters": {} },
        ]));
        assert!(needs_ai_mask_data(&adjustments));

        let mut made = Vec::new();
        fill_ai_mask_data(&mut adjustments, &Value::Null, |mask_type, _, geometry| {
            made.push(mask_type.to_string());
            assert_eq!((geometry.rotation, geometry.orientation_steps), (2.5, 1));
            match mask_type {
                "ai-depth" => Ok(GrayImage::new(2, 2)),
                _ => Err("no foreground".to_string()),
            }
        });

        // A Subject mask without a box and a Text mask without words cannot be made.
        assert_eq!(made, ["ai-depth", "ai-foreground"]);
        let depth = &adjustments["masks"][0]["subMasks"][0]["parameters"];
        assert!(
            depth["maskDataBase64"]
                .as_str()
                .unwrap()
                .starts_with("data:image/png;base64,")
        );
        assert_eq!(depth["minDepth"], 5.0);
        assert_eq!(depth["rotation"], 2.5);
        assert_eq!(depth["orientationSteps"], 1);
        assert_eq!(*data_of(&adjustments, 4), "data:own");
        // One that fails stays without a bitmap, so it has no effect.
        assert!(data_of(&adjustments, 5).is_null());
        assert!(!needs_ai_mask_data(&edit(json!([
            { "id": "g", "type": "brush", "parameters": {} },
        ]))));
    }

    #[test]
    fn shapes_are_fitted_to_the_photo_they_are_applied_to() {
        let size = json!({ "width": 6000, "height": 4000 });
        let mut adjustments = edit(json!([
            { "id": "a", "type": "linear", "parameters": {
                "startX": 3000.0, "startY": 1000.0, "endX": 6000.0, "endY": 2000.0,
                "range": 400.0, "imageSize": size } },
            { "id": "b", "type": "radial", "parameters": {
                "centerX": 1500.0, "centerY": 2000.0, "radiusX": 800.0, "radiusY": 400.0,
                "rotation": 30.0, "feather": 0.5, "imageSize": size } },
            { "id": "c", "type": "ai-subject", "parameters": {
                "startX": 600.0, "startY": 400.0, "endX": 1200.0, "endY": 800.0, "imageSize": size } },
            // Made before `1.125.3`: no size, so its pixels stay.
            { "id": "d", "type": "linear", "parameters": { "startX": 3000.0, "range": 400.0 } },
        ]));
        let shapes_only = edit(json!([adjustments["masks"][0]["subMasks"][0].clone()]));
        assert!(masks_need_preparing(&shapes_only, true));
        // Auto Sync keeps its pixels.
        assert!(!masks_need_preparing(&shapes_only, false));

        // A 3000×3000 photo: half as wide, three quarters as high, short side three quarters.
        fit_masks_to_image(&mut adjustments, (3000, 3000));
        let parameters = |index: usize| &adjustments["masks"][0]["subMasks"][index]["parameters"];
        let linear = parameters(0);
        assert_eq!(
            [
                &linear["startX"],
                &linear["startY"],
                &linear["endX"],
                &linear["endY"],
                &linear["range"]
            ],
            [1500.0, 750.0, 3000.0, 1500.0, 300.0]
        );
        assert_eq!(
            linear["imageSize"],
            json!({ "width": 3000, "height": 3000 })
        );
        let radial = parameters(1);
        assert_eq!(
            [
                &radial["centerX"],
                &radial["centerY"],
                &radial["radiusX"],
                &radial["radiusY"]
            ],
            [750.0, 1500.0, 600.0, 300.0]
        );
        assert_eq!([&radial["rotation"], &radial["feather"]], [30.0, 0.5]);
        assert_eq!(
            [&parameters(2)["startX"], &parameters(2)["endY"]],
            [300.0, 600.0]
        );
        assert_eq!(parameters(3)["startX"], 3000.0);
        assert!(parameters(3).get("imageSize").is_none());
    }

    #[test]
    fn auto_sync_keeps_the_bitmap_a_photo_already_has() {
        let previous = edit(json!([
            { "id": "a", "type": "ai-depth", "parameters": { "maskDataBase64": "data:depth", "rotation": 9.0 } },
            { "id": "b", "type": "ai-text", "parameters": { "prompt": "tree", "maskDataBase64": "data:tree" } },
            { "id": "c", "type": "ai-sky", "parameters": { "maskDataBase64": "data:sky" } },
        ]));
        let mut adjustments = edit(json!([
            { "id": "a", "type": "ai-depth", "parameters": { "minDepth": 30.0 } },
            { "id": "b", "type": "ai-text", "parameters": { "prompt": "house" } },
            { "id": "z", "type": "ai-sky", "parameters": {} },
        ]));

        let mut made = Vec::new();
        fill_ai_mask_data(&mut adjustments, &previous, |mask_type, _, _| {
            made.push(mask_type.to_string());
            Err("not loaded".to_string())
        });

        // Same id and inputs: kept, with the orientation it was made in.
        assert_eq!(*data_of(&adjustments, 0), "data:depth");
        assert_eq!(
            adjustments["masks"][0]["subMasks"][0]["parameters"]["rotation"],
            9.0
        );
        assert_eq!(
            adjustments["masks"][0]["subMasks"][0]["parameters"]["minDepth"],
            30.0
        );
        // Other words or another id: made again.
        assert_eq!(made, ["ai-text", "ai-sky"]);
        assert!(data_of(&adjustments, 1).is_null());
        assert!(data_of(&adjustments, 2).is_null());
    }
}
