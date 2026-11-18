import { Fragment, useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import type { ParseKeys } from 'i18next';
import { ArrowBigUp, ChevronRight, MousePointerClick, Move } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import Button from '../../ui/Button';
import Switch from '../../ui/Switch';
import Text from '../../ui/Text';
import {
  formatKeyCode,
  KeybindDefinition,
  KEYBIND_DEFINITIONS,
  KEYBIND_SECTIONS,
  normalizeCombo,
} from '../../../utils/keyboardUtils';
import { DEFAULT_SPEED_EDIT_ADJUSTMENTS, SPEED_EDIT_ADJUSTMENTS } from '../../../utils/adjustments';
import { TextColors, TextVariants, TextWeights } from '../../../types/typography';
import SettingsPage, { SettingsPageProps, SettingsSectionDef } from './SettingsPage';
import { useSettingsContext } from './SettingsContext';

const SPEED_EDIT_KEY_ROWS = [
  {
    offset: '',
    keys: [
      { code: 'KeyQ', label: 'settings.controls.speedEdit.keys.previousImage' },
      { code: 'KeyW', label: 'settings.controls.speedEdit.keys.hold' },
      { code: 'KeyE', label: 'settings.controls.speedEdit.keys.nextImage' },
      { code: 'KeyR', label: 'settings.controls.speedEdit.keys.reset' },
    ],
  },
  {
    offset: 'ml-4',
    keys: [
      { code: 'KeyA', label: 'settings.controls.speedEdit.keys.previousAdjustment' },
      { code: 'KeyS', label: null },
      { code: 'KeyD', label: 'settings.controls.speedEdit.keys.nextAdjustment' },
    ],
  },
  {
    offset: 'ml-12',
    keys: [
      { code: 'KeyZ', label: null },
      { code: 'KeyX', label: null },
      { code: 'KeyC', label: 'settings.controls.speedEdit.keys.copy' },
      { code: 'KeyV', label: 'settings.controls.speedEdit.keys.paste' },
    ],
  },
] as const;

const SPEED_EDIT_ARROW_ROWS = [
  { offset: 'ml-[70px]', keys: [{ code: 'ArrowUp', label: null }] },
  {
    offset: '',
    keys: [
      { code: 'ArrowLeft', label: 'settings.controls.speedEdit.keys.stepDown' },
      { code: 'ArrowDown', label: null },
      { code: 'ArrowRight', label: 'settings.controls.speedEdit.keys.stepUp' },
    ],
  },
] as const;

const SPEED_EDIT_GESTURES = [
  { icon: Move, label: 'settings.controls.speedEdit.gestures.drag', isPrimary: true },
  { icon: ArrowBigUp, label: 'settings.controls.speedEdit.gestures.fine', isPrimary: false },
  { icon: MousePointerClick, label: 'settings.controls.speedEdit.gestures.doubleClick', isPrimary: false },
] as const;

interface SpeedEditKeyProps {
  code: string;
  label: string | null;
  osPlatform: string;
}

const SpeedEditKey = ({ code, label, osPlatform }: SpeedEditKeyProps) => {
  const isHold = code === 'KeyW';
  return (
    <kbd
      className={clsx(
        'flex flex-col items-center justify-center gap-1 w-16 h-14 px-1 rounded-lg border font-sans text-center',
        isHold && 'bg-accent border-accent text-button-text',
        !isHold && label && 'bg-bg-primary border-border-color shadow-[inset_0_-2px_0_rgba(0,0,0,0.25)]',
        !label && 'border-dashed border-border-color text-text-secondary opacity-40',
      )}
    >
      <span className="text-sm font-semibold leading-none">{formatKeyCode(code, osPlatform)}</span>
      {label && (
        <span className={clsx('text-[9px] leading-tight', isHold ? 'text-button-text/80' : 'text-text-secondary')}>
          {label}
        </span>
      )}
    </kbd>
  );
};

const MiniKey = ({ code, osPlatform }: { code: string; osPlatform: string }) => (
  <kbd className="px-1.5 py-0.5 rounded-sm border border-border-color bg-bg-primary font-sans text-[10px] font-semibold">
    {formatKeyCode(code, osPlatform)}
  </kbd>
);

interface KeybindButtonProps {
  currentCombo?: string[];
  def: KeybindDefinition;
  isConflicting: boolean;
  onSave(action: string, combo: string[]): void;
  onStartRecording(action: string): void;
  osPlatform: string;
  recordingAction: string | null;
}

/** A shortcut's keys; a click records new ones, Escape clears it. */
const KeybindButton = ({
  currentCombo,
  def,
  isConflicting,
  onSave,
  onStartRecording,
  osPlatform,
  recordingAction,
}: KeybindButtonProps) => {
  const { t } = useTranslation();
  const recording = recordingAction === def.action;

  useEffect(() => {
    if (!recording) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onSave(def.action, []);
        onStartRecording('');
        return;
      }
      e.preventDefault();
      const parts = normalizeCombo(e, osPlatform);
      if (parts.length > 0 && !['ctrl', 'shift', 'alt'].includes(parts[parts.length - 1])) {
        onSave(def.action, parts);
        onStartRecording('');
      }
    };
    window.addEventListener('keydown', handler, { capture: true });
    return () => window.removeEventListener('keydown', handler, { capture: true });
  }, [recording, def.action, onSave, onStartRecording, osPlatform]);

  const displayCombo = currentCombo !== undefined ? (currentCombo.length ? currentCombo : null) : def.defaultCombo;

  return (
    <div className="flex items-center gap-1">
      {isConflicting && <span className="text-yellow-400 text-xs">⚠</span>}
      <button onClick={() => onStartRecording(def.action)} className="flex items-center gap-1 flex-wrap shrink-0">
        {recording ? (
          <Text
            as="kbd"
            variant={TextVariants.small}
            color={TextColors.accent}
            weight={TextWeights.semibold}
            className="px-2 py-1 font-sans bg-bg-primary border border-accent rounded-md animate-pulse"
          >
            {t('settings.controls.pressKey')}
          </Text>
        ) : (
          <Text
            as="kbd"
            variant={TextVariants.small}
            color={TextColors.primary}
            weight={TextWeights.semibold}
            className={clsx(
              'px-2 py-1 font-sans bg-bg-primary border rounded-md cursor-pointer hover:border-accent transition-colors',
              isConflicting ? 'border-yellow-400' : 'border-border-color',
            )}
          >
            {displayCombo ? (
              displayCombo.map((k) => formatKeyCode(k, osPlatform)).join(' + ')
            ) : (
              <span className="text-text-secondary italic">{t('settings.controls.notAssigned')}</span>
            )}
          </Text>
        )}
      </button>
    </div>
  );
};

