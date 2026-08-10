import { useCallback, useRef } from 'react';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { homeDir } from '@tauri-apps/api/path';
import { toast } from 'react-toastify';
import { useLibraryStore } from '../store/useLibraryStore';
import { useEditorStore } from '../store/useEditorStore';
import { useUIStore } from '../store/useUIStore';
import { useProcessStore } from '../store/useProcessStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { Invokes, LibraryViewMode, ImageFile } from '../components/ui/AppProperties';
import { INITIAL_ADJUSTMENTS, normalizeLoadedAdjustments } from '../utils/adjustments';
import { globalImageCache } from '../utils/ImageLRUCache';
import { debouncedSave, debouncedSetHistory } from './useEditorActions';
import { mergeXmpImageStacks } from '../utils/imageStacks';

interface CatalogFolderSnapshot {
  images: ImageFile[];
  thumbnails: Record<string, string>;
  updatedAt: number;
}

const mergeImportedXmpStacks = (images: ImageFile[]) => {
  const settingsState = useSettingsStore.getState();
  if (!settingsState.appSettings) return;
  const imageStacks = mergeXmpImageStacks(settingsState.appSettings.imageStacks || [], images);
  if (JSON.stringify(imageStacks) !== JSON.stringify(settingsState.appSettings.imageStacks || [])) {
    settingsState.setAppSettings({ ...settingsState.appSettings, imageStacks });
  }
};

export interface AppNavigationProps {
  refs: {
    transformWrapperRef: React.RefObject<any>;
    preloadedDataRef: React.RefObject<any>;
    cachedEditStateRef: React.RefObject<any>;
    selectedImagePathRef: React.RefObject<string | null>;
    isBackendReadyRef: React.RefObject<boolean>;
    latestRenderedJobIdRef: React.RefObject<number>;
    previewJobIdRef: React.RefObject<number>;
    currentResRef: React.RefObject<number>;
    prevAdjustmentsRef: React.RefObject<any>;
  };
}

