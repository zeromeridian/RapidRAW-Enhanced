import { useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import { useTranslation } from 'react-i18next';
import type { ParseKeys } from 'i18next';
import { toast } from 'react-toastify';
import { create } from 'zustand';
import { Invokes } from '../components/ui/AppProperties';
import { useEditorStore } from '../store/useEditorStore';
import { useEditorActions } from './useEditorActions';
import { useLuts } from './useLuts';
import {
  Adjustments,
  CustomProfile,
  CustomProfileEntry,
  INITIAL_ADJUSTMENTS,
  PROFILE_FILE_EXTENSION,
  getProfileBakeGroupOfKey,
} from '../utils/adjustments';

interface CreatedProfile {
  path: string;
  profile: CustomProfile;
  /** Ticked keys the profile could not take (`custom_profile::Bake::kept`). */
  keptKeys: string[];
}

/** What a new profile or LUT is made of (New Look dialog). */
export interface ProfileRequest {
  name: string;
  /** The group's name; '' for none. */
  group: string;
  /** The adjustment keys to bake (`PROFILE_BAKEABLE_KEYS`). */
  keys: ReadonlyArray<string>;
  monochrome: boolean;
}

/** A profile's recipe on the sliders (Edit Profile), and the edit to go back to on Cancel. */
export interface ProfileEditing {
  entry: CustomProfileEntry;
  before: Adjustments;
  /** The keys the recipe holds, ticked again by Update Profile. */
  recipeKeys: Set<string>;
  /** The photo it started on; another photo ends it. */
  imagePath: string | null;
}

interface CustomProfileState {
  /** The profile folder, as `list_custom_profiles` returns it (by group, then name). */
  entries: CustomProfileEntry[];
  /** Counts listings, so previews of a profile updated in place render again. */
  revision: number;
  editing: ProfileEditing | null;
  isBaking: boolean;
}

/**
 * The custom profiles shared by Basic → Profile, Looks → Profiles and the New Look dialog, so
 * all show the same list and the same Edit Profile.
 */
export const useCustomProfileStore = create<CustomProfileState>(() => ({
  entries: [],
  revision: 0,
  editing: null,
  isBaking: false,
}));

const setProfileState = useCustomProfileStore.setState;

/** Takes a new folder listing; loaded files and previews may be stale. */
const setEntries = (entries: CustomProfileEntry[]) => {
  loadedProfiles.clear();
  setProfileState((state) => ({ entries, revision: state.revision + 1 }));
};

/** Loaded profile files by path; cleared when files change. */
const loadedProfiles = new Map<string, CustomProfile>();
/** The profile a hover preview is waiting for. */
let hoveredPath: string | null = null;

/** A profile as edits embed it: without its recipe, which only its file keeps. */
const toEmbedded = (profile: CustomProfile): CustomProfile => {
  const embedded = { ...profile };
  delete embedded.recipe;
  return embedded;
};

/** The edit with `profile` as its base: Amount kept when a profile was already set, B&W as the profile says. */
export const withProfile = <T extends Partial<Adjustments>>(adjustments: T, profile: CustomProfile): T => ({
  ...adjustments,
  profile: toEmbedded(profile),
  profileAmount: adjustments.profile ? (adjustments.profileAmount ?? 100) : 100,
  monochrome: profile.monochrome,
  sectionVisibility: { ...adjustments.sectionVisibility, profile: true },
});

/** The photo's custom profile and every action on the profile folder (Plan item 83, Looks item 86). */
export function useCustomProfiles() {
  const { t } = useTranslation();
  const { setAdjustments } = useEditorActions();
  const { refreshList: refreshLuts } = useLuts();
  const setEditor = useEditorStore((state) => state.setEditor);

  const refreshList = useCallback(async () => {
    try {
      setEntries(await invoke<CustomProfileEntry[]>(Invokes.ListCustomProfiles));
    } catch (err) {
      console.error('Failed to list custom profiles:', err);
    }
  }, []);

  const loadProfile = useCallback(async (path: string): Promise<CustomProfile> => {
    const cached = loadedProfiles.get(path);
    if (cached) return cached;
    const data = await invoke<CustomProfile>(Invokes.LoadCustomProfile, { path });
    loadedProfiles.set(path, data);
    return data;
  }, []);

  const endPreview = useCallback(() => {
    hoveredPath = null;
    setEditor({ previewOverride: null });
  }, [setEditor]);

  const startPreview = useCallback(
    async (path: string) => {
      hoveredPath = path;
      try {
        const data = await loadProfile(path);
        if (hoveredPath !== path) return;
        setEditor((state) => ({ previewOverride: withProfile(state.adjustments, data) }));
      } catch (err) {
        console.error('Failed to preview custom profile:', err);
      }
    },
    [loadProfile, setEditor],
  );

  const clearProfile = useCallback(
    () => setAdjustments((prev: Adjustments) => ({ ...prev, profile: null, profileAmount: 100 })),
    [setAdjustments],
  );

  /** Chooses `entry` as the photo's profile, or removes it when it is the current one. */
  const selectProfile = useCallback(
    async (entry: CustomProfileEntry) => {
      endPreview();
      if (useEditorStore.getState().adjustments.profile?.id === entry.id) {
        clearProfile();
        return;
      }
      try {
        const data = await loadProfile(entry.path);
        setAdjustments((prev: Adjustments) => withProfile(prev, data));
      } catch (err) {
        toast.error(t('adjustments.profile.loadFailed', { error: String(err) }));
      }
    },
    [clearProfile, endPreview, loadProfile, setAdjustments, t],
  );

  /** Edit Profile: the recipe back on the sliders, the profile itself taken off the photo. */
  const startEdit = async (entry: CustomProfileEntry) => {
    endPreview();
    try {
      const data = await loadProfile(entry.path);
      const recipe = data.recipe;
      if (!recipe) {
        toast.info(t('adjustments.profile.noRecipe'));
        return;
      }
      const { adjustments, selectedImage } = useEditorStore.getState();
      setProfileState({
        editing: {
          entry,
          before: adjustments,
          recipeKeys: new Set(Object.keys(recipe)),
          imagePath: selectedImage?.path ?? null,
        },
      });
      setAdjustments(
        (prev: Adjustments) => ({
          ...prev,
          profile: null,
          profileAmount: 100,
          ...structuredClone(recipe),
          monochrome: data.monochrome,
        }),
        t('adjustments.profile.edit'),
      );
    } catch (err) {
      toast.error(t('adjustments.profile.loadFailed', { error: String(err) }));
    }
  };

  const cancelEdit = () => {
    const { editing } = useCustomProfileStore.getState();
    if (!editing) return;
    setProfileState({ editing: null });
    setAdjustments(() => editing.before, t('adjustments.profile.cancelEdit'));
  };

  /** Renames `entry`, moves it to `request.group` and sets its B&W flag; true when it worked. */
  const rename = async (entry: CustomProfileEntry, request: Omit<ProfileRequest, 'keys'>) => {
    try {
      setEntries(
        await invoke<CustomProfileEntry[]>(Invokes.RenameCustomProfile, {
          path: entry.path,
          name: request.name,
          group: request.group,
          monochrome: request.monochrome,
        }),
      );
      setProfileState({ editing: null });
      return true;
    } catch (err) {
      toast.error(t('adjustments.profile.renameFailed', { error: String(err) }));
      return false;
    }
  };

  /** Move to Group, Rename Group and Delete Group (`group` empty: no group). */
  const moveToGroup = async (entries: ReadonlyArray<CustomProfileEntry>, group: string) => {
    try {
      setEntries(
        await invoke<CustomProfileEntry[]>(Invokes.MoveCustomProfilesToGroup, {
          paths: entries.map((entry) => entry.path),
          group,
        }),
      );
    } catch (err) {
      toast.error(t('adjustments.profile.renameFailed', { error: String(err) }));
    }
  };

  const importProfiles = async () => {
    try {
      const selected = await open({
        multiple: true,
        filters: [{ name: t('adjustments.profile.fileType'), extensions: [PROFILE_FILE_EXTENSION] }],
      });
      const sourcePaths = Array.isArray(selected) ? selected : selected ? [selected] : [];
      if (sourcePaths.length === 0) return;
      const before = useCustomProfileStore.getState().entries.length;
      const list = await invoke<CustomProfileEntry[]>(Invokes.ImportCustomProfiles, { sourcePaths });
      setEntries(list);
      const added = list.length - before;
      if (added < sourcePaths.length) {
        toast.warn(t('adjustments.profile.importSkipped', { count: sourcePaths.length - added }));
      }
    } catch (err) {
      toast.error(t('adjustments.profile.importFailed', { error: String(err) }));
    }
  };

  const exportProfile = async (entry: CustomProfileEntry) => {
    try {
      const destination = await save({
        defaultPath: `${entry.name}.${PROFILE_FILE_EXTENSION}`,
        filters: [{ name: t('adjustments.profile.fileType'), extensions: [PROFILE_FILE_EXTENSION] }],
      });
      if (!destination) return;
      await invoke(Invokes.ExportCustomProfile, { path: entry.path, destination });
    } catch (err) {
      toast.error(t('adjustments.profile.exportFailed', { error: String(err) }));
    }
  };

  const deleteProfile = async (entry: CustomProfileEntry) => {
    try {
      setEntries(await invoke<CustomProfileEntry[]>(Invokes.DeleteCustomProfile, { path: entry.path }));
      if (useCustomProfileStore.getState().editing?.entry.path === entry.path) setProfileState({ editing: null });
    } catch (err) {
      toast.error(t('adjustments.profile.deleteFailed', { error: String(err) }));
    }
  };

  /** Save to my profiles: the photo's embedded profile into the profile folder. */
  const saveEmbedded = async () => {
    const profile = useEditorStore.getState().adjustments.profile;
    if (!profile) return;
    try {
      setEntries(await invoke<CustomProfileEntry[]>(Invokes.SaveEmbeddedCustomProfile, { profile }));
    } catch (err) {
      toast.error(t('adjustments.profile.saveFailed', { error: String(err) }));
    }
  };

  /**
   * Create Profile, or Update Profile for the profile being edited: bake the ticked settings;
   * true when it worked.
   */
  const bake = async (choice: ProfileRequest, entry?: CustomProfileEntry) => {
    const { keys } = choice;
    const adjustments = useEditorStore.getState().adjustments;
    setProfileState({ isBaking: true });
    try {
      const request = { ...choice, adjustments };
      const created = entry
        ? await invoke<CreatedProfile>(Invokes.UpdateCustomProfile, { path: entry.path, request })
        : await invoke<CreatedProfile>(Invokes.CreateCustomProfile, { request });
      // The baked settings move into the profile, so the photo keeps its look at Amount 100;
      // what the profile could not take (its own curve or Zone Editor won) stays in the photo.
      const kept = new Set(created.keptKeys.flatMap((key) => getProfileBakeGroupOfKey(key)?.keys ?? [key]));
      const baked = keys.filter((key) => !kept.has(key));
      setAdjustments(
        (prev: Adjustments) => ({
          ...withProfile(
            {
              ...prev,
              ...Object.fromEntries(baked.map((key) => [key, structuredClone(INITIAL_ADJUSTMENTS[key])])),
              profile: null,
            },
            created.profile,
          ),
          monochrome: choice.monochrome,
        }),
        t(entry ? 'modals.createProfile.titleUpdate' : 'modals.createProfile.title'),
      );
      if (created.keptKeys.length > 0) {
        const settings = created.keptKeys
          .map((key) => getProfileBakeGroupOfKey(key)?.label)
          .filter((label): label is string => label !== undefined)
          .map((label) => t(label as ParseKeys))
          .join(', ');
        toast.info(t('modals.createProfile.kept', { settings }));
      }
      setProfileState({ editing: null });
      refreshList();
      return true;
    } catch (err) {
      toast.error(t('modals.createProfile.failed', { error: String(err) }));
      return false;
    } finally {
      setProfileState({ isBaking: false });
    }
  };

  /**
   * Save as LUT: the ticked settings into a finishing LUT in Look → LUT; the photo stays as it
   * is. True when it worked.
   */
  const saveLut = async (choice: ProfileRequest) => {
    setProfileState({ isBaking: true });
    try {
      await invoke<string>(Invokes.SaveSettingsAsLut, {
        request: { ...choice, adjustments: useEditorStore.getState().adjustments },
      });
      toast.success(t('modals.createProfile.lutSaved', { name: choice.name }));
      refreshLuts();
      return true;
    } catch (err) {
      toast.error(t('modals.createProfile.lutFailed', { error: String(err) }));
      return false;
    } finally {
      setProfileState({ isBaking: false });
    }
  };

  return {
    refreshList,
    startPreview,
    endPreview,
    selectProfile,
    clearProfile,
    startEdit,
    cancelEdit,
    rename,
    bake,
    saveLut,
    moveToGroup,
    importProfiles,
    exportProfile,
    deleteProfile,
    saveEmbedded,
  };
}
