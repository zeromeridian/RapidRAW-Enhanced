import { useEffect, useMemo } from 'react';
import CreateProfileModal from '../modals/CreateProfileModal';
import { changedBakeGroups, useCustomProfiles, useCustomProfileStore } from '../../hooks/useCustomProfiles';
import { useEditorStore } from '../../store/useEditorStore';
import { useLuts, useLutStore } from '../../hooks/useLuts';
import { namedGroupsOf } from '../ui/LooksBrowser/GroupPicker';

/**
 * Develop's one profile dialog (Create, Update, Rename), opened from Basic → Profile or Looks →
 * Profiles. It also lists the profile folder once and ends Edit Profile when another photo opens.
 */
export default function ProfileDialogHost() {
  const { closeDialog, refreshList, submitDialog } = useCustomProfiles();
  const { refreshList: refreshLuts } = useLuts();
  const dialog = useCustomProfileStore((state) => state.dialog);
  const editing = useCustomProfileStore((state) => state.editing);
  const entries = useCustomProfileStore((state) => state.entries);
  const isBaking = useCustomProfileStore((state) => state.isBaking);
  const adjustments = useEditorStore((state) => state.adjustments);
  const selectedImagePath = useEditorStore((state) => state.selectedImage?.path ?? null);

  useEffect(() => {
    refreshList();
  }, [refreshList]);

  // Edit Profile belongs to the photo it started on.
  useEffect(() => {
    if (editing && editing.imagePath !== selectedImagePath) useCustomProfileStore.setState({ editing: null });
  }, [editing, selectedImagePath]);

  const lutEntries = useLutStore((state) => state.entries);
  const profileGroups = useMemo(() => namedGroupsOf(entries), [entries]);
  const lutGroups = useMemo(() => namedGroupsOf(lutEntries), [lutEntries]);

  // Save as LUT offers the LUT folder's groups as they are now.
  useEffect(() => {
    if (dialog?.mode === 'create') refreshLuts();
  }, [dialog, refreshLuts]);
  // Update Profile ticks what the recipe held as well as what the photo has changed since.
  // Only read while the dialog is open, so slider moves do not recompute it otherwise.
  const initialGroups = useMemo(
    () => (dialog ? new Set([...changedBakeGroups(adjustments), ...(editing?.recipeGroups ?? [])]) : new Set<string>()),
    [adjustments, dialog, editing],
  );
  const dialogEntry = dialog && dialog.mode !== 'create' ? dialog.entry : null;

  return (
    <CreateProfileModal
      isOpen={dialog !== null}
      mode={dialog?.mode ?? 'create'}
      currentProfileName={adjustments.profile?.name ?? null}
      initialName={dialogEntry?.name ?? ''}
      profileGroups={profileGroups}
      lutGroups={lutGroups}
      initialGroup={dialogEntry?.group ?? ''}
      initialGroups={initialGroups}
      initialMonochrome={dialog?.mode === 'rename' ? dialog.entry.monochrome : adjustments.monochrome}
      isBusy={isBaking}
      onClose={closeDialog}
      onSubmit={submitDialog}
    />
  );
}
