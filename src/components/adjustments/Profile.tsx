import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, Plus, Trash2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import clsx from 'clsx';
import AdjustmentSlider from './AdjustmentSlider';
import AdjustmentTool from './AdjustmentTool';
import CreateProfileModal, { CreateProfileChoice } from '../modals/CreateProfileModal';
import { useContextMenu } from '../../context/ContextMenuContext';
import { useEditorStore } from '../../store/useEditorStore';
import { Invokes } from '../ui/AppProperties';
import {
  Adjustments,
  CustomProfile,
  CustomProfileEntry,
  INITIAL_ADJUSTMENTS,
  PROFILE_BAKE_GROUPS,
  ProfileAdjustment,
} from '../../utils/adjustments';

interface ProfilePanelProps {
  adjustments: Adjustments;
  setAdjustments(updater: (prev: Partial<Adjustments>) => Partial<Adjustments>, historyLabel?: string): void;
  isForMask?: boolean;
  onDragStateChange?: (isDragging: boolean) => void;
}

interface CreatedProfile {
  path: string;
  profile: CustomProfile;
}

/** The edit with `profile` as its base: Amount kept when a profile was already set, B&W as the profile says. */
const withProfile = <T extends Partial<Adjustments>>(adjustments: T, profile: CustomProfile): T => ({
  ...adjustments,
  profile,
  profileAmount: adjustments.profile ? (adjustments.profileAmount ?? 100) : 100,
  monochrome: profile.monochrome,
  sectionVisibility: { ...adjustments.sectionVisibility, profile: true },
});

/** The bake groups the photo has changed from their defaults; White Balance starts unticked. */
const changedBakeGroups = (adjustments: Adjustments): Set<string> =>
  new Set(
    PROFILE_BAKE_GROUPS.filter(
      (bake) =>
        bake.id !== 'whiteBalance' &&
        bake.keys.some((key) => JSON.stringify(adjustments[key]) !== JSON.stringify(INITIAL_ADJUSTMENTS[key])),
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
  const [entries, setEntries] = useState<CustomProfileEntry[]>([]);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const loaded = useRef<Map<string, CustomProfile>>(new Map());
  const hoveredPath = useRef<string | null>(null);
  const profile = adjustments.profile ?? null;

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

  const handleContextMenu = (event: React.MouseEvent, entry: CustomProfileEntry) => {
    event.preventDefault();
    event.stopPropagation();
    showContextMenu(event.clientX, event.clientY, [
      {
        label: t('adjustments.profile.delete'),
        icon: Trash2,
        isDestructive: true,
        onClick: async () => {
          try {
            setEntries(await invoke<CustomProfileEntry[]>(Invokes.DeleteCustomProfile, { path: entry.path }));
            loaded.current.delete(entry.path);
          } catch (err) {
            toast.error(t('adjustments.profile.deleteFailed', { error: String(err) }));
          }
        },
      },
    ]);
  };

  const handleCreate = async (choice: CreateProfileChoice) => {
    const keys = PROFILE_BAKE_GROUPS.filter((bake) => choice.groups.has(bake.id)).flatMap((bake) => bake.keys);
    setIsCreating(true);
    try {
      const created = await invoke<CreatedProfile>(Invokes.CreateCustomProfile, {
        request: { name: choice.name, group: choice.group, keys, monochrome: choice.monochrome, adjustments },
      });
      loaded.current.set(created.path, created.profile);
      // The baked settings move into the profile, so the photo keeps its look at Amount 100.
      setAdjustments(
        (prev) => ({
          ...withProfile({ ...prev, profile: null }, created.profile),
          ...Object.fromEntries(keys.map((key) => [key, structuredClone(INITIAL_ADJUSTMENTS[key])])),
          monochrome: choice.monochrome,
        }),
        t('modals.createProfile.title'),
      );
      setIsCreateOpen(false);
      refreshList();
    } catch (err) {
      toast.error(t('modals.createProfile.failed', { error: String(err) }));
    } finally {
      setIsCreating(false);
    }
  };

  const groupedEntries = useMemo(() => {
    const groups = new Map<string, CustomProfileEntry[]>();
    for (const entry of entries) {
      groups.set(entry.group, [...(groups.get(entry.group) ?? []), entry]);
    }
    return [...groups.entries()];
  }, [entries]);
  const initialGroups = useMemo(() => changedBakeGroups(adjustments), [adjustments]);
  const isSaved = !profile || entries.some((entry) => entry.id === profile.id);

  if (isForMask) {
    return null;
  }

  return (
    <AdjustmentTool
      id="profile"
      actions={
        <button
          className="p-0.5 rounded-sm text-text-secondary hover:text-text-primary transition-colors"
          data-tooltip={t('adjustments.profile.create')}
          onClick={() => setIsCreateOpen(true)}
        >
          <Plus size={16} />
        </button>
      }
    >
      <div className="flex justify-end items-center gap-1">
        {profile && (
          <button
            onClick={handleClear}
            className="flex items-center justify-center p-0.5 rounded-full bg-bg-tertiary hover:bg-surface text-text-secondary hover:text-text-primary transition-colors"
            data-tooltip={t('adjustments.profile.clear')}
          >
            <X size={14} />
          </button>
        )}
        <button
          onClick={() => setIsExpanded((value) => !value)}
          className="flex items-center gap-1 text-sm text-text-secondary select-none cursor-pointer hover:text-accent transition-colors min-w-0"
          data-tooltip={isSaved ? t('adjustments.profile.browse') : t('adjustments.profile.notSaved')}
        >
          <span className={clsx('truncate text-right', !isSaved && 'italic')}>
            {profile?.name ?? t('adjustments.profile.none')}
          </span>
          <ChevronDown
            size={16}
            className={`shrink-0 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
          />
        </button>
      </div>

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
                groupedEntries.map(([group, groupEntries]) => (
                  <div key={group}>
                    <p className="text-xs text-text-secondary mb-1">{group || t('adjustments.profile.ungrouped')}</p>
                    <div className="flex flex-col">
                      {groupEntries.map((entry) => (
                        <button
                          key={entry.path}
                          onMouseEnter={() => startPreview(entry.path)}
                          onClick={() => handleSelect(entry)}
                          onContextMenu={(e) => handleContextMenu(e, entry)}
                          className={clsx(
                            'flex items-center justify-between gap-2 px-2 py-1 rounded-sm text-sm text-left transition-colors',
                            entry.id === profile?.id
                              ? 'bg-accent text-button-text'
                              : 'text-text-primary hover:bg-surface',
                          )}
                        >
                          <span className="truncate">{entry.name}</span>
                          {entry.monochrome && (
                            <span className="text-[10px] shrink-0 opacity-70">
                              {t('adjustments.profile.blackAndWhite')}
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                ))
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
        isOpen={isCreateOpen}
        initialGroups={initialGroups}
        initialMonochrome={adjustments.monochrome}
        isCreating={isCreating}
        onClose={() => setIsCreateOpen(false)}
        onCreate={handleCreate}
      />
    </AdjustmentTool>
  );
}
