import { Crop } from 'react-image-crop';

export function getOrientedDimensions(
  imageWidth: number,
  imageHeight: number,
  orientationSteps: number,
): { width: number; height: number } {
  const isSwapped = orientationSteps === 1 || orientationSteps === 3;
  return {
    width: isSwapped ? imageHeight : imageWidth,
    height: isSwapped ? imageWidth : imageHeight,
  };
}

export function calculateCenteredCrop(
  imageWidth: number,
  imageHeight: number,
  orientationSteps: number,
  aspectRatio: number | null,
  rotation: number = 0,
): Crop | null {
  if (!aspectRatio || aspectRatio <= 0) return null;

  const { width: W, height: H } = getOrientedDimensions(imageWidth, imageHeight, orientationSteps);

  const angle = Math.abs(rotation);
  const rad = ((angle % 180) * Math.PI) / 180;
  const sin = Math.sin(rad);
  const cos = Math.cos(rad);

  const h_c = Math.min(H / (aspectRatio * sin + cos), W / (aspectRatio * cos + sin));
  const w_c = aspectRatio * h_c;

  return {
    unit: 'px',
    x: Math.round((W - w_c) / 2),
    y: Math.round((H - h_c) / 2),
    width: Math.round(w_c),
    height: Math.round(h_c),
  };
}

