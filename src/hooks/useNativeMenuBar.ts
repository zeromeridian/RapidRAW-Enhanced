import { useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Menu, MenuItem, PredefinedMenuItem, Submenu } from '@tauri-apps/api/menu';
import type { Resource } from '@tauri-apps/api/core';
import type { ParseKeys } from 'i18next';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import { Invokes, LibraryDisplayMode } from '../components/ui/AppProperties';
import { useEditorStore } from '../store/useEditorStore';
import { useLibraryStore } from '../store/useLibraryStore';
import { useProcessStore } from '../store/useProcessStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useUIStore } from '../store/useUIStore';
import { getRejectedPathsForLoadedFolder } from '../utils/imageFlags';
import { MenuCommand, MenuEntry, MenuView, getMenuAccelerator, menusForView } from '../utils/menuBar';
import { canRunShortcutAction, isTypingKeyPress, runShortcutAction } from './useKeyboardShortcuts';
import { getActionPaths } from './useLibraryActions';

interface NativeMenuBarProps {
  handleDeleteRejected(): void;
  handleLibraryRefresh(): Promise<void>;
  handleRenameFiles(paths: string[]): void;
}

interface MenuCommandHandler {
  canRun(): boolean;
  run(): void;
}

/** Greying out follows the app's state at most this often. */
const ENABLED_REFRESH_MS = 150;

const setLibraryDisplayMode = (mode: LibraryDisplayMode) => {
  const { appSettings, handleSettingsChange } = useSettingsStore.getState();
  if (appSettings && appSettings.libraryDisplayMode !== mode) {
    void handleSettingsChange({ ...appSettings, libraryDisplayMode: mode });
  }
};

/** The macOS menu bar's menus from the shared list (`utils/menuBar.ts`), rebuilt per view. */
export function useNativeMenuBar({
  handleDeleteRejected,
  handleLibraryRefresh,
  handleRenameFiles,
}: NativeMenuBarProps) {
  const { t, i18n } = useTranslation();
  const osPlatform = useSettingsStore((state) => state.osPlatform);
  const keybinds = useSettingsStore((state) => state.appSettings?.keybinds);
  const view: MenuView = useEditorStore((state) => (state.selectedImage ? 'develop' : 'library'));

  const commands: Record<MenuCommand, MenuCommandHandler> = {
    deleteRejected: {
      canRun: () => {
        const { imageList, currentFolderPath } = useLibraryStore.getState();
        return getRejectedPathsForLoadedFolder(imageList, currentFolderPath).length > 0;
      },
      run: handleDeleteRejected,
    },
    displayCull: { canRun: () => true, run: () => setLibraryDisplayMode(LibraryDisplayMode.Cull) },
    displayList: { canRun: () => true, run: () => setLibraryDisplayMode(LibraryDisplayMode.List) },
    refreshView: {
      canRun: () => !!useLibraryStore.getState().currentFolderPath,
      run: () => void handleLibraryRefresh(),
    },
    renamePhotos: { canRun: () => getActionPaths().length > 0, run: () => handleRenameFiles(getActionPaths()) },
    showInFinder: {
      canRun: () => getActionPaths().length === 1,
      run: () =>
        invoke(Invokes.ShowInFinder, { path: getActionPaths()[0] }).catch((err) =>
          toast.error(t('contextMenus.toasts.couldNotShowExplorer', { err })),
        ),
    },
  };
  const commandsRef = useRef(commands);
  commandsRef.current = commands;

  useEffect(() => {
    if (osPlatform !== 'macos') return;
    let isCancelled = false;
    const created: Resource[] = [];
    const toggles: Array<{ item: MenuItem; canRun(): boolean; enabled: boolean }> = [];

    const runAction = (actionId: string) => {
      // A key typed into a text field stays with the field, as with the keydown handler; Undo and
      // Redo then act on its text.
      if (isTypingKeyPress()) {
        if (actionId === 'undo' || actionId === 'redo') document.execCommand(actionId);
        return;
      }
      runShortcutAction(actionId);
    };

    const addToggle = async (text: string, canRun: () => boolean, run: () => void, accelerator?: string) => {
      const enabled = canRun();
      const item = await MenuItem.new({ text, accelerator, enabled, action: run });
      toggles.push({ item, canRun, enabled });
      return item;
    };

    const buildEntry = async (entry: MenuEntry): Promise<MenuItem | PredefinedMenuItem | Submenu> => {
      let item: MenuItem | PredefinedMenuItem | Submenu;
      switch (entry.kind) {
        case 'separator':
          item = await PredefinedMenuItem.new({ item: 'Separator' });
          break;
        case 'native':
          item = await PredefinedMenuItem.new({ item: entry.item === 'About' ? { About: null } : entry.item });
          break;
        case 'submenu':
          item = await Submenu.new({
            text: t(entry.label as ParseKeys),
            items: await Promise.all(entry.entries.map(buildEntry)),
          });
          break;
        case 'action':
          item = await addToggle(
            String(t(entry.label as ParseKeys, entry.labelOptions as never)),
            () => canRunShortcutAction(entry.action),
            () => runAction(entry.action),
            getMenuAccelerator(entry.action, keybinds, osPlatform),
          );
          break;
        case 'command': {
          const handler = () => commandsRef.current[entry.command];
          item = await addToggle(
            t(entry.label as ParseKeys),
            () => handler().canRun(),
            () => {
              if (handler().canRun()) handler().run();
            },
          );
          break;
        }
      }
      created.push(item);
      return item;
    };

    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    const refreshEnabled = () => {
      refreshTimer = undefined;
      for (const toggle of toggles) {
        const enabled = toggle.canRun();
        if (enabled !== toggle.enabled) {
          toggle.enabled = enabled;
          void toggle.item.setEnabled(enabled);
        }
      }
    };
    const scheduleRefresh = () => {
      if (refreshTimer === undefined) refreshTimer = setTimeout(refreshEnabled, ENABLED_REFRESH_MS);
    };
    const unsubscribes = [useEditorStore, useLibraryStore, useUIStore, useSettingsStore, useProcessStore].map((store) =>
      store.subscribe(scheduleRefresh),
    );

    const build = async () => {
      const menus = menusForView(view);
      const submenus = await Promise.all(
        menus.map(async (menu) => {
          const submenu = await Submenu.new({
            text: menu.isAppMenu ? menu.label : t(menu.label as ParseKeys),
            items: await Promise.all(menu.entries.map(buildEntry)),
          });
          created.push(submenu);
          return submenu;
        }),
      );
      const menuBar = await Menu.new({ items: submenus });
      created.push(menuBar);
      if (isCancelled) return;
      const previous = await menuBar.setAsAppMenu();
      await Promise.all(
        menus.map((menu, index) =>
          menu.role === 'window'
            ? submenus[index].setAsWindowsMenuForNSApp()
            : menu.role === 'help'
              ? submenus[index].setAsHelpMenuForNSApp()
              : undefined,
        ),
      );
      void previous?.close();
      scheduleRefresh();
    };
    build().catch((err) => console.error('Failed to build the menu bar:', err));

    return () => {
      isCancelled = true;
      clearTimeout(refreshTimer);
      unsubscribes.forEach((unsubscribe) => unsubscribe());
      // The next menu bar replaces this one in the system; only the handles are freed here.
      created.forEach((resource) => void resource.close());
    };
  }, [osPlatform, view, keybinds, i18n.language, t]);
}
