use crate::ai_base_cache::{BaseCache, CachedBase, base_fingerprint, entry_key, source_string};
use crate::app_state::{AppState, LoadedImage};
use crate::relight::RelightTap;
use image::{DynamicImage, GenericImageView, Rgb32FImage, imageops};
use rayon::prelude::*;
use std::borrow::Cow;
use std::path::Path;
use std::sync::{Arc, Mutex};
use tauri::Manager;

const MODEL_TAG: &str = "nind-v3";
const DISK_CACHE_LIMIT_BYTES: u64 = 4 * 1024 * 1024 * 1024;

static CACHE: BaseCache = BaseCache::new(
    "ai_denoise",
    "rrdn",
    // Entries compressed with `cache_codec`.
    b"RRDN0003",
    // Uncompressed f16 entries written before `1.71.0`.
    Some(b"RRDN0002"),
    DISK_CACHE_LIMIT_BYTES,
    2,
    "ai-denoise",
    "AI denoise",
);

pub fn initialize_cache_dir(cache_dir: &Path) {
    CACHE.initialize_dir(cache_dir);
}

pub fn is_enabled(adjustments: &serde_json::Value) -> bool {
    crate::adjustment_utils::is_tool_enabled(adjustments, "aiDenoise", "aiDenoiseEnabled")
}

pub fn cache_epoch() -> u64 {
    CACHE.epoch()
}

fn key_for(source: &str) -> String {
    entry_key(MODEL_TAG, source)
}

/// How much of the original's luma and chroma noise an edit keeps: the
/// Amount and Detail sliders.
#[derive(Clone, Copy)]
pub struct DenoiseBlend {
    luma_keep: f32,
    chroma_keep: f32,
}

impl DenoiseBlend {
    /// The edit's blend, or `None` when AI Denoise is off or at amount 0.
    pub fn from_adjustments(adjustments: &serde_json::Value) -> Option<Self> {
        if !is_enabled(adjustments) {
            return None;
        }
        let amount = (adjustments["aiDenoiseAmount"].as_f64().unwrap_or(100.0) as f32 / 100.0)
            .clamp(0.0, 1.0);
        let detail =
            (adjustments["aiDenoiseDetail"].as_f64().unwrap_or(0.0) as f32 / 100.0).clamp(0.0, 1.0);
        (amount > 0.0).then_some(Self {
            luma_keep: 1.0 - amount * (1.0 - detail),
            chroma_keep: 1.0 - amount,
        })
    }

    /// Whether the result is the denoised image unchanged.
    pub fn is_full_strength(self) -> bool {
        self.luma_keep <= 0.0 && self.chroma_keep <= 0.0
    }

    /// Mixes `denoised` into `out`, which holds the original pixels.
    pub fn blend_into(self, out: &mut Rgb32FImage, denoised: &Rgb32FImage) {
        out.par_chunks_exact_mut(3)
            .zip(denoised.as_raw().par_chunks_exact(3))
            .for_each(|(px, dn)| {
                let r = [px[0] - dn[0], px[1] - dn[1], px[2] - dn[2]];
                let r_luma = 0.2126 * r[0] + 0.7152 * r[1] + 0.0722 * r[2];
                for c in 0..3 {
                    px[c] = dn[c] + self.chroma_keep * (r[c] - r_luma) + self.luma_keep * r_luma;
                }
            });
    }
}

/// The cached, fully denoised base of `path`, if it exists.
pub fn full_strength(path: &str) -> Option<Arc<CachedBase>> {
    let source = source_string(path);
    CACHE.load(&key_for(&source), &source)
}

/// Whether the denoised base made from exactly `base` is cached, without
/// reading its pixels.
pub fn is_ready(path: &str, base: &DynamicImage) -> bool {
    let source = source_string(path);
    CACHE.is_ready(&key_for(&source), &source, base_fingerprint(base))
}

