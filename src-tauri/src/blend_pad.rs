//! Orbit Blend Pad: one puck inside a shape that moves several sliders at once.
//!
//! Anchors sit on the shape's edge, each tied to one slider and a target offset. Each anchor
//! works along an axis from the anchor, through the centre, to the opposite edge: the puck's
//! position along it gives a weight of +1 at the anchor, 0 at the centre and −1 at the opposite
//! edge point. The pad's offsets are added on top of the sliders, so with the puck at the centre
//! the photo looks as the sliders set it. The stored edit keeps the pad, never the computed
//! values; [`Offsets`] resolves it for every render, export and thumbnail.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::f64::consts::TAU;

/// The adjustments key that holds the pad (`BlendPad` in `utils/adjustments.ts`).
const BLEND_PAD_KEY: &str = "blendPad";

/// The pad format this resolver reads. A pad saved with another version is ignored rather
/// than rendered with maths it was not made for.
const BLEND_PAD_VERSION: u32 = 1;

/// Anchors per pad; any beyond this are ignored.
pub const MAX_ANCHORS: usize = 8;

const EPSILON: f64 = 1e-9;

/// A slider the pad can drive, with the range and step of its slider (`ADJUSTMENT_CONTROLS` in
/// `utils/adjustmentControls.ts`). The pad panel reads this list through
/// [`get_blend_pad_parameters`] (`BlendPadParameter` in `utils/blendPad.ts`).
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct Parameter {
    pub id: &'static str,
    pub min: f64,
    pub max: f64,
    pub step: f64,
    /// A hue: values wrap around the range instead of clamping.
    pub wraps: bool,
}

impl Parameter {
    const fn signed(id: &'static str) -> Self {
        Self {
            id,
            min: -100.0,
            max: 100.0,
            step: 1.0,
            wraps: false,
        }
    }

    const fn exposure(id: &'static str) -> Self {
        Self {
            id,
            min: -5.0,
            max: 5.0,
            step: 0.01,
            wraps: false,
        }
    }

    /// A 0–100 slider such as Glow Amount.
    const fn positive(id: &'static str) -> Self {
        Self {
            id,
            min: 0.0,
            max: 100.0,
            step: 1.0,
            wraps: false,
        }
    }

    /// Brings a value into the slider's range.
    fn limit(&self, value: f64) -> f64 {
        if self.wraps {
            let span = self.max - self.min;
            (value - self.min).rem_euclid(span) + self.min
        } else {
            value.clamp(self.min, self.max)
        }
    }

    /// Bounds the anchors' summed offset: at most the slider's whole span either way, so a
    /// negative offset can still lower a one-sided slider (Glow 50 with −30 gives 20); only
    /// the slider plus the offset is kept in the slider's range.
    fn limit_offset(&self, offset: f64) -> f64 {
        if self.wraps {
            self.limit(offset)
        } else {
            let span = self.max - self.min;
            offset.clamp(-span, span)
        }
    }
}

/// The sliders the pad can drive: global sliders that change a uniform of the main shader (Light
/// Flare also its generation pass, as its slider does), so a drag stays fast.
pub const PARAMETERS: [Parameter; 21] = [
    Parameter::exposure("exposure"),
    Parameter::exposure("brightness"),
    Parameter::signed("contrast"),
    Parameter::signed("highlights"),
    Parameter::signed("shadows"),
    Parameter::signed("whites"),
    Parameter::signed("blacks"),
    Parameter::signed("temperature"),
    Parameter::signed("tint"),
    Parameter::signed("vibrance"),
    Parameter::signed("saturation"),
    Parameter {
        id: "hue",
        min: -180.0,
        max: 180.0,
        step: 1.0,
        wraps: true,
    },
    Parameter::signed("clarity"),
    Parameter::signed("dehaze"),
    Parameter::signed("structure"),
    Parameter::signed("centré"),
    Parameter::signed("vignetteAmount"),
    Parameter::positive("gaussianBlurAmount"),
    Parameter::positive("glowAmount"),
    Parameter::positive("flareAmount"),
    Parameter::positive("grainAmount"),
];

