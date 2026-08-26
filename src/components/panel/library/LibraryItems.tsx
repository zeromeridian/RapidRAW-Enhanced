import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Image as ImageIcon,
  Folder,
  FolderOpen,
  Star as StarIcon,
  SlidersHorizontal,
  CloudOff,
  Layers,
} from 'lucide-react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { COLOR_LABELS, Color } from '../../../utils/adjustments';
import { ThumbnailAspectRatio, ImageFile, ExifOverlay } from '../../ui/AppProperties';
import Text from '../../ui/Text';
import { TextColors, TextVariants, TextWeights, TEXT_COLOR_KEYS } from '../../../types/typography';
import { ColumnWidths } from '../MainLibrary';
import { useProcessStore } from '../../../store/useProcessStore';
import { useSettingsStore } from '../../../store/useSettingsStore';
import { IconAperture, IconFocalLength, IconIso, IconShutter } from '../editor/ExifIcons';
import { reorderStackPaths } from '../../../utils/imageStacks';
import { StackMemberPosition, StackVisualInfo } from '../../../utils/imageGrouping';
import { getDisplayFilename, getFileTypeBadgeLabel } from '../../../utils/outputNaming';
import { getImageFlag, ImageFlag } from '../../../utils/imageFlags';
import ImageFlagBadge from '../../ui/ImageFlagBadge';
import { writeLibraryDragPayload } from '../../../utils/libraryDragDrop';

type StackDropEdge = 'before' | 'after';

let draggedStackPath: string | null = null;
const STACK_DRAG_TYPE = 'application/x-thisisraw-stack';

const STACK_SPINE_POSITION_CLASSES: Record<StackMemberPosition, string> = {
  only: 'top-2 bottom-2 rounded-full',
  first: 'top-2 bottom-0 rounded-t-full',
  middle: 'top-0 bottom-0',
  last: 'top-0 bottom-2 rounded-b-full',
};

const STACK_ACCENT_COLOR = '#f97316';

export const StackVisualCue = ({ info }: { info?: StackVisualInfo }) => {
  if (!info) return null;

  return (
    <>
      {!info.collapsed && (
        <div
          className={clsx('absolute left-0 z-20 w-1 pointer-events-none', STACK_SPINE_POSITION_CLASSES[info.position])}
          style={{
            backgroundColor: STACK_ACCENT_COLOR,
            boxShadow: '1px 0 0 rgba(0, 0, 0, 0.65)',
          }}
        />
      )}
      {info.isCover && (
        <>
          <div className="absolute top-1.5 left-1.5 z-20 w-3 h-3 rounded-tl-sm border-t border-l border-accent/40 pointer-events-none" />
          <div className="absolute top-2.5 left-2.5 z-20 w-3 h-3 rounded-tl-sm border-t border-l border-accent/20 pointer-events-none" />
        </>
      )}
    </>
  );
};

interface ImageLayer {
  id: string;
  url: string;
  opacity: number;
}

