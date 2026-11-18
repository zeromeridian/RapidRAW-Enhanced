//! Zone Tint: colours the 11 Zone System zones (0–X) of a photo without changing its tones,
//! toning a Black & White photo or grading a colour one by tonal zone
//! (`docs/ZONE_TINT_PLAN.md`, spec `docs/BW Zone System Coloring.md`).
//!
//! The zones sit on OKLab lightness L at n / 10. The shader (`apply_zone_tint` in
//! `shader.wgsl`) weighs each pixel's L against every zone with a normalised Gaussian, sums
//! the zones' (a, b) chroma vectors, fades them out at black and white (Protect), and adds
//! the result at the same L, reducing chroma along the hue until it fits sRGB. This module
//! turns the edit's `zoneTint` block into those per-zone values, so the shader needs no
//! trigonometry.

use bytemuck::{Pod, Zeroable};
use serde::{Deserialize, Serialize};

/// Zones 0 to X.
pub const ZONE_COUNT: usize = 11;
/// The only `zoneTint.version` this build renders; a newer block is ignored.
const VERSION: u32 = 1;
/// OKLab chroma of a zone at strength 100.
const MAX_CHROMA: f32 = 0.10;
const MAX_STRENGTH: f32 = 100.0;
/// A zone's Luminance runs −100 to 100; at ±100 it moves the zone's tones by 1.5 zones
/// (owner 2026-11-18; half a zone before).
const MAX_LUMINANCE: f32 = 100.0;
const MAX_LUMINANCE_SHIFT: f32 = 0.15;
/// Luminance spreads at least this wide (σ in L), whatever the softness, passed to the shader
/// as the largest 1 / (2σ²) it weighs zones with. Wide enough that one zone, or a run of zones,
/// at ±100 keeps every tone in order on its own; at the colour's σ 0.04 the tone-order scale
/// would cut a lone zone at +100 to ≈ 0.06 (owner 2026-11-18, `docs/ZONE_TINT_PLAN.md`).
const MIN_LUMINANCE_SOFTNESS: f32 = 0.075;
const LUMINANCE_WEIGHT_CAP: f32 = 1.0 / (2.0 * MIN_LUMINANCE_SOFTNESS * MIN_LUMINANCE_SOFTNESS);
/// The tone map L → L + shift must rise at least this steeply everywhere, so darker tones stay
/// below lighter ones. Opposite shifts on close zones (neighbours at +100 and −100, or zones
/// moved apart in Advanced mode) would fall below it; then every shift is scaled down just
/// enough (owner 2026-11-15), and every other edit renders exactly as set.
const MIN_TONE_SLOPE: f32 = 0.1;
/// Where the tone map's slope is checked: this many even steps over L 0–1, far finer than the
/// narrowest luminance weighing (`MIN_LUMINANCE_SOFTNESS`).
const TONE_SLOPE_SAMPLES: usize = 1024;
/// The overall Amount scales every zone's strength and luminance, up to double; the product
/// still stops at `MAX_STRENGTH` and `MAX_LUMINANCE`.
const DEFAULT_AMOUNT: f32 = 1.0;
const MAX_AMOUNT: f32 = 2.0;
/// Zone softness (σ in L) and its range, also the range of a zone's own width.
const DEFAULT_SOFTNESS: f32 = 0.04;
const MIN_SOFTNESS: f32 = 0.02;
const MAX_SOFTNESS: f32 = 0.08;
/// Protect (t in L): how far from black and white the tint fades out.
const DEFAULT_PROTECT: f32 = 0.08;
const MAX_PROTECT: f32 = 0.20;
/// How far a zone's centre may move from n / 10.
const MAX_CENTER_OFFSET: f32 = 0.05;
/// Mask smoothing's range: 0 off, up to the pipeline's tonal blur (≈ 3.5 px at 1080p,
/// scaled with the image) and a little past it, as the spec's 0–4 px.
const MAX_MASK_SMOOTHING: f32 = 4.0;

