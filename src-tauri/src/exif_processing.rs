use std::collections::HashMap;
use std::fs;
use std::io::Cursor;
use std::path::{Path, PathBuf};

use crate::formats::is_raw_file;
use crate::image_processing::ImageMetadata;
use chrono::{DateTime, Local, NaiveDateTime, TimeZone};
use exif::{Exif, In, Value};
use little_exif::exif_tag::ExifTag;
use little_exif::filetype::FileExtension;
use little_exif::ifd::ExifTagGroup;
use little_exif::metadata::Metadata;
use little_exif::rational::{iR64, uR64};
use rawler::decoders::RawMetadata;

pub fn truncate_large_exif(value: &str) -> String {
    if value.len() <= 500 {
        return value.to_string();
    }

    let mut start_idx = 200;
    while !value.is_char_boundary(start_idx) {
        start_idx -= 1;
    }

    let mut end_idx = value.len() - 200;
    while !value.is_char_boundary(end_idx) {
        end_idx += 1;
    }

    if start_idx < end_idx {
        let start_str = &value[..start_idx];
        let end_str = &value[end_idx..];
        return format!("{}...{}", start_str, end_str);
    }

    value.to_string()
}

pub fn load_sidecar(sidecar_path: &Path) -> ImageMetadata {
    if !sidecar_path.exists() {
        return ImageMetadata::default();
    }

    let Ok(content) = fs::read_to_string(sidecar_path) else {
        return ImageMetadata::default();
    };

    let mut meta = serde_json::from_str::<ImageMetadata>(&content).unwrap_or_default();
    let mut healed = false;

    if let Some(ref mut exif_map) = meta.exif {
        for val in exif_map.values_mut() {
            if val.len() > 500 {
                *val = truncate_large_exif(val);
                healed = true;
            }
        }
    }

    if meta
        .exif
        .as_ref()
        .is_some_and(|exif| !has_descriptive_exif(exif))
    {
        meta.exif = None;
    }

    if healed && let Ok(json) = serde_json::to_string_pretty(&meta) {
        let _ = crate::file_management::write_metadata_file(sidecar_path, &json);
        log::info!(
            "Auto-healed bloated sidecar for: {}",
            sidecar_path.display()
        );
    }

    meta
}

fn to_ur64(val: &exif::Rational) -> uR64 {
    uR64 {
        nominator: val.num,
        denominator: val.denom,
    }
}

fn to_ir64(val: &exif::SRational) -> iR64 {
    iR64 {
        nominator: val.num,
        denominator: val.denom,
    }
}

fn clean_creation_datetime_str(s: &str) -> &str {
    s.trim().trim_matches('"').trim_matches('\'').trim()
}

fn fmt_date_str(s: String) -> String {
    if let Some(dt) = parse_creation_datetime(&s) {
        return dt.format("%Y-%m-%d %H:%M:%S").to_string();
    }
    clean_creation_datetime_str(&s).to_string()
}

fn normalize_creation_datetime(s: &str) -> Option<String> {
    let normalized = s.replace('T', " ");
    let (date, time) = normalized.split_once(' ')?;
    Some(format!("{} {}", date.replace(':', "-"), time))
}

fn parse_creation_datetime(s: &str) -> Option<NaiveDateTime> {
    let clean = clean_creation_datetime_str(s);
    if clean.is_empty() {
        return None;
    }

    let normalized = normalize_creation_datetime(clean);
    for candidate in std::iter::once(clean).chain(normalized.as_deref()) {
        for format in [
            "%Y:%m:%d %H:%M:%S",
            "%Y:%m:%d %H:%M:%S%.f",
            "%Y-%m-%d %H:%M:%S",
            "%Y-%m-%d %H:%M:%S%.f",
        ] {
            if let Ok(dt) = NaiveDateTime::parse_from_str(candidate, format) {
                return Some(dt);
            }
        }
    }

    None
}

fn parse_creation_field(field: &exif::Field) -> Option<NaiveDateTime> {
    parse_creation_datetime(&field.display_value().to_string())
}

fn parse_raw_creation_date(date_str: Option<&str>) -> Option<NaiveDateTime> {
    parse_creation_datetime(date_str?)
}

fn clean_ascii_value(value: &exif::Value) -> Option<String> {
    let exif::Value::Ascii(ref components) = *value else {
        return None;
    };

    let cleaned: Vec<String> = components
        .iter()
        .map(|c| {
            String::from_utf8_lossy(c)
                .trim_matches(char::from(0))
                .trim()
                .to_string()
        })
        .filter(|s| !s.is_empty())
        .collect();

    if cleaned.is_empty() {
        None
    } else {
        Some(cleaned.join(" "))
    }
}

fn rational_to_f32_checked(r: &exif::Rational) -> Option<f32> {
    if r.denom == 0 {
        None
    } else {
        Some(r.num as f32 / r.denom as f32)
    }
}

fn rawler_rational_to_f32_checked(r: &rawler::formats::tiff::Rational) -> Option<f32> {
    if r.d == 0 {
        None
    } else {
        Some(r.n as f32 / r.d as f32)
    }
}

fn format_min_max(min: f32, max: f32, tolerance: f32) -> String {
    if (min - max).abs() < tolerance {
        format!("{min}")
    } else {
        format!("{min}-{max}")
    }
}

fn format_lens_specification(components: &[exif::Rational]) -> Option<String> {
    if components.len() < 4 {
        return None;
    }

    let focal_min = rational_to_f32_checked(&components[0]);
    let focal_max = rational_to_f32_checked(&components[1]);
    let (focal_min, focal_max) = match (focal_min, focal_max) {
        (Some(min), Some(max)) => (min, max),
        _ => return None,
    };

    let mut spec = format!("{} mm", format_min_max(focal_min, focal_max, 0.01));

    let aperture_min = rational_to_f32_checked(&components[2]);
    let aperture_max = rational_to_f32_checked(&components[3]);
    if let (Some(amin), Some(amax)) = (aperture_min, aperture_max) {
        spec.push_str(&format!(", f/{}", format_min_max(amin, amax, 0.01)));
    }

    Some(spec)
}

pub fn is_tiff(file_bytes: &[u8]) -> bool {
    file_bytes.starts_with(b"II*\0") || file_bytes.starts_with(b"MM\0*")
}

/// The capture time a TIFF-based file records (the Exif IFD's DateTimeOriginal,
/// else IFD0's DateTime), read by following its IFD offsets in place. A large
/// TIFF often keeps its IFDs after the image data, past every prefix
/// `read_exif` tries, so that copies the whole file (≈ 850 MB per scan TIFF,
/// owner 2026-11-19); this touches only the few pages the IFDs sit on.
/// Classic TIFF only (not BigTIFF).
fn tiff_capture_date(bytes: &[u8]) -> Option<NaiveDateTime> {
    let is_little_endian = bytes.starts_with(b"II");
    let u16_at = |at: usize| {
        let raw: [u8; 2] = bytes.get(at..at.checked_add(2)?)?.try_into().ok()?;
        Some(if is_little_endian {
            u16::from_le_bytes(raw)
        } else {
            u16::from_be_bytes(raw)
        })
    };
    let u32_at = |at: usize| {
        let raw: [u8; 4] = bytes.get(at..at.checked_add(4)?)?.try_into().ok()?;
        Some(if is_little_endian {
            u32::from_le_bytes(raw)
        } else {
            u32::from_be_bytes(raw)
        })
    };
    // The type, count and value field of `tag` in the IFD at `ifd`.
    let entry = |ifd: usize, tag: u16| -> Option<(u16, usize, usize)> {
        let count = u16_at(ifd)? as usize;
        (0..count).find_map(|index| {
            let at = ifd + 2 + index * 12;
            (u16_at(at)? == tag).then_some(())?;
            Some((u16_at(at + 2)?, u32_at(at + 4)? as usize, at + 8))
        })
    };
    let ascii = |ifd: usize, tag: u16| -> Option<NaiveDateTime> {
        let (kind, count, field) = entry(ifd, tag)?;
        if kind != 2 {
            return None;
        }
        let start = if count <= 4 {
            field
        } else {
            u32_at(field)? as usize
        };
        let value = bytes.get(start..start.checked_add(count)?)?;
        parse_creation_datetime(String::from_utf8_lossy(value).trim_end_matches('\0').trim())
    };

    if !is_tiff(bytes) {
        return None;
    }
    let ifd0 = u32_at(4)? as usize;
    let exif_ifd = entry(ifd0, 0x8769).and_then(|(_, _, field)| u32_at(field));
    exif_ifd
        .and_then(|ifd| ascii(ifd as usize, 0x9003))
        .or_else(|| ascii(ifd0, 0x0132))
}

/// Smallest and largest TIFF prefix `read_exif` parses before the whole file.
const EXIF_PREFIX_MIN: usize = 64 * 1024;
const EXIF_PREFIX_MAX: usize = 16 * 1024 * 1024;

/// Reads the EXIF of an image. kamadak-exif copies the whole file for
/// TIFF-based RAWs (ARW, CR2, NEF, DNG, PEF, ...), which reads every RAW in
/// full from a network share. Their EXIF is near the start, and a prefix that
/// cuts it off fails to parse instead of returning partial fields, so growing
/// prefixes are tried first. The returned buffer may therefore be a prefix:
/// slice embedded data by its offsets from the file, not from `Exif::buf`.
pub fn read_exif(file_bytes: &[u8]) -> Option<Exif> {
    let exifreader = exif::Reader::new();
    if is_tiff(file_bytes) {
        let mut len = EXIF_PREFIX_MIN;
        while len < file_bytes.len() && len <= EXIF_PREFIX_MAX {
            if let Ok(exif) = exifreader.read_raw(file_bytes[..len].to_vec()) {
                return Some(exif);
            }
            len *= 4;
        }
    }
    exifreader
        .read_from_container(&mut Cursor::new(file_bytes))
        .ok()
}

