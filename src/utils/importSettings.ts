import { ImportNameClash } from '../components/ui/ExportImportProperties';
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
  };
};

/** January to December in `language`, for the `MMMM` folder token. */
export const monthNames = (language: string): Array<string> => {
  const format = new Intl.DateTimeFormat(language, { month: 'long' });
  return Array.from({ length: 12 }, (_, month) => format.format(new Date(2000, month, 1)));
};
