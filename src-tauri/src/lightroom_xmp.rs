use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::path::Path;

use quick_xml::Reader;
use quick_xml::XmlVersion;
use quick_xml::events::Event;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};
use tempfile::NamedTempFile;

use crate::file_management::{parse_virtual_path, resolve_xmp_path};
use crate::image_processing::ImageMetadata;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LightroomAdjustmentChange {
    source: String,
    target: String,
    previous: Value,
    proposed: Value,
    confidence: &'static str,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LightroomImportPreview {
    path: String,
    xmp_path: Option<String>,
    xmp_digest: Option<String>,
    sidecar_digest: Option<String>,
    process_version: Option<String>,
    changes: Vec<LightroomAdjustmentChange>,
    warnings: Vec<String>,
    error: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LightroomImportApproval {
    path: String,
    xmp_digest: String,
    sidecar_digest: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LightroomApplyResult {
    applied: usize,
    skipped: usize,
}

#[derive(Default)]
struct ParsedXmp {
    scalars: HashMap<String, String>,
    lists: HashMap<String, Vec<String>>,
}

#[derive(Default)]
struct Translation {
    patch: Value,
    changes: Vec<LightroomAdjustmentChange>,
    warnings: Vec<String>,
}

struct NumberMapping<'a> {
    source: &'a str,
    target: &'a [&'a str],
    min: f64,
    max: f64,
    scale: f64,
    confidence: &'static str,
}

fn local_name(name: &[u8]) -> String {
    let local = name.rsplit(|byte| *byte == b':').next().unwrap_or(name);
    String::from_utf8_lossy(local).into_owned()
}

fn parse_xmp(content: &str) -> Result<ParsedXmp, String> {
    let mut reader = Reader::from_str(content);
    reader.config_mut().trim_text(true);

    let mut parsed = ParsedXmp::default();
    let mut stack: Vec<String> = Vec::new();

    loop {
        match reader.read_event() {
            Ok(Event::Start(element)) => {
                for attribute in element.attributes().flatten() {
                    let key = local_name(attribute.key.as_ref());
                    let value = attribute
                        .decoded_and_normalized_value(XmlVersion::Implicit1_0, reader.decoder())
                        .map_err(|error| {
                            format!("Could not decode XMP attribute {key}: {error}")
                        })?;
                    parsed.scalars.insert(key, value.into_owned());
                }
                stack.push(local_name(element.name().as_ref()));
            }
            Ok(Event::Empty(element)) => {
                for attribute in element.attributes().flatten() {
                    let key = local_name(attribute.key.as_ref());
                    let value = attribute
                        .decoded_and_normalized_value(XmlVersion::Implicit1_0, reader.decoder())
                        .map_err(|error| {
                            format!("Could not decode XMP attribute {key}: {error}")
                        })?;
                    parsed.scalars.insert(key, value.into_owned());
                }
            }
            Ok(Event::Text(text)) => {
                let value = text
                    .decode()
                    .map_err(|error| format!("Could not decode XMP text: {error}"))?
                    .trim()
                    .to_string();
                if value.is_empty() {
                    continue;
                }
                if stack.last().is_some_and(|name| name == "li") {
                    if let Some(parent) = stack
                        .iter()
                        .rev()
                        .find(|name| !matches!(name.as_str(), "li" | "Seq" | "Bag" | "Alt"))
                    {
                        parsed.lists.entry(parent.clone()).or_default().push(value);
                    }
                } else if let Some(name) = stack.last() {
                    parsed.scalars.insert(name.clone(), value);
                }
            }
            Ok(Event::End(_)) => {
                stack.pop();
            }
            Ok(Event::Eof) => break,
            Err(error) => return Err(format!("Could not parse XMP: {error}")),
            _ => {}
        }
    }

    Ok(parsed)
}

fn get_nested<'a>(value: &'a Value, path: &[&str]) -> Option<&'a Value> {
    path.iter()
        .try_fold(value, |current, key| current.get(*key))
}

