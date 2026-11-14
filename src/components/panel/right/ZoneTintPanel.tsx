import { MouseEvent, useCallback, useState } from 'react';
import { Eye, EyeOff, RotateCcw, X } from 'lucide-react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import PanelHeader from '../../ui/PanelHeader';
import Button from '../../ui/Button';
import ColorWheel from '../../ui/ColorWheel';
import Dropdown from '../../ui/Dropdown';
import Slider from '../../ui/Slider';
import Text from '../../ui/Text';
import { TextColors, TextVariants } from '../../../types/typography';
import { useEditorStore } from '../../../store/useEditorStore';
import { useEditorActions } from '../../../hooks/useEditorActions';
import {
  BlendPadCurve,
  HueSatLum,
  INITIAL_ADJUSTMENTS,
  ZONE_TINT_AMOUNT,
  ZONE_TINT_PROTECT,
  ZONE_TINT_SOFTNESS,
  ZONE_TINT_ZONE_COUNT,
  ZoneTint,
  ZoneTintZone,
  createZoneTint,
} from '../../../utils/adjustments';
import { BLEND_PAD_CURVES, applyBlendPadCurve } from '../../../utils/blendPad';

const ZONE_NAMES = ['0', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
const MIDDLE_GREY_ZONE = 5;
/** Softness and Protect are OKLab L values, Amount a factor; the sliders show them ×100. */
const SLIDER_SCALE = 100;
const NEUTRAL: HueSatLum = { hue: 0, saturation: 0, luminance: 0 };
const NEUTRAL_ZONE: ZoneTintZone = { hue: 0, strength: 0, luminance: 0 };
/** `zone_tint::MAX_LUMINANCE_SHIFT`: luminance ±100 moves a zone's tones by half a zone. */
const MAX_LUMINANCE_SHIFT = 0.05;

const luminanceOf = (zone: ZoneTintZone) => zone.luminance ?? 0;

/**
 * The display grey of a zone's centre after its luminance: OKLab L = n / 10 (plus the shift) is
 * linear luminance L³.
 */
const zoneGrey = (zone: number, luminance: number) => {
  const l = Math.min(Math.max(zone / (ZONE_TINT_ZONE_COUNT - 1) + (luminance / 100) * MAX_LUMINANCE_SHIFT, 0), 1);
  const linear = l ** 3;
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

const zoneRange = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, index) => from + index);

/** The selection as its first and last zone when it is one unbroken range with zones between them. */
const fillableRange = (selected: number[]): [number, number] | null => {
  const from = selected[0];
  const to = selected[selected.length - 1];
  return selected.length >= 3 && to - from === selected.length - 1 ? [from, to] : null;
};

/** A zone's tint as a point on the colour wheel: the hue's direction, the strength's length. */
const tintVector = ({ hue, strength }: ZoneTintZone) => {
  const angle = (hue * Math.PI) / 180;
  return [strength * Math.cos(angle), strength * Math.sin(angle)];
};

/**
 * Fills the zones strictly between `from` and `to` along the curve, blending one end's tint
 * into the other's on the colour wheel, as the shader sums the zones' colours, and its
 * luminance into the other's. Opposite hues (cool shadows, warm highlights) meet in a soft
 * neutral instead of sweeping through the hues between them, and an untinted end fades the
 * other end's colour out without changing its hue.
 */
const fillZones = (zones: ZoneTintZone[], from: number, to: number, curve: BlendPadCurve): ZoneTintZone[] => {
  const start = zones[from] ?? NEUTRAL_ZONE;
  const end = zones[to] ?? NEUTRAL_ZONE;
  const [startX, startY] = tintVector(start);
  const [endX, endY] = tintVector(end);
  return Array.from({ length: ZONE_TINT_ZONE_COUNT }, (_, zone) => {
    const existing = zones[zone] ?? NEUTRAL_ZONE;
    if (zone <= from || zone >= to) return existing;
    const share = applyBlendPadCurve(curve, (zone - from) / (to - from));
    const x = startX + (endX - startX) * share;
    const y = startY + (endY - startY) * share;
    const strength = Math.hypot(x, y);
    const hue = strength > 1e-6 ? ((((Math.atan2(y, x) * 180) / Math.PI) % 360) + 360) % 360 : existing.hue;
    const luminance = luminanceOf(start) + (luminanceOf(end) - luminanceOf(start)) * share;
    return { ...existing, hue, strength, luminance };
  });
};

