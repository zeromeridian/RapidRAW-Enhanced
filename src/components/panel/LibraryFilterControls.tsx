import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Check, Filter, ListChecks, Star, X } from 'lucide-react';
import clsx from 'clsx';
import { useShallow } from 'zustand/react/shallow';
import { useTranslation } from 'react-i18next';

import {
  EditedStatus,
  FilterCriteria,
  ImageFile,
  RATING_COMPARISON_SYMBOLS,
  RATING_COMPARISONS,
  RatingComparison,
  RawStatus,
} from '../ui/AppProperties';
import { useEditorStore } from '../../store/useEditorStore';
import { useLibraryStore } from '../../store/useLibraryStore';
import { useUIStore } from '../../store/useUIStore';
import { useLibraryActions } from '../../hooks/useLibraryActions';
import { COLOR_LABELS } from '../../utils/adjustments';
import { IMAGE_FLAG_FILTER_OPTIONS } from '../../utils/imageFlags';
import { ImageFlagIcon } from '../ui/ImageFlagBadge';
import { matchesLibraryFilter } from '../../utils/libraryFilters';

const ALL_COLOR_OPTIONS = [...COLOR_LABELS, { name: 'none', color: '#9ca3af' }];

const isRatingInRange = (rating: number, threshold: number, comparison: RatingComparison) =>
  threshold > 0 &&
  (comparison === 'atMost'
    ? rating <= threshold
    : comparison === 'exactly'
      ? rating === threshold
      : rating >= threshold);

type SelectByCriteria = Partial<FilterCriteria> & {
  rawKind?: 'dng' | 'otherRaw';
};

const isDngImage = (image: ImageFile) => image.is_raw && image.path.split('?')[0].toLocaleLowerCase().endsWith('.dng');

const matchesSelectByCriteria = (
  image: ImageFile,
  imageRatings: Record<string, number>,
  criteria: SelectByCriteria,
) => {
  const { rawKind, ...libraryCriteria } = criteria;
  const matchesSharedCriteria = matchesLibraryFilter(image, imageRatings, {
    colors: [],
    flags: [],
    rating: 0,
    ratingComparison: 'atLeast',
    rawStatus: RawStatus.All,
    editedStatus: EditedStatus.All,
    ...libraryCriteria,
  });
  if (!matchesSharedCriteria || !rawKind) return matchesSharedCriteria;
  const isDng = isDngImage(image);
  return rawKind === 'dng' ? isDng : image.is_raw && !isDng;
};

// The toggle button (`w-8`) plus the open row's `ml-1` and `pr-2`, and a separator with its `gap-2`.
const TOGGLE_WIDTH = 32;
const OPEN_ROW_PADDING = 12;
const SEPARATOR_WIDTH = 17;

interface ExpandableControlProps {
  /** Keep the row open and the toggle inert, because there is room for it. */
  forceExpanded?: boolean;
  /** Reports the control's width when open, which is the same whether or not it is open. */
  onExpandedWidthChange?(width: number): void;
}

/** Ref for an expandable row's content, whose natural width is reported as the control's open width. */
function useExpandedWidth(onExpandedWidthChange?: (width: number) => void) {
  const contentRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content || !onExpandedWidthChange) return;
    // The nowrap content keeps its natural width even inside the collapsed `max-w-0` row.
    const report = () => onExpandedWidthChange(TOGGLE_WIDTH + OPEN_ROW_PADDING + content.offsetWidth);
    report();
    const observer = new ResizeObserver(report);
    observer.observe(content);
    return () => observer.disconnect();
  }, [onExpandedWidthChange]);
  return contentRef;
}

/** Localized name of a color label, or of the "no label" choice. */
function useColorLabel() {
  const { t } = useTranslation();
  return useCallback(
    (name: string) =>
      name === 'none'
        ? t('library.header.viewOptions.noLabel')
        : t(`contextMenus.colors.${name}`, {
            defaultValue: name.charAt(0).toUpperCase() + name.slice(1),
          }),
    [t],
  );
}

