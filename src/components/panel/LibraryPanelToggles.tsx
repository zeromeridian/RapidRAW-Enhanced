import clsx from 'clsx';
import { FileInput, Info, Tag } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import { useLibraryStore } from '../../store/useLibraryStore';
import { getLibraryPanel, LibraryPanel, useUIStore } from '../../store/useUIStore';

const PANEL_TOGGLES = [
  { panel: 'metadata', Icon: Info, labelKey: 'editor.metadata.title' },
  { panel: 'tagging', Icon: Tag, labelKey: 'editor.tagging.title' },
  { panel: 'export', Icon: FileInput, labelKey: 'ui.bottomBar.tooltips.export' },
] as const satisfies readonly { panel: LibraryPanel; Icon: typeof Info; labelKey: string }[];

/** Labelled switches for the Library grid's right panels; the shown panel's switch is highlighted. */
export function LibraryPanelToggles({ isItemVisible }: { isItemVisible(id: string): boolean }) {
  const { t } = useTranslation();
  const { shownPanel, toggleLibraryPanel } = useUIStore(
    useShallow((state) => ({
      shownPanel: getLibraryPanel(state, true),
      toggleLibraryPanel: state.toggleLibraryPanel,
    })),
  );
  const hasSelection = useLibraryStore((state) => state.multiSelectedPaths.length > 0);
  const toggles = PANEL_TOGGLES.filter(({ panel }) => isItemVisible(panel));
  if (toggles.length === 0) return null;

  return (
    <div className="flex items-center gap-1 bg-bg-primary p-1 rounded-lg">
      {toggles.map(({ panel, Icon, labelKey }) => {
        const isShown = shownPanel === panel;
        return (
          <button
            key={panel}
            type="button"
            aria-pressed={isShown}
            // Export needs photos to export, but an open Export panel can always be closed.
            disabled={panel === 'export' && !hasSelection && !isShown}
            onClick={() => toggleLibraryPanel(panel)}
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
