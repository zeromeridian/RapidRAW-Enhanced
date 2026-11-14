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

/// Marks a file of exported pad presets.
const PRESET_FILE_FORMAT: &str = "ThisIsRAW Blend Pad presets";
const PRESET_FILE_VERSION: u32 = 1;

/// Writes pad presets to a JSON file. The pad panel builds and cleans the presets
/// (`utils/blendPad.ts`); this only wraps them with the file's format and version.
#[tauri::command]
pub fn export_blend_pad_presets(presets: Vec<Value>, file_path: String) -> Result<(), String> {
    let file = serde_json::json!({
        "format": PRESET_FILE_FORMAT,
        "version": PRESET_FILE_VERSION,
        "presets": presets,
    });
    let text = serde_json::to_string_pretty(&file)
        .map_err(|e| format!("Failed to write the blend pad presets: {e}"))?;
    std::fs::write(&file_path, text).map_err(|e| format!("Failed to save {file_path}: {e}"))
}

/// Reads the presets of a pad preset file: an exported file, a bare list, or a single preset.
/// The pad panel cleans every preset before it keeps any.
#[tauri::command]
pub fn import_blend_pad_presets(file_path: String) -> Result<Vec<Value>, String> {
    let text = std::fs::read_to_string(&file_path)
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

    fn add(self, other: Point) -> Point {
        Point {
            x: self.x + other.x,
            y: self.y + other.y,
        }
    }

    fn sub(self, other: Point) -> Point {
        Point {
            x: self.x - other.x,
            y: self.y - other.y,
        }
    }

    fn cross(self, other: Point) -> f64 {
        self.x * other.y - self.y * other.x
    }
}

/// The pad's outline, centred on (0, 0) in normalised space with y up.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Shape {
    /// Radius 1.
    #[default]
    Circle,
    Triangle,
    Square,
    /// 3:2, landscape.
    Rectangle,
    Pentagon,
    Hexagon,
}

/// The rectangle's width to height.
const RECTANGLE_ASPECT: f64 = 1.5;

impl Shape {
    /// The corners, anticlockwise from the first one past the right (angle 0), all on the unit
    /// circle so every shape fits the same space; `None` for the circle. The triangle, pentagon
    /// and hexagon have a corner at the top; the square and the rectangle sit flat.
    fn corners(self) -> Option<Vec<Point>> {
        let regular = |sides: u32, first_turn: f64| -> Vec<Point> {
            (0..sides)
                .map(|k| {
                    let angle = TAU * (first_turn + f64::from(k) / f64::from(sides));
                    Point {
                        x: angle.cos(),
                        y: angle.sin(),
                    }
                })
                .collect()
        };
        let mut corners = match self {
            Shape::Circle => return None,
            Shape::Triangle => regular(3, 0.25),
            Shape::Square => regular(4, 0.125),
            Shape::Pentagon => regular(5, 0.25),
            Shape::Hexagon => regular(6, 0.25),
            Shape::Rectangle => {
                let diagonal = RECTANGLE_ASPECT.hypot(1.0);
                let (x, y) = (RECTANGLE_ASPECT / diagonal, 1.0 / diagonal);
                [(x, y), (-x, y), (-x, -y), (x, -y)]
                    .map(|(x, y)| Point { x, y })
                    .to_vec()
            }
        };
        let turn = |point: &Point| {
            let angle = point.y.atan2(point.x);
            if angle <= 0.0 { angle + TAU } else { angle }
        };
        corners.sort_by(|a, b| turn(a).total_cmp(&turn(b)));
        Some(corners)
    }

    /// The outline as a closed path from where it crosses the right (+x), anticlockwise.
    fn perimeter_path(self, corners: &[Point]) -> Vec<Point> {
        let start = Point {
            x: self.edge_distance(Point { x: 1.0, y: 0.0 }),
            y: 0.0,
        };
        let mut path = Vec::with_capacity(corners.len() + 2);
        path.push(start);
        path.extend_from_slice(corners);
        path.push(start);
        path
    }

