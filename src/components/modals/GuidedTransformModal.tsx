import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, Columns3, Eye, EyeOff, Rows3, Trash2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import Button from '../ui/Button';
import Text from '../ui/Text';
import { TextColors, TextVariants } from '../../types/typography';
import type { Adjustments, GeometryGuide, GuidedTransformGuides } from '../../utils/adjustments';

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

interface GeometryParams {
  aspect: number;
  constrain_crop: boolean;
  distortion: number;
  horizontal: number;
  lens_dist_k1: number;
  lens_dist_k2: number;
  lens_dist_k3: number;
  lens_distortion_amount: number;
  lens_distortion_enabled: boolean;
  lens_model: number;
  lens_tca_amount: number;
  lens_tca_enabled: boolean;
  lens_vignette_amount: number;
  lens_vignette_enabled: boolean;
  rotate: number;
  scale: number;
  tca_vb: number;
  tca_vr: number;
  vertical: number;
  vig_k1: number;
  vig_k2: number;
  vig_k3: number;
  x_offset: number;
  y_offset: number;
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

const makeGuideId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `guide-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const buildGeometryParams = (adjustments: Adjustments, result: GuidedResult): GeometryParams => ({
  aspect: adjustments.transformAspect ?? 0,
  constrain_crop: adjustments.transformConstrainCrop,
  distortion: adjustments.transformDistortion ?? 0,
  horizontal: result.horizontal,
  lens_dist_k1: adjustments.lensDistortionParams?.k1 ?? 0,
  lens_dist_k2: adjustments.lensDistortionParams?.k2 ?? 0,
  lens_dist_k3: adjustments.lensDistortionParams?.k3 ?? 0,
  lens_distortion_amount: (adjustments.lensDistortionAmount ?? 100) / 100,
  lens_distortion_enabled: adjustments.lensDistortionEnabled ?? true,
  lens_model: adjustments.lensDistortionParams?.model ?? 0,
  lens_tca_amount: (adjustments.lensTcaAmount ?? 100) / 100,
  lens_tca_enabled: adjustments.lensTcaEnabled ?? true,
  lens_vignette_amount: (adjustments.lensVignetteAmount ?? 100) / 100,
  lens_vignette_enabled: adjustments.lensVignetteEnabled ?? true,
  rotate: result.rotate,
  scale: adjustments.transformScale ?? 100,
  tca_vb: adjustments.lensDistortionParams?.tca_vb ?? 1,
  tca_vr: adjustments.lensDistortionParams?.tca_vr ?? 1,
  vertical: result.vertical,
  vig_k1: adjustments.lensDistortionParams?.vig_k1 ?? 0,
  vig_k2: adjustments.lensDistortionParams?.vig_k2 ?? 0,
  vig_k3: adjustments.lensDistortionParams?.vig_k3 ?? 0,
  x_offset: adjustments.transformXOffset ?? 0,
  y_offset: adjustments.transformYOffset ?? 0,
});

const zeroResult = (): GuidedResult => ({ horizontal: 0, residual: 0, rotate: 0, vertical: 0 });

export default function GuidedTransformModal({
  currentAdjustments,
  isOpen,
  onApply,
  onClose,
}: GuidedTransformModalProps) {
  const { t } = useTranslation();
  const [guides, setGuides] = useState<GuidedTransformGuides>(EMPTY_GUIDES);
  const [activeOrientation, setActiveOrientation] = useState<GuideOrientation>('vertical');
  const [result, setResult] = useState<GuidedResult>(zeroResult);
  const [sourcePreviewUrl, setSourcePreviewUrl] = useState<string | null>(null);
  const [correctedPreviewUrl, setCorrectedPreviewUrl] = useState<string | null>(null);
  const [showCorrected, setShowCorrected] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isMounted, setIsMounted] = useState(false);
  const [show, setShow] = useState(false);
  const previewRequestRef = useRef({ corrected: 0, source: 0 });
  const drawingRef = useRef<{ id: string; orientation: GuideOrientation } | null>(null);
  const draggingEndpointRef = useRef<{
    endpoint: 'start' | 'end';
    id: string;
    orientation: GuideOrientation;
  } | null>(null);

  const requestPreview = useCallback(
    async (nextResult: GuidedResult, corrected: boolean) => {
      const previewKind = corrected ? 'corrected' : 'source';
      const requestId = ++previewRequestRef.current[previewKind];
      try {
        const preview = await invoke<string>('preview_geometry_transform', {
          params: buildGeometryParams(currentAdjustments, nextResult),
          jsAdjustments: currentAdjustments,
          showLines: false,
        });
        if (requestId !== previewRequestRef.current[previewKind]) return;
        if (corrected) setCorrectedPreviewUrl(preview);
        else setSourcePreviewUrl(preview);
      } catch (previewError) {
        if (requestId === previewRequestRef.current[previewKind]) setError(String(previewError));
      }
    },
    [currentAdjustments],
  );

  const solve = useCallback(
    async (nextGuides: GuidedTransformGuides) => {
      const hasCompletePair = nextGuides.vertical.length === 2 || nextGuides.horizontal.length === 2;
      if (!hasCompletePair) {
        const emptyResult = zeroResult();
        setResult(emptyResult);
        setCorrectedPreviewUrl(null);
        setShowCorrected(false);
        setError(null);
        return;
      }

      setIsLoading(true);
      setError(null);
      try {
        const nextResult = await invoke<GuidedResult>('solve_guided_transform', {
          guides: nextGuides,
          jsAdjustments: currentAdjustments,
        });
        setResult(nextResult);
        await requestPreview(nextResult, true);
      } catch (solveError) {
        setError(String(solveError));
      } finally {
        setIsLoading(false);
      }
    },
    [currentAdjustments, requestPreview],
  );

  useEffect(() => {
    if (!isOpen) {
      setShow(false);
      const timer = window.setTimeout(() => setIsMounted(false), 250);
      return () => window.clearTimeout(timer);
    }

    setIsMounted(true);
    const timer = window.setTimeout(() => setShow(true), 10);
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
    setGuides(savedGuides);
    setResult(savedResult);
    setCorrectedPreviewUrl(null);
    setShowCorrected(false);
    setError(null);
    setActiveOrientation(savedGuides.vertical.length < 2 ? 'vertical' : 'horizontal');
    void requestPreview(zeroResult(), false);
    if (savedGuides.vertical.length === 2 || savedGuides.horizontal.length === 2) {
      void solve(savedGuides);
    }
    return () => window.clearTimeout(timer);
  }, [isOpen]);

  const updateGuide = (orientation: GuideOrientation, id: string, updater: (guide: GeometryGuide) => GeometryGuide) => {
    setGuides((previous) => ({
      ...previous,
      [orientation]: previous[orientation].map((guide) => (guide.id === id ? updater(guide) : guide)),
    }));
  };

  const pointerPosition = (event: React.PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
    };
  };

  const handlePointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    if (showCorrected || isLoading) return;
    const endpointElement = (event.target as Element).closest<SVGElement>('[data-guide-endpoint]');
    if (endpointElement) {
      draggingEndpointRef.current = {
        endpoint: endpointElement.dataset.guideEndpoint as 'start' | 'end',
        id: endpointElement.dataset.guideId || '',
        orientation: endpointElement.dataset.guideOrientation as GuideOrientation,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    if (guides[activeOrientation].length >= 2) return;

    const point = pointerPosition(event);
    const id = makeGuideId();
    const newGuide: GeometryGuide = { id, x1: point.x, y1: point.y, x2: point.x, y2: point.y };
    drawingRef.current = { id, orientation: activeOrientation };
    setGuides((previous) => ({
      ...previous,
      [activeOrientation]: [...previous[activeOrientation], newGuide],
    }));
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const active = draggingEndpointRef.current || drawingRef.current;
    if (!active) return;
    const point = pointerPosition(event);
    updateGuide(active.orientation, active.id, (guide) => {
      if (drawingRef.current || draggingEndpointRef.current?.endpoint === 'end') {
        return { ...guide, x2: point.x, y2: point.y };
      }
      return { ...guide, x1: point.x, y1: point.y };
    });
  };

  const handlePointerUp = (event: React.PointerEvent<SVGSVGElement>) => {
    const active = draggingEndpointRef.current || drawingRef.current;
    if (!active) return;
    const point = pointerPosition(event);
    const nextGuides = cloneGuides(guides);
    nextGuides[active.orientation] = nextGuides[active.orientation].map((guide) => {
      if (guide.id !== active.id) return guide;
      if (drawingRef.current || draggingEndpointRef.current?.endpoint === 'end') {
        return { ...guide, x2: point.x, y2: point.y };
      }
      return { ...guide, x1: point.x, y1: point.y };
    });
    const currentGuide = nextGuides[active.orientation].find((guide) => guide.id === active.id);
    if (currentGuide && Math.hypot(currentGuide.x2 - currentGuide.x1, currentGuide.y2 - currentGuide.y1) < 0.04) {
      nextGuides[active.orientation] = nextGuides[active.orientation].filter((guide) => guide.id !== active.id);
    }
    setGuides(nextGuides);
    drawingRef.current = null;
    draggingEndpointRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    void solve(nextGuides);
  };

  const removeGuide = (orientation: GuideOrientation, id: string) => {
    const nextGuides = cloneGuides(guides);
    nextGuides[orientation] = nextGuides[orientation].filter((guide) => guide.id !== id);
    setGuides(nextGuides);
    void solve(nextGuides);
  };

  const clearAll = () => {
    const empty = cloneGuides(EMPTY_GUIDES);
    setGuides(empty);
    setResult(zeroResult());
    setCorrectedPreviewUrl(null);
    setShowCorrected(false);
    setError(null);
  };

  const hasCompletePair = guides.vertical.length === 2 || guides.horizontal.length === 2;
  const visiblePreview = showCorrected && correctedPreviewUrl ? correctedPreviewUrl : sourcePreviewUrl;

  if (!isMounted) return null;

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs transition-opacity duration-300 ${
        show ? 'opacity-100' : 'opacity-0'
      }`}
      onPointerDown={onClose}
    >
      <AnimatePresence>
        {show && (
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            className="bg-surface rounded-lg shadow-xl w-full max-w-6xl h-[90vh] flex flex-col overflow-hidden"
            onPointerDown={(event) => event.stopPropagation()}
          >
            <div className="grow min-h-0 flex overflow-hidden">
              <div className="grow min-w-0 relative flex items-center justify-center bg-[#0f0f0f] p-6 overflow-hidden">
                {visiblePreview ? (
                  <div className="relative inline-flex max-w-full max-h-full shadow-2xl">
                    <img
                      alt={t('modals.guidedTransform.previewAlt')}
                      className="block max-w-full max-h-[calc(90vh-5rem)] object-contain select-none"
                      draggable={false}
                      src={visiblePreview}
                    />
                    {!showCorrected && (
                      <svg
                        className="absolute inset-0 h-full w-full cursor-crosshair touch-none"
                        onPointerDown={handlePointerDown}
                        onPointerMove={handlePointerMove}
                        onPointerUp={handlePointerUp}
                        onPointerCancel={handlePointerUp}
                        viewBox="0 0 1000 1000"
                        preserveAspectRatio="none"
                      >
                        {(['vertical', 'horizontal'] as GuideOrientation[]).flatMap((orientation) =>
                          guides[orientation].map((guide, index) => (
                            <g key={guide.id}>
                              <line
                                x1={guide.x1 * 1000}
                                y1={guide.y1 * 1000}
                                x2={guide.x2 * 1000}
                                y2={guide.y2 * 1000}
                                stroke="rgba(255,255,255,0.95)"
                                strokeWidth="2.8"
                                vectorEffect="non-scaling-stroke"
                              />
                              {(['start', 'end'] as const).map((endpoint) => (
                                <circle
                                  key={endpoint}
                                  cx={(endpoint === 'start' ? guide.x1 : guide.x2) * 1000}
                                  cy={(endpoint === 'start' ? guide.y1 : guide.y2) * 1000}
                                  r="8"
                                  fill="#111"
                                  stroke="white"
                                  strokeWidth="3"
                                  vectorEffect="non-scaling-stroke"
                                  data-guide-endpoint={endpoint}
                                  data-guide-id={guide.id}
                                  data-guide-orientation={orientation}
                                  className="cursor-move"
                                />
                              ))}
                              <text
                                x={(guide.x1 + guide.x2) * 500}
                                y={(guide.y1 + guide.y2) * 500 - 14}
                                fill="white"
                                fontSize="24"
                                textAnchor="middle"
                                paintOrder="stroke"
                                stroke="#111"
                                strokeWidth="6"
                              >
                                {orientation === 'vertical' ? 'V' : 'H'}
                                {index + 1}
                              </text>
                            </g>
                          )),
                        )}
                      </svg>
                    )}
                    {showCorrected && (
                      <div className="absolute top-3 left-3 rounded-sm bg-accent px-2 py-1 text-xs font-medium text-button-text">
                        {t('modals.guidedTransform.correctedPreview')}
                      </div>
                    )}
                  </div>
                ) : (
                  <Text color={TextColors.secondary}>{t('modals.guidedTransform.loadingPreview')}</Text>
                )}
              </div>

              <div className="w-80 shrink-0 bg-bg-secondary border-l border-surface flex flex-col">
                <div className="p-4 border-b border-surface">
                  <Text variant={TextVariants.title}>{t('modals.guidedTransform.title')}</Text>
                  <Text variant={TextVariants.small} color={TextColors.secondary} className="mt-2 leading-relaxed">
                    {t('modals.guidedTransform.description')}
                  </Text>
                </div>
                <div className="grow overflow-y-auto p-4 space-y-5 custom-scrollbar">
                  {(['vertical', 'horizontal'] as GuideOrientation[]).map((orientation) => {
                    const pair = guides[orientation];
                    const isActive = activeOrientation === orientation;
                    return (
                      <div key={orientation} className="rounded-lg bg-surface p-3 space-y-3">
                        <button
                          className={`w-full flex items-center justify-between rounded-md px-3 py-2 transition-colors ${
                            isActive
                              ? 'bg-accent text-button-text'
                              : 'bg-bg-secondary text-text-secondary hover:text-text-primary'
                          }`}
                          disabled={pair.length >= 2}
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
                          <div key={guide.id} className="flex items-center justify-between text-xs text-text-secondary">
                            <span>{t('modals.guidedTransform.guideNumber', { number: index + 1 })}</span>
                            <button
                              className="p-1 rounded-sm hover:bg-card-active hover:text-text-primary"
                              onClick={() => removeGuide(orientation, guide.id)}
                              type="button"
                            >
                              <X size={14} />
                            </button>
                          </div>
                        ))}
                        {pair.length < 2 && (
                          <Text variant={TextVariants.small} color={TextColors.secondary}>
                            {isActive
                              ? t('modals.guidedTransform.drawNextGuide')
                              : t('modals.guidedTransform.selectToDraw')}
                          </Text>
                        )}
                      </div>
                    );
                  })}

                  {error && <div className="rounded-md bg-red-500/10 p-3 text-xs text-red-400">{error}</div>}

                  <div className="rounded-lg bg-surface p-3 space-y-2 text-xs text-text-secondary">
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
                    className="w-full flex items-center justify-center gap-2 rounded-md bg-surface px-3 py-2 text-sm text-text-secondary hover:text-text-primary disabled:opacity-40"
                    disabled={!correctedPreviewUrl || isLoading}
                    onClick={() => setShowCorrected((value) => !value)}
                    type="button"
                  >
                    {showCorrected ? <EyeOff size={16} /> : <Eye size={16} />}
                    {showCorrected
                      ? t('modals.guidedTransform.showGuides')
                      : t('modals.guidedTransform.previewCorrection')}
                  </button>
                  <button
                    className="w-full flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm text-text-secondary hover:bg-surface hover:text-text-primary"
                    onClick={clearAll}
                    type="button"
                  >
                    <Trash2 size={16} />
                    {t('modals.guidedTransform.clearAll')}
                  </button>
                </div>
              </div>
            </div>

            <div className="shrink-0 p-4 flex justify-end gap-3 border-t border-surface bg-bg-secondary">
              <button
                className="px-4 py-2 rounded-md text-text-secondary hover:bg-surface transition-colors"
                onClick={onClose}
                type="button"
              >
                {t('modals.guidedTransform.cancel')}
              </button>
              <Button
                disabled={!hasCompletePair || isLoading || !!error}
                onClick={() => {
                  onApply(result, unorientGuidesForStorage(cloneGuides(guides), currentAdjustments));
                  onClose();
                }}
              >
                <Check className="mr-2" size={16} />
                {isLoading ? t('modals.guidedTransform.solving') : t('modals.guidedTransform.apply')}
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
