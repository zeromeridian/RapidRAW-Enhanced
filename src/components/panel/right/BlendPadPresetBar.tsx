import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Switch from '../../ui/Switch';
import { Invokes } from '../../ui/AppProperties';
import { useSettingsStore } from '../../../store/useSettingsStore';
import type { BlendPad } from '../../../utils/adjustments';
import {
  type BlendPadParameter,
  type BlendPadPreset,
  createBlendPadPreset,
  isBlendPadPresetDirty,
  sanitizeBlendPadPresets,
  updateBlendPadPreset,
} from '../../../utils/blendPad';
import NamedPresetBar from './NamedPresetBar';

interface BlendPadPresetBarProps {
  pad: BlendPad;
  parameters: Array<BlendPadParameter>;
  onLoad(preset: BlendPadPreset): void;
  /** The current pad was saved as this new preset: it now belongs to it. */
  onSaved(preset: BlendPadPreset): void;
}

/**
 * Named pad setups, kept in the app settings (only the pad; full looks stay in Presets), on the
 * shared `NamedPresetBar`; a new one can leave the puck out.
 */
export default function BlendPadPresetBar({ pad, parameters, onLoad, onSaved }: BlendPadPresetBarProps) {
  const { t } = useTranslation();
  const appSettings = useSettingsStore((state) => state.appSettings);
  const handleSettingsChange = useSettingsStore((state) => state.handleSettingsChange);
  const [includesPuck, setIncludesPuck] = useState(true);

  // Cleaned against the tools this build offers; until those arrive nothing can be checked.
  const isReady = parameters.length > 0;
  const presets = useMemo(
    () => (isReady ? sanitizeBlendPadPresets(appSettings?.blendPadPresets, parameters) : []),
    [appSettings?.blendPadPresets, isReady, parameters],
  );
  // The pad remembers its preset, so the name stays when the panel is reopened or the photo reloaded.
  const selected = presets.find((preset) => preset.id === pad.presetId) ?? null;

  return (
    <NamedPresetBar
      create={(name) => createBlendPadPreset(name, pad, includesPuck)}
      exportCommand={Invokes.ExportBlendPadPresets}
      importCommand={Invokes.ImportBlendPadPresets}
      isDirty={!!selected && isBlendPadPresetDirty(selected, pad)}
      isReady={isReady}
      labels={{
        placeholder: t('editor.blendPad.presets.placeholder'),
        save: t('editor.blendPad.presets.save'),
        saveTitle: t('editor.blendPad.presets.saveTitle'),
        renameTitle: t('editor.blendPad.presets.renameTitle'),
        deleteTitle: t('editor.blendPad.presets.deleteTitle'),
        deleteMessage: (name) => t('editor.blendPad.presets.deleteMessage', { name }),
        nameConflict: t('editor.blendPad.presets.nameConflict'),
        fileName: t('editor.blendPad.presets.fileName'),
        importNone: t('editor.blendPad.presets.importNone'),
        imported: (count) => t('editor.blendPad.presets.imported', { count }),
      }}
      onLoad={onLoad}
      onPresetsChange={(next) => {
        if (appSettings) void handleSettingsChange({ ...appSettings, blendPadPresets: next });
      }}
      onSaved={onSaved}
      presets={presets}
      sanitize={(values, existing) => sanitizeBlendPadPresets(values, parameters, existing)}
      saveOptions={
        <Switch
          checked={includesPuck}
          label={t('editor.blendPad.presets.includePuck')}
          onChange={setIncludesPuck}
          tooltip={t('editor.blendPad.presets.includePuckHint')}
        />
      }
      selected={selected}
      update={(preset) => updateBlendPadPreset(preset, pad)}
    />
  );
}
