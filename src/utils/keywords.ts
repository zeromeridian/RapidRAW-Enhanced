export const USER_TAG_PREFIX = 'user:';

// Separates the levels of a stored keyword path, as in Lightroom Classic's `lr:hierarchicalSubject`.
export const KEYWORD_PATH_SEPARATOR = '|';

// Number of keywords in a keyword set, one per Option/Alt+1…9 shortcut (`KEYWORD_SET_SIZE` in Rust).
export const KEYWORD_SET_SIZE = 9;

const KEYWORD_INPUT_SEPARATOR = /[>|]/;

export interface KeywordSet {
  id: string;
  name: string;
  // Keyword paths without the `user:` prefix; an empty string is an empty slot.
  keywords: string[];
}

/**
 * Normalizes typed keyword text into a stored keyword path; `>` separates hierarchy levels, so
 * `Places > Germany` becomes `places|germany`. Returns an empty string when nothing remains.
 */
export const parseKeywordInput = (input: string) =>
  input
    .split(KEYWORD_INPUT_SEPARATOR)
    .map((level) => level.trim().toLowerCase())
    .filter(Boolean)
    .join(KEYWORD_PATH_SEPARATOR);

/** Displays a keyword path such as `places|germany` as `places › germany`; `' > '` gives editable text. */
export const formatKeyword = (keyword: string, separator = ' › ') =>
  keyword.split(KEYWORD_PATH_SEPARATOR).join(separator);

interface KeywordSetSettings {
  activeKeywordSet?: string | null;
  keywordSets?: unknown;
}

/** Reads the saved keyword sets, ignoring malformed entries and giving each exactly nine slots. */
export const getKeywordSets = (settings?: KeywordSetSettings | null): KeywordSet[] => {
  if (!Array.isArray(settings?.keywordSets)) return [];
  return settings.keywordSets
    .filter(
      (set): set is KeywordSet =>
        !!set && typeof set.id === 'string' && typeof set.name === 'string' && Array.isArray(set.keywords),
    )
    .map((set) => ({
      id: set.id,
      name: set.name,
      keywords: Array.from({ length: KEYWORD_SET_SIZE }, (_, index) =>
        typeof set.keywords[index] === 'string' ? set.keywords[index] : '',
      ),
    }));
};

/** The selected keyword set, or the first one when the selection no longer exists. */
export const getActiveKeywordSet = (settings?: KeywordSetSettings | null): KeywordSet | null => {
  const sets = getKeywordSets(settings);
  return sets.find((set) => set.id === settings?.activeKeywordSet) ?? sets[0] ?? null;
};
