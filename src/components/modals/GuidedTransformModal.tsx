import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Check, Columns3, Eye, EyeOff, Rows3, Trash2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import Button from '../ui/Button';
import Text from '../ui/Text';
import { useEditorStore } from '../../store/useEditorStore';
import { TextColors, TextVariants } from '../../types/typography';
import { Adjustments, GeometryGuide, GuidedTransformGuides, INITIAL_ADJUSTMENTS } from '../../utils/adjustments';

interface GuidedResult {
  horizontal: number;
  residual: number;
  rotate: number;
  vertical: number;
}

interface GuidedTransformModalProps {
  currentAdjustments: Adjustments;
  isOpen: boolean;
  onApply(result: GuidedResult, guides: GuidedTransformGuides): void;
  onClose(): void;
}

type GuideOrientation = keyof GuidedTransformGuides;

const EMPTY_GUIDES: GuidedTransformGuides = { horizontal: [], vertical: [] };

const cloneGuides = (guides?: GuidedTransformGuides): GuidedTransformGuides => ({
  horizontal: (guides?.horizontal || []).slice(0, 2).map((guide) => ({ ...guide })),
  vertical: (guides?.vertical || []).slice(0, 2).map((guide) => ({ ...guide })),
});

const mapGuide = (guide: GeometryGuide, mapPoint: (x: number, y: number) => [number, number]): GeometryGuide => {
  const [x1, y1] = mapPoint(guide.x1, guide.y1);
  const [x2, y2] = mapPoint(guide.x2, guide.y2);
  return { ...guide, x1, y1, x2, y2 };
};

const orientGuidesForDisplay = (guides: GuidedTransformGuides, adjustments: Adjustments): GuidedTransformGuides => {
  const steps = (adjustments.orientationSteps || 0) % 4;
  const mapPoint = (x: number, y: number): [number, number] => {
    let oriented: [number, number];
    if (steps === 1) oriented = [1 - y, x];
    else if (steps === 2) oriented = [1 - x, 1 - y];
    else if (steps === 3) oriented = [y, 1 - x];
    else oriented = [x, y];
    return [
      adjustments.flipHorizontal ? 1 - oriented[0] : oriented[0],
      adjustments.flipVertical ? 1 - oriented[1] : oriented[1],
    ];
  };
  const horizontal = guides.horizontal.map((guide) => mapGuide(guide, mapPoint));
  const vertical = guides.vertical.map((guide) => mapGuide(guide, mapPoint));
  return steps % 2 === 1 ? { horizontal: vertical, vertical: horizontal } : { horizontal, vertical };
};

const unorientGuidesForStorage = (guides: GuidedTransformGuides, adjustments: Adjustments): GuidedTransformGuides => {
  const steps = (adjustments.orientationSteps || 0) % 4;
  const mapPoint = (displayX: number, displayY: number): [number, number] => {
    const x = adjustments.flipHorizontal ? 1 - displayX : displayX;
    const y = adjustments.flipVertical ? 1 - displayY : displayY;
    if (steps === 1) return [y, 1 - x];
    if (steps === 2) return [1 - x, 1 - y];
    if (steps === 3) return [1 - y, x];
    return [x, y];
  };
  const horizontal = guides.horizontal.map((guide) => mapGuide(guide, mapPoint));
  const vertical = guides.vertical.map((guide) => mapGuide(guide, mapPoint));
  return steps % 2 === 1 ? { horizontal: vertical, vertical: horizontal } : { horizontal, vertical };
};

const zeroResult = (): GuidedResult => ({ horizontal: 0, residual: 0, rotate: 0, vertical: 0 });

const previewAdjustments = (adjustments: Adjustments, result: GuidedResult): Adjustments => ({
  ...adjustments,
  transformAutoMode: null,
  transformGuides: INITIAL_ADJUSTMENTS.transformGuides,
  transformRotate: result.rotate,
  transformVertical: result.vertical,
  transformHorizontal: result.horizontal,
});

