import { Adjustments, AiPatch, MaskBlendMode, MaskContainer, normalizeLoadedAdjustments } from './adjustments';

export const LAYER_DOCUMENT_VERSION = 1;

export type LayerBlendMode = MaskBlendMode;

export interface LayerCanvas {
  width: number;
  height: number;
  background: {
    mode: 'transparent' | 'solid';
    color: [number, number, number, number];
  };
}

export interface LayerSourceReference {
  originalPath: string;
  relativePath?: string;
  fingerprint?: string;
  displayName: string;
}

export interface LayerArrange {
  /** `fit-to-canvas` is the default; the resolved mode is persisted per layer. */
  initialSizing?: 'fit-to-canvas' | 'native-pixels';
  centerX: number;
  centerY: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
  flipHorizontal: boolean;
  flipVertical: boolean;
}

export interface BaseLayer {
  id: string;
  name: string;
  kind: 'image' | 'adjustment';
  visible: boolean;
  opacity: number;
  blendMode: LayerBlendMode;
  locked: boolean;
}

export interface ImageLayer extends BaseLayer {
  kind: 'image';
  source: LayerSourceReference;
  sourceAdjustments: Adjustments;
  creativeAdjustments: Partial<Adjustments>;
  arrange: LayerArrange;
}

export interface AdjustmentLayer extends BaseLayer {
  kind: 'adjustment';
  creativeAdjustments: Partial<Adjustments>;
}

export type Layer = ImageLayer | AdjustmentLayer;

export interface CompositeAdjustments {
  masks: MaskContainer[];
  aiPatches: AiPatch[];
  crop: Adjustments['crop'];
  geometry: Pick<
    Adjustments,
    | 'rotation'
    | 'flipHorizontal'
    | 'flipVertical'
    | 'orientationSteps'
    | 'transformAutoMode'
    | 'transformGuides'
    | 'transformDistortion'
    | 'transformVertical'
    | 'transformHorizontal'
    | 'transformRotate'
    | 'transformAspect'
    | 'transformScale'
    | 'transformXOffset'
    | 'transformYOffset'
    | 'transformConstrainCrop'
  >;
}

export interface SinglePhotoDocument {
  mode: 'single';
  adjustments: Adjustments;
}

export interface LayeredDocument {
  mode: 'layered';
  documentVersion: typeof LAYER_DOCUMENT_VERSION;
  id: string;
  anchorPath: string;
  canvas: LayerCanvas;
  /** Ordered from the canvas background (index 0) to the frontmost layer. */
  layers: Layer[];
  compositeAdjustments: CompositeAdjustments;
  /** Opaque future fields survive validation and a future persistence round-trip. */
  unknownFields: Record<string, unknown>;
}

export type EditorDocument = SinglePhotoDocument | LayeredDocument;

export type DocumentNormalizationResult = { ok: true; document: EditorDocument } | { ok: false; reason: string };

export const createSinglePhotoDocument = (adjustments: Adjustments): SinglePhotoDocument => ({
  mode: 'single',
  adjustments: normalizeLoadedAdjustments(adjustments),
});

export const getActiveAdjustments = (document: EditorDocument): Adjustments | null =>
  document.mode === 'single' ? document.adjustments : null;

export const updateActiveAdjustments = (
  document: EditorDocument,
  updater: (adjustments: Adjustments) => Adjustments,
): EditorDocument => {
  if (document.mode !== 'single') {
    throw new Error('Layered documents do not have an active adjustment target before Layer Mode UI is implemented.');
  }

  return createSinglePhotoDocument(updater(document.adjustments));
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/**
 * Validates persisted layered data without manufacturing IDs or defaults. That
 * makes malformed documents recoverable instead of silently changing data.
 */
export const normalizeEditorDocument = (value: unknown): DocumentNormalizationResult => {
  if (!isRecord(value)) return { ok: false, reason: 'Document must be an object.' };

  if (value.mode === 'single') {
    if (!isRecord(value.adjustments)) return { ok: false, reason: 'Single-photo document is missing adjustments.' };
    return { ok: true, document: createSinglePhotoDocument(value.adjustments as Adjustments) };
  }

  if (value.mode !== 'layered') return { ok: false, reason: 'Unknown document mode.' };
  if (value.documentVersion !== LAYER_DOCUMENT_VERSION)
    return { ok: false, reason: 'Unsupported layer document version.' };
  if (typeof value.id !== 'string' || !value.id || typeof value.anchorPath !== 'string' || !value.anchorPath) {
    return { ok: false, reason: 'Layered document is missing its identity or anchor path.' };
  }
  if (!isRecord(value.canvas) || !isFiniteNumber(value.canvas.width) || !isFiniteNumber(value.canvas.height)) {
    return { ok: false, reason: 'Layered document has an invalid canvas.' };
  }
  if (!Array.isArray(value.layers)) return { ok: false, reason: 'Layered document layers must be an array.' };

  const ids = new Set<string>();
  for (const layer of value.layers) {
    if (!isRecord(layer) || typeof layer.id !== 'string' || !layer.id || ids.has(layer.id)) {
      return { ok: false, reason: 'Layer identifiers must be present and unique.' };
    }
    if ((layer.kind !== 'image' && layer.kind !== 'adjustment') || !isFiniteNumber(layer.opacity)) {
      return { ok: false, reason: 'Layer has an invalid kind or opacity.' };
    }
    ids.add(layer.id);
  }

  if (!isRecord(value.compositeAdjustments))
    return { ok: false, reason: 'Layered document is missing composite adjustments.' };

  const {
    mode: _mode,
    documentVersion: _documentVersion,
    id,
    anchorPath,
    canvas,
    layers,
    compositeAdjustments,
    ...unknownFields
  } = value;
  return {
    ok: true,
    document: {
      mode: 'layered',
      documentVersion: LAYER_DOCUMENT_VERSION,
      id,
      anchorPath,
      canvas: canvas as unknown as LayerCanvas,
      layers: layers as Layer[],
      compositeAdjustments: compositeAdjustments as unknown as CompositeAdjustments,
      unknownFields,
    },
  };
};
