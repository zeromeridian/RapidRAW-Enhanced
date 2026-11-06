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

const DEFAULT_SIZE: RenderSize = {
  width: 0,
  height: 0,
  scale: 1,
  offsetX: 0,
  offsetY: 0,
  containerWidth: 0,
  containerHeight: 0,
};

interface RenderSizeState {
  key: string;
  size: RenderSize;
}

export const useImageRenderSize = (
  containerRef: React.RefObject<HTMLElement | null>,
  imageDimensions: ImageDimensions | null,
  /** Space kept free on every side of the fitted image, in pixels. */
  inset = 0,
  imageKey?: string,
) => {
  const imgWidth = imageDimensions?.width;
  const imgHeight = imageDimensions?.height;
  const renderKey = [imageKey ?? '', imgWidth ?? 0, imgHeight ?? 0, inset].join(':');
  const [renderState, setRenderState] = useState<RenderSizeState>({ key: '', size: DEFAULT_SIZE });

  useLayoutEffect(() => {
    const container = containerRef.current;

    if (!container || !imgWidth || !imgHeight) {
      setRenderState({ key: renderKey, size: DEFAULT_SIZE });
      return;
    }

    const updateSize = () => {
      const { clientWidth: containerWidth, clientHeight: containerHeight } = container;
      const availableWidth = Math.max(1, containerWidth - 2 * inset);
      const availableHeight = Math.max(1, containerHeight - 2 * inset);
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

      const offsetX = inset + (availableWidth - width) / 2;
      const offsetY = inset + (availableHeight - height) / 2;

      setRenderState({
        key: renderKey,
        size: { width, height, scale: width / imgWidth, offsetX, offsetY, containerWidth, containerHeight },
      });
    };

    updateSize();

    const resizeObserver = new ResizeObserver(() => {
      updateSize();
    });

    resizeObserver.observe(container);

    return () => resizeObserver.disconnect();
  }, [containerRef, imgWidth, imgHeight, inset, renderKey]);

  return renderState.key === renderKey ? renderState.size : DEFAULT_SIZE;
};
