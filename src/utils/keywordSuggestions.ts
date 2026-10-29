import { ImageFile } from '../components/ui/AppProperties';
import { USER_TAG_PREFIX } from './keywords';

const userKeywords = (image: ImageFile | undefined) =>
  (image?.tags || []).filter((tag) => tag.startsWith(USER_TAG_PREFIX)).map((tag) => tag.slice(USER_TAG_PREFIX.length));

interface KeywordSuggestionInput {
  activePath: string | null;
  imageList: ImageFile[];
  limit: number;
  targetPaths: string[];
}

/**
 * Suggests keyword paths that are used together with the keywords the active photo already has,
 * weighted by how many of them each other loaded photo shares. A photo without keywords gets no
 * suggestions, and keywords already on every target photo are left out.
 */
export const suggestKeywords = ({ activePath, imageList, limit, targetPaths }: KeywordSuggestionInput): string[] => {
  const activeKeywords = new Set(userKeywords(imageList.find((image) => image.path === activePath)));
  if (activeKeywords.size === 0) return [];

  const targets = new Set(targetPaths);
  const targetImages = imageList.filter((image) => targets.has(image.path));
  const appliedEverywhere = (keyword: string) =>
    targetImages.length > 0 && targetImages.every((image) => image.tags?.includes(`${USER_TAG_PREFIX}${keyword}`));
  const scores = new Map<string, number>();

  for (const image of imageList) {
    if (targets.has(image.path) || image.path === activePath) continue;
    const keywords = userKeywords(image);
    const sharedCount = keywords.filter((keyword) => activeKeywords.has(keyword)).length;
    if (sharedCount === 0) continue;

    for (const keyword of keywords) {
      scores.set(keyword, (scores.get(keyword) || 0) + sharedCount);
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
