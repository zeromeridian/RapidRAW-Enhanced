import { useEffect, useRef } from 'react';
import { Image as ImageIcon, Star } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export default function Filmstrip({ 
  imageList, 
  selectedImage, 
  onImageSelect, 
  onContextMenu,
  thumbnails,
  multiSelectedPaths,
  imageRatings,
  onClearSelection,
}) {
  const filmstripRef = useRef(null);

  useEffect(() => {
    const element = filmstripRef.current;
    if (!element) return;

    const onWheel = (e) => {
      e.preventDefault();
      element.scrollLeft += e.deltaY;
    };

    element.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      element.removeEventListener('wheel', onWheel);
    };
  }, []);

  useEffect(() => {
    if (selectedImage && filmstripRef.current) {
      const selectedIndex = imageList.findIndex(img => img.path === selectedImage.path);

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
    <div 
      ref={filmstripRef} 
      className="h-full overflow-x-auto overflow-y-hidden p-1"
      onClick={onClearSelection}
    >
      <motion.div className="flex h-full gap-2">
        <AnimatePresence>
          {imageList.map((imageFile) => {
            const path = imageFile.path;
            const isActive = selectedImage?.path === path;
            const isSelected = multiSelectedPaths.includes(path);
            const thumbData = thumbnails[path];
            const rating = imageRatings?.[path] || 0;
            
            const ringClass = isActive
              ? 'ring-2 ring-accent'
              : isSelected
              ? 'ring-2 ring-gray-400'
              : 'hover:ring-2 hover:ring-hover-color';

            return (
              <motion.div
                key={path}
                layout
                onClick={(e) => {
                  e.stopPropagation();
                  onImageSelect(path, e);
                }}
                onContextMenu={(e) => onContextMenu(e, path)}
                className={`h-full aspect-square rounded-md overflow-hidden cursor-pointer flex-shrink-0 group relative transition-all duration-150 ${ringClass}`}
                data-path={path}
                style={{ zIndex: isActive ? 2 : isSelected ? 1 : 'auto' }}
              >
                {thumbData ? (
                  <img
                    src={thumbData}
                    alt={path.split(/[\\/]/).pop()}
                    className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-300"
                    loading="lazy"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-surface">
                    <ImageIcon size={24} className="text-text-secondary animate-pulse" />
                  </div>
                )}
                {rating > 0 && (
                  <div className="absolute top-1 right-1 bg-primary rounded-full px-1.5 py-0.5 text-xs text-white flex items-center gap-1 backdrop-blur-sm">
                    <span>{rating}</span>
                    <Star size={10} className="fill-white text-white" />
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