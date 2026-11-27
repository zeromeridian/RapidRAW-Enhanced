import { invoke } from '@tauri-apps/api/core';
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog';
import { relaunch } from '@tauri-apps/plugin-process';
import type { TFunction } from 'i18next';
import { toast } from 'react-toastify';
import type { ConfirmRequest } from '../components/panel/settings/SettingsContext';
import { Invokes } from '../components/ui/AppProperties';
import { useSettingsStore } from '../store/useSettingsStore';
import { useUIStore } from '../store/useUIStore';

/**
 * Back Up / Restore Settings (Plan item 85, `settings_backup.rs`), shared by Settings → Storage
 * and the File menu.
 */

const ZIP_FILTERS = [{ name: 'ZIP', extensions: ['zip'] }];

/** Whether a backup includes the library catalog (`backupIncludeCatalog`, absent means on). */
export const backupIncludesCatalog = () => useSettingsStore.getState().appSettings?.backupIncludeCatalog ?? true;

/** Asks where to save, then writes the backup. */
export async function backUpSettings(t: TFunction) {
  const date = new Date().toISOString().slice(0, 10);
  const path = await saveDialog({
    defaultPath: `ThisIsRAW Settings ${date}.zip`,
    filters: ZIP_FILTERS,
    title: t('settings.data.backup.title'),
  });
  if (!path) return;
  const toastId = toast.loading(t('settings.data.backup.saving'));
  try {
    await invoke(Invokes.BackUpSettings, { path, includeCatalog: backupIncludesCatalog() });
    toast.update(toastId, {
      autoClose: 4000,
      isLoading: false,
      render: t('settings.data.backup.saved', { path }),
      type: 'success',
    });
  } catch (error) {
    toast.update(toastId, {
      autoClose: 8000,
      isLoading: false,
      render: `${t('settings.data.backup.failed')}: ${error}`,
      type: 'error',
    });
  }
}

/** The App's destructive confirmation (`ConfirmModalState`), for callers outside Settings. */
export const confirmWithAppModal = (request: ConfirmRequest) =>
  useUIStore.getState().setUI({
    confirmModalState: { ...request, confirmVariant: 'destructive', isOpen: true },
  });

/**
 * Asks for a backup, confirms through `confirm` (Settings' own dialog there, the App's from
 * the menu), restores it and relaunches the app so every part reads the restored files.
 */
export async function restoreSettings(t: TFunction, confirm: (request: ConfirmRequest) => void) {
  const selected = await openDialog({
    directory: false,
    filters: ZIP_FILTERS,
    multiple: false,
    title: t('settings.data.restore.title'),
  });
  if (typeof selected !== 'string') return;
  confirm({
    confirmText: t('settings.data.restore.confirm'),
    message: t('settings.data.restore.message'),
    onConfirm: async () => {
      const toastId = toast.loading(t('settings.data.restore.restoring'));
      try {
        await invoke(Invokes.RestoreSettings, { path: selected });
        await relaunch();
      } catch (error) {
        toast.update(toastId, {
          autoClose: false,
          isLoading: false,
          render: `${t('settings.data.restore.failed')}: ${error}`,
          type: 'error',
        });
      }
    },
    title: t('settings.data.restore.title'),
  });
}
