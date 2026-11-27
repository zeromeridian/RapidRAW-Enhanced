import PresetsPanel from './PresetsPanel';
import ProfilesBrowser from './ProfilesBrowser';
import LutsBrowser from './LutsBrowser';
import { useLooksKind } from './LooksHeader';

interface LooksPanelProps {
  onNavigateToCommunity(): void;
}

/** Develop's Looks tab (`Panel.Presets`): presets, custom profiles and LUTs, one kind at a time. */
export default function LooksPanel({ onNavigateToCommunity }: LooksPanelProps) {
  const kind = useLooksKind();
  if (kind === 'profiles') return <ProfilesBrowser />;
  if (kind === 'luts') return <LutsBrowser />;
  return <PresetsPanel onNavigateToCommunity={onNavigateToCommunity} />;
}
