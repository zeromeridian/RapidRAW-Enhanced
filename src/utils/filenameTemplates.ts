/**
 * Named file-name templates, shared by rename, export and import like Lightroom Classic's
 * (owner 2026-11-16), and kept in the app settings (`filenameTemplates`). The syntax and
 * tokens are `naming.rs`'s.
 */
import { presetIdentities } from './namedPresets';

export interface FilenameTemplate {
  id: string;
  name: string;
  template: string;
  /** The Custom Text saved with a template that uses `{text}` (owner 2026-11-16). */
  text?: string;
}

/** The tokens the template editor offers as chips, by group. */
export const FILENAME_TOKEN_GROUPS = [
  { id: 'file', tokens: ['{filename}', '{original_filename}', '{original_filename_number}'] },
  { id: 'sequence', tokens: ['{seq}', '{seq:3}', '{seq:4:start=1}'] },
  {
    id: 'date',
    tokens: [
      '{date:YYYYMMDD}',
      '{date:YYYY-MM-DD}',
      '{capture:hhmmss}',
      '{YYYY}',
      '{YY}',
      '{MM}',
      '{DD}',
      '{hh}',
      '{mm}',
      '{ss}',
      '{filedate:YYYYMMDD}',
      '{today:YYYYMMDD}',
    ],
  },
  { id: 'camera', tokens: ['{camera}', '{lens}', '{iso}', '{focal}', '{aperture}', '{shutter}'] },
  { id: 'library', tokens: ['{rating}', '{label}'] },
  { id: 'custom', tokens: ['{text}'] },
] as const;

export type FilenameTokenGroup = (typeof FILENAME_TOKEN_GROUPS)[number]['id'];

/** A problem in a template (`naming::TemplateError`); `position` counts characters from 0. */
export interface TemplateError {
  kind:
    | 'unclosedBrace'
    | 'unmatchedClosingBrace'
    | 'emptyToken'
    | 'unknownToken'
    | 'unknownFilter'
    | 'formatNotAllowed'
    | 'invalidSequenceFormat';
  position: number;
  text: string;
}

/** One photo of a rename preview (`rename::RenamePreviewItem`). */
export interface RenamePreviewItem {
  path: string;
  newName: string;
  missing: Array<string>;
  cleaned: boolean;
  unchanged: boolean;
  clash: 'batch' | 'existingFile' | 'existingSidecar' | null;
}

/** What a rename would do (`rename::preview_rename`); nothing on disk changed. */
export interface RenamePreview {
  items: Array<RenamePreviewItem>;
  errors: Array<TemplateError>;
  clashCount: number;
}

/** Whether `template` uses the custom text (`{text}`, with or without filters or a fallback). */
export const usesCustomText = (template: string) => /\{text[:|?}]/.test(template);

/** A template with this id and name holding `template` and, if it uses `{text}`, the Custom Text. */
export const withTemplate = (
  { id, name }: { id: string; name: string },
  template: string,
  text: string,
): FilenameTemplate => (usesCustomText(template) ? { id, name, template, text } : { id, name, template });

export const createFilenameTemplate = (name: string, template: string, text: string): FilenameTemplate =>
  withTemplate({ id: crypto.randomUUID(), name: name.trim() }, template, text);

/** Whether the dialog's template and Custom Text differ from `preset`. */
export const isFilenameTemplateDirty = (preset: FilenameTemplate, template: string, text: string) =>
  preset.template !== template || (usesCustomText(template) && (preset.text ?? '') !== text);

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

/**
 * Templates from untrusted data (settings or a file): those without a name or a template
 * dropped; ids and names made unique against `existing`.
 */
export const sanitizeFilenameTemplates = (values: unknown, existing: FilenameTemplate[] = []): FilenameTemplate[] => {
  const identity = presetIdentities(existing);
  const templates: FilenameTemplate[] = [];
  for (const candidate of Array.isArray(values) ? values : []) {
    if (!isRecord(candidate) || typeof candidate.name !== 'string' || !candidate.name.trim()) continue;
    if (typeof candidate.template !== 'string' || !candidate.template.trim()) continue;
    const text = typeof candidate.text === 'string' ? candidate.text : '';
    templates.push(withTemplate(identity(candidate.id, candidate.name), candidate.template, text));
  }
  return templates;
};

/** The names of the starter templates, in the app's language. */
export interface FilenameTemplateStarterNames {
  filename: string;
  customSequence: string;
  customNumber: string;
  dateFilename: string;
  dateTimeCamera: string;
}

/** Starter templates after Lightroom Classic's built-in ones; editable and deletable. */
const starterTemplates = (names: FilenameTemplateStarterNames): FilenameTemplate[] => [
  { id: 'filename-starter-filename', name: names.filename, template: '{filename}' },
  { id: 'filename-starter-custom-sequence', name: names.customSequence, template: '{text}-{seq}' },
  {
    id: 'filename-starter-custom-number',
    name: names.customNumber,
    template: '{text}-{original_filename_number}',
  },
  { id: 'filename-starter-date-filename', name: names.dateFilename, template: '{date:YYYYMMDD}-{original_filename}' },
  {
    id: 'filename-starter-date-time-camera',
    name: names.dateTimeCamera,
    template: '{date:YYYYMMDD}-{capture:hhmmss}-{camera}',
  },
];

/**
 * The templates in the app settings, or the starter templates while the setting was never
 * written (`null`/absent); once the list is changed, even emptied, the starters are not
 * offered again.
 */
export const filenameTemplatesFromSettings = (
  value: unknown,
  names: FilenameTemplateStarterNames,
): FilenameTemplate[] => (value == null ? starterTemplates(names) : sanitizeFilenameTemplates(value));
