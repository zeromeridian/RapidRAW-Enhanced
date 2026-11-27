import { ReactNode, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Edit, FolderInput, FolderPlus, Star, Trash2 } from 'lucide-react';
import LooksHeader from '../../panel/right/LooksHeader';
import CreateFolderModal from '../../modals/CreateFolderModal';
import RenameFolderModal from '../../modals/RenameFolderModal';
import Text from '../Text';
import BrowserSection from './BrowserSection';
import BrowserToolbar, { matchesQuery } from './BrowserToolbar';
import { BrowserItemProps, BrowserItems, BrowserRow, BrowserTile } from './BrowserItem';
import { useLooksBrowser } from './useLooksBrowser';
import { groupNamesOf } from './GroupPicker';
import { LooksKind, OPTION_SEPARATOR, Option } from '../AppProperties';
import { TextColors } from '../../../types/typography';
import { useContextMenu } from '../../../context/ContextMenuContext';
import { useUIStore } from '../../../store/useUIStore';

/** What a grouped Looks browser lists: a named item in a group named by a string ('' for none). */
interface GroupedItem {
  name: string;
  group: string;
}

const FAVORITES_SECTION = 'favorites';
const UNGROUPED_SECTION = 'ungrouped';

interface Section<T> {
  key: string;
  title: string;
  items: Array<T>;
  /** The group's name; absent for Favorites and No Group. */
  group?: string;
}

/** Group dialogs: a new group for Move to Group › New Group…, or a rename. */
type GroupDialog<T> = { mode: 'new'; item: T } | { mode: 'rename'; group: string };

interface GroupedBrowserProps<T extends GroupedItem> {
  kind: LooksKind;
  items: ReadonlyArray<T>;
  /** Unique per item (its file path); keys `previews`. */
  getKey(item: T): string;
  getFavoriteId(item: T): string;
  previews: Record<string, string | null>;
  isSelected(item: T): boolean;
  /** The applied item's strength slider, shown under it. */
  activeContent?: ReactNode;
  onSelect(item: T): void;
  onHoverStart?(item: T): void;
  onHoverEnd?(): void;
  badges?(item: T): ReactNode | undefined;
  /** An item's right-click menu, with the given Move to Group entry placed where it belongs. */
  itemMenu(item: T, moveToGroup: Option): Array<Option>;
  /** Entries a group's right-click menu starts with (Import into Group…). */
  groupMenu?(group: string): Array<Option>;
  /** Move to Group, Rename Group (the group's items into the new name) and Delete Group (into ''). */
  onMoveToGroup(items: Array<T>, group: string): void;
  headerActions: ReactNode;
  searchPlaceholder: string;
  emptyText: string;
  /** Shown above the list (Edit Profile's bar). */
  topContent?: ReactNode;
}

/**
 * Looks → Profiles and Looks → LUTs: items by group (Favorites first, then each group by name,
 * then No Group) as a grid of previews or a list, with search, Move to Group, and Rename / Delete
 * Group (Plan item 86). Presets have their own panel for their drag and drop.
 */
