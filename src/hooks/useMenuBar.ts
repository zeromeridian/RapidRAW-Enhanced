import { useEffect, useMemo, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu } from '@tauri-apps/api/menu';
import { getCurrentWindow } from '@tauri-apps/api/window';
import type { Resource } from '@tauri-apps/api/core';
import type { ParseKeys } from 'i18next';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import {
  Invokes,
  LibraryDisplayMode,
  LibraryViewMode,
  Option,
  OPTION_SEPARATOR,
  Panel,
} from '../components/ui/AppProperties';
import { useEditorStore } from '../store/useEditorStore';
import { useLibraryStore } from '../store/useLibraryStore';
import { useProcessStore } from '../store/useProcessStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { SettingsPageId, useUIStore } from '../store/useUIStore';
import { getRejectedPathsForLoadedFolder } from '../utils/imageFlags';
import { formatActionCombo } from '../utils/keyboardUtils';
import { isCollectionView } from '../utils/libraryViews';
import {
  MenuCommand,
  MenuEntry,
  MenuOptionSource,
  MenuView,
  NativeMenuItem,
  getMenuAccelerator,
  menusForView,
} from '../utils/menuBar';
import { backUpSettings, confirmWithAppModal, restoreSettings } from '../utils/settingsBackup';
import { canRunShortcutAction, isTypingKeyPress, runShortcutAction } from './useKeyboardShortcuts';
import { getActionPaths } from './useLibraryActions';
import type { PathCommand, PhotoCommand } from './usePhotoCommands';

interface MenuBarProps {
  handleDeleteRejected(): void;
  handleLibraryRefresh(): Promise<void>;
  libraryViewMode: LibraryViewMode;
  menuOptions: Record<MenuOptionSource, () => Option>;
  photoCommands: Record<PhotoCommand, PathCommand>;
  readXmpFromFolder(folderPath: string): Promise<void>;
  setLibraryViewMode(mode: LibraryViewMode): void;
}

interface MenuCommandHandler {
  canRun(): boolean;
  /** Shown as a check mark (an on/off entry). */
  isChecked?(): boolean;
  run(): void;
}

type NativeItem = MenuItem | CheckMenuItem | PredefinedMenuItem | Submenu;

/** A menu of the Windows and Linux bar: its title and, built when it opens, its entries. */
export interface InAppMenu {
  id: string;
  label: string;
}

export interface MenuBarModel {
  /** Empty on macOS (native menus) and Android (no menus). */
  menus: InAppMenu[];
  buildMenuOptions(menuId: string): Option[];
}

/** The window items the Windows and Linux bar offers itself (`IN_APP_NATIVE_ITEMS`). */
const IN_APP_WINDOW_ITEMS: Partial<Record<NativeMenuItem, { label: ParseKeys; run(): Promise<void> }>> = {
  CloseWindow: { label: 'menuBar.items.closeWindow', run: () => getCurrentWindow().close() },
  Fullscreen: {
    label: 'menuBar.items.fullScreen',
    run: async () => {
      const appWindow = getCurrentWindow();
      await appWindow.setFullscreen(!(await appWindow.isFullscreen()));
    },
  },
  Maximize: { label: 'menuBar.items.maximize', run: () => getCurrentWindow().toggleMaximize() },
  Minimize: { label: 'menuBar.items.minimize', run: () => getCurrentWindow().minimize() },
};

/** Opens Settings on one of its pages. */
const openSettingsPage = (settingsPage: SettingsPageId): MenuCommandHandler => ({
  canRun: () => true,
  run: () => useUIStore.getState().setUI({ isSettingsOpen: true, settingsPage }),
});

/** Greying out follows the app's state at most this often. */
const ENABLED_REFRESH_MS = 150;

const setLibraryDisplayMode = (mode: LibraryDisplayMode) => {
  const { appSettings, handleSettingsChange } = useSettingsStore.getState();
  if (appSettings && appSettings.libraryDisplayMode !== mode) {
    void handleSettingsChange({ ...appSettings, libraryDisplayMode: mode });
  }
};

