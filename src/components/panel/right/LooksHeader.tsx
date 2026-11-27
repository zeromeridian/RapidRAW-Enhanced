import { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { ParseKeys } from 'i18next';
import { ChevronLeft } from 'lucide-react';
import PanelHeader from '../../ui/PanelHeader';
import SegmentedSwitch from '../../ui/SegmentedSwitch';
import { LooksKind, Panel } from '../../ui/AppProperties';
import { useSettingsStore } from '../../../store/useSettingsStore';
import { useUIStore } from '../../../store/useUIStore';

const LOOKS_KINDS: ReadonlyArray<LooksKind> = ['presets', 'profiles', 'luts'];

/** The Back pill's label per panel a tool row can open Looks from. */
const RETURN_LABELS: Partial<Record<Panel, ParseKeys>> = {
  [Panel.Adjustments]: 'editor.looks.backToAdjustments',
};

/** The kind the Looks tab shows, remembered in the settings. */
export const useLooksKind = () => useSettingsStore((state) => state.appSettings?.looksKind ?? 'presets');

const setLooksKind = (looksKind: LooksKind) => {
  const { appSettings, handleSettingsChange } = useSettingsStore.getState();
  if (appSettings) handleSettingsChange({ ...appSettings, looksKind });
};

/** Opens Looks on `kind` from a tool row, with a Back pill to the panel it came from. */
export const openLooks = (kind: LooksKind) => {
  setLooksKind(kind);
  const { activeRightPanel, setRightPanel, setUI } = useUIStore.getState();
  if (activeRightPanel === Panel.Presets) return;
  setRightPanel(Panel.Presets);
  setUI({ looksReturnPanel: activeRightPanel });
};

interface LooksHeaderProps {
  /** The shown kind's buttons (import, create). */
  actions?: ReactNode;
}

/** The top of the Looks tab: its title with the kind's buttons, and the Presets · Profiles · LUTs switch. */
export default function LooksHeader({ actions }: LooksHeaderProps) {
  const { t } = useTranslation();
  const kind = useLooksKind();
  const returnPanel = useUIStore((state) => state.looksReturnPanel);
  const returnLabel = returnPanel ? RETURN_LABELS[returnPanel] : undefined;
  return (
    <>
      <PanelHeader title={t('editor.looks.title')} actions={actions} />
      {returnPanel && returnLabel && (
        <button
          className="mx-4 compact:mx-3 mt-3 compact:mt-2 self-start flex items-center gap-1 pl-1.5 pr-3 py-1 rounded-full bg-surface text-xs text-text-secondary hover:text-text-primary hover:bg-card-active transition-colors shrink-0"
          onClick={() => useUIStore.getState().setRightPanel(returnPanel)}
        >
          <ChevronLeft size={14} />
          {t(returnLabel)}
        </button>
      )}
      <SegmentedSwitch
        className="px-4 compact:px-3 pt-3 compact:pt-2 shrink-0"
        onChange={setLooksKind}
        options={LOOKS_KINDS.map((value) => ({ value, label: t(`editor.looks.kinds.${value}`) }))}
        value={kind}
      />
    </>
  );
}
