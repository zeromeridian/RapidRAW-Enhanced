import { BlackFrameSettings } from '../components/ui/AppProperties';

export const DEFAULT_BLACK_FRAME: BlackFrameSettings = {
  unit: 'percent',
  locked: true,
  top: 5,
  right: 5,
  bottom: 5,
  left: 5,
};

export const BLACK_FRAME_LIMITS = {
  percent: { min: 0, max: 25, step: 0.5 },
  pixels: { min: 0, max: 400, step: 1 },
} as const;

export const BLACK_FRAME_PRESETS: Record<string, BlackFrameSettings> = {
  none: { unit: 'percent', locked: true, top: 0, right: 0, bottom: 0, left: 0 },
  narrow: { unit: 'percent', locked: true, top: 2, right: 2, bottom: 2, left: 2 },
  standard: { ...DEFAULT_BLACK_FRAME },
  wide: { unit: 'percent', locked: true, top: 8, right: 8, bottom: 8, left: 8 },
  cinema: { unit: 'percent', locked: false, top: 8, right: 4, bottom: 8, left: 4 },
};

export const normalizeBlackFrame = (value?: Partial<BlackFrameSettings> | null): BlackFrameSettings => {
  const unit = value?.unit === 'pixels' ? 'pixels' : 'percent';
  const limits = BLACK_FRAME_LIMITS[unit];
  const clamp = (side: number | undefined) =>
    Math.min(limits.max, Math.max(limits.min, Number.isFinite(side) ? Number(side) : DEFAULT_BLACK_FRAME.top));

  return {
    unit,
    locked: value?.locked ?? true,
    top: clamp(value?.top),
    right: clamp(value?.right),
    bottom: clamp(value?.bottom),
    left: clamp(value?.left),
  };
};