/** The folder shown in the Library, unless it is a collection (an album or a search). */
const getOpenFolder = () => {
  const { currentFolderPath } = useLibraryStore.getState();
  return currentFolderPath && !isCollectionView(currentFolderPath) ? currentFolderPath : null;
};

const visibilityToggle = (key: 'filmstrip' | 'folderTree'): MenuCommandHandler => ({
  canRun: () => true,
  isChecked: () => Boolean(useUIStore.getState().uiVisibility[key]),
  run: () =>
    useUIStore
      .getState()
      .setUI((state) => ({ uiVisibility: { ...state.uiVisibility, [key]: !state.uiVisibility[key] } })),
});

/** A Develop tool panel, as the right panel's switcher opens it. */
const toolPanel = (panel: Panel): MenuCommandHandler => ({
  canRun: () => !!useEditorStore.getState().selectedImage,
  run: () => useUIStore.getState().setRightPanel(panel),
});

/** What a right-click submenu shows; it is rebuilt only when this changes. */
const optionSignature = (option: Option) =>
  `${JSON.stringify(option, ['label', 'disabled', 'type', 'submenu'])}\n${getActionPaths().join('\n')}`;

/**
 * The menu bar from the shared list (`utils/menuBar.ts`), rebuilt per view: native menus on macOS, and
 * on Windows and Linux the model for the title bar's own menus (`MenuBarMenus`).
 */
