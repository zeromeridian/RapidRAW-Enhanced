import { ImageFile, LibraryViewMode } from '../components/ui/AppProperties';

interface FolderCacheEntry {
  images: ImageFile[];
  lastAccessed: number;
}

const MAX_CACHE_ENTRIES = 12;
const MAX_CACHED_IMAGES = 100_000;

const entries = new Map<string, FolderCacheEntry>();

export const createFolderCacheKey = (
  path: string,
  viewMode: LibraryViewMode | undefined,
  xmpSyncEnabled: boolean,
  platform: string | undefined,
) => {
  let normalizedPath = path.replace(/\\/g, '/').replace(/\/+$/, '');
  if (platform === 'windows') normalizedPath = normalizedPath.toLocaleLowerCase('en-US');
  return `${viewMode ?? LibraryViewMode.Flat}|${xmpSyncEnabled ? 'xmp' : 'sidecar'}|${normalizedPath}`;
};

const prune = () => {
  let totalImages = 0;
  const oldestFirst = [...entries.entries()].sort((a, b) => a[1].lastAccessed - b[1].lastAccessed);
  for (const [, entry] of oldestFirst) totalImages += entry.images.length;

  while (oldestFirst.length > MAX_CACHE_ENTRIES || totalImages > MAX_CACHED_IMAGES) {
    const oldest = oldestFirst.shift();
    if (!oldest) break;
    entries.delete(oldest[0]);
    totalImages -= oldest[1].images.length;
  }
};

export const libraryFolderCache = {
  get(key: string): ImageFile[] | undefined {
    const entry = entries.get(key);
    if (!entry) return undefined;
    entry.lastAccessed = Date.now();
    return entry.images;
  },

  set(key: string, images: ImageFile[]) {
    entries.set(key, { images, lastAccessed: Date.now() });
    prune();
  },

  updateImages(updates: Record<string, Partial<ImageFile>>) {
    if (Object.keys(updates).length === 0) return;
    for (const entry of entries.values()) {
      let changed = false;
      const images = entry.images.map((image) => {
        const update = updates[image.path];
        if (!update) return image;
        changed = true;
        return { ...image, ...update };
      });
      if (changed) entry.images = images;
    }
  },

  updateImage(path: string, update: Partial<ImageFile>) {
    this.updateImages({ [path]: update });
  },

  deletePaths(paths: Iterable<string>) {
    const removed = new Set(paths);
    for (const entry of entries.values()) {
      entry.images = entry.images.filter((image) => !removed.has(image.path));
    }
  },

  clear() {
    entries.clear();
  },
};
