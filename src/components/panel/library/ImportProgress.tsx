import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';
import { FolderInput, X } from 'lucide-react';
import { Invokes } from '../../ui/AppProperties';
import { ImportState, Status } from '../../ui/ExportImportProperties';
import Text from '../../ui/Text';
import { TextColors, TextVariants } from '../../../types/typography';
import { useProcessStore } from '../../../store/useProcessStore';

const fileName = (path: string) => path.split(/[\\/]/).pop() ?? path;

/**
 * The running import in the Library header, in every folder (the full progress screen shows only
 * for an empty one): the count, a bar, the current file and Cancel, large enough to notice.
 */
export default function ImportProgress({ importState }: { importState: ImportState }) {
  const { t } = useTranslation();
  const current = importState.progress?.current ?? 0;
  const total = importState.progress?.total ?? 0;
  const percent = total > 0 ? Math.min(100, (current / total) * 100) : 0;
  const isCancelling = importState.status === Status.Cancelling;

  const handleCancel = () => {
    useProcessStore.getState().setImportState({ status: Status.Cancelling });
    invoke(Invokes.CancelImport).catch((error) => console.error('Failed to cancel the import:', error));
  };

  return (
    <div className="flex items-center gap-2 min-w-0" data-tooltip={importState.path || undefined}>
      <Text as="span" color={TextColors.accent} className="shrink-0">
        <FolderInput size={20} />
      </Text>
      <div className="flex flex-col gap-1 min-w-0 w-72 compact:w-48">
        <Text as="span" color={TextColors.primary} className="truncate tabular-nums">
          {isCancelling ? t('library.import.cancelling') : t('library.import.count', { current, total })}
        </Text>
        <div className="h-2 rounded-full bg-surface overflow-hidden">
          <div className="h-full bg-accent transition-[width] duration-200" style={{ width: `${percent}%` }} />
        </div>
        <Text as="span" variant={TextVariants.small} className="truncate">
          {importState.path ? fileName(importState.path) : t('library.import.starting')}
        </Text>
      </div>
      <button
        className="p-1.5 rounded-md text-text-secondary hover:text-text-primary hover:bg-surface transition-colors disabled:opacity-50 shrink-0"
        data-tooltip={t('library.import.cancel')}
        disabled={isCancelling}
        onClick={handleCancel}
        type="button"
      >
        <X size={18} />
      </button>
    </div>
  );
}
