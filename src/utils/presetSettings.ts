import type { Preset } from '../components/ui/AppProperties';
import {
  ADJUSTMENT_GROUPS,
  AdjustmentGroup,
  Adjustments,
  COPYABLE_ADJUSTMENT_KEYS,
  INITIAL_ADJUSTMENTS,
} from './adjustments';

/** The checkboxes a group shows in the preset dialog: its parts, or the group itself. */
export const presetSettingUnits = (group: AdjustmentGroup): AdjustmentGroup[] => group.parts ?? [group];

/** Every setting a preset can save; a unit's keys are always saved together. */
const PRESET_SETTING_UNITS = Object.values(ADJUSTMENT_GROUPS).flat().flatMap(presetSettingUnits);

/**
 * Keys that only say how another value is set, so they are not an edit on their own: Reset sets
 * the aspect ratio to the photo's own, every new edit carries the current lens correction
 * version, and the curve mode only picks which curve is shown.
 */
const NOT_AN_EDIT_ALONE = new Set(['aspectRatio', 'curveMode', 'lensCorrectionVersion']);

const isSame = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** All keys of every unit that holds one of `keys`. */
const toWholeUnits = (keys: Iterable<string>): Set<string> => {
  const present = new Set(keys);
  return new Set(
    PRESET_SETTING_UNITS.filter((unit) => unit.keys.some((key) => present.has(key))).flatMap((unit) => unit.keys),
  );
};

/** The settings a new preset starts with: every unit in which `adjustments` differ from the unedited `initial`. */
export const getEditedPresetKeys = (adjustments: Adjustments, initial: Adjustments): Set<string> =>
  toWholeUnits(
    COPYABLE_ADJUSTMENT_KEYS.filter(
      (key) =>
        !NOT_AN_EDIT_ALONE.has(key) &&
        !isSame(adjustments[key as keyof Adjustments], initial[key as keyof Adjustments]),
    ),
  );

/** The settings a saved preset holds, as whole units (older Tool presets left out unchanged sliders). */
export const getPresetKeys = (preset: Preset): Set<string> => toWholeUnits(Object.keys(preset.adjustments ?? {}));

/**
 * The values a preset saves for `keys`, in the Copy & Paste order, taken from `source`. A ticked
 * setting that `source` lacks is saved at its default, so applying the preset resets it.
 */
export const pickPresetAdjustments = (keys: ReadonlySet<string>, source: Partial<Adjustments>): Partial<Adjustments> =>
  Object.fromEntries(
    COPYABLE_ADJUSTMENT_KEYS.filter((key) => keys.has(key)).map((key) => [
      key,
      source[key as keyof Adjustments] ?? INITIAL_ADJUSTMENTS[key as keyof Adjustments],
    ]),
  );

/** The values of `adjustments` the preset dialog does not list; editing a preset keeps them. */
export const getUnlistedAdjustments = (adjustments: Partial<Adjustments>): Partial<Adjustments> =>
  Object.fromEntries(Object.entries(adjustments).filter(([key]) => !COPYABLE_ADJUSTMENT_KEYS.includes(key)));

/** Whether a preset sets anything in one `ADJUSTMENT_GROUPS` section (e.g. `masks`, `geometry`). */
export const presetHoldsSection = (preset: Preset, section: string): boolean =>
  (ADJUSTMENT_GROUPS[section] ?? []).some((group) => group.keys.some((key) => key in (preset.adjustments ?? {})));

/** What the Presets panel tells about a preset: how many settings it saves, and their groups. */
export const describePresetSettings = (preset: Preset): { count: number; groupLabels: string[] } => {
  const keys = new Set(Object.keys(preset.adjustments ?? {}));
  const holds = (group: AdjustmentGroup) => group.keys.some((key) => keys.has(key));
  return {
    count: PRESET_SETTING_UNITS.filter(holds).length,
    groupLabels: Object.values(ADJUSTMENT_GROUPS)
      .flat()
      .filter(holds)
      .map((group) => group.label),
  };
};
