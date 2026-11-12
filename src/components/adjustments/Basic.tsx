import { motion } from 'framer-motion';
import clsx from 'clsx';
import { Adjustments, BasicAdjustment, ToneMapper, getDefaultToneMapper } from '../../utils/adjustments';
import { useEditorStore } from '../../store/useEditorStore';
import { ReactNode, useEffect, useRef, useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import AdjustmentSlider from './AdjustmentSlider';

interface BasicAdjustmentsProps {
  adjustments: Adjustments;
  setAdjustments(adjustments: Partial<Adjustments>): any;
  isForMask?: boolean;
  onDragStateChange?: (isDragging: boolean) => void;
  appSettings?: any;
}

interface ToneMapperSwitchProps {
  selectedMapper: ToneMapper;
  defaultMapper: ToneMapper;
  onMapperChange: (mapper: ToneMapper) => void;
  onExposureReset(): void;
  /** The Exposure slider, shown under the mapper buttons. */
  children: ReactNode;
}

const ToneMapperSwitch = ({
  selectedMapper,
  defaultMapper,
  onMapperChange,
  onExposureReset,
  children,
}: ToneMapperSwitchProps) => {
  const { t } = useTranslation();
  const [bubbleStyle, setBubbleStyle] = useState({});
  const isInitialAnimation = useRef(true);
  const [isLabelHovered, setIsLabelHovered] = useState(false);

  const toneMapperOptions = useMemo<{ id: ToneMapper; label: string; title: string }[]>(
    () => [
      {
        id: 'natural',
        label: t('adjustments.basic.mappers.natural'),
        title: t('adjustments.basic.mappers.naturalDesc'),
      },
      {
        id: 'basic',
        label: t('adjustments.basic.mappers.basic'),
        title: t('adjustments.basic.mappers.basicDesc'),
      },
      {
        id: 'agx',
        label: t('adjustments.basic.mappers.agx'),
        title: t('adjustments.basic.mappers.agxDesc'),
      },
    ],
    [t],
  );

  const handleReset = () => {
    onMapperChange(defaultMapper);
    onExposureReset();
  };

  useEffect(() => {
    const selectedIndex = toneMapperOptions.findIndex((m) => m.id === selectedMapper);
    const safeIndex = selectedIndex >= 0 ? selectedIndex : 0;

    const widthPercent = 100 / toneMapperOptions.length;
    const targetX = `${safeIndex * 100}%`;
    const targetWidth = `${widthPercent}%`;

    if (isInitialAnimation.current) {
      const initialX = safeIndex > 0 ? `${toneMapperOptions.length * 100}%` : '-25%';

      setBubbleStyle({
        x: [initialX, targetX],
        width: targetWidth,
      });
      isInitialAnimation.current = false;
    } else {
      setBubbleStyle({
        x: targetX,
        width: targetWidth,
      });
    }
  }, [selectedMapper, toneMapperOptions]);

  return (
    <div className="group mb-3 compact:mb-1.5">
      <div className="flex justify-between items-center mb-2 compact:mb-1">
        <div
          className="grid cursor-pointer"
          onClick={handleReset}
          onDoubleClick={handleReset}
          onMouseEnter={() => setIsLabelHovered(true)}
          onMouseLeave={() => setIsLabelHovered(false)}
        >
          <span
            aria-hidden={isLabelHovered}
            className={`col-start-1 row-start-1 text-sm compact:text-xs font-medium text-text-secondary select-none transition-opacity duration-200 ease-in-out ${
              isLabelHovered ? 'opacity-0' : 'opacity-100'
            }`}
          >
            {t('adjustments.basic.toneMapper')}
          </span>
          <span
            aria-hidden={!isLabelHovered}
            className={`col-start-1 row-start-1 text-sm compact:text-xs font-medium text-text-primary select-none transition-opacity duration-200 ease-in-out pointer-events-none ${
              isLabelHovered ? 'opacity-100' : 'opacity-0'
            }`}
          >
            {t('adjustments.basic.reset')}
          </span>
        </div>
      </div>
      <div className="w-full p-2 pb-1 compact:p-1 compact:pb-0.5 bg-card-active rounded-md">
        <div className="relative flex w-full">
          <motion.div
            className="absolute top-0 bottom-0 z-0 bg-accent"
            style={{ borderRadius: 6 }}
            animate={bubbleStyle}
            transition={{ type: 'spring', bounce: 0.2, duration: 0.6 }}
          />
          {toneMapperOptions.map((mapper) => (
            <button
              key={mapper.id}
              data-tooltip={mapper.title}
              onClick={() => onMapperChange(mapper.id)}
              className={clsx(
                'relative flex-1 flex items-center justify-center gap-2 px-3 p-1.5 compact:py-1 text-sm compact:text-xs font-medium rounded-md transition-colors',
                {
                  'text-text-primary hover:bg-surface': selectedMapper !== mapper.id,
                  'text-button-text': selectedMapper === mapper.id,
                },
              )}
              style={{ WebkitTapHighlightColor: 'transparent' }}
            >
              <span className="relative z-10 flex items-center">{mapper.label}</span>
            </button>
          ))}
        </div>
        <div className="mt-2.5 compact:mt-1 px-1">{children}</div>
      </div>
    </div>
  );
};

export default function BasicAdjustments({
  adjustments,
  setAdjustments,
  isForMask = false,
  onDragStateChange,
  appSettings,
}: BasicAdjustmentsProps) {
  const handleToneMapperChange = (mapper: ToneMapper) => {
    setAdjustments((prev: Partial<Adjustments>) => ({
      ...prev,
      toneMapper: mapper,
    }));
  };

  const hideTonemapper = isForMask || appSettings?.tonemapperOverrideEnabled;
  const isRaw = useEditorStore((state) => state.selectedImage?.isRaw ?? false);
  const sliderProps = { adjustments, setAdjustments, isForMask, onDragStateChange };

  return (
    <div>
      {hideTonemapper ? (
        <AdjustmentSlider control={BasicAdjustment.Exposure} {...sliderProps} />
      ) : (
        <ToneMapperSwitch
          selectedMapper={adjustments.toneMapper || 'basic'}
          defaultMapper={getDefaultToneMapper(isRaw)}
          onMapperChange={handleToneMapperChange}
          onExposureReset={() =>
            setAdjustments((prev: Partial<Adjustments>) => ({ ...prev, [BasicAdjustment.Exposure]: 0 }))
          }
        >
          <AdjustmentSlider control={BasicAdjustment.Exposure} trackClassName="bg-surface" {...sliderProps} />
        </ToneMapperSwitch>
      )}
      <AdjustmentSlider control={BasicAdjustment.Contrast} {...sliderProps} />
      <AdjustmentSlider control={BasicAdjustment.Highlights} {...sliderProps} />
      <AdjustmentSlider control={BasicAdjustment.Shadows} {...sliderProps} />
      <AdjustmentSlider control={BasicAdjustment.Whites} {...sliderProps} />
      <AdjustmentSlider control={BasicAdjustment.Blacks} {...sliderProps} />
      <AdjustmentSlider control={BasicAdjustment.Brightness} {...sliderProps} />
    </div>
  );
}
