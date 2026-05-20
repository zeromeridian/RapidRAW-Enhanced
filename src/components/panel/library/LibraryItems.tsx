import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Image as ImageIcon, Folder, FolderOpen, Star as StarIcon } from 'lucide-react';
import clsx from 'clsx';
import { COLOR_LABELS, Color } from '../../../utils/adjustments';
import { ThumbnailAspectRatio, ImageFile, ExifOverlay } from '../../ui/AppProperties';
import Text from '../../ui/Text';
import { TextColors, TextVariants, TextWeights, TEXT_COLOR_KEYS } from '../../../types/typography';
import { ColumnWidths } from '../MainLibrary';
import { useProcessStore } from '../../../store/useProcessStore';
import { useSettingsStore } from '../../../store/useSettingsStore';
import { IconAperture, IconFocalLength, IconIso, IconShutter } from '../editor/ExifIcons';

interface ImageLayer {
  id: string;
  url: string;
  opacity: number;
}

const ThumbnailComponent = ({
  isActive,
  isSelected,
  onContextMenu,
  onImageClick,
  onImageDoubleClick,
  onLoad,
  path,
  rating,
  tags,
  aspectRatio: thumbnailAspectRatio,
  exif,
}: any) => {
  const data = useProcessStore((s) => s.thumbnails[path]);
  const exifOverlay = useSettingsStore((s) => s.appSettings?.exifOverlay || ExifOverlay.Off);

  const [showPlaceholder, setShowPlaceholder] = useState(false);
  const [layers, setLayers] = useState<ImageLayer[]>([]);
  const latestThumbDataRef = useRef<string | undefined>(undefined);

  const { baseName, isVirtualCopy } = useMemo(() => {
    const fullFileName = path.split(/[\\/]/).pop() || '';
    const parts = fullFileName.split('?vc=');
    return {
      baseName: parts[0],
      isVirtualCopy: parts.length > 1,
    };
  }, [path]);

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
      latestThumbDataRef.current = undefined;
      return;
    }

    if (data !== latestThumbDataRef.current) {
      latestThumbDataRef.current = data;

      setLayers((prev) => {
        if (prev.some((l) => l.id === data)) {
          return prev;
        }
        return [...prev, { id: data, url: data, opacity: 0 }];
      });
    }
  }, [data]);

  useEffect(() => {
    const layerToFadeIn = layers.find((l) => l.opacity === 0);
    if (layerToFadeIn) {
      const timer = setTimeout(() => {
        setLayers((prev) => prev.map((l) => (l.id === layerToFadeIn.id ? { ...l, opacity: 1 } : l)));
        onLoad();
      }, 10);

      return () => clearTimeout(timer);
    }
  }, [layers, onLoad]);

  const handleTransitionEnd = useCallback((finishedId: string) => {
    setLayers((prev) => {
      const finishedIndex = prev.findIndex((l) => l.id === finishedId);
      if (finishedIndex < 0 || prev.length <= 1) {
        return prev;
      }
      return prev.slice(finishedIndex);
    });
  }, []);

  const ringClass = isActive
    ? 'ring-2 ring-inset ring-accent'
    : isSelected
      ? 'ring-2 ring-inset ring-gray-400'
      : 'group-hover:ring-2 group-hover:ring-inset group-hover:ring-hover-color';

  const colorTag = tags?.find((t: string) => t.startsWith('color:'))?.substring(6);
  const colorLabel = COLOR_LABELS.find((c: Color) => c.name === colorTag);

  const isAlways = exifOverlay === ExifOverlay.Always;
  const isHover = exifOverlay === ExifOverlay.Hover;
  const isOff = exifOverlay === ExifOverlay.Off;

  return (
    <div
      className="aspect-square bg-surface rounded-md overflow-hidden cursor-pointer group relative transition-all duration-150 transform-gpu [-webkit-mask-image:-webkit-radial-gradient(white,black)]"
      onClick={(e: any) => {
        e.stopPropagation();
        onImageClick(path, e);
      }}
      onContextMenu={(e: any) => onContextMenu(e, path)}
      onDoubleClick={() => onImageDoubleClick(path)}
    >
      {layers.length > 0 && (
        <div
          className={clsx(
            'absolute top-0 left-0 right-0 transition-all duration-300',
            isAlways ? 'bottom-[58px]' : 'bottom-0',
          )}
        >
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
                className={`w-full h-full group-hover:scale-[1.02] transition-transform duration-300 ${
                  thumbnailAspectRatio === ThumbnailAspectRatio.Contain ? 'object-contain' : 'object-cover'
                } relative`}
                decoding="async"
                loading="lazy"
                src={layer.url}
              />
            </div>
          ))}
        </div>
      )}

      <AnimatePresence>
        {layers.length === 0 && showPlaceholder && (
          <motion.div
            className={clsx(
              'absolute top-0 left-0 right-0 flex items-center justify-center bg-surface transition-all duration-300',
              isAlways ? 'bottom-[58px]' : 'bottom-0',
            )}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3, ease: 'easeInOut' }}
          >
            <ImageIcon className="text-text-secondary animate-pulse" />
          </motion.div>
        )}
      </AnimatePresence>

      {(colorLabel || rating > 0) && (
        <>
          <div className="absolute top-0 right-0 w-1/2 h-1/2 bg-linear-to-bl from-black/20 via-black/0 to-transparent pointer-events-none z-0" />

          <div className="absolute top-1.5 right-1.5 rounded-full px-1.5 py-0.5 flex items-center gap-1 backdrop-blur-md shadow-md">
            {colorLabel && (
              <div
                className="w-3 h-3 rounded-full ring-1 ring-black/20"
                style={{ backgroundColor: colorLabel.color }}
              />
            )}
            {rating > 0 && (
              <>
                <Text variant={TextVariants.small} color={TextColors.white}>
                  {rating}
                </Text>
                <StarIcon size={12} className="text-white fill-white" />
              </>
            )}
          </div>
        </>
      )}

      <div
        className={clsx(
          'absolute bottom-0 left-0 right-0 p-2 flex items-end justify-between transition-opacity duration-300 pointer-events-none z-10',
          'bg-linear-to-t from-black/70 to-transparent',
          isAlways ? 'opacity-0' : isHover ? 'group-hover:opacity-0' : 'opacity-100',
        )}
      >
        <Text variant={TextVariants.small} color={TextColors.white} className="truncate pr-2">
          {baseName}
        </Text>
        {isVirtualCopy && (
          <Text
            as="div"
            variant={TextVariants.small}
            color={TextColors.white}
            weight={TextWeights.bold}
            className="shrink-0 shadow-md px-1.5 py-0.5 rounded-full backdrop-blur-xs"
            data-tooltip="Virtual Copy"
          >
            VC
          </Text>
        )}
      </div>

      <div
        className={clsx(
          'absolute bottom-0 left-0 right-0 h-[58px] flex flex-col p-2 pb-1.5 transition-all duration-300 z-20 pointer-events-none opacity-100',
          'bg-surface/95 backdrop-blur-md border-t border-border-color/50',
          isOff
            ? 'translate-y-full'
            : isHover
              ? 'translate-y-full group-hover:translate-y-0 group-hover:pointer-events-auto'
              : 'translate-y-0 pointer-events-auto',
        )}
      >
        <div className="flex items-end justify-between">
          <Text
            variant={TextVariants.small}
            weight={TextWeights.semibold}
            color={TextColors.primary}
            className="truncate pr-2"
          >
            {baseName}
          </Text>
          {isVirtualCopy && (
            <Text
              as="div"
              variant={TextVariants.small}
              color={TextColors.primary}
              weight={TextWeights.bold}
              className="shrink-0 shadow-md px-1.5 py-0.5 rounded-full bg-border-color/30"
              data-tooltip="Virtual Copy"
            >
              VC
            </Text>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-2.5 mt-1 pt-1">
          <div className="flex items-center gap-1 text-text-secondary" data-tooltip="Shutter Speed">
            <IconShutter className="w-2.5 h-2.5" />
            <Text variant={TextVariants.small} className="text-[9px] font-medium tracking-wide">
              {shutter || '-'}
            </Text>
          </div>
          <div className="flex items-center gap-1 text-text-secondary" data-tooltip="Aperture">
            <IconAperture className="w-2.5 h-2.5" />
            <Text variant={TextVariants.small} className="text-[9px] font-medium tracking-wide">
              {fNumber || '-'}
            </Text>
          </div>
          <div className="flex items-center gap-1 text-text-secondary" data-tooltip="ISO">
            <IconIso className="w-2.5 h-2.5" />
            <Text variant={TextVariants.small} className="text-[9px] font-medium tracking-wide">
              {iso || '-'}
            </Text>
          </div>
          <div className="flex items-center gap-1 text-text-secondary" data-tooltip="Focal Length">
            <IconFocalLength className="w-2.5 h-2.5" />
            <Text variant={TextVariants.small} className="text-[9px] font-medium tracking-wide">
              {focal ? (String(focal).endsWith('mm') ? focal : `${focal}mm`) : '-'}
            </Text>
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
}: any) => {
  const data = useProcessStore((s) => s.thumbnails[path]);
  const exifOverlay = useSettingsStore((s) => s.appSettings?.exifOverlay || ExifOverlay.Off);

  const [showPlaceholder, setShowPlaceholder] = useState(false);
  const [layers, setLayers] = useState<ImageLayer[]>([]);
  const latestThumbDataRef = useRef<string | undefined>(undefined);

  const { baseName, isVirtualCopy } = useMemo(() => {
    const fullFileName = path.split(/[\\/]/).pop() || '';
    const parts = fullFileName.split('?vc=');
    return {
      baseName: parts[0],
      isVirtualCopy: parts.length > 1,
    };
  }, [path]);

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
      latestThumbDataRef.current = undefined;
      return;
    }

    if (data !== latestThumbDataRef.current) {
      latestThumbDataRef.current = data;
      setLayers((prev) => {
        if (prev.some((l) => l.id === data)) return prev;
        return [...prev, { id: data, url: data, opacity: 0 }];
      });
    }
  }, [data]);

  useEffect(() => {
    const layerToFadeIn = layers.find((l) => l.opacity === 0);
    if (layerToFadeIn) {
      const timer = setTimeout(() => {
        setLayers((prev) => prev.map((l) => (l.id === layerToFadeIn.id ? { ...l, opacity: 1 } : l)));
        onLoad();
      }, 10);
      return () => clearTimeout(timer);
    }
  }, [layers, onLoad]);

  const handleTransitionEnd = useCallback((finishedId: string) => {
    setLayers((prev) => {
      const finishedIndex = prev.findIndex((l) => l.id === finishedId);
      if (finishedIndex < 0 || prev.length <= 1) return prev;
      return prev.slice(finishedIndex);
    });
  }, []);

  const colorTag = tags?.find((t: string) => t.startsWith('color:'))?.substring(6);
  const colorLabel = COLOR_LABELS.find((c: Color) => c.name === colorTag);

  const dateObj = new Date(modified > 1e11 ? modified : modified * 1000);
  const dateStr =
    dateObj.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) +
    ' ' +
    dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const stateClass = isActive
    ? 'ring-1 ring-inset ring-accent bg-accent/10'
    : isSelected
      ? 'ring-1 ring-inset ring-accent/50 bg-accent/5'
      : 'hover:bg-surface/80';

  return (
    <div
      className={`flex items-center w-full h-full border-b border-border-color/30 cursor-pointer transition-colors duration-150 ${stateClass}`}
      onClick={(e: any) => {
        e.stopPropagation();
        onImageClick(path, e);
      }}
      onContextMenu={(e: any) => onContextMenu(e, path)}
      onDoubleClick={() => onImageDoubleClick(path)}
    >
      <div
        style={{ width: getW('thumbnail') }}
        className="flex items-center justify-center p-1.5 h-full overflow-hidden"
      >
        <div className="w-full h-full relative overflow-hidden rounded-sm bg-surface flex items-center justify-center">
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
                  />
                </div>
              ))}
            </div>
          )}
          <AnimatePresence>
            {layers.length === 0 && showPlaceholder && (
              <motion.div
                className="absolute inset-0 w-full h-full flex items-center justify-center"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3, ease: 'easeInOut' }}
              >
                <ImageIcon size={14} className="text-text-secondary animate-pulse" />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <div style={{ width: getW('name') }} className="flex items-center gap-2 px-3 h-full overflow-hidden">
        <Text variant={TextVariants.small} className="truncate" weight={TextWeights.medium} color={TextColors.primary}>
          {baseName}
        </Text>
        {isVirtualCopy && (
          <Text
            as="div"
            variant={TextVariants.small}
            color={TextColors.secondary}
            weight={TextWeights.bold}
            className="shrink-0 bg-bg-primary px-1.5 py-0.5 rounded-full leading-none border border-border-color"
            data-tooltip="Virtual Copy"
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
            <Text variant={TextVariants.small} color={TextColors.secondary} className="capitalize truncate">
              {colorLabel.name}
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
  multiSelectedPaths,
  onContextMenu,
  onImageClick,
  onImageDoubleClick,
  thumbnailAspectRatio,
  loadedThumbnails,
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
}: any) => {
  const row = rows[index];

  useEffect(() => {
    if (row && row.type === 'images') {
      row.images.forEach((img: ImageFile) => {
        queueThumbnailRequest(img.path);
      });
    }
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
    if (!displayPath) displayPath = 'Current Folder';

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
            data-tooltip={row.isExpanded ? 'Collapse Folder' : 'Expand Folder'}
          >
            {row.isExpanded ? <FolderOpen size={16} /> : <Folder size={16} />}
          </button>
          <Text variant={TextVariants.label} weight={TextWeights.semibold} className="truncate" data-tooltip={row.path}>
            {displayPath}
          </Text>
          <Text variant={TextVariants.small} color={TextColors.secondary} className="ml-auto">
            {row.count} images
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
      }}
    >
      {row.images.map((imageFile: ImageFile) => (
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
              isSelected={multiSelectedPaths.includes(imageFile.path)}
              onContextMenu={onContextMenu}
              onImageClick={onImageClick}
              onImageDoubleClick={onImageDoubleClick}
              onLoad={() => loadedThumbnails.add(imageFile.path)}
              path={imageFile.path}
              rating={imageRatings?.[imageFile.path] || 0}
              tags={imageFile.tags || []}
              exif={imageFile.exif}
              aspectRatio={thumbnailAspectRatio}
              modified={imageFile.modified}
              columnWidths={columnWidths}
            />
          ) : (
            <Thumbnail
              isActive={activePath === imageFile.path}
              isSelected={multiSelectedPaths.includes(imageFile.path)}
              onContextMenu={onContextMenu}
              onImageClick={onImageClick}
              onImageDoubleClick={onImageDoubleClick}
              onLoad={() => loadedThumbnails.add(imageFile.path)}
              path={imageFile.path}
              rating={imageRatings?.[imageFile.path] || 0}
              tags={imageFile.tags || []}
              exif={imageFile.exif}
              aspectRatio={thumbnailAspectRatio}
            />
          )}
        </div>
      ))}
    </div>
  );
};

