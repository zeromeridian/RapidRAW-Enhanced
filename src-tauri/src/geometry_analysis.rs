//! Automatic perspective correction (Auto, Level, Vertical).
//!
//! It solves for `transformRotate`, `transformVertical`, and
//! `transformHorizontal` with the exact matrix the geometry warp renders
//! with (`build_transform_matrix`), in the warp's own coordinate space: the
//! unoriented, lens-corrected source image. Coarse orientation and flips are
//! applied after the warp, so they only decide which source axis is vertical
//! on screen.
//!
//! Guided Perspective (`guided_perspective.rs`) is separate: its homography
//! is built from the guides at render time, and the analysis ignores it.

use image::{GrayImage, ImageBuffer, Luma};
use imageproc::edges::canny;
use imageproc::filter::gaussian_blur_f32;
use imageproc::gradients::{horizontal_sobel, vertical_sobel};
use imageproc::hough::{LineDetectionOptions, detect_lines};
use nalgebra::{Matrix3, Vector3};
use serde::{Deserialize, Serialize};

use crate::AppState;
use crate::guided_perspective::GuidedPerspective;
use crate::image_processing::{
    GeometryParams, build_transform_matrix, downscale_f32_image, get_geometry_params_from_json,
    is_geometry_identity, warp_image_geometry,
};

type Point = (f32, f32);

/// Longest side of the image the automatic analysis runs on.
const ANALYSIS_SIZE: u32 = 1400;
/// Canny thresholds and Hough vote fraction of the strict, then adaptive,
/// detection passes. Later passes run on a contrast-stretched image.
const DETECTION_PASSES: [(f32, f32, f32); 3] =
    [(50.0, 100.0, 0.20), (30.0, 70.0, 0.11), (15.0, 40.0, 0.065)];
/// Half-width, in pixels, of the band around a Hough line in which edge
/// pixels are collected. Hough angles are whole degrees, so the band must
/// tolerate the true edge drifting away from the detected line.
const SEED_BAND: i32 = 4;
/// Edge pixels farther than this from a fitted segment are discarded.
const FIT_INLIER_DISTANCE: f32 = 1.5;
const FIT_MAX_RMS: f32 = 1.0;
/// Segments more than this far from an axis cannot belong to its family.
const FAMILY_MAX_DEVIATION_DEGREES: f32 = 25.0;
/// Angular tolerance between a segment and the direction to its family's
/// vanishing point.
const VANISHING_POINT_TOLERANCE_DEGREES: f32 = 1.5;
/// Only the longest segments seed vanishing-point hypotheses.
const VANISHING_POINT_SEEDS: usize = 40;
/// Seed pairs closer than this fraction of the image are the same line.
const MIN_SEED_SEPARATION: f32 = 0.05;
/// Optional horizontals must span this fraction of the image height (or
/// width when rotated) to correct keystone.
const MIN_KEYSTONE_SPREAD: f32 = 0.25;
const MAX_SOLVER_SEGMENTS: usize = 150;
/// Auto keeps a horizontal keystone only when the verticals stay within
/// this mean squared sine (about 0.25°) of their own best fit.
const KEYSTONE_VERTICAL_TOLERANCE: f32 = 1.9e-5;
/// Balanced Auto limits: the area-stretch ratio across the image, and the
/// share of the frame lost beyond what leveling alone loses.
const MAX_AUTO_STRETCH: f32 = 2.2;
const MAX_AUTO_COVERAGE_LOSS: f32 = 0.15;
const MAX_ROTATION: f32 = 45.0;
const MAX_PERSPECTIVE: f32 = 100.0;

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AutoGeometryMode {
    Auto,
    Level,
    Vertical,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AutoGeometryResult {
    rotate: f32,
    vertical: Option<f32>,
    horizontal: Option<f32>,
    /// Suggested Auto Strength in percent; 100 except for Auto.
    strength: f32,
    detected_lines: usize,
}

/// A source-space axis. Lines converging along `Vertical` are corrected by
/// `transformVertical`, lines along `Horizontal` by `transformHorizontal`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Axis {
    Vertical,
    Horizontal,
}

impl Axis {
    fn other(self) -> Self {
        match self {
            Axis::Vertical => Axis::Horizontal,
            Axis::Horizontal => Axis::Vertical,
        }
    }

    /// The image extent across lines parallel to this axis.
    fn extent_across(self, width: f32, height: f32) -> f32 {
        match self {
            Axis::Vertical => width,
            Axis::Horizontal => height,
        }
    }

    /// The source axis that is vertical on screen after coarse orientation.
    fn displayed_vertical(orientation_steps: u8) -> Self {
        if orientation_steps % 2 == 1 {
            Axis::Horizontal
        } else {
            Axis::Vertical
        }
    }
}

#[derive(Clone, Copy, Debug)]
struct LineSegment {
    start: Point,
    end: Point,
}

impl LineSegment {
    fn length(&self) -> f32 {
        (self.end.0 - self.start.0).hypot(self.end.1 - self.start.1)
    }

    /// Distance of `other`'s midpoint from this segment's infinite line, which
    /// is near zero for two pieces or two sides of the same straight edge.
    fn separation_from(&self, other: &LineSegment) -> f32 {
        let middle = (
            (other.start.0 + other.end.0) * 0.5,
            (other.start.1 + other.end.1) * 0.5,
        );
        let (dx, dy) = (self.end.0 - self.start.0, self.end.1 - self.start.1);
        ((middle.0 - self.start.0) * dy - (middle.1 - self.start.1) * dx).abs()
            / dx.hypot(dy).max(1e-6)
    }

    fn deviation_from(&self, axis: Axis) -> f32 {
        let (dx, dy) = (
            (self.end.0 - self.start.0).abs(),
            (self.end.1 - self.start.1).abs(),
        );
        match axis {
            Axis::Vertical => dx.atan2(dy),
            Axis::Horizontal => dy.atan2(dx),
        }
        .to_degrees()
    }
}

/// A segment that should become parallel to `axis` after the correction.
#[derive(Clone, Copy, Debug)]
struct AxisSegment {
    segment: LineSegment,
    axis: Axis,
    weight: f32,
}

#[derive(Clone, Copy, Debug, Default)]
struct FreeAxes {
    vertical: bool,
    horizontal: bool,
}

