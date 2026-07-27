import { useSettingsStore } from '../store/useSettingsStore';
import { AutoStackPair, autoStackImagePairs } from './imageStacks';

export const autoStackCreatedImages = async (pairs: AutoStackPair[]) => {
  if (pairs.length === 0) return;

  const { appSettings, handleSettingsChange, supportedTypes } = useSettingsStore.getState();
  if (!appSettings || !supportedTypes || appSettings.autoStackCreatedImages === false) return;

  const currentStacks = appSettings.imageStacks || [];
  const imageStacks = autoStackImagePairs(
    currentStacks,
    pairs,
    supportedTypes,
    appSettings.expandAutoCreatedStacks !== false,
  );
  if (imageStacks === currentStacks) return;

  await handleSettingsChange({ ...appSettings, imageStacks });
};