function rowAreEqual(prev: any, next: any) {
  if (
    prev.index !== next.index ||
    prev.itemWidth !== next.itemWidth ||
    prev.isListView !== next.isListView ||
    prev.columnWidths !== next.columnWidths
  )
    return false;

  const prevRow = prev.rows[prev.index];
  const nextRow = next.rows[next.index];

  if (!prevRow || !nextRow || prevRow.type !== nextRow.type) return false;

  if (prevRow.type === 'images') {
    if (prevRow.images.length !== nextRow.images.length) return false;
    for (let i = 0; i < nextRow.images.length; i++) {
      if (prevRow.images[i] !== nextRow.images[i]) return false;
      if (prevRow.images[i].path !== nextRow.images[i].path) return false;
      const path = nextRow.images[i].path;
      if ((prev.activePath === path) !== (next.activePath === path)) return false;
      if (prev.multiSelectedPaths.includes(path) !== next.multiSelectedPaths.includes(path)) return false;
      if (prev.imageRatings?.[path] !== next.imageRatings?.[path]) return false;
    }
  } else if (prevRow.type === 'header') {
    if (prevRow.isExpanded !== nextRow.isExpanded || prevRow.count !== nextRow.count) return false;
  }
  return true;
}

export const Row = React.memo(RowComponent, rowAreEqual);
