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

/**
 * The minimum distance between the fitted image and the window edges. Percent values are of the window's short
 * edge. A side only takes effect where the container reaches closer to that window edge than the frame.
 */
export interface WindowFrame {
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

interface RenderSizeState {
  key: string;
  size: RenderSize;
}

export const useImageRenderSize = (
  containerRef: React.RefObject<HTMLElement | null>,
  imageDimensions: ImageDimensions | null,
  windowFrame?: WindowFrame,
  imageKey?: string,
) => {
  const imgWidth = imageDimensions?.width;
  const imgHeight = imageDimensions?.height;
  const renderKey = [
    imageKey ?? '',
    imgWidth ?? 0,
    imgHeight ?? 0,
    windowFrame?.unit ?? 'none',
    windowFrame?.top ?? 0,
    windowFrame?.right ?? 0,
    windowFrame?.bottom ?? 0,
    windowFrame?.left ?? 0,
  ].join(':');
  const [renderState, setRenderState] = useState<RenderSizeState>({ key: '', size: DEFAULT_SIZE });

  useLayoutEffect(() => {
    const container = containerRef.current;

    if (!container || !imgWidth || !imgHeight) {
      setRenderState({ key: renderKey, size: DEFAULT_SIZE });
      return;
    }

    const updateSize = () => {
      const { clientWidth: containerWidth, clientHeight: containerHeight } = container;
      const bounds = container.getBoundingClientRect();
      const { innerWidth: windowWidth, innerHeight: windowHeight } = window;
      const frameScale = windowFrame?.unit === 'percent' ? Math.min(windowWidth, windowHeight) / 100 : 1;
      const insetTop = Math.max(0, (windowFrame?.top ?? 0) * frameScale - bounds.top);
      const insetRight = Math.max(0, (windowFrame?.right ?? 0) * frameScale - (windowWidth - bounds.right));
      const insetBottom = Math.max(0, (windowFrame?.bottom ?? 0) * frameScale - (windowHeight - bounds.bottom));
      const insetLeft = Math.max(0, (windowFrame?.left ?? 0) * frameScale - bounds.left);
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
    // The frame depends on the container's place in the window, which can change without a resize.
    if (windowFrame?.unit) window.addEventListener('resize', updateSize);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', updateSize);
    };
  }, [
    containerRef,
    imgWidth,
    imgHeight,
    windowFrame?.unit,
    windowFrame?.top,
    windowFrame?.right,
    windowFrame?.bottom,
    windowFrame?.left,
    renderKey,
  ]);

  return renderState.key === renderKey ? renderState.size : DEFAULT_SIZE;
};
