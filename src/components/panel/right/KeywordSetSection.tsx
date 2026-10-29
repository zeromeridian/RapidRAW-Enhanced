import { useMemo, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';

import Dropdown from '../../ui/Dropdown';
import Input from '../../ui/Input';
import Text from '../../ui/Text';
import ConfirmModal from '../../modals/ConfirmModal';
import KeywordTile, { useAppliedKeywordCounts } from './KeywordTile';
import { useLibraryActions } from '../../../hooks/useLibraryActions';
import { useSettingsStore } from '../../../store/useSettingsStore';
import { TextColors, TextVariants } from '../../../types/typography';
import { KEYBIND_DEFINITIONS, formatKeyCode, getEffectiveCombo } from '../../../utils/keyboardUtils';
import {
  KEYWORD_SET_SIZE,
  KeywordSet,
  formatKeyword,
  getActiveKeywordSet,
  getKeywordSets,
  parseKeywordInput,
} from '../../../utils/keywords';

const iconButtonClassName =
  'w-9 h-9 shrink-0 rounded-md bg-surface-secondary text-text-secondary hover:text-text-primary hover:bg-surface transition-colors flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed';

interface KeywordSetSectionProps {
  targetPaths: string[];
}

export default function KeywordSetSection({ targetPaths }: KeywordSetSectionProps) {
  const { t } = useTranslation();
  const appSettings = useSettingsStore((state) => state.appSettings);
  const handleSettingsChange = useSettingsStore((state) => state.handleSettingsChange);
  const osPlatform = useSettingsStore((state) => state.osPlatform);
  const { handleToggleKeyword } = useLibraryActions();
  const [draft, setDraft] = useState<KeywordSet | null>(null);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);

  const keywordSets = useMemo(() => getKeywordSets(appSettings), [appSettings]);
  const activeSet = useMemo(() => getActiveKeywordSet(appSettings), [appSettings]);

  const appliedCounts = useAppliedKeywordCounts(targetPaths);

  const shortcutLabels = useMemo(
    () =>
      Array.from({ length: KEYWORD_SET_SIZE }, (_, index) => {
        const definition = KEYBIND_DEFINITIONS.find((item) => item.action === `apply_keyword_${index + 1}`);
        if (!definition) return '';
        return getEffectiveCombo(definition, appSettings?.keybinds)
          .map((key) => formatKeyCode(key, osPlatform))
          .join(osPlatform === 'macos' ? '' : '+');
      }),
    [appSettings?.keybinds, osPlatform],
  );

  const saveKeywordSets = (sets: KeywordSet[], activeKeywordSet: string | null) => {
    if (!appSettings) return;
    void handleSettingsChange({ ...appSettings, keywordSets: sets, activeKeywordSet });
  };

  const startEditing = (set: KeywordSet) =>
    setDraft({ ...set, keywords: set.keywords.map((keyword) => formatKeyword(keyword, ' > ')) });

  const createKeywordSet = () =>
    setDraft({
      id: crypto.randomUUID(),
      name: t('editor.tagging.newKeywordSetName'),
      keywords: Array(KEYWORD_SET_SIZE).fill(''),
    });

  const saveDraft = () => {
    if (!draft) return;
    const existing = keywordSets.find((set) => set.id === draft.id);
    const saved: KeywordSet = {
      id: draft.id,
      name: draft.name.trim() || existing?.name || t('editor.tagging.newKeywordSetName'),
      keywords: draft.keywords.map(parseKeywordInput),
    };
    saveKeywordSets(
      existing ? keywordSets.map((set) => (set.id === saved.id ? saved : set)) : [...keywordSets, saved],
      saved.id,
    );
    setDraft(null);
  };

  const deleteActiveSet = () => {
    if (!activeSet) return;
    const remaining = keywordSets.filter((set) => set.id !== activeSet.id);
    saveKeywordSets(remaining, remaining[0]?.id ?? null);
  };

  const stopShortcuts = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      saveDraft();
    } else if (event.key === 'Escape') {
      setDraft(null);
    }
    event.stopPropagation();
  };

  return (
    <div>
      <Text variant={TextVariants.heading} className="mb-3">
        {t('editor.tagging.keywordSet')}
      </Text>

      {draft ? (
        <div className="space-y-2">
          <Input
            autoFocus
            bgClassName="bg-bg-primary"
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            onKeyDown={stopShortcuts}
            placeholder={t('editor.tagging.keywordSetName')}
            value={draft.name}
          />
          <div className="grid grid-cols-3 gap-1.5">
            {draft.keywords.map((keyword, index) => (
              <Input
                bgClassName="bg-bg-primary"
                className="h-9 px-2"
                key={index}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    keywords: draft.keywords.map((value, slot) => (slot === index ? event.target.value : value)),
                  })
                }
                onKeyDown={stopShortcuts}
                placeholder={shortcutLabels[index]}
                value={keyword}
              />
            ))}
          </div>
          <Text variant={TextVariants.small} color={TextColors.secondary}>
            {t('editor.tagging.hierarchyHint')}
          </Text>
          <div className="flex justify-end gap-2">
            <button
              className="px-3 py-1.5 rounded-md text-sm text-text-secondary hover:text-text-primary hover:bg-surface transition-colors"
              onClick={() => setDraft(null)}
              type="button"
            >
              {t('editor.tagging.cancelKeywordSet')}
            </button>
            <button
              className="px-3 py-1.5 rounded-md text-sm bg-accent text-button-text hover:bg-accent/90 transition-colors"
              onClick={saveDraft}
              type="button"
            >
              {t('editor.tagging.saveKeywordSet')}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center gap-1">
            <Dropdown
              className="grow min-w-0"
              onChange={(id: string) => saveKeywordSets(keywordSets, id)}
              options={keywordSets.map((set) => ({ label: set.name, value: set.id }))}
              placeholder={t('editor.tagging.keywordSet')}
              triggerClassName="bg-surface-secondary h-9 px-2"
              value={activeSet?.id ?? null}
            />
            <button
              className={iconButtonClassName}
              data-tooltip={t('editor.tagging.editKeywordSet')}
              disabled={!activeSet}
              onClick={() => activeSet && startEditing(activeSet)}
              type="button"
            >
              <Pencil size={16} />
            </button>
            <button
              className={iconButtonClassName}
              data-tooltip={t('editor.tagging.newKeywordSet')}
              onClick={createKeywordSet}
              type="button"
            >
              <Plus size={16} />
            </button>
            <button
              className={clsx(iconButtonClassName, 'hover:text-red-400')}
              data-tooltip={t('editor.tagging.deleteKeywordSet')}
              disabled={keywordSets.length < 2}
              onClick={() => setIsDeleteOpen(true)}
              type="button"
            >
              <Trash2 size={16} />
            </button>
          </div>

          {activeSet && (
            <div className="grid grid-cols-3 gap-1.5">
              {activeSet.keywords.map((keyword, index) => (
                <KeywordTile
                  appliedCounts={appliedCounts}
                  key={index}
                  keyword={keyword}
                  label={shortcutLabels[index]}
                  onToggle={(toggled) => handleToggleKeyword(toggled, targetPaths)}
                  targetCount={targetPaths.length}
                />
              ))}
            </div>
          )}
        </div>
      )}

      <ConfirmModal
        confirmText={t('editor.tagging.deleteKeywordSet')}
        confirmVariant="danger"
        isOpen={isDeleteOpen}
        message={t('editor.tagging.deleteKeywordSetMessage', { name: activeSet?.name || '' })}
        onClose={() => setIsDeleteOpen(false)}
        onConfirm={deleteActiveSet}
        title={t('editor.tagging.deleteKeywordSet')}
      />
    </div>
  );
}
