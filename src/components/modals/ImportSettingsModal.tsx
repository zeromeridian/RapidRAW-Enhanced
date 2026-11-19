import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { FolderOpen } from 'lucide-react';
import Dropdown from '../ui/Dropdown';
import SegmentedSwitch from '../ui/SegmentedSwitch';
import FilenameTemplateEditor from '../ui/FilenameTemplateEditor';
import { ImportNameClash, ImportSettings, isUniqueFilenameTemplate } from '../ui/ExportImportProperties';
import { Invokes } from '../ui/AppProperties';
import Text from '../ui/Text';
import { TextVariants } from '../../types/typography';
import { useFilenameTemplatePreview, useFilenameTemplates } from '../../hooks/useFilenameTemplates';
import { textsForTemplate } from '../../utils/filenameTemplates';
import {
  DATE_FOLDER_FORMATS,
  DEFAULT_DATE_FOLDER_FORMAT,
  monthNames,
  readLastImportSettings,
} from '../../utils/importSettings';
import { isPathWithin } from '../../utils/libraryViews';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useLibraryStore } from '../../store/useLibraryStore';

/** The subfolder dropdown's own choices besides `DATE_FOLDER_FORMATS`. */
const INTO_ONE_FOLDER = 'intoOneFolder';
const CUSTOM_FORMAT = 'custom';

enum ImportMode {
  Copy = 'copy',
  Move = 'move',
}

interface ImportSettingsModalProps {
  /** The files to import; the first gives the example name. */
  sourcePaths: Array<string>;
  /** The folder the import was started on (folder right-click); else the last destination. */
  targetFolder: string | null;
  isOpen: boolean;
  onClose(): void;
  onSave(settings: ImportSettings, destination: string): void;
}