impl FreeAxes {
    fn with(mut self, axis: Axis) -> Self {
        match axis {
            Axis::Vertical => self.vertical = true,
            Axis::Horizontal => self.horizontal = true,
        }
        self
    }
}

#[derive(Clone, Copy, Debug)]
struct Correction {
    rotate: f32,
    vertical: f32,
    horizontal: f32,
}

impl Correction {
    const NONE: Self = Self {
        rotate: 0.0,
        vertical: 0.0,
        horizontal: 0.0,
    };

    fn apply_to(self, base: &GeometryParams) -> GeometryParams {
        GeometryParams {
            rotate: self.rotate,
            vertical: self.vertical,
            horizontal: self.horizontal,
            ..*base
        }
    }

    fn clamped(self) -> Self {
        Self {
            rotate: self.rotate.clamp(-MAX_ROTATION, MAX_ROTATION),
            vertical: self.vertical.clamp(-MAX_PERSPECTIVE, MAX_PERSPECTIVE),
            horizontal: self.horizontal.clamp(-MAX_PERSPECTIVE, MAX_PERSPECTIVE),
        }
    }
}

/// Maps a point through a forward geometry matrix, refusing points on or
/// beyond the horizon line the perspective sends to infinity.
fn project(matrix: &Matrix3<f32>, point: Point) -> Option<Point> {
    let mapped = matrix * Vector3::new(point.0, point.1, 1.0);
    (mapped.z > 0.05).then(|| (mapped.x / mapped.z, mapped.y / mapped.z))
}

/// Length-weighted mean squared sine of each segment's angle to its target
/// axis after the correction. Constrain Crop's zoom scales the result about
/// its centre, which keeps every angle, so the cost leaves it out.
fn alignment_cost(
    segments: &[AxisSegment],
    base: &GeometryParams,
    width: f32,
    height: f32,
    correction: Correction,
) -> f32 {
    let matrix = build_transform_matrix(&correction.apply_to(base), width, height, 1.0);
    let mut weighted_sum = 0.0;
    let mut total_weight = 0.0;
    for axis_segment in segments {
        let (Some(start), Some(end)) = (
            project(&matrix, axis_segment.segment.start),
            project(&matrix, axis_segment.segment.end),
        ) else {
            return f32::MAX;
        };
        let (dx, dy) = (end.0 - start.0, end.1 - start.1);
        let length = dx.hypot(dy);
        if length < 1e-3 {
            return f32::MAX;
        }
        let deviation = match axis_segment.axis {
            Axis::Vertical => dx,
            Axis::Horizontal => dy,
        } / length;
        weighted_sum += axis_segment.weight * deviation * deviation;
        total_weight += axis_segment.weight;
    }
    if total_weight <= 0.0 {
        return f32::MAX;
    }

    // Prefer the least invasive solution when several projective transforms
    // satisfy the same constraints.
    weighted_sum / total_weight
        + 1e-7
            * ((correction.rotate / MAX_ROTATION).powi(2)
                + (correction.vertical / MAX_PERSPECTIVE).powi(2)
                + (correction.horizontal / MAX_PERSPECTIVE).powi(2))
}

struct AlignmentProblem<'a> {
    segments: &'a [AxisSegment],
    base: &'a GeometryParams,
    width: f32,
    height: f32,
    free: FreeAxes,
}

impl AlignmentProblem<'_> {
    fn cost(&self, correction: Correction) -> f32 {
        alignment_cost(
            self.segments,
            self.base,
            self.width,
            self.height,
            correction,
        )
    }

    fn coarse_search(&self) -> (Correction, f32) {
        let perspective_steps = |free: bool| if free { -20..=20 } else { 0..=0 };
        let mut best = (Correction::NONE, f32::MAX);
        for rotate_step in -15..=15 {
            for vertical_step in perspective_steps(self.free.vertical) {
                for horizontal_step in perspective_steps(self.free.horizontal) {
                    let correction = Correction {
                        rotate: rotate_step as f32 * 3.0,
                        vertical: vertical_step as f32 * 5.0,
                        horizontal: horizontal_step as f32 * 5.0,
                    };
                    let cost = self.cost(correction);
                    if cost < best.1 {
                        best = (correction, cost);
                    }
                }
            }
        }
        best
    }

    /// Pattern search around `start`, halving the step after each round.
    fn refine(&self, start: Correction) -> (Correction, f32) {
        let mut best = (start, self.cost(start));
        let mut rotate_step = 1.5;
        let mut perspective_step = 2.5;
        let deltas = |free: bool, step: f32| if free { [-step, 0.0, step] } else { [0.0; 3] };
        for _ in 0..12 {
            let center = best.0;
            for rotate_delta in [-rotate_step, 0.0, rotate_step] {
                for vertical_delta in deltas(self.free.vertical, perspective_step) {
                    for horizontal_delta in deltas(self.free.horizontal, perspective_step) {
                        let correction = Correction {
                            rotate: center.rotate + rotate_delta,
                            vertical: center.vertical + vertical_delta,
                            horizontal: center.horizontal + horizontal_delta,
                        }
                        .clamped();
                        let cost = self.cost(correction);
                        if cost < best.1 {
                            best = (correction, cost);
                        }
                    }
                }
            }
            rotate_step *= 0.5;
            perspective_step *= 0.5;
        }
        best
    }

    fn solve(&self) -> Option<(Correction, f32)> {
        let (coarse, _) = self.coarse_search();
        let best = self.refine(coarse);
        // `alignment_cost` reports f32::MAX for no segments or an invalid warp.
        (best.1 < f32::MAX).then_some(best)
    }
}

fn round_to_hundredths(value: f32) -> f32 {
    (value * 100.0).round() / 100.0
}

