export interface RootFolderTree {
  path: string;
}

export interface ProvisionalFolderTree extends RootFolderTree {
  name: string;
  children: ProvisionalFolderTree[];
  isDir: boolean;
  imageCount: number;
  containsImages: boolean;
  hasSubdirs: boolean;
  modified: number;
  created: number;
}

export const createProvisionalFolderTrees = (paths: string[]): ProvisionalFolderTree[] =>
  paths.map((path) => {
    const normalized = path.replace(/\\/g, '/').replace(/\/$/, '');
    return {
      name: normalized.split('/').pop() || path,
      path,
      children: [],
      isDir: true,
      imageCount: 0,
      containsImages: true,
      hasSubdirs: true,
      modified: 0,
      created: 0,
    };
  });

export const mergeRefreshedFolderTrees = <T extends RootFolderTree>(
  requestedPaths: string[],
  existingTrees: T[],
  refreshedTrees: T[],
): T[] => {
  const existingByPath = new Map(existingTrees.map((tree) => [tree.path, tree]));
  const refreshedByPath = new Map(refreshedTrees.map((tree) => [tree.path, tree]));

  return requestedPaths.flatMap((path) => {
    const tree = refreshedByPath.get(path) ?? existingByPath.get(path);
    return tree ? [tree] : [];
  });
};
