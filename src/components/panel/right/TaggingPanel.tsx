import { useMemo, useState } from 'react';
import { Plus, Tag, X } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import clsx from 'clsx';
import { toast } from 'react-toastify';
import { useTranslation } from 'react-i18next';

import KeywordListSection from './KeywordListSection';
import KeywordSetSection from './KeywordSetSection';
import KeywordSuggestionsSection from './KeywordSuggestionsSection';
import TaggingSection from './TaggingSection';
import Text from '../../ui/Text';
import PanelHeader from '../../ui/PanelHeader';
import { useLibraryActions } from '../../../hooks/useLibraryActions';
import { useEditorStore } from '../../../store/useEditorStore';
import { useLibraryStore } from '../../../store/useLibraryStore';
import { TextColors, TextVariants, TextWeights } from '../../../types/typography';
import { isImageFlagTag } from '../../../utils/imageFlags';
import { USER_TAG_PREFIX, formatKeyword, parseKeywordInput } from '../../../utils/keywords';

const isEditableTag = (tag: string) => !tag.startsWith('color:') && !isImageFlagTag(tag);
const displayTag = (tag: string) =>
  formatKeyword(tag.startsWith(USER_TAG_PREFIX) ? tag.slice(USER_TAG_PREFIX.length) : tag);

interface TaggingPanelProps {
  // Shown next to the library grid, which has no panel switcher to close it with
  onClose?(): void;
}

