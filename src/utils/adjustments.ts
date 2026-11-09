import { Crop } from 'react-image-crop';
import { v4 as uuidv4 } from 'uuid';
import { SubMask, SubMaskMode } from '../components/panel/right/Masks';

export enum ActiveChannel {
  Blue = 'blue',
  Green = 'green',
  Luma = 'luma',
  Red = 'red',
}

export enum DisplayMode {
  Luma = 'luma',
  Rgb = 'rgb',
  Parade = 'parade',
  Vectorscope = 'vectorscope',
  Histogram = 'histogram',
}

export enum PasteMode {
  Merge = 'merge',
  Replace = 'replace',
}

export interface CopyPasteSettings {
  mode: PasteMode;
  includedAdjustments: Array<string>;
  knownAdjustments: Array<string>;
  autoSync: boolean;
}

export enum BasicAdjustment {
  Blacks = 'blacks',
  Brightness = 'brightness',
  Contrast = 'contrast',
  Exposure = 'exposure',
  Highlights = 'highlights',
  Shadows = 'shadows',
  Whites = 'whites',
}

export enum ColorAdjustment {
  ColorGrading = 'colorGrading',
  Hsl = 'hsl',
  Hue = 'hue',
  Luminance = 'luminance',
  Monochrome = 'monochrome',
  Saturation = 'saturation',
  Temperature = 'temperature',
  Tint = 'tint',
  Vibrance = 'vibrance',
}

export enum ColorGrading {
  Balance = 'balance',
  Blending = 'blending',
  Global = 'global',
  Highlights = 'highlights',
  Midtones = 'midtones',
  Shadows = 'shadows',
}

export enum DetailsAdjustment {
  AiDenoiseAmount = 'aiDenoiseAmount',
  AiDenoiseDetail = 'aiDenoiseDetail',
  AiDenoiseEnabled = 'aiDenoiseEnabled',
  Clarity = 'clarity',
  Dehaze = 'dehaze',
  Structure = 'structure',
  Centré = 'centré',
  ColorNoiseReduction = 'colorNoiseReduction',
  LumaNoiseReduction = 'lumaNoiseReduction',
  Sharpness = 'sharpness',
  SharpnessThreshold = 'sharpnessThreshold',
  ChromaticAberrationRedCyan = 'chromaticAberrationRedCyan',
  ChromaticAberrationBlueYellow = 'chromaticAberrationBlueYellow',
}

export enum Effect {
  GaussianBlurAmount = 'gaussianBlurAmount',
  MotionBlurAmount = 'motionBlurAmount',
  MotionBlurAngle = 'motionBlurAngle',
  GrainAmount = 'grainAmount',
  GrainRoughness = 'grainRoughness',
  GrainSize = 'grainSize',
  LutData = 'lutData',
  LutIntensity = 'lutIntensity',
  LutName = 'lutName',
  LutPath = 'lutPath',
  LutSize = 'lutSize',
  VignetteAmount = 'vignetteAmount',
  VignetteFeather = 'vignetteFeather',
  VignetteMidpoint = 'vignetteMidpoint',
  VignetteRoundness = 'vignetteRoundness',
  LensBlurEnabled = 'lensBlurEnabled',
  LensBlurAmount = 'lensBlurAmount',
  lensBlurDiffusion = 'lensBlurDiffusion',
  LensBlurShape = 'lensBlurShape',
  LensBlurDepthMap = 'lensBlurDepthMap',
  LensBlurMinDepth = 'lensBlurMinDepth',
  LensBlurMaxDepth = 'lensBlurMaxDepth',
  LensBlurMinFade = 'lensBlurMinFade',
  LensBlurMaxFade = 'lensBlurMaxFade',
  RelightEnabled = 'relightEnabled',
  RelightNormalMap = 'relightNormalMap',
  RelightLights = 'relightLights',
  RelightAmbient = 'relightAmbient',
  RelightSoftness = 'relightSoftness',
  RelightShine = 'relightShine',
  RelightShadows = 'relightShadows',
  RelightShadowSoftness = 'relightShadowSoftness',
  FogEnabled = 'fogEnabled',
  FogDepthMap = 'fogDepthMap',
  FogAmount = 'fogAmount',
  FogStart = 'fogStart',
  FogFeather = 'fogFeather',
  FogDensity = 'fogDensity',
  FogHeight = 'fogHeight',
  FogVariation = 'fogVariation',
  FogGlow = 'fogGlow',
  FogTemperature = 'fogTemperature',
  FogTint = 'fogTint',
}

export interface RelightLight {
  id: string;
  type: 'point' | 'spot' | 'directional';
  x: number;
  y: number;
  depth: number;
  intensity: number;
  radius: number;
  angle: number;
  elevation: number;
  cone: number;
  feather: number;
  temperature: number;
  tint: number;
  color: string;
}

export const createRelightLight = (x: number, y: number): RelightLight => ({
  id: uuidv4(),
  type: 'point',
  x,
  y,
  depth: 0,
  intensity: 60,
  radius: 30,
  angle: 135,
  elevation: 60,
  cone: 40,
  feather: 50,
  temperature: 0,
  tint: 0,
  color: '#ffffff',
});

export const getRelightLightColor = (light: RelightLight): string => {
  const hex = parseInt((light.color || '#ffffff').slice(1), 16);
  const t = light.temperature / 100;
  const m = light.tint / 100;
  const rgb = [
    (((hex >> 16) & 255) / 255) * (1 + 0.45 * t + 0.15 * m),
    (((hex >> 8) & 255) / 255) * (1 - 0.35 * m),
    ((hex & 255) / 255) * (1 - 0.45 * t + 0.15 * m),
  ].map((c) => Math.max(0, c));
  const peak = Math.max(...rgb, 1e-3);
  return `rgb(${rgb.map((c) => Math.round((c / peak) * 255)).join(', ')})`;
};

/** Built-in halation colour (degrees); mirrors `DEFAULT_HALATION_HUE` in `image_processing.rs`. */
export const DEFAULT_HALATION_HUE = 10;
/** Glow colour hue (degrees) before one is chosen; mirrors `DEFAULT_GLOW_HUE` in `image_processing.rs`. */
export const DEFAULT_GLOW_HUE = 35;

export enum CreativeAdjustment {
  GlowAmount = 'glowAmount',
  GlowHue = 'glowHue',
  GlowSaturation = 'glowSaturation',
  HalationAmount = 'halationAmount',
  HalationHue = 'halationHue',
  FlareAmount = 'flareAmount',
}

export enum TransformAdjustment {
  TransformAutoMode = 'transformAutoMode',
  TransformAutoStrength = 'transformAutoStrength',
  TransformDistortion = 'transformDistortion',
  TransformVertical = 'transformVertical',
  TransformHorizontal = 'transformHorizontal',
  TransformRotate = 'transformRotate',
  TransformAspect = 'transformAspect',
  TransformScale = 'transformScale',
  TransformXOffset = 'transformXOffset',
  TransformYOffset = 'transformYOffset',
  TransformConstrainCrop = 'transformConstrainCrop',
}

