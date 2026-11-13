import { useMemo, useState } from 'react';
import type { MouseEvent } from 'react';
import { Download, FolderInput, MoreHorizontal, Pencil, Save, Trash2, Upload } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog';
import { toast } from 'react-toastify';
import Dropdown from '../../ui/Dropdown';
import Switch from '../../ui/Switch';
import ConfirmModal from '../../modals/ConfirmModal';
import PresetNameModal from '../../modals/PresetNameModal';
import { Invokes, OPTION_SEPARATOR } from '../../ui/AppProperties';
import { useContextMenu } from '../../../context/ContextMenuContext';
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

const JSON_FILTERS = [{ name: 'JSON', extensions: ['json'] }];

const buttonClass =
  'w-9 h-9 compact:w-7 compact:h-7 shrink-0 rounded-md bg-surface text-text-secondary hover:text-text-primary hover:bg-bg-primary transition-colors flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed';

interface BlendPadPresetBarProps {
  pad: BlendPad;
  parameters: Array<BlendPadParameter>;
  onLoad(preset: BlendPadPreset): void;
}

type NameModal = { kind: 'save' } | { kind: 'rename'; preset: BlendPadPreset } | null;

/**
 * Named pad setups, kept in the app settings (only the pad; full looks stay in Presets): pick
 * one to load it, save the current pad, update, rename, delete, export and import JSON.
 */
