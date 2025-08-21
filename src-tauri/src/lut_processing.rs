use anyhow::{anyhow, Result};
use image::{DynamicImage, GenericImageView};
use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::Path;

#[derive(Debug)]
pub struct Lut {
    pub size: u32,
    pub data: Vec<f32>,
}

fn parse_cube(path: &Path) -> Result<Lut> {
    let file = File::open(path)?;
    let reader = BufReader::new(file);

    let mut size: Option<u32> = None;
    let mut data: Vec<f32> = Vec::new();

    for line in reader.lines() {
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
            "TITLE" => continue,
            "LUT_3D_SIZE" => {
                if parts.len() > 1 {
                    size = Some(parts[1].parse()?);
                }
            }
            _ => {
                if size.is_some() {
                    let r: f32 = parts.get(0).ok_or(anyhow!("Missing R value"))?.parse()?;
                    let g: f32 = parts.get(1).ok_or(anyhow!("Missing G value"))?.parse()?;
                    let b: f32 = parts.get(2).ok_or(anyhow!("Missing B value"))?.parse()?;
                    data.push(r);
                    data.push(g);
                    data.push(b);
                }
            }
        }
    }

    let lut_size = size.ok_or(anyhow!("LUT_3D_SIZE not found in .cube file"))?;
    if data.len() != (lut_size * lut_size * lut_size * 3) as usize {
        return Err(anyhow!(
            "LUT data size mismatch. Expected {}, found {}",
            lut_size * lut_size * lut_size * 3,
            data.len()
        ));
    }

    Ok(Lut { size: lut_size, data })
}

fn parse_3dl(path: &Path) -> Result<Lut> {
    let file = File::open(path)?;
    let reader = BufReader::new(file);
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
        return Err(anyhow!("Invalid 3DL LUT data size"));
    }

    Ok(Lut { size, data })
}

fn parse_hald(image: DynamicImage) -> Result<Lut> {
    let (width, height) = image.dimensions();
    if width != height {
        return Err(anyhow!("HALD image must be square"));
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

pub fn parse_lut_file(path_str: &str) -> Result<Lut> {
    let path = Path::new(path_str);
    let extension = path.extension().and_then(|s| s.to_str()).unwrap_or("").to_lowercase();

    match extension.as_str() {
        "cube" => parse_cube(path),
        "3dl" => parse_3dl(path),
        "png" | "jpg" | "jpeg" | "tiff" => {
            let img = image::open(path)?;
            parse_hald(img)
        }
        _ => Err(anyhow!("Unsupported LUT file format: {}", extension)),
    }
}