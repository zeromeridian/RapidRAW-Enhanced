//! Zone Tint: colours the 11 Zone System zones (0–X) of a Black & White photo without
//! changing its tones (`docs/ZONE_TINT_PLAN.md`, spec `docs/BW Zone System Coloring.md`).
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
/// The overall Amount scales every zone's strength, up to double; the product still stops at
/// `MAX_STRENGTH`.
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

/// Zone Tint as the shader applies it.
#[derive(Serialize, Deserialize, Debug, Clone, Copy, Pod, Zeroable, Default, PartialEq)]
#[repr(C)]
pub struct ZoneTintSettings {
    /// Per zone: OKLab a and b at full weight, the centre in L, and 1 / (2σ²).
    pub zones: [[f32; 4]; ZONE_COUNT],
    /// 1 when the photo is Black & White and at least one zone has a colour.
    pub enabled: u32,
    pub protect: f32,
    _pad1: f32,
    _pad2: f32,
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
    center_offset: f32,
    /// The zone's own σ; `None` uses the block's softness.
    width: Option<f32>,
}

impl ZoneTintSettings {
    /// Settings for `zoneTint`, or disabled ones when the photo is in colour, the block is
    /// missing, switched off, from a newer version, or tints no zone.
    pub fn from_json(js_zone_tint: Option<&serde_json::Value>, monochrome: bool) -> Self {
        let Some(tint) = js_zone_tint
            .filter(|_| monochrome)
            .and_then(|value| ZoneTint::deserialize(value).ok())
            .filter(|tint| tint.enabled && tint.version == VERSION)
        else {
            return Self::default();
        };

        let softness = tint.softness.clamp(MIN_SOFTNESS, MAX_SOFTNESS);
        let amount = tint.amount.clamp(0.0, MAX_AMOUNT);
        let mut settings = Self {
            protect: tint.protect.clamp(0.0, MAX_PROTECT),
            ..Self::default()
        };
        let mut tinted = false;
        for (index, slot) in settings.zones.iter_mut().enumerate() {
            let zone = tint.zones.get(index);
            let chroma = zone.map_or(0.0, |zone| {
                (zone.strength.max(0.0) * amount).min(MAX_STRENGTH) / MAX_STRENGTH * MAX_CHROMA
            });
            let hue = zone.map_or(0.0, |zone| oklab_hue(zone.hue));
            let offset = zone.map_or(0.0, |zone| {
                zone.center_offset
                    .clamp(-MAX_CENTER_OFFSET, MAX_CENTER_OFFSET)
            });
            let sigma = zone
                .and_then(|zone| zone.width)
                .map_or(softness, |width| width.clamp(MIN_SOFTNESS, MAX_SOFTNESS));
            tinted |= chroma > 0.0;
            *slot = [
                chroma * hue.cos(),
                chroma * hue.sin(),
                index as f32 / (ZONE_COUNT - 1) as f32 + offset,
                1.0 / (2.0 * sigma * sigma),
            ];
        }
        settings.enabled = u32::from(tinted);
        settings
    }
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
    fn zone_tint_is_off_unless_a_black_and_white_photo_tints_a_zone() {
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
        assert_eq!(settings(neutral).enabled, 0);
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
