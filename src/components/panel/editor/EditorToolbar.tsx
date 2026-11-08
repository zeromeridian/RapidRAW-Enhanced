import { memo, useState, useEffect, useRef, useMemo } from 'react';
import { Eye, EyeOff, ArrowLeft, Maximize, Loader2, Undo, Redo, Settings } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { SelectedImage, GroupingMode } from '../../ui/AppProperties';
import { IconAperture, IconCalendar, IconClock, IconFocalLength, IconIso, IconShutter } from './ExifIcons';
import Text from '../../ui/Text';
import { TextColors, TextVariants, TextWeights } from '../../../types/typography';
import { useLibraryStore } from '../../../store/useLibraryStore';
import { useSettingsStore } from '../../../store/useSettingsStore';
import { findGroupVariants, getVariantLabel } from '../../../utils/imageGrouping';
import { getDisplayFilename } from '../../../utils/outputNaming';
import { useUIStore } from '../../../store/useUIStore';

interface EditorToolbarProps {
  canRedo: boolean;
  canUndo: boolean;
  isAndroid: boolean;
  isLoading: boolean;
  onBackToLibrary(): void;
  onImageSelect?(path: string, event?: any): void;
  onRedo(): void;
  onToggleFullScreen(): void;
  onToggleShowOriginal(): void;
  onUndo(): void;
  selectedImage: SelectedImage;
  showOriginal: boolean;
  adjustmentsHistoryLabels: string[];
  adjustmentsHistoryIndex: number;
  goToAdjustmentsHistoryIndex(index: number): void;
}

