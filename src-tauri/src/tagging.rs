use anyhow::Result;
use futures::stream::{self, StreamExt};
use image::{DynamicImage, imageops::FilterType};
use ndarray::{Array, Axis};
use ort::session::Session;
use ort::value::Tensor;
use rayon::prelude::*;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, State};
use tokenizers::Tokenizer;
use tokio::task::JoinHandle;
use walkdir::WalkDir;

use crate::file_management::{self, parse_virtual_path};
use crate::formats::is_supported_image_file;
use crate::hierarchy::TAG_HIERARCHY;
use crate::image_processing::ImageMetadata;
use crate::{AppState, candidates::TAG_CANDIDATES};

pub const COLOR_TAG_PREFIX: &str = "color:";
pub const FLAG_TAG_PREFIX: &str = "flag:";
pub const USER_TAG_PREFIX: &str = "user:";
/// Separates the levels of a user keyword path such as `user:places|germany|berlin`,
/// as in Lightroom Classic's `lr:hierarchicalSubject`.
pub const KEYWORD_PATH_SEPARATOR: char = '|';

fn apply_flag_to_tags(tags: &mut Vec<String>, flag: &str) {
    tags.retain(|tag| !tag.starts_with(FLAG_TAG_PREFIX));
    if flag != "unflagged" {
        tags.push(format!("{FLAG_TAG_PREFIX}{flag}"));
    }
}

/// AI keywords are stored without a prefix; user keywords, color labels, and flags have one.
pub fn is_ai_tag(tag: &str) -> bool {
    !tag.starts_with(COLOR_TAG_PREFIX)
        && !tag.starts_with(FLAG_TAG_PREFIX)
        && !tag.starts_with(USER_TAG_PREFIX)
}

fn push_unique(values: &mut Vec<String>, value: &str) {
    if !values.iter().any(|existing| existing == value) {
        values.push(value.to_string());
    }
}

/// The keyword bags ThisIsRAW writes to XMP for an image's keyword tags.
#[derive(Debug, Default, PartialEq)]
pub struct XmpKeywords {
    /// `dc:subject`: every level of each user keyword path, plus the AI keywords.
    pub subject: Vec<String>,
    /// `lr:hierarchicalSubject`: the complete user keyword paths.
    pub hierarchical: Vec<String>,
    /// AI keywords, listed so that another installation keeps them apart from user keywords.
    pub ai: Vec<String>,
}

impl XmpKeywords {
    /// `tags` must not contain color-label or flag tags.
    pub fn from_tags(tags: &[String]) -> Self {
        let mut keywords = Self::default();
        for tag in tags {
            if let Some(path) = tag.strip_prefix(USER_TAG_PREFIX) {
                push_unique(&mut keywords.hierarchical, path);
                for level in path.split(KEYWORD_PATH_SEPARATOR) {
                    push_unique(&mut keywords.subject, level);
                }
            } else {
                push_unique(&mut keywords.subject, tag);
                push_unique(&mut keywords.ai, tag);
            }
        }
        keywords
    }
}

/// Which application wrote the plain `dc:subject` keywords of an XMP file.
pub enum XmpKeywordOrigin {
    /// ThisIsRAW 1.18 or later, which lists its AI keywords.
    ThisIsRaw { ai_keywords: Vec<String> },
    /// Earlier ThisIsRAW and RapidRAW versions, which wrote AI keywords plainly and user
    /// keywords with the `user:` prefix.
    LegacyThisIsRaw,
    /// Another application, such as Lightroom Classic, whose keywords are all user keywords.
    Other,
}

/// Converts the keyword bags of an XMP file into stored tags.
pub fn tags_from_xmp_keywords(
    subject: &[String],
    hierarchical: &[String],
    origin: &XmpKeywordOrigin,
) -> Vec<String> {
    let mut tags = Vec::new();
    let mut path_levels = HashSet::new();
    for path in hierarchical {
        let levels: Vec<&str> = path
            .split(KEYWORD_PATH_SEPARATOR)
            .map(str::trim)
            .filter(|level| !level.is_empty())
            .collect();
        if levels.is_empty() {
            continue;
        }
        path_levels.extend(levels.iter().copied());
        let joined = levels.join(&KEYWORD_PATH_SEPARATOR.to_string());
        push_unique(&mut tags, &format!("{USER_TAG_PREFIX}{joined}"));
    }

    for keyword in subject.iter().map(|keyword| keyword.trim()) {
        let is_listed_ai_keyword = matches!(
            origin,
            XmpKeywordOrigin::ThisIsRaw { ai_keywords } if ai_keywords.iter().any(|ai| ai == keyword)
        );
        if keyword.is_empty() || (!is_listed_ai_keyword && path_levels.contains(keyword)) {
            continue;
        }
        let tag = if keyword.starts_with(USER_TAG_PREFIX)
            || is_listed_ai_keyword
            || matches!(origin, XmpKeywordOrigin::LegacyThisIsRaw)
        {
            keyword.to_string()
        } else {
            format!("{USER_TAG_PREFIX}{keyword}")
        };
        push_unique(&mut tags, &tag);
    }
    tags
}