/// Zone Tint as the shader applies it.
#[derive(Serialize, Deserialize, Debug, Clone, Copy, Pod, Zeroable, Default, PartialEq)]
#[repr(C)]
pub struct ZoneTintSettings {
    /// Per zone: OKLab a and b at full weight, the centre in L, and 1 / (2σ²).
    pub zones: [[f32; 4]; ZONE_COUNT],
    /// 1 when the panel is visible and at least one zone has a colour or a luminance shift.
    pub enabled: u32,
    pub protect: f32,
    /// The largest 1 / (2σ²) luminance weighs zones with (`MIN_LUMINANCE_SOFTNESS`).
    pub luminance_weight_cap: f32,
    /// 1 when at least one zone moves its tones.
    pub has_luminance: u32,
    /// Per zone, four to a vector: the shift in OKLab L at full weight.
    pub luminance: [[f32; 4]; 3],
    /// Mask smoothing (`maskSmoothing`, 0 to `MAX_MASK_SMOOTHING`) in x; the rest pads the
    /// vector. The shader picks the zones' colour weights from the pixel's lightness scaled by
    /// how much brighter its blurred input is (the pipeline's own blurs), so grain does not
    /// speckle the colour.
    pub smoothing: [f32; 4],
}

/// The edit's `zoneTint` block.
#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase", default)]
struct ZoneTint {
    version: u32,
    enabled: bool,
    zones: Vec<Zone>,
    softness: f32,
    protect: f32,
    /// Absent in blocks saved before it: 1, so they render as before.
    amount: f32,
    /// Absent in blocks saved before it: 0, no smoothing.
    mask_smoothing: f32,
}

impl Default for ZoneTint {
    fn default() -> Self {
        Self {
            version: VERSION,
            enabled: true,
            zones: Vec::new(),
            softness: DEFAULT_SOFTNESS,
            protect: DEFAULT_PROTECT,
            amount: DEFAULT_AMOUNT,
            mask_smoothing: 0.0,
        }
    }
}

#[derive(Deserialize, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
struct Zone {
    /// The colour wheel's hue in degrees (HSV hue of display sRGB); `oklab_hue` turns it
    /// into the direction the shader adds chroma in.
    hue: f32,
    /// 0–100; 0 leaves the zone neutral.
    strength: f32,
    /// −100 to 100; 0 keeps the zone's tones.
    luminance: f32,
    center_offset: f32,
    /// The zone's own σ; `None` uses the block's softness.
    width: Option<f32>,
}

impl ZoneTintSettings {
    /// Settings for `zoneTint`, or disabled ones when the panel is hidden (`visible`), the block
    /// is missing, switched off, from a newer version, or tints no zone. Colour and Black &
    /// White photos alike: on colour the zones' colours shift the existing ones.
    pub fn from_json(js_zone_tint: Option<&serde_json::Value>, visible: bool) -> Self {
        let Some(tint) = js_zone_tint
            .filter(|_| visible)
            .and_then(|value| ZoneTint::deserialize(value).ok())
            .filter(|tint| tint.enabled && tint.version == VERSION)
        else {
            return Self::default();
        };

        let softness = tint.softness.clamp(MIN_SOFTNESS, MAX_SOFTNESS);
        let amount = tint.amount.clamp(0.0, MAX_AMOUNT);
        let mut settings = Self {
            protect: tint.protect.clamp(0.0, MAX_PROTECT),
            smoothing: [
                tint.mask_smoothing.clamp(0.0, MAX_MASK_SMOOTHING),
                0.0,
                0.0,
                0.0,
            ],
            ..Self::default()
        };
        let mut tinted = false;
        let mut moves = false;
        let mut zones = settings.zones;
        let mut shifts = [0.0; ZONE_COUNT];
        for (index, slot) in zones.iter_mut().enumerate() {
            let zone = tint.zones.get(index);
            let chroma = zone.map_or(0.0, |zone| {
                (zone.strength.max(0.0) * amount).min(MAX_STRENGTH) / MAX_STRENGTH * MAX_CHROMA
            });
            let hue = zone.map_or(0.0, |zone| oklab_hue(zone.hue));
            let (centre, inverse_two_sigma_sq) = zone_shape(zone, index, softness);
            let shift = zone.map_or(0.0, |zone| {
                (zone.luminance.clamp(-MAX_LUMINANCE, MAX_LUMINANCE) * amount)
                    .clamp(-MAX_LUMINANCE, MAX_LUMINANCE)
                    / MAX_LUMINANCE
                    * MAX_LUMINANCE_SHIFT
            });
            shifts[index] = shift;
            tinted |= chroma > 0.0;
            moves |= shift != 0.0;
            *slot = [
                chroma * hue.cos(),
                chroma * hue.sin(),
                centre,
                inverse_two_sigma_sq,
            ];
        }
        // Without a colour or a luminance shift the block is off exactly like a missing one,
        // so an edit whose zones are all neutral (or whose Amount is 0) is not an edit.
        if !tinted && !moves {
            return Self::default();
        }
        let order_scale = tone_order_scale(&zones, &shifts);
        for (index, shift) in shifts.iter().enumerate() {
            settings.luminance[index / 4][index % 4] = shift * order_scale;
        }
        settings.zones = zones;
        settings.enabled = 1;
        settings.has_luminance = u32::from(moves);
        settings.luminance_weight_cap = LUMINANCE_WEIGHT_CAP;
        settings
    }
}

