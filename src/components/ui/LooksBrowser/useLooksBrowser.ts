import { useCallback, useMemo } from 'react';
import { useSettingsStore } from '../../../store/useSettingsStore';
import { AppSettings, LooksKind } from '../AppProperties';

interface BrowserSettingKeys {
  favorites: 'favoritePresets' | 'favoriteProfiles' | 'favoriteLuts';
  grid: 'presetBrowserGrid' | 'profileBrowserGrid' | 'lutBrowserGrid';
  /** The layout before the user picks one: presets keep their list, profiles their grid. */
  isGridDefault: boolean;
}

/** Where each Looks browser keeps its favourites and layout in the settings. */
const BROWSER_SETTINGS = {
  presets: { favorites: 'favoritePresets', grid: 'presetBrowserGrid', isGridDefault: false },
  profiles: { favorites: 'favoriteProfiles', grid: 'profileBrowserGrid', isGridDefault: true },
  luts: { favorites: 'favoriteLuts', grid: 'lutBrowserGrid', isGridDefault: true },
} as const satisfies Record<LooksKind, BrowserSettingKeys>;

export type LooksBrowserKind = LooksKind;

const NO_FAVORITES: string[] = [];
const NO_SECTIONS: Record<string, boolean> = {};

const updateSettings = (patch: Partial<AppSettings>) => {
  const { appSettings, handleSettingsChange } = useSettingsStore.getState();
  if (appSettings) handleSettingsChange({ ...appSettings, ...patch });
};

/** A Looks browser's remembered state: favourites, grid or list, and which sections are open. */
export function useLooksBrowser(kind: LooksBrowserKind) {
  const keys: BrowserSettingKeys = BROWSER_SETTINGS[kind];
  const favoriteIds = useSettingsStore((state) => state.appSettings?.[keys.favorites] ?? NO_FAVORITES);
  const isGrid = useSettingsStore((state) => state.appSettings?.[keys.grid] ?? keys.isGridDefault);
  const sections = useSettingsStore((state) => state.appSettings?.looksSections ?? NO_SECTIONS);
  const favorites = useMemo(() => new Set(favoriteIds), [favoriteIds]);

  const toggleFavorite = useCallback(
    (id: string) => {
      const current = useSettingsStore.getState().appSettings?.[keys.favorites] ?? NO_FAVORITES;
      updateSettings({
        [keys.favorites]: current.includes(id) ? current.filter((favorite) => favorite !== id) : [...current, id],
      });
    },
    [keys.favorites],
  );

  const setGrid = useCallback((value: boolean) => updateSettings({ [keys.grid]: value }), [keys.grid]);

  const isSectionOpen = useCallback(
    (section: string, defaultOpen: boolean) => sections[`${kind}:${section}`] ?? defaultOpen,
    [kind, sections],
  );

  const toggleSection = useCallback(
    (section: string, defaultOpen: boolean) => {
      const current = useSettingsStore.getState().appSettings?.looksSections ?? NO_SECTIONS;
      const key = `${kind}:${section}`;
      updateSettings({ looksSections: { ...current, [key]: !(current[key] ?? defaultOpen) } });
    },
    [kind],
  );

  return { favorites, toggleFavorite, isGrid, setGrid, isSectionOpen, toggleSection };
}
