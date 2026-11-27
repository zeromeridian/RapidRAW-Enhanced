import type { PhotoCommand } from '../hooks/usePhotoCommands';
import { KEYBIND_DEFINITIONS, getEffectiveCombo } from './keyboardUtils';
import { KEYWORD_SET_SIZE } from './keywords';

/**
 * The menu bar (Plan item 69, `docs/MENU_BAR_PLAN.md`): Lightroom Classic-style menus that run the
 * same keybind actions and commands as the keys, buttons and context menus, and show each entry's
 * bound key. One list for every platform; menus without `views` are always shown.
 */

export type MenuView = 'library' | 'develop';

/**
 * Entries that are no keybind action: the right-click menus' photo commands (`usePhotoCommands`) and the
 * App's handlers (`useMenuBar`'s `commands`).
 */
export type MenuCommand =
  | PhotoCommand
  | 'about'
  | 'backUpSettings'
  | 'blendPad'
  | 'deleteRejected'
  | 'displayCull'
  | 'displayList'
  | 'filmstrip'
  | 'keyboardShortcuts'
  | 'leftPanel'
  | 'lensGeometry'
  | 'newAlbum'
  | 'newFolder'
  | 'quit'
  | 'readXmp'
  | 'refreshView'
  | 'restoreSettings'
  | 'showInFinder'
  | 'showSubfolders'
  | 'taggingPanel'
  | 'zoneEditor';

/** Submenus built from the right-click menus' entries, because they list the user's editors and albums. */
export type MenuOptionSource = 'addToAlbum' | 'openIn';

/** OS-provided items (`PredefinedMenuItem`): text editing and the macOS app and window items. */
export type NativeMenuItem =
  | 'About'
  | 'BringAllToFront'
  | 'CloseWindow'
  | 'Copy'
  | 'Cut'
  | 'Fullscreen'
  | 'Hide'
  | 'HideOthers'
  | 'Maximize'
  | 'Minimize'
  | 'Paste'
  | 'Quit'
  | 'SelectAll'
  | 'Services'
  | 'ShowAll';

/**
 * The OS items the Windows and Linux bar offers itself (`useMenuBar`); the others (text editing, the
 * macOS app and window list items) are left out there, as those keys work in text fields anyway.
 */
export const IN_APP_NATIVE_ITEMS: ReadonlySet<NativeMenuItem> = new Set([
  'CloseWindow',
  'Fullscreen',
  'Maximize',
  'Minimize',
]);

type MenuEntryKind =
  | { kind: 'action'; action: string; label: string; labelOptions?: Record<string, unknown> }
  | { kind: 'command'; command: MenuCommand; label: string }
  | { kind: 'native'; item: NativeMenuItem }
  | { kind: 'options'; source: MenuOptionSource }
  | { kind: 'submenu'; label: string; entries: MenuEntry[] }
  | { kind: 'separator' };

/** `otherPlatformsOnly`: only in the Windows and Linux bar (what macOS keeps in its app menu). */
export type MenuEntry = MenuEntryKind & { otherPlatformsOnly?: boolean };

export interface MenuDefinition {
  id: string;
  label: string;
  views?: MenuView[];
  /** The macOS app menu (named after the app by the system). */
  isAppMenu?: boolean;
  /** Registered as the macOS Window or Help menu (window list, Help search). */
  role?: 'window' | 'help';
  entries: MenuEntry[];
}

const SEPARATOR: MenuEntry = { kind: 'separator' };
const action = (actionId: string, label: string, labelOptions?: Record<string, unknown>): MenuEntry => ({
  kind: 'action',
  action: actionId,
  label,
  labelOptions,
});
const command = (commandId: MenuCommand, label: string): MenuEntry => ({ kind: 'command', command: commandId, label });
const native = (item: NativeMenuItem): MenuEntry => ({ kind: 'native', item });
const options = (source: MenuOptionSource): MenuEntry => ({ kind: 'options', source });
const onOtherPlatforms = (...entries: MenuEntry[]): MenuEntry[] =>
  entries.map((entry) => ({ ...entry, otherPlatformsOnly: true }));
const submenu = (label: string, entries: MenuEntry[]): MenuEntry => ({ kind: 'submenu', label, entries });

const COLOR_LABEL_ACTIONS = ['red', 'yellow', 'green', 'blue', 'purple'] as const;

