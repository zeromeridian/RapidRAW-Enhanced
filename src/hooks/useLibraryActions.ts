import { useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import { showActionToast } from '../components/ui/ActionToast';
import { useLibraryStore } from '../store/useLibraryStore';
import { useEditorStore } from '../store/useEditorStore';
import { useUIStore } from '../store/useUIStore';
import { Invokes, ImageFile, ImageStack, AlbumItem, Album, AlbumGroup } from '../components/ui/AppProperties';
import { createImageStack, findImageStack, moveImageToTopOfStack, toggleImageStacks } from '../utils/imageStacks';
import { globalImageCache } from '../utils/ImageLRUCache';
import { useSettingsStore } from '../store/useSettingsStore';
import { computeFilteredLibrary, computeSortedLibrary } from './useSortedLibrary';
import { getRefineChanges, ImageFlag, IMAGE_FLAG_PREFIX } from '../utils/imageFlags';
import { USER_TAG_PREFIX, isSameKeyword } from '../utils/keywords';

export const clearLibrarySelection = () => {
  useLibraryStore.getState().setLibrary({
    multiSelectedPaths: [],
    libraryActivePath: null,
    selectionAnchorPath: null,
  });
};

// The images a flag, keyword, or stack action applies to when no paths are given.
export const getActionPaths = (): string[] => {
  const { multiSelectedPaths, libraryActivePath } = useLibraryStore.getState();
  const { selectedImage } = useEditorStore.getState();
  if (multiSelectedPaths.length > 0) return multiSelectedPaths;
  if (selectedImage) return [selectedImage.path];
  return libraryActivePath ? [libraryActivePath] : [];
};

// The photo a stack command targets among `paths`: the active one when it is included.
export const getStackTargetPath = (paths: string[]): string | undefined => {
  const { libraryActivePath } = useLibraryStore.getState();
  const selectedPath = useEditorStore.getState().selectedImage?.path;
  return [libraryActivePath, selectedPath].find((path) => path && paths.includes(path)) ?? paths[0];
};

export const saveImageStacks = (update: (stacks: ImageStack[]) => ImageStack[]) => {
  const { appSettings, handleSettingsChange } = useSettingsStore.getState();
  if (!appSettings) return;
  const stacks = appSettings.imageStacks || [];
  const imageStacks = update(stacks);
  if (imageStacks !== stacks) void handleSettingsChange({ ...appSettings, imageStacks });
};

export const stackImages = (paths: string[], coverPath: string) =>
  saveImageStacks((stacks) => createImageStack(stacks, paths, coverPath));

/** Collapses or expands the stack of the target photo among `paths` (and the other stacks wholly in `paths`). */
export const toggleStacksOfPaths = (paths: string[]) =>
  saveImageStacks((stacks) => toggleImageStacks(stacks, paths, getStackTargetPath(paths)));

// Auto-stacks the selection, or every photo in the current view when fewer than two are selected.
export const openCaptureTimeStackModal = (selection: string[] = getActionPaths()) => {
  const targetPaths =
    selection.length >= 2
      ? selection
      : computeSortedLibrary(useLibraryStore.getState(), useSettingsStore.getState()).map((image) => image.path);
  useUIStore.getState().setUI({ captureTimeStackModalState: { isOpen: true, targetPaths } });
};

export const moveImageToStackTop = (path: string) =>
  saveImageStacks((stacks) => {
    const stack = findImageStack(stacks, path);
    return stack && stack.coverPath !== path ? moveImageToTopOfStack(stacks, stack.id, path) : stacks;
  });

// Whether two stored tags are the same tag: user keywords match apart from case (`is_same_tag` in Rust).
const isSameTag = (left: string, right: string) =>
  left === right ||
  (left.startsWith(USER_TAG_PREFIX) && right.startsWith(USER_TAG_PREFIX) && isSameKeyword(left, right));

// Saves a tag change and returns the tag as stored: an added user keyword takes the library's spelling.
const persistTag = async (tag: string, paths: string[], apply: boolean) => {
  if (apply) return invoke<string>(Invokes.AddTagForPaths, { paths, tag });
  await invoke(Invokes.RemoveTagForPaths, { paths, tag });
  return tag;
};

const setTagInLibrary = (tag: string, paths: string[], apply: boolean) => {
  const updatedPaths = new Set(paths);
  useLibraryStore.getState().setLibrary((state) => ({
    imageList: state.imageList.map((image) => {
      if (!updatedPaths.has(image.path)) return image;
      // An image that has the keyword in another case keeps its own spelling, as the backend does.
      if (apply && image.tags?.some((imageTag) => isSameTag(imageTag, tag))) return image;
      const otherTags = (image.tags || []).filter((imageTag) => imageTag !== tag);
      const tags = apply ? [...otherTags, tag].sort() : otherTags;
      return { ...image, tags: tags.length > 0 ? tags : null };
    }),
  }));
};

const applyWithAutoAdvance = (changedPaths: string[], applyChange: () => void) => {
  const { selectedImage } = useEditorStore.getState();
  const activePath = selectedImage?.path ?? useLibraryStore.getState().libraryActivePath;

  if (!activePath || !changedPaths.includes(activePath) || useUIStore.getState().cullingModalState.isOpen) {
    applyChange();
    return;
  }

  const before = computeSortedLibrary(useLibraryStore.getState(), useSettingsStore.getState());
  applyChange();
  const after = computeSortedLibrary(useLibraryStore.getState(), useSettingsStore.getState());

  const visible = new Set(after.map((img) => img.path));
  const activeIndex = before.findIndex((img) => img.path === activePath);
  if (activeIndex === -1 || visible.has(activePath)) return;

  const next =
    before.slice(activeIndex + 1).find((img) => visible.has(img.path)) ??
    before
      .slice(0, activeIndex)
      .reverse()
      .find((img) => visible.has(img.path));

  if (next) {
    useLibraryStore
      .getState()
      .setLibrary({ libraryActivePath: next.path, multiSelectedPaths: [next.path], selectionAnchorPath: next.path });
    if (selectedImage) useUIStore.getState().imageSelectHandler?.(next.path);
  } else if (!selectedImage) {
    clearLibrarySelection();
  }
};

/** Gives the loaded images at `paths` `flag` in the store; `SetFlagForPaths` saves it. */
const setFlagInLibrary = (flag: ImageFlag, paths: string[]) => {
  const updatedPaths = new Set(paths);
  useLibraryStore.getState().setLibrary((state) => ({
    imageList: state.imageList.map((image) => {
      if (!updatedPaths.has(image.path)) return image;
      const tags = (image.tags || []).filter((tag) => !tag.startsWith(IMAGE_FLAG_PREFIX));
      if (flag !== ImageFlag.Unflagged) tags.push(`${IMAGE_FLAG_PREFIX}${flag}`);
      return { ...image, tags: tags.length > 0 ? tags : null };
    }),
  }));
};

/** Saves several flags at once, each on its paths, without moving the selection; false if any save failed. */
const saveFlags = async (...changes: Array<[ImageFlag, string[]]>) => {
  const pending = changes.filter(([, paths]) => paths.length > 0);
  const results = await Promise.allSettled(
    pending.map(([flag, paths]) => invoke(Invokes.SetFlagForPaths, { paths, flag })),
  );
  let isSaved = true;
  results.forEach((result, index) => {
    const [flag, paths] = pending[index];
    if (result.status === 'fulfilled') setFlagInLibrary(flag, paths);
    else {
      isSaved = false;
      toast.error(`Failed to set flag: ${result.reason}`);
    }
  });
  return isSaved;
};

/** What Refine Photos would change: the photos the grid shows after filters and search, hidden stack members too. */
export const getViewRefineChanges = () => getRefineChanges(computeFilteredLibrary(useLibraryStore.getState()));

/** Whether Refine Photos would change anything in the current view. */
export const canRefinePhotos = () => {
  const { rejectPaths, unflagPaths } = getViewRefineChanges();
  return rejectPaths.length > 0 || unflagPaths.length > 0;
};

export function useLibraryActions(handleImageSelect?: (path: string) => void) {
  const { t } = useTranslation();
  const handleRate = useCallback((newRating: number, paths?: string[]) => {
    const { multiSelectedPaths, imageRatings, setLibrary } = useLibraryStore.getState();
    const { selectedImage } = useEditorStore.getState();

    const pathsToRate =
      paths || (multiSelectedPaths.length > 0 ? multiSelectedPaths : selectedImage ? [selectedImage.path] : []);
    if (pathsToRate.length === 0) return;

    const currentRating = imageRatings[pathsToRate[0]] || 0;
    const finalRating = newRating === currentRating ? 0 : newRating;

    applyWithAutoAdvance(pathsToRate, () =>
      setLibrary((state) => {
        const newRatings = { ...state.imageRatings };
        pathsToRate.forEach((p) => {
          newRatings[p] = finalRating;
        });
        return { imageRatings: newRatings };
      }),
    );

    invoke(Invokes.SetRatingForPaths, { paths: pathsToRate, rating: finalRating }).catch((err) => {
      console.error(err);
      toast.error(`Failed to apply rating: ${err}`);
    });
  }, []);

  const handleSetColorLabel = useCallback(async (color: string | null, paths?: string[]) => {
    const { multiSelectedPaths, libraryActivePath, imageList, setLibrary } = useLibraryStore.getState();
    const { selectedImage } = useEditorStore.getState();

    const pathsToUpdate =
      paths || (multiSelectedPaths.length > 0 ? multiSelectedPaths : selectedImage ? [selectedImage.path] : []);
    if (pathsToUpdate.length === 0) return;

    const primaryPath = selectedImage?.path || libraryActivePath;
    const primaryImage = imageList.find((img: ImageFile) => img.path === primaryPath);
    let currentColor = null;
    if (primaryImage && primaryImage.tags) {
      const colorTag = primaryImage.tags.find((tag: string) => tag.startsWith('color:'));
      if (colorTag) currentColor = colorTag.substring(6);
    }
    const finalColor = color !== null && color === currentColor ? null : color;

    try {
      await invoke(Invokes.SetColorLabelForPaths, { paths: pathsToUpdate, color: finalColor });
      applyWithAutoAdvance(pathsToUpdate, () =>
        setLibrary((state) => ({
          imageList: state.imageList.map((image: ImageFile) => {
            if (pathsToUpdate.includes(image.path)) {
              const otherTags = (image.tags || []).filter((tag: string) => !tag.startsWith('color:'));
              const newTags = finalColor ? [...otherTags, `color:${finalColor}`] : otherTags;
              return { ...image, tags: newTags };
            }
            return image;
          }),
        })),
      );
    } catch (err) {
      toast.error(`Failed to set color label: ${err}`);
    }
  }, []);

  const handleSetFlag = useCallback(async (flag: ImageFlag, paths?: string[]) => {
    const pathsToUpdate = paths || getActionPaths();
    if (pathsToUpdate.length === 0) return;

    try {
      await invoke(Invokes.SetFlagForPaths, { paths: pathsToUpdate, flag });
      applyWithAutoAdvance(pathsToUpdate, () => setFlagInLibrary(flag, pathsToUpdate));
    } catch (err) {
      toast.error(`Failed to set flag: ${err}`);
    }
  }, []);

  // Library → Refine Photos (Plan item 72): one confirmation with both counts, then an Undo toast.
  const handleRefinePhotos = useCallback(() => {
    const { rejectPaths, unflagPaths } = getViewRefineChanges();
    if (rejectPaths.length === 0 && unflagPaths.length === 0) {
      toast.info(t('flags.refineNothing'));
      return;
    }
    const refine = async () => {
      if (!(await saveFlags([ImageFlag.Rejected, rejectPaths], [ImageFlag.Unflagged, unflagPaths]))) return;
      showActionToast(
        t('flags.refineDone', { count: rejectPaths.length + unflagPaths.length }),
        t('flags.refineUndo'),
        () => void saveFlags([ImageFlag.Unflagged, rejectPaths], [ImageFlag.Selected, unflagPaths]),
      );
    };
    useUIStore.getState().setUI({
      confirmModalState: {
        confirmText: t('flags.refineConfirm'),
        isOpen: true,
        message: [
          rejectPaths.length > 0 && t('flags.refineRejects', { count: rejectPaths.length }),
          unflagPaths.length > 0 && t('flags.refineUnflags', { count: unflagPaths.length }),
        ]
          .filter(Boolean)
          .join(' '),
        onConfirm: refine,
        title: t('flags.refinePhotos'),
      },
    });
  }, [t]);

  // Adds a keyword to every target image, or removes it when every target already has it.
  const handleToggleKeyword = useCallback(async (keyword: string, paths?: string[]) => {
    const { imageList } = useLibraryStore.getState();
    const pathsToUpdate = paths || getActionPaths();
    if (!keyword || pathsToUpdate.length === 0) return;

    const tag = `${USER_TAG_PREFIX}${keyword}`;
    const updatedPaths = new Set(pathsToUpdate);
    const targets = imageList.filter((image) => updatedPaths.has(image.path));
    const isApplied =
      targets.length > 0 && targets.every((image) => image.tags?.some((imageTag) => isSameTag(imageTag, tag)));

    try {
      if (isApplied) {
        // Removes the keyword in whatever case each image carries it.
        const spellings = [
          ...new Set(targets.flatMap((image) => (image.tags || []).filter((imageTag) => isSameTag(imageTag, tag)))),
        ];
        for (const spelling of spellings) await persistTag(spelling, pathsToUpdate, false);
        applyWithAutoAdvance(pathsToUpdate, () =>
          spellings.forEach((spelling) => setTagInLibrary(spelling, pathsToUpdate, false)),
        );
      } else {
        const storedTag = await persistTag(tag, pathsToUpdate, true);
        applyWithAutoAdvance(pathsToUpdate, () => setTagInLibrary(storedTag, pathsToUpdate, true));
      }
    } catch (err) {
      toast.error(`Failed to update keyword: ${err}`);
    }
  }, []);

  // Adds a stored tag to, or removes it from, the given images; throws when saving fails.
  const handleSetTag = useCallback(async (tag: string, paths: string[], apply: boolean) => {
    if (paths.length === 0) return;
    setTagInLibrary(await persistTag(tag, paths, apply), paths, apply);
  }, []);

  const handleTagsChanged = useCallback((changedPaths: string[], newTags: { tag: string; isUser: boolean }[]) => {
    applyWithAutoAdvance(changedPaths, () =>
      useLibraryStore.getState().setLibrary((state) => ({
        imageList: state.imageList.map((image) => {
          if (changedPaths.includes(image.path)) {
            const systemTags = (image.tags || []).filter(
              (t) => t.startsWith('color:') || t.startsWith(IMAGE_FLAG_PREFIX),
            );
            const prefixedNewTags = newTags.map((t) => (t.isUser ? `${USER_TAG_PREFIX}${t.tag}` : t.tag));
            const finalTags = [...systemTags, ...prefixedNewTags].sort();
            return { ...image, tags: finalTags.length > 0 ? finalTags : null };
          }
          return image;
        }),
      })),
    );
  }, []);

  const handleUpdateExif = useCallback(async (paths: Array<string> | undefined, updates: Record<string, string>) => {
    const { multiSelectedPaths, imageList, setLibrary } = useLibraryStore.getState();
    const { selectedImage, setEditor } = useEditorStore.getState();

    const pathsToUpdate =
      paths && paths.length > 0
        ? paths
        : multiSelectedPaths.length > 0
          ? multiSelectedPaths
          : selectedImage
            ? [selectedImage.path]
            : [];
    if (pathsToUpdate.length === 0) return;

    const physicalPathsSet = new Set(pathsToUpdate.map((p) => p.split('?vc=')[0]));
    const physicalPathsArray = Array.from(physicalPathsSet);

    try {
      await invoke(Invokes.UpdateExifFields, { paths: physicalPathsArray, updates });

      setEditor((state) => {
        if (!state.selectedImage || !physicalPathsSet.has(state.selectedImage.path.split('?vc=')[0])) return state;
        return { selectedImage: { ...state.selectedImage, exif: { ...(state.selectedImage.exif || {}), ...updates } } };
      });

      setLibrary((state) => ({
        imageList: state.imageList.map((img) => {
          if (physicalPathsSet.has(img.path.split('?vc=')[0])) {
            return { ...img, exif: { ...(img.exif || {}), ...updates } };
          }
          return img;
        }),
      }));

      pathsToUpdate.forEach((p) => {
        const cached = globalImageCache.get(p);
        if (cached && cached.selectedImage) {
          globalImageCache.set(p, {
            ...cached,
            selectedImage: { ...cached.selectedImage, exif: { ...(cached.selectedImage.exif || {}), ...updates } },
          });
        }
      });
    } catch (err) {
      toast.error(`Failed to update metadata: ${err}`);
    }
  }, []);

  const handleClearSelection = useCallback(() => {
    const { selectedImage } = useEditorStore.getState();
    if (selectedImage) {
      useLibraryStore.getState().setLibrary({ multiSelectedPaths: [selectedImage.path], selectedFolderPaths: [] });
    } else {
      useLibraryStore.getState().setLibrary({
        multiSelectedPaths: [],
        selectedFolderPaths: [],
        libraryActivePath: null,
      });
    }
  }, []);

  const handleMultiSelectClick = useCallback(
    (
      path: string,
      event: any,
      options: {
        onSimpleClick(p: string, isAlreadySelected: boolean): void;
        updateLibraryActivePath: boolean;
        shiftAnchor: string | null;
      },
    ) => {
      const libraryState = useLibraryStore.getState();
      const { multiSelectedPaths, setLibrary } = libraryState;
      if (libraryState.selectedFolderPaths.length > 0) {
        setLibrary({ selectedFolderPaths: [] });
      }
      const { ctrlKey, metaKey, shiftKey } = event;
      const isCtrlPressed = ctrlKey || metaKey;
      const { shiftAnchor, onSimpleClick, updateLibraryActivePath } = options;

      const isAlreadySelected = multiSelectedPaths.includes(path);

      if (shiftKey && shiftAnchor) {
        const sortedImageList = computeSortedLibrary(libraryState, useSettingsStore.getState());
        const anchorIndex = sortedImageList.findIndex((f) => f.path === shiftAnchor);
        const currentIndex = sortedImageList.findIndex((f) => f.path === path);

        if (anchorIndex !== -1 && currentIndex !== -1) {
          const start = Math.min(anchorIndex, currentIndex);
          const end = Math.max(anchorIndex, currentIndex);
          const range = sortedImageList.slice(start, end + 1).map((f) => f.path);
          const baseSelection = isCtrlPressed ? multiSelectedPaths : [];
          const newSelection = Array.from(new Set([...baseSelection, ...range]));

          setLibrary({ multiSelectedPaths: newSelection, selectionAnchorPath: path });
          if (updateLibraryActivePath) setLibrary({ libraryActivePath: path });
        }
      } else if (isCtrlPressed) {
        const newSelection = new Set(multiSelectedPaths);
        if (newSelection.has(path)) newSelection.delete(path);
        else newSelection.add(path);

        const newSelectionArray = Array.from(newSelection);
        setLibrary({ multiSelectedPaths: newSelectionArray, selectionAnchorPath: path });

        if (updateLibraryActivePath) {
          if (newSelectionArray.includes(path)) setLibrary({ libraryActivePath: path });
          else if (newSelectionArray.length > 0)
            setLibrary({ libraryActivePath: newSelectionArray[newSelectionArray.length - 1] });
          else setLibrary({ libraryActivePath: null });
        }
      } else {
        onSimpleClick(path, isAlreadySelected);
      }
    },
    [],
  );

  const handleLibraryImageSingleClick = useCallback(
    (path: string, event: any) => {
      const { selectionAnchorPath, libraryActivePath, setLibrary } = useLibraryStore.getState();
      handleMultiSelectClick(path, event, {
        shiftAnchor: selectionAnchorPath ?? libraryActivePath,
        updateLibraryActivePath: true,
        onSimpleClick: (p: string, isAlreadySelected: boolean) => {
          if (isAlreadySelected) {
            setLibrary({ libraryActivePath: p, selectionAnchorPath: p });
          } else {
            setLibrary({ multiSelectedPaths: [p], libraryActivePath: p, selectionAnchorPath: p });
          }
        },
      });
    },
    [handleMultiSelectClick],
  );

  const handleImageClick = useCallback(
    (path: string, event: any) => {
      const { selectionAnchorPath, libraryActivePath, setLibrary } = useLibraryStore.getState();
      const { selectedImage } = useEditorStore.getState();
      const inEditor = !!selectedImage;

      handleMultiSelectClick(path, event, {
        shiftAnchor: selectionAnchorPath ?? (inEditor ? selectedImage.path : libraryActivePath),
        updateLibraryActivePath: !inEditor,
        onSimpleClick: (p: string, isAlreadySelected: boolean) => {
          if (!isAlreadySelected) {
            setLibrary({ multiSelectedPaths: [p] });
          }
          if (handleImageSelect) handleImageSelect(p);
          setLibrary({ selectionAnchorPath: p });
        },
      });
    },
    [handleMultiSelectClick, handleImageSelect],
  );

  const refreshAllFolderTrees = useCallback(async () => {
    const { rootPaths, expandedFolders, setLibrary } = useLibraryStore.getState();
    const { appSettings } = useSettingsStore.getState();

    const showImageCounts = appSettings?.enableFolderImageCounts ?? false;
    const pinnedFolders = appSettings?.pinnedFolders || [];
    const expandedArray = Array.from(expandedFolders);

    try {
      const updates: any = {};

      if (rootPaths && rootPaths.length > 0) {
        const treesData = await invoke(Invokes.GetPinnedFolderTrees, {
          paths: rootPaths,
          expandedFolders: expandedArray,
          showImageCounts,
          hideEmptyFolders: appSettings?.hideEmptyFolders ?? false,
        });
        updates.folderTrees = treesData;
      } else {
        updates.folderTrees = [];
      }

      if (pinnedFolders && pinnedFolders.length > 0) {
        const pinnedTreesData = await invoke(Invokes.GetPinnedFolderTrees, {
          paths: pinnedFolders,
          expandedFolders: expandedArray,
          showImageCounts,
          hideEmptyFolders: appSettings?.hideEmptyFolders ?? false,
        });
        updates.pinnedFolderTrees = pinnedTreesData;
      } else {
        updates.pinnedFolderTrees = [];
      }

      if (Object.keys(updates).length > 0) {
        setLibrary(updates);
      }
    } catch (err) {
      console.error('Failed to refresh folder trees:', err);
    }
  }, []);

  const handleTogglePinFolder = useCallback(async (path: string) => {
    const { appSettings, handleSettingsChange } = useSettingsStore.getState();
    const { expandedFolders, setLibrary } = useLibraryStore.getState();
    if (!appSettings) return;

    const currentPins = appSettings.pinnedFolders || [];
    const isPinned = currentPins.includes(path);
    const newPins = isPinned
      ? currentPins.filter((p: string) => p !== path)
      : [...currentPins, path].sort((a, b) => a.localeCompare(b));

    handleSettingsChange({ ...appSettings, pinnedFolders: newPins });

    try {
      const trees = await invoke(Invokes.GetPinnedFolderTrees, {
        paths: newPins,
        expandedFolders: Array.from(expandedFolders),
        showImageCounts: appSettings.enableFolderImageCounts ?? false,
        hideEmptyFolders: appSettings.hideEmptyFolders ?? false,
      });
      setLibrary({ pinnedFolderTrees: trees });
    } catch (err) {
      toast.error(`Failed to refresh pinned folders: ${err}`);
    }
  }, []);

  const handleCreateAlbumItem = useCallback(async (name: string, type: 'album' | 'group') => {
    const { albumTree, setLibrary } = useLibraryStore.getState();
    const { albumActionTarget } = useUIStore.getState();

    const newTree = structuredClone(albumTree);
    const newItem: AlbumItem =
      type === 'album'
        ? ({ type: 'album', id: crypto.randomUUID(), name, images: [] } as Album)
        : ({ type: 'group', id: crypto.randomUUID(), name, children: [] } as AlbumGroup);

    let actualTarget = albumActionTarget;

    const findNode = (nodes: AlbumItem[], id: string): AlbumItem | undefined => {
      for (const n of nodes) {
        if (n.id === id) return n;
        if (n.type === 'group') {
          const found = findNode((n as AlbumGroup).children, id);
          if (found) return found;
        }
      }
      return undefined;
    };

    const findParentId = (nodes: AlbumItem[], childId: string, parentId: string | null): string | null | undefined => {
      for (const n of nodes) {
        if (n.id === childId) return parentId;
        if (n.type === 'group') {
          const found = findParentId((n as AlbumGroup).children, childId, n.id);
          if (found !== undefined) return found;
        }
      }
      return undefined;
    };

    if (actualTarget) {
      const targetNode = findNode(newTree, actualTarget);
      if (targetNode && targetNode.type === 'album') {
        const pId = findParentId(newTree, actualTarget, null);
        actualTarget = pId === undefined ? null : pId;
      }
    }

    const insert = (nodes: AlbumItem[], target: string | null): boolean => {
      if (!target) {
        nodes.push(newItem);
        return true;
      }
      for (const n of nodes) {
        if (n.id === target && n.type === 'group') {
          (n as AlbumGroup).children.push(newItem);
          return true;
        } else if (n.type === 'group') {
          if (insert((n as AlbumGroup).children, target)) return true;
        }
      }
      return false;
    };

    if (insert(newTree, actualTarget)) {
      try {
        await invoke(Invokes.SaveAlbums, { tree: newTree });
        const sortedTree = await invoke(Invokes.GetAlbums);
        setLibrary({ albumTree: sortedTree as AlbumItem[] });
      } catch (err) {
        toast.error(`Failed to create: ${err}`);
      }
    }
  }, []);

  const handleRenameAlbumItem = useCallback(async (newName: string) => {
    const { albumTree, setLibrary } = useLibraryStore.getState();
    const { albumActionTarget } = useUIStore.getState();
    if (!albumActionTarget) return;

    const newTree = structuredClone(albumTree);

    const rename = (nodes: AlbumItem[]) => {
      for (const n of nodes) {
        if (n.id === albumActionTarget) {
          n.name = newName;
          return true;
        }
        if (n.type === 'group' && rename((n as AlbumGroup).children)) return true;
      }
      return false;
    };

    if (rename(newTree)) {
      try {
        await invoke(Invokes.SaveAlbums, { tree: newTree });
        const sortedTree = await invoke(Invokes.GetAlbums);
        setLibrary({ albumTree: sortedTree as AlbumItem[] });
      } catch (err) {
        toast.error(`Failed to rename: ${err}`);
      }
    }
  }, []);

  return {
    handleRate,
    handleSetColorLabel,
    handleSetFlag,
    handleRefinePhotos,
    handleToggleKeyword,
    handleSetTag,
    handleTagsChanged,
    handleUpdateExif,
    handleClearSelection,
    handleLibraryImageSingleClick,
    handleImageClick,
    refreshAllFolderTrees,
    handleTogglePinFolder,
    handleCreateAlbumItem,
    handleRenameAlbumItem,
  };
}
