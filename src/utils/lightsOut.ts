import {
  DEFAULT_LIGHTS_OUT_DIM_LEVEL,
  DEFAULT_LIGHTS_OUT_SCREEN_COLOR,
  LIGHTS_OUT_DIM_LEVELS,
  LightsOutDimLevel,
  LightsOutScreenColor,
} from '../components/ui/AppProperties';

/** Marks an element that stays lit in Lights Out; its value is the corner radius in pixels. */
export const LIGHTS_OUT_TARGET_ATTRIBUTE = 'data-lights-out-target';
/** Marks a scroll or viewport container whose bounds clip the lit areas inside it. */
export const LIGHTS_OUT_CLIP_ATTRIBUTE = 'data-lights-out-clip';

export const LIGHTS_OUT_FADE_MS = 300;

export const LIGHTS_OUT_SCREEN_COLORS: Record<LightsOutScreenColor, string> = {
  [LightsOutScreenColor.Black]: '#000000',
  [LightsOutScreenColor.DarkGray]: '#333333',
  [LightsOutScreenColor.MediumGray]: '#808080',
  [LightsOutScreenColor.LightGray]: '#c8c8c8',
  [LightsOutScreenColor.White]: '#ffffff',
};

export const normalizeLightsOutDimLevel = (value?: number | null): LightsOutDimLevel =>
  LIGHTS_OUT_DIM_LEVELS.find((level) => level === value) ?? DEFAULT_LIGHTS_OUT_DIM_LEVEL;

export const normalizeLightsOutScreenColor = (value?: string | null): LightsOutScreenColor =>
  Object.values(LightsOutScreenColor).find((color) => color === value) ?? DEFAULT_LIGHTS_OUT_SCREEN_COLOR;

/** Spread onto an element to keep it lit in Lights Out. */
export const lightsOutTarget = (isLit = true, radius = 0) =>
  isLit ? { [LIGHTS_OUT_TARGET_ATTRIBUTE]: String(radius) } : {};

export const lightsOutClip = { [LIGHTS_OUT_CLIP_ATTRIBUTE]: '' };

interface Hole {
  left: number;
  top: number;
  right: number;
  bottom: number;
  radius: number;
}

const round = (value: number) => Math.round(value * 100) / 100;

const roundedRectPath = ({ left, top, right, bottom, radius }: Hole) => {
  const r = Math.min(radius, (right - left) / 2, (bottom - top) / 2);
  if (r <= 0) return `M${round(left)} ${round(top)}H${round(right)}V${round(bottom)}H${round(left)}Z`;
  const arc = `A${round(r)} ${round(r)} 0 0 1`;
  return (
    `M${round(left + r)} ${round(top)}H${round(right - r)}${arc} ${round(right)} ${round(top + r)}` +
    `V${round(bottom - r)}${arc} ${round(right - r)} ${round(bottom)}H${round(left + r)}` +
    `${arc} ${round(left)} ${round(bottom - r)}V${round(top + r)}${arc} ${round(left + r)} ${round(top)}Z`
  );
};

/** The visible part of every lit element, in viewport pixels. */
const collectHoles = (): Hole[] => {
  const holes: Hole[] = [];
  document.querySelectorAll<Element>(`[${LIGHTS_OUT_TARGET_ATTRIBUTE}]`).forEach((element) => {
    const rect = element.getBoundingClientRect();
    const clip = element.closest(`[${LIGHTS_OUT_CLIP_ATTRIBUTE}]`)?.getBoundingClientRect();
    const hole = {
      left: Math.max(rect.left, clip?.left ?? 0, 0),
      top: Math.max(rect.top, clip?.top ?? 0, 0),
      right: Math.min(rect.right, clip?.right ?? window.innerWidth, window.innerWidth),
      bottom: Math.min(rect.bottom, clip?.bottom ?? window.innerHeight, window.innerHeight),
      radius: Number(element.getAttribute(LIGHTS_OUT_TARGET_ATTRIBUTE)) || 0,
    };
    if (hole.right - hole.left >= 1 && hole.bottom - hole.top >= 1) holes.push(hole);
  });
  return holes;
};

/** An even-odd path covering the whole viewport except the lit elements. */
export const buildLightsOutPath = () => {
  const { innerWidth: width, innerHeight: height } = window;
  return [`M0 0H${width}V${height}H0Z`, ...collectHoles().map(roundedRectPath)].join('');
};
