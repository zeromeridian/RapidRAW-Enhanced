import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { platform } from '@tauri-apps/plugin-os';
import { AppSettings, SupportedTypes, Invokes } from '../components/ui/AppProperties';
import { DEFAULT_THEME_ID } from '../utils/themes';
import { areImageStacksEqual } from '../utils/imageStacks';

interface SettingsState {
  appSettings: AppSettings | null;
  theme: string;
  supportedTypes: SupportedTypes | null;
  osPlatform: string;

  // Actions
  initPlatform: () => void;
  setAppSettings: (settings: AppSettings | null) => void;
  setTheme: (theme: string) => void;
  setSupportedTypes: (types: SupportedTypes | null) => void;
  handleSettingsChange: (newSettings: AppSettings) => Promise<void>;
}

interface PendingSettingsSave {
  affectedStackPaths: Set<string>;
  resolve: Array<() => void>;
  settings: AppSettings;
  stacksChanged: boolean;
}

let pendingSave: PendingSettingsSave | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let saveChain = Promise.resolve();

const flushPendingSettings = () => {
  saveTimer = null;
  const pending = pendingSave;
  pendingSave = null;
  if (!pending) return;

  saveChain = saveChain.then(async () => {
    const { searchCriteria: _searchCriteria, ...settingsToSave } = pending.settings as any;
    try {
      if (pending.stacksChanged && pending.affectedStackPaths.size > 0) {
        await invoke(Invokes.SyncImageStacksToXmp, {
          stacks: pending.settings.imageStacks || [],
          affectedPaths: Array.from(pending.affectedStackPaths),
        });
      }
      await invoke(Invokes.SaveSettings, { settings: settingsToSave });
    } catch (err) {
      console.error('Failed to save settings:', err);
    } finally {
      pending.resolve.forEach((resolve) => resolve());
    }
  });
};

const enqueueSettingsSave = (
  settings: AppSettings,
  stacksChanged: boolean,
  affectedStackPaths: string[],
): Promise<void> =>
  new Promise((resolve) => {
    if (!pendingSave) {
      pendingSave = { settings, stacksChanged, affectedStackPaths: new Set(affectedStackPaths), resolve: [resolve] };
    } else {
      pendingSave.settings = settings;
      pendingSave.stacksChanged ||= stacksChanged;
      affectedStackPaths.forEach((path) => pendingSave?.affectedStackPaths.add(path));
      pendingSave.resolve.push(resolve);
    }

    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(flushPendingSettings, 150);
  });

export const useSettingsStore = create<SettingsState>((set, get) => ({
  appSettings: null,
  theme: DEFAULT_THEME_ID,
  supportedTypes: null,
  osPlatform: '',

  initPlatform: () => {
    try {
      set({ osPlatform: platform() });
    } catch (_err) {
      set({ osPlatform: '' });
    }
  },

  setAppSettings: (settings) => set({ appSettings: settings }),

  setTheme: (theme) => set({ theme }),

  setSupportedTypes: (types) => set({ supportedTypes: types }),

  handleSettingsChange: (newSettings: AppSettings) => {
    if (!newSettings) {
      console.error('handleSettingsChange was called with null settings. Aborting save operation.');
      return Promise.resolve();
    }

    if (newSettings.theme && newSettings.theme !== get().theme) {
      set({ theme: newSettings.theme });
    }

    const previousStacks = get().appSettings?.imageStacks || [];
    const nextStacks = newSettings.imageStacks || [];
    const stacksChanged = !areImageStacksEqual(previousStacks, nextStacks);
    const affectedStackPaths = stacksChanged
      ? Array.from(
          new Set([...previousStacks.flatMap((stack) => stack.paths), ...nextStacks.flatMap((stack) => stack.paths)]),
        )
      : [];

    set({ appSettings: newSettings });
    return enqueueSettingsSave(newSettings, stacksChanged, affectedStackPaths);
  },
}));
