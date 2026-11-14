//! Guided Perspective, ported from upstream RapidRAW (`cf29aa13`).
//!
//! Up to two vertical and two horizontal guide lines define an exact
//! homography (keystone plus shear), so any supported combination of guides
//! becomes exactly vertical and horizontal. The guides are stored in the
//! `guidedPerspective` adjustment in normalized coordinates of the
//! unoriented, lens-corrected source image, the space the geometry matrix
//! starts from. `build_transform_matrix` composes the homography innermost,
//! under the Rotate, Vertical, Horizontal, Aspect, Scale, and Offset sliders
//! and Constrain Crop's zoom.

use nalgebra::{Matrix3, Vector3};
use serde::{Deserialize, Serialize};

use crate::AppState;
use crate::geometry_analysis::clip_to_frame;
use crate::image_processing::{Crop, get_geometry_params_from_json, rendered_transform_matrix};

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum GuideOrientation {
    Vertical,
    Horizontal,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq)]
pub struct GuidePoint {
    pub x: f32,
    pub y: f32,
}

/// One guide in the `guidedPerspective.lines` adjustment. The frontend's
/// `id` is not needed here and is ignored.
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq)]
pub struct GuideLine {
    #[serde(rename = "type")]
    pub orientation: GuideOrientation,
    pub p1: GuidePoint,
    pub p2: GuidePoint,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
struct GuidedPerspectiveJson {
    #[serde(default)]
    enabled: bool,
    #[serde(default)]
    lines: Vec<GuideLine>,
}

/// The enabled guides, at most two per orientation. A fixed-size value keeps
/// `GeometryParams` `Copy`.
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(from = "GuidedPerspectiveJson", into = "GuidedPerspectiveJson")]
pub struct GuidedPerspective {
    vertical: [Option<GuideLine>; 2],
    horizontal: [Option<GuideLine>; 2],
}

impl From<GuidedPerspectiveJson> for GuidedPerspective {
    fn from(json: GuidedPerspectiveJson) -> Self {
        let mut guided = Self::default();
        if !json.enabled {
            return guided;
        }
        for line in json.lines {
            let slots = match line.orientation {
                GuideOrientation::Vertical => &mut guided.vertical,
                GuideOrientation::Horizontal => &mut guided.horizontal,
            };
            if let Some(slot) = slots.iter_mut().find(|slot| slot.is_none()) {
                *slot = Some(line);
            }
        }
        guided
    }
}

impl From<GuidedPerspective> for GuidedPerspectiveJson {
    fn from(guided: GuidedPerspective) -> Self {
        let lines = guided
            .vertical
            .into_iter()
            .chain(guided.horizontal)
            .flatten()
            .collect::<Vec<_>>();
        Self {
            enabled: !lines.is_empty(),
            lines,
        }
    }
}

impl GuidedPerspective {
    pub fn from_adjustments(adjustments: &serde_json::Value) -> Self {
        adjustments
            .get("guidedPerspective")
            .and_then(|value| serde::Deserialize::deserialize(value).ok())
            .unwrap_or_default()
    }

    /// Whether the guides can define a correction at all; the homography
    /// may still be rejected for a degenerate drawing.
    pub fn is_active(&self) -> bool {
        self.vertical
            .iter()
            .chain(&self.horizontal)
            .flatten()
            .count()
            >= 2
    }

