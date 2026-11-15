import { MouseEvent, useCallback, useEffect, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { Eye, EyeOff, Layers, Pipette, RotateCcw, SquareDashedMousePointer, X } from 'lucide-react';
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
import { canvasToolState, useEditorStore } from '../../../store/useEditorStore';
import { useSettingsStore } from '../../../store/useSettingsStore';
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
  ZoneTintGrade,
  ZoneTintZone,
  createZoneTint,
} from '../../../utils/adjustments';
import { BLEND_PAD_CURVES } from '../../../utils/blendPad';
import {
  NEUTRAL_ZONE,
  ZONE_NAMES,
  ZoneSelection,
  fillGrades,
  gradeSelection,
  gradeZones,
  isGradeShown,
  isUniformGrade,
  luminanceOf,
  nextZoneSelection,
  overlappingZones,
  setGradeShown,
  updateGrade,
  withZoneTintGrades,
  zoneTintGrades,
} from '../../../utils/zoneTint';

/** Softness and Protect are OKLab L values, Amount a factor; the sliders show them ×100. */
const SLIDER_SCALE = 100;
const NEUTRAL: HueSatLum = { hue: 0, saturation: 0, luminance: 0 };
/** `zone_tint::MAX_LUMINANCE_SHIFT`: luminance ±100 moves a zone's tones by half a zone. */
const MAX_LUMINANCE_SHIFT = 0.05;

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

/** A grade's colour in one zone: its tint, or for a luminance-only grade the zone's grey. */
const gradeZoneColor = (settings: ZoneTintZone, zone: number) =>
  settings.strength > 0 ? tintColor(settings.hue, settings.strength) : zoneGrey(zone, luminanceOf(settings));

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

/** The selection as its first and last zone when it is one unbroken range with zones between them. */
const fillableRange = (selected: number[]): [number, number] | null => {
  const from = selected[0];
  const to = selected[selected.length - 1];
  return selected.length >= 3 && to - from === selected.length - 1 ? [from, to] : null;
};

/** The grades, lightest first like the scale. */
const byLightestZone = (grades: ZoneTintGrade[]) =>
  [...grades].sort((a, b) => Math.max(...gradeZones(b)) - Math.max(...gradeZones(a)));

interface ZoneScaleProps {
  grades: ZoneTintGrade[];
  /** The zone under the cursor on the photo (the hover readout), or null. */
  hovered: number | null;
  onZoneClick(zone: number, event: MouseEvent): void;
  /** The pointer entered a zone (its zones, for the Alt/Option mask preview) or left it (null). */
  onPreviewTarget(zones: number[] | null): void;
  selected: number[];
  zoneTint: ZoneTint;
}

/**
 * The eleven zones as an upright grey scale, X at the top: names on the left, the selection
 * marked beside them, each zone's grades as bands on the scale's right edge, side by side (and
 * flagged) where shown grades overlap; a hidden grade's band is faded. The zone under the
 * cursor on the photo is outlined and its name lit.
 */
