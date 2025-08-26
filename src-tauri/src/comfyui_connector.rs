use anyhow::{anyhow, Result};
use futures_util::StreamExt;
use image::{DynamicImage, ImageFormat};
use reqwest::multipart;
use serde_json::{json, Value};
use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::fs;
use tokio_tungstenite::{connect_async, tungstenite::protocol::Message};
use uuid::Uuid;

use crate::file_management::ComfyUIWorkflowConfig;

const WORKFLOWS_DIR: &str = "./workflows";

async fn upload_image(address: &str, image: DynamicImage, form_name: &str) -> Result<String> {
    let mut image_bytes = Cursor::new(Vec::new());
    image.write_to(&mut image_bytes, ImageFormat::Png)?;
    
    let part = multipart::Part::bytes(image_bytes.into_inner())
        .file_name(format!("{}.png", Uuid::new_v4()))
        .mime_str("image/png")?;

    let form = multipart::Form::new()
        .part(form_name.to_string(), part)
        .text("overwrite", "true");

    let client = reqwest::Client::new();
    let response = client
        .post(format!("http://{}/upload/image", address))
        .multipart(form)
        .send()
        .await?;

    if !response.status().is_success() {
        let status = response.status();
        let error_text = response.text().await.unwrap_or_else(|_| "Could not read error body".to_string());
        return Err(anyhow!("ComfyUI upload failed with status {}: {}", status, error_text));
    }

    let response_json = response.json::<Value>().await
        .map_err(|e| anyhow!("Failed to decode ComfyUI upload response as JSON: {}", e))?;

    response_json.get("name")
        .and_then(Value::as_str)
        .map(String::from)
        .ok_or_else(|| anyhow!("Failed to get filename from ComfyUI upload response. Full response: {}", response_json))
}

async fn queue_prompt(address: &str, prompt: Value, client_id: &str) -> Result<String> {
    let payload = json!({
        "prompt": prompt,
        "client_id": client_id,
    });

    let client = reqwest::Client::new();
    let response = client
        .post(format!("http://{}/prompt", address))
        .json(&payload)
        .send()
        .await?;

    if !response.status().is_success() {
        let status = response.status();
        let error_text = response.text().await.unwrap_or_else(|_| "Could not read error body".to_string());
        return Err(anyhow!("ComfyUI queue_prompt failed with status {}: {}", status, error_text));
    }

    let response_json = response.json::<Value>().await
        .map_err(|e| anyhow!("Failed to decode ComfyUI prompt response as JSON: {}", e))?;

    response_json.get("prompt_id")
        .and_then(Value::as_str)
        .map(String::from)
        .ok_or_else(|| anyhow!("Failed to get prompt_id from ComfyUI. Full response: {}", response_json))
}

async fn get_history(address: &str, prompt_id: &str) -> Result<Value> {
    let url = format!("http://{}/history/{}", address, prompt_id);
    let response = reqwest::get(&url).await?;

    if !response.status().is_success() {
        let status = response.status();
        let error_text = response.text().await.unwrap_or_else(|_| "Could not read error body".to_string());
        return Err(anyhow!("ComfyUI get_history failed with status {}: {}", status, error_text));
    }

    Ok(response.json::<Value>().await?)
}

async fn get_image(address: &str, filename: &str, subfolder: &str, folder_type: &str) -> Result<Vec<u8>> {
    let client = reqwest::Client::new();
    let response = client.get(format!("http://{}/view", address))
        .query(&[
            ("filename", filename),
            ("subfolder", subfolder),
            ("type", folder_type)
        ])
        .send()
        .await?;

    if !response.status().is_success() {
        let status = response.status();
        let error_text = response.text().await.unwrap_or_else(|_| "Could not read error body".to_string());
        return Err(anyhow!("ComfyUI get_image failed with status {}: {}", status, error_text));
    }

    Ok(response.bytes().await?.to_vec())
}

pub async fn ping_server(address: &str) -> Result<()> {
    reqwest::get(format!("http://{}", address)).await?.error_for_status()?;
    Ok(())
}

