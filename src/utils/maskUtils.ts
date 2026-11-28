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

/** Components painted on one photo; presets and copied settings leave them out (owner, Plan item 90). */
const PAINTED_SUB_MASK_TYPES: ReadonlySet<string> = new Set([
  Mask.Brush,
  Mask.Flow,
  Mask.QuickEraser,
  Mask.Clone,
  Mask.Heal,
]);

/** Components whose bitmap an AI model makes from the photo. */
const AI_SUB_MASK_TYPES: ReadonlySet<string> = new Set([
  Mask.AiSubject,
  Mask.AiForeground,
  Mask.AiSky,
  Mask.AiText,
  Mask.AiDepth,
]);

const mapSubMasks = (masks: MaskContainer[], change: (subMask: SubMask) => SubMask): MaskContainer[] =>
  masks.map((container) => ({ ...container, subMasks: (container.subMasks ?? []).map(change) }));

const hasBitmap = (subMask: SubMask) => SUB_MASK_DATA_KEYS.some((key) => subMask.parameters?.[key] != null);

/** Whether any of `masks` has a painted component, which presets and copied settings leave out. */
export const hasPaintedSubMasks = (masks: MaskContainer[] | undefined): boolean =>
  !!masks?.some((container) => container.subMasks?.some((subMask) => PAINTED_SUB_MASK_TYPES.has(subMask.type)));

const withoutAiBitmap = (subMask: SubMask): SubMask => {
  if (!AI_SUB_MASK_TYPES.has(subMask.type) || !hasBitmap(subMask)) return subMask;
  const parameters = { ...subMask.parameters };
  SUB_MASK_DATA_KEYS.forEach((key) => {
    if (key in parameters) parameters[key] = null;
  });
  return { ...subMask, parameters };
};

/**
 * Masks without the bitmaps their AI components were made with for their photo; each photo they
 * are applied to makes its own (Plan item 90). Develop Auto Sync sends masks so: its photos are a
 * matched set, so painted parts stay (owner 2026-11-27).
 */
export const withoutAiBitmaps = (masks: MaskContainer[]): MaskContainer[] => mapSubMasks(masks, withoutAiBitmap);

/**
 * Components whose parameters are pixels of the photo they were drawn on: the uncropped photo
 * after its quarter turns. Each records that size as `imageSize` (Plan item 91); without it
 * (made before `1.125.3`) its pixels are applied as they are. Mirrors `SIZED_MASK_TYPES` and
 * `fit_masks_to_image` in `ai_commands.rs`, which fit masks for photos not open in Develop.
 */
const SIZED_SUB_MASK_TYPES: ReadonlySet<string> = new Set([Mask.Radial, Mask.Linear, Mask.AiSubject]);
const X_PARAMETERS = ['centerX', 'startX', 'endX'];
const Y_PARAMETERS = ['centerY', 'startY', 'endY'];
/** Lengths follow the short side, as a new Linear mask's range does. */
const LENGTH_PARAMETERS = ['radiusX', 'radiusY', 'range'];

/** The size mask coordinates refer to: the photo (`width` × `height` as decoded) after `orientationSteps` quarter turns. */
export const maskImageSize = (
  image: { width: number; height: number } | null | undefined,
  orientationSteps = 0,
): ImageDimensions | null => {
  if (!image?.width || !image?.height) return null;
  return orientationSteps % 2 === 1
    ? { width: image.height, height: image.width }
    : { width: image.width, height: image.height };
};

/** `subMask` recording `size` as the photo its pixels refer to, when it is a shape. */
export const withImageSize = (subMask: SubMask, size: ImageDimensions): SubMask =>
  SIZED_SUB_MASK_TYPES.has(subMask.type)
    ? { ...subMask, parameters: { ...subMask.parameters, imageSize: { width: size.width, height: size.height } } }
    : subMask;

/** `subMask` scaled to a photo of `size` from the size it records (positions per axis, lengths by the short side). */
const fitSubMaskToImage = (subMask: SubMask, size: ImageDimensions): SubMask => {
  const from = subMask.parameters?.imageSize;
  if (!SIZED_SUB_MASK_TYPES.has(subMask.type) || !(from?.width > 0) || !(from?.height > 0)) return subMask;
  const parameters = { ...subMask.parameters };
  const scale = (keys: string[], factor: number) =>
    keys.forEach((key) => {
      if (typeof parameters[key] === 'number') parameters[key] *= factor;
    });
  scale(X_PARAMETERS, size.width / from.width);
  scale(Y_PARAMETERS, size.height / from.height);
  scale(LENGTH_PARAMETERS, Math.min(size.width, size.height) / Math.min(from.width, from.height));
  return withImageSize({ ...subMask, parameters }, size);
};

/** `masks` with their shapes fitted to a photo of `size` (`maskImageSize`); as they are without a size. */
export const fitMasksToImage = (masks: MaskContainer[], size: ImageDimensions | null | undefined): MaskContainer[] =>
  size ? mapSubMasks(masks, (subMask) => fitSubMaskToImage(subMask, size)) : masks;

/**
 * Masks as presets and copied settings hold them (Plan item 90): without AI bitmaps
 * (`withoutAiBitmaps`), without painted components, and without masks left with none. With
 * `sourceSize`, the photo they come from, their shapes record it (Plan item 91).
 */
export const toPortableMasks = (masks: MaskContainer[], sourceSize?: ImageDimensions | null): MaskContainer[] =>
  withoutAiBitmaps(masks)
    .map((container) => ({
      ...container,
      subMasks: container.subMasks
        .filter((subMask) => !PAINTED_SUB_MASK_TYPES.has(subMask.type))
        .map((subMask) => (sourceSize ? withImageSize(subMask, sourceSize) : subMask)),
    }))
    .filter((container) => container.subMasks.length > 0);

/**
 * Portable masks with new ids, to apply to a photo: the backend restores a missing bitmap by its
 * component's id (`hydrate_sub_masks`), so a kept id could bring back another photo's. With
 * `targetSize`, the photo's mask size (`maskImageSize`), their shapes are fitted to it.
 */
export const masksForApplying = (masks: MaskContainer[], targetSize?: ImageDimensions | null): MaskContainer[] =>
  mapSubMasks(fitMasksToImage(toPortableMasks(masks), targetSize), (subMask) => ({ ...subMask, id: uuidv4() })).map(
    (container) => ({ ...container, id: uuidv4() }),
  );

/** `adjustments` with its masks changed by `change` (`toPortableMasks`, `masksForApplying`); as is without masks. */
export const withMasks = <T extends { masks?: MaskContainer[] }>(
  adjustments: T,
  change: (masks: MaskContainer[]) => MaskContainer[],
): T => (Array.isArray(adjustments.masks) ? { ...adjustments, masks: change(adjustments.masks) } : adjustments);

/**
 * The AI components of `masks` that have no bitmap yet but can be made: a Subject mask needs its
 * drawn box, a Text mask its words (as `ai_mask_inputs` in `ai_commands.rs` decides for batches).
 */
export const aiSubMasksToMake = (masks: MaskContainer[] | undefined): SubMask[] =>
  (masks ?? [])
    .flatMap((container) => container.subMasks ?? [])
    .filter((subMask) => {
      if (!AI_SUB_MASK_TYPES.has(subMask.type) || hasBitmap(subMask)) return false;
      const parameters = subMask.parameters ?? {};
      if (subMask.type === Mask.AiSubject) {
        return ['startX', 'startY', 'endX', 'endY'].every((key) => typeof parameters[key] === 'number');
      }
      if (subMask.type === Mask.AiText) return !!parameters.prompt?.trim();
      return true;
    });

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
