import { v4 as uuidv4 } from 'uuid';
import { Mask, SubMask, SubMaskMode, formatMaskTypeName } from '../components/panel/right/Masks';
import { AiPatch, MaskContainer } from './adjustments';
import { ImageDimensions } from '../hooks/useImageRenderSize';

export const createSubMask = (
  type: Mask,
  imageDimensions: ImageDimensions,
  mode: SubMaskMode = SubMaskMode.Additive,
) => {
  const { width, height } = imageDimensions || { width: 1000, height: 1000 };
  const common = {
    id: uuidv4(),
    visible: true,
    invert: false,
    opacity: 100,
    mode,
    name: formatMaskTypeName(type),
    type,
  };

  switch (type) {
    case Mask.Radial:
      return {
        ...common,
        parameters: {
          centerX: width / 2,
          centerY: height / 2,
          radiusX: width / 4,
          radiusY: width / 4,
          rotation: 0,
          feather: 0.5,
        },
      };
    case Mask.Linear:
      return {
        ...common,
        parameters: { startX: width * 0.25, startY: height / 2, endX: width * 0.75, endY: height / 2, range: 50 },
      };
    case Mask.Brush:
      return { ...common, parameters: { lines: [] } };
    case Mask.Flow:
      return { ...common, parameters: { lines: [], flow: 10 } };
    case Mask.AiSubject:
      return { ...common, parameters: { maskDataBase64: null, grow: 0, feather: 0 } };
    case Mask.AiForeground:
      return { ...common, parameters: { maskDataBase64: null, grow: 0, feather: 0 } };
    case Mask.AiText:
      return { ...common, name: '', parameters: { maskDataBase64: null, prompt: '', grow: 0, feather: 0 } };
    case Mask.QuickEraser:
      return { ...common, parameters: { maskDataBase64: null, grow: 50, feather: 50 } };
    default:
      return { ...common, parameters: {} };
  }
};

const SUB_MASK_DATA_KEYS = ['mask_data_base64', 'maskDataBase64'] as const;

/**
 * Drops the embedded bitmaps of sub-masks whose ids are in `sentIds` (the backend restores
 * them from its cache) and records in `newlySentIds` the ones this payload sends first.
 * Copies only the sub-masks it changes; the input is never modified.
 */
export const stripSentSubMasks = (subMasks: SubMask[], sentIds: Set<string>, newlySentIds?: Set<string>): SubMask[] =>
  subMasks.map((subMask) => {
    if (!subMask?.id || !subMask.parameters) return subMask;
    const dataKeys = SUB_MASK_DATA_KEYS.filter((key) => subMask.parameters[key] != null);
    if (dataKeys.length === 0) return subMask;
    if (!sentIds.has(subMask.id)) {
      newlySentIds?.add(subMask.id);
      return subMask;
    }
    const parameters = { ...subMask.parameters };
    dataKeys.forEach((key) => (parameters[key] = null));
    return { ...subMask, parameters };
  });

/**
 * The adjustments to send to the backend: mask and AI patch bitmaps it already holds are
 * left out, copying only the objects that change (the bitmaps can be megabytes, and this
 * runs for every preview frame).
 */
export const stripSentMaskData = <T extends { masks?: MaskContainer[]; aiPatches?: AiPatch[] }>(
  adjustments: T,
  sentIds: Set<string>,
  newlySentIds?: Set<string>,
): T => {
  const stripContainer = <C extends { subMasks: SubMask[] }>(container: C): C =>
    Array.isArray(container?.subMasks)
      ? { ...container, subMasks: stripSentSubMasks(container.subMasks, sentIds, newlySentIds) }
      : container;

  const payload = { ...adjustments };
  if (Array.isArray(adjustments.masks)) {
    payload.masks = adjustments.masks.map(stripContainer);
  }
  if (Array.isArray(adjustments.aiPatches)) {
    payload.aiPatches = adjustments.aiPatches.map((patch) => {
      let next = patch;
      if (patch?.id && patch.patchData && !patch.isLoading) {
        if (sentIds.has(patch.id)) {
          next = { ...patch, patchData: null };
        } else {
          newlySentIds?.add(patch.id);
        }
      }
      return stripContainer(next);
    });
  }
  return payload;
};
