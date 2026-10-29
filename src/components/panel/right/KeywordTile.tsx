import { useMemo } from 'react';
import clsx from 'clsx';

import Text from '../../ui/Text';
import { useLibraryStore } from '../../../store/useLibraryStore';
import { TextColors, TextVariants, TextWeights } from '../../../types/typography';
import { USER_TAG_PREFIX, formatKeyword } from '../../../utils/keywords';

/** How many of the target images carry each user keyword tag. */
export function useAppliedKeywordCounts(targetPaths: string[]) {
  const imageList = useLibraryStore((state) => state.imageList);
  return useMemo(() => {
    const targets = new Set(targetPaths);
    const counts = new Map<string, number>();
    for (const image of imageList) {
      if (!targets.has(image.path)) continue;
      for (const tag of image.tags || []) {
        if (tag.startsWith(USER_TAG_PREFIX)) counts.set(tag, (counts.get(tag) || 0) + 1);
      }
    }
    return counts;
  }, [imageList, targetPaths]);
}

interface KeywordTileProps {
  appliedCounts: Map<string, number>;
  keyword: string;
  label?: string;
  onToggle(keyword: string): void;
  targetCount: number;
}

/** A keyword toggle: accent when every target image has it, dashed when some do. */
export default function KeywordTile({ appliedCounts, keyword, label, onToggle, targetCount }: KeywordTileProps) {
  const count = keyword ? appliedCounts.get(`${USER_TAG_PREFIX}${keyword}`) || 0 : 0;
  const isApplied = targetCount > 0 && count === targetCount;
  return (
    <button
      className={clsx(
        'relative h-12 rounded-md border px-2 text-left transition-colors disabled:cursor-not-allowed',
        label && 'pb-3',
        isApplied
          ? 'bg-accent/20 border-accent'
          : count > 0
            ? 'bg-surface/50 border-dashed border-text-tertiary/60 hover:border-text-tertiary'
            : 'bg-surface border-surface hover:border-text-tertiary/50',
        !keyword && 'opacity-40',
      )}
      data-tooltip={keyword ? formatKeyword(keyword) : undefined}
      disabled={!keyword || targetCount === 0}
      onClick={() => onToggle(keyword)}
      type="button"
    >
      <Text as="span" variant={TextVariants.small} weight={TextWeights.medium} className="block truncate">
        {keyword ? formatKeyword(keyword) : '—'}
      </Text>
      {label && (
        <Text
          as="span"
          variant={TextVariants.small}
          color={TextColors.secondary}
          className="absolute bottom-0.5 right-1.5 text-[10px]"
        >
          {label}
        </Text>
      )}
    </button>
  );
}
