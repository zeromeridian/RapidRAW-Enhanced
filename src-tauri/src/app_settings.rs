use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs;
use std::path::PathBuf;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager};

use crate::app_state::AppState;

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SortCriteria {
    pub key: String,
    pub order: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FilterCriteria {
    pub rating: i8,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rating_comparison: Option<String>,
    /// The file-type filter before 1.89.0. The frontend reads it once to fill
    /// `file_types`; it is still written ("all" by default) because older builds
    /// require it and would otherwise drop every setting.
    #[serde(default = "default_raw_status")]
    pub raw_status: String,
    /// The file types shown (`raw`, `jpeg`, `heif`, `other`); empty shows all.
    /// Absent in settings saved before 1.89.0.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub file_types: Option<Vec<String>>,
    #[serde(default)]
    pub edited_status: Option<String>,
    #[serde(default)]
    pub colors: Vec<String>,
    #[serde(default)]
    pub flags: Vec<String>,
}

impl Default for FilterCriteria {
    fn default() -> Self {
        Self {
            rating: 0,
            rating_comparison: None,
            raw_status: default_raw_status(),
            file_types: None,
            edited_status: Some("all".to_string()),
            colors: Vec::new(),
            flags: Vec::new(),
        }
    }
}

fn default_raw_status() -> String {
    "all".to_string()
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FolderTreeSort {
    pub key: String,
    pub order: String,
}

impl Default for FolderTreeSort {
    fn default() -> Self {
        Self {
            key: "name".to_string(),
            order: "asc".to_string(),
        }
    }
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LastFolderState {
    #[serde(default)]
    pub current_folder_path: Option<String>,
    #[serde(default)]
    pub expanded_folders: Vec<String>,
    #[serde(default)]
    pub active_album_id: Option<String>,
    #[serde(default)]
    pub active_keyword: Option<String>,
    #[serde(default)]
    pub expanded_album_groups: Vec<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct MyLens {
    pub maker: String,
    pub model: String,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct CustomAspectRatio {
    pub width: f64,
    pub height: f64,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum PasteMode {
    Merge,
    Replace,
}

pub fn all_available_adjustments() -> HashSet<String> {
    [
        "exposure",
        "brightness",
        "contrast",
        "curves",
        "pointCurves",
        "parametricCurve",
        "curveMode",
        "highlights",
        "shadows",
        "whites",
        "blacks",
        "toneMapper",
        "temperature",
        "tint",
        "monochrome",
        "saturation",
        "vibrance",
        "hsl",
        "hue",
        "colorGrading",
        "colorCalibration",
        "clarity",
        "structure",
        "dehaze",
        "sharpness",
        "sharpnessThreshold",
        "centré",
        "lumaNoiseReduction",
        "colorNoiseReduction",
        "chromaticAberrationRedCyan",
        "chromaticAberrationBlueYellow",
        "vignetteAmount",
        "vignetteFeather",
        "vignetteMidpoint",
        "vignetteRoundness",
        "grainAmount",
        "grainRoughness",
        "grainSize",
        "lutIntensity",
        "lutName",
        "lutPath",
        "lutSize",
        "lutData",
        "glowAmount",
        "glowHue",
        "glowSaturation",
        "halationAmount",
        "halationHue",
        "flareAmount",
        "motionBlurAmount",
        "motionBlurAngle",
        "motionBlurType",
        "motionBlurLayer",
        "motionBlurHighlights",
        "motionBlurDepthEnabled",
        "motionBlurDepth",
        "crop",
        "aspectRatio",
        "rotation",
        "flipHorizontal",
        "flipVertical",
        "orientationSteps",
        "transformAutoMode",
        "transformAutoStrength",
        "guidedPerspective",
        "transformDistortion",
        "transformVertical",
        "transformHorizontal",
        "transformRotate",
        "transformAspect",
        "transformScale",
        "transformXOffset",
        "transformYOffset",
        "transformConstrainCrop",
        "masks",
        "lensCorrectionMode",
        "lensMaker",
        "lensModel",
        "lensDistortionAmount",
        "lensVignetteAmount",
        "lensTcaAmount",
        "lensDistortionEnabled",
        "lensTcaEnabled",
        "lensVignetteEnabled",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect()
}

pub fn default_included_adjustments() -> HashSet<String> {
    let mut defaults = all_available_adjustments();

    let off_by_default = [
        "crop",
        "aspectRatio",
        "rotation",
        "flipHorizontal",
        "flipVertical",
        "orientationSteps",
        "transformAutoMode",
        "transformAutoStrength",
        "guidedPerspective",
        "transformDistortion",
        "transformVertical",
        "transformHorizontal",
        "transformRotate",
        "transformAspect",
        "transformScale",
        "transformXOffset",
        "transformYOffset",
        "transformConstrainCrop",
        "masks",
        "lensCorrectionMode",
        "lensMaker",
        "lensModel",
        "lensDistortionAmount",
        "lensVignetteAmount",
        "lensTcaAmount",
        "lensDistortionEnabled",
        "lensTcaEnabled",
        "lensVignetteEnabled",
    ];

    for item in off_by_default.iter() {
        defaults.remove(*item);
    }

    defaults
}

/// How the Develop adjustment panels are arranged; the frontend reconciles the ids
/// against its known sections and tools, so unknown ids are ignored.
#[derive(Serialize, Deserialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct AdjustmentLayout {
    pub section_order: Vec<String>,
    pub tool_order: HashMap<String, Vec<String>>,
    pub open_sections: BTreeMap<String, bool>,
    /// Starred sections, tools and controls in the order of the Favorites panel.
    pub favorites: Vec<String>,
    /// `ADJUSTMENT_LAYOUT_VERSION` once converted; 0 (absent) is the layout of the old sections.
    pub version: u32,
}

/// Version 1 (`1.66.0`): the regrouped sections Light, Curves, Color, Look, Light & Atmosphere,
/// Blur, Detail, Finish, replacing Basic, Curves, Color, Details, Effects. Version 2 (`1.69.0`):
/// Chromatic Aberration left Detail for the Lens & Geometry panel.
const ADJUSTMENT_LAYOUT_VERSION: u32 = 2;

const OLD_SECTION_ORDER: [&str; 5] = ["basic", "curves", "color", "details", "effects"];

/// The old sections' tools in their default order.
const OLD_SECTION_TOOLS: &[(&str, &[&str])] = &[
    (
        "color",
        &[
            "blackAndWhite",
            "whiteBalance",
            "colorPresence",
            "hue",
            "colorGrading",
            "colorMixer",
            "colorCalibration",
        ],
    ),
    (
        "details",
        &[
            "sharpening",
            "presence",
            "noiseReduction",
            "aiDenoise",
            "chromaticAberration",
        ],
    ),
    (
        "effects",
        &[
            "glow",
            "halation",
            "lightFlares",
            "lensBlur",
            "relight",
            "fog",
            "lut",
            "gaussianBlur",
            "motionBlur",
            "vignette",
            "grain",
        ],
    ),
];

/// The new sections whose tools all come from one old section, with that section and their
/// tools; a reordered old section passes its order on. Light and Look gather tools from several
/// sections and start in their default order.
const SINGLE_SOURCE_SECTIONS: &[(&str, &str, &[&str])] = &[
    (
        "color",
        "color",
        &["colorPresence", "hue", "colorMixer", "colorCalibration"],
    ),
    (
        "lightAtmosphere",
        "effects",
        &["relight", "fog", "glow", "halation", "lightFlares"],
    ),
    (
        "blur",
        "effects",
        &["lensBlur", "motionBlur", "gaussianBlur"],
    ),
    (
        "detail",
        "details",
        &[
            "sharpening",
            "noiseReduction",
            "aiDenoise",
            "chromaticAberration",
        ],
    ),
    ("finish", "effects", &["vignette", "grain"]),
];

/// The new sections that take an old section's place (and its open state).
fn regrouped_sections(old: &str) -> &'static [&'static str] {
    match old {
        "basic" => &["light"],
        "curves" => &["curves"],
        "color" => &["color", "look"],
        "details" => &["detail"],
        "effects" => &["lightAtmosphere", "blur", "finish"],
        _ => &[],
    }
}

/// What a starred old section becomes: the new sections in its place, then each tool that moved
/// elsewhere, so every starred tool stays in Favorites.
fn regrouped_favorite(favorite: &str) -> Vec<String> {
    let entries: &[&str] = match favorite {
        "section:basic" => &["section:light"],
        "section:color" => &[
            "section:color",
            "tool:blackAndWhite",
            "tool:whiteBalance",
            "tool:colorGrading",
        ],
        "section:details" => &["section:detail", "tool:presence"],
        "section:effects" => &[
            "section:lightAtmosphere",
            "section:blur",
            "section:finish",
            "tool:lut",
        ],
        _ => return vec![favorite.to_string()],
    };
    entries.iter().map(|entry| entry.to_string()).collect()
}

/// Brings a saved layout up to `ADJUSTMENT_LAYOUT_VERSION`, one version at a time, once; true
/// when it changed.
fn migrate_adjustment_layout(layout: &mut AdjustmentLayout) -> bool {
    if layout.version >= ADJUSTMENT_LAYOUT_VERSION {
        return false;
    }
    if layout.version < 1 {
        regroup_sections(layout);
    }
    if layout.version < 2 {
        move_chromatic_aberration(layout);
    }
    layout.version = ADJUSTMENT_LAYOUT_VERSION;
    true
}

/// Version 2: a starred Detail section keeps its chromatic aberration as a favourite of its own,
/// right after it (unless it is starred already).
fn move_chromatic_aberration(layout: &mut AdjustmentLayout) {
    const TOOL: &str = "tool:chromaticAberration";
    if layout.favorites.iter().any(|favorite| favorite == TOOL) {
        return;
    }
    if let Some(index) = layout
        .favorites
        .iter()
        .position(|favorite| favorite == "section:detail")
    {
        layout.favorites.insert(index + 1, TOOL.to_string());
    }
}

/// Version 1: converts a layout of the old sections to the regrouped ones.
fn regroup_sections(layout: &mut AdjustmentLayout) {
    let is_default_order = layout.section_order.is_empty()
        || layout
            .section_order
            .iter()
            .map(String::as_str)
            .eq(OLD_SECTION_ORDER);
    let mut section_order: Vec<String> = Vec::new();
    if !is_default_order {
        for section in layout
            .section_order
            .iter()
            .flat_map(|old| regrouped_sections(old))
        {
            if !section_order.iter().any(|s| s == section) {
                section_order.push(section.to_string());
            }
        }
    }

    let mut tool_order = HashMap::new();
    for (section, source, tools) in SINGLE_SOURCE_SECTIONS {
        let default = OLD_SECTION_TOOLS
            .iter()
            .find(|(old, _)| old == source)
            .map_or(&[][..], |(_, tools)| tools);
        let Some(saved) = layout
            .tool_order
            .get(*source)
            .filter(|saved| !saved.iter().map(String::as_str).eq(default.iter().copied()))
        else {
            continue;
        };
        let order: Vec<String> = saved
            .iter()
            .filter(|tool| tools.contains(&tool.as_str()))
            .cloned()
            .collect();
        if !order.is_empty() {
            tool_order.insert(section.to_string(), order);
        }
    }

    let mut open_sections = BTreeMap::new();
    for (old, is_open) in &layout.open_sections {
        for section in regrouped_sections(old) {
            open_sections.insert(section.to_string(), *is_open);
        }
    }

    let mut favorites: Vec<String> = Vec::new();
    for favorite in &layout.favorites {
        for (index, entry) in regrouped_favorite(favorite).into_iter().enumerate() {
            // A tool the section adds that was also starred on its own keeps its own place.
            let is_starred_alone = index > 0 && layout.favorites.contains(&entry);
            if !is_starred_alone && !favorites.contains(&entry) {
                favorites.push(entry);
            }
        }
    }

    *layout = AdjustmentLayout {
        section_order,
        tool_order,
        open_sections,
        favorites,
        version: 1,
    };
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CopyPasteSettings {
    pub mode: PasteMode,
    #[serde(default = "default_included_adjustments")]
    pub included_adjustments: HashSet<String>,
    #[serde(default)]
    pub known_adjustments: HashSet<String>,
    #[serde(default)]
    pub auto_sync: bool,
}

impl Default for CopyPasteSettings {
    fn default() -> Self {
        Self {
            mode: PasteMode::Merge,
            included_adjustments: default_included_adjustments(),
            known_adjustments: all_available_adjustments(),
            auto_sync: false,
        }
    }
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ExportPreset {
    pub id: String,
    pub name: String,
    pub file_format: String,
    pub jpeg_quality: u8,
    #[serde(default)]
    pub tiff_bit_depth: Option<u8>,
    #[serde(default)]
    pub dpi: Option<u16>,
    pub enable_resize: bool,
    pub resize_mode: String,
    pub resize_value: u32,
    pub dont_enlarge: bool,
    pub keep_metadata: bool,
    #[serde(default)]
    pub preserve_timestamps: bool,
    pub strip_gps: bool,
    pub filename_template: String,
    pub enable_watermark: bool,
    pub watermark_path: Option<String>,
    pub watermark_anchor: Option<String>,
    pub watermark_scale: u32,
    pub watermark_spacing: u32,
    pub watermark_opacity: u32,
    #[serde(default)]
    pub export_masks: Option<bool>,
    #[serde(default)]
    pub preserve_folders: Option<bool>,
    #[serde(default)]
    pub export_to_source_folder: Option<bool>,
    #[serde(default)]
    pub subfolder: Option<String>,
    #[serde(default)]
    pub enable_pad: Option<bool>,
    #[serde(default)]
    pub pad_ratio_width: Option<f32>,
    #[serde(default)]
    pub pad_ratio_height: Option<f32>,
    #[serde(default)]
    pub pad_color: Option<String>,
    #[serde(default)]
    pub enable_border: Option<bool>,
    #[serde(default)]
    pub border_basis: Option<String>,
    #[serde(default)]
    pub border_horizontal_percent: Option<f32>,
    #[serde(default)]
    pub border_vertical_percent: Option<f32>,
    #[serde(default)]
    pub border_color: Option<String>,
    #[serde(default)]
    pub last_export_path: Option<String>,
}

/// The Custom Texts as saved: a list, or one text from before there were three (or null).
fn text_or_texts<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<Vec<String>, D::Error> {
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum Saved {
        Texts(Vec<String>),
        Text(String),
    }
    Ok(match Option::<Saved>::deserialize(deserializer)? {
        Some(Saved::Texts(texts)) => texts,
        Some(Saved::Text(text)) => vec![text],
        None => Vec::new(),
    })
}

pub fn default_export_presets() -> Vec<ExportPreset> {
    vec![
        ExportPreset {
            id: "default-hq".to_string(),
            name: "High Quality".to_string(),
            file_format: "jpeg".to_string(),
            jpeg_quality: 95,
            tiff_bit_depth: Some(16),
            dpi: Some(300),
            enable_resize: false,
            resize_mode: "longEdge".to_string(),
            resize_value: 2048,
            dont_enlarge: true,
            keep_metadata: true,
            preserve_timestamps: false,
            strip_gps: false,
            filename_template: "{filename}".to_string(),
            enable_watermark: false,
            watermark_path: None,
            watermark_anchor: Some("bottomRight".to_string()),
            watermark_scale: 10,
            watermark_spacing: 5,
            watermark_opacity: 75,
            export_masks: Some(false),
            preserve_folders: Some(false),
            export_to_source_folder: Some(false),
            subfolder: Some(String::new()),
            enable_pad: Some(false),
            pad_ratio_width: Some(1.0),
            pad_ratio_height: Some(1.0),
            pad_color: Some("#ffffff".to_string()),
            enable_border: Some(false),
            border_basis: Some("longEdge".to_string()),
            border_horizontal_percent: Some(2.0),
            border_vertical_percent: Some(2.0),
            border_color: Some("#ffffff".to_string()),
            last_export_path: None,
        },
        ExportPreset {
            id: "default-fast".to_string(),
            name: "Fast (Web)".to_string(),
            file_format: "jpeg".to_string(),
            jpeg_quality: 80,
            tiff_bit_depth: Some(16),
            dpi: Some(300),
            enable_resize: true,
            resize_mode: "width".to_string(),
            resize_value: 2048,
            dont_enlarge: true,
            keep_metadata: false,
            preserve_timestamps: false,
            strip_gps: true,
            filename_template: "{filename}_web".to_string(),
            enable_watermark: false,
            watermark_path: None,
            watermark_anchor: Some("bottomRight".to_string()),
            watermark_scale: 10,
            watermark_spacing: 5,
            watermark_opacity: 75,
            export_masks: Some(false),
            preserve_folders: Some(false),
            export_to_source_folder: Some(false),
            subfolder: Some(String::new()),
            enable_pad: Some(false),
            pad_ratio_width: Some(1.0),
            pad_ratio_height: Some(1.0),
            pad_color: Some("#ffffff".to_string()),
            enable_border: Some(false),
            border_basis: Some("longEdge".to_string()),
            border_horizontal_percent: Some(2.0),
            border_vertical_percent: Some(2.0),
            border_color: Some("#ffffff".to_string()),
            last_export_path: None,
        },
    ]
}

pub fn default_linear_raw_mode() -> String {
    "auto".to_string()
}

/// Number of keywords in a keyword set, one per Option/Alt+1…9 shortcut.
pub const KEYWORD_SET_SIZE: usize = 9;

/// A named group of nine keyword paths (stored without the `user:` prefix) that the
/// Tagging panel and the Option/Alt+1…9 shortcuts apply; empty slots are empty strings.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct KeywordSet {
    pub id: String,
    pub name: String,
    pub keywords: Vec<String>,
}

impl KeywordSet {
    fn new(id: &str, name: &str, keywords: &[&str]) -> Self {
        let mut keywords: Vec<String> = keywords.iter().map(|k| k.to_string()).collect();
        keywords.resize(KEYWORD_SET_SIZE, String::new());
        Self {
            id: id.to_string(),
            name: name.to_string(),
            keywords,
        }
    }
}

/// The starting keyword sets: the former tagging shortcuts in sets of nine, then examples.
fn default_keyword_sets(tagging_shortcuts: &[String]) -> Vec<KeywordSet> {
    let shortcuts: Vec<&str> = tagging_shortcuts
        .iter()
        .map(|shortcut| shortcut.trim())
        .filter(|shortcut| !shortcut.is_empty())
        .collect();
    let mut sets: Vec<KeywordSet> = shortcuts
        .chunks(KEYWORD_SET_SIZE)
        .enumerate()
        .map(|(index, keywords)| {
            let suffix = if index == 0 {
                String::new()
            } else {
                format!(" {}", index + 1)
            };
            KeywordSet::new(
                &format!("my-keywords{}", suffix.replace(' ', "-")),
                &format!("My Keywords{suffix}"),
                keywords,
            )
        })
        .collect();
    sets.push(KeywordSet::new(
        "outdoor",
        "Outdoor",
        &[
            "landscape",
            "nature",
            "wildlife",
            "mountains",
            "water",
            "sky",
            "sunset",
            "flowers",
            "macro",
        ],
    ));
    sets.push(KeywordSet::new(
        "portrait",
        "Portrait",
        &[
            "portrait", "headshot", "family", "couple", "child", "group", "studio", "outdoor",
            "candid",
        ],
    ));
    sets.push(KeywordSet::new(
        "event",
        "Event",
        &[
            "event",
            "wedding",
            "ceremony",
            "reception",
            "party",
            "concert",
            "speech",
            "guests",
            "details",
        ],
    ));
    sets
}

/// Creates the keyword sets once, from the tagging shortcuts they replace.
fn migrate_keyword_sets(settings: &mut AppSettings) -> bool {
    if settings.keyword_sets.is_some() {
        return false;
    }
    settings.keyword_sets = Some(default_keyword_sets(
        settings.tagging_shortcuts.as_deref().unwrap_or_default(),
    ));
    true
}

pub fn default_tagging_shortcuts_option() -> Option<Vec<String>> {
    Some(vec![
        "portrait".to_string(),
        "landscape".to_string(),
        "architecture".to_string(),
        "travel".to_string(),
        "street".to_string(),
        "family".to_string(),
        "nature".to_string(),
        "food".to_string(),
        "event".to_string(),
    ])
}

pub fn default_adjustment_visibility() -> HashMap<String, bool> {
    let mut map = HashMap::new();
    map.insert("sharpening".to_string(), true);
    map.insert("presence".to_string(), true);
    map.insert("noiseReduction".to_string(), true);
    map.insert("chromaticAberration".to_string(), false);
    map.insert("vignette".to_string(), true);
    map.insert("colorCalibration".to_string(), false);
    map.insert("grain".to_string(), true);
    map
}

pub fn default_open_tree_sections() -> Vec<String> {
    vec!["current".to_string()]
}

const fn default_true() -> bool {
    true
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub last_root_path: Option<String>,
    #[serde(default)]
    pub root_folders: Vec<String>,
    #[serde(default)]
    pub pinned_folders: Vec<String>,
    pub editor_preview_resolution: Option<u32>,
    #[serde(default)]
    pub thumbnail_resolution: Option<u32>,
    #[serde(default)]
    pub enable_zoom_hifi: Option<bool>,
    #[serde(default)]
    pub use_full_dpi_rendering: Option<bool>,
    #[serde(default)]
    pub high_res_zoom_multiplier: Option<f32>,
    #[serde(default)]
    pub enable_live_previews: Option<bool>,
    #[serde(default)]
    pub live_preview_quality: Option<String>,
    pub sort_criteria: Option<SortCriteria>,
    pub filter_criteria: Option<FilterCriteria>,
    pub theme: Option<String>,
    #[serde(default)]
    pub font_family: Option<String>,
    #[serde(default)]
    pub panel_density: Option<String>,
    pub decorations: Option<bool>,
    #[serde(alias = "comfyuiAddress")]
    pub ai_connector_address: Option<String>,
    pub last_folder_state: Option<LastFolderState>,
    pub ui_visibility: Option<Value>,
    pub enable_ai_tagging: Option<bool>,
    pub tagging_thread_count: Option<u32>,
    /// Replaced by `keyword_sets`; read only to migrate older settings.
    #[serde(default = "default_tagging_shortcuts_option", skip_serializing)]
    pub tagging_shortcuts: Option<Vec<String>>,
    #[serde(default)]
    pub keyword_sets: Option<Vec<KeywordSet>>,
    #[serde(default)]
    pub active_keyword_set: Option<String>,
    #[serde(default)]
    pub custom_ai_tags: Option<Vec<String>>,
    #[serde(default)]
    pub ai_tag_count: Option<u32>,
    pub thumbnail_size: Option<String>,
    pub thumbnail_aspect_ratio: Option<String>,
    pub ai_provider: Option<String>,
    #[serde(default = "default_true")]
    pub ai_gpu_acceleration: bool,
    #[serde(default = "default_adjustment_visibility")]
    pub adjustment_visibility: HashMap<String, bool>,
    #[serde(default)]
    pub adjustment_layout: AdjustmentLayout,
    #[serde(default = "default_open_tree_sections")]
    pub open_tree_sections: Vec<String>,
    #[serde(default)]
    pub copy_paste_settings: CopyPasteSettings,
    #[serde(default)]
    pub raw_highlight_compression: Option<f32>,
    #[serde(default)]
    pub processing_backend: Option<String>,
    #[serde(default)]
    pub linux_gpu_optimization: Option<bool>,
    #[serde(default)]
    pub linux_gpu_optimization_migrated_v1: Option<bool>,
    #[serde(default)]
    pub library_view_mode: Option<String>,
    /// Whether the Recursive view shows a header per subfolder; absent means on.
    #[serde(default)]
    pub group_recursive_by_folder: Option<bool>,
    #[serde(default = "default_export_presets")]
    pub export_presets: Vec<ExportPreset>,
    #[serde(default)]
    pub my_lenses: Option<Vec<MyLens>>,
    #[serde(default = "default_true")]
    pub auto_apply_lens_profile: bool,
    #[serde(default)]
    pub enable_folder_image_counts: Option<bool>,
    #[serde(default)]
    pub hide_empty_folders: Option<bool>,
    #[serde(default)]
    pub display_edit_icon: Option<bool>,
    #[serde(default = "default_linear_raw_mode")]
    pub linear_raw_mode: String,
    #[serde(default)]
    pub enable_xmp_sync: Option<bool>,
    #[serde(default)]
    pub create_xmp_if_missing: Option<bool>,
    #[serde(default)]
    pub is_waveform_visible: Option<bool>,
    #[serde(default)]
    pub waveform_height: Option<u32>,
    #[serde(default)]
    pub active_waveform_channel: Option<String>,
    #[serde(default)]
    pub use_wgpu_renderer: Option<bool>,
    #[serde(default)]
    pub canvas_input_mode: Option<String>,
    #[serde(default)]
    pub editor_neutral_grey_bg: Option<bool>,
    #[serde(default)]
    pub zoom_photo_to_pixel_click: Option<bool>,
    #[serde(default)]
    pub zoom_speed_multiplier: Option<f32>,
    #[serde(default)]
    pub keybinds: HashMap<String, Vec<String>>,
    /// Sliders that Speed Edit cycles through; `None` uses the frontend's default list.
    #[serde(default)]
    pub speed_edit_adjustments: Option<Vec<String>>,
    #[serde(default)]
    pub thumbnail_worker_threads: Option<u32>,
    #[serde(default)]
    pub image_cache_size: Option<u32>,
    #[serde(default)]
    pub tonemapper_override_enabled: Option<bool>,
    #[serde(default)]
    pub default_raw_tonemapper: Option<String>,
    #[serde(default)]
    pub default_non_raw_tonemapper: Option<String>,
    #[serde(default)]
    pub enable_focus_mode: Option<bool>,
    #[serde(default)]
    pub folder_icons: Option<HashMap<String, String>>,
    #[serde(default)]
    pub raw_preprocessing_color_nr: Option<f32>,
    #[serde(default)]
    pub raw_preprocessing_sharpening: Option<f32>,
    #[serde(default)]
    pub apply_preprocessing_to_non_raws: Option<bool>,
    #[serde(default)]
    pub exif_overlay: Option<String>,
    #[serde(default)]
    pub language: Option<String>,
    #[serde(default)]
    pub folder_tree_sort: Option<FolderTreeSort>,
    #[serde(default)]
    pub library_display_mode: Option<String>,
    #[serde(default)]
    pub grouping: Option<String>,
    #[serde(default)]
    pub require_matching_exif: Option<bool>,
    #[serde(default)]
    pub group_edited_files: Option<bool>,
    #[serde(default, skip_serializing)] // legacy
    #[allow(dead_code)]
    pub group_associated_files: Option<bool>,
    #[serde(default, skip_serializing)] // legacy
    #[allow(dead_code)]
    pub group_preferred_type: Option<String>,
    #[serde(default)]
    pub always_decode_raw_thumbnails: Option<bool>,
    #[serde(default)]
    pub custom_aspect_ratios: Vec<CustomAspectRatio>,
    #[serde(default)]
    pub bottom_toolbar_visibility: HashMap<String, bool>,
    #[serde(default)]
    pub image_stacks: Option<Value>,
    #[serde(default = "default_true")]
    pub auto_stack_created_images: bool,
    #[serde(default = "default_true")]
    pub expand_auto_created_stacks: bool,
    #[serde(default)]
    pub skip_splash_screen: bool,
    #[serde(default)]
    pub export_file_suffix_enabled: bool,
    #[serde(default)]
    pub export_file_suffix: String,
    #[serde(default)]
    pub copy_name_suffix_enabled: bool,
    #[serde(default)]
    pub copy_name_suffix: String,
    #[serde(default)]
    pub tone_curve_presets: Vec<Value>,
    /// Named Orbit Blend Pad setups (`BlendPadPreset` in `utils/blendPad.ts`), cleaned there.
    #[serde(default)]
    pub blend_pad_presets: Vec<Value>,
    /// Named Zone Color Grading looks (`ZoneTintPreset` in `utils/zoneTint.ts`), cleaned
    /// there. `None` until first changed, so the panel offers its starter presets; an empty
    /// list means every preset was deleted.
    #[serde(default)]
    pub zone_tint_presets: Option<Vec<Value>>,
    /// Whether Zone Color Grading shows its Advanced controls (a view switch for every photo).
    #[serde(default)]
    pub zone_tint_advanced: bool,
    /// Named file-name templates shared by rename, export and import (`FilenameTemplate` in
    /// `utils/filenameTemplates.ts`), cleaned there. `None` until first changed, so the
    /// starter templates are offered; an empty list means every template was deleted.
    #[serde(default)]
    pub filename_templates: Option<Vec<Value>>,
    /// The Custom Texts (`{text}`, `{text2}`, `{text3}`) last used in rename, export or
    /// import, offered when no saved template brings its own. Also read from the single
    /// text that `1.76.3` (`renameCustomText`) and `1.77.0` (`filenameCustomText`) kept.
    #[serde(
        default,
        alias = "filenameCustomText",
        alias = "renameCustomText",
        deserialize_with = "text_or_texts"
    )]
    pub filename_custom_texts: Vec<String>,
    /// The Import dialog's last choices (`LastImportSettings` in
    /// `components/modals/ImportSettingsModal.tsx`), cleaned there.
    #[serde(default)]
    pub last_import_settings: Option<Value>,
    /// Whether connecting a memory card or camera drive opens the Import dialog; absent means on.
    #[serde(default)]
    pub import_on_card_connect: Option<bool>,
    /// Whether the Adjustments panel shows the Favorites instead of every section.
    #[serde(default)]
    pub show_favorite_adjustments: bool,
    #[serde(default)]
    pub left_panel_width: Option<u32>,
    #[serde(default)]
    pub right_panel_width: Option<u32>,
    #[serde(default)]
    pub catalog_directory: Option<String>,
    #[serde(default)]
    pub lights_out_dim_level: Option<u8>,
    #[serde(default)]
    pub lights_out_screen_color: Option<String>,
    #[serde(default)]
    pub lights_out_border_width: Option<u8>,
    #[serde(default)]
    pub lights_out_border_color: Option<String>,
    #[serde(default)]
    pub external_editors: Vec<ExternalEditor>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalEditor {
    pub id: String,
    pub name: String,
    pub path: String,
    /// The copy to render for this editor; `None` asks each time.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub format: Option<ExternalEditFormat>,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ExternalEditFormat {
    Tiff,
    Jpeg,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            last_root_path: None,
            root_folders: Vec::new(),
            pinned_folders: Vec::new(),
            thumbnail_resolution: Some(720),
            #[cfg(target_os = "android")]
            editor_preview_resolution: Some(1280),
            #[cfg(not(target_os = "android"))]
            editor_preview_resolution: Some(1920),
            enable_zoom_hifi: Some(true),
            use_full_dpi_rendering: Some(false),
            enable_live_previews: Some(true),
            live_preview_quality: Some("high".to_string()),
            sort_criteria: None,
            filter_criteria: None,
            theme: Some("dark".to_string()),
            font_family: None,
            panel_density: None,
            decorations: Some(false),
            ai_connector_address: None,
            last_folder_state: None,
            ui_visibility: None,
            enable_ai_tagging: Some(false),
            tagging_thread_count: Some(3),
            tagging_shortcuts: default_tagging_shortcuts_option(),
            keyword_sets: None,
            active_keyword_set: None,
            custom_ai_tags: Some(Vec::new()),
            ai_tag_count: Some(10),
            #[cfg(target_os = "android")]
            thumbnail_size: Some("small".to_string()),
            #[cfg(not(target_os = "android"))]
            thumbnail_size: Some("medium".to_string()),
            thumbnail_aspect_ratio: Some("cover".to_string()),
            ai_provider: Some("cpu".to_string()),
            ai_gpu_acceleration: true,
            adjustment_visibility: default_adjustment_visibility(),
            adjustment_layout: AdjustmentLayout::default(),
            open_tree_sections: default_open_tree_sections(),
            copy_paste_settings: CopyPasteSettings::default(),
            raw_highlight_compression: Some(2.5),
            processing_backend: Some("auto".to_string()),
            linux_gpu_optimization: Some(false),
            linux_gpu_optimization_migrated_v1: Some(true),
            library_view_mode: Some("flat".to_string()),
            group_recursive_by_folder: Some(true),
            export_presets: default_export_presets(),
            my_lenses: Some(Vec::new()),
            auto_apply_lens_profile: true,
            #[cfg(target_os = "android")]
            high_res_zoom_multiplier: Some(0.75),
            #[cfg(not(target_os = "android"))]
            high_res_zoom_multiplier: Some(1.0),
            enable_folder_image_counts: Some(false),
            hide_empty_folders: Some(false),
            display_edit_icon: Some(true),
            linear_raw_mode: default_linear_raw_mode(),
            enable_xmp_sync: Some(true),
            create_xmp_if_missing: Some(false),
            is_waveform_visible: Some(false),
            waveform_height: Some(220),
            active_waveform_channel: Some("luma".to_string()),
            #[cfg(any(target_os = "linux", target_os = "android"))]
            use_wgpu_renderer: Some(false),
            #[cfg(not(any(target_os = "linux", target_os = "android")))]
            use_wgpu_renderer: Some(true),
            canvas_input_mode: Some("mouse".to_string()),
            editor_neutral_grey_bg: Some(false),
            zoom_photo_to_pixel_click: Some(false),
            zoom_speed_multiplier: Some(1.0),
            keybinds: HashMap::new(),
            speed_edit_adjustments: None,
            #[cfg(target_os = "android")]
            thumbnail_worker_threads: Some(2),
            #[cfg(not(target_os = "android"))]
            thumbnail_worker_threads: Some(4),
            #[cfg(target_os = "android")]
            image_cache_size: Some(2),
            #[cfg(not(target_os = "android"))]
            image_cache_size: Some(5),
            tonemapper_override_enabled: Some(false),
            default_raw_tonemapper: Some(crate::tone_mapping::TONE_MAPPER_AGX.to_string()),
            default_non_raw_tonemapper: Some("basic".to_string()),
            enable_focus_mode: Some(false),
            folder_icons: Some(HashMap::new()),
            raw_preprocessing_color_nr: Some(0.5),
            raw_preprocessing_sharpening: Some(0.35),
            apply_preprocessing_to_non_raws: Some(false),
            exif_overlay: Some("off".to_string()),
            language: Some("en".to_string()),
            folder_tree_sort: Some(FolderTreeSort::default()),
            library_display_mode: Some("grid".to_string()),
            grouping: Some("off".to_string()),
            require_matching_exif: Some(false),
            group_edited_files: Some(true),
            group_associated_files: Some(false),
            group_preferred_type: Some("raw".to_string()),
            always_decode_raw_thumbnails: Some(false),
            custom_aspect_ratios: Vec::new(),
            bottom_toolbar_visibility: HashMap::new(),
            image_stacks: None,
            auto_stack_created_images: true,
            expand_auto_created_stacks: true,
            skip_splash_screen: false,
            export_file_suffix_enabled: false,
            export_file_suffix: String::new(),
            copy_name_suffix_enabled: false,
            copy_name_suffix: String::new(),
            tone_curve_presets: Vec::new(),
            blend_pad_presets: Vec::new(),
            zone_tint_presets: None,
            zone_tint_advanced: false,
            filename_templates: None,
            filename_custom_texts: Vec::new(),
            last_import_settings: None,
            import_on_card_connect: None,
            show_favorite_adjustments: false,
            left_panel_width: None,
            right_panel_width: None,
            catalog_directory: None,
            lights_out_dim_level: None,
            lights_out_screen_color: None,
            lights_out_border_width: None,
            lights_out_border_color: None,
            external_editors: Vec::new(),
        }
    }
}

pub fn get_settings_path(app_handle: &AppHandle) -> Result<PathBuf, String> {
    let settings_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;

    if !settings_dir.exists() {
        fs::create_dir_all(&settings_dir).map_err(|e| e.to_string())?;
    }

    Ok(settings_dir.join("settings.json"))
}

/// The current settings without copying them. They are read from disk and migrated once,
/// then served from memory; `save_settings` replaces them.
pub fn settings_snapshot(app_handle: &AppHandle) -> Result<Arc<AppSettings>, String> {
    let Some(state) = app_handle.try_state::<AppState>() else {
        return read_settings_from_disk(app_handle).map(Arc::new);
    };
    // Held while reading, so concurrent first readers do not migrate the file twice.
    let mut cached = state.settings.lock().unwrap();
    if let Some(settings) = cached.as_ref() {
        return Ok(Arc::clone(settings));
    }
    let settings = Arc::new(read_settings_from_disk(app_handle)?);
    *cached = Some(Arc::clone(&settings));
    Ok(settings)
}

#[tauri::command]
pub fn load_settings(app_handle: AppHandle) -> Result<AppSettings, String> {
    settings_snapshot(&app_handle).map(|settings| (*settings).clone())
}

fn read_settings_from_disk(app_handle: &AppHandle) -> Result<AppSettings, String> {
    let path = get_settings_path(app_handle)?;

    let mut settings: AppSettings = if path.exists() {
        let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        serde_json::from_str(&content).unwrap_or_default()
    } else {
        AppSettings::default()
    };

    if migrate_settings(&mut settings)
        && let Ok(json_string) = serde_json::to_string_pretty(&settings)
    {
        let _ = crate::file_management::write_file_atomically(&path, json_string.as_bytes());
    }

    Ok(settings)
}

/// Brings settings written by an older version up to date; true when anything changed.
/// Idempotent, so it also normalizes every saved document.
fn migrate_settings(settings: &mut AppSettings) -> bool {
    let all_current_keys = all_available_adjustments();
    let default_included = default_included_adjustments();
    let mut settings_modified = false;

    if settings.root_folders.is_empty()
        && let Some(last) = &settings.last_root_path
    {
        settings.root_folders.push(last.clone());
        settings_modified = true;
    }

    #[cfg(target_os = "linux")]
    if !settings.linux_gpu_optimization_migrated_v1.unwrap_or(false) {
        if settings.linux_gpu_optimization == Some(true) {
            settings.linux_gpu_optimization = Some(false);
        }
        settings.linux_gpu_optimization_migrated_v1 = Some(true);
        settings_modified = true;
    }

    let is_first_migration = settings.copy_paste_settings.known_adjustments.is_empty();

    if is_first_migration {
        settings.copy_paste_settings.included_adjustments = default_included;
        settings.copy_paste_settings.known_adjustments = all_current_keys.clone();
        settings_modified = true;
    } else {
        let new_features: Vec<String> = all_current_keys
            .difference(&settings.copy_paste_settings.known_adjustments)
            .cloned()
            .collect();

        if !new_features.is_empty() {
            for feature in new_features {
                if default_included.contains(&feature) {
                    settings
                        .copy_paste_settings
                        .included_adjustments
                        .insert(feature.clone());
                }
                settings
                    .copy_paste_settings
                    .known_adjustments
                    .insert(feature);
            }
            settings_modified = true;
        }
    }

    settings_modified |= migrate_keyword_sets(settings);
    settings_modified |= migrate_adjustment_layout(&mut settings.adjustment_layout);

    settings_modified
}

#[tauri::command]
pub fn save_settings(mut settings: AppSettings, app_handle: AppHandle) -> Result<(), String> {
    let previous_gpu_acceleration = settings_snapshot(&app_handle)
        .map(|previous| previous.ai_gpu_acceleration)
        .ok();
    // Saved settings used to be migrated by the next read from disk; the cache skips that read.
    migrate_settings(&mut settings);
    let path = get_settings_path(&app_handle)?;
    let json_string = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    crate::file_management::write_file_atomically(&path, json_string.as_bytes())?;

    let state = app_handle.state::<AppState>();
    let cache_size = settings.image_cache_size.unwrap_or(5) as usize;
    state
        .decoded_image_cache
        .lock()
        .unwrap()
        .set_capacity(cache_size);

    if previous_gpu_acceleration != Some(settings.ai_gpu_acceleration) {
        crate::ai_processing::reset_ai_sessions(&state.ai_state);
    }
    *state.settings.lock().unwrap() = Some(Arc::new(settings));
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{AppSettings, KEYWORD_SET_SIZE, migrate_keyword_sets, migrate_settings};
    use serde_json::json;

    #[test]
    fn migrated_settings_stay_unchanged_when_migrated_again() {
        let mut settings: AppSettings = serde_json::from_value(json!({
            "lastRootPath": "/photos",
            "taggingShortcuts": ["a", "b"],
        }))
        .unwrap();

        assert!(migrate_settings(&mut settings));
        let migrated = serde_json::to_value(&settings).unwrap();
        assert!(!migrate_settings(&mut settings));
        assert_eq!(serde_json::to_value(&settings).unwrap(), migrated);
        assert_eq!(settings.root_folders, vec!["/photos".to_string()]);
    }

    #[test]
    fn tagging_shortcuts_become_keyword_sets_once() {
        let shortcuts: Vec<String> = (1..=11).map(|n| format!("keyword {n}")).collect();
        let mut settings: AppSettings =
            serde_json::from_value(json!({ "taggingShortcuts": shortcuts })).unwrap();

        assert!(migrate_keyword_sets(&mut settings));
        let sets = settings.keyword_sets.clone().unwrap();
        let names: Vec<&str> = sets.iter().map(|set| set.name.as_str()).collect();
        assert_eq!(
            names,
            [
                "My Keywords",
                "My Keywords 2",
                "Outdoor",
                "Portrait",
                "Event"
            ]
        );
        assert!(
            sets.iter()
                .all(|set| set.keywords.len() == KEYWORD_SET_SIZE)
        );
        assert_eq!(sets[0].keywords[8], "keyword 9");
        assert_eq!(sets[1].id, "my-keywords-2");
        assert_eq!(sets[1].keywords[..3], ["keyword 10", "keyword 11", ""]);
        assert!(!migrate_keyword_sets(&mut settings));

        let serialized = serde_json::to_value(&settings).unwrap();
        assert!(serialized.get("taggingShortcuts").is_none());
        let restored: AppSettings = serde_json::from_value(serialized).unwrap();
        assert_eq!(restored.keyword_sets, settings.keyword_sets);
    }

    #[test]
    fn tone_curve_presets_round_trip_through_settings() {
        let settings = AppSettings {
            tone_curve_presets: vec![json!({
                "id": "curve-1",
                "name": "Portrait",
                "curveMode": "point",
                "pointCurves": {},
                "parametricCurve": {}
            })],
            ..AppSettings::default()
        };

        let serialized = serde_json::to_string(&settings).expect("settings should serialize");
        assert!(serialized.contains("\"toneCurvePresets\""));

        let restored: AppSettings =
            serde_json::from_str(&serialized).expect("settings should deserialize");
        assert_eq!(restored.tone_curve_presets, settings.tone_curve_presets);
    }

    #[test]
    fn blend_pad_presets_round_trip_through_settings() {
        let settings = AppSettings {
            blend_pad_presets: vec![json!({
                "id": "pad-1",
                "name": "Moody",
                "includesPuck": true,
                "pad": { "version": 1, "shape": "triangle", "anchors": [] }
            })],
            ..AppSettings::default()
        };

        let serialized = serde_json::to_string(&settings).expect("settings should serialize");
        assert!(serialized.contains("\"blendPadPresets\""));

        let restored: AppSettings =
            serde_json::from_str(&serialized).expect("settings should deserialize");
        assert_eq!(restored.blend_pad_presets, settings.blend_pad_presets);
        let older: AppSettings = serde_json::from_str("{}").expect("older settings load");
        assert!(older.blend_pad_presets.is_empty());
    }

    #[test]
    fn filename_templates_keep_never_set_apart_from_all_deleted() {
        let older: AppSettings = serde_json::from_str("{}").expect("older settings load");
        assert_eq!(older.filename_templates, None);
        for templates in [
            Some(Vec::new()),
            Some(vec![
                json!({ "id": "t", "name": "Trip", "template": "{date}_{seq}" }),
            ]),
        ] {
            let settings = AppSettings {
                filename_templates: templates.clone(),
                ..AppSettings::default()
            };
            let serialized = serde_json::to_string(&settings).expect("settings should serialize");
            assert!(serialized.contains("\"filenameTemplates\""));
            let restored: AppSettings =
                serde_json::from_str(&serialized).expect("settings should deserialize");
            assert_eq!(restored.filename_templates, templates);
        }

        assert!(older.filename_custom_texts.is_empty());
        let texts = vec!["RAW".to_string(), String::new(), "Rome".to_string()];
        let settings = AppSettings {
            filename_custom_texts: texts.clone(),
            ..AppSettings::default()
        };
        let serialized = serde_json::to_string(&settings).expect("settings should serialize");
        assert!(serialized.contains("\"filenameCustomTexts\":[\"RAW\",\"\",\"Rome\"]"));
        let restored: AppSettings =
            serde_json::from_str(&serialized).expect("settings should deserialize");
        assert_eq!(restored.filename_custom_texts, texts);
        // The single text that 1.76.3 and 1.77.0 kept becomes the first.
        for saved in [
            r#"{"renameCustomText":"JPG"}"#,
            r#"{"filenameCustomText":"JPG"}"#,
        ] {
            let older: AppSettings = serde_json::from_str(saved).expect("older settings load");
            assert_eq!(older.filename_custom_texts, ["JPG"]);
        }
        let unset: AppSettings =
            serde_json::from_str(r#"{"filenameCustomTexts":null}"#).expect("null loads");
        assert!(unset.filename_custom_texts.is_empty());
    }

    #[test]
    fn zone_tint_presets_keep_never_set_apart_from_all_deleted() {
        let older: AppSettings = serde_json::from_str("{}").expect("older settings load");
        assert_eq!(older.zone_tint_presets, None);

        for presets in [
            Some(Vec::new()),
            Some(vec![json!({ "id": "z", "name": "Cool" })]),
        ] {
            let settings = AppSettings {
                zone_tint_presets: presets.clone(),
                ..AppSettings::default()
            };
            let serialized = serde_json::to_string(&settings).expect("settings should serialize");
            let restored: AppSettings =
                serde_json::from_str(&serialized).expect("settings should deserialize");
            assert_eq!(restored.zone_tint_presets, presets);
        }
    }

    #[test]
    fn quick_filter_criteria_round_trip_through_settings() {
        let filter = json!({
            "rating": -1,
            "ratingComparison": "exactly",
            "rawStatus": "rawOnly",
            "editedStatus": "all",
            "colors": ["red"],
            "flags": ["rejected", "unflagged"]
        });
        let settings: AppSettings = serde_json::from_value(json!({ "filterCriteria": filter }))
            .expect("settings with an unrated filter should deserialize");

        let restored = serde_json::to_value(&settings).expect("settings should serialize");
        assert_eq!(restored["filterCriteria"], filter);
    }

    #[test]
    fn file_type_filter_keeps_the_old_raw_status_for_older_builds() {
        let settings: AppSettings = serde_json::from_value(json!({
            "filterCriteria": { "rating": 0, "fileTypes": ["raw", "jpeg"] }
        }))
        .expect("a filter without rawStatus should deserialize");

        let restored = serde_json::to_value(&settings).expect("settings should serialize");
        assert_eq!(
            restored["filterCriteria"]["fileTypes"],
            json!(["raw", "jpeg"])
        );
        assert_eq!(restored["filterCriteria"]["rawStatus"], "all");
    }

    #[test]
    fn speed_edit_adjustments_round_trip_through_settings() {
        let adjustments = json!(["exposure", "rotation"]);
        let settings: AppSettings =
            serde_json::from_value(json!({ "speedEditAdjustments": adjustments.clone() }))
                .expect("settings with Speed Edit adjustments should deserialize");

        let restored = serde_json::to_value(&settings).expect("settings should serialize");
        assert_eq!(restored["speedEditAdjustments"], adjustments);
    }

    #[test]
    fn adjustment_layout_round_trips_and_fills_missing_fields() {
        let layout = json!({
            "sectionOrder": ["color", "light"],
            "toolOrder": { "detail": ["noiseReduction", "sharpening"] },
            "openSections": { "light": true, "color": false },
            "favorites": ["control:clarity", "tool:colorGrading"],
            "version": 1
        });
        let settings: AppSettings =
            serde_json::from_value(json!({ "adjustmentLayout": layout.clone() }))
                .expect("settings with an adjustment layout should deserialize");
        let restored = serde_json::to_value(&settings).expect("settings should serialize");
        assert_eq!(restored["adjustmentLayout"], layout);

        let partial: AppSettings = serde_json::from_value(
            json!({ "adjustmentLayout": { "favorites": ["section:curves"] } }),
        )
        .expect("a partial adjustment layout should deserialize");
        assert!(partial.adjustment_layout.section_order.is_empty());
        assert_eq!(partial.adjustment_layout.favorites, ["section:curves"]);
        assert_eq!(partial.adjustment_layout.version, 0);
    }

    fn migrated_layout(layout: serde_json::Value) -> serde_json::Value {
        let mut settings: AppSettings =
            serde_json::from_value(json!({ "adjustmentLayout": layout }))
                .expect("an old adjustment layout should deserialize");
        migrate_settings(&mut settings);
        serde_json::to_value(&settings.adjustment_layout).expect("the layout should serialize")
    }

    #[test]
    fn an_untouched_old_layout_gets_the_new_default_order() {
        let layout = migrated_layout(json!({
            "sectionOrder": ["basic", "curves", "color", "details", "effects"],
            "toolOrder": {
                "effects": ["glow", "halation", "lightFlares", "lensBlur", "relight", "fog", "lut",
                            "gaussianBlur", "motionBlur", "vignette", "grain"]
            },
            "openSections": { "basic": true, "curves": true, "color": false, "details": false, "effects": true }
        }));
        assert_eq!(layout["sectionOrder"], json!([]));
        assert_eq!(layout["toolOrder"], json!({}));
        assert_eq!(
            layout["openSections"],
            json!({
                "blur": true, "color": false, "curves": true, "detail": false, "finish": true,
                "light": true, "lightAtmosphere": true, "look": false
            })
        );
        assert_eq!(layout["version"], 2);
    }

    #[test]
    fn a_custom_old_layout_keeps_its_order_with_the_new_sections_in_place() {
        let layout = migrated_layout(json!({
            "sectionOrder": ["effects", "color", "basic", "curves", "details"],
            "toolOrder": {
                "color": ["hue", "whiteBalance", "colorMixer", "blackAndWhite", "colorPresence",
                          "colorCalibration", "colorGrading"],
                "details": ["sharpening", "presence", "noiseReduction", "aiDenoise", "chromaticAberration"],
                "effects": ["grain", "fog", "motionBlur", "glow", "vignette", "lut", "relight",
                            "halation", "lensBlur", "lightFlares", "gaussianBlur"]
            }
        }));
        assert_eq!(
            layout["sectionOrder"],
            json!([
                "lightAtmosphere",
                "blur",
                "finish",
                "color",
                "look",
                "light",
                "curves",
                "detail"
            ])
        );
        assert_eq!(
            layout["toolOrder"],
            json!({
                "color": ["hue", "colorMixer", "colorPresence", "colorCalibration"],
                "lightAtmosphere": ["fog", "glow", "relight", "halation", "lightFlares"],
                "blur": ["motionBlur", "lensBlur", "gaussianBlur"],
                "finish": ["grain", "vignette"]
            })
        );
    }

    #[test]
    fn starred_sections_keep_every_tool_they_held() {
        let layout = migrated_layout(json!({
            "favorites": ["control:exposure", "tool:whiteBalance", "section:color", "section:basic",
                          "section:details", "section:effects", "section:curves", "tool:relight"]
        }));
        assert_eq!(
            layout["favorites"],
            json!([
                "control:exposure",
                "tool:whiteBalance",
                "section:color",
                "tool:blackAndWhite",
                "tool:colorGrading",
                "section:light",
                "section:detail",
                "tool:chromaticAberration",
                "tool:presence",
                "section:lightAtmosphere",
                "section:blur",
                "section:finish",
                "tool:lut",
                "section:curves",
                "tool:relight"
            ])
        );
    }

    #[test]
    fn a_converted_layout_is_left_alone() {
        let converted = json!({
            "sectionOrder": ["color", "light"],
            "toolOrder": {},
            "openSections": { "look": true },
            "favorites": ["section:color", "section:detail", "tool:chromaticAberration"],
            "version": 2
        });
        assert_eq!(migrated_layout(converted.clone()), converted);
    }

    #[test]
    fn a_starred_detail_keeps_chromatic_aberration_after_it_moved_to_lens_and_geometry() {
        let layout = migrated_layout(json!({
            "favorites": ["section:detail", "section:light"],
            "version": 1
        }));
        assert_eq!(
            layout["favorites"],
            json!([
                "section:detail",
                "tool:chromaticAberration",
                "section:light"
            ])
        );
        assert_eq!(layout["version"], 2);

        let starred_alone = migrated_layout(json!({
            "favorites": ["tool:chromaticAberration", "section:detail"],
            "version": 1
        }));
        assert_eq!(
            starred_alone["favorites"],
            json!(["tool:chromaticAberration", "section:detail"])
        );
    }
}