export const MENU_BAR: MenuDefinition[] = [
  {
    id: 'app',
    label: 'ThisIsRAW',
    isAppMenu: true,
    entries: [
      native('About'),
      SEPARATOR,
      action('open_settings', 'menuBar.items.settings'),
      SEPARATOR,
      native('Services'),
      SEPARATOR,
      native('Hide'),
      native('HideOthers'),
      native('ShowAll'),
      SEPARATOR,
      native('Quit'),
    ],
  },
  {
    id: 'file',
    label: 'menuBar.file',
    entries: [
      action('import_photos', 'menuBar.items.importPhotos'),
      action('toggle_export', 'menuBar.items.export'),
      SEPARATOR,
      options('openIn'),
      command('importLightroomEdits', 'menuBar.items.importLightroomEdits'),
      SEPARATOR,
      command('showInFinder', 'contextMenus.thumbnail.showExplorer'),
      command('newFolder', 'menuBar.items.newFolder'),
      command('refreshView', 'contextMenus.library.refreshView'),
      SEPARATOR,
      action('copy_files', 'menuBar.items.copyFiles'),
      action('paste_files', 'menuBar.items.pasteFiles'),
      action('copy_image_path', 'menuBar.items.copyImagePath'),
      SEPARATOR,
      command('backUpSettings', 'menuBar.items.backUpSettings'),
      command('restoreSettings', 'menuBar.items.restoreSettings'),
      ...onOtherPlatforms(SEPARATOR, command('quit', 'menuBar.items.exit')),
    ],
  },
  {
    id: 'edit',
    label: 'menuBar.edit',
    // The text items come before the photo items that share their keys (Cmd+C, Cmd+V, Cmd+A),
    // so the macOS menu gives those keys to a text field first.
    entries: [
      action('undo', 'contextMenus.editor.undo'),
      action('redo', 'contextMenus.editor.redo'),
      SEPARATOR,
      native('Cut'),
      native('Copy'),
      native('Paste'),
      native('SelectAll'),
      SEPARATOR,
      action('select_all', 'menuBar.items.selectAllPhotos'),
      action('deselect_all', 'menuBar.items.selectNone'),
      SEPARATOR,
      action('focus_search', 'menuBar.items.find'),
      ...onOtherPlatforms(SEPARATOR, action('open_settings', 'menuBar.items.settings')),
    ],
  },
  {
    id: 'library',
    label: 'menuBar.library',
    views: ['library'],
    entries: [
      action('show_library_grid', 'menuBar.items.grid'),
      command('displayCull', 'menuBar.items.cull'),
      command('displayList', 'menuBar.items.list'),
      SEPARATOR,
      command('showSubfolders', 'menuBar.items.showSubfolders'),
      action('toggle_metadata_filter', 'menuBar.items.filterBar'),
      action('toggle_library_exif', 'menuBar.items.exifOverlay'),
      SEPARATOR,
      submenu('contextMenus.thumbnail.stacking', [
        action('stack_selected', 'menuBar.items.stackSelected'),
        action('toggle_stack', 'ui.bottomBar.tooltips.toggleStack'),
        action('move_to_top_of_stack', 'contextMenus.thumbnail.moveToTopOfStack'),
        command('unstack', 'contextMenus.thumbnail.unstack'),
        SEPARATOR,
        command('autoStack', 'contextMenus.thumbnail.autoStackByCaptureTime'),
      ]),
      submenu('menuBar.items.albums', [
        options('addToAlbum'),
        command('removeFromAlbum', 'menuBar.items.removeFromAlbum'),
        SEPARATOR,
        command('newAlbum', 'menuBar.items.newAlbum'),
      ]),
      SEPARATOR,
      action('refine_photos', 'menuBar.items.refinePhotos'),
      action('rename_photos', 'menuBar.items.renamePhotos'),
    ],
  },
  {
    id: 'photo',
    label: 'menuBar.photo',
    views: ['library', 'develop'],
    entries: [
      action('open_image', 'menuBar.items.openInDevelop'),
      action('preview_prev', 'menuBar.items.previousPhoto'),
      action('preview_next', 'menuBar.items.nextPhoto'),
      SEPARATOR,
      action('rotate_left', 'menuBar.items.rotateLeft'),
      action('rotate_right', 'menuBar.items.rotateRight'),
      SEPARATOR,
      submenu('contextMenus.editor.rating', [
        action('rate_0', 'contextMenus.editor.noRating'),
        ...[1, 2, 3, 4, 5].map((count) => action(`rate_${count}`, 'contextMenus.editor.ratingLabel', { count })),
      ]),
      submenu('menuBar.items.flag', [
        action('flag_rejected', 'flags.rejected'),
        action('flag_selected', 'flags.selected'),
        action('flag_deferred', 'flags.deferred'),
        action('flag_unflagged', 'flags.unflagged'),
      ]),
      submenu('contextMenus.editor.colorLabel', [
        action('color_label_none', 'contextMenus.editor.noLabel'),
        ...COLOR_LABEL_ACTIONS.map((color) => action(`color_label_${color}`, `contextMenus.colors.${color}`)),
      ]),
      submenu('menuBar.items.keywords', [
        ...Array.from({ length: KEYWORD_SET_SIZE }, (_, index) =>
          action(`apply_keyword_${index + 1}`, 'menuBar.items.keyword', { number: index + 1 }),
        ),
        SEPARATOR,
        action('next_keyword_set', 'menuBar.items.nextKeywordSet'),
      ]),
      SEPARATOR,
      command('createVirtualCopy', 'menuBar.items.createVirtualCopy'),
      command('duplicateFile', 'menuBar.items.duplicateFile'),
      SEPARATOR,
      submenu('menuBar.items.photoMerge', [
        command('panorama', 'menuBar.items.panorama'),
        command('hdr', 'menuBar.items.hdr'),
      ]),
      command('collage', 'menuBar.items.collage'),
      command('cullSimilar', 'menuBar.items.cullSimilar'),
      submenu('menuBar.items.enhance', [
        command('denoise', 'menuBar.items.denoise'),
        submenu('adjustments.details.aiDenoise', [
          command('aiDenoiseOn', 'contextMenus.thumbnail.enable'),
          command('aiDenoiseOff', 'contextMenus.thumbnail.remove'),
        ]),
        submenu('contextMenus.editor.superResolution', [
          command('superResolutionOn', 'contextMenus.thumbnail.enable'),
          command('superResolutionOff', 'contextMenus.thumbnail.remove'),
        ]),
        SEPARATOR,
        command('convertNegative', 'menuBar.items.convertNegative'),
      ]),
      SEPARATOR,
      action('delete_selected', 'menuBar.items.deletePhoto'),
      command('deleteRejected', 'flags.deleteRejected'),
    ],
  },
  {
    id: 'metadata',
    label: 'menuBar.metadata',
    views: ['library'],
    entries: [
      action('toggle_metadata', 'menuBar.items.metadataPanel'),
      command('taggingPanel', 'menuBar.items.taggingPanel'),
      SEPARATOR,
      command('readXmp', 'menuBar.items.readXmp'),
    ],
  },
  {
    id: 'develop',
    label: 'menuBar.develop',
    views: ['develop'],
    entries: [
      action('copy_adjustments', 'contextMenus.editor.copyAdjustments'),
      action('paste_adjustments', 'contextMenus.editor.pasteAdjustments'),
      action('toggle_auto_sync', 'menuBar.items.autoSync'),
      action('reset_adjustments', 'contextMenus.editor.resetAdjustments'),
      SEPARATOR,
      command('applyPreset', 'menuBar.items.applyPreset'),
      command('autoAdjust', 'contextMenus.editor.autoAdjust'),
      command('autoLensCorrection', 'contextMenus.editor.autoLensCorrection'),
      command('upgradeLensCorrection', 'menuBar.items.upgradeLensCorrection'),
      SEPARATOR,
      action('show_original', 'menuBar.items.showOriginal'),
    ],
  },
  {
    id: 'tools',
    label: 'menuBar.tools',
    views: ['develop'],
    entries: [
      action('toggle_adjustments', 'menuBar.items.adjustments'),
      action('toggle_crop_panel', 'menuBar.items.crop'),
      action('toggle_crop', 'menuBar.items.straighten'),
      command('lensGeometry', 'editor.adjustments.sections.lensGeometry'),
      SEPARATOR,
      command('blendPad', 'editor.blendPad.title'),
      command('zoneEditor', 'editor.adjustments.sections.zoneTint'),
      SEPARATOR,
      action('toggle_masks', 'menuBar.items.masks'),
      action('toggle_mask_overlay', 'menuBar.items.maskOverlay'),
      action('toggle_ai', 'menuBar.items.ai'),
      action('toggle_presets', 'menuBar.items.presets'),
      SEPARATOR,
      action('brush_size_up', 'menuBar.items.brushSizeUp'),
      action('brush_size_down', 'menuBar.items.brushSizeDown'),
    ],
  },
  {
    id: 'view',
    label: 'menuBar.view',
    entries: [
      action('zoom_in', 'menuBar.items.zoomIn'),
      action('zoom_out', 'menuBar.items.zoomOut'),
      action('zoom_fit', 'menuBar.items.zoomFit'),
      action('zoom_100', 'menuBar.items.zoom100'),
      action('cycle_zoom', 'menuBar.items.cycleZoom'),
      SEPARATOR,
      action('toggle_fullscreen', 'menuBar.items.fullScreenPreview'),
      action('cycle_lights_out', 'menuBar.items.lightsOut'),
      action('cycle_lights_out_reverse', 'menuBar.items.lightsOutBack'),
      action('toggle_analytics', 'menuBar.items.analytics'),
    ],
  },
  {
    id: 'window',
    label: 'menuBar.window',
    role: 'window',
    entries: [
      action('show_library_grid', 'menuBar.items.libraryModule'),
      action('open_image', 'menuBar.items.developModule'),
      SEPARATOR,
      command('leftPanel', 'menuBar.items.leftPanel'),
      command('filmstrip', 'menuBar.items.filmstrip'),
      SEPARATOR,
      native('Minimize'),
      native('Maximize'),
      native('Fullscreen'),
      native('CloseWindow'),
      SEPARATOR,
      native('BringAllToFront'),
    ],
  },
  {
    id: 'help',
    label: 'menuBar.help',
    role: 'help',
    entries: [
      command('keyboardShortcuts', 'menuBar.items.keyboardShortcuts'),
      ...onOtherPlatforms(SEPARATOR, command('about', 'menuBar.items.about')),
    ],
  },
];

