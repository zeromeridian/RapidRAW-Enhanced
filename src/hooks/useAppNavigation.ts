import { useCallback, useRef } from 'react';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { homeDir } from '@tauri-apps/api/path';
import { toast } from 'react-toastify';
import { useLibraryStore } from '../store/useLibraryStore';
import { canvasToolState, useEditorStore } from '../store/useEditorStore';
import { useUIStore } from '../store/useUIStore';
import { useProcessStore } from '../store/useProcessStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { Invokes, LibraryViewMode, ImageFile } from '../components/ui/AppProperties';
import { INITIAL_ADJUSTMENTS, normalizeLoadedAdjustments } from '../utils/adjustments';
import { globalImageCache } from '../utils/ImageLRUCache';
import { debouncedSave, debouncedSetHistory } from './useEditorActions';
import { clearLibrarySelection } from './useLibraryActions';
import { computeSortedLibrary } from './useSortedLibrary';
import { mergeXmpImageStacks } from '../utils/imageStacks';
import { createProvisionalFolderTrees, mergeRefreshedFolderTrees } from '../utils/folderTreeCache';
import { USER_TAG_PREFIX, formatKeyword } from '../utils/keywords';
import { ALBUM_VIEW_PREFIX, KEYWORD_VIEW_PREFIX, isPathWithin } from '../utils/libraryViews';

interface CatalogFolderSnapshot {
  images: ImageFile[];
  thumbnails: Record<string, string>;
  updatedAt: number;
}

const FOLDER_LISTING_CACHE_MAX_ENTRIES = 12;
const FOLDER_LISTING_CACHE_MAX_IMAGES = 100_000;
// A clicked folder with nothing cached shows its loading state after this delay rather than
// leaving the previous folder's photos on screen; the catalog usually answers sooner.
const FOLDER_LOADING_VIEW_DELAY_MS = 150;

/** The last image list shown for each recently visited folder, newest last. */
type FolderListingCache = Map<string, ImageFile[]>;

/** The folder listing currently shown in the Library, if it is a folder (not an album or keyword view). */
interface CommittedListing {
  key: string;
  path: string;
  recursive: boolean;
}

const getFolderListingCacheKey = (path: string, libraryViewMode: LibraryViewMode | undefined, xmpSync: boolean) =>
  `${libraryViewMode ?? LibraryViewMode.Flat}|${xmpSync ? 'xmp' : 'sidecar'}|${path}`;

const storeFolderListing = (cache: FolderListingCache, key: string, images: ImageFile[]) => {
  cache.delete(key);
  cache.set(key, images);
  let cachedImageCount = Array.from(cache.values()).reduce((count, entry) => count + entry.length, 0);
  while (cache.size > FOLDER_LISTING_CACHE_MAX_ENTRIES || cachedImageCount > FOLDER_LISTING_CACHE_MAX_IMAGES) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey === undefined) return;
    cachedImageCount -= cache.get(oldestKey)?.length ?? 0;
    cache.delete(oldestKey);
  }
};

const takeFolderListing = (cache: FolderListingCache, key: string) => {
  const images = cache.get(key);
  if (!images) return null;
  storeFolderListing(cache, key, images);
  return images;
};

const ratingsOf = (images: ImageFile[]) => {
  const ratings: Record<string, number> = {};
  images.forEach((image) => {
    if (image.rating !== undefined) ratings[image.path] = image.rating;
  });
  return ratings;
};

/** The images with ratings changed since listing (kept in `imageRatings`) written back. */
const withRatings = (images: ImageFile[], ratings: Record<string, number>) =>
  images.map((image) => {
    const rating = ratings[image.path];
    return rating === undefined || rating === image.rating ? image : { ...image, rating };
  });

/**
 * Keeps what is already known about each image where a fresh listing has only placeholders:
 * EXIF (listings never read it) and, while the metadata workers are still resolving an image,
 * its rating, edit state, tags, and stack.
 */
