import { useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Invokes } from '../components/ui/AppProperties';
import { ImportVolume, Status } from '../components/ui/ExportImportProperties';
import { isModalOpen, useUIStore } from '../store/useUIStore';
import { useProcessStore } from '../store/useProcessStore';
import { useSettingsStore } from '../store/useSettingsStore';

/** How often the mounted drives are looked at for a new card. */
const CARD_POLL_INTERVAL_MS = 3000;

/**
 * Opens the Import dialog on a memory card or camera drive connected while the app runs, as in
 * Lightroom Classic (Settings → Library, on unless switched off). Drives present at launch, or
 * when the setting is turned on, do not open it; nor does a card while a dialog is open or an
 * import runs.
 */
export function useImportCardWatcher() {
  const isEnabled = useSettingsStore(
    (state) => state.osPlatform !== 'android' && state.appSettings?.importOnCardConnect !== false,
  );

  useEffect(() => {
    if (!isEnabled) return;
    let known: Set<string> | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let isActive = true;

    const poll = async () => {
      try {
        const volumes = await invoke<Array<ImportVolume>>(Invokes.ListImportVolumes);
        if (!isActive) return;
        const connected = known ? volumes.find((volume) => !known?.has(volume.path)) : undefined;
        known = new Set(volumes.map((volume) => volume.path));
        const ui = useUIStore.getState();
        const importStatus = useProcessStore.getState().importState.status;
        const isImporting = importStatus === Status.Importing || importStatus === Status.Cancelling;
        if (connected && !isModalOpen(ui) && !ui.isSettingsOpen && !isImporting) {
          ui.setUI({ importSourcePaths: [connected.path], importTargetFolder: null, isImportModalOpen: true });
        }
      } catch (error) {
        console.error('Failed to look for memory cards:', error);
      }
      if (isActive) timer = setTimeout(poll, CARD_POLL_INTERVAL_MS);
    };

    void poll();
    return () => {
      isActive = false;
      clearTimeout(timer);
    };
  }, [isEnabled]);
}
