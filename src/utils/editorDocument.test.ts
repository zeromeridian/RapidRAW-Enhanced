import { describe, expect, it } from 'vitest';
import { INITIAL_ADJUSTMENTS, MaskBlendMode } from './adjustments';
import {
  LAYER_DOCUMENT_VERSION,
  createSinglePhotoDocument,
  getActiveAdjustments,
  normalizeEditorDocument,
  updateActiveAdjustments,
} from './editorDocument';

const layeredDocument = () => ({
  mode: 'layered',
  documentVersion: LAYER_DOCUMENT_VERSION,
  id: 'composition-1',
  anchorPath: '/photos/source.raw',
  canvas: { width: 4000, height: 3000, background: { mode: 'transparent', color: [0, 0, 0, 0] } },
  layers: [
    {
      id: 'layer-1',
      name: 'Source',
      kind: 'image',
      visible: true,
      opacity: 100,
      blendMode: MaskBlendMode.Normal,
      locked: false,
    },
  ],
  compositeAdjustments: {},
  futureDocumentField: { retained: true },
});

describe('editor documents', () => {
  it('normalizes a legacy adjustment payload into a single-photo document', () => {
    const document = createSinglePhotoDocument({ ...INITIAL_ADJUSTMENTS, exposure: 1.25 });

    expect(document.mode).toBe('single');
    expect(document.adjustments.exposure).toBe(1.25);
    expect(getActiveAdjustments(document)?.exposure).toBe(1.25);
  });

  it('keeps an adjustment update immutable', () => {
    const original = createSinglePhotoDocument({ ...INITIAL_ADJUSTMENTS, exposure: 0 });
    const updated = updateActiveAdjustments(original, (adjustments) => ({ ...adjustments, exposure: 2 }));

    expect(original.adjustments.exposure).toBe(0);
    expect(getActiveAdjustments(updated)?.exposure).toBe(2);
  });

  it('accepts a valid layered document and retains unknown fields', () => {
    const result = normalizeEditorDocument(layeredDocument());

    expect(result.ok).toBe(true);
    if (!result.ok || result.document.mode !== 'layered') return;

    expect(result.document.unknownFields).toEqual({ futureDocumentField: { retained: true } });
  });

  it('rejects duplicate layer identifiers without normalizing the document', () => {
    const document = layeredDocument();
    document.layers.push({ ...document.layers[0] });

    expect(normalizeEditorDocument(document)).toMatchObject({
      ok: false,
      reason: 'Layer identifiers must be present and unique.',
    });
  });

  it('rejects an unsupported layered-document version', () => {
    const document = layeredDocument();
    document.documentVersion = LAYER_DOCUMENT_VERSION + 1;

    expect(normalizeEditorDocument(document)).toMatchObject({
      ok: false,
      reason: 'Unsupported layer document version.',
    });
  });
});
