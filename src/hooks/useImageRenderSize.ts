import { useState, useLayoutEffect } from 'react';

export interface ImageDimensions {
  height: number;
  width: number;
}

export interface RenderSize {
  containerHeight: number;
  containerWidth: number;
  height: number;
  offsetX: number;
  offsetY: number;
  scale: number;
  width: number;
}

export interface RenderInsets {
  unit: 'percent' | 'pixels';
  top: number;
  right: number;
  bottom: number;
  left: number;
}

const DEFAULT_SIZE: RenderSize = {
  width: 0,
  height: 0,
  scale: 1,
  offsetX: 0,
  offsetY: 0,
  containerWidth: 0,
  containerHeight: 0,
};

export const useImageRenderSize = (
  containerRef: React.RefObject<HTMLElement | null>,
  imageDimensions: ImageDimensions | null,
  insets?: RenderInsets,
) => {
  const [renderSize, setRenderSize] = useState<RenderSize>(DEFAULT_SIZE);
  const imgWidth = imageDimensions?.width;
  const imgHeight = imageDimensions?.height;

  useLayoutEffect(() => {
    const container = containerRef.current;

    if (!container || !imgWidth || !imgHeight) {
      setRenderSize(DEFAULT_SIZE);
      return;
    }

    const updateSize = () => {
      const { clientWidth: containerWidth, clientHeight: containerHeight } = container;
      const insetScale = insets?.unit === 'percent' ? Math.min(containerWidth, containerHeight) / 100 : 1;
      const insetTop = Math.max(0, (insets?.top ?? 0) * insetScale);
      const insetRight = Math.max(0, (insets?.right ?? 0) * insetScale);
      const insetBottom = Math.max(0, (insets?.bottom ?? 0) * insetScale);
      const insetLeft = Math.max(0, (insets?.left ?? 0) * insetScale);
      const availableWidth = Math.max(1, containerWidth - insetLeft - insetRight);
      const availableHeight = Math.max(1, containerHeight - insetTop - insetBottom);
      const imageAspectRatio = imgWidth / imgHeight;
      const containerAspectRatio = availableWidth / availableHeight;

      let width, height;
      if (imageAspectRatio > containerAspectRatio) {
        width = availableWidth;
        height = availableWidth / imageAspectRatio;
      } else {
        height = availableHeight;
        width = availableHeight * imageAspectRatio;
      }

      const offsetX = insetLeft + (availableWidth - width) / 2;
      const offsetY = insetTop + (availableHeight - height) / 2;

      setRenderSize({ width, height, scale: width / imgWidth, offsetX, offsetY, containerWidth, containerHeight });
    };

    updateSize();

    const resizeObserver = new ResizeObserver(() => {
      updateSize();
    });

    resizeObserver.observe(container);

    return () => resizeObserver.disconnect();
  }, [containerRef, imgWidth, imgHeight, insets?.unit, insets?.top, insets?.right, insets?.bottom, insets?.left]);

  return renderSize;
};