    /// The homography in image coordinates centered on the image, or `None`
    /// when the guides do not define a stable correction.
    pub fn homography(&self, width: f32, height: f32) -> Option<Matrix3<f64>> {
        let (width, height) = (f64::from(width), f64::from(height));
        let valid = |lines: &[Option<GuideLine>; 2]| {
            lines
                .iter()
                .flatten()
                .filter(|line| is_line_valid(line, width, height))
                .map(|line| centered_line(line, width, height))
                .collect::<Vec<_>>()
        };
        let (verticals, horizontals) = (valid(&self.vertical), valid(&self.horizontal));

        // A vertical pair leads when there is one, as upstream does.
        let homography = match (verticals.as_slice(), horizontals.as_slice()) {
            ([first, second], horizontals) => {
                let primary = primary_vertical(vanishing_point(first, second), height)?;
                match horizontals {
                    [first, second] => {
                        secondary_horizontal_pair(&primary, vanishing_point(first, second), width)?
                    }
                    [line] => align_one_line(&primary, line, GuideOrientation::Horizontal),
                    _ => primary,
                }
            }
            (verticals, [first, second]) => {
                let primary = primary_horizontal(vanishing_point(first, second), width)?;
                match verticals {
                    [line] => align_one_line(&primary, line, GuideOrientation::Vertical),
                    _ => primary,
                }
            }
            ([vertical], [horizontal]) => {
                let (dx, dy) = horizontal.direction_towards_positive_x();
                align_one_line(
                    &rotation(-dy.atan2(dx)),
                    vertical,
                    GuideOrientation::Vertical,
                )
            }
            _ => return None,
        };
        finalize(homography, width, height)
    }
}

const EPS_INFINITY: f64 = 1e-9;
/// Guides further than this from their axis are not accepted.
const MAX_GUIDE_DEVIATION_DEGREES: f64 = 35.0;
/// The shortest guide, as a share of the image diagonal.
const MIN_GUIDE_LENGTH: f64 = 0.02;
/// A vanishing point closer than this share of the image extent to the
/// center would fold the image.
const MIN_VANISHING_DISTANCE: f64 = 0.2;

/// A guide's endpoints in pixel coordinates centered on the image.
#[derive(Clone, Copy, Debug)]
struct CenteredLine {
    start: (f64, f64),
    end: (f64, f64),
}

impl CenteredLine {
    fn homogeneous(&self) -> Vector3<f64> {
        Vector3::new(self.start.0, self.start.1, 1.0)
            .cross(&Vector3::new(self.end.0, self.end.1, 1.0))
            .normalize()
    }

    fn direction_towards_positive_x(&self) -> (f64, f64) {
        let (dx, dy) = (self.end.0 - self.start.0, self.end.1 - self.start.1);
        if dx < 0.0 { (-dx, -dy) } else { (dx, dy) }
    }
}

fn centered_line(line: &GuideLine, width: f64, height: f64) -> CenteredLine {
    let center = |point: GuidePoint| {
        (
            f64::from(point.x) * width - width / 2.0,
            f64::from(point.y) * height - height / 2.0,
        )
    };
    CenteredLine {
        start: center(line.p1),
        end: center(line.p2),
    }
}

fn is_line_valid(line: &GuideLine, width: f64, height: f64) -> bool {
    let centered = centered_line(line, width, height);
    let (dx, dy) = (
        centered.end.0 - centered.start.0,
        centered.end.1 - centered.start.1,
    );
    if dx.hypot(dy) < MIN_GUIDE_LENGTH * width.hypot(height) {
        return false;
    }
    let tolerance = MAX_GUIDE_DEVIATION_DEGREES.to_radians().tan();
    match line.orientation {
        GuideOrientation::Vertical => dx.abs() <= dy.abs() * tolerance,
        GuideOrientation::Horizontal => dy.abs() <= dx.abs() * tolerance,
    }
}

fn vanishing_point(first: &CenteredLine, second: &CenteredLine) -> Vector3<f64> {
    first.homogeneous().cross(&second.homogeneous()).normalize()
}

fn finite_point(point: &Vector3<f64>) -> Option<(f64, f64)> {
    (point.z.abs() >= EPS_INFINITY).then(|| (point.x / point.z, point.y / point.z))
}

fn rotation(theta: f64) -> Matrix3<f64> {
    let (sin, cos) = theta.sin_cos();
    Matrix3::new(cos, -sin, 0.0, sin, cos, 0.0, 0.0, 0.0, 1.0)
}