fn insert_nested(value: &mut Value, path: &[&str], proposed: Value) {
    if path.is_empty() {
        *value = proposed;
        return;
    }
    if !value.is_object() {
        *value = Value::Object(Map::new());
    }
    let object = value.as_object_mut().expect("object initialized above");
    if path.len() == 1 {
        object.insert(path[0].to_string(), proposed);
    } else {
        let child = object
            .entry(path[0].to_string())
            .or_insert_with(|| Value::Object(Map::new()));
        insert_nested(child, &path[1..], proposed);
    }
}

fn merge_patch(target: &mut Value, patch: &Value) {
    let Some(patch_object) = patch.as_object() else {
        *target = patch.clone();
        return;
    };
    if !target.is_object() {
        *target = Value::Object(Map::new());
    }
    let target_object = target.as_object_mut().expect("object initialized above");
    for (key, patch_value) in patch_object {
        let target_value = target_object.entry(key.clone()).or_insert(Value::Null);
        if patch_value.is_object() {
            merge_patch(target_value, patch_value);
        } else {
            *target_value = patch_value.clone();
        }
    }
}

fn add_change(
    translation: &mut Translation,
    current: &Value,
    source: &str,
    target: &[&str],
    proposed: Value,
    confidence: &'static str,
) {
    let previous = get_nested(current, target).cloned().unwrap_or(Value::Null);
    if previous == proposed {
        return;
    }
    insert_nested(&mut translation.patch, target, proposed.clone());
    translation.changes.push(LightroomAdjustmentChange {
        source: source.to_string(),
        target: target.join("."),
        previous,
        proposed,
        confidence,
    });
}

fn parse_number(parsed: &ParsedXmp, field: &str) -> Option<f64> {
    parsed
        .scalars
        .get(field)?
        .trim_start_matches('+')
        .parse()
        .ok()
}

fn add_number(
    translation: &mut Translation,
    parsed: &ParsedXmp,
    current: &Value,
    mapping: NumberMapping<'_>,
) {
    if let Some(value) = parse_number(parsed, mapping.source) {
        add_change(
            translation,
            current,
            mapping.source,
            mapping.target,
            json!((value * mapping.scale).clamp(mapping.min, mapping.max)),
            mapping.confidence,
        );
    }
}

fn add_curve(
    translation: &mut Translation,
    parsed: &ParsedXmp,
    current: &Value,
    source: &str,
    channel: &str,
) {
    let Some(points) = parsed.lists.get(source) else {
        return;
    };
    let converted: Vec<Value> = points
        .iter()
        .filter_map(|point| {
            let (x, y) = point.split_once(',')?;
            let x = x.trim().parse::<f64>().ok()?.clamp(0.0, 255.0);
            let y = y.trim().parse::<f64>().ok()?.clamp(0.0, 255.0);
            Some(json!({ "x": x, "y": y }))
        })
        .take(16)
        .collect();
    if converted.len() < 2 {
        return;
    }
    add_change(
        translation,
        current,
        source,
        &["curves", channel],
        Value::Array(converted.clone()),
        "close",
    );
    add_change(
        translation,
        current,
        source,
        &["pointCurves", channel],
        Value::Array(converted),
        "close",
    );
    add_change(
        translation,
        current,
        source,
        &["curveMode"],
        json!("point"),
        "close",
    );
}

