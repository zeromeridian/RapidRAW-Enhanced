import { GroupPreference, ImageFile } from '../components/ui/AppProperties';

export type GroupId = string;

export interface ImageGroup {
  groupId: GroupId;
  primary: ImageFile;
  variants: ImageFile[];
  virtualCopies: ImageFile[];
  hasRaw: boolean;
  hasNonRaw: boolean;
}

export interface GroupingResult {
  groups: Map<GroupId, ImageGroup>;
  /** Image list with non-primary variants filtered out. */
  displayList: ImageFile[];
}

/**
 * Bucket images by their backend-assigned group_id, pick a primary per
 * group, return a collapsed display list. Virtual copies stay visible
 * (never collapsed).
 */
export function buildImageGroups(images: ImageFile[], preference: GroupPreference): GroupingResult {
  const buckets = new Map<GroupId, { files: ImageFile[]; vcs: ImageFile[] }>();

  for (const image of images) {
    if (!image.group_id) continue;

    let bucket = buckets.get(image.group_id);
    if (!bucket) {
      bucket = { files: [], vcs: [] };
      buckets.set(image.group_id, bucket);
    }

    if (image.is_virtual_copy) {
      bucket.vcs.push(image);
    } else {
      bucket.files.push(image);
    }
  }

  const groups = new Map<GroupId, ImageGroup>();
  const groupedPaths = new Set<string>();

  for (const [groupId, bucket] of buckets) {
    if (bucket.files.length < 2) continue;

    const hasRaw = bucket.files.some((f) => f.is_raw);
    const hasNonRaw = bucket.files.some((f) => !f.is_raw);
    const primary = pickPrimary(bucket.files, preference);

    groups.set(groupId, {
      groupId,
      primary,
      variants: bucket.files,
      virtualCopies: bucket.vcs,
      hasRaw,
      hasNonRaw,
    });

    for (const file of bucket.files) {
      if (file.path !== primary.path) {
        groupedPaths.add(file.path);
      }
    }
  }

  const displayList = images.filter((img) => !groupedPaths.has(img.path));

  return { groups, displayList };
}

function pickPrimary(files: ImageFile[], preference: GroupPreference): ImageFile {
  const raw = files.find((f) => f.is_raw);
  const nonRaw = files.find((f) => !f.is_raw);

  switch (preference) {
    case 'raw':
      return raw ?? nonRaw ?? files[0];
    case 'jpeg':
      return nonRaw ?? raw ?? files[0];
    default:
      return files[0];
  }
}

/** File extension from a path, lowercased. Handles ?vc= suffixes. */
export function getFileExtension(path: string): string {
  const clean = path.split('?')[0];
  const dot = clean.lastIndexOf('.');
  if (dot === -1) return '';
  return clean.substring(dot + 1).toLowerCase();
}

/** Display label for a variant: uppercase extension (e.g. "RAF", "JPG"). */
export function getVariantLabel(path: string): string {
  const ext = getFileExtension(path);
  return ext ? ext.toUpperCase() : 'FILE';
}

export interface GroupBadgeInfo {
  count: number;
  label: string;
}

/**
 * Build a map from group_id to badge display info (variant count and
 * extension label like "RAF+JPG"). Only includes groups with 2+ non-VC
 * files. Operates on the raw image list, not the display list.
 */
export function buildGroupBadgeInfo(images: ImageFile[]): Map<string, GroupBadgeInfo> {
  const groups = new Map<string, ImageFile[]>();

  for (const image of images) {
    if (!image.group_id || image.is_virtual_copy) continue;
    let group = groups.get(image.group_id);
    if (!group) {
      group = [];
      groups.set(image.group_id, group);
    }
    group.push(image);
  }

  const badges = new Map<string, GroupBadgeInfo>();
  for (const [groupId, files] of groups) {
    if (files.length < 2) continue;
    const extensions = new Set(files.map((f) => getVariantLabel(f.path)));
    badges.set(groupId, {
      count: files.length,
      label: Array.from(extensions).join('+'),
    });
  }
  return badges;
}

/**
 * Find all non-VC variants sharing a group_id with the image at the
 * given path. Returns an empty array when not grouped.
 */
export function findGroupVariants(images: ImageFile[], path: string): ImageFile[] {
  const target = images.find((img) => img.path === path);
  if (!target?.group_id) return [];
  return images.filter((img) => img.group_id === target.group_id && !img.is_virtual_copy);
}
