import { useRef } from 'react';
import clsx from 'clsx';
import { useContextMenu } from '../context/ContextMenuContext';
import type { MenuBarModel } from '../hooks/useMenuBar';

/** Gap between a menu title and its open list. */
const MENU_OFFSET = 4;

/**
 * The Windows and Linux menu bar (Plan item 69): the menus' titles in the title bar, each opening its
 * entries in the app's own menu (`ContextMenuContext`); while one is open, pointing at another title
 * switches to it, as in a native menu bar.
 */
export function MenuBarMenus({ menuBar }: { menuBar: MenuBarModel }) {
  const { showContextMenu, hideContextMenu, menuState, menuId } = useContextMenu();
  // The menu id `showContextMenu` gives the list it opens, and which title opened it.
  const openRef = useRef<{ menuId: number; titleId: string } | null>(null);
  const wasOpenOnPressRef = useRef(false);

  const opened = openRef.current;
  const openTitleId = opened && menuState.isVisible && opened.menuId === menuId ? opened.titleId : null;

  const open = (titleId: string, button: HTMLElement) => {
    const bounds = button.getBoundingClientRect();
    openRef.current = { menuId: menuId + 1, titleId };
    showContextMenu(bounds.left, bounds.bottom + MENU_OFFSET, menuBar.buildMenuOptions(titleId));
  };

  if (menuBar.menus.length === 0) return null;

  return (
    <div className="flex items-center h-full px-1 gap-0.5" role="menubar">
      {menuBar.menus.map((menu) => (
        <button
          key={menu.id}
          type="button"
          role="menuitem"
          aria-haspopup="menu"
          aria-expanded={openTitleId === menu.id}
          className={clsx(
            'h-7 px-2.5 rounded-md text-sm text-text-primary transition-colors',
            openTitleId === menu.id ? 'bg-surface' : 'hover:bg-surface',
          )}
          // A press on the open title closes its list (the menu closes on any press outside it), so
          // the click that follows must not open it again.
          onMouseDown={() => {
            wasOpenOnPressRef.current = openTitleId === menu.id;
          }}
          onClick={(event) => {
            if (wasOpenOnPressRef.current) hideContextMenu();
            else open(menu.id, event.currentTarget);
          }}
          onMouseEnter={(event) => {
            if (openTitleId && openTitleId !== menu.id) open(menu.id, event.currentTarget);
          }}
        >
          {menu.label}
        </button>
      ))}
    </div>
  );
}
