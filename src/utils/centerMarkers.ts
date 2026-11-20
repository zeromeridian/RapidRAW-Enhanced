import type { CollapsibleSectionsState } from '../components/ui/AppProperties';
import { Adjustments, DetailsAdjustment, Effect } from './adjustments';

/** A tool with a movable centre on the photo (upstream `b39884b3`). */
export type CenterMarker = 'vignette' | 'centre';

interface CenterMarkerConfig {
  /** The centre's adjustment keys, 0–1 in the cropped frame. */
  keys: [keyof Adjustments, keyof Adjustments];
  /** The Adjustments section the tool's sliders are in; the marker hides when it closes. */
  section: keyof CollapsibleSectionsState;
  /** The outline drawn at the effect's midpoint (0–100) as the shader shapes it. */
  getContour(adjustments: Adjustments): { midpoint: number; roundness: number };
}

export const CENTER_MARKERS: Record<CenterMarker, CenterMarkerConfig> = {
  vignette: {
    keys: [Effect.VignetteCenterX, Effect.VignetteCenterY],
    section: 'finish',
    getContour: (adjustments) => ({
      midpoint: adjustments.vignetteMidpoint ?? 50,
      roundness: adjustments.vignetteRoundness ?? 0,
    }),
  },
  // Centré has a fixed falloff in shader.wgsl (`centre_mask_at`: midpoint 0.4, circular).
  centre: {
    keys: [DetailsAdjustment.CentréX, DetailsAdjustment.CentréY],
    section: 'light',
    getContour: () => ({ midpoint: 40, roundness: 0 }),
  },
};

/** The attribute on a tool's sliders: pressing inside shows its marker, pressing elsewhere hides it. */
export const CENTER_MARKER_CONTROLS_ATTRIBUTE = 'data-center-marker-controls';
