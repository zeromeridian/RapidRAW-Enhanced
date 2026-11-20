import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { ParseKeys } from 'i18next';
import { useControlLabel } from '../../hooks/useControlLabel';
import Text from '../ui/Text';
import Button from '../ui/Button';
import TickBox, { getTickState } from '../ui/TickBox';
import { TextColors, TextVariants } from '../../types/typography';
import { ADJUSTMENT_GROUPS, AdjustmentGroup, COPYABLE_ADJUSTMENT_KEYS } from '../../utils/adjustments';
import { presetSettingUnits } from '../../utils/presetSettings';

/** Save a new preset, Update one with the photo's settings, or Configure one without the photo. */
export type PresetDialogMode = 'new' | 'update' | 'configure';

interface ConfigurePresetModalProps {
  isOpen: boolean;
  mode: PresetDialogMode;
  initialName: string;
  /** The settings ticked when the dialog opens. */
  initialKeys: ReadonlySet<string>;
  onClose(): void;
  onSave(name: string, keys: Set<string>): void;
}

const TITLES: Record<PresetDialogMode, ParseKeys> = {
  new: 'modals.configurePreset.titleSave',
  update: 'modals.configurePreset.titleUpdate',
  configure: 'modals.configurePreset.titleConfigure',
};

const HINTS: Record<PresetDialogMode, ParseKeys> = {
  new: 'modals.configurePreset.hintFromPhoto',
  update: 'modals.configurePreset.hintFromPhoto',
  configure: 'modals.configurePreset.hintKeepValues',
};

interface SettingRowProps {
  label: string;
  state: ReturnType<typeof getTickState>;
  onToggle(): void;
  isPart?: boolean;
}

function SettingRow({ label, state, onToggle, isPart = false }: SettingRowProps) {
  const { t } = useTranslation();
  return (
    <button
      className={`flex w-full items-center gap-2 py-0.5 text-left ${isPart ? 'pl-6' : ''}`}
      onClick={onToggle}
      type="button"
    >
      <TickBox state={state} />
      <Text as="span" color={isPart ? TextColors.secondary : TextColors.primary}>
        {t(label as ParseKeys)}
      </Text>
    </button>
  );
}

/** The preset dialog (Lightroom Classic's New Develop Preset): a name and a tree of the settings it saves. */
export default function ConfigurePresetModal({
  isOpen,
  mode,
  initialName,
  initialKeys,
  onClose,
  onSave,
}: ConfigurePresetModalProps) {
  const { t } = useTranslation();
  const { sectionLabel } = useControlLabel();
  const [name, setName] = useState('');
  const [keys, setKeys] = useState<Set<string>>(new Set());
  const [isMounted, setIsMounted] = useState(false);
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setName(initialName);
      setKeys(new Set(initialKeys));
      setIsMounted(true);
      const timer = setTimeout(() => setShow(true), 10);
      return () => clearTimeout(timer);
    }
    setShow(false);
    const timer = setTimeout(() => setIsMounted(false), 300);
    return () => clearTimeout(timer);
  }, [isOpen, initialName, initialKeys]);

  const canSave = name.trim() !== '' && keys.size > 0;

  const handleSave = useCallback(() => {
    if (canSave) {
      onSave(name.trim(), keys);
      onClose();
    }
  }, [canSave, name, keys, onSave, onClose]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        handleSave();
      } else if (e.key === 'Escape') {
        onClose();
      }
    },
    [handleSave, onClose],
  );

  const isTicked = (unit: AdjustmentGroup) => unit.keys.every((key) => keys.has(key));

  const setTicked = (unitKeys: Array<string>, isOn: boolean) => {
    const next = new Set(keys);
    for (const key of unitKeys) {
      if (isOn) next.add(key);
      else next.delete(key);
    }
    setKeys(next);
  };

  if (!isMounted) {
    return null;
  }

  return (
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
        className={`
          bg-surface rounded-lg shadow-xl p-6 w-full max-w-3xl mx-4 flex flex-col max-h-[90vh]
          transform transition-all duration-300 ease-out
          ${show ? 'scale-100 opacity-100 translate-y-0' : 'scale-95 opacity-0 -translate-y-4'}
        `}
        onClick={(e) => e.stopPropagation()}
      >
        <Text variant={TextVariants.title} className="mb-4">
          {t(TITLES[mode])}
        </Text>
        <input
          autoFocus
          className="w-full bg-bg-primary text-text-primary border border-border rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t('modals.configurePreset.placeholder')}
          type="text"
          value={name}
        />

        <div className="flex justify-between items-center mt-5 mb-2 gap-4">
          <div>
            <Text variant={TextVariants.heading}>{t('modals.configurePreset.settings')}</Text>
            <Text variant={TextVariants.small}>{t(HINTS[mode])}</Text>
          </div>
          <div className="flex gap-2 shrink-0">
            <Button size="sm" onClick={() => setKeys(new Set(COPYABLE_ADJUSTMENT_KEYS))}>
              {t('modals.copyPaste.selectAll')}
            </Button>
            <Button size="sm" onClick={() => setKeys(new Set())}>
              {t('modals.copyPaste.selectNone')}
            </Button>
          </div>
        </div>

        <div className="bg-bg-primary p-4 rounded-md overflow-y-auto min-h-0">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-5">
            {Object.entries(ADJUSTMENT_GROUPS).map(([section, groups]) => (
              <div key={section}>
                <Text variant={TextVariants.label} className="mb-1.5">
                  {sectionLabel(section)}
                </Text>
                {groups.map((group) => {
                  const units = presetSettingUnits(group);
                  const tickedCount = units.filter(isTicked).length;
                  const state = getTickState(tickedCount, units.length);
                  return (
                    <div key={group.label} className="mb-1 last:mb-0">
                      <SettingRow
                        label={group.label}
                        state={state}
                        onToggle={() => setTicked(group.keys, state !== 'all')}
                      />
                      {group.parts?.map((part) => (
                        <SettingRow
                          isPart
                          key={part.label}
                          label={part.label}
                          state={isTicked(part) ? 'all' : 'none'}
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
            {t('modals.configurePreset.save')}
          </button>
        </div>
      </div>
    </div>
  );
}
