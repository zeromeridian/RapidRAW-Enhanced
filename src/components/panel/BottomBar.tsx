import { useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  Aperture,
  Check,
  ChevronDown,
  ChevronUp,
  ClipboardPaste,
  Copy,
  CopyPlus,
  Film,
  FileInput,
  Filter,
  Grip,
  Images,
  LayoutTemplate,
  Layers,
  ListChecks,
  ListCollapse,
  Settings,
  SlidersHorizontal,
  SquaresUnite,
  Star,
  Trash2,
  Ungroup,
  Users,
  SwatchBook,
  X,
} from 'lucide-react';
import clsx from 'clsx';
import { motion, AnimatePresence } from 'framer-motion';
import { useShallow } from 'zustand/react/shallow';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';

import Filmstrip from './Filmstrip';
import {
  AlbumItem,
  EditedStatus,
  FilterCriteria,
  GLOBAL_KEYS,
  ImageFile,
  Invokes,
  RawStatus,
  SelectedImage,
  ThumbnailAspectRatio,
} from '../ui/AppProperties';
import Text from '../ui/Text';
import { useEditorStore } from '../../store/useEditorStore';
import { useLibraryStore } from '../../store/useLibraryStore';
import { useUIStore } from '../../store/useUIStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { COLOR_LABELS, normalizeLoadedAdjustments } from '../../utils/adjustments';
import { globalImageCache } from '../../utils/ImageLRUCache';
import {
  createImageStack,
  findImageStack,
  moveImageToTopOfStack,
  toggleImageStack,
  unstackImagePaths,
} from '../../utils/imageStacks';
import { autoStackCreatedImages } from '../../utils/autoStacking';
import { getEnabledCopySuffix } from '../../utils/outputNaming';
import { GroupBadgeInfo } from '../../utils/imageGrouping';
import {
  getImageFlag,
  getRejectedPathsForLoadedFolder,
  ImageFlag,
  IMAGE_FLAG_FILTER_OPTIONS,
} from '../../utils/imageFlags';
import { ImageFlagIcon } from '../ui/ImageFlagBadge';
import { matchesLibraryFilter } from '../../utils/libraryFilters';

interface BottomBarProps {
  filmstripHeight?: number;
  imageList?: Array<ImageFile>;
  imageRatings?: Record<string, number> | null;
  isCopied: boolean;
  isCopyDisabled: boolean;
  isExportDisabled?: boolean;
  isFilmstripVisible?: boolean;
  isLibraryView?: boolean;
  isLoading?: boolean;
  isPasted: boolean;
  isPasteDisabled: boolean;
  isRatingDisabled?: boolean;
  isResetDisabled?: boolean;
  isResizing?: boolean;
  multiSelectedPaths?: Array<string>;
  onClearSelection?(): void;
  onContextMenu?(event: any, path: string): void;
  onCopy(): void;
  onExportClick?(): void;
  onDeleteRejected?(paths: string[]): void;
  onFlag(flag: ImageFlag): void;
  onSetColorLabel(color: string | null, paths?: string[]): Promise<void>;
  onImageSelect?(path: string, event: any): void;
  onLibraryRefresh?(): Promise<void>;
  onOpenCopyPasteSettings?(): void;
  onRequestThumbnails?(paths: string[]): void;
  onPaste(): void;
  onRate(rate: number): void;
  onReset?(): void;
  onZoomChange?(zoomValue: number, fitToWindow?: boolean): void;
  rating: number;
  selectedImage?: SelectedImage;
  setIsFilmstripVisible?(isVisible: boolean): void;
  showFilmstrip?: boolean;
  showZoomControls?: boolean;
  thumbnailAspectRatio: ThumbnailAspectRatio;
  totalImages?: number;
  groupBadgeInfo?: Map<string, GroupBadgeInfo> | null;
}

interface StarRatingProps {
  disabled: boolean;
  onRate(rate: number): void;
  rating: number;
}

const PRODUCTIVITY_TOOLBAR_IDS = [
  'applyPreset',
  'autoAdjust',
  'denoise',
  'convertNegative',
  'stitchPanorama',
  'mergeHdr',
  'frameImage',
  'cullImage',
] as const;
const COPY_TOOLBAR_IDS = ['physicalCopy', 'virtualCopy'] as const;
const STACK_TOOLBAR_IDS = ['stackSelected', 'toggleStack', 'setStackCover', 'unstack'] as const;
const FLAG_TOOLBAR_IDS = ['flagRejected', 'flagSelected', 'flagDeferred', 'flagUnflagged', 'deleteRejected'] as const;
const COLOR_TOOLBAR_IDS = ['colorRed', 'colorYellow', 'colorGreen', 'colorBlue', 'colorPurple', 'colorNone'] as const;
const ALL_COLOR_OPTIONS = [...COLOR_LABELS, { name: 'none', color: '#9ca3af' }];

const isRatingInRange = (rating: number, threshold: number, comparison: 'atLeast' | 'atMost') =>
  threshold > 0 && (comparison === 'atMost' ? rating <= threshold : rating >= threshold);

type SelectByCriteria = Partial<FilterCriteria> & {
  rawKind?: 'dng' | 'otherRaw';
};

const isDngImage = (image: ImageFile) => image.is_raw && image.path.split('?')[0].toLocaleLowerCase().endsWith('.dng');

const matchesSelectByCriteria = (
  image: ImageFile,
  imageRatings: Record<string, number>,
  criteria: SelectByCriteria,
) => {
  const { rawKind, ...libraryCriteria } = criteria;
  const matchesSharedCriteria = matchesLibraryFilter(image, imageRatings, {
    colors: [],
    flags: [],
    rating: 0,
    ratingComparison: 'atLeast',
    rawStatus: RawStatus.All,
    editedStatus: EditedStatus.All,
    ...libraryCriteria,
  });
  if (!matchesSharedCriteria || !rawKind) return matchesSharedCriteria;
  const isDng = isDngImage(image);
  return rawKind === 'dng' ? isDng : image.is_raw && !isDng;
};

const StarRating = ({ rating, onRate, disabled }: StarRatingProps) => {
  const { t } = useTranslation();

  return (
    <div className={clsx('flex items-center gap-1', disabled && 'cursor-not-allowed')}>
      {[...Array(5)].map((_, index: number) => {
        const starValue = index + 1;
        return (
          <button
            className="disabled:cursor-not-allowed"
            disabled={disabled}
            key={starValue}
            onClick={() => !disabled && onRate(starValue === rating ? 0 : starValue)}
            data-tooltip={
              disabled
                ? t('ui.bottomBar.tooltips.selectToRate')
                : t('ui.bottomBar.tooltips.rateStars', { count: starValue })
            }
          >
            <Star
              size={18}
              className={clsx(
                'transition-colors duration-150',
                disabled
                  ? 'text-text-secondary opacity-40'
                  : starValue <= rating
                    ? 'fill-accent text-accent'
                    : 'text-text-secondary hover:text-accent',
              )}
            />
          </button>
        );
      })}
    </div>
  );
};