export enum LensAdjustment {
  LensCorrectionMode = 'lensCorrectionMode',
  LensMaker = 'lensMaker',
  LensModel = 'lensModel',
  LensDistortionAmount = 'lensDistortionAmount',
  LensVignetteAmount = 'lensVignetteAmount',
  LensTcaAmount = 'lensTcaAmount',
  LensDistortionParams = 'lensDistortionParams',
  LensDistortionEnabled = 'lensDistortionEnabled',
  LensTcaEnabled = 'lensTcaEnabled',
  LensVignetteEnabled = 'lensVignetteEnabled',
}

export interface ColorCalibration {
  shadowsTint: number;
  redHue: number;
  redSaturation: number;
  greenHue: number;
  greenSaturation: number;
  blueHue: number;
  blueSaturation: number;
}

export interface ParametricCurveSettings {
  darks: number;
  shadows: number;
  highlights: number;
  lights: number;
  whiteLevel: number;
  blackLevel: number;
  split1: number;
  split2: number;
  split3: number;
}

export interface ParametricCurve {
  [index: string]: ParametricCurveSettings;
  blue: ParametricCurveSettings;
  green: ParametricCurveSettings;
  luma: ParametricCurveSettings;
  red: ParametricCurveSettings;
}

export interface Adjustments {
  [index: string]: any;
  aiDenoiseAmount: number;
  aiDenoiseDetail: number;
  aiDenoiseEnabled: boolean;
  aiPatches: Array<AiPatch>;
  aspectRatio: number | null;
  blacks: number;
  brightness: number;
  centré: number;
  clarity: number;
  chromaticAberrationBlueYellow: number;
  chromaticAberrationRedCyan: number;
  colorCalibration: ColorCalibration;
  colorGrading: ColorGradingProps;
  colorNoiseReduction: number;
  contrast: number;
  curves: Curves;
  pointCurves?: Curves;
  parametricCurve?: ParametricCurve;
  curveMode?: 'point' | 'parametric';
  crop: Crop | null;
  dehaze: number;
  exposure: number;
  flipHorizontal: boolean;
  flipVertical: boolean;
  flareAmount: number;
  fogAmount: number;
  fogDensity: number;
  fogDepthMap: string | null;
  fogEnabled: boolean;
  fogFeather: number;
  fogGlow: number;
  fogHeight: number;
  fogStart: number;
  fogTemperature: number;
  fogTint: number;
  fogVariation: number;
  glowAmount: number;
  glowHue: number;
  glowSaturation: number;
  grainAmount: number;
  grainRoughness: number;
  grainSize: number;
  guidedPerspective: GuidedPerspective;
  halationAmount: number;
  halationHue: number;
  highlights: number;
  hsl: Hsl;
  hue: number;
  lensBlurAmount: number;
  lensBlurDiffusion: number;
  lensBlurShape: 'circle' | 'hexagon' | 'octagon' | 'ring';
  lensBlurDepthMap: string | null;
  lensBlurEnabled: boolean;
  lensBlurMaxDepth: number;
  lensBlurMaxFade: number;
  lensBlurMinDepth: number;
  lensBlurMinFade: number;
  lensCorrectionMode: 'auto' | 'manual';
  lensDistortionAmount: number;
  lensVignetteAmount: number;
  lensTcaAmount: number;
  lensDistortionEnabled: boolean;
  lensTcaEnabled: boolean;
  lensVignetteEnabled: boolean;
  lensDistortionParams: {
    k1: number;
    k2: number;
    k3: number;
    model: number;
    tca_vr: number;
    tca_vb: number;
    vig_k1: number;
    vig_k2: number;
    vig_k3: number;
  } | null;
  lensMaker: string | null;
  lensModel: string | null;
  lumaNoiseReduction: number;
  lutData?: string | null;
  lutIntensity?: number;
  lutName?: string | null;
  lutPath?: string | null;
  lutSize?: number;
  masks: Array<MaskContainer>;
  monochrome: boolean;
  motionBlurAmount: number;
  motionBlurAngle: number;
  orientationSteps: number;
  relightAmbient: number;
  relightEnabled: boolean;
  relightLights: Array<RelightLight>;
  relightNormalMap: string | null;
  relightShadowSoftness: number;
  relightShadows: boolean;
  relightShine: number;
  relightSoftness: number;
  rotation: number;
  saturation: number;
  sectionVisibility: SectionVisibility;
  shadows: number;
  sharpness: number;
  sharpnessThreshold: number;
  showClipping: boolean;
  structure: number;
  temperature: number;
  tint: number;
  toneMapper: ToneMapper;
  transformAutoMode: 'auto' | 'level' | 'vertical' | 'guided' | null;
  transformAutoStrength: number;
  transformDistortion: number;
  transformVertical: number;
  transformHorizontal: number;
  transformRotate: number;
  transformAspect: number;
  transformScale: number;
  transformXOffset: number;
  transformYOffset: number;
  transformConstrainCrop: boolean;
  vibrance: number;
  vignetteAmount: number;
  vignetteFeather: number;
  vignetteMidpoint: number;
  vignetteRoundness: number;
  whites: number;
}

export type GuideOrientation = 'vertical' | 'horizontal';

export type ToneMapper = 'agx' | 'basic' | 'natural';

/**
 * A Guided Perspective line in normalized coordinates of the unoriented,
 * lens-corrected source image (before the geometry warp).
 */
export interface GuideLine {
  id: string;
  type: GuideOrientation;
  p1: Coord;
  p2: Coord;
}

export interface GuidedPerspective {
  enabled: boolean;
  lines: GuideLine[];
  autoCrop: boolean;
}

/** At most this many guides of each orientation. */
export const MAX_GUIDES_PER_ORIENTATION = 2;

export interface AiPatch {
  id: string;
  isLoading: boolean;
  invert: boolean;
  name: string;
  patchData: any | null;
  prompt: string;
  subMasks: Array<SubMask>;
  visible: boolean;
}

export interface Color {
  color: string;
  name: string;
}

interface ColorGradingProps {
  [index: string]: number | HueSatLum;
  balance: number;
  blending: number;
  global: HueSatLum;
  highlights: HueSatLum;
  midtones: HueSatLum;
  shadows: HueSatLum;
}

export interface Coord {
  x: number;
  y: number;
}

export interface Curves {
  [index: string]: Array<Coord>;
  blue: Array<Coord>;
  green: Array<Coord>;
  luma: Array<Coord>;
  red: Array<Coord>;
}

export interface HueSatLum {
  hue: number;
  saturation: number;
  luminance: number;
}

