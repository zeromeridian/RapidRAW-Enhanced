import { useTranslation } from 'react-i18next';
import { ChevronRight, Save, X } from 'lucide-react';
import clsx from 'clsx';
import AdjustmentSlider from './AdjustmentSlider';
import AdjustmentTool from './AdjustmentTool';
import { openLooks } from '../panel/right/LooksHeader';
import { useCustomProfiles, useCustomProfileStore } from '../../hooks/useCustomProfiles';
import { openLookDialog } from '../../hooks/useLookDialog';
import { Adjustments, ProfileAdjustment } from '../../utils/adjustments';

interface ProfilePanelProps {
  adjustments: Adjustments;
  setAdjustments(updater: (prev: Partial<Adjustments>) => Partial<Adjustments>, historyLabel?: string): void;
  isForMask?: boolean;
  onDragStateChange?: (isDragging: boolean) => void;
}

/** Edit Profile in progress: the profile's name, Cancel and Update Profile (here and in Looks → Profiles). */
export function ProfileEditingBar() {
  const { t } = useTranslation();
  const { cancelEdit } = useCustomProfiles();
  const editing = useCustomProfileStore((state) => state.editing);
  if (!editing) return null;
  return (
    <div className="p-2 rounded-sm bg-surface flex items-center justify-between gap-2 text-xs">
      <span className="truncate text-text-primary">
        {t('adjustments.profile.editing', { name: editing.entry.name })}
      </span>
      <div className="flex gap-1 shrink-0">
        <button
          className="px-2 py-1 rounded-sm text-text-secondary hover:text-text-primary hover:bg-bg-tertiary transition-colors"
          onClick={cancelEdit}
        >
          {t('adjustments.profile.cancelEdit')}
        </button>
        <button
          className="px-2 py-1 rounded-sm bg-accent text-button-text font-semibold hover:bg-accent-hover transition-colors"
          onClick={() => openLookDialog({ mode: 'updateProfile', entry: editing.entry })}
        >
          {t('adjustments.profile.update')}
        </button>
      </div>
    </div>
  );
}

/**
 * The Profile block at the top of Light (Plan item 83): the custom profile the look starts from
 * and its Amount. Choosing one happens in Looks → Profiles, which the name opens (Plan item 86).
 */
export default function ProfilePanel({
  adjustments,
  setAdjustments,
  isForMask = false,
  onDragStateChange,
}: ProfilePanelProps) {
  const { t } = useTranslation();
  const { clearProfile, saveEmbedded } = useCustomProfiles();
  const entries = useCustomProfileStore((state) => state.entries);
  const profile = adjustments.profile ?? null;
  const isSaved = !profile || entries.some((entry) => entry.id === profile.id);

  if (isForMask) {
    return null;
  }

  return (
    <AdjustmentTool id="profile" isUntitled>
      {/* As Lightroom Classic's Profile row: the label, the chosen profile in a field that opens the browser. */}
      <div className="flex items-center gap-2">
        <span className="text-sm compact:text-xs font-medium text-text-primary select-none shrink-0">
          {t('adjustments.profile.title')}
        </span>
        <button
          onClick={() => openLooks('profiles')}
          className="flex-1 min-w-0 flex items-center justify-between gap-2 px-2.5 py-1.5 compact:py-1 rounded-md bg-bg-primary border border-border hover:border-text-secondary text-sm compact:text-xs transition-colors"
          data-tooltip={isSaved ? t('adjustments.profile.browse') : t('adjustments.profile.notSaved')}
        >
          <span
            className={clsx('truncate', profile ? 'text-text-primary' : 'text-text-secondary', !isSaved && 'italic')}
          >
            {profile?.name ?? t('adjustments.profile.none')}
          </span>
          <ChevronRight size={16} className="shrink-0 text-text-secondary" />
        </button>
        {profile && (
          <button
            onClick={clearProfile}
            className="p-0.5 rounded-sm text-text-secondary hover:text-text-primary transition-colors"
            data-tooltip={t('adjustments.profile.clear')}
          >
            <X size={16} />
          </button>
        )}
      </div>

      {profile && !isSaved && (
        <button
          className="mt-2 flex items-center gap-1.5 text-xs text-text-secondary hover:text-accent transition-colors"
          onClick={saveEmbedded}
        >
          <Save size={14} />
          {t('adjustments.profile.saveToProfiles')}
        </button>
      )}

      <div className="mt-2 empty:hidden">
        <ProfileEditingBar />
      </div>

      {profile && (
        <div className="mt-2">
          <AdjustmentSlider
            adjustments={adjustments}
            control={ProfileAdjustment.ProfileAmount}
            setAdjustments={setAdjustments}
            onDragStateChange={onDragStateChange}
          />
        </div>
      )}
    </AdjustmentTool>
  );
}
