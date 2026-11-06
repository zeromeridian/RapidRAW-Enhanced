import { useEffect, useState } from 'react';

import { ImageDimensions } from './useImageRenderSize';

interface NaturalSizeState {
  size: ImageDimensions;
  url: string;
}

/** The intrinsic pixel size of the image at `url`, or null until it has loaded. */
export const useImageNaturalSize = (url?: string | null): ImageDimensions | null => {
  const [state, setState] = useState<NaturalSizeState | null>(null);

  useEffect(() => {
    if (!url) return;
    const image = new Image();
    image.onload = () => setState({ size: { width: image.naturalWidth, height: image.naturalHeight }, url });
    image.src = url;
    return () => {
      image.onload = null;
    };
  }, [url]);

  return state && state.url === url ? state.size : null;
};
