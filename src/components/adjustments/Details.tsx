import { useTranslation } from 'react-i18next';
import Slider, { SliderChangeEvent } from '../ui/Slider';
import { Adjustments, DetailsAdjustment } from '../../utils/adjustments';
import { AppSettings } from '../ui/AppProperties';
import Text from '../ui/Text';
import { TextVariants } from '../../types/typography';
import AiEffectSection from './AiEffectSection';
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

  const adjustmentVisibility = appSettings?.adjustmentVisibility || {};

  return (
    <div className="space-y-4 compact:space-y-2">
      {adjustmentVisibility.sharpening !== false && (
        <div className="p-2 compact:p-1.5 bg-bg-tertiary rounded-md">
          <Text variant={TextVariants.heading} className="mb-2 compact:mb-1 compact:text-sm">
            {t('adjustments.details.sharpening')}
          </Text>
          <Slider
            label={t('adjustments.details.sharpness')}
            max={100}
            min={-100}
            onChange={(e: any) => handleAdjustmentChange(DetailsAdjustment.Sharpness, e.target.value)}
            step={1}
            value={adjustments.sharpness}
            onDragStateChange={onDragStateChange}
          />
          <Slider
            label={t('adjustments.details.threshold')}
            max={80}
            min={0}
            onChange={(e: any) => handleAdjustmentChange(DetailsAdjustment.SharpnessThreshold, e.target.value)}
            step={1}
            value={adjustments.sharpnessThreshold ?? 15}
            onDragStateChange={onDragStateChange}
            defaultValue={15}
            fillOrigin="min"
          />
        </div>
      )}

      {adjustmentVisibility.presence !== false && (
        <div className="p-2 compact:p-1.5 bg-bg-tertiary rounded-md">
          <Text variant={TextVariants.heading} className="mb-2 compact:mb-1 compact:text-sm">
            {t('adjustments.details.presence')}
          </Text>
          <Slider
            label={t('adjustments.details.clarity')}
            max={100}
            min={-100}
            onChange={(e: any) => handleAdjustmentChange(DetailsAdjustment.Clarity, e.target.value)}
            step={1}
            value={adjustments.clarity}
            onDragStateChange={onDragStateChange}
          />
          <Slider
            label={t('adjustments.details.dehaze')}
            max={100}
            min={-100}
            onChange={(e: any) => handleAdjustmentChange(DetailsAdjustment.Dehaze, e.target.value)}
            step={1}
            value={adjustments.dehaze}
            onDragStateChange={onDragStateChange}
          />
          <Slider
            label={t('adjustments.details.structure')}
            max={100}
            min={-100}
            onChange={(e: any) => handleAdjustmentChange(DetailsAdjustment.Structure, e.target.value)}
            step={1}
            value={adjustments.structure}
            onDragStateChange={onDragStateChange}
          />
          {!isForMask && (
            <Slider
              label={t('adjustments.details.centre')}
              max={100}
              min={-100}
              onChange={(e: any) => handleAdjustmentChange(DetailsAdjustment.Centré, e.target.value)}
              step={1}
              value={adjustments.centré}
              onDragStateChange={onDragStateChange}
            />
          )}
        </div>
      )}

      {adjustmentVisibility.noiseReduction !== false && (
        <div className="p-2 compact:p-1.5 bg-bg-tertiary rounded-md">
          <Text variant={TextVariants.heading} className="mb-2 compact:mb-1 compact:text-sm">
            {t('adjustments.details.noiseReduction')}
          </Text>
          <Slider
            label={t('adjustments.details.luminance')}
            max={100}
            min={isForMask ? -100 : 0}
            onChange={(e: any) => handleAdjustmentChange(DetailsAdjustment.LumaNoiseReduction, e.target.value)}
            step={1}
            value={adjustments.lumaNoiseReduction}
            onDragStateChange={onDragStateChange}
          />
          <Slider
            label={t('adjustments.details.color')}
            max={100}
            min={isForMask ? -100 : 0}
            onChange={(e: any) => handleAdjustmentChange(DetailsAdjustment.ColorNoiseReduction, e.target.value)}
            step={1}
            value={adjustments.colorNoiseReduction}
            onDragStateChange={onDragStateChange}
          />
        </div>
      )}

      {!isForMask && adjustmentVisibility.noiseReduction !== false && (
        <AiEffectSection
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
        <div className="p-2 compact:p-1.5 bg-bg-tertiary rounded-md">
          <Text variant={TextVariants.heading} className="mb-2 compact:mb-1 compact:text-sm">
            {t('adjustments.details.chromaticAberration')}
          </Text>
          <Slider
            label={t('adjustments.details.redCyan')}
            max={100}
            min={-100}
            onChange={(e: any) => handleAdjustmentChange(DetailsAdjustment.ChromaticAberrationRedCyan, e.target.value)}
            step={1}
            value={adjustments.chromaticAberrationRedCyan}
            onDragStateChange={onDragStateChange}
          />
          <Slider
            label={t('adjustments.details.blueYellow')}
            max={100}
            min={-100}
            onChange={(e: any) =>
              handleAdjustmentChange(DetailsAdjustment.ChromaticAberrationBlueYellow, e.target.value)
            }
            step={1}
            value={adjustments.chromaticAberrationBlueYellow}
            onDragStateChange={onDragStateChange}
          />
        </div>
      )}
    </div>
  );
}
