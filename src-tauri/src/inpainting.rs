use image::{RgbImage, Rgb, Rgba, RgbaImage, GrayImage, DynamicImage};
use std::collections::BinaryHeap;
use std::cmp::Ordering;

const PIXEL_KNOWN: u8 = 0;
const PIXEL_HOLE: u8 = 1;
const PIXEL_FRONT: u8 = 2;

#[derive(Debug, Copy, Clone, PartialEq)]
struct FloatOrd(f32);

impl Eq for FloatOrd {}

impl PartialOrd for FloatOrd {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        self.0.partial_cmp(&other.0)
    }
}

impl Ord for FloatOrd {
    fn cmp(&self, other: &Self) -> Ordering {
        self.partial_cmp(other).unwrap_or(Ordering::Equal)
    }
}

#[derive(PartialEq, Eq)]
struct HeapItem {
    priority: FloatOrd,
    x: u32,
    y: u32,
}

impl Ord for HeapItem {
    fn cmp(&self, other: &Self) -> Ordering {
        other.priority.cmp(&self.priority)
    }
}

impl PartialOrd for HeapItem {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

fn get_pixel_luma(image: &RgbImage, x: u32, y: u32) -> f32 {
    let p = image.get_pixel(x, y);
    0.299f32 * p[0] as f32 + 0.587f32 * p[1] as f32 + 0.114f32 * p[2] as f32
}

fn calculate_gradient(image: &RgbImage, pixel_states: &[u8], width: u32, height: u32, x: u32, y: u32) -> (f32, f32) {
    let mut grad_x = 0.0f32;
    let mut grad_y = 0.0f32;

    let x_plus_1 = (x + 1).min(width - 1);
    let x_minus_1 = x.saturating_sub(1);
    let y_plus_1 = (y + 1).min(height - 1);
    let y_minus_1 = y.saturating_sub(1);

    if pixel_states[((y * width) + x_plus_1) as usize] == PIXEL_KNOWN {
        grad_x = get_pixel_luma(image, x_plus_1, y) - get_pixel_luma(image, x, y);
    } else if pixel_states[((y * width) + x_minus_1) as usize] == PIXEL_KNOWN {
        grad_x = get_pixel_luma(image, x, y) - get_pixel_luma(image, x_minus_1, y);
    }

    if pixel_states[(((y_plus_1) * width) + x) as usize] == PIXEL_KNOWN {
        grad_y = get_pixel_luma(image, x, y_plus_1) - get_pixel_luma(image, x, y);
    } else if pixel_states[(((y_minus_1) * width) + x) as usize] == PIXEL_KNOWN {
        grad_y = get_pixel_luma(image, x, y) - get_pixel_luma(image, x, y_minus_1);
    }

    (grad_x, grad_y)
}

fn inpaint_telea(
    image: &RgbImage,
    mask: &GrayImage,
    radius: f32,
) -> RgbImage {
    let (width, height) = image.dimensions();
    let mut output = image.clone();

    let mut pixel_states = vec![PIXEL_KNOWN; (width * height) as usize];
    let mut confidence = vec![0.0f32; (width * height) as usize];
    let mut narrow_band = BinaryHeap::new();

    for y in 0..height {
        for x in 0..width {
            let idx = (y * width + x) as usize;
            if mask.get_pixel(x, y)[0] > 0 {
                pixel_states[idx] = PIXEL_HOLE;
            } else {
                confidence[idx] = 1.0f32;
            }
        }
    }

    for y in 1..height - 1 {
        for x in 1..width - 1 {
            let idx = (y * width + x) as usize;
            if pixel_states[idx] == PIXEL_HOLE {
                if pixel_states[idx - 1] == PIXEL_KNOWN ||
                   pixel_states[idx + 1] == PIXEL_KNOWN ||
                   pixel_states[idx - width as usize] == PIXEL_KNOWN ||
                   pixel_states[idx + width as usize] == PIXEL_KNOWN {
                    
                    pixel_states[idx] = PIXEL_FRONT;
                    narrow_band.push(HeapItem {
                        priority: FloatOrd(0.0f32),
                        x,
                        y,
                    });
                }
            }
        }
    }

    while let Some(current) = narrow_band.pop() {
        let (px, py) = (current.x, current.y);
        let p_idx = (py * width + px) as usize;

        if pixel_states[p_idx] == PIXEL_KNOWN {
            continue;
        }
        
        let (new_pixel_color, new_confidence) = calculate_color_and_confidence(&output, &pixel_states, &confidence, width, height, px, py, radius);
        output.put_pixel(px, py, new_pixel_color);
        confidence[p_idx] = new_confidence;
        pixel_states[p_idx] = PIXEL_KNOWN;

        for (nx, ny) in get_neighbors(px, py, width, height) {
            let n_idx = (ny * width + nx) as usize;
            if pixel_states[n_idx] == PIXEL_HOLE {
                pixel_states[n_idx] = PIXEL_FRONT;
                
                let (data_term, conf_term) = calculate_priority(&output, &pixel_states, &confidence, width, height, nx, ny);
                let priority = data_term * conf_term;

                narrow_band.push(HeapItem {
                    priority: FloatOrd(priority),
                    x: nx,
                    y: ny,
                });
            }
        }
    }

    output
}

fn calculate_priority(image: &RgbImage, pixel_states: &[u8], confidence: &[f32], width: u32, height: u32, x: u32, y: u32) -> (f32, f32) {
    let (nx, ny) = calculate_normal(pixel_states, width, x, y);
    let (grad_x, grad_y) = calculate_gradient(image, pixel_states, width, height, x, y);

    let data_term = (grad_x * nx + grad_y * ny).abs() / 255.0f32;

    let mut confidence_sum = 0.0f32;
    let mut count = 0;
    for dy in -1..=1 {
        for dx in -1..=1 {
            if dx == 0 && dy == 0 { continue; }
            let qx = (x as i32 + dx).clamp(0, width as i32 - 1) as u32;
            let qy = (y as i32 + dy).clamp(0, height as i32 - 1) as u32;
            if pixel_states[(qy * width + qx) as usize] == PIXEL_KNOWN {
                confidence_sum += confidence[(qy * width + qx) as usize];
                count += 1;
            }
        }
    }
    let confidence_term = if count > 0 { confidence_sum / count as f32 } else { 0.0f32 };

    (data_term, confidence_term)
}

fn calculate_color_and_confidence(
    image: &RgbImage,
    pixel_states: &[u8],
    confidence: &[f32],
    width: u32,
    height: u32,
    px: u32,
    py: u32,
    radius: f32,
) -> (Rgb<u8>, f32) {
    let (normal_x, normal_y) = calculate_normal(pixel_states, width, px, py);

    let mut total_weight = 0.0f32;
    let mut color_sum = [0.0f32; 3];
    let mut confidence_sum = 0.0f32;

    let r_int = radius.ceil() as i32;
    let y_min = (py as i32 - r_int).max(0) as u32;
    let y_max = (py as i32 + r_int).min(height as i32 - 1) as u32;
    let x_min = (px as i32 - r_int).max(0) as u32;
    let x_max = (px as i32 + r_int).min(width as i32 - 1) as u32;

    for y in y_min..=y_max {
        for x in x_min..=x_max {
            let idx = (y * width + x) as usize;
            if pixel_states[idx] == PIXEL_KNOWN {
                let dx = x as f32 - px as f32;
                let dy = y as f32 - py as f32;
                let dist_sq = dx * dx + dy * dy;

                if dist_sq <= radius * radius {
                    let dir_x = dx / (dist_sq.sqrt() + 1e-6f32);
                    let dir_y = dy / (dist_sq.sqrt() + 1e-6f32);

                    let dir_factor = (dir_x * normal_x + dir_y * normal_y).abs();
                    let dist_factor = 1.0f32 / (dist_sq + 1.0f32);
                    let conf_factor = confidence[idx];

                    let weight = (dir_factor * dist_factor * conf_factor).max(1e-6f32);

                    let pixel_color = image.get_pixel(x, y);
                    for i in 0..3 {
                        color_sum[i] += pixel_color[i] as f32 * weight;
                    }
                    confidence_sum += confidence[idx] * weight;
                    total_weight += weight;
                }
            }
        }
    }

    if total_weight > 0.0f32 {
        let final_color = Rgb([
            (color_sum[0] / total_weight).round().clamp(0.0, 255.0) as u8,
            (color_sum[1] / total_weight).round().clamp(0.0, 255.0) as u8,
            (color_sum[2] / total_weight).round().clamp(0.0, 255.0) as u8,
        ]);
        let final_confidence = confidence_sum / total_weight;
        (final_color, final_confidence)
    } else {
        (*image.get_pixel(px.saturating_sub(1), py), 0.0f32)
    }
}

fn calculate_normal(pixel_states: &[u8], width: u32, x: u32, y: u32) -> (f32, f32) {
    let mut grad_x = 0.0f32;
    let mut grad_y = 0.0f32;
    let height = pixel_states.len() as u32 / width;

    let x_plus_1 = (x + 1).min(width - 1);
    let x_minus_1 = x.saturating_sub(1);
    let y_plus_1 = (y + 1).min(height - 1);
    let y_minus_1 = y.saturating_sub(1);

    let state_at = |nx, ny| pixel_states[(ny * width + nx) as usize] == PIXEL_KNOWN;

    if state_at(x_plus_1, y) != state_at(x_minus_1, y) {
        grad_x = if state_at(x_plus_1, y) { 1.0f32 } else { -1.0f32 };
    }
    if state_at(x, y_plus_1) != state_at(x, y_minus_1) {
        grad_y = if state_at(x, y_plus_1) { 1.0f32 } else { -1.0f32 };
    }

    let mag = (grad_x * grad_x + grad_y * grad_y).sqrt();
    if mag > 1e-6f32 {
        (grad_x / mag, grad_y / mag)
    } else {
        (0.0f32, 0.0f32)
    }
}

fn get_neighbors(x: u32, y: u32, width: u32, height: u32) -> Vec<(u32, u32)> {
    let mut neighbors = Vec::with_capacity(4);
    if x > 0 { neighbors.push((x - 1, y)); }
    if x < width - 1 { neighbors.push((x + 1, y)); }
    if y > 0 { neighbors.push((x, y - 1)); }
    if y < height - 1 { neighbors.push((x, y + 1)); }
    neighbors
}

pub fn perform_fast_inpaint(
    source_image: &DynamicImage,
    mask: &GrayImage,
) -> Result<RgbaImage, String> {
    let source_rgb = source_image.to_rgb8();
    let radius = 7.0f32;

    let inpainted_rgb = inpaint_telea(&source_rgb, mask, radius);

    let (width, height) = inpainted_rgb.dimensions();
    let mut patch_rgba = RgbaImage::new(width, height);

    for y in 0..height {
        for x in 0..width {
            let rgb_pixel = inpainted_rgb.get_pixel(x, y);
            let alpha = mask.get_pixel(x, y)[0];
            patch_rgba.put_pixel(x, y, Rgba([rgb_pixel[0], rgb_pixel[1], rgb_pixel[2], alpha]));
        }
    }

    Ok(patch_rgba)
}