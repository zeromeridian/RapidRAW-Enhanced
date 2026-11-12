import type { Adjustments, AiPatch, MaskContainer } from './adjustments';

type Values = Record<string, unknown>;

const KEY_NAMES: Record<string, string> = {
  aiPatches: 'AI Patches',
  aspectRatio: 'Aspect Ratio',
  flipHorizontal: 'Flip Horizontal',
  flipVertical: 'Flip Vertical',
  orientationSteps: 'Rotation',
  lutPath: 'LUT',
  lutIntensity: 'LUT Intensity',
  lutData: 'LUT Data',
  lutName: 'LUT Name',
  lutSize: 'LUT Size',
  chromaticAberrationBlueYellow: 'Chromatic Aberration Blue/Yellow',
  chromaticAberrationRedCyan: 'Chromatic Aberration Red/Cyan',
  centré: 'Centré',
  lumaNoiseReduction: 'Luma Noise Reduction',
  colorNoiseReduction: 'Color Noise Reduction',
  aiDenoiseEnabled: 'AI Denoise',
  aiDenoiseAmount: 'AI Denoise Amount',
  aiDenoiseDetail: 'AI Denoise Detail',
  lensCorrectionMode: 'Lens Correction',
  lensMaker: 'Lens Maker',
  lensModel: 'Lens Model',
  lensDistortionParams: 'Lens Profile',
  lensDistortionAmount: 'Lens Distortion',
  lensVignetteAmount: 'Lens Vignette',
  lensTcaAmount: 'Lens TCA',
  lensDistortionEnabled: 'Enable Lens Distortion',
  lensTcaEnabled: 'Enable Lens TCA',
  lensVignetteEnabled: 'Enable Lens Vignette',
  guidedPerspective: 'Guided Perspective',
  transformAutoMode: 'Auto Geometry',
  transformAutoStrength: 'Auto Strength',
  transformConstrainCrop: 'Constrain Crop',
  transformDistortion: 'Transform Distortion',
  transformVertical: 'Transform Vertical',
  transformHorizontal: 'Transform Horizontal',
  transformRotate: 'Transform Rotate',
  transformAspect: 'Transform Aspect',
  transformScale: 'Transform Scale',
  transformXOffset: 'Transform X Offset',
  transformYOffset: 'Transform Y Offset',
  colorGrading: 'Color Grading',
  colorCalibration: 'Color Calibration',
  pointColors: 'Point Color',
  toneMapper: 'Tone Mapper',
  showClipping: 'Show Clipping',
  sectionVisibility: 'Section Visibility',
  flareAmount: 'Flare Amount',
  glowAmount: 'Glow Amount',
  glowHue: 'Glow Hue',
  glowSaturation: 'Glow Saturation',
  halationAmount: 'Halation Amount',
  halationHue: 'Halation Hue',
  motionBlurAmount: 'Motion Blur Amount',
  motionBlurAngle: 'Motion Blur Angle',
  motionBlurType: 'Motion Blur Type',
  motionBlurLayer: 'Motion Blur Motion',
  motionBlurHighlights: 'Motion Blur Highlights',
  motionBlurDepthEnabled: 'Motion Blur Depth',
  motionBlurDepth: 'Motion Blur Depth Amount',
  fogEnabled: 'Fog',
  lensBlurEnabled: 'Lens Blur',
  relightEnabled: 'Relight',
  relightLights: 'Relight Lights',
  grainAmount: 'Grain Amount',
  grainRoughness: 'Grain Roughness',
  grainSize: 'Grain Size',
  vignetteAmount: 'Vignette Amount',
  vignetteFeather: 'Vignette Feather',
  vignetteMidpoint: 'Vignette Midpoint',
  vignetteRoundness: 'Vignette Roundness',
  dehaze: 'Dehaze',
  exposure: 'Exposure',
  blacks: 'Blacks',
  whites: 'Whites',
  shadows: 'Shadows',
  highlights: 'Highlights',
  contrast: 'Contrast',
  brightness: 'Brightness',
  clarity: 'Clarity',
  structure: 'Structure',
  sharpness: 'Sharpness',
  sharpnessThreshold: 'Sharpness Threshold',
  saturation: 'Saturation',
  temperature: 'Temperature',
  tint: 'Tint',
  vibrance: 'Vibrance',
  hsl: 'HSL',
  monochrome: 'Black & White',
  curves: 'Curves',
  crop: 'Crop',
  masks: 'Masks',
  rating: 'Rating',
};

/** At most this many changes are named in one label; the rest are counted. */
const MAX_CHANGES = 6;
const CROP_RATIOS = [
  [1, 1],
  [4, 3],
  [3, 4],
  [3, 2],
  [2, 3],
  [5, 4],
  [4, 5],
  [16, 9],
  [9, 16],
  [2, 1],
];

const formatKey = (key: string) =>
  KEY_NAMES[key] ?? key.replace(/([A-Z])/g, ' $1').replace(/^./, (str) => str.toUpperCase());

const formatValue = (value: unknown) => {
  if (typeof value === 'number') return `${value > 0 ? '+' : ''}${Number(value.toFixed(2))}`;
  if (typeof value === 'boolean') return value ? 'On' : 'Off';
  return null;
};