    /// The edge point at perimeter position `t` (0–1 along the outline from the right,
    /// anticlockwise), so anchors keep their place when the shape changes.
    pub fn point_at(self, t: f64) -> Point {
        let Some(corners) = self.corners() else {
            return Point {
                x: (TAU * t).cos(),
                y: (TAU * t).sin(),
            };
        };
        let path = self.perimeter_path(&corners);
        let lengths: Vec<f64> = path
            .windows(2)
            .map(|pair| pair[1].sub(pair[0]).length())
            .collect();
        let mut remaining = t.rem_euclid(1.0) * lengths.iter().sum::<f64>();
        for (pair, length) in path.windows(2).zip(&lengths) {
            if remaining <= *length {
                return pair[0].add(pair[1].sub(pair[0]).scale(remaining / length));
            }
            remaining -= length;
        }
        path[0]
    }

    /// How far from the centre the ray in the unit `direction` leaves the shape.
    fn edge_distance(self, direction: Point) -> f64 {
        let Some(corners) = self.corners() else {
            return 1.0;
        };
        let mut nearest = f64::INFINITY;
        for (index, corner) in corners.iter().enumerate() {
            let edge = corners[(index + 1) % corners.len()].sub(*corner);
            let denominator = direction.cross(edge);
            if denominator.abs() < EPSILON {
                continue;
            }
            let distance = corner.cross(edge) / denominator;
            let along_edge = corner.cross(direction) / denominator;
            if distance > 0.0 && (-EPSILON..=1.0 + EPSILON).contains(&along_edge) {
                nearest = nearest.min(distance);
            }
        }
        nearest
    }

    /// The point pulled inside the shape toward the centre, if it lies outside.
    pub fn clamp(self, point: Point) -> Point {
        let radius = point.length();
        if radius < EPSILON {
            return point;
        }
        let edge = self.edge_distance(point.scale(1.0 / radius));
        if radius > edge {
            point.scale(edge / radius)
        } else {
            point
        }
    }

