import { useTranslation } from 'react-i18next';
import Slider, { SliderChangeEvent } from '../ui/Slider';
import { Adjustments, DetailsAdjustment } from '../../utils/adjustments';
import { AppSettings } from '../ui/AppProperties';
import AiEffectSection from './AiEffectSection';
import AdjustmentSlider from './AdjustmentSlider';
import AdjustmentTool from './AdjustmentTool';
import { useEditorStore } from '../../store/useEditorStore';

interface DetailsPanelProps {
  adjustments: Adjustments;
  setAdjustments(adjustments: Partial<Adjustments>): any;
  appSettings: AppSettings | null;
  isForMask?: boolean;
  onDragStateChange?: (isDragging: boolean) => void;
}

export default function DetailsPanel({
  adjustments,
  setAdjustments,
  appSettings,
  isForMask = false,
  onDragStateChange,
}: DetailsPanelProps) {
  const { t } = useTranslation();
  const aiDenoiseProgress = useEditorStore((state) =>
    state.selectedImage ? state.aiDenoiseProgress[state.selectedImage.path] : undefined,
  );

  const handleAdjustmentChange = (key: string, value: string) => {
    const numericValue = parseInt(value, 10);
    setAdjustments((prev: Partial<Adjustments>) => ({ ...prev, [key]: numericValue }));
  };

  const sliderProps = { adjustments, setAdjustments, isForMask, onDragStateChange };
  const adjustmentVisibility = appSettings?.adjustmentVisibility || {};

  return (
    <div className="flex flex-col gap-4 compact:gap-2">
      {adjustmentVisibility.sharpening !== false && (
        <AdjustmentTool id="sharpening">
          <AdjustmentSlider control={DetailsAdjustment.Sharpness} {...sliderProps} />
          <AdjustmentSlider control={DetailsAdjustment.SharpnessThreshold} {...sliderProps} />
        </AdjustmentTool>
      )}

      {adjustmentVisibility.presence !== false && (
        <AdjustmentTool id="presence">
          <AdjustmentSlider control={DetailsAdjustment.Clarity} {...sliderProps} />
          <AdjustmentSlider control={DetailsAdjustment.Dehaze} {...sliderProps} />
          <AdjustmentSlider control={DetailsAdjustment.Structure} {...sliderProps} />
          {!isForMask && <AdjustmentSlider control={DetailsAdjustment.Centré} {...sliderProps} />}
        </AdjustmentTool>
      )}

      {adjustmentVisibility.noiseReduction !== false && (
        <AdjustmentTool id="noiseReduction">
          <AdjustmentSlider control={DetailsAdjustment.LumaNoiseReduction} {...sliderProps} />
          <AdjustmentSlider control={DetailsAdjustment.ColorNoiseReduction} {...sliderProps} />
        </AdjustmentTool>
      )}

      {!isForMask && adjustmentVisibility.noiseReduction !== false && (
        <AiEffectSection
          toolId="aiDenoise"
          title={t('adjustments.details.aiDenoise')}
          enabled={!!adjustments.aiDenoiseEnabled}
          onEnabledChange={(enabled: boolean) =>
            setAdjustments((prev: Partial<Adjustments>) => ({ ...prev, aiDenoiseEnabled: enabled }))
          }
          isGenerating={aiDenoiseProgress !== undefined}
          generatingLabel={t('editor.ai.denoising')}
          generationProgress={aiDenoiseProgress}
        >
          <Slider
            label={t('adjustments.effects.amount')}
            max={100}
            min={0}
            defaultValue={100}
            onChange={(e: SliderChangeEvent) =>
              handleAdjustmentChange(DetailsAdjustment.AiDenoiseAmount, String(e.target.value))
            }
            step={1}
            value={adjustments.aiDenoiseAmount ?? 100}
            onDragStateChange={onDragStateChange}
            fillOrigin="min"
          />
          <Slider
            label={t('adjustments.details.aiDenoiseDetail')}
            max={100}
            min={0}
            onChange={(e: SliderChangeEvent) =>
              handleAdjustmentChange(DetailsAdjustment.AiDenoiseDetail, String(e.target.value))
            }
            step={1}
            value={adjustments.aiDenoiseDetail ?? 0}
            onDragStateChange={onDragStateChange}
          />
        </AiEffectSection>
      )}

      {!isForMask && adjustmentVisibility.chromaticAberration !== false && (
        <AdjustmentTool id="chromaticAberration">
          <AdjustmentSlider control={DetailsAdjustment.ChromaticAberrationRedCyan} {...sliderProps} />
          <AdjustmentSlider control={DetailsAdjustment.ChromaticAberrationBlueYellow} {...sliderProps} />
        </AdjustmentTool>
      )}
    </div>
  );
}