export default function ShortcutsSettings({ query }: SettingsPageProps) {
  const { t } = useTranslation();
  const { appSettings, osPlatform, updateSetting } = useSettingsContext();
  const [recordingAction, setRecordingAction] = useState<string | null>(null);
  const userKeybinds = useMemo<Record<string, string[]>>(() => appSettings?.keybinds || {}, [appSettings?.keybinds]);
  const speedEditAdjustments: string[] = appSettings?.speedEditAdjustments ?? DEFAULT_SPEED_EDIT_ADJUSTMENTS;

  const conflictingKeys = useMemo(() => {
    const actionsByCombo = new Map<string, Set<string>>();
    for (const def of KEYBIND_DEFINITIONS) {
      const userCombo = userKeybinds[def.action];
      const effective = userCombo?.length ? userCombo : userCombo === undefined ? def.defaultCombo : null;
      if (!effective) continue;
      const combo = effective.join('+');
      if (!actionsByCombo.has(combo)) actionsByCombo.set(combo, new Set());
      actionsByCombo.get(combo)!.add(def.action);
    }
    const keys = new Set<string>();
    for (const actions of actionsByCombo.values()) {
      if (actions.size > 1) actions.forEach((action) => keys.add(action));
    }
    return keys;
  }, [userKeybinds]);

  const handleKeybindSave = (action: string, combo: string[]) =>
    updateSetting('keybinds', { ...userKeybinds, [action]: combo });

  const keybindSections: SettingsSectionDef[] = KEYBIND_SECTIONS.map((section) => ({
    id: `keybinds-${section.id}`,
    title: t(section.label as ParseKeys),
    rows: KEYBIND_DEFINITIONS.filter((def) => def.section === section.id).map((def) => ({
      id: def.action,
      label: t(def.description as ParseKeys),
      control: (
        <KeybindButton
          currentCombo={userKeybinds[def.action]}
          def={def}
          isConflicting={conflictingKeys.has(def.action)}
          onSave={handleKeybindSave}
          onStartRecording={setRecordingAction}
          osPlatform={osPlatform}
          recordingAction={recordingAction}
        />
      ),
    })),
  }));

  return (
    <SettingsPage
      query={query}
      title={t('settings.categories.shortcuts')}
      sections={[
        {
          id: 'speed-edit',
          title: t('settings.controls.speedEdit.title'),
          rows: [
            {
              id: 'speed-edit-keys',
              label: t('settings.controls.speedEdit.keysTitle'),
              stacked: true,
              control: (
                <div>
                  <div className="flex flex-wrap items-end gap-6">
                    {[SPEED_EDIT_KEY_ROWS, SPEED_EDIT_ARROW_ROWS].map((rows) => (
                      <div className="space-y-1.5" key={rows[0].keys[0].code}>
                        {rows.map(({ offset, keys }) => (
                          <div className={clsx('flex gap-1.5', offset)} key={keys[0].code}>
                            {keys.map(({ code, label }) => (
                              <SpeedEditKey code={code} key={code} label={label && t(label)} osPlatform={osPlatform} />
                            ))}
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-2 mt-5">
                    {SPEED_EDIT_GESTURES.map(({ icon: Icon, label, isPrimary }) => (
                      <span
                        className={clsx(
                          'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs',
                          isPrimary ? 'bg-accent text-button-text font-semibold' : 'bg-bg-primary text-text-secondary',
                        )}
                        key={label}
                      >
                        <Icon size={14} />
                        {t(label)}
                      </span>
                    ))}
                  </div>
                </div>
              ),
            },
            {
              id: 'speed-edit-adjustments',
              label: t('settings.controls.speedEdit.adjustments'),
              stacked: true,
              control: (
                <div>
                  <div className="flex flex-wrap items-center gap-1.5 mb-4 text-xs">
                    <MiniKey code="KeyA" osPlatform={osPlatform} />
                    {SPEED_EDIT_ADJUSTMENTS.filter(({ id }) => speedEditAdjustments.includes(id)).map(
                      ({ id, label }, index) => (
                        <Fragment key={id}>
                          {index > 0 && <ChevronRight size={12} className="text-text-secondary" />}
                          <span className="px-2 py-0.5 rounded-full bg-bg-primary">{t(label)}</span>
                        </Fragment>
                      ),
                    )}
                    <MiniKey code="KeyD" osPlatform={osPlatform} />
                  </div>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-3">
                    {SPEED_EDIT_ADJUSTMENTS.map(({ id, label }) => (
                      <Switch
                        checked={speedEditAdjustments.includes(id)}
                        id={`speed-edit-${id}`}
                        key={id}
                        label={t(label)}
                        onChange={(checked) =>
                          updateSetting(
                            'speedEditAdjustments',
                            checked
                              ? [...speedEditAdjustments, id]
                              : speedEditAdjustments.filter((item) => item !== id),
                          )
                        }
                      />
                    ))}
                  </div>
                </div>
              ),
            },
          ],
        },
        {
          id: 'keyboard',
          rows: [
            {
              id: 'reset-keybinds',
              label: t('settings.controls.keyboardTitle'),
              control: (
                <Button variant="ghost" onClick={() => updateSetting('keybinds', {})}>
                  {t('settings.controls.resetDefaults')}
                </Button>
              ),
            },
          ],
        },
        ...keybindSections,
      ]}
    />
  );
}