const mergeKnownImageState = (files: ImageFile[], known: ImageFile[]) => {
  if (known.length === 0) return files;
  const knownByPath = new Map(known.map((image) => [image.path, image]));
  return files.map((file) => {
    const previous = knownByPath.get(file.path);
    if (!previous) return file;
    const exif = file.exif ?? previous.exif;
    if (!file.metadataPending) return exif === file.exif ? file : { ...file, exif };
    return {
      ...file,
      exif,
      rating: previous.rating,
      is_edited: previous.is_edited,
      tags: previous.tags,
      xmpStack: previous.xmpStack,
      metadataPending: previous.metadataPending,
    };
  });
};

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
  const folderListingCacheRef = useRef<FolderListingCache>(new Map());
  const committedListingRef = useRef<CommittedListing | null>(null);
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

  /** Remembers the folder being left, with everything learned while it was shown. */
  const rememberCommittedListing = useCallback(() => {
    const committed = committedListingRef.current;
    const { imageList, imageRatings } = useLibraryStore.getState();
    if (committed && imageList.length > 0) {
      storeFolderListing(folderListingCacheRef.current, committed.key, withRatings(imageList, imageRatings));
    }
  }, []);

  const handleGoHome = useCallback(() => {
    rememberCommittedListing();
    committedListingRef.current = null;
    useLibraryStore.getState().setLibrary({
      rootPaths: [],
      currentFolderPath: null,
      pendingFolderPath: null,
      activeAlbumId: null,
      activeKeyword: null,
      imageList: [],
      imageRatings: {},
      folderTrees: [],
      multiSelectedPaths: [],
      libraryActivePath: null,
      expandedFolders: new Set(),
    });
    useUIStore.getState().setUI({ isLibraryExportPanelVisible: false });
  }, [rememberCommittedListing]);

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
      ...canvasToolState(),
      activeRelightLightId: null,
      activeAiSubMaskId: null,
      transformedOriginalUrl: null,
    });

    selectedImagePathRef.current = null;

    const isStillVisible =
      lastActivePath !== null &&
      computeSortedLibrary(useLibraryStore.getState(), useSettingsStore.getState()).some(
        (img) => img.path === lastActivePath,
      );
    if (isStillVisible) {
      setLibrary({ libraryActivePath: lastActivePath });
    } else {
      clearLibrarySelection();
    }
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

      setEditor({ hasRenderedFirstFrame: false });

      useEditorStore.getState().patchesSentToBackend.clear();
      debouncedSave.flush();
      debouncedSetHistory.cancel();

      if (selectedImage?.path && cachedEditStateRef.current) {
        globalImageCache.set(selectedImage.path, cachedEditStateRef.current);
      }

      const cached = globalImageCache.get(path);
      const isFrontendCached = Boolean(cached && cached.selectedImage?.isReady);

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
        ...canvasToolState(),
        activeRelightLightId: null,
        transformedOriginalUrl: null,
      });

      setUI({
        isLibraryExportPanelVisible: false,
        compactEditorPanelHeightOverride: null,
      });

      if (isFrontendCached && cached) {
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
      skipHistory = false,
    ) => {
      if (!skipHistory && path) {
        useLibraryStore.getState().pushNavHistory({ type: 'folder', path });
      }
      const folderLoadGeneration = ++folderLoadGenerationRef.current;
      const isCurrentLoad = () => folderLoadGenerationRef.current === folderLoadGeneration;
      const { appSettings, handleSettingsChange } = useSettingsStore.getState();
      const { pinnedFolders } = appSettings || { pinnedFolders: [] };
      const { setLibrary, sortCriteria } = useLibraryStore.getState();
      const { setUI } = useUIStore.getState();
      const { selectedImage, resetHistory, setEditor } = useEditorStore.getState();
      const libraryViewMode = appSettings?.libraryViewMode;
      const isRecursive = libraryViewMode === LibraryViewMode.Recursive;
      const destination: CommittedListing | null = path
        ? {
            key: getFolderListingCacheKey(path, libraryViewMode, appSettings?.enableXmpSync ?? false),
            path,
            recursive: isRecursive,
          }
        : null;

      rememberCommittedListing();
      const previousListing = committedListingRef.current;
      const isRefresh = Boolean(destination && previousListing?.key === destination.key);

      setLibrary({ isViewLoading: true, pendingFolderPath: path });
      if (!preserveEditor) {
        setUI({ activeView: 'library' });
      }

      let loadingViewTimer: number | undefined;
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
          const relevantRoot = allRoots
            .filter((root) => isPathWithin(path, root))
            .reduce<string | undefined>((best, r) => (!best || r.length > best.length ? r : best), undefined);

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

        // A refresh keeps the shown list, scroll, and selection until the new listing arrives.
        let destinationCommitted = isRefresh;
        const commitImages = (
          imageList: ImageFile[],
          ratings: Record<string, number>,
          { stillLoading = false }: { stillLoading?: boolean } = {},
        ) => {
          if (!preserveEditor && !destinationCommitted) {
            useLibraryStore.getState().setSearchCriteria({ tags: [], text: '', mode: 'OR' });
          }
          setLibrary({
            currentFolderPath: path,
            pendingFolderPath: stillLoading ? path : null,
            imageList,
            imageRatings: ratings,
            activeAlbumId: null,
            activeKeyword: null,
            isViewLoading: stillLoading,
            ...(destinationCommitted
              ? {}
              : {
                  libraryScrollTop: 0,
                  ...(preserveEditor ? {} : { multiSelectedPaths: [], libraryActivePath: null }),
                }),
          });
          committedListingRef.current = destination;
          destinationCommitted = true;
        };

        if (destination && !preloadedImages && !isRefresh) {
          // Show the destination at once from what is already known: its last listing this
          // session, or, in Recursive mode, its part of an ancestor's listing.
          const knownImages =
            takeFolderListing(folderListingCacheRef.current, destination.key) ??
            (isRecursive && previousListing?.recursive && isPathWithin(destination.path, previousListing.path)
              ? (folderListingCacheRef.current.get(previousListing.key) ?? []).filter((image) =>
                  isPathWithin(image.path, destination.path),
                )
              : null);

          if (knownImages) {
            commitImages(knownImages, ratingsOf(knownImages), { stillLoading: true });
          } else {
            loadingViewTimer = window.setTimeout(() => {
              if (isCurrentLoad() && !destinationCommitted) commitImages([], {}, { stillLoading: true });
            }, FOLDER_LOADING_VIEW_DELAY_MS);

            const snapshot = await invoke<CatalogFolderSnapshot | null>(Invokes.LoadCatalogFolder, {
              path,
              recursive: isRecursive,
              xmpSync: appSettings?.enableXmpSync ?? false,
            }).catch((error) => {
              console.warn('Library catalog could not be read; using filesystem scan:', error);
              return null;
            });
            if (!isCurrentLoad()) return;
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
              commitImages(snapshot.images, ratingsOf(snapshot.images), { stillLoading: true });
            }
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

        const command = isRecursive ? Invokes.ListImagesRecursive : Invokes.ListImagesInDir;

        let files: ImageFile[];
        if (preloadedImages) {
          files = preloadedImages;
        } else {
          files = await invoke(command, { path });
        }
        if (!isCurrentLoad()) return;
        mergeImportedXmpStacks(files);
        if (destinationCommitted) {
          const { imageList, imageRatings } = useLibraryStore.getState();
          files = mergeKnownImageState(files, withRatings(imageList, imageRatings));
        }

        const initialRatings = ratingsOf(files);
        const exifSortKeys = ['date_taken', 'iso', 'shutter_speed', 'aperture', 'focal_length'];
        const isExifSortActive = exifSortKeys.includes(sortCriteria.key);
        // EXIF already known (from this session or the catalog) is not read again.
        const pathsWithoutExif = files.filter((image) => !image.exif).map((image) => image.path);

        if (pathsWithoutExif.length > 0) {
          if (isExifSortActive) {
            commitImages(files, initialRatings, { stillLoading: true });
            const exifDataMap: Record<string, any> = await invoke(Invokes.ReadExifForPaths, {
              paths: pathsWithoutExif,
            });
            if (!isCurrentLoad() || useLibraryStore.getState().currentFolderPath !== path) {
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
              for (let offset = 0; offset < pathsWithoutExif.length; offset += batchSize) {
                if (!isCurrentLoad() || useLibraryStore.getState().currentFolderPath !== path) {
                  return;
                }

                const batchPaths = pathsWithoutExif.slice(offset, offset + batchSize);
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
                  if (!isCurrentLoad() || useLibraryStore.getState().currentFolderPath !== path) {
                    return;
                  }
                  Object.assign(pendingExifData, exifDataMap);

                  const isLastBatch = offset + batchSize >= pathsWithoutExif.length;
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
        // A newer navigation supersedes this one (the backend then also stops this listing).
        if (!isCurrentLoad()) return;
        console.error('Failed to load folder contents:', err);
        toast.error('Failed to load images from the selected folder.');
        setLibrary({ pendingFolderPath: null });
      } finally {
        window.clearTimeout(loadingViewTimer);
        if (isCurrentLoad()) {
          useLibraryStore.getState().setLibrary({ isViewLoading: false, pendingFolderPath: null });
        }
      }
    },
    [refs, rememberCommittedListing],
  );

  // Lists images from anywhere in the library, for album and keyword views.
  const loadImageCollection = useCallback(
    async (
      viewPath: string,
      getImagePaths: () => Promise<string[]>,
      collection: { activeAlbumId: string | null; activeKeyword: string | null },
      preserveEditor: boolean,
    ) => {
      const folderLoadGeneration = ++folderLoadGenerationRef.current;
      const { setLibrary } = useLibraryStore.getState();
      const { setUI } = useUIStore.getState();
      rememberCommittedListing();

      if (!preserveEditor) {
        globalImageCache.clear();
        setUI({ activeView: 'library' });
      }

      setLibrary({
        isViewLoading: true,
        pendingFolderPath: viewPath,
      });

      try {
        const imagePaths = await getImagePaths();
        const files: ImageFile[] = await invoke(Invokes.GetAlbumImages, { paths: imagePaths });
        if (folderLoadGenerationRef.current !== folderLoadGeneration) return;
        mergeImportedXmpStacks(files);

        committedListingRef.current = null;
        setLibrary({
          imageList: files,
          imageRatings: ratingsOf(files),
          currentFolderPath: viewPath,
          pendingFolderPath: null,
          ...collection,
          libraryScrollTop: 0,
          ...(preserveEditor ? {} : { multiSelectedPaths: [], libraryActivePath: null }),
        });
        if (!preserveEditor) {
          useLibraryStore.getState().setSearchCriteria({ tags: [], text: '', mode: 'OR' });
        }
      } catch (err) {
        if (folderLoadGenerationRef.current !== folderLoadGeneration) return;
        console.error(`Failed to load ${viewPath}:`, err);
        toast.error(`Failed to load ${viewPath}: ${err}`);
      } finally {
        if (folderLoadGenerationRef.current === folderLoadGeneration) {
          setLibrary({ isViewLoading: false, pendingFolderPath: null });
        }
      }
    },
    [rememberCommittedListing],
  );

  const handleSelectAlbum = useCallback(
    async (albumId: string, albumName: string, imagePaths: string[], preserveEditor = false, skipHistory = false) => {
      if (!skipHistory) {
        useLibraryStore.getState().pushNavHistory({ type: 'album', path: albumId, albumName, images: imagePaths });
      }
      await loadImageCollection(
        `${ALBUM_VIEW_PREFIX}${albumName}`,
        async () => imagePaths,
        { activeAlbumId: albumId, activeKeyword: null },
        preserveEditor,
      );
    },
    [loadImageCollection],
  );

  /** Shows every library image carrying a stored tag; a user keyword includes its child keywords. */
  const handleSelectKeyword = useCallback(
    async (tag: string, preserveEditor = false, skipHistory = false) => {
      if (!skipHistory) {
        useLibraryStore.getState().pushNavHistory({ type: 'keyword', path: tag });
      }
      const label = formatKeyword(tag.startsWith(USER_TAG_PREFIX) ? tag.slice(USER_TAG_PREFIX.length) : tag);
      await loadImageCollection(
        `${KEYWORD_VIEW_PREFIX}${label}`,
        () => invoke<string[]>(Invokes.GetKeywordImagePaths, { tag }),
        { activeAlbumId: null, activeKeyword: tag },
        preserveEditor,
      );
    },
    [loadImageCollection],
  );

  const handleNavStep = useCallback(
    (step: 1 | -1) => {
      const { navHistory, navIndex, setLibrary } = useLibraryStore.getState();
      const targetIndex = navIndex + step;
      const target = navHistory[targetIndex];
      if (!target) return;

      setLibrary({ navIndex: targetIndex });
      if (target.type === 'folder') {
        handleSelectSubfolder(target.path, false, undefined, true, false, true);
      } else if (target.type === 'keyword') {
        handleSelectKeyword(target.path, false, true);
      } else {
        handleSelectAlbum(target.path, target.albumName!, target.images!, false, true);
      }
    },
    [handleSelectSubfolder, handleSelectAlbum, handleSelectKeyword],
  );

  const handleNavBack = useCallback(() => handleNavStep(-1), [handleNavStep]);
  const handleNavForward = useCallback(() => handleNavStep(1), [handleNavStep]);

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

      setLibrary((state) => ({
        rootPaths: rootFolders,
        folderTrees: mergeRefreshedFolderTrees(
          rootFolders,
          createProvisionalFolderTrees(rootFolders),
          state.folderTrees,
        ),
      }));

      if (folderState?.expandedFolders) {
        const newExpandedFolders = new Set<string>(folderState.expandedFolders);
        setLibrary({ expandedFolders: newExpandedFolders });
      } else {
        setLibrary({ expandedFolders: new Set(rootFolders) });
      }

      setLibrary({ isTreeLoading: true });
      void (async () => {
        try {
          const hasMatchingPreload = preloadedDataRef.current?.rootPaths?.join() === rootFolders.join();
          if (hasMatchingPreload && preloadedDataRef.current.cachedTrees) {
            const cachedTrees = await preloadedDataRef.current.cachedTrees.catch((error: unknown) => {
              console.warn('Failed to restore cached folder trees:', error);
              return [];
            });
            preloadedDataRef.current.cachedTrees = undefined;
            if (cachedTrees.length > 0) {
              setLibrary((state) => ({
                folderTrees: mergeRefreshedFolderTrees(rootFolders, state.folderTrees, cachedTrees),
              }));
            }
          }

          let treesData;
          if (hasMatchingPreload && preloadedDataRef.current.trees) {
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
          setLibrary((state) => ({
            folderTrees: mergeRefreshedFolderTrees(rootFolders, state.folderTrees, treesData),
          }));
        } catch (err) {
          console.error('Failed to restore folder trees:', err);
        } finally {
          setLibrary({ isTreeLoading: false });
        }
      })();

      if (pathToSelect && pathToSelect.startsWith(ALBUM_VIEW_PREFIX)) {
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
      } else if (pathToSelect && pathToSelect.startsWith(KEYWORD_VIEW_PREFIX)) {
        if (folderState?.activeKeyword) {
          await handleSelectKeyword(folderState.activeKeyword);
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
    handleSelectKeyword,
    handleOpenFolder,
    handleNavBack,
    handleNavForward,
    handleContinueSession,
  };
}
