import { useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import { create } from 'zustand';
import { Invokes } from '../components/ui/AppProperties';
import { useEditorStore } from '../store/useEditorStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useEditorActions } from './useEditorActions';
import { Adjustments } from '../utils/adjustments';

/** A LUT file in `luts/` (Rust `LutEntry`). */
export interface LutEntry {
  name: string;
  path: string;
  /** Its group: the subfolder of `luts/` it is in; empty for none. */
  group: string;
  /** Its path inside `luts/`, which favourites keep. */
  id: string;
}

interface MovedLuts {
  entries: LutEntry[];
  /** `[from, to]` paths. */
  moved: Array<[string, string]>;
}

const SUPPORTED_LUT_EXTENSIONS = ['cube', '3dl', 'png', 'jpg', 'jpeg', 'tif', 'tiff'];

interface LutState {
  entries: LutEntry[];
}

/** The LUT folder as Looks → LUTs and Save as LUT's group list see it. */
export const useLutStore = create<LutState>(() => ({ entries: [] }));

/** The edit without a finishing LUT. */
const withoutLut = (adjustments: Adjustments): Adjustments => ({
  ...adjustments,
  lutPath: null,
  lutName: null,
  lutData: null,
  lutSize: 0,
  lutIntensity: 100,
});

/** The LUT folder and the photo's finishing LUT (Look → LUT, Looks → LUTs). */
export function useLuts() {
  const { t } = useTranslation();
  const { setAdjustments, handleLutSelect, setLutPreviewOverride } = useEditorActions();

  const refreshList = useCallback(async () => {
    try {
      useLutStore.setState({ entries: await invoke<LutEntry[]>(Invokes.ListLuts) });
    } catch (err) {
      console.error('Failed to list LUTs:', err);
    }
  }, []);

  const clearLut = useCallback(() => setAdjustments(withoutLut), [setAdjustments]);

  /** Chooses `entry` as the photo's LUT, or removes it when it is the current one. */
  const selectLut = (entry: LutEntry) => {
    setLutPreviewOverride(null);
    if (useEditorStore.getState().adjustments.lutPath === entry.path) clearLut();
    else handleLutSelect(entry.path);
  };

  /** Copies LUT files into `luts/`, or into `group`. */
  const importLuts = async (group?: string) => {
    try {
      const isAndroid = useSettingsStore.getState().osPlatform === 'android';
      const selected = await open({
        multiple: true,
        filters: isAndroid
          ? []
          : [
              {
                name: t('ui.lut.filterLabel'),
                extensions: [...SUPPORTED_LUT_EXTENSIONS, ...SUPPORTED_LUT_EXTENSIONS.map((ext) => ext.toUpperCase())],
              },
            ],
      });
      let sourcePaths = Array.isArray(selected) ? selected : selected ? [selected] : [];
      if (sourcePaths.length === 0) return;

      if (isAndroid) {
        const names = await Promise.all(
          sourcePaths.map((path) =>
            invoke<string>('resolve_android_content_uri_name', { uriStr: path }).catch(() => path),
          ),
        );
        sourcePaths = sourcePaths.filter((_, index) =>
          SUPPORTED_LUT_EXTENSIONS.includes(names[index].split('.').pop()?.toLowerCase() ?? ''),
        );
        if (sourcePaths.length === 0) {
          toast.error(t('ui.lut.importFailed'));
          return;
        }
      }

      useLutStore.setState({ entries: await invoke<LutEntry[]>(Invokes.ImportLuts, { sourcePaths, group }) });
    } catch (err) {
      console.error('Failed to import LUTs:', err);
      toast.error(t('ui.lut.importFailed'));
    }
  };

  const removeLut = async (entry: LutEntry) => {
    try {
      useLutStore.setState({ entries: await invoke<LutEntry[]>(Invokes.RemoveLut, { path: entry.path }) });
      if (useEditorStore.getState().adjustments.lutPath === entry.path) clearLut();
    } catch (err) {
      console.error('Failed to remove LUT:', err);
    }
  };

  /**
   * Move to Group, Rename Group and Delete Group (`group` empty: no group). The photo's LUT and
   * favourites follow a moved file.
   */
  const moveToGroup = async (entries: ReadonlyArray<LutEntry>, group: string) => {
    try {
      const result = await invoke<MovedLuts>(Invokes.MoveLutsToGroup, {
        paths: entries.map((entry) => entry.path),
        group,
      });
      useLutStore.setState({ entries: result.entries });
      const newPathOf = new Map(result.moved);
      const lutPath = useEditorStore.getState().adjustments.lutPath;
      const newLutPath = lutPath ? newPathOf.get(lutPath) : undefined;
      if (newLutPath) {
        setAdjustments((prev: Adjustments) => ({ ...prev, lutPath: newLutPath }));
      }
      const idOfPath = new Map(result.entries.map((entry) => [entry.path, entry.id]));
      const movedIds = new Map(
        entries.flatMap((entry) => {
          const newId = idOfPath.get(newPathOf.get(entry.path) ?? '');
          return newId ? [[entry.id, newId] as const] : [];
        }),
      );
      const { appSettings, handleSettingsChange } = useSettingsStore.getState();
      const favorites = appSettings?.favoriteLuts ?? [];
      if (appSettings && favorites.some((id) => movedIds.has(id))) {
        handleSettingsChange({ ...appSettings, favoriteLuts: favorites.map((id) => movedIds.get(id) ?? id) });
      }
    } catch (err) {
      toast.error(t('ui.lut.moveFailed', { error: String(err) }));
    }
  };

  return {
    refreshList,
    selectLut,
    clearLut,
    importLuts,
    removeLut,
    moveToGroup,
    startPreview: (entry: LutEntry) => setLutPreviewOverride(entry.path),
    endPreview: () => setLutPreviewOverride(null),
  };
}
