import { useEffect, useRef, useState } from 'react';
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
  ListCollapse,
  Settings,
  SlidersHorizontal,
  SquaresUnite,
  Star,
  Ungroup,
  Users,
} from 'lucide-react';
import clsx from 'clsx';
import { motion, AnimatePresence } from 'framer-motion';
import { useShallow } from 'zustand/react/shallow';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';

import Filmstrip from './Filmstrip';
import { AlbumItem, GLOBAL_KEYS, ImageFile, Invokes, SelectedImage, ThumbnailAspectRatio } from '../ui/AppProperties';
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
  const [isCustomizeOpen, setIsCustomizeOpen] = useState(false);
  const customizeRef = useRef<HTMLDivElement>(null);
  const { filterCriteria, libraryActivePath, setFilterCriteria, setLibrary } = useLibraryStore(
    useShallow((state) => ({
      filterCriteria: state.filterCriteria,
      libraryActivePath: state.libraryActivePath,
      setFilterCriteria: state.setFilterCriteria,
      setLibrary: state.setLibrary,
    })),
  );
  const setUI = useUIStore((state) => state.setUI);
  const setEditor = useEditorStore((state) => state.setEditor);
  const { appSettings, handleSettingsChange } = useSettingsStore(
    useShallow((state) => ({
      appSettings: state.appSettings,
      handleSettingsChange: state.handleSettingsChange,
    })),
  );

  const allColors = [...COLOR_LABELS, { name: 'none', color: '#9ca3af' }];
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
    multiSelectedPaths.length > 0
      ? multiSelectedPaths
      : selectedImage?.path
        ? [selectedImage.path]
        : libraryActivePath
          ? [libraryActivePath]
          : [];
  const productivityCount = productivityPaths.length;
  const firstProductivityImage = imageList.find((image) => image.path === productivityPaths[0]);
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
  const toolbarItems = [
    { id: 'rating', label: t('contextMenus.editor.rating') },
    { id: 'copySettings', label: t('ui.bottomBar.tooltips.copySettings') },
    { id: 'pasteSettings', label: t('ui.bottomBar.tooltips.pasteSettings') },
    { id: 'copyPasteSettings', label: t('ui.bottomBar.tooltips.copyPasteSettings') },
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
    { id: 'export', label: t('ui.bottomBar.tooltips.export') },
    { id: 'zoom', label: t('ui.bottomBar.zoomLabel') },
    { id: 'filmstrip', label: t('ui.bottomBar.tooltips.collapseFilmstrip') },
  ];
  const productivityButtonClass =
    'w-8 h-8 flex items-center justify-center rounded-md text-text-secondary hover:bg-surface hover:text-text-primary transition-colors disabled:opacity-40 disabled:hover:bg-transparent disabled:cursor-not-allowed';

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
    <div className="shrink-0 bg-bg-secondary rounded-lg flex flex-col">
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
          <div className="h-5 w-px bg-surface"></div>
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
                    : 'text-text-secondary hover:bg-surface hover:text-text-primary',
                )}
                onClick={() => setIsFilterExpanded(!isFilterExpanded)}
                data-tooltip={t('ui.bottomBar.tooltips.quickFilter', 'Quick Filter')}
              >
                <Filter size={18} />
              </button>

              <div
                className={clsx(
                  'flex items-center transition-all duration-300 ease-in-out overflow-hidden',
                  isFilterExpanded ? 'max-w-100 opacity-100 pr-2 ml-1' : 'max-w-0 opacity-0 pr-0 ml-0',
                )}
              >
                <div className="flex items-center gap-3 whitespace-nowrap">
                  <div className="flex items-center gap-0.5">
                    {[1, 2, 3, 4, 5].map((starValue) => {
                      const isFilled = filterCriteria.rating > 0 && starValue <= filterCriteria.rating;
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