pub fn apply_ai_denoise<'a>(
    base: &'a DynamicImage,
    path: &str,
    adjustments: &serde_json::Value,
) -> Cow<'a, DynamicImage> {
    let Some(blend) = DenoiseBlend::from_adjustments(adjustments) else {
        return Cow::Borrowed(base);
    };
    let Some(entry) = full_strength(path) else {
        return Cow::Borrowed(base);
    };

    let (w, h) = base.dimensions();
    let denoised: Cow<Rgb32FImage> = if entry.image.dimensions() == (w, h) {
        Cow::Borrowed(entry.image.as_ref())
    } else {
        Cow::Owned(imageops::resize(
            entry.image.as_ref(),
            w,
            h,
            imageops::FilterType::Triangle,
        ))
    };

    let mut out = base.to_rgb32f();
    blend.blend_into(&mut out, &denoised);
    Cow::Owned(DynamicImage::ImageRgb32F(out))
}

fn restore_low_frequencies(denoised: &mut Rgb32FImage, source: &Rgb32FImage) {
    const FACTOR: usize = 64;
    let (w, h) = (source.width() as usize, source.height() as usize);
    let (sw, sh) = (w.div_ceil(FACTOR), h.div_ceil(FACTOR));
    if sw < 2 || sh < 2 {
        return;
    }

    let src = source.as_raw();
    let dn = denoised.as_raw();
    let planes: Vec<Vec<f32>> = (0..3)
        .map(|c| {
            let mut plane = vec![0.0f32; sw * sh];
            plane
                .par_chunks_exact_mut(sw)
                .enumerate()
                .for_each(|(sy, row)| {
                    let y_range = sy * FACTOR..((sy + 1) * FACTOR).min(h);
                    for (sx, out) in row.iter_mut().enumerate() {
                        let x_range = sx * FACTOR..((sx + 1) * FACTOR).min(w);
                        let mut acc = 0.0f32;
                        for y in y_range.clone() {
                            for x in x_range.clone() {
                                let i = (y * w + x) * 3 + c;
                                acc += src[i] - dn[i];
                            }
                        }
                        *out = acc / (y_range.len() * x_range.len()) as f32;
                    }
                });
            for _ in 0..3 {
                crate::lens_blur::dof_box_filter(&mut plane, sw, sh, 1, 3);
            }
            plane
        })
        .collect();

    denoised
        .par_chunks_exact_mut(w * 3)
        .enumerate()
        .for_each(|(y, row)| {
            let v = (y as f32 + 0.5) / h as f32;
            for x in 0..w {
                let tap = RelightTap::new((x as f32 + 0.5) / w as f32, v, sw, sh);
                for (c, plane) in planes.iter().enumerate() {
                    row[x * 3 + c] += tap.sample(plane);
                }
            }
        });
}

fn run_model(
    base: &DynamicImage,
    session: &Mutex<ort::session::Session>,
    on_progress: &dyn Fn(f32),
) -> Result<Rgb32FImage, String> {
    let source = base.to_rgb32f();
    let mut output = crate::ai_processing::run_ai_denoise(&source, 0.5, session, on_progress)
        .map_err(|e| e.to_string())?
        .into_rgb32f();

    output
        .par_iter_mut()
        .zip(source.as_raw().par_iter())
        .for_each(|(dn, &src)| *dn += src - src.clamp(0.0, 1.0));

    restore_low_frequencies(&mut output, &source);
    Ok(output)
}

fn generate_entry(
    base: &DynamicImage,
    key: String,
    source: String,
    session: &Mutex<ort::session::Session>,
    on_progress: &dyn Fn(f32),
) -> Result<(), String> {
    let fingerprint = base_fingerprint(base);
    let image = run_model(base, session, on_progress)?;
    CACHE.store(CachedBase {
        key,
        source,
        fingerprint,
        image: Arc::new(image),
    });
    Ok(())
}

async fn load_session(
    app_handle: &tauri::AppHandle,
) -> Result<Arc<Mutex<ort::session::Session>>, String> {
    let state = app_handle.state::<AppState>();
    crate::ai_processing::get_or_init_denoise_model(
        app_handle,
        &state.ai_state,
        &state.ai_init_lock,
    )
    .await
    .map_err(|e| e.to_string())
}

/// Generates the denoised base synchronously when it is missing. Exports call
/// this so an image is never written without the AI denoise its edit requests.
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
    let key = key_for(&source);
    if CACHE.load(&key, &source).is_some() {
        return Ok(());
    }

    let session = tauri::async_runtime::block_on(load_session(app_handle))?;
    generate_entry(base, key, source, &session, &|_| {})
}

