import { useMemo } from 'react';
import { SearchCriteria, useLibraryStore } from '../store/useLibraryStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useUIStore } from '../store/useUIStore';
import { SortDirection, ImageFile, GroupingMode } from '../components/ui/AppProperties';
import { buildImageGroups, GroupBadgeInfo, GroupId } from '../utils/imageGrouping';
import { applyImageStacks, getCaptureTime } from '../utils/imageStacks';
import { getImageFlag } from '../utils/imageFlags';
import { getActiveFilterCriteria, matchesLibraryFilter } from '../utils/libraryFilters';
import { hasKeywordOrChild } from '../utils/keywords';
import { getIso, parseAperture, parseFocalLength, parseShutter } from '../utils/exifValues';

export const ADVANCED_QUERY_REGEX =
  /^(iso|aperture|f|shutter|s|focal|mm|rating|color|flag|camera|make|model|lens|keyword)(?=\s*[:<>=])\s*(?::)?\s*(>=|<=|>|<|=)?\s*(.+)$/i;

const fileNameCollator = new Intl.Collator(undefined, { numeric: true });

/**
 * Orders file names with digit runs read as numbers (`IMG_2` before `IMG_10`); names the numeric
 * collation treats as equal (`frame_1`, `frame_01`) fall back to `localeCompare` for a stable order.
 */
const compareFileNames = (a: ImageFile, b: ImageFile): number => {
  const nameA = a.path.split(/[\\/]/).pop() || a.path;
  const nameB = b.path.split(/[\\/]/).pop() || b.path;
  return fileNameCollator.compare(nameA, nameB) || nameA.localeCompare(nameB);
};

export interface GroupedLibrary {
  displayList: ImageFile[];
  badges: Map<GroupId, GroupBadgeInfo> | null;
}

export interface SearchMatcher {
  isActive: boolean;
  /** Whether a photo matches the search text and query tags; always true while no search is active. */
  matches(image: ImageFile): boolean;
}

/** The Library search (text and query tags such as `iso>800`) as a test of one photo. */
export function createSearchMatcher(
  searchCriteria: SearchCriteria,
  imageRatings: Record<string, number>,
): SearchMatcher {
  const { tags: searchTags, text: searchText, mode: searchMode } = searchCriteria;
  const lowerCaseSearchText = searchText.trim().toLowerCase();

  const parsedTags = searchTags.map((tag: string) => {
    const match = tag.match(ADVANCED_QUERY_REGEX);
    if (match) {
      const operator = match[2] || '=';
      return { type: 'query', field: match[1].toLowerCase(), operator, value: match[3].toLowerCase(), raw: tag };
    }
    return { type: 'normal', value: tag.toLowerCase(), raw: tag };
  });

  const evaluateQuery = (q: any, image: ImageFile) => {
    const { field, operator, value } = q;

    if (['iso', 'aperture', 'f', 'shutter', 's', 'focal', 'mm', 'rating'].includes(field)) {
      let imgVal = 0;
      let qVal = parseFloat(value);

      if (field === 'iso') imgVal = getIso(image.exif);
      else if (field === 'aperture' || field === 'f') imgVal = parseAperture(image.exif?.FNumber);
      else if (field === 'focal' || field === 'mm') imgVal = parseFocalLength(image.exif?.FocalLength);
      else if (field === 'rating') imgVal = imageRatings[image.path] || 0;
      else if (field === 'shutter' || field === 's') {
        imgVal = parseShutter(image.exif?.ExposureTime);
        qVal = parseShutter(value);
      }

      switch (operator) {
        case '>':
          return imgVal > qVal;
        case '<':
          return imgVal < qVal;
        case '>=':
          return imgVal >= qVal;
        case '<=':
          return imgVal <= qVal;
        case '=':
        case ':':
          return imgVal === qVal;
        default:
          return false;
      }
    } else {
      let imgStr = '';
      if (field === 'camera' || field === 'make' || field === 'model') {
        imgStr = `${image.exif?.Make || ''} ${image.exif?.Model || ''}`.toLowerCase();
      } else if (field === 'lens') {
        imgStr = String(
          `${image.exif?.LensModel || ''} ${image.exif?.Lens || ''} ${image.exif?.LensMake || ''}`,
        ).toLowerCase();
      } else if (field === 'color') {
        imgStr = (image.tags || []).find((t: string) => t.startsWith('color:'))?.substring(6) || '';
      } else if (field === 'flag') {
        imgStr = getImageFlag(image.tags);
      } else if (field === 'keyword') {
        return (operator === '=' || operator === ':') && hasKeywordOrChild(image.tags, value);
      }

      return operator === '=' || operator === ':' ? imgStr.includes(value) : false;
    }
  };

  const isSearchActive = parsedTags.length > 0 || lowerCaseSearchText !== '';

  const matchesSearch = (image: ImageFile): boolean => {
    if (!isSearchActive) return true;

    const lowerCaseImageTags = (image.tags || []).map((t) => t.toLowerCase().replace('user:', ''));
    const filename = image?.path?.split(/[\\/]/)?.pop()?.toLowerCase() || '';

    let tagsMatch = true;
    if (parsedTags.length > 0) {
      const evaluateTag = (parsedTag: any) => {
        if (parsedTag.type === 'normal') {
          return lowerCaseImageTags.some((imgTag) => imgTag.includes(parsedTag.value));
        }
        return evaluateQuery(parsedTag, image);
      };

      if (searchMode === 'OR') {
        tagsMatch = parsedTags.some((pt: any) => evaluateTag(pt));
      } else {
        tagsMatch = parsedTags.every((pt: any) => evaluateTag(pt));
      }
    }

    let textMatch = true;
    if (lowerCaseSearchText !== '') {
      textMatch =
        filename.includes(lowerCaseSearchText) || lowerCaseImageTags.some((t) => t.includes(lowerCaseSearchText));
    }

    return tagsMatch && textMatch;
  };

  return { isActive: isSearchActive, matches: matchesSearch };
}

