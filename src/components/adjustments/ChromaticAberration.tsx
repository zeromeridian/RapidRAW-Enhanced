import { EyeOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Adjustments, DetailsAdjustment, INITIAL_ADJUSTMENTS, isGroupVisible } from '../../utils/adjustments';
import AdjustmentSlider from './AdjustmentSlider';
import AdjustmentTool from './AdjustmentTool';

export const CHROMATIC_ABERRATION_TOOL = 'chromaticAberration';

interface ChromaticAberrationProps {
  adjustments: Partial<Adjustments>;
  setAdjustments(updater: (previous: Partial<Adjustments>) => Partial<Adjustments>): void;
  onDragStateChange?: (isDragging: boolean) => void;
}

/**
 * The manual Red/Cyan and Blue/Yellow sliders, in Lens & Geometry and as a favourite. An edit made
 * before `1.69.0` with the Details eye off keeps them off; an eye shows that and turns them on.
 */
export default function ChromaticAberration({
  adjustments,
  setAdjustments,
  onDragStateChange,
}: ChromaticAberrationProps) {
  const { t } = useTranslation();
  const isVisible = isGroupVisible(adjustments.sectionVisibility, CHROMATIC_ABERRATION_TOOL);
  const sliderProps = { adjustments, setAdjustments, onDragStateChange };
  const showAgain = () =>
    setAdjustments((previous) => ({
      ...previous,
      sectionVisibility: {
        ...(previous.sectionVisibility ?? INITIAL_ADJUSTMENTS.sectionVisibility),
        [CHROMATIC_ABERRATION_TOOL]: true,
      },
    }));

  return (
    <AdjustmentTool
      id={CHROMATIC_ABERRATION_TOOL}
      actions={
        !isVisible && (
          <button
            className="p-1 rounded-full text-accent hover:bg-bg-primary"
            onClick={showAgain}
            data-tooltip={t('ui.collapsibleSection.enableSection')}
          >
            <EyeOff size={16} />
          </button>
        )
      }
    >
      <div className={isVisible ? undefined : 'opacity-30'}>
        <AdjustmentSlider control={DetailsAdjustment.ChromaticAberrationRedCyan} {...sliderProps} />
        <AdjustmentSlider control={DetailsAdjustment.ChromaticAberrationBlueYellow} {...sliderProps} />
      </div>
    </AdjustmentTool>
  );
}
