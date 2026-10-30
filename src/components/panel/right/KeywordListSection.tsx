import { useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Check, ChevronRight, Images, Loader2, Minus, Pencil, Search, Trash2 } from 'lucide-react';
import clsx from 'clsx';
import { toast } from 'react-toastify';
import { useTranslation } from 'react-i18next';

import ConfirmModal from '../../modals/ConfirmModal';
import RenameFolderModal from '../../modals/RenameFolderModal';
import Text from '../../ui/Text';
import TaggingSection from './TaggingSection';
import { Invokes } from '../../ui/AppProperties';
import { useAppliedKeywordCounts } from './KeywordTile';
import { useContextMenu } from '../../../context/ContextMenuContext';
import { useKeywordIndex } from '../../../hooks/useKeywordIndex';
import { useLibraryActions } from '../../../hooks/useLibraryActions';
import { useLibraryStore } from '../../../store/useLibraryStore';
import { useProcessStore } from '../../../store/useProcessStore';
import { useUIStore } from '../../../store/useUIStore';
import { TextColors, TextVariants, TextWeights } from '../../../types/typography';
import {
  KEYWORD_PATH_SEPARATOR,
  KeywordOperation,
  KeywordTreeNode,
  USER_TAG_PREFIX,
  applyKeywordOperationToTag,
  buildKeywordTree,
  filterKeywordTree,
  formatKeyword,
  keywordOperationTag,
  parseKeywordPath,
} from '../../../utils/keywords';
import { mayContainLibraryDragPayload, readLibraryDragPayload } from '../../../utils/libraryDragDrop';

const AI_GROUP_SECTION = 'keywordListAi';
const INDENT_PX = 12;
// Keyword drags use their own type, so folders and albums never mistake them for photos.
const KEYWORD_DRAG_TYPE = 'application/x-thisisraw-keyword';

interface PendingOperation {
  operation: KeywordOperation;
  count: number;
  isMerge: boolean;
}

const displayTag = (tag: string) =>
  formatKeyword(tag.startsWith(USER_TAG_PREFIX) ? tag.slice(USER_TAG_PREFIX.length) : tag);
// The last level of a user keyword tag, e.g. `berlin` for `user:places|germany|berlin`.
const lastLevel = (tag: string) => tag.slice(USER_TAG_PREFIX.length).split(KEYWORD_PATH_SEPARATOR).pop() ?? '';

interface KeywordListSectionProps {
  targetPaths: string[];
}

/**
 * Every keyword in the library: tick to tag the selected images, click a name to show its images,
 * drop photos on a keyword to tag them, and rename, move, merge, or delete keywords library-wide.
 */
