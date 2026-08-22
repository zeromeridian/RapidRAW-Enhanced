export interface PlusFeatures {
  layerMode: boolean;
}

export type InitialImageLayerPlacement = 'fit-to-canvas' | 'native-pixels';

const enabled = (value: string | boolean | undefined): boolean => value === true || value === 'true';

export const parseInitialImageLayerPlacement = (
  value: string | undefined,
): InitialImageLayerPlacement => (value === 'native-pixels' ? 'native-pixels' : 'fit-to-canvas');

/**
 * ThisIsRAW Plus is developer-only. Vite loads `.env.local` automatically and
 * the repository ignores `*.local`, so the override is never shipped or
 * synchronized through application settings.
 */
export const plusFeatures: Readonly<PlusFeatures> = Object.freeze({
  layerMode: enabled(import.meta.env.VITE_THISISRAW_PLUS_LAYER_MODE),
});

export const isPlusFeatureEnabled = (feature: keyof PlusFeatures): boolean => plusFeatures[feature];

/**
 * A local developer preference used only when creating a new image layer.
 * The resolved mode is persisted on the layer, so this value never changes an
 * existing composition.
 */
export const defaultInitialImageLayerPlacement = parseInitialImageLayerPlacement(
  import.meta.env.VITE_THISISRAW_PLUS_DEFAULT_IMAGE_LAYER_PLACEMENT,
);
