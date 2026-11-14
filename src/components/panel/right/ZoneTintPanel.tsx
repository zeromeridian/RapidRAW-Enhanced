import { MouseEvent, useCallback, useState } from 'react';
import { Eye, EyeOff, RotateCcw } from 'lucide-react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import PanelHeader from '../../ui/PanelHeader';
import ColorWheel from '../../ui/ColorWheel';
import Slider from '../../ui/Slider';
import Switch from '../../ui/Switch';
import Text from '../../ui/Text';
import { TextColors, TextVariants } from '../../../types/typography';
import { useEditorStore } from '../../../store/useEditorStore';
import { useEditorActions } from '../../../hooks/useEditorActions';
import {
  HueSatLum,
  INITIAL_ADJUSTMENTS,
  ZONE_TINT_PROTECT,
  ZONE_TINT_SOFTNESS,
  ZONE_TINT_ZONE_COUNT,
  ZoneTint,
  createZoneTint,
} from '../../../utils/adjustments';

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

/** The wheel colour of a zone's tint, fainter for a weaker tint. */
const tintColor = (hue: number, strength: number) => `hsl(${hue} 100% 50% / ${0.35 + (0.65 * strength) / 100})`;

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

/** Sorted zones as their names, with neighbouring zones joined into ranges: "II, IV–VII". */
const formatZones = (zones: number[]) => {
  const runs: Array<[number, number]> = [];
  zones.forEach((zone) => {
    const last = runs[runs.length - 1];
    if (last && zone === last[1] + 1) last[1] = zone;
    else runs.push([zone, zone]);
  });
  return runs
    .map(([from, to]) => (from === to ? ZONE_NAMES[from] : `${ZONE_NAMES[from]}–${ZONE_NAMES[to]}`))
    .join(', ');
};

interface ZoneStripProps {
  onZoneClick(zone: number, event: MouseEvent): void;
  selected: number[];
  zoneTint: ZoneTint;
}

