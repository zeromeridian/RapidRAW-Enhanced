import { useMemo, useState } from 'react';
import { Check, ChevronRight, Loader2, Minus, Search } from 'lucide-react';
import clsx from 'clsx';
import { toast } from 'react-toastify';
import { useTranslation } from 'react-i18next';

import Text from '../../ui/Text';
import TaggingSection from './TaggingSection';
import { useAppliedKeywordCounts } from './KeywordTile';
import { useKeywordIndex } from '../../../hooks/useKeywordIndex';
import { useLibraryActions } from '../../../hooks/useLibraryActions';
import { useLibraryStore } from '../../../store/useLibraryStore';
import { useUIStore } from '../../../store/useUIStore';
import { TextColors, TextVariants, TextWeights } from '../../../types/typography';
import { KeywordTreeNode, USER_TAG_PREFIX, buildKeywordTree, filterKeywordTree } from '../../../utils/keywords';

const AI_GROUP_SECTION = 'keywordListAi';
const INDENT_PX = 12;

interface KeywordListSectionProps {
  targetPaths: string[];
}

/** Every keyword in the library: tick to tag the selected images, click a name to show its images. */
export default function KeywordListSection({ targetPaths }: KeywordListSectionProps) {
  const { t } = useTranslation();
  const { keywords, aiTags, isScanning } = useKeywordIndex();
  const appliedCounts = useAppliedKeywordCounts(targetPaths);
  const { handleSetTag } = useLibraryActions();
  const activeKeyword = useLibraryStore((state) => state.activeKeyword);
  const keywordSelectHandler = useUIStore((state) => state.keywordSelectHandler);
  const isAiGroupOpen = useUIStore((state) => state.taggingSectionsOpen[AI_GROUP_SECTION] ?? false);
  const toggleTaggingSection = useUIStore((state) => state.toggleTaggingSection);
  const [query, setQuery] = useState('');
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());

  const tree = useMemo(() => filterKeywordTree(buildKeywordTree(keywords), query), [keywords, query]);
  const visibleAiTags = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return aiTags
      .filter(({ keyword }) => keyword.toLowerCase().includes(needle))
      .sort((left, right) => left.keyword.localeCompare(right.keyword));
  }, [aiTags, query]);

  const toggleTag = async (tag: string) => {
    const isApplied = (appliedCounts.get(tag) || 0) === targetPaths.length;
    try {
      await handleSetTag(tag, targetPaths, !isApplied);
    } catch (error) {
      toast.error(t('editor.tagging.updateFailed', { error: String(error) }));
    }
  };

  const toggleExpanded = (path: string) =>
    setExpandedPaths((current) => {
      const next = new Set(current);
      if (!next.delete(path)) next.add(path);
      return next;
    });

  const renderRow = (tag: string, name: string, count: number, depth: number, expander?: React.ReactNode) => {
    const appliedCount = appliedCounts.get(tag) || 0;
    const isApplied = targetPaths.length > 0 && appliedCount === targetPaths.length;
    return (
      <div className="flex items-center gap-1.5 h-7" style={{ paddingLeft: depth * INDENT_PX }}>
        <div className="w-4 shrink-0 flex justify-center">{expander}</div>
        <button
          aria-checked={isApplied ? 'true' : appliedCount > 0 ? 'mixed' : 'false'}
          className={clsx(
            'w-3.5 h-3.5 shrink-0 rounded-sm border flex items-center justify-center transition-colors disabled:opacity-40',
            appliedCount > 0
              ? 'bg-accent border-accent text-button-text'
              : 'border-text-tertiary hover:border-text-secondary',
          )}
          data-tooltip={t('editor.tagging.keywordCheckboxTooltip')}
          disabled={targetPaths.length === 0}
          onClick={() => void toggleTag(tag)}
          role="checkbox"
          type="button"
        >
          {isApplied ? <Check size={10} strokeWidth={3} /> : appliedCount > 0 && <Minus size={10} strokeWidth={3} />}
        </button>
        <button
          className={clsx(
            'grow min-w-0 text-left truncate text-sm transition-colors hover:text-accent',
            activeKeyword === tag ? 'text-accent' : 'text-text-primary',
          )}
          data-tooltip={t('editor.tagging.showKeywordImages')}
          onClick={() => keywordSelectHandler?.(tag)}
          type="button"
        >
          {name}
        </button>
        {count > 0 && (
          <Text as="span" variant={TextVariants.small} color={TextColors.secondary} className="shrink-0">
            {count}
          </Text>
        )}
      </div>
    );
  };

  const renderNode = (node: KeywordTreeNode, depth: number): React.ReactNode => {
    const isExpanded = !!query.trim() || expandedPaths.has(node.path);
    const expander = node.children.length > 0 && (
      <button
        className="text-text-secondary hover:text-text-primary"
        onClick={() => toggleExpanded(node.path)}
        type="button"
      >
        <ChevronRight size={14} className={clsx('transition-transform', isExpanded && 'rotate-90')} />
      </button>
    );
    return (
      <div key={node.path}>
        {renderRow(`${USER_TAG_PREFIX}${node.path}`, node.name, node.count, depth, expander)}
        {isExpanded && node.children.map((child) => renderNode(child, depth + 1))}
      </div>
    );
  };

  return (
    <TaggingSection id="keywordList" title={t('editor.tagging.keywordList')}>
      <div className="space-y-3">
        <div className="flex items-center gap-2 bg-bg-primary rounded-md px-3 h-9">
          <Search size={14} className="text-text-tertiary shrink-0" />
          <input
            className="bg-transparent border-none outline-hidden text-sm w-full text-text-primary placeholder-text-tertiary"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => event.stopPropagation()}
            placeholder={t('editor.tagging.searchKeywords')}
            type="text"
            value={query}
          />
        </div>

        {isScanning && (
          <div className="flex items-center gap-2 text-text-secondary">
            <Loader2 size={12} className="animate-spin" />
            <Text as="span" variant={TextVariants.small} color={TextColors.secondary}>
              {t('editor.tagging.updatingKeywordList')}
            </Text>
          </div>
        )}

        <div>
          {tree.map((node) => renderNode(node, 0))}
          {tree.length === 0 && (
            <Text variant={TextVariants.small} color={TextColors.secondary} className="italic">
              {query.trim() ? t('editor.tagging.noKeywordMatches') : t('editor.tagging.noKeywords')}
            </Text>
          )}
        </div>

        {aiTags.length > 0 && (
          <div className="border-t border-bg-primary pt-3">
            <button
              className="w-full flex items-center gap-1.5 text-left"
              onClick={() => toggleTaggingSection(AI_GROUP_SECTION, false)}
              type="button"
            >
              <ChevronRight
                size={14}
                className={clsx('text-text-secondary transition-transform', isAiGroupOpen && 'rotate-90')}
              />
              <Text as="span" variant={TextVariants.small} weight={TextWeights.medium}>
                {t('editor.tagging.aiTags')}
              </Text>
              <Text as="span" variant={TextVariants.small} color={TextColors.secondary}>
                {aiTags.length}
              </Text>
            </button>
            {isAiGroupOpen && (
              <div className="mt-1">
                {visibleAiTags.map(({ keyword, count }) => (
                  <div key={keyword}>{renderRow(keyword, keyword, count, 0)}</div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </TaggingSection>
  );
}