interface Hsl {
  [index: string]: HueSatLum;
  aquas: HueSatLum;
  blues: HueSatLum;
  greens: HueSatLum;
  magentas: HueSatLum;
  oranges: HueSatLum;
  purples: HueSatLum;
  reds: HueSatLum;
  yellows: HueSatLum;
}

export interface MaskAdjustments {
  [index: string]: any;
  blacks: number;
  brightness: number;
  clarity: number;
  colorCalibration: ColorCalibration;
  colorGrading: ColorGradingProps;
  colorNoiseReduction: number;
  contrast: number;
  curves: Curves;
  pointCurves?: Curves;
  parametricCurve?: ParametricCurve;
  curveMode?: 'point' | 'parametric';
  dehaze: number;
  exposure: number;
  flareAmount: number;
  gaussianBlurAmount: number;
  glowAmount: number;
  grainAmount: number;
  grainRoughness: number;
  grainSize: number;
  halationAmount: number;
  highlights: number;
  hsl: Hsl;
  hue: number;
  id?: string;
  lumaNoiseReduction: number;
  monochrome: boolean;
  motionBlurAmount: number;
  motionBlurAngle: number;
  saturation: number;
  sectionVisibility: SectionVisibility;
  shadows: number;
  sharpness: number;
  sharpnessThreshold: number;
  structure: number;
  temperature: number;
  tint: number;
  vibrance: number;
  vignetteAmount: number;
  vignetteFeather: number;
  vignetteMidpoint: number;
  vignetteRoundness: number;
  whites: number;
}

export interface MaskContainer {
  adjustments: MaskAdjustments;
  blendMode: MaskBlendMode;
  id?: any;
  invert: boolean;
  name: string;
  opacity: number;
  subMasks: Array<SubMask>;
  visible: boolean;
}

export enum MaskBlendMode {
  Normal = 'normal',
  Darken = 'darken',
  Multiply = 'multiply',
  ColorBurn = 'colorBurn',
  LinearBurn = 'linearBurn',
  Lighten = 'lighten',
  Screen = 'screen',
  ColorDodge = 'colorDodge',
  LinearDodge = 'linearDodge',
  Overlay = 'overlay',
  SoftLight = 'softLight',
  HardLight = 'hardLight',
  VividLight = 'vividLight',
  LinearLight = 'linearLight',
  PinLight = 'pinLight',
  HardMix = 'hardMix',
  Hue = 'hue',
  Saturation = 'saturation',
  Color = 'color',
  Luminosity = 'luminosity',
}

export interface Sections {
  [index: string]: Array<string>;
  basic: Array<string>;
  curves: Array<string>;
  color: Array<string>;
  details: Array<string>;
  effects: Array<string>;
}

export interface SectionVisibility {
  [index: string]: boolean;
  basic: boolean;
  curves: boolean;
  color: boolean;
  details: boolean;
  effects: boolean;
}

export const COLOR_LABELS: Array<Color> = [
  { name: 'red', color: '#ef4444' },
  { name: 'yellow', color: '#facc15' },
  { name: 'green', color: '#4ade80' },
  { name: 'blue', color: '#60a5fa' },
  { name: 'purple', color: '#a78bfa' },
];

const INITIAL_COLOR_GRADING: ColorGradingProps = {
  balance: 0,
  blending: 50,
  global: { hue: 0, saturation: 0, luminance: 0 },
  highlights: { hue: 0, saturation: 0, luminance: 0 },
  midtones: { hue: 0, saturation: 0, luminance: 0 },
  shadows: { hue: 0, saturation: 0, luminance: 0 },
};

const INITIAL_COLOR_CALIBRATION: ColorCalibration = {
  shadowsTint: 0,
  redHue: 0,
  redSaturation: 0,
  greenHue: 0,
  greenSaturation: 0,
  blueHue: 0,
  blueSaturation: 0,
};

export const DEFAULT_PARAMETRIC_CURVE_SETTINGS: ParametricCurveSettings = {
  darks: 0,
  shadows: 0,
  highlights: 0,
  lights: 0,
  whiteLevel: 0,
  blackLevel: 0,
  split1: 25,
  split2: 50,
  split3: 75,
};

export const getDefaultParametricCurve = (): ParametricCurve => ({
  luma: { ...DEFAULT_PARAMETRIC_CURVE_SETTINGS },
  red: { ...DEFAULT_PARAMETRIC_CURVE_SETTINGS },
  green: { ...DEFAULT_PARAMETRIC_CURVE_SETTINGS },
  blue: { ...DEFAULT_PARAMETRIC_CURVE_SETTINGS },
});

export const getDefaultCurves = (): Curves => ({
  blue: [
    { x: 0, y: 0 },
    { x: 255, y: 255 },
  ],
  green: [
    { x: 0, y: 0 },
    { x: 255, y: 255 },
  ],
  luma: [
    { x: 0, y: 0 },
    { x: 255, y: 255 },
  ],
  red: [
    { x: 0, y: 0 },
    { x: 255, y: 255 },
  ],
});

export const DEFAULT_PARAMETRIC_CURVE = getDefaultParametricCurve();

export const INITIAL_MASK_ADJUSTMENTS: MaskAdjustments = {
  blacks: 0,
  brightness: 0,
  clarity: 0,
  colorCalibration: { ...INITIAL_COLOR_CALIBRATION },
  colorGrading: { ...INITIAL_COLOR_GRADING },
  colorNoiseReduction: 0,
  contrast: 0,
  curves: getDefaultCurves(),
  pointCurves: getDefaultCurves(),
  parametricCurve: getDefaultParametricCurve(),
  curveMode: 'point',
  dehaze: 0,
  exposure: 0,
  flareAmount: 0,
  gaussianBlurAmount: 0,
  glowAmount: 0,
  grainAmount: 0,
  grainRoughness: 50,
  grainSize: 25,
  halationAmount: 0,
  highlights: 0,
  hsl: {
    aquas: { hue: 0, saturation: 0, luminance: 0 },
    blues: { hue: 0, saturation: 0, luminance: 0 },
    greens: { hue: 0, saturation: 0, luminance: 0 },
    magentas: { hue: 0, saturation: 0, luminance: 0 },
    oranges: { hue: 0, saturation: 0, luminance: 0 },
    purples: { hue: 0, saturation: 0, luminance: 0 },
    reds: { hue: 0, saturation: 0, luminance: 0 },
    yellows: { hue: 0, saturation: 0, luminance: 0 },
  },
  hue: 0,
  lumaNoiseReduction: 0,
  monochrome: false,
  motionBlurAmount: 0,
  motionBlurAngle: 0,
  saturation: 0,
  sectionVisibility: {
    basic: true,
    curves: true,
    color: true,
    details: true,
    effects: true,
  },
  shadows: 0,
  sharpness: 0,
  sharpnessThreshold: 15,
  structure: 0,
  temperature: 0,
  tint: 0,
  vibrance: 0,
  vignetteAmount: 0,
  vignetteFeather: 50,
  vignetteMidpoint: 50,
  vignetteRoundness: 0,
  whites: 0,
};