export function useMenuBar({
  handleDeleteRejected,
  handleLibraryRefresh,
  libraryViewMode,
  menuOptions,
  photoCommands,
  readXmpFromFolder,
  setLibraryViewMode,
}: MenuBarProps): MenuBarModel {
  const { t, i18n } = useTranslation();
  const osPlatform = useSettingsStore((state) => state.osPlatform);
  const keybinds = useSettingsStore((state) => state.appSettings?.keybinds);
  const view: MenuView = useEditorStore((state) => (state.selectedImage ? 'develop' : 'library'));

  // The right-click menus' photo commands act on the selection, as the keys do.
  const photoMenuCommands = Object.fromEntries(
    Object.entries(photoCommands).map(([id, command]) => [
      id,
      { canRun: () => command.canRun(getActionPaths()), run: () => command.run(getActionPaths()) },
    ]),
  ) as Record<PhotoCommand, MenuCommandHandler>;

  const commands: Record<MenuCommand, MenuCommandHandler> = {
    ...photoMenuCommands,
    about: openSettingsPage('about'),
    backUpSettings: { canRun: () => true, run: () => void backUpSettings(t) },
    blendPad: toolPanel(Panel.BlendPad),
    deleteRejected: {
      canRun: () => {
        const { imageList, currentFolderPath } = useLibraryStore.getState();
        return getRejectedPathsForLoadedFolder(imageList, currentFolderPath).length > 0;
      },
      run: handleDeleteRejected,
    },
    displayCull: { canRun: () => true, run: () => setLibraryDisplayMode(LibraryDisplayMode.Cull) },
    displayList: { canRun: () => true, run: () => setLibraryDisplayMode(LibraryDisplayMode.List) },
    filmstrip: visibilityToggle('filmstrip'),
    keyboardShortcuts: openSettingsPage('shortcuts'),
    leftPanel: visibilityToggle('folderTree'),
    lensGeometry: toolPanel(Panel.LensGeometry),
    newAlbum: {
      canRun: () => true,
      run: () => useUIStore.getState().setUI({ albumActionTarget: null, isCreateAlbumModalOpen: true }),
    },
    newFolder: {
      canRun: () => !!getOpenFolder(),
      run: () => useUIStore.getState().setUI({ folderActionTarget: getOpenFolder(), isCreateFolderModalOpen: true }),
    },
    // Closes the window as its close button does, so its usual saving on close runs.
    quit: { canRun: () => true, run: () => void getCurrentWindow().close() },
    readXmp: {
      canRun: () => !!getOpenFolder(),
      run: () => {
        const folder = getOpenFolder();
        if (folder) void readXmpFromFolder(folder);
      },
    },
    refreshView: {
      canRun: () => !!useLibraryStore.getState().currentFolderPath,
      run: () => void handleLibraryRefresh(),
    },
    restoreSettings: { canRun: () => true, run: () => void restoreSettings(t, confirmWithAppModal) },
    showInFinder: {
      canRun: () => getActionPaths().length === 1,
      run: () =>
        invoke(Invokes.ShowInFinder, { path: getActionPaths()[0] }).catch((err) =>
          toast.error(t('contextMenus.toasts.couldNotShowExplorer', { err })),
        ),
    },
    showSubfolders: {
      canRun: () => true,
      isChecked: () => libraryViewMode === LibraryViewMode.Recursive,
      run: () =>
        setLibraryViewMode(
          libraryViewMode === LibraryViewMode.Recursive ? LibraryViewMode.Flat : LibraryViewMode.Recursive,
        ),
    },
    taggingPanel: {
      canRun: () => true,
      run: () => {
        const ui = useUIStore.getState();
        if (useEditorStore.getState().selectedImage) ui.setRightPanel(Panel.Tagging);
        else ui.toggleLibraryPanel('tagging');
      },
    },
    zoneEditor: toolPanel(Panel.ZoneTint),
  };
  const commandsRef = useRef(commands);
  commandsRef.current = commands;
  const menuOptionsRef = useRef(menuOptions);
  menuOptionsRef.current = menuOptions;
  const refreshRef = useRef<() => void>(() => {});

  // The view mode is the App's own state, not a store the menu listens to.
  useEffect(() => refreshRef.current(), [libraryViewMode]);

  useEffect(() => {
    if (osPlatform !== 'macos') return;
    let isCancelled = false;
    const created: Resource[] = [];
    const toggles: Array<{
      item: MenuItem | CheckMenuItem;
      canRun(): boolean;
      enabled: boolean;
      isChecked?(): boolean;
    }> = [];
    // `resources` holds every handle of the submenu's current items, freed when they are replaced.
    const optionMenus: Array<{
      submenu: Submenu;
      source: MenuOptionSource;
      signature: string;
      items: NativeItem[];
      resources: Resource[];
      update: Promise<void>;
    }> = [];

    const runAction = (actionId: string) => {
      // A key typed into a text field stays with the field, as with the keydown handler; Undo and
      // Redo then act on its text.
      if (isTypingKeyPress()) {
        if (actionId === 'undo' || actionId === 'redo') document.execCommand(actionId);
        return;
      }
      runShortcutAction(actionId);
    };

    const addToggle = async (
      text: string,
      canRun: () => boolean,
      run: () => void,
      { accelerator, isChecked }: { accelerator?: string; isChecked?(): boolean } = {},
    ) => {
      const enabled = canRun();
      const checked = isChecked?.();
      const item =
        checked === undefined
          ? await MenuItem.new({ text, accelerator, enabled, action: run })
          : await CheckMenuItem.new({ text, accelerator, enabled, checked, action: run });
      toggles.push({ item, canRun, enabled, isChecked });
      return item;
    };

    // A right-click menu entry as a native item, its handles added to `resources`; its own submenus are
    // built the same way.
    const buildOption = async (option: Option, resources: Resource[]): Promise<NativeItem> => {
      const item =
        option.type === OPTION_SEPARATOR
          ? await PredefinedMenuItem.new({ item: 'Separator' })
          : option.submenu
            ? await Submenu.new({
                text: option.label ?? '',
                enabled: !option.disabled,
                items: await buildOptions(option.submenu, resources),
              })
            : await MenuItem.new({
                text: option.label ?? '',
                enabled: !option.disabled && !!option.onClick,
                action: () => option.onClick?.(),
              });
      resources.push(item);
      return item;
    };
    const buildOptions = (items: Option[] | undefined, resources: Resource[]) =>
      Promise.all((items ?? []).map((option) => buildOption(option, resources)));

    const refreshOptionMenu = (entry: (typeof optionMenus)[number]) => {
      entry.update = entry.update.then(async () => {
        const option = menuOptionsRef.current[entry.source]();
        const signature = optionSignature(option);
        if (isCancelled || signature === entry.signature) return;
        entry.signature = signature;
        await Promise.all(entry.items.map((item) => entry.submenu.remove(item)));
        entry.resources.forEach((resource) => void resource.close());
        entry.resources = [];
        entry.items = await buildOptions(option.submenu, entry.resources);
        await entry.submenu.append(entry.items);
        await entry.submenu.setEnabled(!option.disabled);
      });
    };

    const buildEntry = async (entry: MenuEntry): Promise<NativeItem> => {
      let item: NativeItem;
      switch (entry.kind) {
        case 'separator':
          item = await PredefinedMenuItem.new({ item: 'Separator' });
          break;
        case 'native':
          item = await PredefinedMenuItem.new({ item: entry.item === 'About' ? { About: null } : entry.item });
          break;
        case 'options': {
          const option = menuOptionsRef.current[entry.source]();
          const resources: Resource[] = [];
          const items = await buildOptions(option.submenu, resources);
          const submenu = await Submenu.new({ text: option.label ?? '', enabled: !option.disabled, items });
          optionMenus.push({
            submenu,
            source: entry.source,
            signature: optionSignature(option),
            items,
            resources,
            update: Promise.resolve(),
          });
          item = submenu;
          break;
        }
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
            { accelerator: getMenuAccelerator(entry.action, keybinds, osPlatform) },
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
            { isChecked: handler().isChecked && (() => handler().isChecked?.() ?? false) },
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
        // A click flips a native check mark itself, so it is always set to the app's state.
        const checked = toggle.isChecked?.();
        if (checked !== undefined && toggle.item instanceof CheckMenuItem) void toggle.item.setChecked(checked);
      }
      optionMenus.forEach(refreshOptionMenu);
    };
    const scheduleRefresh = () => {
      if (refreshTimer === undefined) refreshTimer = setTimeout(refreshEnabled, ENABLED_REFRESH_MS);
    };
    refreshRef.current = scheduleRefresh;
    const unsubscribes = [useEditorStore, useLibraryStore, useUIStore, useSettingsStore, useProcessStore].map((store) =>
      store.subscribe(scheduleRefresh),
    );

    const build = async () => {
      const menus = menusForView(view, osPlatform);
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
      refreshRef.current = () => {};
      unsubscribes.forEach((unsubscribe) => unsubscribe());
      // The next menu bar replaces this one in the system; only the handles are freed here.
      [...created, ...optionMenus.flatMap((entry) => entry.resources)].forEach((resource) => void resource.close());
    };
  }, [osPlatform, view, keybinds, i18n.language, t]);

  // Windows and Linux: the title bar's menus, their entries built from the app's state when one opens.
  const hasInAppMenus = osPlatform === 'linux' || osPlatform === 'windows';
  const inAppMenus = useMemo(
    () => (hasInAppMenus ? menusForView(view, osPlatform) : []),
    [hasInAppMenus, osPlatform, view],
  );

  const toOption = (entry: MenuEntry): Option | null => {
    switch (entry.kind) {
      case 'separator':
        return { type: OPTION_SEPARATOR };
      case 'native': {
        const windowItem = IN_APP_WINDOW_ITEMS[entry.item];
        return windowItem ? { label: t(windowItem.label), onClick: () => void windowItem.run() } : null;
      }
      case 'options':
        return menuOptionsRef.current[entry.source]();
      case 'submenu':
        return { label: t(entry.label as ParseKeys), submenu: toOptions(entry.entries) };
      case 'action':
        return {
          label: String(t(entry.label as ParseKeys, entry.labelOptions as never)),
          disabled: !canRunShortcutAction(entry.action),
          shortcut: formatActionCombo(entry.action, keybinds, osPlatform) || undefined,
          onClick: () => runShortcutAction(entry.action),
        };
      case 'command': {
        const handler = commandsRef.current[entry.command];
        return {
          label: t(entry.label as ParseKeys),
          checked: handler.isChecked?.(),
          disabled: !handler.canRun(),
          onClick: handler.run,
        };
      }
    }
  };
  const toOptions = (entries: MenuEntry[]) =>
    entries.map(toOption).filter((option): option is Option => option !== null);

  return {
    menus: inAppMenus.map((menu) => ({ id: menu.id, label: t(menu.label as ParseKeys) })),
    buildMenuOptions: (menuId) => toOptions(inAppMenus.find((menu) => menu.id === menuId)?.entries ?? []),
  };
}