export default function GuidedTransformModal({
  currentAdjustments,
  isOpen,
  onApply,
  onClose,
}: GuidedTransformModalProps) {
  const { t } = useTranslation();
  const selectedImagePath = useEditorStore((state) => state.selectedImage?.path ?? null);
  const overlay = useEditorStore((state) => state.guidedTransformOverlay);
  const setEditor = useEditorStore((state) => state.setEditor);
  const [result, setResult] = useState<GuidedResult>(zeroResult);
  const [showCorrected, setShowCorrected] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sessionImagePathRef = useRef<string | null>(null);
  const solveRequestRef = useRef(0);

  const showResult = useCallback(
    (nextResult: GuidedResult, corrected: boolean) => {
      setShowCorrected(corrected);
      setEditor((state) => ({
        previewOverride: previewAdjustments(currentAdjustments, corrected ? nextResult : zeroResult()),
        guidedTransformOverlay: state.guidedTransformOverlay
          ? { ...state.guidedTransformOverlay, interactive: !corrected }
          : null,
      }));
    },
    [currentAdjustments, setEditor],
  );

  useEffect(() => {
    if (!isOpen) return;
    const savedGuides = orientGuidesForDisplay(cloneGuides(currentAdjustments.transformGuides), currentAdjustments);
    const savedResult =
      currentAdjustments.transformAutoMode === 'guided'
        ? {
            horizontal: currentAdjustments.transformHorizontal,
            residual: 0,
            rotate: currentAdjustments.transformRotate,
            vertical: currentAdjustments.transformVertical,
          }
        : zeroResult();
    sessionImagePathRef.current = selectedImagePath;
    setResult(savedResult);
    setShowCorrected(false);
    setError(null);
    setEditor({
      previewOverride: previewAdjustments(currentAdjustments, zeroResult()),
      guidedTransformOverlay: {
        activeOrientation: savedGuides.vertical.length < 2 ? 'vertical' : 'horizontal',
        guides: savedGuides,
        interactive: true,
        revision: savedGuides.vertical.length === 2 || savedGuides.horizontal.length === 2 ? 1 : 0,
      },
    });

    return () => {
      solveRequestRef.current += 1;
      setEditor({ previewOverride: null, guidedTransformOverlay: null });
    };
    // Capture the committed adjustment state once when the draft opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && sessionImagePathRef.current && selectedImagePath !== sessionImagePathRef.current) {
      onClose();
    }
  }, [isOpen, onClose, selectedImagePath]);

  useEffect(() => {
    if (!isOpen || !overlay) return;
    const nextGuides = overlay.guides;
    const hasCompletePair = nextGuides.vertical.length === 2 || nextGuides.horizontal.length === 2;
    if (!hasCompletePair) {
      const emptyResult = zeroResult();
      setResult(emptyResult);
      setError(null);
      showResult(emptyResult, false);
      return;
    }

    const requestId = ++solveRequestRef.current;
    setIsLoading(true);
    setError(null);
    invoke<GuidedResult>('solve_guided_transform', {
      guides: nextGuides,
      jsAdjustments: currentAdjustments,
    })
      .then((nextResult) => {
        if (solveRequestRef.current !== requestId) return;
        setResult(nextResult);
        if (showCorrected) showResult(nextResult, true);
      })
      .catch((solveError) => {
        if (solveRequestRef.current === requestId) setError(String(solveError));
      })
      .finally(() => {
        if (solveRequestRef.current === requestId) setIsLoading(false);
      });
    // A revision is committed only after a guide draw/drag/remove operation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overlay?.revision]);

  if (!isOpen || !overlay) return null;

  const setActiveOrientation = (orientation: GuideOrientation) => {
    setEditor((state) => ({
      guidedTransformOverlay: state.guidedTransformOverlay
        ? { ...state.guidedTransformOverlay, activeOrientation: orientation }
        : null,
    }));
  };

  const removeGuide = (orientation: GuideOrientation, id: string) => {
    setEditor((state) => {
      if (!state.guidedTransformOverlay) return {};
      const guides = cloneGuides(state.guidedTransformOverlay.guides);
      guides[orientation] = guides[orientation].filter((guide) => guide.id !== id);
      return {
        guidedTransformOverlay: {
          ...state.guidedTransformOverlay,
          guides,
          interactive: true,
          revision: state.guidedTransformOverlay.revision + 1,
        },
      };
    });
  };

  const clearAll = () => {
    const emptyResult = zeroResult();
    setResult(emptyResult);
    setError(null);
    showResult(emptyResult, false);
    setEditor((state) => ({
      guidedTransformOverlay: state.guidedTransformOverlay
        ? {
            ...state.guidedTransformOverlay,
            activeOrientation: 'vertical',
            guides: cloneGuides(EMPTY_GUIDES),
            interactive: true,
            revision: state.guidedTransformOverlay.revision + 1,
          }
        : null,
    }));
  };

  const hasCompletePair = overlay.guides.vertical.length === 2 || overlay.guides.horizontal.length === 2;

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-start gap-3 border-b border-surface p-4">
        <button
          className="mt-0.5 rounded-full p-2 transition-colors hover:bg-surface"
          onClick={onClose}
          data-tooltip={t('modals.guidedTransform.cancel')}
          type="button"
        >
          <X size={18} />
        </button>
        <div className="min-w-0">
          <Text variant={TextVariants.title}>{t('modals.guidedTransform.title')}</Text>
          <Text variant={TextVariants.small} color={TextColors.secondary} className="mt-2 leading-relaxed">
            {t('modals.guidedTransform.description')}
          </Text>
        </div>
      </div>

      <div className="custom-scrollbar grow space-y-5 overflow-y-auto p-4">
        {(['vertical', 'horizontal'] as GuideOrientation[]).map((orientation) => {
          const pair = overlay.guides[orientation];
          const isActive = overlay.activeOrientation === orientation;
          return (
            <div className="space-y-3 rounded-lg bg-surface p-3" key={orientation}>
              <button
                className={`flex w-full items-center justify-between rounded-md px-3 py-2 transition-colors ${
                  isActive
                    ? 'bg-accent text-button-text'
                    : 'bg-bg-secondary text-text-secondary hover:text-text-primary'
                }`}
                disabled={pair.length >= 2 || showCorrected}
                onClick={() => setActiveOrientation(orientation)}
                type="button"
              >
                <span className="flex items-center gap-2 text-sm font-medium">
                  {orientation === 'vertical' ? <Columns3 size={16} /> : <Rows3 size={16} />}
                  {t(`modals.guidedTransform.${orientation}`)}
                </span>
                <span className="text-xs">{pair.length}/2</span>
              </button>
              {pair.map((guide, index) => (
                <div className="flex items-center justify-between text-xs text-text-secondary" key={guide.id}>
                  <span>{t('modals.guidedTransform.guideNumber', { number: index + 1 })}</span>
                  <button
                    className="rounded-sm p-1 hover:bg-card-active hover:text-text-primary"
                    disabled={showCorrected}
                    onClick={() => removeGuide(orientation, guide.id)}
                    type="button"
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
              {pair.length < 2 && (
                <Text variant={TextVariants.small} color={TextColors.secondary}>
                  {isActive ? t('modals.guidedTransform.drawNextGuide') : t('modals.guidedTransform.selectToDraw')}
                </Text>
              )}
            </div>
          );
        })}

        {error && <div className="rounded-md bg-red-500/10 p-3 text-xs text-red-400">{error}</div>}

        <div className="space-y-2 rounded-lg bg-surface p-3 text-xs text-text-secondary">
          <div className="flex justify-between">
            <span>{t('modals.guidedTransform.rotation')}</span>
            <span>{result.rotate.toFixed(2)}°</span>
          </div>
          <div className="flex justify-between">
            <span>{t('modals.guidedTransform.vertical')}</span>
            <span>{result.vertical.toFixed(2)}</span>
          </div>
          <div className="flex justify-between">
            <span>{t('modals.guidedTransform.horizontal')}</span>
            <span>{result.horizontal.toFixed(2)}</span>
          </div>
        </div>

        <button
          className="flex w-full items-center justify-center gap-2 rounded-md bg-surface px-3 py-2 text-sm text-text-secondary hover:text-text-primary disabled:opacity-40"
          disabled={!hasCompletePair || isLoading || !!error}
          onClick={() => showResult(result, !showCorrected)}
          type="button"
        >
          {showCorrected ? <EyeOff size={16} /> : <Eye size={16} />}
          {showCorrected ? t('modals.guidedTransform.showGuides') : t('modals.guidedTransform.previewCorrection')}
        </button>
        <button
          className="flex w-full items-center justify-center gap-2 rounded-md px-3 py-2 text-sm text-text-secondary hover:bg-surface hover:text-text-primary"
          onClick={clearAll}
          type="button"
        >
          <Trash2 size={16} />
          {t('modals.guidedTransform.clearAll')}
        </button>
      </div>

      <div className="flex shrink-0 justify-end gap-3 border-t border-surface bg-bg-secondary p-4">
        <button
          className="rounded-md px-4 py-2 text-text-secondary transition-colors hover:bg-surface"
          onClick={onClose}
          type="button"
        >
          {t('modals.guidedTransform.cancel')}
        </button>
        <Button
          disabled={!hasCompletePair || isLoading || !!error}
          onClick={() => {
            onApply(result, unorientGuidesForStorage(cloneGuides(overlay.guides), currentAdjustments));
            onClose();
          }}
        >
          <Check className="mr-2" size={16} />
          {isLoading ? t('modals.guidedTransform.solving') : t('modals.guidedTransform.apply')}
        </Button>
      </div>
    </div>
  );
}
