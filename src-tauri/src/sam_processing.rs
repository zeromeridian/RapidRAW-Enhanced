use std::fs;
use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use anyhow::Result;
use image::{DynamicImage, GenericImageView, GrayImage};
use image::imageops::FilterType;
use ndarray::{Array, IxDyn};
use ort::{Environment, Session, SessionBuilder, Value};
use serde::{Deserialize, Serialize};
use tauri::Manager;
use tauri::Emitter;

const ENCODER_URL: &str = "https://github.com/AndreyGermanov/sam_onnx_rust/blob/main/vit_t_encoder.onnx?raw=true";
const DECODER_URL: &str = "https://github.com/AndreyGermanov/sam_onnx_rust/blob/main/vit_t_decoder.onnx?raw=true";
const ENCODER_FILENAME: &str = "vit_t_encoder.onnx";
const DECODER_FILENAME: &str = "vit_t_decoder.onnx";
const SAM_INPUT_SIZE: u32 = 1024;

pub struct SamModels {
    pub encoder: Session,
    pub decoder: Session,
}

#[derive(Clone)]
pub struct ImageEmbeddings {
    pub path_hash: String,
    pub embeddings: Array<f32, IxDyn>,
    pub original_size: (u32, u32),
}

pub struct SamState {
    pub models: Arc<SamModels>,
    pub embeddings: Option<ImageEmbeddings>,
}

fn get_models_dir(app_handle: &tauri::AppHandle) -> Result<PathBuf> {
    let models_dir = app_handle
        .path()
        .app_data_dir()?
        .join("models");
    if !models_dir.exists() {
        fs::create_dir_all(&models_dir)?;
    }
    Ok(models_dir)
}

async fn download_model(url: &str, dest: &Path) -> Result<()> {
    let response = reqwest::get(url).await?;
    let mut file = fs::File::create(dest)?;
    let mut content = Cursor::new(response.bytes().await?);
    std::io::copy(&mut content, &mut file)?;
    Ok(())
}

pub async fn get_or_init_sam_models(app_handle: &tauri::AppHandle) -> Result<Arc<SamModels>> {
    let models_dir = get_models_dir(app_handle)?;
    let encoder_path = models_dir.join(ENCODER_FILENAME);
    let decoder_path = models_dir.join(DECODER_FILENAME);

    if !encoder_path.exists() {
        let _ = app_handle.emit("sam-model-download-start", "encoder");
        download_model(ENCODER_URL, &encoder_path).await?;
        let _ = app_handle.emit("sam-model-download-finish", "encoder");
    }
    if !decoder_path.exists() {
        let _ = app_handle.emit("sam-model-download-start", "decoder");
        download_model(DECODER_URL, &decoder_path).await?;
        let _ = app_handle.emit("sam-model-download-finish", "decoder");
    }

    let environment = Arc::new(Environment::builder().with_name("SAM").build()?);
    let encoder = SessionBuilder::new(&environment)?.with_model_from_file(encoder_path)?;
    let decoder = SessionBuilder::new(&environment)?.with_model_from_file(decoder_path)?;

    Ok(Arc::new(SamModels { encoder, decoder }))
}

pub fn generate_image_embeddings(
    image: &DynamicImage,
    encoder: &Session,
) -> Result<ImageEmbeddings> {
    let (orig_width, orig_height) = image.dimensions();

    let long_side = orig_width.max(orig_height) as f32;
    let scale = SAM_INPUT_SIZE as f32 / long_side;
    let new_width = (orig_width as f32 * scale).round() as u32;
    let new_height = (orig_height as f32 * scale).round() as u32;

    let resized_image = image.resize(new_width, new_height, FilterType::Triangle);

    let mut input_tensor: Array<f32, _> = Array::zeros((1, 3, SAM_INPUT_SIZE as usize, SAM_INPUT_SIZE as usize));
    let mean = [123.675, 116.28, 103.53];
    let std = [58.395, 57.12, 57.375];

    for (x, y, pixel) in resized_image.to_rgb8().enumerate_pixels() {
        input_tensor[[0, 0, y as usize, x as usize]] = (pixel[0] as f32 - mean[0]) / std[0];
        input_tensor[[0, 1, y as usize, x as usize]] = (pixel[1] as f32 - mean[1]) / std[1];
        input_tensor[[0, 2, y as usize, x as usize]] = (pixel[2] as f32 - mean[2]) / std[2];
    }

    let input_tensor_dyn = input_tensor.into_dyn();

    let input_values = input_tensor_dyn.as_standard_layout();
    let inputs = vec![Value::from_array(encoder.allocator(), &input_values)?];
    
    let outputs = encoder.run(inputs)?;
    let embeddings = outputs[0].try_extract::<f32>()?.view().to_owned();

    Ok(ImageEmbeddings {
        path_hash: "".to_string(),
        embeddings: embeddings.into_dyn(),
        original_size: (orig_width, orig_height),
    })
}