fn stretch_luma_contrast(gray: &GrayImage) -> GrayImage {
    let mut histogram = [0_u32; 256];
    for pixel in gray.pixels() {
        histogram[pixel[0] as usize] += 1;
    }

    // Ignore a very small number of clipped pixels so isolated hot or black
    // pixels do not prevent useful contrast expansion in a flat photograph.
    let clipped_pixels = (gray.width() as u64 * gray.height() as u64 / 400) as u32;
    let mut accumulated = 0_u32;
    let low = histogram
        .iter()
        .position(|count| {
            accumulated += *count;
            accumulated > clipped_pixels
        })
        .unwrap_or(0) as u8;

    accumulated = 0;
    let high = histogram
        .iter()
        .rposition(|count| {
            accumulated += *count;
            accumulated > clipped_pixels
        })
        .unwrap_or(255) as u8;

    if high.saturating_sub(low) < 8 {
        return gray.clone();
    }

    let range = u16::from(high - low);
    ImageBuffer::from_fn(gray.width(), gray.height(), |x, y| {
        let value = gray.get_pixel(x, y)[0].clamp(low, high);
        Luma([((u16::from(value - low) * 255) / range) as u8])
    })
}

/// Fits a segment to edge pixels by total least squares, refitting once
/// without outliers. Rejects curved, sparse, or short runs.
fn fit_segment(points: &[Point], min_length: f32) -> Option<LineSegment> {
    let fit = |points: &[Point]| -> Option<(Point, Point)> {
        if points.len() < 2 {
            return None;
        }
        let count = points.len() as f32;
        let mean = points
            .iter()
            .fold((0.0, 0.0), |sum, point| (sum.0 + point.0, sum.1 + point.1));
        let mean = (mean.0 / count, mean.1 / count);
        let (mut xx, mut xy, mut yy) = (0.0, 0.0, 0.0);
        for point in points {
            let (dx, dy) = (point.0 - mean.0, point.1 - mean.1);
            xx += dx * dx;
            xy += dx * dy;
            yy += dy * dy;
        }
        let angle = 0.5 * (2.0 * xy).atan2(xx - yy);
        Some((mean, (angle.cos(), angle.sin())))
    };
    let distance = |point: &Point, (mean, direction): &(Point, Point)| -> f32 {
        ((point.0 - mean.0) * direction.1 - (point.1 - mean.1) * direction.0).abs()
    };

    let first = fit(points)?;
    let inliers = points
        .iter()
        .copied()
        .filter(|point| distance(point, &first) <= FIT_INLIER_DISTANCE)
        .collect::<Vec<_>>();
    let line = fit(&inliers)?;
    let rms = (inliers
        .iter()
        .map(|point| distance(point, &line).powi(2))
        .sum::<f32>()
        / inliers.len() as f32)
        .sqrt();
    if rms > FIT_MAX_RMS {
        return None;
    }

    let (mean, direction) = line;
    let (min_t, max_t) = inliers.iter().fold((f32::MAX, f32::MIN), |range, point| {
        let t = (point.0 - mean.0) * direction.0 + (point.1 - mean.1) * direction.1;
        (range.0.min(t), range.1.max(t))
    });
    let length = max_t - min_t;
    // A straight edge leaves about one Canny pixel per pixel of length.
    if length < min_length || (inliers.len() as f32) < length * 0.6 {
        return None;
    }
    let at = |t: f32| (mean.0 + direction.0 * t, mean.1 + direction.1 * t);
    Some(LineSegment {
        start: at(min_t),
        end: at(max_t),
    })
}

/// Canny edges plus the Sobel gradient, whose direction tells the two sides
/// of a thin pole or wire apart and rejects texture crossing a line.
struct EdgeMap {
    edges: GrayImage,
    gradient_x: ImageBuffer<Luma<i16>, Vec<i16>>,
    gradient_y: ImageBuffer<Luma<i16>, Vec<i16>>,
}

/// Edge pixels whose gradient is further than this from a line's normal do
/// not belong to it (cos 30°).
const MIN_GRADIENT_ALIGNMENT: f32 = 0.87;
/// The Gaussian blur `imageproc::edges::canny` applies before its gradient.
const CANNY_SIGMA: f32 = 1.4;

/// Walks along a Hough line and returns the contiguous runs of unused edge
/// pixels within `SEED_BAND` of it, separately for each gradient polarity.
fn collect_edge_runs(
    map: &EdgeMap,
    used: &[bool],
    visited: &mut [u32],
    line_id: u32,
    (origin, direction): (Point, Point),
    max_gap: f32,
) -> Vec<Vec<(Point, usize)>> {
    let (width, height) = (map.edges.width() as i32, map.edges.height() as i32);
    let normal = (-direction.1, direction.0);
    let reach = (width as f32).hypot(height as f32);
    let mut runs = Vec::new();
    let mut current: [Vec<(Point, usize)>; 2] = [Vec::new(), Vec::new()];
    let mut last_hit = [f32::MIN; 2];
    let mut t = -reach;
    while t <= reach {
        for offset in -SEED_BAND..=SEED_BAND {
            let x = (origin.0 + direction.0 * t + normal.0 * offset as f32).round() as i32;
            let y = (origin.1 + direction.1 * t + normal.1 * offset as f32).round() as i32;
            if x < 0 || y < 0 || x >= width || y >= height {
                continue;
            }
            let index = (y * width + x) as usize;
            if visited[index] == line_id || used[index] || map.edges.as_raw()[index] == 0 {
                continue;
            }
            visited[index] = line_id;
            let gradient = (
                f32::from(map.gradient_x.as_raw()[index]),
                f32::from(map.gradient_y.as_raw()[index]),
            );
            let across = gradient.0 * normal.0 + gradient.1 * normal.1;
            if across.abs() < MIN_GRADIENT_ALIGNMENT * gradient.0.hypot(gradient.1) {
                continue;
            }
            let polarity = usize::from(across > 0.0);
            let run = &mut current[polarity];
            if t - last_hit[polarity] > max_gap && !run.is_empty() {
                runs.push(std::mem::take(run));
            }
            run.push(((x as f32, y as f32), index));
            last_hit[polarity] = t;
        }
        t += 1.0;
    }
    runs.extend(current.into_iter().filter(|run| !run.is_empty()));
    runs
}

