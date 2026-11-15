import { useMemo } from 'react';
import { Reorder, useDragControls } from 'framer-motion';
import { GripVertical } from 'lucide-react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import Text from '../../ui/Text';
import { TextVariants, TextWeights } from '../../../types/typography';
import { LENS_GEOMETRY_SECTION, getSectionEye, isGroupVisible } from '../../../utils/adjustments';
import ChromaticAberration from '../../adjustments/ChromaticAberration';
import { ADJUSTMENT_CONTROLS_BY_ID, Favorite } from '../../../utils/adjustmentControls';
import { ADJUSTMENT_SECTION_COMPONENTS } from '../../adjustments/sectionComponents';
import AdjustmentSlider from '../../adjustments/AdjustmentSlider';
import { AdjustmentPanelContext, FavoriteStar } from '../../adjustments/AdjustmentTool';
import { useAdjustmentSectionProps } from '../../../hooks/useAdjustmentSectionProps';
import { useFavorites } from '../../../hooks/useFavorites';
import { useReorderableList } from '../../../hooks/useReorderableList';

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

  if (favorite.section === LENS_GEOMETRY_SECTION) {
    return (
      <ChromaticAberration
        adjustments={sectionProps.adjustments}
        onDragStateChange={sectionProps.onDragStateChange}
        setAdjustments={sectionProps.setAdjustments}
      />
    );
  }

  if (favorite.kind === 'tool') {
    return (
      <AdjustmentPanelContext.Provider value={{ canFavorite: true, tools: [favorite.id] }}>
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
  const visibility = sectionProps.adjustments.sectionVisibility;
  // A tool switched off with its section's eye has no effect; its favorites show that. A slider
  // follows its tool's eye; a section or tool dims as a whole only when the section is off (in a
  // partly off section, the section dims its hidden tools itself).
  const control = favorite.kind === 'control' ? ADJUSTMENT_CONTROLS_BY_ID[favorite.id] : undefined;
  const isSectionOn = control
    ? isGroupVisible(visibility, control.parent)
    : getSectionEye(visibility, favorite.section) !== 'off';

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

interface FavoritesListProps {
  sectionProps: SectionProps;
}

/**
 * The Adjustments panel's Favorites view: the photo's starred sections, tools and sliders, in the
 * order the user drags them into.
 */
export default function FavoritesList({ sectionProps }: FavoritesListProps) {
  const { t } = useTranslation();
  const { favorites, getLabel, reorderFavorites } = useFavorites();
  const favoritesByKey = Object.fromEntries(favorites.map((favorite) => [favorite.key, favorite]));
  const savedOrder = useMemo(() => favorites.map((favorite) => favorite.key), [favorites]);
  const list = useReorderableList(savedOrder, reorderFavorites);

  if (favorites.length === 0) {
    return (
      <Text variant={TextVariants.small} className="block text-center text-text-secondary px-4 py-8">
        {t('editor.favorites.empty')}
      </Text>
    );
  }

  return (
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
  );
}