function ZoneScale({ grades, hovered, onZoneClick, onPreviewTarget, selected, zoneTint }: ZoneScaleProps) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col-reverse shrink-0">
      {ZONE_NAMES.map((name, zone) => {
        const combined = zoneTint.zones[zone] ?? NEUTRAL_ZONE;
        const bands = grades.flatMap((grade) => {
          const settings = grade.zones[zone];
          return settings && (settings.strength > 0 || luminanceOf(settings) !== 0)
            ? [{ id: grade.id, color: gradeZoneColor(settings, zone), isShown: isGradeShown(grade) }]
            : [];
        });
        const shownCount = bands.filter((band) => band.isShown).length;
        const isOverlap = shownCount > 1;
        const isSideBySide = bands.length > 1;
        const isSelected = selected.includes(zone);
        const isHovered = hovered === zone;
        return (
          <button
            aria-label={t('adjustments.zoneTint.zone', { zone: name })}
            aria-pressed={isSelected}
            className="group flex items-stretch gap-1.5 h-5 compact:h-[18px] focus:outline-none"
            data-tooltip={isOverlap ? t('adjustments.zoneTint.overlapCount', { count: shownCount }) : undefined}
            key={name}
            onClick={(event) => onZoneClick(zone, event)}
            onPointerEnter={() => onPreviewTarget([zone])}
            onPointerLeave={() => onPreviewTarget(null)}
          >
            <span
              className={clsx(
                'w-8 self-center text-right text-[11px] leading-none select-none transition-colors',
                isSelected ? 'text-text-primary font-semibold' : 'text-text-secondary group-hover:text-text-primary',
                isHovered && 'text-text-primary',
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
              style={{ backgroundColor: zoneGrey(zone, luminanceOf(combined)) }}
            >
              {bands.length > 0 && (
                <span className="absolute inset-y-0 right-0 flex">
                  {bands.map((band) => (
                    <span
                      className={clsx(isSideBySide ? 'w-1.5' : 'w-2.5', !band.isShown && 'opacity-30')}
                      key={band.id}
                      style={{ backgroundColor: band.color }}
                    />
                  ))}
                </span>
              )}
              {isHovered && (
                <span className="absolute inset-0 border-2 border-accent pointer-events-none rounded-[inherit]" />
              )}
              {isOverlap && (
                <Layers
                  className="absolute left-0.5 top-1/2 -translate-y-1/2 text-white drop-shadow-[0_0_1px_rgba(0,0,0,0.9)]"
                  size={10}
                />
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** A grade's settings in the list: hue, strength and luminance, or "Gradient" for a Fill between ramp. */
function GradeValues({ grade }: { grade: ZoneTintGrade }) {
  const { t } = useTranslation();
  if (!isUniformGrade(grade)) return <span>{t('adjustments.zoneTint.gradient')}</span>;
  const settings = grade.zones[gradeZones(grade)[0]] ?? NEUTRAL_ZONE;
  const luminance = luminanceOf(settings);
  return (
    <>
      {settings.strength > 0 && (
        <>
          <span>
            <span className="font-bold">{t('ui.colorWheel.hueAbbreviation')}</span> {Math.round(settings.hue)}&deg;
          </span>
          <span>
            <span className="font-bold">{t('ui.colorWheel.saturationAbbreviation')}</span>{' '}
            {Math.round(settings.strength)}
          </span>
        </>
      )}
      {luminance !== 0 && (
        <span>
          <span className="font-bold">{t('ui.colorWheel.luminanceAbbreviation')}</span> {luminance > 0 ? '+' : ''}
          {Math.round(luminance)}
        </span>
      )}
    </>
  );
}

/**
 * Zone Color Grading (internally Zone Tint): colours by Zone System zone (`zone_tint.rs`),
 * toning a Black & White photo or grading a colour one. Each coloured selection is a grade;
 * grades that share zones add up there.
 */
export default function ZoneTintPanel() {
  const { t } = useTranslation();
  const { setAdjustments } = useEditorActions();
  const { storedZoneTint, sectionVisibility, selection, hoveredZone, picker, setEditor } = useEditorStore(
    useShallow((state) => ({
      storedZoneTint: state.adjustments.zoneTint,
      hoveredZone: state.zoneTintHover?.zone ?? null,
      sectionVisibility: state.adjustments.sectionVisibility ?? INITIAL_ADJUSTMENTS.sectionVisibility,
      selection: state.zoneTintSelection,
      picker: state.targetedAdjustment?.tool === 'zoneTint' ? state.targetedAdjustment : null,
      setEditor: state.setEditor,
    })),
  );
  const { zones: selected, anchor } = selection;
  const setSelection = (zoneTintSelection: ZoneSelection) => setEditor({ zoneTintSelection });
  const [fillCurve, setFillCurve] = useState<BlendPadCurve>('linear');
  const osPlatform = useSettingsStore((state) => state.osPlatform);

  // Alt/Option mask preview (owner 2026-11-15): while Alt/Option is held over a zone on the
  // scale or a row of the Grades list, the photo shows where those zones colour it.
  const [previewTarget, setPreviewTarget] = useState<number[] | null>(null);
  const [isAltHeld, setIsAltHeld] = useState(false);
  useEffect(() => {
    const track = (e: KeyboardEvent | PointerEvent) => setIsAltHeld(e.altKey);
    const release = () => setIsAltHeld(false);
    window.addEventListener('keydown', track);
    window.addEventListener('keyup', track);
    window.addEventListener('pointermove', track);
    window.addEventListener('blur', release);
    return () => {
      window.removeEventListener('keydown', track);
      window.removeEventListener('keyup', track);
      window.removeEventListener('pointermove', track);
      window.removeEventListener('blur', release);
    };
  }, []);
  const previewZones = isAltHeld ? previewTarget : null;
  useEffect(() => {
    setEditor({ zoneTintPreviewZones: previewZones });
  }, [previewZones, setEditor]);
  useEffect(() => () => setEditor({ zoneTintPreviewZones: null }), [setEditor]);

  const title = t('editor.adjustments.sections.zoneTint');
  const isVisible = sectionVisibility.zoneTint;
  const zoneTint = storedZoneTint ?? createZoneTint();
  const grades = zoneTintGrades(zoneTint);
  const activeGrade = grades.find((grade) => grade.id === selection.gradeId) ?? null;
  // A selection that is not a grade yet shows neutral: moving the wheel creates its grade.
  const shown = activeGrade?.zones[anchor] ?? NEUTRAL_ZONE;

  const updateZoneTint = (update: (current: ZoneTint) => ZoneTint, historyLabel?: string) =>
    setAdjustments((prev) => ({ ...prev, zoneTint: update(prev.zoneTint ?? createZoneTint()) }), historyLabel);

  const updateGrades = (update: (current: ZoneTint) => ZoneTintGrade[], historyLabel?: string) =>
    updateZoneTint((current) => withZoneTintGrades(current, update(current)), historyLabel);

  const handleDragStateChange = useCallback(
    (isDragging: boolean) => setEditor({ isSliderDragging: isDragging }),
    [setEditor],
  );

  /**
   * Writes only what the wheel changed into the selected grade, so moving the hue keeps each
   * zone's own strength and luminance (and the other way round). A selection that is not a
   * grade yet becomes one.
   */
  const handleColorChange = ({ hue, saturation, luminance }: HueSatLum) => {
    const change: Partial<ZoneTintZone> = {};
    if (hue !== shown.hue) change.hue = hue;
    if (saturation !== shown.strength) change.strength = saturation;
    if (luminance !== luminanceOf(shown)) change.luminance = luminance;
    if (Object.keys(change).length === 0) return;
    // The store, not this render's copy, so every event of one drag edits the same new grade.
    const current = useEditorStore.getState().zoneTintSelection;
    const gradeId = current.gradeId ?? uuidv4();
    if (!current.gradeId) setSelection({ ...current, gradeId });
    updateGrades((zoneTintNow) => updateGrade(zoneTintGrades(zoneTintNow), gradeId, current.zones, change));
  };

  const handleZoneClick = (zone: number, event: MouseEvent) => setSelection(nextZoneSelection(selection, zone, event));

  const removeGrade = (grade: ZoneTintGrade) => {
    if (selection.gradeId === grade.id) setSelection({ ...selection, gradeId: null });
    updateGrades(
      (current) => zoneTintGrades(current).filter((g) => g.id !== grade.id),
      t('adjustments.zoneTint.removeGrade'),
    );
  };

  /** The grade's eye: one undo step, like the panel's own eye. */
  const toggleGradeShown = (grade: ZoneTintGrade) => {
    const isShown = !isGradeShown(grade);
    updateGrades(
      (current) => setGradeShown(zoneTintGrades(current), grade.id, isShown),
      t(isShown ? 'adjustments.zoneTint.showGrade' : 'adjustments.zoneTint.hideGrade'),
    );
  };

  /** Turns a picker on the photo on (`area`: the rectangle), or off when it is already on. */
  const togglePicker = (area: boolean) =>
    setEditor(canvasToolState(picker?.area === area ? {} : { targetedAdjustment: { tool: 'zoneTint', area } }));
  const pickerClassName = (isActive: boolean) =>
    clsx('p-2 rounded-full transition-colors', isActive ? 'bg-accent text-button-text' : 'hover:bg-surface');

  const zonesLabel = (zones: number[]) =>
    zones.length === 1
      ? t('adjustments.zoneTint.zone', { zone: ZONE_NAMES[zones[0]] })
      : t('adjustments.zoneTint.zones', { zones: formatZones(zones) });

  const fillRange = fillableRange(selected);
  const curveOptions = BLEND_PAD_CURVES.map((curve) => ({ label: t(`editor.blendPad.curves.${curve}`), value: curve }));
  const handleFill = () => {
    if (!fillRange) return;
    setSelection({ ...selection, gradeId: null });
    updateGrades((current) => fillGrades(current, ...fillRange, fillCurve), t('adjustments.zoneTint.fill'));
  };

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
              aria-pressed={picker?.area === false}
              className={pickerClassName(picker?.area === false)}
              data-tooltip={t('adjustments.zoneTint.pickPoint')}
              onClick={() => togglePicker(false)}
            >
              <Pipette size={18} />
            </button>
            <button
              aria-pressed={picker?.area === true}
              className={pickerClassName(picker?.area === true)}
              data-tooltip={t('adjustments.zoneTint.pickArea')}
              onClick={() => togglePicker(true)}
            >
              <SquareDashedMousePointer size={18} />
            </button>
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
              onClick={() => {
                setSelection({ ...selection, gradeId: null });
                setAdjustments(
                  (prev) => ({ ...prev, zoneTint: null }),
                  t('editor.adjustments.actions.resetSectionSettings', { section: title }),
                );
              }}
            >
              <RotateCcw size={18} />
            </button>
          </>
        }
      />
      <div className="grow overflow-y-auto p-4 compact:p-3 flex flex-col gap-4 compact:gap-3">
        <div className={clsx('flex flex-col gap-4 compact:gap-3 transition-opacity', !isVisible && 'opacity-40')}>
          <div className="flex items-center gap-3">
            <ZoneScale
              grades={grades}
              hovered={hoveredZone}
              onPreviewTarget={setPreviewTarget}
              onZoneClick={handleZoneClick}
              selected={selected}
              zoneTint={zoneTint}
            />
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
          <Text variant={TextVariants.small} color={TextColors.secondary} className="block">
            {t('adjustments.zoneTint.previewHint', { key: osPlatform === 'macos' ? 'Option' : 'Alt' })}
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

          {grades.length > 0 && (
            <div className="flex flex-col gap-1">
              <Text variant={TextVariants.label} color={TextColors.secondary}>
                {t('adjustments.zoneTint.grades')}
              </Text>
              {byLightestZone(grades).map((grade) => {
                const zones = gradeZones(grade);
                const overlap = overlappingZones(grade, grades);
                const first = grade.zones[zones[0]] ?? NEUTRAL_ZONE;
                const last = grade.zones[zones[zones.length - 1]] ?? NEUTRAL_ZONE;
                const isShown = isGradeShown(grade);
                const eyeLabel = t(isShown ? 'adjustments.zoneTint.hideGrade' : 'adjustments.zoneTint.showGrade');
                return (
                  <div
                    className={clsx(
                      'flex items-center gap-1 rounded-md transition-colors',
                      grade.id === activeGrade?.id ? 'bg-surface' : 'hover:bg-surface',
                    )}
                    key={grade.id}
                    onPointerEnter={() => setPreviewTarget(zones)}
                    onPointerLeave={() => setPreviewTarget(null)}
                  >
                    <button
                      className={clsx(
                        'grow min-w-0 flex items-center gap-2 px-2 py-1.5 text-left transition-opacity',
                        !isShown && 'opacity-40',
                      )}
                      onClick={() => setSelection(gradeSelection(grade))}
                    >
                      <span
                        className="w-3 h-3 shrink-0 rounded-full border border-white/20"
                        style={{
                          background: `linear-gradient(to top, ${gradeZoneColor(first, zones[0])}, ${gradeZoneColor(last, zones[zones.length - 1])})`,
                        }}
                      />
                      <span className="grow min-w-0 flex flex-col">
                        <Text variant={TextVariants.small} className="truncate">
                          {zonesLabel(zones)}
                        </Text>
                        {overlap.length > 0 && (
                          <Text
                            variant={TextVariants.small}
                            color={TextColors.secondary}
                            className="flex items-center gap-1 truncate"
                          >
                            <Layers className="shrink-0" size={11} />
                            {t('adjustments.zoneTint.overlaps', { zones: formatZones(overlap) })}
                          </Text>
                        )}
                      </span>
                      <Text
                        variant={TextVariants.small}
                        color={TextColors.secondary}
                        className="flex items-center gap-2 tabular-nums"
                      >
                        <GradeValues grade={grade} />
                      </Text>
                    </button>
                    <button
                      aria-label={eyeLabel}
                      aria-pressed={!isShown}
                      className="p-1.5 rounded-full text-text-secondary hover:text-text-primary hover:bg-bg-primary transition-colors"
                      data-tooltip={eyeLabel}
                      onClick={() => toggleGradeShown(grade)}
                    >
                      {isShown ? <Eye size={14} /> : <EyeOff size={14} />}
                    </button>
                    <button
                      className="p-1.5 mr-0.5 rounded-full text-text-secondary hover:text-text-primary hover:bg-bg-primary transition-colors"
                      data-tooltip={t('adjustments.zoneTint.removeGrade')}
                      onClick={() => removeGrade(grade)}
                    >
                      <X size={14} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