/// The sliders the pad can drive, so the pad panel offers and resolves exactly these.
#[tauri::command]
pub fn get_blend_pad_parameters() -> [Parameter; PARAMETERS.len()] {
    PARAMETERS
}

fn parameter_index(id: &str) -> Option<usize> {
    PARAMETERS.iter().position(|parameter| parameter.id == id)
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Deserialize)]
pub struct Point {
    pub x: f64,
    pub y: f64,
}

impl Point {
    fn dot(self, other: Point) -> f64 {
        self.x * other.x + self.y * other.y
    }

    fn length(self) -> f64 {
        self.x.hypot(self.y)
    }

    fn scale(self, factor: f64) -> Point {
        Point {
            x: self.x * factor,
            y: self.y * factor,
        }
    }
}

/// The pad's outline, centred on (0, 0) in normalised space with y up.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Shape {
    /// Radius 1.
    #[default]
    Circle,
}

impl Shape {
    /// The edge point at perimeter position `t` (0–1, from the right, anticlockwise).
    pub fn point_at(self, t: f64) -> Point {
        match self {
            Shape::Circle => Point {
                x: (TAU * t).cos(),
                y: (TAU * t).sin(),
            },
        }
    }

    /// How far from the centre the ray in the unit `direction` leaves the shape.
    fn edge_distance(self, _direction: Point) -> f64 {
        match self {
            Shape::Circle => 1.0,
        }
    }

    /// The nearest point inside the shape.
    pub fn clamp(self, point: Point) -> Point {
        match self {
            Shape::Circle => {
                let radius = point.length();
                if radius > 1.0 {
                    point.scale(1.0 / radius)
                } else {
                    point
                }
            }
        }
    }

    /// The anchor's weight for a puck inside the shape: +1 at the anchor, 0 at the centre and
    /// −1 at the opposite edge point, measured separately on each side of the centre so both
    /// ends reach ±1 even where the two distances differ.
    pub fn axis_weight(self, t: f64, puck: Point) -> f64 {
        let anchor = self.point_at(t);
        let reach = anchor.length();
        if reach < EPSILON {
            return 0.0;
        }
        let direction = anchor.scale(1.0 / reach);
        let along = puck.dot(direction);
        let weight = if along >= 0.0 {
            along / reach
        } else {
            along / self.edge_distance(direction.scale(-1.0))
        };
        weight.clamp(-1.0, 1.0)
    }
}

/// How an anchor's offset grows with the puck's distance along its axis, the same on both sides.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Curve {
    #[default]
    Linear,
    /// Smoothstep: gentler near the centre.
    Soft,
    EaseIn,
}

