import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { ParseKeys } from 'i18next';
import Text from '../ui/Text';
import Button from '../ui/Button';
import TickBox from '../ui/TickBox';
import { TextColors, TextVariants } from '../../types/typography';
import { PROFILE_BAKE_GROUPS } from '../../utils/adjustments';

export interface CreateProfileChoice {
  name: string;
  group: string;
  /** The `PROFILE_BAKE_GROUPS` ids to bake. */
  groups: Set<string>;
  monochrome: boolean;
}

interface CreateProfileModalProps {
  isOpen: boolean;
  /** The bake groups ticked when the dialog opens (those the photo has changed). */
  initialGroups: ReadonlySet<string>;
  initialMonochrome: boolean;
  isCreating: boolean;
  onClose(): void;
  onCreate(choice: CreateProfileChoice): void;
}

const INPUT_CLASS =
  'w-full bg-bg-primary text-text-primary border border-border rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent';

/** Adobe Camera Raw's Create Profile: a name, a group and the settings to bake into the look. */
export default function CreateProfileModal({
  isOpen,
  initialGroups,
  initialMonochrome,
  isCreating,
  onClose,
  onCreate,
}: CreateProfileModalProps) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [group, setGroup] = useState('');
  const [groups, setGroups] = useState<Set<string>>(new Set());
  const [monochrome, setMonochrome] = useState(false);
  const [isMounted, setIsMounted] = useState(false);
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setName('');
      setGroups(new Set(initialGroups));
      setMonochrome(initialMonochrome);
      setIsMounted(true);
      const timer = setTimeout(() => setShow(true), 10);
      return () => clearTimeout(timer);
    }
    setShow(false);
    const timer = setTimeout(() => setIsMounted(false), 300);
    return () => clearTimeout(timer);
  }, [isOpen, initialGroups, initialMonochrome]);

  const canCreate = name.trim() !== '' && !isCreating;

  const handleCreate = useCallback(() => {
    if (canCreate) {
      onCreate({ name: name.trim(), group: group.trim(), groups, monochrome });
    }
  }, [canCreate, group, groups, monochrome, name, onCreate]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        handleCreate();
      } else if (e.key === 'Escape') {
        onClose();
      }
    },
    [handleCreate, onClose],
  );

  const toggle = (id: string) => {
    const next = new Set(groups);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setGroups(next);
  };

  if (!isMounted) {
    return null;
  }

  return createPortal(
    <div
      className={`
        fixed inset-0 flex items-center justify-center z-50
        bg-black/30 backdrop-blur-xs
        transition-opacity duration-300 ease-in-out
        ${show ? 'opacity-100' : 'opacity-0'}
      `}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className={`
          bg-surface rounded-lg shadow-xl p-6 w-full max-w-md mx-4 flex flex-col max-h-[90vh]
          transform transition-all duration-300 ease-out
          ${show ? 'scale-100 opacity-100 translate-y-0' : 'scale-95 opacity-0 -translate-y-4'}
        `}
        onClick={(e) => e.stopPropagation()}
      >
        <Text variant={TextVariants.title} className="mb-4">
          {t('modals.createProfile.title')}
        </Text>
        <div className="flex flex-col gap-2">
          <input
            autoFocus
            className={INPUT_CLASS}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('modals.createProfile.namePlaceholder')}
            type="text"
            value={name}
          />
          <input
            className={INPUT_CLASS}
            onChange={(e) => setGroup(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('modals.createProfile.groupPlaceholder')}
            type="text"
            value={group}
          />
        </div>

        <div className="flex justify-between items-center mt-5 mb-2 gap-4">
          <div>
            <Text variant={TextVariants.heading}>{t('modals.createProfile.settings')}</Text>
            <Text variant={TextVariants.small}>{t('modals.createProfile.hint')}</Text>
          </div>
          <div className="flex gap-2 shrink-0">
            <Button size="sm" onClick={() => setGroups(new Set(PROFILE_BAKE_GROUPS.map((bake) => bake.id)))}>
              {t('modals.createProfile.selectAll')}
            </Button>
            <Button size="sm" onClick={() => setGroups(new Set())}>
              {t('modals.createProfile.selectNone')}
            </Button>
          </div>
        </div>

        <div className="bg-bg-primary p-4 rounded-md overflow-y-auto min-h-0">
          {PROFILE_BAKE_GROUPS.map((bake) => (
            <button
              className="flex w-full items-center gap-2 py-0.5 text-left"
              data-tooltip={bake.isApproximate ? t('modals.createProfile.approximateHint') : undefined}
              key={bake.id}
              onClick={() => toggle(bake.id)}
              type="button"
            >
              <TickBox state={groups.has(bake.id) ? 'all' : 'none'} />
              <Text as="span">{t(bake.label as ParseKeys)}</Text>
              {bake.isApproximate && (
                <Text as="span" color={TextColors.secondary} variant={TextVariants.small}>
                  ({t('modals.createProfile.approximate')})
                </Text>
              )}
            </button>
          ))}
          <button
            className="flex w-full items-center gap-2 pt-3 text-left"
            onClick={() => setMonochrome((value) => !value)}
            type="button"
          >
            <TickBox state={monochrome ? 'all' : 'none'} />
            <Text as="span">{t('modals.createProfile.blackAndWhite')}</Text>
          </button>
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <button
            className="px-4 py-2 rounded-md text-text-secondary hover:bg-surface transition-colors"
            onClick={onClose}
          >
            {t('modals.createProfile.cancel')}
          </button>
          <button
            className="px-4 py-2 rounded-md bg-accent text-button-text font-semibold hover:bg-accent-hover disabled:bg-gray-500 disabled:text-white disabled:cursor-not-allowed transition-colors"
            disabled={!canCreate}
            onClick={handleCreate}
          >
            {t('modals.createProfile.create')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
