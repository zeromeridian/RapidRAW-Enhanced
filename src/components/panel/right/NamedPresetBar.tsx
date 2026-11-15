import { useState } from 'react';
import type { MouseEvent, ReactNode } from 'react';
import { Download, FolderInput, MoreHorizontal, Pencil, Save, Trash2, Upload } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog';
import { toast } from 'react-toastify';
import Dropdown from '../../ui/Dropdown';
import ConfirmModal from '../../modals/ConfirmModal';
import PresetNameModal from '../../modals/PresetNameModal';
import { Invokes, OPTION_SEPARATOR } from '../../ui/AppProperties';
import { useContextMenu } from '../../../context/ContextMenuContext';
import type { NamedPreset } from '../../../utils/namedPresets';

const JSON_FILTERS = [{ name: 'JSON', extensions: ['json'] }];

const buttonClass =
  'w-9 h-9 compact:w-7 compact:h-7 shrink-0 rounded-md bg-surface text-text-secondary hover:text-text-primary hover:bg-bg-primary transition-colors flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed';

/** The texts that name a tool's presets; the generic actions share `editor.blendPad.presets.*`. */
export interface NamedPresetLabels {
  placeholder: string;
  save: string;
  saveTitle: string;
  renameTitle: string;
  deleteTitle: string;
  deleteMessage(name: string): string;
  nameConflict: string;
  fileName: string;
  importNone: string;
  imported(count: number): string;
}

interface NamedPresetBarProps<P extends NamedPreset> {
  /** The tool's presets, already cleaned. */
  presets: Array<P>;
  /** The preset the current setup came from, or null. */
  selected: P | null;
  /** Whether the current setup differs from `selected`. */
  isDirty: boolean;
  /** False until the presets can be read (they are cleaned against data still loading). */
  isReady?: boolean;
  /** Keeps a new list of presets (in the app settings). */
  onPresetsChange(presets: Array<P>): void;
  onLoad(preset: P): void;
  /** The current setup was saved as this new preset: it now belongs to it. */
  onSaved(preset: P): void;
  /** A new preset of the current setup. */
  create(name: string): P;
  /** `preset` overwritten with the current setup, keeping its id and name. */
  update(preset: P): P;
  /** Presets from a file, cleaned and made unique against `existing`. */
  sanitize(values: unknown, existing: Array<P>): Array<P>;
  exportCommand: Invokes;
  importCommand: Invokes;
  labels: NamedPresetLabels;
  /** Extra controls in the save dialog. */
  saveOptions?: ReactNode;
}

type NameModal<P> = { kind: 'save' } | { kind: 'rename'; preset: P } | null;

/**
 * A tool's named presets, kept in the app settings (the Orbit Blend Pad's, Zone Color
 * Grading's): pick one to load it, save the current setup, update, rename, delete, export and
 * import JSON.
 */
export default function NamedPresetBar<P extends NamedPreset>({
  presets,
  selected,
  isDirty,
  isReady = true,
  onPresetsChange,
  onLoad,
  onSaved,
  create,
  update,
  sanitize,
  exportCommand,
  importCommand,
  labels,
  saveOptions,
}: NamedPresetBarProps<P>) {
  const { t } = useTranslation();
  const { showContextMenu } = useContextMenu();
  const [nameModal, setNameModal] = useState<NameModal<P>>(null);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const options = presets.map((preset) => ({ label: preset.name, value: preset.id }));

  const handleLoad = (id: string) => {
    const preset = presets.find((candidate) => candidate.id === id);
    if (preset) onLoad(preset);
  };

  const handleSaveNew = (name: string) => {
    const preset = create(name);
    onPresetsChange([...presets, preset]);
    onSaved(preset);
  };

  const handleUpdate = () => {
    if (!selected) return;
    onPresetsChange(presets.map((preset) => (preset.id === selected.id ? update(preset) : preset)));
  };

  const handleRename = (preset: P, name: string) =>
    onPresetsChange(presets.map((candidate) => (candidate.id === preset.id ? { ...candidate, name } : candidate)));

  const handleDelete = () => {
    if (!selected) return;
    // The setup keeps a stale preset id, which simply matches nothing any more.
    onPresetsChange(presets.filter((preset) => preset.id !== selected.id));
  };

  const handleExport = async (toExport: Array<P>) => {
    try {
      const filePath = await saveDialog({
        defaultPath: `${toExport.length === 1 ? toExport[0].name : labels.fileName}.json`,
        filters: JSON_FILTERS,
        title: t('editor.blendPad.presets.export'),
      });
      if (!filePath) return;
      await invoke(exportCommand, { presets: toExport, filePath });
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
      const values = await invoke<Array<unknown>>(importCommand, { filePath });
      // Every imported preset is cleaned; clashing names get a number.
      const imported = sanitize(values, presets);
      if (imported.length === 0) {
        toast.warn(labels.importNone);
        return;
      }
      onPresetsChange([...presets, ...imported]);
      toast.success(labels.imported(imported.length));
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
        placeholder={labels.placeholder}
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
        data-tooltip={isDirty ? t('editor.blendPad.presets.update') : labels.save}
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
        confirmLabel={nameModal?.kind === 'rename' ? t('editor.blendPad.presets.rename') : labels.save}
        conflictMessage={labels.nameConflict}
        existingNames={existingNames}
        initialName={nameModal?.kind === 'rename' ? nameModal.preset.name : ''}
        isOpen={nameModal !== null}
        onClose={() => setNameModal(null)}
        onSave={(name) => (nameModal?.kind === 'rename' ? handleRename(nameModal.preset, name) : handleSaveNew(name))}
        title={nameModal?.kind === 'rename' ? labels.renameTitle : labels.saveTitle}
      >
        {nameModal?.kind === 'save' && saveOptions}
      </PresetNameModal>
      <ConfirmModal
        confirmText={t('editor.blendPad.presets.delete')}
        confirmVariant="danger"
        isOpen={isDeleteOpen}
        message={labels.deleteMessage(selected?.name ?? '')}
        onClose={() => setIsDeleteOpen(false)}
        onConfirm={handleDelete}
        title={labels.deleteTitle}
      />
    </div>
  );
}
