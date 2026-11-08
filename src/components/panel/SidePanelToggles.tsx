import clsx from 'clsx';
import { FileInput, Info, SlidersHorizontal, Tag } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import { useEditorStore } from '../../store/useEditorStore';
import { useLibraryStore } from '../../store/useLibraryStore';
import { DEVELOP_PANEL_BY_LIBRARY_PANEL, getLibraryPanel, LibraryPanel, useUIStore } from '../../store/useUIStore';

type SidePanelToggle = LibraryPanel | 'develop';

const SIDE_PANEL_TOGGLES = [
  { id: 'metadata', Icon: Info, labelKey: 'editor.switcher.tooltips.info' },
  { id: 'tagging', Icon: Tag, labelKey: 'editor.switcher.tooltips.tagging' },
  { id: 'export', Icon: FileInput, labelKey: 'editor.switcher.tooltips.export' },
  { id: 'develop', Icon: SlidersHorizontal, labelKey: 'editor.switcher.tooltips.develop' },
] as const satisfies readonly { id: SidePanelToggle; Icon: typeof Info; labelKey: string }[];

/**
 * The top bar's labelled switches for the right sidebar, in Library and Develop; the shown panel's switch is
 * highlighted. In Develop, Info, Tagging, and Export show that panel for the photo being edited and Develop
 * returns to the last editing tool; in the Library, Develop opens the active photo like a double-click.
 */
export function SidePanelToggles({ isItemVisible }: { isItemVisible(id: string): boolean }) {
  const { t } = useTranslation();
  const isEditing = useEditorStore((state) => Boolean(state.selectedImage));
  const { libraryActivePath, hasSelection } = useLibraryStore(
    useShallow((state) => ({
      libraryActivePath: state.libraryActivePath,
      hasSelection: state.multiSelectedPaths.length > 0,
    })),
  );
  const { libraryPanel, activeRightPanel, lastEditingPanel, arePanelsHidden } = useUIStore(
    useShallow((state) => ({
      libraryPanel: getLibraryPanel(state, true),
      activeRightPanel: state.activeRightPanel,
      lastEditingPanel: state.lastEditingPanel,
      arePanelsHidden: state.isFullScreen,
    })),
  );

  const developPanelToggle = (Object.keys(DEVELOP_PANEL_BY_LIBRARY_PANEL) as LibraryPanel[]).find(
    (panel) => DEVELOP_PANEL_BY_LIBRARY_PANEL[panel] === activeRightPanel,
  );
  const shownToggle: SidePanelToggle | null = isEditing
    ? activeRightPanel && (developPanelToggle ?? 'develop')
    : libraryPanel;

  const select = (toggle: SidePanelToggle) => {
    const ui = useUIStore.getState();
    // While Develop's panels are hidden, a switch brings them back instead of closing the one it shows.
    if (arePanelsHidden) {
      ui.setUI({ isFullScreen: false });
      if (toggle === shownToggle) return;
    }
    if (toggle === 'develop') {
      if (isEditing) ui.setRightPanel(lastEditingPanel);
      else if (libraryActivePath) ui.imageSelectHandler?.(libraryActivePath);
    } else if (isEditing) {
      ui.setRightPanel(DEVELOP_PANEL_BY_LIBRARY_PANEL[toggle]);
    } else {
      ui.toggleLibraryPanel(toggle);
    }
  };

  const isDisabled = (toggle: SidePanelToggle) => {
    if (isEditing || toggle === shownToggle) return false;
    // In the Library, Export needs photos to export and Develop needs a photo to open.
    if (toggle === 'export') return !hasSelection;
    if (toggle === 'develop') return !libraryActivePath;
    return false;
  };

  const toggles = SIDE_PANEL_TOGGLES.filter(({ id }) => isItemVisible(id));
  if (toggles.length === 0) return null;

  return (
    <div className="flex items-center gap-1 bg-bg-primary p-1 rounded-lg">
      {toggles.map(({ id, Icon, labelKey }) => {
        const isShown = shownToggle === id;
        return (
          <button
            key={id}
            type="button"
            aria-pressed={isShown}
            disabled={isDisabled(id)}
            onClick={() => select(id)}
            className={clsx(
              'h-7 px-2.5 flex items-center gap-1.5 rounded-md text-xs font-semibold whitespace-nowrap transition-colors',
              'disabled:opacity-40 disabled:cursor-not-allowed',
              isShown
                ? 'bg-accent text-button-text shadow-xs'
                : 'text-text-primary hover:bg-surface disabled:hover:bg-transparent',
            )}
          >
            <Icon size={15} className="shrink-0" />
            {t(labelKey)}
          </button>
        );
      })}
    </div>
  );
}
