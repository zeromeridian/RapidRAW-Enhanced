/**
 * Zone Tint (Zone Color Grading) helpers shared by its panel and its pickers on the photo:
 * the zone selection and the zones read from the `zoneTint` probe (OKLab L in red, the
 * lightness `apply_zone_tint` in `shader.wgsl` picks its zones by).
 */
import { ZONE_TINT_ZONE_COUNT, ZoneTint } from './adjustments';

export const MIDDLE_GREY_ZONE = 5;

/** `zone_tint::MAX_CENTER_OFFSET`: how far a zone's centre may move from n / 10. */
const MAX_CENTER_OFFSET = 0.05;

/**
 * A rectangle pick keeps the zones that cover at least this share of its pixels, so a few
 * stray pixels (a highlight, noise) do not select a zone of their own.
 */
const MIN_AREA_SHARE = 0.03;

/** The selected zones (sorted) and the zone the wheel shows and Shift-click ranges start from. */
export interface ZoneSelection {
  zones: number[];
  anchor: number;
}

export const INITIAL_ZONE_SELECTION: ZoneSelection = { zones: [MIDDLE_GREY_ZONE], anchor: MIDDLE_GREY_ZONE };

/** The modifier keys of a click on the zone scale or the photo. */
export interface ZoneSelectionModifiers {
  shiftKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
}

/** The selection after a click on a zone: Shift adds the range from the anchor, Cmd/Ctrl toggles the zone. */
export const nextZoneSelection = (
  { zones, anchor }: ZoneSelection,
  zone: number,
  { shiftKey, metaKey, ctrlKey }: ZoneSelectionModifiers,
): ZoneSelection => {
  if (shiftKey) {
    const [from, to] = anchor <= zone ? [anchor, zone] : [zone, anchor];
    return { zones: Array.from({ length: to - from + 1 }, (_, index) => from + index), anchor };
  }
  if (metaKey || ctrlKey) {
    if (!zones.includes(zone)) return { zones: [...zones, zone].sort((a, b) => a - b), anchor: zone };
    const remaining = zones.filter((z) => z !== zone);
    if (remaining.length === 0) return { zones, anchor };
    return { zones: remaining, anchor: remaining.includes(anchor) ? anchor : remaining[0] };
  }
  return { zones: [zone], anchor: zone };
};

/** Zone n's centre in OKLab L, as `zone_tint.rs` places it. */
const zoneCentre = (zoneTint: ZoneTint, zone: number) => {
  const offset = zoneTint.zones[zone]?.centerOffset ?? 0;
  return zone / (ZONE_TINT_ZONE_COUNT - 1) + Math.max(-MAX_CENTER_OFFSET, Math.min(MAX_CENTER_OFFSET, offset));
};

/** The zone whose centre is nearest to an OKLab lightness. */
const nearestZone = (lightness: number, zoneTint: ZoneTint) => {
  let nearest = 0;
  for (let zone = 1; zone < ZONE_TINT_ZONE_COUNT; zone += 1) {
    if (Math.abs(zoneCentre(zoneTint, zone) - lightness) < Math.abs(zoneCentre(zoneTint, nearest) - lightness)) {
      nearest = zone;
    }
  }
  return nearest;
};

/** How many of an RGBA8 `zoneTint` probe's pixels fall in each zone. */
const zoneCounts = (probe: Uint8Array, zoneTint: ZoneTint) => {
  const counts = new Array<number>(ZONE_TINT_ZONE_COUNT).fill(0);
  for (let i = 0; i < probe.length; i += 4) counts[nearestZone(probe[i] / 255, zoneTint)] += 1;
  return counts;
};

/** The zone of a point pick: the zone of the sampled pixels' mean lightness. */
export const samplePickedZone = (probe: Uint8Array, zoneTint: ZoneTint): number | null => {
  const count = probe.length / 4;
  if (count === 0) return null;
  let lightness = 0;
  for (let i = 0; i < probe.length; i += 4) lightness += probe[i] / 255;
  return nearestZone(lightness / count, zoneTint);
};

/**
 * The selection a rectangle pick makes: every zone holding a fair share of its pixels, the
 * anchor on the zone holding the most. With Shift or Cmd/Ctrl they join the current selection.
 */
export const sampleAreaZones = (
  probe: Uint8Array,
  zoneTint: ZoneTint,
  current: ZoneSelection,
  { shiftKey, metaKey, ctrlKey }: ZoneSelectionModifiers,
): ZoneSelection | null => {
  const total = probe.length / 4;
  if (total === 0) return null;
  const counts = zoneCounts(probe, zoneTint);
  // The fullest zone always holds at least 1/11 of the pixels, so `picked` is never empty.
  const picked = counts.flatMap((count, zone) => (count / total >= MIN_AREA_SHARE ? [zone] : []));
  const anchor = counts.indexOf(Math.max(...counts));
  const zones = shiftKey || metaKey || ctrlKey ? [...new Set([...current.zones, ...picked])] : picked;
  return { zones: zones.sort((a, b) => a - b), anchor };
};