/** Neighbouring zones that share one setting. */
interface ZoneRun {
  from: number;
  to: number;
  hue: number;
  strength: number;
  luminance: number;
}

/**
 * The zones with a colour or a luminance shift, neighbours with the same settings joined,
 * lightest first like the scale.
 */
const zoneRuns = (zoneTint: ZoneTint): ZoneRun[] => {
  const runs: ZoneRun[] = [];
  for (let zone = 0; zone < ZONE_TINT_ZONE_COUNT; zone += 1) {
    const settings = zoneTint.zones[zone] ?? NEUTRAL_ZONE;
    const { hue, strength } = settings;
    const luminance = luminanceOf(settings);
    if (strength <= 0 && luminance === 0) continue;
    const last = runs[runs.length - 1];
    const isSame =
      last &&
      last.to === zone - 1 &&
      last.strength === strength &&
      last.luminance === luminance &&
      (strength <= 0 || last.hue === hue);
    if (isSame) last.to = zone;
    else runs.push({ from: zone, to: zone, hue, strength, luminance });
  }
  return runs.reverse();
};

interface ZoneScaleProps {
  onZoneClick(zone: number, event: MouseEvent): void;
  selected: number[];
  zoneTint: ZoneTint;
}

/**
 * The eleven zones as an upright grey scale, X at the top: names on the left, the selection
 * marked beside them, each zone's tint as a band on the scale's right edge.
 */
