import { MouseEvent, useState } from 'react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import ColorWheel from '../ui/ColorWheel';
import Slider from '../ui/Slider';
import Text from '../ui/Text';
import { TextColors, TextVariants } from '../../types/typography';
import {
  Adjustments,
  HueSatLum,
  ZONE_TINT_PROTECT,
  ZONE_TINT_SOFTNESS,
  ZONE_TINT_ZONE_COUNT,
  ZoneTint,
  createZoneTint,
} from '../../utils/adjustments';

const ZONE_NAMES = ['0', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
const MIDDLE_GREY_ZONE = 5;
/** Softness and Protect are OKLab L values; the sliders show them ×100. */
const SLIDER_SCALE = 100;
const NEUTRAL: HueSatLum = { hue: 0, saturation: 0, luminance: 0 };
const NEUTRAL_ZONE = { hue: 0, strength: 0 };

/** The display grey of a zone's centre: OKLab L = n / 10 is linear luminance L³. */
const zoneGrey = (zone: number) => {
  const linear = (zone / (ZONE_TINT_ZONE_COUNT - 1)) ** 3;
  const display = linear <= 0.0031308 ? linear * 12.92 : 1.055 * linear ** (1 / 2.4) - 0.055;
  const level = Math.round(display * 255);
  return `rgb(${level}, ${level}, ${level})`;
};

/** The zones a click selects: Shift adds the range from the anchor, Cmd/Ctrl toggles one zone. */
const nextSelection = (selected: number[], anchor: number, zone: number, event: MouseEvent) => {
  if (event.shiftKey) {
    const [from, to] = anchor <= zone ? [anchor, zone] : [zone, anchor];
    return Array.from({ length: to - from + 1 }, (_, index) => from + index);
  }
  if (event.metaKey || event.ctrlKey) {
    const toggled = selected.includes(zone) ? selected.filter((z) => z !== zone) : [...selected, zone];
    return toggled.length > 0 ? toggled.sort((a, b) => a - b) : selected;
  }
  return [zone];
};

interface ZoneTintPanelProps {
  adjustments: Adjustments;
  setAdjustments(adjustments: Partial<Adjustments> | ((prev: Adjustments) => Partial<Adjustments>)): void;
  onDragStateChange?(isDragging: boolean): void;
}

/** Zone Tint: a colour per Zone System zone of a Black & White photo (`zone_tint.rs`). */
export default function ZoneTintPanel({ adjustments, setAdjustments, onDragStateChange }: ZoneTintPanelProps) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<number[]>([MIDDLE_GREY_ZONE]);
  const [anchor, setAnchor] = useState(MIDDLE_GREY_ZONE);

  if (!adjustments.monochrome) {
    return (
      <Text variant={TextVariants.small} color={TextColors.secondary} className="block">
        {t('adjustments.zoneTint.needsBlackAndWhite')}
      </Text>
    );
  }

  const zoneTint = adjustments.zoneTint ?? createZoneTint();
  const zoneAt = (zone: number) => zoneTint.zones[zone] ?? NEUTRAL_ZONE;
  const shown = zoneAt(anchor);

  const updateZoneTint = (update: (current: ZoneTint) => ZoneTint) =>
    setAdjustments((prev: Adjustments) => ({ ...prev, zoneTint: update(prev.zoneTint ?? createZoneTint()) }));

  const handleColorChange = ({ hue, saturation }: HueSatLum) =>
    updateZoneTint((current) => ({
      ...current,
      zones: Array.from({ length: ZONE_TINT_ZONE_COUNT }, (_, zone) => {
        const existing = current.zones[zone] ?? NEUTRAL_ZONE;
        return selected.includes(zone) ? { ...existing, hue, strength: saturation } : existing;
      }),
    }));

  const handleZoneClick = (zone: number, event: MouseEvent) => {
    setSelected(nextSelection(selected, anchor, zone, event));
    if (!event.shiftKey) setAnchor(zone);
  };

  const label =
    selected.length === 1
      ? t('adjustments.zoneTint.zone', { zone: ZONE_NAMES[selected[0]] })
      : t('adjustments.zoneTint.zones', { zones: selected.map((zone) => ZONE_NAMES[zone]).join(', ') });

  return (
    <div className="flex flex-col gap-3 compact:gap-2">
      <div className="flex gap-0.5">
        {ZONE_NAMES.map((name, zone) => {
          const { hue, strength } = zoneAt(zone);
          return (
            <button
              key={name}
              aria-pressed={selected.includes(zone)}
              className={clsx(
                'relative flex-1 h-9 rounded-sm flex items-end justify-center pb-0.5 transition-shadow',
                selected.includes(zone) ? 'ring-2 ring-accent' : 'ring-1 ring-surface hover:ring-text-secondary',
              )}
              data-tooltip={t('adjustments.zoneTint.zone', { zone: name })}
              onClick={(event) => handleZoneClick(zone, event)}
              style={{ backgroundColor: zoneGrey(zone) }}
            >
              {strength > 0 && (
                <span
                  className="absolute top-1 w-2 h-2 rounded-full border border-white/70"
                  style={{ backgroundColor: `hsl(${hue}, 100%, 50%)`, opacity: 0.35 + (0.65 * strength) / 100 }}
                />
              )}
              <span
                className="text-[9px] leading-none select-none"
                style={{ color: zone < MIDDLE_GREY_ZONE ? '#ddd' : '#222' }}
              >
                {name}
              </span>
            </button>
          );
        })}
      </div>
      <Text variant={TextVariants.small} color={TextColors.secondary} className="block">
        {t('adjustments.zoneTint.hint')}
      </Text>

      <div className="w-full max-w-60 self-center">
        <ColorWheel
          defaultValue={NEUTRAL}
          label={label}
          onChange={handleColorChange}
          onDragStateChange={onDragStateChange}
          showLuminance={false}
          value={{ hue: shown.hue, saturation: shown.strength, luminance: 0 }}
        />
      </div>

      <Slider
        defaultValue={ZONE_TINT_SOFTNESS.default * SLIDER_SCALE}
        label={t('adjustments.zoneTint.softness')}
        max={ZONE_TINT_SOFTNESS.max * SLIDER_SCALE}
        min={ZONE_TINT_SOFTNESS.min * SLIDER_SCALE}
        onChange={(event) =>
          updateZoneTint((current) => ({ ...current, softness: Number(event.target.value) / SLIDER_SCALE }))
        }
        onDragStateChange={onDragStateChange}
        step={0.1}
        value={zoneTint.softness * SLIDER_SCALE}
      />
      <Slider
        defaultValue={ZONE_TINT_PROTECT.default * SLIDER_SCALE}
        label={t('adjustments.zoneTint.protect')}
        max={ZONE_TINT_PROTECT.max * SLIDER_SCALE}
        min={ZONE_TINT_PROTECT.min * SLIDER_SCALE}
        onChange={(event) =>
          updateZoneTint((current) => ({ ...current, protect: Number(event.target.value) / SLIDER_SCALE }))
        }
        onDragStateChange={onDragStateChange}
        step={0.5}
        value={zoneTint.protect * SLIDER_SCALE}
      />
    </div>
  );
}
