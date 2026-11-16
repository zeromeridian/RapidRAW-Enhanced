//! AI Super Resolution: a 2× upscale of the base image by a SPAN model,
//! cached like AI Denoise. With AI Denoise on, both the original and the
//! denoised base are upscaled, so the Denoise sliders blend them at 2×.
//! Ported from upstream RapidRAW `f1b8fef6` and `deec27c5`.

use crate::ai_base_cache::{BaseCache, CachedBase, base_fingerprint, entry_key, source_string};
use crate::ai_denoise::DenoiseBlend;
use crate::app_state::{AppState, LoadedImage};
use image::{DynamicImage, GenericImageView, Rgb32FImage};
use rayon::prelude::*;
use std::borrow::Cow;
use std::path::Path;
use std::sync::{Arc, Mutex};
use tauri::Manager;

pub const FACTOR: u32 = 2;
const MODEL_TAG: &str = "upscale-v3";
const DISK_CACHE_LIMIT_BYTES: u64 = 20 * 1024 * 1024 * 1024;
const GAMMA: f32 = 2.2;
const DETAIL_GAIN: f32 = 1.5;
const DETAIL_NOISE_FLOOR: f32 = 2.0;
const DETAIL_OVERSHOOT: f32 = 0.25;
const DETAIL_BAND: usize = 32;
const DETAIL_SAMPLE_STEP: usize = 8;

static CACHE: BaseCache = BaseCache::new(
    "ai_upscale",
    "rrup",
    b"RRUP0001",
    None,
    DISK_CACHE_LIMIT_BYTES,
    2,
    "ai-upscale",
    "AI super resolution",
);

type Session = Arc<Mutex<ort::session::Session>>;

pub fn initialize_cache_dir(cache_dir: &Path) {
    CACHE.initialize_dir(cache_dir);
}

pub fn cache_epoch() -> u64 {
    CACHE.epoch()
}

pub fn is_enabled(adjustments: &serde_json::Value) -> bool {
    crate::adjustment_utils::is_tool_enabled(adjustments, "superResolution", "aiUpscaleEnabled")
}

/// How much larger than the decoded photo an edit's prepared base is.
pub fn factor(adjustments: &serde_json::Value) -> u32 {
    if is_enabled(adjustments) { FACTOR } else { 1 }
}

/// The scale from `base` to `prepared`: `FACTOR` once the upscaled base
/// replaced it, else 1.
pub fn scale_between(base: &DynamicImage, prepared: &DynamicImage) -> f32 {
    if base.width() == 0 {
        1.0
    } else {
        prepared.width() as f32 / base.width() as f32
    }
}

/// Which base an upscale entry was made from.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Input {
    Original,
    Denoised,
}

impl Input {
    fn tag(self) -> &'static str {
        match self {
            Input::Original => "none",
            Input::Denoised => "nind",
        }
    }
}

fn key(source: &str, input: Input) -> String {
    entry_key(&format!("{MODEL_TAG}+{}", input.tag()), source)
}

/// The entries an edit needs, denoised first.
fn inputs(adjustments: &serde_json::Value) -> &'static [Input] {
    if DenoiseBlend::from_adjustments(adjustments).is_some() {
        &[Input::Denoised, Input::Original]
    } else {
        &[Input::Original]
    }
}

fn taps(o: usize, len: usize) -> (usize, usize) {
    let i = o / 2;
    let j = if o.is_multiple_of(2) {
        i.saturating_sub(1)
    } else {
        (i + 1).min(len - 1)
    };
    (i, j)
}

/// Adds `src`, bilinearly enlarged 2×, to `dst`.
fn upsample_add(dst: &mut [f32], src: &[f32], width: usize, height: usize) {
    let out_w = width * FACTOR as usize;
    dst.par_chunks_exact_mut(out_w * 3)
        .enumerate()
        .for_each(|(oy, row)| {
            let (y0, y1) = taps(oy, height);
            let (r0, r1) = (&src[y0 * width * 3..], &src[y1 * width * 3..]);
            for ox in 0..out_w {
                let (x0, x1) = taps(ox, width);
                for c in 0..3 {
                    let near = 0.75 * r0[x0 * 3 + c] + 0.25 * r0[x1 * 3 + c];
                    let far = 0.75 * r1[x0 * 3 + c] + 0.25 * r1[x1 * 3 + c];
                    row[ox * 3 + c] += 0.75 * near + 0.25 * far;
                }
            }
        });
}

fn luma(p: &[f32]) -> f32 {
    0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2]
}