pub fn read_exif_from_path(path: &Path) -> Option<Exif> {
    match crate::file_management::read_file_mapped(path) {
        Ok(mmap) => read_exif(&mmap),
        Err(_) => read_exif(&fs::read(path).ok()?),
    }
}

pub fn read_raw_metadata(file_bytes: &[u8]) -> Option<RawMetadata> {
    crate::raw_processing::read_from_prefix(file_bytes, |bytes, _| {
        let raw_source = rawler::rawsource::RawSource::new_from_slice(bytes);
        let decoder = rawler::get_decoder(&raw_source).ok()?;
        decoder.raw_metadata(&raw_source, &Default::default()).ok()
    })
}

fn read_raw_metadata_from_path(path: &Path) -> Option<RawMetadata> {
    match crate::file_management::read_file_mapped(path) {
        Ok(mmap) => read_raw_metadata(&mmap),
        Err(_) => read_raw_metadata(&fs::read(path).ok()?),
    }
}

const EXIF_WIDTH_KEYS: [&str; 3] = ["PixelXDimension", "ExifImageWidth", "ImageWidth"];
const EXIF_HEIGHT_KEYS: [&str; 3] = ["PixelYDimension", "ExifImageHeight", "ImageLength"];

/// Whether an EXIF map carries anything beyond image dimensions. A map with
/// only dimensions is not a usable metadata cache: it is what a RAW file whose
/// descriptive fields could not be read produces.
pub fn has_descriptive_exif(exif: &HashMap<String, String>) -> bool {
    exif.keys().any(|key| {
        !EXIF_WIDTH_KEYS.contains(&key.as_str()) && !EXIF_HEIGHT_KEYS.contains(&key.as_str())
    })
}

/// Whether `exif` records a positive pixel width and height.
pub fn has_pixel_dimensions(exif: &HashMap<String, String>) -> bool {
    let has_dimension = |keys: &[&str]| {
        keys.iter().any(|key| {
            exif.get(*key)
                .is_some_and(|value| value.parse::<usize>().is_ok_and(|dimension| dimension > 0))
        })
    };
    has_dimension(&EXIF_WIDTH_KEYS) && has_dimension(&EXIF_HEIGHT_KEYS)
}

fn add_raw_dimensions(exif: &mut HashMap<String, String>, file_bytes: &[u8]) {
    if has_pixel_dimensions(exif) {
        return;
    }

    let raw_source = rawler::rawsource::RawSource::new_from_slice(file_bytes);
    let Ok(decoder) = rawler::get_decoder(&raw_source) else {
        return;
    };
    let Ok(raw_image) = decoder.raw_image(&raw_source, &Default::default(), true) else {
        return;
    };
    if raw_image.width == 0 || raw_image.height == 0 {
        return;
    }

    exif.entry("PixelXDimension".to_string())
        .or_insert_with(|| raw_image.width.to_string());
    exif.entry("PixelYDimension".to_string())
        .or_insert_with(|| raw_image.height.to_string());
}

pub fn read_exposure_time_secs(path: &str, file_bytes: &[u8]) -> Option<f32> {
    if let Some(map) = read_sidecar_exif(Path::new(path))
        && let Some(val_str) = map.get("ExposureTime").or(map.get("ShutterSpeedValue"))
    {
        let cleaned = val_str.replace(" s", "");
        if cleaned.contains('/') {
            let parts: Vec<&str> = cleaned.split('/').collect();
            if parts.len() == 2
                && let (Ok(num), Ok(den)) = (parts[0].parse::<f32>(), parts[1].parse::<f32>())
                && den != 0.0
            {
                return Some(num / den);
            }
        } else if let Ok(val) = cleaned.parse::<f32>() {
            return Some(val);
        }
    }

    if is_raw_file(path)
        && let Some(meta) = read_raw_metadata(file_bytes)
    {
        if let Some(r) = meta.exif.exposure_time {
            return if r.d == 0 {
                None
            } else {
                Some(r.n as f32 / r.d as f32)
            };
        } else if let Some(r) = meta.exif.shutter_speed_value {
            return if r.d == 0 {
                None
            } else {
                Some(r.n as f32 / r.d as f32)
            };
        }
    }

    if let Some(exif) = read_exif(file_bytes) {
        if let Some(exposure) = exif.get_field(exif::Tag::ExposureTime, In::PRIMARY) {
            if let Value::Rational(ref r) = exposure.value {
                if r.is_empty() {
                    return None;
                }

                let val = r.first()?;

                return if val.denom == 0 {
                    None
                } else {
                    Some(val.num as f32 / val.denom as f32)
                };
            }
        } else if let Some(shutter_speed) =
            exif.get_field(exif::Tag::ShutterSpeedValue, In::PRIMARY)
            && let Value::Rational(ref r) = shutter_speed.value
        {
            if r.is_empty() {
                return None;
            }

            let val = r.first()?;

            return if val.denom == 0 {
                None
            } else {
                Some(val.num as f32 / val.denom as f32)
            };
        }
    }
    None
}

pub fn read_iso(path: &str, file_bytes: &[u8]) -> Option<u32> {
    if let Some(map) = read_sidecar_exif(Path::new(path))
        && let Some(val_str) = map
            .get("ISOSpeed")
            .or(map.get("PhotographicSensitivity"))
            .or(map.get("ISOSpeedRatings"))
        && let Ok(val) = val_str.parse::<u32>()
    {
        return Some(val);
    }

    if is_raw_file(path)
        && let Some(meta) = read_raw_metadata(file_bytes)
    {
        if let Some(r) = meta.exif.iso_speed {
            return Some(r);
        } else if let Some(r) = meta.exif.iso_speed_ratings {
            return Some(r as u32);
        }
    }

    if let Some(exif) = read_exif(file_bytes) {
        if let Some(r) = exif.get_field(exif::Tag::ISOSpeed, In::PRIMARY) {
            return r.value.get_uint(0);
        } else if let Some(r) = exif.get_field(exif::Tag::PhotographicSensitivity, In::PRIMARY) {
            return r.value.get_uint(0);
        }
    }
    None
}

pub fn extract_metadata(file_bytes: &[u8]) -> Option<HashMap<String, String>> {
    let mut map = extract_metadata_fields(file_bytes).unwrap_or_default();
    add_raw_dimensions(&mut map, file_bytes);
    (!map.is_empty()).then_some(map)
}