pub fn run_sam_decoder(
    decoder: &Session,
    embeddings: &ImageEmbeddings,
    start_point: (f64, f64),
    end_point: (f64, f64),
) -> Result<GrayImage> {
    let (orig_width, orig_height) = embeddings.original_size;

    let long_side = orig_width.max(orig_height) as f64;
    let scale = SAM_INPUT_SIZE as f64 / long_side;

    let x1 = start_point.0.min(end_point.0) * scale;
    let y1 = start_point.1.min(end_point.1) * scale;
    let x2 = start_point.0.max(end_point.0) * scale;
    let y2 = start_point.1.max(end_point.1) * scale;

    let point_coords = Array::from_shape_vec((1, 2, 2), vec![x1 as f32, y1 as f32, x2 as f32, y2 as f32])?.into_dyn();
    let point_labels = Array::from_shape_vec((1, 2), vec![2.0f32, 3.0f32])?.into_dyn();
    
    let mask_input: Array<f32, IxDyn> = Array::zeros((1, 1, 256, 256)).into_dyn();
    let has_mask_input = Array::from_elem((1,), 0.0f32).into_dyn();
    let orig_im_size = Array::from_shape_vec((2,), vec![orig_height as f32, orig_width as f32])?.into_dyn();

    let embeddings_values = embeddings.embeddings.as_standard_layout();
    let point_coords_values = point_coords.as_standard_layout();
    let point_labels_values = point_labels.as_standard_layout();
    let mask_input_values = mask_input.as_standard_layout();
    let has_mask_input_values = has_mask_input.as_standard_layout();
    let orig_im_size_values = orig_im_size.as_standard_layout();

    let inputs = vec![
        Value::from_array(decoder.allocator(), &embeddings_values)?,
        Value::from_array(decoder.allocator(), &point_coords_values)?,
        Value::from_array(decoder.allocator(), &point_labels_values)?,
        Value::from_array(decoder.allocator(), &mask_input_values)?,
        Value::from_array(decoder.allocator(), &has_mask_input_values)?,
        Value::from_array(decoder.allocator(), &orig_im_size_values)?,
    ];

    let outputs = decoder.run(inputs)?;
    let mask_tensor = outputs[0].try_extract::<f32>()?.view().to_owned();
    
    let mask_dims = mask_tensor.shape();
    let mask_height = mask_dims[2];
    let mask_width = mask_dims[3];

    let mask_data: Vec<u8> = mask_tensor
        .iter()
        .map(|&val| if val > 0.0 { 255 } else { 0 })
        .collect();

    let gray_mask = GrayImage::from_raw(mask_width as u32, mask_height as u32, mask_data)
        .ok_or_else(|| anyhow::anyhow!("Failed to create mask image from raw data"))?;

    let feathered_mask = image::imageops::blur(&gray_mask, 3.0);
    
    Ok(feathered_mask)
}

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct AiSubjectMaskParameters {
    pub start_x: f64,
    pub start_y: f64,
    pub end_x: f64,
    pub end_y: f64,
    #[serde(default)]
    pub mask_data_base64: Option<String>,
    #[serde(default)]
    pub rotation: Option<f32>,
}