/// Makes a vertical pair parallel and upright: rotates its vanishing point
/// onto the vertical axis, then sends it to infinity.
fn primary_vertical(vanishing_point: Vector3<f64>, height: f64) -> Option<Matrix3<f64>> {
    let Some((x, y)) = finite_point(&vanishing_point) else {
        // Parallel guides only need leveling.
        let (dx, dy) = if vanishing_point.y < 0.0 {
            (-vanishing_point.x, -vanishing_point.y)
        } else {
            (vanishing_point.x, vanishing_point.y)
        };
        return Some(rotation(-(-dx).atan2(dy)));
    };
    if x.hypot(y) <= MIN_VANISHING_DISTANCE * height {
        return None;
    }
    // Upstream uses `x.atan2(y)` below the image and `dx.atan2(dy)` for
    // parallel guides, which doubles the tilt instead of removing it.
    let theta = if y < 0.0 { x.atan2(-y) } else { (-x).atan2(y) };
    let level = rotation(-theta);
    let (_, rotated_y) = finite_point(&(level * Vector3::new(x, y, 1.0)))?;
    if rotated_y.abs() < 1e-3 {
        return None;
    }
    let keystone = Matrix3::new(1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, -1.0 / rotated_y, 1.0);
    Some(keystone * level)
}

/// Makes a horizontal pair parallel and level, like [`primary_vertical`].
fn primary_horizontal(vanishing_point: Vector3<f64>, width: f64) -> Option<Matrix3<f64>> {
    let Some((x, y)) = finite_point(&vanishing_point) else {
        let (dx, dy) = if vanishing_point.x < 0.0 {
            (-vanishing_point.x, -vanishing_point.y)
        } else {
            (vanishing_point.x, vanishing_point.y)
        };
        return Some(rotation(-dy.atan2(dx)));
    };
    if x.hypot(y) <= MIN_VANISHING_DISTANCE * width {
        return None;
    }
    let theta = if x < 0.0 { (-y).atan2(-x) } else { y.atan2(x) };
    let level = rotation(-theta);
    let (rotated_x, _) = finite_point(&(level * Vector3::new(x, y, 1.0)))?;
    if rotated_x.abs() < 1e-3 {
        return None;
    }
    let keystone = Matrix3::new(1.0, 0.0, 0.0, 0.0, 1.0, 0.0, -1.0 / rotated_x, 0.0, 1.0);
    Some(keystone * level)
}

/// After the verticals are parallel and upright, makes a horizontal pair
/// parallel and level with a keystone and a shear that keep verticals
/// vertical.
fn secondary_horizontal_pair(
    primary: &Matrix3<f64>,
    vanishing_point: Vector3<f64>,
    width: f64,
) -> Option<Matrix3<f64>> {
    let mapped = (primary * vanishing_point).normalize();
    match finite_point(&mapped) {
        Some((x, y)) => {
            if x.abs() <= MIN_VANISHING_DISTANCE * width {
                return None;
            }
            let keystone = Matrix3::new(1.0, 0.0, 0.0, 0.0, 1.0, 0.0, -1.0 / x, 0.0, 1.0);
            Some(vertical_shear(-y / x) * keystone * primary)
        }
        None => {
            if mapped.x.abs() < EPS_INFINITY {
                return None;
            }
            Some(vertical_shear(-mapped.y / mapped.x) * primary)
        }
    }
}

/// `y += factor * x`: levels horizontals and keeps verticals vertical.
fn vertical_shear(factor: f64) -> Matrix3<f64> {
    Matrix3::new(1.0, 0.0, 0.0, factor, 1.0, 0.0, 0.0, 0.0, 1.0)
}

/// Shears so that one more guide becomes exactly vertical or horizontal
/// without disturbing the other axis.
fn align_one_line(
    homography: &Matrix3<f64>,
    line: &CenteredLine,
    orientation: GuideOrientation,
) -> Matrix3<f64> {
    let project =
        |point: (f64, f64)| finite_point(&(homography * Vector3::new(point.0, point.1, 1.0)));
    let (Some(start), Some(end)) = (project(line.start), project(line.end)) else {
        return *homography;
    };
    let (dx, dy) = (end.0 - start.0, end.1 - start.1);
    match orientation {
        GuideOrientation::Vertical if dy.abs() >= EPS_INFINITY => {
            Matrix3::new(1.0, -dx / dy, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0) * homography
        }
        GuideOrientation::Horizontal if dx.abs() >= EPS_INFINITY => {
            vertical_shear(-dy / dx) * homography
        }
        _ => *homography,
    }
}

