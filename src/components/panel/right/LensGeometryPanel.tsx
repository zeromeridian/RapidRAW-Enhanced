import { useTranslation } from 'react-i18next';
import PanelHeader from '../../ui/PanelHeader';
import ChromaticAberration from '../../adjustments/ChromaticAberration';
import { AdjustmentPanelContext } from '../../adjustments/AdjustmentTool';
import LensCorrection, { LensNotices, LensParams } from './LensCorrection';
import Perspective from './Perspective';
import { useAdjustmentSectionProps } from '../../../hooks/useAdjustmentSectionProps';
import { useEditorStore } from '../../../store/useEditorStore';
import { Adjustments, DetailsAdjustment, INITIAL_ADJUSTMENTS } from '../../../utils/adjustments';

const LENS_GEOMETRY_CONTEXT = { canFavorite: true };

/** Lens & Geometry: the lens profile, chromatic aberration and perspective, all applied live. */
export default function LensGeometryPanel() {
  const { t } = useTranslation();
  const selectedImage = useEditorStore((state) => state.selectedImage);
  const { adjustments, setAdjustments, onDragStateChange } = useAdjustmentSectionProps();

  const applyLens = (params: LensParams) => setAdjustments((previous: Adjustments) => ({ ...previous, ...params }));

  return (
    <div className="flex flex-col h-full">
      <PanelHeader title={t('editor.adjustments.sections.lensGeometry')} />
      <AdjustmentPanelContext.Provider value={LENS_GEOMETRY_CONTEXT}>
        <div className="grow overflow-y-auto p-4 compact:p-2.5 flex flex-col gap-6 compact:gap-3 text-text-secondary">
          <LensCorrection
            adjustments={adjustments}
            onChange={applyLens}
            onReset={(params) =>
              setAdjustments((previous: Adjustments) => ({
                ...previous,
                ...params,
                [DetailsAdjustment.ChromaticAberrationRedCyan]: INITIAL_ADJUSTMENTS.chromaticAberrationRedCyan,
                [DetailsAdjustment.ChromaticAberrationBlueYellow]: INITIAL_ADJUSTMENTS.chromaticAberrationBlueYellow,
              }))
            }
            selectedImage={selectedImage}
          >
            <ChromaticAberration
              adjustments={adjustments}
              onDragStateChange={onDragStateChange}
              setAdjustments={setAdjustments}
            />
          </LensCorrection>
          <Perspective />
          <LensNotices hasMasks={adjustments.masks.length > 0} />
        </div>
      </AdjustmentPanelContext.Provider>
    </div>
  );
}