export const INITIAL_MASK_CONTAINER: MaskContainer = {
  adjustments: INITIAL_MASK_ADJUSTMENTS,
  blendMode: MaskBlendMode.Normal,
  invert: false,
  name: 'New Mask',
  opacity: 100,
  subMasks: [],
  visible: true,
};

export const INITIAL_ADJUSTMENTS: Adjustments = {
  aiDenoiseAmount: 100,
  aiDenoiseDetail: 0,
  aiDenoiseEnabled: false,
  aiPatches: [],
  aspectRatio: null,
  blacks: 0,
  brightness: 0,
  centré: 0,
  clarity: 0,
  chromaticAberrationBlueYellow: 0,
  chromaticAberrationRedCyan: 0,
  colorCalibration: { ...INITIAL_COLOR_CALIBRATION },
  colorGrading: { ...INITIAL_COLOR_GRADING },
  colorNoiseReduction: 0,
  contrast: 0,
  crop: null,
  curves: getDefaultCurves(),
  pointCurves: getDefaultCurves(),
  parametricCurve: getDefaultParametricCurve(),
  curveMode: 'point',
  dehaze: 0,
  exposure: 0,
  flipHorizontal: false,
  flipVertical: false,
  flareAmount: 0,
  fogAmount: 50,
  fogDensity: 50,
  fogDepthMap: null,
  fogEnabled: false,
  fogFeather: 0,
  fogGlow: 25,
  fogHeight: 0,
  fogStart: 0,
  fogTemperature: 0,
  fogTint: 0,
  fogVariation: 25,
  glowAmount: 0,
  glowHue: DEFAULT_GLOW_HUE,
  glowSaturation: 0,
  grainAmount: 0,
  grainRoughness: 50,
  grainSize: 25,
  guidedPerspective: { enabled: false, lines: [], autoCrop: true },
  halationAmount: 0,
  halationHue: DEFAULT_HALATION_HUE,
  highlights: 0,
  hsl: {
    aquas: { hue: 0, saturation: 0, luminance: 0 },
    blues: { hue: 0, saturation: 0, luminance: 0 },
    greens: { hue: 0, saturation: 0, luminance: 0 },
    magentas: { hue: 0, saturation: 0, luminance: 0 },
    oranges: { hue: 0, saturation: 0, luminance: 0 },
    purples: { hue: 0, saturation: 0, luminance: 0 },
    reds: { hue: 0, saturation: 0, luminance: 0 },
    yellows: { hue: 0, saturation: 0, luminance: 0 },
  },
  hue: 0,
  lensBlurAmount: 40,
  lensBlurDiffusion: 0,
  lensBlurShape: 'circle',
  lensBlurDepthMap: null,
  lensBlurEnabled: false,
  lensBlurMaxDepth: 100,
  lensBlurMaxFade: 20,
  lensBlurMinDepth: 20,
  lensBlurMinFade: 20,
  lensCorrectionMode: 'manual',
  lensDistortionAmount: 100,
  lensVignetteAmount: 100,
  lensTcaAmount: 100,
  lensDistortionEnabled: true,
  lensTcaEnabled: true,
  lensVignetteEnabled: true,
  lensDistortionParams: null,
  lensMaker: null,
  lensModel: null,
  lumaNoiseReduction: 0,
  lutData: null,
  lutIntensity: 100,
  lutName: null,
  lutPath: null,
  lutSize: 0,
  masks: [],
  monochrome: false,
  motionBlurAmount: 0,
  motionBlurAngle: 0,
  orientationSteps: 0,
  relightAmbient: 0,
  relightEnabled: false,
  relightLights: [],
  relightNormalMap: null,
  relightShadowSoftness: 15,
  relightShadows: false,
  relightShine: 0,
  relightSoftness: 25,
  rotation: 0,
  saturation: 0,
  sectionVisibility: {
    basic: true,
    curves: true,
    color: true,
    details: true,
    effects: true,
  },
  shadows: 0,
  sharpness: 0,
  sharpnessThreshold: 15,
  showClipping: false,
  structure: 0,
  temperature: 0,
  tint: 0,
  toneMapper: 'basic',
  transformAutoMode: null,
  transformAutoStrength: 100,
  transformDistortion: 0,
  transformVertical: 0,
  transformHorizontal: 0,
  transformRotate: 0,
  transformAspect: 0,
  transformScale: 100,
  transformXOffset: 0,
  transformYOffset: 0,
  transformConstrainCrop: false,
  vibrance: 0,
  vignetteAmount: 0,
  vignetteFeather: 50,
  vignetteMidpoint: 50,
  vignetteRoundness: 0,
  whites: 0,
};

const deepCloneCurves = (curves: any): Curves => ({
  blue: curves?.blue?.map((p: Coord) => ({ ...p })) || [
    { x: 0, y: 0 },
    { x: 255, y: 255 },
  ],
  green: curves?.green?.map((p: Coord) => ({ ...p })) || [
    { x: 0, y: 0 },
    { x: 255, y: 255 },
  ],
  luma: curves?.luma?.map((p: Coord) => ({ ...p })) || [
    { x: 0, y: 0 },
    { x: 255, y: 255 },
  ],
  red: curves?.red?.map((p: Coord) => ({ ...p })) || [
    { x: 0, y: 0 },
    { x: 255, y: 255 },
  ],
});

const deepCloneParametric = (pCurve: any): ParametricCurve => ({
  luma: { ...DEFAULT_PARAMETRIC_CURVE_SETTINGS, ...(pCurve?.luma || {}) },
  red: { ...DEFAULT_PARAMETRIC_CURVE_SETTINGS, ...(pCurve?.red || {}) },
  green: { ...DEFAULT_PARAMETRIC_CURVE_SETTINGS, ...(pCurve?.green || {}) },
  blue: { ...DEFAULT_PARAMETRIC_CURVE_SETTINGS, ...(pCurve?.blue || {}) },
});

const clampUnit = (value: unknown, fallback: number) =>
  Math.min(1, Math.max(0, typeof value === 'number' && Number.isFinite(value) ? value : fallback));

