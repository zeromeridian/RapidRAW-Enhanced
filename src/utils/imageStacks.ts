import { ImageFile, ImageStack } from '../components/ui/AppProperties';
import { GroupBadgeInfo, GroupId } from './imageGrouping';

export function normalizeImageStacks(stacks: ImageStack[] | undefined, availablePaths: Set<string>): ImageStack[] {
  return (stacks || [])
    .map((stack) => {
      const paths = Array.from(new Set(stack.paths)).filter((path) => availablePaths.has(path));
      return {
        ...stack,
        paths,
        coverPath: paths.includes(stack.coverPath) ? stack.coverPath : paths[0],
      };
    })
    .filter((stack) => stack.paths.length >= 2 && stack.coverPath);
}

export function applyImageStacks(
  sortedImages: ImageFile[],
  allImages: ImageFile[],
  stacks: ImageStack[] | undefined,
  existingBadges: Map<GroupId, GroupBadgeInfo> | null,
): { displayList: ImageFile[]; badges: Map<GroupId, GroupBadgeInfo> | null } {
  const availableByPath = new Map(allImages.map((image) => [image.path, image]));
  const normalizedStacks = normalizeImageStacks(stacks, new Set(availableByPath.keys()));
  if (normalizedStacks.length === 0) {
    return { displayList: sortedImages, badges: existingBadges };
  }

  let displayList = [...sortedImages];
  const badges = new Map(existingBadges || []);

  for (const stack of normalizedStacks) {
    const memberPaths = new Set(stack.paths);
    const visibleMembers = displayList.filter((image) => memberPaths.has(image.path));
    if (visibleMembers.length === 0) continue;

    const insertionIndex = Math.min(...visibleMembers.map((image) => displayList.indexOf(image)));
    displayList = displayList.filter((image) => !memberPaths.has(image.path));

    if (stack.collapsed) {
      const cover = availableByPath.get(stack.coverPath) || visibleMembers[0];
      displayList.splice(insertionIndex, 0, cover);
      badges.set(cover.path, { count: stack.paths.length, label: `Stack · ${stack.paths.length}` });
      continue;
    }

    const visibleByPath = new Map(visibleMembers.map((image) => [image.path, image]));
    const orderedMembers = stack.paths
      .map((path) => visibleByPath.get(path))
      .filter((image): image is ImageFile => Boolean(image));
    displayList.splice(insertionIndex, 0, ...orderedMembers);
    for (const member of orderedMembers) {
      badges.set(member.path, { count: stack.paths.length, label: `Stack · ${stack.paths.length}` });
    }
  }

  return { displayList, badges };
}