export default function GroupedBrowser<T extends GroupedItem>({
  kind,
  items,
  getKey,
  getFavoriteId,
  previews,
  isSelected,
  activeContent,
  onSelect,
  onHoverStart,
  onHoverEnd,
  badges,
  itemMenu,
  groupMenu,
  onMoveToGroup,
  headerActions,
  searchPlaceholder,
  emptyText,
  topContent,
}: GroupedBrowserProps<T>) {
  const { t } = useTranslation();
  const { showContextMenu } = useContextMenu();
  const { favorites, toggleFavorite, isGrid, setGrid, isSectionOpen, toggleSection } = useLooksBrowser(kind);
  const [query, setQuery] = useState('');
  const [groupDialog, setGroupDialog] = useState<GroupDialog<T> | null>(null);

  const groups = useMemo(() => groupNamesOf(items), [items]);

  const isSearching = query.trim() !== '';
  const sections = useMemo<Array<Section<T>>>(() => {
    const matching = items.filter((item) => matchesQuery(item.name, query));
    const favoriteItems = matching.filter((item) => favorites.has(getFavoriteId(item)));
    const ungrouped = matching.filter((item) => item.group === '');
    return [
      ...(favoriteItems.length > 0
        ? [{ key: FAVORITES_SECTION, title: t('editor.looks.favorites'), items: favoriteItems }]
        : []),
      ...groups
        .map((group) => ({
          key: `group:${group}`,
          title: group,
          group,
          items: matching.filter((item) => item.group === group),
        }))
        .filter((section) => section.items.length > 0),
      ...(ungrouped.length > 0 ? [{ key: UNGROUPED_SECTION, title: t('editor.looks.noGroup'), items: ungrouped }] : []),
    ];
  }, [favorites, getFavoriteId, groups, items, query, t]);

  const isOpen = (section: Section<T>) => isSearching || isSectionOpen(section.key, true);
  // The strength slider shows once: in the first open section that lists the applied item.
  const activeSection = sections.find((section) => isOpen(section) && section.items.some(isSelected));
  const activeItem = activeSection?.items.find(isSelected);

  const itemsOfGroup = (group: string) => items.filter((item) => item.group === group);

  const confirmDeleteGroup = (group: string) => {
    const groupItems = itemsOfGroup(group);
    useUIStore.getState().setUI({
      confirmModalState: {
        confirmText: t('editor.looks.deleteGroup'),
        confirmVariant: 'destructive',
        isOpen: true,
        message: t('editor.looks.deleteGroupMessage', { name: group, count: groupItems.length }),
        onConfirm: () => onMoveToGroup(groupItems, ''),
        title: t('editor.looks.deleteGroup'),
      },
    });
  };

  const handleGroupContextMenu = (event: React.MouseEvent, group: string) => {
    event.preventDefault();
    event.stopPropagation();
    showContextMenu(event.clientX, event.clientY, [
      ...(groupMenu?.(group) ?? []),
      { icon: Edit, label: t('editor.looks.renameGroup'), onClick: () => setGroupDialog({ mode: 'rename', group }) },
      { type: OPTION_SEPARATOR },
      {
        icon: Trash2,
        isDestructive: true,
        label: t('editor.looks.deleteGroup'),
        onClick: () => confirmDeleteGroup(group),
      },
    ]);
  };

  const handleItemContextMenu = (event: React.MouseEvent, item: T) => {
    event.preventDefault();
    event.stopPropagation();
    const moveToGroup: Option = {
      icon: FolderInput,
      label: t('editor.looks.moveToGroup'),
      submenu: [
        { label: t('editor.looks.noGroup'), checked: item.group === '', onClick: () => onMoveToGroup([item], '') },
        ...groups.map((group) => ({
          label: group,
          checked: item.group === group,
          onClick: () => onMoveToGroup([item], group),
        })),
        { type: OPTION_SEPARATOR },
        { icon: FolderPlus, label: t('editor.looks.newGroup'), onClick: () => setGroupDialog({ mode: 'new', item }) },
      ],
    };
    showContextMenu(event.clientX, event.clientY, itemMenu(item, moveToGroup));
  };

  const handleGroupDialogSave = (name: string) => {
    if (groupDialog?.mode === 'new') onMoveToGroup([groupDialog.item], name);
    else if (groupDialog?.mode === 'rename') onMoveToGroup(itemsOfGroup(groupDialog.group), name);
    setGroupDialog(null);
  };

  const renderItem = (item: T) => {
    const itemProps: BrowserItemProps = {
      name: item.name,
      preview: previews[getKey(item)],
      isSelected: isSelected(item),
      isFavorite: favorites.has(getFavoriteId(item)),
      onToggleFavorite: () => toggleFavorite(getFavoriteId(item)),
      onClick: () => onSelect(item),
      onMouseEnter: onHoverStart ? () => onHoverStart(item) : undefined,
      onContextMenu: (event) => handleItemContextMenu(event, item),
      badges: badges?.(item),
    };
    return isGrid ? <BrowserTile {...itemProps} /> : <BrowserRow {...itemProps} />;
  };

  const renderSectionItems = (section: Section<T>) => (
    <BrowserItems
      isGrid={isGrid}
      items={section.items}
      getKey={getKey}
      renderItem={renderItem}
      activeKey={section === activeSection && activeItem ? getKey(activeItem) : null}
      activeContent={activeContent}
    />
  );

  const hasOnlyUngrouped = sections.length === 1 && sections[0].key === UNGROUPED_SECTION;

  return (
    <div className="flex flex-col h-full">
      <LooksHeader actions={headerActions} />
      {items.length > 0 && (
        <BrowserToolbar
          query={query}
          onQueryChange={setQuery}
          placeholder={searchPlaceholder}
          isGrid={isGrid}
          onGridChange={setGrid}
        />
      )}
      {topContent && <div className="px-4 compact:px-3 pt-2 empty:hidden">{topContent}</div>}
      <div className="grow overflow-y-auto p-4 compact:p-2 space-y-2 compact:space-y-1" onMouseLeave={onHoverEnd}>
        {items.length === 0 ? (
          <Text color={TextColors.secondary} className="text-center pt-4">
            {emptyText}
          </Text>
        ) : isSearching && sections.length === 0 ? (
          <Text color={TextColors.secondary} className="text-center pt-4">
            {t('editor.looks.noMatches')}
          </Text>
        ) : hasOnlyUngrouped ? (
          renderSectionItems(sections[0])
        ) : (
          sections.map((section) => {
            const { group } = section;
            return (
              <BrowserSection
                key={section.key}
                count={section.items.length}
                icon={
                  section.key === FAVORITES_SECTION ? (
                    <Star size={14} className="text-accent" fill="currentColor" />
                  ) : undefined
                }
                isOpen={isOpen(section)}
                onContextMenu={group !== undefined ? (event) => handleGroupContextMenu(event, group) : undefined}
                onToggle={() => toggleSection(section.key, true)}
                title={section.title}
              >
                {renderSectionItems(section)}
              </BrowserSection>
            );
          })
        )}
      </div>
      <CreateFolderModal
        isOpen={groupDialog?.mode === 'new'}
        onClose={() => setGroupDialog(null)}
        onSave={handleGroupDialogSave}
        placeholder={t('editor.looks.newGroupPlaceholder')}
        title={t('editor.looks.newGroupTitle')}
      />
      <RenameFolderModal
        currentName={groupDialog?.mode === 'rename' ? groupDialog.group : ''}
        isOpen={groupDialog?.mode === 'rename'}
        onClose={() => setGroupDialog(null)}
        onSave={handleGroupDialogSave}
        title={t('editor.looks.renameGroupTitle')}
      />
    </div>
  );
}