export default function KeywordListSection({ targetPaths }: KeywordListSectionProps) {
  const { t } = useTranslation();
  const { keywords, aiTags, isScanning } = useKeywordIndex();
  const appliedCounts = useAppliedKeywordCounts(targetPaths);
  const { handleSetTag } = useLibraryActions();
  const { showContextMenu } = useContextMenu();
  const activeKeyword = useLibraryStore((state) => state.activeKeyword);
  const keywordJob = useProcessStore((state) => state.keywordJob);
  const setProcess = useProcessStore((state) => state.setProcess);
  const keywordSelectHandler = useUIStore((state) => state.keywordSelectHandler);
  const isAiGroupOpen = useUIStore((state) => state.taggingSectionsOpen[AI_GROUP_SECTION] ?? false);
  const toggleTaggingSection = useUIStore((state) => state.toggleTaggingSection);
  const [query, setQuery] = useState('');
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [renamingTag, setRenamingTag] = useState<string | null>(null);
  const [pendingOperation, setPendingOperation] = useState<PendingOperation | null>(null);
  const [draggedKeyword, setDraggedKeyword] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

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

  // Counts the affected photos so the change can be confirmed before it runs.
  const requestOperation = async (operation: KeywordOperation) => {
    // Renaming a keyword to its own child would rename the target too.
    if (operation.kind === 'rename' && applyKeywordOperationToTag(operation.to, operation) !== operation.to) {
      toast.error(t('editor.tagging.moveIntoItself'));
      return;
    }
    try {
      const paths = await invoke<string[]>(Invokes.GetKeywordImagePaths, { tag: keywordOperationTag(operation) });
      const target = operation.kind === 'rename' ? operation.to.slice(USER_TAG_PREFIX.length) : null;
      const isMerge =
        !!target &&
        keywords.some(({ keyword }) => keyword === target || keyword.startsWith(`${target}${KEYWORD_PATH_SEPARATOR}`));
      setPendingOperation({ operation, count: paths.length, isMerge });
    } catch (error) {
      toast.error(t('editor.tagging.updateFailed', { error: String(error) }));
    }
  };

  const startOperation = async ({ operation, count }: PendingOperation) => {
    setProcess({ keywordJob: { operation, done: 0, total: count } });
    try {
      await invoke<number>(Invokes.StartKeywordJob, { operation });
    } catch (error) {
      setProcess({ keywordJob: null });
      toast.error(t('editor.tagging.updateFailed', { error: String(error) }));
    }
  };

  const renameTo = (from: string, text: string) => {
    setRenamingTag(null);
    const path = parseKeywordPath(text);
    if (path) void requestOperation({ kind: 'rename', from, to: `${USER_TAG_PREFIX}${path}` });
  };

  const moveKeyword = (from: string, parentTag: string | null) => {
    const to = parentTag
      ? `${parentTag}${KEYWORD_PATH_SEPARATOR}${lastLevel(from)}`
      : `${USER_TAG_PREFIX}${lastLevel(from)}`;
    if (to !== from) void requestOperation({ kind: 'rename', from, to });
  };

  const openContextMenu = (event: React.MouseEvent, tag: string) => {
    event.preventDefault();
    event.stopPropagation();
    const isUserKeyword = tag.startsWith(USER_TAG_PREFIX);
    showContextMenu(event.clientX, event.clientY, [
      { label: t('editor.tagging.showKeywordImages'), icon: Images, onClick: () => keywordSelectHandler?.(tag) },
      ...(isUserKeyword
        ? [
            {
              label: t('editor.tagging.renameKeywordMenu'),
              icon: Pencil,
              disabled: !!keywordJob,
              onClick: () => setRenamingTag(tag),
            },
          ]
        : []),
      {
        label: t('editor.tagging.deleteMenu'),
        icon: Trash2,
        disabled: !!keywordJob,
        isDestructive: true,
        onClick: () => void requestOperation({ kind: 'delete', tag }),
      },
    ]);
  };

  // Photos from the library grid tag them; another keyword moves under this one.
  const dropProps = (tag: string | null) => ({
    onDragOver: (event: React.DragEvent) => {
      const isKeyword = event.dataTransfer.types.includes(KEYWORD_DRAG_TYPE);
      if (!isKeyword && (!tag || !mayContainLibraryDragPayload(event.dataTransfer))) return;
      event.preventDefault();
      event.stopPropagation();
      setDropTarget(tag ?? '');
    },
    onDragLeave: (event: React.DragEvent) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget(null);
    },
    onDrop: (event: React.DragEvent) => {
      event.preventDefault();
      event.stopPropagation();
      setDropTarget(null);
      const keyword = event.dataTransfer.getData(KEYWORD_DRAG_TYPE);
      if (keyword) {
        if (!tag || tag.startsWith(USER_TAG_PREFIX)) moveKeyword(keyword, tag);
        return;
      }
      const payload = readLibraryDragPayload(event.dataTransfer);
      if (tag && payload?.kind === 'files') {
        handleSetTag(tag, payload.paths, true).catch((error) =>
          toast.error(t('editor.tagging.updateFailed', { error: String(error) })),
        );
      }
    },
  });

  const renderRow = (tag: string, name: string, count: number, depth: number, expander?: React.ReactNode) => {
    const appliedCount = appliedCounts.get(tag) || 0;
    const isApplied = targetPaths.length > 0 && appliedCount === targetPaths.length;
    const isUserKeyword = tag.startsWith(USER_TAG_PREFIX);
    return (
      <div
        className={clsx(
          'flex items-center gap-1.5 h-7 compact:h-6 rounded-sm',
          dropTarget === tag && 'bg-accent/20 ring-1 ring-accent',
        )}
        draggable={isUserKeyword && !keywordJob}
        onContextMenu={(event) => openContextMenu(event, tag)}
        onDragEnd={() => setDraggedKeyword(null)}
        onDragStart={(event) => {
          event.dataTransfer.setData(KEYWORD_DRAG_TYPE, tag);
          event.dataTransfer.effectAllowed = 'move';
          setDraggedKeyword(tag);
        }}
        style={{ paddingLeft: depth * INDENT_PX }}
        {...dropProps(tag)}
      >
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
          <Text as="span" variant={TextVariants.small} color={TextColors.secondary} className="shrink-0 pr-1">
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

  const confirmMessage = (() => {
    if (!pendingOperation) return '';
    const { operation, count, isMerge } = pendingOperation;
    if (operation.kind === 'delete') {
      return t(
        operation.tag.startsWith(USER_TAG_PREFIX)
          ? 'editor.tagging.confirmDeleteKeyword'
          : 'editor.tagging.confirmDeleteAiTag',
        { count, keyword: displayTag(operation.tag) },
      );
    }
    return t(isMerge ? 'editor.tagging.confirmMergeKeyword' : 'editor.tagging.confirmRenameKeyword', {
      count,
      from: displayTag(operation.from),
      to: displayTag(operation.to),
    });
  })();

  return (
    <TaggingSection id="keywordList" title={t('editor.tagging.keywordList')}>
      <div className="space-y-3 compact:space-y-2">
        <div className="flex items-center gap-2 bg-bg-primary rounded-md px-3 h-9 compact:h-7">
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

        {keywordJob && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <Text as="span" variant={TextVariants.small} color={TextColors.secondary}>
                {t('editor.tagging.keywordJobProgress', { done: keywordJob.done, total: keywordJob.total })}
              </Text>
              <button
                className="text-xs text-text-secondary hover:text-text-primary transition-colors"
                onClick={() => void invoke(Invokes.CancelKeywordJob)}
                type="button"
              >
                {t('editor.tagging.cancelKeywordJob')}
              </button>
            </div>
            <div className="h-1 rounded-full bg-bg-primary overflow-hidden">
              <div
                className="h-full bg-accent transition-all"
                style={{ width: `${keywordJob.total ? (keywordJob.done / keywordJob.total) * 100 : 0}%` }}
              />
            </div>
          </div>
        )}

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
          {draggedKeyword && (
            <div
              className={clsx(
                'mt-1 h-7 rounded-sm border border-dashed flex items-center justify-center text-xs text-text-secondary',
                dropTarget === '' ? 'border-accent bg-accent/20' : 'border-text-tertiary/60',
              )}
              {...dropProps(null)}
            >
              {t('editor.tagging.moveToTopLevel')}
            </div>
          )}
        </div>

        {aiTags.length > 0 && (
          <div className="border-t border-bg-primary pt-3 compact:pt-2">
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

      <RenameFolderModal
        buttonText={t('editor.tagging.renameKeywordButton')}
        currentName={renamingTag ? formatKeyword(renamingTag.slice(USER_TAG_PREFIX.length), ' > ') : ''}
        isOpen={!!renamingTag}
        onClose={() => setRenamingTag(null)}
        onSave={(text) => renamingTag && renameTo(renamingTag, text)}
        placeholder={t('editor.tagging.renameKeywordPlaceholder')}
        title={t('editor.tagging.renameKeyword')}
      />
      <ConfirmModal
        confirmText={
          pendingOperation?.operation.kind === 'delete'
            ? t('editor.tagging.deleteButton')
            : t('editor.tagging.renameKeywordButton')
        }
        confirmVariant={pendingOperation?.operation.kind === 'delete' ? 'danger' : 'primary'}
        isOpen={!!pendingOperation}
        message={confirmMessage}
        onClose={() => setPendingOperation(null)}
        onConfirm={() => pendingOperation && void startOperation(pendingOperation)}
        title={
          pendingOperation?.operation.kind !== 'delete'
            ? t('editor.tagging.renameKeyword')
            : pendingOperation.operation.tag.startsWith(USER_TAG_PREFIX)
              ? t('editor.tagging.deleteKeyword')
              : t('editor.tagging.deleteAiTag')
        }
      />
    </TaggingSection>
  );
}
