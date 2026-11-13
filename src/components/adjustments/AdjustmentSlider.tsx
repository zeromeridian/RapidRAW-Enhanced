import { useTranslation } from 'react-i18next';
import type { ParseKeys } from 'i18next';
import Slider, { SliderChangeEvent, SliderProps } from '../ui/Slider';
import { Adjustments } from '../../utils/adjustments';
import { ADJUSTMENT_CONTROLS_BY_ID, favoriteKey, getControlSpeedEditId } from '../../utils/adjustmentControls';
import { FAVORITE_DATA_ATTRIBUTE, FavoriteStar } from './AdjustmentTool';
import { useBlendPadParameters } from '../../hooks/useBlendPadParameters';
import { blendPadValue } from '../../utils/blendPad';

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
  const blendPadParameters = useBlendPadParameters();
  const definition = ADJUSTMENT_CONTROLS_BY_ID[control];
  const parse = (value: string) => (definition.step < 1 ? parseFloat(value) : parseInt(value, 10));
  const favorite = favoriteKey('control', control);
  const value = (adjustments[control as keyof Adjustments] as number | undefined) ?? definition.defaultValue ?? 0;
  // The photo's sliders mark where the Orbit Blend Pad moves them; masks have no pad.
  const ghostValue = isForMask ? undefined : blendPadValue(adjustments.blendPad, blendPadParameters, control, value);

  return (
    <div {...{ [FAVORITE_DATA_ATTRIBUTE]: favorite }}>
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