fn extract_metadata_fields(file_bytes: &[u8]) -> Option<HashMap<String, String>> {
    let mut map = HashMap::new();

    if let Some(exif_obj) = read_exif(file_bytes) {
        for field in exif_obj.fields() {
            match field.tag {
                exif::Tag::ExposureTime => {
                    if let exif::Value::Rational(ref v) = field.value
                        && !v.is_empty()
                    {
                        let r = &v[0];
                        if r.num == 1 && r.denom > 1 {
                            map.insert("ExposureTime".to_string(), format!("1/{} s", r.denom));
                        } else {
                            let val = r.num as f32 / r.denom as f32;
                            if val < 1.0 && val > 0.0 {
                                map.insert(
                                    "ExposureTime".to_string(),
                                    format!("1/{} s", (1.0 / val).round()),
                                );
                            } else {
                                map.insert("ExposureTime".to_string(), format!("{} s", val));
                            }
                        }
                    }
                }
                exif::Tag::ShutterSpeedValue => {
                    if let exif::Value::SRational(ref v) = field.value
                        && !v.is_empty()
                    {
                        let val = v[0].num as f32 / v[0].denom as f32;
                        map.insert("ShutterSpeedValue".to_string(), val.to_string());
                    }
                }
                exif::Tag::FNumber => {
                    if let exif::Value::Rational(ref v) = field.value
                        && !v.is_empty()
                    {
                        let val = v[0].num as f32 / v[0].denom as f32;
                        map.insert("FNumber".to_string(), format!("f/{}", val));
                    }
                }
                exif::Tag::ApertureValue => {
                    if let exif::Value::Rational(ref v) = field.value
                        && !v.is_empty()
                    {
                        let val = v[0].num as f32 / v[0].denom as f32;
                        map.insert("ApertureValue".to_string(), format!("f/{}", val));
                    }
                }
                exif::Tag::FocalLength => {
                    if let exif::Value::Rational(ref v) = field.value
                        && !v.is_empty()
                    {
                        let val = v[0].num as f32 / v[0].denom as f32;
                        map.insert("FocalLength".to_string(), val.to_string());
                        map.insert("FocalLengthIn35mmFilm".to_string(), val.to_string());
                    }
                }
                exif::Tag::PhotographicSensitivity | exif::Tag::ISOSpeed => {
                    map.insert(
                        "PhotographicSensitivity".to_string(),
                        field.display_value().to_string(),
                    );
                    map.insert("ISOSpeed".to_string(), field.display_value().to_string());
                }
                exif::Tag::DateTimeOriginal => {
                    map.insert(
                        "DateTimeOriginal".to_string(),
                        fmt_date_str(field.display_value().to_string()),
                    );
                }
                exif::Tag::DateTime => {
                    map.insert(
                        "CreateDate".to_string(),
                        fmt_date_str(field.display_value().to_string()),
                    );
                }
                exif::Tag::DateTimeDigitized => {
                    map.insert(
                        "ModifyDate".to_string(),
                        fmt_date_str(field.display_value().to_string()),
                    );
                }
                exif::Tag::LensSpecification => {
                    if let exif::Value::Rational(ref v) = field.value
                        && v.len() >= 4
                        && let (Some(focal_min), Some(focal_max)) = (
                            rational_to_f32_checked(&v[0]),
                            rational_to_f32_checked(&v[1]),
                        )
                    {
                        let mut spec = format!("{} mm", format_min_max(focal_min, focal_max, 0.01));

                        let aperture = match (
                            rational_to_f32_checked(&v[2]),
                            rational_to_f32_checked(&v[3]),
                        ) {
                            (Some(amin), Some(amax)) => Some((amin, amax)),
                            _ => read_raw_metadata(file_bytes).and_then(|meta| {
                                let lens_desc = meta.lens?;
                                let amin =
                                    rawler_rational_to_f32_checked(&lens_desc.aperture_range[0])?;
                                let amax =
                                    rawler_rational_to_f32_checked(&lens_desc.aperture_range[1])?;
                                Some((amin, amax))
                            }),
                        };

                        if let Some((amin, amax)) = aperture
                            && (amin > 0.0 || amax > 0.0)
                        {
                            spec.push_str(&format!(", f/{}", format_min_max(amin, amax, 0.01)));
                        }

                        map.insert("LensSpecification".to_string(), spec);
                    }
                }
                _ => match &field.value {
                    exif::Value::Ascii(_) => {
                        if let Some(val) = clean_ascii_value(&field.value) {
                            map.insert(field.tag.to_string(), val);
                        }
                    }
                    _ => {
                        let val = field.display_value().with_unit(&exif_obj).to_string();
                        if !val.trim().is_empty() {
                            map.insert(field.tag.to_string(), val);
                        }
                    }
                },
            }
        }
    }

    if !map.is_empty() {
        return Some(map);
    }

    let metadata = read_raw_metadata(file_bytes)?;

    let exif = metadata.exif;

    let fmt_rat = |r: &rawler::formats::tiff::Rational| -> f32 {
        if r.d == 0 {
            0.0
        } else {
            r.n as f32 / r.d as f32
        }
    };

    let fmt_srat = |r: &rawler::formats::tiff::SRational| -> f32 {
        if r.d == 0 {
            0.0
        } else {
            r.n as f32 / r.d as f32
        }
    };

    let mut insert_if_present = |key: &str, val: String| {
        let trimmed = val.trim();
        if !trimmed.is_empty() {
            map.insert(key.to_string(), truncate_large_exif(trimmed));
        }
    };

    insert_if_present("Make", metadata.make);
    insert_if_present("Model", metadata.model);

    if let Some(v) = exif.artist {
        insert_if_present("Artist", v);
    }
    if let Some(v) = exif.copyright {
        insert_if_present("Copyright", v);
    }
    if let Some(v) = exif.owner_name {
        insert_if_present("OwnerName", v);
    }
    if let Some(v) = exif.serial_number {
        insert_if_present("SerialNumber", v);
    }
    if let Some(v) = exif.image_number {
        insert_if_present("ImageNumber", v.to_string());
    }
    if let Some(v) = exif.user_comment {
        insert_if_present("UserComment", v);
    }

    if let Some(v) = exif.date_time_original {
        insert_if_present("DateTimeOriginal", fmt_date_str(v));
    }
    if let Some(v) = exif.create_date {
        insert_if_present("CreateDate", fmt_date_str(v));
    }
    if let Some(v) = exif.modify_date {
        insert_if_present("ModifyDate", fmt_date_str(v));
    }

    if let Some(v) = exif.offset_time {
        insert_if_present("OffsetTime", v);
    }
    if let Some(v) = exif.offset_time_original {
        insert_if_present("OffsetTimeOriginal", v);
    }
    if let Some(v) = exif.offset_time_digitized {
        insert_if_present("OffsetTimeDigitized", v);
    }
    if let Some(v) = exif.sub_sec_time {
        insert_if_present("SubSecTime", v);
    }
    if let Some(v) = exif.sub_sec_time_original {
        insert_if_present("SubSecTimeOriginal", v);
    }
    if let Some(v) = exif.sub_sec_time_digitized {
        insert_if_present("SubSecTimeDigitized", v);
    }

    if let Some(v) = exif.lens_model {
        insert_if_present("LensModel", v);
    } else if let Some(lens_desc) = &metadata.lens {
        insert_if_present("LensModel", lens_desc.lens_model.clone());
    }

    if let Some(v) = exif.lens_make {
        insert_if_present("LensMake", v);
    } else if let Some(lens_desc) = &metadata.lens {
        insert_if_present("LensMake", lens_desc.lens_make.clone());
    }

    if let Some(v) = exif.lens_serial_number {
        insert_if_present("LensSerialNumber", v);
    }

    if let Some(lens_desc) = &metadata.lens {
        let focal_min = fmt_rat(&lens_desc.focal_range[0]);
        let focal_max = fmt_rat(&lens_desc.focal_range[1]);
        let mut spec = format!("{} mm", format_min_max(focal_min, focal_max, 0.01));

        let aperture_min = fmt_rat(&lens_desc.aperture_range[0]);
        let aperture_max = fmt_rat(&lens_desc.aperture_range[1]);
        if aperture_min > 0.0 || aperture_max > 0.0 {
            spec.push_str(&format!(
                ", f/{}",
                format_min_max(aperture_min, aperture_max, 0.01)
            ));
        }

        insert_if_present("LensSpecification", spec);
    }

    if let Some(v) = exif.orientation {
        insert_if_present("Orientation", v.to_string());
    }

    if let Some(r) = exif.fnumber {
        let val = fmt_rat(&r);
        insert_if_present("FNumber", format!("f/{}", val));
    }

    if let Some(r) = exif.aperture_value {
        let val = fmt_rat(&r);
        insert_if_present("ApertureValue", format!("f/{}", val));
    }

    if let Some(r) = exif.max_aperture_value {
        insert_if_present("MaxApertureValue", fmt_rat(&r).to_string());
    }

    if let Some(r) = exif.exposure_time {
        if r.n == 1 && r.d > 1 {
            insert_if_present("ExposureTime", format!("1/{} s", r.d));
        } else {
            let val = fmt_rat(&r);
            if val < 1.0 && val > 0.0 {
                insert_if_present("ExposureTime", format!("1/{} s", (1.0 / val).round()));
            } else {
                insert_if_present("ExposureTime", format!("{} s", val));
            }
        }
    }

    if let Some(r) = exif.shutter_speed_value {
        insert_if_present("ShutterSpeedValue", fmt_srat(&r).to_string());
    }

    if let Some(v) = exif.iso_speed {
        insert_if_present("PhotographicSensitivity", v.to_string());
        insert_if_present("ISOSpeed", v.to_string());
    } else if let Some(v) = exif.iso_speed_ratings {
        insert_if_present("PhotographicSensitivity", v.to_string());
        insert_if_present("ISOSpeedRatings", v.to_string());
    }

    if let Some(v) = exif.recommended_exposure_index {
        insert_if_present("RecommendedExposureIndex", v.to_string());
    }
    if let Some(v) = exif.sensitivity_type {
        insert_if_present("SensitivityType", v.to_string());
    }

    if let Some(r) = exif.focal_length {
        let val = fmt_rat(&r);
        insert_if_present("FocalLength", val.to_string());
        insert_if_present("FocalLengthIn35mmFilm", val.to_string());
    }

    if let Some(r) = exif.exposure_bias {
        insert_if_present("ExposureBiasValue", fmt_srat(&r).to_string());
    }

    if let Some(v) = exif.metering_mode {
        insert_if_present("MeteringMode", v.to_string());
    }
    if let Some(v) = exif.light_source {
        insert_if_present("LightSource", v.to_string());
    }
    if let Some(v) = exif.flash {
        insert_if_present("Flash", v.to_string());
    }
    if let Some(v) = exif.white_balance {
        insert_if_present("WhiteBalance", v.to_string());
    }
    if let Some(v) = exif.exposure_program {
        insert_if_present("ExposureProgram", v.to_string());
    }
    if let Some(v) = exif.exposure_mode {
        insert_if_present("ExposureMode", v.to_string());
    }
    if let Some(v) = exif.scene_capture_type {
        insert_if_present("SceneCaptureType", v.to_string());
    }
    if let Some(v) = exif.color_space {
        insert_if_present("ColorSpace", v.to_string());
    }
    if let Some(r) = exif.flash_energy {
        insert_if_present("FlashEnergy", fmt_rat(&r).to_string());
    }
    if let Some(r) = exif.brightness_value {
        insert_if_present("BrightnessValue", fmt_srat(&r).to_string());
    }

    if let Some(r) = exif.subject_distance {
        insert_if_present("SubjectDistance", fmt_rat(&r).to_string());
    }
    if let Some(v) = exif.subject_distance_range {
        insert_if_present("SubjectDistanceRange", v.to_string());
    }

    if let Some(gps) = exif.gps {
        let fmt_gps_coord = |coords: &[rawler::formats::tiff::Rational; 3]| -> String {
            format!(
                "{} deg {} min {} sec",
                fmt_rat(&coords[0]),
                fmt_rat(&coords[1]),
                fmt_rat(&coords[2])
            )
        };

        if let Some(lat) = gps.gps_latitude {
            insert_if_present("GPSLatitude", fmt_gps_coord(&lat));
        }
        if let Some(lat_ref) = gps.gps_latitude_ref {
            insert_if_present("GPSLatitudeRef", lat_ref);
        }
        if let Some(lon) = gps.gps_longitude {
            insert_if_present("GPSLongitude", fmt_gps_coord(&lon));
        }
        if let Some(lon_ref) = gps.gps_longitude_ref {
            insert_if_present("GPSLongitudeRef", lon_ref);
        }
        if let Some(alt) = gps.gps_altitude {
            insert_if_present("GPSAltitude", fmt_rat(&alt).to_string());
        }
        if let Some(alt_ref) = gps.gps_altitude_ref {
            insert_if_present("GPSAltitudeRef", alt_ref.to_string());
        }
        if let Some(v) = gps.gps_img_direction {
            insert_if_present("GPSImgDirection", fmt_rat(&v).to_string());
        }
        if let Some(v) = gps.gps_img_direction_ref {
            insert_if_present("GPSImgDirectionRef", v);
        }
        if let Some(v) = gps.gps_speed {
            insert_if_present("GPSSpeed", fmt_rat(&v).to_string());
        }
        if let Some(v) = gps.gps_speed_ref {
            insert_if_present("GPSSpeedRef", v);
        }
        if let Some(v) = gps.gps_status {
            insert_if_present("GPSStatus", v);
        }
        if let Some(v) = gps.gps_measure_mode {
            insert_if_present("GPSMeasureMode", v);
        }
        if let Some(v) = gps.gps_dop {
            insert_if_present("GPSDOP", fmt_rat(&v).to_string());
        }
        if let Some(v) = gps.gps_map_datum {
            insert_if_present("GPSMapDatum", v);
        }
    }

    Some(map)
}

