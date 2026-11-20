/**
 * Import Presets (Plan item 64 phase 4, `docs/IMPORT_PLAN.md` decisions 19 and 20): named sets of
 * the Import dialog's keywords, author, copyright and file name template with its Custom Texts,
 * kept in the app settings (`importPresets`). The template part is a `FilenameTemplate`'s, stored
 * as text, so the template helpers apply to it unchanged.
 */
import { presetIdentities } from './namedPresets';
import { FilenameTemplate, isFilenameTemplateDirty, normalizeCustomTexts, withTemplate } from './filenameTemplates';
import { USER_TAG_PREFIX, isSameKeyword } from './keywords';

export interface ImportPreset extends FilenameTemplate {
  /** Stored tags (`user:Places|Berlin`). */
  keywords: Array<string>;
  creator: string;
  copyright: string;
}

/** The Import dialog's fields a preset holds. */
export interface ImportPresetFields {
  keywords: Array<string>;
  creator: string;
  copyright: string;
  template: string;
  /** One per `{text}`, `{text2}`, `{text3}`. */
  texts: Array<string>;
}

/** A preset with this id and name holding `fields`. */
const withFields = ({ id, name }: { id: string; name: string }, fields: ImportPresetFields): ImportPreset => ({
  ...withTemplate({ id, name }, fields.template.trim(), fields.texts),
  keywords: [...fields.keywords],
  creator: fields.creator.trim(),
  copyright: fields.copyright.trim(),
});

export const createImportPreset = (name: string, fields: ImportPresetFields): ImportPreset =>
  withFields({ id: crypto.randomUUID(), name: name.trim() }, fields);

/** `preset` overwritten with `fields`, keeping its id and name. */
export const updateImportPreset = (preset: ImportPreset, fields: ImportPresetFields): ImportPreset =>
  withFields(preset, fields);

/**
 * The dialog's fields after picking `preset`. With `clearsEmpty`, a field the preset leaves empty
 * empties the dialog's too; else the dialog keeps what it holds (decision 20). An empty template
 * always keeps the dialog's, since an import needs one.
 */
export const applyImportPreset = (
  preset: ImportPreset,
  current: ImportPresetFields,
  clearsEmpty: boolean,
): ImportPresetFields => {
  const pick = <T>(value: T, isEmpty: boolean, kept: T) => (clearsEmpty || !isEmpty ? value : kept);
  const hasTemplate = preset.template.trim() !== '';
  return {
    keywords: pick(preset.keywords, preset.keywords.length === 0, current.keywords),
    creator: pick(preset.creator, !preset.creator, current.creator),
    copyright: pick(preset.copyright, !preset.copyright, current.copyright),
    template: hasTemplate ? preset.template : current.template,
    // Like picking a saved template: its own texts when it has some, else the dialog's.
    texts: hasTemplate && preset.texts !== undefined ? normalizeCustomTexts(preset.texts) : current.texts,
  };
};

const sameKeywords = (left: Array<string>, right: Array<string>) =>
  left.length === right.length && left.every((tag) => right.some((other) => isSameKeyword(tag, other)));

/** Whether the dialog's fields differ from what picking `preset` would give them. */
export const isImportPresetDirty = (preset: ImportPreset, current: ImportPresetFields, clearsEmpty: boolean) => {
  const applied = applyImportPreset(preset, current, clearsEmpty);
  return (
    !sameKeywords(applied.keywords, current.keywords) ||
    applied.creator !== current.creator.trim() ||
    applied.copyright !== current.copyright.trim() ||
    isFilenameTemplateDirty(
      { id: preset.id, name: preset.name, template: applied.template.trim(), texts: applied.texts },
      current.template.trim(),
      current.texts,
    )
  );
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

/** Stored user tags from untrusted data, each once (ignoring case). */
const sanitizeKeywords = (values: unknown): Array<string> => {
  const keywords: Array<string> = [];
  for (const value of Array.isArray(values) ? values : []) {
    if (typeof value !== 'string' || !value.startsWith(USER_TAG_PREFIX)) continue;
    if (value.length === USER_TAG_PREFIX.length) continue;
    if (!keywords.some((kept) => isSameKeyword(kept, value))) keywords.push(value);
  }
  return keywords;
};

const text = (value: unknown) => (typeof value === 'string' ? value : '');

/**
 * Presets from untrusted data (settings or a file): those without a name dropped, missing fields
 * empty; ids and names made unique against `existing`.
 */
export const sanitizeImportPresets = (values: unknown, existing: Array<ImportPreset> = []): Array<ImportPreset> => {
  const identity = presetIdentities(existing);
  const presets: Array<ImportPreset> = [];
  for (const candidate of Array.isArray(values) ? values : []) {
    if (!isRecord(candidate) || typeof candidate.name !== 'string' || !candidate.name.trim()) continue;
    presets.push(
      withFields(identity(candidate.id, candidate.name), {
        keywords: sanitizeKeywords(candidate.keywords),
        creator: text(candidate.creator),
        copyright: text(candidate.copyright),
        template: text(candidate.template),
        texts: normalizeCustomTexts(candidate.texts),
      }),
    );
  }
  return presets;
};