/// Normalizes the homography and rejects one that is singular, sends a
/// corner through the horizon, or folds the image.
fn finalize(homography: Matrix3<f64>, width: f64, height: f64) -> Option<Matrix3<f64>> {
    if homography[(2, 2)].abs() <= 1e-15 {
        return None;
    }
    let homography = homography / homography[(2, 2)];
    if homography.determinant().abs() < 1e-9 {
        return None;
    }
    let (half_width, half_height) = (width / 2.0, height / 2.0);
    let corners = [
        (-half_width, -half_height),
        (half_width, -half_height),
        (half_width, half_height),
        (-half_width, half_height),
    ]
    .map(|(x, y)| homography * Vector3::new(x, y, 1.0));
    // Unlike upstream, every corner must stay in front of the horizon: one
    // behind it would split the warped image.
    if corners.iter().any(|corner| corner.z <= 1e-6) {
        return None;
    }
    let quad = corners.map(|corner| (corner.x / corner.z, corner.y / corner.z));
    is_convex_clockwise(&quad).then_some(homography)
}

/// Whether the quad keeps the image's corner order (clockwise on screen)
/// and stays convex.
fn is_convex_clockwise(quad: &[(f64, f64); 4]) -> bool {
    (0..4).all(|index| {
        let (x0, y0) = quad[index];
        let (x1, y1) = quad[(index + 1) % 4];
        let (x2, y2) = quad[(index + 2) % 4];
        (x1 - x0) * (y2 - y1) - (y1 - y0) * (x2 - x1) > 1e-12
    })
}

type Point = (f32, f32);

/// The horizontal extent of a convex polygon at height `y`.
fn x_bounds_at(polygon: &[Point], y: f32) -> Option<(f32, f32)> {
    let mut bounds: Option<(f32, f32)> = None;
    for (index, &(x1, y1)) in polygon.iter().enumerate() {
        let (x2, y2) = polygon[(index + 1) % polygon.len()];
        let crossings = if (y2 - y1).abs() <= f32::EPSILON {
            if (y1 - y).abs() > 1e-3 {
                continue;
            }
            [x1, x2]
        } else {
            let t = (y - y1) / (y2 - y1);
            if !(-1e-4..=1.0 + 1e-4).contains(&t) {
                continue;
            }
            let x = x1 + t * (x2 - x1);
            [x, x]
        };
        for x in crossings {
            bounds = Some(bounds.map_or((x, x), |(low, high)| (low.min(x), high.max(x))));
        }
    }
    bounds.filter(|(low, high)| high > low)
}

/// The largest axis-aligned rectangle with corners at heights `top` and
/// `bottom` inside a convex polygon, optionally with a fixed aspect ratio
/// (width over height), centered in the available slab.
fn slab_rect(polygon: &[Point], top: f32, bottom: f32, aspect: Option<f32>) -> Option<Crop> {
    let (left_top, right_top) = x_bounds_at(polygon, top)?;
    let (left_bottom, right_bottom) = x_bounds_at(polygon, bottom)?;
    let (left, right) = (left_top.max(left_bottom), right_top.min(right_bottom));
    if right <= left || bottom <= top {
        return None;
    }
    let (mut width, mut height) = (right - left, bottom - top);
    if let Some(aspect) = aspect {
        if width > height * aspect {
            width = height * aspect;
        } else {
            height = width / aspect;
        }
    }
    // A convex polygon is at least as wide between the slab's edges as at
    // both of them, so the centered rectangle stays inside.
    Some(Crop {
        x: f64::from((left + right - width) / 2.0),
        y: f64::from((top + bottom - height) / 2.0),
        width: f64::from(width),
        height: f64::from(height),
    })
}

