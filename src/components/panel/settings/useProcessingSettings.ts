import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { relaunch } from '@tauri-apps/plugin-process';
import { AppSettings } from '../../ui/AppProperties';

/** Settings the processing engine reads only at launch; they are saved with "Save & Relaunch". */
const RESTART_KEYS = new Set([
  'processingBackend',
  'linuxGpuOptimization',
  'useWgpuRenderer',
  'thumbnailWorkerThreads',
]);
/** Settings that change how RAW files decode, so the decoded images in memory are dropped. */
const DECODE_KEYS = new Set([
  'rawHighlightCompression',
  'rawPreprocessingColorNr',
  'rawPreprocessingSharpening',
  'applyPreprocessingToNonRaws',
]);

const readProcessingSettings = (appSettings: AppSettings | null, osPlatform: string) => ({
  editorPreviewResolution: appSettings?.editorPreviewResolution || 1920,
  thumbnailResolution: appSettings?.thumbnailResolution || 720,
  rawHighlightCompression: appSettings?.rawHighlightCompression ?? 2.5,
  processingBackend: appSettings?.processingBackend || 'auto',
  linuxGpuOptimization: appSettings?.linuxGpuOptimization ?? false,
  highResZoomMultiplier: appSettings?.highResZoomMultiplier || 1.0,
  useFullDpiRendering: appSettings?.useFullDpiRendering ?? false,
  useWgpuRenderer: appSettings?.useWgpuRenderer ?? (osPlatform === 'linux' || osPlatform === 'android' ? false : true),
  thumbnailWorkerThreads: appSettings?.thumbnailWorkerThreads ?? 4,
  imageCacheSize: appSettings?.imageCacheSize ?? 5,
  rawPreprocessingColorNr: appSettings?.rawPreprocessingColorNr ?? 0.5,
  rawPreprocessingSharpening: appSettings?.rawPreprocessingSharpening ?? 0.35,
  applyPreprocessingToNonRaws: appSettings?.applyPreprocessingToNonRaws ?? false,
});

export type ProcessingSettings = ReturnType<typeof readProcessingSettings>;

/**
 * The Processing page's values, kept by the Settings window so a change that needs a relaunch
 * stays pending while the user moves between pages or searches.
 */
export const useProcessingSettings = (
  appSettings: AppSettings | null,
  onSettingsChange: (settings: AppSettings) => Promise<void>,
  osPlatform: string,
) => {
  const [values, setValues] = useState(() => readProcessingSettings(appSettings, osPlatform));
  const [restartRequired, setRestartRequired] = useState(false);

  useEffect(() => {
    setValues(readProcessingSettings(appSettings, osPlatform));
    setRestartRequired(false);
  }, [appSettings, osPlatform]);

  const change = async <K extends keyof ProcessingSettings>(key: K, value: ProcessingSettings[K]) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    if (RESTART_KEYS.has(key)) {
      setRestartRequired(true);
      return;
    }
    if (!appSettings) return;
    await onSettingsChange({ ...appSettings, [key]: value });
    if (DECODE_KEYS.has(key)) {
      await invoke('clear_image_caches');
    }
  };

  const saveAndRelaunch = async () => {
    if (!appSettings) return;
    await onSettingsChange({ ...appSettings, ...values });
    await relaunch();
  };

  return { values, restartRequired, change, saveAndRelaunch };
};

export type ProcessingSettingsState = ReturnType<typeof useProcessingSettings>;
