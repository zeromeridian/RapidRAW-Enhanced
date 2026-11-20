import type { ImageFile } from '../components/ui/AppProperties';
import { exifText, formatCameraName, getIso, parseAperture, parseFocalLength, parseShutter } from './exifValues';
import { getImageFileType } from './imageFileTypes';
import { getImageFlag } from './imageFlags';
import { userKeywords } from './keywordSuggestions';

/** A column of the Library's metadata filter bar (Lightroom Classic's Library Filter › Metadata). */
export enum MetadataField {
  Date = 'date',
  Camera = 'camera',
  Lens = 'lens',
  FocalLength = 'focalLength',
  Iso = 'iso',
  Shutter = 'shutter',
  Aperture = 'aperture',
  Keyword = 'keyword',
  Label = 'label',
  Flag = 'flag',
  Rating = 'rating',
  FileType = 'fileType',
}

export const METADATA_FIELDS = Object.values(MetadataField);
export const DEFAULT_METADATA_COLUMNS = [
  MetadataField.Date,
  MetadataField.Camera,
  MetadataField.Lens,
  MetadataField.FocalLength,
];
export const MAX_METADATA_COLUMNS = 8;

/** The values picked in each column; a photo must match one value of every column with picks. */
export type MetadataPicks = Partial<Record<MetadataField, string[]>>;

/** The value of a photo that lacks the field (no date, no lens, no keyword, no label). */
export const UNKNOWN_VALUE = '';

/** Fields read from EXIF, which a photo still being scanned does not have yet. */
const EXIF_FIELDS = new Set([
  MetadataField.Date,
  MetadataField.Camera,
  MetadataField.Lens,
  MetadataField.FocalLength,
  MetadataField.Iso,
  MetadataField.Shutter,
  MetadataField.Aperture,
]);

/** Fields whose values sort as numbers. */
const NUMERIC_FIELDS = new Set([
  MetadataField.FocalLength,
  MetadataField.Iso,
  MetadataField.Shutter,
  MetadataField.Aperture,
  MetadataField.Rating,
]);

const positive = (value: number) => (value > 0 ? String(value) : UNKNOWN_VALUE);

/** A photo's values for one field: one each, except Keyword (every keyword it has). */
export function getMetadataValues(
  image: ImageFile,
  field: MetadataField,
  imageRatings: Record<string, number>,
): string[] {
  const exif = image.exif;
  switch (field) {
    case MetadataField.Date: {
      const match = exif?.DateTimeOriginal?.match(/^(\d{4})[-:](\d{2})[-:](\d{2})/);
      return [match ? `${match[1]}-${match[2]}-${match[3]}` : UNKNOWN_VALUE];
    }
    case MetadataField.Camera:
      return [formatCameraName(exifText(exif?.Make), exifText(exif?.Model))];
    case MetadataField.Lens:
      return [exifText(exif?.LensModel || exif?.Lens)];
    case MetadataField.FocalLength:
      return [positive(Math.round(parseFocalLength(exif?.FocalLength) * 10) / 10)];
    case MetadataField.Iso:
      return [positive(getIso(exif))];
    case MetadataField.Shutter:
      return [positive(parseShutter(exif?.ExposureTime))];
    case MetadataField.Aperture:
      return [positive(Math.round(parseAperture(exif?.FNumber) * 10) / 10)];
    case MetadataField.Keyword: {
      const keywords = userKeywords(image);
      return keywords.length > 0 ? keywords : [UNKNOWN_VALUE];
    }
    case MetadataField.Label:
      return [(image.tags || []).find((tag) => tag.startsWith('color:'))?.substring(6) ?? UNKNOWN_VALUE];
    case MetadataField.Flag:
      return [getImageFlag(image.tags)];
    case MetadataField.Rating:
      return [String(imageRatings[image.path] || 0)];
    case MetadataField.FileType:
      return [getImageFileType(image) ?? UNKNOWN_VALUE];
  }
}

/**
 * Text fields whose values are one value apart from case and spacing: cameras and lenses are
 * written differently by different files ("FUJIFILM" in a RAF, "Fujifilm" in a JPEG; doubled
 * spaces in some lens names), and keywords match apart from case (`isSameKeyword`).
 */
const LOOSE_TEXT_FIELDS = new Set([MetadataField.Camera, MetadataField.Lens, MetadataField.Keyword]);

/** The form two values of a field are compared in. */
const valueKey = (field: MetadataField, value: string) =>
  LOOSE_TEXT_FIELDS.has(field) ? value.toLowerCase().replace(/\s+/g, ' ').trim() : value;

