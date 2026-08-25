import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Building2, Minus, MoveDiagonal2, RotateCcw, Scan, WandSparkles } from 'lucide-react';
import { motion } from 'framer-motion';
import clsx from 'clsx';
import { toast } from 'react-toastify';
import { useTranslation } from 'react-i18next';

import GuidedTransformModal from '../../modals/GuidedTransformModal';
import TransformModal from '../../modals/TransformModal';
import Switch from '../../ui/Switch';
import Text from '../../ui/Text';
import { useEditorActions } from '../../../hooks/useEditorActions';
import { useEditorStore } from '../../../store/useEditorStore';
import { TextColors, TextVariants, TextWeights } from '../../../types/typography';
import { Adjustments, INITIAL_ADJUSTMENTS } from '../../../utils/adjustments';

export default function GeometryPanel() {
  const { t } = useTranslation();
  const selectedImage = useEditorStore((state) => state.selectedImage);
  const adjustments = useEditorStore((state) => state.adjustments);
  const { setAdjustments } = useEditorActions();
  const [isTransformModalOpen, setIsTransformModalOpen] = useState(false);
  const [isGuidedModalOpen, setIsGuidedModalOpen] = useState(false);
  const [analyzingGeometry, setAnalyzingGeometry] = useState<'auto' | 'level' | 'vertical' | null>(null);
  const hasAppliedGuidedTransform =
    adjustments.transformAutoMode === 'guided' ||
    adjustments.transformGuides.vertical.length === 2 ||
    adjustments.transformGuides.horizontal.length === 2;

  const resetTransforms = () => {
    setAdjustments((previous: Adjustments) => ({
      ...previous,
      transformAutoMode: INITIAL_ADJUSTMENTS.transformAutoMode,
      transformGuides: INITIAL_ADJUSTMENTS.transformGuides,
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

  const handleAutoGeometry = async (mode: 'auto' | 'level' | 'vertical') => {
    if (!selectedImage || analyzingGeometry) return;

    setAnalyzingGeometry(mode);
    try {
      const result = await invoke<{ horizontal?: number; rotate: number; vertical?: number }>('analyze_geometry', {
        mode,
        jsAdjustments: adjustments,
      });
      setAdjustments((previous: Adjustments) => ({
        ...previous,
        transformAutoMode: mode,
        transformGuides: INITIAL_ADJUSTMENTS.transformGuides,
        transformRotate: result.rotate,
        transformVertical: mode !== 'level' && result.vertical !== undefined ? result.vertical : 0,
        transformHorizontal: mode === 'auto' && result.horizontal !== undefined ? result.horizontal : 0,
      }));
    } catch (error) {
      toast.error(t('editor.crop.autoGeometryFailed', { error: String(error) }));
    } finally {
      setAnalyzingGeometry(null);
    }
  };

  const buttonClass =
    'flex flex-col items-center justify-center p-3 rounded-lg transition-colors disabled:cursor-wait disabled:opacity-50';

  if (isGuidedModalOpen) {
    return (
      <GuidedTransformModal
        isOpen
        onClose={() => setIsGuidedModalOpen(false)}
        onApply={(result, guides) => {
          setAdjustments((previous: Adjustments) => ({
            ...previous,
            transformAutoMode: 'guided',
            transformGuides: guides,
            transformRotate: result.rotate,
            transformVertical: result.vertical,
            transformHorizontal: result.horizontal,
          }));
        }}
        currentAdjustments={adjustments}
      />
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 flex justify-between items-center shrink-0 border-b border-surface">
        <Text variant={TextVariants.title}>{t('editor.geometry.title')}</Text>
      </div>

      <div className="grow overflow-y-auto p-4 custom-scrollbar">
        {selectedImage ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2">
              <motion.button
                className={clsx(
                  buttonClass,
                  adjustments.transformAutoMode === 'auto'
                    ? 'bg-accent text-button-text shadow-sm'
                    : 'bg-surface text-text-secondary hover:bg-card-active hover:text-text-primary',
                )}
                disabled={analyzingGeometry !== null}
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
                  hasAppliedGuidedTransform
                    ? 'bg-accent text-button-text shadow-sm'
                    : 'bg-surface text-text-secondary hover:bg-card-active hover:text-text-primary',
                )}
                onClick={() => setIsGuidedModalOpen(true)}
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
                disabled={analyzingGeometry !== null}
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
                disabled={analyzingGeometry !== null}
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
            <motion.button
              className="w-full flex items-center justify-center gap-2 rounded-lg border border-text-secondary/40 bg-surface px-3 py-3 text-sm font-medium text-text-primary transition-colors hover:border-accent hover:bg-card-active"
              onClick={resetTransforms}
              data-tooltip={t('editor.geometry.resetTooltip')}
              whileTap={{ scale: 0.98 }}
              type="button"
            >
              <RotateCcw size={18} />
              <span>{t('adjustments.basic.reset')}</span>
            </motion.button>
            <div className="rounded-lg bg-surface p-3">
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
            transformAutoMode: null,
            transformGuides: INITIAL_ADJUSTMENTS.transformGuides,
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
