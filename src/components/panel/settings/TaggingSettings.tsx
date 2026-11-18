import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { AnimatePresence, motion } from 'framer-motion';
import { Plus, Trash2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import Input from '../../ui/Input';
import Slider from '../../ui/Slider';
import Text from '../../ui/Text';
import { Invokes } from '../../ui/AppProperties';
import { TextColors, TextVariants } from '../../../types/typography';
import SettingsPage, { SettingsPageProps } from './SettingsPage';
import { ActionButton, SettingSwitch, StatusMessage, useTimedAction } from './SettingControls';
import { useSettingsContext } from './SettingsContext';

const tagVariants = {
  visible: { opacity: 1, scale: 1, transition: { type: 'spring', stiffness: 500, damping: 30 } },
  exit: { opacity: 0, scale: 0.8, transition: { duration: 0.15 } },
} as const;

export default function TaggingSettings({ query }: SettingsPageProps) {
  const { t } = useTranslation();
  const { appSettings, onLibraryRefresh, requestConfirm, rootPaths, updateSetting } = useSettingsContext();
  const [newAiTag, setNewAiTag] = useState('');
  const clearAiTags = useTimedAction();
  const clearAllTags = useTimedAction();
  const customAiTags = Array.from(new Set<string>(appSettings?.customAiTags || []));
  const isAiTaggingEnabled = appSettings?.enableAiTagging ?? false;

  /** Runs a tag-clearing command on every library folder and returns the count of photos changed. */
  const clearTagsInLibrary = async (command: Invokes) => {
    let total = 0;
    for (const rootPath of rootPaths) {
      total += await invoke<number>(command, { rootPath });
    }
    onLibraryRefresh();
    return total;
  };

  const handleClearAiTags = () =>
    requestConfirm({
      confirmText: t('settings.data.modals.confirmClearAi'),
      message: t('settings.data.modals.aiMessage'),
      title: t('settings.data.modals.confirmAiTitle'),
      onConfirm: () =>
        clearAiTags.run(t('settings.data.statuses.clearingAi'), async () =>
          t('settings.data.statuses.aiSuccess', { count: await clearTagsInLibrary(Invokes.ClearAiTags) }),
        ),
    });

  const handleClearAllTags = () =>
    requestConfirm({
      confirmText: t('settings.data.modals.confirmClearAll'),
      message: t('settings.data.modals.allMessage'),
      title: t('settings.data.modals.confirmAllTitle'),
      onConfirm: () =>
        clearAllTags.run(t('settings.data.statuses.clearingAll'), async () =>
          t('settings.data.statuses.allSuccess', { count: await clearTagsInLibrary(Invokes.ClearAllTags) }),
        ),
    });

  const handleAddAiTag = () => {
    const parsedTags = newAiTag
      .split(',')
      .map((tag) => tag.trim().toLowerCase())
      .filter((tag) => tag.length > 0);
    if (parsedTags.length > 0) {
      updateSetting('customAiTags', Array.from(new Set([...customAiTags, ...parsedTags])).sort());
    }
    setNewAiTag('');
  };

  const handleRemoveAiTag = (tagToRemove: string) =>
    updateSetting(
      'customAiTags',
      customAiTags.filter((tag) => tag !== tagToRemove),
    );

  return (
    <SettingsPage
      query={query}
      title={t('settings.categories.tagging')}
      sections={[
        {
          id: 'ai-tagging',
          rows: [
            {
              id: 'ai-tagging',
              label: t('settings.tagging.aiTagging'),
              description: t('settings.tagging.aiTaggingDesc'),
              control: (
                <SettingSwitch
                  checked={isAiTaggingEnabled}
                  id="ai-tagging-toggle"
                  label={t('settings.tagging.automaticAiTagging')}
                  onChange={(checked) => updateSetting('enableAiTagging', checked)}
                />
              ),
            },
            isAiTaggingEnabled && {
              id: 'max-ai-tags',
              label: t('settings.tagging.maxAiTags'),
              description: t('settings.tagging.maxAiTagsDesc'),
              indent: true,
              control: (
                <div className="w-full">
                  <Slider
                    label={t('settings.tagging.amount')}
                    min={1}
                    max={20}
                    step={1}
                    value={appSettings?.aiTagCount ?? 10}
                    defaultValue={10}
                    onChange={(e) => updateSetting('aiTagCount', parseInt(String(e.target.value)))}
                  />
                </div>
              ),
            },
            isAiTaggingEnabled && {
              id: 'custom-ai-tags',
              label: t('settings.tagging.customList'),
              description: t('settings.tagging.customListDesc'),
              indent: true,
              stacked: true,
              control: (
                <div>
                  <div className="flex flex-wrap gap-2 p-2 bg-bg-primary rounded-md min-h-10 border border-border-color mb-2 items-center">
                    <AnimatePresence>
                      {customAiTags.length > 0 ? (
                        customAiTags.map((tag) => (
                          <motion.div
                            key={tag}
                            layout
                            variants={tagVariants}
                            initial={false}
                            animate="visible"
                            exit="exit"
                            onClick={() => handleRemoveAiTag(tag)}
                            data-tooltip={t('settings.tagging.removeCustomTooltip', { tag })}
                            className="flex items-center gap-1 bg-surface px-2 py-1 rounded-sm group cursor-pointer"
                          >
                            <Text variant={TextVariants.label} color={TextColors.primary}>
                              {tag}
                            </Text>
                            <span className="rounded-full group-hover:bg-black/20 p-0.5 transition-colors">
                              <X size={14} />
                            </span>
                          </motion.div>
                        ))
                      ) : (
                        <motion.span
                          key="no-ai-tags-placeholder"
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          transition={{ duration: 0.2 }}
                        >
                          <Text className="px-1 select-none italic">{t('settings.tagging.noCustomTags')}</Text>
                        </motion.span>
                      )}
                    </AnimatePresence>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <Input
                        type="text"
                        value={newAiTag}
                        onChange={(e) => setNewAiTag(e.target.value)}
                        onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleAddAiTag();
                          }
                        }}
                        placeholder={t('settings.tagging.addCustomPlaceholder')}
                        className="pr-10"
                        bgClassName="bg-bg-primary"
                      />
                      <button
                        onClick={handleAddAiTag}
                        className="absolute right-1 top-1/2 -translate-y-1/2 p-1.5 rounded-full text-text-secondary hover:text-text-primary hover:bg-surface"
                        data-tooltip={t('settings.tagging.addCustomTooltip')}
                      >
                        <Plus size={18} />
                      </button>
                    </div>
                    <button
                      onClick={() => updateSetting('customAiTags', [])}
                      disabled={customAiTags.length === 0}
                      className="p-2 text-text-secondary hover:text-red-400 hover:bg-surface rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:text-text-secondary disabled:hover:bg-transparent"
                      data-tooltip={t('settings.tagging.clearCustomTooltip')}
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                </div>
              ),
            },
          ],
        },
        {
          id: 'clear-tags',
          rows: [
            {
              id: 'clear-ai-tags',
              label: t('settings.tagging.clearAiTagsTitle'),
              description: t('settings.tagging.clearAiTagsDesc'),
              control: (
                <ActionButton
                  disabled={rootPaths.length === 0}
                  icon={Trash2}
                  isProcessing={clearAiTags.isRunning}
                  onClick={handleClearAiTags}
                  text={t('settings.tagging.clearAiTagsButton')}
                />
              ),
              details: clearAiTags.message && <StatusMessage message={clearAiTags.message} />,
            },
            {
              id: 'clear-all-tags',
              label: t('settings.tagging.clearAllTagsTitle'),
              description: t('settings.tagging.clearAllTagsDesc'),
              control: (
                <ActionButton
                  disabled={rootPaths.length === 0}
                  icon={Trash2}
                  isProcessing={clearAllTags.isRunning}
                  onClick={handleClearAllTags}
                  text={t('settings.tagging.clearAiTagsButton')}
                />
              ),
              details: clearAllTags.message && <StatusMessage message={clearAllTags.message} />,
            },
          ],
        },
      ]}
    />
  );
}