/// Adds the tags read from XMP to `tags`. Earlier versions stored every plain `dc:subject`
/// keyword as an AI tag; such a tag is dropped when the XMP now yields it as a user keyword.
pub fn merge_xmp_keyword_tags(tags: &mut Vec<String>, subject: &[String], xmp_tags: &[String]) {
    tags.retain(|tag| !is_ai_tag(tag) || !subject.contains(tag) || xmp_tags.contains(tag));
    for tag in xmp_tags {
        push_unique(tags, tag);
    }
}

fn preprocess_clip_image(image: &DynamicImage) -> Array<f32, ndarray::Dim<[usize; 4]>> {
    let input_size = 224;
    let resized = image.resize_to_fill(input_size, input_size, FilterType::Triangle);
    let rgb_image = resized.to_rgb8();

    let mean = [0.48145466, 0.4578275, 0.40821073];
    let std = [0.26862954, 0.261_302_6, 0.275_777_1];

    let mut array = Array::zeros((1, 3, input_size as usize, input_size as usize));
    for (x, y, pixel) in rgb_image.enumerate_pixels() {
        array[[0, 0, y as usize, x as usize]] = (pixel[0] as f32 / 255.0 - mean[0]) / std[0];
        array[[0, 1, y as usize, x as usize]] = (pixel[1] as f32 / 255.0 - mean[1]) / std[1];
        array[[0, 2, y as usize, x as usize]] = (pixel[2] as f32 / 255.0 - mean[2]) / std[2];
    }
    array
}

fn softmax(array: &Array<f32, ndarray::Dim<[usize; 2]>>) -> Array<f32, ndarray::Dim<[usize; 2]>> {
    let mut new_array = array.clone();
    for mut row in new_array.axis_iter_mut(Axis(0)) {
        let max_val = row.iter().fold(f32::NEG_INFINITY, |a, &b| a.max(b));
        row.mapv_inplace(|x| (x - max_val).exp());
        let sum = row.sum();
        if sum > 0.0 {
            row.mapv_inplace(|x| x / sum);
        }
    }
    new_array
}

fn rgb_to_hsv((r, g, b): (u8, u8, u8)) -> (f32, f32, f32) {
    let r = r as f32 / 255.0;
    let g = g as f32 / 255.0;
    let b = b as f32 / 255.0;

    let max = r.max(g).max(b);
    let min = r.min(g).min(b);
    let delta = max - min;

    let h = if delta.abs() < f32::EPSILON {
        0.0
    } else if (max - r).abs() < f32::EPSILON {
        60.0 * (((g - b) / delta) % 6.0)
    } else if (max - g).abs() < f32::EPSILON {
        60.0 * (((b - r) / delta) + 2.0)
    } else {
        60.0 * (((r - g) / delta) + 4.0)
    };
    let h = if h < 0.0 { h + 360.0 } else { h };

    let s = if max.abs() < f32::EPSILON {
        0.0
    } else {
        delta / max
    };
    let v = max;

    (h, s, v)
}