const EditorToolbar = memo(
  ({
    canRedo,
    canUndo,
    isAndroid,
    isLoading,
    onBackToLibrary,
    onImageSelect,
    onRedo,
    onToggleFullScreen,
    onToggleShowOriginal,
    onUndo,
    selectedImage,
    showOriginal,
    adjustmentsHistoryLabels,
    adjustmentsHistoryIndex,
    goToAdjustmentsHistoryIndex,
  }: EditorToolbarProps) => {
    const { t } = useTranslation();
    const isAnyLoading = isLoading;
    const [isLoaderVisible, setIsLoaderVisible] = useState(false);
    const [isLoaderMounted, setIsLoaderMounted] = useState(false);
    const [disableLoaderTransition, setDisableLoaderTransition] = useState(false);
    const hideTimeoutRef = useRef<number | null>(null);
    const prevIsLoadingRef = useRef(isLoading);
    const [isVcHovered, setIsVcHovered] = useState(false);
    const [isHistoryVisible, setIsHistoryVisible] = useState(false);
    const historyContainerRef = useRef<HTMLDivElement>(null);
    const historyButtonRef = useRef<HTMLDivElement>(null);

    const showResolution = !isAndroid && selectedImage.width > 0 && selectedImage.height > 0;
    const [displayedResolution, setDisplayedResolution] = useState('');

    const imageList = useLibraryStore((s) => s.imageList);
    const groupingMode: GroupingMode = useSettingsStore((s) => s.appSettings?.grouping) ?? 'off';
    const setUI = useUIStore((state) => state.setUI);
    const isExifVisible = useUIStore((state) => state.uiVisibility.editorExif ?? true);

    const toggleExifVisible = () =>
      setUI((state) => ({
        uiVisibility: { ...state.uiVisibility, editorExif: !(state.uiVisibility.editorExif ?? true) },
      }));

    const variantOptions = useMemo(() => {
      if (groupingMode === 'off' || !onImageSelect) return [];
      const isVC = selectedImage.path.includes('?vc=');
      if (isVC) return [];
      const variants = findGroupVariants(imageList, selectedImage.group_id);
      if (variants.length < 2) return [];
      return variants.map((v) => ({ path: v.path, label: getVariantLabel(v.path) }));
    }, [groupingMode, selectedImage.path, imageList, onImageSelect]);

    const { baseName, isVirtualCopy, vcId, exifData, hasExif } = useMemo(() => {
      const path = selectedImage.path;
      const { baseName, isVirtualCopy, vcId } = getDisplayFilename(path);

      const exif = selectedImage.exif || {};

      let fNum = exif.FNumber;
      if (fNum) {
        const fStr = String(fNum);
        fNum = fStr.toLowerCase().startsWith('f') ? fStr : `f/${fStr}`;
      }

      let captureDate = null;
      let captureTime = null;

      if (exif.DateTimeOriginal) {
        const dateTimeParts = exif.DateTimeOriginal.split(' ');
        captureDate = dateTimeParts[0]?.replace(/:/g, '-') || null;
        if (dateTimeParts[1]) {
          const timeParts = dateTimeParts[1].split(':');
          captureTime = `${timeParts[0]}:${timeParts[1]}`;
        }
      }

      const data = {
        iso: exif.PhotographicSensitivity || exif.ISO,
        fNumber: fNum,
        shutter: exif.ExposureTime,
        focal: exif.FocalLengthIn35mmFilm,
        captureDate: captureDate,
        captureTime: captureTime,
      };

      const hasData = !!(data.iso || data.fNumber || data.shutter || data.focal || data.captureDate);

      return {
        baseName,
        isVirtualCopy,
        vcId,
        exifData: data,
        hasExif: hasData,
      };
    }, [selectedImage.path, selectedImage.exif]);

    useEffect(() => {
      if (showResolution) {
        setDisplayedResolution(` - ${selectedImage.width} × ${selectedImage.height}`);
      }
    }, [showResolution, selectedImage.width, selectedImage.height]);

    useEffect(() => {
      const wasLoadingResolution = prevIsLoadingRef.current && !isLoading;

      if (isAnyLoading) {
        if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);
        setDisableLoaderTransition(false);
        setIsLoaderVisible(true);
      } else if (isLoaderVisible) {
        if (wasLoadingResolution) {
          setDisableLoaderTransition(true);
          setIsLoaderVisible(false);
        } else {
          setDisableLoaderTransition(false);
          hideTimeoutRef.current = window.setTimeout(() => {
            setIsLoaderVisible(false);
          }, 300);
        }
      }

      prevIsLoadingRef.current = isLoading;

      return () => {
        if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);
      };
    }, [isAnyLoading, isLoading, isLoaderVisible]);

    useEffect(() => {
      if (isLoaderVisible) {
        setIsLoaderMounted(true);
      } else if (disableLoaderTransition) {
        setIsLoaderMounted(false);
      }
    }, [isLoaderVisible, disableLoaderTransition]);

    useEffect(() => {
      if (!isHistoryVisible) return;
      const handleClickOutside = (e: MouseEvent) => {
        if (
          historyContainerRef.current &&
          !historyContainerRef.current.contains(e.target as Node) &&
          historyButtonRef.current &&
          !historyButtonRef.current.contains(e.target as Node)
        ) {
          setIsHistoryVisible(false);
        }
      };
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isHistoryVisible]);

    useEffect(() => {
      if (isHistoryVisible && historyContainerRef.current) {
        const timer = setTimeout(() => {
          const activeEl = historyContainerRef.current?.querySelector('[data-active="true"]');
          if (activeEl) {
            activeEl.scrollIntoView({ block: 'nearest', behavior: 'auto' });
          }
        }, 10);
        return () => clearTimeout(timer);
      }
    }, [isHistoryVisible, adjustmentsHistoryIndex]);

    const handleButtonKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
      if (e.key === 'Tab') return;
      e.currentTarget.blur();
    };

    const exifItems = [
      {
        key: 'shutter',
        Icon: IconShutter,
        value: exifData.shutter,
        tooltip: t('editor.toolbar.tooltips.shutterSpeed'),
      },
      { key: 'aperture', Icon: IconAperture, value: exifData.fNumber, tooltip: t('editor.toolbar.tooltips.aperture') },
      { key: 'iso', Icon: IconIso, value: exifData.iso, tooltip: t('editor.toolbar.tooltips.iso') },
      {
        key: 'focal',
        Icon: IconFocalLength,
        value: exifData.focal && (String(exifData.focal).endsWith('mm') ? exifData.focal : `${exifData.focal}mm`),
        tooltip: t('editor.toolbar.tooltips.focalLength'),
      },
      { key: 'date', Icon: IconCalendar, value: exifData.captureDate, tooltip: undefined },
      { key: 'time', Icon: IconClock, value: exifData.captureTime, tooltip: undefined },
    ].filter((item) => item.value);

    return (
      <div className="relative shrink-0 flex items-center justify-between px-4 compact:px-2 h-14 compact:h-11 gap-4 compact:gap-2 z-40">
        <div className="flex items-center gap-2 shrink-0 z-40">
          <button
            className="bg-surface text-text-primary p-2 compact:p-1.5 rounded-full hover:bg-card-active transition-colors shrink-0"
            onClick={onBackToLibrary}
            onKeyDown={handleButtonKeyDown}
            data-tooltip={t('editor.toolbar.tooltips.backToLibrary')}
            data-bench-id="back-to-library"
          >
            <ArrowLeft size={20} />
          </button>

          <div className="hidden 2xl:flex items-center gap-2" aria-hidden="true">
            <div className="p-2 compact:p-1.5 invisible pointer-events-none">
              <Undo size={20} />
            </div>
            <div className="p-2 compact:p-1.5 invisible pointer-events-none">
              <Undo size={20} />
            </div>
            <div className="p-2 compact:p-1.5 invisible pointer-events-none">
              <Undo size={20} />
            </div>
            <div className="p-2 compact:p-1.5 invisible pointer-events-none">
              <Undo size={20} />
            </div>
          </div>
        </div>

        <div className="flex-1 flex justify-center min-w-0 relative h-full">
          <div
            className={clsx(
              'bg-surface absolute top-2.5 compact:top-1.5 flex items-center h-9 compact:h-8 px-4 compact:px-3 rounded-[18px] max-w-full transition-colors duration-200',
              hasExif && 'cursor-pointer hover:bg-card-active',
            )}
            onClick={() => hasExif && toggleExifVisible()}
            data-tooltip={hasExif ? t('editor.toolbar.tooltips.toggleImageDetails') : undefined}
            style={{
              transform: 'translateX(-50%)',
              left: '50%',
            }}
          >
            <div className="flex items-center justify-center max-w-full h-5 min-w-0">
              <Text
                as="span"
                variant={TextVariants.small}
                color={TextColors.primary}
                weight={TextWeights.medium}
                className="truncate min-w-0 shrink"
              >
                {baseName}
              </Text>

              {isVirtualCopy && (
                <Text
                  as="div"
                  variant={TextVariants.small}
                  color={TextColors.accent}
                  weight={TextWeights.bold}
                  className="ml-2 shrink-0 bg-accent/20 px-2 py-0.5 rounded-full flex items-center overflow-hidden cursor-default"
                  onMouseEnter={() => setIsVcHovered(true)}
                  onMouseLeave={() => setIsVcHovered(false)}
                >
                  <span>{t('editor.toolbar.vc')}</span>
                  <div
                    className={clsx(
                      'transition-all duration-300 ease-out overflow-hidden whitespace-nowrap',
                      isVcHovered ? 'max-w-20 opacity-100' : 'max-w-0 opacity-0',
                    )}
                  >
                    <span>-{vcId}</span>
                  </div>
                </Text>
              )}

              {variantOptions.length > 0 && (
                <div className="flex items-center ml-2 shrink-0 border border-text-secondary/20 rounded-full overflow-hidden">
                  {variantOptions.map((v) => {
                    const isActive = v.path === selectedImage.path;
                    return (
                      <button
                        key={v.path}
                        disabled={isActive}
                        className={clsx(
                          'px-2.5 py-1 text-[11px] font-medium transition-colors',
                          isActive ? 'bg-surface text-text-primary' : 'text-text-secondary hover:bg-surface/50',
                        )}
                        data-tooltip={t('editor.toolbar.switchToVariant', { label: v.label })}
                        onClick={(e) => {
                          e.stopPropagation();
                          onImageSelect?.(v.path, e);
                        }}
                        onKeyDown={handleButtonKeyDown}
                      >
                        {v.label}
                      </button>
                    );
                  })}
                </div>
              )}

              <div
                className={clsx(
                  'transition-all duration-300 ease-out overflow-hidden whitespace-nowrap shrink-0',
                  showResolution ? 'max-w-40 opacity-100 ml-2' : 'max-w-0 opacity-0 ml-0',
                )}
              >
                <Text
                  as="span"
                  variant={TextVariants.small}
                  className={clsx(
                    'block transition-transform duration-200 delay-100',
                    showResolution ? 'scale-100' : 'scale-95',
                  )}
                >
                  {displayedResolution}
                </Text>
              </div>

              <div
                className={clsx(
                  'overflow-hidden shrink-0',
                  isLoaderVisible ? 'max-w-4 opacity-100 ml-2' : 'max-w-0 opacity-0 ml-0',
                  disableLoaderTransition ? 'transition-none' : 'transition-all duration-300',
                )}
                onTransitionEnd={(e) => {
                  if (e.propertyName === 'opacity' && !isLoaderVisible) {
                    setIsLoaderMounted(false);
                  }
                }}
              >
                {isLoaderMounted && <Loader2 size={12} className="text-text-secondary animate-spin" />}
              </div>

              <div
                className={clsx(
                  'flex items-center gap-4 overflow-hidden whitespace-nowrap shrink-0 transition-all duration-300 ease-out',
                  isExifVisible && exifItems.length > 0
                    ? 'max-w-[40rem] opacity-100 ml-3 pl-3 border-l border-text-secondary/20'
                    : 'max-w-0 opacity-0 ml-0 pl-0 border-l-0',
                )}
              >
                {exifItems.map(({ key, Icon, value, tooltip }) => (
                  <div className="flex items-center gap-1.5" data-tooltip={tooltip} key={key}>
                    <Text as="span">
                      <Icon />
                    </Text>
                    <Text as="span" variant={TextVariants.small} color={TextColors.primary} weight={TextWeights.medium}>
                      {value}
                    </Text>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0 z-40">
          <div className="relative flex items-center gap-2" ref={historyButtonRef}>
            <button
              className="bg-surface text-text-primary p-2 compact:p-1.5 rounded-full hover:bg-card-active transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={!canUndo}
              onClick={onUndo}
              onKeyDown={handleButtonKeyDown}
              onContextMenu={(e) => {
                e.preventDefault();
                setIsHistoryVisible((prev) => !prev);
              }}
              data-tooltip={t('editor.toolbar.tooltips.undo')}
              data-bench-id="undo"
            >
              <Undo size={20} />
            </button>
            <button
              className="bg-surface text-text-primary p-2 compact:p-1.5 rounded-full hover:bg-card-active transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={!canRedo}
              onClick={onRedo}
              onKeyDown={handleButtonKeyDown}
              onContextMenu={(e) => {
                e.preventDefault();
                setIsHistoryVisible((prev) => !prev);
              }}
              data-tooltip={t('editor.toolbar.tooltips.redo')}
            >
              <Redo size={20} />
            </button>

            <AnimatePresence>
              {isHistoryVisible && adjustmentsHistoryLabels.length > 1 && (
                <motion.div
                  ref={historyContainerRef}
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.15, ease: 'easeOut' }}
                  className="absolute top-full right-0 mt-3 w-96 max-w-[calc(100vw-1.5rem)] max-h-[min(20rem,calc(100vh-8rem))] bg-surface/90 backdrop-blur-md border border-text-secondary/10 shadow-xl rounded-lg overflow-y-auto custom-scrollbar z-50 flex flex-col py-1.5 px-0.5"
                >
                  {adjustmentsHistoryLabels.map((label, i) => {
                    const isCurrent = i === adjustmentsHistoryIndex;
                    const isFuture = i > adjustmentsHistoryIndex;

                    const textColor = isCurrent
                      ? TextColors.button
                      : isFuture
                        ? TextColors.secondary
                        : TextColors.primary;
                    const textWeight = isCurrent ? TextWeights.medium : TextWeights.normal;

                    return (
                      <button
                        key={i}
                        data-active={isCurrent}
                        onClick={() => goToAdjustmentsHistoryIndex(i)}
                        onKeyDown={handleButtonKeyDown}
                        data-tooltip={label || undefined}
                        className={clsx(
                          'text-left px-3 py-2 transition-colors mx-1 my-0.5 rounded-md',
                          isCurrent
                            ? 'bg-accent'
                            : isFuture
                              ? 'opacity-50 hover:bg-bg-primary hover:opacity-100'
                              : 'hover:bg-bg-primary',
                        )}
                      >
                        <div className="flex justify-between items-center gap-2">
                          <Text
                            as="span"
                            color={textColor}
                            weight={textWeight}
                            className="flex-1 line-clamp-2 wrap-break-word"
                          >
                            {label || 'Initial State'}
                          </Text>
                          <Text
                            as="span"
                            variant={TextVariants.small}
                            color={textColor}
                            weight={textWeight}
                            className="opacity-50 shrink-0"
                          >
                            {i === 0 ? '' : i}
                          </Text>
                        </div>
                      </button>
                    );
                  })}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <button
            className="bg-surface text-text-primary p-2 compact:p-1.5 rounded-full hover:bg-card-active transition-colors"
            onClick={() => setUI({ isSettingsOpen: true })}
            onKeyDown={handleButtonKeyDown}
            data-tooltip={t('library.splash.goToSettings')}
          >
            <Settings size={20} />
          </button>
          <button
            className={clsx(
              'p-2 rounded-full transition-colors',
              showOriginal
                ? 'bg-accent text-button-text hover:bg-accent/90 hover:text-button-text'
                : 'bg-surface hover:bg-card-active text-text-primary',
            )}
            onClick={onToggleShowOriginal}
            onKeyDown={handleButtonKeyDown}
            data-tooltip={
              showOriginal ? t('editor.toolbar.tooltips.showEdited') : t('editor.toolbar.tooltips.showOriginal')
            }
          >
            {showOriginal ? <EyeOff size={20} /> : <Eye size={20} />}
          </button>
          <button
            className="bg-surface text-text-primary p-2 compact:p-1.5 rounded-full hover:bg-card-active transition-colors disabled:opacity-50 disabled:cursor-not-allowed relative"
            onClick={onToggleFullScreen}
            onKeyDown={handleButtonKeyDown}
            data-tooltip={t('editor.toolbar.tooltips.fullscreen')}
          >
            <div className="relative w-5 h-5 flex items-center justify-center">
              <Maximize size={20} />
            </div>
          </button>
        </div>
      </div>
    );
  },
);

export default EditorToolbar;