/** Whether two values of a field are the same value (a pick and a listed value, say). */
export const isSameMetadataValue = (field: MetadataField, left: string, right: string) =>
  valueKey(field, left) === valueKey(field, right);

/** Whether a photo's value matches a pick; a Date pick may be a year (`2026`) or month (`2026-11`). */
const matchesPick = (field: MetadataField, value: string, pick: string) =>
  isSameMetadataValue(field, value, pick) ||
  (field === MetadataField.Date && pick !== UNKNOWN_VALUE && value.startsWith(`${pick}-`));

export const hasMetadataPicks = (picks: MetadataPicks | undefined) =>
  Object.values(picks ?? {}).some((values) => values && values.length > 0);

/** Whether a photo matches every column that has picks; a photo still being scanned matches no EXIF column. */
export function matchesMetadataPicks(
  image: ImageFile,
  picks: MetadataPicks | undefined,
  imageRatings: Record<string, number>,
): boolean {
  for (const [field, values] of Object.entries(picks ?? {}) as Array<[MetadataField, string[] | undefined]>) {
    if (!values || values.length === 0) continue;
    if (image.metadataPending && EXIF_FIELDS.has(field)) return false;
    const photoValues = getMetadataValues(image, field, imageRatings);
    if (!photoValues.some((value) => values.some((pick) => matchesPick(field, value, pick)))) return false;
  }
  return true;
}

export interface MetadataValueCount {
  value: string;
  count: number;
}

/**
 * The values of one column with how many `images` have each, in display order: dates newest
 * first, numbers ascending, text alphabetically; the unknown value last. Camera, lens and keyword
 * values differing only in case or spacing are one row, shown in their most common spelling. Photos still being scanned are left
 * out of EXIF columns.
 */
export function listMetadataValues(
  images: ImageFile[],
  field: MetadataField,
  imageRatings: Record<string, number>,
): MetadataValueCount[] {
  // Per value key: the photo count, and how many photos use each spelling.
  const counts = new Map<string, number>();
  const spellings = new Map<string, Map<string, number>>();
  for (const image of images) {
    if (image.metadataPending && EXIF_FIELDS.has(field)) continue;
    const photoValues = new Map(getMetadataValues(image, field, imageRatings).map((v) => [valueKey(field, v), v]));
    for (const [key, value] of photoValues) {
      counts.set(key, (counts.get(key) ?? 0) + 1);
      const forKey = spellings.get(key) ?? new Map<string, number>();
      forKey.set(value, (forKey.get(value) ?? 0) + 1);
      spellings.set(key, forKey);
    }
  }
  const mostCommonSpelling = (key: string) =>
    [...(spellings.get(key) ?? [])].reduce((best, entry) => (entry[1] > best[1] ? entry : best), [key, 0])[0];
  const compare = (a: string, b: string) => {
    if (a === UNKNOWN_VALUE || b === UNKNOWN_VALUE) return a === UNKNOWN_VALUE ? 1 : -1;
    if (field === MetadataField.Date) return b.localeCompare(a);
    if (NUMERIC_FIELDS.has(field)) return parseFloat(a) - parseFloat(b);
    return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
  };
  return [...counts]
    .map(([key, count]) => ({ value: mostCommonSpelling(key), count }))
    .sort((left, right) => compare(left.value, right.value));
}

export interface DateNode extends MetadataValueCount {
  /** `2026`, `2026-11` or `2026-11-20`; the unknown date has no children. */
  children: DateNode[];
}

/** Capture days (`YYYY-MM-DD`, newest first) as a Year › Month › Day tree with summed counts. */
export function buildDateTree(days: MetadataValueCount[]): DateNode[] {
  const years: DateNode[] = [];
  for (const day of days) {
    if (day.value === UNKNOWN_VALUE) {
      years.push({ ...day, children: [] });
      continue;
    }
    const yearKey = day.value.slice(0, 4);
    const monthKey = day.value.slice(0, 7);
    let year = years.find((node) => node.value === yearKey);
    if (!year) {
      year = { value: yearKey, count: 0, children: [] };
      years.push(year);
    }
    let month = year.children.find((node) => node.value === monthKey);
    if (!month) {
      month = { value: monthKey, count: 0, children: [] };
      year.children.push(month);
    }
    year.count += day.count;
    month.count += day.count;
    month.children.push({ ...day, children: [] });
  }
  return years;
}

/** How many photos are still waiting for their EXIF. */
export const countPendingMetadata = (images: ImageFile[]) => images.filter((image) => image.metadataPending).length;
