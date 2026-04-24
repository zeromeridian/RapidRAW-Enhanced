export interface KeybindingDefinition {
  actionKey: string;
  description: string;
  defaultCombo: string[];
  section: 'library' | 'view' | 'rating' | 'panels' | 'editing';
}

export interface KeybindingSection {
  id: KeybindingDefinition['section'];
  label: string;
}

export const KEYBINDING_SECTIONS: KeybindingSection[] = [
  { id: 'library', label: 'Library' },
  { id: 'editing', label: 'Editing' },
  { id: 'view', label: 'View' },
  { id: 'rating', label: 'Rating & Labels' },
  { id: 'panels', label: 'Panels' },
];

export const KEYBINDING_DEFINITIONS: KeybindingDefinition[] = [
  { actionKey: 'open_image', description: 'Open selected image', defaultCombo: ['Enter'], section: 'library' },
  { actionKey: 'copy_files', description: 'Copy selected file(s)', defaultCombo: ['ctrl', 'shift', 'KeyC'], section: 'library' },
  { actionKey: 'paste_files', description: 'Paste file(s) to current folder', defaultCombo: ['ctrl', 'shift', 'KeyV'], section: 'library' },
  { actionKey: 'select_all', description: 'Select all images', defaultCombo: ['ctrl', 'KeyA'], section: 'library' },
  { actionKey: 'delete_selected', description: 'Delete selected file(s)', defaultCombo: ['Delete'], section: 'library' },
  { actionKey: 'preview_prev', description: 'Previous image', defaultCombo: ['ArrowLeft'], section: 'library' },
  { actionKey: 'preview_next', description: 'Next image', defaultCombo: ['ArrowRight'], section: 'library' },
  { actionKey: 'zoom_in_step', description: 'Zoom in (by step)', defaultCombo: ['ArrowUp'], section: 'view' },
  { actionKey: 'zoom_out_step', description: 'Zoom out (by step)', defaultCombo: ['ArrowDown'], section: 'view' },
  { actionKey: 'cycle_zoom', description: 'Cycle zoom (Fit, 2x Fit, 100%)', defaultCombo: ['Space'], section: 'view' },
  { actionKey: 'zoom_in', description: 'Zoom in', defaultCombo: ['ctrl', 'Equal'], section: 'view' },
  { actionKey: 'zoom_out', description: 'Zoom out', defaultCombo: ['ctrl', 'Minus'], section: 'view' },
  { actionKey: 'zoom_fit', description: 'Zoom to fit', defaultCombo: ['ctrl', 'Digit0'], section: 'view' },
  { actionKey: 'zoom_100', description: 'Zoom to 100%', defaultCombo: ['ctrl', 'Digit1'], section: 'view' },
  { actionKey: 'toggle_fullscreen', description: 'Toggle fullscreen', defaultCombo: ['KeyF'], section: 'view' },
  { actionKey: 'show_original', description: 'Show original (before/after)', defaultCombo: ['KeyB'], section: 'view' },
  { actionKey: 'rate_0', description: 'Star rating: 0', defaultCombo: ['Digit0'], section: 'rating' },
  { actionKey: 'rate_1', description: 'Star rating: 1', defaultCombo: ['Digit1'], section: 'rating' },
  { actionKey: 'rate_2', description: 'Star rating: 2', defaultCombo: ['Digit2'], section: 'rating' },
  { actionKey: 'rate_3', description: 'Star rating: 3', defaultCombo: ['Digit3'], section: 'rating' },
  { actionKey: 'rate_4', description: 'Star rating: 4', defaultCombo: ['Digit4'], section: 'rating' },
  { actionKey: 'rate_5', description: 'Star rating: 5', defaultCombo: ['Digit5'], section: 'rating' },
  { actionKey: 'color_label_none', description: 'Color label: None', defaultCombo: ['shift', 'Digit0'], section: 'rating' },
  { actionKey: 'color_label_red', description: 'Color label: Red', defaultCombo: ['shift', 'Digit1'], section: 'rating' },
  { actionKey: 'color_label_yellow', description: 'Color label: Yellow', defaultCombo: ['shift', 'Digit2'], section: 'rating' },
  { actionKey: 'color_label_green', description: 'Color label: Green', defaultCombo: ['shift', 'Digit3'], section: 'rating' },
  { actionKey: 'color_label_blue', description: 'Color label: Blue', defaultCombo: ['shift', 'Digit4'], section: 'rating' },
  { actionKey: 'color_label_purple', description: 'Color label: Purple', defaultCombo: ['shift', 'Digit5'], section: 'rating' },
  { actionKey: 'toggle_adjustments', description: 'Toggle Adjustments panel', defaultCombo: ['KeyD'], section: 'panels' },
  { actionKey: 'toggle_crop_panel', description: 'Toggle Crop panel', defaultCombo: ['KeyR'], section: 'panels' },
  { actionKey: 'toggle_masks', description: 'Toggle Masks panel', defaultCombo: ['KeyM'], section: 'panels' },
  { actionKey: 'toggle_ai', description: 'Toggle AI panel', defaultCombo: ['KeyK'], section: 'panels' },
  { actionKey: 'toggle_presets', description: 'Toggle Presets panel', defaultCombo: ['KeyP'], section: 'panels' },
  { actionKey: 'toggle_metadata', description: 'Toggle Metadata panel', defaultCombo: ['KeyI'], section: 'panels' },
  { actionKey: 'toggle_analytics', description: 'Toggle Analytics display', defaultCombo: ['KeyA'], section: 'panels' },
  { actionKey: 'toggle_export', description: 'Toggle Export panel', defaultCombo: ['KeyE'], section: 'panels' },
  { actionKey: 'undo', description: 'Undo adjustment', defaultCombo: ['ctrl', 'KeyZ'], section: 'editing' },
  { actionKey: 'redo', description: 'Redo adjustment', defaultCombo: ['ctrl', 'KeyY'], section: 'editing' },
  { actionKey: 'copy_adjustments', description: 'Copy selected adjustments', defaultCombo: ['ctrl', 'KeyC'], section: 'editing' },
  { actionKey: 'paste_adjustments', description: 'Paste copied adjustments', defaultCombo: ['ctrl', 'KeyV'], section: 'editing' },
  { actionKey: 'rotate_left', description: 'Rotate 90° counter-clockwise', defaultCombo: ['BracketLeft'], section: 'editing' },
  { actionKey: 'rotate_right', description: 'Rotate 90° clockwise', defaultCombo: ['BracketRight'], section: 'editing' },
  { actionKey: 'toggle_crop', description: 'Toggle Crop / Straighten', defaultCombo: ['KeyS'], section: 'editing' },
  { actionKey: 'brush_size_up', description: 'Increase brush size', defaultCombo: ['ctrl', 'ArrowUp'], section: 'editing' },
  { actionKey: 'brush_size_down', description: 'Decrease brush size', defaultCombo: ['ctrl', 'ArrowDown'], section: 'editing' },
];

