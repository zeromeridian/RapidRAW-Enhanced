import { useImageProcessing } from '../../hooks/useImageProcessing';

interface Props {
  transformWrapperRef: React.MutableRefObject<any>;
  prevAdjustmentsRef: React.MutableRefObject<any>;
  previewJobIdRef: React.MutableRefObject<number>;
  latestRenderedJobIdRef: React.MutableRefObject<number>;
  currentResRef: React.MutableRefObject<number>;
}

export default function ImageProcessingManager(props: Props) {
  useImageProcessing(props.transformWrapperRef, props.prevAdjustmentsRef, {
    previewJobIdRef: props.previewJobIdRef,
    latestRenderedJobIdRef: props.latestRenderedJobIdRef,
    currentResRef: props.currentResRef,
  });

  return null;
}