const ThumbnailComponent = ({
  isActive,
  isSelected,
  isForcedHover,
  onContextMenu,
  onImageClick,
  onImageDoubleClick,
  onLoad,
  path,
  rating,
  tags,
  aspectRatio: thumbnailAspectRatio,
  isEdited,
  exif,
  isCloudPlaceholder,
  groupBadgeLabel,
  groupBadgeCount,
  stackVisual,
  isRaw,
  onStackBadgeClick,
  isStackDraggable,
  onStackDragStart,
  onStackDragOver,
  onStackDrop,
  onStackDragEnd,
  onFileDragStart,
}: any) => {
  const { t } = useTranslation();
  const data = useProcessStore((s) => s.thumbnails[path]);
  const exifOverlay = useSettingsStore((s) => s.appSettings?.exifOverlay || ExifOverlay.Off);
  const displayEditIcon = useSettingsStore((s) => s.appSettings?.displayEditIcon ?? true);
  const showEditIcon = isEdited && displayEditIcon;

  const [showPlaceholder, setShowPlaceholder] = useState(false);
  const [layers, setLayers] = useState<ImageLayer[]>([]);
  const [stackDropEdge, setStackDropEdge] = useState<StackDropEdge | null>(null);
  const [isStackDragging, setIsStackDragging] = useState(false);

  const [currentPath, setCurrentPath] = useState(path);
  if (currentPath !== path) {
    setCurrentPath(path);
    setLayers([]);
  }

  const pathRef = useRef(path);
  const hadDataOnPathChange = useRef(!!data);

  if (pathRef.current !== path) {
    pathRef.current = path;
    hadDataOnPathChange.current = !!data;
  }

  const { baseName, isVirtualCopy } = useMemo(() => {
    return getDisplayFilename(path);
  }, [path]);
  const fileTypeLabel = useMemo(() => getFileTypeBadgeLabel(path, isRaw), [isRaw, path]);

  const { shutter, fNumber, iso, focal } = useMemo(() => {
    const e = exif || {};
    let fNum = e.FNumber ? String(e.FNumber) : '';
    if (fNum && !fNum.toLowerCase().startsWith('f')) fNum = `f/${fNum}`;
    return {
      shutter: e.ExposureTime || '',
      fNumber: fNum,
      iso: e.PhotographicSensitivity || e.ISOSpeedRatings || '',
      focal: e.FocalLengthIn35mmFilm || e.FocalLength || '',
    };
  }, [exif]);

  useEffect(() => {
    if (data) {
      setShowPlaceholder(false);
      return;
    }
    const timer = setTimeout(() => {
      setShowPlaceholder(true);
    }, 500);
    return () => clearTimeout(timer);
  }, [data]);

  useEffect(() => {
    if (!data) {
      setLayers([]);
      return;
    }

    setLayers((prev) => {
      if (prev.some((l) => l.id === data)) return prev;

      if (prev.length === 0) {
        if (hadDataOnPathChange.current) {
          return [{ id: data, url: data, opacity: 1 }];
        } else {
          return [{ id: data, url: data, opacity: 0 }];
        }
      }

      return [...prev, { id: data, url: data, opacity: 0 }];
    });
  }, [data, path]);

  useEffect(() => {
    const layerToFadeIn = layers.find((l) => l.opacity === 0);
    if (layerToFadeIn) {
      const frame = requestAnimationFrame(() => {
        setLayers((prev) => prev.map((l) => (l.id === layerToFadeIn.id ? { ...l, opacity: 1 } : l)));
      });
      return () => cancelAnimationFrame(frame);
    }
  }, [layers]);

  const handleTransitionEnd = useCallback((finishedId: string) => {
    setLayers((prev) => {
      const finishedIndex = prev.findIndex((l) => l.id === finishedId);
      if (finishedIndex < 0 || prev.length <= 1) return prev;
      return prev.slice(finishedIndex);
    });
  }, []);

  const ringClass = isActive
    ? 'ring-2 ring-inset ring-accent'
    : isSelected
      ? 'ring-2 ring-inset ring-gray-400'
      : isForcedHover
        ? 'ring-2 ring-inset ring-hover-color'
        : 'group-hover:ring-2 group-hover:ring-inset group-hover:ring-hover-color';

  const colorTag = tags?.find((t: string) => t.startsWith('color:'))?.substring(6);
  const colorLabel = COLOR_LABELS.find((c: Color) => c.name === colorTag);
  const imageFlag = getImageFlag(tags);

  const isAlways = exifOverlay === ExifOverlay.Always;
  const isHover = exifOverlay === ExifOverlay.Hover;
  const showFileTypeBadge = exifOverlay !== ExifOverlay.Off;

  const hasEditIcon = !!showEditIcon;
  const hasColorLabel = !!colorLabel;
  const hasRating = rating > 0;
  const hasGroupBadge = !!groupBadgeLabel;
  const hasAnyOverlay = hasEditIcon || hasColorLabel || hasRating || hasGroupBadge;

  return (
    <div
      className={clsx(
        'aspect-square bg-surface rounded-md overflow-hidden cursor-pointer group relative flex flex-col transition-all duration-150 transform-gpu [-webkit-mask-image:-webkit-radial-gradient(white,black)]',
        isStackDragging && 'opacity-50',
      )}
      data-bench-id="thumbnail"
      draggable
      onClick={(e: any) => {
        e.stopPropagation();
        onImageClick(path, e);
      }}
      onContextMenu={(e: any) => onContextMenu(e, path)}
      onDoubleClick={() => onImageDoubleClick(path)}
      onDragStart={(event) => {
        onFileDragStart(path, event);
        if (isStackDraggable) {
          setIsStackDragging(true);
          onStackDragStart(path, event);
        }
      }}
      onDragOver={(event) => {
        const edge = onStackDragOver(path, event, 'horizontal');
        setStackDropEdge(edge);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setStackDropEdge(null);
      }}
      onDrop={(event) => {
        setStackDropEdge(null);
        onStackDrop(path, event, 'horizontal');
      }}
      onDragEnd={() => {
        setIsStackDragging(false);
        setStackDropEdge(null);
        onStackDragEnd();
      }}
    >
      {stackDropEdge && (
        <div
          className={clsx(
            'absolute top-0 bottom-0 z-40 w-1 bg-accent pointer-events-none',
            stackDropEdge === 'before' ? 'left-0' : 'right-0',
          )}
        />
      )}
      <StackVisualCue info={stackVisual} />
      <ImageFlagBadge flag={imageFlag} className="absolute bottom-1.5 left-2 z-30 pointer-events-none" />
      <div className="relative w-full flex-1 min-h-0 z-0 bg-surface">
        {layers.length > 0 && (
          <div className="absolute inset-0 w-full h-full">
            {layers.map((layer) => (
              <div
                key={layer.id}
                className="absolute inset-0 w-full h-full"
                style={{
                  opacity: layer.opacity,
                  transition: 'opacity 300ms ease-in-out',
                }}
                onTransitionEnd={() => handleTransitionEnd(layer.id)}
              >
                <img
                  alt={path.split(/[\\/]/).pop()}
                  className={clsx(
                    'w-full h-full transition-transform duration-300 will-change-transform relative',
                    thumbnailAspectRatio === ThumbnailAspectRatio.Contain ? 'object-contain' : 'object-cover',
                    isForcedHover ? 'scale-[1.02]' : 'group-hover:scale-[1.02]',
                  )}
                  decoding="async"
                  loading="lazy"
                  src={layer.url}
                  onLoad={() => onLoad(path)}
                />
              </div>
            ))}
          </div>
        )}

        {layers.length === 0 &&
          showPlaceholder &&
          (isCloudPlaceholder ? (
            <div
              className="absolute inset-0 w-full h-full flex items-center justify-center bg-surface"
              data-tooltip={t('library.items.cloudPlaceholder')}
            >
              <CloudOff className="text-text-secondary" />
            </div>
          ) : (
            <div className="absolute inset-0 w-full h-full flex items-center justify-center bg-surface">
              <ImageIcon className="text-text-secondary animate-pulse" />
            </div>
          ))}

        {isCloudPlaceholder && layers.length > 0 && (
          <div
            className="absolute top-1.5 left-1.5 z-10 rounded-full h-5 w-5 flex items-center justify-center bg-black/40 shadow-md pointer-events-none"
            data-tooltip={t('library.items.cloudPlaceholder')}
          >
            <CloudOff size={12} className="text-white" />
          </div>
        )}

        {imageFlag === ImageFlag.Rejected && <div className="absolute inset-0 z-10 bg-black/45 pointer-events-none" />}
      </div>

      <div
        className={clsx(
          'absolute top-0 right-0 w-1/2 h-1/2 bg-linear-to-bl from-black/20 via-black/0 to-transparent pointer-events-none z-0 transition-opacity duration-200 ease-in-out',
          hasAnyOverlay ? 'opacity-100' : 'opacity-0',
        )}
      />

      <div className="absolute top-1.5 right-1.5 flex items-center justify-end z-10 pointer-events-none">
        <div
          className={clsx(
            'rounded-full h-5 px-1.5 flex items-center justify-center gap-0 pointer-events-auto transition-all duration-200 ease-out origin-top-right',
            stackVisual?.collapsed && groupBadgeCount
              ? 'bg-black/80 ring-1 ring-white/90 shadow-[0_1px_4px_rgba(0,0,0,0.9)]'
              : 'bg-black/30 shadow-md',
            hasAnyOverlay ? 'opacity-100 scale-100' : 'opacity-0 scale-90 pointer-events-none',
          )}
        >
          <div
            className={clsx(
              'text-white flex items-center transition-all duration-200 ease-out overflow-hidden',
              hasEditIcon ? 'max-w-3 opacity-100 scale-100' : 'max-w-0 opacity-0 scale-75 pointer-events-none',
            )}
          >
            <SlidersHorizontal size={12} />
          </div>

          <div
            className={clsx(
              'flex items-center justify-center shrink-0 transition-all duration-200 ease-out overflow-hidden',
              hasColorLabel ? 'max-w-3 opacity-100 scale-100' : 'max-w-0 opacity-0 scale-75 pointer-events-none',
              hasColorLabel && hasEditIcon ? 'ml-1.5' : 'ml-0',
            )}
          >
            <div
              className="w-3 h-3 rounded-full transition-colors duration-200"
              style={{ backgroundColor: colorLabel ? colorLabel.color : 'transparent' }}
            />
          </div>

          <div
            className={clsx(
              'flex items-center gap-0.5 shrink-0 transition-all duration-200 ease-out overflow-hidden',
              hasRating ? 'max-w-7 opacity-100 scale-100' : 'max-w-0 opacity-0 scale-75 pointer-events-none',
              hasRating && (hasEditIcon || hasColorLabel) ? 'ml-1.5' : 'ml-0',
            )}
          >
            <Text variant={TextVariants.small} color={TextColors.white}>
              {rating}
            </Text>
            <StarIcon size={12} className="text-white fill-white" />
          </div>

          <div
            className={clsx(
              'flex items-center shrink-0 transition-all duration-200 ease-out overflow-hidden rounded-sm',
              hasGroupBadge ? 'max-w-10 opacity-100 scale-100' : 'max-w-0 opacity-0 scale-75 pointer-events-none',
              hasGroupBadge && (hasEditIcon || hasColorLabel || hasRating) ? 'ml-1.5' : 'ml-0',
              groupBadgeCount &&
                'cursor-pointer hover:bg-white/20 focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-white',
            )}
            data-tooltip={groupBadgeLabel}
            role={groupBadgeCount ? 'button' : undefined}
            tabIndex={groupBadgeCount ? 0 : undefined}
            onClick={(event) => {
              if (!groupBadgeCount) return;
              event.stopPropagation();
              onStackBadgeClick(path);
            }}
            onKeyDown={(event) => {
              if (!groupBadgeCount || (event.key !== 'Enter' && event.key !== ' ')) return;
              event.preventDefault();
              event.stopPropagation();
              onStackBadgeClick(path);
            }}
          >
            <Layers size={12} className="text-white" />
            {groupBadgeCount && (
              <Text variant={TextVariants.small} color={TextColors.white} className="ml-0.5">
                {groupBadgeCount}
              </Text>
            )}
          </div>
        </div>
      </div>

      <div
        className={clsx(
          'absolute bottom-0 left-0 right-0 h-16 transition-opacity duration-300 pointer-events-none z-10',
          'bg-linear-to-t from-black/70 to-transparent',
          isAlways ? 'opacity-0' : isHover ? 'opacity-100 group-hover:opacity-0' : 'opacity-100',
        )}
      />

      <div
        className={clsx(
          'w-full transition-[grid-template-rows] duration-300 ease-in-out grid shrink-0 z-0',
          isAlways ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
        )}
        aria-hidden="true"
      >
        <div className="min-h-0 overflow-hidden pointer-events-none invisible">
          <div className="flex flex-col p-2 pb-1.5">
            <div className="flex items-center justify-between gap-1 shrink-0">
              <Text variant={TextVariants.small} className="min-w-0 flex-1 truncate pr-1">
                {baseName}
              </Text>
              <div className="flex shrink-0 items-center gap-1">
                {showFileTypeBadge && (
                  <Text variant={TextVariants.small} className="rounded-sm border px-1 py-0.5 text-[8px] font-bold">
                    {fileTypeLabel}
                  </Text>
                )}
                {isVirtualCopy && (
                  <Text variant={TextVariants.small} className="px-1.5 py-0.5 font-bold">
                    VC
                  </Text>
                )}
              </div>
            </div>
            <div className="pt-1.5 pb-0.5 flex flex-wrap items-center gap-x-2.5 shrink-0">
              <div className="flex items-center gap-1">
                <IconShutter className="w-2.5 h-2.5" />
                <Text variant={TextVariants.small} className="text-[9px] font-medium tracking-wide">
                  {shutter || '-'}
                </Text>
              </div>
              <div className="flex items-center gap-1">
                <IconAperture className="w-2.5 h-2.5" />
                <Text variant={TextVariants.small} className="text-[9px] font-medium tracking-wide">
                  {fNumber || '-'}
                </Text>
              </div>
              <div className="flex items-center gap-1">
                <IconIso className="w-2.5 h-2.5" />
                <Text variant={TextVariants.small} className="text-[9px] font-medium tracking-wide">
                  {iso || '-'}
                </Text>
              </div>
              <div className="flex items-center gap-1">
                <IconFocalLength className="w-2.5 h-2.5" />
                <Text variant={TextVariants.small} className="text-[9px] font-medium tracking-wide">
                  {focal ? (String(focal).endsWith('mm') ? focal : `${focal}mm`) : '-'}
                </Text>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div
        className={clsx(
          'absolute bottom-0 left-0 right-0 flex flex-col p-2 pb-1.5 transition-all duration-300 ease-in-out z-20',
          isAlways
            ? 'bg-surface border-t border-border-color/50 pointer-events-auto'
            : isHover
              ? 'bg-transparent group-hover:bg-surface/60 backdrop-blur-none group-hover:backdrop-blur-md border-t border-transparent group-hover:border-border-color/50 pointer-events-none group-hover:pointer-events-auto'
              : 'bg-transparent border-t border-transparent pointer-events-none',
        )}
      >
        <div className="flex items-center justify-between gap-1 shrink-0">
          <Text
            variant={TextVariants.small}
            className={clsx(
              'min-w-0 flex-1 truncate pr-1 transition-colors duration-300',
              isAlways ? 'text-white' : isHover ? 'text-white group-hover:text-white' : 'text-white',
            )}
          >
            {baseName}
          </Text>
          <div className="flex shrink-0 items-center gap-1">
            {showFileTypeBadge && (
              <Text
                as="div"
                variant={TextVariants.small}
                weight={TextWeights.bold}
                className={clsx(
                  'shrink-0 rounded-sm border px-1 py-0.5 text-[8px] font-bold tracking-wide transition-colors duration-300',
                  isAlways
                    ? 'border-border-color/70 bg-bg-primary/60 text-text-secondary'
                    : 'border-white/20 bg-black/35 text-white/85 backdrop-blur-xs group-hover:border-border-color/70 group-hover:bg-bg-primary/60 group-hover:text-text-secondary group-hover:backdrop-blur-none',
                )}
              >
                {fileTypeLabel}
              </Text>
            )}
            {isVirtualCopy && (
              <Text
                as="div"
                variant={TextVariants.small}
                weight={TextWeights.bold}
                className={clsx(
                  'shrink-0 px-1.5 py-0.5 rounded-full transition-colors duration-300 font-bold pointer-events-auto',
                  isAlways
                    ? 'bg-border-color/30 text-text-primary shadow-none'
                    : isHover
                      ? 'bg-black/30 text-white backdrop-blur-xs shadow-md group-hover:bg-border-color/30 group-hover:text-text-primary group-hover:shadow-none group-hover:backdrop-blur-none'
                      : 'bg-black/30 text-white backdrop-blur-xs shadow-md',
                )}
                data-tooltip={t('library.items.tooltipVirtualCopy')}
              >
                VC
              </Text>
            )}
          </div>
        </div>

        <div
          className={clsx(
            'grid transition-[grid-template-rows,opacity] duration-300 ease-in-out shrink-0',
            isAlways
              ? 'grid-rows-[1fr] opacity-100'
              : isHover
                ? 'grid-rows-[0fr] opacity-0 group-hover:grid-rows-[1fr] group-hover:opacity-100'
                : 'grid-rows-[0fr] opacity-0',
          )}
        >
          <div className="overflow-hidden min-h-0">
            <div
              className={clsx(
                'pt-1.5 pb-0.5 flex flex-wrap items-center gap-x-2.5 shrink-0 transition-transform duration-300 ease-in-out',
                isAlways ? 'translate-y-0' : isHover ? 'translate-y-3 group-hover:translate-y-0' : 'translate-y-3',
              )}
            >
              <div
                className="flex items-center gap-1 text-text-secondary"
                data-tooltip={t('library.items.tooltipShutterSpeed')}
              >
                <IconShutter className="w-2.5 h-2.5" />
                <Text variant={TextVariants.small} className="text-[9px] font-medium tracking-wide">
                  {shutter || '-'}
                </Text>
              </div>
              <div
                className="flex items-center gap-1 text-text-secondary"
                data-tooltip={t('library.items.tooltipAperture')}
              >
                <IconAperture className="w-2.5 h-2.5" />
                <Text variant={TextVariants.small} className="text-[9px] font-medium tracking-wide">
                  {fNumber || '-'}
                </Text>
              </div>
              <div className="flex items-center gap-1 text-text-secondary" data-tooltip={t('library.items.tooltipIso')}>
                <IconIso className="w-2.5 h-2.5" />
                <Text variant={TextVariants.small} className="text-[9px] font-medium tracking-wide">
                  {iso || '-'}
                </Text>
              </div>
              <div
                className="flex items-center gap-1 text-text-secondary"
                data-tooltip={t('library.items.tooltipFocalLength')}
              >
                <IconFocalLength className="w-2.5 h-2.5" />
                <Text variant={TextVariants.small} className="text-[9px] font-medium tracking-wide">
                  {focal ? (String(focal).endsWith('mm') ? focal : `${focal}mm`) : '-'}
                </Text>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div
        className={clsx('absolute inset-0 rounded-md pointer-events-none z-30 transition-all duration-150', ringClass)}
      />
    </div>
  );
};

