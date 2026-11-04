import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  Building2,
  Check,
  Columns3,
  Minus,
  MoveDiagonal2,
  RotateCcw,
  Rows3,
  Scan,
  Trash2,
  WandSparkles,
  X,
} from 'lucide-react';
import { motion } from 'framer-motion';
import clsx from 'clsx';
import { toast } from 'react-toastify';
import { useTranslation } from 'react-i18next';

import TransformModal from '../../modals/TransformModal';
import Slider, { SliderChangeEvent } from '../../ui/Slider';
import Switch from '../../ui/Switch';
import Text from '../../ui/Text';
import PanelHeader from '../../ui/PanelHeader';
import { useEditorActions } from '../../../hooks/useEditorActions';
import { useGuidedPerspectiveSession } from '../../../hooks/useGuidedPerspectiveSession';
import { useEditorStore } from '../../../store/useEditorStore';
import { TextColors, TextVariants, TextWeights } from '../../../types/typography';
import { Adjustments, GuideLine, INITIAL_ADJUSTMENTS, hasGuidedPerspective } from '../../../utils/adjustments';
import { swapOrientationForQuarterTurn, withGuideLines } from '../../../utils/guidedPerspective';

type AutoGeometryMode = 'auto' | 'level' | 'vertical';

export default function GeometryPanel() {
  const { t } = useTranslation();
  const selectedImage = useEditorStore((state) => state.selectedImage);
  const adjustments = useEditorStore((state) => state.adjustments);
  const { setAdjustments } = useEditorActions();
  const [isTransformModalOpen, setIsTransformModalOpen] = useState(false);
  const setEditor = useEditorStore((state) => state.setEditor);
  const isGuidedPerspectiveActive = useEditorStore((state) => state.isGuidedPerspectiveActive);
  const [analyzingGeometry, setAnalyzingGeometry] = useState<AutoGeometryMode | null>(null);
  useGuidedPerspectiveSession();
  const guideLines = adjustments.guidedPerspective.lines;
  // Automatic and manual corrections replace or stack on the guides, so
  // they wait until guide drawing ends.
  const isBusy = analyzingGeometry !== null || isGuidedPerspectiveActive;

  const resetTransforms = () => {
    setAdjustments((previous: Adjustments) => ({
      ...previous,
      transformAutoMode: INITIAL_ADJUSTMENTS.transformAutoMode,
      transformAutoStrength: INITIAL_ADJUSTMENTS.transformAutoStrength,
      guidedPerspective: INITIAL_ADJUSTMENTS.guidedPerspective,
      transformDistortion: INITIAL_ADJUSTMENTS.transformDistortion,
      transformVertical: INITIAL_ADJUSTMENTS.transformVertical,
      transformHorizontal: INITIAL_ADJUSTMENTS.transformHorizontal,
      transformRotate: INITIAL_ADJUSTMENTS.transformRotate,
      transformAspect: INITIAL_ADJUSTMENTS.transformAspect,
      transformScale: INITIAL_ADJUSTMENTS.transformScale,
      transformXOffset: INITIAL_ADJUSTMENTS.transformXOffset,
      transformYOffset: INITIAL_ADJUSTMENTS.transformYOffset,
      transformConstrainCrop: INITIAL_ADJUSTMENTS.transformConstrainCrop,
    }));
  };

  const autoPerspectiveMode =
    adjustments.transformAutoMode === 'auto' || adjustments.transformAutoMode === 'vertical'
      ? adjustments.transformAutoMode
      : null;

  // `keepStrength` re-applies the analysis at the strength the user chose
  // instead of the one the backend suggests.
  const handleAutoGeometry = async (mode: AutoGeometryMode, keepStrength = false) => {
    if (!selectedImage || analyzingGeometry) return;

    setAnalyzingGeometry(mode);
    try {
      // The backend reports only the axes the mode corrected; on a
      // quarter-turned photo the on-screen verticals are the horizontal axis.
      // Auto suggests a balanced strength; Vertical and Level suggest 100 %.
      const result = await invoke<{
        horizontal: number | null;
        rotate: number;
        strength: number;
        vertical: number | null;
      }>('analyze_geometry', { mode, jsAdjustments: adjustments });
      setAdjustments((previous: Adjustments) => {
        const strength = keepStrength ? previous.transformAutoStrength : result.strength;
        // Auto Strength scales only the perspective; leveling stays complete.
        return {
          ...previous,
          transformAutoMode: mode,
          transformAutoStrength: strength,
          guidedPerspective: INITIAL_ADJUSTMENTS.guidedPerspective,
          transformRotate: result.rotate,
          transformVertical: ((result.vertical ?? 0) * strength) / 100,
          transformHorizontal: ((result.horizontal ?? 0) * strength) / 100,
        };
      });
    } catch (error) {
      toast.error(t('editor.crop.autoGeometryFailed', { error: String(error) }));
    } finally {
      setAnalyzingGeometry(null);
    }
  };

  const handleAutoStrengthChange = (event: SliderChangeEvent) => {
    const strength = Number(event.target.value);
    // At 0 % the full correction is no longer stored, so analyze again.
    const needsAnalysis = adjustments.transformAutoStrength <= 0 && strength > 0;
    setAdjustments((previous: Adjustments) => {
      const ratio = previous.transformAutoStrength > 0 ? strength / previous.transformAutoStrength : 0;
      return {
        ...previous,
        transformAutoStrength: strength,
        transformVertical: previous.transformVertical * ratio,
        transformHorizontal: previous.transformHorizontal * ratio,
      };
    });
    if (needsAnalysis && autoPerspectiveMode) {
      void handleAutoGeometry(autoPerspectiveMode, true);
    }
  };

  const handleSliderDragStateChange = (isDragging: boolean) => setEditor({ isSliderDragging: isDragging });

  const buttonClass =
    'flex flex-col items-center justify-center p-3 compact:p-2 rounded-lg transition-colors disabled:cursor-wait disabled:opacity-50';

  const setGuideLines = (update: (lines: GuideLine[]) => GuideLine[]) =>
    setAdjustments((previous: Adjustments) => withGuideLines(previous, update(previous.guidedPerspective.lines)));

  // Guides are listed by their on-screen orientation and numbered within it.
  const listedGuides = (['vertical', 'horizontal'] as const).flatMap((orientation) =>
    guideLines
      .filter((line) => swapOrientationForQuarterTurn(line.type, adjustments.orientationSteps || 0) === orientation)
      .map((line, index) => ({ line, orientation, number: index + 1 })),
  );

  return (
    <div className="flex flex-col h-full">
      <PanelHeader title={t('editor.geometry.title')} />

      <div className="grow overflow-y-auto p-4 compact:p-2.5 custom-scrollbar">
        {selectedImage ? (
          <div className="space-y-4 compact:space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <motion.button
                className={clsx(
                  buttonClass,
                  adjustments.transformAutoMode === 'auto'
                    ? 'bg-accent text-button-text shadow-sm'
                    : 'bg-surface text-text-secondary hover:bg-card-active hover:text-text-primary',
                )}
                disabled={isBusy}
                onClick={() => handleAutoGeometry('auto')}
                data-tooltip={t('editor.crop.tooltips.auto')}
                whileTap={{ scale: 0.98 }}
                type="button"
              >
                <WandSparkles size={20} />
                <span className="text-xs mt-2">
                  {analyzingGeometry === 'auto' ? t('editor.crop.labels.analyzing') : t('editor.crop.labels.auto')}
                </span>
              </motion.button>
              <motion.button
                className={`${buttonClass} bg-surface text-text-secondary hover:bg-card-active hover:text-text-primary`}
                disabled={isBusy}
                onClick={() => setIsTransformModalOpen(true)}
                data-tooltip={t('editor.crop.tooltips.manualTransform')}
                whileTap={{ scale: 0.98 }}
                type="button"
              >
                <Scan size={20} />
                <span className="text-xs mt-2">{t('editor.crop.labels.manualTransform')}</span>
              </motion.button>
              <motion.button
                className={clsx(
                  buttonClass,
                  isGuidedPerspectiveActive || hasGuidedPerspective(adjustments.guidedPerspective)
                    ? 'bg-accent text-button-text shadow-sm'
                    : 'bg-surface text-text-secondary hover:bg-card-active hover:text-text-primary',
                )}
                disabled={analyzingGeometry !== null}
                onClick={() => setEditor({ isGuidedPerspectiveActive: !isGuidedPerspectiveActive })}
                data-tooltip={t('editor.crop.tooltips.guided')}
                whileTap={{ scale: 0.98 }}
                type="button"
              >
                <MoveDiagonal2 size={20} />
                <span className="text-xs mt-2">{t('editor.crop.labels.guided')}</span>
              </motion.button>
              <motion.button
                className={clsx(
                  buttonClass,
                  adjustments.transformAutoMode === 'level'
                    ? 'bg-accent text-button-text shadow-sm'
                    : 'bg-surface text-text-secondary hover:bg-card-active hover:text-text-primary',
                )}
                disabled={isBusy}
                onClick={() => handleAutoGeometry('level')}
                data-tooltip={t('editor.crop.tooltips.level')}
                whileTap={{ scale: 0.98 }}
                type="button"
              >
                <Minus size={20} />
                <span className="text-xs mt-2">
                  {analyzingGeometry === 'level' ? t('editor.crop.labels.analyzing') : t('editor.crop.labels.level')}
                </span>
              </motion.button>
              <motion.button
                className={clsx(
                  buttonClass,
                  adjustments.transformAutoMode === 'vertical'
                    ? 'bg-accent text-button-text shadow-sm'
                    : 'bg-surface text-text-secondary hover:bg-card-active hover:text-text-primary',
                )}
                disabled={isBusy}
                onClick={() => handleAutoGeometry('vertical')}
                data-tooltip={t('editor.crop.tooltips.vertical')}
                whileTap={{ scale: 0.98 }}
                type="button"
              >
                <Building2 size={20} />
                <span className="text-xs mt-2">
                  {analyzingGeometry === 'vertical'
                    ? t('editor.crop.labels.analyzing')
                    : t('editor.crop.labels.vertical')}
                </span>
              </motion.button>
            </div>
            {isGuidedPerspectiveActive && (
              <div className="space-y-3 compact:space-y-2 rounded-lg bg-surface p-3 compact:p-2">
                <Text variant={TextVariants.small} color={TextColors.secondary} className="leading-relaxed">
                  {t('editor.geometry.guided.hint')}
                </Text>
                <div className="flex items-center justify-between text-xs font-medium">
                  <span>{t('editor.geometry.guided.linesStatus')}</span>
                  <span className={guideLines.length >= 2 ? 'text-accent' : 'text-text-secondary'}>
                    {guideLines.length} / 4
                  </span>
                </div>
                {listedGuides.map(({ line, orientation, number }) => (
                  <div
                    className="flex items-center gap-2 rounded-md bg-bg-secondary px-2 py-1.5 text-xs text-text-secondary"
                    key={line.id}
                  >
                    {orientation === 'vertical' ? <Columns3 size={14} /> : <Rows3 size={14} />}
                    <span className="grow text-text-primary">
                      {t(`editor.geometry.guided.${orientation}Guide`, { number })}
                    </span>
                    <button
                      className="rounded-sm p-1 hover:bg-card-active hover:text-text-primary"
                      data-tooltip={t('editor.geometry.guided.removeGuide')}
                      onClick={() => setGuideLines((lines) => lines.filter((guide) => guide.id !== line.id))}
                      type="button"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
                <div className="flex gap-2">
                  <button
                    className="flex grow items-center justify-center gap-2 rounded-md px-3 py-2 text-sm text-text-secondary hover:bg-card-active hover:text-text-primary disabled:opacity-40"
                    disabled={guideLines.length === 0}
                    onClick={() => setGuideLines(() => [])}
                    type="button"
                  >
                    <Trash2 size={16} />
                    {t('editor.geometry.guided.clearAll')}
                  </button>
                  <button
                    className="flex grow items-center justify-center gap-2 rounded-md bg-accent px-3 py-2 text-sm text-button-text"
                    onClick={() => setEditor({ isGuidedPerspectiveActive: false })}
                    type="button"
                  >
                    <Check size={16} />
                    {t('editor.geometry.guided.done')}
                  </button>
                </div>
              </div>
            )}
            {autoPerspectiveMode && (
              <div
                className="rounded-lg bg-surface px-3 compact:px-2 pt-2 pb-3 compact:py-2"
                data-tooltip={t('editor.crop.tooltips.autoStrength')}
              >
                <Slider
                  label={t('editor.crop.labels.autoStrength')}
                  min={0}
                  max={100}
                  step={1}
                  value={adjustments.transformAutoStrength}
                  defaultValue={INITIAL_ADJUSTMENTS.transformAutoStrength}
                  suffix="%"
                  disabled={isBusy}
                  onChange={handleAutoStrengthChange}
                  onDragStateChange={handleSliderDragStateChange}
                />
              </div>
            )}
            <motion.button
              className="w-full flex items-center justify-center gap-2 rounded-lg border border-text-secondary/40 bg-surface px-3 py-3 compact:py-2 text-sm font-medium text-text-primary transition-colors hover:border-accent hover:bg-card-active"
              onClick={resetTransforms}
              data-tooltip={t('editor.geometry.resetTooltip')}
              whileTap={{ scale: 0.98 }}
              type="button"
            >
              <RotateCcw size={18} />
              <span>{t('adjustments.basic.reset')}</span>
            </motion.button>
            <div className="rounded-lg bg-surface p-3 compact:p-2">
              <Switch
                checked={adjustments.transformConstrainCrop}
                label={t('editor.crop.labels.constrainCrop')}
                onChange={(checked) =>
                  setAdjustments((previous: Adjustments) => ({
                    ...previous,
                    transformConstrainCrop: checked,
                  }))
                }
                tooltip={t('editor.crop.tooltips.constrainCrop')}
              />
            </div>
          </div>
        ) : (
          <Text
            variant={TextVariants.heading}
            color={TextColors.secondary}
            weight={TextWeights.normal}
            className="text-center mt-4"
          >
            {t('editor.ai.noImageSelected')}
          </Text>
        )}
      </div>

      <TransformModal
        isOpen={isTransformModalOpen}
        onClose={() => setIsTransformModalOpen(false)}
        onApply={(parameters) => {
          setAdjustments((previous: Adjustments) => ({
            ...previous,
            // Manual values stack on Guided Perspective, which stays active.
            transformAutoMode: previous.transformAutoMode === 'guided' ? 'guided' : null,
            transformDistortion: parameters.distortion,
            transformVertical: parameters.vertical,
            transformHorizontal: parameters.horizontal,
            transformRotate: parameters.rotate,
            transformAspect: parameters.aspect,
            transformScale: parameters.scale,
            transformXOffset: parameters.x_offset,
            transformYOffset: parameters.y_offset,
          }));
        }}
        currentAdjustments={adjustments}
      />
    </div>
  );
}