/// When the photo was taken, as the camera's clock showed it: EXIF capture
/// times carry no time zone, so they are used as they are and never
/// converted. A file without one uses its creation (else modification) time
/// in the computer's time zone, else the current time.
pub fn get_creation_date_from_path(path: &Path) -> NaiveDateTime {
    try_get_exif_creation_date(path)
        .or_else(|| {
            let metadata = fs::metadata(path).ok()?;
            let time = metadata.created().or_else(|_| metadata.modified()).ok()?;
            Some(DateTime::<Local>::from(time).naive_local())
        })
        .unwrap_or_else(|| Local::now().naive_local())
}

/// A file's modification time in the computer's time zone.
pub fn file_date(path: &Path) -> Option<NaiveDateTime> {
    let modified = fs::metadata(path).ok()?.modified().ok()?;
    Some(DateTime::<Local>::from(modified).naive_local())
}

/// The moment a capture time names, read in the computer's time zone (for
/// file timestamps). A time skipped by a daylight-saving change counts as
/// the hour after it.
pub fn local_instant(date: NaiveDateTime) -> DateTime<Local> {
    Local
        .from_local_datetime(&date)
        .earliest()
        .or_else(|| {
            Local
                .from_local_datetime(&(date + chrono::TimeDelta::hours(1)))
                .earliest()
        })
        .unwrap_or_else(|| Local.from_utc_datetime(&date))
}

/// The capture time recorded in the photo's EXIF, as the camera's clock
/// showed it (see `get_creation_date_from_path`).
pub fn try_get_exif_creation_date(path: &Path) -> Option<NaiveDateTime> {
    if let Some(map) = read_sidecar_exif(path)
        && let Some(dt_str) = map.get("DateTimeOriginal").or(map.get("CreateDate"))
        && let Some(dt) = parse_creation_datetime(dt_str)
    {
        return Some(dt);
    }

    if let Ok(mmap) = crate::file_management::read_file_mapped(path)
        && let Some(dt) = tiff_capture_date(&mmap)
    {
        return Some(dt);
    }

    if let Some(exif_obj) = read_exif_from_path(path) {
        for tag in [exif::Tag::DateTimeOriginal, exif::Tag::DateTime] {
            if let Some(field) = exif_obj.get_field(tag, exif::In::PRIMARY)
                && let Some(dt) = parse_creation_field(field)
            {
                return Some(dt);
            }
        }
    }

    if is_raw_file(path)
        && let Some(metadata) = read_raw_metadata_from_path(path)
    {
        if let Some(dt) = parse_raw_creation_date(metadata.exif.date_time_original.as_deref()) {
            return Some(dt);
        }
        if let Some(dt) = parse_raw_creation_date(metadata.exif.create_date.as_deref()) {
            return Some(dt);
        }
    }

    None
}

#[cfg(target_os = "android")]
pub fn get_creation_date_from_bytes(path_hint: &str, file_bytes: &[u8]) -> NaiveDateTime {
    if let Some(exif_obj) = read_exif(file_bytes) {
        for tag in [exif::Tag::DateTimeOriginal, exif::Tag::DateTime] {
            if let Some(field) = exif_obj.get_field(tag, exif::In::PRIMARY)
                && let Some(dt) = parse_creation_field(field)
            {
                return dt;
            }
        }
    }

    if is_raw_file(path_hint)
        && let Some(metadata) = read_raw_metadata(file_bytes)
    {
        if let Some(dt) = parse_raw_creation_date(metadata.exif.date_time_original.as_deref()) {
            return dt;
        }
        if let Some(dt) = parse_raw_creation_date(metadata.exif.create_date.as_deref()) {
            return dt;
        }
    }

    Local::now().naive_local()
}