fn translate(parsed: &ParsedXmp, current: &Value) -> Translation {
    let mut translation = Translation {
        patch: json!({}),
        ..Translation::default()
    };

    for (source, target, min, max, scale, confidence) in [
        ("Exposure2012", "exposure", -5.0, 5.0, 1.0, "approximate"),
        ("Contrast2012", "contrast", -100.0, 100.0, 1.0, "close"),
        ("Highlights2012", "highlights", -100.0, 100.0, 1.0, "close"),
        ("Shadows2012", "shadows", -100.0, 100.0, 1.0, "close"),
        ("Whites2012", "whites", -100.0, 100.0, 1.0, "close"),
        ("Blacks2012", "blacks", -100.0, 100.0, 1.0, "close"),
        ("Saturation", "saturation", -100.0, 100.0, 1.0, "close"),
        ("Vibrance", "vibrance", -100.0, 100.0, 1.0, "close"),
        ("Clarity2012", "clarity", -100.0, 100.0, 1.0, "approximate"),
        ("Dehaze", "dehaze", -100.0, 100.0, 1.0, "approximate"),
        ("Texture", "structure", -100.0, 100.0, 1.0, "approximate"),
        (
            "Sharpness",
            "sharpness",
            0.0,
            100.0,
            2.0 / 3.0,
            "approximate",
        ),
        (
            "LuminanceSmoothing",
            "lumaNoiseReduction",
            0.0,
            100.0,
            1.0,
            "approximate",
        ),
        (
            "ColorNoiseReduction",
            "colorNoiseReduction",
            0.0,
            100.0,
            1.0,
            "approximate",
        ),
        (
            "PostCropVignetteAmount",
            "vignetteAmount",
            -100.0,
            100.0,
            1.0,
            "approximate",
        ),
        (
            "PostCropVignetteMidpoint",
            "vignetteMidpoint",
            0.0,
            100.0,
            1.0,
            "approximate",
        ),
        (
            "PostCropVignetteFeather",
            "vignetteFeather",
            0.0,
            100.0,
            1.0,
            "approximate",
        ),
        (
            "PostCropVignetteRoundness",
            "vignetteRoundness",
            -100.0,
            100.0,
            1.0,
            "approximate",
        ),
        ("GrainAmount", "grainAmount", 0.0, 100.0, 1.0, "approximate"),
        ("GrainSize", "grainSize", 0.0, 100.0, 1.0, "approximate"),
        (
            "GrainFrequency",
            "grainRoughness",
            0.0,
            100.0,
            1.0,
            "approximate",
        ),
    ] {
        let target_path = [target];
        add_number(
            &mut translation,
            parsed,
            current,
            NumberMapping {
                source,
                target: &target_path,
                min,
                max,
                scale,
                confidence,
            },
        );
    }

    for (source, target) in [
        ("IncrementalTemperature", "temperature"),
        ("IncrementalTint", "tint"),
    ] {
        let target_path = [target];
        add_number(
            &mut translation,
            parsed,
            current,
            NumberMapping {
                source,
                target: &target_path,
                min: -100.0,
                max: 100.0,
                scale: 1.0,
                confidence: "approximate",
            },
        );
    }

    for (lightroom_color, this_is_raw_color) in [
        ("Red", "reds"),
        ("Orange", "oranges"),
        ("Yellow", "yellows"),
        ("Green", "greens"),
        ("Aqua", "aquas"),
        ("Blue", "blues"),
        ("Purple", "purples"),
        ("Magenta", "magentas"),
    ] {
        for (prefix, component) in [
            ("HueAdjustment", "hue"),
            ("SaturationAdjustment", "saturation"),
            ("LuminanceAdjustment", "luminance"),
        ] {
            let source = format!("{prefix}{lightroom_color}");
            let target_path = ["hsl", this_is_raw_color, component];
            add_number(
                &mut translation,
                parsed,
                current,
                NumberMapping {
                    source: &source,
                    target: &target_path,
                    min: -100.0,
                    max: 100.0,
                    scale: 1.0,
                    confidence: "close",
                },
            );
        }
    }

    for (source, target) in [
        ("ShadowTint", "shadowsTint"),
        ("RedHue", "redHue"),
        ("RedSaturation", "redSaturation"),
        ("GreenHue", "greenHue"),
        ("GreenSaturation", "greenSaturation"),
        ("BlueHue", "blueHue"),
        ("BlueSaturation", "blueSaturation"),
    ] {
        let target_path = ["colorCalibration", target];
        add_number(
            &mut translation,
            parsed,
            current,
            NumberMapping {
                source,
                target: &target_path,
                min: -100.0,
                max: 100.0,
                scale: 1.0,
                confidence: "close",
            },
        );
    }

    add_curve(&mut translation, parsed, current, "ToneCurvePV2012", "luma");
    add_curve(
        &mut translation,
        parsed,
        current,
        "ToneCurvePV2012Red",
        "red",
    );
    add_curve(
        &mut translation,
        parsed,
        current,
        "ToneCurvePV2012Green",
        "green",
    );
    add_curve(
        &mut translation,
        parsed,
        current,
        "ToneCurvePV2012Blue",
        "blue",
    );

    if parsed
        .scalars
        .get("ConvertToGrayscale")
        .is_some_and(|value| value.eq_ignore_ascii_case("true"))
    {
        add_change(
            &mut translation,
            current,
            "ConvertToGrayscale",
            &["monochrome"],
            json!(true),
            "close",
        );
    }

    if parsed.scalars.contains_key("Temperature") || parsed.scalars.contains_key("Tint") {
        translation.warnings.push(
            "Absolute Lightroom white balance was not applied because ThisIsRAW uses relative temperature and tint controls."
                .to_string(),
        );
    }
    for (field, warning) in [
        (
            "CameraProfile",
            "The Lightroom camera profile cannot be reproduced exactly.",
        ),
        (
            "LensProfileEnable",
            "Lightroom lens-profile corrections were not imported.",
        ),
        (
            "HasCrop",
            "Lightroom crop and geometry were not imported in this trial.",
        ),
        (
            "MaskGroupBasedCorrections",
            "Lightroom AI and local masks were not imported.",
        ),
        (
            "RetouchAreas",
            "Lightroom healing and retouch operations were not imported.",
        ),
    ] {
        if parsed.scalars.contains_key(field) || parsed.lists.contains_key(field) {
            translation.warnings.push(warning.to_string());
        }
    }

    translation
}

