import { useImageLoader } from '../../hooks/useImageLoader';
import type { AdjustmentsBaseline } from '../../hooks/useImageProcessing';

interface Props {
  cachedEditStateRef: React.RefObject<any>;
  prevAdjustmentsRef: React.RefObject<AdjustmentsBaseline | null>;
}

export default function ImageLoaderManager({ cachedEditStateRef, prevAdjustmentsRef }: Props) {
  useImageLoader(cachedEditStateRef, prevAdjustmentsRef);

  return null;
}
