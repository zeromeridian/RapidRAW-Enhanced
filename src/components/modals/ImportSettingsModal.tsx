import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { Files, FolderOpen, HardDrive } from 'lucide-react';
import clsx from 'clsx';
import Dropdown from '../ui/Dropdown';
import SegmentedSwitch from '../ui/SegmentedSwitch';
import Switch from '../ui/Switch';
import FilenameTemplateEditor from '../ui/FilenameTemplateEditor';
import NamedPresetBar from '../panel/right/NamedPresetBar';
import ImportSourceGrid from './ImportSourceGrid';
import ImportKeywordField from './ImportKeywordField';
import {
  ImportCandidate,
  ImportNameClash,
  ImportSettings,
  ImportVolume,
  isUniqueFilenameTemplate,
} from '../ui/ExportImportProperties';
import { Invokes } from '../ui/AppProperties';
import Text from '../ui/Text';
import { TextVariants } from '../../types/typography';
import { useFilenameTemplatePreview, useFilenameTemplates } from '../../hooks/useFilenameTemplates';
import { textsForTemplate } from '../../utils/filenameTemplates';
import {
  ImportPreset,
  ImportPresetFields,
  applyImportPreset,
  createImportPreset,
  isImportPresetDirty,
  sanitizeImportPresets,
  updateImportPreset,
} from '../../utils/importPresets';
import {
  DATE_FOLDER_FORMATS,
  DEFAULT_DATE_FOLDER_FORMAT,
  monthNames,
  pickImportFiles,
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

/** Where the photos come from: folders (a card's `DCIM` too) or single files. */
interface ImportSource {
  paths: Array<string>;
  isFiles: boolean;
}

const fileName = (path: string) =>
  path
    .replace(/[\\/]+$/, '')
    .split(/[\\/]/)
    .pop() ?? path;

const sourceButtonClass = (isActive: boolean) =>
  clsx(
    'flex items-center gap-2 px-3 py-1.5 rounded-md text-sm transition-colors shrink-0',
    isActive ? 'bg-accent text-button-text' : 'bg-bg-primary hover:bg-card-active text-text-primary',
  );

interface ImportSettingsModalProps {
  /** Folders or files to start from (a card that was just connected); empty: pick one in the dialog. */
  sourcePaths: Array<string>;
  /** The folder the import was started on (folder right-click); else the last destination. */
  targetFolder: string | null;
  isOpen: boolean;
  onClose(): void;
  /** Imports `sourcePaths` (the ticked photos, in capture order) into `destination`. */
  onSave(settings: ImportSettings, destination: string, sourcePaths: Array<string>): void;
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

  const [source, setSource] = useState<ImportSource | null>(null);
  const [includeSubfolders, setIncludeSubfolders] = useState(true);
  const [volumes, setVolumes] = useState<Array<ImportVolume>>([]);
  const [candidates, setCandidates] = useState<Array<ImportCandidate>>([]);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [isScanning, setIsScanning] = useState(false);

  const [mode, setMode] = useState(ImportMode.Copy);
  const [destination, setDestination] = useState('');
  const [folderChoice, setFolderChoice] = useState<string>(INTO_ONE_FOLDER);
  const [customFormat, setCustomFormat] = useState('');
  const [filenameTemplate, setFilenameTemplate] = useState('');
  // Null until typed or loaded: then the template's saved texts, else the last ones used.
  const [customTexts, setCustomTexts] = useState<Array<string> | null>(null);
  const [nameClash, setNameClash] = useState(ImportNameClash.AddSuffix);
  const [keywords, setKeywords] = useState<Array<string>>([]);
  const [creator, setCreator] = useState('');
  const [copyright, setCopyright] = useState('');
  const [presetId, setPresetId] = useState<string | null>(null);
  const [exampleFolder, setExampleFolder] = useState('');

  const savedPresets = useSettingsStore((state) => state.appSettings?.importPresets);
  const presets = useMemo(() => sanitizeImportPresets(savedPresets), [savedPresets]);
  const clearsEmpty = useSettingsStore((state) => state.appSettings?.importPresetClearsEmpty !== false);
  const selectedPreset = presets.find((preset) => preset.id === presetId) ?? null;

  const selectedPaths = useMemo(
    () => candidates.filter((candidate) => checked.has(candidate.path)).map((candidate) => candidate.path),
    [candidates, checked],
  );
  const fileCount = selectedPaths.length;
  const template = filenameTemplate.trim();
  const shownTexts = customTexts ?? defaultCustomTexts(template);
  const filenameTexts = textsForTemplate(template, shownTexts);
  const presetFields: ImportPresetFields = { keywords, creator, copyright, template, texts: shownTexts };
  const examplePath = selectedPaths[0];
  const preview = useFilenameTemplatePreview(isOpen ? (examplePath ?? null) : null, template, filenameTexts);
  const exampleExtension = examplePath?.includes('.') ? examplePath.substring(examplePath.lastIndexOf('.')) : '';
  const organizeByDate = folderChoice !== INTO_ONE_FOLDER;
  const dateFolderFormat = folderChoice === CUSTOM_FORMAT ? customFormat.trim() : folderChoice;
  const months = useMemo(() => monthNames(i18n.language), [i18n.language]);
  const rootPaths = useLibraryStore((state) => state.rootPaths);
  const isOutsideLibrary = !!destination && !rootPaths.some((root) => isPathWithin(destination, root));
  const activeVolume =
    source && !source.isFiles && source.paths.length === 1
      ? volumes.find((volume) => volume.path === source.paths[0])
      : undefined;

  useEffect(() => {
    if (isOpen) {
      // Every opening starts from the last choices, always as a Copy (owner 2026-11-19), and
      // the last Import Preset used, loaded again (decision 20).
      const { appSettings } = useSettingsStore.getState();
      const last = readLastImportSettings(appSettings?.lastImportSettings);
      const lastPreset = sanitizeImportPresets(appSettings?.importPresets).find(({ id }) => id === last.presetId);
      // Keywords start empty without a preset, so one shoot's never land on the next (decision 9).
      // A kept `noTexts` means the template's own or the last texts, as without a preset.
      const noTexts: Array<string> = [];
      const opened: ImportPresetFields = {
        keywords: [],
        creator: last.creator,
        copyright: last.copyright,
        template: last.filenameTemplate,
        texts: noTexts,
      };
      const fields = lastPreset
        ? applyImportPreset(lastPreset, opened, appSettings?.importPresetClearsEmpty !== false)
        : opened;
      const isListedFormat = (DATE_FOLDER_FORMATS as ReadonlyArray<string>).includes(last.dateFolderFormat);
      setSource(sourcePaths.length > 0 ? { paths: sourcePaths, isFiles: false } : null);
      setIncludeSubfolders(last.includeSubfolders);
      setCandidates([]);
      setChecked(new Set());
      setMode(ImportMode.Copy);
      setDestination(targetFolder ?? last.destination ?? useLibraryStore.getState().currentFolderPath ?? '');
      setFolderChoice(!last.organizeByDate ? INTO_ONE_FOLDER : isListedFormat ? last.dateFolderFormat : CUSTOM_FORMAT);
      setCustomFormat(isListedFormat ? '' : last.dateFolderFormat);
      setNameClash(last.nameClash);
      setFilenameTemplate(fields.template);
      setCustomTexts(fields.texts === noTexts ? null : fields.texts);
      setKeywords(fields.keywords);
      setCreator(fields.creator);
      setCopyright(fields.copyright);
      setPresetId(lastPreset?.id ?? null);
      setIsMounted(true);
      invoke<Array<ImportVolume>>(Invokes.ListImportVolumes)
        .then(setVolumes)
        .catch(() => setVolumes([]));
      const timer = setTimeout(() => setShow(true), 10);
      return () => clearTimeout(timer);
    } else {
      setShow(false);
      const timer = setTimeout(() => {
        setIsMounted(false);
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [isOpen, sourcePaths, targetFolder]);

  // A new source (or the subfolder switch) lists its photos again, all ticked.
  useEffect(() => {
    if (!isOpen || !source) {
      setCandidates([]);
      setChecked(new Set());
      return;
    }
    let isCurrent = true;
    setIsScanning(true);
    invoke<Array<ImportCandidate>>(Invokes.ScanImportSource, { paths: source.paths, recursive: includeSubfolders })
      .then((found) => {
        if (!isCurrent) return;
        setCandidates(found);
        setChecked(new Set(found.map((candidate) => candidate.path)));
      })
      .catch((error) => {
        console.error('Failed to list the photos to import:', error);
        if (isCurrent) setCandidates([]);
      })
      .finally(() => isCurrent && setIsScanning(false));
    return () => {
      isCurrent = false;
    };
  }, [isOpen, source, includeSubfolders]);

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

  const handleChooseSourceFolder = useCallback(async () => {
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected === 'string') setSource({ paths: [selected], isFiles: false });
  }, []);

  const handleChooseSourceFiles = useCallback(async () => {
    const files = await pickImportFiles();
    if (files) setSource({ paths: files, isFiles: true });
  }, []);

  const handleChooseDestination = useCallback(async () => {
    const selected = await open({ directory: true, multiple: false, defaultPath: destination || undefined });
    if (typeof selected === 'string') setDestination(selected);
  }, [destination]);

  const canImport = fileCount > 0 && !!template && !!destination && (!organizeByDate || !!dateFolderFormat);

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
          includeSubfolders,
          creator: creator.trim(),
          copyright: copyright.trim(),
          presetId: selectedPreset?.id ?? null,
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
        keywords,
        creator: creator.trim(),
        copyright: copyright.trim(),
      },
      destination,
      selectedPaths,
    );
    onClose();
  }, [
    keywords,
    creator,
    copyright,
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
    includeSubfolders,
    months,
    selectedPaths,
    selectedPreset,
  ]);

  const setPresetFields = (fields: ImportPresetFields) => {
    setKeywords(fields.keywords);
    setCreator(fields.creator);
    setCopyright(fields.copyright);
    setFilenameTemplate(fields.template);
    setCustomTexts(fields.texts);
  };

  const savePresets = (next: Array<ImportPreset>) => {
    const { appSettings, handleSettingsChange } = useSettingsStore.getState();
    if (appSettings) void handleSettingsChange({ ...appSettings, importPresets: next });
  };

  const setClearsEmpty = (value: boolean) => {
    const { appSettings, handleSettingsChange } = useSettingsStore.getState();
    if (appSettings) void handleSettingsChange({ ...appSettings, importPresetClearsEmpty: value });
  };

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      // The template bar's own dialogs sit inside this one; their keys are theirs.
      const target = e.target as HTMLElement;
      if (target.closest('[role="dialog"]') !== dialogRef.current) return;
      if (e.key === 'Enter') {
        // A focused button (a dropdown, a source, Copy / Move, a tile) keeps Enter for itself.
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
  const sourceLabel = !source
    ? ''
    : activeVolume
      ? activeVolume.name
      : source.isFiles
        ? t('modals.importSettings.fileCount', { count: source.paths.length })
        : source.paths.map(fileName).join(', ');

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
        className={`bg-surface rounded-lg shadow-xl p-6 w-[96vw] max-w-[2200px] h-[92vh] flex flex-col transform transition-all duration-300 ease-out ${
          show ? 'scale-100 opacity-100 translate-y-0' : 'scale-95 opacity-0 -translate-y-4'
        }`}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <Text variant={TextVariants.title} className="mb-4">
          {t('modals.importSettings.title')}
        </Text>

        <div className="flex-1 min-h-0 flex gap-6 text-sm">
          <div className="flex-1 min-w-0 flex flex-col gap-3">
            <div>
              <Text variant={TextVariants.heading} className="block mb-2">
                {t('modals.importSettings.source')}
              </Text>
              <div className="flex flex-wrap gap-2">
                {volumes.map((volume) => (
                  <button
                    className={sourceButtonClass(activeVolume?.path === volume.path)}
                    data-tooltip={volume.path}
                    key={volume.path}
                    onClick={() => setSource({ paths: [volume.path], isFiles: false })}
                    type="button"
                  >
                    <HardDrive size={16} />
                    {volume.name}
                  </button>
                ))}
                <button className={sourceButtonClass(false)} onClick={handleChooseSourceFolder} type="button">
                  <FolderOpen size={16} />
                  {t('modals.importSettings.sourceFolder')}
                </button>
                <button className={sourceButtonClass(false)} onClick={handleChooseSourceFiles} type="button">
                  <Files size={16} />
                  {t('modals.importSettings.sourceFiles')}
                </button>
              </div>
            </div>

            {source && (
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                <Text as="div" className="min-w-0 flex-1 truncate font-mono" data-tooltip={source.paths.join('\n')}>
                  {sourceLabel}
                </Text>
                {!source.isFiles && (
                  <Switch
                    checked={includeSubfolders}
                    label={t('modals.importSettings.includeSubfolders')}
                    onChange={setIncludeSubfolders}
                  />
                )}
              </div>
            )}

            {candidates.length > 0 && !isScanning && (
              <div className="flex items-center justify-between gap-3">
                <Text variant={TextVariants.small}>
                  {t('modals.importSettings.selectedCount', { selected: fileCount, total: candidates.length })}
                </Text>
                <div className="flex gap-2">
                  <button
                    className={sourceButtonClass(false)}
                    onClick={() => setChecked(new Set(candidates.map((candidate) => candidate.path)))}
                    type="button"
                  >
                    {t('modals.importSettings.checkAll')}
                  </button>
                  <button className={sourceButtonClass(false)} onClick={() => setChecked(new Set())} type="button">
                    {t('modals.importSettings.uncheckAll')}
                  </button>
                </div>
              </div>
            )}

            <ImportSourceGrid
              candidates={candidates}
              checked={checked}
              isScanning={isScanning}
              onCheckedChange={setChecked}
            />
            {!isScanning && candidates.length === 0 && (
              <div className="flex-1 flex items-center justify-center text-center">
                <Text>{t(source ? 'modals.importSettings.noPhotos' : 'modals.importSettings.noSource')}</Text>
              </div>
            )}
          </div>

          <div className="w-[26rem] shrink-0 overflow-y-auto space-y-6 pr-1">
            <div className="space-y-2">
              <Text variant={TextVariants.heading} className="block">
                {t('modals.importSettings.presets.heading')}
              </Text>
              <NamedPresetBar
                create={(name) => createImportPreset(name, presetFields)}
                exportCommand={Invokes.ExportImportPresets}
                importCommand={Invokes.ImportImportPresets}
                isDirty={!!selectedPreset && isImportPresetDirty(selectedPreset, presetFields, clearsEmpty)}
                labels={{
                  placeholder: t('modals.importSettings.presets.placeholder'),
                  save: t('modals.importSettings.presets.save'),
                  saveTitle: t('modals.importSettings.presets.saveTitle'),
                  renameTitle: t('modals.importSettings.presets.renameTitle'),
                  deleteTitle: t('modals.importSettings.presets.deleteTitle'),
                  deleteMessage: (name) => t('modals.importSettings.presets.deleteMessage', { name }),
                  nameConflict: t('modals.importSettings.presets.nameConflict'),
                  fileName: t('modals.importSettings.presets.fileName'),
                  importNone: t('modals.importSettings.presets.importNone'),
                  imported: (count) => t('modals.importSettings.presets.imported', { count }),
                }}
                onLoad={(preset) => {
                  setPresetFields(applyImportPreset(preset, presetFields, clearsEmpty));
                  setPresetId(preset.id);
                }}
                onPresetsChange={savePresets}
                onSaved={(preset) => setPresetId(preset.id)}
                presets={presets}
                sanitize={sanitizeImportPresets}
                selected={selectedPreset}
                update={(preset) => updateImportPreset(preset, presetFields)}
              />
              <Switch
                checked={clearsEmpty}
                label={t('modals.importSettings.presets.clearsEmpty')}
                onChange={setClearsEmpty}
                tooltip={t('modals.importSettings.presets.clearsEmptyTooltip')}
              />
            </div>

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

            <div className="space-y-3">
              <Text variant={TextVariants.heading} className="block">
                {t('modals.importSettings.metadata')}
              </Text>
              <div>
                <Text variant={TextVariants.label} className="block mb-1">
                  {t('modals.importSettings.keywords')}
                </Text>
                <ImportKeywordField keywords={keywords} onChange={setKeywords} />
              </div>
              {[
                { label: t('editor.metadata.fields.author'), value: creator, onChange: setCreator },
                { label: t('editor.metadata.fields.copyright'), value: copyright, onChange: setCopyright },
              ].map((field) => (
                <label className="block" key={field.label}>
                  <Text as="span" variant={TextVariants.label} className="block mb-1">
                    {field.label}
                  </Text>
                  <input
                    className="w-full bg-bg-primary border border-surface rounded-md p-2 text-sm text-text-primary focus:ring-accent focus:border-accent"
                    onChange={(e) => field.onChange(e.target.value)}
                    type="text"
                    value={field.value}
                  />
                </label>
              ))}
              <Text variant={TextVariants.small}>{t('modals.importSettings.metadataHelp')}</Text>
            </div>

            {preview?.stem && destination && (
              <Text variant={TextVariants.small} className="font-mono break-all">
                {`${t('modals.importSettings.example')}: ${exampleDestination}`}
              </Text>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-3 mt-6">
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
