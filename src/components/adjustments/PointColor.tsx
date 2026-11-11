import { type PointerEvent as ReactPointerEvent, useEffect, useRef } from 'react';
import { Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import Slider, { type SliderChangeEvent } from '../ui/Slider';
import Switch from '../ui/Switch';
import Text from '../ui/Text';
import { RangePicker } from '../ui/RangePicker';
import { TextColors, TextVariants } from '../../types/typography';
import { useEditorStore } from '../../store/useEditorStore';
import {
  Adjustments,
  DEFAULT_POINT_COLOR_VARIANCE,
  POINT_COLOR_RANGE_DEFAULTS,
  PointColor,
  PointColorRange,
} from '../../utils/adjustments';
import {
  PickedColor,
  hueRangeFromBar,
  hueRangeGradient,
  hueRangeToBar,
  luminanceRangeGradient,
  pickedColorCss,
  rangeFromBar,
  rangeToBar,
  saturationRangeGradient,
  shiftedPickedColor,
} from '../../utils/pointColor';
import { ColorSwatch } from '../ui/ColorSwatch';

interface PointColorPanelProps {
  adjustments: Adjustments;
  setAdjustments(adjustments: (prev: Adjustments) => Adjustments): void;
  onDragStateChange?: (isDragging: boolean) => void;
}

const HUE_SPECTRUM_STOPS = 12;

/** Calls `onMove` with the pointer's position in `element` (0–1 each way) while it is pressed and dragged. */
const usePointerDrag = (onMove: (x: number, y: number) => void, onDragStateChange?: (isDragging: boolean) => void) => {
  const ref = useRef<HTMLDivElement>(null);
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const element = ref.current;
    if (!element) return;
    e.preventDefault();
    element.setPointerCapture(e.pointerId);
    const move = (ev: { clientX: number; clientY: number }) => {
      const rect = element.getBoundingClientRect();
      onMove(
        Math.min(1, Math.max(0, (ev.clientX - rect.left) / rect.width)),
        Math.min(1, Math.max(0, (ev.clientY - rect.top) / rect.height)),
      );
    };
    const up = () => {
      element.removeEventListener('pointermove', move);
      element.removeEventListener('pointerup', up);
      element.removeEventListener('pointercancel', up);
      onDragStateChange?.(false);
    };
    onDragStateChange?.(true);
    move(e);
    element.addEventListener('pointermove', move);
    element.addEventListener('pointerup', up);
    element.addEventListener('pointercancel', up);
  };
  return { ref, onPointerDown };
};

/**
 * The picked colour as Lightroom Classic shows it: a hue (across) by saturation (up) field at
 * the picked luminance and a luminance strip; dragging either refines the target colour.
 */
function PickedColorField({
  color,
  onChange,
  onDragStateChange,
}: {
  color: PickedColor;
  onChange: (color: Partial<PickedColor>) => void;
  onDragStateChange?: (isDragging: boolean) => void;
}) {
  const field = usePointerDrag(
    (x, y) => onChange({ hue: Math.round(x * 360) % 360, saturation: Math.round((1 - y) * 100) }),
    onDragStateChange,
  );
  const strip = usePointerDrag((_, y) => onChange({ luminance: Math.round((1 - y) * 100) }), onDragStateChange);
  const spectrum = Array.from({ length: HUE_SPECTRUM_STOPS + 1 }, (_, i) =>
    pickedColorCss({ ...color, hue: (i * 360) / HUE_SPECTRUM_STOPS, saturation: 100 }),
  );
  const marker =
    'absolute w-3 h-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow pointer-events-none';

  return (
    <div className="flex gap-2 h-24">
      <div
        ref={field.ref}
        onPointerDown={field.onPointerDown}
        className="relative flex-1 rounded-md cursor-crosshair touch-none"
        style={{
          background: `linear-gradient(to top, ${pickedColorCss({ ...color, saturation: 0 })}, transparent), linear-gradient(to right, ${spectrum.join(', ')})`,
        }}
      >
        <div
          className={marker}
          style={{
            left: `${(color.hue / 360) * 100}%`,
            top: `${100 - color.saturation}%`,
            background: pickedColorCss(color),
          }}
        />
      </div>
      <div
        ref={strip.ref}
        onPointerDown={strip.onPointerDown}
        className="relative w-4 rounded-md cursor-ns-resize touch-none"
        style={{ background: luminanceRangeGradient(color, 'to top') }}
      >
        <div
          className={marker}
          style={{ left: '50%', top: `${100 - color.luminance}%`, background: pickedColorCss(color) }}
        />
      </div>
    </div>
  );
}

