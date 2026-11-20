import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { toast } from 'react-toastify';
import { ImportNameClash } from '../components/ui/ExportImportProperties';
import { useSettingsStore } from '../store/useSettingsStore';
import { DEFAULT_IMPORT_TEMPLATE } from './filenameTemplates';

/**
 * The date subfolder choices of the Import dialog (Lightroom Classic's list): tokens as in Rust
 * `photo_import::date_subfolder`, `MMMM` being the month's name.
 */
export const DATE_FOLDER_FORMATS = [
  'YYYY/YYYY-MM-DD',
  'YYYY/YYYY-MM/YYYY-MM-DD',
  'YYYY/MM/DD',
  'YYYY/MM-DD',
  'YYYY-MM-DD',
  'YYYY/MMMM/DD',
] as const;

export const DEFAULT_DATE_FOLDER_FORMAT = 'YYYY/MM-DD';

/** The Import dialog's choices that reopen with it (owner 2026-11-19; never Move). */
export interface LastImportSettings {
  /** Null: the folder open in the Library. */
  destination: string | null;
  organizeByDate: boolean;
  dateFolderFormat: string;
  filenameTemplate: string;
  nameClash: ImportNameClash;
  /** Whether a folder or card source lists its subfolders' photos too. */
  includeSubfolders: boolean;
  /** Given to every imported photo; remembered, unlike the keywords (decision 9). */
  creator: string;
  copyright: string;
}

const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.trim() !== '';

/** `AppSettings.lastImportSettings` as saved, with every missing or broken field at its default. */
export const readLastImportSettings = (value: unknown): LastImportSettings => {
  const saved = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  return {
    destination: isNonEmptyString(saved.destination) ? saved.destination : null,
    organizeByDate: saved.organizeByDate === true,
    dateFolderFormat: isNonEmptyString(saved.dateFolderFormat) ? saved.dateFolderFormat : DEFAULT_DATE_FOLDER_FORMAT,
    filenameTemplate: isNonEmptyString(saved.filenameTemplate) ? saved.filenameTemplate : DEFAULT_IMPORT_TEMPLATE,
    nameClash: saved.nameClash === ImportNameClash.Skip ? ImportNameClash.Skip : ImportNameClash.AddSuffix,
    includeSubfolders: saved.includeSubfolders !== false,
    creator: typeof saved.creator === 'string' ? saved.creator : '',
    copyright: typeof saved.copyright === 'string' ? saved.copyright : '',
  };
};

/**
 * Asks for photos to import in the system's file dialog: the supported ones, or null when none
 * were picked or an unsupported one was (which is reported). Android names content URIs first.
 */
export const pickImportFiles = async (): Promise<Array<string> | null> => {
  const { supportedTypes, osPlatform } = useSettingsStore.getState();
  const isAndroid = osPlatform === 'android';

  try {
    const expandExtensions = (exts: string[]) =>
      Array.from(new Set(exts.flatMap((ext) => [ext.toLowerCase(), ext.toUpperCase()])));
    const processedNonRaw = expandExtensions(supportedTypes?.nonRaw || []);
    const processedRaw = expandExtensions(supportedTypes?.raw || []);
    const allImageExtensions = [...processedNonRaw, ...processedRaw];

    const typeFilters = isAndroid
      ? []
      : [
          { name: 'All Supported Images', extensions: allImageExtensions },
          { name: 'RAW Images', extensions: processedRaw },
          { name: 'Standard Images (JPEG, PNG, etc.)', extensions: processedNonRaw },
          { name: 'All Files', extensions: ['*'] },
        ];

    const selected = await open({ filters: typeFilters, multiple: true, title: 'Select files to import' });
    if (!Array.isArray(selected) || selected.length === 0) return null;

    const allowedExtensions = new Set(allImageExtensions.map((e) => e.toLowerCase()));
    const resolvedFiles = await Promise.all(
      selected.map(async (path) => {
        if (!isAndroid) return path;
        try {
          return await invoke<string>('resolve_android_content_uri_name', { uriStr: path });
        } catch (e) {
          console.error('Failed to resolve URI:', e);
          return path;
        }
      }),
    );

    const invalidExtensions = new Set<string>();
    const validFiles = selected.filter((_, index) => {
      const ext = resolvedFiles[index].split('.').pop()?.toLowerCase() || 'unknown';
      if (allowedExtensions.has(ext)) return true;
      invalidExtensions.add(`.${ext}`);
      return false;
    });

    if (invalidExtensions.size > 0) {
      toast.error(`Unsupported file format(s) detected: ${Array.from(invalidExtensions).join(', ')}`);
      return null;
    }
    return validFiles;
  } catch (err) {
    console.error('Failed to open file dialog for import:', err);
    return null;
  }
};

/** January to December in `language`, for the `MMMM` folder token. */
export const monthNames = (language: string): Array<string> => {
  const format = new Intl.DateTimeFormat(language, { month: 'long' });
  return Array.from({ length: 12 }, (_, month) => format.format(new Date(2000, month, 1)));
};