pub fn extract_color_tags(image: &DynamicImage) -> Vec<String> {
    let resized = image.resize(100, 100, FilterType::Triangle);
    let rgb_image = resized.to_rgb8();
    let mut color_counts: HashMap<String, u32> = HashMap::new();

    for pixel in rgb_image.pixels() {
        let rgb = (pixel[0], pixel[1], pixel[2]);
        let (h, s, v) = rgb_to_hsv(rgb);

        let color_name = if v < 0.2 {
            "black".to_string()
        } else if s < 0.1 {
            if v > 0.8 {
                "white".to_string()
            } else {
                "gray".to_string()
            }
        } else {
            match h {
                _ if !(20.0..340.0).contains(&h) => "red".to_string(),
                _ if (20.0..45.0).contains(&h) => "orange".to_string(),
                _ if (45.0..70.0).contains(&h) => "yellow".to_string(),
                _ if (70.0..160.0).contains(&h) => "green".to_string(),
                _ if (160.0..260.0).contains(&h) => "blue".to_string(),
                _ if (260.0..340.0).contains(&h) => "purple".to_string(),
                _ => "unknown".to_string(),
            }
        };

        if (color_name == "orange" || color_name == "red") && v < 0.6 && s < 0.7 {
            *color_counts.entry("brown".to_string()).or_insert(0) += 1;
        } else {
            *color_counts.entry(color_name).or_insert(0) += 1;
        }
    }

    let mut colorful_tags: Vec<(String, u32)> = color_counts
        .iter()
        .filter(|(name, _)| !matches!(name.as_str(), "black" | "white" | "gray"))
        .map(|(name, &count)| (name.clone(), count))
        .collect();

    colorful_tags.sort_by_key(|b| std::cmp::Reverse(b.1));

    if !colorful_tags.is_empty() {
        colorful_tags
            .into_iter()
            .take(2)
            .map(|(name, _)| name)
            .collect()
    } else {
        color_counts
            .into_iter()
            .max_by_key(|&(_, count)| count)
            .map(|(name, _)| vec![name])
            .unwrap_or_default()
    }
}

pub fn generate_tags_with_clip(
    image: &DynamicImage,
    clip_session_mutex: &Mutex<Session>,
    tokenizer: &Tokenizer,
    custom_tags: Option<Vec<String>>,
    max_tags: usize,
) -> Result<Vec<String>> {
    let image_input = preprocess_clip_image(image);

    let is_custom = custom_tags.as_ref().map(|t| !t.is_empty()).unwrap_or(false);
    let text_inputs: Vec<String> = if is_custom {
        custom_tags.as_ref().unwrap().clone()
    } else {
        TAG_CANDIDATES.iter().map(|&s| s.to_string()).collect()
    };

    let encodings = tokenizer
        .encode_batch(text_inputs.clone(), true)
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;

    let max_len = encodings
        .iter()
        .map(|e| e.get_ids().len())
        .max()
        .unwrap_or(0);

    let mut ids_data = Vec::new();
    let mut mask_data = Vec::new();
    for encoding in encodings {
        let mut ids = encoding
            .get_ids()
            .iter()
            .map(|&i| i as i64)
            .collect::<Vec<_>>();
        let mut mask = encoding
            .get_attention_mask()
            .iter()
            .map(|&m| m as i64)
            .collect::<Vec<_>>();
        ids.resize(max_len, 0);
        mask.resize(max_len, 0);
        ids_data.extend_from_slice(&ids);
        mask_data.extend_from_slice(&mask);
    }

    let ids_array = Array::from_shape_vec((text_inputs.len(), max_len), ids_data)?;
    let mask_array = Array::from_shape_vec((text_inputs.len(), max_len), mask_data)?;

    let image_input_dyn = image_input.into_dyn();
    let ids_array_dyn = ids_array.into_dyn();
    let mask_array_dyn = mask_array.into_dyn();

    let image_layout = image_input_dyn.as_standard_layout();
    let ids_layout = ids_array_dyn.as_standard_layout();
    let mask_layout = mask_array_dyn.as_standard_layout();

    let image_val = Tensor::from_array(image_layout.into_owned())?;
    let ids_val = Tensor::from_array(ids_layout.into_owned())?;
    let mask_val = Tensor::from_array(mask_layout.into_owned())?;

    let mut clip_session = clip_session_mutex.lock().unwrap();
    let outputs = crate::ai_processing::gpu_inference(
        clip_session.run(ort::inputs![ids_val, image_val, mask_val]),
    )?;

    let logits_dyn = outputs[0].try_extract_array::<f32>()?.to_owned();
    let logits = logits_dyn.into_dimensionality::<ndarray::Dim<[usize; 2]>>()?;
    let probs = softmax(&logits);

    let confidence_threshold = 0.005;
    let mut scored_tags: Vec<(String, f32)> = Vec::new();

    let prob_row = probs.row(0);
    for (i, &prob) in prob_row.iter().enumerate() {
        if prob > confidence_threshold {
            scored_tags.push((text_inputs[i].clone(), prob));
        }
    }

    scored_tags.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap());
    let initial_tags: Vec<String> = scored_tags
        .into_iter()
        .take(max_tags)
        .map(|(tag, _)| tag)
        .collect();

    let mut final_tags_set: HashSet<String> = initial_tags.iter().cloned().collect();

    if !is_custom {
        let color_tags = extract_color_tags(image);
        for color_tag in color_tags {
            final_tags_set.insert(color_tag);
        }

        for tag in &initial_tags {
            if let Some(parents) = TAG_HIERARCHY.get(tag.as_str()) {
                for &parent in parents {
                    final_tags_set.insert(parent.to_string());
                }
            }
        }
    }

    let final_tags = final_tags_set.into_iter().collect();

    Ok(final_tags)
}

