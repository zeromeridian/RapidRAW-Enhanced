import { Fragment, ReactNode, useEffect, useRef, useState } from 'react';
import { ImageOff, Star } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';

/** Columns of the grid layout. */
const GRID_COLUMNS = 3;

export interface BrowserItemProps {
  name: string;
  /** The open photo with the item applied: a URL, `null` when it failed, `undefined` while pending. */
  preview: string | null | undefined;
  isSelected: boolean;
  isFavorite: boolean;
  onToggleFavorite(): void;
  onClick(): void;
  onMouseEnter?(): void;
  onMouseLeave?(): void;
  onContextMenu?(event: React.MouseEvent): void;
  /** Small marks such as B&W or a preset's masks and crop: on the preview in the grid, after the name in the list. */
  badges?: ReactNode;
  /** The list's second line, e.g. a preset's settings count. */
  details?: ReactNode;
  tooltip?: string;
}

/** Scrolls the item into view when it appears selected, e.g. the current profile as Looks opens. */
function useRevealWhenSelected(isSelected: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const [wasSelectedAtMount] = useState(isSelected);
  useEffect(() => {
    if (wasSelectedAtMount) ref.current?.scrollIntoView({ block: 'nearest' });
  }, [wasSelectedAtMount]);
  return ref;
}

function Preview({ name, preview }: Pick<BrowserItemProps, 'name' | 'preview'>) {
  if (preview === undefined) return <div className="w-full h-full animate-pulse bg-surface" />;
  if (preview === null) {
    return (
      <div className="w-full h-full flex items-center justify-center text-text-secondary">
        <ImageOff size={18} />
      </div>
    );
  }
  return <img src={preview} alt={name} className="w-full h-full object-cover pointer-events-none" draggable={false} />;
}

function FavoriteStar({
  isFavorite,
  onToggle,
  isOnPreview,
}: {
  isFavorite: boolean;
  onToggle(): void;
  isOnPreview: boolean;
}) {
  const { t } = useTranslation();
  return (
    <button
      aria-pressed={isFavorite}
      className={clsx(
        'p-0.5 rounded-sm transition-opacity shrink-0',
        isOnPreview && 'absolute top-1 right-1 bg-black/40',
        isFavorite
          ? 'text-accent'
          : 'opacity-0 group-hover/look:opacity-100 hover:text-text-primary ' +
              (isOnPreview ? 'text-white' : 'text-text-secondary'),
      )}
      data-tooltip={isFavorite ? t('editor.favorites.remove') : t('editor.favorites.add')}
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <Star size={12} fill={isFavorite ? 'currentColor' : 'none'} />
    </button>
  );
}

/** An item of the grid layout: a square preview with the name below it. */
export function BrowserTile({
  name,
  preview,
  isSelected,
  isFavorite,
  onToggleFavorite,
  onClick,
  onMouseEnter,
  onMouseLeave,
  onContextMenu,
  badges,
  tooltip,
}: BrowserItemProps) {
  const ref = useRevealWhenSelected(isSelected);
  return (
    <div
      ref={ref}
      className={clsx(
        'group/look relative aspect-square rounded-md overflow-hidden bg-bg-primary border-2 cursor-pointer transition-colors',
        isSelected ? 'border-accent' : 'border-transparent hover:border-surface',
      )}
      data-tooltip={tooltip ?? name}
      onClick={onClick}
      onContextMenu={onContextMenu}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      role="button"
    >
      <Preview name={name} preview={preview} />
      {badges && <div className="absolute top-1 left-1 flex items-center gap-1 pointer-events-none">{badges}</div>}
      <span className="absolute inset-x-0 bottom-0 px-1 py-0.5 text-[10px] text-white bg-black/50 truncate text-left">
        {name}
      </span>
      <FavoriteStar isFavorite={isFavorite} onToggle={onToggleFavorite} isOnPreview />
    </div>
  );
}

/** An item of the list layout: a small preview, the name and its details. */
export function BrowserRow({
  name,
  preview,
  isSelected,
  isFavorite,
  onToggleFavorite,
  onClick,
  onMouseEnter,
  onMouseLeave,
  onContextMenu,
  badges,
  details,
  tooltip,
}: BrowserItemProps) {
  const ref = useRevealWhenSelected(isSelected);
  return (
    <div
      ref={ref}
      className={clsx(
        'group/look flex items-center gap-3 compact:gap-2 p-1.5 rounded-lg border-2 cursor-pointer transition-colors',
        isSelected ? 'border-accent bg-surface' : 'border-transparent bg-surface hover:bg-card-active',
      )}
      data-tooltip={tooltip}
      onClick={onClick}
      onContextMenu={onContextMenu}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      role="button"
    >
      <div className="w-20 h-14 compact:w-16 compact:h-11 rounded-md overflow-hidden bg-bg-tertiary shrink-0">
        <Preview name={name} preview={preview} />
      </div>
      <div className="grow min-w-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="truncate text-sm compact:text-xs font-medium text-text-primary">{name}</span>
          {badges}
        </div>
        {details}
      </div>
      <FavoriteStar isFavorite={isFavorite} onToggle={onToggleFavorite} isOnPreview={false} />
    </div>
  );
}

interface BrowserItemsProps<T> {
  isGrid: boolean;
  items: ReadonlyArray<T>;
  getKey(item: T): string;
  renderItem(item: T): ReactNode;
  /** The applied item, whose `activeContent` (its strength slider) shows under it, or under its row in the grid. */
  activeKey?: string | null;
  activeContent?: ReactNode;
}

/** A section's items in the grid or list layout. */
export function BrowserItems<T>({ isGrid, items, getKey, renderItem, activeKey, activeContent }: BrowserItemsProps<T>) {
  const activeIndex = activeContent ? items.findIndex((item) => getKey(item) === activeKey) : -1;
  // In the grid the slider takes a full row after the active item's row.
  const contentAfter =
    activeIndex < 0
      ? -1
      : isGrid
        ? Math.min(Math.ceil((activeIndex + 1) / GRID_COLUMNS) * GRID_COLUMNS, items.length) - 1
        : activeIndex;
  return (
    <div className={isGrid ? 'grid grid-cols-3 gap-2' : 'flex flex-col gap-1.5 compact:gap-1'}>
      {items.map((item, index) => (
        <Fragment key={getKey(item)}>
          {renderItem(item)}
          {index === contentAfter && <div className={clsx(isGrid && 'col-span-3')}>{activeContent}</div>}
        </Fragment>
      ))}
    </div>
  );
}
