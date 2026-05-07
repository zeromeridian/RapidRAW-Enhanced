import { useImageLoader } from '../../hooks/useImageLoader';

interface Props {
  cachedEditStateRef: React.MutableRefObject<any>;
}

export default function ImageLoaderManager({ cachedEditStateRef }: Props) {
  useImageLoader(cachedEditStateRef);

  return null;
}