#[tauri::command]
pub async fn start_background_indexing(
    folder_path: String,
    app_handle: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let job_id = state
        .indexing_generation
        .fetch_add(1, std::sync::atomic::Ordering::SeqCst)
        + 1;
    if let Some(handle) = state.indexing_task_handle.lock().unwrap().take() {
        println!("Cancelling previous indexing task.");
        handle.abort();
    }

    let _ = app_handle.emit(
        "indexing-started",
        serde_json::json!({ "jobId": job_id, "folderPath": folder_path }),
    );

    let settings = crate::load_settings(app_handle.clone()).map_err(|message| {
        let _ = app_handle.emit(
            "indexing-error",
            serde_json::json!({
                "jobId": job_id,
                "folderPath": folder_path,
                "error": message
            }),
        );
        message
    })?;
    if !settings.enable_ai_tagging.unwrap_or(false) {
        let _ = app_handle.emit(
            "indexing-finished",
            serde_json::json!({ "jobId": job_id, "folderPath": folder_path }),
        );
        return Ok(());
    }

    let max_concurrent_tasks = settings.tagging_thread_count.unwrap_or(3).max(1) as usize;
    let custom_ai_tags = settings.custom_ai_tags.clone();
    let ai_tag_count = settings.ai_tag_count.unwrap_or(10) as usize;

    let clip_models = crate::ai_processing::get_or_init_clip_models(
        &app_handle,
        &state.ai_state,
        &state.ai_init_lock,
    )
    .await
    .map_err(|error| {
        let message = error.to_string();
        let _ = app_handle.emit(
            "indexing-error",
            serde_json::json!({
                "jobId": job_id,
                "folderPath": folder_path,
                "error": message
            }),
        );
        message
    })?;

    if state
        .indexing_generation
        .load(std::sync::atomic::Ordering::SeqCst)
        != job_id
    {
        return Ok(());
    }

    let app_handle_clone = app_handle.clone();
    let indexed_folder_path = folder_path.clone();

    let task: JoinHandle<()> = tokio::spawn(async move {
        println!("Starting background indexing for: {}", folder_path);
        println!(
            "Using {} concurrent threads for AI tagging.",
            max_concurrent_tasks
        );

        let state_clone = app_handle_clone.state::<AppState>();
        let gpu_context =
            crate::gpu_processing::get_or_init_gpu_context(&state_clone, &app_handle).ok();

        let image_paths: Vec<PathBuf> = match fs::read_dir(&folder_path) {
            Ok(entries) => entries
                .filter_map(Result::ok)
                .map(|entry| entry.path())
                .filter(|path| {
                    path.is_file() && is_supported_image_file(path.to_string_lossy().as_ref())
                })
                .collect(),
            Err(e) => {
                eprintln!("Failed to read directory '{}': {}", folder_path, e);
                let _ = app_handle_clone.emit(
                    "indexing-error",
                    serde_json::json!({
                        "jobId": job_id,
                        "folderPath": indexed_folder_path,
                        "error": format!("Failed to read directory: {}", e)
                    }),
                );
                let app_state = app_handle_clone.state::<AppState>();
                if app_state
                    .indexing_generation
                    .load(std::sync::atomic::Ordering::SeqCst)
                    == job_id
                {
                    *app_state.indexing_task_handle.lock().unwrap() = None;
                }
                return;
            }
        };

        println!(
            "Found {} images to process in {}",
            image_paths.len(),
            folder_path
        );
        let total_images = image_paths.len();
        let processed_count = Arc::new(Mutex::new(0));
        let custom_ai_tags_shared = Arc::new(custom_ai_tags);

        stream::iter(image_paths)
            .for_each_concurrent(max_concurrent_tasks, |path| {
                let app_handle_inner = app_handle_clone.clone();
                let clip_models_inner = clip_models.clone();
                let gpu_context_inner = gpu_context.clone();
                let processed_count_inner = Arc::clone(&processed_count);
                let tags_inner = Arc::clone(&custom_ai_tags_shared);
                let indexed_folder_path_inner = indexed_folder_path.clone();

                async move {
                    if app_handle_inner
                        .state::<AppState>()
                        .indexing_generation
                        .load(std::sync::atomic::Ordering::Relaxed)
                        != job_id
                    {
                        return;
                    }
                    let path_str = path.to_string_lossy().to_string();
                    let (_, sidecar_path) = parse_virtual_path(&path_str);

                    // AI tagging is background work. Yield while the Library
                    // has visible thumbnail work so navigation gets the next
                    // available CPU/GPU and filesystem capacity.
                    loop {
                        let has_foreground_thumbnails = {
                            let app_state = app_handle_inner.state::<AppState>();
                            !app_state.thumbnail_manager.queue.lock().unwrap().is_empty()
                        };
                        if !has_foreground_thumbnails {
                            break;
                        }
                        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
                    }

                    let mut metadata = crate::exif_processing::load_sidecar(&sidecar_path);

                    let should_generate_tags = match &metadata.tags {
                        None => true,
                        Some(tags) => !tags.iter().any(|tag| is_ai_tag(tag)),
                    };

                    if should_generate_tags {
                        // AI analysis must not populate the thumbnail cache.
                        // Cache generation belongs to visible requests and
                        // explicit folder refreshes only.
                        let analysis_image = file_management::get_cached_thumbnail_image(
                            &path_str,
                            &app_handle_inner,
                        )
                        .map(Ok)
                        .unwrap_or_else(|| {
                            file_management::generate_thumbnail_data(
                                &path_str,
                                gpu_context_inner.as_ref(),
                                None,
                                &app_handle_inner,
                            )
                        });
                        match analysis_image {
                            Ok(image) => {
                                if let Ok(ai_tags) = generate_tags_with_clip(
                                    &image,
                                    &clip_models_inner.model,
                                    &clip_models_inner.tokenizer,
                                    (*tags_inner).clone(),
                                    ai_tag_count,
                                ) {
                                    let mut existing_tags: HashSet<String> =
                                        metadata.tags.unwrap_or_default().into_iter().collect();

                                    for tag in ai_tags {
                                        existing_tags.insert(tag);
                                    }

                                    let mut final_tags: Vec<String> =
                                        existing_tags.into_iter().collect();
                                    final_tags.sort_unstable();

                                    metadata.tags = Some(final_tags);

                                    if let Ok(json_string) = serde_json::to_string_pretty(&metadata)
                                    {
                                        let _ = fs::write(sidecar_path, json_string);
                                    }
                                }
                            }
                            Err(e) => {
                                eprintln!(
                                    "Could not get or generate image for tagging {}: {}",
                                    path_str, e
                                );
                            }
                        }
                    }

                    let mut count = processed_count_inner.lock().unwrap();
                    *count += 1;
                    let _ = app_handle_inner.emit(
                        "indexing-progress",
                        serde_json::json!({
                            "jobId": job_id,
                            "folderPath": indexed_folder_path_inner,
                            "current": *count,
                            "total": total_images
                        }),
                    );
                }
            })
            .await;

        println!("Background indexing finished for: {}", folder_path);
        let _ = app_handle_clone.emit(
            "indexing-finished",
            serde_json::json!({ "jobId": job_id, "folderPath": indexed_folder_path }),
        );

        let app_state = app_handle_clone.state::<AppState>();
        if app_state
            .indexing_generation
            .load(std::sync::atomic::Ordering::SeqCst)
            == job_id
        {
            *app_state.indexing_task_handle.lock().unwrap() = None;
        }
    });

    *state.indexing_task_handle.lock().unwrap() = Some(task);

    Ok(())
}

