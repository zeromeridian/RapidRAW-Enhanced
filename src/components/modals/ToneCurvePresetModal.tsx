import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Button from '../ui/Button';
import Text from '../ui/Text';
import { TextColors, TextVariants } from '../../types/typography';
import { normalizeToneCurvePresetName } from '../../utils/toneCurvePresets';

interface ToneCurvePresetModalProps {
  existingNames: string[];
  isOpen: boolean;
  onClose(): void;
  onSave(name: string): void;
}

export default function ToneCurvePresetModal({ existingNames, isOpen, onClose, onSave }: ToneCurvePresetModalProps) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [isMounted, setIsMounted] = useState(false);
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setName('');
      setIsMounted(true);
      const timer = setTimeout(() => setShow(true), 10);
      return () => clearTimeout(timer);
    }

    setShow(false);
    const timer = setTimeout(() => {
      setIsMounted(false);
      setName('');
    }, 300);
    return () => clearTimeout(timer);
  }, [isOpen]);

  const trimmedName = name.trim();
  const normalizedName = normalizeToneCurvePresetName(name);
  const hasConflict = useMemo(
    () =>
      !!normalizedName && existingNames.some((existing) => normalizeToneCurvePresetName(existing) === normalizedName),
    [existingNames, normalizedName],
  );
  const error = !trimmedName
    ? t('adjustments.curves.presetNameRequired')
    : hasConflict
      ? t('adjustments.curves.presetNameConflict')
      : '';

  const handleSave = useCallback(() => {
    if (error) return;
    onSave(trimmedName);
    onClose();
  }, [error, onClose, onSave, trimmedName]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        handleSave();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    },
    [handleSave, onClose],
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
        className={`bg-surface rounded-lg shadow-xl p-6 w-full max-w-sm transform transition-all duration-300 ease-out ${
          show ? 'scale-100 opacity-100 translate-y-0' : 'scale-95 opacity-0 -translate-y-4'
        }`}
        onClick={(event) => event.stopPropagation()}
      >
        <Text variant={TextVariants.title} className="mb-4">
          {t('adjustments.curves.savePresetTitle')}
        </Text>
        <input
          aria-invalid={!!error}
          autoFocus
          className="w-full bg-bg-primary text-text-primary border border-border-color rounded-md px-3 py-2 focus:outline-hidden focus:ring-2 focus:ring-accent"
          onChange={(event) => setName(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t('adjustments.curves.presetNamePlaceholder')}
          type="text"
          value={name}
        />
        <Text
          variant={TextVariants.small}
          color={error ? TextColors.error : TextColors.secondary}
          className="min-h-5 mt-2"
        >
          {error || t('adjustments.curves.presetNameUniqueHint')}
        </Text>
        <div className="flex justify-end gap-3 mt-4">
          <Button variant="ghost" onClick={onClose}>
            {t('modals.confirm.cancel')}
          </Button>
          <Button disabled={!!error} onClick={handleSave}>
            {t('adjustments.curves.savePreset')}
          </Button>
        </div>
      </div>
    </div>
  );
}
