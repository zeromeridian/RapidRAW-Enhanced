import { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import PanelHeader from '../../ui/PanelHeader';
import SegmentedSwitch from '../../ui/SegmentedSwitch';
import { LooksKind } from '../../ui/AppProperties';
import { useSettingsStore } from '../../../store/useSettingsStore';

const LOOKS_KINDS: ReadonlyArray<LooksKind> = ['presets', 'profiles', 'luts'];

/** The kind the Looks tab shows, remembered in the settings. */
export const useLooksKind = () => useSettingsStore((state) => state.appSettings?.looksKind ?? 'presets');

const setLooksKind = (looksKind: LooksKind) => {
  const { appSettings, handleSettingsChange } = useSettingsStore.getState();
  if (appSettings) handleSettingsChange({ ...appSettings, looksKind });
};

interface LooksHeaderProps {
  /** The shown kind's buttons (import, create). */
  actions?: ReactNode;
}

/** The top of the Looks tab: its title with the kind's buttons, and the Presets · Profiles · LUTs switch. */
export default function LooksHeader({ actions }: LooksHeaderProps) {
  const { t } = useTranslation();
  const kind = useLooksKind();
  return (
    <>
      <PanelHeader title={t('editor.looks.title')} actions={actions} />
      <SegmentedSwitch
        className="px-4 compact:px-3 pt-3 compact:pt-2 shrink-0"
        onChange={setLooksKind}
        options={LOOKS_KINDS.map((value) => ({ value, label: t(`editor.looks.kinds.${value}`) }))}
        value={kind}
      />
    </>
  );
}
