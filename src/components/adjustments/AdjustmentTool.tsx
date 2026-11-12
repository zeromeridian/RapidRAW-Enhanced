import { createContext, ReactNode, useContext } from 'react';
import { Star } from 'lucide-react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import type { ParseKeys } from 'i18next';
import Text from '../ui/Text';
import { TextVariants } from '../../types/typography';
import { useSettingsStore } from '../../store/useSettingsStore';
import { ADJUSTMENT_TOOLS_BY_ID, getAdjustmentToolOrder } from '../../utils/adjustments';
import { favoriteKey, withFavoriteToggled } from '../../utils/adjustmentControls';

interface AdjustmentPanelContextValue {
  /** Sections, tools and sliders show a Favorites star (the photo's panels; masks have none). */
  canFavorite: boolean;
  /** Only this tool block is shown (a tool in the Favorites panel). */
  onlyTool?: string;
}

export const AdjustmentPanelContext = createContext<AdjustmentPanelContextValue>({ canFavorite: false });

/** `data-favorite` marks what a right-click inside it can add to Favorites. */
export const FAVORITE_DATA_ATTRIBUTE = 'data-favorite';

interface FavoriteStarProps {
  favorite: string;
}

/** A star that adds the item to Favorites or removes it; hidden until its `group/favorite` is hovered. */
export function FavoriteStar({ favorite }: FavoriteStarProps) {
  const { t } = useTranslation();
  const { canFavorite } = useContext(AdjustmentPanelContext);
  const isFavorite = useSettingsStore(
    (state) => state.appSettings?.adjustmentLayout?.favorites?.includes(favorite) ?? false,
  );
  if (!canFavorite) return null;

  return (
    <button
      aria-pressed={isFavorite}
      className={clsx(
        'p-0.5 rounded-sm shrink-0 transition-opacity duration-200 focus-visible:opacity-100',
        isFavorite
          ? 'text-accent'
          : 'text-text-secondary hover:text-text-primary opacity-0 group-hover/favorite:opacity-100',
      )}
      onClick={(e) => {
        e.stopPropagation();
        const { appSettings, handleSettingsChange } = useSettingsStore.getState();
        if (appSettings) handleSettingsChange(withFavoriteToggled(appSettings, favorite));
      }}
      data-tooltip={isFavorite ? t('editor.favorites.remove') : t('editor.favorites.add')}
    >
      <Star size={12} fill={isFavorite ? 'currentColor' : 'none'} />
    </button>
  );
}

interface AdjustmentToolProps {
  actions?: ReactNode;
  children: ReactNode;
  id: string;
  /** Overrides the heading's default label (e.g. Local Hue in masks). */
  title?: string;
  titleClassName?: string;
  /** No heading: the block is one labelled control (Black & White) and the star sits after it. */
  isUntitled?: boolean;
}

/**
 * One tool block of an adjustment section: its heading with the Favorites star, placed in the
 * Customize Panels order (the section's container must be a flex column).
 */
export default function AdjustmentTool({
  actions,
  children,
  id,
  title,
  titleClassName = 'mb-2 compact:mb-1',
  isUntitled = false,
}: AdjustmentToolProps) {
  const { t } = useTranslation();
  const { onlyTool } = useContext(AdjustmentPanelContext);
  const tool = ADJUSTMENT_TOOLS_BY_ID[id];
  const order = useSettingsStore((state) =>
    getAdjustmentToolOrder(tool.section, state.appSettings?.adjustmentLayout?.toolOrder).indexOf(id),
  );
  if (onlyTool && onlyTool !== id) return null;
  const favorite = favoriteKey('tool', id);
  const blockProps = {
    className: 'p-2 compact:p-1.5 bg-bg-tertiary rounded-md',
    style: { order },
    [FAVORITE_DATA_ATTRIBUTE]: favorite,
  };

  if (isUntitled) {
    return (
      <div {...blockProps}>
        <div className="group/favorite flex items-center gap-1">
          <div className="grow min-w-0">{children}</div>
          <FavoriteStar favorite={favorite} />
        </div>
      </div>
    );
  }

  return (
    <div {...blockProps}>
      <div className={clsx('group/favorite flex justify-between items-center', titleClassName)}>
        <div className="flex items-center gap-1 min-w-0">
          <Text variant={TextVariants.heading} className="compact:text-sm truncate">
            {title ?? t(tool.label as ParseKeys)}
          </Text>
          <FavoriteStar favorite={favorite} />
        </div>
        {actions}
      </div>
      {children}
    </div>
  );
}