/// Straight edge segments with sub-pixel endpoints. Hough lines only seed
/// the search; each segment is fitted to its own edge pixels.
fn detect_segments(gray: &GrayImage, pass: usize) -> Vec<LineSegment> {
    let (low_threshold, high_threshold, vote_fraction) = DETECTION_PASSES[pass];
    // Canny locates its edges on this blur; the raw image's gradient is
    // flat at the edge pixels of a thin line.
    let blurred = gaussian_blur_f32(gray, CANNY_SIGMA);
    let map = EdgeMap {
        edges: canny(gray, low_threshold, high_threshold),
        gradient_x: horizontal_sobel(&blurred),
        gradient_y: vertical_sobel(&blurred),
    };
    let edges = &map.edges;
    let min_dim = gray.width().min(gray.height()) as f32;
    let lines = detect_lines(
        edges,
        LineDetectionOptions {
            vote_threshold: ((min_dim * vote_fraction).round() as u32).max(18),
            suppression_radius: ((min_dim * 0.008).round() as u32).clamp(6, 14),
        },
    );

    let min_length = (min_dim * 0.05).max(12.0);
    let max_gap = (min_dim * 0.006).max(3.0);
    let pixel_count = edges.as_raw().len();
    let mut used = vec![false; pixel_count];
    let mut visited = vec![0_u32; pixel_count];
    let mut segments = Vec::new();
    for (line_id, line) in (1_u32..).zip(lines) {
        let (sin, cos) = (line.angle_in_degrees as f32).to_radians().sin_cos();
        let seed = ((cos * line.r, sin * line.r), (-sin, cos));
        for run in collect_edge_runs(&map, &used, &mut visited, line_id, seed, max_gap) {
            let points = run.iter().map(|(point, _)| *point).collect::<Vec<_>>();
            if let Some(segment) = fit_segment(&points, min_length) {
                for (_, index) in &run {
                    used[*index] = true;
                }
                segments.push(segment);
            }
        }
    }
    segments
}

/// Image coordinates centered on the image and scaled by its half-diagonal,
/// which keeps homogeneous intersections well conditioned.
struct NormalizedFrame {
    center: Point,
    scale: f32,
}

impl NormalizedFrame {
    fn new(width: f32, height: f32) -> Self {
        Self {
            center: (width * 0.5, height * 0.5),
            scale: width.hypot(height) * 0.5,
        }
    }

    fn point(&self, point: Point) -> Vector3<f32> {
        Vector3::new(
            (point.0 - self.center.0) / self.scale,
            (point.1 - self.center.1) / self.scale,
            1.0,
        )
    }

    fn line(&self, segment: &LineSegment) -> Vector3<f32> {
        self.point(segment.start).cross(&self.point(segment.end))
    }

    /// Whether a vanishing point lies beyond the image edges along `axis`.
    /// One inside the image belongs to receding lines (a street, a
    /// tabletop), not to verticals or horizontals that converge only through
    /// camera tilt. It is also beyond what the perspective sliders can reach.
    fn is_beyond_image(&self, vanishing_point: &Vector3<f32>, axis: Axis) -> bool {
        if vanishing_point.z.abs() <= 1e-6 * vanishing_point.norm() {
            return true;
        }
        let (along, half_extent) = match axis {
            Axis::Vertical => (vanishing_point.y, self.center.1),
            Axis::Horizontal => (vanishing_point.x, self.center.0),
        };
        (along / vanishing_point.z).abs() >= half_extent / self.scale
    }

    fn points_towards(&self, vanishing_point: &Vector3<f32>, segment: &LineSegment) -> bool {
        let start = self.point(segment.start);
        let end = self.point(segment.end);
        let direction = (end.x - start.x, end.y - start.y);
        let target = if vanishing_point.z.abs() <= 1e-6 * vanishing_point.norm() {
            (vanishing_point.x, vanishing_point.y)
        } else {
            let middle = ((start.x + end.x) * 0.5, (start.y + end.y) * 0.5);
            (
                vanishing_point.x / vanishing_point.z - middle.0,
                vanishing_point.y / vanishing_point.z - middle.1,
            )
        };
        let norms = direction.0.hypot(direction.1) * target.0.hypot(target.1);
        norms > 1e-9
            && (direction.0 * target.1 - direction.1 * target.0).abs() / norms
                <= VANISHING_POINT_TOLERANCE_DEGREES.to_radians().sin()
    }
}

/// The segments near `axis` that share the best-supported vanishing point
/// beyond the image, chosen by an exhaustive pairwise consensus over the
/// longest candidates. Lines that merely lean towards the axis, textures,
/// and receding lines do not share such a point and are left out.
fn consensus_family(
    segments: &[LineSegment],
    axis: Axis,
    width: f32,
    height: f32,
) -> Vec<LineSegment> {
    let mut candidates = segments
        .iter()
        .copied()
        .filter(|segment| segment.deviation_from(axis) <= FAMILY_MAX_DEVIATION_DEGREES)
        .collect::<Vec<_>>();
    candidates.sort_by(|first, second| second.length().total_cmp(&first.length()));
    if candidates.len() < 2 {
        return candidates;
    }

    let frame = NormalizedFrame::new(width, height);
    let lines = candidates
        .iter()
        .map(|segment| frame.line(segment))
        .collect::<Vec<_>>();
    let seeds = candidates.len().min(VANISHING_POINT_SEEDS);
    let mut best: (f32, Vec<LineSegment>) = (0.0, Vec::new());
    // Two sides of one pole, or one edge found twice, are nearly the same
    // line; their intersection is noise, not a vanishing point.
    let min_separation = axis.extent_across(width, height) * MIN_SEED_SEPARATION;
    for first in 0..seeds {
        for second in first + 1..seeds {
            if candidates[first].separation_from(&candidates[second]) < min_separation {
                continue;
            }
            let vanishing_point = lines[first].cross(&lines[second]);
            if !frame.is_beyond_image(&vanishing_point, axis) {
                continue;
            }
            let inliers = candidates
                .iter()
                .copied()
                .filter(|segment| frame.points_towards(&vanishing_point, segment))
                .collect::<Vec<_>>();
            let support = inliers.iter().map(LineSegment::length).sum::<f32>();
            if support > best.0 {
                best = (support, inliers);
            }
        }
    }
    best.1
}

fn family_support(family: &[LineSegment]) -> f32 {
    family.iter().map(LineSegment::length).sum()
}

/// How far apart the family's most distant lines are.
fn family_spread(family: &[LineSegment]) -> f32 {
    family
        .iter()
        .flat_map(|first| family.iter().map(|second| first.separation_from(second)))
        .fold(0.0, f32::max)
}