/// The factor (0–1] that keeps the shader's tone map L → L + shift(L) rising at least
/// `MIN_TONE_SLOPE` steeply: 1 when it already does, else the shifts scaled down just enough.
/// The shift is linear in the zones' shifts, so its slope is too, and one factor is exact.
fn tone_order_scale(zones: &[[f32; 4]; ZONE_COUNT], shifts: &[f32; ZONE_COUNT]) -> f32 {
    if shifts.iter().all(|shift| *shift == 0.0) {
        return 1.0;
    }
    let steepest_fall = (0..=TONE_SLOPE_SAMPLES)
        .map(|step| shift_slope(zones, shifts, step as f32 / TONE_SLOPE_SAMPLES as f32))
        .fold(0.0, f32::min);
    let allowed_fall = 1.0 - MIN_TONE_SLOPE;
    if -steepest_fall > allowed_fall {
        allowed_fall / -steepest_fall
    } else {
        1.0
    }
}

/// The slope at `l` of the luminance shift `apply_zone_tint` adds, Σ pᵢ sᵢ with pᵢ the zones'
/// normalised weights exp(−kᵢ (l − cᵢ)²) (kᵢ capped at `LUMINANCE_WEIGHT_CAP`): since
/// dpᵢ/dl = pᵢ (gᵢ − ḡ) with gᵢ = −2 kᵢ (l − cᵢ), it is Σ pᵢ sᵢ gᵢ − (Σ pᵢ sᵢ)(Σ pᵢ gᵢ).
fn shift_slope(zones: &[[f32; 4]; ZONE_COUNT], shifts: &[f32; ZONE_COUNT], l: f32) -> f32 {
    let k = |zone: &[f32; 4]| zone[3].min(LUMINANCE_WEIGHT_CAP);
    let exponent = |zone: &[f32; 4]| {
        let d = l - zone[2];
        d * d * k(zone)
    };
    // Offset by the nearest zone's exponent, as the shader does, so no weight underflows.
    let nearest = zones.iter().map(exponent).fold(f32::INFINITY, f32::min);
    let (mut total, mut shift, mut gradient, mut shift_gradient) = (0.0, 0.0, 0.0, 0.0);
    for (zone, zone_shift) in zones.iter().zip(shifts) {
        let weight = (nearest - exponent(zone)).exp();
        let g = -2.0 * k(zone) * (l - zone[2]);
        total += weight;
        shift += weight * zone_shift;
        gradient += weight * g;
        shift_gradient += weight * zone_shift * g;
    }
    shift_gradient / total - (shift / total) * (gradient / total)
}

/// Zone `index`'s centre in L (n / 10 plus its offset) and 1 / (2σ²) of its own width or the
/// block's softness: where the shader places and how widely it weighs the zone.
fn zone_shape(zone: Option<&Zone>, index: usize, softness: f32) -> (f32, f32) {
    let offset = zone.map_or(0.0, |zone| {
        zone.center_offset
            .clamp(-MAX_CENTER_OFFSET, MAX_CENTER_OFFSET)
    });
    let sigma = zone
        .and_then(|zone| zone.width)
        .map_or(softness, |width| width.clamp(MIN_SOFTNESS, MAX_SOFTNESS));
    (
        index as f32 / (ZONE_COUNT - 1) as f32 + offset,
        1.0 / (2.0 * sigma * sigma),
    )
}