/** The eleven zones as one grey ramp: a tint band on top, the selection marked beneath. */
function ZoneStrip({ onZoneClick, selected, zoneTint }: ZoneStripProps) {
  const { t } = useTranslation();

  return (
    <div className="flex">
      {ZONE_NAMES.map((name, zone) => {
        const { hue, strength } = zoneTint.zones[zone] ?? NEUTRAL_ZONE;
        const isSelected = selected.includes(zone);
        return (
          <button
            aria-label={t('adjustments.zoneTint.zone', { zone: name })}
            aria-pressed={isSelected}
            className="group flex-1 min-w-0 flex flex-col items-stretch gap-1 focus:outline-none"
            key={name}
            onClick={(event) => onZoneClick(zone, event)}
          >
            <span
              className={clsx(
                'relative h-8 compact:h-7 overflow-hidden',
                zone === 0 && 'rounded-l-md',
                zone === ZONE_NAMES.length - 1 && 'rounded-r-md',
                zone > 0 && 'border-l border-white/5',
              )}
              style={{ backgroundColor: zoneGrey(zone) }}
            >
              {strength > 0 && (
                <span className="absolute inset-x-0 top-0 h-2" style={{ backgroundColor: tintColor(hue, strength) }} />
              )}
            </span>
            <span className={clsx('h-0.5 transition-colors', isSelected ? 'bg-accent' : 'bg-transparent')} />
            <span
              className={clsx(
                'text-[10px] leading-none text-center select-none transition-colors tabular-nums',
                isSelected ? 'text-text-primary font-semibold' : 'text-text-secondary group-hover:text-text-primary',
              )}
            >
              {name}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Zone Tint: a colour per Zone System zone of a Black & White photo (`zone_tint.rs`). */
export default function ZoneTintPanel() {
  const { t } = useTranslation();
  const { setAdjustments } = useEditorActions();
  const { monochrome, storedZoneTint, sectionVisibility, setEditor } = useEditorStore(
    useShallow((state) => ({
      monochrome: !!state.adjustments.monochrome,
      storedZoneTint: state.adjustments.zoneTint,
      sectionVisibility: state.adjustments.sectionVisibility ?? INITIAL_ADJUSTMENTS.sectionVisibility,
      setEditor: state.setEditor,
    })),
  );
  const [selected, setSelected] = useState<number[]>([MIDDLE_GREY_ZONE]);
  const [anchor, setAnchor] = useState(MIDDLE_GREY_ZONE);

  const title = t('editor.adjustments.sections.zoneTint');
  const isVisible = sectionVisibility.zoneTint;
  const zoneTint = storedZoneTint ?? createZoneTint();
  const shown = zoneTint.zones[anchor] ?? NEUTRAL_ZONE;

  const updateZoneTint = (update: (current: ZoneTint) => ZoneTint) =>
    setAdjustments((prev) => ({ ...prev, zoneTint: update(prev.zoneTint ?? createZoneTint()) }));

  const handleDragStateChange = useCallback(
    (isDragging: boolean) => setEditor({ isSliderDragging: isDragging }),
    [setEditor],
  );

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

  const handleToggleVisibility = () =>
    setAdjustments((prev) => {
      const visibility = prev.sectionVisibility ?? INITIAL_ADJUSTMENTS.sectionVisibility;
      return { ...prev, sectionVisibility: { ...visibility, zoneTint: !visibility.zoneTint } };
    });

  const label =
    selected.length === 1
      ? t('adjustments.zoneTint.zone', { zone: ZONE_NAMES[selected[0]] })
      : t('adjustments.zoneTint.zones', { zones: formatZones(selected) });

  return (
    <div className="flex flex-col h-full">
      <PanelHeader
        title={title}
        actions={
          <>
            <button
              className="p-2 rounded-full hover:bg-surface transition-colors"
              data-tooltip={
                isVisible ? t('ui.collapsibleSection.disableSection') : t('ui.collapsibleSection.enableSection')
              }
              onClick={handleToggleVisibility}
            >
              {isVisible ? <Eye size={18} /> : <EyeOff size={18} />}
            </button>
            <button
              className="p-2 rounded-full hover:bg-surface transition-colors disabled:opacity-40 disabled:hover:bg-transparent"
              data-tooltip={t('editor.adjustments.actions.resetSectionSettings', { section: title })}
              disabled={!storedZoneTint}
              onClick={() =>
                setAdjustments(
                  (prev) => ({ ...prev, zoneTint: null }),
                  t('editor.adjustments.actions.resetSectionSettings', { section: title }),
                )
              }
            >
              <RotateCcw size={18} />
            </button>
          </>
        }
      />
      <div className="grow overflow-y-auto p-4 compact:p-3 flex flex-col gap-4 compact:gap-3">
        {!monochrome ? (
          <>
            <Text variant={TextVariants.small} color={TextColors.secondary} className="block">
              {t('adjustments.zoneTint.needsBlackAndWhite')}
            </Text>
            <Switch
              checked={false}
              label={t('adjustments.color.blackAndWhite')}
              onChange={() => setAdjustments((prev) => ({ ...prev, monochrome: true }))}
            />
          </>
        ) : (
          <div className={clsx('flex flex-col gap-4 compact:gap-3 transition-opacity', !isVisible && 'opacity-40')}>
            <div className="flex flex-col gap-2">
              <ZoneStrip onZoneClick={handleZoneClick} selected={selected} zoneTint={zoneTint} />
              <Text variant={TextVariants.small} color={TextColors.secondary} className="block">
                {t('adjustments.zoneTint.hint')}
              </Text>
            </div>

            <div className="w-full max-w-60 self-center">
              <ColorWheel
                defaultValue={NEUTRAL}
                label={label}
                onChange={handleColorChange}
                onDragStateChange={handleDragStateChange}
                showLuminance={false}
                value={{ hue: shown.hue, saturation: shown.strength, luminance: 0 }}
              />
            </div>

            <div className="flex flex-col gap-2">
              <Slider
                defaultValue={ZONE_TINT_SOFTNESS.default * SLIDER_SCALE}
                label={t('adjustments.zoneTint.softness')}
                max={ZONE_TINT_SOFTNESS.max * SLIDER_SCALE}
                min={ZONE_TINT_SOFTNESS.min * SLIDER_SCALE}
                onChange={(event) =>
                  updateZoneTint((current) => ({ ...current, softness: Number(event.target.value) / SLIDER_SCALE }))
                }
                onDragStateChange={handleDragStateChange}
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
                onDragStateChange={handleDragStateChange}
                step={0.5}
                value={zoneTint.protect * SLIDER_SCALE}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