fn detail_amount(adjustments: &serde_json::Value) -> f32 {
    (adjustments["aiUpscaleDetail"].as_f64().unwrap_or(30.0) as f32 / 100.0).clamp(0.0, 1.0)
}

struct DetailField<'a> {
    source_luma: &'a [f32],
    width: usize,
    height: usize,
}

struct DetailScratch {
    width: usize,
    blend: Vec<f32>,
    signal: Vec<f32>,
    residual: Vec<f32>,
    lo: Vec<f32>,
    hi: Vec<f32>,
    energy: Vec<f32>,
}

impl DetailScratch {
    fn new(width: usize, rows: usize) -> Self {
        let out_w = width * FACTOR as usize;
        let n = rows * out_w;
        Self {
            width: out_w,
            blend: vec![0.0; width],
            signal: vec![0.0; n],
            residual: vec![0.0; n],
            lo: vec![0.0; n],
            hi: vec![0.0; n],
            energy: vec![0.0; n],
        }
    }

    fn span(&self, slot: usize) -> std::ops::Range<usize> {
        slot * self.width..(slot + 1) * self.width
    }

    fn load(&mut self, slot: usize, (signal, residual): &(Vec<f32>, Vec<f32>)) {
        let span = self.span(slot);
        self.signal[span.clone()].copy_from_slice(signal);
        self.residual[span].copy_from_slice(residual);
        self.local_stats(slot);
    }

    fn local_stats(&mut self, slot: usize) {
        let span = self.span(slot);
        let (signal, residual) = (&self.signal[span.clone()], &self.residual[span.clone()]);
        let (lo, hi, energy) = (
            &mut self.lo[span.clone()],
            &mut self.hi[span.clone()],
            &mut self.energy[span],
        );
        let last = signal.len() - 1;
        for x in 0..signal.len() {
            let (l, r) = (x.saturating_sub(1), (x + 1).min(last));
            lo[x] = signal[l].min(signal[x]).min(signal[r]);
            hi[x] = signal[l].max(signal[x]).max(signal[r]);
            energy[x] =
                residual[l] * residual[l] + residual[x] * residual[x] + residual[r] * residual[r];
        }
    }
}

impl DetailField<'_> {
    fn out_width(&self) -> usize {
        self.width * FACTOR as usize
    }

    fn row(&self, oy: usize, pixels: &[f32], scratch: &mut DetailScratch, slot: usize) {
        let (y0, y1) = taps(oy, self.height);
        let near = &self.source_luma[y0 * self.width..][..self.width];
        let far = &self.source_luma[y1 * self.width..][..self.width];
        for ((b, n), f) in scratch.blend.iter_mut().zip(near).zip(far) {
            *b = 0.75 * n + 0.25 * f;
        }
        let span = scratch.span(slot);
        let blend = &scratch.blend;
        let last = self.width - 1;
        for (x, (pair, (s, r))) in pixels
            .as_chunks::<6>()
            .0
            .iter()
            .zip(
                scratch.signal[span.clone()]
                    .as_chunks_mut::<2>()
                    .0
                    .iter_mut()
                    .zip(scratch.residual[span].as_chunks_mut::<2>().0.iter_mut()),
            )
            .enumerate()
        {
            let centre = 0.75 * blend[x];
            let up = [
                centre + 0.25 * blend[x.saturating_sub(1)],
                centre + 0.25 * blend[(x + 1).min(last)],
            ];
            for k in 0..2 {
                s[k] = luma(&pair[k * 3..k * 3 + 3]).max(0.0).sqrt();
                r[k] = s[k] - up[k].max(0.0).sqrt();
            }
        }
    }

    fn row_owned(&self, oy: usize, pixels: &[f32]) -> (Vec<f32>, Vec<f32>) {
        let mut scratch = DetailScratch::new(self.width, 1);
        self.row(oy, pixels, &mut scratch, 0);
        (scratch.signal, scratch.residual)
    }

    fn noise_sigma(&self, pixels: &[f32]) -> f32 {
        let stride = self.out_width() * 3;
        let rows = pixels.len() / stride;
        let mut samples: Vec<f32> = (0..rows.div_ceil(DETAIL_SAMPLE_STEP))
            .into_par_iter()
            .flat_map_iter(|i| {
                let oy = i * DETAIL_SAMPLE_STEP;
                self.row_owned(oy, &pixels[oy * stride..][..stride])
                    .1
                    .into_iter()
                    .step_by(DETAIL_SAMPLE_STEP)
                    .map(f32::abs)
            })
            .collect();
        if samples.is_empty() {
            return 0.0;
        }
        let mid = samples.len() / 2;
        1.4826 * *samples.select_nth_unstable_by(mid, f32::total_cmp).1
    }
}

