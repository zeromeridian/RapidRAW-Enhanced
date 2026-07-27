import {
  Adjustments,
  Coord,
  Curves,
  DEFAULT_PARAMETRIC_CURVE,
  ParametricCurve,
  ParametricCurveSettings,
  getDefaultCurves,
} from './adjustments';

export interface ToneCurvePreset {
  builtIn?: boolean;
  curveMode: 'point' | 'parametric';
  id: string;
  name: string;
  parametricCurve: ParametricCurve;
  pointCurves: Curves;
}

export type ToneCurvePresetData = Pick<ToneCurvePreset, 'curveMode' | 'parametricCurve' | 'pointCurves'>;

const CHANNELS = ['luma', 'red', 'green', 'blue'] as const;
const PARAMETRIC_KEYS = [
  'darks',
  'shadows',
  'highlights',
  'lights',
  'whiteLevel',
  'blackLevel',
  'split1',
  'split2',
  'split3',
] as const;

const clonePoints = (points: unknown, fallback: Coord[]): Coord[] => {
  if (!Array.isArray(points) || points.length < 2) return fallback.map((point) => ({ ...point }));

  const validPoints = points
    .filter(
      (point): point is Coord =>
        !!point &&
        typeof point === 'object' &&
        Number.isFinite((point as Coord).x) &&
        Number.isFinite((point as Coord).y),
    )
    .map((point) => ({
      x: Math.max(0, Math.min(255, point.x)),
      y: Math.max(0, Math.min(255, point.y)),
    }))
    .sort((a, b) => a.x - b.x);

  return validPoints.length >= 2 ? validPoints : fallback.map((point) => ({ ...point }));
};

export const cloneToneCurvePoints = (curves: unknown): Curves => {
  const defaults = getDefaultCurves();
  const source = curves && typeof curves === 'object' ? (curves as Partial<Curves>) : {};

  return {
    luma: clonePoints(source.luma, defaults.luma),
    red: clonePoints(source.red, defaults.red),
    green: clonePoints(source.green, defaults.green),
    blue: clonePoints(source.blue, defaults.blue),
  };
};

const cloneParametricSettings = (settings: unknown, fallback: ParametricCurveSettings): ParametricCurveSettings => {
  const source = settings && typeof settings === 'object' ? (settings as Partial<ParametricCurveSettings>) : {};
  const cloned = { ...fallback };

  for (const key of PARAMETRIC_KEYS) {
    const value = source[key];
    if (Number.isFinite(value)) cloned[key] = value as number;
  }

  return cloned;
};

export const cloneToneCurveParametric = (curve: unknown): ParametricCurve => {
  const source = curve && typeof curve === 'object' ? (curve as Partial<ParametricCurve>) : {};

  return {
    luma: cloneParametricSettings(source.luma, DEFAULT_PARAMETRIC_CURVE.luma),
    red: cloneParametricSettings(source.red, DEFAULT_PARAMETRIC_CURVE.red),
    green: cloneParametricSettings(source.green, DEFAULT_PARAMETRIC_CURVE.green),
    blue: cloneParametricSettings(source.blue, DEFAULT_PARAMETRIC_CURVE.blue),
  };
};

export const normalizeToneCurvePresetName = (name: string) => name.trim().toLowerCase();

export const hasToneCurvePresetNameConflict = (name: string, presets: ToneCurvePreset[]) => {
  const normalizedName = normalizeToneCurvePresetName(name);
  return !!normalizedName && presets.some((preset) => normalizeToneCurvePresetName(preset.name) === normalizedName);
};

export const getToneCurvePresetData = (adjustments: Adjustments): ToneCurvePresetData => ({
  curveMode: adjustments.curveMode === 'parametric' ? 'parametric' : 'point',
  pointCurves: cloneToneCurvePoints(adjustments.curveMode === 'point' ? adjustments.curves : adjustments.pointCurves),
  parametricCurve: cloneToneCurveParametric(adjustments.parametricCurve),
});