const withValue = (name: string, value: unknown) => {
  const formatted = formatValue(value);
  return formatted === null ? name : `${name} ${formatted}`;
};

/** Deep equality for plain adjustment values (objects, arrays, primitives). */
const isSameValue = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  return aKeys.length === bKeys.length && aKeys.every((key) => isSameValue((a as Values)[key], (b as Values)[key]));
};

const nestedChanges = (prefix: string, before: unknown, after: unknown): string[] => {
  const prev = (before || {}) as Values;
  const next = (after || {}) as Values;
  return Object.keys(next)
    .filter((key) => !isSameValue(prev[key], next[key]))
    .map((key) => withValue(`${prefix}: ${formatKey(key)}`, next[key]));
};

const maskChanges = (before: MaskContainer[] = [], after: MaskContainer[] = []): string[] => {
  const changes: string[] = [];
  before
    .filter((mask) => !after.some((m) => m.id === mask.id))
    .forEach((mask) => changes.push(`Deleted Mask: ${mask.name || 'Mask'}`));

  after.forEach((mask) => {
    const prev = before.find((m) => m.id === mask.id);
    const name = mask.name || 'Mask';
    if (!prev) {
      changes.push(`Added Mask: ${name}`);
      return;
    }
    if (isSameValue(prev, mask)) return;

    changes.push(...nestedChanges(name, prev.adjustments, mask.adjustments));
    if (!isSameValue(prev.subMasks, mask.subMasks)) changes.push(`${name}: Mask Area / Brush`);
    if (prev.opacity !== mask.opacity) changes.push(`${name}: Opacity ${mask.opacity}`);
    if (prev.blendMode !== mask.blendMode) changes.push(`${name}: Blend Mode`);
    if (prev.invert !== mask.invert) changes.push(`${name}: Invert ${formatValue(mask.invert)}`);
    if (prev.visible !== mask.visible) changes.push(`${name}: Visible ${formatValue(mask.visible)}`);
    if (prev.name !== mask.name) changes.push(`Renamed Mask: ${name}`);
  });
  return changes;
};

const aiPatchChanges = (before: AiPatch[] = [], after: AiPatch[] = []): string[] => {
  if (after.length > before.length) return ['Added AI Patch'];
  if (after.length < before.length) return ['Deleted AI Patch'];
  const changes: string[] = [];
  after.forEach((patch) => {
    const prev = before.find((p) => p.id === patch.id);
    if (!prev) return;
    if (prev.visible !== patch.visible) changes.push('AI Patch Visibility');
    if (!isSameValue(prev.subMasks, patch.subMasks)) changes.push('AI Patch Area');
    if (prev.patchData !== patch.patchData || prev.prompt !== patch.prompt) changes.push('AI Generation');
  });
  return changes;
};

const cropLabel = ({ crop, aspectRatio }: Adjustments) => {
  if (!crop) return 'Crop Cleared';
  const ratio = aspectRatio || crop.width / crop.height;
  const standard = CROP_RATIOS.find(([w, h]) => Math.abs(ratio - w / h) < 0.001);
  return `Crop ${standard ? standard.join(':') : `${Math.round(crop.width)} × ${Math.round(crop.height)}`}`;
};

/**
 * Names the history step from `before` to `after`: the changed controls with their new values,
 * mask and AI patch changes, HSL and curve channels, and the crop ratio.
 */
export function describeHistoryChange(before: Adjustments, after: Adjustments): string {
  const prev = before as unknown as Values;
  const next = after as unknown as Values;
  const changedKeys = Object.keys(next).filter((key) => !isSameValue(prev[key], next[key]));

  const changes = changedKeys.flatMap((key): string[] => {
    switch (key) {
      case 'sectionVisibility':
        return changedKeys.length === 1 ? [formatKey(key)] : [];
      case 'masks':
        return maskChanges(before.masks, after.masks);
      case 'aiPatches':
        return aiPatchChanges(before.aiPatches, after.aiPatches);
      case 'crop':
      case 'aspectRatio':
        return key === 'aspectRatio' && changedKeys.includes('crop') ? [] : [cropLabel(after)];
      case 'curves':
      case 'pointCurves':
      case 'parametricCurve': {
        const beforeCurves = (prev[key] || {}) as Values;
        const afterCurves = (next[key] || {}) as Values;
        return Object.keys(afterCurves)
          .filter((channel) => !isSameValue(beforeCurves[channel], afterCurves[channel]))
          .map((channel) => `Curves: ${formatKey(channel)}`);
      }
      case 'hsl': {
        const beforeHsl = (before.hsl || {}) as Values;
        return Object.entries(after.hsl).flatMap(([channel, values]) =>
          nestedChanges(`HSL ${formatKey(channel.replace(/s$/, ''))}`, beforeHsl[channel], values),
        );
      }
      case 'pointColors':
        return [formatKey(key)];
      case 'colorGrading':
      case 'colorCalibration':
        return nestedChanges(formatKey(key), prev[key], next[key]);
      default:
        return [withValue(formatKey(key), next[key])];
    }
  });

  const unique = Array.from(new Set(changes));
  if (unique.length === 0) return 'Adjustment';
  const extra = unique.length - MAX_CHANGES;
  return unique.slice(0, MAX_CHANGES).join(', ') + (extra > 0 ? ` (+${extra} more)` : '');
}