const ListItemComponent = ({
  isActive,
  isSelected,
  onContextMenu,
  onImageClick,
  onImageDoubleClick,
  onLoad,
  path,
  rating,
  tags,
  modified,
  aspectRatio: thumbnailAspectRatio,
  columnWidths,
  exif,
  isCloudPlaceholder,
  isPrevSelected,
  isNextSelected,
  stackBadgeLabel,
  stackBadgeCount,
  stackVisual,
  isRaw,
  onStackBadgeClick,
  isStackDraggable,
  onStackDragStart,
  onStackDragOver,
  onStackDrop,
  onStackDragEnd,
  onFileDragStart,
}: any) => {
  const { t } = useTranslation();
  const data = useProcessStore((s) => s.thumbnails[path]);
  const exifOverlay = useSettingsStore((s) => s.appSettings?.exifOverlay || ExifOverlay.Off);

  const [showPlaceholder, setShowPlaceholder] = useState(false);
  const [layers, setLayers] = useState<ImageLayer[]>([]);
  const [stackDropEdge, setStackDropEdge] = useState<StackDropEdge | null>(null);
  const [isStackDragging, setIsStackDragging] = useState(false);

  const [currentPath, setCurrentPath] = useState(path);
  if (currentPath !== path) {
    setCurrentPath(path);
    setLayers([]);
  }

  const pathRef = useRef(path);
  const hadDataOnPathChange = useRef(!!data);

  if (pathRef.current !== path) {
    pathRef.current = path;
    hadDataOnPathChange.current = !!data;
  }

  const { baseName, isVirtualCopy } = useMemo(() => {
    return getDisplayFilename(path);
  }, [path]);
  const fileTypeLabel = useMemo(() => getFileTypeBadgeLabel(path, isRaw), [isRaw, path]);

  const { shutter, fNumber, iso, focal } = useMemo(() => {
    const e = exif || {};
    let fNum = e.FNumber ? String(e.FNumber) : '';
    if (fNum && !fNum.toLowerCase().startsWith('f')) fNum = `f/${fNum}`;
    return {
      shutter: e.ExposureTime || '',
      fNumber: fNum,
      iso: e.PhotographicSensitivity || e.ISOSpeedRatings || '',
      focal: e.FocalLengthIn35mmFilm || e.FocalLength || '',
    };
  }, [exif]);

  const showExifCols = exifOverlay !== ExifOverlay.Off;
  const totalBase =
    columnWidths.thumbnail +
    columnWidths.name +
    columnWidths.date +
    columnWidths.rating +
    columnWidths.color +
    (showExifCols ? columnWidths.shutter + columnWidths.aperture + columnWidths.iso + columnWidths.focal : 0);
  const getW = (key: keyof ColumnWidths) => `${(columnWidths[key] / totalBase) * 100}%`;

  useEffect(() => {
    if (data) {
      setShowPlaceholder(false);
      return;
    }
    const timer = setTimeout(() => {
      setShowPlaceholder(true);
    }, 500);
    return () => clearTimeout(timer);
  }, [data]);

  useEffect(() => {
    if (!data) {
      setLayers([]);
      return;
    }

    setLayers((prev) => {
      if (prev.some((l) => l.id === data)) return prev;

      if (prev.length === 0) {
        if (hadDataOnPathChange.current) {
          return [{ id: data, url: data, opacity: 1 }];
        } else {
          return [{ id: data, url: data, opacity: 0 }];
        }
      }

      return [...prev, { id: data, url: data, opacity: 0 }];
    });
  }, [data, path]);

  useEffect(() => {
    const layerToFadeIn = layers.find((l) => l.opacity === 0);
    if (layerToFadeIn) {
      const frame = requestAnimationFrame(() => {
        setLayers((prev) => prev.map((l) => (l.id === layerToFadeIn.id ? { ...l, opacity: 1 } : l)));
      });
      return () => cancelAnimationFrame(frame);
    }
  }, [layers]);

  const handleTransitionEnd = useCallback((finishedId: string) => {
    setLayers((prev) => {
      const finishedIndex = prev.findIndex((l) => l.id === finishedId);
      if (finishedIndex < 0 || prev.length <= 1) return prev;
      return prev.slice(finishedIndex);
    });
  }, []);

  const colorTag = tags?.find((t: string) => t.startsWith('color:'))?.substring(6);
  const colorLabel = COLOR_LABELS.find((c: Color) => c.name === colorTag);
  const imageFlag = getImageFlag(tags);

  const dateObj = new Date(modified > 1e11 ? modified : modified * 1000);
  const dateStr =
    dateObj.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) +
    ' ' +
    dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  let roundingClass = 'rounded-md';
  if (isSelected || isActive) {
    if (isPrevSelected && isNextSelected) {
      roundingClass = 'rounded-none';
    } else if (isPrevSelected) {
      roundingClass = 'rounded-b-md';
    } else if (isNextSelected) {
      roundingClass = 'rounded-t-md';
    }
  }

  const borderClass =
    (isSelected || isActive) && isNextSelected ? 'border-b border-transparent' : 'border-b border-border-color/30';

  const stateClass = isActive
    ? `ring-1 ring-inset ring-accent bg-accent/10 ${roundingClass}`
    : isSelected
      ? `ring-1 ring-inset ring-accent/50 bg-accent/5 ${roundingClass}`
      : 'hover:bg-surface/80 hover:rounded-md';

  return (
    <div
      className={clsx(
        `flex items-center w-full h-full cursor-pointer transition-all duration-150 ${borderClass} ${roundingClass} ${stateClass}`,
        'relative',
        isStackDragging && 'opacity-50',
      )}
      draggable
      onClick={(e: any) => {
        e.stopPropagation();
        onImageClick(path, e);
      }}
      onContextMenu={(e: any) => onContextMenu(e, path)}
      onDoubleClick={() => onImageDoubleClick(path)}
      onDragStart={(event) => {
        onFileDragStart(path, event);
        if (isStackDraggable) {
          setIsStackDragging(true);
          onStackDragStart(path, event);
        }
      }}
      onDragOver={(event) => {
        const edge = onStackDragOver(path, event, 'vertical');
        setStackDropEdge(edge);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setStackDropEdge(null);
      }}
      onDrop={(event) => {
        setStackDropEdge(null);
        onStackDrop(path, event, 'vertical');
      }}
      onDragEnd={() => {
        setIsStackDragging(false);
        setStackDropEdge(null);
        onStackDragEnd();
      }}
    >
      {stackDropEdge && (
        <div
          className={clsx(
            'absolute left-0 right-0 z-40 h-1 bg-accent pointer-events-none',
            stackDropEdge === 'before' ? 'top-0' : 'bottom-0',
          )}
        />
      )}
      <StackVisualCue info={stackVisual} />
      <div
        style={{ width: getW('thumbnail') }}
        className="flex items-center justify-center p-1.5 h-full overflow-hidden"
      >
        <div className="w-full h-full relative overflow-hidden rounded-sm bg-surface flex items-center justify-center">
          <ImageFlagBadge flag={imageFlag} className="absolute bottom-1 left-1 z-20 pointer-events-none" />
          {layers.length > 0 && (
            <div className="absolute inset-0 w-full h-full flex items-center justify-center">
              {layers.map((layer) => (
                <div
                  key={layer.id}
                  className="absolute inset-0 w-full h-full"
                  style={{ opacity: layer.opacity, transition: 'opacity 300ms ease-in-out' }}
                  onTransitionEnd={() => handleTransitionEnd(layer.id)}
                >
                  <img
                    alt={baseName}
                    className={`w-full h-full relative ${
                      thumbnailAspectRatio === ThumbnailAspectRatio.Contain ? 'object-contain' : 'object-cover'
                    }`}
                    decoding="async"
                    loading="lazy"
                    src={layer.url}
                    onLoad={() => onLoad(path)}
                  />
                </div>
              ))}
            </div>
          )}

          {layers.length === 0 &&
            showPlaceholder &&
            (isCloudPlaceholder ? (
              <div
                className="absolute inset-0 w-full h-full flex items-center justify-center"
                data-tooltip={t('library.items.cloudPlaceholder')}
              >
                <CloudOff size={14} className="text-text-secondary" />
              </div>
            ) : (
              <div className="absolute inset-0 w-full h-full flex items-center justify-center">
                <ImageIcon size={14} className="text-text-secondary animate-pulse" />
              </div>
            ))}

          {imageFlag === ImageFlag.Rejected && (
            <div className="absolute inset-0 z-10 bg-black/45 pointer-events-none" />
          )}

          {stackBadgeCount && (
            <button
              type="button"
              className={clsx(
                'absolute top-1 right-1 z-20 rounded-full text-white px-1.5 h-5 flex items-center gap-0.5 cursor-pointer focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-white',
                stackVisual?.collapsed
                  ? 'bg-black/80 hover:bg-black ring-1 ring-white/90 shadow-[0_1px_4px_rgba(0,0,0,0.9)]'
                  : 'bg-black/50 hover:bg-black/70',
              )}
              data-tooltip={stackBadgeLabel}
              onClick={(event) => {
                event.stopPropagation();
                onStackBadgeClick(path);
              }}
            >
              <Layers size={11} />
              <Text variant={TextVariants.small} color={TextColors.white}>
                {stackBadgeCount}
              </Text>
            </button>
          )}

          {isCloudPlaceholder && layers.length > 0 && (
            <div
              className="absolute top-0.5 left-0.5 z-10 rounded-full h-3.5 w-3.5 flex items-center justify-center bg-black/40 pointer-events-none"
              data-tooltip={t('library.items.cloudPlaceholder')}
            >
              <CloudOff size={9} className="text-white" />
            </div>
          )}
        </div>
      </div>

      <div style={{ width: getW('name') }} className="flex items-center gap-2 px-3 h-full overflow-hidden">
        <Text variant={TextVariants.small} className="truncate" weight={TextWeights.medium} color={TextColors.primary}>
          {baseName}
        </Text>
        {showExifCols && (
          <Text
            as="div"
            variant={TextVariants.small}
            color={TextColors.secondary}
            weight={TextWeights.bold}
            className="shrink-0 rounded-sm border border-border-color bg-bg-primary/60 px-1 py-0.5 text-[8px] leading-none tracking-wide"
          >
            {fileTypeLabel}
          </Text>
        )}
        {isVirtualCopy && (
          <Text
            as="div"
            variant={TextVariants.small}
            color={TextColors.secondary}
            weight={TextWeights.bold}
            className="shrink-0 bg-bg-primary px-1.5 py-0.5 rounded-full leading-none border border-border-color"
            data-tooltip={t('library.items.tooltipVirtualCopy')}
          >
            VC
          </Text>
        )}
      </div>

      <div style={{ width: getW('date') }} className="flex items-center px-3 h-full overflow-hidden">
        <Text variant={TextVariants.small} color={TextColors.secondary} className="truncate">
          {dateStr}
        </Text>
      </div>

      <div style={{ width: getW('rating') }} className="flex items-center px-3 h-full overflow-hidden">
        {rating > 0 && (
          <div className="flex items-center gap-1">
            <StarIcon size={12} className="text-accent fill-accent" />
            <Text variant={TextVariants.small} color={TextColors.primary} weight={TextWeights.medium}>
              {rating}
            </Text>
          </div>
        )}
      </div>

      <div style={{ width: getW('color') }} className="flex items-center px-3 h-full overflow-hidden">
        {colorLabel && (
          <div className="flex items-center gap-1.5">
            <div
              className="w-2.5 h-2.5 rounded-full shrink-0 ring-1 ring-black/20"
              style={{ backgroundColor: colorLabel.color }}
            />
            <Text variant={TextVariants.small} color={TextColors.secondary} className="truncate">
              {t(`contextMenus.colors.${colorLabel.name}`, {
                defaultValue: colorLabel.name.charAt(0).toUpperCase() + colorLabel.name.slice(1),
              })}
            </Text>
          </div>
        )}
      </div>

      {showExifCols && (
        <>
          <div style={{ width: getW('shutter') }} className="flex items-center px-3 h-full overflow-hidden">
            <Text variant={TextVariants.small} color={TextColors.secondary} className="truncate">
              {shutter}
            </Text>
          </div>
          <div style={{ width: getW('aperture') }} className="flex items-center px-3 h-full overflow-hidden">
            <Text variant={TextVariants.small} color={TextColors.secondary} className="truncate">
              {fNumber}
            </Text>
          </div>
          <div style={{ width: getW('iso') }} className="flex items-center px-3 h-full overflow-hidden">
            <Text variant={TextVariants.small} color={TextColors.secondary} className="truncate">
              {iso}
            </Text>
          </div>
          <div style={{ width: getW('focal') }} className="flex items-center px-3 h-full overflow-hidden">
            <Text variant={TextVariants.small} color={TextColors.secondary} className="truncate">
              {focal ? (String(focal).endsWith('mm') ? focal : `${focal}mm`) : ''}
            </Text>
          </div>
        </>
      )}
    </div>
  );
};