fn read_metadata_without_writing(path: &Path) -> Result<(ImageMetadata, String), String> {
    if !path.exists() {
        return Ok((ImageMetadata::default(), "missing".to_string()));
    }
    let bytes = fs::read(path).map_err(|error| {
        format!(
            "Could not read existing sidecar {}: {error}",
            path.display()
        )
    })?;
    let digest = blake3::hash(&bytes).to_hex().to_string();
    let metadata = serde_json::from_slice(&bytes)
        .map_err(|error| format!("Existing sidecar {} is invalid: {error}", path.display()))?;
    Ok((metadata, digest))
}

fn build_preview(path: String) -> LightroomImportPreview {
    let (source_path, sidecar_path) = parse_virtual_path(&path);
    if path.contains("?vc=") {
        return LightroomImportPreview {
            path,
            xmp_path: None,
            xmp_digest: None,
            sidecar_digest: None,
            process_version: None,
            changes: Vec::new(),
            warnings: Vec::new(),
            error: Some("Lightroom XMP import is available only for physical images.".to_string()),
        };
    }

    let Some(xmp_path) = resolve_xmp_path(&source_path) else {
        return LightroomImportPreview {
            path,
            xmp_path: None,
            xmp_digest: None,
            sidecar_digest: None,
            process_version: None,
            changes: Vec::new(),
            warnings: Vec::new(),
            error: Some("No matching XMP sidecar was found.".to_string()),
        };
    };
    let content = match fs::read_to_string(&xmp_path) {
        Ok(content) => content,
        Err(error) => {
            return LightroomImportPreview {
                path,
                xmp_path: Some(xmp_path.to_string_lossy().into_owned()),
                xmp_digest: None,
                sidecar_digest: None,
                process_version: None,
                changes: Vec::new(),
                warnings: Vec::new(),
                error: Some(format!("Could not read XMP sidecar: {error}")),
            };
        }
    };
    let parsed = match parse_xmp(&content) {
        Ok(parsed) => parsed,
        Err(error) => {
            return LightroomImportPreview {
                path,
                xmp_path: Some(xmp_path.to_string_lossy().into_owned()),
                xmp_digest: None,
                sidecar_digest: None,
                process_version: None,
                changes: Vec::new(),
                warnings: Vec::new(),
                error: Some(error),
            };
        }
    };
    let (metadata, sidecar_digest) = match read_metadata_without_writing(&sidecar_path) {
        Ok(result) => result,
        Err(error) => {
            return LightroomImportPreview {
                path,
                xmp_path: Some(xmp_path.to_string_lossy().into_owned()),
                xmp_digest: Some(blake3::hash(content.as_bytes()).to_hex().to_string()),
                sidecar_digest: None,
                process_version: parsed.scalars.get("ProcessVersion").cloned(),
                changes: Vec::new(),
                warnings: Vec::new(),
                error: Some(error),
            };
        }
    };
    let translation = translate(&parsed, &metadata.adjustments);
    let process_version = parsed.scalars.get("ProcessVersion").cloned();
    let error = if translation.changes.is_empty() {
        Some(
            "No supported Lightroom adjustments differ from the current ThisIsRAW edits."
                .to_string(),
        )
    } else {
        None
    };

    LightroomImportPreview {
        path,
        xmp_path: Some(xmp_path.to_string_lossy().into_owned()),
        xmp_digest: Some(blake3::hash(content.as_bytes()).to_hex().to_string()),
        sidecar_digest: Some(sidecar_digest),
        process_version,
        changes: translation.changes,
        warnings: translation.warnings,
        error,
    }
}

