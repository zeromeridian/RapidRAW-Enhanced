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

// The per-image stack fields that `sync_image_stacks_to_xmp` writes, keyed by physical path.
const getXmpStackStates = (stacks: ImageStack[]) => {
  const states = new Map<string, string>();
  for (const stack of stacks) {
    const physicalPaths = stack.paths.filter((path) => !path.includes('?vc='));
    if (physicalPaths.length < 2) continue;
    physicalPaths.forEach((path, order) => {
      if (!states.has(path)) {
        states.set(path, JSON.stringify([stack.id, order, path === stack.coverPath, stack.collapsed]));
      }
    });
  }
  return states;
};

export const getChangedXmpStackPaths = (previousStacks: ImageStack[], nextStacks: ImageStack[]): string[] => {
  const previousStates = getXmpStackStates(previousStacks);
  const nextStates = getXmpStackStates(nextStacks);
  return Array.from(new Set([...previousStates.keys(), ...nextStates.keys()])).filter(
    (path) => previousStates.get(path) !== nextStates.get(path),
  );
};

export function mergeXmpImageStacks(stacks: ImageStack[], images: ImageFile[]): ImageStack[] {
  const membersByStack = new Map<string, ImageFile[]>();
  for (const image of images) {
    if (!image.xmpStack?.id) continue;
    const members = membersByStack.get(image.xmpStack.id) || [];
    members.push(image);
    membersByStack.set(image.xmpStack.id, members);
  }

  const importedStacks: ImageStack[] = [];
  for (const [id, members] of membersByStack) {
    if (members.length < 2) continue;
    members.sort((left, right) => (left.xmpStack?.order ?? 0) - (right.xmpStack?.order ?? 0));
    const cover = members.find((member) => member.xmpStack?.isCover) || members[0];
    importedStacks.push({
      id,
      paths: [cover.path, ...members.filter((member) => member.path !== cover.path).map((member) => member.path)],
      coverPath: cover.path,
      collapsed: cover.xmpStack?.collapsed ?? members[0].xmpStack?.collapsed ?? true,
    });
  }

  if (importedStacks.length === 0) return stacks;
  const importedPaths = new Set(importedStacks.flatMap((stack) => stack.paths));
  const retainedStacks = removePathsFromStacks(
    stacks.filter((stack) => !importedStacks.some((imported) => imported.id === stack.id)),
    importedPaths,
  );
  return [...retainedStacks, ...importedStacks];
}

/**
 * Stacks `paths` together, as Lightroom Classic's Group into Stack: every stack they touch is merged
 * in, so selecting a stack and other photos adds them to it. The stack holding `coverPath` keeps its
 * id, cover, and collapsed state; otherwise `coverPath` tops a new collapsed stack.
 */
export const createImageStack = (stacks: ImageStack[], paths: string[], coverPath: string): ImageStack[] => {
  const touchedStacks = stacks.filter((stack) => stack.paths.some((path) => paths.includes(path)));
  const coverStack = touchedStacks.find((stack) => stack.paths.includes(coverPath)) ?? touchedStacks[0];
  const orderedStacks = coverStack ? [coverStack, ...touchedStacks.filter((stack) => stack !== coverStack)] : [];
  const memberPaths = Array.from(new Set([...orderedStacks.flatMap((stack) => stack.paths), ...paths]));
  if (memberPaths.length < 2 || (touchedStacks.length === 1 && memberPaths.length === coverStack?.paths.length)) {
    return stacks;
  }

  const resolvedCoverPath = coverStack?.coverPath ?? (paths.includes(coverPath) ? coverPath : paths[0]);
  return [
    ...stacks.filter((stack) => !touchedStacks.includes(stack)),
    {
      id: coverStack?.id ?? createStackId(),
      paths: [resolvedCoverPath, ...memberPaths.filter((path) => path !== resolvedCoverPath)],
      coverPath: resolvedCoverPath,
      collapsed: coverStack?.collapsed ?? true,
    },
  ];
};

/**
 * Capture time in seconds, from EXIF `DateTimeOriginal`. The backend normalizes it to
 * `YYYY-MM-DD HH:MM:SS`; unparsed values keep the raw EXIF `YYYY:MM:DD HH:MM:SS`.
 */
const getCaptureTime = (image: ImageFile): number | null => {
  const match = image.exif?.DateTimeOriginal?.match(/^(\d{4})[-:](\d{2})[-:](\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!match) return null;
  const [year, month, day, hours, minutes, seconds] = match.slice(1).map(Number);
  return Date.UTC(year, month - 1, day, hours, minutes, seconds) / 1000;
};

export interface CaptureTimeStackPlan {
  groups: string[][];
  // Unstacked candidates whose capture time is unknown (EXIF missing or not loaded yet).
  undatedCount: number;
}

/**
 * Lightroom-style Auto-Stack by Capture Time: unstacked `images` taken at most `maxGapSeconds`
 * after the previous one form a group. Photos already in a stack are left alone.
 */
export function planCaptureTimeStacks(
  images: ImageFile[],
  stacks: ImageStack[],
  maxGapSeconds: number,
): CaptureTimeStackPlan {
  const stackedPaths = new Set(stacks.flatMap((stack) => stack.paths));
  const candidates = images.filter((image) => !stackedPaths.has(image.path));
  const dated = candidates
    .map((image) => ({ path: image.path, time: getCaptureTime(image) }))
    .filter((entry): entry is { path: string; time: number } => entry.time !== null)
    .sort((left, right) => left.time - right.time);

  const groups: string[][] = [];
  let current: string[] = [];
  dated.forEach((entry, index) => {
    if (index > 0 && entry.time - dated[index - 1].time > maxGapSeconds) {
      if (current.length >= 2) groups.push(current);
      current = [];
    }
    current.push(entry.path);
  });
  if (current.length >= 2) groups.push(current);

  return { groups, undatedCount: candidates.length - dated.length };
}

export const addCaptureTimeStacks = (stacks: ImageStack[], groups: string[][]): ImageStack[] => [
  ...stacks,
  ...groups.map((paths) => ({ id: createStackId(), paths, coverPath: paths[0], collapsed: true })),
];

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