/// One detection pass's answer and how much line evidence backs it.
struct PassAnalysis {
    result: AutoGeometryResult,
    found_perspective: bool,
    /// Total length of the family the correction is anchored on: the
    /// verticals when there are any, otherwise the horizontals.
    support: f32,
}

fn analyze_segments(
    segments: &[LineSegment],
    mode: AutoGeometryMode,
    orientation_steps: u8,
    base: &GeometryParams,
    width: f32,
    height: f32,
) -> Option<PassAnalysis> {
    let displayed_vertical = Axis::displayed_vertical(orientation_steps);
    let displayed_horizontal = displayed_vertical.other();
    let family = |axis| consensus_family(segments, axis, width, height);
    let solve = |segments: &[AxisSegment], free| {
        let problem = AlignmentProblem {
            segments,
            base,
            width,
            height,
            free,
        };
        problem.solve().map(|(correction, _)| Solution {
            correction,
            free,
            detected_lines: segments.len(),
        })
    };

    let (solution, found_perspective, support) = match mode {
        AutoGeometryMode::Level => {
            let horizontal_family = family(displayed_horizontal);
            let support = family_support(&horizontal_family);
            let horizontals = to_axis_segments(horizontal_family, displayed_horizontal);
            (solve(&horizontals, FreeAxes::default())?, false, support)
        }
        AutoGeometryMode::Vertical => {
            let vertical_family = family(displayed_vertical);
            let support = family_support(&vertical_family);
            let verticals = to_axis_segments(vertical_family, displayed_vertical);
            (
                solve(&verticals, FreeAxes::default().with(displayed_vertical))?,
                true,
                support,
            )
        }
        AutoGeometryMode::Auto => {
            let vertical_family = family(displayed_vertical);
            let horizontal_family = family(displayed_horizontal);
            let support = if vertical_family.is_empty() {
                family_support(&horizontal_family)
            } else {
                family_support(&vertical_family)
            };
            // Horizontals only correct keystone when they clearly converge
            // together, as on a facade seen at an angle; otherwise they only
            // help level a scene without verticals.
            let strong_horizontals = family_support(&horizontal_family) >= width.min(height) * 0.6
                && family_spread(&horizontal_family)
                    >= displayed_horizontal.extent_across(width, height) * MIN_KEYSTONE_SPREAD;
            let verticals = to_axis_segments(vertical_family, displayed_vertical);
            let horizontals = to_axis_segments(horizontal_family, displayed_horizontal);
            let vertical_free = FreeAxes::default().with(displayed_vertical);

            if verticals.is_empty() {
                let free = if strong_horizontals {
                    FreeAxes::default().with(displayed_horizontal)
                } else {
                    FreeAxes::default()
                };
                (solve(&horizontals, free)?, strong_horizontals, support)
            } else {
                // Verticals come first. A keystone from the horizontals is
                // kept only when it leaves them as straight as before: lines
                // that recede or sag (tables, railings, wires) cannot be
                // made horizontal without bending the verticals.
                let vertical_only = solve(&verticals, vertical_free)?;
                let combined = strong_horizontals
                    .then(|| {
                        let both = [verticals.as_slice(), horizontals.as_slice()].concat();
                        solve(&both, vertical_free.with(displayed_horizontal))
                    })
                    .flatten();
                let verticals_problem = AlignmentProblem {
                    segments: &verticals,
                    base,
                    width,
                    height,
                    free: vertical_free,
                };
                let keeps_verticals = |candidate: &Solution| {
                    verticals_problem.cost(candidate.correction)
                        <= verticals_problem.cost(vertical_only.correction)
                            + KEYSTONE_VERTICAL_TOLERANCE
                };
                (
                    combined.filter(keeps_verticals).unwrap_or(vertical_only),
                    true,
                    support,
                )
            }
        }
    };

    let correction = solution.correction;
    let free_value = |is_free: bool, value: f32| is_free.then(|| round_to_hundredths(value));
    let strength = match mode {
        AutoGeometryMode::Auto => balanced_strength(base, correction, width, height),
        AutoGeometryMode::Level | AutoGeometryMode::Vertical => 100.0,
    };
    Some(PassAnalysis {
        result: AutoGeometryResult {
            rotate: round_to_hundredths(correction.rotate),
            vertical: free_value(solution.free.vertical, correction.vertical),
            horizontal: free_value(solution.free.horizontal, correction.horizontal),
            strength,
            detected_lines: solution.detected_lines,
        },
        found_perspective,
        support,
    })
}

struct Solution {
    correction: Correction,
    free: FreeAxes,
    detected_lines: usize,
}

/// The longest segments of a family, weighted by length.
fn to_axis_segments(family: Vec<LineSegment>, axis: Axis) -> Vec<AxisSegment> {
    let mut segments = family
        .into_iter()
        .map(|segment| AxisSegment {
            segment,
            axis,
            weight: segment.length(),
        })
        .collect::<Vec<_>>();
    segments.sort_by(|first, second| second.weight.total_cmp(&first.weight));
    segments.truncate(MAX_SOLVER_SEGMENTS);
    segments
}

/// The uneven stretch (as an area ratio) and the share of the output frame
/// the warped image still covers, from the exact forward matrix.
fn warp_naturalness(matrix: &Matrix3<f32>, width: f32, height: f32) -> (f32, f32) {
    let corners = [(0.0, 0.0), (width, 0.0), (width, height), (0.0, height)];
    // The area scale of a homography at a point is det / z³, so the ratio
    // of the extreme z values over the image measures its uneven stretch.
    let depths = corners.map(|(x, y)| matrix[(2, 0)] * x + matrix[(2, 1)] * y + matrix[(2, 2)]);
    let (low, high) = depths.iter().fold((f32::MAX, f32::MIN), |range, z| {
        (range.0.min(*z), range.1.max(*z))
    });
    let stretch = if low > 0.0 {
        (high / low).powi(3)
    } else {
        f32::MAX
    };
    let Some(quad) = corners
        .iter()
        .map(|corner| project(matrix, *corner))
        .collect::<Option<Vec<_>>>()
    else {
        return (stretch, 0.0);
    };
    let covered = polygon_area(&clip_to_frame(quad, width, height));
    (stretch, covered / (width * height))
}

