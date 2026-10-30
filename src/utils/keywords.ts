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

export interface KeywordTreeNode {
  // Stored keyword path without the `user:` prefix, e.g. `places|germany`
  path: string;
  name: string;
  // Images carrying exactly this keyword; 0 for a level that only exists as a parent
  count: number;
  children: KeywordTreeNode[];
}

const compareNames = (left: { name: string }, right: { name: string }) =>
  left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });

/** Arranges keyword paths and their image counts as a tree sorted by name. */
export const buildKeywordTree = (keywords: Array<{ keyword: string; count: number }>): KeywordTreeNode[] => {
  const nodes = new Map<string, KeywordTreeNode>();
  const roots: KeywordTreeNode[] = [];
  const getNode = (path: string): KeywordTreeNode => {
    const existing = nodes.get(path);
    if (existing) return existing;
    const separatorIndex = path.lastIndexOf(KEYWORD_PATH_SEPARATOR);
    const node: KeywordTreeNode = { path, name: path.slice(separatorIndex + 1), count: 0, children: [] };
    nodes.set(path, node);
    (separatorIndex === -1 ? roots : getNode(path.slice(0, separatorIndex)).children).push(node);
    return node;
  };
  keywords.forEach(({ keyword, count }) => (getNode(keyword).count = count));

  const sort = (list: KeywordTreeNode[]) => {
    list.sort(compareNames);
    list.forEach((node) => sort(node.children));
  };
  sort(roots);
  return roots;
};

/** Keeps the nodes whose name contains `query`, with their ancestors and descendants. */
export const filterKeywordTree = (nodes: KeywordTreeNode[], query: string): KeywordTreeNode[] => {
  const needle = query.trim().toLowerCase();
  if (!needle) return nodes;
  return nodes.flatMap((node) => {
    if (node.name.toLowerCase().includes(needle)) return [node];
    const children = filterKeywordTree(node.children, needle);
    return children.length > 0 ? [{ ...node, children }] : [];
  });
};

/** True when `tags` has the typed keyword path (e.g. `places > germany`) or one of its child keywords. */
export const hasKeywordOrChild = (tags: string[] | null | undefined, input: string) => {
  const path = parseKeywordInput(input);
  if (!path) return false;
  return (tags || []).some((tag) => {
    if (!tag.startsWith(USER_TAG_PREFIX)) return false;
    const keyword = tag.slice(USER_TAG_PREFIX.length).toLowerCase();
    return keyword === path || keyword.startsWith(`${path}${KEYWORD_PATH_SEPARATOR}`);
  });
};
