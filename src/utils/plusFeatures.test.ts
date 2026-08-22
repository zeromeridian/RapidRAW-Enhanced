import { describe, expect, it } from 'vitest';
import { parseInitialImageLayerPlacement } from './plusFeatures';

describe('Plus developer configuration', () => {
  it('defaults new image layers to fit the canvas', () => {
    expect(parseInitialImageLayerPlacement(undefined)).toBe('fit-to-canvas');
  });

  it('accepts the native-pixel placement override', () => {
    expect(parseInitialImageLayerPlacement('native-pixels')).toBe('native-pixels');
  });

  it('fails closed to the fit-to-canvas default for invalid local configuration', () => {
    expect(parseInitialImageLayerPlacement('unexpected-value')).toBe('fit-to-canvas');
  });
});