/// Sutherland–Hodgman clip of a polygon against the output frame.
pub(crate) fn clip_to_frame(polygon: Vec<Point>, width: f32, height: f32) -> Vec<Point> {
    type Edge = (fn(Point, f32) -> f32, f32);
    // Each edge keeps points where `inside(point, limit)` is not negative.
    let edges: [Edge; 4] = [
        (|point, _| point.0, 0.0),
        (|point, limit| limit - point.0, width),
        (|point, _| point.1, 0.0),
        (|point, limit| limit - point.1, height),
    ];
    edges.iter().fold(polygon, |polygon, (inside, limit)| {
        let mut clipped = Vec::with_capacity(polygon.len() + 1);
        for (index, &current) in polygon.iter().enumerate() {
            let previous = polygon[(index + polygon.len() - 1) % polygon.len()];
            let (current_side, previous_side) = (inside(current, *limit), inside(previous, *limit));
            if (current_side >= 0.0) != (previous_side >= 0.0) {
                let t = previous_side / (previous_side - current_side);
                clipped.push((
                    previous.0 + (current.0 - previous.0) * t,
                    previous.1 + (current.1 - previous.1) * t,
                ));
            }
            if current_side >= 0.0 {
                clipped.push(current);
            }
        }
        clipped
    })
}

fn polygon_area(polygon: &[Point]) -> f32 {
    let doubled = polygon
        .iter()
        .zip(polygon.iter().cycle().skip(1))
        .map(|(first, second)| first.0 * second.1 - second.0 * first.1)
        .sum::<f32>();
    doubled.abs() * 0.5
}

/// The largest share (in percent) of a perspective correction that keeps
/// the image natural: steep upward shots keep some convergence instead of
/// being pinched at the bottom and losing much of the frame, as
/// Lightroom's Auto does. Leveling is never reduced.
fn balanced_strength(
    base: &GeometryParams,
    correction: Correction,
    width: f32,
    height: f32,
) -> f32 {
    let measure = |share: f32| {
        let scaled = Correction {
            vertical: correction.vertical * share,
            horizontal: correction.horizontal * share,
            ..correction
        };
        let matrix = build_transform_matrix(&scaled.apply_to(base), width, height, 1.0);
        warp_naturalness(&matrix, width, height)
    };
    let (_, level_coverage) = measure(0.0);
    let is_natural = |share: f32| {
        let (stretch, coverage) = measure(share);
        stretch <= MAX_AUTO_STRETCH && coverage >= level_coverage - MAX_AUTO_COVERAGE_LOSS
    };
    if is_natural(1.0) {
        return 100.0;
    }
    let (mut low, mut high) = (0.0, 1.0);
    for _ in 0..12 {
        let middle = (low + high) * 0.5;
        if is_natural(middle) {
            low = middle;
        } else {
            high = middle;
        }
    }
    (low * 100.0).floor()
}

fn analyze_geometry_pixels(
    gray: &GrayImage,
    mode: AutoGeometryMode,
    orientation_steps: u8,
    base: &GeometryParams,
) -> Result<AutoGeometryResult, String> {
    let (width, height) = (gray.width() as f32, gray.height() as f32);
    let enhanced = stretch_luma_contrast(gray);
    // A strict pass can see only a few strong edges, such as the splayed
    // legs of stacked chairs, and mistake their convergence for camera
    // tilt. Every pass is analyzed, and the one whose anchoring family has
    // the most line evidence wins. Auto prefers a pass that found
    // perspective over one that could only level the scene.
    (0..DETECTION_PASSES.len())
        .filter_map(|pass| {
            let detection_image = if pass == 0 { gray } else { &enhanced };
            let segments = detect_segments(detection_image, pass);
            analyze_segments(&segments, mode, orientation_steps, base, width, height)
        })
        .max_by(|first, second| {
            (first.found_perspective, first.support)
                .partial_cmp(&(second.found_perspective, second.support))
                .unwrap_or(std::cmp::Ordering::Equal)
        })
        .map(|analysis| analysis.result)
        .ok_or_else(|| {
            match mode {
                AutoGeometryMode::Vertical => "No reliable vertical structures were detected",
                AutoGeometryMode::Auto => "No reliable perspective structures were detected",
                AutoGeometryMode::Level => "No reliable horizontal or vertical lines were detected",
            }
            .to_string()
        })
}

/// The settings that shape the image before the perspective matrix: lens
/// correction and manual distortion only.
fn without_perspective(params: &GeometryParams) -> GeometryParams {
    let identity = GeometryParams::default();
    GeometryParams {
        vertical: identity.vertical,
        horizontal: identity.horizontal,
        rotate: identity.rotate,
        aspect: identity.aspect,
        scale: identity.scale,
        x_offset: identity.x_offset,
        y_offset: identity.y_offset,
        constrain_crop: identity.constrain_crop,
        guided_perspective: identity.guided_perspective,
        ..*params
    }
}

