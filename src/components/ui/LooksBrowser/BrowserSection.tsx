import { ReactNode, Ref } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronRight } from 'lucide-react';
import clsx from 'clsx';

interface BrowserSectionProps {
  title: string;
  count: number;
  isOpen: boolean;
  onToggle(): void;
  children: ReactNode;
  /** Before the title: a group's folder icon (the presets' drag handle) or the Favorites star. */
  icon?: ReactNode;
  onContextMenu?(event: React.MouseEvent): void;
  /** Highlights the section while something can be dropped on it. */
  isDropTarget?: boolean;
  /** The drop target (presets' drag and drop). */
  containerRef?: Ref<HTMLDivElement>;
}

/** A collapsible group of a Looks browser: Favorites, a group, or No Group. */
export default function BrowserSection({
  title,
  count,
  isOpen,
  onToggle,
  children,
  icon,
  onContextMenu,
  isDropTarget = false,
  containerRef,
}: BrowserSectionProps) {
  return (
    <div ref={containerRef} className={clsx('rounded-lg transition-colors', isDropTarget && 'bg-surface-hover')}>
      <div
        className="flex items-center gap-1.5 px-1 py-1 rounded-md cursor-pointer select-none text-text-secondary hover:text-text-primary"
        onClick={onToggle}
        onContextMenu={onContextMenu}
      >
        <ChevronRight size={14} className={clsx('shrink-0 transition-transform duration-200', isOpen && 'rotate-90')} />
        {icon}
        <span className="grow truncate text-xs font-medium uppercase tracking-wider">{title}</span>
        <span className="text-xs pr-1">{count}</span>
      </div>
      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            animate={{ height: 'auto', opacity: 1 }}
            className="overflow-hidden"
            exit={{ height: 0, opacity: 0 }}
            initial={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeInOut' }}
          >
            <div className="pt-1 pb-2">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