/// The EXIF an exported or converted image carries: with `inherit_all_exif` the source's
/// complete EXIF (for a TIFF output only from a non-RAW source, so no RAW- or DNG-only tags
/// reach it), otherwise the supported fields from the sidecar, the RAW decoder or the file.
/// GPS is left out with `strip_gps`. `None` when the source file is gone.
pub fn collect_export_metadata(
    original_path_str: &str,
    strip_gps: bool,
    inherit_all_exif: bool,
    is_tiff_output: bool,
) -> Option<Metadata> {
    let original_path = Path::new(original_path_str);
    if !original_path.exists() {
        return None;
    }

    let copy_all = inherit_all_exif && !(is_tiff_output && is_raw_file(original_path_str));
    let (mut metadata, mut source_read_success) = if copy_all {
        match Metadata::new_from_path(original_path) {
            Ok(metadata) => (metadata, true),
            Err(error) => {
                log::warn!(
                    "Could not inherit complete EXIF from '{}': {}. Falling back to supported metadata fields.",
                    original_path.display(),
                    error
                );
                (Metadata::new(), false)
            }
        }
    } else {
        (Metadata::new(), false)
    };

    if !source_read_success && let Some(map) = read_sidecar_exif(original_path) {
        source_read_success = true;

        let clean_s = |s: &String| s.replace('"', "").trim().to_string();

        let parse_ur64 = |s: &str| -> Option<uR64> {
            let cleaned_string = s
                .replace("f/", "")
                .replace(" s", "")
                .replace(" mm", "")
                .replace("\"", "");

            let val = cleaned_string.trim();

            if val.contains('/') {
                let parts: Vec<&str> = val.split('/').collect();
                if parts.len() == 2
                    && let (Ok(n), Ok(d)) = (parts[0].parse::<u32>(), parts[1].parse::<u32>())
                {
                    return Some(uR64 {
                        nominator: n,
                        denominator: d,
                    });
                }
            } else if let Ok(f) = val.parse::<f32>() {
                return Some(uR64 {
                    nominator: (f * 1000.0) as u32,
                    denominator: 1000,
                });
            }
            None
        };
        if let Some(val) = map.get("Make") {
            metadata.set_tag(ExifTag::Make(clean_s(val)));
        }
        if let Some(val) = map.get("Model") {
            metadata.set_tag(ExifTag::Model(clean_s(val)));
        }
        if let Some(val) = map.get("LensMake") {
            metadata.set_tag(ExifTag::LensMake(clean_s(val)));
        }
        if let Some(val) = map.get("LensModel") {
            metadata.set_tag(ExifTag::LensModel(clean_s(val)));
        }
        if let Some(val) = map.get("Artist") {
            metadata.set_tag(ExifTag::Artist(clean_s(val)));
        }
        if let Some(val) = map.get("Copyright") {
            metadata.set_tag(ExifTag::Copyright(clean_s(val)));
        }
        if let Some(val) = map.get("UserComment") {
            metadata.set_tag(ExifTag::UserComment(clean_s(val).into_bytes()));
        }
        if let Some(val) = map.get("ImageDescription") {
            metadata.set_tag(ExifTag::ImageDescription(clean_s(val)));
        }
        if let Some(val) = map.get("DateTimeOriginal") {
            metadata.set_tag(ExifTag::DateTimeOriginal(clean_s(val)));
        }
        if let Some(val) = map.get("CreateDate") {
            metadata.set_tag(ExifTag::CreateDate(clean_s(val)));
        }
        if let Some(val) = map.get("FNumber")
            && let Some(ur) = parse_ur64(val)
        {
            metadata.set_tag(ExifTag::FNumber(vec![ur]));
        }
        if let Some(val) = map.get("ExposureTime")
            && let Some(ur) = parse_ur64(val)
        {
            metadata.set_tag(ExifTag::ExposureTime(vec![ur]));
        }
        if let Some(val) = map.get("FocalLength")
            && let Some(ur) = parse_ur64(val)
        {
            metadata.set_tag(ExifTag::FocalLength(vec![ur]));
        }
        if let Some(val) = map.get("FocalLengthIn35mmFilm") {
            let cleaned = val.replace(" mm", "").replace("\"", "");
            let trimmed = cleaned.trim();
            if let Ok(f_val) = trimmed.parse::<f32>() {
                metadata.set_tag(ExifTag::FocalLengthIn35mmFormat(vec![f_val.round() as u16]));
            }
        }
        if let Some(val) = map.get("ISOSpeed").or(map.get("PhotographicSensitivity"))
            && let Ok(iso) = val.replace('"', "").trim().parse::<u16>()
        {
            metadata.set_tag(ExifTag::ISO(vec![iso]));
        }
    }

    if !source_read_success && let Some(exif_obj) = read_exif_from_path(original_path) {
        source_read_success = true;

        let get_string_val = |field: &exif::Field| -> String {
            match &field.value {
                exif::Value::Ascii(vec) => vec
                    .iter()
                    .map(|v| {
                        String::from_utf8_lossy(v)
                            .trim_matches(char::from(0))
                            .to_string()
                    })
                    .collect::<Vec<String>>()
                    .join(" "),
                _ => field
                    .display_value()
                    .to_string()
                    .replace("\"", "")
                    .trim()
                    .to_string(),
            }
        };

        if let Some(f) = exif_obj.get_field(exif::Tag::Make, exif::In::PRIMARY) {
            metadata.set_tag(ExifTag::Make(get_string_val(f)));
        }
        if let Some(f) = exif_obj.get_field(exif::Tag::Model, exif::In::PRIMARY) {
            metadata.set_tag(ExifTag::Model(get_string_val(f)));
        }
        if let Some(f) = exif_obj.get_field(exif::Tag::LensMake, exif::In::PRIMARY) {
            metadata.set_tag(ExifTag::LensMake(get_string_val(f)));
        }
        if let Some(f) = exif_obj.get_field(exif::Tag::LensModel, exif::In::PRIMARY) {
            metadata.set_tag(ExifTag::LensModel(get_string_val(f)));
        }
        if let Some(f) = exif_obj.get_field(exif::Tag::Artist, exif::In::PRIMARY) {
            metadata.set_tag(ExifTag::Artist(get_string_val(f)));
        }
        if let Some(f) = exif_obj.get_field(exif::Tag::Copyright, exif::In::PRIMARY) {
            metadata.set_tag(ExifTag::Copyright(get_string_val(f)));
        }
        if let Some(f) = exif_obj.get_field(exif::Tag::DateTimeOriginal, exif::In::PRIMARY) {
            metadata.set_tag(ExifTag::DateTimeOriginal(get_string_val(f)));
        }
        if let Some(f) = exif_obj.get_field(exif::Tag::DateTime, exif::In::PRIMARY) {
            metadata.set_tag(ExifTag::CreateDate(get_string_val(f)));
        }
        if let Some(f) = exif_obj.get_field(exif::Tag::FNumber, exif::In::PRIMARY)
            && let exif::Value::Rational(v) = &f.value
            && !v.is_empty()
        {
            metadata.set_tag(ExifTag::FNumber(vec![to_ur64(&v[0])]));
        }
        if let Some(f) = exif_obj.get_field(exif::Tag::ExposureTime, exif::In::PRIMARY)
            && let exif::Value::Rational(v) = &f.value
            && !v.is_empty()
        {
            metadata.set_tag(ExifTag::ExposureTime(vec![to_ur64(&v[0])]));
        }
        if let Some(f) = exif_obj.get_field(exif::Tag::FocalLength, exif::In::PRIMARY)
            && let exif::Value::Rational(v) = &f.value
            && !v.is_empty()
        {
            metadata.set_tag(ExifTag::FocalLength(vec![to_ur64(&v[0])]));
        }
        if let Some(f) = exif_obj.get_field(exif::Tag::ExposureBiasValue, exif::In::PRIMARY) {
            match &f.value {
                exif::Value::SRational(v) if !v.is_empty() => {
                    metadata.set_tag(ExifTag::ExposureCompensation(vec![to_ir64(&v[0])]));
                }
                exif::Value::Rational(v) if !v.is_empty() => {
                    metadata.set_tag(ExifTag::ExposureCompensation(vec![iR64 {
                        nominator: v[0].num as i32,
                        denominator: v[0].denom as i32,
                    }]));
                }
                _ => {}
            }
        }
        if let Some(f) = exif_obj.get_field(exif::Tag::PhotographicSensitivity, exif::In::PRIMARY) {
            if let Some(val) = f.value.get_uint(0) {
                metadata.set_tag(ExifTag::ISO(vec![val as u16]));
            }
        } else if let Some(f) = exif_obj.get_field(exif::Tag::ISOSpeed, exif::In::PRIMARY)
            && let Some(val) = f.value.get_uint(0)
        {
            metadata.set_tag(ExifTag::ISO(vec![val as u16]));
        }
        if let Some(f) = exif_obj.get_field(exif::Tag::FocalLengthIn35mmFilm, exif::In::PRIMARY)
            && let Some(val) = f.value.get_uint(0)
        {
            metadata.set_tag(ExifTag::FocalLengthIn35mmFormat(vec![val as u16]));
        }
        if !strip_gps {
            if let Some(f) = exif_obj.get_field(exif::Tag::GPSLatitude, exif::In::PRIMARY)
                && let exif::Value::Rational(v) = &f.value
                && v.len() >= 3
            {
                metadata.set_tag(ExifTag::GPSLatitude(vec![
                    to_ur64(&v[0]),
                    to_ur64(&v[1]),
                    to_ur64(&v[2]),
                ]));
            }
            if let Some(f) = exif_obj.get_field(exif::Tag::GPSLatitudeRef, exif::In::PRIMARY) {
                metadata.set_tag(ExifTag::GPSLatitudeRef(get_string_val(f)));
            }
            if let Some(f) = exif_obj.get_field(exif::Tag::GPSLongitude, exif::In::PRIMARY)
                && let exif::Value::Rational(v) = &f.value
                && v.len() >= 3
            {
                metadata.set_tag(ExifTag::GPSLongitude(vec![
                    to_ur64(&v[0]),
                    to_ur64(&v[1]),
                    to_ur64(&v[2]),
                ]));
            }
            if let Some(f) = exif_obj.get_field(exif::Tag::GPSLongitudeRef, exif::In::PRIMARY) {
                metadata.set_tag(ExifTag::GPSLongitudeRef(get_string_val(f)));
            }
            if let Some(f) = exif_obj.get_field(exif::Tag::GPSAltitude, exif::In::PRIMARY)
                && let exif::Value::Rational(v) = &f.value
                && !v.is_empty()
            {
                metadata.set_tag(ExifTag::GPSAltitude(vec![to_ur64(&v[0])]));
            }
            if let Some(f) = exif_obj.get_field(exif::Tag::GPSAltitudeRef, exif::In::PRIMARY) {
                let alt_ref = f.value.get_uint(0).unwrap_or(0) as u8;
                metadata.set_tag(ExifTag::GPSAltitudeRef(vec![alt_ref]));
            }
        }
    }

    if !source_read_success
        && is_raw_file(original_path_str)
        && let Some(meta) = read_raw_metadata_from_path(Path::new(original_path_str))
    {
        if !meta.make.is_empty() {
            metadata.set_tag(ExifTag::Make(meta.make.clone()));
        }
        if !meta.model.is_empty() {
            metadata.set_tag(ExifTag::Model(meta.model.clone()));
        }
        let exif = meta.exif;
        if let Some(artist) = exif.artist {
            metadata.set_tag(ExifTag::Artist(artist));
        }
        if let Some(copyright) = exif.copyright {
            metadata.set_tag(ExifTag::Copyright(copyright));
        }
        if let Some(dt) = exif.date_time_original {
            metadata.set_tag(ExifTag::DateTimeOriginal(dt));
        }
        if let Some(dt) = exif.create_date {
            metadata.set_tag(ExifTag::CreateDate(dt));
        }
        if let Some(lens_make) = exif.lens_make {
            metadata.set_tag(ExifTag::LensMake(lens_make));
        }
        if let Some(lens_model) = exif.lens_model {
            metadata.set_tag(ExifTag::LensModel(lens_model));
        }
        if let Some(f) = exif.fnumber {
            metadata.set_tag(ExifTag::FNumber(vec![uR64 {
                nominator: f.n,
                denominator: f.d,
            }]));
        }
        if let Some(t) = exif.exposure_time {
            metadata.set_tag(ExifTag::ExposureTime(vec![uR64 {
                nominator: t.n,
                denominator: t.d,
            }]));
        }
        if let Some(fl) = exif.focal_length {
            metadata.set_tag(ExifTag::FocalLength(vec![uR64 {
                nominator: fl.n,
                denominator: fl.d,
            }]));
        }
        if let Some(iso) = exif.iso_speed {
            metadata.set_tag(ExifTag::ISO(vec![iso as u16]));
        } else if let Some(iso) = exif.iso_speed_ratings {
            metadata.set_tag(ExifTag::ISO(vec![iso]));
        }
        if let Some(ev) = exif.exposure_bias {
            metadata.set_tag(ExifTag::ExposureCompensation(vec![iR64 {
                nominator: ev.n,
                denominator: ev.d,
            }]));
        }
        if let Some(flash) = exif.flash {
            metadata.set_tag(ExifTag::Flash(vec![flash]));
        }
        if let Some(metering) = exif.metering_mode {
            metadata.set_tag(ExifTag::MeteringMode(vec![metering]));
        }
        if let Some(wb) = exif.white_balance {
            metadata.set_tag(ExifTag::WhiteBalance(vec![wb]));
        }
        if let Some(prog) = exif.exposure_program {
            metadata.set_tag(ExifTag::ExposureProgram(vec![prog]));
        }
        if !strip_gps && let Some(gps) = exif.gps {
            if let Some(lat) = gps.gps_latitude {
                metadata.set_tag(ExifTag::GPSLatitude(vec![
                    uR64 {
                        nominator: lat[0].n,
                        denominator: lat[0].d,
                    },
                    uR64 {
                        nominator: lat[1].n,
                        denominator: lat[1].d,
                    },
                    uR64 {
                        nominator: lat[2].n,
                        denominator: lat[2].d,
                    },
                ]));
            }
            if let Some(lat_ref) = gps.gps_latitude_ref {
                metadata.set_tag(ExifTag::GPSLatitudeRef(lat_ref));
            }
            if let Some(lon) = gps.gps_longitude {
                metadata.set_tag(ExifTag::GPSLongitude(vec![
                    uR64 {
                        nominator: lon[0].n,
                        denominator: lon[0].d,
                    },
                    uR64 {
                        nominator: lon[1].n,
                        denominator: lon[1].d,
                    },
                    uR64 {
                        nominator: lon[2].n,
                        denominator: lon[2].d,
                    },
                ]));
            }
            if let Some(lon_ref) = gps.gps_longitude_ref {
                metadata.set_tag(ExifTag::GPSLongitudeRef(lon_ref));
            }
            if let Some(alt) = gps.gps_altitude {
                metadata.set_tag(ExifTag::GPSAltitude(vec![uR64 {
                    nominator: alt.n,
                    denominator: alt.d,
                }]));
            }
            if let Some(alt_ref) = gps.gps_altitude_ref {
                metadata.set_tag(ExifTag::GPSAltitudeRef(vec![alt_ref]));
            }
        }
    }

    if strip_gps {
        for tag in 0x0000..=0x001f {
            metadata.remove_tag_by_hex_group(tag, ExifTagGroup::GPS);
        }
    }

    metadata.set_tag(ExifTag::Software("ThisIsRAW".to_string()));
    metadata.set_tag(ExifTag::Orientation(vec![1u16]));
    metadata.set_tag(ExifTag::ColorSpace(vec![1u16]));
    if is_tiff_output {
        // Required in a TIFF's Exif IFD; JPEG exports keep what they wrote before.
        metadata.set_tag(ExifTag::ExifVersion(b"0232".to_vec()));
        metadata.set_tag(ExifTag::FlashpixVersion(b"0100".to_vec()));
    }

    Some(metadata)
}

