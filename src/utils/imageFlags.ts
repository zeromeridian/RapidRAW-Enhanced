export const IMAGE_FLAG_PREFIX = 'flag:';

export const ImageFlag = {
  Rejected: 'rejected',
  Selected: 'selected',
  Deferred: 'deferred',
  Unflagged: 'unflagged',
} as const;

export type ImageFlag = (typeof ImageFlag)[keyof typeof ImageFlag];

export const IMAGE_FLAG_FILTER_OPTIONS: ImageFlag[] = [
  ImageFlag.Rejected,
  ImageFlag.Selected,
  ImageFlag.Deferred,
  ImageFlag.Unflagged,
];

export const getImageFlag = (tags: string[] | null | undefined): ImageFlag => {
  const value = tags?.find((tag) => tag.startsWith(IMAGE_FLAG_PREFIX))?.slice(IMAGE_FLAG_PREFIX.length);
  return value === ImageFlag.Rejected || value === ImageFlag.Selected || value === ImageFlag.Deferred
    ? value
    : ImageFlag.Unflagged;
};

export const matchesImageFlagFilter = (tags: string[] | null | undefined, selectedFlags: ImageFlag[] | undefined) =>
  !selectedFlags?.length || selectedFlags.includes(getImageFlag(tags));

export const isImageFlagTag = (tag: string) => tag.startsWith(IMAGE_FLAG_PREFIX);

export const getRejectedPathsForLoadedFolder = (
  images: Array<{ path: string; tags: string[] | null }>,
  folderPath: string | null,
) => {
  if (!folderPath || folderPath.startsWith('Album: ')) return [];
  return images.filter((image) => getImageFlag(image.tags) === ImageFlag.Rejected).map((image) => image.path);
};