#[tauri::command]
pub fn preview_lightroom_xmp_edits(paths: Vec<String>) -> Vec<LightroomImportPreview> {
    paths.into_iter().map(build_preview).collect()
}

fn write_metadata_atomically(
    path: &Path,
    metadata: &crate::image_processing::ImageMetadata,
) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("Could not determine sidecar folder for {}", path.display()))?;
    let mut temporary = NamedTempFile::new_in(parent)
        .map_err(|error| format!("Could not create temporary sidecar: {error}"))?;
    let json = serde_json::to_vec_pretty(metadata)
        .map_err(|error| format!("Could not serialize sidecar: {error}"))?;
    temporary
        .write_all(&json)
        .and_then(|()| temporary.flush())
        .map_err(|error| format!("Could not write temporary sidecar: {error}"))?;
    temporary.persist(path).map_err(|error| {
        format!(
            "Could not replace sidecar {}: {}",
            path.display(),
            error.error
        )
    })?;
    Ok(())
}

#[tauri::command]
pub fn apply_approved_lightroom_xmp_edits(
    approvals: Vec<LightroomImportApproval>,
) -> Result<LightroomApplyResult, String> {
    let mut applied = 0;
    let mut skipped = 0;

    for approval in approvals {
        let (source_path, sidecar_path) = parse_virtual_path(&approval.path);
        if approval.path.contains("?vc=") {
            skipped += 1;
            continue;
        }
        let xmp_path = resolve_xmp_path(&source_path).ok_or_else(|| {
            format!(
                "The XMP sidecar for {} is no longer available.",
                approval.path
            )
        })?;
        let content = fs::read_to_string(&xmp_path)
            .map_err(|error| format!("Could not reread {}: {error}", xmp_path.display()))?;
        let digest = blake3::hash(content.as_bytes()).to_hex().to_string();
        if digest != approval.xmp_digest {
            return Err(format!(
                "The XMP sidecar for {} changed after preview. Review it again before applying.",
                approval.path
            ));
        }
        let parsed = parse_xmp(&content)?;
        let (mut metadata, sidecar_digest) = read_metadata_without_writing(&sidecar_path)?;
        if sidecar_digest != approval.sidecar_digest {
            return Err(format!(
                "The ThisIsRAW sidecar for {} changed after preview. Review it again before applying.",
                approval.path
            ));
        }
        let translation = translate(&parsed, &metadata.adjustments);
        if translation.changes.is_empty() {
            skipped += 1;
            continue;
        }
        merge_patch(&mut metadata.adjustments, &translation.patch);
        write_metadata_atomically(&sidecar_path, &metadata)?;
        applied += 1;
    }

    Ok(LightroomApplyResult { applied, skipped })
}