fn modify_tags_for_path(
    path_str: &str,
    modify_fn: impl Fn(&mut Vec<String>),
) -> Result<ImageMetadata, String> {
    let (_, sidecar_path) = parse_virtual_path(path_str);

    let mut metadata = crate::exif_processing::load_sidecar(&sidecar_path);

    let mut tags = metadata.tags.take().unwrap_or_default();
    modify_fn(&mut tags);

    tags.sort_unstable();
    tags.dedup();

    if !tags.is_empty() {
        metadata.tags = Some(tags);
    }

    let json_string = serde_json::to_string_pretty(&metadata).map_err(|e| e.to_string())?;
    fs::write(sidecar_path, json_string).map_err(|e| e.to_string())?;
    Ok(metadata)
}

/// Changes the tags of every path and synchronizes physical images to XMP.
fn modify_tags_for_paths(
    paths: &[String],
    app_handle: AppHandle,
    modify_fn: impl Fn(&mut Vec<String>) + Sync,
) -> Result<(), String> {
    let settings = crate::app_settings::load_settings(app_handle).unwrap_or_default();
    let enable_xmp_sync = settings.enable_xmp_sync.unwrap_or(false);
    let create_xmp_if_missing = settings.create_xmp_if_missing.unwrap_or(false);

    paths
        .par_iter()
        .try_for_each(|path| -> Result<(), String> {
            let metadata = modify_tags_for_path(path, &modify_fn)?;

            if enable_xmp_sync && !path.contains("?vc=") {
                let (source_path, _) = parse_virtual_path(path);
                file_management::sync_metadata_to_xmp(
                    &source_path,
                    &metadata,
                    create_xmp_if_missing,
                    true,
                );
            }
            Ok(())
        })
        .map_err(|error| {
            eprintln!("{error}");
            error
        })
}

