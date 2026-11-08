//! Exposure that a RAW file says should be added back: the DNG
//! `BaselineExposure` tags and the exposure the camera held back in its
//! highlight-preserving modes (Fujifilm DR200/DR400, Canon Highlight Tone
//! Priority and Auto Lighting Optimizer, Nikon HLG and Active D-Lighting,
//! Olympus/OM gradation, Pentax DR expansion), read from the maker notes like
//! darktable's `_check_highlight_preservation`.
//!
//! Ported from upstream RapidRAW `bc7791a4`, reduced to the parts read from
//! the file (upstream's optional user baseline offset is not ported). The
//! value depends only on the file, so an edit renders the same on every
//! installation. ThisIsRAW applies it only in the Natural tone mapper, which
//! is new, so no existing edit changes.

use std::collections::HashMap;
use std::io::Cursor;
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex};
use std::time::SystemTime;

use rawler::bits::Endian;
use rawler::decoders::{Decoder, FormatHint, WellKnownIFD};
use rawler::formats::bmff::Bmff;
use rawler::formats::tiff::reader::TiffReader;
use rawler::formats::tiff::{IFD, Value, ifd::OffsetMode};
use rawler::rawsource::RawSource;
use rawler::tags::{DngTag, ExifTag};

use crate::image_processing::AllAdjustments;

const HIGHLIGHT_BIAS_MIN: f32 = -1.0;
const HIGHLIGHT_BIAS_MAX: f32 = 4.0;

const CANON_LIGHTING_OPT: u16 = 0x4018;
const FUJI_DEVELOPMENT_DYNAMIC_RANGE: u16 = 0x1403;
const FUJI_AUTO_DYNAMIC_RANGE: u16 = 0x140b;
const NIKON_COLOR_SPACE: u16 = 0x001e;
const NIKON_ACTIVE_D_LIGHTING: u16 = 0x0022;
const OLYMPUS_CAMERA_SETTINGS: u16 = 0x2020;
const OLYMPUS_GRADATION: u16 = 0x050f;
const PENTAX_DYNAMIC_RANGE_EXPANSION: u16 = 0x0069;

const RAF_JPEG_OFFSET_POSITION: usize = 84;
const RAF_JPEG_TIFF_HEADER: u32 = 12;
const FUJI_MAKERNOTE_HEADER: &[u8] = b"FUJIFILM";
const FUJI_MAKERNOTE_IFD_OFFSET: u32 = 12;

type ExposureCache = Mutex<HashMap<PathBuf, (Option<SystemTime>, f32)>>;
static EXPOSURE_CACHE: LazyLock<ExposureCache> = LazyLock::new(|| Mutex::new(HashMap::new()));

/// Sets the per-file exposure compensation of a Natural RAW render. Other
/// tone mappers and non-RAW images are left untouched (no file is read).
pub fn apply_natural_exposure(adjustments: &mut AllAdjustments, path: &str) {
    let global = &mut adjustments.global;
    if global.tonemapper_mode != crate::tone_mapping::TONE_MAPPER_MODE_NATURAL
        || global.is_raw_image == 0
    {
        return;
    }
    global.natural_exposure_ev = natural_exposure_ev(path);
}

/// Exposure compensation (EV) of the RAW file behind an image path (virtual
/// copies resolve to their source), cached until the file changes.
pub fn natural_exposure_ev(path: &str) -> f32 {
    let (source_path, _) = crate::file_management::parse_virtual_path(path);
    cached_exposure_compensation(&source_path)
}

fn cached_exposure_compensation(source_path: &Path) -> f32 {
    let modified = std::fs::metadata(source_path)
        .and_then(|metadata| metadata.modified())
        .ok();
    if let Some((cached_modified, ev)) = EXPOSURE_CACHE.lock().unwrap().get(source_path)
        && *cached_modified == modified
    {
        return *ev;
    }
    let ev = crate::file_management::read_file_mapped(source_path)
        .map(|bytes| exposure_compensation(&bytes))
        .unwrap_or(0.0);
    EXPOSURE_CACHE
        .lock()
        .unwrap()
        .insert(source_path.to_path_buf(), (modified, ev));
    ev
}

