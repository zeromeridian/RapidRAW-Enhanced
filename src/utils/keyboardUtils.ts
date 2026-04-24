export function normalizeCombo(event: KeyboardEvent): string[] {
  const parts: string[] = [];
  if (event.ctrlKey || event.metaKey) parts.push('ctrl');
  if (event.shiftKey) parts.push('shift');
  if (event.altKey) parts.push('alt');
  const code = event.code;
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
  return symMap[code] ?? null;
}

export const ACCEPTED_KEY_CODES = new Set([
  'Space', 'Enter', 'Tab', 'Backspace', 'Delete', 'Escape', 'Insert',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'PageUp', 'PageDown', 'Home', 'End',
  'BracketLeft', 'BracketRight',
  'Comma', 'Period', 'Slash', 'Semicolon', 'Quote', 'Backquote', 'Minus', 'Equal', 'Backslash',
  'Numpad0', 'Numpad1', 'Numpad2', 'Numpad3', 'Numpad4',
  'Numpad5', 'Numpad6', 'Numpad7', 'Numpad8', 'Numpad9',
  'NumpadAdd', 'NumpadMultiply', 'NumpadDivide', 'NumpadSubtract',
  'NumpadDecimal', 'NumpadComma', 'NumpadEnter', 'NumpadEqual',
  'CapsLock', 'PrintScreen',
]);

export function isValidShortcutKey(code: string): boolean {
  if (code.startsWith('Key') || code.startsWith('Digit')) return true;
  if (code.startsWith('F') && /^\d+$/.test(code.slice(1))) return true;
  return ACCEPTED_KEY_CODES.has(code);
}