#[tauri::command]
pub fn add_tag_for_paths(
    paths: Vec<String>,
    tag: String,
    app_handle: AppHandle,
) -> Result<(), String> {
    modify_tags_for_paths(&paths, app_handle, |tags| {
        if !tags.contains(&tag) {
            tags.push(tag.clone());
        }
    })
}

#[tauri::command]
pub fn remove_tag_for_paths(
    paths: Vec<String>,
    tag: String,
    app_handle: AppHandle,
) -> Result<(), String> {
    modify_tags_for_paths(&paths, app_handle, |tags| tags.retain(|t| t != &tag))
}

#[tauri::command]
pub fn set_flag_for_paths(
    paths: Vec<String>,
    flag: String,
    app_handle: AppHandle,
) -> Result<(), String> {
    if !matches!(
        flag.as_str(),
        "rejected" | "selected" | "deferred" | "unflagged"
    ) {
        return Err(format!("Unsupported image flag: {flag}"));
    }

    modify_tags_for_paths(&paths, app_handle, |tags| apply_flag_to_tags(tags, &flag))
}

#[cfg(test)]
mod flag_tests {
    use super::apply_flag_to_tags;

    #[test]
    fn replacing_and_clearing_flags_preserves_other_tags() {
        let mut tags = vec![
            "color:red".to_string(),
            "user:portrait".to_string(),
            "flag:rejected".to_string(),
        ];

        apply_flag_to_tags(&mut tags, "selected");
        assert_eq!(tags, ["color:red", "user:portrait", "flag:selected"]);

        apply_flag_to_tags(&mut tags, "unflagged");
        assert_eq!(tags, ["color:red", "user:portrait"]);
    }
}

#[cfg(test)]
mod keyword_tests {
    use super::*;