pub async fn execute_workflow(
    address: &str,
    config: &ComfyUIWorkflowConfig,
    source_image: DynamicImage,
    mask_image: Option<DynamicImage>,
    text_prompt: Option<String>,
) -> Result<Vec<u8>> {
    let workflow_path = config.workflow_path.as_ref().map(PathBuf::from).unwrap_or_else(|| {
        Path::new(WORKFLOWS_DIR).join("generative_replace.json")
    });

    let workflow_str = fs::read_to_string(&workflow_path)
        .map_err(|e| anyhow!("Failed to read workflow file at {:?}: {}", workflow_path, e))?;
    let mut workflow: Value = serde_json::from_str(&workflow_str)?;

    for (node_id, ckpt_name) in &config.model_checkpoints {
        if let Some(node) = workflow.get_mut(node_id) {
            if let Some(inputs) = node.get_mut("inputs") {
                inputs["ckpt_name"] = json!(ckpt_name);
            }
        }
    }

    for (node_id, vae_name) in &config.vae_loaders {
        if let Some(node) = workflow.get_mut(node_id) {
            if let Some(inputs) = node.get_mut("inputs") {
                inputs["vae_name"] = json!(vae_name);
            }
        }
    }

    for (node_id, controlnet_name) in &config.controlnet_loaders {
        if let Some(node) = workflow.get_mut(node_id) {
            if let Some(inputs) = node.get_mut("inputs") {
                inputs["control_net_name"] = json!(controlnet_name);
            }
        }
    }

    if let Some(node) = workflow.get_mut(&config.sampler_node_id) {
        if let Some(inputs) = node.get_mut("inputs") {
            inputs["steps"] = json!(config.sampler_steps);
        }
    }

    let source_filename = upload_image(address, source_image, "image").await?;
    if let Some(node) = workflow.get_mut(&config.source_image_node_id) {
        node["inputs"]["image"] = json!(source_filename);
    } else {
        return Err(anyhow!("Source image node ID '{}' not found in workflow.", config.source_image_node_id));
    }

    if let Some(mask) = mask_image {
        let mask_filename = upload_image(address, mask, "image").await?;
        if let Some(node) = workflow.get_mut(&config.mask_image_node_id) {
            node["inputs"]["image"] = json!(mask_filename);
        } else {
            return Err(anyhow!("Mask image node ID '{}' not found in workflow.", config.mask_image_node_id));
        }
    }

    if let Some(prompt_text) = text_prompt {
        if let Some(node) = workflow.get_mut(&config.text_prompt_node_id) {
            if let Some(node_inputs) = node.get_mut("inputs") {
                node_inputs["text"] = json!(prompt_text);
            }
        } else {
            return Err(anyhow!("Text prompt node ID '{}' not found in workflow.", config.text_prompt_node_id));
        }
    }

    let client_id = Uuid::new_v4().to_string();
    let ws_url = format!("ws://{}/ws?clientId={}", address, client_id);
    let (ws_stream, _) = connect_async(&ws_url).await.map_err(|e| anyhow!("Failed to connect to WebSocket at {}: {}", ws_url, e))?;
    let (_write, mut read) = ws_stream.split();

    let prompt_id = queue_prompt(address, workflow, &client_id).await?;

    loop {
        match read.next().await {
            Some(Ok(msg)) => {
                if let Message::Text(text) = msg {
                    if let Ok(v) = serde_json::from_str::<Value>(&text) {
                        if v["type"] == "executing" && v["data"]["node"].is_null() && v["data"]["prompt_id"] == prompt_id {
                            break;
                        }
                    }
                }
            }
            Some(Err(e)) => return Err(anyhow!("WebSocket error: {}", e)),
            None => return Err(anyhow!("WebSocket stream ended unexpectedly")),
        }
    }

    let history = get_history(address, &prompt_id).await?;
    let outputs = history.get(&prompt_id)
        .and_then(|h| h.get("outputs"))
        .ok_or_else(|| anyhow!("Could not find outputs for prompt_id {} in history", prompt_id))?;
    
    let images = outputs.get(&config.final_output_node_id)
        .and_then(|n| n.get("images"))
        .and_then(|i| i.as_array())
        .ok_or_else(|| anyhow!("No 'images' array found in specified output node '{}'", config.final_output_node_id))?;
    
    if images.is_empty() {
        return Err(anyhow!("Output node '{}' produced no images", config.final_output_node_id));
    }

    let first_image_info = &images[0];
    let final_filename = first_image_info.get("filename").and_then(|f| f.as_str()).ok_or_else(|| anyhow!("Could not get filename from output"))?;
    let subfolder = first_image_info.get("subfolder").and_then(|s| s.as_str()).unwrap_or("");
    let folder_type = first_image_info.get("type").and_then(|t| t.as_str()).ok_or_else(|| anyhow!("Could not get type from output"))?;

    get_image(address, final_filename, subfolder, folder_type).await
}