/** Upstream's normalization: valid coordinates and at most two guides per orientation. */
export const normalizeGuidedPerspective = (loaded?: Partial<GuidedPerspective>): GuidedPerspective => {
  const lines: GuideLine[] = (loaded?.lines || []).map((line) => ({
    id: line.id || uuidv4(),
    type: line.type === 'horizontal' ? 'horizontal' : 'vertical',
    p1: { x: clampUnit(line.p1?.x, 0), y: clampUnit(line.p1?.y, 0) },
    p2: { x: clampUnit(line.p2?.x, 1), y: clampUnit(line.p2?.y, 1) },
  }));
  const ofType = (type: GuideOrientation) =>
    lines.filter((line) => line.type === type).slice(0, MAX_GUIDES_PER_ORIENTATION);
  return {
    enabled: loaded?.enabled ?? false,
    lines: [...ofType('vertical'), ...ofType('horizontal')],
    autoCrop: loaded?.autoCrop ?? true,
  };
};

/**
 * Tone mapper for an image without edits (mirrors `default_tone_mapper` in
 * `tone_mapping.rs`). Saved edits without a `toneMapper` stay Basic, which is
 * why `INITIAL_ADJUSTMENTS` keeps Basic.
 */
export const getDefaultToneMapper = (isRaw: boolean): ToneMapper => (isRaw ? 'natural' : 'basic');

/** Adjustments of an unedited image, as after a reset. */
export const getInitialAdjustments = (isRaw: boolean): Adjustments => ({
  ...INITIAL_ADJUSTMENTS,
  toneMapper: getDefaultToneMapper(isRaw),
});

/** Whether Guided Perspective has enough guides to correct the image. */
export const hasGuidedPerspective = (guided: GuidedPerspective) => guided.enabled && guided.lines.length >= 2;