/** The Color Mixer's Point Color view: points picked with the pipette, each shifting the colours near it. */
export default function PointColorPanel({ adjustments, setAdjustments, onDragStateChange }: PointColorPanelProps) {
  const { t } = useTranslation();
  const activePointColorId = useEditorStore((state) => state.activePointColorId);
  const isVisualized = useEditorStore((state) => state.isPointColorRangeVisualized);
  const setEditor = useEditorStore((state) => state.setEditor);
  const points = adjustments.pointColors ?? [];
  const point = points.find((p) => p.id === activePointColorId) ?? points[points.length - 1];

  // Visualize Range is a view of the open panel only.
  useEffect(() => () => setEditor({ isPointColorRangeVisualized: false }), [setEditor]);

  const updatePoint = (changes: Partial<PointColor>) => {
    if (!point) return;
    setAdjustments((prev) => ({
      ...prev,
      pointColors: (prev.pointColors ?? []).map((p) => (p.id === point.id ? { ...p, ...changes } : p)),
    }));
  };

  const deletePoint = () => {
    if (!point) return;
    setAdjustments((prev) => ({ ...prev, pointColors: (prev.pointColors ?? []).filter((p) => p.id !== point.id) }));
    setEditor({ activePointColorId: null });
  };

  if (!point) {
    return (
      <Text variant={TextVariants.small} color={TextColors.secondary} className="px-1 pb-1">
        {t('adjustments.color.pointColor.empty')}
      </Text>
    );
  }

  const renderShiftSlider = (key: 'hueShift' | 'saturationShift' | 'luminanceShift') => (
    <Slider
      key={key}
      label={t(`adjustments.color.pointColor.${key}`)}
      min={-100}
      max={100}
      step={1}
      defaultValue={0}
      value={point[key]}
      onChange={(e: SliderChangeEvent) => updatePoint({ [key]: Number(e.target.value) })}
      onDragStateChange={onDragStateChange}
    />
  );

  const renderRange = (
    key: 'hueRange' | 'saturationRange' | 'luminanceRange',
    gradient: string,
    startLabel: string,
    endLabel: string,
    toBar: (range: PointColorRange) => PointColorRange,
    fromBar: (range: PointColorRange) => PointColorRange,
  ) => (
    <RangePicker
      key={key}
      title={t(`adjustments.color.pointColor.${key}`)}
      startLabel={startLabel}
      endLabel={endLabel}
      gradient={gradient}
      value={toBar(point[key])}
      defaults={toBar(POINT_COLOR_RANGE_DEFAULTS[key])}
      onChange={(range) => updatePoint({ [key]: fromBar(range) })}
      onDragStateChange={onDragStateChange}
    />
  );

  return (
    <div className="space-y-3 compact:space-y-2">
      <div className="flex items-center gap-3 px-1">
        <div className="flex flex-wrap gap-3 flex-1">
          {points.map((p, index) => (
            <ColorSwatch
              key={p.id}
              color={pickedColorCss(p)}
              isActive={p.id === point.id}
              name={p.id}
              onClick={(id) => setEditor({ activePointColorId: id })}
              ariaLabel={t('adjustments.color.pointColor.ariaSelectPoint', { index: index + 1 })}
            />
          ))}
        </div>
        <button
          onClick={deletePoint}
          className="p-1.5 rounded-md hover:bg-bg-secondary text-text-secondary"
          data-tooltip={t('adjustments.color.pointColor.delete')}
        >
          <Trash2 size={16} />
        </button>
      </div>

      <div className="flex h-6 rounded-md overflow-hidden">
        <div className="flex-1" style={{ background: pickedColorCss(point) }} />
        <div className="flex-1" style={{ background: pickedColorCss(shiftedPickedColor(point)) }} />
      </div>

      <PickedColorField color={point} onChange={updatePoint} onDragStateChange={onDragStateChange} />

      <div>
        {renderShiftSlider('hueShift')}
        {renderShiftSlider('saturationShift')}
        {renderShiftSlider('luminanceShift')}
        <Slider
          label={t('adjustments.color.pointColor.variance')}
          min={0}
          max={100}
          step={1}
          defaultValue={DEFAULT_POINT_COLOR_VARIANCE}
          value={point.variance}
          onChange={(e: SliderChangeEvent) => updatePoint({ variance: Number(e.target.value) })}
          onDragStateChange={onDragStateChange}
          fillOrigin="min"
        />
      </div>

      {renderRange('hueRange', hueRangeGradient(point), '−60°', '+60°', hueRangeToBar, hueRangeFromBar)}
      {renderRange(
        'saturationRange',
        saturationRangeGradient(point),
        t('adjustments.color.pointColor.low'),
        t('adjustments.color.pointColor.high'),
        (range) => rangeToBar(range, point.saturation),
        (range) => rangeFromBar(range, point.saturation),
      )}
      {renderRange(
        'luminanceRange',
        luminanceRangeGradient(point),
        t('editor.masks.luminanceRange.dark'),
        t('editor.masks.luminanceRange.light'),
        (range) => rangeToBar(range, point.luminance),
        (range) => rangeFromBar(range, point.luminance),
      )}

      <Switch
        checked={isVisualized}
        label={t('adjustments.color.pointColor.visualize')}
        onChange={(checked: boolean) => setEditor({ isPointColorRangeVisualized: checked })}
      />
    </div>
  );
}
