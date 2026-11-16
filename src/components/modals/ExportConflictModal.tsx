import { useEffect, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import Button from '../ui/Button';
import Switch from '../ui/Switch';
import Text from '../ui/Text';
import { TextVariants } from '../../types/typography';
import { ExportConflict, ExportConflictResolution } from '../ui/ExportImportProperties';

interface ExportConflictModalProps {
  /** The clash to ask about; the modal is open while it is set. */
  conflict: ExportConflict | null;
  /** Clashes still to decide after this one. */
  remainingAfter: number;
  onCancel(): void;
  onChoose(resolution: ExportConflictResolution, applyToAll: boolean): void;
}

const SECONDARY_BUTTON =
  'bg-bg-primary shadow-transparent hover:bg-bg-primary text-white shadow-none focus:outline-hidden focus:ring-0';

const splitPath = (path: string) => {
  const index = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return { folder: path.substring(0, index), name: path.substring(index + 1) };
};

/** Asks what to do with an export whose file already exists, before anything is written. */
export default function ExportConflictModal({
  conflict,
  remainingAfter,
  onCancel,
  onChoose,
}: ExportConflictModalProps) {
  const { t } = useTranslation();
  const isOpen = conflict !== null;
  const [shown, setShown] = useState<ExportConflict | null>(null);
  const [show, setShow] = useState(false);
  const [applyToAll, setApplyToAll] = useState(false);

  useEffect(() => {
    if (conflict) {
      setShown(conflict);
      const timer = setTimeout(() => setShow(true), 10);
      return () => clearTimeout(timer);
    }
    setShow(false);
    setApplyToAll(false);
    const timer = setTimeout(() => setShown(null), 300);
    return () => clearTimeout(timer);
  }, [conflict]);

  const choose = useCallback(
    (resolution: ExportConflictResolution) => onChoose(resolution, applyToAll && remainingAfter > 0),
    [applyToAll, onChoose, remainingAfter],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      e.nativeEvent.stopImmediatePropagation();
      onCancel();
    },
    [onCancel],
  );

  if (!shown) {
    return null;
  }
  const { folder, name } = splitPath(shown.outputPath);

  return createPortal(
    <div
      aria-labelledby="export-conflict-modal-title"
      aria-modal="true"
      className={`
        fixed inset-0 flex items-center justify-center z-50
        bg-black/30 backdrop-blur-xs
        transition-opacity duration-300 ease-in-out
        ${show ? 'opacity-100' : 'opacity-0'}
      `}
      onClick={isOpen ? onCancel : undefined}
      role="dialog"
    >
      <div
        className={`
          bg-surface rounded-lg shadow-xl p-6 w-full max-w-md
          transform transition-all duration-300 ease-out
          ${show ? 'scale-100 opacity-100 translate-y-0' : 'scale-95 opacity-0 -translate-y-4'}
        `}
        onClick={(e: React.MouseEvent) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <Text variant={TextVariants.title} id="export-conflict-modal-title" className="mb-4">
          {t('export.conflict.title')}
        </Text>
        <Text className="mb-2 break-all">{t('export.conflict.message', { name, folder })}</Text>
        {remainingAfter > 0 && (
          <Switch
            className="mt-4"
            id="export-conflict-apply-to-all"
            label={t('export.conflict.applyToAll', { count: remainingAfter })}
            checked={applyToAll}
            onChange={setApplyToAll}
          />
        )}
        <div className="flex flex-wrap justify-end gap-3 mt-6">
          <Button className={SECONDARY_BUTTON} onClick={onCancel} variant="ghost">
            {t('export.conflict.cancel')}
          </Button>
          <Button className={SECONDARY_BUTTON} onClick={() => choose(ExportConflictResolution.Skip)}>
            {t('export.conflict.skip')}
          </Button>
          <Button className={SECONDARY_BUTTON} onClick={() => choose(ExportConflictResolution.Overwrite)}>
            {t('export.conflict.overwrite')}
          </Button>
          <Button
            autoFocus={true}
            className="focus:outline-hidden focus:ring-0 focus:ring-offset-0"
            onClick={() => choose(ExportConflictResolution.Rename)}
          >
            {t('export.conflict.rename')}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