/** Drops entries the platform does not show, then separators left at an edge or next to another. */
const entriesForPlatform = (entries: MenuEntry[], isMac: boolean): MenuEntry[] => {
  const shown: MenuEntry[] = [];
  for (const entry of entries) {
    const isShown = isMac ? !entry.otherPlatformsOnly : entry.kind !== 'native' || IN_APP_NATIVE_ITEMS.has(entry.item);
    if (!isShown) continue;
    if (entry.kind === 'separator') {
      if (shown.length > 0 && shown[shown.length - 1].kind !== 'separator') shown.push(entry);
    } else {
      shown.push(entry.kind === 'submenu' ? { ...entry, entries: entriesForPlatform(entry.entries, isMac) } : entry);
    }
  }
  if (shown[shown.length - 1]?.kind === 'separator') shown.pop();
  return shown;
};

/** The menus of a view on a platform: macOS has its app menu; Windows and Linux move its entries. */
export const menusForView = (view: MenuView, osPlatform: string): MenuDefinition[] => {
  const isMac = osPlatform === 'macos';
  return MENU_BAR.filter((menu) => (!menu.views || menu.views.includes(view)) && (isMac || !menu.isAppMenu)).map(
    (menu) => ({ ...menu, entries: entriesForPlatform(menu.entries, isMac) }),
  );
};

const ACCELERATOR_MODIFIERS: Record<string, string> = { ctrl: 'CmdOrCtrl', shift: 'Shift', alt: 'Alt' };

/**
 * The menu accelerator for a keybind action, from the user's combo (`ctrl` is Cmd on macOS, as in
 * `normalizeCombo`, which also turns Cmd+Backspace into `Delete` there).
 */
export function getMenuAccelerator(
  actionId: string,
  keybinds: Record<string, string[]> | undefined,
  osPlatform: string,
): string | undefined {
  const definition = KEYBIND_DEFINITIONS.find((candidate) => candidate.action === actionId);
  if (!definition) return undefined;
  const combo = getEffectiveCombo(definition, keybinds);
  if (combo.length === 0) return undefined;
  const key = combo[combo.length - 1];
  const modifiers = combo.slice(0, -1).map((modifier) => ACCELERATOR_MODIFIERS[modifier] ?? modifier);
  if (osPlatform === 'macos' && key === 'Delete') return [...modifiers, 'CmdOrCtrl', 'Backspace'].join('+');
  return [...modifiers, key].join('+');
}
