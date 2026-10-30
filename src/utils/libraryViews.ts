// `currentFolderPath` labels for library views that list images from anywhere in the library.
export const ALBUM_VIEW_PREFIX = 'Album: ';
export const KEYWORD_VIEW_PREFIX = 'Keyword: ';

/** True for album and keyword views, which have no folder to import or paste into. */
export const isCollectionView = (folderPath: string | null | undefined) =>
  !!folderPath && (folderPath.startsWith(ALBUM_VIEW_PREFIX) || folderPath.startsWith(KEYWORD_VIEW_PREFIX));