const symMap: Record<string, string> = {
  Space: 'Space',
  Backspace: '⌫',
  Enter: 'Enter',
  Delete: 'Delete',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  BracketLeft: '[',
  BracketRight: ']',
  Minus: '-',
  Equal: '+',
  Comma: ',',
  Period: '.',
  Slash: '/',
  Semicolon: ';',
  Quote: "'",
  Backquote: '`',
  Backslash: '\\',
  Tab: 'Tab',
  Escape: 'Esc',
  PageUp: 'Page Up',
  PageDown: 'Page Down',
  Home: 'Home',
  End: 'End',
  Insert: 'Insert',
  NumpadAdd: 'Numpad +',
  NumpadMultiply: 'Numpad *',
  NumpadDivide: 'Numpad /',
  NumpadSubtract: 'Numpad -',
  NumpadDecimal: 'Numpad .',
  NumpadComma: 'Numpad ,',
  NumpadEnter: 'Numpad Enter',
  NumpadEqual: 'Numpad =',
  CapsLock: 'Caps Lock',
  PrintScreen: 'PrtSc',
};

export function normalizeCombo(event: KeyboardEvent, osPlatform?: string): string[] {
  const isMacDelete = osPlatform === 'macos' && event.code === 'Backspace' && (event.ctrlKey || event.metaKey);
  const parts: string[] = [];
  if ((event.ctrlKey || event.metaKey) && !isMacDelete) parts.push('ctrl');
  if (event.shiftKey) parts.push('shift');
  if (event.altKey) parts.push('alt');
  const code = isMacDelete ? 'Delete' : event.code;
  if (isValidShortcutKey(code)) {
    parts.push(code);
  }
  return parts;
}

export function codeToDisplayLabel(code: string): string | null {
  if (/^Key[A-Z]$/.test(code) || /^Digit[0-9]$/.test(code)) {
    return code[code.length - 1].toUpperCase();
  }
  if (/^Numpad[0-9]$/.test(code)) {
    return `Numpad ${code.slice(-1)}`;
  }
  return symMap[code] ?? null;
}

export function isValidShortcutKey(code: string): boolean {
  if (code.startsWith('Key') || code.startsWith('Digit')) return true;
  if (code.startsWith('F') && /^\d+$/.test(code.slice(1))) return true;
  if (/^Numpad[0-9]$/.test(code)) return true;
  return code in symMap;
}

export function formatKeyCode(key: string, osPlatform: string): string {
  if (key === 'ctrl') return osPlatform === 'macos' ? '⌘' : 'Ctrl';
  if (key === 'shift') return 'Shift';
  if (key === 'alt') return osPlatform === 'macos' ? '⌥' : 'Alt';
  if (key === 'Delete' && osPlatform === 'macos') return 'Delete / ⌘+⌫';
  const label = codeToDisplayLabel(key);
  return label || key;
}

export function arraysEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}
