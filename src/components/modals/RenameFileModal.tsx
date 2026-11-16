import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';
import Text from '../ui/Text';
import { TextVariants } from '../../types/typography';
import { Invokes } from '../ui/AppProperties';
import NamedPresetBar from '../panel/right/NamedPresetBar';
import { useSettingsStore } from '../../store/useSettingsStore';
import {
  FILENAME_TOKEN_GROUPS,
  RenamePreview,
  createFilenameTemplate,
  filenameTemplatesFromSettings,
  sanitizeFilenameTemplates,
  usesCustomText,
} from '../../utils/filenameTemplates';

/** How long the preview waits after the last keystroke. */
const PREVIEW_DELAY_MS = 150;
const DEFAULT_TEMPLATE = '{original_filename}';

interface RenameFileModalProps {
  /** The photos to rename, in the grid's order (sequence numbers follow it). */
  filesToRename: Array<string>;
  isOpen: boolean;
  onClose(): void;
  onSave(template: string, text: string | null): void;
}

const fileName = (path: string) => path.split(/[\\/]/).pop() ?? path;

/**
 * Lightroom-style rename: a file-name template with grouped token chips, saved templates
 * (shared with export and import), a custom text, and a live preview that shows clashes,
 * missing values and template errors before anything changes.
 */
export default function RenameFileModal({ filesToRename, isOpen, onClose, onSave }: RenameFileModalProps) {
  const { t } = useTranslation();
  const [nameTemplate, setNameTemplate] = useState('');
  const [customText, setCustomText] = useState('');
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [preview, setPreview] = useState<RenamePreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isMounted, setIsMounted] = useState(false);
  const [show, setShow] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  // The last template used for several photos, offered again next time.
  const lastBatchTemplateRef = useRef(DEFAULT_TEMPLATE);

  const appSettings = useSettingsStore((state) => state.appSettings);
  const handleSettingsChange = useSettingsStore((state) => state.handleSettingsChange);
  const templates = useMemo(
    () =>
      filenameTemplatesFromSettings(appSettings?.filenameTemplates, {
        filename: t('modals.renameFile.templates.starters.filename'),
        customSequence: t('modals.renameFile.templates.starters.customSequence'),
        customNumber: t('modals.renameFile.templates.starters.customNumber'),
        dateFilename: t('modals.renameFile.templates.starters.dateFilename'),
        dateTimeCamera: t('modals.renameFile.templates.starters.dateTimeCamera'),
      }),
    [appSettings?.filenameTemplates, t],
  );
  const selectedTemplate = templates.find((template) => template.id === selectedTemplateId) ?? null;

  const fileCount = filesToRename.length;
  const isSingleFile = fileCount === 1;
  const template = nameTemplate.trim();
  const needsText = usesCustomText(template);
  const text = needsText ? customText : null;

  useEffect(() => {
    if (isOpen) {
      if (isSingleFile && filesToRename[0]) {
        const name = fileName(filesToRename[0]);
        const dot = name.lastIndexOf('.');
        setNameTemplate(dot > 0 ? name.substring(0, dot) : name);
        setSelectedTemplateId(null);
      } else {
        setNameTemplate(lastBatchTemplateRef.current);
      }
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
    }, PREVIEW_DELAY_MS);
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
    onSave(template, text);
    onClose();
  }, [canRename, isSingleFile, template, text, onSave, onClose]);

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

  const handleVariableClick = (variable: string) => {
    if (!nameInputRef.current) {
      return;
    }
    const input = nameInputRef.current;
    const start = input?.selectionStart || 0;
    const end = input?.selectionEnd || 0;
    const currentValue = input.value;
    const newValue = currentValue.substring(0, start) + variable + currentValue.substring(end);
    setNameTemplate(newValue);
    setTimeout(() => {
      input.focus();
      const newCursorPos = start + variable.length;
      input.setSelectionRange(newCursorPos, newCursorPos);
    }, 0);
  };

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
          <NamedPresetBar
            create={(name) => createFilenameTemplate(name, template)}
            exportCommand={Invokes.ExportFilenameTemplates}
            importCommand={Invokes.ImportFilenameTemplates}
            isDirty={!!selectedTemplate && selectedTemplate.template !== template}
            labels={{
              placeholder: t('modals.renameFile.templates.placeholder'),
              save: t('modals.renameFile.templates.save'),
              saveTitle: t('modals.renameFile.templates.saveTitle'),
              renameTitle: t('modals.renameFile.templates.renameTitle'),
              deleteTitle: t('modals.renameFile.templates.deleteTitle'),
              deleteMessage: (name) => t('modals.renameFile.templates.deleteMessage', { name }),
              nameConflict: t('modals.renameFile.templates.nameConflict'),
              fileName: t('modals.renameFile.templates.fileName'),
              importNone: t('modals.renameFile.templates.importNone'),
              imported: (count) => t('modals.renameFile.templates.imported', { count }),
            }}
            onLoad={(loaded) => {
              setNameTemplate(loaded.template);
              setSelectedTemplateId(loaded.id);
            }}
            onPresetsChange={(next) => {
              if (appSettings) void handleSettingsChange({ ...appSettings, filenameTemplates: next });
            }}
            onSaved={(saved) => setSelectedTemplateId(saved.id)}
            presets={templates}
            sanitize={sanitizeFilenameTemplates}
            selected={selectedTemplate}
            update={(preset) => ({ ...preset, template })}
          />

          <div>
            <Text variant={TextVariants.heading} className="block mb-2">
              {isSingleFile ? t('modals.renameFile.newName') : t('modals.renameFile.fileNamingTemplate')}
            </Text>
            <input
              autoFocus
              className="w-full bg-bg-primary border border-surface rounded-md p-2 text-sm text-text-primary font-mono focus:ring-accent focus:border-accent"
              onChange={(e: any) => setNameTemplate(e.target.value)}
              ref={nameInputRef}
              spellCheck={false}
              type="text"
              value={nameTemplate}
            />
            {preview?.errors.map((error) => (
              <Text key={`${error.position}-${error.kind}`} variant={TextVariants.small} className="mt-1 text-red-400">
                {t(`modals.renameFile.errors.${error.kind}`, { text: error.text, column: error.position + 1 })}
              </Text>
            ))}
          </div>

          <div className="space-y-2">
            {FILENAME_TOKEN_GROUPS.map((group) => (
              <div className="flex items-start gap-2" key={group.id}>
                <Text variant={TextVariants.small} className="w-20 shrink-0 pt-1">
                  {t(`modals.renameFile.groups.${group.id}`)}
                </Text>
                <div className="flex flex-wrap gap-1.5">
                  {group.tokens.map((variable: string) => (
                    <button
                      className="px-2 py-1 bg-bg-primary text-text-secondary text-xs font-mono rounded-md hover:bg-card-active transition-colors"
                      key={variable}
                      onClick={() => handleVariableClick(variable)}
                      type="button"
                    >
                      {variable}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            <Text variant={TextVariants.small}>{t('modals.renameFile.filtersHint')}</Text>
          </div>

          {needsText && (
            <div>
              <Text variant={TextVariants.heading} className="block mb-2">
                {t('modals.renameFile.customText')}
              </Text>
              <input
                className="w-full bg-bg-primary border border-surface rounded-md p-2 text-sm text-text-primary focus:ring-accent focus:border-accent"
                onChange={(e: any) => setCustomText(e.target.value)}
                type="text"
                value={customText}
              />
            </div>
          )}

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