/// Upstream's slab search for the largest inscribed rectangle: a grid over
/// the top and bottom heights, then a local refinement.
fn largest_inscribed_rect(polygon: &[Point], aspect: Option<f32>) -> Option<Crop> {
    if polygon.len() < 3 {
        return None;
    }
    let (y_min, y_max) = polygon.iter().fold((f32::MAX, f32::MIN), |range, point| {
        (range.0.min(point.1), range.1.max(point.1))
    });
    const SAMPLES: usize = 96;
    let step = (y_max - y_min) / (SAMPLES - 1) as f32;
    if step <= 0.0 {
        return None;
    }
    let area = |crop: &Crop| crop.width * crop.height;
    let mut best: Option<(Crop, f32, f32)> = None;
    let consider = |top: f32, bottom: f32, best: &mut Option<(Crop, f32, f32)>| {
        if let Some(crop) = slab_rect(polygon, top, bottom, aspect)
            && best
                .as_ref()
                .is_none_or(|(current, _, _)| area(&crop) > area(current))
        {
            *best = Some((crop, top, bottom));
        }
    };
    for first in 0..SAMPLES {
        for second in first + 1..SAMPLES {
            consider(
                y_min + step * first as f32,
                y_min + step * second as f32,
                &mut best,
            );
        }
    }
    let mut half = step;
    for _ in 0..6 {
        half *= 0.5;
        let (_, top, bottom) = best?;
        for (top_delta, bottom_delta) in [
            (-half, 0.0),
            (half, 0.0),
            (0.0, -half),
            (0.0, half),
            (-half, -half),
            (-half, half),
            (half, -half),
            (half, half),
        ] {
            consider(
                (top + top_delta).clamp(y_min, y_max),
                (bottom + bottom_delta).clamp(y_min, y_max),
                &mut best,
            );
        }
    }
    best.map(|(crop, _, _)| crop)
}

/// Maps an unoriented pixel through coarse orientation and flips, as the
/// pipeline applies them after the geometry warp.
fn orient_point(
    (x, y): Point,
    width: f32,
    height: f32,
    orientation_steps: u8,
    flip_horizontal: bool,
    flip_vertical: bool,
) -> Point {
    let (oriented, (display_width, display_height)) = match orientation_steps % 4 {
        1 => ((height - y, x), (height, width)),
        2 => ((width - x, height - y), (width, height)),
        3 => ((y, width - x), (height, width)),
        _ => ((x, y), (width, height)),
    };
    (
        if flip_horizontal {
            display_width - oriented.0
        } else {
            oriented.0
        },
        if flip_vertical {
            display_height - oriented.1
        } else {
            oriented.1
        },
    )
}

/// The full forward geometry matrix of an image, as the warp renders it.
fn forward_matrix(adjustments: &serde_json::Value, width: f32, height: f32) -> Matrix3<f32> {
    rendered_transform_matrix(&get_geometry_params_from_json(adjustments), width, height)
}

