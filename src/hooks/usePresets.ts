import { useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import debounce from 'lodash.debounce';
import { create } from 'zustand';
import { Adjustments } from '../utils/adjustments';
import { getUnlistedAdjustments, pickPresetAdjustments } from '../utils/presetSettings';
import { Invokes, Preset } from '../components/ui/AppProperties';
import type { GroupChoice } from '../components/ui/LooksBrowser/GroupPicker';

/**
 * Clears upstream RapidRAW's Tool/Style flags when ThisIsRAW saves a preset: its settings are
 * the keys it holds, so flags left from before would describe it wrongly to RapidRAW.
 */
const WITHOUT_UPSTREAM_PRESET_FLAGS: Pick<Preset, 'includeMasks' | 'includeCropTransform' | 'presetType'> = {
  includeMasks: undefined,
  includeCropTransform: undefined,
  presetType: undefined,
};

export enum PresetListType {
  Folder = 'folder',
  Preset = 'preset',
}

/** A preset folder (a group in Looks → Presets), as `presets.json` stores it. */
export interface PresetFolder {
  id: string;
  name: string;
  children: Array<Preset>;
}

export interface UserPreset {
  folder?: PresetFolder;
  id?: string | undefined;
  name?: string | undefined;
  preset?: Preset;
}

export interface PresetImportFailure {
  fileName: string;
  error: string;
}

export interface PresetImportResult {
  presets: Array<UserPreset>;
  failures: Array<PresetImportFailure>;
}

function arrayMove(array: any, from: any, to: any) {
  const newArray = array.slice();
  const [item] = newArray.splice(from, 1);
  newArray.splice(to, 0, item);
  return newArray;
}

/** A new, empty folder (preset group). */
const createFolder = (name: string): { folder: PresetFolder } => ({
  folder: { id: crypto.randomUUID(), name, children: [] },
});

/** The tree with `folder` after the other folders, before the first preset outside a folder. */
const insertFolder = (tree: Array<UserPreset>, folder: UserPreset): Array<UserPreset> => {
  const firstPresetIndex = tree.findIndex((item) => item.preset);
  return firstPresetIndex === -1
    ? [...tree, folder]
    : [...tree.slice(0, firstPresetIndex), folder, ...tree.slice(firstPresetIndex)];
};

/** The folder holding preset `id`: its id, `null` outside a folder, `undefined` when the tree lacks it. */
export const findPresetFolderId = (tree: Array<UserPreset>, id: string): string | null | undefined => {
  for (const item of tree) {
    if (item.preset?.id === id) return null;
    if (item.folder?.children.some((child) => child.id === id)) return item.folder.id;
  }
  return undefined;
};

/**
 * The tree with `preset` in the chosen group (a new group is created first): replaced where it
 * is when it stays in its group, otherwise moved to the end of the target.
 */
const placePreset = (tree: Array<UserPreset>, preset: Preset, group: GroupChoice): Array<UserPreset> => {
  let next = tree;
  let targetId: string | null = group.type === 'existing' ? group.id : null;
  if (group.type === 'new') {
    const folder = createFolder(group.name.trim());
    next = insertFolder(next, folder);
    targetId = folder.folder.id;
  }
  const replaceIn = (children: Array<Preset>) => children.map((child) => (child.id === preset.id ? preset : child));
  if (findPresetFolderId(next, preset.id) === targetId) {
    return next.map((item) => {
      if (item.preset?.id === preset.id) return { preset };
      if (item.folder) return { folder: { ...item.folder, children: replaceIn(item.folder.children) } };
      return item;
    });
  }
  const without = next
    .filter((item) => item.preset?.id !== preset.id)
    .map((item) =>
      item.folder
        ? { folder: { ...item.folder, children: item.folder.children.filter((child) => child.id !== preset.id) } }
        : item,
    );
  if (!targetId) return [...without, { preset }];
  return without.map((item) =>
    item.folder?.id === targetId ? { folder: { ...item.folder, children: [...item.folder.children, preset] } } : item,
  );
};

interface PresetState {
  presets: Array<UserPreset>;
  isLoading: boolean;
}

/**
 * The preset tree (`presets.json`), shared by every `usePresets` (Looks → Presets, Masks, the
 * New Look dialog), so a preset saved in one shows in all and saves never race.
 */
const usePresetStore = create<PresetState>(() => ({ presets: [], isLoading: true }));

const setIsLoading = (isLoading: boolean) => usePresetStore.setState({ isLoading });

const setPresets = (update: Array<UserPreset> | ((current: Array<UserPreset>) => Array<UserPreset>)) =>
  usePresetStore.setState((state) => ({
    presets: typeof update === 'function' ? update(state.presets) : update,
  }));

const savePresetsToBackend = debounce((presetsToSave: Array<UserPreset>) => {
  invoke(Invokes.SavePresets, { presets: presetsToSave }).catch((err) => console.error('Failed to save presets:', err));
}, 500);

const loadPresets = async () => {
  setIsLoading(true);
  try {
    setPresets(await invoke<Array<UserPreset>>(Invokes.LoadPresets));
  } catch (error) {
    console.error('Failed to load presets:', error);
    setPresets([]);
  } finally {
    setIsLoading(false);
  }
};

export function usePresets(currentAdjustments: Adjustments) {
  const presets = usePresetStore((state) => state.presets);
  const isLoading = usePresetStore((state) => state.isLoading);

  useEffect(() => {
    loadPresets();
  }, []);

  /** Saves the photo's values of the ticked `keys` as a new preset in the chosen group. */
  const addPreset = (name: string, keys: ReadonlySet<string>, group: GroupChoice) => {
    const newPresetData: Preset = {
      adjustments: pickPresetAdjustments(keys, currentAdjustments),
      id: crypto.randomUUID(),
      name,
    };

    const updatedPresets = placePreset(presets, newPresetData, group);
    setPresets(updatedPresets);
    savePresetsToBackend(updatedPresets);
    return newPresetData;
  };

  const addFolder = (name: string) => {
    setPresets((currentPresets: Array<UserPreset>) => {
      const updatedPresets = insertFolder(currentPresets, createFolder(name));
      savePresetsToBackend(updatedPresets);
      return updatedPresets;
    });
  };

  /** Deletes the folder `id`; its presets stay, outside any folder. */
  const deleteFolder = (id: string) => {
    const children = presets.find((item: UserPreset) => item.folder?.id === id)?.folder?.children ?? [];
    const updatedPresets = [
      ...presets.filter((item: UserPreset) => item.folder?.id !== id),
      ...children.map((preset: Preset) => ({ preset })),
    ];
    setPresets(updatedPresets);
    savePresetsToBackend(updatedPresets);
  };

  /** Moves preset `id` into the chosen group, at its end. */
  const movePresetToGroup = (id: string, group: GroupChoice) => {
    const preset = presets
      .flatMap((item: UserPreset) => (item.preset ? [item.preset] : (item.folder?.children ?? [])))
      .find((candidate: Preset) => candidate.id === id);
    if (!preset) return;
    const updatedPresets = placePreset(presets, preset, group);
    setPresets(updatedPresets);
    savePresetsToBackend(updatedPresets);
  };

  const deleteItem = (id: string) => {
    let updatedPresets = presets.filter((item: UserPreset) => item.preset?.id !== id && item.folder?.id !== id);
    updatedPresets = updatedPresets.map((item: UserPreset) => {
      if (item.folder) {
        return {
          folder: {
            ...item.folder,
            children: item.folder.children.filter((child: any) => child.id !== id),
          },
        };
      }
      return item;
    });
    setPresets(updatedPresets);
    savePresetsToBackend(updatedPresets);
  };

  const renameItem = (id: string | null, newName: string) => {
    const updatedPresets = presets.map((item: UserPreset) => {
      if (item.preset?.id === id) {
        return { preset: { ...item.preset, name: newName } };
      }
      if (item.folder?.id === id) {
        return { folder: { ...item.folder, name: newName } };
      }
      if (item.folder) {
        return {
          folder: {
            ...item.folder,
            children: item.folder.children.map((child: any) => (child.id === id ? { ...child, name: newName } : child)),
          },
        };
      }
      return item;
    });
    setPresets(updatedPresets);
    savePresetsToBackend(updatedPresets);
  };

  /**
   * Renames the preset `id` and keeps only the ticked `keys`. Their values come from the photo
   * (`fromPhoto`, Update with Current Settings) or stay the preset's own (Configure, where a newly
   * ticked setting is saved at its default and settings the dialog does not list are kept), and
   * places it in the chosen group.
   */
  const updatePreset = (
    id: string,
    name: string,
    keys: ReadonlySet<string>,
    fromPhoto: boolean,
    group: GroupChoice,
  ) => {
    const existingPreset = presets
      .flatMap((item: UserPreset) => (item.preset ? [item.preset] : (item.folder?.children ?? [])))
      .find((preset: Preset) => preset.id === id);
    if (!existingPreset) return null;

    const updatedPreset: Preset = {
      ...existingPreset,
      ...WITHOUT_UPSTREAM_PRESET_FLAGS,
      name,
      adjustments: fromPhoto
        ? pickPresetAdjustments(keys, currentAdjustments)
        : {
            ...getUnlistedAdjustments(existingPreset.adjustments),
            ...pickPresetAdjustments(keys, existingPreset.adjustments),
          },
    };

    const updatedPresets = placePreset(presets, updatedPreset, group);
    setPresets(updatedPresets);
    savePresetsToBackend(updatedPresets);
    return updatedPreset;
  };

  const duplicatePreset = useCallback(
    (presetId: string | null) => {
      let presetToDuplicate: Preset | null = null;
      let sourceFolderId = null;

      for (const item of presets) {
        if (item.preset?.id === presetId) {
          presetToDuplicate = item.preset;
          break;
        }
        if (item.folder) {
          const found = item.folder.children.find((p: any) => p.id === presetId);
          if (found) {
            presetToDuplicate = found;
            sourceFolderId = item.folder.id;
            break;
          }
        }
      }

      if (!presetToDuplicate) {
        return null;
      }

      const newPreset: Preset = {
        adjustments: JSON.parse(JSON.stringify(presetToDuplicate.adjustments)),
        id: crypto.randomUUID(),
        name: `${presetToDuplicate.name} Copy`,
        includeMasks: presetToDuplicate.includeMasks,
        includeCropTransform: presetToDuplicate.includeCropTransform,
        presetType: presetToDuplicate.presetType || 'style',
      };

      let updatedPresets;
      if (sourceFolderId) {
        updatedPresets = presets.map((item: UserPreset) => {
          if (item.folder?.id === sourceFolderId) {
            const originalIndex = item.folder.children.findIndex((p: any) => p.id === presetId);
            const newChildren = [...item.folder.children];
            newChildren.splice(originalIndex + 1, 0, newPreset);
            return { folder: { ...item.folder, children: newChildren } };
          }
          return item;
        });
      } else {
        const originalIndex = presets.findIndex((item: UserPreset) => item.preset?.id === presetId);
        updatedPresets = [...presets];
        updatedPresets.splice(originalIndex + 1, 0, { preset: newPreset });
      }

      setPresets(updatedPresets);
      savePresetsToBackend(updatedPresets);
      return newPreset;
    },
    [presets],
  );

  const movePreset = useCallback(
    (presetId: string, targetFolderId: string | null, overId = null) => {
      let presetToMove: Preset | null = null;
      let sourceFolderId = null;

      for (const item of presets) {
        if (item.preset?.id === presetId) {
          presetToMove = item.preset;
          break;
        }
        if (item.folder) {
          const found = item.folder.children.find((p: any) => p.id === presetId);
          if (found) {
            presetToMove = found;
            sourceFolderId = item.folder.id;
            break;
          }
        }
      }

      if (!presetToMove) {
        return;
      }

      let updatedPresets = [...presets];

      if (sourceFolderId) {
        updatedPresets = updatedPresets.map((item: UserPreset) =>
          item.folder?.id === sourceFolderId
            ? { folder: { ...item.folder, children: item.folder.children.filter((p: any) => p.id !== presetId) } }
            : item,
        );
      } else {
        updatedPresets = updatedPresets.filter((item: UserPreset) => item.preset?.id !== presetId);
      }

      if (targetFolderId) {
        updatedPresets = updatedPresets.map((item: UserPreset) => {
          if (item.folder?.id === targetFolderId) {
            const newChildren = [...item.folder.children];
            if (overId) {
              const overIndex = newChildren.findIndex((p) => p.id === overId);
              if (overIndex !== -1) {
                newChildren.splice(overIndex, 0, presetToMove!);
              } else {
                newChildren.push(presetToMove!);
              }
            } else {
              newChildren.push(presetToMove!);
            }
            return { folder: { ...item.folder, children: newChildren } };
          }
          return item;
        });
      } else {
        if (overId) {
          const overIndex = updatedPresets.findIndex(
            (item) => item.preset?.id === overId || item.folder?.id === overId,
          );
          if (overIndex !== -1) {
            updatedPresets.splice(overIndex, 0, { preset: presetToMove });
          } else {
            updatedPresets.push({ preset: presetToMove });
          }
        } else {
          updatedPresets.push({ preset: presetToMove });
        }
      }

      setPresets(updatedPresets);
      savePresetsToBackend(updatedPresets);
    },
    [presets],
  );

  const reorderItems = useCallback((activeId: string, overId: string) => {
    setPresets((currentPresets: Array<UserPreset>) => {
      const getIndex = (arr: Array<UserPreset>, id: string) =>
        arr.findIndex((item: UserPreset) => item.preset?.id === id || item.folder?.id === id || item?.id === id);

      const activeRootIndex = getIndex(currentPresets, activeId);
      const overRootIndex = getIndex(currentPresets, overId);

      if (activeRootIndex !== -1 && overRootIndex !== -1) {
        const newPresets: Array<UserPreset> = arrayMove(currentPresets, activeRootIndex, overRootIndex);
        savePresetsToBackend(newPresets);
        return newPresets;
      }

      for (const item of currentPresets) {
        const folder = item.folder;
        if (folder) {
          const activeChildIndex = folder.children.findIndex((child) => child.id === activeId);
          const overChildIndex = folder.children.findIndex((child) => child.id === overId);

          if (activeChildIndex !== -1 && overChildIndex !== -1) {
            const newPresets = currentPresets.map((p: UserPreset) =>
              p.folder?.id === folder.id
                ? { folder: { ...folder, children: arrayMove(folder.children, activeChildIndex, overChildIndex) } }
                : p,
            );
            savePresetsToBackend(newPresets);
            return newPresets;
          }
        }
      }

      return currentPresets;
    });
  }, []);

  const sortAllPresetsAlphabetically = useCallback(() => {
    setPresets((currentPresets) => {
      const newPresets: Array<UserPreset> = JSON.parse(JSON.stringify(currentPresets));
      const sortOptions = { numeric: true, sensitivity: 'base' };

      newPresets.forEach((item: UserPreset) => {
        if (item.folder && item.folder.children) {
          item.folder.children.sort((a: any, b: any) => a.name.localeCompare(b.name, undefined, sortOptions));
        }
      });

      const folders = newPresets.filter((item: UserPreset) => item.folder);
      const rootPresets = newPresets.filter((item: UserPreset) => item.preset);

      folders.sort((a: any, b: any) => a.folder.name.localeCompare(b.folder.name, undefined, sortOptions));
      rootPresets.sort((a: any, b: any) => a.preset.name.localeCompare(b.preset.name, undefined, sortOptions));

      const sortedPresets = [...folders, ...rootPresets];

      savePresetsToBackend(sortedPresets);
      return sortedPresets;
    });
  }, []);

  const importPresetsFromFile = useCallback(async (filePath: string) => {
    setIsLoading(true);
    try {
      const updatedPresetList: Array<any> = await invoke(Invokes.HandleImportPresetsFromFile, { filePath });
      setPresets(updatedPresetList);
    } catch (error) {
      console.error('Failed to import presets from file:', error);
      throw error;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const importLegacyPresetsFromFile = useCallback(async (filePath: string) => {
    setIsLoading(true);
    try {
      const updatedPresetList: Array<UserPreset> = await invoke(Invokes.HandleImportLegacyPresetsFromFile, {
        filePath,
      });
      setPresets(updatedPresetList);
    } catch (error) {
      console.error('Failed to import legacy presets from file:', error);
      throw error;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const importPresetsFromFiles = useCallback(async (filePaths: Array<string>): Promise<PresetImportResult> => {
    setIsLoading(true);
    try {
      const result: PresetImportResult = await invoke(Invokes.HandleImportPresetsFromFiles, { filePaths });
      setPresets(result.presets);
      return result;
    } catch (error) {
      console.error('Failed to import presets from files:', error);
      throw error;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const exportPresetsToFile = useCallback(async (presetsToExport: Array<any>, filePath: string) => {
    try {
      await invoke(Invokes.HandleExportPresetsToFile, { presetsToExport, filePath });
    } catch (error) {
      console.error('Failed to export presets to file:', error);
      throw error;
    }
  }, []);

  return {
    addFolder,
    addPreset,
    deleteFolder,
    deleteItem,
    duplicatePreset,
    exportPresetsToFile,
    importPresetsFromFile,
    importPresetsFromFiles,
    importLegacyPresetsFromFile,
    isLoading,
    movePreset,
    movePresetToGroup,
    presets,
    refreshPresets: loadPresets,
    renameItem,
    reorderItems,
    sortAllPresetsAlphabetically,
    updatePreset,
  };
}
