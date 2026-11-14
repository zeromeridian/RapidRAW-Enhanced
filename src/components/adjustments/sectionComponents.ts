import { ComponentType } from 'react';
import BasicAdjustments from './Basic';
import CurveGraph from './Curves';
import ColorPanel from './Color';
import DetailsPanel from './Details';
import EffectsPanel from './Effects';
import ZoneTintPanel from './ZoneTint';

/** The component that renders each adjustment section, shared by the photo's and the masks' panels. */
export const ADJUSTMENT_SECTION_COMPONENTS: Record<string, ComponentType<any>> = {
  basic: BasicAdjustments,
  curves: CurveGraph,
  color: ColorPanel,
  details: DetailsPanel,
  effects: EffectsPanel,
  zoneTint: ZoneTintPanel,
};
