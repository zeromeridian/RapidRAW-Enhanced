import { useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import debounce from 'lodash.debounce';
import { toast } from 'react-toastify';
import { useTranslation } from 'react-i18next';
import { useEditorStore, debouncedSetHistory, getZoomPixelSize } from '../store/useEditorStore';
import { useLibraryStore } from '../store/useLibraryStore';
import { useUIStore } from '../store/useUIStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useProcessStore } from '../store/useProcessStore';
import {
  Adjustments,
  INITIAL_ADJUSTMENTS,
  getInitialAdjustments,
  COPYABLE_ADJUSTMENT_KEYS,
  CROP_GEOMETRY_KEYS,
  PasteMode,
  LensAdjustment,
  MaskContainer,
  normalizeLoadedAdjustments,
} from '../utils/adjustments';
import { calculateCenteredCrop } from '../utils/cropUtils';
import {
  aiSubMasksToMake,
  fitMasksToImage,
  maskImageSize,
  masksForApplying,
  toPortableMasks,
  withMasks,
} from '../utils/maskUtils';
import { Invokes, Panel, SelectedImage } from '../components/ui/AppProperties';
import { globalImageCache } from '../utils/ImageLRUCache';

export { debouncedSetHistory };

export const debouncedSave = debounce((path: string, adjustmentsToSave: Adjustments) => {
  invoke(Invokes.SaveMetadataAndUpdateThumbnail, { path, adjustments: adjustmentsToSave }).catch((err) => {
    console.error('Auto-save failed:', err);
    toast.error(`Failed to save changes: ${err}`);
  });
}, 300);

/** Turns Develop Auto Sync on or off; it syncs edits to every selected image. */
export const toggleAutoSync = () => {
  const { appSettings, handleSettingsChange } = useSettingsStore.getState();
  if (!appSettings?.copyPasteSettings) return;
  const { copyPasteSettings } = appSettings;
  void handleSettingsChange({
    ...appSettings,
    copyPasteSettings: { ...copyPasteSettings, autoSync: !copyPasteSettings.autoSync },
  });
};

/** The mask size (`maskImageSize`) of the photo open in Develop with `adjustments` (its orientation); null without one. */
export const openPhotoMaskSize = (adjustments: Partial<Adjustments> = useEditorStore.getState().adjustments) =>
  maskImageSize(useEditorStore.getState().selectedImage, adjustments.orientationSteps);

/** Has the editor make the AI parts of `masks`, applied to the open photo without bitmaps (Plan item 90). */
export const makeAiMasksFor = (masks: MaskContainer[] | undefined) => {
  const ids = aiSubMasksToMake(masks).map((subMask) => subMask.id);
  if (ids.length > 0) useEditorStore.getState().setEditor({ aiSubMasksToMake: ids });
};

/** A photo's adjustments with every edit removed: its defaults, with the crop's aspect ratio of the uncropped photo. */
const getResetAdjustments = (image: SelectedImage): Adjustments => ({
  ...getInitialAdjustments(image.isRaw),
  aspectRatio: image.width && image.height ? image.width / image.height : null,
});

/** Keeps the crop and leaves the Crop panel (Enter in Crop). */
export const applyCrop = () => {
  useEditorStore.getState().setEditor({ isStraightenActive: false, liveRotation: null });
  useUIStore.getState().setRightPanel(Panel.Adjustments);
};

/**
 * Leaves the Crop panel and restores its values from when it was opened (Escape in Crop), as one
 * undoable step. The panel closes first so no render sees the restored values while cropping.
 */
export const cancelCrop = () => {
  const { cropSessionSnapshot, selectedImage, adjustments, setEditor } = useEditorStore.getState();
  applyCrop();
  if (!cropSessionSnapshot || cropSessionSnapshot.path !== (selectedImage?.path ?? null)) return;
  const { geometry } = cropSessionSnapshot;
  const hasChanged = CROP_GEOMETRY_KEYS.some(
    (key) => JSON.stringify(adjustments[key]) !== JSON.stringify(geometry[key]),
  );
  if (!hasChanged) return;
  debouncedSetHistory.flush();
  setEditor((state) => {
    const restored = { ...state.adjustments, ...geometry };
    debouncedSetHistory(restored);
    return { adjustments: restored };
  });
  debouncedSetHistory.flush();
};

/**
 * Runs a backend batch edit (Auto Adjust, Auto Lens Correction, the updated lens correction) on
 * `paths`, then reloads the saved adjustments of the photo open in Develop and of the Library's
 * active photo if either was edited.
 */
export const applyBatchEditToPaths = async (
  command:
    | Invokes.ApplyAutoAdjustmentsToPaths
    | Invokes.ApplyAutoLensCorrectionToPaths
    | Invokes.UpgradeLensCorrectionForPaths,
  paths: string[],
) => {
  if (paths.length === 0) return;
  paths.forEach((p) => globalImageCache.delete(p));
  await invoke(command, { paths });

  const { selectedImage, setEditor, resetHistory } = useEditorStore.getState();
  const { libraryActivePath, setLibrary } = useLibraryStore.getState();
  const loadAdjustments = async (path: string) => {
    const metadata = await invoke<{ adjustments?: Adjustments & { is_null?: boolean } }>(Invokes.LoadMetadata, {
      path,
    });
    return metadata.adjustments && !metadata.adjustments.is_null
      ? (normalizeLoadedAdjustments(metadata.adjustments) as Adjustments)
      : null;
  };

  if (selectedImage && paths.includes(selectedImage.path)) {
    const adjustments = await loadAdjustments(selectedImage.path);
    if (adjustments) {
      setEditor({ adjustments });
      resetHistory(adjustments);
    }
  }
  if (libraryActivePath && paths.includes(libraryActivePath)) {
    const adjustments = await loadAdjustments(libraryActivePath);
    if (adjustments) setLibrary({ libraryActiveAdjustments: adjustments });
  }
};

export function useEditorActions() {
  const { t } = useTranslation();
  const setEditor = useEditorStore((s) => s.setEditor);

  const setAdjustments = useCallback(
    (value: Partial<Adjustments> | ((prev: Adjustments) => Adjustments), label?: string) => {
      // A labelled action gets its own history step instead of merging with pending slider edits.
      if (label) debouncedSetHistory.flush();
      setEditor((state) => {
        const prev = state.adjustments;
        const newAdjustments = typeof value === 'function' ? value(prev) : { ...prev, ...value };
        debouncedSetHistory(newAdjustments, label);
        return { adjustments: newAdjustments };
      });
      if (label) debouncedSetHistory.flush();
    },
    [setEditor],
  );

  const handleRotate = useCallback(
    (degrees: number) => {
      const { selectedImage, adjustments } = useEditorStore.getState();
      const increment = degrees > 0 ? 1 : 3;
      const newAspectRatio =
        adjustments.aspectRatio && adjustments.aspectRatio !== 0 ? 1 / adjustments.aspectRatio : null;
      const newOrientationSteps = ((adjustments.orientationSteps || 0) + increment) % 4;
      const newCrop =
        selectedImage?.width && selectedImage?.height
          ? calculateCenteredCrop(selectedImage.width, selectedImage.height, newOrientationSteps, newAspectRatio)
          : null;

      setAdjustments((prev) => ({
        ...prev,
        aspectRatio: newAspectRatio,
        orientationSteps: newOrientationSteps,
        rotation: 0,
        crop: newCrop,
      }));
    },
    [setAdjustments],
  );

  const handleAutoAdjustments = useCallback(async () => {
    const selectedImage = useEditorStore.getState().selectedImage;
    if (!selectedImage?.isReady) return;
    try {
      const autoAdjustments: Adjustments = await invoke(Invokes.CalculateAutoAdjustments);
      setAdjustments(
        (prev: Adjustments) => ({
          ...prev,
          ...autoAdjustments,
          sectionVisibility: { ...prev.sectionVisibility, ...autoAdjustments.sectionVisibility },
        }),
        t('contextMenus.editor.autoAdjust'),
      );
    } catch (err) {
      toast.error(`Failed to apply auto adjustments: ${err}`);
    }
  }, [setAdjustments, t]);

  const handleLutSelect = useCallback(
    async (path: string) => {
      const isAndroid = useSettingsStore.getState().osPlatform === 'android';
      try {
        // `data` is the LUT's table for the edit to embed, so the look travels with the photo
        // (`lut_processing::lut_for_adjustments`); null for a LUT too large to embed.
        const result: { size: number; data: string | null } = await invoke('load_and_parse_lut', { path });
        let name =
          isAndroid && path.startsWith('content://')
            ? await invoke<string>('resolve_android_content_uri_name', { uriStr: path })
            : path.split(/[\\/]/).pop() || 'LUT';
        setAdjustments((prev: Adjustments) => ({
          ...prev,
          lutPath: path,
          lutName: name,
          lutSize: result.size,
          lutData: result.data,
          lutIntensity: 100,
          sectionVisibility: { ...(prev.sectionVisibility || INITIAL_ADJUSTMENTS.sectionVisibility), lut: true },
        }));
      } catch (err) {
        toast.error(`Failed to load LUT: ${err}`);
      }
    },
    [setAdjustments],
  );

  const setLutPreviewOverride = useCallback(
    (path: string | null) => {
      setEditor((state) => {
        if (!path) return { previewOverride: null };
        const name = path.split(/[\\/]/).pop() || 'LUT';
        return {
          // Without the chosen LUT's embedded table, so the hovered file is what renders.
          previewOverride: {
            ...state.adjustments,
            lutPath: path,
            lutName: name,
            lutData: null,
            lutIntensity: state.adjustments.lutIntensity,
          },
        };
      });
    },
    [setEditor],
  );

  const handleResetAdjustments = useCallback(
    (paths?: string[]) => {
      const { multiSelectedPaths, libraryActivePath, imageList, setLibrary } = useLibraryStore.getState();
      const { selectedImage, resetHistory } = useEditorStore.getState();
      const pathsToReset = paths || multiSelectedPaths;
      if (pathsToReset.length === 0) return;

      pathsToReset.forEach((p) => globalImageCache.delete(p));
      debouncedSetHistory.cancel();

      invoke(Invokes.ResetAdjustmentsForPaths, { paths: pathsToReset })
        .then(() => {
          if (libraryActivePath && pathsToReset.includes(libraryActivePath)) {
            const isRaw = imageList.find((image) => image.path === libraryActivePath)?.is_raw ?? false;
            setLibrary({ libraryActiveAdjustments: getInitialAdjustments(isRaw) });
          }
          if (selectedImage && pathsToReset.includes(selectedImage.path)) {
            const resetData = getResetAdjustments(selectedImage);
            resetHistory(resetData);
            setEditor({ adjustments: resetData });
          }
        })
        .catch((err) => toast.error(`Failed to reset adjustments: ${err}`));
    },
    [setEditor],
  );

  /**
   * Develop's Reset (Plan item 81): removes every edit of the open photo (sliders, crop, masks, lens
   * and geometry, Blend Pad, Zone Editor, AI edits) as one undoable History step, as in Lightroom.
   */
  const handleResetEdit = useCallback(() => {
    const { selectedImage, zoneTintSelection } = useEditorStore.getState();
    if (!selectedImage) return;
    // The removed masks, AI edits, lights and zone grades can no longer be selected.
    setEditor({
      activeMaskId: null,
      activeMaskContainerId: null,
      activeAiPatchContainerId: null,
      activeAiSubMaskId: null,
      activeRelightLightId: null,
      zoneTintSelection: { ...zoneTintSelection, gradeId: null },
    });
    setAdjustments(() => getResetAdjustments(selectedImage), t('contextMenus.editor.resetAdjustments'));
  }, [setAdjustments, setEditor, t]);

  const handleCopyAdjustments = useCallback(async (pathOrEvent?: string | any) => {
    const pathOverride = typeof pathOrEvent === 'string' ? pathOrEvent : undefined;
    const { selectedImage, adjustments } = useEditorStore.getState();
    const { libraryActivePath, multiSelectedPaths } = useLibraryStore.getState();
    let sourceAdjustments: any = null;

    const pathToCopyFrom =
      pathOverride || (selectedImage ? selectedImage.path : libraryActivePath || multiSelectedPaths[0]);

    if (selectedImage && pathToCopyFrom === selectedImage.path) {
      sourceAdjustments = adjustments;
    } else if (pathToCopyFrom) {
      try {
        const meta: any = await invoke(Invokes.LoadMetadata, { path: pathToCopyFrom });
        if (meta?.adjustments && !meta.adjustments.is_null) {
          sourceAdjustments = normalizeLoadedAdjustments(meta.adjustments);
        } else {
          sourceAdjustments = INITIAL_ADJUSTMENTS;
        }
      } catch (err) {
        toast.error(`Failed to load metadata for copying: ${err}`);
        return;
      }
    }

    if (!sourceAdjustments) return;

    const adjustmentsToCopy: any = {};

    for (const key of COPYABLE_ADJUSTMENT_KEYS) {
      if (Object.prototype.hasOwnProperty.call(sourceAdjustments, key)) {
        adjustmentsToCopy[key] = structuredClone(sourceAdjustments[key]);
      }
    }
    // Shapes copied from the open photo record its size; copied from the Library they keep the size they record.
    const sourceSize = selectedImage && pathToCopyFrom === selectedImage.path ? openPhotoMaskSize() : null;
    useEditorStore.getState().setEditor({
      copiedAdjustments: withMasks(adjustmentsToCopy, (masks) => toPortableMasks(masks, sourceSize)),
    });
    useProcessStore.getState().setProcess({ isCopied: true });
  }, []);

  const handlePasteAdjustments = useCallback(
    (paths?: string[]) => {
      const { copiedAdjustments, selectedImage, adjustments } = useEditorStore.getState();
      const { multiSelectedPaths } = useLibraryStore.getState();
      const { appSettings } = useSettingsStore.getState();
      const { setProcess } = useProcessStore.getState();

      if (!copiedAdjustments || !appSettings) return;

      const { mode, includedAdjustments } = appSettings.copyPasteSettings;
      const adjustmentsToApply: Partial<Adjustments> = {};

      for (const key of includedAdjustments) {
        if (Object.prototype.hasOwnProperty.call(copiedAdjustments, key)) {
          const value = copiedAdjustments[key as keyof Adjustments];
          if (mode === PasteMode.Merge) {
            const defaultValue = INITIAL_ADJUSTMENTS[key as keyof Adjustments];
            if (JSON.stringify(value) !== JSON.stringify(defaultValue))
              adjustmentsToApply[key as keyof Adjustments] = value;
          } else {
            adjustmentsToApply[key as keyof Adjustments] = value;
          }
        }
      }

      if (includedAdjustments.includes(LensAdjustment.LensMaker)) {
        if (!adjustmentsToApply.lensMaker) {
          adjustmentsToApply.lensDistortionParams = null;
        }
      }
      // A pasted lens choice keeps the lens correction it was made with; Merge would skip
      // version 2, the default.
      const lensChoiceKeys: (keyof Adjustments)[] = [
        LensAdjustment.LensCorrectionMode,
        LensAdjustment.LensMaker,
        LensAdjustment.LensModel,
      ];
      if (lensChoiceKeys.some((key) => key in adjustmentsToApply)) {
        adjustmentsToApply.lensCorrectionVersion = copiedAdjustments.lensCorrectionVersion ?? 1;
      }

      if (Object.keys(adjustmentsToApply).length === 0) {
        setProcess({ isPasted: true });
        return;
      }

      const pathsToUpdate =
        paths || (multiSelectedPaths.length > 0 ? multiSelectedPaths : selectedImage ? [selectedImage.path] : []);
      if (pathsToUpdate.length === 0) return;

      pathsToUpdate.forEach((p) => globalImageCache.delete(p));

      // Pasted masks get new ids and are fitted to each photo, their shapes to its size and their
      // AI parts made for it (Plan items 90 and 91): here for the open photo, by the backend for
      // the others.
      const pastedAdjustments = withMasks(adjustmentsToApply, masksForApplying);
      const editorPath = selectedImage && pathsToUpdate.includes(selectedImage.path) ? selectedImage.path : null;
      const editorSize = openPhotoMaskSize({ ...adjustments, ...pastedAdjustments });
      const editorPasted = withMasks(pastedAdjustments, (masks) => fitMasksToImage(masks, editorSize));
      const pasted: Adjustments = { ...adjustments, ...editorPasted };
      if (editorPath) {
        setAdjustments(() => pasted, t('contextMenus.editor.pasteAdjustments'));
        makeAiMasksFor(pasted.masks);
      }

      const otherPaths = pathsToUpdate.filter((path) => path !== editorPath);
      const writes: Promise<unknown>[] = [];
      if (otherPaths.length > 0) {
        writes.push(invoke(Invokes.ApplyAdjustmentsToPaths, { paths: otherPaths, adjustments: pastedAdjustments }));
      }
      if (editorPath) {
        writes.push(
          invoke(Invokes.ApplyAdjustmentsToPaths, { paths: [editorPath], adjustments: editorPasted, editorPath }).then(
            () =>
              invoke('load_metadata', { path: editorPath }).then((meta: any) => {
                if (meta.adjustments) {
                  const lens: Partial<Adjustments> = {
                    lensMaker: meta.adjustments.lensMaker,
                    lensModel: meta.adjustments.lensModel,
                    lensDistortionParams: meta.adjustments.lensDistortionParams,
                  };
                  const { adjustments: current, history, historyIndex } = useEditorStore.getState();
                  const lensChanged = (Object.keys(lens) as (keyof Adjustments)[]).some(
                    (key) => JSON.stringify(current[key]) !== JSON.stringify(lens[key]),
                  );
                  if (!lensChanged) return;
                  // The backend resolves the lens profile for this image; while the paste is still the
                  // current step, it belongs to that step instead of becoming a step of its own.
                  if (current === pasted && history[historyIndex] === pasted) {
                    const amended = { ...pasted, ...lens };
                    setEditor((state) => ({
                      adjustments: amended,
                      history: state.history.map((step, i) => (i === state.historyIndex ? amended : step)),
                    }));
                  } else {
                    setAdjustments(lens);
                  }
                }
              }),
          ),
        );
      }
      Promise.all(writes).catch((err) => toast.error(`Failed to paste adjustments: ${err}`));

      setProcess({ isPasted: true });
    },
    [setAdjustments, setEditor, t],
  );

  /** Writes `changes` into the saved edits of `paths`; the photo open in Develop gets them as one undo step. */
  const applyAdjustmentsToPaths = useCallback(
    (paths: string[], changes: Partial<Adjustments>, label: string) => {
      if (paths.length === 0) return;
      const { selectedImage } = useEditorStore.getState();
      paths.forEach((p) => globalImageCache.delete(p));
      if (selectedImage && paths.includes(selectedImage.path)) {
        setAdjustments((prev: Adjustments) => ({ ...prev, ...changes }), label);
      }
      invoke(Invokes.ApplyAdjustmentsToPaths, { paths, adjustments: changes }).catch((err) =>
        toast.error(`Failed to apply adjustments: ${err}`),
      );
    },
    [setAdjustments],
  );

  const handleZoomChange = useCallback((zoomValue: number, fitToWindow: boolean = false) => {
    const editorState = useEditorStore.getState();
    const { baseRenderSize, adjustments } = editorState;
    const zoomSize = getZoomPixelSize(editorState);
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    let targetZoomPercent: number;

    const orientationSteps = adjustments.orientationSteps || 0;
    const isSwapped = orientationSteps === 1 || orientationSteps === 3;
    const effectiveOriginalWidth = isSwapped ? zoomSize.height : zoomSize.width;
    const effectiveOriginalHeight = isSwapped ? zoomSize.width : zoomSize.height;

    if (fitToWindow) {
      if (
        effectiveOriginalWidth > 0 &&
        effectiveOriginalHeight > 0 &&
        baseRenderSize.width > 0 &&
        baseRenderSize.height > 0
      ) {
        const originalAspect = effectiveOriginalWidth / effectiveOriginalHeight;
        const baseAspect = baseRenderSize.width / baseRenderSize.height;
        targetZoomPercent =
          originalAspect > baseAspect
            ? baseRenderSize.width / effectiveOriginalWidth
            : baseRenderSize.height / effectiveOriginalHeight;
      } else {
        targetZoomPercent = 1.0;
      }
    } else {
      targetZoomPercent = zoomValue / dpr;
    }

    targetZoomPercent = Math.max(0.1 / dpr, Math.min(2.0, targetZoomPercent));

    let transformZoom = 1.0;
    if (
      effectiveOriginalWidth > 0 &&
      effectiveOriginalHeight > 0 &&
      baseRenderSize.width > 0 &&
      baseRenderSize.height > 0
    ) {
      const originalAspect = effectiveOriginalWidth / effectiveOriginalHeight;
      const baseAspect = baseRenderSize.width / baseRenderSize.height;
      if (originalAspect > baseAspect) {
        transformZoom = (targetZoomPercent * effectiveOriginalWidth) / baseRenderSize.width;
      } else {
        transformZoom = (targetZoomPercent * effectiveOriginalHeight) / baseRenderSize.height;
      }
    }
    useEditorStore.getState().setEditor({ zoom: transformZoom });
  }, []);

  return {
    setAdjustments,
    handleRotate,
    handleAutoAdjustments,
    handleLutSelect,
    setLutPreviewOverride,
    handleResetAdjustments,
    handleResetEdit,
    handleCopyAdjustments,
    handlePasteAdjustments,
    applyAdjustmentsToPaths,
    handleZoomChange,
  };
}
