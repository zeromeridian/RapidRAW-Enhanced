import { type MouseEvent, type PointerEvent, useCallback, useRef } from 'react';

/**
 * macOS turns Ctrl+click into a right-click, so a Ctrl+click or Ctrl-drag also opens a context
 * menu. Spread the returned handlers on the element: the menu of a Ctrl press is suppressed and
 * `onCtrlClick`, when given, runs instead (a click that may follow is skipped). Other platforms
 * send no context menu for Ctrl+click, so nothing changes there.
 */
export function useCtrlClickMenuGuard(onCtrlClick?: (e: MouseEvent) => void) {
  const isCtrlPressRef = useRef(false);
  const skipClickRef = useRef(false);
  const onCtrlClickRef = useRef(onCtrlClick);
  onCtrlClickRef.current = onCtrlClick;

  const onPointerDownCapture = useCallback((e: PointerEvent) => {
    isCtrlPressRef.current = e.button === 0 && e.ctrlKey;
    skipClickRef.current = false;
  }, []);

  const onContextMenuCapture = useCallback((e: MouseEvent) => {
    // The menu event must carry Ctrl too, so a keyboard-opened menu after a Ctrl+click still opens.
    if (!isCtrlPressRef.current || !e.ctrlKey) return;
    isCtrlPressRef.current = false;
    e.preventDefault();
    e.stopPropagation();
    if (onCtrlClickRef.current) {
      onCtrlClickRef.current(e);
      skipClickRef.current = true;
    }
  }, []);

  const onClickCapture = useCallback((e: MouseEvent) => {
    if (!skipClickRef.current) return;
    skipClickRef.current = false;
    e.stopPropagation();
  }, []);

  return { onPointerDownCapture, onContextMenuCapture, onClickCapture };
}
