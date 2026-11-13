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
      const offset = roundHalfAway(limit(parameter, sums[parameter.id]) / parameter.step) * parameter.step;
      return [parameter.id, offset === 0 ? 0 : offset];
    }),
  );
};

/** The three fixed anchor slots of the pad panel: top, bottom right, bottom left. */
export const BLEND_PAD_SLOTS = [
  { id: 'top', t: 0.25, param: 'contrast', target: 60 },
  { id: 'bottomRight', t: 11 / 12, param: 'temperature', target: 50 },
  { id: 'bottomLeft', t: 7 / 12, param: 'saturation', target: -60 },
] as const;

/** A new pad: the three slots with their default tools, the puck at the centre. */
export const createBlendPad = (): BlendPad => ({
  version: 1,
  enabled: true,
  shape: 'circle',
  amount: 1,
  puck: { x: 0, y: 0 },
  anchors: BLEND_PAD_SLOTS.map(({ id, t, param, target }) => ({
    id,
    param,
    t,
    target,
    curve: 'linear',
    muted: false,
  })),
});
