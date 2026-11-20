import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import debounce from 'lodash.debounce';
import { Adjustments } from '../utils/adjustments';
import { getUnlistedAdjustments, pickPresetAdjustments } from '../utils/presetSettings';
import { Folder, Invokes, Preset } from '../components/ui/AppProperties';

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

export interface UserPreset {
  folder?: Folder;
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

export function usePresets(currentAdjustments: Adjustments) {
  const [presets, setPresets] = useState<Array<UserPreset>>([]);
  const [isLoading, setIsLoading] = useState(true);

  const loadPresets = useCallback(async () => {
    setIsLoading(true);
    try {
      const loadedPresets: Array<UserPreset> = await invoke(Invokes.LoadPresets);
      setPresets(loadedPresets);
    } catch (error) {
      console.error('Failed to load presets:', error);
      setPresets([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const savePresetsToBackend = useCallback(
    debounce((presetsToSave: Array<UserPreset>) => {
      invoke(Invokes.SavePresets, { presets: presetsToSave }).catch((err) =>
        console.error('Failed to save presets:', err),
      );
    }, 500),
    [],
  );

  useEffect(() => {
    loadPresets();
  }, [loadPresets]);

  /** Saves the photo's values of the ticked `keys` as a new preset. */
  const addPreset = (name: string, keys: ReadonlySet<string>, folderId: string | null = null) => {
    const newPresetData: Preset = {
      adjustments: pickPresetAdjustments(keys, currentAdjustments),
      id: crypto.randomUUID(),
      name,
    };

    let updatedPresets: Array<UserPreset>;
    if (folderId) {
      updatedPresets = presets.map((item: UserPreset) => {
        if (item.folder && item.folder.id === folderId) {
          return {
            folder: {
              ...item.folder,
              children: [...item.folder.children, newPresetData],
            },
          };
        }
        return item;
      });
    } else {
      updatedPresets = [...presets, { preset: newPresetData }];
    }

    setPresets(updatedPresets);
    savePresetsToBackend(updatedPresets);
    return newPresetData;
  };

  const addFolder = (name: string) => {
    const newFolder = {
      folder: {
        id: crypto.randomUUID(),
        name,
        children: [],
      },
    };

    setPresets((currentPresets: Array<any>) => {
      const updatedPresets = [...currentPresets];
      const firstPresetIndex = updatedPresets.findIndex((p: UserPreset) => p.preset);

      if (firstPresetIndex === -1) {
        updatedPresets.push(newFolder);
      } else {
        updatedPresets.splice(firstPresetIndex, 0, newFolder);
      }

      savePresetsToBackend(updatedPresets);
      return updatedPresets;
    });
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
   * ticked setting is saved at its default and settings the dialog does not list are kept).
   */
  const updatePreset = (id: string, name: string, keys: ReadonlySet<string>, fromPhoto: boolean) => {
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

    const updatedPresets = presets.map((item: UserPreset) => {
      if (item.preset?.id === id) {
        return { preset: updatedPreset };
      }
      if (item.folder?.children.some((child: Preset) => child.id === id)) {
        const children = item.folder.children.map((child: Preset) => (child.id === id ? updatedPreset : child));
        return { folder: { ...item.folder, children } };
      }
      return item;
    });

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
    [presets, savePresetsToBackend],
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
    [presets, savePresetsToBackend],
  );

  const reorderItems = useCallback(
    (activeId: string, overId: string) => {
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
          if (item.folder) {
            const activeChildIndex = getIndex(item.folder.children, activeId);
            const overChildIndex = getIndex(item.folder.children, overId);

            if (activeChildIndex !== -1 && overChildIndex !== -1) {
              const newPresets = currentPresets.map((p: UserPreset) => {
                if (p.folder?.id === item.folder?.id) {
                  return {
                    folder: {
                      ...p?.folder,
                      children: arrayMove(p.folder?.children, activeChildIndex, overChildIndex),
                    },
                  };
                }
                return p;
              });
              savePresetsToBackend(newPresets);
              return newPresets;
            }
          }
        }

        return currentPresets;
      });
    },
    [savePresetsToBackend],
  );

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
  }, [savePresetsToBackend]);

  const importPresetsFromFile = useCallback(
    async (filePath: string) => {
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
    },
    [setPresets],
  );

  const importLegacyPresetsFromFile = useCallback(
    async (filePath: string) => {
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
    },
    [setPresets],
  );

  const importPresetsFromFiles = useCallback(
    async (filePaths: Array<string>): Promise<PresetImportResult> => {
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
    },
    [setPresets],
  );

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
    deleteItem,
    duplicatePreset,
    exportPresetsToFile,
    importPresetsFromFile,
    importPresetsFromFiles,
    importLegacyPresetsFromFile,
    isLoading,
    movePreset,
    presets,
    refreshPresets: loadPresets,
    renameItem,
    reorderItems,
    sortAllPresetsAlphabetically,
    updatePreset,
  };
}
