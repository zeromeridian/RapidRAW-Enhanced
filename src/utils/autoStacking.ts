import { useSettingsStore } from '../store/useSettingsStore';
import { AutoStackPair, autoStackImagePairs } from './imageStacks';

/** `outputsStayLocal`: the outputs are exports, which get no sidecar (see `autoStackImagePairs`). */
export const autoStackCreatedImages = async (pairs: AutoStackPair[], outputsStayLocal = false) => {
  if (pairs.length === 0) return;

  const { appSettings, handleSettingsChange, supportedTypes } = useSettingsStore.getState();
  if (!appSettings || !supportedTypes || appSettings.autoStackCreatedImages === false) return;

  const currentStacks = appSettings.imageStacks || [];
  const imageStacks = autoStackImagePairs(
    currentStacks,
    pairs,
    supportedTypes,
    appSettings.expandAutoCreatedStacks !== false,
    outputsStayLocal,
  );
  if (imageStacks === currentStacks) return;

  await handleSettingsChange({ ...appSettings, imageStacks });
};
