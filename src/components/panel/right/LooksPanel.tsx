import PresetsPanel from './PresetsPanel';
import LooksHeader, { useLooksKind } from './LooksHeader';
import ProfilePanel from '../../adjustments/Profile';
import LutTool from '../../adjustments/LutTool';
import { useAdjustmentSectionProps } from '../../../hooks/useAdjustmentSectionProps';

interface LooksPanelProps {
  onNavigateToCommunity(): void;
}

/**
 * Profiles and LUTs in Looks, as their tools show them until they get their own browsers
 * (`LOOKS_BROWSER_PLAN.md` phases 2 and 3).
 */
function LooksTools() {
  const kind = useLooksKind();
  const { adjustments, setAdjustments, handleLutSelect, onLutHover, onDragStateChange } = useAdjustmentSectionProps();
  return (
    <div className="flex flex-col h-full">
      <LooksHeader />
      <div className="grow overflow-y-auto p-4 compact:p-2 flex flex-col">
        {kind === 'profiles' ? (
          <ProfilePanel
            adjustments={adjustments}
            setAdjustments={setAdjustments}
            onDragStateChange={onDragStateChange}
          />
        ) : (
          <LutTool
            adjustments={adjustments}
            setAdjustments={setAdjustments}
            handleLutSelect={handleLutSelect}
            onLutHover={onLutHover}
            onDragStateChange={onDragStateChange}
          />
        )}
      </div>
    </div>
  );
}

/** Develop's Looks tab (`Panel.Presets`): presets, custom profiles and LUTs, one kind at a time. */
export default function LooksPanel({ onNavigateToCommunity }: LooksPanelProps) {
  const kind = useLooksKind();
  return kind === 'presets' ? <PresetsPanel onNavigateToCommunity={onNavigateToCommunity} /> : <LooksTools />;
}
