/**
 * The Orbit Blend Pad's maths for the pad panel's live values, mirroring `blend_pad.rs`, which
 * stays the source of truth for every render. Both are checked against `blendPad.vectors.json`
 * (`node scripts/check-blend-pad.mjs` and `cargo test`). Type imports only, so Node can run it.
 */
import type { BlendPad, BlendPadAnchor, BlendPadCurve, Coord } from './adjustments';

/** A slider the pad can drive, as `blend_pad::Parameter` (read with `get_blend_pad_parameters`). */
export interface BlendPadParameter {
  id: string;
  min: number;
  max: number;
  step: number;
  /** A hue: values wrap around the range instead of clamping. */
  wraps: boolean;
}

/** Anchors per pad; mirrors `blend_pad::MAX_ANCHORS`. */
export const MAX_BLEND_PAD_ANCHORS = 8;

const TAU = Math.PI * 2;
const EPSILON = 1e-9;

const CURVES: Record<BlendPadCurve, (x: number) => number> = {
  linear: (x) => x,
  soft: (x) => x * x * (3 - 2 * x),
  easeIn: (x) => x * x,
};

/** The circle's edge point at perimeter position `t` (0–1, from the right, anticlockwise). */
export const anchorPoint = (t: number): Coord => ({ x: Math.cos(TAU * t), y: Math.sin(TAU * t) });

/** `Point::scale`: multiplies by the factor, as Rust does, so both round alike. */
const scale = (point: Coord, factor: number): Coord => ({ x: point.x * factor, y: point.y * factor });

/** The nearest point inside the circle. */
export const clampToPad = (point: Coord): Coord => {
  const radius = Math.hypot(point.x, point.y);
  return radius > 1 ? scale(point, 1 / radius) : point;
};

/** +1 at the anchor, 0 at the centre, −1 at the opposite edge point (`Shape::axis_weight`). */
export const axisWeight = (t: number, puck: Coord): number => {
  const anchor = anchorPoint(t);
  const reach = Math.hypot(anchor.x, anchor.y);
  if (reach < EPSILON) return 0;
  const direction = scale(anchor, 1 / reach);
  const along = puck.x * direction.x + puck.y * direction.y;
  // The circle's opposite edge point is 1 from the centre.
  const weight = along >= 0 ? along / reach : along;
  return Math.min(1, Math.max(-1, weight));
};

/** What one anchor adds at the puck before stacking, limiting and rounding. */
export const anchorValue = (anchor: BlendPadAnchor, puck: Coord, amount: number): number => {
  if (anchor.muted) return 0;
  const weight = axisWeight(anchor.t, clampToPad(puck));
  const value = anchor.target * CURVES[anchor.curve](Math.abs(weight)) * Math.sign(weight) * amount;
  return value === 0 ? 0 : value;
};

/** Brings a value into the slider's range, wrapping a hue (`f64::rem_euclid`). */
const limit = (parameter: BlendPadParameter, value: number) => {
  if (!parameter.wraps) return Math.min(parameter.max, Math.max(parameter.min, value));
  const span = parameter.max - parameter.min;
  const rest = (value - parameter.min) % span;
  return (rest < 0 ? rest + span : rest) + parameter.min;
};

/**
 * Bounds the anchors' summed offset to the slider's whole span either way, so it can still
 * lower a one-sided slider (`Parameter::limit_offset`); a hue wraps.
 */
const limitOffset = (parameter: BlendPadParameter, offset: number) => {
  if (parameter.wraps) return limit(parameter, offset);
  const span = parameter.max - parameter.min;
  return Math.min(span, Math.max(-span, offset));
};

/** Rounds half away from zero, as Rust's `f64::round` (`Math.round(-0.5)` is −0). */
const roundHalfAway = (value: number) => Math.sign(value) * Math.round(Math.abs(value));

/** The pad's offset for every parameter, 0 for those it does not move (`Offsets::from_pad`). */
export const resolveBlendPad = (
  pad: BlendPad | null | undefined,
  parameters: Array<BlendPadParameter>,
): Record<string, number> => {
  const sums: Record<string, number> = Object.fromEntries(parameters.map((parameter) => [parameter.id, 0]));
  if (pad?.enabled && pad.version === 1) {
    const amount = Math.min(1, Math.max(0, pad.amount));
    for (const anchor of pad.anchors.slice(0, MAX_BLEND_PAD_ANCHORS)) {
      if (anchor.param in sums) sums[anchor.param] += anchorValue(anchor, pad.puck, amount);
    }
  }
  return Object.fromEntries(
    parameters.map((parameter) => {
      const offset = roundHalfAway(limitOffset(parameter, sums[parameter.id]) / parameter.step) * parameter.step;
      return [parameter.id, offset === 0 ? 0 : offset];
    }),
  );
};

