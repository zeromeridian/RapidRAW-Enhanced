import {
  Adjustments,
  Coord,
  GuideLine,
  GuideOrientation,
  INITIAL_ADJUSTMENTS,
  MAX_GUIDES_PER_ORIENTATION,
} from './adjustments';
import { OrientationTransform, orientNormalizedPoint, unorientNormalizedPoint } from './cropUtils';

/** The geometry Guided Perspective draws through (`get_guided_perspective_frame`). */
export interface GuidedPerspectiveFrame {
  /** The unoriented source size the guides and matrices refer to. */
  width: number;
  height: number;
  /** Row-major forward geometry matrix in source pixels, and its inverse. */
  forward: number[];
  inverse: number[];
  /** Whether the guides produced a correction. */
  solved: boolean;
  /** The largest crop without empty borders, in oriented pixels. */
  crop: { x: number; y: number; width: number; height: number } | null;
}

/** Guides further than this from their axis on screen are rejected, as upstream does. */
const MAX_GUIDE_DEVIATION_DEGREES = 35;

const project = (matrix: number[], x: number, y: number): Coord | null => {
  const w = matrix[6] * x + matrix[7] * y + matrix[8];
  if (Math.abs(w) < 1e-9) return null;
  return {
    x: (matrix[0] * x + matrix[1] * y + matrix[2]) / w,
    y: (matrix[3] * x + matrix[4] * y + matrix[5]) / w,
  };
};

/** A guide point (normalized source) to its normalized position on the uncropped preview. */
export const sourceToDisplay = (
  point: Coord,
  frame: GuidedPerspectiveFrame,
  orientation: OrientationTransform,
): Coord | null => {
  const warped = project(frame.forward, point.x * frame.width, point.y * frame.height);
  if (!warped) return null;
  const [x, y] = orientNormalizedPoint(warped.x / frame.width, warped.y / frame.height, orientation);
  return { x, y };
};

/** Inverse of {@link sourceToDisplay}, clamped to the source image. */
export const displayToSource = (
  point: Coord,
  frame: GuidedPerspectiveFrame,
  orientation: OrientationTransform,
): Coord | null => {
  const [x, y] = unorientNormalizedPoint(point.x, point.y, orientation);
  const source = project(frame.inverse, x * frame.width, y * frame.height);
  if (!source) return null;
  return {
    x: Math.min(1, Math.max(0, source.x / frame.width)),
    y: Math.min(1, Math.max(0, source.y / frame.height)),
  };
};

/**
 * A quarter turn swaps the axes: guides are stored with their source-space
 * orientation, which the solver uses, and shown with their on-screen one.
 */
export const swapOrientationForQuarterTurn = (
  orientation: GuideOrientation,
  orientationSteps: number,
): GuideOrientation => {
  if (orientationSteps % 2 === 0) return orientation;
  return orientation === 'vertical' ? 'horizontal' : 'vertical';
};

/** The on-screen orientation of a line drawn between two screen points, or null when it is too diagonal. */
export const classifyDrawnGuide = (start: Coord, end: Coord): GuideOrientation | null => {
  const dx = Math.abs(end.x - start.x);
  const dy = Math.abs(end.y - start.y);
  const tolerance = Math.tan((MAX_GUIDE_DEVIATION_DEGREES * Math.PI) / 180);
  if (dx <= dy * tolerance) return 'vertical';
  if (dy <= dx * tolerance) return 'horizontal';
  return null;
};

export const canAddGuide = (lines: GuideLine[], type: GuideOrientation) =>
  lines.filter((line) => line.type === type).length < MAX_GUIDES_PER_ORIENTATION;

/**
 * Replaces the guides. The first guide replaces an Auto, Level, or Vertical
 * result, whose slider values would otherwise stack on the correction;
 * manual slider values stay for fine-tuning.
 */
export const withGuideLines = (adjustments: Adjustments, lines: GuideLine[]): Adjustments => {
  const replacesAutomatic =
    lines.length > 0 &&
    (adjustments.transformAutoMode === 'auto' ||
      adjustments.transformAutoMode === 'level' ||
      adjustments.transformAutoMode === 'vertical');
  const transformAutoMode =
    lines.length > 0 ? 'guided' : adjustments.transformAutoMode === 'guided' ? null : adjustments.transformAutoMode;
  return {
    ...adjustments,
    ...(replacesAutomatic && {
      transformAutoStrength: INITIAL_ADJUSTMENTS.transformAutoStrength,
      transformHorizontal: INITIAL_ADJUSTMENTS.transformHorizontal,
      transformRotate: INITIAL_ADJUSTMENTS.transformRotate,
      transformVertical: INITIAL_ADJUSTMENTS.transformVertical,
    }),
    transformAutoMode,
    guidedPerspective: { ...adjustments.guidedPerspective, enabled: lines.length >= 2, lines },
  };
};