export function computeGroupedLibrary(
  libraryState: any,
  settingsState: any,
  isMetadataFilterBarOpen = isMetadataFilterBarShown(),
): GroupedLibrary {
  const { imageList, imageRatings, searchCriteria, sortCriteria } = libraryState;
  const filterCriteria = getActiveFilterCriteria(libraryState.filterCriteria, isMetadataFilterBarOpen);
  const { appSettings } = settingsState;

  const groupingMode: GroupingMode = appSettings?.grouping ?? 'off';
  const isGroupingActive = groupingMode !== 'off';

  const { isActive: isSearchActive, matches: matchesSearch } = createSearchMatcher(searchCriteria, imageRatings);

  let processedList = imageList.filter((image: ImageFile) => matchesLibraryFilter(image, imageRatings, filterCriteria));
  let searchMatchingGroupIds: Set<string> | null = null;

  if (isGroupingActive) {
    const groupEditedFiles = appSettings?.groupEditedFiles ?? true;
    const groupingResult = buildImageGroups(processedList, groupingMode, groupEditedFiles);
    processedList = groupingResult.displayList;

    if (isSearchActive) {
      searchMatchingGroupIds = new Set<string>();
      for (const image of imageList) {
        if (!image.group_id) continue;
        if (matchesSearch(image)) {
          searchMatchingGroupIds.add(image.group_id);
        }
      }
    }
  }

  const filteredBySearch = !isSearchActive
    ? processedList
    : processedList.filter((image: ImageFile) => {
        if (searchMatchingGroupIds && image.group_id && searchMatchingGroupIds.has(image.group_id)) return true;
        return matchesSearch(image);
      });

  const list = [...filteredBySearch];

  list.sort((a, b) => {
    const { key, order } = sortCriteria;
    let comparison = 0;

    switch (key) {
      case 'date_taken': {
        // Compare parsed times: RAW dates are normalized to `YYYY-MM-DD`, other formats keep
        // EXIF's `YYYY:MM:DD`, so comparing the strings would split RAW+JPEG pairs.
        const timeA = getCaptureTime(a) ?? -Infinity;
        const timeB = getCaptureTime(b) ?? -Infinity;
        if (timeA !== timeB) comparison = timeA < timeB ? -1 : 1;
        else comparison = a.modified - b.modified;
        break;
      }
      case 'iso': {
        comparison = getIso(a.exif) - getIso(b.exif);
        break;
      }
      case 'shutter_speed': {
        comparison = parseShutter(a.exif?.ExposureTime) - parseShutter(b.exif?.ExposureTime);
        break;
      }
      case 'aperture': {
        comparison = parseAperture(a.exif?.FNumber) - parseAperture(b.exif?.FNumber);
        break;
      }
      case 'focal_length': {
        comparison = parseFocalLength(a.exif?.FocalLength) - parseFocalLength(b.exif?.FocalLength);
        break;
      }
      case 'date':
        comparison = a.modified - b.modified;
        break;
      case 'rating':
        comparison = (imageRatings[a.path] || 0) - (imageRatings[b.path] || 0);
        break;
      case 'edited':
        comparison = a.is_edited === b.is_edited ? 0 : a.is_edited ? 1 : -1;
        break;
      default:
        comparison = compareFileNames(a, b);
        break;
    }

    if (comparison === 0 && key !== 'name') {
      return compareFileNames(a, b);
    }

    return order === SortDirection.Ascending ? comparison : -comparison;
  });

  const badges = isGroupingActive
    ? buildImageGroups(imageList, groupingMode, appSettings?.groupEditedFiles ?? true).badges
    : null;

  return applyImageStacks(list, imageList, appSettings?.imageStacks, badges);
}

export function computeSortedLibrary(libraryState: any, settingsState: any): ImageFile[] {
  return computeGroupedLibrary(libraryState, settingsState).displayList;
}

function isMetadataFilterBarShown() {
  return Boolean(useUIStore.getState().uiVisibility.metadataFilterBar);
}

export function useSortedLibrary() {
  const imageList = useLibraryStore((state) => state.imageList);
  const imageRatings = useLibraryStore((state) => state.imageRatings);
  const filterCriteria = useLibraryStore((state) => state.filterCriteria);
  const searchCriteria = useLibraryStore((state) => state.searchCriteria);
  const sortCriteria = useLibraryStore((state) => state.sortCriteria);
  const isMetadataFilterBarOpen = useUIStore((state) => Boolean(state.uiVisibility.metadataFilterBar));

  const appSettings = useSettingsStore((state) => state.appSettings);

  const result = useMemo(() => {
    return computeGroupedLibrary(
      { imageList, imageRatings, filterCriteria, searchCriteria, sortCriteria },
      { appSettings },
      isMetadataFilterBarOpen,
    );
  }, [imageList, sortCriteria, imageRatings, filterCriteria, searchCriteria, appSettings, isMetadataFilterBarOpen]);

  return result;
}