export default function ImportSettingsModal({
  sourcePaths,
  targetFolder,
  isOpen,
  onClose,
  onSave,
}: ImportSettingsModalProps) {
  const { t, i18n } = useTranslation();
  const [isMounted, setIsMounted] = useState(false);
  const [show, setShow] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const { defaultCustomTexts, rememberCustomTexts } = useFilenameTemplates();

  const [mode, setMode] = useState(ImportMode.Copy);
  const [destination, setDestination] = useState('');
  const [folderChoice, setFolderChoice] = useState<string>(INTO_ONE_FOLDER);
  const [customFormat, setCustomFormat] = useState('');
  const [filenameTemplate, setFilenameTemplate] = useState('');
  // Null until typed or loaded: then the template's saved texts, else the last ones used.
  const [customTexts, setCustomTexts] = useState<Array<string> | null>(null);
  const [nameClash, setNameClash] = useState(ImportNameClash.AddSuffix);
  const [exampleFolder, setExampleFolder] = useState('');

  const fileCount = sourcePaths.length;
  const template = filenameTemplate.trim();
  const shownTexts = customTexts ?? defaultCustomTexts(template);
  const filenameTexts = textsForTemplate(template, shownTexts);
  const preview = useFilenameTemplatePreview(isOpen ? (sourcePaths[0] ?? null) : null, template, filenameTexts);
  const examplePath = sourcePaths[0];
  const exampleExtension = examplePath?.includes('.') ? examplePath.substring(examplePath.lastIndexOf('.')) : '';
  const organizeByDate = folderChoice !== INTO_ONE_FOLDER;
  const dateFolderFormat = folderChoice === CUSTOM_FORMAT ? customFormat.trim() : folderChoice;
  const months = useMemo(() => monthNames(i18n.language), [i18n.language]);
  const rootPaths = useLibraryStore((state) => state.rootPaths);
  const isOutsideLibrary = !!destination && !rootPaths.some((root) => isPathWithin(destination, root));

  useEffect(() => {
    if (isOpen) {
      // Every opening starts from the last choices, always as a Copy (owner 2026-11-19).
      const last = readLastImportSettings(useSettingsStore.getState().appSettings?.lastImportSettings);
      const isListedFormat = (DATE_FOLDER_FORMATS as ReadonlyArray<string>).includes(last.dateFolderFormat);
      setMode(ImportMode.Copy);
      setDestination(targetFolder ?? last.destination ?? useLibraryStore.getState().currentFolderPath ?? '');
      setFolderChoice(!last.organizeByDate ? INTO_ONE_FOLDER : isListedFormat ? last.dateFolderFormat : CUSTOM_FORMAT);
      setCustomFormat(isListedFormat ? '' : last.dateFolderFormat);
      setFilenameTemplate(last.filenameTemplate);
      setNameClash(last.nameClash);
      setCustomTexts(null);
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
  }, [isOpen, targetFolder]);

  useEffect(() => {
    if (!isOpen || !organizeByDate || !dateFolderFormat || !examplePath) {
      setExampleFolder('');
      return;
    }
    let isCurrent = true;
    invoke<string>(Invokes.PreviewImportFolder, { path: examplePath, pattern: dateFolderFormat, monthNames: months })
      .then((folder) => isCurrent && setExampleFolder(folder))
      .catch(() => isCurrent && setExampleFolder(''));
    return () => {
      isCurrent = false;
    };
  }, [isOpen, organizeByDate, dateFolderFormat, examplePath, months]);

  const handleChooseDestination = useCallback(async () => {
    const selected = await open({ directory: true, multiple: false, defaultPath: destination || undefined });
    if (typeof selected === 'string') setDestination(selected);
  }, [destination]);

  const canImport = !!template && !!destination && (!organizeByDate || !!dateFolderFormat);

  const handleSave = useCallback(() => {
    if (!canImport) return;
    rememberCustomTexts(filenameTexts);
    const { appSettings, handleSettingsChange } = useSettingsStore.getState();
    if (appSettings) {
      handleSettingsChange({
        ...appSettings,
        lastImportSettings: {
          destination,
          organizeByDate,
          dateFolderFormat: dateFolderFormat || DEFAULT_DATE_FOLDER_FORMAT,
          filenameTemplate: template,
          nameClash,
        },
      });
    }
    onSave(
      {
        filenameTemplate: template,
        filenameTexts: filenameTexts ?? [],
        organizeByDate,
        dateFolderFormat,
        deleteAfterImport: mode === ImportMode.Move,
        nameClash,
        monthNames: months,
      },
      destination,
    );
    onClose();
  }, [
    canImport,
    onSave,
    onClose,
    template,
    filenameTexts,
    rememberCustomTexts,
    organizeByDate,
    dateFolderFormat,
    destination,
    mode,
    nameClash,
    months,
  ]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      // The template bar's own dialogs sit inside this one; their keys are theirs.
      const target = e.target as HTMLElement;
      if (target.closest('[role="dialog"]') !== dialogRef.current) return;
      if (e.key === 'Enter') {
        // A focused button (a dropdown, Choose…, Copy / Move) keeps Enter for itself.
        if (target.closest('button')) return;
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

  const separator = destination.includes('\\') && !destination.includes('/') ? '\\' : '/';
  const exampleDestination = [destination, exampleFolder, `${preview?.stem ?? ''}${exampleExtension}`]
    .filter(Boolean)
    .join(separator);

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
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="flex items-baseline justify-between mb-4">
          <Text variant={TextVariants.title}>{t('modals.importSettings.title')}</Text>
          <Text variant={TextVariants.small}>{t('modals.importSettings.photoCount', { count: fileCount })}</Text>
        </div>

        <div className="space-y-6 text-sm">
          <div>
            <SegmentedSwitch<ImportMode>
              onChange={setMode}
              options={[
                { value: ImportMode.Copy, label: t('modals.importSettings.modeCopy') },
                { value: ImportMode.Move, label: t('modals.importSettings.modeMove') },
              ]}
              value={mode}
            />
            {mode === ImportMode.Move && (
              <Text variant={TextVariants.small} className="mt-1">
                {t('modals.importSettings.deleteWarning')}
              </Text>
            )}
          </div>

          <div>
            <Text variant={TextVariants.heading} className="block mb-2">
              {t('modals.importSettings.destination')}
            </Text>
            <div className="flex items-center gap-2">
              <Text
                as="div"
                className="flex-1 min-w-0 truncate font-mono bg-bg-primary rounded-md px-3 py-2"
                data-tooltip={destination || undefined}
              >
                {destination || t('modals.importSettings.noDestination')}
              </Text>
              <button
                className="flex items-center gap-2 px-3 py-2 rounded-md bg-bg-primary hover:bg-card-active text-text-primary transition-colors shrink-0"
                onClick={handleChooseDestination}
                type="button"
              >
                <FolderOpen size={16} />
                {t('modals.importSettings.chooseDestination')}
              </button>
            </div>
            {isOutsideLibrary && (
              <Text variant={TextVariants.small} className="mt-1">
                {t('modals.importSettings.destinationOutsideLibrary')}
              </Text>
            )}
          </div>

          <div>
            <Text variant={TextVariants.heading} className="block mb-2">
              {t('modals.importSettings.subfolders')}
            </Text>
            <Dropdown
              onChange={setFolderChoice}
              options={[
                { value: INTO_ONE_FOLDER, label: t('modals.importSettings.intoOneFolder') },
                ...DATE_FOLDER_FORMATS.map((format) => ({ value: format, label: format })),
                { value: CUSTOM_FORMAT, label: t('modals.importSettings.customFormat') },
              ]}
              value={folderChoice}
            />
            {folderChoice === CUSTOM_FORMAT && (
              <div className="mt-2">
                <input
                  className="w-full bg-bg-primary border border-surface rounded-md p-2 text-sm text-text-primary focus:ring-accent focus:border-accent font-mono"
                  onChange={(e) => setCustomFormat(e.target.value)}
                  placeholder={t('modals.importSettings.dateFormatPlaceholder')}
                  type="text"
                  value={customFormat}
                />
                <Text variant={TextVariants.small} className="mt-1">
                  {t('modals.importSettings.customFormatHelp')}
                </Text>
              </div>
            )}
          </div>

          <div>
            <FilenameTemplateEditor
              autoFocus
              customTexts={shownTexts}
              errors={preview?.errors}
              label={t('modals.importSettings.fileNaming')}
              onCustomTextsChange={setCustomTexts}
              onTemplateChange={setFilenameTemplate}
              template={filenameTemplate}
            />
            {fileCount > 1 && !isUniqueFilenameTemplate(template) && (
              <Text variant={TextVariants.small} className="mt-2">
                {t('modals.importSettings.notUniqueWarning')}
              </Text>
            )}
          </div>

          <div>
            <Text variant={TextVariants.heading} className="block mb-2">
              {t('modals.importSettings.nameClash')}
            </Text>
            <Dropdown
              onChange={setNameClash}
              options={[
                { value: ImportNameClash.AddSuffix, label: t('modals.importSettings.nameClashAddSuffix') },
                { value: ImportNameClash.Skip, label: t('modals.importSettings.nameClashSkip') },
              ]}
              value={nameClash}
            />
          </div>

          {preview?.stem && destination && (
            <Text variant={TextVariants.small} className="font-mono break-all">
              {`${t('modals.importSettings.example')}: ${exampleDestination}`}
            </Text>
          )}
        </div>

        <div className="flex justify-end gap-3 mt-8">
          <button
            className="px-4 py-2 rounded-md text-text-secondary hover:bg-surface transition-colors"
            onClick={onClose}
          >
            {t('modals.importSettings.cancel')}
          </button>
          <button
            className="px-4 py-2 rounded-md bg-accent shadow-shiny text-button-text font-semibold hover:bg-accent-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={!canImport}
            onClick={handleSave}
          >
            {t('modals.importSettings.startImport')}
          </button>
        </div>
      </div>
    </div>
  );
}
