//! Files of named tool presets (the Orbit Blend Pad's and Zone Color Grading's). The panels
//! build and clean the presets (`utils/blendPad.ts`, `utils/zoneTint.ts`); this only wraps
//! them with a file's format and version, and reads them back.

use serde_json::Value;

/// The version every preset file is written with.
pub const VERSION: u32 = 1;

/// Writes `presets` to a JSON file marked with `format`.
pub fn write(format: &str, presets: Vec<Value>, file_path: &str) -> Result<(), String> {
    let file = serde_json::json!({
        "format": format,
        "version": VERSION,
        "presets": presets,
    });
    let text = serde_json::to_string_pretty(&file)
        .map_err(|e| format!("Failed to write the presets: {e}"))?;
    std::fs::write(file_path, text).map_err(|e| format!("Failed to save {file_path}: {e}"))
}

/// The presets of a preset file: an exported file, a bare list, or a single preset. The
/// panel cleans every preset before it keeps any.
pub fn read(file_path: &str) -> Result<Vec<Value>, String> {
    let text = std::fs::read_to_string(file_path)
        .map_err(|e| format!("Failed to open {file_path}: {e}"))?;
    let value: Value =
        serde_json::from_str(&text).map_err(|e| format!("{file_path} is not valid JSON: {e}"))?;
    Ok(presets_in_file(value))
}

fn presets_in_file(value: Value) -> Vec<Value> {
    match value {
        Value::Array(presets) => presets,
        Value::Object(mut file) => match file.remove("presets") {
            Some(Value::Array(presets)) => presets,
            _ => vec![Value::Object(file)],
        },
        _ => Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn preset_files_round_trip_and_accept_lists_and_single_presets() {
        let preset = json!({ "id": "a", "name": "Moody" });
        let path = std::env::temp_dir().join(format!("tir-presets-{}.json", std::process::id()));
        let path_text = path.to_string_lossy().to_string();
        write("ThisIsRAW test presets", vec![preset.clone()], &path_text).unwrap();
        let written: Value =
            serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(written["format"], "ThisIsRAW test presets");
        assert_eq!(written["version"], VERSION);
        assert_eq!(read(&path_text).unwrap(), vec![preset.clone()]);
        std::fs::remove_file(&path).unwrap();

        assert_eq!(
            presets_in_file(json!([preset.clone()])),
            vec![preset.clone()]
        );
        assert_eq!(presets_in_file(preset.clone()), vec![preset]);
        assert!(presets_in_file(json!(3)).is_empty());
        assert!(read(&path_text).is_err());
    }
}