    fn strings(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| value.to_string()).collect()
    }

    #[test]
    fn keyword_paths_are_written_as_lightroom_keyword_bags() {
        let keywords = XmpKeywords::from_tags(&strings(&[
            "sky",
            "user:places|germany|berlin",
            "user:places|germany|munich",
            "user:dog",
        ]));
        assert_eq!(
            keywords.hierarchical,
            strings(&["places|germany|berlin", "places|germany|munich", "dog"])
        );
        assert_eq!(
            keywords.subject,
            strings(&["sky", "places", "germany", "berlin", "munich", "dog"])
        );
        assert_eq!(keywords.ai, strings(&["sky"]));
    }

    #[test]
    fn written_keywords_read_back_unchanged() {
        let tags = strings(&["sky", "user:places|germany|berlin", "user:sky", "user:R&D"]);
        let keywords = XmpKeywords::from_tags(&tags);
        let origin = XmpKeywordOrigin::ThisIsRaw {
            ai_keywords: keywords.ai.clone(),
        };
        let mut read = tags_from_xmp_keywords(&keywords.subject, &keywords.hierarchical, &origin);
        read.sort();
        let mut expected = tags;
        expected.sort();
        assert_eq!(read, expected);
    }

    #[test]
    fn lightroom_keywords_are_user_keywords() {
        let subject = strings(&["Berlin", "Germany", "Places", "sunset"]);
        let hierarchical = strings(&["Places|Germany|Berlin", " | ", "sunset"]);
        assert_eq!(
            tags_from_xmp_keywords(&subject, &hierarchical, &XmpKeywordOrigin::Other),
            strings(&["user:Places|Germany|Berlin", "user:sunset"])
        );
        assert_eq!(
            tags_from_xmp_keywords(&subject, &[], &XmpKeywordOrigin::Other),
            strings(&["user:Berlin", "user:Germany", "user:Places", "user:sunset"])
        );
    }

    #[test]
    fn earlier_this_is_raw_keywords_keep_their_meaning() {
        let subject = strings(&["sky", "user:portrait"]);
        assert_eq!(
            tags_from_xmp_keywords(&subject, &[], &XmpKeywordOrigin::LegacyThisIsRaw),
            subject
        );
    }

    #[test]
    fn merging_replaces_keywords_earlier_imported_as_ai_tags() {
        let subject = strings(&["Berlin", "Germany", "sky"]);
        let hierarchical = strings(&["Germany|Berlin"]);
        let origin = XmpKeywordOrigin::ThisIsRaw {
            ai_keywords: strings(&["sky"]),
        };
        let xmp_tags = tags_from_xmp_keywords(&subject, &hierarchical, &origin);

        let mut tags = strings(&["Berlin", "Germany", "sky", "tree", "color:red"]);
        merge_xmp_keyword_tags(&mut tags, &subject, &xmp_tags);
        assert_eq!(
            tags,
            strings(&["sky", "tree", "color:red", "user:Germany|Berlin"])
        );
    }

    #[test]
    fn only_unprefixed_tags_are_ai_tags() {
        assert!(is_ai_tag("sky"));
        assert!(!is_ai_tag("user:sky"));
        assert!(!is_ai_tag("flag:selected"));
        assert!(!is_ai_tag("color:red"));
    }
}

#[tauri::command]
pub fn clear_ai_tags(root_path: String) -> Result<usize, String> {
    if !Path::new(&root_path).exists() {
        return Err(format!("Root path does not exist: {}", root_path));
    }

    let mut updated_count = 0;
    let walker = WalkDir::new(root_path).into_iter();

    for entry in walker.filter_map(|e| e.ok()) {
        let path = entry.path();
        if path.is_file()
            && path.extension().and_then(|s| s.to_str()) == Some("tirdata")
            && let Ok(content) = fs::read_to_string(path)
            && let Ok(mut metadata) = serde_json::from_str::<ImageMetadata>(&content)
            && let Some(tags) = &mut metadata.tags
        {
            let original_len = tags.len();
            tags.retain(|tag| !is_ai_tag(tag));

            if tags.len() < original_len {
                if tags.is_empty() {
                    metadata.tags = None;
                }
                if let Ok(json_string) = serde_json::to_string_pretty(&metadata)
                    && fs::write(path, json_string).is_ok()
                {
                    updated_count += 1;
                }
            }
        }
    }
    Ok(updated_count)
}

#[tauri::command]
pub fn clear_all_tags(root_path: String) -> Result<usize, String> {
    if !Path::new(&root_path).exists() {
        return Err(format!("Root path does not exist: {}", root_path));
    }

    let mut updated_count = 0;
    let walker = WalkDir::new(root_path).into_iter();

    for entry in walker.filter_map(|e| e.ok()) {
        let path = entry.path();
        if path.is_file()
            && path.extension().and_then(|s| s.to_str()) == Some("tirdata")
            && let Ok(content) = fs::read_to_string(path)
            && let Ok(mut metadata) = serde_json::from_str::<ImageMetadata>(&content)
            && let Some(tags) = &mut metadata.tags
        {
            let original_len = tags.len();
            // Flags and color labels are independent of the editable tag list.
            tags.retain(|tag| {
                tag.starts_with(COLOR_TAG_PREFIX) || tag.starts_with(FLAG_TAG_PREFIX)
            });

            if tags.len() < original_len {
                if tags.is_empty() {
                    metadata.tags = None;
                }
                if let Ok(json_string) = serde_json::to_string_pretty(&metadata)
                    && fs::write(path, json_string).is_ok()
                {
                    updated_count += 1;
                }
            }
        }
    }
    Ok(updated_count)
}