function ZoneScale({ onZoneClick, selected, zoneTint }: ZoneScaleProps) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col-reverse shrink-0">
      {ZONE_NAMES.map((name, zone) => {
        const settings = zoneTint.zones[zone] ?? NEUTRAL_ZONE;
        const { hue, strength } = settings;
        const isSelected = selected.includes(zone);
        return (
          <button
            aria-label={t('adjustments.zoneTint.zone', { zone: name })}
            aria-pressed={isSelected}
            className="group flex items-stretch gap-1.5 h-5 compact:h-[18px] focus:outline-none"
            key={name}
            onClick={(event) => onZoneClick(zone, event)}
          >
            <span
              className={clsx(
                'w-8 self-center text-right text-[11px] leading-none select-none transition-colors',
                isSelected ? 'text-text-primary font-semibold' : 'text-text-secondary group-hover:text-text-primary',
              )}
            >
              {name}
            </span>
            <span className={clsx('w-0.5 transition-colors', isSelected ? 'bg-accent' : 'bg-transparent')} />
            <span
              className={clsx(
                'relative w-10 overflow-hidden',
                zone === 0 && 'rounded-b-md',
                zone === ZONE_NAMES.length - 1 && 'rounded-t-md',
                zone > 0 && 'border-b border-white/5',
              )}
              style={{ backgroundColor: zoneGrey(zone, luminanceOf(settings)) }}
            >
              {strength > 0 && (
                <span
                  className="absolute inset-y-0 right-0 w-2.5"
                  style={{ backgroundColor: tintColor(hue, strength) }}
                />
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * Zone Tint: a colour per Zone System zone (`zone_tint.rs`), toning a Black & White photo or
 * grading a colour one by tonal zone.
 */
export default function ZoneTintPanel() {
  const { t } = useTranslation();
  const { setAdjustments } = useEditorActions();
  const { storedZoneTint, sectionVisibility, setEditor } = useEditorStore(
    useShallow((state) => ({
      storedZoneTint: state.adjustments.zoneTint,
      sectionVisibility: state.adjustments.sectionVisibility ?? INITIAL_ADJUSTMENTS.sectionVisibility,
      setEditor: state.setEditor,
    })),
  );
  const [selected, setSelected] = useState<number[]>([MIDDLE_GREY_ZONE]);
  const [anchor, setAnchor] = useState(MIDDLE_GREY_ZONE);
  const [fillCurve, setFillCurve] = useState<BlendPadCurve>('linear');

  const title = t('editor.adjustments.sections.zoneTint');
  const isVisible = sectionVisibility.zoneTint;
  const zoneTint = storedZoneTint ?? createZoneTint();
  const shown = zoneTint.zones[anchor] ?? NEUTRAL_ZONE;

  const updateZoneTint = (update: (current: ZoneTint) => ZoneTint, historyLabel?: string) =>
    setAdjustments((prev) => ({ ...prev, zoneTint: update(prev.zoneTint ?? createZoneTint()) }), historyLabel);

  /** Writes the given settings into the given zones, keeping their others. */
  const updateZones = (zones: number[], change: Partial<ZoneTintZone>, historyLabel?: string) =>
    updateZoneTint(
      (current) => ({
        ...current,
        zones: Array.from({ length: ZONE_TINT_ZONE_COUNT }, (_, zone) => {
          const existing = current.zones[zone] ?? NEUTRAL_ZONE;
          return zones.includes(zone) ? { ...existing, ...change } : existing;
        }),
      }),
      historyLabel,
    );

  const handleDragStateChange = useCallback(
    (isDragging: boolean) => setEditor({ isSliderDragging: isDragging }),
    [setEditor],
  );

  /**
   * Writes only what the wheel changed, so moving the hue of a range keeps each zone's own
   * strength and luminance (and the other way round).
   */
  const handleColorChange = ({ hue, saturation, luminance }: HueSatLum) => {
    const change: Partial<ZoneTintZone> = {};
    if (hue !== shown.hue) change.hue = hue;
    if (saturation !== shown.strength) change.strength = saturation;
    if (luminance !== luminanceOf(shown)) change.luminance = luminance;
    if (Object.keys(change).length > 0) updateZones(selected, change);
  };

  const handleZoneClick = (zone: number, event: MouseEvent) => {
    setSelected(nextSelection(selected, anchor, zone, event));
    if (!event.shiftKey) setAnchor(zone);
  };

  const selectRun = ({ from, to }: ZoneRun) => {
    setSelected(zoneRange(from, to));
    setAnchor(from);
  };

  const zonesLabel = (zones: number[]) =>
    zones.length === 1
      ? t('adjustments.zoneTint.zone', { zone: ZONE_NAMES[zones[0]] })
      : t('adjustments.zoneTint.zones', { zones: formatZones(zones) });

  const fillRange = fillableRange(selected);
  const curveOptions = BLEND_PAD_CURVES.map((curve) => ({ label: t(`editor.blendPad.curves.${curve}`), value: curve }));
  const handleFill = () => {
    if (!fillRange) return;
    updateZoneTint(
      (current) => ({ ...current, zones: fillZones(current.zones, ...fillRange, fillCurve) }),
      t('adjustments.zoneTint.fill'),
    );
  };

  const runs = zoneRuns(zoneTint);
  const isSelectedRun = ({ from, to }: ZoneRun) =>
    selected.length === to - from + 1 && selected[0] === from && selected[selected.length - 1] === to;

  const handleToggleVisibility = () =>
    setAdjustments((prev) => {
      const visibility = prev.sectionVisibility ?? INITIAL_ADJUSTMENTS.sectionVisibility;
      return { ...prev, sectionVisibility: { ...visibility, zoneTint: !visibility.zoneTint } };
    });

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
        <div className={clsx('flex flex-col gap-4 compact:gap-3 transition-opacity', !isVisible && 'opacity-40')}>
          <div className="flex items-center gap-3">
            <ZoneScale onZoneClick={handleZoneClick} selected={selected} zoneTint={zoneTint} />
            <div className="grow min-w-0 max-w-60">
              <ColorWheel
                defaultValue={NEUTRAL}
                label={zonesLabel(selected)}
                onChange={handleColorChange}
                onDragStateChange={handleDragStateChange}
                value={{ hue: shown.hue, saturation: shown.strength, luminance: luminanceOf(shown) }}
              />
            </div>
          </div>
          <Text variant={TextVariants.small} color={TextColors.secondary} className="block">
            {t('adjustments.zoneTint.hint')}
          </Text>

          <div className="flex items-center gap-2" data-tooltip={t('adjustments.zoneTint.fillHint')}>
            <Dropdown
              className="grow min-w-0"
              onChange={(curve: BlendPadCurve) => setFillCurve(curve)}
              options={curveOptions}
              value={fillCurve}
            />
            <Button className="bg-surface text-text-primary shrink-0" disabled={!fillRange} onClick={handleFill}>
              {t('adjustments.zoneTint.fill')}
            </Button>
          </div>

          <div className="flex flex-col gap-2">
            <Slider
              defaultValue={ZONE_TINT_AMOUNT.default * SLIDER_SCALE}
              fillOrigin="min"
              label={t('adjustments.effects.amount')}
              max={ZONE_TINT_AMOUNT.max * SLIDER_SCALE}
              min={ZONE_TINT_AMOUNT.min * SLIDER_SCALE}
              onChange={(event) =>
                updateZoneTint((current) => ({ ...current, amount: Number(event.target.value) / SLIDER_SCALE }))
              }
              onDragStateChange={handleDragStateChange}
              step={1}
              value={Math.round((zoneTint.amount ?? ZONE_TINT_AMOUNT.default) * SLIDER_SCALE)}
            />
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

          {runs.length > 0 && (
            <div className="flex flex-col gap-1">
              <Text variant={TextVariants.label} color={TextColors.secondary}>
                {t('adjustments.zoneTint.tintedZones')}
              </Text>
              {runs.map((run) => (
                <div
                  className={clsx(
                    'flex items-center gap-1 rounded-md transition-colors',
                    isSelectedRun(run) ? 'bg-surface' : 'hover:bg-surface',
                  )}
                  key={run.from}
                >
                  <button
                    className="grow min-w-0 flex items-center gap-2 px-2 py-1.5 text-left"
                    onClick={() => selectRun(run)}
                  >
                    <span
                      className="w-3 h-3 shrink-0 rounded-full border border-white/20"
                      style={{
                        backgroundColor:
                          run.strength > 0 ? tintColor(run.hue, run.strength) : zoneGrey(run.from, run.luminance),
                      }}
                    />
                    <Text variant={TextVariants.small} className="grow truncate">
                      {zonesLabel(zoneRange(run.from, run.to))}
                    </Text>
                    <Text
                      variant={TextVariants.small}
                      color={TextColors.secondary}
                      className="flex items-center gap-2 tabular-nums"
                    >
                      {run.strength > 0 && (
                        <>
                          <span>
                            <span className="font-bold">{t('ui.colorWheel.hueAbbreviation')}</span>{' '}
                            {Math.round(run.hue)}&deg;
                          </span>
                          <span>
                            <span className="font-bold">{t('ui.colorWheel.saturationAbbreviation')}</span>{' '}
                            {Math.round(run.strength)}
                          </span>
                        </>
                      )}
                      {run.luminance !== 0 && (
                        <span>
                          <span className="font-bold">{t('ui.colorWheel.luminanceAbbreviation')}</span>{' '}
                          {run.luminance > 0 ? '+' : ''}
                          {Math.round(run.luminance)}
                        </span>
                      )}
                    </Text>
                  </button>
                  <button
                    className="p-1.5 mr-0.5 rounded-full text-text-secondary hover:text-text-primary hover:bg-bg-primary transition-colors"
                    data-tooltip={t('adjustments.zoneTint.untint')}
                    onClick={() =>
                      updateZones(
                        zoneRange(run.from, run.to),
                        { hue: 0, strength: 0, luminance: 0 },
                        t('adjustments.zoneTint.untint'),
                      )
                    }
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
