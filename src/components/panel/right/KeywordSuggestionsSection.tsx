import { useMemo } from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import Text from '../../ui/Text';
import KeywordTile, { useAppliedKeywordCounts } from './KeywordTile';
import TaggingSection from './TaggingSection';
import { useAiKeywordSuggestions } from '../../../hooks/useAiKeywordSuggestions';
import { useLibraryActions } from '../../../hooks/useLibraryActions';
import { useLibraryStore } from '../../../store/useLibraryStore';
import { TextColors, TextVariants } from '../../../types/typography';
import { suggestKeywords } from '../../../utils/keywordSuggestions';
import { KEYWORD_SET_SIZE } from '../../../utils/keywords';

interface KeywordSuggestionsSectionProps {
  activePath: string | null;
  targetPaths: string[];
}

export default function KeywordSuggestionsSection({ activePath, targetPaths }: KeywordSuggestionsSectionProps) {
  const { t } = useTranslation();
  const imageList = useLibraryStore((state) => state.imageList);
  const { handleToggleKeyword } = useLibraryActions();
  const appliedCounts = useAppliedKeywordCounts(targetPaths);
  const ai = useAiKeywordSuggestions(activePath);

  const suggestions = useMemo(
    () => suggestKeywords({ activePath, imageList, limit: KEYWORD_SET_SIZE, targetPaths }),
    [activePath, imageList, targetPaths],
  );

  const renderTiles = (keywords: string[]) => (
    <div className="grid grid-cols-3 gap-1.5">
      {keywords.map((keyword) => (
        <KeywordTile
          appliedCounts={appliedCounts}
          key={keyword}
          keyword={keyword}
          onToggle={(toggled) => handleToggleKeyword(toggled, targetPaths)}
          targetCount={targetPaths.length}
        />
      ))}
    </div>
  );

  return (
    <>
      <TaggingSection id="suggestions" title={t('editor.tagging.suggestions')}>
        {suggestions.length > 0 ? (
          renderTiles(suggestions)
        ) : (
          <Text variant={TextVariants.small} color={TextColors.secondary} className="italic">
            {t('editor.tagging.noSuggestions')}
          </Text>
        )}
      </TaggingSection>

      <TaggingSection id="aiSuggestions" title={t('editor.tagging.aiSuggestions')}>
        <div className="space-y-2">
          <button
            className="w-full h-9 flex items-center justify-center gap-2 rounded-md bg-bg-primary border border-transparent text-sm text-text-primary hover:border-text-tertiary/50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            data-tooltip={t('editor.tagging.suggestWithAiTooltip')}
            disabled={!activePath || ai.isLoading}
            onClick={() => void ai.requestSuggestions()}
            type="button"
          >
            {ai.isLoading ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
            {t('editor.tagging.suggestWithAi')}
          </button>
          {ai.suggestions &&
            (ai.suggestions.length > 0 ? (
              renderTiles(ai.suggestions)
            ) : (
              <Text variant={TextVariants.small} color={TextColors.secondary} className="italic">
                {t('editor.tagging.noAiSuggestions')}
              </Text>
            ))}
        </div>
      </TaggingSection>
    </>
  );
}
