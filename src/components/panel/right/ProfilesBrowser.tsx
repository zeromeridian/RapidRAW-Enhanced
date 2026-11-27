import { useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';
import {
  Edit,
  FolderInput,
  FolderPlus,
  Pencil,
  Plus,
  Share2,
  Star,
  TextCursorInput,
  Trash2,
  Upload,
} from 'lucide-react';
import LooksHeader from './LooksHeader';
import AdjustmentSlider from '../../adjustments/AdjustmentSlider';
import { ProfileEditingBar } from '../../adjustments/Profile';
import CreateFolderModal from '../../modals/CreateFolderModal';
import RenameFolderModal from '../../modals/RenameFolderModal';
import Text from '../../ui/Text';
import BrowserSection from '../../ui/LooksBrowser/BrowserSection';
import BrowserToolbar, { matchesQuery } from '../../ui/LooksBrowser/BrowserToolbar';
import { BrowserItemProps, BrowserItems, BrowserRow, BrowserTile } from '../../ui/LooksBrowser/BrowserItem';
import { useLooksBrowser } from '../../ui/LooksBrowser/useLooksBrowser';
import { Invokes, OPTION_SEPARATOR } from '../../ui/AppProperties';
import { TextColors } from '../../../types/typography';
import { useContextMenu } from '../../../context/ContextMenuContext';
import { useCustomProfiles, useCustomProfileStore } from '../../../hooks/useCustomProfiles';
import { useAdjustmentSectionProps } from '../../../hooks/useAdjustmentSectionProps';
import { useEditorStore } from '../../../store/useEditorStore';
import { useUIStore } from '../../../store/useUIStore';
import { CustomProfileEntry, ProfileAdjustment } from '../../../utils/adjustments';

/** The previews' long side in pixels, and how many photo/edit states are kept. */
const PREVIEW_SIZE = 112;
const PREVIEW_CACHE_SIZE = 8;
const previewCache = new Map<string, Record<string, string | null>>();

const FAVORITES_SECTION = 'favorites';
const UNGROUPED_SECTION = 'ungrouped';

interface ProfileSection {
  key: string;
  title: string;
  entries: Array<CustomProfileEntry>;
  /** The group's name; absent for Favorites and No Group. */
  group?: string;
}

/** Group dialogs: a new group (Move to Group › New Group…) or a rename. */
type GroupDialog = { mode: 'new'; entry: CustomProfileEntry } | { mode: 'rename'; group: string };

/** Looks → Profiles: the profile folder by group, as a grid of previews or a list (Plan item 86). */
export default function ProfilesBrowser() {
  const { t } = useTranslation();
  const { showContextMenu } = useContextMenu();
  const {
    startPreview,
    endPreview,
    selectProfile,
    startEdit,
    openDialog,
    moveToGroup,
    importProfiles,
    exportProfile,
    deleteProfile,
  } = useCustomProfiles();
  const entries = useCustomProfileStore((state) => state.entries);
  const revision = useCustomProfileStore((state) => state.revision);
  const { adjustments, setAdjustments, onDragStateChange } = useAdjustmentSectionProps();
  const selectedImagePath = useEditorStore((state) => state.selectedImage?.path ?? null);
  const isImageReady = useEditorStore((state) => state.selectedImage?.isReady ?? false);
  const { favorites, toggleFavorite, isGrid, setGrid, isSectionOpen, toggleSection } = useLooksBrowser('profiles');
  const [query, setQuery] = useState('');
  const [groupDialog, setGroupDialog] = useState<GroupDialog | null>(null);
  const [previews, setPreviews] = useState<Record<string, string | null>>({});
  const profileId = adjustments.profile?.id ?? null;

  // The previews render the edit as it is when Looks opens, not on every slider move.
  const adjustmentsRef = useRef(adjustments);
  useEffect(() => {
    adjustmentsRef.current = adjustments;
  });

  useEffect(() => endPreview, [endPreview]);

  useEffect(() => {
    if (!selectedImagePath || !isImageReady || entries.length === 0) return;
    const edit = adjustmentsRef.current;
    const paths = entries.map((entry) => entry.path);
    const key = `${selectedImagePath}|${revision}|${paths.join(',')}|${JSON.stringify({ ...edit, profile: edit.profile?.id ?? null })}`;
    const cached = previewCache.get(key);
    if (cached) {
      setPreviews(cached);
      return;
    }
    let isActive = true;
    setPreviews({});
    invoke<Array<{ path: string; thumb: string | null }>>(Invokes.GenerateProfilePreviews, {
      paths,
      adjustments: edit,
      size: PREVIEW_SIZE,
    })
      .then((results) => {
        if (!isActive) return;
        const map = Object.fromEntries(results.map((result) => [result.path, result.thumb]));
        if (previewCache.size >= PREVIEW_CACHE_SIZE) previewCache.clear();
        previewCache.set(key, map);
        setPreviews(map);
      })
      .catch((err) => console.error('Failed to generate profile previews:', err));
    return () => {
      isActive = false;
    };
  }, [selectedImagePath, isImageReady, entries, revision]);

  const groups = useMemo(
    () => [...new Set(entries.map((entry) => entry.group).filter((group) => group !== ''))],
    [entries],
  );

  // Favorites first (a favorite also stays in its group), then each group by name, then No Group.
  const isSearching = query.trim() !== '';
  const sections = useMemo<Array<ProfileSection>>(() => {
    const matching = entries.filter((entry) => matchesQuery(entry.name, query));
    const favoriteEntries = matching.filter((entry) => favorites.has(entry.id));
    const ungrouped = matching.filter((entry) => entry.group === '');
    return [
      ...(favoriteEntries.length > 0
        ? [{ key: FAVORITES_SECTION, title: t('editor.looks.favorites'), entries: favoriteEntries }]
        : []),
      ...groups
        .map((group) => ({
          key: `group:${group}`,
          title: group,
          group,
          entries: matching.filter((entry) => entry.group === group),
        }))
        .filter((section) => section.entries.length > 0),
      ...(ungrouped.length > 0
        ? [{ key: UNGROUPED_SECTION, title: t('editor.looks.noGroup'), entries: ungrouped }]
        : []),
    ];
  }, [entries, favorites, groups, query, t]);

  const isOpen = (section: ProfileSection) => isSearching || isSectionOpen(section.key, true);
  // The Amount slider shows once: in the first open section that lists the photo's profile.
  const activeSectionKey = sections.find(
    (section) => isOpen(section) && section.entries.some((entry) => entry.id === profileId),
  )?.key;

  const confirmDeleteGroup = (group: string) => {
    const groupEntries = entries.filter((entry) => entry.group === group);
    useUIStore.getState().setUI({
      confirmModalState: {
        confirmText: t('editor.looks.deleteGroup'),
        confirmVariant: 'destructive',
        isOpen: true,
        message: t('editor.looks.deleteGroupMessage', { name: group, count: groupEntries.length }),
        onConfirm: () => moveToGroup(groupEntries, ''),
        title: t('editor.looks.deleteGroup'),
      },
    });
  };

  const handleGroupContextMenu = (event: React.MouseEvent, group: string) => {
    event.preventDefault();
    event.stopPropagation();
    showContextMenu(event.clientX, event.clientY, [
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

  const handleProfileContextMenu = (event: React.MouseEvent, entry: CustomProfileEntry) => {
    event.preventDefault();
    event.stopPropagation();
    showContextMenu(event.clientX, event.clientY, [
      { label: t('adjustments.profile.edit'), icon: Pencil, disabled: !entry.canEdit, onClick: () => startEdit(entry) },
      {
        label: t('adjustments.profile.rename'),
        icon: TextCursorInput,
        onClick: () => openDialog({ mode: 'rename', entry }),
      },
      {
        icon: FolderInput,
        label: t('editor.looks.moveToGroup'),
        submenu: [
          { label: t('editor.looks.noGroup'), checked: entry.group === '', onClick: () => moveToGroup([entry], '') },
          ...groups.map((group) => ({
            label: group,
            checked: entry.group === group,
            onClick: () => moveToGroup([entry], group),
          })),
          { type: OPTION_SEPARATOR },
          {
            icon: FolderPlus,
            label: t('editor.looks.newGroup'),
            onClick: () => setGroupDialog({ mode: 'new', entry }),
          },
        ],
      },
      { label: t('adjustments.profile.export'), icon: Share2, onClick: () => exportProfile(entry) },
      { type: OPTION_SEPARATOR },
      {
        label: t('adjustments.profile.delete'),
        icon: Trash2,
        isDestructive: true,
        onClick: () => deleteProfile(entry),
      },
    ]);
  };

  const handleGroupDialogSave = (name: string) => {
    if (groupDialog?.mode === 'new') moveToGroup([groupDialog.entry], name);
    else if (groupDialog?.mode === 'rename') {
      moveToGroup(
        entries.filter((entry) => entry.group === groupDialog.group),
        name,
      );
    }
    setGroupDialog(null);
  };

  const renderProfile = (entry: CustomProfileEntry) => {
    const itemProps: BrowserItemProps = {
      name: entry.name,
      preview: previews[entry.path],
      isSelected: entry.id === profileId,
      isFavorite: favorites.has(entry.id),
      onToggleFavorite: () => toggleFavorite(entry.id),
      onClick: () => selectProfile(entry),
      onMouseEnter: () => startPreview(entry.path),
      onContextMenu: (event) => handleProfileContextMenu(event, entry),
      badges: entry.monochrome ? (
        <span className="px-1 rounded-sm text-[9px] text-white bg-black/50 shrink-0">
          {t('adjustments.profile.blackAndWhite')}
        </span>
      ) : undefined,
    };
    return isGrid ? <BrowserTile {...itemProps} /> : <BrowserRow {...itemProps} />;
  };

  const activeContent = adjustments.profile && (
    <div className="px-1 pt-1 pb-2" onClick={(event) => event.stopPropagation()}>
      <AdjustmentSlider
        adjustments={adjustments}
        control={ProfileAdjustment.ProfileAmount}
        setAdjustments={setAdjustments}
        onDragStateChange={onDragStateChange}
      />
    </div>
  );

  const renderSectionItems = (section: ProfileSection) => (
    <BrowserItems
      isGrid={isGrid}
      items={section.entries}
      getKey={(entry) => entry.path}
      renderItem={renderProfile}
      activeKey={section.key === activeSectionKey ? entries.find((entry) => entry.id === profileId)?.path : null}
      activeContent={activeContent}
    />
  );

  const hasOnlyUngrouped = sections.length === 1 && sections[0].key === UNGROUPED_SECTION;

  return (
    <div className="flex flex-col h-full">
      <LooksHeader
        actions={
          <>
            <button
              className="p-2 rounded-full hover:bg-surface transition-colors"
              onClick={importProfiles}
              data-tooltip={t('adjustments.profile.import')}
            >
              <Upload size={18} />
            </button>
            <button
              className="p-2 rounded-full hover:bg-surface transition-colors"
              onClick={() => openDialog({ mode: 'create' })}
              data-tooltip={t('adjustments.profile.create')}
            >
              <Plus size={18} />
            </button>
          </>
        }
      />
      {entries.length > 0 && (
        <BrowserToolbar
          query={query}
          onQueryChange={setQuery}
          placeholder={t('editor.looks.searchProfiles')}
          isGrid={isGrid}
          onGridChange={setGrid}
        />
      )}
      <div className="px-4 compact:px-3 pt-2 empty:hidden">
        <ProfileEditingBar />
      </div>
      <div className="grow overflow-y-auto p-4 compact:p-2 space-y-2 compact:space-y-1" onMouseLeave={endPreview}>
        {entries.length === 0 ? (
          <Text color={TextColors.secondary} className="text-center pt-4">
            {t('adjustments.profile.empty')}
          </Text>
        ) : isSearching && sections.length === 0 ? (
          <Text color={TextColors.secondary} className="text-center pt-4">
            {t('editor.looks.noMatches')}
          </Text>
        ) : hasOnlyUngrouped ? (
          renderSectionItems(sections[0])
        ) : (
          sections.map((section) => (
            <BrowserSection
              key={section.key}
              count={section.entries.length}
              icon={
                section.key === FAVORITES_SECTION ? (
                  <Star size={14} className="text-accent" fill="currentColor" />
                ) : undefined
              }
              isOpen={isOpen(section)}
              onContextMenu={
                section.group !== undefined
                  ? (event) => handleGroupContextMenu(event, section.group as string)
                  : undefined
              }
              onToggle={() => toggleSection(section.key, true)}
              title={section.title}
            >
              {renderSectionItems(section)}
            </BrowserSection>
          ))
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