impl Curve {
    fn apply(self, x: f64) -> f64 {
        match self {
            Curve::Linear => x,
            Curve::Soft => x * x * (3.0 - 2.0 * x),
            Curve::EaseIn => x * x,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Anchor {
    param: String,
    t: f64,
    target: f64,
    #[serde(default)]
    curve: Curve,
    #[serde(default)]
    muted: bool,
}

fn full_amount() -> f64 {
    1.0
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BlendPad {
    version: u32,
    #[serde(default)]
    enabled: bool,
    #[serde(default)]
    shape: Shape,
    #[serde(default = "full_amount")]
    amount: f64,
    #[serde(default)]
    puck: Point,
    #[serde(default)]
    anchors: Vec<Value>,
}

/// The pad's offset for each of [`PARAMETERS`], resolved once per render.
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct Offsets([f64; PARAMETERS.len()]);

impl Offsets {
    /// The offsets of the adjustments' pad; all zero without an enabled pad.
    pub fn from_adjustments(adjustments: &Value) -> Self {
        adjustments
            .get(BLEND_PAD_KEY)
            .and_then(|pad| BlendPad::deserialize(pad).ok())
            .filter(|pad| pad.enabled && pad.version == BLEND_PAD_VERSION)
            .map(|pad| Self::from_pad(&pad))
            .unwrap_or_default()
    }

    fn from_pad(pad: &BlendPad) -> Self {
        let puck = pad.shape.clamp(pad.puck);
        let amount = pad.amount.clamp(0.0, 1.0);
        let mut sums = [0.0; PARAMETERS.len()];
        let anchors = pad
            .anchors
            .iter()
            .take(MAX_ANCHORS)
            .filter_map(|anchor| Anchor::deserialize(anchor).ok());
        for anchor in anchors.filter(|anchor| !anchor.muted) {
            let Some(index) = parameter_index(&anchor.param) else {
                continue;
            };
            let weight = pad.shape.axis_weight(anchor.t, puck);
            sums[index] +=
                anchor.target * anchor.curve.apply(weight.abs()) * weight.signum() * amount;
        }
        let mut offsets = [0.0; PARAMETERS.len()];
        for ((offset, sum), parameter) in offsets.iter_mut().zip(sums).zip(&PARAMETERS) {
            let rounded = (parameter.limit_offset(sum) / parameter.step).round() * parameter.step;
            // No negative zero, so an anchor at the centre leaves the slider untouched.
            *offset = if rounded == 0.0 { 0.0 } else { rounded };
        }
        Self(offsets)
    }

    /// The pad's offset for the slider `id`, 0 when the pad does not drive it.
    #[cfg(test)]
    fn offset(&self, id: &str) -> f64 {
        parameter_index(id).map_or(0.0, |index| self.0[index])
    }

    /// The slider's value with the pad's offset added, kept in the slider's range. A slider the
    /// pad does not move keeps its value exactly.
    pub fn apply(&self, id: &str, value: f64) -> f64 {
        match parameter_index(id) {
            Some(index) if self.0[index] != 0.0 => PARAMETERS[index].limit(value + self.0[index]),
            _ => value,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const TOP: f64 = 0.25;
    const BOTTOM_RIGHT: f64 = 11.0 / 12.0;
    const BOTTOM_LEFT: f64 = 7.0 / 12.0;

    fn anchor(param: &str, t: f64, target: f64) -> Value {
        json!({ "id": param, "param": param, "t": t, "target": target })
    }

    fn pad(puck: (f64, f64), anchors: Vec<Value>) -> Value {
        json!({
            "blendPad": {
                "version": 1,
                "enabled": true,
                "shape": "circle",
                "amount": 1,
                "puck": { "x": puck.0, "y": puck.1 },
                "anchors": anchors,
            }
        })
    }

    fn defaults() -> Vec<Value> {
        vec![
            anchor("contrast", TOP, 60.0),
            anchor("temperature", BOTTOM_RIGHT, 50.0),
            anchor("saturation", BOTTOM_LEFT, -60.0),
        ]
    }

    fn offsets(puck: (f64, f64), anchors: Vec<Value>) -> Offsets {
        Offsets::from_adjustments(&pad(puck, anchors))
    }

    #[test]
    fn weight_is_one_on_the_anchor_zero_at_the_centre_and_minus_one_opposite() {
        for t in [0.0, TOP, BOTTOM_RIGHT, BOTTOM_LEFT, 0.37] {
            let at = Shape::Circle.point_at(t);
            let opposite = at.scale(-1.0);
            assert!((Shape::Circle.axis_weight(t, at) - 1.0).abs() < 1e-12);
            assert_eq!(Shape::Circle.axis_weight(t, Point::default()), 0.0);
            assert!((Shape::Circle.axis_weight(t, opposite) + 1.0).abs() < 1e-12);
        }
    }

    #[test]
    fn defaults_at_the_top_pull_the_other_tools_halfway_in_reverse() {
        let resolved = offsets((0.0, 1.0), defaults());
        assert_eq!(resolved.offset("contrast"), 60.0);
        assert_eq!(resolved.offset("temperature"), -25.0);
        assert_eq!(resolved.offset("saturation"), 30.0);
    }

    #[test]
    fn the_centre_is_neutral() {
        assert_eq!(offsets((0.0, 0.0), defaults()), Offsets::default());
    }

    #[test]
    fn shared_parameters_add_and_only_the_slider_total_clamps() {
        let stacked = offsets(
            (0.0, 1.0),
            vec![anchor("contrast", TOP, 40.0), anchor("contrast", TOP, 30.0)],
        );
        assert_eq!(stacked.offset("contrast"), 70.0);
        let large = offsets(
            (0.0, 1.0),
            vec![anchor("contrast", TOP, 80.0), anchor("contrast", TOP, 80.0)],
        );
        assert_eq!(large.offset("contrast"), 160.0);
        assert_eq!(large.apply("contrast", 0.0), 100.0);
        // The whole offset still counts against a slider set the other way.
        assert_eq!(large.apply("contrast", -80.0), 80.0);
        let beyond = offsets(
            (0.0, 1.0),
            (0..3).map(|_| anchor("contrast", TOP, 100.0)).collect(),
        );
        assert_eq!(beyond.offset("contrast"), 200.0);
    }

    #[test]
    fn offsets_add_to_the_slider_within_its_range() {
        let resolved = offsets((0.0, 1.0), vec![anchor("contrast", TOP, 60.0)]);
        assert_eq!(resolved.apply("contrast", 20.0), 80.0);
        assert_eq!(resolved.apply("contrast", 70.0), 100.0);
        assert_eq!(resolved.apply("exposure", 1.234), 1.234);
    }

    #[test]
    fn hue_wraps() {
        let resolved = offsets(
            (0.0, 1.0),
            vec![anchor("hue", TOP, 170.0), anchor("hue", TOP, 30.0)],
        );
        assert_eq!(resolved.offset("hue"), -160.0);
        let single = offsets((0.0, 1.0), vec![anchor("hue", TOP, 150.0)]);
        assert_eq!(single.apply("hue", 100.0), -110.0);
    }

    #[test]
    fn a_one_sided_slider_combines_and_cancels_but_stops_at_zero() {
        // Glow +40 at the top; the puck at the bottom gives −40.
        let reverse = offsets((0.0, -1.0), vec![anchor("glowAmount", TOP, 40.0)]);
        assert_eq!(reverse.offset("glowAmount"), -40.0);
        assert_eq!(reverse.apply("glowAmount", 50.0), 10.0);
        assert_eq!(reverse.apply("glowAmount", 30.0), 0.0);
        assert_eq!(reverse.apply("glowAmount", 0.0), 0.0);
        let toward = offsets((0.0, 1.0), vec![anchor("glowAmount", TOP, 40.0)]);
        assert_eq!(toward.apply("glowAmount", 80.0), 100.0);
    }

    #[test]
    fn offsets_round_to_the_slider_step() {
        let resolved = offsets(
            (0.0, 0.333),
            vec![anchor("contrast", TOP, 50.0), anchor("exposure", TOP, 1.0)],
        );
        assert_eq!(resolved.offset("contrast"), 17.0);
        assert!((resolved.offset("exposure") - 0.33).abs() < 1e-12);
    }

    #[test]
    fn amount_curves_and_the_puck_clamp() {
        let mut adjustments = pad((0.0, 0.5), vec![anchor("contrast", TOP, 80.0)]);
        adjustments["blendPad"]["amount"] = json!(0.5);
        assert_eq!(
            Offsets::from_adjustments(&adjustments).offset("contrast"),
            20.0
        );

        for (curve, half) in [("linear", 40.0), ("soft", 40.0), ("easeIn", 20.0)] {
            let mut curved = anchor("contrast", TOP, 80.0);
            curved["curve"] = json!(curve);
            assert_eq!(
                offsets((0.0, 1.0), vec![curved.clone()]).offset("contrast"),
                80.0
            );
            assert_eq!(
                offsets((0.0, -1.0), vec![curved.clone()]).offset("contrast"),
                -80.0
            );
            assert_eq!(offsets((0.0, 0.5), vec![curved]).offset("contrast"), half);
        }

        let outside = offsets((0.0, 3.0), vec![anchor("contrast", TOP, 60.0)]);
        assert_eq!(outside.offset("contrast"), 60.0);
    }

    #[test]
    fn muted_unknown_and_surplus_anchors_are_skipped() {
        let mut muted = anchor("contrast", TOP, 60.0);
        muted["muted"] = json!(true);
        let mut anchors = vec![muted, anchor("fade", TOP, 50.0), json!({ "param": 3 })];
        anchors.extend((0..MAX_ANCHORS).map(|_| anchor("whites", TOP, 10.0)));
        let resolved = offsets((0.0, 1.0), anchors);
        assert_eq!(resolved.offset("contrast"), 0.0);
        assert_eq!(resolved.offset("fade"), 0.0);
        assert_eq!(resolved.offset("whites"), 10.0 * (MAX_ANCHORS - 3) as f64);
    }

    #[test]
    fn a_disabled_missing_or_newer_pad_changes_nothing() {
        let mut disabled = pad((0.0, 1.0), defaults());
        disabled["blendPad"]["enabled"] = json!(false);
        let mut newer = pad((0.0, 1.0), defaults());
        newer["blendPad"]["version"] = json!(2);
        let mut other_shape = pad((0.0, 1.0), defaults());
        other_shape["blendPad"]["shape"] = json!("spiral");
        for adjustments in [disabled, newer, other_shape, json!({}), Value::Null] {
            assert_eq!(Offsets::from_adjustments(&adjustments), Offsets::default());
        }
    }

    /// The vectors `utils/blendPad.ts` is checked against too (`scripts/check-blend-pad.mjs`).
    #[test]
    fn shared_vectors_match() {
        let vectors: Value =
            serde_json::from_str(include_str!("../../src/utils/blendPad.vectors.json")).unwrap();
        let listed = vectors["parameters"].as_array().unwrap();
        assert_eq!(listed.len(), PARAMETERS.len());
        for (entry, parameter) in listed.iter().zip(&PARAMETERS) {
            assert_eq!(entry["id"], parameter.id);
            assert_eq!(
                entry["min"].as_f64(),
                Some(parameter.min),
                "{}",
                parameter.id
            );
            assert_eq!(
                entry["max"].as_f64(),
                Some(parameter.max),
                "{}",
                parameter.id
            );
            assert_eq!(
                entry["step"].as_f64(),
                Some(parameter.step),
                "{}",
                parameter.id
            );
            assert_eq!(entry["wraps"], parameter.wraps, "{}", parameter.id);
        }
        for case in vectors["cases"].as_array().unwrap() {
            let resolved = Offsets::from_adjustments(&json!({ "blendPad": case["pad"] }));
            for parameter in &PARAMETERS {
                let expected = case["offsets"][parameter.id].as_f64().unwrap_or(0.0);
                assert!(
                    (resolved.offset(parameter.id) - expected).abs() < 1e-9,
                    "{}: {} is {}, expected {expected}",
                    case["name"],
                    parameter.id,
                    resolved.offset(parameter.id)
                );
            }
        }
    }

    #[test]
    fn the_same_setup_and_puck_always_give_the_same_values() {
        let grid = || -> Vec<Offsets> {
            (-10..=10)
                .flat_map(|i| (-10..=10).map(move |j| (f64::from(i) / 10.0, f64::from(j) / 10.0)))
                .map(|puck| offsets(puck, defaults()))
                .collect()
        };
        assert_eq!(grid(), grid());
        for resolved in grid() {
            for (value, parameter) in resolved.0.iter().zip(&PARAMETERS) {
                assert!((parameter.min..=parameter.max).contains(value));
            }
        }
    }
}
