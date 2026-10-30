import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Button from '../ui/Button';
import Text from '../ui/Text';
import { TextColors, TextVariants } from '../../types/typography';
import { useLibraryStore } from '../../store/useLibraryStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { saveImageStacks } from '../../hooks/useLibraryActions';
import { addCaptureTimeStacks, planCaptureTimeStacks } from '../../utils/imageStacks';

// Lightroom Classic offers 0 s to 1 h between stacks; the slider snaps to these gaps.
const STACK_GAP_SECONDS = [5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];
const DEFAULT_GAP_INDEX = STACK_GAP_SECONDS.indexOf(60);

interface CaptureTimeStackModalProps {
  isOpen: boolean;
  onClose(): void;
  targetPaths: string[];
}

export default function CaptureTimeStackModal({ isOpen, onClose, targetPaths }: CaptureTimeStackModalProps) {
  const { t } = useTranslation();
  const [gapIndex, setGapIndex] = useState(DEFAULT_GAP_INDEX);
  const [isMounted, setIsMounted] = useState(false);
  const [show, setShow] = useState(false);
  const imageList = useLibraryStore((state) => state.imageList);
  const imageStacks = useSettingsStore((state) => state.appSettings?.imageStacks);

  useEffect(() => {
    if (isOpen) {
      setIsMounted(true);
      const timer = setTimeout(() => setShow(true), 10);
      return () => clearTimeout(timer);
    }

    setShow(false);
    const timer = setTimeout(() => setIsMounted(false), 300);
    return () => clearTimeout(timer);
  }, [isOpen]);

  const images = useMemo(() => {
    const paths = new Set(targetPaths);
    return imageList.filter((image) => paths.has(image.path));
  }, [imageList, targetPaths]);
  const gapSeconds = STACK_GAP_SECONDS[gapIndex];
  const plan = useMemo(
    () => planCaptureTimeStacks(images, imageStacks || [], gapSeconds),
    [gapSeconds, imageStacks, images],
  );
  const stackedPhotoCount = plan.groups.reduce((total, group) => total + group.length, 0);

  const formatGap = (seconds: number) =>
    seconds < 60
      ? t('modals.captureTimeStack.seconds', { count: seconds })
      : seconds < 3600
        ? t('modals.captureTimeStack.minutes', { count: seconds / 60 })
        : t('modals.captureTimeStack.hours', { count: seconds / 3600 });

  const handleStack = useCallback(() => {
    if (plan.groups.length === 0) return;
    saveImageStacks((stacks) => addCaptureTimeStacks(stacks, planCaptureTimeStacks(images, stacks, gapSeconds).groups));
    onClose();
  }, [gapSeconds, images, onClose, plan.groups.length]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        event.stopPropagation();
        handleStack();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    },
    [handleStack, onClose],
  );

  if (!isMounted) return null;

  return (
    <div
      aria-modal="true"
      className={`fixed inset-0 flex items-center justify-center z-50 bg-black/30 backdrop-blur-xs transition-opacity duration-300 ease-in-out ${
        show ? 'opacity-100' : 'opacity-0'
      }`}
      onClick={onClose}
      role="dialog"
    >
      <div
        className={`bg-surface rounded-lg shadow-xl p-6 w-full max-w-md transform transition-all duration-300 ease-out ${
          show ? 'scale-100 opacity-100 translate-y-0' : 'scale-95 opacity-0 -translate-y-4'
        }`}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <Text variant={TextVariants.title} className="mb-2">
          {t('modals.captureTimeStack.title')}
        </Text>
        <Text color={TextColors.secondary} className="mb-5">
          {t('modals.captureTimeStack.scope', { count: images.length })}
        </Text>
        <div className="flex items-center justify-between mb-2">
          <Text>{t('modals.captureTimeStack.timeBetweenStacks')}</Text>
          <Text>{formatGap(gapSeconds)}</Text>
        </div>
        <div className="relative h-5 mb-5">
          <div className="absolute top-1/2 left-0 w-full h-1.5 -translate-y-1/2 bg-bg-primary rounded-full pointer-events-none" />
          <input
            aria-label={t('modals.captureTimeStack.timeBetweenStacks')}
            autoFocus
            className="absolute top-1/2 left-0 w-full h-1.5 mt-[-1.5px] appearance-none bg-transparent cursor-pointer p-0 slider-input z-10"
            max={STACK_GAP_SECONDS.length - 1}
            min={0}
            onChange={(event) => setGapIndex(Number(event.target.value))}
            step={1}
            type="range"
            value={gapIndex}
          />
        </div>
        <Text>{t('modals.captureTimeStack.result', { count: plan.groups.length, photos: stackedPhotoCount })}</Text>
        <Text variant={TextVariants.small} color={TextColors.secondary} className="min-h-5 mt-1">
          {plan.undatedCount > 0 ? t('modals.captureTimeStack.undated', { count: plan.undatedCount }) : ''}
        </Text>
        <div className="flex justify-end gap-3 mt-4">
          <Button variant="ghost" onClick={onClose}>
            {t('modals.confirm.cancel')}
          </Button>
          <Button disabled={plan.groups.length === 0} onClick={handleStack}>
            {t('modals.captureTimeStack.stack')}
          </Button>
        </div>
      </div>
    </div>
  );
}
