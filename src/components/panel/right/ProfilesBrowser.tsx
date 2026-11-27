import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';
import { Pencil, Plus, Share2, TextCursorInput, Trash2, Upload } from 'lucide-react';
import AdjustmentSlider from '../../adjustments/AdjustmentSlider';
import { ProfileEditingBar } from '../../adjustments/Profile';
import GroupedBrowser from '../../ui/LooksBrowser/GroupedBrowser';
import { Invokes, OPTION_SEPARATOR } from '../../ui/AppProperties';
import { useCustomProfiles, useCustomProfileStore } from '../../../hooks/useCustomProfiles';
import { openLookDialog } from '../../../hooks/useLookDialog';
import { useAdjustmentSectionProps } from '../../../hooks/useAdjustmentSectionProps';
import { useEditorStore } from '../../../store/useEditorStore';
import { CustomProfileEntry, ProfileAdjustment } from '../../../utils/adjustments';

/** The previews' long side in pixels, and how many photo/edit states are kept. */
const PREVIEW_SIZE = 112;
const PREVIEW_CACHE_SIZE = 8;
const previewCache = new Map<string, Record<string, string | null>>();

const getPath = (entry: CustomProfileEntry) => entry.path;
const getId = (entry: CustomProfileEntry) => entry.id;

/** Looks → Profiles: the profile folder by group, as a grid of previews or a list (Plan item 86). */
export default function ProfilesBrowser() {
  const { t } = useTranslation();
  const {
    startPreview,
    endPreview,
    selectProfile,
    startEdit,
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
    const paths = entries.map(getPath);
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

  return (
    <GroupedBrowser
      kind="profiles"
      items={entries}
      getKey={getPath}
      getFavoriteId={getId}
      previews={previews}
      isSelected={(entry) => entry.id === profileId}
      activeContent={
        <div className="px-1 pt-1 pb-2" onClick={(event) => event.stopPropagation()}>
          <AdjustmentSlider
            adjustments={adjustments}
            control={ProfileAdjustment.ProfileAmount}
            setAdjustments={setAdjustments}
            onDragStateChange={onDragStateChange}
          />
        </div>
      }
      onSelect={selectProfile}
      onHoverStart={(entry) => startPreview(entry.path)}
      onHoverEnd={endPreview}
      badges={(entry) =>
        entry.monochrome ? (
          <span className="px-1 rounded-sm text-[9px] text-white bg-black/50 shrink-0">
            {t('adjustments.profile.blackAndWhite')}
          </span>
        ) : undefined
      }
      itemMenu={(entry, moveToGroupOption) => [
        {
          label: t('adjustments.profile.edit'),
          icon: Pencil,
          disabled: !entry.canEdit,
          onClick: () => startEdit(entry),
        },
        {
          label: t('adjustments.profile.rename'),
          icon: TextCursorInput,
          onClick: () => openLookDialog({ mode: 'renameProfile', entry }),
        },
        moveToGroupOption,
        { label: t('adjustments.profile.export'), icon: Share2, onClick: () => exportProfile(entry) },
        { type: OPTION_SEPARATOR },
        {
          label: t('adjustments.profile.delete'),
          icon: Trash2,
          isDestructive: true,
          onClick: () => deleteProfile(entry),
        },
      ]}
      onMoveToGroup={moveToGroup}
      headerActions={
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
            onClick={() => openLookDialog({ mode: 'new', type: 'profile' })}
            data-tooltip={t('adjustments.profile.create')}
          >
            <Plus size={18} />
          </button>
        </>
      }
      searchPlaceholder={t('editor.looks.searchProfiles')}
      emptyText={t('adjustments.profile.empty')}
      topContent={<ProfileEditingBar />}
    />
  );
}
