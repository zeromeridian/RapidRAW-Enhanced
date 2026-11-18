import { EditedStatus, FilterCriteria, ImageFile, ImageFileType } from '../components/ui/AppProperties';
import { matchesImageFlagFilter } from './imageFlags';
import { getFileExtension } from './imageGrouping';

const JPEG_EXTENSIONS = new Set(['jpg', 'jpeg']);
const HEIF_EXTENSIONS = new Set(['heic', 'heif']);

/** The file type the Quick Filter and Select By sort an image under. */
export function getImageFileType(image: ImageFile): ImageFileType {
  if (image.is_raw) return ImageFileType.Raw;
  const extension = getFileExtension(image.path);
  if (JPEG_EXTENSIONS.has(extension)) return ImageFileType.Jpeg;
  if (HEIF_EXTENSIONS.has(extension)) return ImageFileType.Heif;
  return ImageFileType.Other;
}

export function matchesLibraryFilter(
  image: ImageFile,
  imageRatings: Record<string, number>,
  filterCriteria: FilterCriteria,
): boolean {
  if (filterCriteria.rating !== 0) {
    const rating = imageRatings[image.path] || 0;
    if (filterCriteria.rating === -1 && rating !== 0) return false;
    if (filterCriteria.rating > 0) {
      const comparison = filterCriteria.ratingComparison ?? 'atLeast';
      if (comparison === 'atMost' && (rating === 0 || rating > filterCriteria.rating)) return false;
      if (comparison === 'exactly' && rating !== filterCriteria.rating) return false;
      if (comparison === 'atLeast' && rating < filterCriteria.rating) return false;
    }
  }

  if (filterCriteria.fileTypes?.length && !filterCriteria.fileTypes.includes(getImageFileType(image))) return false;

  if (filterCriteria.editedStatus && filterCriteria.editedStatus !== EditedStatus.All) {
    if (filterCriteria.editedStatus === EditedStatus.EditedOnly && !image.is_edited) return false;
    if (filterCriteria.editedStatus === EditedStatus.UneditedOnly && image.is_edited) return false;
  }

  if (filterCriteria.colors && filterCriteria.colors.length > 0) {
    const imageColor = (image.tags || []).find((tag) => tag.startsWith('color:'))?.substring(6);
    const hasMatchingColor = imageColor ? filterCriteria.colors.includes(imageColor) : false;
    const matchesNone = !imageColor && filterCriteria.colors.includes('none');
    if (!hasMatchingColor && !matchesNone) return false;
  }

  return matchesImageFlagFilter(image.tags, filterCriteria.flags);
}
