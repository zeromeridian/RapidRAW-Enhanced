import AdjustmentTool from './AdjustmentTool';
import LUTControl from '../ui/LUTControl';
import { Adjustments } from '../../utils/adjustments';

interface LutToolProps {
  adjustments: Adjustments;
  setAdjustments(updater: (prev: Partial<Adjustments>) => Partial<Adjustments>): void;
  handleLutSelect(path: string): void;
  onLutHover?: (path: string | null) => void;
  onDragStateChange?: (isDragging: boolean) => void;
}

/** Look → LUT: the photo's finishing LUT and its Intensity (also shown in Looks → LUTs). */
export default function LutTool({
  adjustments,
  setAdjustments,
  handleLutSelect,
  onLutHover,
  onDragStateChange,
}: LutToolProps) {
  return (
    <AdjustmentTool id="lut">
      <LUTControl
        lutPath={adjustments.lutPath || null}
        lutName={adjustments.lutName || null}
        lutIntensity={adjustments.lutIntensity ?? 100}
        onLutSelect={handleLutSelect}
        onLutHover={onLutHover}
        onIntensityChange={(lutIntensity) => setAdjustments((prev) => ({ ...prev, lutIntensity }))}
        onClear={() =>
          setAdjustments((prev) => ({
            ...prev,
            lutPath: null,
            lutName: null,
            lutData: null,
            lutSize: 0,
            lutIntensity: 100,
          }))
        }
        onDragStateChange={onDragStateChange}
      />
    </AdjustmentTool>
  );
}
