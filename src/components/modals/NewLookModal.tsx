import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { ParseKeys } from 'i18next';
import clsx from 'clsx';
import { useControlLabel } from '../../hooks/useControlLabel';
import Text from '../ui/Text';
import Button from '../ui/Button';
import SegmentedSwitch from '../ui/SegmentedSwitch';
import TickBox, { getTickState } from '../ui/TickBox';
import GroupPicker, { BrowserGroup, GroupChoice, NO_GROUP, isGroupChoiceValid } from '../ui/LooksBrowser/GroupPicker';
import { TextColors, TextVariants } from '../../types/typography';
import {
  ADJUSTMENT_GROUPS,
  AdjustmentGroup,
  COPYABLE_ADJUSTMENT_KEYS,
  ColorAdjustment,
  PROFILE_BAKEABLE_KEYS,
  ProfileAdjustment,
  getProfileBakeGroupOfKey,
} from '../../utils/adjustments';
import { presetSettingUnits } from '../../utils/presetSettings';
import { LookDialog, LookType, lookTypeOf } from '../../hooks/useLookDialog';

/** What the dialog returns: the Type, name, group and the ticked settings. */
export interface LookChoice {
  type: LookType;
  name: string;
  group: GroupChoice;
  /** The ticked keys; for a profile or LUT only those it can bake. */
  keys: Set<string>;
  /** Black & White ticked (for a profile or LUT: its B&W flag). */
  monochrome: boolean;
}

interface NewLookModalProps {
  isOpen: boolean;
  /** The task; kept while the dialog fades out. */
  dialog: LookDialog | null;
  groups: Record<LookType, ReadonlyArray<BrowserGroup>>;
  initialName: string;
  initialGroup: GroupChoice;
  initialKeys: ReadonlySet<string>;
  /** Rename Profile's Black & White switch. */
  initialMonochrome: boolean;
  /** The photo's profile, which a new profile can bake in; null without one. */
  currentProfileName: string | null;
  isBusy: boolean;
  onClose(): void;
  onSubmit(choice: LookChoice): void;
}

const LOOK_TYPES: ReadonlyArray<LookType> = ['preset', 'profile', 'lut'];

/** Every setting the tree lists; a unit's keys are saved together. */
const SETTING_UNITS = Object.values(ADJUSTMENT_GROUPS).flat().flatMap(presetSettingUnits);

const TYPE_LABELS: Record<LookType, ParseKeys> = {
  preset: 'editor.presets.types.preset',
  profile: 'modals.createProfile.targetProfile',
  lut: 'modals.createProfile.targetLut',
};

const NAME_PLACEHOLDERS: Record<LookType, ParseKeys> = {
  preset: 'modals.configurePreset.placeholder',
  profile: 'modals.createProfile.namePlaceholder',
  lut: 'modals.createProfile.lutNamePlaceholder',
};

const titleOf = (dialog: LookDialog, type: LookType): ParseKeys => {
  switch (dialog.mode) {
    case 'updatePreset':
      return 'modals.configurePreset.titleUpdate';
    case 'configurePreset':
      return 'modals.configurePreset.titleConfigure';
    case 'updateProfile':
      return 'modals.createProfile.titleUpdate';
    case 'renameProfile':
      return 'modals.createProfile.titleRename';
    default:
      return type === 'preset'
        ? 'modals.configurePreset.titleSave'
        : type === 'profile'
          ? 'modals.createProfile.title'
          : 'modals.createProfile.titleLut';
  }
};

const hintOf = (dialog: LookDialog, type: LookType): ParseKeys => {
  if (dialog.mode === 'configurePreset') return 'modals.configurePreset.hintKeepValues';
  if (dialog.mode === 'updateProfile') return 'modals.createProfile.hintUpdate';
  if (type === 'lut') return 'modals.createProfile.hintLut';
  return type === 'profile' ? 'modals.createProfile.hint' : 'modals.configurePreset.hintFromPhoto';
};

const submitLabelOf = (dialog: LookDialog, type: LookType): ParseKeys => {
  if (dialog.mode === 'updateProfile') return 'modals.createProfile.update';
  if (dialog.mode === 'renameProfile') return 'modals.createProfile.save';
  if (type === 'lut') return 'modals.createProfile.saveLut';
  return type === 'profile' ? 'modals.createProfile.create' : 'modals.configurePreset.save';
};

const isApproximate = (unit: AdjustmentGroup) => unit.keys.some((key) => getProfileBakeGroupOfKey(key)?.isApproximate);

interface SettingRowProps {
  label: string;
  state: ReturnType<typeof getTickState>;
  onToggle(): void;
  isPart?: boolean;
  isDisabled?: boolean;
  /** "(approximate)" after a setting a profile bakes closely, not exactly; its tooltip says why. */
  note?: string;
}

