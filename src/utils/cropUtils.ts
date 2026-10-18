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
