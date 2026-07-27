import { ImageFile, ImageStack } from '../components/ui/AppProperties';
import { GroupBadgeInfo, GroupId, StackMemberPosition } from './imageGrouping';

const getStackMemberPosition = (index: number, memberCount: number): StackMemberPosition => {
  if (memberCount === 1) return 'only';
  if (index === 0) return 'first';
  if (index === memberCount - 1) return 'last';
  return 'middle';
};

const createStackBadge = (
  stack: ImageStack,
  path: string,
  index: number,
  visibleMemberCount: number,
): GroupBadgeInfo => ({
  count: stack.paths.length,
  label: `Stack · ${stack.paths.length}`,
  stackVisual: {
    collapsed: stack.collapsed,
    isCover: path === stack.coverPath,
    position: getStackMemberPosition(index, visibleMemberCount),
  },
});

export const findImageStack = (stacks: ImageStack[], path: string) =>
  stacks.find((stack) => stack.paths.includes(path));

export const createImageStack = (stacks: ImageStack[], paths: string[], coverPath: string): ImageStack[] => {
  if (paths.length < 2) return stacks;

  const selectedPaths = new Set(paths);
  const remainingStacks = stacks
    .map((stack) => ({ ...stack, paths: stack.paths.filter((path) => !selectedPaths.has(path)) }))
    .filter((stack) => stack.paths.length >= 2)
    .map((stack) => ({
      ...stack,
      coverPath: stack.paths.includes(stack.coverPath) ? stack.coverPath : stack.paths[0],
    }));

  return [
    ...remainingStacks,
    {
      id: `stack-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      paths,
      coverPath: paths.includes(coverPath) ? coverPath : paths[0],
      collapsed: true,
    },
  ];
};

export const toggleImageStack = (stacks: ImageStack[], stackId: string): ImageStack[] =>
  stacks.map((stack) => (stack.id === stackId ? { ...stack, collapsed: !stack.collapsed } : stack));

export const setImageStackCover = (stacks: ImageStack[], stackId: string, coverPath: string): ImageStack[] =>
  stacks.map((stack) => (stack.id === stackId && stack.paths.includes(coverPath) ? { ...stack, coverPath } : stack));

export const unstackImagePaths = (stacks: ImageStack[], paths: string[]): ImageStack[] => {
  const selectedPaths = new Set(paths);
  return stacks.filter((stack) => !stack.paths.some((path) => selectedPaths.has(path)));
};

export function reorderStackPaths(
  paths: string[],
  sourcePath: string,
  targetPath: string,
  placeAfterTarget: boolean,
): string[] {
  if (sourcePath === targetPath || !paths.includes(sourcePath) || !paths.includes(targetPath)) return paths;

  const reordered = paths.filter((path) => path !== sourcePath);
  const targetIndex = reordered.indexOf(targetPath);
  reordered.splice(targetIndex + (placeAfterTarget ? 1 : 0), 0, sourcePath);
  return reordered;
}

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
      badges.set(cover.path, createStackBadge(stack, cover.path, 0, 1));
      continue;
    }

    const visibleByPath = new Map(visibleMembers.map((image) => [image.path, image]));
    const orderedMembers = stack.paths
      .map((path) => visibleByPath.get(path))
      .filter((image): image is ImageFile => Boolean(image));
    displayList.splice(insertionIndex, 0, ...orderedMembers);
    orderedMembers.forEach((member, index) => {
      badges.set(member.path, createStackBadge(stack, member.path, index, orderedMembers.length));
    });
  }

  return { displayList, badges };
}
