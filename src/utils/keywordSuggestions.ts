import { ImageFile } from '../components/ui/AppProperties';
import { USER_TAG_PREFIX } from './keywords';

// Photos taken this close to the active photo suggest their keywords, more strongly the closer they are.
const CAPTURE_WINDOW_MS = 30 * 60 * 1000;
const CAPTURE_WEIGHT = 2;
// Weight per keyword a photo shares with the active photo, for that photo's other keywords.
const SHARED_KEYWORD_WEIGHT = 1;

/** Parses an EXIF `YYYY:MM:DD HH:MM:SS` date, ignoring the time zone. */
const parseExifDate = (value: unknown): number | null => {
  const match = typeof value === 'string' && value.match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match.map(Number);
  return Date.UTC(year, month - 1, day, hour, minute, second);
};

const userKeywords = (image: ImageFile | undefined) =>
  (image?.tags || []).filter((tag) => tag.startsWith(USER_TAG_PREFIX)).map((tag) => tag.slice(USER_TAG_PREFIX.length));

interface KeywordSuggestionInput {
  activePath: string | null;
  imageList: ImageFile[];
  limit: number;
  targetPaths: string[];
}

/**
 * Suggests keyword paths for the active photo from the other loaded photos: keywords on photos
 * taken around the same time, and keywords used together with the ones the active photo already
 * has. Keywords already on every target photo are left out.
 */
export const suggestKeywords = ({ activePath, imageList, limit, targetPaths }: KeywordSuggestionInput): string[] => {
  const targets = new Set(targetPaths);
  const targetImages = imageList.filter((image) => targets.has(image.path));
  const appliedEverywhere = (keyword: string) =>
    targetImages.length > 0 && targetImages.every((image) => image.tags?.includes(`${USER_TAG_PREFIX}${keyword}`));

  const activeImage = imageList.find((image) => image.path === activePath);
  const activeKeywords = new Set(userKeywords(activeImage));
  const activeTime = parseExifDate(activeImage?.exif?.DateTimeOriginal);
  const scores = new Map<string, number>();

  for (const image of imageList) {
    if (targets.has(image.path) || image.path === activePath) continue;
    const keywords = userKeywords(image);
    if (keywords.length === 0) continue;

    const time = activeTime === null ? null : parseExifDate(image.exif?.DateTimeOriginal);
    const closeness = activeTime === null || time === null ? 0 : 1 - Math.abs(time - activeTime) / CAPTURE_WINDOW_MS;
    const sharedCount = keywords.filter((keyword) => activeKeywords.has(keyword)).length;
    const score = Math.max(closeness, 0) * CAPTURE_WEIGHT + sharedCount * SHARED_KEYWORD_WEIGHT;
    if (score <= 0) continue;

    for (const keyword of keywords) {
      scores.set(keyword, (scores.get(keyword) || 0) + score);
    }
  }

  return [...scores.entries()]
    .filter(([keyword]) => !appliedEverywhere(keyword))
    .sort(([leftKeyword, left], [rightKeyword, right]) => right - left || leftKeyword.localeCompare(rightKeyword))
    .slice(0, limit)
    .map(([keyword]) => keyword);
};

/** Every user keyword path known to the app, for AI suggestions in the user's own vocabulary. */
export const collectUserKeywords = (imageList: ImageFile[], keywordSetKeywords: string[]): string[] => {
  const keywords = new Set(keywordSetKeywords.filter(Boolean));
  for (const image of imageList) {
    userKeywords(image).forEach((keyword) => keywords.add(keyword));
  }
  return [...keywords];
};
