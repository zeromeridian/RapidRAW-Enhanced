import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import Switch from '../ui/Switch';
import FilenameTemplateEditor from '../ui/FilenameTemplateEditor';
import { ImportSettings, isUniqueFilenameTemplate } from '../ui/ExportImportProperties';
import Text from '../ui/Text';
import { TextVariants } from '../../types/typography';
import { useFilenameTemplatePreview, useFilenameTemplates } from '../../hooks/useFilenameTemplates';
import { DEFAULT_IMPORT_TEMPLATE, usesCustomText } from '../../utils/filenameTemplates';

interface ImportSettingsModalProps {
  /** The files to import; the first gives the example name. */
  sourcePaths: Array<string>;
  isOpen: boolean;
  onClose(): void;
  onSave(settings: ImportSettings): void;
}

export default function ImportSettingsModal({ sourcePaths, isOpen, onClose, onSave }: ImportSettingsModalProps) {
  const { t } = useTranslation();
  const [isMounted, setIsMounted] = useState(false);
  const [show, setShow] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const { defaultCustomText, rememberCustomText } = useFilenameTemplates();

  const [filenameTemplate, setFilenameTemplate] = useState(DEFAULT_IMPORT_TEMPLATE);
  // Null until typed or loaded: then the template's saved text, else the last one used.
  const [customText, setCustomText] = useState<string | null>(null);
  const [organizeByDate, setOrganizeByDate] = useState(false);
  const [dateFolderFormat, setDateFolderFormat] = useState('YYYY/MM-DD');
  const [deleteAfterImport, setDeleteAfterImport] = useState(false);

  const fileCount = sourcePaths.length;
  const template = filenameTemplate.trim();
  const shownText = customText ?? defaultCustomText(template);
  const filenameText = usesCustomText(template) ? shownText : null;
  const preview = useFilenameTemplatePreview(isOpen ? (sourcePaths[0] ?? null) : null, template, filenameText);
  const examplePath = sourcePaths[0];
  const exampleExtension = examplePath?.includes('.') ? examplePath.substring(examplePath.lastIndexOf('.')) : '';

  useEffect(() => {
    if (isOpen) {
      setCustomText(null);
      setIsMounted(true);
      const timer = setTimeout(() => setShow(true), 10);
      return () => clearTimeout(timer);
    } else {
      setShow(false);
      const timer = setTimeout(() => {
        setIsMounted(false);
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  const handleSave = useCallback(() => {
    if (!template) return;
    rememberCustomText(filenameText);
    onSave({
      filenameTemplate: template,
      filenameText,
      organizeByDate,
      dateFolderFormat,
      deleteAfterImport,
    });
    onClose();
  }, [
    onSave,
    onClose,
    template,
    filenameText,
    rememberCustomText,
    organizeByDate,
    dateFolderFormat,
    deleteAfterImport,
  ]);

  const handleKeyDown = useCallback(
    (e: any) => {
      // The template bar's own dialogs sit inside this one; their keys are theirs.
      if ((e.target as HTMLElement).closest('[role="dialog"]') !== dialogRef.current) return;
      if (e.key === 'Enter') {
        handleSave();
      } else if (e.key === 'Escape') {
        onClose();
      }
    },
    [handleSave, onClose],
  );

  if (!isMounted) {
    return null;
  }

  return (
    <div
      aria-modal="true"
      className={`fixed inset-0 flex items-center justify-center z-50 bg-black/30 backdrop-blur-xs transition-opacity duration-300 ease-in-out ${
        show ? 'opacity-100' : 'opacity-0'
      }`}
      onClick={onClose}
      ref={dialogRef}
      role="dialog"
    >
      <div
        className={`bg-surface rounded-lg shadow-xl p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto transform transition-all duration-300 ease-out ${
          show ? 'scale-100 opacity-100 translate-y-0' : 'scale-95 opacity-0 -translate-y-4'
        }`}
        onClick={(e: any) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <Text variant={TextVariants.title} className="mb-4">
          {t('modals.importSettings.title')}
        </Text>

        <div className="space-y-8 text-sm">
          <div>
            <FilenameTemplateEditor
              autoFocus
              customText={shownText}
              errors={preview?.errors}
              label={t('modals.importSettings.fileNaming')}
              onCustomTextChange={setCustomText}
              onTemplateChange={setFilenameTemplate}
              template={filenameTemplate}
            />
            {preview?.stem && (
              <Text variant={TextVariants.small} className="mt-2 font-mono">
                {`${t('modals.renameFile.preview')}: ${preview.stem}${exampleExtension}`}
              </Text>
            )}
            {fileCount > 1 && !isUniqueFilenameTemplate(template) && (
              <Text variant={TextVariants.small} className="mt-2">
                {t('modals.importSettings.notUniqueWarning')}
              </Text>
            )}
          </div>

          <div>
            <Text variant={TextVariants.heading} className="block mb-2">
              {t('modals.importSettings.folderOrganization')}
            </Text>
            <Switch
              label={t('modals.importSettings.organizeByDate')}
              checked={organizeByDate}
              onChange={setOrganizeByDate}
            />
            {organizeByDate && (
              <div className="mt-2">
                <Text variant={TextVariants.label} className="block mb-1">
                  {t('modals.importSettings.dateFormat')}
                </Text>
                <input
                  className="w-full bg-bg-primary border border-surface rounded-md p-2 text-sm text-text-primary focus:ring-accent focus:border-accent"
                  onChange={(e: any) => setDateFolderFormat(e.target.value)}
                  placeholder={t('modals.importSettings.dateFormatPlaceholder')}
                  type="text"
                  value={dateFolderFormat}
                />
              </div>
            )}
          </div>

          <div>
            <Text variant={TextVariants.heading} className="block mb-2">
              {t('modals.importSettings.sourceFiles')}
            </Text>
            <Switch
              checked={deleteAfterImport}
              label={t('modals.importSettings.deleteAfterImport')}
              onChange={setDeleteAfterImport}
            />
            {deleteAfterImport && (
              <Text variant={TextVariants.small} className="mt-1">
                {t('modals.importSettings.deleteWarning')}
              </Text>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-3 mt-8">
          <button
            className="px-4 py-2 rounded-md text-text-secondary hover:bg-surface transition-colors"
            onClick={onClose}
          >
            {t('modals.importSettings.cancel')}
          </button>
          <button
            className="px-4 py-2 rounded-md bg-accent shadow-shiny text-button-text font-semibold hover:bg-accent-hover transition-colors"
            onClick={handleSave}
          >
            {t('modals.importSettings.startImport')}
          </button>
        </div>
      </div>
    </div>
  );
}
