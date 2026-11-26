import { useCallback, useEffect, useRef, useState } from 'react';
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
  /** The `PROFILE_BAKE_GROUPS` ids to bake (none when renaming). */
  groups: Set<string>;
  monochrome: boolean;
}

/** Create a profile, bake a new revision of the one being edited, or rename one. */
export type ProfileDialogMode = 'create' | 'update' | 'rename';

interface CreateProfileModalProps {
  isOpen: boolean;
  mode: ProfileDialogMode;
  /** The photo's current profile, which can be baked in; null without one. */
  currentProfileName: string | null;
  initialName: string;
  initialGroup: string;
  /** The bake groups ticked when the dialog opens. */
  initialGroups: ReadonlySet<string>;
  initialMonochrome: boolean;
  isBusy: boolean;
  onClose(): void;
  onSubmit(choice: CreateProfileChoice): void;
}

const TITLES: Record<ProfileDialogMode, ParseKeys> = {
  create: 'modals.createProfile.title',
  update: 'modals.createProfile.titleUpdate',
  rename: 'modals.createProfile.titleRename',
};

const SUBMIT_LABELS: Record<ProfileDialogMode, ParseKeys> = {
  create: 'modals.createProfile.create',
  update: 'modals.createProfile.update',
  rename: 'modals.createProfile.save',
};

const INPUT_CLASS =
  'w-full bg-bg-primary text-text-primary border border-border rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent';

/**
 * Adobe Camera Raw's Create Profile: a name, a group and the settings to bake into the look;
 * also Update Profile (the same, for the profile being edited) and Rename (no settings).
 */
export default function CreateProfileModal({
  isOpen,
  mode,
  currentProfileName,
  initialName,
  initialGroup,
  initialGroups,
  initialMonochrome,
  isBusy,
  onClose,
  onSubmit,
}: CreateProfileModalProps) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [group, setGroup] = useState('');
  const [groups, setGroups] = useState<Set<string>>(new Set());
  const [monochrome, setMonochrome] = useState(false);
  const [isMounted, setIsMounted] = useState(false);
  const [show, setShow] = useState(false);
  const wasOpen = useRef(false);

  useEffect(() => {
    if (isOpen) {
      // The fields start from the initial values once, as the dialog opens.
      if (!wasOpen.current) {
        setName(initialName);
        setGroup(initialGroup);
        setGroups(new Set(initialGroups));
        setMonochrome(initialMonochrome);
      }
      wasOpen.current = true;
      setIsMounted(true);
      const timer = setTimeout(() => setShow(true), 10);
      return () => clearTimeout(timer);
    }
    wasOpen.current = false;
    setShow(false);
    const timer = setTimeout(() => setIsMounted(false), 300);
    return () => clearTimeout(timer);
  }, [isOpen, initialName, initialGroup, initialGroups, initialMonochrome]);

  const canSubmit = name.trim() !== '' && !isBusy;

  const handleSubmit = useCallback(() => {
    if (canSubmit) {
      onSubmit({ name: name.trim(), group: group.trim(), groups: mode === 'rename' ? new Set() : groups, monochrome });
    }
  }, [canSubmit, group, groups, mode, monochrome, name, onSubmit]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        handleSubmit();
      } else if (e.key === 'Escape') {
        onClose();
      }
    },
    [handleSubmit, onClose],
  );

  const bakeGroups = PROFILE_BAKE_GROUPS.filter((bake) => !bake.needsProfile || currentProfileName !== null);

  const toggle = (id: string) => {
    const next = new Set(groups);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setGroups(next);
  };

  if (!isMounted) {
    return null;
  }

  const monochromeToggle = (
    <button
      className={`flex w-full items-center gap-2 text-left ${mode === 'rename' ? 'mt-4' : 'pt-3'}`}
      onClick={() => setMonochrome((value) => !value)}
      type="button"
    >
      <TickBox state={monochrome ? 'all' : 'none'} />
      <Text as="span">{t('modals.createProfile.blackAndWhite')}</Text>
    </button>
  );

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
          {t(TITLES[mode])}
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

        {mode === 'rename' ? (
          monochromeToggle
        ) : (
          <>
            <div className="flex justify-between items-center mt-5 mb-2 gap-4">
              <div>
                <Text variant={TextVariants.heading}>{t('modals.createProfile.settings')}</Text>
                <Text variant={TextVariants.small}>
                  {t(mode === 'update' ? 'modals.createProfile.hintUpdate' : 'modals.createProfile.hint')}
                </Text>
              </div>
              <div className="flex gap-2 shrink-0">
                <Button size="sm" onClick={() => setGroups(new Set(bakeGroups.map((bake) => bake.id)))}>
                  {t('modals.createProfile.selectAll')}
                </Button>
                <Button size="sm" onClick={() => setGroups(new Set())}>
                  {t('modals.createProfile.selectNone')}
                </Button>
              </div>
            </div>

            <div className="bg-bg-primary p-4 rounded-md overflow-y-auto min-h-0">
              {bakeGroups.map((bake) => (
                <button
                  className="flex w-full items-center gap-2 py-0.5 text-left"
                  data-tooltip={bake.isApproximate ? t('modals.createProfile.approximateHint') : undefined}
                  key={bake.id}
                  onClick={() => toggle(bake.id)}
                  type="button"
                >
                  <TickBox state={groups.has(bake.id) ? 'all' : 'none'} />
                  <Text as="span">{t(bake.label as ParseKeys, { name: currentProfileName })}</Text>
                  {bake.isApproximate && (
                    <Text as="span" color={TextColors.secondary} variant={TextVariants.small}>
                      ({t('modals.createProfile.approximate')})
                    </Text>
                  )}
                </button>
              ))}
              {monochromeToggle}
            </div>
          </>
        )}

        <div className="flex justify-end gap-3 mt-6">
          <button
            className="px-4 py-2 rounded-md text-text-secondary hover:bg-surface transition-colors"
            onClick={onClose}
          >
            {t('modals.createProfile.cancel')}
          </button>
          <button
            className="px-4 py-2 rounded-md bg-accent text-button-text font-semibold hover:bg-accent-hover disabled:bg-gray-500 disabled:text-white disabled:cursor-not-allowed transition-colors"
            disabled={!canSubmit}
            onClick={handleSubmit}
          >
            {t(SUBMIT_LABELS[mode])}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