export const normalizeLoadedAdjustments = (loadedAdjustments: Adjustments): any => {
  if (!loadedAdjustments) {
    return INITIAL_ADJUSTMENTS;
  }

  const normalizeSubMasks = (subMasks: any[]) => {
    return (subMasks || []).map((subMask: Partial<SubMask>) => ({
      visible: true,
      mode: SubMaskMode.Additive,
      invert: false,
      opacity: 100,
      ...subMask,
    }));
  };

  const normalizedMasks = (loadedAdjustments.masks || []).map((maskContainer: MaskContainer) => {
    const containerAdjustments = maskContainer.adjustments || {};
    const normalizedSubMasks = normalizeSubMasks(maskContainer.subMasks);

    return {
      ...INITIAL_MASK_CONTAINER,
      id: maskContainer.id || uuidv4(),
      ...maskContainer,
      adjustments: {
        ...INITIAL_MASK_ADJUSTMENTS,
        ...containerAdjustments,
        flareAmount: containerAdjustments.flareAmount ?? INITIAL_MASK_ADJUSTMENTS.flareAmount,
        glowAmount: containerAdjustments.glowAmount ?? INITIAL_MASK_ADJUSTMENTS.glowAmount,
        halationAmount: containerAdjustments.halationAmount ?? INITIAL_MASK_ADJUSTMENTS.halationAmount,
        hue: containerAdjustments.hue ?? INITIAL_MASK_ADJUSTMENTS.hue,
        colorCalibration: {
          ...INITIAL_MASK_ADJUSTMENTS.colorCalibration,
          ...(containerAdjustments.colorCalibration || {}),
        },
        colorGrading: { ...INITIAL_MASK_ADJUSTMENTS.colorGrading, ...(containerAdjustments.colorGrading || {}) },
        hsl: { ...INITIAL_MASK_ADJUSTMENTS.hsl, ...(containerAdjustments.hsl || {}) },
        curves: containerAdjustments.curves ? deepCloneCurves(containerAdjustments.curves) : getDefaultCurves(),
        pointCurves: containerAdjustments.pointCurves
          ? deepCloneCurves(containerAdjustments.pointCurves)
          : getDefaultCurves(),
        parametricCurve: containerAdjustments.parametricCurve
          ? deepCloneParametric(containerAdjustments.parametricCurve)
          : getDefaultParametricCurve(),
        curveMode: containerAdjustments.curveMode || INITIAL_MASK_ADJUSTMENTS.curveMode,
        sectionVisibility: {
          ...INITIAL_MASK_ADJUSTMENTS.sectionVisibility,
          ...(containerAdjustments.sectionVisibility || {}),
        },
        sharpnessThreshold: containerAdjustments.sharpnessThreshold ?? INITIAL_MASK_ADJUSTMENTS.sharpnessThreshold,
      },
      subMasks: normalizedSubMasks,
    };
  });

  const normalizedAiPatches = (loadedAdjustments.aiPatches || []).map((patch: any) => ({
    visible: true,
    ...patch,
    subMasks: normalizeSubMasks(patch.subMasks),
  }));

  // Guided Transform (before `1.29.0`) stored guides that solved into the
  // sliders. Those edits keep their slider values; the guides are dropped.
  const { transformGuides: _legacyGuides, ...current } = loadedAdjustments as Adjustments & {
    transformGuides?: unknown;
  };
  const guidedPerspective = normalizeGuidedPerspective(current.guidedPerspective);

  return {
    ...INITIAL_ADJUSTMENTS,
    ...current,
    flareAmount: loadedAdjustments.flareAmount ?? INITIAL_ADJUSTMENTS.flareAmount,
    fogAmount: loadedAdjustments.fogAmount ?? INITIAL_ADJUSTMENTS.fogAmount,
    fogDensity: loadedAdjustments.fogDensity ?? INITIAL_ADJUSTMENTS.fogDensity,
    fogDepthMap: loadedAdjustments.fogDepthMap ?? INITIAL_ADJUSTMENTS.fogDepthMap,
    fogEnabled: loadedAdjustments.fogEnabled ?? INITIAL_ADJUSTMENTS.fogEnabled,
    fogFeather: loadedAdjustments.fogFeather ?? INITIAL_ADJUSTMENTS.fogFeather,
    fogGlow: loadedAdjustments.fogGlow ?? INITIAL_ADJUSTMENTS.fogGlow,
    fogHeight: loadedAdjustments.fogHeight ?? INITIAL_ADJUSTMENTS.fogHeight,
    fogStart: loadedAdjustments.fogStart ?? INITIAL_ADJUSTMENTS.fogStart,
    fogTemperature: loadedAdjustments.fogTemperature ?? INITIAL_ADJUSTMENTS.fogTemperature,
    fogTint: loadedAdjustments.fogTint ?? INITIAL_ADJUSTMENTS.fogTint,
    fogVariation: loadedAdjustments.fogVariation ?? INITIAL_ADJUSTMENTS.fogVariation,
    glowAmount: loadedAdjustments.glowAmount ?? INITIAL_ADJUSTMENTS.glowAmount,
    glowHue: loadedAdjustments.glowHue ?? INITIAL_ADJUSTMENTS.glowHue,
    glowSaturation: loadedAdjustments.glowSaturation ?? INITIAL_ADJUSTMENTS.glowSaturation,
    halationAmount: loadedAdjustments.halationAmount ?? INITIAL_ADJUSTMENTS.halationAmount,
    halationHue: loadedAdjustments.halationHue ?? INITIAL_ADJUSTMENTS.halationHue,
    lensBlurAmount: loadedAdjustments.lensBlurAmount ?? INITIAL_ADJUSTMENTS.lensBlurAmount,
    lensBlurDiffusion: loadedAdjustments.lensBlurDiffusion ?? INITIAL_ADJUSTMENTS.lensBlurDiffusion,
    lensBlurShape: loadedAdjustments.lensBlurShape ?? INITIAL_ADJUSTMENTS.lensBlurShape,
    lensBlurDepthMap: loadedAdjustments.lensBlurDepthMap ?? INITIAL_ADJUSTMENTS.lensBlurDepthMap,
    lensBlurEnabled: loadedAdjustments.lensBlurEnabled ?? INITIAL_ADJUSTMENTS.lensBlurEnabled,
    lensBlurMaxDepth: loadedAdjustments.lensBlurMaxDepth ?? INITIAL_ADJUSTMENTS.lensBlurMaxDepth,
    lensBlurMaxFade: loadedAdjustments.lensBlurMaxFade ?? INITIAL_ADJUSTMENTS.lensBlurMaxFade,
    lensBlurMinDepth: loadedAdjustments.lensBlurMinDepth ?? INITIAL_ADJUSTMENTS.lensBlurMinDepth,
    lensBlurMinFade: loadedAdjustments.lensBlurMinFade ?? INITIAL_ADJUSTMENTS.lensBlurMinFade,
    lensCorrectionMode: loadedAdjustments.lensCorrectionMode || 'manual',
    relightAmbient: loadedAdjustments.relightAmbient ?? INITIAL_ADJUSTMENTS.relightAmbient,
    relightEnabled: loadedAdjustments.relightEnabled ?? INITIAL_ADJUSTMENTS.relightEnabled,
    relightLights: (loadedAdjustments.relightLights ?? INITIAL_ADJUSTMENTS.relightLights).map(
      (light: RelightLight) => ({ ...createRelightLight(light.x, light.y), ...light }),
    ),
    relightNormalMap: loadedAdjustments.relightNormalMap ?? INITIAL_ADJUSTMENTS.relightNormalMap,
    relightShadowSoftness: loadedAdjustments.relightShadowSoftness ?? INITIAL_ADJUSTMENTS.relightShadowSoftness,
    relightShadows: loadedAdjustments.relightShadows ?? INITIAL_ADJUSTMENTS.relightShadows,
    relightShine: loadedAdjustments.relightShine ?? INITIAL_ADJUSTMENTS.relightShine,
    relightSoftness: loadedAdjustments.relightSoftness ?? INITIAL_ADJUSTMENTS.relightSoftness,
    lensMaker: loadedAdjustments.lensMaker ?? INITIAL_ADJUSTMENTS.lensMaker,
    lensModel: loadedAdjustments.lensModel ?? INITIAL_ADJUSTMENTS.lensModel,
    lensDistortionAmount: loadedAdjustments.lensDistortionAmount ?? INITIAL_ADJUSTMENTS.lensDistortionAmount,
    lensVignetteAmount: loadedAdjustments.lensVignetteAmount ?? INITIAL_ADJUSTMENTS.lensVignetteAmount,
    lensTcaAmount: loadedAdjustments.lensTcaAmount ?? INITIAL_ADJUSTMENTS.lensTcaAmount,
    lensDistortionEnabled: loadedAdjustments.lensDistortionEnabled ?? INITIAL_ADJUSTMENTS.lensDistortionEnabled,
    lensTcaEnabled: loadedAdjustments.lensTcaEnabled ?? INITIAL_ADJUSTMENTS.lensTcaEnabled,
    lensVignetteEnabled: loadedAdjustments.lensVignetteEnabled ?? INITIAL_ADJUSTMENTS.lensVignetteEnabled,
    lensDistortionParams: loadedAdjustments.lensDistortionParams ?? INITIAL_ADJUSTMENTS.lensDistortionParams,
    guidedPerspective,
    transformAutoMode:
      current.transformAutoMode === 'guided' && !hasGuidedPerspective(guidedPerspective)
        ? INITIAL_ADJUSTMENTS.transformAutoMode
        : (current.transformAutoMode ?? INITIAL_ADJUSTMENTS.transformAutoMode),
    transformAutoStrength: loadedAdjustments.transformAutoStrength ?? INITIAL_ADJUSTMENTS.transformAutoStrength,
    transformDistortion: loadedAdjustments.transformDistortion ?? INITIAL_ADJUSTMENTS.transformDistortion,
    transformVertical: loadedAdjustments.transformVertical ?? INITIAL_ADJUSTMENTS.transformVertical,
    transformHorizontal: loadedAdjustments.transformHorizontal ?? INITIAL_ADJUSTMENTS.transformHorizontal,
    transformRotate: loadedAdjustments.transformRotate ?? INITIAL_ADJUSTMENTS.transformRotate,
    transformAspect: loadedAdjustments.transformAspect ?? INITIAL_ADJUSTMENTS.transformAspect,
    transformScale: loadedAdjustments.transformScale ?? INITIAL_ADJUSTMENTS.transformScale,
    transformXOffset: loadedAdjustments.transformXOffset ?? INITIAL_ADJUSTMENTS.transformXOffset,
    transformYOffset: loadedAdjustments.transformYOffset ?? INITIAL_ADJUSTMENTS.transformYOffset,
    transformConstrainCrop: loadedAdjustments.transformConstrainCrop ?? INITIAL_ADJUSTMENTS.transformConstrainCrop,
    colorCalibration: { ...INITIAL_ADJUSTMENTS.colorCalibration, ...(loadedAdjustments.colorCalibration || {}) },
    colorGrading: { ...INITIAL_ADJUSTMENTS.colorGrading, ...(loadedAdjustments.colorGrading || {}) },
    hsl: { ...INITIAL_ADJUSTMENTS.hsl, ...(loadedAdjustments.hsl || {}) },
    curves: loadedAdjustments.curves ? deepCloneCurves(loadedAdjustments.curves) : getDefaultCurves(),
    pointCurves: loadedAdjustments.pointCurves ? deepCloneCurves(loadedAdjustments.pointCurves) : getDefaultCurves(),
    parametricCurve: loadedAdjustments.parametricCurve
      ? deepCloneParametric(loadedAdjustments.parametricCurve)
      : getDefaultParametricCurve(),
    curveMode: loadedAdjustments.curveMode || INITIAL_ADJUSTMENTS.curveMode,
    masks: normalizedMasks,
    monochrome: loadedAdjustments.monochrome ?? INITIAL_ADJUSTMENTS.monochrome,
    aiDenoiseAmount: loadedAdjustments.aiDenoiseAmount ?? INITIAL_ADJUSTMENTS.aiDenoiseAmount,
    aiDenoiseDetail: loadedAdjustments.aiDenoiseDetail ?? INITIAL_ADJUSTMENTS.aiDenoiseDetail,
    aiDenoiseEnabled: loadedAdjustments.aiDenoiseEnabled ?? INITIAL_ADJUSTMENTS.aiDenoiseEnabled,
    aiPatches: normalizedAiPatches,
    sectionVisibility: {
      ...INITIAL_ADJUSTMENTS.sectionVisibility,
      ...(loadedAdjustments.sectionVisibility || {}),
    },
    sharpnessThreshold: loadedAdjustments.sharpnessThreshold ?? INITIAL_ADJUSTMENTS.sharpnessThreshold,
  };
};

