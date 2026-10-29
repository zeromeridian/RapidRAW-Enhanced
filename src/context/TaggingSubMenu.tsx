import { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Loader2, Plus, Sparkles, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { Invokes } from '../components/ui/AppProperties';
import { useAiKeywordSuggestions } from '../hooks/useAiKeywordSuggestions';
import Text from '../components/ui/Text';
import { TextVariants } from '../types/typography';
import { USER_TAG_PREFIX, formatKeyword, getActiveKeywordSet, parseKeywordInput } from '../utils/keywords';

interface TaggingSubMenuProps {
  paths: string[];
  initialTags: { tag: string; isUser: boolean }[];
  onTagsChanged: (paths: string[], newTags: { tag: string; isUser: boolean }[]) => void;
  appSettings: any;
  hideContextMenu: () => void;
}

const tagVariants = {
  visible: { opacity: 1, scale: 1, transition: { type: 'spring', stiffness: 500, damping: 30 } },
  exit: { opacity: 0, scale: 0.8, transition: { duration: 0.15 } },
};

export default function TaggingSubMenu({
  paths,
  initialTags,
  onTagsChanged,
  appSettings,
  hideContextMenu,
}: TaggingSubMenuProps) {
  const { t } = useTranslation();
  const [tags, setTags] = useState<{ tag: string; isUser: boolean }[]>(initialTags);
  const [inputValue, setInputValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTags(initialTags);
  }, [initialTags]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleAddTag = (input: string) => addKeyword(parseKeywordInput(input));

  const addKeyword = async (newTagValue: string) => {
    if (newTagValue && !tags.some((t) => t.tag === newTagValue)) {
      try {
        const prefixedTag = `${USER_TAG_PREFIX}${newTagValue}`;
        await invoke(Invokes.AddTagForPaths, { paths, tag: prefixedTag });
        const newTags = [...tags, { tag: newTagValue, isUser: true }].sort((a, b) => a.tag.localeCompare(b.tag));
        setTags(newTags);
        onTagsChanged(paths, newTags);
        setInputValue('');
      } catch (err) {
        console.error(`Failed to add tag: ${err}`);
      }
    }
  };

  const handleRemoveTag = async (tagToRemove: { tag: string; isUser: boolean }) => {
    try {
      const prefixedTag = tagToRemove.isUser ? `${USER_TAG_PREFIX}${tagToRemove.tag}` : tagToRemove.tag;
      await invoke(Invokes.RemoveTagForPaths, { paths, tag: prefixedTag });
      const newTags = tags.filter((t) => t.tag !== tagToRemove.tag);
      setTags(newTags);
      onTagsChanged(paths, newTags);
    } catch (err) {
      console.error(`Failed to remove tag: ${err}`);
    }
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddTag(inputValue);
    }
    if (e.key === 'Escape') {
      hideContextMenu();
    }
  };

  const keywordSet = getActiveKeywordSet(appSettings);
  const shortcuts = keywordSet?.keywords.filter(Boolean) ?? [];
  const ai = useAiKeywordSuggestions(paths[0] ?? null);

  return (
    <div
      className="bg-surface/95 p-2 w-64 text-text-primary rounded-lg"
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="mb-2">
        <div className="flex flex-wrap gap-1 p-1 bg-surface rounded-md min-h-[32px] items-center">
          <AnimatePresence>
            {tags.length > 0 ? (
              tags.map((tagItem) => (
                <motion.div
                  key={tagItem.tag}
                  layout
                  variants={tagVariants}
                  initial={false}
                  animate="visible"
                  exit="exit"
                  onClick={() => handleRemoveTag(tagItem)}
                  data-tooltip={t('menus.tagging.removeTooltip', { tag: formatKeyword(tagItem.tag) })}
                  className="flex items-center gap-1 bg-bg-primary text-text-primary text-xs font-medium px-2 py-1 rounded-sm group cursor-pointer"
                >
                  <span>{formatKeyword(tagItem.tag)}</span>
                  <span className="rounded-full group-hover:bg-black/20 p-0.5 transition-colors">
                    <X size={12} />
                  </span>
                </motion.div>
              ))
            ) : (
              <motion.span
                key="no-tags-placeholder"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="p-1 select-none"
              >
                <Text variant={TextVariants.small} className="italic">
                  {t('menus.tagging.noTags')}
                </Text>
              </motion.span>
            )}
          </AnimatePresence>
        </div>
      </div>

      <div className="relative mb-2">
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleInputKeyDown}
          placeholder={t('menus.tagging.placeholder')}
          className="w-full bg-surface border border-border-color rounded-md pl-2 pr-8 py-1.5 text-sm focus:outline-hidden"
        />
        <button
          onClick={() => handleAddTag(inputValue)}
          className="absolute right-1 top-1/2 -translate-y-1/2 p-1 rounded-full text-text-secondary hover:text-text-primary hover:bg-surface"
          data-tooltip={t('menus.tagging.addTagTooltip')}
        >
          <Plus size={16} />
        </button>
      </div>

      {shortcuts.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-text-primary px-1 py-1">{keywordSet?.name}</p>
          <div className="flex flex-wrap gap-1">
            {shortcuts.map((shortcut: string) => (
              <button
                key={shortcut}
                onClick={() => addKeyword(shortcut)}
                className="bg-surface text-text-secondary hover:bg-card-active hover:text-text-primary text-xs font-medium px-2 py-1 rounded-sm"
              >
                {formatKeyword(shortcut)}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="mt-2">
        <button
          className="flex items-center gap-1 text-xs font-medium text-text-secondary hover:text-text-primary px-1 py-1 disabled:opacity-40"
          disabled={paths.length === 0 || ai.isLoading}
          onClick={() => void ai.requestSuggestions()}
          type="button"
        >
          {ai.isLoading ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
          {t('editor.tagging.suggestWithAi')}
        </button>
        {ai.suggestions && (
          <div className="flex flex-wrap gap-1">
            {ai.suggestions.length > 0 ? (
              ai.suggestions.map((keyword) => (
                <button
                  key={keyword}
                  onClick={() => addKeyword(keyword)}
                  className="bg-surface text-text-secondary hover:bg-card-active hover:text-text-primary text-xs font-medium px-2 py-1 rounded-sm"
                >
                  {formatKeyword(keyword)}
                </button>
              ))
            ) : (
              <Text variant={TextVariants.small} className="italic px-1">
                {t('editor.tagging.noAiSuggestions')}
              </Text>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
