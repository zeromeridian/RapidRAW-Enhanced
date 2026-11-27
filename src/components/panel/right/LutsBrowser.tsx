import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';
import { Eye, EyeOff, FileUp, Plus, Trash2, Upload } from 'lucide-react';
import clsx from 'clsx';
import { isGroupVisible } from '../../../utils/adjustments';
import { openLookDialog } from '../../../hooks/useLookDialog';
import Slider from '../../ui/Slider';
import GroupedBrowser from '../../ui/LooksBrowser/GroupedBrowser';
import { Invokes, OPTION_SEPARATOR } from '../../ui/AppProperties';
import { LutEntry, useLuts, useLutStore } from '../../../hooks/useLuts';
import { useAdjustmentSectionProps } from '../../../hooks/useAdjustmentSectionProps';
import { useEditorStore } from '../../../store/useEditorStore';

/** The previews' long side in pixels, and how many photo/folder states are kept. */
const PREVIEW_SIZE = 112;
const PREVIEW_CACHE_SIZE = 8;
const previewCache = new Map<string, Record<string, string | null>>();

const getPath = (entry: LutEntry) => entry.path;
const getId = (entry: LutEntry) => entry.id;

/** Looks → LUTs: the LUT folder by group (its subfolders), as a grid of previews or a list (Plan item 86). */
export default function LutsBrowser() {
  const { t } = useTranslation();
  const { refreshList, selectLut, importLuts, removeLut, moveToGroup, startPreview, endPreview } = useLuts();
  const entries = useLutStore((state) => state.entries);
  const { adjustments, setAdjustments, onDragStateChange } = useAdjustmentSectionProps();
  const selectedImagePath = useEditorStore((state) => state.selectedImage?.path ?? null);
  const isImageReady = useEditorStore((state) => state.selectedImage?.isReady ?? false);
  const [previews, setPreviews] = useState<Record<string, string | null>>({});
  const isLutShown = isGroupVisible(adjustments.sectionVisibility, 'lut');

  // Listed whenever Looks → LUTs opens, so LUTs saved meanwhile (Save as LUT) appear.
  useEffect(() => {
    refreshList();
  }, [refreshList]);

  useEffect(() => endPreview, [endPreview]);

  useEffect(() => {
    if (!selectedImagePath || !isImageReady || entries.length === 0) return;
    const lutPaths = entries.map(getPath);
    const key = `${selectedImagePath}|${lutPaths.join(',')}`;
    const cached = previewCache.get(key);
    if (cached) {
      setPreviews(cached);
      return;
    }
    let isActive = true;
    setPreviews({});
    invoke<Array<{ path: string; thumb: string | null }>>(Invokes.GenerateLutPreviews, {
      lutPaths,
      size: PREVIEW_SIZE,
    })
      .then((results) => {
        if (!isActive) return;
        const map = Object.fromEntries(results.map((result) => [result.path, result.thumb]));
        if (previewCache.size >= PREVIEW_CACHE_SIZE) previewCache.clear();
        previewCache.set(key, map);
        setPreviews(map);
      })
      .catch((err) => console.error('Failed to generate LUT previews:', err));
    return () => {
      isActive = false;
    };
  }, [selectedImagePath, isImageReady, entries]);

  return (
    <GroupedBrowser
      kind="luts"
      items={entries}
      getKey={getPath}
      getFavoriteId={getId}
      previews={previews}
      isSelected={(entry) => entry.path === adjustments.lutPath}
      activeContent={
        <div className="flex items-center gap-2 px-1 pt-1 pb-2" onClick={(event) => event.stopPropagation()}>
          <div className="grow min-w-0">
            <Slider
              label={t('ui.lut.intensity')}
              min={0}
              max={100}
              step={1}
              value={adjustments.lutIntensity ?? 100}
              defaultValue={100}
              onChange={(e) => setAdjustments((prev) => ({ ...prev, lutIntensity: Number(e.target.value) }))}
              onDragStateChange={onDragStateChange}
              fillOrigin="min"
            />
          </div>
          {/* The LUT's own eye (it has no Adjustments section): off keeps it in the edit, unseen. */}
          <button
            className={clsx(
              'p-1 rounded-full hover:bg-bg-primary shrink-0',
              isLutShown ? 'text-text-secondary' : 'text-accent',
            )}
            data-tooltip={t(isLutShown ? 'ui.lut.hideLut' : 'ui.lut.showLut')}
            onClick={() =>
              setAdjustments((prev) => ({
                ...prev,
                sectionVisibility: { ...prev.sectionVisibility, lut: !isLutShown },
              }))
            }
          >
            {isLutShown ? <Eye size={16} /> : <EyeOff size={16} />}
          </button>
        </div>
      }
      onSelect={selectLut}
      onHoverStart={startPreview}
      onHoverEnd={endPreview}
      itemMenu={(entry, moveToGroupOption) => [
        moveToGroupOption,
        { type: OPTION_SEPARATOR },
        { label: t('ui.lut.removeLut'), icon: Trash2, isDestructive: true, onClick: () => removeLut(entry) },
      ]}
      groupMenu={(group) => [
        { label: t('ui.lut.importIntoGroup'), icon: FileUp, onClick: () => importLuts(group) },
        { type: OPTION_SEPARATOR },
      ]}
      onMoveToGroup={moveToGroup}
      headerActions={
        <>
          <button
            className="p-2 rounded-full hover:bg-surface transition-colors"
            onClick={() => importLuts()}
            data-tooltip={t('ui.lut.importLuts')}
          >
            <Upload size={18} />
          </button>
          <button
            className="p-2 rounded-full hover:bg-surface transition-colors"
            onClick={() => openLookDialog({ mode: 'new', type: 'lut' })}
            data-tooltip={t('modals.createProfile.titleLut')}
          >
            <Plus size={18} />
          </button>
        </>
      }
      searchPlaceholder={t('editor.looks.searchLuts')}
      emptyText={t('ui.lut.empty')}
    />
  );
}
