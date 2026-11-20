import { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ParseKeys } from 'i18next';
import { useShallow } from 'zustand/react/shallow';
import clsx from 'clsx';
import { Check, ChevronDown, ChevronRight, Loader2, Plus, X } from 'lucide-react';
import { IMAGE_FILE_TYPE_LABELS, ImageFileType, OPTION_SEPARATOR } from '../../ui/AppProperties';
import Text from '../../ui/Text';
import { TextColors, TextVariants } from '../../../types/typography';
import { useLibraryStore } from '../../../store/useLibraryStore';
import { useSettingsStore } from '../../../store/useSettingsStore';
import { useContextMenu } from '../../../context/ContextMenuContext';
import { createSearchMatcher } from '../../../hooks/useSortedLibrary';
import { matchesLibraryFilter } from '../../../utils/libraryFilters';
import { formatKeyword } from '../../../utils/keywords';
import {
  DEFAULT_METADATA_COLUMNS,
  DateNode,
  MAX_METADATA_COLUMNS,
  METADATA_FIELDS,
  MetadataField,
  MetadataPicks,
  UNKNOWN_VALUE,
  buildDateTree,
  countPendingMetadata,
  isSameMetadataValue,
  listMetadataValues,
} from '../../../utils/metadataFilter';

const UNKNOWN_LABELS: Partial<Record<MetadataField, ParseKeys>> = {
  [MetadataField.Date]: 'library.metadataFilter.unknownDate',
  [MetadataField.Keyword]: 'library.metadataFilter.noKeyword',
  [MetadataField.Label]: 'library.header.viewOptions.noLabel',
};

/** The picks without one column's, dropping the column when it has none left. */
export const withFieldPicks = (picks: MetadataPicks | undefined, field: MetadataField, values: string[]) => {
  const next: MetadataPicks = { ...picks };
  if (values.length > 0) next[field] = values;
  else delete next[field];
  return next;
};

/** Names of the bar's fields and values, also used by the header's active-filter chips. */
export function useMetadataFilterLabels() {
  const { t, i18n } = useTranslation();

  const fieldLabel = useCallback(
    (field: MetadataField) => t(`library.metadataFilter.fields.${field}` as ParseKeys),
    [t],
  );

  /** A value's name; `isStandalone` names a date month or day with its year (outside the Date tree). */
  const valueLabel = useCallback(
    (field: MetadataField, value: string, isStandalone = false): string => {
      if (value === UNKNOWN_VALUE) return t(UNKNOWN_LABELS[field] ?? 'library.metadataFilter.unknown');
      switch (field) {
        case MetadataField.Date: {
          const [year, month, day] = value.split('-').map(Number);
          if (!month) return value;
          const date = new Date(year, month - 1, day || 1);
          if (day) {
            return date.toLocaleDateString(
              i18n.language,
              isStandalone ? { dateStyle: 'medium' } : { day: 'numeric', weekday: 'short' },
            );
          }
          return date.toLocaleDateString(
            i18n.language,
            isStandalone ? { month: 'long', year: 'numeric' } : { month: 'long' },
          );
        }
        case MetadataField.FocalLength:
          return `${value} mm`;
        case MetadataField.Iso:
          return `ISO ${value}`;
        case MetadataField.Shutter: {
          const seconds = Number(value);
          return seconds >= 1 ? `${seconds} s` : `1/${Math.round(1 / seconds)} s`;
        }
        case MetadataField.Aperture:
          return `f/${value}`;
        case MetadataField.Keyword:
          return formatKeyword(value);
        case MetadataField.Label:
          return t(`contextMenus.colors.${value}` as ParseKeys, {
            defaultValue: value.charAt(0).toUpperCase() + value.slice(1),
          });
        case MetadataField.Flag:
          return t(`flags.${value}` as ParseKeys);
        case MetadataField.Rating:
          return value === '0' ? t('library.filters.rating.unrated') : '★'.repeat(Number(value));
        case MetadataField.FileType:
          return IMAGE_FILE_TYPE_LABELS[value as ImageFileType] ?? value;
        default:
          return value;
      }
    },
    [i18n.language, t],
  );

  return { fieldLabel, valueLabel };
}

interface ValueRow {
  value: string;
  count: number;
  depth: number;
  /** A date year or month that has rows under it. */
  isExpandable: boolean;
}

/** The Date column's rows: years, then the months and days of expanded ones. */
const flattenDateTree = (nodes: DateNode[], expanded: ReadonlySet<string>, depth = 0): ValueRow[] =>
  nodes.flatMap((node) => [
    { value: node.value, count: node.count, depth, isExpandable: node.children.length > 0 },
    ...(expanded.has(node.value) ? flattenDateTree(node.children, expanded, depth + 1) : []),
  ]);