#[tauri::command]
pub async fn analyze_geometry(
    mode: AutoGeometryMode,
    js_adjustments: serde_json::Value,
    state: tauri::State<'_, AppState>,
) -> Result<AutoGeometryResult, String> {
    let original = {
        let guard = state.original_image.lock().unwrap();
        guard.as_ref().ok_or("No image loaded")?.image.clone()
    };
    let orientation_steps = js_adjustments["orientationSteps"].as_u64().unwrap_or(0) as u8;
    // Auto, Level, and Vertical replace Guided Perspective, so its guides
    // do not shape the analysis.
    let base = GeometryParams {
        guided_perspective: GuidedPerspective::default(),
        ..get_geometry_params_from_json(&js_adjustments)
    };

    tokio::task::spawn_blocking(move || {
        let preview = downscale_f32_image(&original, ANALYSIS_SIZE, ANALYSIS_SIZE);
        let lens_params = without_perspective(&base);
        let lens_corrected = if is_geometry_identity(&lens_params) {
            preview
        } else {
            warp_image_geometry(&preview, lens_params)
        };
        analyze_geometry_pixels(&lens_corrected.to_luma8(), mode, orientation_steps, &base)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use imageproc::drawing::draw_line_segment_mut;

    const WIDTH: u32 = 600;
    const HEIGHT: u32 = 400;

    /// Draws segments that become axis-aligned under `correction`, so the
    /// analysis should recover exactly that correction.
    fn scene_needing(
        correction: Correction,
        vertical_xs: &[f32],
        horizontal_ys: &[f32],
    ) -> GrayImage {
        let (width, height) = (WIDTH as f32, HEIGHT as f32);
        let inverse = build_transform_matrix(
            &correction.apply_to(&GeometryParams::default()),
            width,
            height,
            1.0,
        )
        .try_inverse()
        .unwrap();
        let source = |x: f32, y: f32| project(&inverse, (x * width, y * height)).unwrap();
        let mut gray = GrayImage::from_pixel(WIDTH, HEIGHT, Luma([30]));
        for &x in vertical_xs {
            draw_line_segment_mut(&mut gray, source(x, 0.12), source(x, 0.88), Luma([225]));
        }
        for &y in horizontal_ys {
            draw_line_segment_mut(&mut gray, source(0.12, y), source(0.88, y), Luma([225]));
        }
        gray
    }

    fn analyze(
        gray: &GrayImage,
        mode: AutoGeometryMode,
        orientation_steps: u8,
    ) -> AutoGeometryResult {
        analyze_geometry_pixels(gray, mode, orientation_steps, &GeometryParams::default()).unwrap()
    }

    const FACADE_XS: [f32; 5] = [0.18, 0.34, 0.5, 0.66, 0.82];
    const FACADE_YS: [f32; 4] = [0.2, 0.4, 0.6, 0.8];

    #[test]
    fn vertical_recovers_rotation_and_keystone() {
        let truth = Correction {
            rotate: 2.0,
            vertical: 25.0,
            horizontal: 0.0,
        };
        let result = analyze(
            &scene_needing(truth, &FACADE_XS, &[]),
            AutoGeometryMode::Vertical,
            0,
        );
        assert!((result.rotate - truth.rotate).abs() < 0.2, "{result:?}");
        assert!(
            (result.vertical.unwrap() - truth.vertical).abs() < 2.0,
            "{result:?}"
        );
        assert_eq!(result.horizontal, None);
    }

    #[test]
    fn auto_recovers_both_axes_on_a_facade() {
        let truth = Correction {
            rotate: -1.5,
            vertical: -20.0,
            horizontal: 15.0,
        };
        let gray = scene_needing(truth, &FACADE_XS, &FACADE_YS);
        let result = analyze(&gray, AutoGeometryMode::Auto, 0);
        assert!((result.rotate - truth.rotate).abs() < 0.2, "{result:?}");
        assert!(
            (result.vertical.unwrap() - truth.vertical).abs() < 2.0,
            "{result:?}"
        );
        assert!(
            (result.horizontal.unwrap() - truth.horizontal).abs() < 2.0,
            "{result:?}"
        );
    }

    #[test]
    fn auto_ignores_lines_receding_into_the_image() {
        let truth = Correction {
            rotate: 0.0,
            vertical: 20.0,
            horizontal: 0.0,
        };
        let mut gray = scene_needing(truth, &FACADE_XS, &[]);
        // A street or tabletop: near-horizontal lines meeting inside the
        // frame must not be read as a horizontal keystone.
        let vanishing_point = (330.0, 190.0);
        for (x, y) in [(20.0, 120.0), (20.0, 290.0), (580.0, 105.0), (580.0, 300.0)] {
            draw_line_segment_mut(&mut gray, (x, y), vanishing_point, Luma([225]));
        }
        let result = analyze(&gray, AutoGeometryMode::Auto, 0);
        assert_eq!(result.horizontal, None, "{result:?}");
        assert!(
            (result.vertical.unwrap() - truth.vertical).abs() < 2.0,
            "{result:?}"
        );
    }

    #[test]
    fn auto_drops_a_keystone_that_would_bend_the_verticals() {
        let truth = Correction {
            rotate: 0.0,
            vertical: 15.0,
            horizontal: 0.0,
        };
        let mut gray = scene_needing(truth, &FACADE_XS, &[]);
        // Converging near-horizontals that only line up with a different
        // rotation, like railings and tabletops receding at an angle.
        let conflicting = scene_needing(
            Correction {
                rotate: 4.0,
                vertical: 15.0,
                horizontal: 30.0,
            },
            &[],
            &FACADE_YS,
        );
        for (pixel, line) in gray.pixels_mut().zip(conflicting.pixels()) {
            pixel.0[0] = pixel.0[0].max(line.0[0]);
        }
        let result = analyze(&gray, AutoGeometryMode::Auto, 0);
        assert_eq!(result.horizontal, None, "{result:?}");
        assert!(result.rotate.abs() < 0.3, "{result:?}");
        assert!(
            (result.vertical.unwrap() - truth.vertical).abs() < 2.0,
            "{result:?}"
        );
    }

    #[test]
    fn auto_balances_a_steep_correction() {
        let steep = Correction {
            rotate: 0.0,
            vertical: 35.0,
            horizontal: 0.0,
        };
        let result = analyze(
            &scene_needing(steep, &FACADE_XS, &[]),
            AutoGeometryMode::Auto,
            0,
        );
        // The full correction is still reported; only the strength is lower.
        assert!(
            (result.vertical.unwrap() - steep.vertical).abs() < 2.0,
            "{result:?}"
        );
        assert!(
            result.strength > 20.0 && result.strength < 90.0,
            "{result:?}"
        );

        let gentle = Correction {
            vertical: 6.0,
            ..steep
        };
        let result = analyze(
            &scene_needing(gentle, &FACADE_XS, &[]),
            AutoGeometryMode::Auto,
            0,
        );
        assert_eq!(result.strength, 100.0, "{result:?}");
        let vertical = analyze(
            &scene_needing(steep, &FACADE_XS, &[]),
            AutoGeometryMode::Vertical,
            0,
        );
        assert_eq!(vertical.strength, 100.0, "{vertical:?}");
    }

    #[test]
    fn warp_naturalness_measures_stretch_and_coverage() {
        let identity = build_transform_matrix(&GeometryParams::default(), 600.0, 400.0, 1.0);
        let (stretch, coverage) = warp_naturalness(&identity, 600.0, 400.0);
        assert!((stretch - 1.0).abs() < 1e-5);
        assert!((coverage - 1.0).abs() < 1e-4);

        let keystone = Correction {
            rotate: 0.0,
            vertical: 30.0,
            horizontal: 0.0,
        };
        let matrix = build_transform_matrix(
            &keystone.apply_to(&GeometryParams::default()),
            600.0,
            400.0,
            1.0,
        );
        let (stretch, coverage) = warp_naturalness(&matrix, 600.0, 400.0);
        assert!(stretch > 2.0, "{stretch}");
        assert!(coverage < 0.95, "{coverage}");
    }

    #[test]
    fn vertical_follows_a_quarter_turn_orientation() {
        // Rotated a quarter turn, the source's horizontal lines are the
        // verticals on screen, corrected by the horizontal slider.
        let truth = Correction {
            rotate: 1.0,
            vertical: 0.0,
            horizontal: 20.0,
        };
        let gray = scene_needing(truth, &[], &[0.15, 0.38, 0.62, 0.85]);
        let result = analyze(&gray, AutoGeometryMode::Vertical, 1);
        assert!((result.rotate - truth.rotate).abs() < 0.2, "{result:?}");
        assert!(
            (result.horizontal.unwrap() - truth.horizontal).abs() < 2.0,
            "{result:?}"
        );
        assert_eq!(result.vertical, None);
    }

    #[test]
    fn parallel_verticals_need_no_keystone() {
        let gray = scene_needing(Correction::NONE, &FACADE_XS, &[]);
        let result = analyze(&gray, AutoGeometryMode::Vertical, 0);
        assert!(result.rotate.abs() < 0.2, "{result:?}");
        assert!(result.vertical.unwrap().abs() < 1.0, "{result:?}");
    }

    #[test]
    fn constrain_crop_does_not_change_the_correction() {
        let truth = Correction {
            rotate: 0.0,
            vertical: 30.0,
            horizontal: 0.0,
        };
        let gray = scene_needing(truth, &FACADE_XS, &[]);
        let analyze_with = |constrain_crop: bool| {
            let base = GeometryParams {
                constrain_crop,
                ..GeometryParams::default()
            };
            analyze_geometry_pixels(&gray, AutoGeometryMode::Vertical, 0, &base).unwrap()
        };
        // Constrain Crop's zoom comes after the perspective, so the same
        // lines need the same correction with it on or off.
        let free = analyze_with(false);
        let constrained = analyze_with(true);
        assert_eq!(constrained.rotate, free.rotate, "{constrained:?}");
        assert_eq!(constrained.vertical, free.vertical, "{constrained:?}");
        assert!(
            (free.vertical.unwrap() - truth.vertical).abs() < 2.0,
            "{free:?}"
        );
    }

    #[test]
    fn diagonal_lines_are_not_verticals() {
        let mut gray = GrayImage::from_pixel(320, 240, Luma([30]));
        for x in [40.0, 120.0, 200.0] {
            draw_line_segment_mut(&mut gray, (x, 20.0), (x + 100.0, 220.0), Luma([225]));
        }
        assert!(
            analyze_geometry_pixels(
                &gray,
                AutoGeometryMode::Vertical,
                0,
                &GeometryParams::default()
            )
            .is_err()
        );
    }

    #[test]
    fn adaptive_pass_finds_short_low_contrast_level_lines() {
        let mut gray = GrayImage::from_pixel(320, 240, Luma([110]));
        for index in 0..6 {
            let y = 35.0 + index as f32 * 30.0;
            draw_line_segment_mut(&mut gray, (24.0, y), (66.0, y + 4.0), Luma([124]));
        }

        assert!(detect_segments(&gray, 0).is_empty());

        let result = analyze(&gray, AutoGeometryMode::Level, 0);
        assert!(result.detected_lines >= 2);
        assert!(result.rotate.abs() > 1.0);
    }

    #[test]
    fn auto_trusts_the_pass_with_the_most_vertical_evidence() {
        // Two strong splayed edges, like the legs of stacked chairs, and
        // many faint upright edges that only the adaptive passes see.
        let mut gray = GrayImage::from_pixel(WIDTH, HEIGHT, Luma([30]));
        for x in [70.0, 140.0, 420.0, 490.0, 540.0, 300.0] {
            draw_line_segment_mut(&mut gray, (x, 50.0), (x, 350.0), Luma([44]));
        }
        draw_line_segment_mut(&mut gray, (250.0, 60.0), (235.0, 340.0), Luma([225]));
        draw_line_segment_mut(&mut gray, (350.0, 60.0), (365.0, 340.0), Luma([225]));

        let (width, height) = (WIDTH as f32, HEIGHT as f32);
        let strict = analyze_segments(
            &detect_segments(&gray, 0),
            AutoGeometryMode::Auto,
            0,
            &GeometryParams::default(),
            width,
            height,
        )
        .unwrap();
        assert!(
            strict.result.vertical.unwrap().abs() > 10.0,
            "{:?}",
            strict.result
        );

        let result = analyze(&gray, AutoGeometryMode::Auto, 0);
        assert!(result.rotate.abs() < 0.2, "{result:?}");
        assert!(result.vertical.unwrap().abs() < 2.0, "{result:?}");
    }

    #[test]
    fn level_analysis_only_rotates_the_canvas() {
        let mut gray = GrayImage::from_pixel(320, 240, Luma([30]));
        for (y1, y2) in [(35.0, 55.0), (120.0, 120.0), (205.0, 185.0)] {
            draw_line_segment_mut(&mut gray, (20.0, y1), (300.0, y2), Luma([225]));
        }

        let result = analyze(&gray, AutoGeometryMode::Level, 0);
        assert!(result.rotate.abs() < 1.0);
        assert_eq!(result.horizontal, None);
        assert_eq!(result.vertical, None);
    }

    #[test]
    fn auto_analysis_accepts_a_level_only_scene() {
        let mut gray = GrayImage::from_pixel(320, 240, Luma([30]));
        for y in [55.0, 120.0, 185.0] {
            draw_line_segment_mut(&mut gray, (20.0, y), (300.0, y + 8.0), Luma([225]));
        }

        let result = analyze(&gray, AutoGeometryMode::Auto, 0);
        assert!(result.rotate.abs() > 1.0);
    }
}
