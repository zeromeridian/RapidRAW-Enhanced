import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import debounce from 'lodash.debounce';
import { COPYABLE_ADJUSTMENT_KEYS } from '../utils/adjustments';

export function usePresets(currentAdjustments) {
  const [presets, setPresets] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  const loadPresets = useCallback(async () => {
    setIsLoading(true);
    try {
      const loadedPresets = await invoke('load_presets');
      setPresets(loadedPresets);
    } catch (error) {
      console.error('Failed to load presets:', error);
      setPresets([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const savePresetsToBackend = useCallback(debounce((presetsToSave) => {
    invoke('save_presets', { presets: presetsToSave })
      .catch(err => console.error("Failed to save presets:", err));
  }, 500), []);

  useEffect(() => {
    loadPresets();
  }, [loadPresets]);

  const addPreset = (name, folderId = null) => {
    const presetAdjustments = {};
    for (const key of COPYABLE_ADJUSTMENT_KEYS) {
      if (currentAdjustments.hasOwnProperty(key)) {
        presetAdjustments[key] = currentAdjustments[key];
      }
    }

    const newPresetData = {
      id: crypto.randomUUID(),
      name,
      adjustments: presetAdjustments,
    };

    let updatedPresets;
    if (folderId) {
      updatedPresets = presets.map(item => {
        if (item.folder && item.folder.id === folderId) {
          return {
            folder: {
              ...item.folder,
              children: [...item.folder.children, newPresetData],
            }
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

  const addFolder = (name) => {
    const newFolder = {
      folder: {
        id: crypto.randomUUID(),
        name,
        children: [],
      }
    };
    const updatedPresets = [...presets, newFolder];
    setPresets(updatedPresets);
    savePresetsToBackend(updatedPresets);
  };

  const deleteItem = (id) => {
    let updatedPresets = presets.filter(item => (item.preset?.id !== id && item.folder?.id !== id));
    updatedPresets = updatedPresets.map(item => {
      if (item.folder) {
        return {
          folder: {
            ...item.folder,
            children: item.folder.children.filter(child => child.id !== id),
          }
        };
      }
      return item;
    });
    setPresets(updatedPresets);
    savePresetsToBackend(updatedPresets);
  };

  const renameItem = (id, newName) => {
    const updatedPresets = presets.map(item => {
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
            children: item.folder.children.map(child => 
              child.id === id ? { ...child, name: newName } : child
            ),
          }
        };
      }
      return item;
    });
    setPresets(updatedPresets);
    savePresetsToBackend(updatedPresets);
  };

  const updatePreset = (id) => {
    const presetAdjustments = {};
    for (const key of COPYABLE_ADJUSTMENT_KEYS) {
      if (currentAdjustments.hasOwnProperty(key)) {
        presetAdjustments[key] = currentAdjustments[key];
      }
    }

    let updatedPreset = null;
    const updatedPresets = presets.map(item => {
      if (item.preset?.id === id) {
        updatedPreset = { ...item.preset, adjustments: presetAdjustments };
        return { preset: updatedPreset };
      }
      if (item.folder) {
        let found = false;
        const newChildren = item.folder.children.map(child => {
          if (child.id === id) {
            found = true;
            updatedPreset = { ...child, adjustments: presetAdjustments };
            return updatedPreset;
          }
          return child;
        });
        if (found) {
          return { folder: { ...item.folder, children: newChildren } };
        }
      }
      return item;
    });
    setPresets(updatedPresets);
    savePresetsToBackend(updatedPresets);
    return updatedPreset;
  };

  const duplicatePreset = useCallback((presetId) => {
    let presetToDuplicate = null;
    presets.forEach(item => {
      if (item.preset?.id === presetId) {
        presetToDuplicate = item.preset;
      } else if (item.folder) {
        const found = item.folder.children.find(p => p.id === presetId);
        if (found) presetToDuplicate = found;
      }
    });

    if (!presetToDuplicate) {
      console.error("Preset to duplicate not found");
      return null;
    }

    const newPreset = {
      adjustments: JSON.parse(JSON.stringify(presetToDuplicate.adjustments)),
      id: crypto.randomUUID(),
      name: `${presetToDuplicate.name} Copy`,
    };

    const updatedPresets = [...presets, { preset: newPreset }];
    setPresets(updatedPresets);
    savePresetsToBackend(updatedPresets);
    return newPreset;
  }, [presets, savePresetsToBackend]);

  const movePreset = useCallback((presetId, targetFolderId) => {
    let presetToMove = null;
    let sourceFolderId = null;

    for (const item of presets) {
      if (item.preset?.id === presetId) {
        presetToMove = item.preset;
        break;
      }
      if (item.folder) {
        const found = item.folder.children.find(p => p.id === presetId);
        if (found) {
          presetToMove = found;
          sourceFolderId = item.folder.id;
          break;
        }
      }
    }

    if (!presetToMove) return;
    if (sourceFolderId === targetFolderId) return;

    let updatedPresets = [...presets];

    if (sourceFolderId) {
      updatedPresets = updatedPresets.map(item => 
        item.folder?.id === sourceFolderId 
          ? { folder: { ...item.folder, children: item.folder.children.filter(p => p.id !== presetId) } }
          : item
      );
    } else {
      updatedPresets = updatedPresets.filter(item => item.preset?.id !== presetId);
    }

    if (targetFolderId) {
      updatedPresets = updatedPresets.map(item => 
        item.folder?.id === targetFolderId
          ? { folder: { ...item.folder, children: [...item.folder.children, presetToMove] } }
          : item
      );
    } else {
      updatedPresets.push({ preset: presetToMove });
    }

    setPresets(updatedPresets);
    savePresetsToBackend(updatedPresets);
  }, [presets, savePresetsToBackend]);

  const importPresetsFromFile = useCallback(async (filePath) => {
    setIsLoading(true);
    try {
      const updatedPresetList = await invoke('handle_import_presets_from_file', { filePath });
      setPresets(updatedPresetList);
    } catch (error) {
      console.error('Failed to import presets from file:', error);
      throw error;
    } finally {
      setIsLoading(false);
    }
  }, [setPresets]);

  const exportPresetsToFile = useCallback(async (presetsToExport, filePath) => {
    try {
      await invoke('handle_export_presets_to_file', { presetsToExport, filePath });
    } catch (error) {
      console.error('Failed to export presets to file:', error);
      throw error;
    }
  }, []);

  return {
    presets,
    isLoading,
    addPreset,
    addFolder,
    deleteItem,
    renameItem,
    updatePreset,
    duplicatePreset,
    movePreset,
    importPresetsFromFile,
    exportPresetsToFile,
    refreshPresets: loadPresets,
  };
}