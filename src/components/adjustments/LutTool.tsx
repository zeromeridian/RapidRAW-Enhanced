import { useTranslation } from 'react-i18next';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronRight, X } from 'lucide-react';
import clsx from 'clsx';
import AdjustmentTool from './AdjustmentTool';
import Slider from '../ui/Slider';
import { openLooks } from '../panel/right/LooksHeader';
import { useLuts } from '../../hooks/useLuts';
import { Adjustments } from '../../utils/adjustments';

interface LutToolProps {
  adjustments: Adjustments;
  setAdjustments(updater: (prev: Partial<Adjustments>) => Partial<Adjustments>): void;
  onDragStateChange?: (isDragging: boolean) => void;
}

/**
 * Look → LUT: the photo's finishing LUT and its Intensity. Choosing one happens in Looks → LUTs,
 * which the name opens (Plan item 86).
 */
export default function LutTool({ adjustments, setAdjustments, onDragStateChange }: LutToolProps) {
  const { t } = useTranslation();
  const { clearLut } = useLuts();
  const lutName = adjustments.lutName || null;

  return (
    <AdjustmentTool id="lut" isUntitled>
      <div className="flex items-center gap-2">
        <span className="text-sm compact:text-xs font-medium text-text-primary select-none shrink-0">
          {t('ui.lut.label')}
        </span>
        <button
          onClick={() => openLooks('luts')}
          className="flex-1 min-w-0 flex items-center justify-between gap-2 px-2.5 py-1.5 compact:py-1 rounded-md bg-bg-primary border border-border hover:border-text-secondary text-sm compact:text-xs transition-colors"
          data-tooltip={t('ui.lut.selectLutFile')}
        >
          <span className={clsx('truncate', lutName ? 'text-text-primary' : 'text-text-secondary')}>
            {lutName ?? t('adjustments.profile.none')}
          </span>
          <ChevronRight size={16} className="shrink-0 text-text-secondary" />
        </button>
        {lutName && (
          <button
            onClick={clearLut}
            className="p-0.5 rounded-sm text-text-secondary hover:text-text-primary transition-colors"
            data-tooltip={t('ui.lut.clearLut')}
          >
            <X size={16} />
          </button>
        )}
      </div>

      <AnimatePresence initial={false}>
        {lutName && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <div className="mt-2">
              <Slider
                label={t('ui.lut.intensity')}
                min={0}
                max={100}
                step={1}
                value={adjustments.lutIntensity ?? 100}
                defaultValue={100}
                onChange={(e) => setAdjustments((prev) => ({ ...prev, lutIntensity: Number(e.target.value) }))}
                onDragStateChange={onDragStateChange}
                fillOrigin="min"
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </AdjustmentTool>
  );
}
