import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { AnimatePresence, motion } from 'framer-motion';
import { open, save } from '@tauri-apps/plugin-dialog';
import {
  ChevronDown,
  ImageOff,
  Pencil,
  Plus,
  Save,
  Share2,
  Star,
  TextCursorInput,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ParseKeys } from 'i18next';
import { toast } from 'react-toastify';
import clsx from 'clsx';
import AdjustmentSlider from './AdjustmentSlider';
import AdjustmentTool from './AdjustmentTool';
import CreateProfileModal, { CreateProfileChoice } from '../modals/CreateProfileModal';
import { useContextMenu } from '../../context/ContextMenuContext';
import { useEditorStore } from '../../store/useEditorStore';
import BrowserViewSwitch from '../ui/LooksBrowser/BrowserViewSwitch';
import { useLooksBrowser } from '../ui/LooksBrowser/useLooksBrowser';
import { Invokes } from '../ui/AppProperties';
import {
  Adjustments,
  CustomProfile,
  CustomProfileEntry,
  INITIAL_ADJUSTMENTS,
  PROFILE_BAKE_GROUPS,
  PROFILE_FILE_EXTENSION,
  ProfileAdjustment,
  getProfileBakeGroupOfKey,
} from '../../utils/adjustments';

interface ProfilePanelProps {
  adjustments: Adjustments;
  setAdjustments(updater: (prev: Partial<Adjustments>) => Partial<Adjustments>, historyLabel?: string): void;
  isForMask?: boolean;
  onDragStateChange?: (isDragging: boolean) => void;
}

/** The grid's previews: pixels on the long side, and how many photo/edit states are kept. */
const PREVIEW_SIZE = 112;
const PREVIEW_CACHE_SIZE = 8;

interface CreatedProfile {
  path: string;
  profile: CustomProfile;
  /** Ticked keys the profile could not take (`custom_profile::Bake::kept`). */
  keptKeys: string[];
}

/** The profile dialog that is open: a new profile, a new revision of the one being edited, or a rename. */
type ProfileDialog =
  { mode: 'create' } | { mode: 'update'; entry: CustomProfileEntry } | { mode: 'rename'; entry: CustomProfileEntry };

/** A profile's recipe on the sliders (Edit Profile), and the edit to go back to on Cancel. */
interface ProfileEditing {
  entry: CustomProfileEntry;
  before: Adjustments;
  /** The bake groups the recipe holds, ticked again by Update Profile. */
  recipeGroups: Set<string>;
}

/** A profile as edits embed it: without its recipe, which only its file keeps. */
const toEmbedded = (profile: CustomProfile): CustomProfile => {
  const embedded = { ...profile };
  delete embedded.recipe;
  return embedded;
};

/** The edit with `profile` as its base: Amount kept when a profile was already set, B&W as the profile says. */
const withProfile = <T extends Partial<Adjustments>>(adjustments: T, profile: CustomProfile): T => ({
  ...adjustments,
  profile: toEmbedded(profile),
  profileAmount: adjustments.profile ? (adjustments.profileAmount ?? 100) : 100,
  monochrome: profile.monochrome,
  sectionVisibility: { ...adjustments.sectionVisibility, profile: true },
});

const isChanged = (adjustments: Partial<Adjustments>, key: string) =>
  JSON.stringify(adjustments[key]) !== JSON.stringify(INITIAL_ADJUSTMENTS[key]);

/** The bake groups the photo has changed from their defaults; White Balance starts unticked. */
const changedBakeGroups = (adjustments: Adjustments): Set<string> =>
  new Set(
    PROFILE_BAKE_GROUPS.filter(
      (bake) => bake.id !== 'whiteBalance' && bake.keys.some((key) => isChanged(adjustments, key)),
    ).map((bake) => bake.id),
  );

/**
 * The Profile block at the top of Light (Plan item 83): the custom profile the look starts from,
 * chosen from the profile folder with a live preview on hover, its Amount, and Create Profile.
 */
