import { useRef, useEffect, useState } from 'react';
import { ChevronDown, Eye, EyeOff } from 'lucide-react';
import clsx from 'clsx';

export default function CollapsibleSection({
  title,
  children,
  isOpen,
  onToggle,
  onContextMenu,
  isContentVisible,
  onToggleVisibility,
  canToggleVisibility = true,
}) {
  const contentRef = useRef(null);
  const wrapperRef = useRef(null);
  const [isHovering, setIsHovering] = useState(false);
  const hoverTimeoutRef = useRef(null);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    const content = contentRef.current;
    if (!wrapper || !content) return;

    const updateMaxHeight = () => {
      if (isOpen) {
        const contentHeight = content.scrollHeight;
        wrapper.style.maxHeight = `${contentHeight}px`;
      } else {
        wrapper.style.maxHeight = '0px';
      }
    };

    updateMaxHeight();

    const resizeObserver = new ResizeObserver(updateMaxHeight);
    resizeObserver.observe(content);

    return () => resizeObserver.disconnect();

  }, [isOpen]);

  const handleMouseEnter = () => {
    if (!canToggleVisibility) return;
    hoverTimeoutRef.current = setTimeout(() => {
      setIsHovering(true);
    }, 1000);
  };

  const handleMouseLeave = () => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
    setIsHovering(false);
  };

  const handleVisibilityClick = (e) => {
    e.stopPropagation();
    if (onToggleVisibility) {
      onToggleVisibility();
    }
  };

  return (
    <div
      className="bg-surface rounded-lg overflow-hidden flex-shrink-0"
      onContextMenu={onContextMenu}
    >
      <button
        onClick={onToggle}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-card-active transition-colors duration-200"
      >
        <div className="flex items-center gap-2">
          <h3 className="text-lg font-normal text-primary text-shadow-shiny">{title}</h3>
          {canToggleVisibility && (
            <div className="w-6 h-6 flex items-center justify-center">
              <button
                onClick={handleVisibilityClick}
                className={clsx(
                  'p-1 rounded-full text-text-secondary hover:bg-bg-primary z-10 transition-opacity duration-300',
                  (isHovering || !isContentVisible)
                    ? 'opacity-100'
                    : 'opacity-0 pointer-events-none'
                )}
                title={isContentVisible ? 'Preview disabled section' : 'Enable section'}
              >
                {isContentVisible ? <Eye size={16} /> : <EyeOff size={16} />}
              </button>
            </div>
          )}
        </div>
        <ChevronDown
          size={20}
          className={clsx('text-accent transition-transform duration-300', { 'rotate-180': isOpen })}
        />
      </button>
      <div
        ref={wrapperRef}
        className="overflow-hidden transition-all duration-300 ease-in-out"
      >
        <div ref={contentRef} className={clsx(
          "px-4 pb-4 transition-opacity duration-300",
          !isContentVisible && "opacity-30 pointer-events-none"
        )}>
          {children}
        </div>
      </div>
    </div>
  );
}