/// How strongly chosen zones colour each tone, for the panel's Alt/Option mask preview: the
/// shader's weighing (`apply_zone_tint`: normalised Gaussian weights, then Protect) summed over
/// the chosen zones, so the preview shows exactly where their colour goes. It uses the block's
/// zone shapes whatever their colours, so an uncoloured zone previews too.
pub struct ZoneWeights {
    shapes: [(f32, f32); ZONE_COUNT],
    chosen: [bool; ZONE_COUNT],
    protect: f32,
}

impl ZoneWeights {
    pub fn from_json(js_zone_tint: Option<&serde_json::Value>, chosen: &[usize]) -> Self {
        let tint = js_zone_tint
            .and_then(|value| ZoneTint::deserialize(value).ok())
            .filter(|tint| tint.version == VERSION)
            .unwrap_or_default();
        let softness = tint.softness.clamp(MIN_SOFTNESS, MAX_SOFTNESS);
        Self {
            shapes: std::array::from_fn(|index| zone_shape(tint.zones.get(index), index, softness)),
            chosen: std::array::from_fn(|index| chosen.contains(&index)),
            protect: tint.protect.clamp(0.0, MAX_PROTECT),
        }
    }

    /// The chosen zones' share (0–1) of the colour at OKLab lightness `l`.
    pub fn weight(&self, l: f32) -> f32 {
        // Offset by the nearest zone's exponent, as the shader does, so narrow zones far from
        // `l` cannot underflow every weight.
        let exponent = |(centre, inverse_two_sigma_sq): (f32, f32)| {
            let d = l - centre;
            d * d * inverse_two_sigma_sq
        };
        let nearest = self
            .shapes
            .iter()
            .map(|shape| exponent(*shape))
            .fold(f32::INFINITY, f32::min);
        let (mut chosen, mut total) = (0.0, 0.0);
        for (shape, is_chosen) in self.shapes.iter().zip(self.chosen) {
            let weight = (nearest - exponent(*shape)).exp();
            total += weight;
            if is_chosen {
                chosen += weight;
            }
        }
        let smoothstep = |edge0: f32, edge1: f32, x: f32| {
            let t = ((x - edge0) / (edge1 - edge0)).clamp(0.0, 1.0);
            t * t * (3.0 - 2.0 * t)
        };
        let protection = if self.protect > 0.0 {
            smoothstep(0.0, self.protect, l) * (1.0 - smoothstep(1.0 - self.protect, 1.0, l))
        } else {
            1.0
        };
        chosen / total * protection
    }
}

/// Marks a file of exported Zone Editor presets. It keeps the tool's former name, Zone Color
/// Grading, so files exported before the rename still load.
const PRESET_FILE_FORMAT: &str = "ThisIsRAW Zone Color Grading presets";

/// Writes Zone Color Grading presets to a JSON file (`preset_file`); the panel builds and
/// cleans them (`utils/zoneTint.ts`).
#[tauri::command]
pub fn export_zone_tint_presets(
    presets: Vec<serde_json::Value>,
    file_path: String,
) -> Result<(), String> {
    crate::preset_file::write(PRESET_FILE_FORMAT, presets, &file_path)
}

/// Reads the presets of a Zone Color Grading preset file (`preset_file`); the panel cleans
/// every one.
#[tauri::command]
pub fn import_zone_tint_presets(file_path: String) -> Result<Vec<serde_json::Value>, String> {
    crate::preset_file::read(&file_path)
}

/// The sRGB transfer curve, display value to linear.
pub(crate) fn srgb_to_linear(value: f32) -> f32 {
    if value <= 0.04045 {
        value / 12.92
    } else {
        ((value + 0.055) / 1.055).powf(2.4)
    }
}

/// OKLab (Björn Ottosson) of linear sRGB; the same matrices as `linear_srgb_to_oklab` in
/// `shader.wgsl`.
pub(crate) fn linear_srgb_to_oklab([r, g, b]: [f32; 3]) -> [f32; 3] {
    let l = (0.412_221_46 * r + 0.536_332_55 * g + 0.051_445_995 * b).cbrt();
    let m = (0.211_903_5 * r + 0.680_699_5 * g + 0.107_396_96 * b).cbrt();
    let s = (0.088_302_46 * r + 0.281_718_85 * g + 0.629_978_7 * b).cbrt();
    [
        0.210_454_26 * l + 0.793_617_8 * m - 0.004_072_047 * s,
        1.977_998_5 * l - 2.428_592_2 * m + 0.450_593_7 * s,
        0.025_904_037 * l + 0.782_771_77 * m - 0.808_675_77 * s,
    ]
}

