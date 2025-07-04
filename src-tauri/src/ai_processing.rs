use std::fs;
use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use anyhow::Result;
use image::{DynamicImage, GenericImageView, GrayImage};
use image::imageops::{self, FilterType};
use ndarray::{Array, IxDyn};
use ort::{Environment, Session, SessionBuilder, Value};
use serde::{Deserialize, Serialize};
use tauri::Manager;
use tauri::Emitter;

const ENCODER_URL: &str = "https://huggingface.co/CyberTimon/RapidRAW-Models/resolve/main/vit_t_encoder.onnx?download=true";
const DECODER_URL: &str = "https://huggingface.co/CyberTimon/RapidRAW-Models/resolve/main/vit_t_decoder.onnx?download=true";
const ENCODER_FILENAME: &str = "vit_t_encoder.onnx";
const DECODER_FILENAME: &str = "vit_t_decoder.onnx";
const SAM_INPUT_SIZE: u32 = 1024;

const U2NETP_URL: &str = "https://huggingface.co/CyberTimon/RapidRAW-Models/resolve/main/u2net.onnx?download=true";
const U2NETP_FILENAME: &str = "u2net.onnx";
const U2NETP_INPUT_SIZE: u32 = 320;

pub struct AiModels {
    pub sam_encoder: Session,
    pub sam_decoder: Session,
    pub u2netp: Session,
}

#[derive(Clone)]
pub struct ImageEmbeddings {
    pub path_hash: String,
    pub embeddings: Array<f32, IxDyn>,
    pub original_size: (u32, u32),
}

pub struct AiState {
    pub models: Arc<AiModels>,
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

pub async fn get_or_init_ai_models(app_handle: &tauri::AppHandle) -> Result<Arc<AiModels>> {
    let models_dir = get_models_dir(app_handle)?;
    let encoder_path = models_dir.join(ENCODER_FILENAME);
    let decoder_path = models_dir.join(DECODER_FILENAME);
    let u2netp_path = models_dir.join(U2NETP_FILENAME);

    if !encoder_path.exists() {
        let _ = app_handle.emit("ai-model-download-start", "SAM Encoder");
        download_model(ENCODER_URL, &encoder_path).await?;
        let _ = app_handle.emit("ai-model-download-finish", "SAM Encoder");
    }
    if !decoder_path.exists() {
        let _ = app_handle.emit("ai-model-download-start", "SAM Decoder");
        download_model(DECODER_URL, &decoder_path).await?;
        let _ = app_handle.emit("ai-model-download-finish", "SAM Decoder");
    }
    if !u2netp_path.exists() {
        let _ = app_handle.emit("ai-model-download-start", "Foreground Model");
        download_model(U2NETP_URL, &u2netp_path).await?;
        let _ = app_handle.emit("ai-model-download-finish", "Foreground Model");
    }

    let environment = Arc::new(Environment::builder().with_name("AI").build()?);
    let sam_encoder = SessionBuilder::new(&environment)?.with_model_from_file(encoder_path)?;
    let sam_decoder = SessionBuilder::new(&environment)?.with_model_from_file(decoder_path)?;
    let u2netp = SessionBuilder::new(&environment)?.with_model_from_file(u2netp_path)?;

    Ok(Arc::new(AiModels { sam_encoder, sam_decoder, u2netp }))
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

pub fn run_u2netp_model(
    image: &DynamicImage,
    u2netp_session: &Session,
) -> Result<GrayImage> {
    let (orig_width, orig_height) = image.dimensions();

    let resized_image = image.resize(U2NETP_INPUT_SIZE, U2NETP_INPUT_SIZE, FilterType::Triangle);
    let (resized_w, resized_h) = resized_image.dimensions();
    let resized_rgb = resized_image.to_rgb8();

    let mut square_input_image = image::RgbImage::new(U2NETP_INPUT_SIZE, U2NETP_INPUT_SIZE);
    let paste_x = (U2NETP_INPUT_SIZE - resized_w) / 2;
    let paste_y = (U2NETP_INPUT_SIZE - resized_h) / 2;
    imageops::overlay(&mut square_input_image, &resized_rgb, paste_x.into(), paste_y.into());

    let mut input_tensor: Array<f32, _> = Array::zeros((1, 3, U2NETP_INPUT_SIZE as usize, U2NETP_INPUT_SIZE as usize));
    let mean = [0.485, 0.456, 0.406];
    let std = [0.229, 0.224, 0.225];

    for y in 0..U2NETP_INPUT_SIZE {
        for x in 0..U2NETP_INPUT_SIZE {
            let pixel = square_input_image.get_pixel(x, y);
            input_tensor[[0, 0, y as usize, x as usize]] = (pixel[0] as f32 / 255.0 - mean[0]) / std[0];
            input_tensor[[0, 1, y as usize, x as usize]] = (pixel[1] as f32 / 255.0 - mean[1]) / std[1];
            input_tensor[[0, 2, y as usize, x as usize]] = (pixel[2] as f32 / 255.0 - mean[2]) / std[2];
        }
    }
    
    let input_tensor_dyn = input_tensor.into_dyn();
    let input_values = input_tensor_dyn.as_standard_layout();
    let inputs = vec![Value::from_array(u2netp_session.allocator(), &input_values)?];

    let outputs = u2netp_session.run(inputs)?;
    let output_tensor = outputs[0].try_extract::<f32>()?.view().to_owned();

    let (min_val, max_val) = output_tensor.iter().fold((f32::MAX, f32::MIN), |(min, max), &v| (min.min(v), max.max(v)));
    let range = max_val - min_val;

    let mask_data: Vec<u8> = output_tensor
        .iter()
        .map(|&val| {
            if range > 1e-6 {
                (((val - min_val) / range) * 255.0) as u8
            } else {
                0
            }
        })
        .collect();

    let square_mask = GrayImage::from_raw(U2NETP_INPUT_SIZE, U2NETP_INPUT_SIZE, mask_data)
        .ok_or_else(|| anyhow::anyhow!("Failed to create mask from U-2-Netp output"))?;

    let cropped_mask = imageops::crop_imm(
        &square_mask,
        paste_x,
        paste_y,
        resized_w,
        resized_h,
    ).to_image();

    let final_mask = imageops::resize(&cropped_mask, orig_width, orig_height, FilterType::Triangle);

    Ok(final_mask)
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
    #[serde(default)]
    pub flip_horizontal: Option<bool>,
    #[serde(default)]
    pub flip_vertical: Option<bool>,
}

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct AiForegroundMaskParameters {
    #[serde(default)]
    pub mask_data_base64: Option<String>,
    #[serde(default)]
    pub rotation: Option<f32>,
    #[serde(default)]
    pub flip_horizontal: Option<bool>,
    #[serde(default)]
    pub flip_vertical: Option<bool>,
}