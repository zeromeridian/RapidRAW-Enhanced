import { ImageFile, ImageStack } from '../components/ui/AppProperties';
import { GroupBadgeInfo, GroupId, StackMemberPosition } from './imageGrouping';

export interface AutoStackPair {
  sourcePath: string;
  outputPath: string;
}

interface AutoStackFileTypes {
  nonRaw: string[];
  raw: string[];
}

const NON_RAW_QUALITY: Record<string, number> = {
  exr: 950,
  tif: 900,
  tiff: 900,
  hdr: 850,
  png: 800,
  jxl: 700,
  avif: 600,
  webp: 500,
  jpg: 400,
  jpeg: 400,
  qoi: 350,
  bmp: 300,
  tga: 300,
  gif: 200,
};

const getPathExtension = (path: string) => {
  const physicalPath = path.split('?')[0];
  const extensionIndex = physicalPath.lastIndexOf('.');
  return extensionIndex === -1 ? '' : physicalPath.slice(extensionIndex + 1).toLowerCase();
};

const normalizeExtensions = (extensions: string[]) =>
  new Set(extensions.map((extension) => extension.replace(/^\./, '').toLowerCase()));

const createStackId = () => `stack-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const removePathsFromStacks = (stacks: ImageStack[], paths: Set<string>): ImageStack[] =>
  stacks
    .map((stack) => ({ ...stack, paths: stack.paths.filter((path) => !paths.has(path)) }))
    .filter((stack) => stack.paths.length >= 2)
    .map((stack) => ({
      ...stack,
      coverPath: stack.paths.includes(stack.coverPath) ? stack.coverPath : stack.paths[0],
    }));

const selectAutoStackTopPath = (paths: string[], fileTypes: AutoStackFileTypes) => {
  const rawExtensions = normalizeExtensions(fileTypes.raw);
  return paths.reduce((bestPath, candidatePath) => {
    const bestExtension = getPathExtension(bestPath);
    const candidateExtension = getPathExtension(candidatePath);
    const bestQuality = rawExtensions.has(bestExtension) ? 1000 : (NON_RAW_QUALITY[bestExtension] ?? 0);
    const candidateQuality = rawExtensions.has(candidateExtension) ? 1000 : (NON_RAW_QUALITY[candidateExtension] ?? 0);
    return candidateQuality > bestQuality ? candidatePath : bestPath;
  });
};

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
  const remainingStacks = removePathsFromStacks(stacks, selectedPaths);
  const resolvedCoverPath = paths.includes(coverPath) ? coverPath : paths[0];

  return [
    ...remainingStacks,
    {
      id: createStackId(),
      paths: [resolvedCoverPath, ...paths.filter((path) => path !== resolvedCoverPath)],
      coverPath: resolvedCoverPath,
      collapsed: true,
    },
  ];
};

export const toggleImageStack = (stacks: ImageStack[], stackId: string): ImageStack[] =>
  stacks.map((stack) => (stack.id === stackId ? { ...stack, collapsed: !stack.collapsed } : stack));

export const moveImageToTopOfStack = (stacks: ImageStack[], stackId: string, imagePath: string): ImageStack[] =>
  stacks.map((stack) =>
    stack.id === stackId && stack.paths.includes(imagePath)
      ? {
          ...stack,
          paths: [imagePath, ...stack.paths.filter((path) => path !== imagePath)],
          coverPath: imagePath,
        }
      : stack,
  );

export const unstackImagePaths = (stacks: ImageStack[], paths: string[]): ImageStack[] => {
  const selectedPaths = new Set(paths);
  return stacks.filter((stack) => !stack.paths.some((path) => selectedPaths.has(path)));
};

export const autoStackImagePairs = (
  stacks: ImageStack[],
  pairs: AutoStackPair[],
  fileTypes: AutoStackFileTypes,
  expandNewStacks = true,
): ImageStack[] => {
  const supportedExtensions = normalizeExtensions([...fileTypes.raw, ...fileTypes.nonRaw]);

  return pairs.reduce((currentStacks, { sourcePath, outputPath }) => {
    if (
      !sourcePath ||
      !outputPath ||
      sourcePath === outputPath ||
      !supportedExtensions.has(getPathExtension(sourcePath)) ||
      !supportedExtensions.has(getPathExtension(outputPath))
    ) {
      return currentStacks;
    }

    const sourceStack = findImageStack(currentStacks, sourcePath);
    const stacksWithoutOutput = removePathsFromStacks(currentStacks, new Set([outputPath]));
    const retainedSourceStack = sourceStack
      ? stacksWithoutOutput.find((stack) => stack.id === sourceStack.id)
      : undefined;

    if (retainedSourceStack) {
      return stacksWithoutOutput.map((stack) =>
        stack.id === retainedSourceStack.id ? { ...stack, paths: [...stack.paths, outputPath] } : stack,
      );
    }

    const paths = [sourcePath, outputPath];
    const topPath = selectAutoStackTopPath(paths, fileTypes);
    const orderedPaths = topPath === sourcePath ? paths : [outputPath, sourcePath];
    return [
      ...removePathsFromStacks(stacksWithoutOutput, new Set([sourcePath])),
      {
        id: createStackId(),
        paths: orderedPaths,
        coverPath: topPath,
        collapsed: !expandNewStacks,
      },
    ];
  }, stacks);
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
      const coverPath = paths.includes(stack.coverPath) ? stack.coverPath : paths[0];
      return {
        ...stack,
        paths: coverPath ? [coverPath, ...paths.filter((path) => path !== coverPath)] : paths,
        coverPath,
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