fn soft_limit(value: f32, lo: f32, hi: f32, knee: f32) -> f32 {
    if knee <= 1e-6 {
        value.clamp(lo, hi)
    } else if value > hi {
        hi + knee * (1.0 - (-(value - hi) / knee).exp())
    } else if value < lo {
        lo - knee * (1.0 - (-(lo - value) / knee).exp())
    } else {
        value
    }
}

/// The Detail slider: strengthens the model's added detail where it rises
/// above the noise, limited to the local range so edges do not ring.
fn enhance_detail(out: &mut Rgb32FImage, source: &Rgb32FImage, amount: f32) {
    let source_luma: Vec<f32> = source.as_raw().par_chunks_exact(3).map(luma).collect();
    let field = DetailField {
        source_luma: &source_luma,
        width: source.width() as usize,
        height: source.height() as usize,
    };
    let out_w = field.out_width();
    let stride = out_w * 3;
    let band_len = DETAIL_BAND * stride;

    let pixels = out.as_raw();
    let noise_energy = 9.0 * DETAIL_NOISE_FLOOR * field.noise_sigma(pixels).powi(2);
    let edges: Vec<[(Vec<f32>, Vec<f32>); 2]> = pixels
        .par_chunks(band_len)
        .enumerate()
        .map(|(band, chunk)| {
            let last = chunk.len() / stride - 1;
            [0, last]
                .map(|i| field.row_owned(band * DETAIL_BAND + i, &chunk[i * stride..][..stride]))
        })
        .collect();

    let strength = DETAIL_GAIN * amount;
    out.par_chunks_mut(band_len).enumerate().for_each_init(
        || DetailScratch::new(field.width, 3),
        |scratch, (band, chunk)| {
            let first = band * DETAIL_BAND;
            let rows = chunk.len() / stride;
            scratch.load(
                0,
                if band > 0 {
                    &edges[band - 1][1]
                } else {
                    &edges[band][0]
                },
            );
            field.row(first, &chunk[..stride], scratch, 1);
            scratch.local_stats(1);
            for i in 0..rows {
                let next = (i + 2) % 3;
                if i + 1 < rows {
                    field.row(
                        first + i + 1,
                        &chunk[(i + 1) * stride..][..stride],
                        scratch,
                        next,
                    );
                    scratch.local_stats(next);
                } else {
                    scratch.load(next, edges.get(band + 1).map_or(&edges[band][1], |e| &e[0]));
                }
                let [a, b, c] = [i % 3, (i + 1) % 3, next].map(|slot| slot * out_w);
                let row = &mut chunk[i * stride..][..stride];
                for (x, px) in row.as_chunks_mut::<3>().0.iter_mut().enumerate() {
                    let s = scratch.signal[b + x];
                    let local_energy =
                        scratch.energy[a + x] + scratch.energy[b + x] + scratch.energy[c + x];
                    if s <= 1e-4 || local_energy <= noise_energy {
                        continue;
                    }
                    let weight = 1.0 - noise_energy / local_energy;
                    let lo = scratch.lo[a + x]
                        .min(scratch.lo[b + x])
                        .min(scratch.lo[c + x]);
                    let hi = scratch.hi[a + x]
                        .max(scratch.hi[b + x])
                        .max(scratch.hi[c + x]);
                    let target = s + strength * weight * scratch.residual[b + x];
                    let limited = soft_limit(target, lo, hi, DETAIL_OVERSHOOT * (hi - lo));
                    let gain = (limited.max(0.0) / s).powi(2);
                    px.iter_mut().for_each(|v| *v *= gain);
                }
            }
        },
    );
}