/// Adds the export EXIF to an encoded JPEG, PNG, JPEG XL or WebP. TIFF exports carry theirs
/// from the encoder (`tiff_metadata::encode_tiff_with_metadata`), so other formats are left as
/// they are.
pub fn write_image_with_metadata(
    image_bytes: &mut Vec<u8>,
    original_path_str: &str,
    output_format: &str,
    keep_metadata: bool,
    strip_gps: bool,
    inherit_all_exif: bool,
    dpi: Option<u16>,
) -> Result<(), String> {
    if !keep_metadata {
        return Ok(());
    }

    let file_type = match output_format.to_lowercase().as_str() {
        "jpg" | "jpeg" => FileExtension::JPEG,
        "png" => FileExtension::PNG {
            as_zTXt_chunk: true,
        },
        // `little_exif` wraps a bare JPEG XL codestream in the container that holds EXIF.
        "jxl" => FileExtension::JXL,
        "webp" => FileExtension::WEBP,
        _ => return Ok(()),
    };

    let Some(mut metadata) =
        collect_export_metadata(original_path_str, strip_gps, inherit_all_exif, false)
    else {
        return Ok(());
    };

    if file_type == FileExtension::WEBP {
        convert_webp_to_extended(image_bytes);
    }

    if let Some(dpi) = dpi {
        let resolution = vec![uR64 {
            nominator: dpi.into(),
            denominator: 1,
        }];
        metadata.set_tag(ExifTag::XResolution(resolution.clone()));
        metadata.set_tag(ExifTag::YResolution(resolution));
        metadata.set_tag(ExifTag::ResolutionUnit(vec![2u16]));
    }

    if let Err(e) = metadata.write_to_vec(image_bytes, file_type) {
        log::warn!("Failed to write metadata: {}", e);
    }

    Ok(())
}

/// A lossy WebP in the simple format has no room for EXIF and `little_exif` cannot convert it
/// in memory, so this adds the extended format's `VP8X` header in front of its `VP8 ` frame.
/// Anything else is left as it is.
fn convert_webp_to_extended(image_bytes: &mut Vec<u8>) {
    const VP8_FRAME: usize = 20;

    if image_bytes.len() < VP8_FRAME + 10
        || &image_bytes[0..4] != b"RIFF"
        || &image_bytes[12..16] != b"VP8 "
        || image_bytes[VP8_FRAME + 3..VP8_FRAME + 6] != [0x9D, 0x01, 0x2A]
    {
        return;
    }

    // VP8X stores width and height minus one, in 24 bits each.
    let dimension = |offset: usize| {
        u32::from(u16::from_le_bytes([image_bytes[offset], image_bytes[offset + 1]]) & 0x3FFF)
            .saturating_sub(1)
    };
    let width = dimension(VP8_FRAME + 6);
    let height = dimension(VP8_FRAME + 8);

    let mut vp8x = Vec::with_capacity(18);
    vp8x.extend_from_slice(b"VP8X");
    vp8x.extend_from_slice(&10u32.to_le_bytes());
    vp8x.extend_from_slice(&[0; 4]);
    vp8x.extend_from_slice(&width.to_le_bytes()[..3]);
    vp8x.extend_from_slice(&height.to_le_bytes()[..3]);
    image_bytes.splice(12..12, vp8x);
    let riff_size = (image_bytes.len() - 8) as u32;
    image_bytes[4..8].copy_from_slice(&riff_size.to_le_bytes());
}

pub fn get_primary_sidecar_path(image_path: &Path) -> PathBuf {
    let mut filename = image_path.file_name().unwrap_or_default().to_os_string();
    filename.push(".tirdata");
    image_path.with_file_name(filename)
}

fn load_primary_metadata(image_path: &Path) -> ImageMetadata {
    let primary = get_primary_sidecar_path(image_path);
    load_sidecar(&primary)
}

fn save_primary_metadata(image_path: &Path, metadata: &ImageMetadata) -> std::io::Result<()> {
    let primary = get_primary_sidecar_path(image_path);
    let json = serde_json::to_string_pretty(metadata).map_err(std::io::Error::other)?;
    crate::file_management::write_metadata_file(&primary, &json).map_err(std::io::Error::other)
}

pub fn read_sidecar_exif(image_path: &Path) -> Option<HashMap<String, String>> {
    let metadata = load_primary_metadata(image_path);
    metadata.exif
}

/// EXIF for lens-profile lookup: the sidecar's own, then the physical image's
/// cached EXIF (virtual-copy sidecars store none), then the image file.
pub fn exif_for_lens_lookup(
    sidecar_exif: &Option<HashMap<String, String>>,
    image_path: &Path,
) -> Option<HashMap<String, String>> {
    if let Some(exif) = sidecar_exif {
        return Some(exif.clone());
    }
    read_exif_without_caching(image_path)
}

/// The image's cached EXIF, else its file's; nothing is written.
pub fn read_exif_without_caching(image_path: &Path) -> Option<HashMap<String, String>> {
    if let Some(exif) = read_sidecar_exif(image_path) {
        return Some(exif);
    }
    let file_bytes = crate::file_management::read_file_mapped(image_path).ok()?;
    let exif = read_exif_data_from_bytes(&image_path.to_string_lossy(), &file_bytes);
    has_descriptive_exif(&exif).then_some(exif)
}

pub fn read_exif_data_from_bytes(path: &str, file_bytes: &[u8]) -> HashMap<String, String> {
    if is_raw_file(path)
        && let Some(map) = extract_metadata(file_bytes)
    {
        return map;
    }

    let mut exif_data = HashMap::new();
    if let Some(exif) = read_exif(file_bytes) {
        for field in exif.fields() {
            let raw_val = match &field.value {
                exif::Value::Ascii(_) => match clean_ascii_value(&field.value) {
                    Some(v) => v,
                    None => continue,
                },
                exif::Value::Rational(v) if field.tag == exif::Tag::LensSpecification => {
                    match format_lens_specification(v) {
                        Some(s) => s,
                        None => continue,
                    }
                }
                _ => field.display_value().with_unit(&exif).to_string(),
            };
            exif_data.insert(field.tag.to_string(), truncate_large_exif(&raw_val));
        }
    }
    exif_data
}

pub fn read_exif_data(path: &str, file_bytes: &[u8]) -> HashMap<String, String> {
    let source_path = Path::new(path);
    let sidecar_exif = read_sidecar_exif(source_path);
    let has_sidecar_exif = sidecar_exif.is_some();
    let mut exif_map = sidecar_exif.unwrap_or_else(|| read_exif_data_from_bytes(path, file_bytes));

    let mut added_dimensions = false;
    if is_raw_file(path) && !has_pixel_dimensions(&exif_map) {
        add_raw_dimensions(&mut exif_map, file_bytes);
        added_dimensions = has_pixel_dimensions(&exif_map);
    }

    // Cache new EXIF, and RAW dimensions found by the decoder, so the file need not
    // be parsed again on the next listing.
    if (!has_sidecar_exif || added_dimensions)
        && has_descriptive_exif(&exif_map)
        && may_cache_exif(source_path)
    {
        let mut metadata = load_primary_metadata(source_path);
        metadata.exif = Some(exif_map.clone());
        let _ = save_primary_metadata(source_path, &metadata);
    }
    exif_map
}

