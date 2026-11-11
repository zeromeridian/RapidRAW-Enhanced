/**
 * Targeted adjustments: click a spot in the photo and drag to change the colour mixer bands
 * or the tone curve at that spot, as Lightroom Classic's targeted adjustment tool does.
 * This file holds the edit logic; `useTargetedAdjustment` runs the pointer and sampling.
 */
import {
  ActiveChannel,
  Adjustments,
  Coord,
  DEFAULT_PARAMETRIC_CURVE,
  INITIAL_ADJUSTMENTS,
  INITIAL_MASK_ADJUSTMENTS,
  MaskAdjustments,
} from './adjustments';
import { HslMixerBand, HslMixerProperty, sampleHslPresence } from './hslMixer';
import {
  MAX_CURVE_POINTS,
  ParametricRegion,
  buildParametricPoints,
  evaluateToneCurve,
  getParametricRegion,
} from './toneCurve';

export type TargetedAdjustment =
  | { tool: 'colorMixer'; property: HslMixerProperty }
  | { tool: 'toneCurve'; channel: ActiveChannel }
  | { tool: 'pointColor' };

/** The render stage a target samples (`gpu_processing::SampleProbe`). */
export type SampleProbe = 'hsl' | 'curve' | 'maskCurve' | 'pointColor';

/** A drag prepared at press time: `apply` maps the drag offset onto the adjustments at that time. */
export interface TargetedDrag {
  range: [number, number];
  apply(adjustments: Adjustments, offset: number): Adjustments;
}

/** Curve points closer than this (in 0–255 units) to the sampled tone are reused. */
const CURVE_POINT_PICK_DISTANCE = 8;
const SLIDER_LIMIT = 100;

type TargetAdjustments = Adjustments | MaskAdjustments;

const getTargetAdjustments = (adjustments: Adjustments, maskId: string | null): TargetAdjustments =>
  maskId
    ? { ...INITIAL_MASK_ADJUSTMENTS, ...adjustments.masks.find((mask) => mask.id === maskId)?.adjustments }
    : adjustments;

const withTargetAdjustments = (
  adjustments: Adjustments,
  maskId: string | null,
  change: Partial<TargetAdjustments>,
): Adjustments =>
  maskId
    ? {
        ...adjustments,
        masks: adjustments.masks.map((mask) =>
          mask.id === maskId ? { ...mask, adjustments: { ...mask.adjustments, ...change } } : mask,
        ),
      }
    : { ...adjustments, ...change };

export const getSampleProbe = (target: TargetedAdjustment, maskId: string | null): SampleProbe => {
  if (target.tool === 'colorMixer') return 'hsl';
  if (target.tool === 'pointColor') return 'pointColor';
  return maskId ? 'maskCurve' : 'curve';
};

const clampToSlider = (value: number) => Math.max(-SLIDER_LIMIT, Math.min(SLIDER_LIMIT, Math.round(value)));

const withHslValues = (
  adjustments: Adjustments,
  maskId: string | null,
  property: HslMixerProperty,
  values: Array<[HslMixerBand, number]>,
): Adjustments => {
  const hsl = { ...INITIAL_ADJUSTMENTS.hsl, ...getTargetAdjustments(adjustments, maskId).hsl };
  values.forEach(([band, value]) => {
    hsl[band] = { ...hsl[band], [property]: value };
  });
  return withTargetAdjustments(adjustments, maskId, { hsl });
};

/** The mean of one channel (0–255) of an RGBA8 `curve` probe. */
const sampledTone = (pixels: Uint8Array, channel: ActiveChannel) => {
  const offset = { [ActiveChannel.Red]: 0, [ActiveChannel.Green]: 1, [ActiveChannel.Blue]: 2, [ActiveChannel.Luma]: 3 }[
    channel
  ];
  let total = 0;
  for (let i = offset; i < pixels.length; i += 4) total += pixels[i];
  return pixels.length ? total / (pixels.length / 4) : null;
};

const nearestPointIndex = (points: Array<Coord>, x: number) => {
  let nearest = -1;
  points.forEach((point, index) => {
    if (
      Math.abs(point.x - x) <= CURVE_POINT_PICK_DISTANCE &&
      (nearest < 0 || Math.abs(point.x - x) < Math.abs(points[nearest].x - x))
    ) {
      nearest = index;
    }
  });
  return nearest;
};

const withChannelCurve = (
  adjustments: Adjustments,
  maskId: string | null,
  channel: ActiveChannel,
  points: Array<Coord>,
): Adjustments => {
  const target = getTargetAdjustments(adjustments, maskId);
  return withTargetAdjustments(adjustments, maskId, { curves: { ...target.curves, [channel]: points } });
};