/** The slider's value with the pad's offset added, as the renderer uses it (`Offsets::apply`). */
export const withBlendPadOffset = (parameter: BlendPadParameter, value: number, offset: number) =>
  offset === 0 ? value : limit(parameter, value + offset);

/** The value the pad moves the slider `id` to, or `undefined` when the pad does not move it. */
export const blendPadValue = (
  pad: BlendPad | null | undefined,
  parameters: Array<BlendPadParameter>,
  id: string,
  value: number,
): number | undefined => {
  const parameter = parameters.find((candidate) => candidate.id === id);
  if (!parameter || !pad?.enabled) return undefined;
  const offset = resolveBlendPad(pad, [parameter])[id];
  return offset === 0 ? undefined : withBlendPadOffset(parameter, value, offset);
};

/** Bake: the slider values with the pad's offsets written into them (only those it moves). */
export const bakeBlendPad = (
  values: Record<string, unknown>,
  pad: BlendPad | null | undefined,
  parameters: Array<BlendPadParameter>,
): Record<string, number> => {
  const offsets = resolveBlendPad(pad, parameters);
  return Object.fromEntries(
    parameters
      .filter((parameter) => offsets[parameter.id] !== 0)
      .map((parameter) => {
        const value = typeof values[parameter.id] === 'number' ? (values[parameter.id] as number) : 0;
        return [parameter.id, withBlendPadOffset(parameter, value, offsets[parameter.id])];
      }),
  );
};

/** The tools a new pad starts with: Contrast at the top, Temperature and Saturation below. */
const DEFAULT_ANCHORS = [
  { id: 'top', t: 0.25, param: 'contrast', target: 60 },
  { id: 'bottomRight', t: 11 / 12, param: 'temperature', target: 50 },
  { id: 'bottomLeft', t: 7 / 12, param: 'saturation', target: -60 },
] as const;

/** A new pad: the default tools, the puck at the centre. */
export const createBlendPad = (): BlendPad => ({
  version: 1,
  enabled: true,
  shape: 'circle',
  amount: 1,
  puck: { x: 0, y: 0 },
  anchors: DEFAULT_ANCHORS.map(({ id, t, param, target }) => ({
    id,
    param,
    t,
    target,
    curve: 'linear',
    muted: false,
  })),
});

/** Where a new anchor goes: the middle of the largest free stretch of edge (the top on an empty pad). */
export const largestGapPosition = (anchors: Array<BlendPadAnchor>): number => {
  const positions = anchors.map((anchor) => ((anchor.t % 1) + 1) % 1).sort((a, b) => a - b);
  if (positions.length === 0) return 0.25;
  let best = { start: positions[positions.length - 1], length: positions[0] + 1 - positions[positions.length - 1] };
  for (let i = 1; i < positions.length; i += 1) {
    const length = positions[i] - positions[i - 1];
    if (length > best.length) best = { start: positions[i - 1], length };
  }
  return (best.start + best.length / 2) % 1;
};

/** The perimeter position of a point in pad space (0–1, from the right, anticlockwise). */
export const positionOf = (point: Coord): number => {
  const turns = Math.atan2(point.y, point.x) / TAU;
  return turns < 0 ? turns + 1 : turns;
};

/** A target of the same share of the slider's reach (Contrast +60 becomes Exposure +3.00). */
export const targetWithShare = (share: number, parameter: BlendPadParameter): number => {
  const reach = Math.max(Math.abs(parameter.min), Math.abs(parameter.max));
  const target = Math.round((share * reach) / parameter.step) * parameter.step;
  return Math.min(parameter.max, Math.max(-parameter.max, target));
};

/** The share of the slider's reach a target is. */
export const shareOf = (target: number, parameter: BlendPadParameter): number =>
  target / Math.max(Math.abs(parameter.min), Math.abs(parameter.max));
