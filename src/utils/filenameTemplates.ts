/**
 * Named file-name templates, shared by rename, export and import like Lightroom Classic's
 * (owner 2026-11-16), and kept in the app settings (`filenameTemplates`). The syntax and
 * tokens are `naming.rs`'s.
 */
import { presetIdentities } from './namedPresets';

/** The export template until another is chosen; Rust's `DEFAULT_FILENAME_TEMPLATE` is the same. */
export const DEFAULT_EXPORT_TEMPLATE = '{filename}_edited';
/** The import template until another is chosen. */
export const DEFAULT_IMPORT_TEMPLATE = '{filename}';

export interface FilenameTemplate {
  id: string;
  name: string;
  template: string;
  /**
   * The Custom Texts saved with a template that uses `{text}`, `{text2}` or `{text3}`
   * (owner 2026-11-16), one per slot; `CUSTOM_TEXT_SLOTS` long.
   */
  texts?: Array<string>;
}

/** `{text}` (also `{text1}`), `{text2}`, `{text3}` (owner 2026-11-16). */
export const CUSTOM_TEXT_SLOTS = 3;

/** Exactly `CUSTOM_TEXT_SLOTS` texts from `values`, missing ones empty. */
export const normalizeCustomTexts = (values: unknown): Array<string> =>
  Array.from({ length: CUSTOM_TEXT_SLOTS }, (_, slot) => {
    const value = Array.isArray(values) ? values[slot] : undefined;
    return typeof value === 'string' ? value : '';
  });

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
  { id: 'custom', tokens: ['{text}', '{text2}', '{text3}'] },
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

/**
 * The Custom Text slots `template` uses (0 for `{text}`/`{text1}`, 1 for `{text2}`, 2 for
 * `{text3}`), with or without a format, filters or a fallback; in slot order.
 */
export const customTextSlots = (template: string): Array<number> => {
  const used = new Set<number>();
  for (const match of template.matchAll(/\{text([123]?)[:|?}]/g)) {
    used.add(match[1] ? Number(match[1]) - 1 : 0);
  }
  return [...used].sort((a, b) => a - b);
};

/** The texts sent with `template`: all slots when it uses any, else none. */
export const textsForTemplate = (template: string, texts: Array<string>): Array<string> | null =>
  customTextSlots(template).length > 0 ? normalizeCustomTexts(texts) : null;

/** A template with this id and name holding `template` and the Custom Texts of the slots it uses. */
export const withTemplate = (
  { id, name }: { id: string; name: string },
  template: string,
  texts: Array<string>,
): FilenameTemplate => {
  const slots = customTextSlots(template);
  if (slots.length === 0) return { id, name, template };
  const kept = normalizeCustomTexts(texts).map((text, slot) => (slots.includes(slot) ? text : ''));
  return { id, name, template, texts: kept };
};

export const createFilenameTemplate = (name: string, template: string, texts: Array<string>): FilenameTemplate =>
  withTemplate({ id: crypto.randomUUID(), name: name.trim() }, template, texts);

/** Whether the dialog's template and the Custom Texts it uses differ from `preset`. */
export const isFilenameTemplateDirty = (preset: FilenameTemplate, template: string, texts: Array<string>) => {
  const saved = normalizeCustomTexts(preset.texts);
  const current = normalizeCustomTexts(texts);
  return preset.template !== template || customTextSlots(template).some((slot) => saved[slot] !== current[slot]);
};

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
    // Templates saved before there were three texts hold one `text`.
    const texts = normalizeCustomTexts(
      Array.isArray(candidate.texts) ? candidate.texts : [typeof candidate.text === 'string' ? candidate.text : ''],
    );
    templates.push(withTemplate(identity(candidate.id, candidate.name), candidate.template, texts));
  }
  return templates;
};

/** The names of the starter templates, in the app's language. */
export interface FilenameTemplateStarterNames {
  filename: string;
  filenameEdited: string;
  customSequence: string;
  customNumber: string;
  dateFilename: string;
  dateTimeCamera: string;
}

/** Starter templates after Lightroom Classic's built-in ones; editable and deletable. */
const starterTemplates = (names: FilenameTemplateStarterNames): FilenameTemplate[] => [
  { id: 'filename-starter-filename', name: names.filename, template: '{filename}' },
  // Export's default name (owner 2026-11-16).
  { id: 'filename-starter-filename-edited', name: names.filenameEdited, template: DEFAULT_EXPORT_TEMPLATE },
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
