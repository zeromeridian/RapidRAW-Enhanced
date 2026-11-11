/**
 * Point Color helpers: reading a picked colour from the `pointColor` probe, showing colours as
 * swatches, and mapping the stored ranges (offsets from the picked value) onto range bars.
 * The selection itself runs in `shader.wgsl` (`point_color_weight`).
 */
import { PointColor, PointColorRange } from './adjustments';

/** A colour as Point Color selects it: perceptual hue (degrees), saturation and luminance (0–100). */
export type PickedColor = Pick<PointColor, 'hue' | 'saturation' | 'luminance'>;

/** Degrees either side of the picked hue that the Hue Range bar spans. */
const HUE_BAR_SPAN = 60;
const HUE_BAR_SCALE = 50 / HUE_BAR_SPAN;

/** The colour mixer's hue scale: a shift of ±100 turns the hue ±60° (`SCALES.hsl_hue_multiplier` × 2). */
const HUE_SHIFT_DEGREES_PER_UNIT = 0.6;

const LUMA = [0.2126, 0.7152, 0.0722];

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * The mean colour of an RGBA8 `pointColor` probe (hue/360, saturation, luma per pixel). Hue is
 * averaged on the colour circle, weighted by saturation, so reds either side of 0° average to red.
 */
export const samplePickedColor = (probe: Uint8Array): PickedColor | null => {
  const count = probe.length / 4;
  if (count === 0) return null;
  let x = 0;
  let y = 0;
  let saturation = 0;
  let luminance = 0;
  for (let i = 0; i < probe.length; i += 4) {
    const angle = (probe[i] / 255) * 2 * Math.PI;
    const s = probe[i + 1] / 255;
    x += Math.cos(angle) * s;
    y += Math.sin(angle) * s;
    saturation += s;
    luminance += probe[i + 2] / 255;
  }
  return {
    hue: Math.round((((Math.atan2(y, x) * 180) / Math.PI) % 360) + 360) % 360,
    saturation: Math.round((saturation / count) * 100),
    luminance: Math.round((luminance / count) * 100),
  };
};

const hsvToRgb = (hue: number, saturation: number): number[] => {
  const h = (((hue % 360) + 360) % 360) / 60;
  const c = saturation;
  const x = c * (1 - Math.abs((h % 2) - 1));
  const m = 1 - c;
  const [r, g, b] =
    h < 1 ? [c, x, 0] : h < 2 ? [x, c, 0] : h < 3 ? [0, c, x] : h < 4 ? [0, x, c] : h < 5 ? [x, 0, c] : [c, 0, x];
  return [r + m, g + m, b + m];
};

/** A CSS colour with the picked hue and saturation at the picked luminance (display-encoded, as the shader selects). */
export const pickedColorCss = ({ hue, saturation, luminance }: PickedColor): string => {
  const rgb = hsvToRgb(hue, clamp(saturation, 0, 100) / 100);
  const luma = rgb.reduce((sum, channel, i) => sum + channel * LUMA[i], 0);
  const scale = clamp(luminance, 0, 100) / 100 / Math.max(luma, 0.0001);
  const [r, g, b] = rgb.map((channel) => Math.round(clamp(channel * scale, 0, 1) * 255));
  return `rgb(${r}, ${g}, ${b})`;
};

/** The picked colour after the point's shifts, for the result swatch; approximates the shader, which shifts in linear light. */
export const shiftedPickedColor = (point: PointColor): PickedColor => ({
  hue: point.hue + point.hueShift * HUE_SHIFT_DEGREES_PER_UNIT,
  saturation: clamp(point.saturation * (1 + point.saturationShift / 100), 0, 100),
  luminance: clamp(point.luminance * (1 + point.luminanceShift / 100), 0, 100),
});

/** The Hue Range bar runs from 60° below to 60° above the picked hue; its centre is the pick. */
export const hueRangeToBar = ({ min, max, minFade, maxFade }: PointColorRange): PointColorRange => ({
  min: 50 + min * HUE_BAR_SCALE,
  max: 50 + max * HUE_BAR_SCALE,
  minFade: minFade * HUE_BAR_SCALE,
  maxFade: maxFade * HUE_BAR_SCALE,
});

export const hueRangeFromBar = ({ min, max, minFade, maxFade }: PointColorRange): PointColorRange => ({
  min: Math.round((min - 50) / HUE_BAR_SCALE),
  max: Math.round((max - 50) / HUE_BAR_SCALE),
  minFade: Math.round(minFade / HUE_BAR_SCALE),
  maxFade: Math.round(maxFade / HUE_BAR_SCALE),
});

/** Saturation and Luminance Range bars are absolute (0–100), so the stored offsets move with the pick. */
export const rangeToBar = ({ min, max, minFade, maxFade }: PointColorRange, picked: number): PointColorRange => ({
  min: clamp(picked + min, 0, 100),
  max: clamp(picked + max, 0, 100),
  minFade,
  maxFade,
});

export const rangeFromBar = ({ min, max, minFade, maxFade }: PointColorRange, picked: number): PointColorRange => ({
  min: min - picked,
  max: max - picked,
  minFade,
  maxFade,
});

/** The Hue Range bar's track: the hues it spans around the pick. */
export const hueRangeGradient = (point: PickedColor): string => {
  const stops = Array.from({ length: 7 }, (_, i) => {
    const hue = point.hue - HUE_BAR_SPAN + (i * HUE_BAR_SPAN) / 3;
    return pickedColorCss({ hue, saturation: 100, luminance: 60 });
  });
  return `linear-gradient(to right, ${stops.join(', ')})`;
};

export const saturationRangeGradient = (point: PickedColor): string =>
  `linear-gradient(to right, ${pickedColorCss({ ...point, saturation: 0 })}, ${pickedColorCss({ ...point, saturation: 100 })})`;

export const luminanceRangeGradient = (point: PickedColor, direction = 'to right'): string =>
  `linear-gradient(${direction}, ${pickedColorCss({ ...point, luminance: 0 })}, ${pickedColorCss({ ...point, luminance: 50 })}, ${pickedColorCss({ ...point, luminance: 100 })})`;
