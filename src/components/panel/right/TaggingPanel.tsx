import { useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Plus, Tag, X } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import clsx from 'clsx';
import { toast } from 'react-toastify';
import { useTranslation } from 'react-i18next';

import { Invokes } from '../../ui/AppProperties';
import Text from '../../ui/Text';
import { useEditorStore } from '../../../store/useEditorStore';
import { useLibraryStore } from '../../../store/useLibraryStore';
import { TextColors, TextVariants, TextWeights } from '../../../types/typography';
import { isImageFlagTag } from '../../../utils/imageFlags';

const USER_TAG_PREFIX = 'user:';

const isEditableTag = (tag: string) => !tag.startsWith('color:') && !isImageFlagTag(tag);
const displayTag = (tag: string) => (tag.startsWith(USER_TAG_PREFIX) ? tag.slice(USER_TAG_PREFIX.length) : tag);

export default function TaggingPanel() {
  const { t } = useTranslation();
  const [tagInput, setTagInput] = useState('');
  const [isInputFocused, setIsInputFocused] = useState(false);
  const selectedImage = useEditorStore((state) => state.selectedImage);
  const multiSelectedPaths = useLibraryStore((state) => state.multiSelectedPaths);
  const imageList = useLibraryStore((state) => state.imageList);
  const setLibrary = useLibraryStore((state) => state.setLibrary);
  const targetPaths = multiSelectedPaths.length > 0 ? multiSelectedPaths : selectedImage ? [selectedImage.path] : [];
  const targetSet = useMemo(() => new Set(targetPaths), [targetPaths]);

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

  const addTag = async () => {
    const normalized = tagInput.trim().toLowerCase();
    if (!normalized || targetPaths.length === 0) return;
    const storedTag = `${USER_TAG_PREFIX}${normalized}`;
    try {
      await invoke(Invokes.AddTagForPaths, { paths: targetPaths, tag: storedTag });
      setLibrary((state) => ({
        imageList: state.imageList.map((image) => {
          if (!targetSet.has(image.path)) return image;
          const imageTags = image.tags || [];
          return imageTags.includes(storedTag) ? image : { ...image, tags: [...imageTags, storedTag].sort() };
        }),
      }));
      setTagInput('');
    } catch (error) {
      toast.error(t('editor.tagging.addFailed', { error: String(error) }));
    }
  };

  const removeTag = async (storedTag: string) => {
    try {
      await invoke(Invokes.RemoveTagForPaths, { paths: targetPaths, tag: storedTag });
      setLibrary((state) => ({
        imageList: state.imageList.map((image) => {
          if (!targetSet.has(image.path)) return image;
          const nextTags = (image.tags || []).filter((tag) => tag !== storedTag);
          return { ...image, tags: nextTags.length > 0 ? nextTags : null };
        }),
      }));
    } catch (error) {
      toast.error(t('editor.tagging.removeFailed', { error: String(error) }));
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 flex items-center gap-2 shrink-0 border-b border-surface">
        <Tag size={18} />
        <Text variant={TextVariants.title}>{t('editor.tagging.title')}</Text>
      </div>
      <div className="grow overflow-y-auto p-4 custom-scrollbar">
        {targetPaths.length > 0 ? (
          <div className="space-y-5">
            <Text variant={TextVariants.small} color={TextColors.secondary}>
              {t('editor.tagging.selectionCount', { count: targetPaths.length })}
            </Text>

            <div>
              <Text variant={TextVariants.heading} className="mb-3">
                {t('editor.tagging.currentTags')}
              </Text>
              <div className="flex flex-wrap gap-2">
                <AnimatePresence>
                  {tags.map((tag) => (
                    <motion.button
                      key={tag.storedTag}
                      layout
                      initial={{ opacity: 0, scale: 0.85 }}
                      animate={{ opacity: tag.common ? 1 : 0.65, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.85 }}
                      className={clsx(
                        'flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-left transition-colors',
                        tag.common
                          ? 'bg-surface border-surface hover:border-text-tertiary/50'
                          : 'bg-surface/50 border-dashed border-text-tertiary/40 hover:border-text-tertiary',
                      )}
                      onClick={() => removeTag(tag.storedTag)}
                      data-tooltip={
                        tag.common ? t('editor.tagging.removeTooltip') : t('editor.tagging.mixedTagTooltip')
                      }
                      type="button"
                    >
                      <Text as="span" variant={TextVariants.small} weight={TextWeights.medium}>
                        {tag.label}
                      </Text>
                      <X size={11} />
                    </motion.button>
                  ))}
                </AnimatePresence>
                {tags.length === 0 && (
                  <Text variant={TextVariants.small} color={TextColors.secondary} className="italic">
                    {t('editor.tagging.noTags')}
                  </Text>
                )}
              </div>
            </div>

            <div>
              <Text variant={TextVariants.heading} className="mb-3">
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
            </div>
          </div>
        ) : (
          <Text
            variant={TextVariants.heading}
            color={TextColors.secondary}
            weight={TextWeights.normal}
            className="text-center mt-4"
          >
            {t('editor.ai.noImageSelected')}
          </Text>
        )}
      </div>
    </div>
  );
}