#[cfg(test)]
mod tests {
    use super::{
        LightroomImportApproval, apply_approved_lightroom_xmp_edits, merge_patch, parse_xmp,
        preview_lightroom_xmp_edits, translate,
    };
    use crate::image_processing::ImageMetadata;
    use serde_json::json;
    use std::fs;

    const SAMPLE_XMP: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/"
    crs:ProcessVersion="15.4" crs:Exposure2012="+1.25" crs:Contrast2012="12"
    crs:HueAdjustmentRed="-8" crs:Temperature="5350">
   <crs:ToneCurvePV2012><rdf:Seq><rdf:li>0, 0</rdf:li><rdf:li>128, 140</rdf:li><rdf:li>255, 255</rdf:li></rdf:Seq></crs:ToneCurvePV2012>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>"#;

    #[test]
    fn parses_attributes_and_curve_sequences() {
        let parsed = parse_xmp(SAMPLE_XMP).unwrap();
        assert_eq!(parsed.scalars.get("Exposure2012").unwrap(), "+1.25");
        assert_eq!(parsed.lists["ToneCurvePV2012"].len(), 3);
    }

    #[test]
    fn translation_is_partial_and_preserves_unrelated_adjustments() {
        let parsed = parse_xmp(SAMPLE_XMP).unwrap();
        let current = json!({
            "exposure": 0.0,
            "masks": [{"id": "keep-me"}],
            "hsl": {"reds": {"hue": 0, "saturation": 7, "luminance": 0}}
        });
        let translation = translate(&parsed, &current);
        let mut merged = current.clone();
        merge_patch(&mut merged, &translation.patch);

        assert_eq!(merged["exposure"], json!(1.25));
        assert_eq!(merged["contrast"], json!(12.0));
        assert_eq!(merged["hsl"]["reds"]["hue"], json!(-8.0));
        assert_eq!(merged["hsl"]["reds"]["saturation"], json!(7));
        assert_eq!(merged["masks"][0]["id"], json!("keep-me"));
        assert!(
            translation
                .warnings
                .iter()
                .any(|warning| warning.contains("white balance"))
        );
    }

    #[test]
    fn preview_is_read_only_and_approval_merges_existing_sidecar() {
        let folder = tempfile::tempdir().unwrap();
        let image = folder.path().join("photo.dng");
        let xmp = folder.path().join("photo.xmp");
        let sidecar = folder.path().join("photo.dng.tirdata");
        fs::write(&image, []).unwrap();
        fs::write(&xmp, SAMPLE_XMP).unwrap();
        let metadata = ImageMetadata {
            adjustments: json!({"exposure": 0.0, "masks": [{"id": "preserved"}]}),
            ..ImageMetadata::default()
        };
        fs::write(&sidecar, serde_json::to_vec_pretty(&metadata).unwrap()).unwrap();
        let original_sidecar = fs::read(&sidecar).unwrap();
        let original_xmp = fs::read(&xmp).unwrap();

        let mut previews = preview_lightroom_xmp_edits(vec![image.to_string_lossy().into_owned()]);
        let preview = previews.pop().unwrap();
        assert!(preview.error.is_none());
        assert!(!preview.changes.is_empty());
        assert_eq!(fs::read(&sidecar).unwrap(), original_sidecar);
        assert_eq!(fs::read(&xmp).unwrap(), original_xmp);

        let result = apply_approved_lightroom_xmp_edits(vec![LightroomImportApproval {
            path: image.to_string_lossy().into_owned(),
            xmp_digest: preview.xmp_digest.unwrap(),
            sidecar_digest: preview.sidecar_digest.unwrap(),
        }])
        .unwrap();
        assert_eq!(result.applied, 1);

        let updated: ImageMetadata = serde_json::from_slice(&fs::read(&sidecar).unwrap()).unwrap();
        assert_eq!(updated.adjustments["exposure"], json!(1.25));
        assert_eq!(updated.adjustments["masks"][0]["id"], json!("preserved"));
        assert_eq!(fs::read(&xmp).unwrap(), original_xmp);
    }
}
