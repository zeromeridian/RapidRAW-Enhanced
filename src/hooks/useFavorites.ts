import { useCallback, useMemo } from 'react';
import { Star } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ParseKeys } from 'i18next';
import { useShallow } from 'zustand/react/shallow';
import { useSettingsStore } from '../store/useSettingsStore';
import { ADJUSTMENT_TOOLS_BY_ID, withAdjustmentLayout } from '../utils/adjustments';
import { Favorite, favoriteKey, getFavorites, parseFavorite, withFavoriteToggled } from '../utils/adjustmentControls';
import { FAVORITE_DATA_ATTRIBUTE } from '../components/adjustments/AdjustmentTool';
import { useControlLabel } from './useControlLabel';

/** The photo's Favorites: the saved list, their labels, and adding, removing and reordering them. */
export function useFavorites() {
  const { t } = useTranslation();
  const { appSettings, handleSettingsChange } = useSettingsStore(
    useShallow((state) => ({ appSettings: state.appSettings, handleSettingsChange: state.handleSettingsChange })),
  );
  const favorites = useMemo(() => getFavorites(appSettings?.adjustmentLayout), [appSettings?.adjustmentLayout]);

  const { controlLabel, sectionLabel } = useControlLabel();

  const getLabel = useCallback(
    (favorite: Favorite): string => {
      if (favorite.kind === 'section') return sectionLabel(favorite.id);
      if (favorite.kind === 'tool') return t(ADJUSTMENT_TOOLS_BY_ID[favorite.id].label as ParseKeys);
      return controlLabel(favorite.id);
    },
    [t, controlLabel, sectionLabel],
  );

  const toggleFavorite = useCallback(
    (key: string) => {
      if (appSettings) handleSettingsChange(withFavoriteToggled(appSettings, key));
    },
    [appSettings, handleSettingsChange],
  );

  const reorderFavorites = useCallback(
    (order: string[]) => {
      if (appSettings) handleSettingsChange(withAdjustmentLayout(appSettings, { favorites: order }));
    },
    [appSettings, handleSettingsChange],
  );

  /** Context-menu entries for the slider, tool and section a right-click inside `section` hit. */
  const getFavoriteMenuOptions = useCallback(
    (target: EventTarget | null, section: string) => {
      const element = target instanceof Element ? target : null;
      const closestKey = (kind: string) =>
        element?.closest(`[${FAVORITE_DATA_ATTRIBUTE}^="${kind}:"]`)?.getAttribute(FAVORITE_DATA_ATTRIBUTE);
      const keys = [closestKey('control'), closestKey('tool'), favoriteKey('section', section)];
      const saved = appSettings?.adjustmentLayout?.favorites ?? [];
      return keys
        .map((key) => (key ? parseFavorite(key) : null))
        .filter((favorite): favorite is Favorite => favorite !== null)
        .map((favorite) => ({
          label: t(saved.includes(favorite.key) ? 'editor.favorites.removeItem' : 'editor.favorites.addItem', {
            name: getLabel(favorite),
          }),
          icon: Star,
          onClick: () => toggleFavorite(favorite.key),
        }));
    },
    [appSettings?.adjustmentLayout?.favorites, getLabel, t, toggleFavorite],
  );

  return { favorites, getLabel, toggleFavorite, reorderFavorites, getFavoriteMenuOptions };
}