export default function TaggingPanel({ onClose }: TaggingPanelProps) {
  const { t } = useTranslation();
  const [tagInput, setTagInput] = useState('');
  const [isInputFocused, setIsInputFocused] = useState(false);
  const selectedImage = useEditorStore((state) => state.selectedImage);
  const multiSelectedPaths = useLibraryStore((state) => state.multiSelectedPaths);
  const imageList = useLibraryStore((state) => state.imageList);
  const libraryActivePath = useLibraryStore((state) => state.libraryActivePath);
  const activePath = selectedImage?.path ?? libraryActivePath ?? multiSelectedPaths[0] ?? null;
  const targetPaths = useMemo(
    () => (multiSelectedPaths.length > 0 ? multiSelectedPaths : activePath ? [activePath] : []),
    [multiSelectedPaths, activePath],
  );
  const { handleSetTag } = useLibraryActions();

  const tags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const path of targetPaths) {
      const imageTags = imageList.find((image) => image.path === path)?.tags || [];
      new Set(imageTags.filter(isEditableTag)).forEach((tag) => counts.set(tag, (counts.get(tag) || 0) + 1));
    }
    return [...counts.entries()]
      .map(([storedTag, count]) => ({
        storedTag,
        label: displayTag(storedTag),
        common: count === targetPaths.length,
      }))
      .sort((left, right) => left.label.localeCompare(right.label));
  }, [imageList, targetPaths]);
  const userTags = tags.filter((tag) => tag.storedTag.startsWith(USER_TAG_PREFIX));
  const aiTags = tags.filter((tag) => !tag.storedTag.startsWith(USER_TAG_PREFIX));

  const setTag = async (storedTag: string, apply: boolean) => {
    try {
      await handleSetTag(storedTag, targetPaths, apply);
      return true;
    } catch (error) {
      toast.error(t('editor.tagging.updateFailed', { error: String(error) }));
      return false;
    }
  };

  const addTag = async () => {
    const normalized = parseKeywordInput(tagInput);
    if (normalized && (await setTag(`${USER_TAG_PREFIX}${normalized}`, true))) setTagInput('');
  };

  const renderTagChips = (chips: typeof tags) => (
    <div className="flex flex-wrap gap-2">
      <AnimatePresence>
        {chips.map((tag) => (
          <motion.div
            key={tag.storedTag}
            layout
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: tag.common ? 1 : 0.65, scale: 1 }}
            exit={{ opacity: 0, scale: 0.85 }}
            className={clsx(
              'flex items-center rounded-md border bg-bg-primary transition-colors',
              tag.common ? 'border-transparent' : 'border-dashed border-text-tertiary/60',
            )}
          >
            <button
              className="pl-2.5 pr-1 py-1.5 compact:py-1 text-left disabled:cursor-default"
              data-tooltip={tag.common ? undefined : t('editor.tagging.mixedTagTooltip')}
              disabled={tag.common}
              onClick={() => void setTag(tag.storedTag, true)}
              type="button"
            >
              <Text as="span" variant={TextVariants.small} weight={TextWeights.medium}>
                {tag.label}
              </Text>
            </button>
            <button
              className="pr-2 pl-1 py-1.5 compact:py-1 text-text-secondary hover:text-red-400 transition-colors"
              data-tooltip={t('editor.tagging.removeTooltip')}
              onClick={() => void setTag(tag.storedTag, false)}
              type="button"
            >
              <X size={11} />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );

  return (
    <div className="flex flex-col h-full">
      <PanelHeader
        icon={<Tag size={18} />}
        title={t('editor.tagging.title')}
        actions={
          onClose && (
            <button
              className="p-1 rounded-md text-text-secondary hover:text-text-primary hover:bg-surface transition-colors"
              onClick={onClose}
              type="button"
            >
              <X size={18} />
            </button>
          )
        }
      />
      <div className="grow overflow-y-auto p-4 compact:p-2.5 custom-scrollbar">
        {targetPaths.length > 0 ? (
          <div className="space-y-3 compact:space-y-2">
            <Text variant={TextVariants.small} color={TextColors.secondary}>
              {t('editor.tagging.selectionCount', { count: targetPaths.length })}
            </Text>

            <div>
              <Text variant={TextVariants.heading} className="mb-3 compact:mb-1.5 compact:text-sm">
                {t('editor.tagging.addTag')}
              </Text>
              <div
                className={clsx(
                  'flex items-center bg-bg-primary border rounded-md px-3 py-2 transition-colors',
                  isInputFocused ? 'border-accent' : 'border-surface',
                )}
              >
                <input
                  type="text"
                  value={tagInput}
                  onChange={(event) => setTagInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      void addTag();
                    }
                    event.stopPropagation();
                  }}
                  onFocus={() => setIsInputFocused(true)}
                  onBlur={() => setIsInputFocused(false)}
                  placeholder={t('editor.tagging.placeholder')}
                  className="bg-transparent border-none outline-hidden text-sm w-full text-text-primary placeholder-text-tertiary"
                />
                <button
                  className="text-text-secondary hover:text-accent disabled:opacity-30 transition-colors"
                  disabled={!tagInput.trim()}
                  onClick={() => void addTag()}
                  type="button"
                >
                  <Plus size={16} />
                </button>
              </div>
              <Text variant={TextVariants.small} color={TextColors.secondary} className="mt-2">
                {t('editor.tagging.hierarchyHint')}
              </Text>
            </div>

            <TaggingSection id="currentTags" title={t('editor.tagging.keywordsCount', { count: userTags.length })}>
              {userTags.length > 0 ? (
                renderTagChips(userTags)
              ) : (
                <Text variant={TextVariants.small} color={TextColors.secondary} className="italic">
                  {t('editor.tagging.noTags')}
                </Text>
              )}
            </TaggingSection>

            {aiTags.length > 0 && (
              <TaggingSection id="currentAiTags" title={t('editor.tagging.aiTagsCount', { count: aiTags.length })}>
                {renderTagChips(aiTags)}
              </TaggingSection>
            )}

            <KeywordSuggestionsSection activePath={activePath} targetPaths={targetPaths} />

            <KeywordSetSection targetPaths={targetPaths} />

            <KeywordListSection targetPaths={targetPaths} />
          </div>
        ) : (
          <div className="space-y-3 compact:space-y-2">
            <Text
              variant={TextVariants.heading}
              color={TextColors.secondary}
              weight={TextWeights.normal}
              className="text-center my-4"
            >
              {t('editor.ai.noImageSelected')}
            </Text>
            <KeywordListSection targetPaths={targetPaths} />
          </div>
        )}
      </div>
    </div>
  );
}
