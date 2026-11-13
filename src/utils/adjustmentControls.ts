import type { AdjustmentLayout, AppSettings } from '../components/ui/AppProperties';
import {
  ADJUSTMENT_SECTIONS,
  ADJUSTMENT_TOOLS_BY_ID,
  BasicAdjustment,
  ColorAdjustment,
  CreativeAdjustment,
  DEFAULT_GLOW_HUE,
  DEFAULT_HALATION_HUE,
  DetailsAdjustment,
  Effect,
  SPEED_EDIT_ADJUSTMENTS,
  withAdjustmentLayout,
} from './adjustments';

/** A slider that sets one adjustment value, and so can also be a Favorite on its own. */
export interface AdjustmentControl {
  /** The adjustment key it sets. */
  id: string;
  label: string;
  /** The tool block it belongs to, or the section when that section has no blocks (Basic). */
  parent: string;
  min: number;
  max: number;
  step: number;
  /** The reset value, also shown while the adjustment is unset. */
  defaultValue?: number;
  /** A different minimum in masks (local noise reduction can add noise back). */
  maskMin?: number;
  fillOrigin?: 'min' | 'default';
  trackClassName?: string;
  /** The label alone does not say what it changes ("Amount"), so Favorites prefixes the tool. */
  qualify?: boolean;
}

const signed = { min: -100, max: 100, step: 1 };
const positive = { min: 0, max: 100, step: 1, fillOrigin: 'min' as const };

export const ADJUSTMENT_CONTROLS: Array<AdjustmentControl> = [
  { id: BasicAdjustment.Exposure, label: 'adjustments.basic.exposure', parent: 'basic', min: -5, max: 5, step: 0.01 },
  { id: BasicAdjustment.Contrast, label: 'adjustments.basic.contrast', parent: 'basic', ...signed },
  { id: BasicAdjustment.Highlights, label: 'adjustments.basic.highlights', parent: 'basic', ...signed },
  { id: BasicAdjustment.Shadows, label: 'adjustments.basic.shadows', parent: 'basic', ...signed },
  { id: BasicAdjustment.Whites, label: 'adjustments.basic.whites', parent: 'basic', ...signed },
  { id: BasicAdjustment.Blacks, label: 'adjustments.basic.blacks', parent: 'basic', ...signed },
  {
    id: BasicAdjustment.Brightness,
    label: 'adjustments.basic.brightness',
    parent: 'basic',
    min: -5,
    max: 5,
    step: 0.01,
  },
  {
    id: ColorAdjustment.Temperature,
    label: 'adjustments.color.temperature',
    parent: 'whiteBalance',
    trackClassName: 'temperature-gradient-track',
    ...signed,
  },
  {
    id: ColorAdjustment.Tint,
    label: 'adjustments.color.tint',
    parent: 'whiteBalance',
    trackClassName: 'tint-gradient-track',
    ...signed,
  },
  { id: ColorAdjustment.Vibrance, label: 'adjustments.color.vibrance', parent: 'colorPresence', ...signed },
  { id: ColorAdjustment.Saturation, label: 'adjustments.color.saturation', parent: 'colorPresence', ...signed },
  {
    id: ColorAdjustment.Hue,
    label: 'adjustments.color.hue',
    parent: 'hue',
    min: -180,
    max: 180,
    step: 1,
    trackClassName: 'hue-range-track',
  },
  { id: DetailsAdjustment.Sharpness, label: 'adjustments.details.sharpness', parent: 'sharpening', ...signed },
  {
    id: DetailsAdjustment.SharpnessThreshold,
    label: 'adjustments.details.threshold',
    parent: 'sharpening',
    ...positive,
    max: 80,
    defaultValue: 15,
    qualify: true,
  },
  { id: DetailsAdjustment.Clarity, label: 'adjustments.details.clarity', parent: 'presence', ...signed },
  { id: DetailsAdjustment.Dehaze, label: 'adjustments.details.dehaze', parent: 'presence', ...signed },
  { id: DetailsAdjustment.Structure, label: 'adjustments.details.structure', parent: 'presence', ...signed },
  { id: DetailsAdjustment.Centré, label: 'adjustments.details.centre', parent: 'presence', ...signed },
  {
    id: DetailsAdjustment.LumaNoiseReduction,
    label: 'adjustments.details.luminance',
    parent: 'noiseReduction',
    min: 0,
    max: 100,
    step: 1,
    maskMin: -100,
    qualify: true,
  },
  {
    id: DetailsAdjustment.ColorNoiseReduction,
    label: 'adjustments.details.color',
    parent: 'noiseReduction',
    min: 0,
    max: 100,
    step: 1,
    maskMin: -100,
    qualify: true,
  },
  {
    id: DetailsAdjustment.ChromaticAberrationRedCyan,
    label: 'adjustments.details.redCyan',
    parent: 'chromaticAberration',
    qualify: true,
    ...signed,
  },
  {
    id: DetailsAdjustment.ChromaticAberrationBlueYellow,
    label: 'adjustments.details.blueYellow',
    parent: 'chromaticAberration',
    qualify: true,
    ...signed,
  },
  {
    id: CreativeAdjustment.GlowAmount,
    label: 'adjustments.effects.amount',
    parent: 'glow',
    min: 0,
    max: 100,
    step: 1,
    qualify: true,
  },
  {
    id: CreativeAdjustment.GlowHue,
    label: 'adjustments.color.hue',
    parent: 'glow',
    min: 0,
    max: 360,
    step: 1,
    defaultValue: DEFAULT_GLOW_HUE,
    trackClassName: 'hue-range-track',
    qualify: true,
  },
  {
    id: CreativeAdjustment.GlowSaturation,
    label: 'adjustments.color.saturation',
    parent: 'glow',
    ...positive,
    qualify: true,
  },
  {
    id: CreativeAdjustment.HalationAmount,
    label: 'adjustments.effects.amount',
    parent: 'halation',
    min: 0,
    max: 100,
    step: 1,
    qualify: true,
  },
  {
    id: CreativeAdjustment.HalationHue,
    label: 'adjustments.color.hue',
    parent: 'halation',
    min: 0,
    max: 360,
    step: 1,
    defaultValue: DEFAULT_HALATION_HUE,
    trackClassName: 'hue-range-track',
    qualify: true,
  },
  {
    id: CreativeAdjustment.FlareAmount,
    label: 'adjustments.effects.amount',
    parent: 'lightFlares',
    min: 0,
    max: 100,
    step: 1,
    qualify: true,
  },
  {
    id: Effect.GaussianBlurAmount,
    label: 'adjustments.effects.amount',
    parent: 'gaussianBlur',
    ...positive,
    qualify: true,
  },
  {
    id: Effect.MotionBlurAmount,
    label: 'adjustments.effects.amount',
    parent: 'motionBlur',
    ...positive,
    qualify: true,
  },
  { id: Effect.VignetteAmount, label: 'adjustments.effects.amount', parent: 'vignette', ...signed, qualify: true },
  {
    id: Effect.VignetteMidpoint,
    label: 'adjustments.effects.midpoint',
    parent: 'vignette',
    ...positive,
    defaultValue: 50,
    qualify: true,
  },
  {
    id: Effect.VignetteRoundness,
    label: 'adjustments.effects.roundness',
    parent: 'vignette',
    ...signed,
    qualify: true,
  },
  {
    id: Effect.VignetteFeather,
    label: 'adjustments.effects.feather',
    parent: 'vignette',
    ...positive,
    defaultValue: 50,
    qualify: true,
  },
  {
    id: Effect.GrainAmount,
    label: 'adjustments.effects.amount',
    parent: 'grain',
    min: 0,
    max: 100,
    step: 1,
    qualify: true,
  },
  {
    id: Effect.GrainSize,
    label: 'adjustments.effects.size',
    parent: 'grain',
    ...positive,
    defaultValue: 25,
    qualify: true,
  },
  {
    id: Effect.GrainRoughness,
    label: 'adjustments.effects.roughness',
    parent: 'grain',
    ...positive,
    defaultValue: 50,
    qualify: true,
  },
];

