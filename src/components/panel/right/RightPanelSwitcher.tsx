import { motion, LayoutGroup } from 'framer-motion';
import {
  SlidersHorizontal,
  Info,
  Crop,
  Layers,
  Paintbrush,
  SwatchBook,
  FileInput,
  Aperture,
  Tag,
  Orbit,
  Blend,
  type LucideIcon,
} from 'lucide-react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import type { ParseKeys } from 'i18next';
import { Panel } from '../../ui/AppProperties';
import { TOOLBAR_ROW } from '../editor/EditorToolbar';
import { useIsTitleBarShown } from '../../../window/TitleBar';

interface PanelOptions {
  icon: LucideIcon;
  id: Panel;
  title: string;
}

interface RightPanelSwitcherProps {
  activePanel: Panel | null;
  onPanelSelect(id: Panel): void;
  isInstantTransition: boolean;
}

/** Develop's tools: adjust and frame the photo, grade it, local work, then presets (owner's order). */
const editingPanelGroups: Array<Array<PanelOptions>> = [
  [
    { id: Panel.Adjustments, icon: SlidersHorizontal, title: 'editor.switcher.tooltips.adjust' },
    { id: Panel.Crop, icon: Crop, title: 'editor.switcher.tooltips.crop' },
    { id: Panel.LensGeometry, icon: Aperture, title: 'editor.adjustments.sections.lensGeometry' },
  ],
  [
    { id: Panel.BlendPad, icon: Orbit, title: 'editor.blendPad.title' },
    { id: Panel.ZoneTint, icon: Blend, title: 'editor.adjustments.sections.zoneTint' },
  ],
  [
    { id: Panel.Masks, icon: Layers, title: 'editor.switcher.tooltips.masks' },
    { id: Panel.Ai, icon: Paintbrush, title: 'editor.switcher.tooltips.inpaint' },
  ],
  [{ id: Panel.Presets, icon: SwatchBook, title: 'editor.switcher.tooltips.looks' }],
];

// Info, Tagging, and Export are top-bar switches; only without the top bar (Android) are they here.
const panelGroupsWithoutTopBar: Array<Array<PanelOptions>> = [
  [{ id: Panel.Metadata, icon: Info, title: 'editor.switcher.tooltips.info' }],
  ...editingPanelGroups,
  [
    { id: Panel.Tagging, icon: Tag, title: 'editor.switcher.tooltips.tagging' },
    { id: Panel.Export, icon: FileInput, title: 'editor.switcher.tooltips.export' },
  ],
];

/**
 * Develop's tool bar: one row of tool buttons that share its width evenly, groups set apart by a
 * line, so every tool fits even at the narrowest sidebar.
 */
export default function RightPanelSwitcher({
  activePanel,
  onPanelSelect,
  isInstantTransition,
}: RightPanelSwitcherProps) {
  const { t } = useTranslation();
  const panelGroups = useIsTitleBarShown() ? editingPanelGroups : panelGroupsWithoutTopBar;

  return (
    <LayoutGroup id="right-panel-switcher">
      <div className={clsx('flex items-center gap-0.5', TOOLBAR_ROW)}>
        {panelGroups.map((group, groupIndex) => (
          <div key={groupIndex} className="contents">
            {groupIndex > 0 && <div className="w-px h-6 shrink-0 bg-surface" />}
            {group.map(({ id, icon: Icon, title }) => (
              <button
                className={`relative flex-1 min-w-0 flex justify-center py-2 rounded-md transition-colors duration-200 ${
                  activePanel === id
                    ? 'text-text-primary'
                    : 'text-text-secondary hover:bg-surface hover:text-text-primary'
                }`}
                key={id}
                onClick={() => onPanelSelect(id)}
                data-tooltip={t(title as ParseKeys)}
              >
                {activePanel === id && (
                  <motion.div
                    layoutId="active-panel-indicator"
                    className="absolute inset-0 bg-surface rounded-md"
                    transition={isInstantTransition ? { duration: 0 } : { type: 'spring', bounce: 0.2, duration: 0.4 }}
                  />
                )}
                <Icon size={22} className="relative z-10 shrink-0" />
              </button>
            ))}
          </div>
        ))}
      </div>
    </LayoutGroup>
  );
}
