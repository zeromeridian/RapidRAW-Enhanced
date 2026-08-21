import { EditedStatus, FilterCriteria, ImageFile, RawStatus } from '../components/ui/AppProperties';
import { matchesImageFlagFilter } from './imageFlags';

export function matchesLibraryFilter(
  image: ImageFile,
  imageRatings: Record<string, number>,
  filterCriteria: FilterCriteria,
): boolean {
  if (filterCriteria.rating !== 0) {
    const rating = imageRatings[image.path] || 0;
    if (filterCriteria.rating === -1 && rating !== 0) return false;
    if (filterCriteria.rating === 5 && rating !== 5) return false;
    if (filterCriteria.rating > 0 && filterCriteria.rating < 5 && rating < filterCriteria.rating) return false;
  }

  if (filterCriteria.rawStatus && filterCriteria.rawStatus !== RawStatus.All) {
    if (filterCriteria.rawStatus === RawStatus.RawOnly && !image.is_raw) return false;
    if (filterCriteria.rawStatus === RawStatus.NonRawOnly && image.is_raw) return false;
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

  return matchesImageFlagFilter(image.tags, filterCriteria.flags);
}