export default function ProfilePanel({
  adjustments,
  setAdjustments,
  isForMask = false,
  onDragStateChange,
}: ProfilePanelProps) {
  const { t } = useTranslation();
  const { showContextMenu } = useContextMenu();
  const setEditor = useEditorStore((state) => state.setEditor);
  const selectedImagePath = useEditorStore((state) => state.selectedImage?.path ?? null);
  const [entries, setEntries] = useState<CustomProfileEntry[]>([]);
  const [isExpanded, setIsExpanded] = useState(false);
  const [dialog, setDialog] = useState<ProfileDialog | null>(null);
  const [editing, setEditing] = useState<ProfileEditing | null>(null);
  const [isBaking, setIsBaking] = useState(false);
  const loaded = useRef<Map<string, CustomProfile>>(new Map());
  const hoveredPath = useRef<string | null>(null);
  const profile = adjustments.profile ?? null;

  const isImageReady = useEditorStore((state) => state.selectedImage?.isReady ?? false);
  const { favorites, toggleFavorite, isGrid: isGridView, setGrid: setGridView } = useLooksBrowser('profiles');
  const [previews, setPreviews] = useState<Record<string, string | null>>({});
  const [isLoadingPreviews, setIsLoadingPreviews] = useState(false);
  const previewCache = useRef<Map<string, Record<string, string | null>>>(new Map());
  // The grid renders the edit as it is when it opens, not on every slider move.
  const adjustmentsRef = useRef(adjustments);
  useEffect(() => {
    adjustmentsRef.current = adjustments;
  });

  // Editing belongs to the photo it started on.
  useEffect(() => setEditing(null), [selectedImagePath]);

  const refreshList = useCallback(async () => {
    try {
      setEntries(await invoke<CustomProfileEntry[]>(Invokes.ListCustomProfiles));
    } catch (err) {
      console.error('Failed to list custom profiles:', err);
    }
  }, []);

  useEffect(() => {
    if (!isForMask) refreshList();
  }, [isForMask, refreshList]);

  const loadProfile = useCallback(async (path: string): Promise<CustomProfile> => {
    const cached = loaded.current.get(path);
    if (cached) return cached;
    const data = await invoke<CustomProfile>(Invokes.LoadCustomProfile, { path });
    loaded.current.set(path, data);
    return data;
  }, []);

  const endPreview = useCallback(() => {
    hoveredPath.current = null;
    setEditor({ previewOverride: null });
  }, [setEditor]);

  useEffect(() => endPreview, [endPreview]);

  const startPreview = useCallback(
    async (path: string) => {
      hoveredPath.current = path;
      try {
        const data = await loadProfile(path);
        if (hoveredPath.current !== path) return;
        setEditor((state) => ({ previewOverride: withProfile(state.adjustments, data) }));
      } catch (err) {
        console.error('Failed to preview custom profile:', err);
      }
    },
    [loadProfile, setEditor],
  );

  const handleSelect = useCallback(
    async (entry: CustomProfileEntry) => {
      endPreview();
      if (profile?.id === entry.id) {
        setAdjustments((prev) => ({ ...prev, profile: null, profileAmount: 100 }));
        return;
      }
      try {
        const data = await loadProfile(entry.path);
        setAdjustments((prev) => withProfile(prev, data));
      } catch (err) {
        toast.error(t('adjustments.profile.loadFailed', { error: String(err) }));
      }
    },
    [endPreview, loadProfile, profile?.id, setAdjustments, t],
  );

  const handleClear = () => setAdjustments((prev) => ({ ...prev, profile: null, profileAmount: 100 }));

  /** Edit Profile: the recipe back on the sliders, the profile itself taken off the photo. */
  const handleEdit = async (entry: CustomProfileEntry) => {
    endPreview();
    try {
      const data = await loadProfile(entry.path);
      const recipe = data.recipe;
      if (!recipe) {
        toast.info(t('adjustments.profile.noRecipe'));
        return;
      }
      setEditing({
        entry,
        before: adjustments,
        recipeGroups: new Set(
          PROFILE_BAKE_GROUPS.filter((bake) => bake.keys.some((key) => key in recipe)).map((bake) => bake.id),
        ),
      });
      setAdjustments(
        (prev) => ({
          ...prev,
          profile: null,
          profileAmount: 100,
          ...structuredClone(recipe),
          monochrome: data.monochrome,
        }),
        t('adjustments.profile.edit'),
      );
    } catch (err) {
      toast.error(t('adjustments.profile.loadFailed', { error: String(err) }));
    }
  };

  const handleCancelEdit = () => {
    if (!editing) return;
    const { before } = editing;
    setEditing(null);
    setAdjustments(() => before, t('adjustments.profile.cancelEdit'));
  };

  const handleRename = async (entry: CustomProfileEntry, choice: CreateProfileChoice) => {
    try {
      setEntries(
        await invoke<CustomProfileEntry[]>(Invokes.RenameCustomProfile, {
          path: entry.path,
          name: choice.name,
          group: choice.group,
          monochrome: choice.monochrome,
        }),
      );
      loaded.current.clear();
      setEditing(null);
      setDialog(null);
    } catch (err) {
      toast.error(t('adjustments.profile.renameFailed', { error: String(err) }));
    }
  };

  const handleImport = async () => {
    try {
      const selected = await open({
        multiple: true,
        filters: [{ name: t('adjustments.profile.fileType'), extensions: [PROFILE_FILE_EXTENSION] }],
      });
      const sourcePaths = Array.isArray(selected) ? selected : selected ? [selected] : [];
      if (sourcePaths.length === 0) return;
      const list = await invoke<CustomProfileEntry[]>(Invokes.ImportCustomProfiles, { sourcePaths });
      const added = list.length - entries.length;
      setEntries(list);
      setIsExpanded(true);
      if (added < sourcePaths.length) {
        toast.warn(t('adjustments.profile.importSkipped', { count: sourcePaths.length - added }));
      }
    } catch (err) {
      toast.error(t('adjustments.profile.importFailed', { error: String(err) }));
    }
  };

  const handleExport = async (entry: CustomProfileEntry) => {
    try {
      const destination = await save({
        defaultPath: `${entry.name}.${PROFILE_FILE_EXTENSION}`,
        filters: [{ name: t('adjustments.profile.fileType'), extensions: [PROFILE_FILE_EXTENSION] }],
      });
      if (!destination) return;
      await invoke(Invokes.ExportCustomProfile, { path: entry.path, destination });
    } catch (err) {
      toast.error(t('adjustments.profile.exportFailed', { error: String(err) }));
    }
  };

  /** Save to my profiles: the photo's embedded profile into the profile folder. */
  const handleSaveEmbedded = async () => {
    if (!profile) return;
    try {
      setEntries(await invoke<CustomProfileEntry[]>(Invokes.SaveEmbeddedCustomProfile, { profile }));
    } catch (err) {
      toast.error(t('adjustments.profile.saveFailed', { error: String(err) }));
    }
  };

  const handleContextMenu = (event: React.MouseEvent, entry: CustomProfileEntry) => {
    event.preventDefault();
    event.stopPropagation();
    showContextMenu(event.clientX, event.clientY, [
      {
        label: t('adjustments.profile.edit'),
        icon: Pencil,
        disabled: !entry.canEdit,
        onClick: () => handleEdit(entry),
      },
      {
        label: t('adjustments.profile.rename'),
        icon: TextCursorInput,
        onClick: () => setDialog({ mode: 'rename', entry }),
      },
      {
        label: t('adjustments.profile.export'),
        icon: Share2,
        onClick: () => handleExport(entry),
      },
      {
        label: t('adjustments.profile.delete'),
        icon: Trash2,
        isDestructive: true,
        onClick: async () => {
          try {
            setEntries(await invoke<CustomProfileEntry[]>(Invokes.DeleteCustomProfile, { path: entry.path }));
            loaded.current.delete(entry.path);
            if (editing?.entry.path === entry.path) setEditing(null);
          } catch (err) {
            toast.error(t('adjustments.profile.deleteFailed', { error: String(err) }));
          }
        },
      },
    ]);
  };

  /** Create Profile, or Update Profile for the profile being edited: bake the ticked settings. */
  const handleBake = async (choice: CreateProfileChoice, entry?: CustomProfileEntry) => {
    const keys = PROFILE_BAKE_GROUPS.filter((bake) => choice.groups.has(bake.id)).flatMap((bake) => bake.keys);
    setIsBaking(true);
    try {
      const request = { name: choice.name, group: choice.group, keys, monochrome: choice.monochrome, adjustments };
      const created = entry
        ? await invoke<CreatedProfile>(Invokes.UpdateCustomProfile, { path: entry.path, request })
        : await invoke<CreatedProfile>(Invokes.CreateCustomProfile, { request });
      if (entry) {
        loaded.current.delete(entry.path);
        previewCache.current.clear();
      }
      loaded.current.set(created.path, created.profile);
      // The baked settings move into the profile, so the photo keeps its look at Amount 100;
      // what the profile could not take (its own curve or Zone Editor won) stays in the photo.
      const kept = new Set(created.keptKeys.flatMap((key) => getProfileBakeGroupOfKey(key)?.keys ?? [key]));
      const baked = keys.filter((key) => !kept.has(key));
      setAdjustments(
        (prev) => ({
          ...withProfile(
            {
              ...prev,
              ...Object.fromEntries(baked.map((key) => [key, structuredClone(INITIAL_ADJUSTMENTS[key])])),
              profile: null,
            },
            created.profile,
          ),
          monochrome: choice.monochrome,
        }),
        t(entry ? 'modals.createProfile.titleUpdate' : 'modals.createProfile.title'),
      );
      if (created.keptKeys.length > 0) {
        const settings = created.keptKeys
          .map((key) => getProfileBakeGroupOfKey(key)?.label)
          .filter((label): label is string => label !== undefined)
          .map((label) => t(label as ParseKeys))
          .join(', ');
        toast.info(t('modals.createProfile.kept', { settings }));
      }
      setDialog(null);
      setEditing(null);
      refreshList();
    } catch (err) {
      toast.error(t('modals.createProfile.failed', { error: String(err) }));
    } finally {
      setIsBaking(false);
    }
  };

  /** Save as LUT: the ticked settings into a finishing LUT in Look → LUT; the photo stays as it is. */
  const handleSaveLut = async (choice: CreateProfileChoice) => {
    const keys = PROFILE_BAKE_GROUPS.filter((bake) => choice.groups.has(bake.id)).flatMap((bake) => bake.keys);
    setIsBaking(true);
    try {
      await invoke<string>(Invokes.SaveSettingsAsLut, {
        request: { name: choice.name, group: '', keys, monochrome: choice.monochrome, adjustments },
      });
      toast.success(t('modals.createProfile.lutSaved', { name: choice.name }));
      setDialog(null);
    } catch (err) {
      toast.error(t('modals.createProfile.lutFailed', { error: String(err) }));
    } finally {
      setIsBaking(false);
    }
  };

  const handleDialogSubmit = (choice: CreateProfileChoice) => {
    if (dialog?.mode === 'rename') handleRename(dialog.entry, choice);
    else if (choice.target === 'lut') handleSaveLut(choice);
    else handleBake(choice, dialog?.mode === 'update' ? dialog.entry : undefined);
  };

  // The grid's previews: the open photo with each profile, rendered when the grid opens.
  useEffect(() => {
    if (!isExpanded || !isGridView || !selectedImagePath || !isImageReady || entries.length === 0) return;
    const edit = adjustmentsRef.current;
    const paths = entries.map((entry) => entry.path);
    const key = `${selectedImagePath}|${paths.join(',')}|${JSON.stringify({ ...edit, profile: edit.profile?.id ?? null })}`;
    const cached = previewCache.current.get(key);
    if (cached) {
      setPreviews(cached);
      return;
    }
    let isActive = true;
    setIsLoadingPreviews(true);
    invoke<Array<{ path: string; thumb: string | null }>>(Invokes.GenerateProfilePreviews, {
      paths,
      adjustments: edit,
      size: PREVIEW_SIZE,
    })
      .then((results) => {
        if (!isActive) return;
        const map = Object.fromEntries(results.map((result) => [result.path, result.thumb]));
        if (previewCache.current.size >= PREVIEW_CACHE_SIZE) previewCache.current.clear();
        previewCache.current.set(key, map);
        setPreviews(map);
      })
      .catch((err) => console.error('Failed to generate profile previews:', err))
      .finally(() => {
        if (isActive) setIsLoadingPreviews(false);
      });
    return () => {
      isActive = false;
    };
  }, [isExpanded, isGridView, selectedImagePath, isImageReady, entries]);

  const groupedEntries = useMemo(() => {
    const groups = new Map<string, CustomProfileEntry[]>();
    for (const entry of entries) {
      groups.set(entry.group, [...(groups.get(entry.group) ?? []), entry]);
    }
    return [...groups.entries()];
  }, [entries]);
  // Favorites first, as in Adobe's Profile Browser, then each group; a favorite shows in both.
  const sections = useMemo(() => {
    const favoriteEntries = entries.filter((entry) => favorites.has(entry.id));
    return [
      ...(favoriteEntries.length > 0
        ? [{ key: 'favorites', title: t('editor.looks.favorites'), entries: favoriteEntries }]
        : []),
      ...groupedEntries.map(([group, groupEntries]) => ({
        key: `group:${group}`,
        title: group || t('adjustments.profile.ungrouped'),
        entries: groupEntries,
      })),
    ];
  }, [entries, favorites, groupedEntries, t]);
  // Update Profile ticks what the recipe held as well as what the photo has changed since.
  const initialGroups = useMemo(
    () => new Set([...changedBakeGroups(adjustments), ...(editing?.recipeGroups ?? [])]),
    [adjustments, editing],
  );
  const dialogEntry = dialog && dialog.mode !== 'create' ? dialog.entry : null;
  const isSaved = !profile || entries.some((entry) => entry.id === profile.id);

  if (isForMask) {
    return null;
  }

  return (
    <AdjustmentTool id="profile" isUntitled>
      {/* As Lightroom Classic's Profile row: the label, the chosen profile in a field that opens the list. */}
      <div className="flex items-center gap-2">
        <span className="text-sm compact:text-xs font-medium text-text-primary select-none shrink-0">
          {t('adjustments.profile.title')}
        </span>
        <button
          onClick={() => setIsExpanded((value) => !value)}
          className={clsx(
            'flex-1 min-w-0 flex items-center justify-between gap-2 px-2.5 py-1.5 compact:py-1 rounded-md bg-bg-primary border text-sm compact:text-xs transition-colors',
            isExpanded ? 'border-accent' : 'border-border hover:border-text-secondary',
          )}
          data-tooltip={isSaved ? t('adjustments.profile.browse') : t('adjustments.profile.notSaved')}
        >
          <span
            className={clsx('truncate', profile ? 'text-text-primary' : 'text-text-secondary', !isSaved && 'italic')}
          >
            {profile?.name ?? t('adjustments.profile.none')}
          </span>
          <ChevronDown
            size={16}
            className={`shrink-0 text-text-secondary transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
          />
        </button>
        {profile && (
          <button
            onClick={handleClear}
            className="p-0.5 rounded-sm text-text-secondary hover:text-text-primary transition-colors"
            data-tooltip={t('adjustments.profile.clear')}
          >
            <X size={16} />
          </button>
        )}
        <button
          className="p-0.5 rounded-sm text-text-secondary hover:text-text-primary transition-colors"
          data-tooltip={t('adjustments.profile.create')}
          onClick={() => setDialog({ mode: 'create' })}
        >
          <Plus size={16} />
        </button>
        <button
          className="p-0.5 rounded-sm text-text-secondary hover:text-text-primary transition-colors"
          data-tooltip={t('adjustments.profile.import')}
          onClick={handleImport}
        >
          <Upload size={16} />
        </button>
      </div>

      {profile && !isSaved && (
        <button
          className="mt-2 flex items-center gap-1.5 text-xs text-text-secondary hover:text-accent transition-colors"
          onClick={handleSaveEmbedded}
        >
          <Save size={14} />
          {t('adjustments.profile.saveToProfiles')}
        </button>
      )}

      {editing && (
        <div className="mt-2 p-2 rounded-sm bg-surface flex items-center justify-between gap-2 text-xs">
          <span className="truncate text-text-primary">
            {t('adjustments.profile.editing', { name: editing.entry.name })}
          </span>
          <div className="flex gap-1 shrink-0">
            <button
              className="px-2 py-1 rounded-sm text-text-secondary hover:text-text-primary hover:bg-bg-tertiary transition-colors"
              onClick={handleCancelEdit}
            >
              {t('adjustments.profile.cancelEdit')}
            </button>
            <button
              className="px-2 py-1 rounded-sm bg-accent text-button-text font-semibold hover:bg-accent-hover transition-colors"
              onClick={() => setDialog({ mode: 'update', entry: editing.entry })}
            >
              {t('adjustments.profile.update')}
            </button>
          </div>
        </div>
      )}

      <AnimatePresence initial={false}>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <div className="mt-2 flex flex-col gap-2" onMouseLeave={endPreview}>
              {entries.length === 0 ? (
                <p className="text-xs text-text-secondary">{t('adjustments.profile.empty')}</p>
              ) : (
                <>
                  <div className="flex justify-end">
                    <BrowserViewSwitch isGrid={isGridView} onChange={setGridView} />
                  </div>
                  {sections.map((section) => (
                    <div key={section.key}>
                      <p className="text-xs text-text-secondary mb-1">{section.title}</p>
                      <div className={isGridView ? 'grid grid-cols-3 gap-2' : 'flex flex-col'}>
                        {section.entries.map((entry) => {
                          const isSelected = entry.id === profile?.id;
                          const isFavorite = favorites.has(entry.id);
                          const entryProps = {
                            onMouseEnter: () => startPreview(entry.path),
                            onClick: () => handleSelect(entry),
                            onContextMenu: (e: React.MouseEvent) => handleContextMenu(e, entry),
                          };
                          const star = (
                            <button
                              aria-pressed={isFavorite}
                              className={clsx(
                                'p-0.5 rounded-sm transition-opacity',
                                isGridView && 'absolute top-1 right-1 bg-black/40',
                                isFavorite
                                  ? 'text-accent'
                                  : 'opacity-0 group-hover/profile:opacity-100 text-text-secondary hover:text-text-primary',
                                isGridView && !isFavorite && 'text-white',
                              )}
                              data-tooltip={isFavorite ? t('editor.favorites.remove') : t('editor.favorites.add')}
                              onClick={() => toggleFavorite(entry.id)}
                            >
                              <Star size={12} fill={isFavorite ? 'currentColor' : 'none'} />
                            </button>
                          );
                          if (isGridView) {
                            const thumb = previews[entry.path];
                            return (
                              <div key={entry.path} className="relative group/profile">
                                <button
                                  {...entryProps}
                                  className={clsx(
                                    'relative w-full aspect-square rounded-md overflow-hidden bg-bg-primary border-2 transition-colors',
                                    isSelected ? 'border-accent' : 'border-transparent hover:border-surface',
                                  )}
                                  data-tooltip={entry.name}
                                >
                                  {isLoadingPreviews && thumb === undefined ? (
                                    <div className="w-full h-full animate-pulse bg-surface" />
                                  ) : thumb ? (
                                    <img
                                      src={thumb}
                                      alt={entry.name}
                                      className="w-full h-full object-cover"
                                      draggable={false}
                                    />
                                  ) : (
                                    <div className="w-full h-full flex items-center justify-center text-text-secondary">
                                      <ImageOff size={18} />
                                    </div>
                                  )}
                                  {entry.monochrome && (
                                    <span className="absolute top-1 left-1 px-1 rounded-sm text-[9px] text-white bg-black/50">
                                      {t('adjustments.profile.blackAndWhite')}
                                    </span>
                                  )}
                                  <span className="absolute inset-x-0 bottom-0 px-1 py-0.5 text-[10px] text-white bg-black/50 truncate text-left">
                                    {entry.name}
                                  </span>
                                </button>
                                {star}
                              </div>
                            );
                          }
                          return (
                            <div
                              key={entry.path}
                              className={clsx(
                                'group/profile flex items-center gap-1 pr-1 rounded-sm transition-colors',
                                isSelected ? 'bg-accent text-button-text' : 'text-text-primary hover:bg-surface',
                              )}
                            >
                              <button
                                {...entryProps}
                                className="flex-1 min-w-0 flex items-center justify-between gap-2 px-2 py-1 text-sm text-left"
                              >
                                <span className="truncate">{entry.name}</span>
                                {entry.monochrome && (
                                  <span className="text-[10px] shrink-0 opacity-70">
                                    {t('adjustments.profile.blackAndWhite')}
                                  </span>
                                )}
                              </button>
                              {star}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {profile && (
        <div className="mt-2">
          <AdjustmentSlider
            adjustments={adjustments}
            control={ProfileAdjustment.ProfileAmount}
            setAdjustments={setAdjustments}
            onDragStateChange={onDragStateChange}
          />
        </div>
      )}

      <CreateProfileModal
        isOpen={dialog !== null}
        mode={dialog?.mode ?? 'create'}
        currentProfileName={profile?.name ?? null}
        initialName={dialogEntry?.name ?? ''}
        initialGroup={dialogEntry?.group ?? ''}
        initialGroups={initialGroups}
        initialMonochrome={dialog?.mode === 'rename' ? dialog.entry.monochrome : adjustments.monochrome}
        isBusy={isBaking}
        onClose={() => setDialog(null)}
        onSubmit={handleDialogSubmit}
      />
    </AdjustmentTool>
  );
}