/// Whether EXIF may be cached in the image's `.tirdata`. A RAW's EXIF is slow to
/// read, so it always is; any other image is cached only into a sidecar it
/// already has, so listing or opening a JPEG or an export creates none.
fn may_cache_exif(image_path: &Path) -> bool {
    is_raw_file(image_path) || get_primary_sidecar_path(image_path).exists()
}

pub fn persist_exif_if_missing(source_path: &Path, source_path_str: &str, file_bytes: &[u8]) {
    if !may_cache_exif(source_path) {
        return;
    }
    {
        let metadata = load_primary_metadata(source_path);
        if metadata.exif.is_some() {
            return;
        }
    }

    let exif_map = read_exif_data_from_bytes(source_path_str, file_bytes);
    if !has_descriptive_exif(&exif_map) {
        return;
    }

    let mut metadata = load_primary_metadata(source_path);

    if metadata.exif.is_none() {
        metadata.exif = Some(exif_map);
        let _ = save_primary_metadata(source_path, &metadata);
    }
}

/// Saves an image a conversion made from `source_path_str` (denoising, negative conversion,
/// panorama, HDR) as TIFF or PNG with the source's EXIF embedded, so other applications see
/// what the `.tirdata` sidecar written beside it records. No colour profile is added (the
/// float TIFFs of panoramas and HDR merges are not sRGB-encoded).
pub fn save_converted_image(
    image: &image::DynamicImage,
    output_path: &Path,
    source_path_str: &str,
) -> Result<(), String> {
    let extension = output_path
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_lowercase();
    let is_tiff = matches!(extension.as_str(), "tif" | "tiff");
    let metadata = collect_export_metadata(source_path_str, false, true, is_tiff);

    let bytes = if is_tiff {
        let samples = match image {
            image::DynamicImage::ImageRgb32F(_) | image::DynamicImage::ImageRgba32F(_) => {
                crate::tiff_metadata::TiffSamples::ThirtyTwoFloat
            }
            image::DynamicImage::ImageRgb16(_)
            | image::DynamicImage::ImageRgba16(_)
            | image::DynamicImage::ImageLuma16(_)
            | image::DynamicImage::ImageLumaA16(_) => crate::tiff_metadata::TiffSamples::Sixteen,
            _ => crate::tiff_metadata::TiffSamples::Eight,
        };
        crate::tiff_metadata::encode_tiff_with_metadata(
            image,
            samples,
            metadata.as_ref(),
            None,
            None,
        )?
    } else if extension == "png" {
        let mut bytes = Vec::new();
        image
            .write_to(&mut Cursor::new(&mut bytes), image::ImageFormat::Png)
            .map_err(|e| format!("Failed to encode image: {}", e))?;
        if let Some(metadata) = metadata
            && let Err(e) = metadata.write_to_vec(
                &mut bytes,
                FileExtension::PNG {
                    as_zTXt_chunk: true,
                },
            )
        {
            log::warn!("Failed to write metadata: {}", e);
        }
        bytes
    } else {
        return Err(format!(
            "Unsupported format for a converted image: '{}'",
            extension
        ));
    };

    fs::write(output_path, bytes)
        .map_err(|e| format!("Failed to write file to '{}': {}", output_path.display(), e))
}

pub fn write_exif_sidecar(source_path_str: &str, target_image_path: &Path) -> Result<(), String> {
    let source_path = Path::new(source_path_str);

    let exif_data = if let Some(existing) = read_sidecar_exif(source_path) {
        existing
    } else if let Ok(bytes) = fs::read(source_path) {
        read_exif_data_from_bytes(source_path_str, &bytes)
    } else {
        return Ok(());
    };

    if exif_data.is_empty() {
        return Ok(());
    }

    let mut metadata = load_primary_metadata(target_image_path);
    metadata.exif = Some(exif_data);
    save_primary_metadata(target_image_path, &metadata)
        .map_err(|e| format!("Failed to write sidecar: {}", e))
}

/// Hand-built TIFF files for tests of prefix reads.
#[cfg(test)]
pub(crate) mod test_tiff {
    /// A little-endian TIFF of `len` zero bytes with one IFD at `ifd_offset`
    /// holding `entries` as (tag, type, count, value-or-offset).
    pub(crate) fn little_endian(
        len: usize,
        ifd_offset: usize,
        entries: &[(u16, u16, u32, u32)],
    ) -> Vec<u8> {
        let mut bytes = vec![0u8; len];
        bytes[..4].copy_from_slice(b"II*\0");
        bytes[4..8].copy_from_slice(&(ifd_offset as u32).to_le_bytes());
        bytes[ifd_offset..ifd_offset + 2].copy_from_slice(&(entries.len() as u16).to_le_bytes());
        for (index, (tag, kind, count, value)) in entries.iter().enumerate() {
            let at = ifd_offset + 2 + index * 12;
            bytes[at..at + 2].copy_from_slice(&tag.to_le_bytes());
            bytes[at + 2..at + 4].copy_from_slice(&kind.to_le_bytes());
            bytes[at + 4..at + 8].copy_from_slice(&count.to_le_bytes());
            bytes[at + 8..at + 12].copy_from_slice(&value.to_le_bytes());
        }
        bytes
    }

