import { useEffect, useRef } from 'react';
import { Image as ImageIcon, Star } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { ImageFile, SelectedImage } from '../ui/AppProperties';
import { Color, COLOR_LABELS } from '../../utils/adjustments';

interface FilmStripProps {
  imageList: Array<ImageFile>;
  imageRatings: any;
  isLoading: boolean;
  multiSelectedPaths: Array<string>;
  onClearSelection?(): void;
  onContextMenu?(event: any, path: string): void;
  onImageSelect?(path: string, event: any): void;
  selectedImage?: SelectedImage;
  thumbnails: Record<string, string> | undefined;
}

export default function Filmstrip({
  imageList,
  imageRatings,
  isLoading,
  multiSelectedPaths,
  onClearSelection,
  onContextMenu,
  onImageSelect,
  selectedImage,
  thumbnails,
}: FilmStripProps) {
  const filmstripRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = filmstripRef.current;
    if (!element) {
      return;
    }

    const onWheel = (e: any) => {
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        return;
      }
      e.preventDefault();
      element.scrollLeft += e.deltaY;
    };

    element.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      if (element) {
        element.removeEventListener('wheel', onWheel);
      }
    };
  }, []);

  useEffect(() => {
    if (selectedImage && filmstripRef.current) {
      const selectedIndex = imageList.findIndex((img: ImageFile) => img.path === selectedImage.path);

      if (selectedIndex !== -1) {
        const activeElement = filmstripRef.current.querySelector(`[data-path="${CSS.escape(selectedImage.path)}"]`);

        if (activeElement) {
          setTimeout(() => {
            activeElement.scrollIntoView({
              behavior: 'smooth',
              block: 'nearest',
              inline: 'center',
            });
          }, 320);
        }
      }
    }
  }, [selectedImage, imageList]);

  return (
    <div ref={filmstripRef} className="h-full overflow-x-auto overflow-y-hidden p-1" onClick={onClearSelection}>
      <motion.div className="flex h-full gap-2">
        <AnimatePresence>
          {imageList.map((imageFile: ImageFile) => {
            const path = imageFile.path;
            const isActive = selectedImage?.path === path;
            const isSelected = multiSelectedPaths.includes(path);
            const thumbData = thumbnails ? thumbnails[path] : undefined;
            const rating = imageRatings?.[path] || 0;
            const colorTag = imageFile.tags?.find((t: string) => t.startsWith('color:'))?.substring(6);
            const colorLabel = COLOR_LABELS.find((c: Color) => c.name === colorTag);

            const ringClass = isActive
              ? 'ring-2 ring-accent'
              : isSelected
              ? 'ring-2 ring-gray-400'
              : 'hover:ring-2 hover:ring-hover-color';

            return (
              <motion.div
                className={`h-full aspect-square rounded-md overflow-hidden cursor-pointer flex-shrink-0 group relative transition-all duration-150 ${ringClass}`}
                data-path={path}
                key={path}
                layout
                onClick={(e: any) => {
                  e.stopPropagation();
                  if (onImageSelect) {
                    onImageSelect(path, e);
                  }
                }}
                onContextMenu={(e: any) => {
                  if (onContextMenu) {
                    onContextMenu(e, path);
                  }
                }}
                style={{ zIndex: isActive ? 2 : isSelected ? 1 : 'auto' }}
              >
                {thumbData ? (
                  <img
                    alt={path.split(/[\\/]/).pop()}
                    className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-300"
                    loading="lazy"
                    src={thumbData}
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-surface">
                    <ImageIcon size={24} className="text-text-secondary animate-pulse" />
                  </div>
                )}
                {(colorLabel || rating > 0) && (
                  <div className="absolute top-1 right-1 bg-primary rounded-full px-1.5 py-0.5 text-xs text-white flex items-center gap-1 backdrop-blur-sm">
                    {colorLabel && (
                      <div
                        className="w-3 h-3 rounded-full ring-1 ring-black/20"
                        style={{ backgroundColor: colorLabel.color }}
                        title={`Color: ${colorLabel.name}`}
                      ></div>
                    )}
                    {rating > 0 && (
                      <>
                        <span>{rating}</span>
                        <Star size={10} className="fill-white text-white" />
                      </>
                    )}
                  </div>
                )}
              </motion.div>
            );
          })}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