/// The OKLab hue angle (radians) of the fully saturated colour at a colour wheel hue, so a
/// zone tints toward the colour the wheel shows.
fn oklab_hue(wheel_hue: f32) -> f32 {
    let sector = wheel_hue.rem_euclid(360.0) / 60.0;
    let rising = sector.fract();
    let falling = 1.0 - rising;
    let display = match sector as u32 {
        0 => [1.0, rising, 0.0],
        1 => [falling, 1.0, 0.0],
        2 => [0.0, 1.0, rising],
        3 => [0.0, falling, 1.0],
        4 => [rising, 0.0, 1.0],
        _ => [1.0, 0.0, falling],
    };
    let [_, a, b] = linear_srgb_to_oklab(display.map(srgb_to_linear));
    b.atan2(a)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn settings(zone_tint: serde_json::Value) -> ZoneTintSettings {
        ZoneTintSettings::from_json(Some(&zone_tint), true)
    }

    #[test]
    fn a_tinted_zone_gets_its_chroma_vector_and_the_others_stay_neutral() {
        let mut zones = vec![json!({}); ZONE_COUNT];
        zones[7] = json!({ "hue": 90, "strength": 100 });
        let tint = settings(json!({ "version": 1, "zones": zones }));

        assert_eq!(tint.enabled, 1);
        assert_eq!(tint.protect, DEFAULT_PROTECT);
        let [a, b, centre, inverse_two_sigma_sq] = tint.zones[7];
        assert!((a.hypot(b) - MAX_CHROMA).abs() < 1e-6);
        assert!((b.atan2(a) - oklab_hue(90.0)).abs() < 1e-5);
        assert!((centre - 0.7).abs() < 1e-6);
        assert!((inverse_two_sigma_sq - 312.5).abs() < 1e-3);
        for (index, zone) in tint.zones.iter().enumerate().filter(|(i, _)| *i != 7) {
            assert_eq!(zone[..2], [0.0, 0.0], "zone {index}");
            assert!((zone[2] - index as f32 / 10.0).abs() < 1e-6, "zone {index}");
        }
    }

    #[test]
    fn mask_smoothing_reaches_the_shader_within_its_range() {
        let tinted = |extra: serde_json::Value| {
            let mut block = json!({ "zones": [{ "hue": 30, "strength": 40 }] });
            block
                .as_object_mut()
                .unwrap()
                .extend(extra.as_object().unwrap().clone());
            settings(block).smoothing
        };
        // Absent in older edits: off.
        assert_eq!(tinted(json!({})), [0.0; 4]);
        assert_eq!(
            tinted(json!({ "maskSmoothing": 1.5 })),
            [1.5, 0.0, 0.0, 0.0]
        );
        assert_eq!(tinted(json!({ "maskSmoothing": 9 }))[0], MAX_MASK_SMOOTHING);
        assert_eq!(tinted(json!({ "maskSmoothing": -1 }))[0], 0.0);
    }

    #[test]
    fn the_mask_preview_weighs_the_chosen_zones_like_the_shader() {
        let block = json!({ "version": 1, "zones": [] });
        let zone_five = ZoneWeights::from_json(Some(&block), &[5]);
        // Most of the colour at the zone's centre (its neighbours keep ≈ 4 % each at the
        // default softness; Protect is 1 there), gone two zones away.
        assert!((zone_five.weight(0.5) - 0.919).abs() < 0.005);
        assert!(zone_five.weight(0.3) < 1e-3);
        assert!(zone_five.weight(0.7) < 1e-3);
        // Halfway to the next zone, the two share the colour.
        assert!((zone_five.weight(0.55) - 0.5).abs() < 0.05);

        // Every zone together is the whole colour, faded by Protect at black and white only.
        let all = ZoneWeights::from_json(Some(&block), &(0..ZONE_COUNT).collect::<Vec<_>>());
        for l in [0.2, 0.45, 0.8] {
            assert!((all.weight(l) - 1.0).abs() < 1e-5, "L {l}");
        }
        assert_eq!(all.weight(0.0), 0.0);
        assert_eq!(all.weight(1.0), 0.0);

        // Neighbours of one choice add up, and nothing chosen is no colour.
        let pair = ZoneWeights::from_json(Some(&block), &[5, 6]);
        assert!(pair.weight(0.55) > 0.95);
        assert_eq!(ZoneWeights::from_json(None, &[]).weight(0.5), 0.0);
    }

    #[test]
    fn zone_tint_is_off_unless_a_visible_block_tints_a_zone() {
        let tinted = json!({ "zones": [{ "hue": 30, "strength": 40 }] });
        assert_eq!(settings(tinted.clone()).enabled, 1);
        assert_eq!(
            ZoneTintSettings::from_json(Some(&tinted), false),
            ZoneTintSettings::default()
        );
        assert_eq!(
            ZoneTintSettings::from_json(None, true),
            ZoneTintSettings::default()
        );
        let off = json!({ "enabled": false, "zones": [{ "hue": 30, "strength": 40 }] });
        assert_eq!(settings(off).enabled, 0);
        let newer = json!({ "version": 2, "zones": [{ "hue": 30, "strength": 40 }] });
        assert_eq!(settings(newer).enabled, 0);
        let neutral = json!({ "zones": [{ "hue": 30, "strength": 0 }] });
        assert_eq!(settings(neutral), ZoneTintSettings::default());
        assert_eq!(settings(json!("not a block")).enabled, 0);
    }

    #[test]
    fn zone_tint_values_are_kept_within_their_ranges() {
        let tint = settings(json!({
            "softness": 1.0,
            "protect": -1.0,
            "zones": [
                { "hue": 0, "strength": 500, "centerOffset": 0.3, "width": 0.001 },
                { "hue": 0, "strength": 50, "centerOffset": -0.3 },
            ],
        }));
        assert_eq!(tint.protect, 0.0);
        let [a, b, centre, inverse_two_sigma_sq] = tint.zones[0];
        assert!((a.hypot(b) - MAX_CHROMA).abs() < 1e-6);
        assert!((centre - MAX_CENTER_OFFSET).abs() < 1e-6);
        assert!((inverse_two_sigma_sq - 1.0 / (2.0 * MIN_SOFTNESS * MIN_SOFTNESS)).abs() < 1e-2);
        let [a, b, centre, inverse_two_sigma_sq] = tint.zones[1];
        assert!((a.hypot(b) - MAX_CHROMA / 2.0).abs() < 1e-6);
        assert!((centre - (0.1 - MAX_CENTER_OFFSET)).abs() < 1e-6);
        assert!((inverse_two_sigma_sq - 1.0 / (2.0 * MAX_SOFTNESS * MAX_SOFTNESS)).abs() < 1e-2);
        // Zones without an entry keep the block's softness.
        assert!((tint.zones[5][3] - 1.0 / (2.0 * MAX_SOFTNESS * MAX_SOFTNESS)).abs() < 1e-2);
    }

    #[test]
    fn a_zone_luminance_moves_its_tones_without_needing_a_colour() {
        let mut zones = vec![json!({}); ZONE_COUNT];
        zones[2] = json!({ "luminance": 100 });
        zones[5] = json!({ "luminance": -50 });
        zones[10] = json!({ "luminance": 400 });
        let tint = settings(json!({ "zones": zones }));

        assert_eq!(tint.enabled, 1);
        assert_eq!(tint.has_luminance, 1);
        let shift = |zone: usize| tint.luminance[zone / 4][zone % 4];
        assert!((shift(2) - MAX_LUMINANCE_SHIFT).abs() < 1e-6);
        assert!((shift(5) + MAX_LUMINANCE_SHIFT / 2.0).abs() < 1e-6);
        // Out of range, a zone's luminance is clamped to ±100.
        assert!((shift(10) - MAX_LUMINANCE_SHIFT).abs() < 1e-6);
        assert_eq!(shift(0), 0.0);
        // Luminance alone tints nothing and spreads at least σ 0.075, wider than the colour.
        assert!(tint.zones.iter().all(|zone| zone[..2] == [0.0, 0.0]));
        assert!((tint.luminance_weight_cap - 1.0 / (2.0 * 0.075 * 0.075)).abs() < 1e-3);

        // The Amount scales the shift too; a colour alone moves no tone.
        let halved = settings(json!({ "amount": 0.5, "zones": [{ "luminance": 100 }] }));
        assert!((halved.luminance[0][0] - MAX_LUMINANCE_SHIFT / 2.0).abs() < 1e-6);
        let colour_only = settings(json!({ "zones": [{ "hue": 30, "strength": 40 }] }));
        assert_eq!(colour_only.has_luminance, 0);
        assert_eq!(colour_only.luminance, [[0.0; 4]; 3]);
    }

    /// The tone map `apply_zone_tint` applies before it clamps to 0–1, written out like the
    /// shader (not with `shift_slope`), so the tests check the order independently.
    fn tone_map(tint: &ZoneTintSettings, l: f32) -> f32 {
        let exponent = |zone: &[f32; 4]| {
            let d = l - zone[2];
            d * d * zone[3].min(tint.luminance_weight_cap)
        };
        let nearest = tint
            .zones
            .iter()
            .map(exponent)
            .fold(f32::INFINITY, f32::min);
        let (mut total, mut shift) = (0.0, 0.0);
        for (index, zone) in tint.zones.iter().enumerate() {
            let weight = (nearest - exponent(zone)).exp();
            total += weight;
            shift += weight * tint.luminance[index / 4][index % 4];
        }
        l + shift / total
    }

    /// The smallest slope of the tone map, by finite differences on a grid finer than
    /// `TONE_SLOPE_SAMPLES` and offset from it. Steps that the shader's clamp clips to black or
    /// white are left out: flat there, but never reversed.
    fn min_tone_slope(tint: &ZoneTintSettings) -> f32 {
        let steps = 4099;
        (0..steps)
            .filter_map(|step| {
                let (a, b) = (step as f32 / steps as f32, (step + 1) as f32 / steps as f32);
                let (from, to) = (tone_map(tint, a), tone_map(tint, b));
                let inside = |value: f32| (0.0..=1.0).contains(&value);
                (inside(from) && inside(to)).then_some((to - from) * steps as f32)
            })
            .fold(f32::INFINITY, f32::min)
    }

    #[test]
    fn opposite_luminance_on_close_zones_keeps_every_tone_in_order() {
        // Neighbours at +100 and −100 reverse tones without the scale (slope ≈ −0.14), which
        // keeps them at ≈ 0.12 each.
        let mut zones = vec![json!({}); ZONE_COUNT];
        zones[5] = json!({ "luminance": 100 });
        zones[6] = json!({ "luminance": -100 });
        let neighbours = settings(json!({ "softness": 0.02, "zones": zones.clone() }));
        assert!(min_tone_slope(&neighbours) >= MIN_TONE_SLOPE - 0.01);
        // Scaled together: Zone V still rises and Zone VI falls by as much.
        let shift = |tint: &ZoneTintSettings, zone: usize| tint.luminance[zone / 4][zone % 4];
        assert!(shift(&neighbours, 5) > 0.11 && shift(&neighbours, 5) < MAX_LUMINANCE_SHIFT);
        assert!((shift(&neighbours, 5) + shift(&neighbours, 6)).abs() < 1e-6);

        // Advanced mode: the same zones moved apart, the steepest case, and every mix of moves,
        // widths and opposite shifts across the scale.
        zones[5] = json!({ "luminance": 100, "centerOffset": -0.05 });
        zones[6] = json!({ "luminance": -100, "centerOffset": 0.05 });
        assert!(min_tone_slope(&settings(json!({ "zones": zones }))) >= MIN_TONE_SLOPE - 0.01);
        for case in 0..60_usize {
            let zones: Vec<_> = (0..ZONE_COUNT)
                .map(|zone| {
                    let pick = (case * 7 + zone * 13) % 5;
                    let luminance = [100.0, -100.0, 0.0, 60.0, -35.0][pick];
                    let offset = [-0.05, 0.05, 0.0, 0.03, -0.02][(pick + case) % 5];
                    let width = [0.02, 0.08, 0.04, 0.03, 0.06][(zone + case) % 5];
                    json!({ "luminance": luminance, "centerOffset": offset, "width": width })
                })
                .collect();
            let tint = settings(json!({ "softness": 0.02, "zones": zones }));
            let slope = min_tone_slope(&tint);
            assert!(slope >= MIN_TONE_SLOPE - 0.01, "case {case}: slope {slope}");
        }
    }

    #[test]
    fn luminance_that_keeps_tones_in_order_renders_as_set() {
        // Zone V alone at +100 or −100, Zones V and VI both at +100, and neighbours at ±50
        // already rise steeply enough, so they get the full 1.5 zones (or half of it).
        for (five, six) in [(100.0, 0.0), (-100.0, 0.0), (100.0, 100.0), (50.0, -50.0)] {
            let mut zones = vec![json!({}); ZONE_COUNT];
            zones[5] = json!({ "luminance": five });
            zones[6] = json!({ "luminance": six });
            let tint = settings(json!({ "zones": zones }));
            assert!(
                (tint.luminance[1][1] - five / MAX_LUMINANCE * MAX_LUMINANCE_SHIFT).abs() < 1e-6
            );
            assert!(
                (tint.luminance[1][2] - six / MAX_LUMINANCE * MAX_LUMINANCE_SHIFT).abs() < 1e-6
            );
        }
    }

    #[test]
    fn luminance_at_full_strength_lifts_one_zone_by_most_of_a_zone_and_a_run_by_one_and_a_half() {
        let lift = |zones: &[usize], l: f32| {
            let mut block = vec![json!({}); ZONE_COUNT];
            for &zone in zones {
                block[zone] = json!({ "luminance": 100 });
            }
            tone_map(&settings(json!({ "zones": block })), l) - l
        };
        // One zone: its centre rises ≈ 0.08 and takes its neighbours part of the way along.
        assert!((lift(&[5], 0.5) - 0.080).abs() < 2e-3);
        assert!((lift(&[5], 0.4) - 0.033).abs() < 2e-3);
        // A run of zones: its middle rises the full 1.5 zones (just under, from the run's ends).
        assert!((lift(&[4, 5, 6], 0.5) - 0.145).abs() < 2e-3);
    }

    #[test]
    fn the_amount_scales_every_zone_up_to_full_strength() {
        let chroma = |amount: serde_json::Value| {
            let tint = settings(json!({
                "amount": amount,
                "zones": [{ "hue": 0, "strength": 80 }, { "hue": 0, "strength": 20 }],
            }));
            [0, 1].map(|zone| tint.zones[zone][0].hypot(tint.zones[zone][1]) / MAX_CHROMA)
        };
        let close =
            |[a, b]: [f32; 2], [x, y]: [f32; 2]| (a - x).abs() < 1e-6 && (b - y).abs() < 1e-6;

        assert!(close(chroma(json!(1.0)), [0.8, 0.2]));
        assert!(close(chroma(json!(0.5)), [0.4, 0.1]));
        // Doubled, the strong zone stops at full strength and the weak one doubles.
        assert!(close(chroma(json!(2.0)), [1.0, 0.4]));
        // Out of range, the amount is clamped to 0–2.
        assert!(close(chroma(json!(5.0)), [1.0, 0.4]));
        assert_eq!(
            settings(json!({ "amount": 0, "zones": [{ "strength": 80 }] })).enabled,
            0
        );
        // A block saved before the amount existed renders at 100 %.
        let older = settings(json!({ "zones": [{ "hue": 0, "strength": 80 }] }));
        assert!((older.zones[0][0].hypot(older.zones[0][1]) / MAX_CHROMA - 0.8).abs() < 1e-6);
    }

    #[test]
    fn wheel_hues_tint_toward_the_colour_the_wheel_shows() {
        // OKLab hues of sRGB red, green and blue (Ottosson): 29.2°, 142.5°, 264.1°.
        for (wheel, oklab) in [(0.0, 29.2), (120.0, 142.5), (240.0, 264.1), (360.0, 29.2)] {
            let degrees = oklab_hue(wheel).to_degrees().rem_euclid(360.0);
            assert!((degrees - oklab).abs() < 0.2, "wheel {wheel}: {degrees}");
        }
    }
}
