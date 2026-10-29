import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'react-toastify';
import { useTranslation } from 'react-i18next';

import { Invokes } from '../components/ui/AppProperties';
import { useLibraryStore } from '../store/useLibraryStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { collectUserKeywords } from '../utils/keywordSuggestions';
import { getKeywordSets } from '../utils/keywords';

// AI suggestions per image path for this session, so reopening an image does not rerun CLIP.
const aiSuggestionCache = new Map<string, string[]>();

/** AI keyword suggestions for one image, computed only when requested. */
export function useAiKeywordSuggestions(path: string | null) {
  const { t } = useTranslation();
  const [suggestions, setSuggestions] = useState<string[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const currentPathRef = useRef(path);

  useEffect(() => {
    currentPathRef.current = path;
    setSuggestions(path ? (aiSuggestionCache.get(path) ?? null) : null);
    setIsLoading(false);
  }, [path]);

  const requestSuggestions = useCallback(async () => {
    if (!path) return;
    const keywordSetKeywords = getKeywordSets(useSettingsStore.getState().appSettings).flatMap((set) => set.keywords);
    const userKeywords = collectUserKeywords(useLibraryStore.getState().imageList, keywordSetKeywords);
    setIsLoading(true);
    try {
      const result = await invoke<string[]>(Invokes.SuggestAiKeywords, { path, userKeywords });
      aiSuggestionCache.set(path, result);
      if (currentPathRef.current === path) setSuggestions(result);
    } catch (error) {
      toast.error(t('editor.tagging.aiSuggestionsFailed', { error: String(error) }));
    } finally {
      if (currentPathRef.current === path) setIsLoading(false);
    }
  }, [path, t]);

  return { suggestions, isLoading, requestSuggestions };
}
