import { ComponentType, useContext, useMemo } from 'react';
import BasicAdjustments from './Basic';
import CurveGraph from './Curves';
import ColorPanel from './Color';
import DetailsPanel from './Details';
import EffectsPanel from './Effects';
import ProfilePanel from './Profile';
import { AdjustmentPanelContext } from './AdjustmentTool';
import {
  ADJUSTMENT_SECTION_TOOLS,
  SectionVisibility,
  getHiddenSectionGroups,
  getSectionEye,
} from '../../utils/adjustments';

/** The section components take the panel's props (photo or mask) and pass them on unchanged. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- each source declares its own props
type SectionComponent = ComponentType<any>;

interface AdjustmentSectionProps {
  adjustments?: { sectionVisibility?: SectionVisibility };
  [prop: string]: unknown;
}

/**
 * The components that hold each section's tool blocks. A section shows only its own blocks of
 * them, in one column, so Customize Panels can order blocks that come from different components.
 */
const SECTION_SOURCES: Record<string, Array<SectionComponent>> = {
  light: [ProfilePanel, ColorPanel, BasicAdjustments, DetailsPanel],
  curves: [CurveGraph],
  color: [ColorPanel],
  look: [ColorPanel, EffectsPanel],
  lightAtmosphere: [EffectsPanel],
  blur: [EffectsPanel],
  detail: [DetailsPanel],
  finish: [EffectsPanel],
};

function createSectionComponent(section: string): SectionComponent {
  const sources = SECTION_SOURCES[section];
  const sectionTools: ReadonlyArray<string> = (ADJUSTMENT_SECTION_TOOLS[section] ?? []).map((tool) => tool.id);

  function AdjustmentSection(props: AdjustmentSectionProps) {
    const parent = useContext(AdjustmentPanelContext);
    const visibility = props.adjustments?.sectionVisibility;
    const context = useMemo(
      () => ({
        ...parent,
        // A Favorites tool narrows the section down to that one block.
        tools: parent.tools ? sectionTools.filter((id) => parent.tools?.includes(id)) : sectionTools,
        // An older edit can have only some of a section's tools switched off: those show dimmed.
        hiddenTools:
          getSectionEye(visibility, section) === 'partial' ? getHiddenSectionGroups(visibility, section) : undefined,
      }),
      [parent, visibility],
    );

    return (
      <AdjustmentPanelContext.Provider value={context}>
        <div className="flex flex-col gap-4 compact:gap-2">
          {sources.map((Source, index) => (
            <Source key={index} {...props} />
          ))}
        </div>
      </AdjustmentPanelContext.Provider>
    );
  }
  AdjustmentSection.displayName = `AdjustmentSection(${section})`;
  return AdjustmentSection;
}

/** The component that renders each adjustment section, shared by the photo's and the masks' panels. */
export const ADJUSTMENT_SECTION_COMPONENTS: Record<string, SectionComponent> = Object.fromEntries(
  Object.keys(SECTION_SOURCES).map((section) => [section, createSectionComponent(section)]),
);