export default function BlendPadPresetBar({ pad, parameters, onLoad }: BlendPadPresetBarProps) {
  const { t } = useTranslation();
  const { showContextMenu } = useContextMenu();
  const appSettings = useSettingsStore((state) => state.appSettings);
  const handleSettingsChange = useSettingsStore((state) => state.handleSettingsChange);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [nameModal, setNameModal] = useState<NameModal>(null);
  const [includesPuck, setIncludesPuck] = useState(true);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);

  // Cleaned against the tools this build offers; until those arrive nothing can be checked.
  const isReady = parameters.length > 0;
  const presets = useMemo(
    () => (isReady ? sanitizeBlendPadPresets(appSettings?.blendPadPresets, parameters) : []),
    [appSettings?.blendPadPresets, isReady, parameters],
  );
  const selected = presets.find((preset) => preset.id === selectedId) ?? null;
  const isDirty = !!selected && isBlendPadPresetDirty(selected, pad);
  const options = useMemo(() => presets.map((preset) => ({ label: preset.name, value: preset.id })), [presets]);

  const savePresets = (next: Array<BlendPadPreset>) => {
    if (appSettings) void handleSettingsChange({ ...appSettings, blendPadPresets: next });
  };

  const handleLoad = (id: string) => {
    const preset = presets.find((candidate) => candidate.id === id);
    if (!preset) return;
    setSelectedId(id);
    onLoad(preset);
  };

  const handleSaveNew = (name: string) => {
    const preset = createBlendPadPreset(name, pad, includesPuck);
    savePresets([...presets, preset]);
    setSelectedId(preset.id);
  };

  const handleUpdate = () => {
    if (!selected) return;
    savePresets(presets.map((preset) => (preset.id === selected.id ? updateBlendPadPreset(preset, pad) : preset)));
  };

  const handleRename = (preset: BlendPadPreset, name: string) =>
    savePresets(presets.map((candidate) => (candidate.id === preset.id ? { ...candidate, name } : candidate)));

  const handleDelete = () => {
    if (!selected) return;
    savePresets(presets.filter((preset) => preset.id !== selected.id));
    setSelectedId(null);
  };

  const handleExport = async (toExport: Array<BlendPadPreset>) => {
    try {
      const filePath = await saveDialog({
        defaultPath: `${toExport.length === 1 ? toExport[0].name : t('editor.blendPad.presets.fileName')}.json`,
        filters: JSON_FILTERS,
        title: t('editor.blendPad.presets.export'),
      });
      if (!filePath) return;
      await invoke(Invokes.ExportBlendPadPresets, { presets: toExport, filePath });
    } catch (error) {
      toast.error(String(error));
    }
  };

  const handleImport = async () => {
    try {
      const filePath = await openDialog({
        filters: JSON_FILTERS,
        multiple: false,
        title: t('editor.blendPad.presets.import'),
      });
      if (typeof filePath !== 'string') return;
      const values = await invoke<Array<unknown>>(Invokes.ImportBlendPadPresets, { filePath });
      // Every imported preset is cleaned; clashing names get a number.
      const imported = sanitizeBlendPadPresets(values, parameters, presets);
      if (imported.length === 0) {
        toast.warn(t('editor.blendPad.presets.importNone'));
        return;
      }
      savePresets([...presets, ...imported]);
      toast.success(t('editor.blendPad.presets.imported', { count: imported.length }));
    } catch (error) {
      toast.error(String(error));
    }
  };

  const openMoreMenu = (event: MouseEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    showContextMenu(rect.left, rect.bottom, [
      {
        label: t('editor.blendPad.presets.saveAsNew'),
        icon: Save,
        onClick: () => setNameModal({ kind: 'save' }),
      },
      {
        label: t('editor.blendPad.presets.rename'),
        icon: Pencil,
        disabled: !selected,
        onClick: () => selected && setNameModal({ kind: 'rename', preset: selected }),
      },
      {
        label: t('editor.blendPad.presets.delete'),
        icon: Trash2,
        isDestructive: true,
        disabled: !selected,
        onClick: () => setIsDeleteOpen(true),
      },
      { type: OPTION_SEPARATOR },
      {
        label: t('editor.blendPad.presets.export'),
        icon: Upload,
        disabled: !selected,
        onClick: () => selected && void handleExport([selected]),
      },
      {
        label: t('editor.blendPad.presets.exportAll'),
        icon: Upload,
        disabled: presets.length === 0,
        onClick: () => void handleExport(presets),
      },
      {
        label: t('editor.blendPad.presets.import'),
        icon: FolderInput,
        onClick: () => void handleImport(),
      },
    ]);
  };

  const existingNames = presets
    .filter((preset) => nameModal?.kind !== 'rename' || preset.id !== nameModal.preset.id)
    .map((preset) => preset.name);

  return (
    <div className="flex items-center gap-1">
      <Dropdown
        className="grow min-w-0"
        disabled={!isReady || presets.length === 0}
        onChange={handleLoad}
        options={options}
        placeholder={t('editor.blendPad.presets.placeholder')}
        selectedSuffix={
          isDirty ? (
            <span
              aria-label={t('editor.blendPad.presets.modified')}
              className="font-bold text-red-500"
              data-tooltip={t('editor.blendPad.presets.modified')}
            >
              *
            </span>
          ) : undefined
        }
        value={selected ? selected.id : null}
      />
      <button
        className={buttonClass}
        data-tooltip={isDirty ? t('editor.blendPad.presets.update') : t('editor.blendPad.presets.save')}
        disabled={!isReady}
        onClick={() => (isDirty ? handleUpdate() : setNameModal({ kind: 'save' }))}
        type="button"
      >
        {isDirty ? <Download size={16} /> : <Save size={16} />}
      </button>
      <button
        className={buttonClass}
        data-tooltip={t('editor.blendPad.presets.more')}
        disabled={!isReady}
        onClick={openMoreMenu}
        type="button"
      >
        <MoreHorizontal size={16} />
      </button>

      <PresetNameModal
        confirmLabel={
          nameModal?.kind === 'rename' ? t('editor.blendPad.presets.rename') : t('editor.blendPad.presets.save')
        }
        conflictMessage={t('editor.blendPad.presets.nameConflict')}
        existingNames={existingNames}
        initialName={nameModal?.kind === 'rename' ? nameModal.preset.name : ''}
        isOpen={nameModal !== null}
        onClose={() => setNameModal(null)}
        onSave={(name) => (nameModal?.kind === 'rename' ? handleRename(nameModal.preset, name) : handleSaveNew(name))}
        title={
          nameModal?.kind === 'rename'
            ? t('editor.blendPad.presets.renameTitle')
            : t('editor.blendPad.presets.saveTitle')
        }
      >
        {nameModal?.kind === 'save' && (
          <Switch
            checked={includesPuck}
            label={t('editor.blendPad.presets.includePuck')}
            onChange={setIncludesPuck}
            tooltip={t('editor.blendPad.presets.includePuckHint')}
          />
        )}
      </PresetNameModal>
      <ConfirmModal
        confirmText={t('editor.blendPad.presets.delete')}
        confirmVariant="danger"
        isOpen={isDeleteOpen}
        message={t('editor.blendPad.presets.deleteMessage', { name: selected?.name ?? '' })}
        onClose={() => setIsDeleteOpen(false)}
        onConfirm={handleDelete}
        title={t('editor.blendPad.presets.deleteTitle')}
      />
    </div>
  );
}
