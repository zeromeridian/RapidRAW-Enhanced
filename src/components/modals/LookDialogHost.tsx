import { useEffect, useMemo } from 'react';
import NewLookModal, { LookChoice } from './NewLookModal';
import { closeLookDialog, useLookDialogStore } from '../../hooks/useLookDialog';
import { useCustomProfiles, useCustomProfileStore } from '../../hooks/useCustomProfiles';
import { useLuts, useLutStore } from '../../hooks/useLuts';
import { findPresetFolderId, usePresets } from '../../hooks/usePresets';
import { useEditorStore } from '../../store/useEditorStore';
import { GroupChoice, NO_GROUP, groupChoiceOf, namedGroupsOf } from '../ui/LooksBrowser/GroupPicker';
import { PROFILE_BAKEABLE_KEYS, getInitialAdjustments } from '../../utils/adjustments';
import { getEditedPresetKeys, getPresetKeys } from '../../utils/presetSettings';

/** A profile or LUT group's name from the picker's choice (their ids are their names). */
const namedGroupOf = (choice: GroupChoice) =>
  choice.type === 'none' ? '' : choice.type === 'new' ? choice.name.trim() : choice.id;

/**
 * Develop's one New Look dialog (Plan item 86 phase 4), opened from Looks' ＋, a preset's or
 * profile's right-click menu and the Edit Profile bar. It also lists the profile folder once and
 * ends Edit Profile when another photo opens.
 */
export default function LookDialogHost() {
  const dialog = useLookDialogStore((state) => state.dialog);
  const lastDialog = useLookDialogStore((state) => state.lastDialog);
  const adjustments = useEditorStore((state) => state.adjustments);
  const selectedImage = useEditorStore((state) => state.selectedImage);
  const { presets, addPreset, updatePreset } = usePresets(adjustments);
  const { refreshList, bake, rename, saveLut } = useCustomProfiles();
  const { refreshList: refreshLuts } = useLuts();
  const profileEntries = useCustomProfileStore((state) => state.entries);
  const editing = useCustomProfileStore((state) => state.editing);
  const isBaking = useCustomProfileStore((state) => state.isBaking);
  const lutEntries = useLutStore((state) => state.entries);
  const selectedImagePath = selectedImage?.path ?? null;

  useEffect(() => {
    refreshList();
  }, [refreshList]);

  // Edit Profile belongs to the photo it started on.
  useEffect(() => {
    if (editing && editing.imagePath !== selectedImagePath) useCustomProfileStore.setState({ editing: null });
  }, [editing, selectedImagePath]);

  // A new look offers the LUT folder's groups as they are now.
  useEffect(() => {
    if (dialog?.mode === 'new') refreshLuts();
  }, [dialog, refreshLuts]);

  const groups = useMemo(
    () => ({
      preset: presets.flatMap((item) => (item.folder ? [{ id: item.folder.id, name: item.folder.name }] : [])),
      profile: namedGroupsOf(profileEntries),
      lut: namedGroupsOf(lutEntries),
    }),
    [lutEntries, presets, profileEntries],
  );

  // The dialog's starting values; it reads them as it opens and keeps its own after that.
  const initial = useMemo(() => {
    const edited = () => getEditedPresetKeys(adjustments, getInitialAdjustments(selectedImage?.isRaw ?? false));
    switch (lastDialog?.mode) {
      case 'updatePreset':
      case 'configurePreset':
        return {
          name: lastDialog.preset.name,
          group: groupChoiceOf(findPresetFolderId(presets, lastDialog.preset.id)),
          keys: getPresetKeys(lastDialog.preset),
          monochrome: false,
        };
      case 'updateProfile':
      case 'renameProfile':
        return {
          name: lastDialog.entry.name,
          group: groupChoiceOf(lastDialog.entry.group),
          // Update Profile ticks what the recipe held as well as what the photo has changed since.
          keys: new Set([...edited(), ...(editing?.recipeKeys ?? [])]),
          monochrome: lastDialog.entry.monochrome,
        };
      case 'new':
        return { name: '', group: lastDialog.group ?? NO_GROUP, keys: edited(), monochrome: false };
      default:
        return { name: '', group: NO_GROUP, keys: new Set<string>(), monochrome: false };
    }
  }, [adjustments, editing, lastDialog, presets, selectedImage?.isRaw]);

  const handleSubmit = async (choice: LookChoice) => {
    if (!dialog) return;
    // A profile's or LUT's B&W is its flag, not a baked setting.
    const keys = [...choice.keys].filter((key) => PROFILE_BAKEABLE_KEYS.has(key));
    const request = { name: choice.name, group: namedGroupOf(choice.group), keys, monochrome: choice.monochrome };
    let isDone = true;
    if (dialog.mode === 'updatePreset' || dialog.mode === 'configurePreset') {
      updatePreset(dialog.preset.id, choice.name, choice.keys, dialog.mode === 'updatePreset', choice.group);
    } else if (dialog.mode === 'renameProfile') {
      isDone = await rename(dialog.entry, request);
    } else if (dialog.mode === 'updateProfile') {
      isDone = await bake(request, dialog.entry);
    } else if (choice.type === 'preset') {
      addPreset(choice.name, choice.keys, choice.group);
    } else if (choice.type === 'profile') {
      isDone = await bake(request);
    } else {
      isDone = await saveLut(request);
    }
    if (isDone) closeLookDialog();
  };

  return (
    <NewLookModal
      isOpen={dialog !== null}
      dialog={dialog ?? lastDialog}
      groups={groups}
      initialName={initial.name}
      initialGroup={initial.group}
      initialKeys={initial.keys}
      initialMonochrome={initial.monochrome}
      currentProfileName={adjustments.profile?.name ?? null}
      isBusy={isBaking}
      onClose={closeLookDialog}
      onSubmit={handleSubmit}
    />
  );
}