interface MetadataColumnProps {
  field: MetadataField;
  index: number;
  columns: MetadataField[];
  rows: ValueRow[];
  total: number;
  picks: string[];
  expandedDates: ReadonlySet<string>;
  onPicksChange(values: string[]): void;
  onToggleExpanded(value: string): void;
  onFieldChange(field: MetadataField): void;
  onRemove(): void;
}

function MetadataColumn({
  field,
  index,
  columns,
  rows,
  total,
  picks,
  expandedDates,
  onPicksChange,
  onToggleExpanded,
  onFieldChange,
  onRemove,
}: MetadataColumnProps) {
  const { t } = useTranslation();
  const { fieldLabel, valueLabel } = useMetadataFilterLabels();
  const { showContextMenu } = useContextMenu();
  // The row a Shift-click extends from, as in a file list.
  const anchorRef = useRef<string | null>(null);

  const openFieldMenu = (event: React.MouseEvent) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    showContextMenu(bounds.left, bounds.bottom + 4, [
      ...METADATA_FIELDS.map((option) => ({
        label: fieldLabel(option),
        icon: option === field ? Check : undefined,
        disabled: option !== field && columns.includes(option),
        onClick: () => onFieldChange(option),
      })),
      { type: OPTION_SEPARATOR },
      {
        label: t('library.metadataFilter.removeColumn'),
        icon: X,
        disabled: columns.length <= 1,
        onClick: onRemove,
      },
    ]);
  };

  const isPicked = (value: string) => picks.some((pick) => isSameMetadataValue(field, pick, value));

  const handleRowClick = (event: React.MouseEvent, value: string) => {
    const isOnlyPick = picks.length === 1 && isPicked(value);
    if (event.shiftKey && anchorRef.current !== null) {
      const from = rows.findIndex((row) => row.value === anchorRef.current);
      const to = rows.findIndex((row) => row.value === value);
      if (from !== -1 && to !== -1) {
        const [start, end] = from < to ? [from, to] : [to, from];
        onPicksChange(rows.slice(start, end + 1).map((row) => row.value));
        return;
      }
    }
    anchorRef.current = value;
    if (event.metaKey || event.ctrlKey) {
      onPicksChange(
        isPicked(value) ? picks.filter((pick) => !isSameMetadataValue(field, pick, value)) : [...picks, value],
      );
    } else {
      onPicksChange(isOnlyPick ? [] : [value]);
    }
  };

  const rowClass = (isPicked: boolean) =>
    clsx(
      'flex w-full items-center gap-1 rounded-sm px-1.5 py-0.5 text-left text-xs transition-colors',
      isPicked ? 'bg-card-active text-accent' : 'text-text-primary hover:bg-card-active',
    );

  return (
    <div
      className="flex min-w-0 flex-1 flex-col rounded-md border border-border-color/20 bg-bg-primary"
      data-column={index}
    >
      <button
        className="flex items-center justify-between gap-1 border-b border-border-color/20 px-2 py-1 text-left"
        onClick={openFieldMenu}
        type="button"
      >
        <Text as="span" variant={TextVariants.label} className="truncate">
          {fieldLabel(field)}
        </Text>
        <ChevronDown size={14} className="shrink-0 text-text-secondary" />
      </button>
      <div className="min-h-0 flex-1 overflow-y-auto p-1">
        <button className={rowClass(picks.length === 0)} onClick={() => onPicksChange([])} type="button">
          <span className="min-w-0 flex-1 truncate">{t('library.metadataFilter.all')}</span>
          <span className="shrink-0 text-text-secondary">{total}</span>
        </button>
        {rows.map((row) => (
          <div className="flex items-center" key={row.value} style={{ paddingLeft: row.depth * 12 }}>
            {field === MetadataField.Date && (
              <button
                className={clsx('w-4 shrink-0 text-text-secondary', !row.isExpandable && 'invisible')}
                onClick={() => onToggleExpanded(row.value)}
                tabIndex={row.isExpandable ? 0 : -1}
                type="button"
              >
                {expandedDates.has(row.value) ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              </button>
            )}
            <button
              className={rowClass(isPicked(row.value))}
              onClick={(event) => handleRowClick(event, row.value)}
              type="button"
            >
              <span className="min-w-0 flex-1 truncate">{valueLabel(field, row.value)}</span>
              <span className="shrink-0 text-text-secondary">{row.count}</span>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Lightroom Classic's Library Filter › Metadata bar: columns of the values found in the folder,
 * each with its count; picks in one column add up, columns narrow each other.
 */
export default function MetadataFilterBar() {
  const { t } = useTranslation();
  const { imageList, imageRatings, filterCriteria, searchCriteria, setFilterCriteria } = useLibraryStore(
    useShallow((state) => ({
      imageList: state.imageList,
      imageRatings: state.imageRatings,
      filterCriteria: state.filterCriteria,
      searchCriteria: state.searchCriteria,
      setFilterCriteria: state.setFilterCriteria,
    })),
  );
  const { appSettings, handleSettingsChange } = useSettingsStore(
    useShallow((state) => ({ appSettings: state.appSettings, handleSettingsChange: state.handleSettingsChange })),
  );
  const [expandedDates, setExpandedDates] = useState<Set<string>>(new Set());

  const columns = appSettings?.libraryFilterColumns?.length
    ? appSettings.libraryFilterColumns
    : DEFAULT_METADATA_COLUMNS;
  const picks = filterCriteria.metadata;

  // Counts are over the photos the other filters and the search show, not narrowed by other columns.
  const shownByOtherFilters = useMemo(() => {
    const otherFilters = { ...filterCriteria, metadata: undefined };
    const search = createSearchMatcher(searchCriteria, imageRatings);
    return imageList.filter(
      (image) => matchesLibraryFilter(image, imageRatings, otherFilters) && search.matches(image),
    );
  }, [filterCriteria, imageList, imageRatings, searchCriteria]);

  const rowsByField = useMemo(() => {
    const result = new Map<MetadataField, ValueRow[]>();
    for (const field of columns) {
      const values = listMetadataValues(shownByOtherFilters, field, imageRatings);
      result.set(
        field,
        field === MetadataField.Date
          ? flattenDateTree(buildDateTree(values), expandedDates)
          : values.map((entry) => ({ ...entry, depth: 0, isExpandable: false })),
      );
    }
    return result;
  }, [columns, expandedDates, imageRatings, shownByOtherFilters]);

  const pendingCount = useMemo(() => countPendingMetadata(imageList), [imageList]);

  const setColumns = (next: MetadataField[]) => {
    if (appSettings) handleSettingsChange({ ...appSettings, libraryFilterColumns: next });
  };

  const setFieldPicks = (field: MetadataField, values: string[]) =>
    setFilterCriteria((previous) => ({ ...previous, metadata: withFieldPicks(previous.metadata, field, values) }));

  const changeColumnField = (index: number, field: MetadataField) => {
    const previousField = columns[index];
    if (previousField === field) return;
    setFieldPicks(previousField, []);
    setColumns(columns.map((column, columnIndex) => (columnIndex === index ? field : column)));
  };

  const removeColumn = (index: number) => {
    setFieldPicks(columns[index], []);
    setColumns(columns.filter((_, columnIndex) => columnIndex !== index));
  };

  const addColumn = () => {
    const unused = METADATA_FIELDS.find((field) => !columns.includes(field));
    if (unused) setColumns([...columns, unused]);
  };

  const toggleExpanded = (value: string) =>
    setExpandedDates((previous) => {
      const next = new Set(previous);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });

  return (
    <div className="shrink-0 border-b border-surface px-4 py-2 compact:px-3">
      <div className="flex h-44 gap-2 compact:h-36">
        {columns.map((field, index) => (
          <MetadataColumn
            columns={columns}
            expandedDates={expandedDates}
            field={field}
            index={index}
            key={field}
            onFieldChange={(next) => changeColumnField(index, next)}
            onPicksChange={(values) => setFieldPicks(field, values)}
            onRemove={() => removeColumn(index)}
            onToggleExpanded={toggleExpanded}
            picks={picks?.[field] ?? []}
            rows={rowsByField.get(field) ?? []}
            total={shownByOtherFilters.length}
          />
        ))}
        {columns.length < MAX_METADATA_COLUMNS && (
          <button
            className="flex w-7 shrink-0 items-center justify-center rounded-md text-text-secondary hover:bg-surface hover:text-text-primary"
            data-tooltip={t('library.metadataFilter.addColumn')}
            onClick={addColumn}
            type="button"
          >
            <Plus size={16} />
          </button>
        )}
      </div>
      {pendingCount > 0 && (
        <Text
          as="div"
          variant={TextVariants.small}
          color={TextColors.secondary}
          className="mt-1 flex items-center gap-1.5"
        >
          <Loader2 size={12} className="animate-spin" />
          {t('library.metadataFilter.reading', { count: pendingCount })}
        </Text>
      )}
    </div>
  );
}
