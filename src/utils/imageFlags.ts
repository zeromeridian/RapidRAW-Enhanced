export const IMAGE_FLAG_PREFIX = 'flag:';

export const ImageFlag = {
  Rejected: 'rejected',
  Selected: 'selected',
  Deferred: 'deferred',
  Unflagged: 'unflagged',
} as const;

export type ImageFlag = (typeof ImageFlag)[keyof typeof ImageFlag];

export const getImageFlag = (tags: string[] | null | undefined): ImageFlag => {
  const value = tags?.find((tag) => tag.startsWith(IMAGE_FLAG_PREFIX))?.slice(IMAGE_FLAG_PREFIX.length);
  return value === ImageFlag.Rejected || value === ImageFlag.Selected || value === ImageFlag.Deferred
    ? value
    : ImageFlag.Unflagged;
};

export const isImageFlagTag = (tag: string) => tag.startsWith(IMAGE_FLAG_PREFIX);

export const getRejectedPathsInFolder = (
  images: Array<{ path: string; tags: string[] | null }>,
  folderPath: string | null,
) => {
  if (!folderPath || folderPath.startsWith('Album: ')) return [];
  const normalizedFolder = folderPath.replace(/[\\/]+$/, '');
  return images
    .filter((image) => {
      if (getImageFlag(image.tags) !== ImageFlag.Rejected) return false;
      const physicalPath = image.path.split('?vc=')[0];
      const separatorIndex = Math.max(physicalPath.lastIndexOf('/'), physicalPath.lastIndexOf('\\'));
      return separatorIndex >= 0 && physicalPath.slice(0, separatorIndex) === normalizedFolder;
    })
    .map((image) => image.path);
};
