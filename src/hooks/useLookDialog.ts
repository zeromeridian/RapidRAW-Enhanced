import { create } from 'zustand';
import type { GroupChoice } from '../components/ui/LooksBrowser/GroupPicker';
import type { Preset } from '../components/ui/AppProperties';
import type { CustomProfileEntry } from '../utils/adjustments';

/** What the New Look dialog saves. */
export type LookType = 'preset' | 'profile' | 'lut';

/**
 * The New Look dialog's task (Plan item 86 phase 4): a new preset, profile or LUT (its Type can
 * change), Update or Configure a preset, Update a profile being edited, or rename a profile.
 */
export type LookDialog =
  | { mode: 'new'; type: LookType; group?: GroupChoice }
  | { mode: 'updatePreset' | 'configurePreset'; preset: Preset }
  | { mode: 'updateProfile' | 'renameProfile'; entry: CustomProfileEntry };

interface LookDialogState {
  dialog: LookDialog | null;
  /** The last dialog, kept while it fades out so its title does not change. */
  lastDialog: LookDialog | null;
}

export const useLookDialogStore = create<LookDialogState>(() => ({ dialog: null, lastDialog: null }));

export const openLookDialog = (dialog: LookDialog) => useLookDialogStore.setState({ dialog, lastDialog: dialog });

export const closeLookDialog = () => useLookDialogStore.setState({ dialog: null });

/** The Type a dialog saves. */
export const lookTypeOf = (dialog: LookDialog): LookType => {
  switch (dialog.mode) {
    case 'new':
      return dialog.type;
    case 'updatePreset':
    case 'configurePreset':
      return 'preset';
    default:
      return 'profile';
  }
};
