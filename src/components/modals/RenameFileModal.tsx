import { useState, useEffect, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';
import Text from '../ui/Text';
import { TextVariants } from '../../types/typography';
import { Invokes } from '../ui/AppProperties';
import FilenameTemplateEditor from '../ui/FilenameTemplateEditor';
import { TEMPLATE_PREVIEW_DELAY_MS, useFilenameTemplates } from '../../hooks/useFilenameTemplates';
import { RenamePreview, usesCustomText } from '../../utils/filenameTemplates';

const DEFAULT_TEMPLATE = '{filename}';

interface RenameFileModalProps {
  /** The photos to rename, in the grid's order (sequence numbers follow it). */
  filesToRename: Array<string>;
  isOpen: boolean;
  onClose(): void;
  onSave(template: string, text: string | null): void;
}

const fileName = (path: string) => path.split(/[\\/]/).pop() ?? path;

/**
 * Lightroom-style rename: the shared file-name template editor and a live preview that shows
 * clashes, missing values and template errors before anything changes.
 */
export default function RenameFileModal({ filesToRename, isOpen, onClose, onSave }: RenameFileModalProps) {
  const { t } = useTranslation();
  const { defaultCustomText, rememberCustomText } = useFilenameTemplates();
  const [nameTemplate, setNameTemplate] = useState('');
  // Null until typed or loaded: then the template's saved text, else the last one used.
  const [customText, setCustomText] = useState<string | null>(null);
  const [preview, setPreview] = useState<RenamePreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isMounted, setIsMounted] = useState(false);
  const [show, setShow] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  // The last template used for several photos, offered again next time.
  const lastBatchTemplateRef = useRef(DEFAULT_TEMPLATE);

  const fileCount = filesToRename.length;
  const isSingleFile = fileCount === 1;
  const template = nameTemplate.trim();
  const shownText = customText ?? defaultCustomText(template);
  const text = usesCustomText(template) ? shownText : null;

  useEffect(() => {
    if (isOpen) {
      if (isSingleFile && filesToRename[0]) {
        const name = fileName(filesToRename[0]);
        const dot = name.lastIndexOf('.');
        setNameTemplate(dot > 0 ? name.substring(0, dot) : name);
      } else {
        setNameTemplate(lastBatchTemplateRef.current);
      }
      setCustomText(null);
      setIsMounted(true);
      const timer = setTimeout(() => setShow(true), 10);
      return () => clearTimeout(timer);
    } else {
      setShow(false);
      const timer = setTimeout(() => {
        setIsMounted(false);
        setNameTemplate('');
        setPreview(null);
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [isOpen, filesToRename, isSingleFile]);

  useEffect(() => {
    if (!isOpen || !template) {
      setPreview(null);
      setPreviewError(null);
      return;
    }
    let isCurrent = true;
    setIsPreviewing(true);
    const timer = setTimeout(() => {
      invoke<RenamePreview>(Invokes.PreviewRename, { paths: filesToRename, nameTemplate: template, text })
        .then((result) => {
          if (!isCurrent) return;
          setPreview(result);
          setPreviewError(null);
        })
        .catch((error) => {
          if (!isCurrent) return;
          setPreview(null);
          setPreviewError(String(error));
        })
        .finally(() => isCurrent && setIsPreviewing(false));
    }, TEMPLATE_PREVIEW_DELAY_MS);
    return () => {
      isCurrent = false;
      clearTimeout(timer);
    };
  }, [isOpen, filesToRename, template, text]);

  const hasChanges = !!preview && preview.items.some((item) => !item.unchanged);
  const canRename = !!preview && !isPreviewing && preview.clashCount === 0 && hasChanges;

  const handleSave = useCallback(() => {
    if (!canRename) return;
    if (!isSingleFile) lastBatchTemplateRef.current = template;
    rememberCustomText(text);
    onSave(template, text);
    onClose();
  }, [canRename, isSingleFile, template, text, rememberCustomText, onSave, onClose]);

  const handleKeyDown = useCallback(
    (e: any) => {
      // The template bar's own dialogs sit inside this one; their keys are theirs.
      if ((e.target as HTMLElement).closest('[role="dialog"]') !== dialogRef.current) return;
      if (e.key === 'Enter') {
        e.preventDefault();
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

  const items = preview?.items ?? [];
  const examples = items.length > 1 ? [items[0], items[items.length - 1]] : items;
  const firstClash = items.find((item) => item.clash);
  const clashKind = firstClash?.clash;
  const missingItems = items.filter((item) => item.missing.length > 0);
  const missingTokens = [...new Set(missingItems.flatMap((item) => item.missing))].map((token) => `{${token}}`);

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
          {isSingleFile
            ? t('modals.renameFile.titleSingle')
            : t('modals.renameFile.titleMultiple', { count: fileCount })}
        </Text>

        <div className="space-y-5 text-sm">
          <FilenameTemplateEditor
            autoFocus
            customText={shownText}
            errors={preview?.errors}
            label={isSingleFile ? t('modals.renameFile.newName') : t('modals.renameFile.fileNamingTemplate')}
            onCustomTextChange={setCustomText}
            onTemplateChange={setNameTemplate}
            template={nameTemplate}
          />

          <div className="bg-bg-primary rounded-md p-3 space-y-1">
            <Text variant={TextVariants.heading} className="block mb-1">
              {t('modals.renameFile.preview')}
            </Text>
            {examples.map((item, index) => (
              <div className="flex flex-wrap items-center gap-x-2 font-mono text-xs" key={item.path}>
                {index === 1 && items.length > 2 && <span className="w-full text-text-secondary">…</span>}
                <span className="text-text-secondary">{fileName(item.path)}</span>
                <span className="text-text-secondary">→</span>
                <span className={item.clash ? 'text-red-400' : 'text-text-primary'}>{item.newName}</span>
              </div>
            ))}
            {previewError && (
              <Text variant={TextVariants.small} className="text-red-400">
                {previewError}
              </Text>
            )}
            {firstClash && clashKind && (
              <Text variant={TextVariants.small} className="text-red-400">
                {t(`modals.renameFile.clash.${clashKind}`, { name: firstClash.newName })}
              </Text>
            )}
            {missingItems.length > 0 && (
              <Text variant={TextVariants.small} className="text-amber-400">
                {t('modals.renameFile.missing', { tokens: missingTokens.join(', ') })}
              </Text>
            )}
            {items.some((item) => item.cleaned) && (
              <Text variant={TextVariants.small}>{t('modals.renameFile.cleaned')}</Text>
            )}
            {preview && !hasChanges && <Text variant={TextVariants.small}>{t('modals.renameFile.noChanges')}</Text>}
          </div>
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <button
            className="px-4 py-2 rounded-md text-text-secondary hover:bg-bg-primary transition-colors"
            onClick={onClose}
          >
            {t('modals.renameFile.cancel')}
          </button>
          <button
            className="px-4 py-2 rounded-md bg-accent shadow-shiny text-button-text font-semibold hover:bg-accent-hover disabled:bg-gray-500 disabled:text-white disabled:cursor-not-allowed transition-colors"
            disabled={!canRename}
            onClick={handleSave}
          >
            {t('modals.renameFile.save')}
          </button>
        </div>
      </div>
    </div>
  );
}