function SettingRow({ label, state, onToggle, isPart = false, isDisabled = false, note }: SettingRowProps) {
  const { t } = useTranslation();
  return (
    <button
      className={clsx(
        'flex w-full items-center gap-2 py-0.5 text-left',
        isPart && 'pl-6',
        isDisabled && 'opacity-40 cursor-not-allowed',
      )}
      data-tooltip={note ? t('modals.createProfile.approximateHint') : undefined}
      disabled={isDisabled}
      onClick={onToggle}
      type="button"
    >
      <TickBox state={isDisabled ? 'none' : state} />
      <Text as="span" color={isPart ? TextColors.secondary : TextColors.primary}>
        {t(label as ParseKeys)}
      </Text>
      {note && (
        <Text as="span" color={TextColors.secondary} variant={TextVariants.small}>
          ({note})
        </Text>
      )}
    </button>
  );
}

/**
 * The New Look dialog (Plan item 86, decisions L9–L10): a preset, profile or LUT from the
 * photo's settings with a name and a group, in one tree of settings. A profile or LUT bakes only
 * what it can; the rest is greyed out and keeps its tick for a preset.
 */
export default function NewLookModal({
  isOpen,
  dialog,
  groups,
  initialName,
  initialGroup,
  initialKeys,
  initialMonochrome,
  currentProfileName,
  isBusy,
  onClose,
  onSubmit,
}: NewLookModalProps) {
  const { t } = useTranslation();
  const { sectionLabel } = useControlLabel();
  const [type, setType] = useState<LookType>('preset');
  const [name, setName] = useState('');
  const [group, setGroup] = useState<GroupChoice>(NO_GROUP);
  const [keys, setKeys] = useState<Set<string>>(new Set());
  const [monochrome, setMonochrome] = useState(false);
  const [isMounted, setIsMounted] = useState(false);
  const [show, setShow] = useState(false);

  const wasOpen = useRef(false);

  useEffect(() => {
    if (isOpen && dialog) {
      // The fields start from the initial values once, as the dialog opens.
      if (!wasOpen.current) {
        setType(lookTypeOf(dialog));
        setName(initialName);
        setGroup(initialGroup);
        setKeys(new Set(initialKeys));
        setMonochrome(initialMonochrome);
      }
      wasOpen.current = true;
      setIsMounted(true);
      const timer = setTimeout(() => setShow(true), 10);
      return () => clearTimeout(timer);
    }
    wasOpen.current = false;
    setShow(false);
    const timer = setTimeout(() => setIsMounted(false), 300);
    return () => clearTimeout(timer);
  }, [isOpen, dialog, initialName, initialGroup, initialKeys, initialMonochrome]);

  const isRename = dialog?.mode === 'renameProfile';
  const isBake = type !== 'preset';

  /** A setting a profile or LUT can bake: Profile only while the photo has one. */
  const canBake = useCallback(
    (unit: AdjustmentGroup) =>
      unit.keys.every((key) => PROFILE_BAKEABLE_KEYS.has(key) || key === ColorAdjustment.Monochrome) &&
      (!unit.keys.includes(ProfileAdjustment.Profile) || currentProfileName !== null),
    [currentProfileName],
  );
  const isEnabled = (unit: AdjustmentGroup) => !isBake || canBake(unit);
  const isTicked = (unit: AdjustmentGroup) => unit.keys.every((key) => keys.has(key));

  const setTicked = (unitKeys: Array<string>, isOn: boolean) => {
    const next = new Set(keys);
    for (const key of unitKeys) {
      if (isOn) next.add(key);
      else next.delete(key);
    }
    setKeys(next);
  };

  /** The keys the chosen Type saves: everything for a preset, the bakeable ticks otherwise. */
  const savedKeys = (): Set<string> =>
    isBake
      ? new Set(SETTING_UNITS.filter((unit) => canBake(unit) && isTicked(unit)).flatMap((unit) => unit.keys))
      : keys;

  const selectAll = () =>
    setKeys(
      isBake
        ? new Set([...keys, ...SETTING_UNITS.filter(canBake).flatMap((unit) => unit.keys)])
        : new Set(COPYABLE_ADJUSTMENT_KEYS),
    );

  const handleTypeChange = (next: LookType) => {
    // Presets, profiles and LUTs have groups of their own.
    if (next !== type) setGroup(NO_GROUP);
    setType(next);
  };

  const chosenKeys = isRename ? new Set<string>() : savedKeys();
  const canSave = !isBusy && name.trim() !== '' && isGroupChoiceValid(group) && (isRename || chosenKeys.size > 0);

  const handleSave = () => {
    if (!canSave) return;
    onSubmit({
      type,
      name: name.trim(),
      group,
      keys: chosenKeys,
      monochrome: isRename ? monochrome : chosenKeys.has(ColorAdjustment.Monochrome),
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') handleSave();
    else if (e.key === 'Escape') onClose();
  };

  if (!isMounted || !dialog) {
    return null;
  }

  return createPortal(
    <div
      className={`
        fixed inset-0 flex items-center justify-center z-50
        bg-black/30 backdrop-blur-xs
        transition-opacity duration-300 ease-in-out
        ${show ? 'opacity-100' : 'opacity-0'}
      `}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className={clsx(
          'bg-surface rounded-lg shadow-xl p-6 w-full mx-4 flex flex-col max-h-[90vh] transform transition-all duration-300 ease-out',
          isRename ? 'max-w-md' : 'max-w-3xl',
          show ? 'scale-100 opacity-100 translate-y-0' : 'scale-95 opacity-0 -translate-y-4',
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <Text variant={TextVariants.title} className="mb-4">
          {t(titleOf(dialog, type))}
        </Text>
        {dialog.mode === 'new' && (
          <SegmentedSwitch
            className="mb-3"
            onChange={handleTypeChange}
            options={LOOK_TYPES.map((value) => ({ value, label: t(TYPE_LABELS[value]) }))}
            value={type}
          />
        )}
        <input
          autoFocus
          className="w-full bg-bg-primary text-text-primary border border-border rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t(NAME_PLACEHOLDERS[type])}
          type="text"
          value={name}
        />
        <div className="mt-3">
          <GroupPicker groups={groups[type]} value={group} onChange={setGroup} />
        </div>

        {isRename ? (
          <div className="mt-4">
            <SettingRow
              label="modals.createProfile.blackAndWhite"
              state={monochrome ? 'all' : 'none'}
              onToggle={() => setMonochrome((value) => !value)}
            />
          </div>
        ) : (
          <>
            <div className="flex justify-between items-center mt-5 mb-2 gap-4">
              <div>
                <Text variant={TextVariants.heading}>{t('modals.configurePreset.settings')}</Text>
                <Text variant={TextVariants.small}>{t(hintOf(dialog, type))}</Text>
              </div>
              <div className="flex gap-2 shrink-0">
                <Button size="sm" onClick={selectAll}>
                  {t('modals.copyPaste.selectAll')}
                </Button>
                <Button size="sm" onClick={() => setKeys(new Set())}>
                  {t('modals.copyPaste.selectNone')}
                </Button>
              </div>
            </div>

            <div className="bg-bg-primary p-4 rounded-md overflow-y-auto min-h-0">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-5">
                {Object.entries(ADJUSTMENT_GROUPS).map(([section, sectionGroups]) => (
                  <div key={section}>
                    <Text variant={TextVariants.label} className="mb-1.5">
                      {sectionLabel(section)}
                    </Text>
                    {sectionGroups.map((settingGroup) => {
                      const units = presetSettingUnits(settingGroup).filter(isEnabled);
                      const state = getTickState(units.filter(isTicked).length, units.length);
                      const isGroupApproximate = isBake && !settingGroup.parts && isApproximate(settingGroup);
                      return (
                        <div key={settingGroup.label} className="mb-1 last:mb-0">
                          <SettingRow
                            label={settingGroup.label}
                            state={state}
                            isDisabled={units.length === 0}
                            note={isGroupApproximate ? t('modals.createProfile.approximate') : undefined}
                            onToggle={() =>
                              setTicked(
                                units.flatMap((unit) => unit.keys),
                                state !== 'all',
                              )
                            }
                          />
                          {settingGroup.parts?.map((part) => (
                            <SettingRow
                              isPart
                              key={part.label}
                              label={part.label}
                              state={isTicked(part) ? 'all' : 'none'}
                              isDisabled={!isEnabled(part)}
                              note={isBake && isApproximate(part) ? t('modals.createProfile.approximate') : undefined}
                              onToggle={() => setTicked(part.keys, !isTicked(part))}
                            />
                          ))}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        <div className="flex justify-end gap-3 mt-6">
          <button
            className="px-4 py-2 rounded-md text-text-secondary hover:bg-surface transition-colors"
            onClick={onClose}
          >
            {t('modals.configurePreset.cancel')}
          </button>
          <button
            className="px-4 py-2 rounded-md bg-accent text-button-text font-semibold hover:bg-accent-hover disabled:bg-gray-500 disabled:text-white disabled:cursor-not-allowed transition-colors"
            disabled={!canSave}
            onClick={handleSave}
          >
            {t(submitLabelOf(dialog, type))}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