/// DNG baseline plus highlight-preservation compensation of a RAW file, in EV.
pub fn exposure_compensation(file_bytes: &[u8]) -> f32 {
    catch_unwind(AssertUnwindSafe(|| {
        let source = RawSource::new_from_slice(file_bytes);
        let Ok(decoder) = rawler::get_decoder(&source) else {
            return 0.0;
        };
        let highlight_preservation = highlight_preservation(decoder.format_hint(), file_bytes)
            .clamp(HIGHLIGHT_BIAS_MIN, HIGHLIGHT_BIAS_MAX);
        dng_baseline(decoder.as_ref()) + highlight_preservation
    }))
    .unwrap_or(0.0)
}

fn dng_baseline(decoder: &dyn Decoder) -> f32 {
    let Ok(Some(tags)) = decoder.ifd(WellKnownIFD::VirtualDngRootTags) else {
        return 0.0;
    };
    [DngTag::BaselineExposure, DngTag::BaselineExposureOffset]
        .into_iter()
        .filter_map(|tag| tags.get_entry(tag)?.value.get_f32(0).ok().flatten())
        .sum()
}

fn highlight_preservation(format: FormatHint, file_bytes: &[u8]) -> f32 {
    match format {
        FormatHint::CR2 => tiff_makernote(file_bytes).map(|makernote| canon(&makernote)),
        FormatHint::CR3 => Bmff::new_buf(file_bytes)
            .ok()
            .and_then(|bmff| bmff.filebox.moov.cr3desc)
            .map(|desc| canon(desc.cmt3.tiff.root_ifd())),
        FormatHint::NEF | FormatHint::NRW => {
            tiff_makernote(file_bytes).map(|makernote| nikon(&makernote))
        }
        FormatHint::PEF => tiff_makernote(file_bytes).map(|makernote| pentax(&makernote)),
        FormatHint::ORF => olympus_camera_settings(file_bytes).map(|settings| olympus(&settings)),
        FormatHint::RAF => fuji_makernote(file_bytes).map(|makernote| fuji(&makernote)),
        _ => None,
    }
    .unwrap_or(0.0)
}

fn exif_with_makernote(cursor: &mut Cursor<&[u8]>, tiff_offset: u32) -> Option<IFD> {
    IFD::new_root(cursor, tiff_offset)
        .ok()?
        .find_first_ifd_with_tag(ExifTag::MakerNotes)
        .cloned()
}

fn makernote_start(exif: &IFD) -> Option<u32> {
    Some(exif.base + exif.get_entry(ExifTag::MakerNotes)?.offset()? as u32)
}

fn tiff_makernote(file_bytes: &[u8]) -> Option<IFD> {
    let mut cursor = Cursor::new(file_bytes);
    exif_with_makernote(&mut cursor, 0)?
        .parse_makernote(&mut cursor, OffsetMode::Absolute, &[])
        .ok()?
}

fn fuji_makernote(file_bytes: &[u8]) -> Option<IFD> {
    let jpeg_offset = u32::from_be_bytes(
        file_bytes
            .get(RAF_JPEG_OFFSET_POSITION..RAF_JPEG_OFFSET_POSITION + 4)?
            .try_into()
            .ok()?,
    );
    let mut cursor = Cursor::new(file_bytes);
    let exif = exif_with_makernote(&mut cursor, jpeg_offset + RAF_JPEG_TIFF_HEADER)?;
    if !matches!(
        exif.get_entry(ExifTag::MakerNotes).map(|entry| &entry.value),
        Some(Value::Undefined(data)) if data.starts_with(FUJI_MAKERNOTE_HEADER)
    ) {
        return None;
    }
    IFD::new(
        &mut cursor,
        FUJI_MAKERNOTE_IFD_OFFSET,
        makernote_start(&exif)?,
        0,
        Endian::Little,
        &[],
    )
    .ok()
}