export default function BottomBar({
  filmstripHeight,
  imageList = [],
  imageRatings,
  isCopied,
  isCopyDisabled,
  isExportDisabled,
  isFilmstripVisible,
  isLibraryView = false,
  isLoading = false,
  isPasted,
  isPasteDisabled,
  isRatingDisabled = false,
  isResetDisabled = false,
  isResizing,
  multiSelectedPaths = [],
  onClearSelection,
  onContextMenu,
  onCopy,
  onExportClick,
  onDeleteRejected,
  onFlag,
  onSetColorLabel,
  onImageSelect,
  onLibraryRefresh,
  onOpenCopyPasteSettings,
  onRequestThumbnails,
  onPaste,
  onRate,
  onReset,
  onZoomChange = () => {},
  rating,
  selectedImage,
  setIsFilmstripVisible,
  showFilmstrip = true,
  showZoomControls = true,
  thumbnailAspectRatio,
  totalImages,
  groupBadgeInfo,
}: BottomBarProps) {
  const { t } = useTranslation();
  const { displaySize, originalSize } = useEditorStore(
    useShallow((state) => ({
      displaySize: state.displaySize,
      originalSize: state.originalSize,
    })),
  );

  const [isEditingPercent, setIsEditingPercent] = useState(false);
  const [percentInputValue, setPercentInputValue] = useState('');
  const isDraggingSlider = useRef(false);
  const [isZoomActive, setIsZoomActive] = useState(false);

  const percentInputRef = useRef<HTMLInputElement>(null);
  const [isZoomLabelHovered, setIsZoomLabelHovered] = useState(false);
  const isZoomReady = !isLoading && originalSize && originalSize.width > 0 && displaySize && displaySize.width > 0;

  const currentOriginalPercent = isZoomReady
    ? (displaySize.width * (typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1)) / originalSize.width
    : 1.0;

  const [latchedSliderValue, setLatchedSliderValue] = useState(1.0);
  const [latchedDisplayPercent, setLatchedDisplayPercent] = useState(100);

  const numSelected = multiSelectedPaths.length;
  const total = totalImages ?? 0;
  const showSelectionCounter = numSelected > 1;

  const [isFilterExpanded, setIsFilterExpanded] = useState(false);
  const [isSelectByOpen, setIsSelectByOpen] = useState(false);
  const [selectRatingComparison, setSelectRatingComparison] = useState<'atLeast' | 'atMost'>('atLeast');
  const [activeSelectBy, setActiveSelectBy] = useState<{
    criteria: SelectByCriteria;
    id: string;
  } | null>(null);
  const [isCustomizeOpen, setIsCustomizeOpen] = useState(false);
  const customizeRef = useRef<HTMLDivElement>(null);
  const {
    filterCriteria,
    libraryActivePath,
    allLibraryImages,
    currentFolderPath,
    selectedFolderPaths,
    setFilterCriteria,
    setLibrary,
  } = useLibraryStore(
    useShallow((state) => ({
      filterCriteria: state.filterCriteria,
      libraryActivePath: state.libraryActivePath,
      allLibraryImages: state.imageList,
      currentFolderPath: state.currentFolderPath,
      selectedFolderPaths: state.selectedFolderPaths,
      setFilterCriteria: state.setFilterCriteria,
      setLibrary: state.setLibrary,
    })),
  );
  const { selectionClearRequest, setUI } = useUIStore(
    useShallow((state) => ({
      selectionClearRequest: state.selectionClearRequest,
      setUI: state.setUI,
    })),
  );
  const setEditor = useEditorStore((state) => state.setEditor);
  const { appSettings, handleSettingsChange } = useSettingsStore(
    useShallow((state) => ({
      appSettings: state.appSettings,
      handleSettingsChange: state.handleSettingsChange,
    })),
  );

  const allColors = ALL_COLOR_OPTIONS;
  const hasActiveFilters =
    filterCriteria.rating !== 0 ||
    filterCriteria.rawStatus !== RawStatus.All ||
    filterCriteria.editedStatus !== EditedStatus.All ||
    (filterCriteria.colors || []).length > 0 ||
    (filterCriteria.flags || []).length > 0;
  const clearFilters = () =>
    setFilterCriteria((previous) => ({
      ...previous,
      rating: 0,
      ratingComparison: 'atLeast',
      rawStatus: RawStatus.All,
      editedStatus: EditedStatus.All,
      colors: [],
      flags: [],
    }));
  const toolbarVisibility = appSettings?.bottomToolbarVisibility || {};
  const isToolbarItemVisible = (id: string) => toolbarVisibility[id] !== false;
  const isToolbarGroupVisible = (ids: readonly string[]) => ids.some(isToolbarItemVisible);
  const toggleToolbarItem = (id: string) => {
    if (!appSettings) return;
    handleSettingsChange({
      ...appSettings,
      bottomToolbarVisibility: {
        ...toolbarVisibility,
        [id]: !isToolbarItemVisible(id),
      },
    });
  };
  const productivityPaths =
    selectedFolderPaths.length > 0
      ? []
      : multiSelectedPaths.length > 0
        ? multiSelectedPaths
        : selectedImage?.path
          ? [selectedImage.path]
          : libraryActivePath
            ? [libraryActivePath]
            : [];
  const productivityCount = productivityPaths.length;
  const firstProductivityImage =
    imageList.find((image) => image.path === productivityPaths[0]) ||
    allLibraryImages.find((image) => image.path === productivityPaths[0]);
  const selectedColors = productivityPaths.map((path) => {
    const image =
      imageList.find((candidate) => candidate.path === path) ||
      allLibraryImages.find((candidate) => candidate.path === path);
    return image?.tags?.find((tag) => tag.startsWith('color:'))?.slice(6) || null;
  });
  const activeColor: string | null | undefined =
    selectedColors.length > 0 && selectedColors.every((color) => color === selectedColors[0])
      ? selectedColors[0]
      : undefined;
  const activeFlag = getImageFlag(firstProductivityImage?.tags);
  const rejectedInCurrentFolder = getRejectedPathsForLoadedFolder(allLibraryImages, currentFolderPath);
  const imageStacks = appSettings?.imageStacks || [];
  const stackTargetPath =
    (libraryActivePath && productivityPaths.includes(libraryActivePath) ? libraryActivePath : null) ||
    (selectedImage?.path && productivityPaths.includes(selectedImage.path) ? selectedImage.path : null) ||
    productivityPaths[0];
  const targetStack = stackTargetPath ? findImageStack(imageStacks, stackTargetPath) : undefined;
  const hasSelectedStacks = imageStacks.some((stack) =>
    stack.paths.some((stackPath) => productivityPaths.includes(stackPath)),
  );
  const hasProductivityActions = isToolbarGroupVisible(PRODUCTIVITY_TOOLBAR_IDS);
  const hasCopyActions = isToolbarGroupVisible(COPY_TOOLBAR_IDS);
  const hasStackActions = isToolbarGroupVisible(STACK_TOOLBAR_IDS);
  const hasFlagActions = isToolbarGroupVisible(FLAG_TOOLBAR_IDS);
  const hasColorActions = isToolbarGroupVisible(COLOR_TOOLBAR_IDS);
  const toolbarItems = [
    { id: 'rating', label: t('contextMenus.editor.rating') },
    ...COLOR_LABELS.map((color) => ({
      id: `color${color.name.charAt(0).toUpperCase()}${color.name.slice(1)}`,
      label: String(t(`contextMenus.colors.${color.name}` as never)),
    })),
    { id: 'colorNone', label: t('editor.metadata.organization.none') },
    { id: 'flagRejected', label: t('flags.rejected') },
    { id: 'flagSelected', label: t('flags.selected') },
    { id: 'flagDeferred', label: t('flags.deferred') },
    { id: 'flagUnflagged', label: t('flags.unflagged') },
    { id: 'deleteRejected', label: t('flags.deleteRejected') },
    { id: 'copySettings', label: t('ui.bottomBar.tooltips.copySettings') },
    { id: 'pasteSettings', label: t('ui.bottomBar.tooltips.pasteSettings') },
    { id: 'copyPasteSettings', label: t('ui.bottomBar.tooltips.copyPasteSettings') },
    { id: 'applyPreset', label: t('presetBatch.applyPreset') },
    { id: 'autoAdjust', label: t('contextMenus.thumbnail.autoAdjust', { count: 1 }) },
    { id: 'denoise', label: t('contextMenus.thumbnail.denoise', { count: 1 }) },
    { id: 'convertNegative', label: t('contextMenus.thumbnail.convertNegative', { count: 1 }) },
    { id: 'stitchPanorama', label: t('contextMenus.editor.stitchPanorama') },
    { id: 'mergeHdr', label: t('contextMenus.editor.mergeHdr') },
    { id: 'frameImage', label: t('contextMenus.thumbnail.collage', { count: 1 }) },
    { id: 'cullImage', label: t('contextMenus.thumbnail.cullImage', { count: 2 }) },
    { id: 'physicalCopy', label: t('contextMenus.thumbnail.physicalCopy') },
    { id: 'virtualCopy', label: t('contextMenus.thumbnail.virtualCopy') },
    { id: 'stackSelected', label: t('ui.bottomBar.tooltips.stackSelected') },
    { id: 'toggleStack', label: t('ui.bottomBar.tooltips.toggleStack') },
    { id: 'setStackCover', label: t('contextMenus.thumbnail.moveToTopOfStack') },
    { id: 'unstack', label: t('contextMenus.thumbnail.unstack') },
    { id: 'quickFilter', label: t('ui.bottomBar.tooltips.quickFilter') },
    { id: 'selectBy', label: t('ui.bottomBar.selectBy.title', 'Select by') },
    { id: 'export', label: t('ui.bottomBar.tooltips.export') },
    { id: 'zoom', label: t('ui.bottomBar.zoomLabel') },
    { id: 'filmstrip', label: t('ui.bottomBar.tooltips.collapseFilmstrip') },
  ];
  const productivityButtonClass =
    'w-8 h-8 flex items-center justify-center rounded-md text-text-secondary hover:bg-surface hover:text-text-primary transition-colors disabled:opacity-40 disabled:hover:bg-transparent disabled:cursor-not-allowed';

  const selectByFileTypes = useMemo<
    Array<{ criteria: SelectByCriteria; id: string; label: string; shortLabel: string }>
  >(
    () => [
      {
        criteria: { rawKind: 'dng', rawStatus: RawStatus.RawOnly },
        id: 'dng',
        label: t('ui.bottomBar.selectBy.dngOnly'),
        shortLabel: 'DNG',
      },
      {
        criteria: { rawKind: 'otherRaw', rawStatus: RawStatus.RawOnly },
        id: 'other-raw',
        label: t('ui.bottomBar.selectBy.otherRawOnly'),
        shortLabel: 'RAW',
      },
      {
        criteria: { rawStatus: RawStatus.NonRawOnly },
        id: 'non-raw',
        label: t('library.filters.raw.nonRawOnly'),
        shortLabel: 'IMG',
      },
    ],
    [t],
  );

  const selectByGroups = useMemo(
    () => [
      {
        label: t('library.header.viewOptions.filterByRating'),
        options: [
          { id: 'rating-unrated', label: t('library.filters.rating.unrated'), criteria: { rating: -1 } },
          ...[1, 2, 3, 4, 5].map((rating) => ({
            id: `rating-${selectRatingComparison}-${rating}`,
            label: `${selectRatingComparison === 'atMost' ? '≤' : '≥'} ${rating}`,
            criteria: { rating, ratingComparison: selectRatingComparison },
          })),
        ],
      },
      {
        label: t('library.header.viewOptions.filterByFileType'),
        options: selectByFileTypes,
      },
      {
        label: t('library.header.viewOptions.filterByEdited', 'Edit status'),
        options: [
          {
            id: 'edited',
            label: t('library.filters.edited.editedOnly'),
            criteria: { editedStatus: EditedStatus.EditedOnly },
          },
          {
            id: 'unedited',
            label: t('library.filters.edited.uneditedOnly'),
            criteria: { editedStatus: EditedStatus.UneditedOnly },
          },
        ],
      },
      {
        label: t('library.header.viewOptions.filterByColorLabel'),
        options: allColors.map((color) => ({
          id: `color-${color.name}`,
          label:
            color.name === 'none'
              ? t('library.header.viewOptions.noLabel')
              : t(`contextMenus.colors.${color.name}`, {
                  defaultValue: color.name.charAt(0).toUpperCase() + color.name.slice(1),
                }),
          criteria: { colors: [color.name] },
          color: color.color,
        })),
      },
      {
        label: t('library.header.viewOptions.filterByFlag'),
        options: IMAGE_FLAG_FILTER_OPTIONS.map((flag) => ({
          id: `flag-${flag}`,
          label: t(`flags.${flag}`),
          criteria: { flags: [flag] },
          flag,
        })),
      },
    ],
    [selectByFileTypes, selectRatingComparison, t],
  );

  const selectByCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const group of selectByGroups) {
      for (const option of group.options) {
        counts.set(
          option.id,
          allLibraryImages.reduce(
            (count, image) =>
              count + (matchesSelectByCriteria(image, imageRatings || {}, option.criteria as SelectByCriteria) ? 1 : 0),
            0,
          ),
        );
      }
    }
    return counts;
  }, [allLibraryImages, imageRatings, selectByGroups]);
  const activeSelectByRatingMatch = activeSelectBy?.id.match(/^rating-(?:atLeast|atMost)-([1-5])$/);
  const activeSelectByRating = activeSelectByRatingMatch ? Number(activeSelectByRatingMatch[1]) : 0;

  const handleClearSelectBy = () => {
    setActiveSelectBy(null);
    if (isLibraryView) {
      setLibrary({
        multiSelectedPaths: [],
        selectedFolderPaths: [],
        libraryActivePath: null,
        selectionAnchorPath: null,
      });
    } else {
      onClearSelection?.();
    }
  };

  const handleSelectBy = (id: string, criteriaOverrides: SelectByCriteria) => {
    if (activeSelectBy?.id === id) {
      handleClearSelectBy();
      return;
    }
    const criteria: SelectByCriteria = {
      colors: [],
      flags: [],
      rating: 0,
      ratingComparison: 'atLeast',
      rawStatus: RawStatus.All,
      editedStatus: EditedStatus.All,
      ...criteriaOverrides,
    };
    const paths = allLibraryImages
      .filter((image) => matchesSelectByCriteria(image, imageRatings || {}, criteria))
      .map((image) => image.path);
    const activePath = libraryActivePath && paths.includes(libraryActivePath) ? libraryActivePath : paths[0] || null;
    setLibrary({
      multiSelectedPaths: paths,
      selectedFolderPaths: [],
      libraryActivePath: activePath,
      selectionAnchorPath: activePath,
    });
    setActiveSelectBy({ criteria: criteriaOverrides, id });
  };

  const handleDeleteRejected = () => {
    if (!onDeleteRejected || rejectedInCurrentFolder.length === 0) return;
    setUI({
      confirmModalState: {
        confirmText: t('flags.deleteRejectedConfirm'),
        confirmVariant: 'destructive',
        isOpen: true,
        message: t('flags.deleteRejectedMessage', { count: rejectedInCurrentFolder.length }),
        onConfirm: () => onDeleteRejected(rejectedInCurrentFolder),
        title: t('flags.deleteRejected'),
      },
    });
  };

  const handleAutoAdjust = () => {
    if (productivityCount === 0) return;
    productivityPaths.forEach((path) => globalImageCache.delete(path));

    invoke(Invokes.ApplyAutoAdjustmentsToPaths, { paths: productivityPaths })
      .then(async () => {
        if (selectedImage && productivityPaths.includes(selectedImage.path)) {
          const metadata: any = await invoke(Invokes.LoadMetadata, { path: selectedImage.path });
          if (metadata.adjustments && !metadata.adjustments.is_null) {
            const normalized = normalizeLoadedAdjustments(metadata.adjustments);
            setEditor({ adjustments: normalized });
            useEditorStore.getState().resetHistory(normalized);
          }
        }
        if (libraryActivePath && productivityPaths.includes(libraryActivePath)) {
          const metadata: any = await invoke(Invokes.LoadMetadata, { path: libraryActivePath });
          if (metadata.adjustments && !metadata.adjustments.is_null) {
            setLibrary({ libraryActiveAdjustments: normalizeLoadedAdjustments(metadata.adjustments) });
          }
        }
      })
      .catch((err) => {
        console.error('Failed to apply auto adjustments to paths:', err);
        toast.error(t('contextMenus.toasts.failedApplyAuto', { err }));
      });
  };

  const openDenoise = () =>
    setUI({
      denoiseModalState: {
        isOpen: true,
        isProcessing: false,
        previewBase64: null,
        error: null,
        targetPaths: productivityPaths,
        progressMessage: null,
        isRaw: firstProductivityImage?.is_raw || selectedImage?.isRaw || false,
      },
    });

  const openPanorama = () =>
    setUI({
      panoramaModalState: {
        error: null,
        finalImageBase64: null,
        isOpen: true,
        isProcessing: false,
        progressMessage: null,
        stitchingSourcePaths: productivityPaths,
      },
    });

  const openHdr = () =>
    setUI({
      hdrModalState: {
        error: null,
        finalImageBase64: null,
        isOpen: true,
        isProcessing: false,
        progressMessage: null,
        stitchingSourcePaths: productivityPaths,
      },
    });

  const refreshAfterDuplicate = async () => {
    const { activeAlbumId } = useLibraryStore.getState();
    if (activeAlbumId) {
      const albumTree = await invoke<AlbumItem[]>(Invokes.GetAlbums);
      setLibrary({ albumTree });
    }
    await onLibraryRefresh?.();
  };

  const handlePhysicalCopy = async () => {
    if (productivityCount !== 1) return;
    try {
      const outputPath = await invoke<string>(Invokes.DuplicateFile, {
        path: productivityPaths[0],
        targetAlbumId: useLibraryStore.getState().activeAlbumId || null,
        copyNameSuffix: getEnabledCopySuffix(appSettings),
      });
      autoStackCreatedImages([{ sourcePath: productivityPaths[0], outputPath }]);
      await refreshAfterDuplicate();
    } catch (err) {
      console.error('Failed to duplicate file:', err);
      toast.error(t('contextMenus.toasts.failedDuplicate', { err }));
    }
  };

  const handleVirtualCopy = async () => {
    if (productivityCount !== 1) return;
    try {
      const outputPath = await invoke<string>(Invokes.CreateVirtualCopy, {
        sourceVirtualPath: productivityPaths[0],
        targetAlbumId: useLibraryStore.getState().activeAlbumId || null,
        copyNameSuffix: getEnabledCopySuffix(appSettings),
      });
      autoStackCreatedImages([{ sourcePath: productivityPaths[0], outputPath }]);
      await refreshAfterDuplicate();
    } catch (err) {
      console.error('Failed to create virtual copy:', err);
      toast.error(t('contextMenus.toasts.failedCreateVirtualCopy', { err }));
    }
  };

  const saveImageStacks = (nextStacks: typeof imageStacks) => {
    if (!appSettings) return;
    void handleSettingsChange({ ...appSettings, imageStacks: nextStacks });
  };

  const handleStackSelected = () => {
    if (productivityCount < 2 || !stackTargetPath) return;
    saveImageStacks(createImageStack(imageStacks, productivityPaths, stackTargetPath));
  };

  const handleToggleStack = () => {
    if (!targetStack) return;
    saveImageStacks(toggleImageStack(imageStacks, targetStack.id));
  };

  const handleMoveToTopOfStack = () => {
    if (!targetStack || !stackTargetPath) return;
    saveImageStacks(moveImageToTopOfStack(imageStacks, targetStack.id, stackTargetPath));
  };

  const handleUnstack = () => {
    if (!hasSelectedStacks) return;
    saveImageStacks(unstackImagePaths(imageStacks, productivityPaths));
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (customizeRef.current && !customizeRef.current.contains(event.target as Node)) {
        setIsCustomizeOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (!activeSelectBy) return;
    const expectedPaths = new Set(
      allLibraryImages
        .filter((image) => matchesSelectByCriteria(image, imageRatings || {}, activeSelectBy.criteria))
        .map((image) => image.path),
    );
    if (
      expectedPaths.size !== multiSelectedPaths.length ||
      multiSelectedPaths.some((path) => !expectedPaths.has(path))
    ) {
      setActiveSelectBy(null);
    }
  }, [activeSelectBy, allLibraryImages, imageRatings, multiSelectedPaths]);

  useEffect(() => {
    setActiveSelectBy(null);
  }, [selectionClearRequest]);

  useEffect(() => {
    if (isZoomReady && !isDraggingSlider.current) {
      setLatchedSliderValue(currentOriginalPercent);
      setLatchedDisplayPercent(Math.round(currentOriginalPercent * 100));
    }
  }, [currentOriginalPercent, isZoomReady]);

  useEffect(() => {
    const handleDragEndGlobal = () => {
      if (isZoomActive) {
        setIsZoomActive(false);
        isDraggingSlider.current = false;
        if (isZoomReady) {
          setLatchedDisplayPercent(Math.round(currentOriginalPercent * 100));
        }
      }
    };

    if (isZoomActive) {
      window.addEventListener('mouseup', handleDragEndGlobal);
      window.addEventListener('touchend', handleDragEndGlobal);
    }

    return () => {
      window.removeEventListener('mouseup', handleDragEndGlobal);
      window.removeEventListener('touchend', handleDragEndGlobal);
    };
  }, [isZoomActive, isZoomReady, currentOriginalPercent]);

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newZoom = parseFloat(e.target.value);
    setLatchedSliderValue(newZoom);
    setLatchedDisplayPercent(Math.round(newZoom * 100));
    onZoomChange(newZoom);
  };

  const handleMouseDown = () => {
    isDraggingSlider.current = true;
    setIsZoomActive(true);
  };

  const handleMouseUp = () => {
    isDraggingSlider.current = false;
    setIsZoomActive(false);
    if (isZoomReady) {
      setLatchedDisplayPercent(Math.round(currentOriginalPercent * 100));
    }
  };

  const handleZoomKeyDown = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && ['z', 'y'].includes(e.key.toLowerCase())) {
      (e.target as HTMLElement).blur();
      return;
    }
    if (GLOBAL_KEYS.includes(e.key)) {
      (e.target as HTMLElement).blur();
    }
  };

  const handleResetZoom = () => {
    onZoomChange(0, true);
  };

  const handlePercentClick = () => {
    if (!isZoomReady) return;
    setIsEditingPercent(true);
    setPercentInputValue(latchedDisplayPercent.toString());
    setTimeout(() => {
      percentInputRef.current?.focus();
      percentInputRef.current?.select();
    }, 0);
  };

  const handlePercentSubmit = () => {
    const value = parseFloat(percentInputValue);
    if (!isNaN(value)) {
      const originalPercent = value / 100;
      const clampedPercent = Math.max(0.1, Math.min(2.0, originalPercent));
      onZoomChange(clampedPercent);
    }
    setIsEditingPercent(false);
    setPercentInputValue('');
  };

  const handlePercentKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handlePercentSubmit();
    else if (e.key === 'Escape') {
      setIsEditingPercent(false);
      setPercentInputValue('');
    }
    e.stopPropagation();
  };

  return (
    <div className="lights-out-chrome shrink-0 bg-bg-secondary rounded-lg flex flex-col">
      {!isLibraryView && showFilmstrip && (
        <div
          className={clsx('overflow-hidden', !isResizing && 'transition-all duration-300 ease-in-out')}
          style={{ height: isFilmstripVisible ? `${filmstripHeight}px` : '0px' }}
        >
          <div className="w-full p-2" style={{ height: `${filmstripHeight}px` }}>
            <Filmstrip
              imageList={imageList}
              imageRatings={imageRatings}
              isLoading={isLoading}
              multiSelectedPaths={multiSelectedPaths}
              onClearSelection={onClearSelection}
              onContextMenu={onContextMenu}
              onImageSelect={onImageSelect}
              onRequestThumbnails={onRequestThumbnails}
              selectedImage={selectedImage}
              thumbnailAspectRatio={thumbnailAspectRatio}
              groupBadgeInfo={groupBadgeInfo}
            />
          </div>
        </div>
      )}

      <div
        className={clsx(
          'shrink-0 h-10 flex items-center justify-between px-3',
          !isLibraryView && 'border-t',
          !isLibraryView && showFilmstrip && isFilmstripVisible ? 'border-surface' : 'border-transparent',
        )}
      >
        <div className="flex items-center gap-4">
          {isToolbarItemVisible('rating') && <StarRating rating={rating} onRate={onRate} disabled={isRatingDisabled} />}
          {isToolbarItemVisible('rating') && hasColorActions && <div className="h-5 w-px bg-surface" />}
          {isToolbarItemVisible('rating') && !hasColorActions && hasFlagActions && (
            <div className="h-5 w-px bg-surface" />
          )}
          {hasColorActions && (
            <>
              <div className="flex items-center gap-1.5">
                {COLOR_LABELS.map((color) => {
                  const itemId = `color${color.name.charAt(0).toUpperCase()}${color.name.slice(1)}`;
                  if (!isToolbarItemVisible(itemId)) return null;
                  return (
                    <button
                      key={color.name}
                      className={clsx(
                        'w-4 h-4 rounded-full transition-transform hover:scale-110 disabled:cursor-not-allowed disabled:opacity-40',
                        activeColor === color.name && 'ring-2 ring-white ring-offset-1 ring-offset-bg-primary',
                      )}
                      disabled={productivityCount === 0}
                      onClick={() => void onSetColorLabel(color.name, productivityPaths)}
                      style={{ backgroundColor: color.color }}
                      data-tooltip={String(t(`contextMenus.colors.${color.name}` as never))}
                    />
                  );
                })}
                {isToolbarItemVisible('colorNone') && (
                  <button
                    className={clsx(
                      'w-4 h-4 rounded-full border border-text-secondary/60 flex items-center justify-center text-text-secondary transition-transform hover:scale-110 disabled:cursor-not-allowed disabled:opacity-40',
                      activeColor === null && 'ring-2 ring-text-secondary ring-offset-1 ring-offset-bg-primary',
                    )}
                    disabled={productivityCount === 0}
                    onClick={() => void onSetColorLabel(null, productivityPaths)}
                    data-tooltip={t('editor.metadata.organization.none')}
                  >
                    <Check size={9} className={activeColor === null ? 'opacity-100' : 'opacity-0'} />
                  </button>
                )}
              </div>
              {hasFlagActions && <div className="h-5 w-px bg-surface" />}
            </>
          )}
          {hasFlagActions && (
            <>
              <div className="flex items-center gap-1">
                {isToolbarItemVisible('flagRejected') && (
                  <button
                    className={clsx(
                      productivityButtonClass,
                      activeFlag === ImageFlag.Rejected && 'bg-surface text-text-primary',
                    )}
                    disabled={productivityCount === 0}
                    onClick={() => onFlag(ImageFlag.Rejected)}
                    data-tooltip={t('flags.rejectedShortcut')}
                  >
                    <ImageFlagIcon flag={ImageFlag.Rejected} size={18} />
                  </button>
                )}
                {isToolbarItemVisible('flagSelected') && (
                  <button
                    className={clsx(
                      productivityButtonClass,
                      activeFlag === ImageFlag.Selected && 'bg-surface text-text-primary',
                    )}
                    disabled={productivityCount === 0}
                    onClick={() => onFlag(ImageFlag.Selected)}
                    data-tooltip={t('flags.selectedShortcut')}
                  >
                    <ImageFlagIcon flag={ImageFlag.Selected} size={18} />
                  </button>
                )}
                {isToolbarItemVisible('flagDeferred') && (
                  <button
                    className={clsx(
                      productivityButtonClass,
                      activeFlag === ImageFlag.Deferred && 'bg-surface text-text-primary',
                    )}
                    disabled={productivityCount === 0}
                    onClick={() => onFlag(ImageFlag.Deferred)}
                    data-tooltip={t('flags.deferredShortcut')}
                  >
                    <ImageFlagIcon flag={ImageFlag.Deferred} size={18} />
                  </button>
                )}
                {isToolbarItemVisible('flagUnflagged') && (
                  <button
                    className={clsx(productivityButtonClass, activeFlag === ImageFlag.Unflagged && 'bg-surface')}
                    disabled={productivityCount === 0}
                    onClick={() => onFlag(ImageFlag.Unflagged)}
                    data-tooltip={t('flags.unflaggedShortcut')}
                  >
                    <ImageFlagIcon flag={ImageFlag.Unflagged} size={18} />
                  </button>
                )}
                {isToolbarItemVisible('deleteRejected') && (
                  <button
                    className={productivityButtonClass}
                    disabled={!onDeleteRejected || rejectedInCurrentFolder.length === 0}
                    onClick={handleDeleteRejected}
                    data-tooltip={t('flags.deleteRejectedCount', { count: rejectedInCurrentFolder.length })}
                  >
                    <Trash2 size={18} />
                  </button>
                )}
              </div>
              <div className="h-5 w-px bg-surface"></div>
            </>
          )}
          <div className="flex items-center gap-2">
            {isToolbarItemVisible('copySettings') && (
              <button
                className="relative w-8 h-8 flex items-center justify-center rounded-md text-text-secondary hover:bg-surface hover:text-text-primary transition-colors disabled:opacity-40 disabled:hover:bg-transparent disabled:cursor-not-allowed"
                disabled={isCopyDisabled}
                onClick={onCopy}
                data-tooltip={t('ui.bottomBar.tooltips.copySettings')}
              >
                <AnimatePresence mode="wait" initial={false}>
                  {isCopied ? (
                    <motion.div
                      key="copied"
                      initial={{ opacity: 0, scale: 0.5 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.5 }}
                      transition={{ duration: 0.15 }}
                      className="absolute"
                    >
                      <Check size={18} className="text-green-500" />
                    </motion.div>
                  ) : (
                    <motion.div
                      key="copy"
                      initial={{ opacity: 0, scale: 0.5 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.5 }}
                      transition={{ duration: 0.15 }}
                      className="absolute"
                    >
                      <Copy size={18} />
                    </motion.div>
                  )}
                </AnimatePresence>
              </button>
            )}

            {isToolbarItemVisible('pasteSettings') && (
              <button
                className="relative w-8 h-8 flex items-center justify-center rounded-md text-text-secondary hover:bg-surface hover:text-text-primary transition-colors disabled:opacity-40 disabled:hover:bg-transparent disabled:cursor-not-allowed"
                disabled={isPasteDisabled}
                onClick={onPaste}
                data-tooltip={t('ui.bottomBar.tooltips.pasteSettings')}
              >
                <AnimatePresence mode="wait" initial={false}>
                  {isPasted ? (
                    <motion.div
                      key="pasted"
                      initial={{ opacity: 0, scale: 0.5 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.5 }}
                      transition={{ duration: 0.15 }}
                      className="absolute"
                    >
                      <Check size={18} className="text-green-500" />
                    </motion.div>
                  ) : (
                    <motion.div
                      key="paste"
                      initial={{ opacity: 0, scale: 0.5 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.5 }}
                      transition={{ duration: 0.15 }}
                      className="absolute"
                    >
                      <ClipboardPaste size={18} />
                    </motion.div>
                  )}
                </AnimatePresence>
              </button>
            )}

            {isToolbarItemVisible('copyPasteSettings') && (
              <button
                className="w-8 h-8 flex items-center justify-center rounded-md text-text-secondary hover:bg-surface hover:text-text-primary transition-colors"
                onClick={onOpenCopyPasteSettings}
                data-tooltip={t('ui.bottomBar.tooltips.copyPasteSettings')}
              >
                <Settings size={18} />
              </button>
            )}
          </div>

          <div className="h-5 w-px bg-surface"></div>

          <div className="flex items-center gap-1">
            {isToolbarItemVisible('applyPreset') && (
              <button
                className={productivityButtonClass}
                disabled={productivityCount === 0 && selectedFolderPaths.length === 0}
                onClick={() =>
                  setUI({
                    presetBatchModalState: {
                      isOpen: true,
                      target: {
                        imagePaths: productivityPaths,
                        folderPaths: productivityPaths.length > 0 ? [] : selectedFolderPaths,
                        includeSubfolders: false,
                      },
                    },
                  })
                }
                data-tooltip={t('presetBatch.applyPreset')}
              >
                <SwatchBook size={18} />
              </button>
            )}
            {isToolbarItemVisible('autoAdjust') && (
              <button
                className={productivityButtonClass}
                disabled={productivityCount === 0}
                onClick={handleAutoAdjust}
                data-tooltip={t('contextMenus.thumbnail.autoAdjust', { count: productivityCount })}
              >
                <Aperture size={18} />
              </button>
            )}
            {isToolbarItemVisible('denoise') && (
              <button
                className={productivityButtonClass}
                disabled={productivityCount === 0}
                onClick={openDenoise}
                data-tooltip={t('contextMenus.thumbnail.denoise', { count: productivityCount })}
              >
                <Grip size={18} />
              </button>
            )}
            {isToolbarItemVisible('convertNegative') && (
              <button
                className={productivityButtonClass}
                disabled={productivityCount === 0}
                onClick={() => setUI({ negativeModalState: { isOpen: true, targetPaths: productivityPaths } })}
                data-tooltip={t('contextMenus.thumbnail.convertNegative', { count: productivityCount })}
              >
                <Film size={18} />
              </button>
            )}
            {isToolbarItemVisible('stitchPanorama') && (
              <button
                className={productivityButtonClass}
                disabled={productivityCount < 2 || productivityCount > 30}
                onClick={openPanorama}
                data-tooltip={t('contextMenus.editor.stitchPanorama')}
              >
                <SquaresUnite size={18} />
              </button>
            )}
            {isToolbarItemVisible('mergeHdr') && (
              <button
                className={productivityButtonClass}
                disabled={productivityCount < 2 || productivityCount > 9}
                onClick={openHdr}
                data-tooltip={t('contextMenus.editor.mergeHdr')}
              >
                <Images size={18} />
              </button>
            )}
            {isToolbarItemVisible('frameImage') && (
              <button
                className={productivityButtonClass}
                disabled={productivityCount === 0 || productivityCount > 9}
                onClick={() =>
                  setUI({
                    collageModalState: {
                      isOpen: true,
                      sourceImages: imageList.filter((image) => productivityPaths.includes(image.path)),
                    },
                  })
                }
                data-tooltip={t('contextMenus.thumbnail.collage', { count: productivityCount })}
              >
                <LayoutTemplate size={18} />
              </button>
            )}
            {isToolbarItemVisible('cullImage') && (
              <button
                className={productivityButtonClass}
                disabled={productivityCount < 2}
                onClick={() =>
                  setUI({
                    cullingModalState: {
                      isOpen: true,
                      progress: null,
                      suggestions: null,
                      error: null,
                      pathsToCull: productivityPaths,
                    },
                  })
                }
                data-tooltip={t('contextMenus.thumbnail.cullImage', { count: productivityCount })}
              >
                <Users size={18} />
              </button>
            )}
            {hasProductivityActions && (hasCopyActions || hasStackActions) && (
              <div className="h-5 w-px bg-surface mx-1" aria-hidden="true" />
            )}
            {isToolbarItemVisible('physicalCopy') && (
              <button
                className={productivityButtonClass}
                disabled={productivityCount !== 1}
                onClick={handlePhysicalCopy}
                data-tooltip={t('contextMenus.thumbnail.physicalCopy')}
              >
                <Copy size={18} />
              </button>
            )}
            {isToolbarItemVisible('virtualCopy') && (
              <button
                className={productivityButtonClass}
                disabled={productivityCount !== 1}
                onClick={handleVirtualCopy}
                data-tooltip={t('contextMenus.thumbnail.virtualCopy')}
              >
                <CopyPlus size={18} />
              </button>
            )}
            {hasCopyActions && hasStackActions && <div className="h-5 w-px bg-surface mx-1" aria-hidden="true" />}
            {isToolbarItemVisible('stackSelected') && (
              <button
                className={productivityButtonClass}
                disabled={productivityCount < 2}
                onClick={handleStackSelected}
                data-tooltip={t('contextMenus.thumbnail.stackSelected', { count: productivityCount })}
              >
                <Layers size={18} />
              </button>
            )}
            {isToolbarItemVisible('toggleStack') && (
              <button
                className={productivityButtonClass}
                disabled={!targetStack}
                onClick={handleToggleStack}
                data-tooltip={
                  targetStack?.collapsed
                    ? t('contextMenus.thumbnail.expandStack')
                    : t('contextMenus.thumbnail.collapseStack')
                }
              >
                <ListCollapse size={18} />
              </button>
            )}
            {isToolbarItemVisible('setStackCover') && (
              <button
                className={productivityButtonClass}
                disabled={!targetStack || !stackTargetPath || targetStack.coverPath === stackTargetPath}
                onClick={handleMoveToTopOfStack}
                data-tooltip={t('contextMenus.thumbnail.moveToTopOfStack')}
              >
                <Star size={18} />
              </button>
            )}
            {isToolbarItemVisible('unstack') && (
              <button
                className={productivityButtonClass}
                disabled={!hasSelectedStacks}
                onClick={handleUnstack}
                data-tooltip={t('contextMenus.thumbnail.unstack')}
              >
                <Ungroup size={18} />
              </button>
            )}
          </div>

          <div className="h-5 w-px bg-surface"></div>

          {isToolbarItemVisible('quickFilter') && (
            <div
              className={clsx(
                'flex items-center transition-all duration-300',
                isFilterExpanded ? 'bg-surface rounded-md' : 'bg-transparent',
              )}
            >
              <button
                className={clsx(
                  'relative w-8 h-8 flex items-center justify-center rounded-md transition-colors shrink-0',
                  isFilterExpanded
                    ? 'text-text-primary'
                    : hasActiveFilters
                      ? 'bg-card-active text-accent'
                      : 'text-text-secondary hover:bg-surface hover:text-text-primary',
                )}
                onClick={() => setIsFilterExpanded(!isFilterExpanded)}
                data-tooltip={t('ui.bottomBar.tooltips.quickFilter', 'Quick Filter')}
              >
                <Filter size={18} />
                {hasActiveFilters && !isFilterExpanded && (
                  <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-accent" />
                )}
              </button>

              <div
                className={clsx(
                  'flex items-center transition-all duration-300 ease-in-out overflow-hidden',
                  isFilterExpanded ? 'max-w-[52rem] opacity-100 pr-2 ml-1' : 'max-w-0 opacity-0 pr-0 ml-0',
                )}
              >
                <div className="flex items-center gap-3 whitespace-nowrap">
                  <button
                    type="button"
                    onClick={clearFilters}
                    disabled={!hasActiveFilters}
                    className={clsx(
                      'flex h-6 w-6 items-center justify-center rounded-sm transition-colors',
                      hasActiveFilters
                        ? 'text-text-secondary hover:bg-card-active hover:text-text-primary'
                        : 'cursor-default text-text-secondary/30',
                    )}
                    data-tooltip={t('library.header.activeFilters.clearAll')}
                  >
                    <X size={15} />
                  </button>

                  <div className="h-4 w-px bg-border-color"></div>

                  <div className="flex items-center gap-0.5">
                    <button
                      type="button"
                      onClick={() => setFilterCriteria((prev) => ({ ...prev, rating: prev.rating === -1 ? 0 : -1 }))}
                      className={clsx(
                        'flex h-6 min-w-6 items-center justify-center rounded-sm px-1 text-xs transition-colors',
                        filterCriteria.rating === -1
                          ? 'bg-card-active text-accent'
                          : 'text-text-secondary hover:bg-card-active hover:text-text-primary',
                      )}
                      data-tooltip={t('library.filters.rating.unrated')}
                    >
                      0
                    </button>
                    {(['atMost', 'atLeast'] as const).map((comparison) => (
                      <button
                        key={`qf-rating-${comparison}`}
                        type="button"
                        onClick={() =>
                          setFilterCriteria((prev) => ({
                            ...prev,
                            ratingComparison: comparison,
                          }))
                        }
                        className={clsx(
                          'flex h-6 min-w-6 items-center justify-center rounded-sm px-1 text-xs font-semibold transition-colors',
                          (filterCriteria.ratingComparison ?? 'atLeast') === comparison
                            ? 'bg-card-active text-accent'
                            : 'text-text-secondary hover:bg-card-active hover:text-text-primary',
                        )}
                        data-tooltip={comparison === 'atMost' ? '≤ 1–5' : '≥ 1–5'}
                      >
                        {comparison === 'atMost' ? '≤' : '≥'}
                      </button>
                    ))}
                    {[1, 2, 3, 4, 5].map((starValue) => {
                      const isFilled = isRatingInRange(
                        starValue,
                        filterCriteria.rating,
                        filterCriteria.ratingComparison ?? 'atLeast',
                      );
                      return (
                        <button
                          key={`qf-star-${starValue}`}
                          onClick={() =>
                            setFilterCriteria((prev) => ({
                              ...prev,
                              rating: prev.rating === starValue ? 0 : starValue,
                            }))
                          }
                          className="p-0.5 focus:outline-none"
                          data-tooltip={`${(filterCriteria.ratingComparison ?? 'atLeast') === 'atMost' ? '≤' : '≥'} ${starValue}`}
                        >
                          <Star
                            size={16}
                            className={clsx(
                              'transition-colors duration-150',
                              isFilled ? 'text-accent fill-accent' : 'text-text-secondary hover:text-accent',
                            )}
                          />
                        </button>
                      );
                    })}
                  </div>

                  <div className="h-4 w-px bg-border-color"></div>

                  <div className="flex items-center gap-1">
                    {[
                      { status: RawStatus.RawOnly, label: 'RAW', tooltip: t('library.filters.raw.rawOnly') },
                      { status: RawStatus.NonRawOnly, label: 'IMG', tooltip: t('library.filters.raw.nonRawOnly') },
                    ].map(({ status, label, tooltip }) => (
                      <button
                        key={status}
                        type="button"
                        onClick={() =>
                          setFilterCriteria((prev) => ({
                            ...prev,
                            rawStatus: prev.rawStatus === status ? RawStatus.All : status,
                          }))
                        }
                        className={clsx(
                          'h-6 rounded-sm px-1.5 text-[10px] font-semibold transition-colors',
                          filterCriteria.rawStatus === status
                            ? 'bg-card-active text-accent'
                            : 'text-text-secondary hover:bg-card-active hover:text-text-primary',
                        )}
                        data-tooltip={tooltip}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  <div className="h-4 w-px bg-border-color"></div>

                  <div className="flex items-center gap-1">
                    {[
                      {
                        status: EditedStatus.EditedOnly,
                        label: 'EDIT',
                        tooltip: t('library.filters.edited.editedOnly'),
                      },
                      {
                        status: EditedStatus.UneditedOnly,
                        label: 'ORIG',
                        tooltip: t('library.filters.edited.uneditedOnly'),
                      },
                    ].map(({ status, label, tooltip }) => (
                      <button
                        key={status}
                        type="button"
                        onClick={() =>
                          setFilterCriteria((prev) => ({
                            ...prev,
                            editedStatus: prev.editedStatus === status ? EditedStatus.All : status,
                          }))
                        }
                        className={clsx(
                          'h-6 rounded-sm px-1.5 text-[10px] font-semibold transition-colors',
                          filterCriteria.editedStatus === status
                            ? 'bg-card-active text-accent'
                            : 'text-text-secondary hover:bg-card-active hover:text-text-primary',
                        )}
                        data-tooltip={tooltip}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  <div className="h-4 w-px bg-border-color"></div>

                  <div className="flex items-center gap-1.5">
                    {allColors.map((color) => {
                      const isSelected = (filterCriteria.colors || []).includes(color.name);

                      const tooltipTitle =
                        color.name === 'none'
                          ? t('library.header.viewOptions.noLabel')
                          : t(`contextMenus.colors.${color.name}`, {
                              defaultValue: color.name.charAt(0).toUpperCase() + color.name.slice(1),
                            });

                      return (
                        <button
                          key={`qf-color-${color.name}`}
                          onClick={() => {
                            const currentColors = filterCriteria.colors || [];
                            const newColors = currentColors.includes(color.name)
                              ? currentColors.filter((c) => c !== color.name)
                              : [...currentColors, color.name];
                            setFilterCriteria((prev) => ({ ...prev, colors: newColors }));
                          }}
                          className={clsx(
                            'w-4 h-4 rounded-full transition-transform hover:scale-105 flex items-center justify-center focus:outline-none',
                            isSelected ? 'ring-2 ring-accent ring-offset-1 ring-offset-bg-primary' : '',
                          )}
                          style={{ backgroundColor: color.color }}
                          data-tooltip={tooltipTitle}
                        >
                          {isSelected && <Check size={10} className="text-white drop-shadow-md" />}
                        </button>
                      );
                    })}
                  </div>

                  <div className="h-4 w-px bg-border-color"></div>

                  <div className="flex items-center gap-1">
                    {IMAGE_FLAG_FILTER_OPTIONS.map((flag) => {
                      const isSelected = (filterCriteria.flags || []).includes(flag);
                      return (
                        <button
                          key={`qf-flag-${flag}`}
                          onClick={() => {
                            const currentFlags = filterCriteria.flags || [];
                            const flags = currentFlags.includes(flag)
                              ? currentFlags.filter((currentFlag) => currentFlag !== flag)
                              : [...currentFlags, flag];
                            setFilterCriteria((prev) => ({ ...prev, flags }));
                          }}
                          className={clsx(
                            'flex h-6 w-6 items-center justify-center rounded-sm transition-colors',
                            isSelected
                              ? 'bg-card-active text-text-primary'
                              : 'text-text-secondary hover:bg-card-active hover:text-text-primary',
                          )}
                          data-tooltip={t(`flags.${flag}`)}
                        >
                          <ImageFlagIcon flag={flag} size={15} />
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          )}

          {isToolbarItemVisible('selectBy') && (
            <div
              className={clsx(
                'flex items-center transition-all duration-300',
                isSelectByOpen ? 'rounded-md bg-surface' : 'bg-transparent',
                activeSelectBy && 'ring-1 ring-accent/50',
              )}
            >
              <button
                type="button"
                className={clsx(
                  'relative flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors',
                  isSelectByOpen || activeSelectBy
                    ? 'text-accent'
                    : 'text-text-secondary hover:bg-surface hover:text-text-primary',
                )}
                onClick={() => setIsSelectByOpen((open) => !open)}
                aria-expanded={isSelectByOpen}
                data-tooltip={t('ui.bottomBar.selectBy.title', 'Select by')}
              >
                <ListChecks size={18} />
                {activeSelectBy && <span className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-accent" />}
              </button>

              <div
                className={clsx(
                  'flex items-center overflow-hidden transition-all duration-300 ease-in-out',
                  isSelectByOpen ? 'ml-1 max-w-[48rem] pr-2 opacity-100' : 'ml-0 max-w-0 pr-0 opacity-0',
                )}
              >
                <div className="flex items-center gap-3 whitespace-nowrap">
                  <button
                    type="button"
                    className="flex h-6 w-6 items-center justify-center rounded-sm text-text-secondary transition-colors hover:bg-card-active hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
                    disabled={numSelected === 0}
                    onClick={handleClearSelectBy}
                    data-tooltip={t('ui.bottomBar.selectBy.clear', 'Clear selection')}
                  >
                    <X size={15} />
                  </button>

                  <div className="h-4 w-px bg-border-color" />

                  <div className="flex items-center gap-0.5">
                    <button
                      type="button"
                      className={clsx(
                        'flex h-5 min-w-5 items-center justify-center rounded-sm px-1 text-[10px] transition-colors hover:bg-card-active hover:text-text-primary disabled:opacity-40',
                        activeSelectBy?.id === 'rating-unrated' ? 'bg-card-active text-accent' : 'text-text-secondary',
                      )}
                      disabled={(selectByCounts.get('rating-unrated') || 0) === 0}
                      onClick={() => handleSelectBy('rating-unrated', { rating: -1 })}
                      data-tooltip={`${t('library.filters.rating.unrated')} (${selectByCounts.get('rating-unrated') || 0})`}
                    >
                      0
                    </button>
                    {(['atMost', 'atLeast'] as const).map((comparison) => (
                      <button
                        key={`select-rating-${comparison}`}
                        type="button"
                        className={clsx(
                          'flex h-6 min-w-6 items-center justify-center rounded-sm px-1 text-xs font-semibold transition-colors',
                          selectRatingComparison === comparison
                            ? 'bg-card-active text-accent'
                            : 'text-text-secondary hover:bg-card-active hover:text-text-primary',
                        )}
                        onClick={() => {
                          if (selectRatingComparison === comparison) return;
                          setSelectRatingComparison(comparison);
                          if (activeSelectByRating > 0) {
                            handleSelectBy(`rating-${comparison}-${activeSelectByRating}`, {
                              rating: activeSelectByRating,
                              ratingComparison: comparison,
                            });
                          }
                        }}
                        data-tooltip={comparison === 'atMost' ? '≤ 1–5' : '≥ 1–5'}
                      >
                        {comparison === 'atMost' ? '≤' : '≥'}
                      </button>
                    ))}
                    {[1, 2, 3, 4, 5].map((rating) => {
                      const count = selectByCounts.get(`rating-${selectRatingComparison}-${rating}`) || 0;
                      const isIncluded = isRatingInRange(rating, activeSelectByRating, selectRatingComparison);
                      return (
                        <button
                          key={`select-rating-${rating}`}
                          type="button"
                          className={clsx(
                            'p-0.5 transition-colors hover:text-accent',
                            isIncluded ? 'text-accent' : 'text-text-secondary',
                            count === 0 && !isIncluded && 'opacity-40',
                          )}
                          disabled={count === 0}
                          onClick={() =>
                            handleSelectBy(`rating-${selectRatingComparison}-${rating}`, {
                              rating,
                              ratingComparison: selectRatingComparison,
                            })
                          }
                          data-tooltip={`${selectByGroups[0].options[rating].label} (${count})`}
                        >
                          <Star size={16} className={isIncluded ? 'fill-accent' : undefined} />
                        </button>
                      );
                    })}
                  </div>

                  <div className="h-4 w-px bg-border-color" />

                  <div className="flex items-center gap-1">
                    {selectByFileTypes.map(({ criteria, id, label, shortLabel }) => {
                      const count = selectByCounts.get(id) || 0;
                      return (
                        <button
                          key={`select-${id}`}
                          type="button"
                          className={clsx(
                            'h-6 rounded-sm px-1.5 text-[10px] font-semibold transition-colors hover:bg-card-active hover:text-text-primary disabled:opacity-40',
                            activeSelectBy?.id === id ? 'bg-card-active text-accent' : 'text-text-secondary',
                          )}
                          disabled={count === 0}
                          onClick={() => handleSelectBy(id, criteria)}
                          data-tooltip={`${label} (${count})`}
                        >
                          {shortLabel}
                        </button>
                      );
                    })}
                    {(['edited', 'unedited'] as const).map((id) => {
                      const isEdited = id === 'edited';
                      const count = selectByCounts.get(id) || 0;
                      return (
                        <button
                          key={`select-${id}`}
                          type="button"
                          className={clsx(
                            'h-6 rounded-sm px-1.5 text-[10px] transition-colors hover:bg-card-active hover:text-text-primary disabled:opacity-40',
                            activeSelectBy?.id === id ? 'bg-card-active text-accent' : 'text-text-secondary',
                          )}
                          disabled={count === 0}
                          onClick={() =>
                            handleSelectBy(id, {
                              editedStatus: isEdited ? EditedStatus.EditedOnly : EditedStatus.UneditedOnly,
                            })
                          }
                          data-tooltip={`${t(
                            isEdited ? 'library.filters.edited.editedOnly' : 'library.filters.edited.uneditedOnly',
                          )} (${count})`}
                        >
                          {isEdited ? 'EDIT' : 'ORIG'}
                        </button>
                      );
                    })}
                  </div>

                  <div className="h-4 w-px bg-border-color" />

                  <div className="flex items-center gap-1.5">
                    {allColors.map((color) => {
                      const count = selectByCounts.get(`color-${color.name}`) || 0;
                      const label =
                        color.name === 'none'
                          ? t('library.header.viewOptions.noLabel')
                          : t(`contextMenus.colors.${color.name}`, {
                              defaultValue: color.name.charAt(0).toUpperCase() + color.name.slice(1),
                            });
                      return (
                        <button
                          key={`select-color-${color.name}`}
                          type="button"
                          className={clsx(
                            'h-4 w-4 rounded-full transition-transform hover:scale-105 disabled:opacity-40',
                            activeSelectBy?.id === `color-${color.name}` &&
                              'ring-2 ring-accent ring-offset-1 ring-offset-bg-primary',
                          )}
                          style={{ backgroundColor: color.color }}
                          disabled={count === 0}
                          onClick={() => handleSelectBy(`color-${color.name}`, { colors: [color.name] })}
                          data-tooltip={`${label} (${count})`}
                        />
                      );
                    })}
                  </div>

                  <div className="h-4 w-px bg-border-color" />

                  <div className="flex items-center gap-1">
                    {IMAGE_FLAG_FILTER_OPTIONS.map((flag) => {
                      const count = selectByCounts.get(`flag-${flag}`) || 0;
                      return (
                        <button
                          key={`select-flag-${flag}`}
                          type="button"
                          className={clsx(
                            'flex h-6 w-6 items-center justify-center rounded-sm transition-colors hover:bg-card-active hover:text-text-primary disabled:opacity-40',
                            activeSelectBy?.id === `flag-${flag}`
                              ? 'bg-card-active text-accent'
                              : 'text-text-secondary',
                          )}
                          disabled={count === 0}
                          onClick={() => handleSelectBy(`flag-${flag}`, { flags: [flag] })}
                          data-tooltip={`${t(`flags.${flag}`)} (${count})`}
                        >
                          <ImageFlagIcon flag={flag} size={15} />
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          )}

          <div
            className={clsx(
              'flex items-center transition-all duration-300 ease-out overflow-hidden',
              showSelectionCounter ? 'max-w-xs opacity-100' : 'max-w-0 opacity-0',
            )}
          >
            <div className="h-5 w-px bg-surface mr-4"></div>
            <Text as="span" className="whitespace-nowrap">
              {t('ui.bottomBar.imagesSelected', { current: numSelected, total })}
            </Text>
          </div>
        </div>
        <div className="grow" />
        {isLibraryView ? (
          <div className="flex items-center gap-2">
            {isToolbarItemVisible('export') && (
              <button
                className="w-8 h-8 flex items-center justify-center rounded-md text-text-secondary hover:bg-surface hover:text-text-primary transition-colors disabled:opacity-40 disabled:hover:bg-transparent disabled:cursor-not-allowed"
                disabled={isExportDisabled}
                onClick={onExportClick}
                data-tooltip={t('ui.bottomBar.tooltips.export')}
              >
                <FileInput size={18} />
              </button>
            )}
          </div>
        ) : showZoomControls ? (
          <div className="flex items-center gap-4">
            {isToolbarItemVisible('zoom') && (
              <div className="flex items-center gap-2 w-56">
                <div
                  className="relative w-12 h-full flex items-center justify-end cursor-pointer"
                  onClick={handleResetZoom}
                  onMouseEnter={() => setIsZoomLabelHovered(true)}
                  onMouseLeave={() => setIsZoomLabelHovered(false)}
                  data-tooltip={t('ui.bottomBar.tooltips.resetZoom')}
                >
                  <span className="absolute right-0 text-xs text-text-secondary select-none text-right w-max transition-colors hover:text-text-primary">
                    {isZoomLabelHovered ? t('ui.bottomBar.zoomLabelReset') : t('ui.bottomBar.zoomLabel')}
                  </span>
                </div>

                <div className="relative flex-1 h-5">
                  <div className="absolute top-1/2 left-0 w-full h-1.5 -translate-y-1/2 bg-surface rounded-full pointer-events-none" />
                  <input
                    type="range"
                    min={0.1}
                    max={2.0}
                    step="0.05"
                    value={latchedSliderValue}
                    onChange={handleSliderChange}
                    onKeyDown={handleZoomKeyDown}
                    onMouseDown={handleMouseDown}
                    onMouseUp={handleMouseUp}
                    onTouchStart={handleMouseDown}
                    onTouchEnd={handleMouseUp}
                    onDoubleClick={handleResetZoom}
                    className={`absolute top-1/2 left-0 w-full h-1.5 mt-[-1.5px] appearance-none bg-transparent cursor-pointer p-0 slider-input z-10 ${
                      isZoomActive ? 'slider-thumb-active' : ''
                    }`}
                  />
                </div>

                <div className="relative text-xs text-text-secondary w-6 text-right flex items-center justify-end h-5 gap-1">
                  {isEditingPercent ? (
                    <input
                      ref={percentInputRef}
                      type="text"
                      value={percentInputValue}
                      onChange={(e) => setPercentInputValue(e.target.value)}
                      onKeyDown={handlePercentKeyDown}
                      onBlur={handlePercentSubmit}
                      className="w-full text-xs text-text-primary bg-bg-primary border border-border-color rounded-sm px-1 text-right"
                      style={{ fontSize: '12px', height: '18px' }}
                    />
                  ) : (
                    <span
                      onClick={handlePercentClick}
                      className="cursor-pointer hover:text-text-primary transition-colors select-none"
                      data-tooltip={t('ui.bottomBar.tooltips.customZoom')}
                    >
                      {latchedDisplayPercent}%
                    </span>
                  )}
                </div>
              </div>
            )}
            {showFilmstrip && isToolbarItemVisible('filmstrip') && (
              <>
                <div className="h-5 w-px bg-surface"></div>
                <button
                  className="p-1.5 rounded-md text-text-secondary hover:bg-surface hover:text-text-primary transition-colors"
                  onClick={() => setIsFilmstripVisible?.(!isFilmstripVisible)}
                  data-tooltip={
                    isFilmstripVisible
                      ? t('ui.bottomBar.tooltips.collapseFilmstrip')
                      : t('ui.bottomBar.tooltips.expandFilmstrip')
                  }
                >
                  {isFilmstripVisible ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
                </button>
              </>
            )}
          </div>
        ) : null}
        <div className="relative ml-2" ref={customizeRef}>
          <button
            className="w-8 h-8 flex items-center justify-center rounded-md text-text-secondary hover:bg-surface hover:text-text-primary transition-colors"
            onClick={() => setIsCustomizeOpen((open) => !open)}
            data-tooltip={t('ui.bottomBar.tooltips.customizeToolbar')}
            aria-expanded={isCustomizeOpen}
            aria-haspopup="menu"
          >
            <SlidersHorizontal size={18} />
          </button>
          <AnimatePresence>
            {isCustomizeOpen && (
              <motion.div
                className="absolute right-0 bottom-10 z-50 w-64 origin-bottom-right bg-surface/95 backdrop-blur-md rounded-lg shadow-xl p-2"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.1, ease: 'easeOut' }}
                role="menu"
              >
                <div className="px-3 py-2 text-xs font-semibold text-text-secondary uppercase tracking-wide">
                  {t('ui.bottomBar.customizeToolbar')}
                </div>
                <div className="max-h-96 overflow-y-auto custom-scrollbar">
                  {toolbarItems.map((item) => (
                    <button
                      key={item.id}
                      className="w-full px-3 py-2 text-sm rounded-md flex items-center gap-3 text-left text-text-primary hover:bg-bg-primary transition-colors"
                      onClick={() => toggleToolbarItem(item.id)}
                      role="menuitemcheckbox"
                      aria-checked={isToolbarItemVisible(item.id)}
                    >
                      <span className="w-4 h-4 rounded border border-text-secondary/50 flex items-center justify-center shrink-0">
                        {isToolbarItemVisible(item.id) && <Check size={12} />}
                      </span>
                      <span>{item.label}</span>
                    </button>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
