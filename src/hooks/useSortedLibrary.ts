import { useMemo } from 'react';
import { useLibraryStore } from '../store/useLibraryStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { RawStatus, EditedStatus, SortDirection, ImageFile, GroupingMode } from '../components/ui/AppProperties';
import { buildImageGroups, GroupBadgeInfo, GroupId } from '../utils/imageGrouping';
import { applyImageStacks } from '../utils/imageStacks';
import { getImageFlag, matchesImageFlagFilter } from '../utils/imageFlags';

export const ADVANCED_QUERY_REGEX =
  /^(iso|aperture|f|shutter|s|focal|mm|rating|color|flag|camera|make|model|lens)\s*(?::)?\s*(>=|<=|>|<|=)?\s*(.+)$/i;

export const parseShutter = (val: string | undefined): number => {
  if (!val) return 0;
  const cleanVal = val.replace(/s/i, '').trim();
  const parts = cleanVal.split('/');
  if (parts.length === 2) {
    const num = parseFloat(parts[0]);
    const den = parseFloat(parts[1]);
    return den !== 0 ? num / den : 0;
  }
  const numVal = parseFloat(cleanVal);
  return isNaN(numVal) ? 0 : numVal;
};

export const parseAperture = (val: string | undefined): number => {
  if (!val) return 0;
  const match = val.match(/(\d+(\.\d+)?)/);
  const numVal = match ? parseFloat(match[0]) : 0;
  return isNaN(numVal) ? 0 : numVal;
};

export const parseFocalLength = (val: string | undefined): number => {
  if (!val) return 0;
  const match = val.match(/(\d+(\.\d+)?)/);
  if (!match) return 0;
  const numVal = parseFloat(match[0]);
  return isNaN(numVal) ? 0 : numVal;
};

export interface GroupedLibrary {
  displayList: ImageFile[];
  badges: Map<GroupId, GroupBadgeInfo> | null;
}

interface DerivedImageFields {
  aperture: number;
  color: string;
  filename: string;
  flag: string;
  focalLength: number;
  iso: number;
  normalizedTags: string[];
  shutter: number;
}

export function computeGroupedLibrary(libraryState: any, settingsState: any): GroupedLibrary {
  const { imageList, imageRatings, filterCriteria, searchCriteria, sortCriteria } = libraryState;
  const { appSettings } = settingsState;

  const groupingMode: GroupingMode = appSettings?.grouping ?? 'off';
  const isGroupingActive = groupingMode !== 'off';
  const derived = new Map<string, DerivedImageFields>(
    imageList.map((image: ImageFile) => {
      const tags = image.tags || [];
      return [
        image.path,
        {
          aperture: parseAperture(image.exif?.FNumber),
          color: tags.find((tag: string) => tag.startsWith('color:'))?.substring(6) || '',
          filename: image.path.split(/[\\/]/).pop() || image.path,
          flag: getImageFlag(tags),
          focalLength: parseFocalLength(image.exif?.FocalLength),
          iso: parseInt(image.exif?.PhotographicSensitivity || image.exif?.ISOSpeedRatings || '0', 10) || 0,
          normalizedTags: tags.map((tag: string) => tag.toLowerCase().replace('user:', '')),
          shutter: parseShutter(image.exif?.ExposureTime),
        },
      ] as const;
    }),
  );

  const matchesFilter = (image: ImageFile): boolean => {
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
      const imageColor = derived.get(image.path)?.color;
      const hasMatchingColor = imageColor && filterCriteria.colors.includes(imageColor);
      const matchesNone = !imageColor && filterCriteria.colors.includes('none');

      if (!hasMatchingColor && !matchesNone) return false;
    }

    if (!matchesImageFlagFilter(image.tags, filterCriteria.flags)) {
      return false;
    }

    return true;
  };

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

      if (field === 'iso')
        imgVal = parseInt(image.exif?.PhotographicSensitivity || image.exif?.ISOSpeedRatings || '0', 10) || 0;
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
        imgStr = derived.get(image.path)?.color || '';
      } else if (field === 'flag') {
        imgStr = derived.get(image.path)?.flag || '';
      }

      return operator === '=' || operator === ':' ? imgStr.includes(value) : false;
    }
  };

  const isSearchActive = parsedTags.length > 0 || lowerCaseSearchText !== '';

  const matchesSearch = (image: ImageFile): boolean => {
    if (!isSearchActive) return true;

    const imageDerived = derived.get(image.path)!;
    const lowerCaseImageTags = imageDerived.normalizedTags;
    const filename = imageDerived.filename.toLowerCase();

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

  let processedList = imageList;
  let searchMatchingGroupIds: Set<string> | null = null;
  let groupBadges: Map<GroupId, GroupBadgeInfo> | null = null;

  if (isGroupingActive) {
    const groupEditedFiles = appSettings?.groupEditedFiles ?? true;
    const groupingResult = buildImageGroups(imageList, groupingMode, groupEditedFiles);
    processedList = groupingResult.displayList;
    groupBadges = groupingResult.badges;

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

  const filteredList = processedList.filter((image: ImageFile) => matchesFilter(image));

  const filteredBySearch = !isSearchActive
    ? filteredList
    : filteredList.filter((image: ImageFile) => {
        if (searchMatchingGroupIds && image.group_id && searchMatchingGroupIds.has(image.group_id)) return true;
        return matchesSearch(image);
      });

  const list = [...filteredBySearch];

  list.sort((a, b) => {
    const { key, order } = sortCriteria;
    const derivedA = derived.get(a.path)!;
    const derivedB = derived.get(b.path)!;
    let comparison = 0;

    switch (key) {
      case 'date_taken': {
        const dateA = a.exif?.DateTimeOriginal || '';
        const dateB = b.exif?.DateTimeOriginal || '';
        if (dateA !== dateB) comparison = dateA < dateB ? -1 : 1;
        else comparison = a.modified - b.modified;
        break;
      }
      case 'iso': {
        comparison = derivedA.iso - derivedB.iso;
        break;
      }
      case 'shutter_speed': {
        comparison = derivedA.shutter - derivedB.shutter;
        break;
      }
      case 'aperture': {
        comparison = derivedA.aperture - derivedB.aperture;
        break;
      }
      case 'focal_length': {
        comparison = derivedA.focalLength - derivedB.focalLength;
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
      default: {
        comparison = derivedA.filename.localeCompare(derivedB.filename);
        break;
      }
    }

    if (comparison === 0 && key !== 'name') {
      return derivedA.filename.localeCompare(derivedB.filename);
    }

    return order === SortDirection.Ascending ? comparison : -comparison;
  });

  return applyImageStacks(list, imageList, appSettings?.imageStacks, groupBadges);
}

export function computeSortedLibrary(libraryState: any, settingsState: any): ImageFile[] {
  return computeGroupedLibrary(libraryState, settingsState).displayList;
}

export function useSortedLibrary() {
  const imageList = useLibraryStore((state) => state.imageList);
  const imageRatings = useLibraryStore((state) => state.imageRatings);
  const filterCriteria = useLibraryStore((state) => state.filterCriteria);
  const searchCriteria = useLibraryStore((state) => state.searchCriteria);
  const sortCriteria = useLibraryStore((state) => state.sortCriteria);

  const appSettings = useSettingsStore((state) => state.appSettings);

  const result = useMemo(() => {
    return computeGroupedLibrary(
      { imageList, imageRatings, filterCriteria, searchCriteria, sortCriteria },
      { appSettings },
    );
  }, [imageList, sortCriteria, imageRatings, filterCriteria, searchCriteria, appSettings]);

  return result;
}