export const ADJUSTMENT_CONTROLS_BY_ID: Record<string, AdjustmentControl> = Object.fromEntries(
  ADJUSTMENT_CONTROLS.map((control) => [control.id, control]),
);

const SPEED_EDIT_IDS = new Set<string>(SPEED_EDIT_ADJUSTMENTS.map((adjustment) => adjustment.id));

/** Speed Edit can drive the slider when it is one of the sliders Settings offers. */
export const getControlSpeedEditId = (id: string) => (SPEED_EDIT_IDS.has(id) ? id : undefined);

/** The section a control is shown in. */
export const getControlSection = (control: AdjustmentControl) =>
  ADJUSTMENT_TOOLS_BY_ID[control.parent]?.section ?? control.parent;

export type FavoriteKind = 'section' | 'tool' | 'control';

export interface Favorite {
  /** The stored id, `<kind>:<id>`. */
  key: string;
  kind: FavoriteKind;
  id: string;
  /** The section it lives in. */
  section: string;
}

export const favoriteKey = (kind: FavoriteKind, id: string) => `${kind}:${id}`;

export const parseFavorite = (key: string): Favorite | null => {
  const separator = key.indexOf(':');
  const kind = key.slice(0, separator);
  const id = key.slice(separator + 1);
  const section =
    kind === 'section'
      ? id in ADJUSTMENT_SECTIONS
        ? id
        : undefined
      : kind === 'tool'
        ? ADJUSTMENT_TOOLS_BY_ID[id]?.section
        : kind === 'control' && ADJUSTMENT_CONTROLS_BY_ID[id]
          ? getControlSection(ADJUSTMENT_CONTROLS_BY_ID[id])
          : undefined;
  return section ? { key, kind: kind as FavoriteKind, id, section } : null;
};

/** The saved Favorites in their order; unknown and repeated ids are dropped. */
export const getFavorites = (layout?: AdjustmentLayout): Array<Favorite> =>
  (layout?.favorites ?? [])
    .filter((key, index, keys) => keys.indexOf(key) === index)
    .map(parseFavorite)
    .filter((favorite): favorite is Favorite => favorite !== null);

/** Adds a Favorite at the end of the Favorites panel, or removes it. */
export const withFavoriteToggled = (settings: AppSettings, key: string): AppSettings => {
  const favorites = settings.adjustmentLayout?.favorites ?? [];
  return withAdjustmentLayout(settings, {
    favorites: favorites.includes(key) ? favorites.filter((favorite) => favorite !== key) : [...favorites, key],
  });
};