pub fn ensure_generated(
    app_handle: &tauri::AppHandle,
    loaded_image: &LoadedImage,
    adjustments: &serde_json::Value,
) {
    if !is_enabled(adjustments) {
        return;
    }

    let source = source_string(&loaded_image.path);
    let key = key_for(&source);
    if CACHE.is_pending(&key)
        || CACHE.is_ready(&key, &source, base_fingerprint(&loaded_image.image))
    {
        return;
    }

    let task_handle = app_handle.clone();
    let loaded_image = loaded_image.clone();
    let path = loaded_image.path.clone();
    let task_key = key.clone();
    CACHE.spawn(app_handle, path.clone(), key, async move {
        let session = load_session(&task_handle).await?;
        tokio::task::spawn_blocking(move || {
            generate_entry(
                &loaded_image.image,
                task_key,
                source,
                &session,
                &|progress| {
                    CACHE.emit_progress(&task_handle, &path, progress);
                },
            )
        })
        .await
        .map_err(|e| format!("AI denoise task failed: {}", e))?
    });
}

#[tauri::command]
pub fn get_ai_denoise_cache_size() -> u64 {
    CACHE.size()
}

#[tauri::command]
pub fn clear_ai_denoise_cache() -> Result<(), String> {
    CACHE.clear()
}

#[cfg(test)]
mod tests {
    use super::{DenoiseBlend, apply_ai_denoise, is_enabled};
    use image::{DynamicImage, Rgb32FImage};
    use std::borrow::Cow;

    #[test]
    fn ai_denoise_respects_details_section_visibility() {
        assert!(is_enabled(&serde_json::json!({ "aiDenoiseEnabled": true })));
        assert!(!is_enabled(&serde_json::json!({
            "aiDenoiseEnabled": true,
            "sectionVisibility": { "details": false },
        })));
        assert!(!is_enabled(
            &serde_json::json!({ "aiDenoiseEnabled": false })
        ));
    }

    #[test]
    fn ai_denoise_passes_the_base_through_without_a_cached_result() {
        let base = DynamicImage::ImageRgb32F(Rgb32FImage::new(4, 4));
        let disabled = serde_json::json!({ "aiDenoiseEnabled": false });
        assert!(matches!(
            apply_ai_denoise(&base, "/missing/image.raw", &disabled),
            Cow::Borrowed(_)
        ));

        let uncached = serde_json::json!({ "aiDenoiseEnabled": true, "aiDenoiseAmount": 100 });
        assert!(matches!(
            apply_ai_denoise(&base, "/missing/image.raw", &uncached),
            Cow::Borrowed(_)
        ));
    }

    #[test]
    fn denoise_blend_follows_amount_and_detail() {
        let blend = |json| DenoiseBlend::from_adjustments(&json);
        assert!(blend(serde_json::json!({ "aiDenoiseEnabled": false })).is_none());
        assert!(
            blend(serde_json::json!({ "aiDenoiseEnabled": true, "aiDenoiseAmount": 0 })).is_none()
        );
        let full = blend(serde_json::json!({ "aiDenoiseEnabled": true })).expect("full");
        assert!(full.is_full_strength());

        let original = Rgb32FImage::from_raw(1, 1, vec![0.6, 0.4, 0.2]).expect("image");
        let denoised = Rgb32FImage::from_raw(1, 1, vec![0.5, 0.5, 0.5]).expect("image");
        let mut out = original.clone();
        full.blend_into(&mut out, &denoised);
        assert_eq!(out.as_raw(), denoised.as_raw());

        let half = blend(serde_json::json!({ "aiDenoiseEnabled": true, "aiDenoiseAmount": 50 }))
            .expect("half");
        assert!(!half.is_full_strength());
        let mut out = original.clone();
        half.blend_into(&mut out, &denoised);
        for ((o, a), b) in out
            .as_raw()
            .iter()
            .zip(original.as_raw())
            .zip(denoised.as_raw())
        {
            assert!((o - (a + b) / 2.0).abs() < 1e-6);
        }
    }
}
