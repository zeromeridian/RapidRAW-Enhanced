import { useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { ParseKeys, TFunction } from 'i18next';
import { Maximize2, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import { Album, AlbumItem, Invokes } from '../components/ui/AppProperties';
import { useEditorStore } from '../store/useEditorStore';
import { useLibraryStore } from '../store/useLibraryStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useUIStore } from '../store/useUIStore';
import { autoStackCreatedImages } from '../utils/autoStacking';
import { unstackImagePaths } from '../utils/imageStacks';
import { getEnabledCopySuffix } from '../utils/outputNaming';
import { showProgressToast } from '../utils/progressToast';
import { applyBatchEditToPaths, debouncedSave, useEditorActions } from './useEditorActions';
import { openCaptureTimeStackModal, saveImageStacks } from './useLibraryActions';

/**
 * The photo commands shared by the right-click menus and the menu bar (Plan item 69): each tells whether it
 * applies to `paths` and runs on them, so both offer the same commands with the same limits.
 */
export type PhotoCommand =
  | 'aiDenoiseOff'
  | 'aiDenoiseOn'
  | 'applyPreset'
  | 'autoAdjust'
  | 'autoLensCorrection'
  | 'autoStack'
  | 'collage'
  | 'convertNegative'
  | 'createVirtualCopy'
  | 'cullSimilar'
  | 'denoise'
  | 'duplicateFile'
  | 'hdr'
  | 'importLightroomEdits'
  | 'panorama'
  | 'removeFromAlbum'
  | 'superResolutionOff'
  | 'superResolutionOn'
  | 'unstack'
  | 'upgradeLensCorrection';

export interface PathCommand {
  canRun(paths: string[]): boolean;
  run(paths: string[]): void;
}

/** The AI tools a menu switches on or off for whole photos: AI Denoise and Super Resolution. */
export const aiBaseTools = (t: TFunction) =>
  [
    {
      key: 'aiDenoiseEnabled',
      icon: Sparkles,
      label: t('adjustments.details.aiDenoise'),
      removeLabel: t('contextMenus.editor.removeAiDenoise'),
      enable: 'aiDenoiseOn',
      remove: 'aiDenoiseOff',
    },
    {
      key: 'aiUpscaleEnabled',
      icon: Maximize2,
      label: t('contextMenus.editor.superResolution'),
      removeLabel: t('contextMenus.editor.removeSuperResolution'),
      enable: 'superResolutionOn',
      remove: 'superResolutionOff',
    },
  ] as const satisfies readonly ({ enable: PhotoCommand; remove: PhotoCommand } & Record<string, unknown>)[];

type AiToolCommand = ReturnType<typeof aiBaseTools>[number]['enable' | 'remove'];

/** Merge and frame tools take between this many photos (inclusive). */
const PANORAMA_PHOTOS = { min: 2, max: 30 };
const HDR_PHOTOS = { min: 2, max: 9 };
const COLLAGE_PHOTOS = { min: 1, max: 9 };

const hasCount = (paths: string[], { min, max }: { min: number; max: number }) =>
  paths.length >= min && paths.length <= max;
const hasPhotos = (paths: string[]) => paths.length > 0;
const isSinglePhoto = (paths: string[]) => paths.length === 1;

/** Whether `paths` is only the photo open in Develop: its own tools then act on the live edit. */
const isEditedPhotoOnly = (paths: string[]) =>
  isSinglePhoto(paths) && useEditorStore.getState().selectedImage?.path === paths[0];

/** Edit commands wait until the photo open in Develop has loaded. */
const canEdit = (paths: string[]) =>
  hasPhotos(paths) && (!isEditedPhotoOnly(paths) || !!useEditorStore.getState().selectedImage?.isReady);

const refreshAlbumTree = async () =>
  useLibraryStore.getState().setLibrary({ albumTree: await invoke<AlbumItem[]>(Invokes.GetAlbums) });

const findAlbum = (nodes: AlbumItem[], albumId: string): Album | null => {
  for (const node of nodes) {
    if (node.id === albumId && node.type === 'album') return node as Album;
    if (node.type === 'group') {
      const found = findAlbum(node.children, albumId);
      if (found) return found;
    }
  }
  return null;
};

export function usePhotoCommands({ refreshImageList }: { refreshImageList(): Promise<void> }) {
  const { t } = useTranslation();
  const { handleAutoAdjustments, applyAdjustmentsToPaths } = useEditorActions();

  return useMemo(() => {
    const setUI = useUIStore.getState().setUI;

    const runBatchEdit = (
      command: Parameters<typeof applyBatchEditToPaths>[0],
      paths: string[],
      failedKey: ParseKeys,
      logMessage: string,
    ) =>
      applyBatchEditToPaths(command, paths).catch((err) => {
        console.error(logMessage, err);
        toast.error(t(failedKey, { err }));
      });

    // A new copy beside the photo, added to the open album and stacked with its source when that is on.
    const createCopy = async (command: Invokes, pathArg: 'path' | 'sourceVirtualPath', sourcePath: string) => {
      const { activeAlbumId } = useLibraryStore.getState();
      const outputPath = await invoke<string>(command, {
        [pathArg]: sourcePath,
        targetAlbumId: activeAlbumId || null,
        copyNameSuffix: getEnabledCopySuffix(useSettingsStore.getState().appSettings),
      });
      autoStackCreatedImages([{ sourcePath, outputPath }]);
      if (activeAlbumId) await refreshAlbumTree();
      await refreshImageList();
    };

    const removeFromAlbum = async (paths: string[]) => {
      const { activeAlbumId, albumTree, setLibrary } = useLibraryStore.getState();
      if (!activeAlbumId) return;
      const newTree = structuredClone(albumTree);
      const album = findAlbum(newTree, activeAlbumId);
      if (!album) return;
      album.images = album.images.filter((path) => !paths.includes(path));
      try {
        await invoke(Invokes.SaveAlbums, { tree: newTree });
        const sortedTree = await invoke<AlbumItem[]>(Invokes.GetAlbums);
        setLibrary({ albumTree: sortedTree });
        const savedAlbum = findAlbum(sortedTree, activeAlbumId);
        if (savedAlbum) {
          setLibrary((state) => ({
            imageList: state.imageList.filter((image) => savedAlbum.images.includes(image.path)),
          }));
        }
      } catch (err) {
        toast.error(t('contextMenus.toasts.failedRemoveImages', { err }));
      }
    };

    const setAiTool = (key: string, enabled: boolean, label: string): PathCommand => ({
      canRun: canEdit,
      run: (paths) => applyAdjustmentsToPaths(paths, { [key]: enabled }, label),
    });
    const aiToolCommands = Object.fromEntries(
      aiBaseTools(t).flatMap(({ key, label, removeLabel, enable, remove }) => [
        [enable, setAiTool(key, true, label)],
        [remove, setAiTool(key, false, removeLabel)],
      ]),
    ) as Record<AiToolCommand, PathCommand>;

    const commands: Record<PhotoCommand, PathCommand> = {
      ...aiToolCommands,
      applyPreset: {
        canRun: hasPhotos,
        run: (imagePaths) =>
          setUI({
            presetBatchModalState: { isOpen: true, target: { imagePaths, folderPaths: [], includeSubfolders: false } },
          }),
      },
      autoAdjust: {
        canRun: canEdit,
        run: (paths) => {
          if (isEditedPhotoOnly(paths)) handleAutoAdjustments();
          else
            void runBatchEdit(
              Invokes.ApplyAutoAdjustmentsToPaths,
              paths,
              'contextMenus.toasts.failedApplyAuto',
              'Failed to apply auto adjustments to paths:',
            );
        },
      },
      autoLensCorrection: {
        canRun: canEdit,
        run: (paths) =>
          void runBatchEdit(
            Invokes.ApplyAutoLensCorrectionToPaths,
            paths,
            'contextMenus.toasts.failedApplyAutoLensCorrection',
            'Failed to apply auto lens correction to paths:',
          ),
      },
      autoStack: { canRun: () => true, run: (paths) => openCaptureTimeStackModal(paths) },
      collage: {
        canRun: (paths) => hasCount(paths, COLLAGE_PHOTOS),
        run: (paths) =>
          setUI({
            collageModalState: {
              isOpen: true,
              sourceImages: useLibraryStore.getState().imageList.filter((image) => paths.includes(image.path)),
            },
          }),
      },
      convertNegative: {
        canRun: hasPhotos,
        run: (targetPaths) => setUI({ negativeModalState: { isOpen: true, targetPaths } }),
      },
      createVirtualCopy: {
        canRun: isSinglePhoto,
        run: ([sourcePath]) =>
          void createCopy(Invokes.CreateVirtualCopy, 'sourceVirtualPath', sourcePath).catch((err) =>
            toast.error(t('contextMenus.toasts.failedCreateVirtualCopy', { err })),
          ),
      },
      cullSimilar: {
        canRun: (paths) => paths.length >= 2,
        run: (pathsToCull) =>
          setUI({ cullingModalState: { isOpen: true, progress: null, suggestions: null, error: null, pathsToCull } }),
      },
      denoise: {
        canRun: hasPhotos,
        run: (targetPaths) =>
          setUI({
            denoiseModalState: {
              isOpen: true,
              isProcessing: false,
              previewBase64: null,
              error: null,
              targetPaths,
              progressMessage: null,
              isRaw: useEditorStore.getState().selectedImage?.isRaw || false,
            },
          }),
      },
      duplicateFile: {
        canRun: isSinglePhoto,
        run: ([sourcePath]) =>
          void createCopy(Invokes.DuplicateFile, 'path', sourcePath).catch((err) => {
            console.error('Failed to duplicate file:', err);
            toast.error(t('contextMenus.toasts.failedDuplicate', { err }));
          }),
      },
      hdr: {
        canRun: (paths) => hasCount(paths, HDR_PHOTOS),
        run: (stitchingSourcePaths) =>
          setUI({
            hdrModalState: {
              error: null,
              finalImageBase64: null,
              isOpen: true,
              isProcessing: false,
              progressMessage: null,
              stitchingSourcePaths,
            },
          }),
      },
      importLightroomEdits: {
        canRun: hasPhotos,
        run: (targetPaths) => {
          debouncedSave.flush();
          setUI({ lightroomImportModalState: { isOpen: true, targetPaths } });
        },
      },
      panorama: {
        canRun: (paths) => hasCount(paths, PANORAMA_PHOTOS),
        run: (stitchingSourcePaths) =>
          setUI({
            panoramaModalState: {
              error: null,
              finalImageBase64: null,
              isOpen: true,
              isProcessing: false,
              progressMessage: null,
              stitchingSourcePaths,
            },
          }),
      },
      removeFromAlbum: {
        canRun: (paths) => hasPhotos(paths) && !!useLibraryStore.getState().activeAlbumId,
        run: (paths) => void removeFromAlbum(paths),
      },
      unstack: {
        canRun: (paths) =>
          (useSettingsStore.getState().appSettings?.imageStacks || []).some((stack) =>
            stack.paths.some((stackPath) => paths.includes(stackPath)),
          ),
        run: (paths) => saveImageStacks((stacks) => unstackImagePaths(stacks, paths)),
      },
      upgradeLensCorrection: {
        canRun: hasPhotos,
        run: (paths) =>
          void runBatchEdit(
            Invokes.UpgradeLensCorrectionForPaths,
            paths,
            'contextMenus.toasts.failedUpgradeLensCorrection',
            'Failed to update the lens correction of paths:',
          ),
      },
    };

    /**
     * Reads the XMP files of a folder into the library (the folder menu's Read XMP from Folder), with a
     * progress bar. A photo whose edit is newer than its XMP's keeps it (`apply_xmp_adjustments`, Plan item 92).
     */
    const readXmpFromFolder = async (folderPath: string) => {
      const progress = showProgressToast(t('contextMenus.folders.readXmpReading'));
      const unlisten = await listen<{ current: number; total: number }>('xmp-read-progress', ({ payload }) => {
        const { current, total } = payload;
        progress.update(t('contextMenus.folders.readXmpProgress', { current, total }), current, total);
      });
      try {
        const { read, keptEdits } = await invoke<{ read: number; keptEdits: number }>(Invokes.ReadXmpFromFolder, {
          path: folderPath,
        });
        if (folderPath === useLibraryStore.getState().currentFolderPath) await refreshImageList();
        const summary = t('contextMenus.folders.readXmpSuccess', { count: read });
        progress.done(
          keptEdits > 0 ? `${summary}. ${t('contextMenus.folders.readXmpKeptEdits', { count: keptEdits })}` : summary,
        );
      } catch (err) {
        progress.fail(t('contextMenus.folders.readXmpFailed', { err }));
      } finally {
        unlisten();
      }
    };

    return { commands, readXmpFromFolder };
  }, [applyAdjustmentsToPaths, handleAutoAdjustments, refreshImageList, t]);
}