export const createToneCurvePreset = (name: string, adjustments: Adjustments): ToneCurvePreset => ({
  id: crypto.randomUUID(),
  name: name.trim(),
  ...getToneCurvePresetData(adjustments),
});

export const updateToneCurvePreset = (preset: ToneCurvePreset, adjustments: Adjustments): ToneCurvePreset => ({
  ...preset,
  ...getToneCurvePresetData(adjustments),
});

export const isToneCurvePresetDirty = (preset: ToneCurvePreset, adjustments: Adjustments) =>
  JSON.stringify({
    curveMode: preset.curveMode,
    pointCurves: cloneToneCurvePoints(preset.pointCurves),
    parametricCurve: cloneToneCurveParametric(preset.parametricCurve),
  }) !== JSON.stringify(getToneCurvePresetData(adjustments));

const createBuiltInPreset = (id: string, name: string, luma: Coord[]): ToneCurvePreset => ({
  builtIn: true,
  id,
  name,
  curveMode: 'point',
  pointCurves: { ...getDefaultCurves(), luma },
  parametricCurve: cloneToneCurveParametric(DEFAULT_PARAMETRIC_CURVE),
});

export const BUILT_IN_TONE_CURVE_PRESETS: ToneCurvePreset[] = [
  createBuiltInPreset('builtin-linear', 'Linear', [
    { x: 0, y: 0 },
    { x: 255, y: 255 },
  ]),
  createBuiltInPreset('builtin-medium-contrast', 'Medium Contrast', [
    { x: 0, y: 0 },
    { x: 64, y: 54 },
    { x: 128, y: 128 },
    { x: 192, y: 204 },
    { x: 255, y: 255 },
  ]),
  createBuiltInPreset('builtin-high-contrast', 'High Contrast', [
    { x: 0, y: 0 },
    { x: 64, y: 40 },
    { x: 128, y: 128 },
    { x: 192, y: 220 },
    { x: 255, y: 255 },
  ]),
];

export const normalizeToneCurvePresets = (presets: unknown): ToneCurvePreset[] => {
  if (!Array.isArray(presets)) return [];

  const names = new Set<string>();
  const ids = new Set<string>();
  const normalized: ToneCurvePreset[] = [];

  for (const candidate of presets) {
    if (!candidate || typeof candidate !== 'object') continue;
    const preset = candidate as Partial<ToneCurvePreset>;
    const id = typeof preset.id === 'string' ? preset.id.trim() : '';
    const name = typeof preset.name === 'string' ? preset.name.trim() : '';
    const normalizedName = normalizeToneCurvePresetName(name);
    if (!id || !normalizedName || ids.has(id) || names.has(normalizedName)) continue;

    ids.add(id);
    names.add(normalizedName);
    normalized.push({
      id,
      name,
      curveMode: preset.curveMode === 'parametric' ? 'parametric' : 'point',
      pointCurves: cloneToneCurvePoints(preset.pointCurves),
      parametricCurve: cloneToneCurveParametric(preset.parametricCurve),
    });
  }

  return normalized;
};

export const buildToneCurvePresetAdjustments = (
  preset: ToneCurvePreset,
  buildParametricPoints: (settings: ParametricCurveSettings) => Coord[],
): Pick<Adjustments, 'curveMode' | 'curves' | 'pointCurves' | 'parametricCurve'> => {
  const pointCurves = cloneToneCurvePoints(preset.pointCurves);
  const parametricCurve = cloneToneCurveParametric(preset.parametricCurve);
  const curves =
    preset.curveMode === 'parametric'
      ? CHANNELS.reduce(
          (result, channel) => ({
            ...result,
            [channel]: buildParametricPoints(parametricCurve[channel]),
          }),
          {} as Curves,
        )
      : cloneToneCurvePoints(pointCurves);

  return {
    curveMode: preset.curveMode,
    curves,
    pointCurves,
    parametricCurve,
  };
};