fn olympus_camera_settings(file_bytes: &[u8]) -> Option<IFD> {
    let mut cursor = Cursor::new(file_bytes);
    let exif = exif_with_makernote(&mut cursor, 0)?;
    let makernote = rawler::decoders::orf::parse_makernote(&mut cursor, &exif).ok()??;
    let settings_offset = makernote
        .get_entry_raw_with_len(OLYMPUS_CAMERA_SETTINGS, &mut cursor, 4)
        .ok()??
        .get_force_u32(0);
    IFD::new(
        &mut cursor,
        settings_offset,
        makernote_start(&exif)?,
        0,
        makernote.endian,
        &[],
    )
    .ok()
}

fn integers(ifd: &IFD, tag: u16) -> Vec<i32> {
    ifd.get_entry(tag)
        .map(|entry| {
            (0..entry.value.count())
                .map_while(|index| entry.value.get_i32(index).ok().flatten())
                .collect()
        })
        .unwrap_or_default()
}

fn first_integer(ifd: &IFD, tag: u16) -> Option<i32> {
    ifd.get_entry(tag)?.value.get_i32(0).ok().flatten()
}

fn canon(makernote: &IFD) -> f32 {
    let lighting_opt = integers(makernote, CANON_LIGHTING_OPT);
    let auto_lighting_optimizer = match lighting_opt.get(2) {
        Some(0) => 0.5,
        Some(1) => 0.33,
        Some(2) => 0.66,
        _ => 0.0,
    };
    let highlight_tone_priority = match lighting_opt.get(3) {
        Some(&state) if state > 0 => 1.0,
        _ => 0.0,
    };
    auto_lighting_optimizer + highlight_tone_priority
}

fn fuji(makernote: &IFD) -> f32 {
    match [FUJI_DEVELOPMENT_DYNAMIC_RANGE, FUJI_AUTO_DYNAMIC_RANGE]
        .into_iter()
        .find_map(|tag| first_integer(makernote, tag))
    {
        Some(200) => 1.0,
        Some(400) => 2.0,
        _ => 0.0,
    }
}

fn nikon(makernote: &IFD) -> f32 {
    if first_integer(makernote, NIKON_COLOR_SPACE) == Some(4) {
        return 2.0;
    }
    match first_integer(makernote, NIKON_ACTIVE_D_LIGHTING) {
        Some(3) => 0.33,
        Some(5) => 0.66,
        Some(7) => 1.0,
        Some(8) => 1.1,
        Some(9) => 1.2,
        Some(10) => 1.3,
        Some(11) => 1.33,
        _ => 0.0,
    }
}

fn olympus(camera_settings: &IFD) -> f32 {
    match integers(camera_settings, OLYMPUS_GRADATION).as_slice() {
        [_, _, _, 1, ..] => 0.33,
        [-1, -1, 1, ..] => 0.66,
        _ => 0.0,
    }
}

fn pentax(makernote: &IFD) -> f32 {
    match makernote
        .get_entry(PENTAX_DYNAMIC_RANGE_EXPANSION)
        .map(|entry| &entry.value)
    {
        Some(Value::Undefined(data)) if data.first() == Some(&1) => 1.0,
        _ => 0.0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unreadable_files_get_no_compensation() {
        assert_eq!(exposure_compensation(&[]), 0.0);
        assert_eq!(exposure_compensation(b"not a raw file"), 0.0);
    }

    #[test]
    fn only_natural_raw_renders_read_the_file() {
        use crate::image_processing::get_all_adjustments_from_json;
        let missing = "/nonexistent/ThisIsRAW/baseline.orf";
        for (tone_mapper, is_raw) in [("basic", true), ("agx", true), ("natural", false)] {
            let mut adjustments = get_all_adjustments_from_json(
                &serde_json::json!({ "toneMapper": tone_mapper }),
                is_raw,
                None,
            );
            adjustments.global.natural_exposure_ev = 7.0;
            apply_natural_exposure(&mut adjustments, missing);
            assert_eq!(adjustments.global.natural_exposure_ev, 7.0);
        }
        let mut natural = get_all_adjustments_from_json(
            &serde_json::json!({ "toneMapper": "natural" }),
            true,
            None,
        );
        apply_natural_exposure(&mut natural, missing);
        assert_eq!(natural.global.natural_exposure_ev, 0.0);
    }
}