function isCropWithinBounds(crop: Crop, imageW: number, imageH: number, rotation: number): boolean {
  const cx = imageW / 2;
  const cy = imageH / 2;
  const rad = (-rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const pts = [
    { x: crop.x, y: crop.y },
    { x: crop.x + crop.width, y: crop.y },
    { x: crop.x, y: crop.y + crop.height },
    { x: crop.x + crop.width, y: crop.y + crop.height },
  ];
  for (let i = 0; i < 4; i++) {
    const nx = cos * (pts[i].x - cx) - sin * (pts[i].y - cy) + cx;
    const ny = sin * (pts[i].x - cx) + cos * (pts[i].y - cy) + cy;
    if (nx < -1 || nx > imageW + 1 || ny < -1 || ny > imageH + 1) return false;
  }
  return true;
}

export function calculateAreaPreservingCrop(
  imageWidth: number,
  imageHeight: number,
  orientationSteps: number,
  aspectRatio: number | null,
  rotation: number,
  currentCrop: Crop | null | undefined,
): Crop | null {
  if (!aspectRatio || aspectRatio <= 0 || !currentCrop || !currentCrop.width || !currentCrop.height) return null;

  const { width: W, height: H } = getOrientedDimensions(imageWidth, imageHeight, orientationSteps);

  const area = currentCrop.width * currentCrop.height;
  const newH = Math.sqrt(area / aspectRatio);
  const newW = aspectRatio * newH;
  const centerX = currentCrop.x + currentCrop.width / 2;
  const centerY = currentCrop.y + currentCrop.height / 2;

  const candidate: Crop = {
    unit: 'px',
    x: Math.round(centerX - newW / 2),
    y: Math.round(centerY - newH / 2),
    width: Math.round(newW),
    height: Math.round(newH),
  };

  return isCropWithinBounds(candidate, W, H, rotation) ? candidate : null;
}

export function rotatePoint(x: number, y: number, cx: number, cy: number, degrees: number): [number, number] {
  const rad = (degrees * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const px = x - cx;
  const py = y - cy;
  return [cx + px * cos - py * sin, cy + px * sin + py * cos];
}

export function rotateCropCenter(
  crop: Crop,
  orientedWidth: number,
  orientedHeight: number,
  deltaDegrees: number,
): Crop {
  const [centerX, centerY] = rotatePoint(
    crop.x + crop.width / 2,
    crop.y + crop.height / 2,
    orientedWidth / 2,
    orientedHeight / 2,
    deltaDegrees,
  );
  return {
    unit: 'px',
    x: Math.round(centerX - crop.width / 2),
    y: Math.round(centerY - crop.height / 2),
    width: crop.width,
    height: crop.height,
  };
}

export interface OrientationTransform {
  orientationSteps?: number;
  flipHorizontal?: boolean;
  flipVertical?: boolean;
}

/** Maps a source-normalized point through coarse orientation and flips to display-normalized space. */
export function orientNormalizedPoint(x: number, y: number, transform: OrientationTransform): [number, number] {
  const steps = (transform.orientationSteps || 0) % 4;
  let oriented: [number, number];
  if (steps === 1) oriented = [1 - y, x];
  else if (steps === 2) oriented = [1 - x, 1 - y];
  else if (steps === 3) oriented = [y, 1 - x];
  else oriented = [x, y];
  return [
    transform.flipHorizontal ? 1 - oriented[0] : oriented[0],
    transform.flipVertical ? 1 - oriented[1] : oriented[1],
  ];
}

/** Inverse of {@link orientNormalizedPoint}. */
export function unorientNormalizedPoint(
  displayX: number,
  displayY: number,
  transform: OrientationTransform,
): [number, number] {
  const steps = (transform.orientationSteps || 0) % 4;
  const x = transform.flipHorizontal ? 1 - displayX : displayX;
  const y = transform.flipVertical ? 1 - displayY : displayY;
  if (steps === 1) return [y, 1 - x];
  if (steps === 2) return [1 - x, 1 - y];
  if (steps === 3) return [1 - y, x];
  return [x, y];
}

/** Moves `crop` by the delta as far as it stays inside the rotated image, each axis on its own. */
export function moveCropInsideBounds(
  crop: Crop,
  deltaX: number,
  deltaY: number,
  imageW: number,
  imageH: number,
  rotation: number,
): Crop {
  const fullTarget = { ...crop, x: crop.x + deltaX, y: crop.y + deltaY };
  if (isCropWithinBounds(fullTarget, imageW, imageH, rotation)) {
    return { ...crop, x: Math.round(fullTarget.x), y: Math.round(fullTarget.y) };
  }

  let bestX = crop.x;
  let loX = 0;
  let hiX = 1;
  for (let i = 0; i < 12; i++) {
    const mid = (loX + hiX) / 2;
    const testCrop = { ...crop, x: crop.x + deltaX * mid };
    if (isCropWithinBounds(testCrop, imageW, imageH, rotation)) {
      bestX = testCrop.x;
      loX = mid;
    } else {
      hiX = mid;
    }
  }

  let bestY = crop.y;
  let loY = 0;
  let hiY = 1;
  for (let i = 0; i < 12; i++) {
    const mid = (loY + hiY) / 2;
    const testCrop = { ...crop, x: bestX, y: crop.y + deltaY * mid };
    if (isCropWithinBounds(testCrop, imageW, imageH, rotation)) {
      bestY = testCrop.y;
      loY = mid;
    } else {
      hiY = mid;
    }
  }

  return { ...crop, x: Math.round(bestX), y: Math.round(bestY) };
}

/** Shifts `crop` towards the image centre until it lies inside the rotated image. */
function forceCropInBounds(crop: Crop, imageW: number, imageH: number, rotation: number): Crop {
  if (isCropWithinBounds(crop, imageW, imageH, rotation)) {
    return crop;
  }

  if (rotation === 0) {
    const x = Math.max(0, Math.min(crop.x, imageW - crop.width));
    const y = Math.max(0, Math.min(crop.y, imageH - crop.height));
    return { ...crop, x, y };
  }

  const dx = imageW / 2 - (crop.x + crop.width / 2);
  const dy = imageH / 2 - (crop.y + crop.height / 2);
  let low = 0;
  let high = 1;
  let bestValid = crop;
  for (let i = 0; i < 15; i++) {
    const mid = (low + high) / 2;
    const testCrop = { ...crop, x: crop.x + dx * mid, y: crop.y + dy * mid };
    if (isCropWithinBounds(testCrop, imageW, imageH, rotation)) {
      bestValid = testCrop;
      high = mid;
    } else {
      low = mid;
    }
  }
  return bestValid;
}

/**
 * Scales `crop` by `scaleFactor` around the point (`originX`, `originY`), default its centre, keeping
 * the aspect ratio and a 64 px minimum; a growing crop stops where it would leave the image.
 */
export function zoomCrop(
  crop: Crop,
  scaleFactor: number,
  imageW: number,
  imageH: number,
  rotation: number,
  aspectRatio: number | null,
  originX?: number,
  originY?: number,
): Crop {
  const A = aspectRatio || (crop.height > 0 ? crop.width / crop.height : 1);
  const MIN_SIZE = 64;

  let targetW = crop.width * scaleFactor;
  if (targetW < MIN_SIZE || targetW / A < MIN_SIZE) {
    targetW = Math.max(MIN_SIZE, MIN_SIZE * A);
  }

  const clampedOriginX = Math.max(crop.x, Math.min(crop.x + crop.width, originX ?? crop.x + crop.width / 2));
  const clampedOriginY = Math.max(crop.y, Math.min(crop.y + crop.height, originY ?? crop.y + crop.height / 2));
  const relX = (clampedOriginX - crop.x) / crop.width;
  const relY = (clampedOriginY - crop.y) / crop.height;

  const cropOfWidth = (w: number): Crop => {
    const h = w / A;
    return { unit: 'px', x: clampedOriginX - relX * w, y: clampedOriginY - relY * h, width: w, height: h };
  };

  const clamped = forceCropInBounds(cropOfWidth(targetW), imageW, imageH, rotation);
  if (scaleFactor <= 1 || isCropWithinBounds(clamped, imageW, imageH, rotation)) {
    return clamped;
  }

  let low = crop.width;
  let high = targetW;
  let bestCrop = crop;
  for (let i = 0; i < 15; i++) {
    const mid = (low + high) / 2;
    const candidate = forceCropInBounds(cropOfWidth(mid), imageW, imageH, rotation);
    if (isCropWithinBounds(candidate, imageW, imageH, rotation)) {
      bestCrop = candidate;
      low = mid;
    } else {
      high = mid;
    }
  }
  return bestCrop;
}

/** The crop closest to `to` on the straight path from `from` that `isValid` accepts. */
export function fitCropTowards<T extends Crop>(from: T, to: T, isValid: (crop: T) => boolean): T {
  if (isValid(to)) {
    return to;
  }

  let low = 0;
  let high = 1;
  let bestCrop = from;
  for (let i = 0; i < 15; i++) {
    const mid = (low + high) / 2;
    const testCrop: T = {
      ...from,
      x: from.x + (to.x - from.x) * mid,
      y: from.y + (to.y - from.y) * mid,
      width: from.width + (to.width - from.width) * mid,
      height: from.height + (to.height - from.height) * mid,
    };
    if (isValid(testCrop)) {
      bestCrop = testCrop;
      low = mid;
    } else {
      high = mid;
    }
  }
  return bestCrop;
}
