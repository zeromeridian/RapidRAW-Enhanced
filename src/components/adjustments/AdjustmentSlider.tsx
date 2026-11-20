import { useTranslation } from 'react-i18next';
import type { ParseKeys } from 'i18next';
import Slider, { SliderChangeEvent, SliderProps } from '../ui/Slider';
import { Adjustments, INITIAL_ADJUSTMENTS } from '../../utils/adjustments';
import { ADJUSTMENT_CONTROLS_BY_ID, favoriteKey, getControlSpeedEditId } from '../../utils/adjustmentControls';
import { FAVORITE_DATA_ATTRIBUTE, FavoriteStar } from './AdjustmentTool';
import { useBlendPadParameters } from '../../hooks/useBlendPadParameters';
import { blendPadValue } from '../../utils/blendPad';
import { canvasToolState, useEditorStore } from '../../store/useEditorStore';
import { CENTER_MARKER_CONTROLS_ATTRIBUTE } from '../../utils/centerMarkers';

interface AdjustmentSliderProps extends Partial<SliderProps> {
  adjustments: Partial<Adjustments>;
  /** An `ADJUSTMENT_CONTROLS` id, the adjustment key it sets. */
  control: string;
  isForMask?: boolean;
  setAdjustments(updater: (prev: Partial<Adjustments>) => Partial<Adjustments>): void;
}

/** A slider for one adjustment value, defined once in `ADJUSTMENT_CONTROLS` (also used by Favorites). */
export default function AdjustmentSlider({
  adjustments,
  control,
  isForMask = false,
  setAdjustments,
  ...overrides
}: AdjustmentSliderProps) {
  const { t } = useTranslation();
  const setEditor = useEditorStore((state) => state.setEditor);
  const blendPadParameters = useBlendPadParameters();
  const definition = ADJUSTMENT_CONTROLS_BY_ID[control];
  const parse = (value: string) => (definition.step < 1 ? parseFloat(value) : parseInt(value, 10));
  const favorite = favoriteKey('control', control);
  const value = (adjustments[control as keyof Adjustments] as number | undefined) ?? definition.defaultValue ?? 0;
  // The photo's sliders mark where the Orbit Blend Pad moves them; masks have no pad.
  const ghostValue = isForMask ? undefined : blendPadValue(adjustments.blendPad, blendPadParameters, control, value);
  // A reset also puts back what belongs to the slider (a tool's centre); masks have no such keys.
  const linkedKeys = isForMask ? undefined : definition.resetsWith;
  const handleReset = linkedKeys
    ? () =>
        setAdjustments((prev: Partial<Adjustments>) => ({
          ...prev,
          [control]: definition.defaultValue ?? 0,
          ...Object.fromEntries(linkedKeys.map((key) => [key, INITIAL_ADJUSTMENTS[key]])),
        }))
    : undefined;

  // Pressing a slider of a tool with a movable centre shows that centre on the photo.
  const centerMarker = isForMask ? undefined : definition.centerMarker;
  const centerMarkerProps = centerMarker
    ? {
        [CENTER_MARKER_CONTROLS_ATTRIBUTE]: centerMarker,
        onPointerDown: () => setEditor(canvasToolState({ activeCenterMarker: centerMarker })),
      }
    : {};

  return (
    <div {...{ [FAVORITE_DATA_ATTRIBUTE]: favorite }} {...centerMarkerProps}>
      <Slider
        defaultValue={definition.defaultValue}
        fillOrigin={definition.fillOrigin}
        label={t(definition.label as ParseKeys)}
        labelAddon={<FavoriteStar favorite={favorite} />}
        max={definition.max}
        min={isForMask ? (definition.maskMin ?? definition.min) : definition.min}
        onChange={(e: SliderChangeEvent) =>
          setAdjustments((prev: Partial<Adjustments>) => ({ ...prev, [control]: parse(String(e.target.value)) }))
        }
        onReset={handleReset}
        speedEditId={getControlSpeedEditId(control)}
        step={definition.step}
        trackClassName={definition.trackClassName}
        value={value}
        ghostValue={ghostValue}
        {...overrides}
      />
    </div>
  );
}
