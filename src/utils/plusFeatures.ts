export interface PlusFeatures {
  layerMode: boolean;
}

const enabled = (value: string | boolean | undefined): boolean => value === true || value === 'true';

/**
 * ThisIsRAW Plus is developer-only. Vite loads `.env.local` automatically and
 * the repository ignores `*.local`, so the override is never shipped or
 * synchronized through application settings.
 */
export const plusFeatures: Readonly<PlusFeatures> = Object.freeze({
  layerMode: enabled(import.meta.env.VITE_THISISRAW_PLUS_LAYER_MODE),
});

export const isPlusFeatureEnabled = (feature: keyof PlusFeatures): boolean => plusFeatures[feature];