export const Thumbnail = React.memo(ThumbnailComponent);
export const ListItem = React.memo(ListItemComponent);

const RowComponent = ({
  index,
  style,
  rows,
  activePath,
  multiSelectedSet,
  onContextMenu,
  onImageClick,
  onImageDoubleClick,
  thumbnailAspectRatio,
  onImageLoad,
  imageRatings,
  baseFolderPath,
  itemWidth,
  itemHeight,
  outerPadding,
  gap,
  isListView,
  columnWidths,
  queueThumbnailRequest,
  onToggleRecursiveFolder,
  groupBadgeInfo,
}: any) => {
  const { t } = useTranslation();
  const row = rows[index];
  const handleStackBadgeClick = useCallback((path: string) => {
    const { appSettings, handleSettingsChange } = useSettingsStore.getState();
    if (!appSettings) return;

    const targetStack = appSettings.imageStacks?.find((stack) => stack.paths.includes(path));
    if (!targetStack) return;

    void handleSettingsChange({
      ...appSettings,
      imageStacks: appSettings.imageStacks?.map((stack) =>
        stack.id === targetStack.id ? { ...stack, collapsed: !stack.collapsed } : stack,
      ),
    });
  }, []);
  const getExpandedStackForPath = useCallback((path: string) => {
    return useSettingsStore
      .getState()
      .appSettings?.imageStacks?.find((stack) => !stack.collapsed && stack.paths.includes(path));
  }, []);
  const handleFileDragStart = useCallback(
    (path: string, event: React.DragEvent<HTMLElement>) => {
      const paths = multiSelectedSet.has(path) ? Array.from(multiSelectedSet) : [path];
      writeLibraryDragPayload(event.dataTransfer, { kind: 'files', paths });
    },
    [multiSelectedSet],
  );
  const handleStackDragStart = useCallback(
    (path: string, event: React.DragEvent<HTMLElement>) => {
      if (!getExpandedStackForPath(path)) {
        event.preventDefault();
        return;
      }
      draggedStackPath = path;
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData(STACK_DRAG_TYPE, path);
    },
    [getExpandedStackForPath],
  );
  const getStackDropEdge = useCallback(
    (
      targetPath: string,
      event: React.DragEvent<HTMLElement>,
      axis: 'horizontal' | 'vertical',
    ): StackDropEdge | null => {
      const sourcePath = draggedStackPath || event.dataTransfer.getData(STACK_DRAG_TYPE);
      if (!sourcePath || sourcePath === targetPath) return null;

      const sourceStack = getExpandedStackForPath(sourcePath);
      if (!sourceStack || !sourceStack.paths.includes(targetPath)) return null;

      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      const rect = event.currentTarget.getBoundingClientRect();
      const isAfter =
        axis === 'horizontal'
          ? event.clientX >= rect.left + rect.width / 2
          : event.clientY >= rect.top + rect.height / 2;
      return isAfter ? 'after' : 'before';
    },
    [getExpandedStackForPath],
  );
  const handleStackDrop = useCallback(
    (targetPath: string, event: React.DragEvent<HTMLElement>, axis: 'horizontal' | 'vertical') => {
      const sourcePath = draggedStackPath || event.dataTransfer.getData(STACK_DRAG_TYPE);
      const edge = getStackDropEdge(targetPath, event, axis);
      if (!sourcePath || !edge) return;

      const { appSettings, handleSettingsChange } = useSettingsStore.getState();
      const targetStack = appSettings?.imageStacks?.find(
        (stack) => !stack.collapsed && stack.paths.includes(sourcePath) && stack.paths.includes(targetPath),
      );
      if (!appSettings || !targetStack) return;

      event.preventDefault();
      event.stopPropagation();
      const reorderedPaths = reorderStackPaths(targetStack.paths, sourcePath, targetPath, edge === 'after');
      void handleSettingsChange({
        ...appSettings,
        imageStacks: appSettings.imageStacks?.map((stack) =>
          stack.id === targetStack.id ? { ...stack, paths: reorderedPaths } : stack,
        ),
      });
      draggedStackPath = null;
    },
    [getStackDropEdge],
  );
  const handleStackDragEnd = useCallback(() => {
    draggedStackPath = null;
  }, []);

  useEffect(() => {
    if (!row || row.type !== 'images') return;

    row.images.forEach((img: ImageFile) => {
      queueThumbnailRequest(img.path);
    });

    const cloudPaths = row.images
      .filter((img: ImageFile) => img.is_cloud_placeholder)
      .map((img: ImageFile) => img.path);
    if (cloudPaths.length === 0) return;

    const interval = setInterval(() => {
      cloudPaths.forEach((path: string) => queueThumbnailRequest(path));
    }, 5000);

    return () => clearInterval(interval);
  }, [row, queueThumbnailRequest]);

  if (row.type === 'footer') return null;
  const shiftedStyle = {
    ...style,
    transform: (style.transform as string).replace(
      /translateY\(([^)]+)\)/,
      (_: string, y: string) => `translateY(${parseFloat(y) + outerPadding}px)`,
    ),
  };

  if (row.type === 'header') {
    let displayPath = row.path;
    if (baseFolderPath && row.path.startsWith(baseFolderPath)) {
      displayPath = row.path.substring(baseFolderPath.length);
      if (displayPath.startsWith('/') || displayPath.startsWith('\\')) {
        displayPath = displayPath.substring(1);
      }
    }
    if (!displayPath) displayPath = t('library.items.currentFolder');

    return (
      <div
        style={{
          ...shiftedStyle,
          left: 0,
          width: '100%',
          paddingLeft: outerPadding === 0 ? 12 : outerPadding,
          paddingRight: outerPadding === 0 ? 12 : outerPadding,
          boxSizing: 'border-box',
        }}
        className="flex items-end pb-2 pt-2"
      >
        <div className="flex items-center gap-2 w-full border-b border-border-color/50 pb-1">
          <button
            type="button"
            className={`${TEXT_COLOR_KEYS[TextColors.secondary]} p-0.5 rounded transition-colors hover:bg-surface-hover cursor-pointer`}
            onClick={(event) => {
              event.stopPropagation();
              onToggleRecursiveFolder(row.path);
            }}
            data-tooltip={row.isExpanded ? t('library.items.collapseFolder') : t('library.items.expandFolder')}
          >
            {row.isExpanded ? <FolderOpen size={16} /> : <Folder size={16} />}
          </button>
          <Text variant={TextVariants.label} weight={TextWeights.semibold} className="truncate" data-tooltip={row.path}>
            {displayPath}
          </Text>
          <Text variant={TextVariants.small} color={TextColors.secondary} className="ml-auto">
            {t('library.items.imagesCount', { count: row.count })}
          </Text>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        ...shiftedStyle,
        left: outerPadding,
        right: outerPadding,
        width: isListView ? '100%' : 'auto',
        display: 'flex',
        gap: gap,
        paddingLeft: isListView ? '8px' : '0px',
        paddingRight: isListView ? '8px' : '0px',
        boxSizing: 'border-box',
      }}
    >
      {row.images.map((imageFile: ImageFile) => {
        const stackBadge = groupBadgeInfo?.get(imageFile.path);
        const isStackDraggable = Boolean(getExpandedStackForPath(imageFile.path));
        let isPrevSelected = false;
        let isNextSelected = false;

        if (isListView) {
          const prevRow = index > 0 ? rows[index - 1] : null;
          const nextRow = index < rows.length - 1 ? rows[index + 1] : null;

          if (prevRow && prevRow.type === 'images' && prevRow.images.length > 0) {
            isPrevSelected = multiSelectedSet.has(prevRow.images[0].path);
          }
          if (nextRow && nextRow.type === 'images' && nextRow.images.length > 0) {
            isNextSelected = multiSelectedSet.has(nextRow.images[0].path);
          }
        }

        return (
          <div
            key={imageFile.path}
            style={{
              width: isListView ? '100%' : itemWidth,
              height: itemHeight,
            }}
          >
            {isListView ? (
              <ListItem
                isActive={activePath === imageFile.path}
                isSelected={multiSelectedSet.has(imageFile.path)}
                onContextMenu={onContextMenu}
                onImageClick={onImageClick}
                onImageDoubleClick={onImageDoubleClick}
                onLoad={onImageLoad}
                path={imageFile.path}
                rating={imageRatings?.[imageFile.path] || 0}
                tags={imageFile.tags}
                exif={imageFile.exif}
                aspectRatio={thumbnailAspectRatio}
                modified={imageFile.modified}
                columnWidths={columnWidths}
                isCloudPlaceholder={imageFile.is_cloud_placeholder}
                isRaw={imageFile.is_raw}
                isPrevSelected={isPrevSelected}
                isNextSelected={isNextSelected}
                stackBadgeLabel={stackBadge?.label}
                stackBadgeCount={stackBadge?.count}
                stackVisual={stackBadge?.stackVisual}
                onStackBadgeClick={handleStackBadgeClick}
                isStackDraggable={isStackDraggable}
                onStackDragStart={handleStackDragStart}
                onStackDragOver={getStackDropEdge}
                onStackDrop={handleStackDrop}
                onStackDragEnd={handleStackDragEnd}
                onFileDragStart={handleFileDragStart}
              />
            ) : (
              <Thumbnail
                isActive={activePath === imageFile.path}
                isSelected={multiSelectedSet.has(imageFile.path)}
                onContextMenu={onContextMenu}
                onImageClick={onImageClick}
                onImageDoubleClick={onImageDoubleClick}
                onLoad={onImageLoad}
                path={imageFile.path}
                rating={imageRatings?.[imageFile.path] || 0}
                tags={imageFile.tags}
                exif={imageFile.exif}
                isEdited={imageFile.is_edited}
                aspectRatio={thumbnailAspectRatio}
                isCloudPlaceholder={imageFile.is_cloud_placeholder}
                isRaw={imageFile.is_raw}
                groupBadgeLabel={
                  stackBadge?.label || (imageFile.group_id && groupBadgeInfo?.get(imageFile.group_id)?.label)
                }
                groupBadgeCount={stackBadge?.count}
                stackVisual={stackBadge?.stackVisual}
                onStackBadgeClick={handleStackBadgeClick}
                isStackDraggable={isStackDraggable}
                onStackDragStart={handleStackDragStart}
                onStackDragOver={getStackDropEdge}
                onStackDrop={handleStackDrop}
                onStackDragEnd={handleStackDragEnd}
                onFileDragStart={handleFileDragStart}
              />
            )}
          </div>
        );
      })}
    </div>
  );
};

export const Row = React.memo(RowComponent);