    /// A TIFF whose IFD at `ifd_offset` holds only an ASCII Make tag.
    pub(crate) fn with_make(len: usize, ifd_offset: usize, make: &str) -> Vec<u8> {
        let value = format!("{make}\0");
        let value_offset = ifd_offset + 2 + 12 + 4;
        let mut bytes = little_endian(
            len,
            ifd_offset,
            &[(0x010f, 2, value.len() as u32, value_offset as u32)],
        );
        bytes[value_offset..value_offset + value.len()].copy_from_slice(value.as_bytes());
        bytes
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{DynamicImage, ImageBuffer, Rgb};
    use std::io::Cursor;

    fn exif_make(exif: &Exif) -> Option<String> {
        clean_ascii_value(&exif.get_field(exif::Tag::Make, In::PRIMARY)?.value)
    }

    #[test]
    fn tiff_exif_is_read_from_the_first_prefix_when_it_holds_the_metadata() {
        let bytes = test_tiff::with_make(1024 * 1024, 8, "Prefix Cam");
        let exif = read_exif(&bytes).unwrap();
        assert_eq!(exif_make(&exif).as_deref(), Some("Prefix Cam"));
        assert_eq!(exif.buf().len(), EXIF_PREFIX_MIN);
    }

    #[test]
    fn tiff_exif_beyond_a_prefix_is_read_from_a_longer_one_or_the_whole_file() {
        let longer = test_tiff::with_make(300_000, 200_000, "Far Cam");
        let exif = read_exif(&longer).unwrap();
        assert_eq!(exif_make(&exif).as_deref(), Some("Far Cam"));
        assert_eq!(exif.buf().len(), EXIF_PREFIX_MIN * 4);

        let whole = test_tiff::with_make(200_000, 150_000, "Whole Cam");
        let exif = read_exif(&whole).unwrap();
        assert_eq!(exif_make(&exif).as_deref(), Some("Whole Cam"));
        assert_eq!(exif.buf().len(), whole.len());
    }

    #[test]
    fn a_tiff_capture_date_is_read_in_place_even_after_the_image_data() {
        // IFD0 near the end of a 2 MB file (past the first prefixes) points to an Exif IFD.
        let (ifd0, exif_ifd) = (2_000_000, 2_000_100);
        let mut bytes = test_tiff::little_endian(
            2_100_000,
            ifd0,
            &[(0x0132, 2, 20, 2_000_200), (0x8769, 4, 1, exif_ifd as u32)],
        );
        let place = |bytes: &mut Vec<u8>, at: usize, text: &str| {
            bytes[at..at + text.len()].copy_from_slice(text.as_bytes());
        };
        place(&mut bytes, 2_000_200, "2026:03:07 10:00:00\0");
        bytes[exif_ifd..exif_ifd + 2].copy_from_slice(&1u16.to_le_bytes());
        let original = [
            0x9003u16.to_le_bytes().as_slice(),
            &2u16.to_le_bytes(),
            &20u32.to_le_bytes(),
            &2_000_300u32.to_le_bytes(),
        ]
        .concat();
        bytes[exif_ifd + 2..exif_ifd + 14].copy_from_slice(&original);
        place(&mut bytes, 2_000_300, "2026:03:07 09:30:15\0");
        assert_eq!(
            tiff_capture_date(&bytes),
            parse_creation_datetime("2026:03:07 09:30:15")
        );

        // Without an Exif IFD, IFD0's DateTime; without either, none.
        let mut plain = test_tiff::little_endian(4096, 8, &[(0x0132, 2, 20, 100)]);
        place(&mut plain, 100, "2025:12:31 23:59:59\0");
        assert_eq!(
            tiff_capture_date(&plain),
            parse_creation_datetime("2025:12:31 23:59:59")
        );
        assert_eq!(
            tiff_capture_date(&test_tiff::with_make(4096, 8, "Cam")),
            None
        );
        assert_eq!(tiff_capture_date(b"\xff\xd8\xff\xe0 not a tiff"), None);
    }

    fn encoded_test_tiff() -> Vec<u8> {
        let image = DynamicImage::ImageRgb8(ImageBuffer::from_pixel(3, 2, Rgb([20, 40, 60])));
        let mut bytes = Vec::new();
        image
            .write_to(&mut Cursor::new(&mut bytes), image::ImageFormat::Tiff)
            .unwrap();
        bytes
    }

    #[test]
    fn converted_images_embed_the_source_exif() {
        let folder = tempfile::tempdir().unwrap();
        let source_path = folder.path().join("source.tiff");
        let mut source_bytes = encoded_test_tiff();
        let mut source_metadata =
            Metadata::new_from_vec(&source_bytes, FileExtension::TIFF).unwrap();
        source_metadata.set_tag(ExifTag::Make("Test Camera Co.".to_string()));
        source_metadata
            .write_to_vec(&mut source_bytes, FileExtension::TIFF)
            .unwrap();
        fs::write(&source_path, source_bytes).unwrap();

        let outputs = [
            (
                "pano.tiff",
                DynamicImage::ImageRgb32F(image::ImageBuffer::from_pixel(
                    3,
                    2,
                    Rgb([0.25f32, 0.5, 1.5]),
                )),
                FileExtension::TIFF,
            ),
            (
                "denoised.tiff",
                DynamicImage::ImageRgb16(image::ImageBuffer::from_pixel(
                    3,
                    2,
                    Rgb([1000u16, 2000, 3000]),
                )),
                FileExtension::TIFF,
            ),
            (
                "denoised.png",
                DynamicImage::ImageRgb8(ImageBuffer::from_pixel(3, 2, Rgb([20, 40, 60]))),
                FileExtension::PNG {
                    as_zTXt_chunk: true,
                },
            ),
        ];
        for (name, image, file_type) in outputs {
            let output_path = folder.path().join(name);
            save_converted_image(&image, &output_path, source_path.to_str().unwrap()).unwrap();
            let bytes = fs::read(&output_path).unwrap();
            let decoded = image::load_from_memory(&bytes).unwrap();
            assert_eq!(decoded.color(), image.color(), "{name}");
            let written = Metadata::new_from_vec(&bytes, file_type).unwrap();
            assert!(
                written
                    .into_iter()
                    .any(|tag| matches!(tag, ExifTag::Make(v) if v == "Test Camera Co.")),
                "{name}"
            );
        }
    }

    #[test]
    fn jxl_and_webp_exports_carry_the_source_exif_and_strip_gps_on_request() {
        jxl_oxide::integration::register_image_decoding_hook();
        let folder = tempfile::tempdir().unwrap();
        let source_path = folder.path().join("source.tiff");
        let mut source_bytes = encoded_test_tiff();
        let mut source_metadata =
            Metadata::new_from_vec(&source_bytes, FileExtension::TIFF).unwrap();
        source_metadata.set_tag(ExifTag::Make("Test Camera Co.".to_string()));
        source_metadata.set_tag(ExifTag::GPSLatitude(vec![
            uR64 {
                nominator: 40,
                denominator: 1,
            };
            3
        ]));
        source_metadata.set_tag(ExifTag::GPSLatitudeRef("N".to_string()));
        source_metadata
            .write_to_vec(&mut source_bytes, FileExtension::TIFF)
            .unwrap();
        fs::write(&source_path, source_bytes).unwrap();

        let image = DynamicImage::ImageRgb8(ImageBuffer::from_fn(17, 9, |x, y| {
            Rgb([(x * 15) as u8, (y * 28) as u8, 90])
        }));
        let rgb = image.to_rgb8();
        let (width, height) = (image.width(), image.height());
        let lossless_jxl = jxl_encoder::LosslessConfig::new()
            .with_tree_learning(false)
            .encode(rgb.as_raw(), width, height, jxl_encoder::PixelLayout::Rgb8)
            .unwrap();
        let lossy_jxl = jxl_encoder::LossyConfig::new(1.0)
            .encode(rgb.as_raw(), width, height, jxl_encoder::PixelLayout::Rgb8)
            .unwrap();
        let webp = webp::Encoder::from_image(&image)
            .unwrap()
            .encode(90.0)
            .to_vec();
        assert_eq!(
            &webp[12..16],
            b"VP8 ",
            "the export writes simple lossy WebP"
        );

        let outputs = [
            ("jxl", lossless_jxl, FileExtension::JXL),
            ("jxl", lossy_jxl, FileExtension::JXL),
            ("webp", webp, FileExtension::WEBP),
        ];
        for (format, encoded, file_type) in outputs {
            for strip_gps in [false, true] {
                let mut bytes = encoded.clone();
                write_image_with_metadata(
                    &mut bytes,
                    source_path.to_str().unwrap(),
                    format,
                    true,
                    strip_gps,
                    true,
                    None,
                )
                .unwrap();

                let decoded = image::load_from_memory(&bytes).unwrap();
                assert_eq!(
                    (decoded.width(), decoded.height()),
                    (width, height),
                    "{format}"
                );
                let written = Metadata::new_from_vec(&bytes, file_type).unwrap();
                let has = |wanted: &dyn Fn(&ExifTag) -> bool| written.into_iter().any(wanted);
                assert!(
                    has(&|tag| matches!(tag, ExifTag::Make(v) if v == "Test Camera Co.")),
                    "{format}"
                );
                assert_eq!(
                    has(&|tag| matches!(tag, ExifTag::GPSLatitudeRef(_))),
                    !strip_gps,
                    "{format}"
                );
            }
        }
    }

    #[test]
    fn tiff_exports_carry_the_full_source_exif_and_strip_gps_on_request() {
        let folder = tempfile::tempdir().unwrap();
        let source_path = folder.path().join("source.tiff");
        let mut source_bytes = encoded_test_tiff();
        let mut source_metadata =
            Metadata::new_from_vec(&source_bytes, FileExtension::TIFF).unwrap();
        source_metadata.set_tag(ExifTag::Make("Test Camera Co.".to_string()));
        source_metadata.set_tag(ExifTag::ImageDescription("Café ☕".to_string()));
        source_metadata.set_tag(ExifTag::WhiteBalance(vec![1]));
        source_metadata.set_tag(ExifTag::GPSLatitude(vec![
            uR64 {
                nominator: 40,
                denominator: 1,
            };
            3
        ]));
        source_metadata.set_tag(ExifTag::GPSLatitudeRef("N".to_string()));
        source_metadata.set_tag(ExifTag::Software("Source Software".to_string()));
        source_metadata
            .write_to_vec(&mut source_bytes, FileExtension::TIFF)
            .unwrap();
        fs::write(&source_path, source_bytes).unwrap();
        let image = DynamicImage::ImageRgb8(ImageBuffer::from_pixel(3, 2, Rgb([20, 40, 60])));

        for strip_gps in [false, true] {
            let metadata =
                collect_export_metadata(source_path.to_str().unwrap(), strip_gps, true, true)
                    .unwrap();
            let bytes = crate::tiff_metadata::encode_tiff_with_metadata(
                &image,
                crate::tiff_metadata::TiffSamples::Eight,
                Some(&metadata),
                None,
                None,
            )
            .unwrap();

            image::load_from_memory_with_format(&bytes, image::ImageFormat::Tiff).unwrap();
            let output = Metadata::new_from_vec(&bytes, FileExtension::TIFF).unwrap();
            let has = |wanted: &dyn Fn(&ExifTag) -> bool| output.into_iter().any(wanted);
            assert!(has(
                &|tag| matches!(tag, ExifTag::Make(v) if v == "Test Camera Co.")
            ));
            assert!(has(
                &|tag| matches!(tag, ExifTag::ImageDescription(v) if v == "Café ☕")
            ));
            assert!(has(
                &|tag| matches!(tag, ExifTag::WhiteBalance(v) if v == &vec![1])
            ));
            assert!(has(
                &|tag| matches!(tag, ExifTag::Software(v) if v == "ThisIsRAW")
            ));
            assert_eq!(
                has(&|tag| matches!(tag, ExifTag::GPSLatitude(_))),
                !strip_gps
            );
        }
    }

    #[test]
    fn dimension_only_exif_is_not_descriptive() {
        let dimensions = HashMap::from([
            ("PixelXDimension".to_string(), "6384".to_string()),
            ("PixelYDimension".to_string(), "4182".to_string()),
        ]);
        assert!(!has_descriptive_exif(&dimensions));

        let mut descriptive = dimensions.clone();
        descriptive.insert("Model".to_string(), "X-T3".to_string());
        assert!(has_descriptive_exif(&descriptive));
        assert!(!has_descriptive_exif(&HashMap::new()));
    }

    #[test]
    fn dimension_only_sidecar_exif_is_ignored_so_it_is_read_again() {
        let folder = tempfile::tempdir().unwrap();
        let sidecar = folder.path().join("image.raf.tirdata");
        let dimension_only = ImageMetadata {
            exif: Some(HashMap::from([
                ("PixelXDimension".to_string(), "6384".to_string()),
                ("PixelYDimension".to_string(), "4182".to_string()),
            ])),
            rating: 3,
            ..ImageMetadata::default()
        };
        fs::write(&sidecar, serde_json::to_string(&dimension_only).unwrap()).unwrap();

        let loaded = load_sidecar(&sidecar);
        assert!(loaded.exif.is_none());
        assert_eq!(loaded.rating, 3);

        let complete = ImageMetadata {
            exif: Some(HashMap::from([("Model".to_string(), "X-T3".to_string())])),
            ..ImageMetadata::default()
        };
        fs::write(&sidecar, serde_json::to_string(&complete).unwrap()).unwrap();
        assert_eq!(load_sidecar(&sidecar).exif, complete.exif);
    }

    #[test]
    fn only_raws_get_a_sidecar_just_for_cached_exif() {
        let folder = tempfile::tempdir().unwrap();
        let raw = folder.path().join("IMG_1.CR3");
        let jpeg = folder.path().join("IMG_1_edited.jpg");
        assert!(may_cache_exif(&raw));
        assert!(!may_cache_exif(&jpeg));
        fs::write(get_primary_sidecar_path(&jpeg), "{}").unwrap();
        assert!(may_cache_exif(&jpeg));
    }
}