/** Quick Filter: an expanding row that edits the Library's shared filter criteria. */
export function QuickFilterControl({ forceExpanded = false, onExpandedWidthChange }: ExpandableControlProps) {
  const { t } = useTranslation();
  const contentRef = useExpandedWidth(onExpandedWidthChange);
  const getColorLabel = useColorLabel();
  const { filterCriteria, setFilterCriteria } = useLibraryStore(
    useShallow((state) => ({
      filterCriteria: state.filterCriteria,
      setFilterCriteria: state.setFilterCriteria,
    })),
  );
  const { setUI, isToggledOpen } = useUIStore(
    useShallow((state) => ({
      setUI: state.setUI,
      isToggledOpen: Boolean(state.uiVisibility.quickFilter),
    })),
  );
  const isFilterExpanded = forceExpanded || isToggledOpen;

  const toggleQuickFilter = () => {
    setUI((s) => ({
      uiVisibility: {
        ...s.uiVisibility,
        quickFilter: !s.uiVisibility.quickFilter,
      },
    }));
  };

  const hasActiveFilters =
    filterCriteria.rating !== 0 ||
    filterCriteria.rawStatus !== RawStatus.All ||
    filterCriteria.editedStatus !== EditedStatus.All ||
    (filterCriteria.colors || []).length > 0 ||
    (filterCriteria.flags || []).length > 0;
  const clearFilters = () =>
    setFilterCriteria((previous) => ({
      ...previous,
      rating: 0,
      ratingComparison: 'atLeast',
      rawStatus: RawStatus.All,
      editedStatus: EditedStatus.All,
      colors: [],
      flags: [],
    }));

  return (
    <div
      className={clsx(
        'flex items-center transition-all duration-300',
        isFilterExpanded ? 'bg-surface rounded-md' : 'bg-transparent',
      )}
    >
      <button
        className={clsx(
          'relative w-8 h-8 flex items-center justify-center rounded-md transition-colors shrink-0',
          forceExpanded
            ? 'cursor-default text-text-secondary'
            : isFilterExpanded
              ? 'text-text-primary'
              : hasActiveFilters
                ? 'bg-card-active text-accent'
                : 'text-text-secondary hover:bg-surface hover:text-text-primary',
        )}
        disabled={forceExpanded}
        onClick={toggleQuickFilter}
        data-tooltip={t('ui.bottomBar.tooltips.quickFilter', 'Quick Filter')}
      >
        <Filter size={18} />
        {hasActiveFilters && !isFilterExpanded && (
          <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-accent" />
        )}
      </button>

      <div
        className={clsx(
          'flex items-center transition-all duration-300 ease-in-out overflow-hidden',
          isFilterExpanded ? 'max-w-[52rem] opacity-100 pr-2 ml-1' : 'max-w-0 opacity-0 pr-0 ml-0',
        )}
      >
        <div ref={contentRef} className="flex items-center gap-3 whitespace-nowrap">
          <button
            type="button"
            onClick={clearFilters}
            disabled={!hasActiveFilters}
            className={clsx(
              'flex h-6 w-6 items-center justify-center rounded-sm transition-colors',
              hasActiveFilters
                ? 'text-text-secondary hover:bg-card-active hover:text-text-primary'
                : 'cursor-default text-text-secondary/30',
            )}
            data-tooltip={t('library.header.activeFilters.clearAll')}
          >
            <X size={15} />
          </button>

          <div className="h-4 w-px bg-border-color"></div>

          <div className="flex items-center gap-0.5">
            <button
              type="button"
              onClick={() => setFilterCriteria((prev) => ({ ...prev, rating: prev.rating === -1 ? 0 : -1 }))}
              className={clsx(
                'flex h-6 min-w-6 items-center justify-center rounded-sm px-1 text-xs transition-colors',
                filterCriteria.rating === -1
                  ? 'bg-card-active text-accent'
                  : 'text-text-secondary hover:bg-card-active hover:text-text-primary',
              )}
              data-tooltip={t('library.filters.rating.unrated')}
            >
              0
            </button>
            {RATING_COMPARISONS.map((comparison) => (
              <button
                key={`qf-rating-${comparison}`}
                type="button"
                onClick={() =>
                  setFilterCriteria((prev) => ({
                    ...prev,
                    ratingComparison: comparison,
                  }))
                }
                className={clsx(
                  'flex h-6 min-w-6 items-center justify-center rounded-sm px-1 text-xs font-semibold transition-colors',
                  (filterCriteria.ratingComparison ?? 'atLeast') === comparison
                    ? 'bg-card-active text-accent'
                    : 'text-text-secondary hover:bg-card-active hover:text-text-primary',
                )}
                data-tooltip={`${RATING_COMPARISON_SYMBOLS[comparison]} 1–5`}
              >
                {RATING_COMPARISON_SYMBOLS[comparison]}
              </button>
            ))}
            {[1, 2, 3, 4, 5].map((starValue) => {
              const isFilled = isRatingInRange(
                starValue,
                filterCriteria.rating,
                filterCriteria.ratingComparison ?? 'atLeast',
              );
              return (
                <button
                  key={`qf-star-${starValue}`}
                  onClick={() =>
                    setFilterCriteria((prev) => ({
                      ...prev,
                      rating: prev.rating === starValue ? 0 : starValue,
                    }))
                  }
                  className="p-0.5 focus:outline-none"
                  data-tooltip={`${RATING_COMPARISON_SYMBOLS[filterCriteria.ratingComparison ?? 'atLeast']} ${starValue}`}
                >
                  <Star
                    size={16}
                    className={clsx(
                      'transition-colors duration-150',
                      isFilled ? 'text-accent fill-accent' : 'text-text-secondary hover:text-accent',
                    )}
                  />
                </button>
              );
            })}
          </div>

          <div className="h-4 w-px bg-border-color"></div>

          <div className="flex items-center gap-1">
            {[
              { status: RawStatus.RawOnly, label: 'RAW', tooltip: t('library.filters.raw.rawOnly') },
              { status: RawStatus.NonRawOnly, label: 'IMG', tooltip: t('library.filters.raw.nonRawOnly') },
            ].map(({ status, label, tooltip }) => (
              <button
                key={status}
                type="button"
                onClick={() =>
                  setFilterCriteria((prev) => ({
                    ...prev,
                    rawStatus: prev.rawStatus === status ? RawStatus.All : status,
                  }))
                }
                className={clsx(
                  'h-6 rounded-sm px-1.5 text-[10px] font-semibold transition-colors',
                  filterCriteria.rawStatus === status
                    ? 'bg-card-active text-accent'
                    : 'text-text-secondary hover:bg-card-active hover:text-text-primary',
                )}
                data-tooltip={tooltip}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="h-4 w-px bg-border-color"></div>

          <div className="flex items-center gap-1">
            {[
              {
                status: EditedStatus.EditedOnly,
                label: 'EDIT',
                tooltip: t('library.filters.edited.editedOnly'),
              },
              {
                status: EditedStatus.UneditedOnly,
                label: 'ORIG',
                tooltip: t('library.filters.edited.uneditedOnly'),
              },
            ].map(({ status, label, tooltip }) => (
              <button
                key={status}
                type="button"
                onClick={() =>
                  setFilterCriteria((prev) => ({
                    ...prev,
                    editedStatus: prev.editedStatus === status ? EditedStatus.All : status,
                  }))
                }
                className={clsx(
                  'h-6 rounded-sm px-1.5 text-[10px] font-semibold transition-colors',
                  filterCriteria.editedStatus === status
                    ? 'bg-card-active text-accent'
                    : 'text-text-secondary hover:bg-card-active hover:text-text-primary',
                )}
                data-tooltip={tooltip}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="h-4 w-px bg-border-color"></div>

          <div className="flex items-center gap-1.5">
            {ALL_COLOR_OPTIONS.map((color) => {
              const isSelected = (filterCriteria.colors || []).includes(color.name);
              return (
                <button
                  key={`qf-color-${color.name}`}
                  onClick={() => {
                    const currentColors = filterCriteria.colors || [];
                    const newColors = currentColors.includes(color.name)
                      ? currentColors.filter((c) => c !== color.name)
                      : [...currentColors, color.name];
                    setFilterCriteria((prev) => ({ ...prev, colors: newColors }));
                  }}
                  className={clsx(
                    'w-4 h-4 rounded-full transition-transform hover:scale-105 flex items-center justify-center focus:outline-none',
                    isSelected ? 'ring-2 ring-accent ring-offset-1 ring-offset-bg-primary' : '',
                  )}
                  style={{ backgroundColor: color.color }}
                  data-tooltip={getColorLabel(color.name)}
                >
                  {isSelected && <Check size={10} className="text-white drop-shadow-md" />}
                </button>
              );
            })}
          </div>

          <div className="h-4 w-px bg-border-color"></div>

          <div className="flex items-center gap-1">
            {IMAGE_FLAG_FILTER_OPTIONS.map((flag) => {
              const isSelected = (filterCriteria.flags || []).includes(flag);
              return (
                <button
                  key={`qf-flag-${flag}`}
                  onClick={() => {
                    const currentFlags = filterCriteria.flags || [];
                    const flags = currentFlags.includes(flag)
                      ? currentFlags.filter((currentFlag) => currentFlag !== flag)
                      : [...currentFlags, flag];
                    setFilterCriteria((prev) => ({ ...prev, flags }));
                  }}
                  className={clsx(
                    'flex h-6 w-6 items-center justify-center rounded-sm transition-colors',
                    isSelected
                      ? 'bg-card-active text-text-primary'
                      : 'text-text-secondary hover:bg-card-active hover:text-text-primary',
                  )}
                  data-tooltip={t(`flags.${flag}`)}
                >
                  <ImageFlagIcon flag={flag} size={15} />
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Select by: an expanding row that selects every loaded image matching one filter criterion,
 * without changing the Library's filters.
 */
export function SelectByControl({ forceExpanded = false, onExpandedWidthChange }: ExpandableControlProps) {
  const { t } = useTranslation();
  const contentRef = useExpandedWidth(onExpandedWidthChange);
  const getColorLabel = useColorLabel();
  const { handleClearSelection } = useLibraryActions();
  const isEditing = useEditorStore((state) => Boolean(state.selectedImage));
  const { libraryActivePath, allLibraryImages, imageRatings, multiSelectedPaths, setLibrary } = useLibraryStore(
    useShallow((state) => ({
      libraryActivePath: state.libraryActivePath,
      allLibraryImages: state.imageList,
      imageRatings: state.imageRatings,
      multiSelectedPaths: state.multiSelectedPaths,
      setLibrary: state.setLibrary,
    })),
  );
  const selectionClearRequest = useUIStore((state) => state.selectionClearRequest);

  const [isToggledOpen, setIsToggledOpen] = useState(false);
  const isSelectByOpen = forceExpanded || isToggledOpen;
  const [selectRatingComparison, setSelectRatingComparison] = useState<RatingComparison>('atLeast');
  const [activeSelectBy, setActiveSelectBy] = useState<{
    criteria: SelectByCriteria;
    id: string;
  } | null>(null);

  const selectByFileTypes = useMemo<
    Array<{ criteria: SelectByCriteria; id: string; label: string; shortLabel: string }>
  >(
    () => [
      {
        criteria: { rawKind: 'dng', rawStatus: RawStatus.RawOnly },
        id: 'dng',
        label: t('ui.bottomBar.selectBy.dngOnly'),
        shortLabel: 'DNG',
      },
      {
        criteria: { rawKind: 'otherRaw', rawStatus: RawStatus.RawOnly },
        id: 'other-raw',
        label: t('ui.bottomBar.selectBy.otherRawOnly'),
        shortLabel: 'RAW',
      },
      {
        criteria: { rawStatus: RawStatus.NonRawOnly },
        id: 'non-raw',
        label: t('library.filters.raw.nonRawOnly'),
        shortLabel: 'IMG',
      },
    ],
    [t],
  );

  const selectByGroups = useMemo(
    () => [
      {
        label: t('library.header.viewOptions.filterByRating'),
        options: [
          { id: 'rating-unrated', label: t('library.filters.rating.unrated'), criteria: { rating: -1 } },
          ...[1, 2, 3, 4, 5].map((rating) => ({
            id: `rating-${selectRatingComparison}-${rating}`,
            label: `${RATING_COMPARISON_SYMBOLS[selectRatingComparison]} ${rating}`,
            criteria: { rating, ratingComparison: selectRatingComparison },
          })),
        ],
      },
      {
        label: t('library.header.viewOptions.filterByFileType'),
        options: selectByFileTypes,
      },
      {
        label: t('library.header.viewOptions.filterByEdited', 'Edit status'),
        options: [
          {
            id: 'edited',
            label: t('library.filters.edited.editedOnly'),
            criteria: { editedStatus: EditedStatus.EditedOnly },
          },
          {
            id: 'unedited',
            label: t('library.filters.edited.uneditedOnly'),
            criteria: { editedStatus: EditedStatus.UneditedOnly },
          },
        ],
      },
      {
        label: t('library.header.viewOptions.filterByColorLabel'),
        options: ALL_COLOR_OPTIONS.map((color) => ({
          id: `color-${color.name}`,
          label: getColorLabel(color.name),
          criteria: { colors: [color.name] },
          color: color.color,
        })),
      },
      {
        label: t('library.header.viewOptions.filterByFlag'),
        options: IMAGE_FLAG_FILTER_OPTIONS.map((flag) => ({
          id: `flag-${flag}`,
          label: t(`flags.${flag}`),
          criteria: { flags: [flag] },
          flag,
        })),
      },
    ],
    [getColorLabel, selectByFileTypes, selectRatingComparison, t],
  );

  const selectByCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const group of selectByGroups) {
      for (const option of group.options) {
        counts.set(
          option.id,
          allLibraryImages.reduce(
            (count, image) =>
              count + (matchesSelectByCriteria(image, imageRatings || {}, option.criteria as SelectByCriteria) ? 1 : 0),
            0,
          ),
        );
      }
    }
    return counts;
  }, [allLibraryImages, imageRatings, selectByGroups]);
  const activeSelectByRatingMatch = activeSelectBy?.id.match(/^rating-(?:atLeast|exactly|atMost)-([1-5])$/);
  const activeSelectByRating = activeSelectByRatingMatch ? Number(activeSelectByRatingMatch[1]) : 0;

  const handleClearSelectBy = () => {
    setActiveSelectBy(null);
    if (isEditing) {
      handleClearSelection();
    } else {
      setLibrary({
        multiSelectedPaths: [],
        selectedFolderPaths: [],
        libraryActivePath: null,
        selectionAnchorPath: null,
      });
    }
  };

  const handleSelectBy = (id: string, criteriaOverrides: SelectByCriteria) => {
    if (activeSelectBy?.id === id) {
      handleClearSelectBy();
      return;
    }
    const criteria: SelectByCriteria = {
      colors: [],
      flags: [],
      rating: 0,
      ratingComparison: 'atLeast',
      rawStatus: RawStatus.All,
      editedStatus: EditedStatus.All,
      ...criteriaOverrides,
    };
    const paths = allLibraryImages
      .filter((image) => matchesSelectByCriteria(image, imageRatings || {}, criteria))
      .map((image) => image.path);
    const activePath = libraryActivePath && paths.includes(libraryActivePath) ? libraryActivePath : paths[0] || null;
    setLibrary({
      multiSelectedPaths: paths,
      selectedFolderPaths: [],
      libraryActivePath: activePath,
      selectionAnchorPath: activePath,
    });
    setActiveSelectBy({ criteria: criteriaOverrides, id });
  };

  useEffect(() => {
    if (!activeSelectBy) return;
    const expectedPaths = new Set(
      allLibraryImages
        .filter((image) => matchesSelectByCriteria(image, imageRatings || {}, activeSelectBy.criteria))
        .map((image) => image.path),
    );
    if (
      expectedPaths.size !== multiSelectedPaths.length ||
      multiSelectedPaths.some((path) => !expectedPaths.has(path))
    ) {
      setActiveSelectBy(null);
    }
  }, [activeSelectBy, allLibraryImages, imageRatings, multiSelectedPaths]);

  useEffect(() => {
    setActiveSelectBy(null);
  }, [selectionClearRequest]);

  return (
    <div
      className={clsx(
        'flex items-center transition-all duration-300',
        isSelectByOpen ? 'rounded-md bg-surface' : 'bg-transparent',
        activeSelectBy && 'ring-1 ring-accent/50',
      )}
    >
      <button
        type="button"
        className={clsx(
          'relative flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors',
          forceExpanded && 'cursor-default',
          isSelectByOpen || activeSelectBy
            ? 'text-accent'
            : 'text-text-secondary hover:bg-surface hover:text-text-primary',
        )}
        disabled={forceExpanded}
        onClick={() => setIsToggledOpen((open) => !open)}
        aria-expanded={isSelectByOpen}
        data-tooltip={t('ui.bottomBar.selectBy.title', 'Select by')}
      >
        <ListChecks size={18} />
        {activeSelectBy && <span className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-accent" />}
      </button>

      <div
        className={clsx(
          'flex items-center overflow-hidden transition-all duration-300 ease-in-out',
          isSelectByOpen ? 'ml-1 max-w-[48rem] pr-2 opacity-100' : 'ml-0 max-w-0 pr-0 opacity-0',
        )}
      >
        <div ref={contentRef} className="flex items-center gap-3 whitespace-nowrap">
          <button
            type="button"
            className="flex h-6 w-6 items-center justify-center rounded-sm text-text-secondary transition-colors hover:bg-card-active hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
            disabled={multiSelectedPaths.length === 0}
            onClick={handleClearSelectBy}
            data-tooltip={t('ui.bottomBar.selectBy.clear', 'Clear selection')}
          >
            <X size={15} />
          </button>

          <div className="h-4 w-px bg-border-color" />

          <div className="flex items-center gap-0.5">
            <button
              type="button"
              className={clsx(
                'flex h-5 min-w-5 items-center justify-center rounded-sm px-1 text-[10px] transition-colors hover:bg-card-active hover:text-text-primary disabled:opacity-40',
                activeSelectBy?.id === 'rating-unrated' ? 'bg-card-active text-accent' : 'text-text-secondary',
              )}
              disabled={(selectByCounts.get('rating-unrated') || 0) === 0}
              onClick={() => handleSelectBy('rating-unrated', { rating: -1 })}
              data-tooltip={`${t('library.filters.rating.unrated')} (${selectByCounts.get('rating-unrated') || 0})`}
            >
              0
            </button>
            {RATING_COMPARISONS.map((comparison) => (
              <button
                key={`select-rating-${comparison}`}
                type="button"
                className={clsx(
                  'flex h-6 min-w-6 items-center justify-center rounded-sm px-1 text-xs font-semibold transition-colors',
                  selectRatingComparison === comparison
                    ? 'bg-card-active text-accent'
                    : 'text-text-secondary hover:bg-card-active hover:text-text-primary',
                )}
                onClick={() => {
                  if (selectRatingComparison === comparison) return;
                  setSelectRatingComparison(comparison);
                  if (activeSelectByRating > 0) {
                    handleSelectBy(`rating-${comparison}-${activeSelectByRating}`, {
                      rating: activeSelectByRating,
                      ratingComparison: comparison,
                    });
                  }
                }}
                data-tooltip={`${RATING_COMPARISON_SYMBOLS[comparison]} 1–5`}
              >
                {RATING_COMPARISON_SYMBOLS[comparison]}
              </button>
            ))}
            {[1, 2, 3, 4, 5].map((rating) => {
              const count = selectByCounts.get(`rating-${selectRatingComparison}-${rating}`) || 0;
              const isIncluded = isRatingInRange(rating, activeSelectByRating, selectRatingComparison);
              return (
                <button
                  key={`select-rating-${rating}`}
                  type="button"
                  className={clsx(
                    'p-0.5 transition-colors hover:text-accent',
                    isIncluded ? 'text-accent' : 'text-text-secondary',
                    count === 0 && !isIncluded && 'opacity-40',
                  )}
                  disabled={count === 0}
                  onClick={() =>
                    handleSelectBy(`rating-${selectRatingComparison}-${rating}`, {
                      rating,
                      ratingComparison: selectRatingComparison,
                    })
                  }
                  data-tooltip={`${selectByGroups[0].options[rating].label} (${count})`}
                >
                  <Star size={16} className={isIncluded ? 'fill-accent' : undefined} />
                </button>
              );
            })}
          </div>

          <div className="h-4 w-px bg-border-color" />

          <div className="flex items-center gap-1">
            {selectByFileTypes.map(({ criteria, id, label, shortLabel }) => {
              const count = selectByCounts.get(id) || 0;
              return (
                <button
                  key={`select-${id}`}
                  type="button"
                  className={clsx(
                    'h-6 rounded-sm px-1.5 text-[10px] font-semibold transition-colors hover:bg-card-active hover:text-text-primary disabled:opacity-40',
                    activeSelectBy?.id === id ? 'bg-card-active text-accent' : 'text-text-secondary',
                  )}
                  disabled={count === 0}
                  onClick={() => handleSelectBy(id, criteria)}
                  data-tooltip={`${label} (${count})`}
                >
                  {shortLabel}
                </button>
              );
            })}
            {(['edited', 'unedited'] as const).map((id) => {
              const isEdited = id === 'edited';
              const count = selectByCounts.get(id) || 0;
              return (
                <button
                  key={`select-${id}`}
                  type="button"
                  className={clsx(
                    'h-6 rounded-sm px-1.5 text-[10px] transition-colors hover:bg-card-active hover:text-text-primary disabled:opacity-40',
                    activeSelectBy?.id === id ? 'bg-card-active text-accent' : 'text-text-secondary',
                  )}
                  disabled={count === 0}
                  onClick={() =>
                    handleSelectBy(id, {
                      editedStatus: isEdited ? EditedStatus.EditedOnly : EditedStatus.UneditedOnly,
                    })
                  }
                  data-tooltip={`${t(
                    isEdited ? 'library.filters.edited.editedOnly' : 'library.filters.edited.uneditedOnly',
                  )} (${count})`}
                >
                  {isEdited ? 'EDIT' : 'ORIG'}
                </button>
              );
            })}
          </div>

          <div className="h-4 w-px bg-border-color" />

          <div className="flex items-center gap-1.5">
            {ALL_COLOR_OPTIONS.map((color) => {
              const count = selectByCounts.get(`color-${color.name}`) || 0;
              return (
                <button
                  key={`select-color-${color.name}`}
                  type="button"
                  className={clsx(
                    'h-4 w-4 rounded-full transition-transform hover:scale-105 disabled:opacity-40',
                    activeSelectBy?.id === `color-${color.name}` &&
                      'ring-2 ring-accent ring-offset-1 ring-offset-bg-primary',
                  )}
                  style={{ backgroundColor: color.color }}
                  disabled={count === 0}
                  onClick={() => handleSelectBy(`color-${color.name}`, { colors: [color.name] })}
                  data-tooltip={`${getColorLabel(color.name)} (${count})`}
                />
              );
            })}
          </div>

          <div className="h-4 w-px bg-border-color" />

          <div className="flex items-center gap-1">
            {IMAGE_FLAG_FILTER_OPTIONS.map((flag) => {
              const count = selectByCounts.get(`flag-${flag}`) || 0;
              return (
                <button
                  key={`select-flag-${flag}`}
                  type="button"
                  className={clsx(
                    'flex h-6 w-6 items-center justify-center rounded-sm transition-colors hover:bg-card-active hover:text-text-primary disabled:opacity-40',
                    activeSelectBy?.id === `flag-${flag}` ? 'bg-card-active text-accent' : 'text-text-secondary',
                  )}
                  disabled={count === 0}
                  onClick={() => handleSelectBy(`flag-${flag}`, { flags: [flag] })}
                  data-tooltip={`${t(`flags.${flag}`)} (${count})`}
                >
                  <ImageFlagIcon flag={flag} size={15} />
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Quick Filter and Select by, in the order the toolbar has always shown them and honoring Customize
 * Toolbar. Given an `availableWidth`, both stay open while they fit and fall back to their toggles
 * only when they do not; without one, each opens on its toggle.
 */
export function LibraryFilterControls({
  availableWidth,
  isItemVisible,
}: {
  availableWidth?: number;
  isItemVisible(id: string): boolean;
}) {
  const [quickFilterWidth, setQuickFilterWidth] = useState(0);
  const [selectByWidth, setSelectByWidth] = useState(0);
  const showQuickFilter = isItemVisible('quickFilter');
  const showSelectBy = isItemVisible('selectBy');
  const requiredWidth =
    (showQuickFilter ? quickFilterWidth : 0) +
    (showSelectBy ? selectByWidth : 0) +
    (showQuickFilter && showSelectBy ? SEPARATOR_WIDTH : 0);
  const forceExpanded = availableWidth !== undefined && requiredWidth > 0 && availableWidth >= requiredWidth;

  return (
    <div className="flex items-center gap-2">
      {showQuickFilter && (
        <QuickFilterControl forceExpanded={forceExpanded} onExpandedWidthChange={setQuickFilterWidth} />
      )}
      {showQuickFilter && showSelectBy && <div className="h-5 w-px shrink-0 bg-surface" aria-hidden="true" />}
      {showSelectBy && <SelectByControl forceExpanded={forceExpanded} onExpandedWidthChange={setSelectByWidth} />}
    </div>
  );
}