/// The largest crop (in oriented pixels, before straightening) that shows
/// no empty border, for a fixed `aspect` ratio when one is given.
fn inscribed_crop(
    adjustments: &serde_json::Value,
    forward: &Matrix3<f32>,
    width: f32,
    height: f32,
) -> Option<Crop> {
    let corners = [(0.0, 0.0), (width, 0.0), (width, height), (0.0, height)];
    let quad = corners
        .iter()
        .map(|&(x, y)| {
            let mapped = forward * Vector3::new(x, y, 1.0);
            (mapped.z > 1e-6).then(|| (mapped.x / mapped.z, mapped.y / mapped.z))
        })
        .collect::<Option<Vec<_>>>()?;
    let orientation_steps = adjustments["orientationSteps"].as_u64().unwrap_or(0) as u8;
    let flip_horizontal = adjustments["flipHorizontal"].as_bool().unwrap_or(false);
    let flip_vertical = adjustments["flipVertical"].as_bool().unwrap_or(false);
    let visible = clip_to_frame(quad, width, height)
        .into_iter()
        .map(|point| {
            orient_point(
                point,
                width,
                height,
                orientation_steps,
                flip_horizontal,
                flip_vertical,
            )
        })
        .collect::<Vec<_>>();
    let aspect = adjustments["aspectRatio"]
        .as_f64()
        .filter(|ratio| *ratio > 0.0)
        .map(|ratio| ratio as f32);
    let crop = largest_inscribed_rect(&visible, aspect)?;
    // Round inwards so the crop never touches the border.
    let (left, top) = (crop.x.ceil(), crop.y.ceil());
    let (right, bottom) = (
        (crop.x + crop.width).floor(),
        (crop.y + crop.height).floor(),
    );
    (right > left && bottom > top).then_some(Crop {
        x: left,
        y: top,
        width: right - left,
        height: bottom - top,
    })
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GuidedPerspectiveFrame {
    /// The unoriented source size the guides and the matrix refer to.
    width: u32,
    height: u32,
    /// Row-major forward geometry matrix in unoriented source pixels, and
    /// its inverse (from the warped frame back to the source).
    forward: [f32; 9],
    inverse: [f32; 9],
    /// Whether the guides produced a homography.
    solved: bool,
    /// The largest crop without empty borders, when the guides are solved.
    crop: Option<Crop>,
}

/// The geometry the Guided Perspective overlay draws through, and the crop
/// that fills the frame after the correction.
#[tauri::command]
pub fn get_guided_perspective_frame(
    js_adjustments: serde_json::Value,
    state: tauri::State<'_, AppState>,
) -> Result<GuidedPerspectiveFrame, String> {
    let (width, height) = {
        let guard = state.original_image.lock().unwrap();
        let image = &guard.as_ref().ok_or("No image loaded")?.image;
        (image.width(), image.height())
    };
    let (width_f, height_f) = (width as f32, height as f32);
    let forward = forward_matrix(&js_adjustments, width_f, height_f);
    let solved = GuidedPerspective::from_adjustments(&js_adjustments)
        .homography(width_f, height_f)
        .is_some();
    let crop = solved
        .then(|| inscribed_crop(&js_adjustments, &forward, width_f, height_f))
        .flatten();
    let row_major =
        |matrix: Matrix3<f32>| -> [f32; 9] { matrix.transpose().as_slice().try_into().unwrap() };
    Ok(GuidedPerspectiveFrame {
        width,
        height,
        forward: row_major(forward),
        inverse: row_major(
            forward
                .try_inverse()
                .ok_or("The geometry cannot be inverted")?,
        ),
        solved,
        crop,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const WIDTH: f32 = 1200.0;
    const HEIGHT: f32 = 800.0;

    fn line(orientation: GuideOrientation, p1: (f32, f32), p2: (f32, f32)) -> GuideLine {
        GuideLine {
            orientation,
            p1: GuidePoint { x: p1.0, y: p1.1 },
            p2: GuidePoint { x: p2.0, y: p2.1 },
        }
    }

    fn guided(lines: &[GuideLine]) -> GuidedPerspective {
        GuidedPerspective::from(GuidedPerspectiveJson {
            enabled: true,
            lines: lines.to_vec(),
        })
    }

    /// The guide's direction after the homography, as an angle from its
    /// target axis in degrees.
    fn deviation_after(homography: &Matrix3<f64>, guide: &GuideLine) -> f64 {
        let centered = centered_line(guide, f64::from(WIDTH), f64::from(HEIGHT));
        let project = |(x, y): (f64, f64)| {
            let mapped = homography * Vector3::new(x, y, 1.0);
            (mapped.x / mapped.z, mapped.y / mapped.z)
        };
        let (start, end) = (project(centered.start), project(centered.end));
        let (dx, dy) = ((end.0 - start.0).abs(), (end.1 - start.1).abs());
        match guide.orientation {
            GuideOrientation::Vertical => dx.atan2(dy),
            GuideOrientation::Horizontal => dy.atan2(dx),
        }
        .to_degrees()
    }

    fn assert_aligned(lines: &[GuideLine]) {
        let homography = guided(lines).homography(WIDTH, HEIGHT).unwrap();
        for guide in lines {
            let deviation = deviation_after(&homography, guide);
            // Guide points are f32, so a few millionths of a degree remain.
            assert!(deviation < 1e-4, "{guide:?} deviates by {deviation}°");
        }
    }

    // Converging verticals, as from a camera tilted upwards.
    fn left_vertical() -> GuideLine {
        line(GuideOrientation::Vertical, (0.25, 0.1), (0.2, 0.9))
    }
    fn right_vertical() -> GuideLine {
        line(GuideOrientation::Vertical, (0.75, 0.1), (0.8, 0.9))
    }
    // Converging, slightly tilted horizontals.
    fn top_horizontal() -> GuideLine {
        line(GuideOrientation::Horizontal, (0.1, 0.22), (0.9, 0.18))
    }
    fn bottom_horizontal() -> GuideLine {
        line(GuideOrientation::Horizontal, (0.1, 0.8), (0.9, 0.86))
    }

    #[test]
    fn every_guide_combination_becomes_exact() {
        assert_aligned(&[left_vertical(), right_vertical()]);
        assert_aligned(&[top_horizontal(), bottom_horizontal()]);
        assert_aligned(&[left_vertical(), top_horizontal()]);
        assert_aligned(&[left_vertical(), right_vertical(), top_horizontal()]);
        assert_aligned(&[top_horizontal(), bottom_horizontal(), left_vertical()]);
        assert_aligned(&[
            left_vertical(),
            right_vertical(),
            top_horizontal(),
            bottom_horizontal(),
        ]);
    }

    #[test]
    fn verticals_converging_downwards_become_upright() {
        // Upstream doubled the tilt here (camera pointing down).
        assert_aligned(&[
            line(GuideOrientation::Vertical, (0.2, 0.1), (0.25, 0.9)),
            line(GuideOrientation::Vertical, (0.8, 0.1), (0.75, 0.9)),
        ]);
        assert_aligned(&[
            line(GuideOrientation::Vertical, (0.2, 0.1), (0.25, 0.9)),
            line(GuideOrientation::Vertical, (0.8, 0.1), (0.75, 0.9)),
            top_horizontal(),
            bottom_horizontal(),
        ]);
    }

    #[test]
    fn parallel_guides_only_level() {
        let tilted = [
            line(GuideOrientation::Vertical, (0.3, 0.1), (0.32, 0.9)),
            line(GuideOrientation::Vertical, (0.7, 0.1), (0.72, 0.9)),
        ];
        let homography = guided(&tilted).homography(WIDTH, HEIGHT).unwrap();
        assert!(
            homography[(2, 0)].abs() < 1e-9 && homography[(2, 1)].abs() < 1e-9,
            "{homography}"
        );
        assert_aligned(&tilted);
    }

    #[test]
    fn guides_need_two_lines_and_valid_angles() {
        assert!(
            guided(&[left_vertical()])
                .homography(WIDTH, HEIGHT)
                .is_none()
        );
        // A 45° "vertical" is neither vertical nor horizontal.
        let diagonal = line(GuideOrientation::Vertical, (0.2, 0.2), (0.6, 0.8));
        assert!(
            guided(&[left_vertical(), diagonal])
                .homography(WIDTH, HEIGHT)
                .is_none()
        );
        // Guides crossing inside the image would fold it.
        let crossing = [
            line(GuideOrientation::Vertical, (0.3, 0.1), (0.7, 0.9)),
            line(GuideOrientation::Vertical, (0.7, 0.1), (0.3, 0.9)),
        ];
        assert!(guided(&crossing).homography(WIDTH, HEIGHT).is_none());
    }

    #[test]
    fn disabled_or_extra_guides_are_ignored() {
        let json = serde_json::json!({
            "guidedPerspective": {
                "enabled": false,
                "lines": [
                    { "id": "a", "type": "vertical", "p1": { "x": 0.25, "y": 0.1 }, "p2": { "x": 0.2, "y": 0.9 } },
                    { "id": "b", "type": "vertical", "p1": { "x": 0.75, "y": 0.1 }, "p2": { "x": 0.8, "y": 0.9 } }
                ]
            }
        });
        assert!(!GuidedPerspective::from_adjustments(&json).is_active());

        let third = line(GuideOrientation::Vertical, (0.5, 0.1), (0.5, 0.9));
        let capped = guided(&[left_vertical(), right_vertical(), third]);
        assert_eq!(capped, guided(&[left_vertical(), right_vertical()]));
    }

    #[test]
    fn guides_round_trip_through_json() {
        let original = guided(&[left_vertical(), top_horizontal()]);
        let json = serde_json::to_value(original).unwrap();
        assert_eq!(json["enabled"], true);
        let parsed: GuidedPerspective = serde_json::from_value(json).unwrap();
        assert_eq!(parsed, original);
    }

    #[test]
    fn inscribed_rect_fills_a_trapezoid_and_honours_the_aspect_ratio() {
        // Narrower at the top, as after correcting converging verticals.
        let trapezoid = [(200.0, 0.0), (1000.0, 0.0), (1200.0, 800.0), (0.0, 800.0)];
        let free = largest_inscribed_rect(&trapezoid, None).unwrap();
        // Width grows by half a pixel per row, which never pays for the
        // lost height: the best rectangle spans the full height at the top
        // edge's width, 800 × 800.
        assert!(
            (free.width * free.height - 640_000.0).abs() < 6_400.0,
            "{free:?}"
        );
        let square = largest_inscribed_rect(&trapezoid, Some(1.0)).unwrap();
        assert!((square.width - square.height).abs() < 1e-3, "{square:?}");
        for crop in [free, square] {
            for (x, y) in [
                (crop.x, crop.y),
                (crop.x + crop.width, crop.y),
                (crop.x, crop.y + crop.height),
                (crop.x + crop.width, crop.y + crop.height),
            ] {
                let (left, right) = x_bounds_at(&trapezoid, y as f32).unwrap();
                assert!(
                    x as f32 >= left - 0.5 && x as f32 <= right + 0.5,
                    "{crop:?}"
                );
            }
        }
    }

    #[test]
    fn guided_homography_renders_through_the_geometry_matrix() {
        let adjustments = serde_json::json!({
            "guidedPerspective": {
                "enabled": true,
                "lines": [
                    { "id": "a", "type": "vertical", "p1": { "x": 0.25, "y": 0.1 }, "p2": { "x": 0.2, "y": 0.9 } },
                    { "id": "b", "type": "vertical", "p1": { "x": 0.75, "y": 0.1 }, "p2": { "x": 0.8, "y": 0.9 } }
                ]
            }
        });
        let forward = forward_matrix(&adjustments, WIDTH, HEIGHT);
        let project = |(x, y): (f32, f32)| {
            let mapped = forward * Vector3::new(x * WIDTH, y * HEIGHT, 1.0);
            (mapped.x / mapped.z, mapped.y / mapped.z)
        };
        for (top, bottom) in [((0.25, 0.1), (0.2, 0.9)), ((0.75, 0.1), (0.8, 0.9))] {
            let (start, end) = (project(top), project(bottom));
            assert!((start.0 - end.0).abs() < 0.05, "{start:?} {end:?}");
        }

        let crop = inscribed_crop(&adjustments, &forward, WIDTH, HEIGHT).unwrap();
        assert!(crop.x >= 0.0 && crop.y >= 0.0);
        assert!(crop.x + crop.width <= f64::from(WIDTH));
        assert!(crop.y + crop.height <= f64::from(HEIGHT));
        assert!(crop.width * crop.height > f64::from(WIDTH * HEIGHT) * 0.5);
    }

    #[test]
    fn orientation_maps_like_the_pipeline() {
        assert_eq!(
            orient_point((10.0, 20.0), 100.0, 50.0, 1, false, false),
            (30.0, 10.0)
        );
        assert_eq!(
            orient_point((10.0, 20.0), 100.0, 50.0, 2, false, false),
            (90.0, 30.0)
        );
        assert_eq!(
            orient_point((10.0, 20.0), 100.0, 50.0, 3, false, false),
            (20.0, 90.0)
        );
        assert_eq!(
            orient_point((10.0, 20.0), 100.0, 50.0, 0, true, true),
            (90.0, 30.0)
        );
    }
}