export interface AdjustmentGroup {
  label: string;
  keys: string[];
}

export const ADJUSTMENT_GROUPS: Record<string, AdjustmentGroup[]> = {
  basic: [
    {
      label: 'modals.copyPaste.groups.exposureToneMapper',
      keys: [BasicAdjustment.Exposure, 'toneMapper'],
    },
    {
      label: 'modals.copyPaste.groups.tone',
      keys: [
        BasicAdjustment.Brightness,
        BasicAdjustment.Contrast,
        BasicAdjustment.Highlights,
        BasicAdjustment.Shadows,
        BasicAdjustment.Whites,
        BasicAdjustment.Blacks,
      ],
    },
    {
      label: 'modals.copyPaste.groups.curves',
      keys: ['curves', 'pointCurves', 'parametricCurve', 'curveMode'],
    },
  ],
  color: [
    { label: 'modals.copyPaste.groups.whiteBalance', keys: [ColorAdjustment.Temperature, ColorAdjustment.Tint] },
    {
      label: 'modals.copyPaste.groups.presence',
      keys: [ColorAdjustment.Monochrome, ColorAdjustment.Saturation, ColorAdjustment.Vibrance],
    },
    {
      label: 'modals.copyPaste.groups.hueShift',
      keys: [ColorAdjustment.Hue],
    },
    { label: 'modals.copyPaste.groups.colorGrading', keys: [ColorAdjustment.ColorGrading] },
    { label: 'modals.copyPaste.groups.colorMixer', keys: [ColorAdjustment.Hsl] },
    { label: 'modals.copyPaste.groups.colorCalibration', keys: ['colorCalibration'] },
  ],
  details: [
    {
      label: 'modals.copyPaste.groups.clarityDehaze',
      keys: [
        DetailsAdjustment.Clarity,
        DetailsAdjustment.Structure,
        DetailsAdjustment.Dehaze,
        DetailsAdjustment.Centré,
      ],
    },
    {
      label: 'modals.copyPaste.groups.sharpness',
      keys: [DetailsAdjustment.Sharpness, DetailsAdjustment.SharpnessThreshold],
    },
    {
      label: 'modals.copyPaste.groups.noiseReduction',
      keys: [
        DetailsAdjustment.LumaNoiseReduction,
        DetailsAdjustment.ColorNoiseReduction,
        DetailsAdjustment.AiDenoiseEnabled,
        DetailsAdjustment.AiDenoiseAmount,
        DetailsAdjustment.AiDenoiseDetail,
      ],
    },
    {
      label: 'modals.copyPaste.groups.chromaticAberration',
      keys: [DetailsAdjustment.ChromaticAberrationRedCyan, DetailsAdjustment.ChromaticAberrationBlueYellow],
    },
  ],
  effects: [
    {
      label: 'modals.copyPaste.groups.vignette',
      keys: [Effect.VignetteAmount, Effect.VignetteFeather, Effect.VignetteMidpoint, Effect.VignetteRoundness],
    },
    { label: 'modals.copyPaste.groups.grain', keys: [Effect.GrainAmount, Effect.GrainRoughness, Effect.GrainSize] },
    {
      label: 'modals.copyPaste.groups.halationGlow',
      keys: [
        CreativeAdjustment.GlowAmount,
        CreativeAdjustment.GlowHue,
        CreativeAdjustment.GlowSaturation,
        CreativeAdjustment.HalationAmount,
        CreativeAdjustment.HalationHue,
        CreativeAdjustment.FlareAmount,
      ],
    },
    { label: 'modals.copyPaste.groups.motionBlur', keys: [Effect.MotionBlurAmount, Effect.MotionBlurAngle] },
    {
      label: 'modals.copyPaste.groups.lut',
      keys: [Effect.LutIntensity, Effect.LutName, Effect.LutPath, Effect.LutSize, Effect.LutData],
    },
  ],
  geometry: [
    { label: 'modals.copyPaste.groups.cropAspectRatio', keys: ['crop', 'aspectRatio'] },
    {
      label: 'modals.copyPaste.groups.transformRotation',
      keys: [
        'rotation',
        'flipHorizontal',
        'flipVertical',
        'orientationSteps',
        TransformAdjustment.TransformAutoMode,
        TransformAdjustment.TransformAutoStrength,
        'guidedPerspective',
        TransformAdjustment.TransformDistortion,
        TransformAdjustment.TransformVertical,
        TransformAdjustment.TransformHorizontal,
        TransformAdjustment.TransformRotate,
        TransformAdjustment.TransformAspect,
        TransformAdjustment.TransformScale,
        TransformAdjustment.TransformXOffset,
        TransformAdjustment.TransformYOffset,
        TransformAdjustment.TransformConstrainCrop,
      ],
    },
  ],
  lensCorrection: [
    {
      label: 'modals.copyPaste.groups.lensCorrection',
      keys: [
        LensAdjustment.LensCorrectionMode,
        LensAdjustment.LensMaker,
        LensAdjustment.LensModel,
        LensAdjustment.LensDistortionAmount,
        LensAdjustment.LensVignetteAmount,
        LensAdjustment.LensTcaAmount,
        LensAdjustment.LensDistortionEnabled,
        LensAdjustment.LensTcaEnabled,
        LensAdjustment.LensVignetteEnabled,
      ],
    },
  ],
  masks: [{ label: 'modals.copyPaste.groups.masks', keys: ['masks'] }],
};

export const SPEED_EDIT_ROTATION = 'rotation';

