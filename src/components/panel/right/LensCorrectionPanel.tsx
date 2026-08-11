import LensCorrectionModal from '../../modals/LensCorrectionModal';
import { useEditorActions } from '../../../hooks/useEditorActions';
import { useEditorStore } from '../../../store/useEditorStore';
import { Adjustments } from '../../../utils/adjustments';

export default function LensCorrectionPanel() {
  const selectedImage = useEditorStore((state) => state.selectedImage);
  const adjustments = useEditorStore((state) => state.adjustments);
  const { setAdjustments } = useEditorActions();

  return (
    <LensCorrectionModal
      inline
      isOpen
      onClose={() => undefined}
      onApply={(parameters) =>
        setAdjustments((previous: Adjustments) => ({
          ...previous,
          ...parameters,
        }))
      }
      currentAdjustments={adjustments}
      selectedImage={selectedImage}
    />
  );
}
