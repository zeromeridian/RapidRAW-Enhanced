/**
 * The colour mixer's eight bands and how strongly each one acts on a sampled area. The
 * band ranges, falloff and saturation gates mirror `apply_hsl_panel` in `shader.wgsl`, so
 * the targeted pipette moves the bands the mixer would apply to those pixels.
 */
export const HSL_MIXER_BANDS = [
  'reds',
  'oranges',
  'yellows',
  'greens',
  'aquas',
  'blues',
  'purples',
  'magentas',
] as const;

export type HslMixerBand = (typeof HSL_MIXER_BANDS)[number];
export type HslMixerProperty = 'hue' | 'saturation' | 'luminance';
/** Each present band's share of the sample, relative to the strongest band (1). */
export type HslPresence = Partial<Record<HslMixerBand, number>>;

const HSL_RANGES: Array<[number, number]> = [
  [358, 35],
  [25, 45],
  [60, 40],
  [115, 90],
  [180, 60],
  [225, 60],
  [280, 55],
  [330, 50],
];

/** Bands weaker than this (relative to the strongest) are left alone. */
const MIN_PRESENCE = 0.03;

const smoothstep = (edge0: number, edge1: number, x: number) => {
  const t = Math.min(Math.max((x - edge0) / (edge1 - edge0), 0), 1);
  return t * t * (3 - 2 * t);
};

const bandInfluence = (hue: number, center: number, width: number) => {
  const dist = Math.min(Math.abs(hue - center), 360 - Math.abs(hue - center));
  const falloff = dist / (width * 0.5);
  return Math.exp(-1.5 * falloff * falloff);
};

const presenceGate = (saturation: number, property: HslMixerProperty) =>
  property === 'luminance' ? smoothstep(0, 1, saturation) : smoothstep(0.05, 0.2, saturation);

const hslBandWeights = (hue: number, saturation: number, property: HslMixerProperty): number[] => {
  const gate = presenceGate(saturation, property);
  const raw = HSL_RANGES.map(([center, width]) => bandInfluence(hue, center, width));
  const total = raw.reduce((sum, v) => sum + v, 0);
  return raw.map((v) => (v / total) * gate);
};

/** The bands present in an RGBA8 `hsl` probe (hue/360, saturation, value per pixel). */
export const sampleHslPresence = (probe: Uint8Array, property: HslMixerProperty): HslPresence => {
  const totals = HSL_RANGES.map(() => 0);
  const count = probe.length / 4;
  for (let i = 0; i < probe.length; i += 4) {
    hslBandWeights((probe[i] / 255) * 360, probe[i + 1] / 255, property).forEach((w, band) => {
      totals[band] += w;
    });
  }
  const max = Math.max(...totals);
  const presence: HslPresence = {};
  if (count === 0 || max / count < MIN_PRESENCE) return presence;
  HSL_MIXER_BANDS.forEach((band, i) => {
    if (totals[i] / max >= MIN_PRESENCE) presence[band] = totals[i] / max;
  });
  return presence;
};
