import {
  DEFAULT_LIGHTS_OUT_BORDER_COLOR,
  DEFAULT_LIGHTS_OUT_BORDER_WIDTH,
  DEFAULT_LIGHTS_OUT_DIM_LEVEL,
  DEFAULT_LIGHTS_OUT_SCREEN_COLOR,
  LIGHTS_OUT_BORDER_WIDTHS,
  LIGHTS_OUT_DIM_LEVELS,
  LightsOutBorderWidth,
  LightsOutDimLevel,
  LightsOutScreenColor,
} from '../components/ui/AppProperties';
import type { LightsOutMode } from '../store/useUIStore';

/** Marks an element that stays lit in Lights Out; its value is the corner radius in pixels. */
export const LIGHTS_OUT_TARGET_ATTRIBUTE = 'data-lights-out-target';
/** Marks a scroll or viewport container whose bounds clip the lit areas inside it. */
export const LIGHTS_OUT_CLIP_ATTRIBUTE = 'data-lights-out-clip';

/** Also used by `public/lights-out-cover.html` and `FADE_DURATION` in `src-tauri/src/lights_out_cover.rs`. */
export const LIGHTS_OUT_FADE_MS = 300;
/** Emitted by the backend when the main window loses focus; matches `DEACTIVATED_EVENT` in `lights_out_cover.rs`. */
export const LIGHTS_OUT_DEACTIVATED_EVENT = 'lights-out-deactivated';

export const LIGHTS_OUT_SCREEN_COLORS: Record<LightsOutScreenColor, string> = {
  [LightsOutScreenColor.Black]: '#000000',
  [LightsOutScreenColor.DarkGray]: '#333333',
  [LightsOutScreenColor.MediumGray]: '#808080',
  [LightsOutScreenColor.LightGray]: '#c8c8c8',
  [LightsOutScreenColor.White]: '#ffffff',
};

/** Lights Dim always darkens with black; Lights Out uses the chosen screen colour. */
export const lightsOutColor = (mode: Exclude<LightsOutMode, 'off'>, screenColor: LightsOutScreenColor) =>
  mode === 'out' ? LIGHTS_OUT_SCREEN_COLORS[screenColor] : LIGHTS_OUT_SCREEN_COLORS[LightsOutScreenColor.Black];

export const normalizeLightsOutDimLevel = (value?: number | null): LightsOutDimLevel =>
  LIGHTS_OUT_DIM_LEVELS.find((level) => level === value) ?? DEFAULT_LIGHTS_OUT_DIM_LEVEL;

const findLightsOutColor = (value?: string | null) =>
  Object.values(LightsOutScreenColor).find((color) => color === value);

export const normalizeLightsOutScreenColor = (value?: string | null): LightsOutScreenColor =>
  findLightsOutColor(value) ?? DEFAULT_LIGHTS_OUT_SCREEN_COLOR;

export const normalizeLightsOutBorderColor = (value?: string | null): LightsOutScreenColor =>
  findLightsOutColor(value) ?? DEFAULT_LIGHTS_OUT_BORDER_COLOR;

export const normalizeLightsOutBorderWidth = (value?: number | null): LightsOutBorderWidth =>
  LIGHTS_OUT_BORDER_WIDTHS.find((width) => width === value) ?? DEFAULT_LIGHTS_OUT_BORDER_WIDTH;

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

interface LitArea {
  /** The lit element's bounds, unclipped. */
  bounds: Hole;
  /** The part of the viewport the lit element may show in. */
  visible: Omit<Hole, 'radius'>;
}

const clipHole = (hole: Hole, visible: LitArea['visible']): Hole | null => {
  const clipped = {
    left: Math.max(hole.left, visible.left),
    top: Math.max(hole.top, visible.top),
    right: Math.min(hole.right, visible.right),
    bottom: Math.min(hole.bottom, visible.bottom),
    radius: hole.radius,
  };
  return clipped.right - clipped.left >= 1 && clipped.bottom - clipped.top >= 1 ? clipped : null;
};

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

/** Every lit element, in viewport pixels. */
const collectLitAreas = (): LitArea[] =>
  Array.from(document.querySelectorAll<Element>(`[${LIGHTS_OUT_TARGET_ATTRIBUTE}]`), (element) => {
    const { left, top, right, bottom } = element.getBoundingClientRect();
    const clip = element.closest(`[${LIGHTS_OUT_CLIP_ATTRIBUTE}]`)?.getBoundingClientRect();
    return {
      bounds: { left, top, right, bottom, radius: Number(element.getAttribute(LIGHTS_OUT_TARGET_ATTRIBUTE)) || 0 },
      visible: {
        left: Math.max(clip?.left ?? 0, 0),
        top: Math.max(clip?.top ?? 0, 0),
        right: Math.min(clip?.right ?? window.innerWidth, window.innerWidth),
        bottom: Math.min(clip?.bottom ?? window.innerHeight, window.innerHeight),
      },
    };
  });

const expandHole = ({ left, top, right, bottom, radius }: Hole, by: number): Hole => ({
  left: left - by,
  top: top - by,
  right: right + by,
  bottom: bottom + by,
  radius: radius > 0 ? radius + by : 0,
});

/**
 * Even-odd paths in viewport pixels: `veil` covers the whole viewport except the lit elements, and `border` is a
 * ring of `borderWidth` around each of them (empty when the width is 0). Both stay inside each element's clip.
 */
export const buildLightsOutPaths = (borderWidth: number) => {
  const { innerWidth: width, innerHeight: height } = window;
  const veil = [`M0 0H${width}V${height}H0Z`];
  const border: string[] = [];
  collectLitAreas().forEach(({ bounds, visible }) => {
    const hole = clipHole(bounds, visible);
    if (!hole) return;
    veil.push(roundedRectPath(hole));
    const outer = borderWidth > 0 ? clipHole(expandHole(bounds, borderWidth), visible) : null;
    if (outer) border.push(roundedRectPath(outer), roundedRectPath(hole));
  });
  return { veil: veil.join(''), border: border.join('') };
};