const withParametricValue = (
  adjustments: Adjustments,
  maskId: string | null,
  channel: ActiveChannel,
  region: ParametricRegion,
  value: number,
): Adjustments => {
  const target = getTargetAdjustments(adjustments, maskId);
  const parametricCurve = target.parametricCurve || DEFAULT_PARAMETRIC_CURVE;
  const settings = { ...parametricCurve[channel], [region]: value };
  return withTargetAdjustments(adjustments, maskId, {
    parametricCurve: { ...parametricCurve, [channel]: settings },
    curves: { ...target.curves, [channel]: buildParametricPoints(settings) },
  });
};

/**
 * Prepares a drag from the sampled pixels; null when nothing under the cursor can be moved
 * (a grey area for the mixer, a full point curve without a point near the tone).
 */
export const beginTargetedDrag = (
  target: TargetedAdjustment,
  maskId: string | null,
  pixels: Uint8Array,
  adjustments: Adjustments,
): TargetedDrag | null => {
  const current = getTargetAdjustments(adjustments, maskId);

  if (target.tool === 'colorMixer') {
    const { property } = target;
    const presence = Object.entries(sampleHslPresence(pixels, property)) as Array<[HslMixerBand, number]>;
    if (!presence.length) return null;
    const hsl = { ...INITIAL_ADJUSTMENTS.hsl, ...current.hsl };
    // The strongest band reaches the slider ends exactly; weaker bands follow in proportion.
    const [dominant] = presence.find(([, weight]) => weight === 1) ?? presence[0];
    const dominantValue = hsl[dominant][property];
    return {
      range: [-SLIDER_LIMIT - dominantValue, SLIDER_LIMIT - dominantValue],
      apply: (next, offset) =>
        withHslValues(
          next,
          maskId,
          property,
          presence.map(([band, weight]) => [band, clampToSlider(hsl[band][property] + offset * weight)]),
        ),
    };
  }

  // Point Color picks a colour on click (`useTargetedAdjustment`); it has no drag or reset.
  if (target.tool === 'pointColor') return null;
  const { channel } = target;
  const tone = sampledTone(pixels, channel);
  if (tone === null) return null;

  if (current.curveMode === 'parametric') {
    const settings = (current.parametricCurve || DEFAULT_PARAMETRIC_CURVE)[channel];
    const region = getParametricRegion(settings, tone);
    const base = settings[region];
    return {
      range: [-SLIDER_LIMIT - base, SLIDER_LIMIT - base],
      apply: (next, offset) => withParametricValue(next, maskId, channel, region, clampToSlider(base + offset)),
    };
  }

  const basePoints = current.curves[channel];
  let index = nearestPointIndex(basePoints, tone);
  let points = basePoints;
  if (index < 0) {
    if (basePoints.length >= MAX_CURVE_POINTS) return null;
    points = [...basePoints, { x: tone, y: evaluateToneCurve(basePoints, tone) }].sort((a, b) => a.x - b.x);
    index = points.findIndex((point) => point.x === tone);
  }
  const { x, y } = points[index];
  return {
    range: [-y, 255 - y],
    apply: (next, offset) =>
      withChannelCurve(
        next,
        maskId,
        channel,
        points.map((point, i) => (i === index ? { x, y: Math.max(0, Math.min(255, y + offset)) } : point)),
      ),
  };
};

/**
 * Double-click: puts the mixer bands under the cursor back to 0, or removes the curve point
 * near the sampled tone (parametric curves: resets that region). Null when nothing changes.
 */
export const resetTargetedAdjustment = (
  target: TargetedAdjustment,
  maskId: string | null,
  pixels: Uint8Array,
  adjustments: Adjustments,
): Adjustments | null => {
  if (target.tool === 'colorMixer') {
    const bands = Object.keys(sampleHslPresence(pixels, target.property)) as Array<HslMixerBand>;
    return bands.length
      ? withHslValues(
          adjustments,
          maskId,
          target.property,
          bands.map((band) => [band, 0]),
        )
      : null;
  }

  // Point Color picks a colour on click (`useTargetedAdjustment`); it has no drag or reset.
  if (target.tool === 'pointColor') return null;
  const { channel } = target;
  const tone = sampledTone(pixels, channel);
  if (tone === null) return null;
  const current = getTargetAdjustments(adjustments, maskId);

  if (current.curveMode === 'parametric') {
    const settings = (current.parametricCurve || DEFAULT_PARAMETRIC_CURVE)[channel];
    return withParametricValue(adjustments, maskId, channel, getParametricRegion(settings, tone), 0);
  }

  const points = current.curves[channel];
  const index = nearestPointIndex(points, tone);
  if (index <= 0 || index >= points.length - 1) return null;
  return withChannelCurve(
    adjustments,
    maskId,
    channel,
    points.filter((_, i) => i !== index),
  );
};