    /// The point opposite the anchor at `t`, where its reverse is strongest.
    #[cfg(test)]
    fn opposite_point(self, t: f64) -> Point {
        let anchor = self.point_at(t);
        let reach = anchor.length();
        if reach < EPSILON {
            return anchor;
        }
        let away = anchor.scale(-1.0 / reach);
        away.scale(self.edge_distance(away))
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

/// How the puck's position becomes each tool's share of its value at the dot.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Mode {
    /// Each tool along its own line through the centre: its full value at its dot, nothing at
    /// the centre, its reverse at the opposite edge point (unless Reverse is off).
    #[default]
    Axis,
    /// Shares by closeness (1 / distance²) that always add up to 1: a crossfade between the
    /// tools, never neutral; on a dot only that tool counts.
    Normalized,
    /// The puck's direction mixes the two neighbouring tools around the edge; its distance
    /// from the centre (0 there, 1 on the edge) sets the strength.
    Polar,
}

/// A point's direction as an angle in [0, 2π).
fn turn_of(point: Point) -> f64 {
    let angle = point.y.atan2(point.x);
    if angle < 0.0 { angle + TAU } else { angle }
}

impl Mode {
    /// Each tool's factor (its share, shaped by its curve); the offset is target × factor ×
    /// amount. `anchors` are the tools that take part, in pad order.
    fn factors(self, shape: Shape, anchors: &[&Anchor], puck: Point) -> Vec<f64> {
        match self {
            Mode::Axis => anchors
                .iter()
                .map(|anchor| {
                    let weight = shape.axis_weight(anchor.t, puck);
                    if weight < 0.0 && !anchor.reverse {
                        0.0
                    } else {
                        anchor.curve.apply(weight.abs()) * weight.signum()
                    }
                })
                .collect(),
            Mode::Normalized => {
                let distances: Vec<f64> = anchors
                    .iter()
                    .map(|anchor| puck.sub(shape.point_at(anchor.t)).length())
                    .collect();
                if let Some(on_dot) = distances.iter().position(|distance| *distance < EPSILON) {
                    return (0..anchors.len())
                        .map(|index| if index == on_dot { 1.0 } else { 0.0 })
                        .collect();
                }
                let closeness: Vec<f64> = distances
                    .iter()
                    .map(|distance| 1.0 / (distance * distance))
                    .collect();
                let total: f64 = closeness.iter().sum();
                anchors
                    .iter()
                    .zip(closeness)
                    .map(|(anchor, share)| anchor.curve.apply(share / total))
                    .collect()
            }
            Mode::Polar => {
                let radius = puck.length();
                let mut shares = vec![0.0; anchors.len()];
                if radius < EPSILON || anchors.is_empty() {
                    return shares;
                }
                let direction = puck.scale(1.0 / radius);
                let strength = (radius / shape.edge_distance(direction)).min(1.0);
                let puck_turn = turn_of(puck);
                let turns: Vec<f64> = anchors
                    .iter()
                    .map(|anchor| turn_of(shape.point_at(anchor.t)))
                    .collect();
                // The tools on either side of the puck's direction (the first on ties),
                // wrapping round past 0.
                let (mut before, mut after) = (None::<usize>, None::<usize>);
                let (mut lowest, mut highest) = (0, 0);
                for (index, turn) in turns.iter().enumerate() {
                    if *turn <= puck_turn && before.is_none_or(|b| *turn > turns[b]) {
                        before = Some(index);
                    }
                    if *turn > puck_turn && after.is_none_or(|a| *turn < turns[a]) {
                        after = Some(index);
                    }
                    if *turn < turns[lowest] {
                        lowest = index;
                    }
                    if *turn > turns[highest] {
                        highest = index;
                    }
                }
                let before = before.unwrap_or(highest);
                let after = after.unwrap_or(lowest);
                if before == after {
                    shares[before] = 1.0;
                } else {
                    let gap = (turns[after] - turns[before]).rem_euclid(TAU);
                    let along = (puck_turn - turns[before]).rem_euclid(TAU);
                    let mix = if gap < EPSILON {
                        0.0
                    } else {
                        (along / gap).clamp(0.0, 1.0)
                    };
                    shares[before] += 1.0 - mix;
                    shares[after] += mix;
                }
                anchors
                    .iter()
                    .zip(shares)
                    .map(|(anchor, share)| share * anchor.curve.apply(strength))
                    .collect()
            }
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
    /// Whether the opposite side gives the target's reverse; off, the tool fades to 0 at the
    /// centre and gives nothing beyond it. On when absent (pads saved before it existed).
    #[serde(default = "reverse_by_default")]
    reverse: bool,
}

fn reverse_by_default() -> bool {
    true
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
    #[serde(default)]
    mode: Mode,
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
        // The tools that take part: valid, not muted, driving a known slider.
        let active: Vec<(usize, Anchor)> = pad
            .anchors
            .iter()
            .take(MAX_ANCHORS)
            .filter_map(|anchor| Anchor::deserialize(anchor).ok())
            .filter(|anchor| !anchor.muted)
            .filter_map(|anchor| parameter_index(&anchor.param).map(|index| (index, anchor)))
            .collect();
        let anchors: Vec<&Anchor> = active.iter().map(|(_, anchor)| anchor).collect();
        let factors = pad.mode.factors(pad.shape, &anchors, puck);
        for ((index, anchor), factor) in active.iter().zip(factors) {
            sums[*index] += anchor.target * factor * amount;
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
    fn preset_files_round_trip_and_accept_lists_and_single_presets() {
        let preset = json!({ "id": "a", "name": "Moody", "pad": { "version": 1 } });
        let path = std::env::temp_dir().join(format!("tir-blend-pad-{}.json", std::process::id()));
        let path_text = path.to_string_lossy().to_string();
        export_blend_pad_presets(vec![preset.clone()], path_text.clone()).unwrap();
        let written: Value =
            serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(written["format"], PRESET_FILE_FORMAT);
        assert_eq!(written["version"], PRESET_FILE_VERSION);
        assert_eq!(
            import_blend_pad_presets(path_text.clone()).unwrap(),
            vec![preset.clone()]
        );
        std::fs::remove_file(&path).unwrap();

        assert_eq!(
            presets_in_file(json!([preset.clone()])),
            vec![preset.clone()]
        );
        assert_eq!(presets_in_file(preset.clone()), vec![preset]);
        assert!(presets_in_file(json!(3)).is_empty());
        assert!(import_blend_pad_presets(path_text).is_err());
    }

    const SHAPES: [Shape; 6] = [
        Shape::Circle,
        Shape::Triangle,
        Shape::Square,
        Shape::Rectangle,
        Shape::Pentagon,
        Shape::Hexagon,
    ];

    #[test]
    fn every_shape_gives_one_at_the_anchor_minus_one_opposite_and_zero_at_the_centre() {
        for shape in SHAPES {
            // Corners included: every shape has one near 1/n of the way round, and these
            // positions land on the triangle's and the square's.
            for t in [
                0.0,
                0.1,
                0.125,
                2.0 / 9.0,
                0.25,
                0.37,
                0.5,
                0.625,
                0.8,
                0.99,
            ] {
                let at = shape.point_at(t);
                assert!(
                    (shape.axis_weight(t, at) - 1.0).abs() < 1e-9,
                    "{shape:?} at {t}"
                );
                assert!(
                    (shape.axis_weight(t, shape.opposite_point(t)) + 1.0).abs() < 1e-9,
                    "{shape:?} opposite {t}"
                );
                assert_eq!(shape.axis_weight(t, Point::default()), 0.0);
                assert!(at.length() <= 1.0 + 1e-9, "{shape:?} fits the unit circle");
            }
        }
    }

    #[test]
    fn every_shape_clamps_the_puck_inside_and_keeps_weights_in_range() {
        for shape in SHAPES {
            for i in -15..=15 {
                for j in -15..=15 {
                    let puck = shape.clamp(Point {
                        x: f64::from(i) / 10.0,
                        y: f64::from(j) / 10.0,
                    });
                    let radius = puck.length();
                    if radius > EPSILON {
                        let edge = shape.edge_distance(puck.scale(1.0 / radius));
                        assert!(radius <= edge + 1e-9, "{shape:?} clamps {i},{j}");
                    }
                    for t in [0.0, 0.2, 0.45, 0.7] {
                        let weight = shape.axis_weight(t, puck);
                        assert!((-1.0..=1.0).contains(&weight), "{shape:?} {t}");
                    }
                }
            }
        }
    }

    #[test]
    fn a_triangle_measures_each_side_of_the_centre_on_its_own() {
        // The top corner is 1 from the centre, the bottom edge only 0.5.
        let top = 2.0 / 9.0;
        let at = Shape::Triangle.point_at(top);
        assert!(at.x.abs() < 1e-9 && (at.y - 1.0).abs() < 1e-9);
        let half_up = Shape::Triangle.axis_weight(top, Point { x: 0.0, y: 0.5 });
        let half_down = Shape::Triangle.axis_weight(top, Point { x: 0.0, y: -0.5 });
        assert!((half_up - 0.5).abs() < 1e-9);
        assert!((half_down + 1.0).abs() < 1e-9);
    }

    #[test]
    fn anchors_keep_their_position_when_the_shape_changes() {
        let mut adjustments = pad((0.0, 0.5), vec![anchor("contrast", TOP, 60.0)]);
        for shape in [
            "circle",
            "triangle",
            "square",
            "rectangle",
            "pentagon",
            "hexagon",
        ] {
            adjustments["blendPad"]["shape"] = json!(shape);
            let resolved = Offsets::from_adjustments(&adjustments);
            assert!(resolved.offset("contrast") > 0.0, "{shape}");
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

    fn offsets_in(mode: &str, puck: (f64, f64), anchors: Vec<Value>) -> Offsets {
        let mut adjustments = pad(puck, anchors);
        adjustments["blendPad"]["mode"] = json!(mode);
        Offsets::from_adjustments(&adjustments)
    }

    #[test]
    fn normalized_shares_add_up_to_one_and_a_dot_takes_all() {
        // At the centre of a circle every tool is as close: a third each.
        let centre = offsets_in("normalized", (0.0, 0.0), defaults());
        assert_eq!(centre.offset("contrast"), 20.0);
        assert_eq!(centre.offset("temperature"), 17.0);
        assert_eq!(centre.offset("saturation"), -20.0);
        let on_dot = offsets_in("normalized", (0.0, 1.0), defaults());
        assert_eq!(on_dot.offset("contrast"), 60.0);
        assert_eq!(on_dot.offset("temperature"), 0.0);
        assert_eq!(on_dot.offset("saturation"), 0.0);
        // A muted tool takes no share: the other two split it.
        let mut anchors = defaults();
        anchors[2]["muted"] = json!(true);
        let muted = offsets_in("normalized", (0.0, 0.0), anchors);
        assert_eq!(muted.offset("contrast"), 30.0);
        assert_eq!(muted.offset("temperature"), 25.0);
        assert_eq!(muted.offset("saturation"), 0.0);
    }

    #[test]
    fn polar_mixes_the_two_neighbours_and_the_centre_is_neutral() {
        assert_eq!(
            offsets_in("polar", (0.0, 0.0), defaults()),
            Offsets::default()
        );
        // Straight towards Contrast, halfway out: Contrast only, at half strength.
        let up = offsets_in("polar", (0.0, 0.5), defaults());
        assert_eq!(up.offset("contrast"), 30.0);
        assert_eq!(up.offset("saturation"), 0.0);
        // On the edge halfway between Contrast (90°) and Saturation (210°).
        let angle = 150f64.to_radians();
        let between = offsets_in("polar", (angle.cos(), angle.sin()), defaults());
        assert_eq!(between.offset("contrast"), 30.0);
        assert_eq!(between.offset("saturation"), -30.0);
        assert_eq!(between.offset("temperature"), 0.0);
        // Right (0°), 0.8 out: a quarter of the way from Temperature (330°) to Contrast (90°).
        let right = offsets_in("polar", (0.8, 0.0), defaults());
        assert_eq!(right.offset("temperature"), 30.0);
        assert_eq!(right.offset("contrast"), 12.0);
        // One tool: the direction does not matter, only the distance.
        let single = offsets_in("polar", (-0.5, 0.0), vec![anchor("contrast", TOP, 60.0)]);
        assert_eq!(single.offset("contrast"), 30.0);
    }

    #[test]
    fn an_unknown_mode_changes_nothing() {
        assert_eq!(
            offsets_in("spiral", (0.0, 1.0), defaults()),
            Offsets::default()
        );
    }

    #[test]
    fn a_tool_without_reverse_gives_nothing_past_the_centre() {
        let mut one_way = anchor("whites", TOP, -80.0);
        one_way["reverse"] = json!(false);
        assert_eq!(
            offsets((0.0, 1.0), vec![one_way.clone()]).offset("whites"),
            -80.0
        );
        assert_eq!(
            offsets((0.0, 0.5), vec![one_way.clone()]).offset("whites"),
            -40.0
        );
        assert_eq!(
            offsets((0.0, -0.5), vec![one_way.clone()]).offset("whites"),
            0.0
        );
        assert_eq!(offsets((0.0, -1.0), vec![one_way]).offset("whites"), 0.0);
        // Absent, it reverses as before.
        assert_eq!(
            offsets((0.0, -1.0), vec![anchor("whites", TOP, -80.0)]).offset("whites"),
            80.0
        );
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
