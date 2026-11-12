import { useMemo } from 'react';
import { Reorder, useDragControls } from 'framer-motion';
import { GripVertical } from 'lucide-react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import PanelHeader from '../../ui/PanelHeader';
import Text from '../../ui/Text';
import { TextVariants, TextWeights } from '../../../types/typography';
import { INITIAL_ADJUSTMENTS, SectionVisibility } from '../../../utils/adjustments';
import { Favorite } from '../../../utils/adjustmentControls';
import { ADJUSTMENT_SECTION_COMPONENTS } from '../../adjustments/sectionComponents';
import AdjustmentSlider from '../../adjustments/AdjustmentSlider';
import { AdjustmentPanelContext, FavoriteStar } from '../../adjustments/AdjustmentTool';
import { useAdjustmentSectionProps } from '../../../hooks/useAdjustmentSectionProps';
import { useFavorites } from '../../../hooks/useFavorites';
import { useReorderableList } from '../../../hooks/useReorderableList';

const FAVORITES_PANEL_CONTEXT = { canFavorite: true };

type SectionProps = ReturnType<typeof useAdjustmentSectionProps>;

interface FavoriteRowProps {
  favorite: Favorite;
  label: string;
  onDragEnd(): void;
  sectionProps: SectionProps;
}

function FavoriteContent({ favorite, label, sectionProps }: Omit<FavoriteRowProps, 'onDragEnd'>) {
  const SectionComponent = ADJUSTMENT_SECTION_COMPONENTS[favorite.section];

  if (favorite.kind === 'control') {
    return (
      <div className="p-2 compact:p-1.5 bg-bg-tertiary rounded-md">
        <AdjustmentSlider
          adjustments={sectionProps.adjustments}
          control={favorite.id}
          label={label}
          onDragStateChange={sectionProps.onDragStateChange}
          setAdjustments={sectionProps.setAdjustments}
        />
      </div>
    );
  }

  if (favorite.kind === 'tool') {
    return (
      <AdjustmentPanelContext.Provider value={{ canFavorite: true, onlyTool: favorite.id }}>
        <SectionComponent {...sectionProps} />
      </AdjustmentPanelContext.Provider>
    );
  }

  return (
    <div className="bg-surface rounded-lg compact:rounded-none px-4 pt-3 pb-4 compact:px-3 compact:pt-1 compact:pb-2.5">
      <div className="group/favorite flex items-center gap-1 mb-2 compact:mb-1 min-h-7 compact:min-h-6">
        <Text
          variant={TextVariants.title}
          weight={TextWeights.normal}
          className="compact:text-[17px] compact:font-medium"
        >
          {label}
        </Text>
        <FavoriteStar favorite={favorite.key} />
      </div>
      <SectionComponent {...sectionProps} />
    </div>
  );
}

function FavoriteRow({ favorite, label, onDragEnd, sectionProps }: FavoriteRowProps) {
  const { t } = useTranslation();
  const dragControls = useDragControls();
  const sectionVisibility: SectionVisibility =
    sectionProps.adjustments.sectionVisibility || INITIAL_ADJUSTMENTS.sectionVisibility;
  // A section switched off with its eye in Adjustments has no effect; its favorites show that.
  const isSectionOn = sectionVisibility[favorite.section as keyof SectionVisibility] !== false;

  return (
    <Reorder.Item
      as="div"
      className="group/row flex items-start gap-0.5"
      dragControls={dragControls}
      dragListener={false}
      layout="position"
      onDragEnd={onDragEnd}
      transition={{ duration: 0 }}
      value={favorite.key}
    >
      <button
        className="mt-2 compact:mt-1.5 p-0.5 rounded-sm shrink-0 text-text-secondary hover:text-text-primary cursor-grab active:cursor-grabbing touch-none opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100 transition-opacity"
        onPointerDown={(e) => dragControls.start(e)}
        data-tooltip={t('editor.favorites.dragToReorder')}
      >
        <GripVertical size={14} />
      </button>
      <div className={clsx('grow min-w-0 transition-opacity', !isSectionOn && 'opacity-30')}>
        <FavoriteContent favorite={favorite} label={label} sectionProps={sectionProps} />
      </div>
    </Reorder.Item>
  );
}

/** The photo's starred sections, tools and sliders, in the order the user drags them into. */
export default function FavoritesPanel() {
  const { t } = useTranslation();
  const sectionProps = useAdjustmentSectionProps();
  const { favorites, getLabel, reorderFavorites } = useFavorites();
  const favoritesByKey = Object.fromEntries(favorites.map((favorite) => [favorite.key, favorite]));
  const savedOrder = useMemo(() => favorites.map((favorite) => favorite.key), [favorites]);
  const list = useReorderableList(savedOrder, reorderFavorites);

  return (
    <div className="flex flex-col h-full">
      <PanelHeader title={t('editor.favorites.title')} />
      <AdjustmentPanelContext.Provider value={FAVORITES_PANEL_CONTEXT}>
        <div className="grow overflow-y-auto p-4 compact:p-1.5">
          {favorites.length === 0 ? (
            <Text variant={TextVariants.small} className="block text-center text-text-secondary px-4 py-8">
              {t('editor.favorites.empty')}
            </Text>
          ) : (
            <Reorder.Group
              as="div"
              axis="y"
              className="flex flex-col gap-2 compact:gap-1.5"
              onReorder={list.handleReorder}
              values={list.order}
            >
              {list.order
                .filter((key) => favoritesByKey[key])
                .map((key) => (
                  <FavoriteRow
                    favorite={favoritesByKey[key]}
                    key={key}
                    label={getLabel(favoritesByKey[key])}
                    onDragEnd={list.handleDragEnd}
                    sectionProps={sectionProps}
                  />
                ))}
            </Reorder.Group>
          )}
        </div>
      </AdjustmentPanelContext.Provider>
    </div>
  );
}
