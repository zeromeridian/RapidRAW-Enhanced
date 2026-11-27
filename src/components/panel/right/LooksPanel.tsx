import PresetsPanel from './PresetsPanel';
import ProfilesBrowser from './ProfilesBrowser';
import LooksHeader, { useLooksKind } from './LooksHeader';
import LutTool from '../../adjustments/LutTool';
import { useAdjustmentSectionProps } from '../../../hooks/useAdjustmentSectionProps';

interface LooksPanelProps {
  onNavigateToCommunity(): void;
}

/** LUTs in Looks, as Look → LUT shows them until they get their own browser (`LOOKS_BROWSER_PLAN.md` phase 3). */
function LutsInLooks() {
  const { adjustments, setAdjustments, handleLutSelect, onLutHover, onDragStateChange } = useAdjustmentSectionProps();
  return (
    <div className="flex flex-col h-full">
      <LooksHeader />
      <div className="grow overflow-y-auto p-4 compact:p-2 flex flex-col">
        <LutTool
          adjustments={adjustments}
          setAdjustments={setAdjustments}
          handleLutSelect={handleLutSelect}
          onLutHover={onLutHover}
          onDragStateChange={onDragStateChange}
        />
      </div>
    </div>
  );
}

/** Develop's Looks tab (`Panel.Presets`): presets, custom profiles and LUTs, one kind at a time. */
export default function LooksPanel({ onNavigateToCommunity }: LooksPanelProps) {
  const kind = useLooksKind();
  if (kind === 'profiles') return <ProfilesBrowser />;
  if (kind === 'luts') return <LutsInLooks />;
  return <PresetsPanel onNavigateToCommunity={onNavigateToCommunity} />;
}
