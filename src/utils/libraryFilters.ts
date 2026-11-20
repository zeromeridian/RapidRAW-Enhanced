import { EditedStatus, FilterCriteria, ImageFile } from '../components/ui/AppProperties';
import { matchesImageFlagFilter } from './imageFlags';
import { getImageFileType } from './imageFileTypes';
import { matchesMetadataPicks } from './metadataFilter';

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

  if (filterCriteria.fileTypes?.length) {
    const fileType = getImageFileType(image);
    if (!fileType || !filterCriteria.fileTypes.includes(fileType)) return false;
  }

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

  if (!matchesMetadataPicks(image, filterCriteria.metadata, imageRatings)) return false;

  return matchesImageFlagFilter(image.tags, filterCriteria.flags);
}