/// Replaces `image` (the denoised base, same size as `base`) with its cached
/// 2× upscale; returns `image` unchanged while an entry is still missing.
pub fn apply_ai_upscale<'a>(
    base: &DynamicImage,
    image: Cow<'a, DynamicImage>,
    path: &str,
    adjustments: &serde_json::Value,
) -> Cow<'a, DynamicImage> {
    if !is_enabled(adjustments) {
        return image;
    }
    let (w, h) = base.dimensions();
    if image.dimensions() != (w, h) {
        return image;
    }
    let source = source_string(path);
    let load = |input| {
        CACHE
            .load(&key(&source, input), &source)
            .filter(|entry| entry.image.dimensions() == (w * FACTOR, h * FACTOR))
    };

    let upscaled = match DenoiseBlend::from_adjustments(adjustments) {
        None => load(Input::Original).map(|entry| entry.image.as_ref().clone()),
        Some(blend) => load(Input::Denoised).and_then(|denoised| {
            if blend.is_full_strength() {
                return Some(denoised.image.as_ref().clone());
            }
            let mut out = load(Input::Original)?.image.as_ref().clone();
            blend.blend_into(&mut out, &denoised.image);
            Some(out)
        }),
    };
    let Some(mut out) = upscaled else {
        return image;
    };
    let amount = detail_amount(adjustments);
    if amount > 0.0 {
        match image.as_rgb32f() {
            Some(source) => enhance_detail(&mut out, source, amount),
            None => enhance_detail(&mut out, &image.to_rgb32f(), amount),
        }
    }
    Cow::Owned(DynamicImage::ImageRgb32F(out))
}

fn input_image(base: &DynamicImage, path: &str, input: Input) -> Result<Rgb32FImage, String> {
    match input {
        Input::Original => Ok(base.to_rgb32f()),
        Input::Denoised => crate::ai_denoise::full_strength(path)
            .filter(|entry| entry.image.dimensions() == base.dimensions())
            .map(|entry| entry.image.as_ref().clone())
            .ok_or_else(|| "AI denoise result is not available".to_string()),
    }
}

/// Upscales in display gamma, which the model was trained on, then puts back
/// the values outside 0–1 the model cannot carry (highlight headroom).
fn run_upscaler(
    input: &Rgb32FImage,
    session: &Mutex<ort::session::Session>,
    on_progress: &dyn Fn(f32),
) -> Result<Rgb32FImage, String> {
    let (w, h) = input.dimensions();
    let mut encoded = input.clone();
    encoded
        .par_iter_mut()
        .for_each(|v| *v = v.clamp(0.0, 1.0).powf(1.0 / GAMMA));

    let mut output = crate::ai_processing::run_ai_upscale(&encoded, session, FACTOR, on_progress)
        .map_err(|e| e.to_string())?;
    drop(encoded);
    if output.dimensions() != (w * FACTOR, h * FACTOR) {
        return Err(format!(
            "Upscale model returned {}x{} for a {}x{} input",
            output.width(),
            output.height(),
            w,
            h
        ));
    }
    output.par_iter_mut().for_each(|v| *v = v.powf(GAMMA));

    let excess: Vec<f32> = input
        .as_raw()
        .par_iter()
        .map(|&v| v - v.clamp(0.0, 1.0))
        .collect();
    upsample_add(&mut output, &excess, w as usize, h as usize);
    Ok(output)
}

fn generate_entry(
    base: &DynamicImage,
    path: &str,
    input: Input,
    session: &Mutex<ort::session::Session>,
    on_progress: &dyn Fn(f32),
) -> Result<(), String> {
    let image = run_upscaler(&input_image(base, path, input)?, session, on_progress)?;
    let source = source_string(path);
    CACHE.store(CachedBase {
        key: key(&source, input),
        source,
        fingerprint: base_fingerprint(base),
        image: Arc::new(image),
    });
    Ok(())
}

async fn load_session(app_handle: &tauri::AppHandle) -> Result<Session, String> {
    let state = app_handle.state::<AppState>();
    crate::ai_processing::get_or_init_upscale_model(
        app_handle,
        &state.ai_state,
        &state.ai_init_lock,
    )
    .await
    .map_err(|e| e.to_string())
}

/// Starts the next missing upscale in the background. The denoised input
/// waits until AI Denoise has finished; its ready event re-renders the
/// preview, which calls this again.
pub fn ensure_generated(
    app_handle: &tauri::AppHandle,
    loaded_image: &LoadedImage,
    adjustments: &serde_json::Value,
) {
    if !is_enabled(adjustments) {
        return;
    }
    let path = &loaded_image.path;
    let source = source_string(path);
    let fingerprint = base_fingerprint(&loaded_image.image);
    for &input in inputs(adjustments) {
        let key = key(&source, input);
        if CACHE.is_pending(&key) {
            return;
        }
        if CACHE.is_ready(&key, &source, fingerprint)
            || (input == Input::Denoised && !crate::ai_denoise::is_ready(path, &loaded_image.image))
        {
            continue;
        }

        let task_handle = app_handle.clone();
        let loaded_image = loaded_image.clone();
        let path = path.clone();
        CACHE.spawn(app_handle, path.clone(), key, async move {
            let session = load_session(&task_handle).await?;
            tokio::task::spawn_blocking(move || {
                generate_entry(&loaded_image.image, &path, input, &session, &|progress| {
                    CACHE.emit_progress(&task_handle, &path, progress);
                })
            })
            .await
            .map_err(|e| format!("AI super resolution task failed: {}", e))?
        });
        return;
    }
}