export function useAppNavigation({ refs }: AppNavigationProps) {
  const folderLoadGenerationRef = useRef(0);
  const {
    transformWrapperRef,
    preloadedDataRef,
    cachedEditStateRef,
    selectedImagePathRef,
    isBackendReadyRef,
    latestRenderedJobIdRef,
    previewJobIdRef,
    currentResRef,
    prevAdjustmentsRef,
  } = refs;

  const handleGoHome = useCallback(() => {
    useLibraryStore.getState().setLibrary({
      rootPaths: [],
      currentFolderPath: null,
      pendingFolderPath: null,
      activeAlbumId: null,
      imageList: [],
      imageRatings: {},
      folderTrees: [],
      multiSelectedPaths: [],
      libraryActivePath: null,
      expandedFolders: new Set(),
    });
    useUIStore.getState().setUI({ isLibraryExportPanelVisible: false });
  }, []);

  const handleBackToLibrary = useCallback(() => {
    const { selectedImage, resetHistory, setEditor } = useEditorStore.getState();
    const { setLibrary } = useLibraryStore.getState();
    const { setUI } = useUIStore.getState();

    if (selectedImage?.path && cachedEditStateRef.current) {
      globalImageCache.set(selectedImage.path, cachedEditStateRef.current);
    }
    if (transformWrapperRef.current) {
      transformWrapperRef.current.resetTransform(0);
    }
    setEditor({ zoom: 1 });

    debouncedSave.flush();
    debouncedSetHistory.cancel();

    const lastActivePath = selectedImage?.path ?? null;

    setEditor({
      hasRenderedFirstFrame: false,
      selectedImage: null,
      finalPreviewUrl: null,
      uncroppedAdjustedPreviewUrl: null,
      histogram: null,
      waveform: null,
      activeMaskId: null,
      activeMaskContainerId: null,
      activeAiPatchContainerId: null,
      isWbPickerActive: false,
      activeAiSubMaskId: null,
      transformedOriginalUrl: null,
    });

    selectedImagePathRef.current = null;

    setLibrary({ libraryActivePath: lastActivePath });
    setUI({ slideDirection: 1 });

    setEditor({ adjustments: INITIAL_ADJUSTMENTS });
    resetHistory(INITIAL_ADJUSTMENTS);
    useEditorStore.getState().patchesSentToBackend.clear();

    isBackendReadyRef.current = true;
    setEditor((state) => {
      if (state.interactivePatch?.url) URL.revokeObjectURL(state.interactivePatch.url);
      return { interactivePatch: null };
    });
  }, [refs]);

  const handleImageSelect = useCallback(
    async (path: string) => {
      const { selectedImage, isSliderDragging, resetHistory, setEditor } = useEditorStore.getState();
      const { setLibrary, multiSelectedPaths } = useLibraryStore.getState();
      const { setUI } = useUIStore.getState();

      if (selectedImage?.path === path) return;

      useEditorStore.getState().patchesSentToBackend.clear();
      debouncedSave.flush();
      debouncedSetHistory.cancel();

      if (selectedImage?.path && cachedEditStateRef.current) {
        globalImageCache.set(selectedImage.path, cachedEditStateRef.current);
      }

      const cached = globalImageCache.get(path);
      const isFrontendCached = Boolean(cached && cached.selectedImage?.isReady);
      const isCachedInBackend = isFrontendCached
        ? await invoke<boolean>('is_image_cached', { path }).catch(() => false)
        : false;

      const hasDifferentResolution =
        cached &&
        (useEditorStore.getState().originalSize.width !== cached.originalSize.width ||
          useEditorStore.getState().originalSize.height !== cached.originalSize.height);

      if (!isCachedInBackend || hasDifferentResolution) {
        setEditor({ hasRenderedFirstFrame: false });
      }

      selectedImagePathRef.current = path;

      const newMultiSelectedPaths = multiSelectedPaths.includes(path) ? multiSelectedPaths : [path];

      setLibrary({
        multiSelectedPaths: newMultiSelectedPaths,
        libraryActivePath: null,
        selectionAnchorPath: path,
      });

      setEditor({
        showOriginal: false,
        activeMaskId: null,
        activeMaskContainerId: null,
        activeAiPatchContainerId: null,
        activeAiSubMaskId: null,
        isWbPickerActive: false,
        transformedOriginalUrl: null,
      });

      setUI({
        isLibraryExportPanelVisible: false,
        compactEditorPanelHeightOverride: null,
      });

      if (isFrontendCached) {
        setEditor({
          selectedImage: {
            ...cached.selectedImage,
            thumbnailUrl: useProcessStore.getState().thumbnails[path] || cached.selectedImage.thumbnailUrl,
          },
          originalSize: cached.originalSize,
          previewSize: cached.previewSize,
          histogram: cached.histogram,
          waveform: cached.waveform,
          finalPreviewUrl: cached.finalPreviewUrl,
          uncroppedAdjustedPreviewUrl: cached.uncroppedPreviewUrl,
        });

        setEditor({ adjustments: cached.adjustments });
        resetHistory(cached.adjustments);
        prevAdjustmentsRef.current = { path, adjustments: cached.adjustments };

        setLibrary({ isViewLoading: false });

        latestRenderedJobIdRef.current = previewJobIdRef.current;
        isBackendReadyRef.current = false;
        currentResRef.current = Infinity;

        invoke(Invokes.LoadImage, { path })
          .then((_result: any) => {
            if (selectedImagePathRef.current !== path) return;
            isBackendReadyRef.current = true;
            currentResRef.current = 0;
            setEditor({ originalSize: { width: _result.width, height: _result.height } });
          })
          .catch((err: any) => {
            if (String(err).includes('cancelled')) return;
            console.error('Background load_image failed on cache hit:', err);
            isBackendReadyRef.current = true;
            currentResRef.current = 0;
          });

        invoke(Invokes.LoadMetadata, { path })
          .then((metadata: any) => {
            if (selectedImagePathRef.current !== path) return;
            let freshAdjustments: any;
            if (metadata.adjustments && !metadata.adjustments.is_null) {
              freshAdjustments = normalizeLoadedAdjustments(metadata.adjustments);
            } else {
              freshAdjustments = { ...INITIAL_ADJUSTMENTS };
            }
            if (!isSliderDragging && JSON.stringify(cached.adjustments) !== JSON.stringify(freshAdjustments)) {
              setEditor({ adjustments: freshAdjustments });
              resetHistory(freshAdjustments);
              prevAdjustmentsRef.current = { path, adjustments: freshAdjustments };
              globalImageCache.set(path, { ...cached, adjustments: freshAdjustments });
            }
          })
          .catch((err) => console.error('Failed background metadata sync on cache hit:', err));

        return;
      }

      isBackendReadyRef.current = true;

      const imageFile = useLibraryStore.getState().imageList.find((img) => img.path === path);
      setEditor({
        selectedImage: {
          exif: null,
          group_id: imageFile?.group_id ?? null,
          height: 0,
          isRaw: false,
          isReady: false,
          metadata: null,
          originalUrl: null,
          path,
          thumbnailUrl: useProcessStore.getState().thumbnails[path],
          width: 0,
        },
        originalSize: { width: 0, height: 0 },
        previewSize: { width: 0, height: 0 },
        histogram: null,
        waveform: null,
        uncroppedAdjustedPreviewUrl: null,
      });

      setLibrary({ isViewLoading: true });

      setEditor((state) => {
        const prev = state.finalPreviewUrl;
        if (prev?.startsWith('blob:') && !globalImageCache.isProtected(prev)) {
          setTimeout(() => {
            if (!globalImageCache.isProtected(prev)) {
              URL.revokeObjectURL(prev);
            }
          }, 250);
        }
        return { finalPreviewUrl: null };
      });

      setEditor((state) => {
        if (state.interactivePatch?.url) URL.revokeObjectURL(state.interactivePatch.url);
        return { interactivePatch: null };
      });
    },
    [refs],
  );

  const handleSelectSubfolder = useCallback(
    async (
      path: string | null,
      isNewRoot = false,
      preloadedImages?: ImageFile[],
      expandParents = true,
      preserveEditor = false,
    ) => {
      const folderLoadGeneration = ++folderLoadGenerationRef.current;
      const { appSettings, handleSettingsChange } = useSettingsStore.getState();
      const { pinnedFolders } = appSettings || { pinnedFolders: [] };
      const { setLibrary, sortCriteria } = useLibraryStore.getState();
      const { setUI } = useUIStore.getState();
      const { selectedImage, resetHistory, setEditor } = useEditorStore.getState();
      const libraryViewMode = appSettings?.libraryViewMode;

      if (!preserveEditor) {
        setLibrary({ isViewLoading: true, pendingFolderPath: path });
        setUI({ activeView: 'library' });
      } else {
        setLibrary({ isViewLoading: true, pendingFolderPath: path });
      }

      try {
        const { rootPaths, expandedFolders: currentExpandedFolders } = useLibraryStore.getState();
        let newExpandedFolders = new Set(currentExpandedFolders);

        if (isNewRoot && path) {
          newExpandedFolders = new Set([path]);
          if (appSettings) {
            handleSettingsChange({ ...appSettings, lastRootPath: path } as any);
          }
        } else if (path && expandParents) {
          const allRoots = [...(rootPaths || []), ...(pinnedFolders || [])].filter(Boolean) as string[];
          const relevantRoot = allRoots.find((r) => path.startsWith(r));

          if (relevantRoot) {
            const separator = path.includes('/') ? '/' : '\\';
            const parentSeparatorIndex = path.lastIndexOf(separator);

            if (parentSeparatorIndex > -1 && path.length > relevantRoot.length) {
              let current = path.substring(0, parentSeparatorIndex);
              while (current && current.length >= relevantRoot.length) {
                newExpandedFolders.add(current);
                const nextParentIndex = current.lastIndexOf(separator);
                if (nextParentIndex === -1 || current === relevantRoot) break;
                current = current.substring(0, nextParentIndex);
              }
            }
            newExpandedFolders.add(relevantRoot);
          }
        }

        setLibrary({
          expandedFolders: newExpandedFolders,
        });

        let destinationCommitted = false;
        const commitImages = (imageList: ImageFile[], ratings: Record<string, number>) => {
          if (!preserveEditor && !destinationCommitted) {
            useLibraryStore.getState().setSearchCriteria({ tags: [], text: '', mode: 'OR' });
          }
          setLibrary({
            currentFolderPath: path,
            pendingFolderPath: null,
            imageList,
            imageRatings: ratings,
            activeAlbumId: null,
            isViewLoading: false,
            ...(destinationCommitted
              ? {}
              : {
                  libraryScrollTop: 0,
                  ...(preserveEditor ? {} : { multiSelectedPaths: [], libraryActivePath: null }),
                }),
          });
          destinationCommitted = true;
        };

        if (path && !preloadedImages) {
          const snapshot = await invoke<CatalogFolderSnapshot | null>(Invokes.LoadCatalogFolder, {
            path,
            recursive: libraryViewMode === LibraryViewMode.Recursive,
            xmpSync: appSettings?.enableXmpSync ?? false,
          }).catch((error) => {
            console.warn('Library catalog could not be read; using filesystem scan:', error);
            return null;
          });
          if (folderLoadGenerationRef.current !== folderLoadGeneration) return;
          if (snapshot) {
            mergeImportedXmpStacks(snapshot.images);
            const restoredThumbnails = Object.fromEntries(
              Object.entries(snapshot.thumbnails).map(([imagePath, thumbnailPath]) => [
                imagePath,
                convertFileSrc(thumbnailPath.replace(/\\/g, '/')),
              ]),
            );
            if (Object.keys(restoredThumbnails).length > 0) {
              useProcessStore.getState().setProcess((state) => ({
                thumbnails: { ...state.thumbnails, ...restoredThumbnails },
              }));
            }
            const cachedRatings: Record<string, number> = {};
            snapshot.images.forEach((image) => {
              if (image.rating !== undefined) cachedRatings[image.path] = image.rating;
            });
            commitImages(snapshot.images, cachedRatings);
          }
        }

        if (!preserveEditor && selectedImage) {
          debouncedSave.flush();
          debouncedSetHistory.cancel();
          setEditor({ selectedImage: null, finalPreviewUrl: null, uncroppedAdjustedPreviewUrl: null, histogram: null });
          setEditor({ adjustments: INITIAL_ADJUSTMENTS });
          resetHistory(INITIAL_ADJUSTMENTS);
          useEditorStore.getState().patchesSentToBackend.clear();
        }

        const command =
          libraryViewMode === LibraryViewMode.Recursive ? Invokes.ListImagesRecursive : Invokes.ListImagesInDir;

        let files: ImageFile[];
        if (preloadedImages) {
          files = preloadedImages;
        } else {
          files = await invoke(command, { path });
        }
        if (folderLoadGenerationRef.current !== folderLoadGeneration) return;
        mergeImportedXmpStacks(files);

        const initialRatings: Record<string, number> = {};
        files.forEach((f) => {
          if (f.rating !== undefined) {
            initialRatings[f.path] = f.rating;
          }
        });
        const exifSortKeys = ['date_taken', 'iso', 'shutter_speed', 'aperture', 'focal_length'];
        const isExifSortActive = exifSortKeys.includes(sortCriteria.key);

        if (files.length > 0) {
          const paths = files.map((f: ImageFile) => f.path);

          if (isExifSortActive) {
            commitImages(files, initialRatings);
            setLibrary({ isViewLoading: true, pendingFolderPath: path });
            const exifDataMap: Record<string, any> = await invoke(Invokes.ReadExifForPaths, { paths });
            if (
              folderLoadGenerationRef.current !== folderLoadGeneration ||
              useLibraryStore.getState().currentFolderPath !== path
            ) {
              return;
            }
            const finalImageList = files.map((image) => ({
              ...image,
              exif: exifDataMap[image.path] || image.exif || null,
            }));
            commitImages(finalImageList, initialRatings);
          } else {
            commitImages(files, initialRatings);
            window.setTimeout(async () => {
              const batchSize = 200;
              const stateUpdateBatchSize = 1_000;
              let pendingExifData: Record<string, Record<string, string>> = {};
              for (let offset = 0; offset < paths.length; offset += batchSize) {
                if (
                  folderLoadGenerationRef.current !== folderLoadGeneration ||
                  useLibraryStore.getState().currentFolderPath !== path
                ) {
                  return;
                }

                const batchPaths = paths.slice(offset, offset + batchSize);
                try {
                  await new Promise<void>((resolve) => {
                    if ('requestIdleCallback' in window) {
                      window.requestIdleCallback(() => resolve(), { timeout: 250 });
                    } else {
                      setTimeout(resolve, 32);
                    }
                  });
                  const exifDataMap: Record<string, Record<string, string>> = await invoke(Invokes.ReadExifForPaths, {
                    paths: batchPaths,
                  });
                  if (
                    folderLoadGenerationRef.current !== folderLoadGeneration ||
                    useLibraryStore.getState().currentFolderPath !== path
                  ) {
                    return;
                  }
                  Object.assign(pendingExifData, exifDataMap);

                  const isLastBatch = offset + batchSize >= paths.length;
                  if (Object.keys(pendingExifData).length >= stateUpdateBatchSize || isLastBatch) {
                    const exifUpdates = pendingExifData;
                    pendingExifData = {};
                    setLibrary((state) => ({
                      imageList: state.imageList.map((image) =>
                        exifUpdates[image.path] ? { ...image, exif: exifUpdates[image.path] } : image,
                      ),
                    }));
                  }
                } catch (err) {
                  console.error('Failed to read EXIF data in background:', err);
                  return;
                }
              }
            }, 1200);
          }
        } else {
          commitImages(files, initialRatings);
        }

        if (!preserveEditor) {
          invoke(Invokes.StartBackgroundIndexing, { folderPath: path }).catch((err) => {
            console.error('Failed to start background indexing:', err);
          });
        }
      } catch (err) {
        if (folderLoadGenerationRef.current !== folderLoadGeneration) return;
        console.error('Failed to load folder contents:', err);
        toast.error('Failed to load images from the selected folder.');
        setLibrary({ pendingFolderPath: null });
      } finally {
        if (folderLoadGenerationRef.current === folderLoadGeneration) {
          useLibraryStore.getState().setLibrary({ isViewLoading: false, pendingFolderPath: null });
        }
      }
    },
    [refs],
  );

  const handleSelectAlbum = useCallback(
    async (albumId: string, albumName: string, imagePaths: string[], preserveEditor = false) => {
      const folderLoadGeneration = ++folderLoadGenerationRef.current;
      const { setLibrary } = useLibraryStore.getState();
      const { setUI } = useUIStore.getState();

      if (!preserveEditor) {
        globalImageCache.clear();
        setUI({ activeView: 'library' });
      }

      setLibrary({
        isViewLoading: true,
        pendingFolderPath: `Album: ${albumName}`,
      });

      try {
        const files: ImageFile[] = await invoke(Invokes.GetAlbumImages, { paths: imagePaths });
        if (folderLoadGenerationRef.current !== folderLoadGeneration) return;
        mergeImportedXmpStacks(files);

        const initialRatings: Record<string, number> = {};
        files.forEach((f) => {
          if (f.rating !== undefined) initialRatings[f.path] = f.rating;
        });

        setLibrary({
          imageList: files,
          imageRatings: initialRatings,
          currentFolderPath: `Album: ${albumName}`,
          pendingFolderPath: null,
          activeAlbumId: albumId,
          libraryScrollTop: 0,
          ...(preserveEditor ? {} : { multiSelectedPaths: [], libraryActivePath: null }),
        });
        if (!preserveEditor) {
          useLibraryStore.getState().setSearchCriteria({ tags: [], text: '', mode: 'OR' });
        }
      } catch (err) {
        if (folderLoadGenerationRef.current !== folderLoadGeneration) return;
        console.error('Failed to load album images:', err);
        toast.error(`Failed to load album: ${err}`);
      } finally {
        if (folderLoadGenerationRef.current === folderLoadGeneration) {
          setLibrary({ isViewLoading: false, pendingFolderPath: null });
        }
      }
    },
    [],
  );

  const handleOpenFolder = async () => {
    const { osPlatform, appSettings, handleSettingsChange } = useSettingsStore.getState();
    const { rootPaths, setLibrary } = useLibraryStore.getState();
    const isAndroid = osPlatform === 'android';

    try {
      let selectedPath = '';
      if (isAndroid) {
        selectedPath = await invoke<string>(Invokes.GetOrCreateInternalLibraryRoot);
      } else {
        const selected = await open({ directory: true, multiple: false, defaultPath: await homeDir() });
        if (typeof selected === 'string') {
          selectedPath = selected;
        }
      }

      if (selectedPath) {
        let shouldRefineTree = false;
        if (!rootPaths.includes(selectedPath)) {
          const newRootPaths = [...rootPaths, selectedPath];
          setLibrary({ rootPaths: newRootPaths });

          if (appSettings) {
            handleSettingsChange({ ...appSettings, rootFolders: newRootPaths } as any);
          }

          setLibrary({ isTreeLoading: true });
          try {
            const newTree = await invoke(Invokes.GetFolderTree, {
              path: selectedPath,
              expandedFolders: [selectedPath],
              showImageCounts: false,
              hideEmptyFolders: false,
            });
            setLibrary((state) => ({ folderTrees: [...state.folderTrees, newTree] }));

            shouldRefineTree = Boolean(
              appSettings?.enableFolderImageCounts ||
              appSettings?.folderTreeSort?.key === 'imageCount' ||
              appSettings?.hideEmptyFolders,
            );
          } catch (e) {
            toast.error(`Failed to load folder tree: ${e}`);
          } finally {
            setLibrary({ isTreeLoading: false });
          }
        }
        await handleSelectSubfolder(selectedPath, true);
        if (shouldRefineTree && useLibraryStore.getState().rootPaths.includes(selectedPath)) {
          invoke(Invokes.GetFolderTree, {
            path: selectedPath,
            expandedFolders: [selectedPath],
            showImageCounts: appSettings?.enableFolderImageCounts || appSettings?.folderTreeSort?.key === 'imageCount',
            hideEmptyFolders: appSettings?.hideEmptyFolders ?? false,
          })
            .then((detailedTree) => {
              if (!useLibraryStore.getState().rootPaths.includes(selectedPath)) return;
              setLibrary((state) => ({
                folderTrees: state.folderTrees.map((tree) => (tree.path === selectedPath ? detailedTree : tree)),
              }));
            })
            .catch((error) => console.error('Failed to refine folder tree:', error));
        }
      }
    } catch (err) {
      console.error(isAndroid ? 'Failed to open Android library root:' : 'Failed to open directory dialog:', err);
      toast.error(isAndroid ? 'Failed to open library.' : 'Failed to open folder selection dialog.');
    }
  };

  const handleContinueSession = () => {
    const restore = async () => {
      const { appSettings } = useSettingsStore.getState();
      const { setLibrary } = useLibraryStore.getState();

      const rootFolders = appSettings?.rootFolders?.length
        ? appSettings.rootFolders
        : appSettings?.lastRootPath
          ? [appSettings.lastRootPath]
          : [];

      if (rootFolders.length === 0) return;

      const folderState = appSettings?.lastFolderState;
      const pathToSelect = folderState?.currentFolderPath || rootFolders[0];

      setLibrary({ rootPaths: rootFolders });

      if (folderState?.expandedFolders) {
        const newExpandedFolders = new Set<string>(folderState.expandedFolders);
        setLibrary({ expandedFolders: newExpandedFolders });
      } else {
        setLibrary({ expandedFolders: new Set(rootFolders) });
      }

      setLibrary({ isTreeLoading: true });
      void (async () => {
        try {
          let treesData;
          if (preloadedDataRef.current?.rootPaths?.join() === rootFolders.join() && preloadedDataRef.current.trees) {
            treesData = await preloadedDataRef.current.trees;
            preloadedDataRef.current.trees = undefined;
          } else {
            const expandedArr = folderState?.expandedFolders
              ? Array.from(new Set(folderState.expandedFolders))
              : rootFolders;
            treesData = await invoke(Invokes.GetPinnedFolderTrees, {
              paths: rootFolders,
              expandedFolders: expandedArr,
              showImageCounts:
                appSettings?.enableFolderImageCounts || appSettings?.folderTreeSort?.key === 'imageCount',
              hideEmptyFolders: appSettings?.hideEmptyFolders ?? false,
            });
          }
          setLibrary({ folderTrees: treesData });
        } catch (err) {
          console.error('Failed to restore folder trees:', err);
        } finally {
          setLibrary({ isTreeLoading: false });
        }
      })();

      if (pathToSelect && pathToSelect.startsWith('Album: ')) {
        const activeAlbumId = folderState?.activeAlbumId;
        if (activeAlbumId) {
          try {
            const albumTree: any = await invoke(Invokes.GetAlbums);
            setLibrary({ albumTree });

            const findObj = (nodes: any[]): any => {
              for (const n of nodes) {
                if (n.id === activeAlbumId) return n;
                if (n.type === 'group') {
                  const f = findObj(n.children);
                  if (f) return f;
                }
              }
              return null;
            };

            const album = findObj(albumTree);
            if (album) {
              await handleSelectAlbum(album.id, album.name, album.images);
            } else {
              await handleSelectSubfolder(rootFolders[0], false, undefined, false);
            }
          } catch (e) {
            console.error('Failed to restore album session:', e);
            await handleSelectSubfolder(rootFolders[0], false, undefined, false);
          }
        } else {
          await handleSelectSubfolder(rootFolders[0], false, undefined, false);
        }
      } else {
        await handleSelectSubfolder(pathToSelect, false, undefined, false);
      }
    };

    restore().catch((err) => {
      console.error('Failed to restore session:', err);
      toast.error('Failed to restore session. A folder may have been moved or deleted.');
      handleGoHome();
      useLibraryStore.getState().setLibrary({ isTreeLoading: false });
    });
  };

  return {
    handleGoHome,
    handleBackToLibrary,
    handleImageSelect,
    handleSelectSubfolder,
    handleSelectAlbum,
    handleOpenFolder,
    handleContinueSession,
  };
}