export const SPEED_EDIT_ADJUSTMENTS = [
  { id: BasicAdjustment.Exposure, label: 'adjustments.basic.evShift' },
  { id: BasicAdjustment.Contrast, label: 'adjustments.basic.contrast' },
  { id: BasicAdjustment.Highlights, label: 'adjustments.basic.highlights' },
  { id: BasicAdjustment.Shadows, label: 'adjustments.basic.shadows' },
  { id: BasicAdjustment.Whites, label: 'adjustments.basic.whites' },
  { id: BasicAdjustment.Blacks, label: 'adjustments.basic.blacks' },
  { id: ColorAdjustment.Temperature, label: 'adjustments.color.temperature' },
  { id: ColorAdjustment.Tint, label: 'adjustments.color.tint' },
  { id: ColorAdjustment.Vibrance, label: 'adjustments.color.vibrance' },
  { id: ColorAdjustment.Saturation, label: 'adjustments.color.saturation' },
  { id: DetailsAdjustment.Clarity, label: 'adjustments.details.clarity' },
  { id: DetailsAdjustment.Dehaze, label: 'adjustments.details.dehaze' },
  { id: DetailsAdjustment.Structure, label: 'adjustments.details.structure' },
  { id: Effect.VignetteAmount, label: 'adjustments.effects.vignette' },
  { id: SPEED_EDIT_ROTATION, label: 'editor.crop.rotationHeading' },
] as const;

export const DEFAULT_SPEED_EDIT_ADJUSTMENTS: string[] = [
  BasicAdjustment.Exposure,
  BasicAdjustment.Contrast,
  BasicAdjustment.Highlights,
  BasicAdjustment.Shadows,
  ColorAdjustment.Temperature,
  ColorAdjustment.Tint,
  ColorAdjustment.Saturation,
  SPEED_EDIT_ROTATION,
];

export const COPYABLE_ADJUSTMENT_KEYS: string[] = Object.values(ADJUSTMENT_GROUPS)
  .flat()
  .flatMap((group) => group.keys);

/** The values the Crop panel edits; Escape in Crop restores them as they were when Crop opened. */
export const CROP_GEOMETRY_KEYS = [
  'crop',
  'aspectRatio',
  'rotation',
  'orientationSteps',
  'flipHorizontal',
  'flipVertical',
] as const satisfies ReadonlyArray<keyof Adjustments>;

export type CropGeometry = Pick<Adjustments, (typeof CROP_GEOMETRY_KEYS)[number]>;

export const pickCropGeometry = (adjustments: Adjustments): CropGeometry =>
  Object.fromEntries(CROP_GEOMETRY_KEYS.map((key) => [key, structuredClone(adjustments[key])])) as CropGeometry;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const diffAdjustmentValue = (previous: unknown, next: unknown): unknown => {
  if (isPlainObject(previous) && isPlainObject(next)) {
    const changes: Record<string, unknown> = {};
    for (const key of Object.keys(next)) {
      const change = diffAdjustmentValue(previous[key], next[key]);
      if (change !== undefined) changes[key] = change;
    }
    return Object.keys(changes).length > 0 ? changes : undefined;
  }
  return JSON.stringify(previous) === JSON.stringify(next) ? undefined : next;
};

/**
 * Describes what changed between two adjustment states, limited to `keys`.
 * `changes` holds only the changed controls (nested objects such as HSL keep
 * just the changed channel and field; arrays stay whole), and `complete` holds
 * the full value of each changed key, as `apply_adjustments_to_paths` expects.
 */
export const getAdjustmentChanges = (
  previous: Adjustments,
  next: Adjustments,
  keys: Array<string>,
): { changes: Partial<Adjustments>; complete: Partial<Adjustments> } | null => {
  const changes: Record<string, unknown> = {};
  const complete: Record<string, unknown> = {};
  for (const key of keys) {
    const change = diffAdjustmentValue(previous[key as keyof Adjustments], next[key as keyof Adjustments]);
    if (change !== undefined) {
      changes[key] = change;
      complete[key] = next[key as keyof Adjustments];
    }
  }
  return Object.keys(changes).length > 0
    ? { changes: changes as Partial<Adjustments>, complete: complete as Partial<Adjustments> }
    : null;
};

export const ADJUSTMENT_SECTIONS: Sections = {
  basic: [
    BasicAdjustment.Brightness,
    BasicAdjustment.Contrast,
    BasicAdjustment.Highlights,
    BasicAdjustment.Shadows,
    BasicAdjustment.Whites,
    BasicAdjustment.Blacks,
    BasicAdjustment.Exposure,
    'toneMapper',
  ],
  curves: ['curves', 'pointCurves', 'parametricCurve', 'curveMode'],
  color: [
    ColorAdjustment.Monochrome,
    ColorAdjustment.Saturation,
    ColorAdjustment.Temperature,
    ColorAdjustment.Tint,
    ColorAdjustment.Vibrance,
    ColorAdjustment.Hsl,
    ColorAdjustment.ColorGrading,
    'colorCalibration',
    ColorAdjustment.Hue,
  ],
  details: [
    DetailsAdjustment.Clarity,
    DetailsAdjustment.Dehaze,
    DetailsAdjustment.Structure,
    DetailsAdjustment.Centré,
    DetailsAdjustment.Sharpness,
    DetailsAdjustment.SharpnessThreshold,
    DetailsAdjustment.LumaNoiseReduction,
    DetailsAdjustment.ColorNoiseReduction,
    DetailsAdjustment.AiDenoiseEnabled,
    DetailsAdjustment.AiDenoiseAmount,
    DetailsAdjustment.AiDenoiseDetail,
    DetailsAdjustment.ChromaticAberrationRedCyan,
    DetailsAdjustment.ChromaticAberrationBlueYellow,
  ],
  effects: [
    CreativeAdjustment.GlowAmount,
    CreativeAdjustment.GlowHue,
    CreativeAdjustment.GlowSaturation,
    CreativeAdjustment.HalationAmount,
    CreativeAdjustment.HalationHue,
    CreativeAdjustment.FlareAmount,
    Effect.MotionBlurAmount,
    Effect.MotionBlurAngle,
    Effect.GrainAmount,
    Effect.GrainRoughness,
    Effect.GrainSize,
    Effect.LutIntensity,
    Effect.LutName,
    Effect.LutPath,
    Effect.LutSize,
    Effect.VignetteAmount,
    Effect.VignetteFeather,
    Effect.VignetteMidpoint,
    Effect.VignetteRoundness,
    Effect.LensBlurEnabled,
    Effect.LensBlurAmount,
    Effect.lensBlurDiffusion,
    Effect.LensBlurShape,
    Effect.LensBlurMinDepth,
    Effect.LensBlurMaxDepth,
    Effect.LensBlurMinFade,
    Effect.LensBlurMaxFade,
    Effect.RelightEnabled,
    Effect.RelightLights,
    Effect.RelightAmbient,
    Effect.RelightSoftness,
    Effect.RelightShine,
    Effect.RelightShadows,
    Effect.RelightShadowSoftness,
    Effect.FogEnabled,
    Effect.FogAmount,
    Effect.FogStart,
    Effect.FogFeather,
    Effect.FogDensity,
    Effect.FogHeight,
    Effect.FogVariation,
    Effect.FogGlow,
    Effect.FogTemperature,
    Effect.FogTint,
  ],
};