/// Generates every missing upscale synchronously. Exports call this after
/// `ai_denoise::ensure_ready_blocking`, so the denoised input exists.
pub fn ensure_ready_blocking(
    app_handle: &tauri::AppHandle,
    base: &DynamicImage,
    path: &str,
    adjustments: &serde_json::Value,
) -> Result<(), String> {
    if !is_enabled(adjustments) {
        return Ok(());
    }
    let source = source_string(path);
    let fingerprint = base_fingerprint(base);
    let mut session = None;
    for &input in inputs(adjustments) {
        if CACHE.is_ready(&key(&source, input), &source, fingerprint) {
            continue;
        }
        let session = match &session {
            Some(session) => session,
            None => session.insert(tauri::async_runtime::block_on(load_session(app_handle))?),
        };
        generate_entry(base, path, input, session, &|_| {})?;
    }
    Ok(())
}

#[tauri::command]
pub fn get_ai_upscale_cache_size() -> u64 {
    CACHE.size()
}

#[tauri::command]
pub fn clear_ai_upscale_cache() -> Result<(), String> {
    CACHE.clear()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn gradient(width: u32, height: u32) -> Rgb32FImage {
        Rgb32FImage::from_fn(width, height, |x, y| {
            let v = (x as f32 * 0.07 + y as f32 * 0.03).sin() * 0.4 + 0.5;
            image::Rgb([v, v * 0.8, v * 0.6])
        })
    }

    #[test]
    fn super_resolution_follows_its_switch_and_the_details_eye() {
        assert!(is_enabled(&json!({ "aiUpscaleEnabled": true })));
        assert!(!is_enabled(&json!({ "aiUpscaleEnabled": false })));
        assert!(!is_enabled(&json!({})));
        assert!(!is_enabled(&json!({
            "aiUpscaleEnabled": true,
            "sectionVisibility": { "details": false },
        })));
        assert!(!is_enabled(&json!({
            "aiUpscaleEnabled": true,
            "sectionVisibility": { "superResolution": false },
        })));
        assert_eq!(factor(&json!({ "aiUpscaleEnabled": true })), FACTOR);
        assert_eq!(factor(&json!({})), 1);
    }

    #[test]
    fn denoised_input_is_needed_only_with_ai_denoise() {
        assert_eq!(inputs(&json!({})), &[Input::Original]);
        assert_eq!(
            inputs(&json!({ "aiDenoiseEnabled": true, "aiDenoiseAmount": 0 })),
            &[Input::Original]
        );
        assert_eq!(
            inputs(&json!({ "aiDenoiseEnabled": true })),
            &[Input::Denoised, Input::Original]
        );
        assert_ne!(
            key("/a.CR3", Input::Original),
            key("/a.CR3", Input::Denoised)
        );
    }

    #[test]
    fn upscale_passes_the_image_through_without_a_cached_result() {
        let base = DynamicImage::ImageRgb32F(Rgb32FImage::new(4, 4));
        let on = json!({ "aiUpscaleEnabled": true });
        assert!(matches!(
            apply_ai_upscale(&base, Cow::Borrowed(&base), "/missing/image.raw", &on),
            Cow::Borrowed(_)
        ));
        assert!(matches!(
            apply_ai_upscale(
                &base,
                Cow::Borrowed(&base),
                "/missing/image.raw",
                &json!({})
            ),
            Cow::Borrowed(_)
        ));
    }

    #[test]
    fn upsample_add_enlarges_a_flat_image_exactly() {
        let (w, h) = (5, 3);
        let src = vec![0.25f32; w * h * 3];
        let mut dst = vec![1.0f32; w * h * 3 * 4];
        upsample_add(&mut dst, &src, w, h);
        assert!(dst.iter().all(|v| (v - 1.25).abs() < 1e-6));
    }

    #[test]
    fn detail_leaves_a_plain_enlargement_unchanged_and_stays_in_range() {
        let source = gradient(40, 24);
        let mut plain = Rgb32FImage::new(80, 48);
        upsample_add(&mut plain, source.as_raw(), 40, 24);
        let before = plain.clone();
        enhance_detail(&mut plain, &source, 1.0);
        for (a, b) in plain.as_raw().iter().zip(before.as_raw()) {
            assert!(a.is_finite());
            assert!((a - b).abs() < 0.05);
        }
    }
}
