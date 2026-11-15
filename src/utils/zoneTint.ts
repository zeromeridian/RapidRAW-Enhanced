/**
 * Zone Tint (Zone Color Grading) helpers shared by its panel and its pickers on the photo:
 * the zone selection and the zones read from the `zoneTint` probe (OKLab L in red, the
 * lightness `apply_zone_tint` in `shader.wgsl` picks its zones by).
 */
import {
  BlendPadCurve,
  ZONE_TINT_ZONE_COUNT,
  ZoneTint,
  ZoneTintGrade,
  ZoneTintZone,
  createZoneTintGrade,
} from './adjustments';
import { applyBlendPadCurve } from './blendPad';

export const MIDDLE_GREY_ZONE = 5;

/** The Zone System's names for zones 0–X. */
export const ZONE_NAMES = ['0', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];

/** `zone_tint::MAX_CENTER_OFFSET`: how far a zone's centre may move from n / 10. */
const MAX_CENTER_OFFSET = 0.05;

/**
 * A rectangle pick keeps the zones that cover at least this share of its pixels, so a few
 * stray pixels (a highlight, noise) do not select a zone of their own.
 */
const MIN_AREA_SHARE = 0.03;

/** `zone_tint::MAX_STRENGTH` and the luminance range: the sum of overlapping grades stops there. */
const MAX_STRENGTH = 100;
const MAX_LUMINANCE = 100;
/** How far saved zones may differ from their grades' sum (rounding) and still match it. */
const SUM_TOLERANCE = 0.01;

export const NEUTRAL_ZONE: ZoneTintZone = { hue: 0, strength: 0, luminance: 0 };

/**
 * The selected zones (sorted), the zone the wheel shows and Shift-click ranges start from, and
 * the grade the wheel edits: null until the selection is coloured, which creates a new grade.
 */
export interface ZoneSelection {
  zones: number[];
  anchor: number;
  gradeId: string | null;
}

export const INITIAL_ZONE_SELECTION: ZoneSelection = {
  zones: [MIDDLE_GREY_ZONE],
  anchor: MIDDLE_GREY_ZONE,
  gradeId: null,
};

export const luminanceOf = (zone: ZoneTintZone) => zone.luminance ?? 0;

const isAdjusted = (zone: ZoneTintZone) => zone.strength > 0 || luminanceOf(zone) !== 0;

/** A zone's colour as a point on the colour wheel: the hue's direction, the strength's length. */
export const tintVector = ({ hue, strength }: ZoneTintZone) => {
  const angle = (hue * Math.PI) / 180;
  return [strength * Math.cos(angle), strength * Math.sin(angle)];
};

/** The hue (degrees) of a colour-wheel point, or `fallback` at the centre. */
export const vectorHue = (x: number, y: number, fallback: number) =>
  Math.hypot(x, y) > 1e-6 ? ((((Math.atan2(y, x) * 180) / Math.PI) % 360) + 360) % 360 : fallback;

/** Whether a grade is shown, so it renders and combines with the others. */
export const isGradeShown = (grade: ZoneTintGrade) => grade.visible !== false;

/** The grade shown or hidden; a shown grade carries no flag, as in edits made before the toggle. */
const withGradeShown = ({ visible: _visible, ...grade }: ZoneTintGrade, isShown: boolean): ZoneTintGrade =>
  isShown ? grade : { ...grade, visible: false };

/** Shows or hides the grade `gradeId`. */
export const setGradeShown = (grades: ZoneTintGrade[], gradeId: string, isShown: boolean) =>
  grades.map((grade) => (grade.id === gradeId ? withGradeShown(grade, isShown) : grade));

/** The zones in a grade, darkest first. */
export const gradeZones = (grade: ZoneTintGrade) => grade.zones.flatMap((settings, zone) => (settings ? [zone] : []));

/**
 * An older block without grades as grades: each run of neighbouring zones with the same
 * settings becomes one, so the list and the render stay as they were.
 */
const gradesFromZones = (zones: ZoneTintZone[]): ZoneTintGrade[] => {
  const grades: ZoneTintGrade[] = [];
  let run: { from: number; settings: ZoneTintZone } | null = null;
  const close = (to: number) => {
    if (!run) return;
    const { from, settings } = run;
    // A fixed id, since this runs on every render until the first edit saves the grades.
    grades.push(
      createZoneTintGrade(
        Array.from({ length: ZONE_TINT_ZONE_COUNT }, (_, zone) =>
          zone >= from && zone <= to
            ? { hue: settings.hue, strength: settings.strength, luminance: luminanceOf(settings) }
            : null,
        ),
        `zones-${from}`,
      ),
    );
    run = null;
  };
  const isSame = (a: ZoneTintZone, b: ZoneTintZone) =>
    a.strength === b.strength && luminanceOf(a) === luminanceOf(b) && (a.strength <= 0 || a.hue === b.hue);
  for (let zone = 0; zone < ZONE_TINT_ZONE_COUNT; zone += 1) {
    const settings = zones[zone] ?? NEUTRAL_ZONE;
    if (run && !(isAdjusted(settings) && isSame(run.settings, settings))) close(zone - 1);
    if (!run && isAdjusted(settings)) run = { from: zone, settings };
  }
  close(ZONE_TINT_ZONE_COUNT - 1);
  return grades;
};

/**
 * The shown grades' sum per zone, which Rust renders: their colours add on the colour wheel
 * (opposite hues soften towards neutral) and their luminances add, each within its range. Hidden
 * grades are left out. Advanced mode's per-zone values come from `zones`.
 */
const sumGrades = (grades: ZoneTintGrade[], zones: ZoneTintZone[]): ZoneTintZone[] =>
  Array.from({ length: ZONE_TINT_ZONE_COUNT }, (_, zone) => {
    let x = 0;
    let y = 0;
    let luminance = 0;
    grades.forEach((grade) => {
      const settings = grade.zones[zone];
      if (!settings || !isGradeShown(grade)) return;
      const [gx, gy] = tintVector(settings);
      x += gx;
      y += gy;
      luminance += luminanceOf(settings);
    });
    return {
      ...(zones[zone] ?? NEUTRAL_ZONE),
      hue: vectorHue(x, y, 0),
      strength: Math.min(Math.hypot(x, y), MAX_STRENGTH),
      luminance: Math.max(-MAX_LUMINANCE, Math.min(MAX_LUMINANCE, luminance)),
    };
  });

/** Whether two zones render alike (the hue only counts where there is colour). */
const isSameRender = (a: ZoneTintZone, b: ZoneTintZone) => {
  const hueDistance = Math.abs(((((a.hue - b.hue) % 360) + 540) % 360) - 180);
  return (
    Math.abs(a.strength - b.strength) < SUM_TOLERANCE &&
    Math.abs(luminanceOf(a) - luminanceOf(b)) < SUM_TOLERANCE &&
    (Math.max(a.strength, b.strength) < SUM_TOLERANCE || hueDistance < SUM_TOLERANCE)
  );
};

/**
 * The block's grades. An older block without them reads its zones as grades, and so does a
 * block whose zones no longer match its grades' sum: a build before grades changed the zones
 * and kept the stale grades, and the zones are what renders.
 */
export const zoneTintGrades = (zoneTint: ZoneTint): ZoneTintGrade[] => {
  const { grades, zones } = zoneTint;
  if (!grades) return gradesFromZones(zones);
  const sum = sumGrades(grades, zones);
  return sum.every((zone, index) => isSameRender(zone, zones[index] ?? NEUTRAL_ZONE)) ? grades : gradesFromZones(zones);
};

/** The block with these grades and, in `zones`, their sum (`sumGrades`). */
export const withZoneTintGrades = (zoneTint: ZoneTint, grades: ZoneTintGrade[]): ZoneTint => ({
  ...zoneTint,
  grades,
  zones: sumGrades(grades, zoneTint.zones),
});

/**
 * Writes `change` into every zone of the grade `gradeId`, keeping their other settings; a grade
 * that does not exist (a new selection, or one an undo removed) is added with `zones`. Editing a
 * hidden grade shows it again, so the edit is visible (owner, 2026-11-15).
 */
export const updateGrade = (
  grades: ZoneTintGrade[],
  gradeId: string,
  zones: number[],
  change: Partial<ZoneTintZone>,
): ZoneTintGrade[] => {
  const grade = grades.find((g) => g.id === gradeId);
  if (!grade) {
    const members = Array.from({ length: ZONE_TINT_ZONE_COUNT }, (_, zone) =>
      zones.includes(zone) ? { ...NEUTRAL_ZONE, ...change } : null,
    );
    return [...grades, createZoneTintGrade(members, gradeId)];
  }
  return grades.map((g) =>
    g.id === gradeId
      ? withGradeShown({ ...g, zones: g.zones.map((settings) => settings && { ...settings, ...change }) }, true)
      : g,
  );
};

/**
 * Fill between: one grade on the zones strictly between `from` and `to` that blends the colour
 * there (the sum of every grade) at one end into the other's along the curve, on the colour
 * wheel, as the shader sums the zones' colours, and luminance likewise. Opposite hues (cool
 * shadows, warm highlights) meet in a soft neutral instead of sweeping through the hues between
 * them, and an untinted end fades the other's colour out without changing its hue. The ramp
 * replaces the other grades on those zones (owner, 2026-11-14), hidden ones too, and its ends are
 * what the shown grades sum to there (owner, 2026-11-15); a grade left empty is removed.
 */
export const fillGrades = (zoneTint: ZoneTint, from: number, to: number, curve: BlendPadCurve): ZoneTintGrade[] => {
  const start = zoneTint.zones[from] ?? NEUTRAL_ZONE;
  const end = zoneTint.zones[to] ?? NEUTRAL_ZONE;
  const [startX, startY] = tintVector(start);
  const [endX, endY] = tintVector(end);
  const isBetween = (zone: number) => zone > from && zone < to;
  const ramp = createZoneTintGrade(
    Array.from({ length: ZONE_TINT_ZONE_COUNT }, (_, zone) => {
      if (!isBetween(zone)) return null;
      const share = applyBlendPadCurve(curve, (zone - from) / (to - from));
      const x = startX + (endX - startX) * share;
      const y = startY + (endY - startY) * share;
      return {
        hue: vectorHue(x, y, start.strength > 0 ? start.hue : end.hue),
        strength: Math.hypot(x, y),
        luminance: luminanceOf(start) + (luminanceOf(end) - luminanceOf(start)) * share,
      };
    }),
  );
  const others = zoneTintGrades(zoneTint)
    .map((grade) => ({ ...grade, zones: grade.zones.map((settings, zone) => (isBetween(zone) ? null : settings)) }))
    .filter((grade) => grade.zones.some(Boolean));
  return [...others, ramp];
};

/** Whether a grade gives each of its zones the same settings (not a Fill between ramp). */
export const isUniformGrade = (grade: ZoneTintGrade) => {
  const [first, ...rest] = gradeZones(grade).map((zone) => grade.zones[zone]!);
  return rest.every(
    (settings) =>
      settings.hue === first.hue &&
      settings.strength === first.strength &&
      luminanceOf(settings) === luminanceOf(first),
  );
};

/**
 * The zones a shown grade shares with any other shown grade that changes them; hidden grades do
 * not combine, so they neither overlap nor are overlapped.
 */
export const overlappingZones = (grade: ZoneTintGrade, grades: ZoneTintGrade[]) =>
  isGradeShown(grade)
    ? gradeZones(grade).filter((zone) =>
        grades.some(
          (other) =>
            other.id !== grade.id && isGradeShown(other) && other.zones[zone] && isAdjusted(other.zones[zone]!),
        ),
      )
    : [];

/** The modifier keys of a click on the zone scale or the photo. */
export interface ZoneSelectionModifiers {
  shiftKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
}

/**
 * The selection after a click on a zone: Shift adds the range from the anchor, Cmd/Ctrl toggles
 * the zone. A new selection is not a grade yet; colouring it creates one.
 */
export const nextZoneSelection = (
  current: ZoneSelection,
  zone: number,
  { shiftKey, metaKey, ctrlKey }: ZoneSelectionModifiers,
): ZoneSelection => {
  const { zones, anchor } = current;
  if (shiftKey) {
    const [from, to] = anchor <= zone ? [anchor, zone] : [zone, anchor];
    return { zones: Array.from({ length: to - from + 1 }, (_, index) => from + index), anchor, gradeId: null };
  }
  if (metaKey || ctrlKey) {
    if (!zones.includes(zone)) return { zones: [...zones, zone].sort((a, b) => a - b), anchor: zone, gradeId: null };
    const remaining = zones.filter((z) => z !== zone);
    if (remaining.length === 0) return current;
    return { zones: remaining, anchor: remaining.includes(anchor) ? anchor : remaining[0], gradeId: null };
  }
  return { zones: [zone], anchor: zone, gradeId: null };
};

/** The selection of a grade, so the wheel edits it. */
export const gradeSelection = (grade: ZoneTintGrade): ZoneSelection => {
  const zones = gradeZones(grade);
  return { zones, anchor: zones[0] ?? MIDDLE_GREY_ZONE, gradeId: grade.id };
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

/** The mean OKLab lightness of an RGBA8 `zoneTint` probe's pixels, or null when it is empty. */
const meanLightness = (probe: Uint8Array): number | null => {
  const count = probe.length / 4;
  if (count === 0) return null;
  let lightness = 0;
  for (let i = 0; i < probe.length; i += 4) lightness += probe[i] / 255;
  return lightness / count;
};

/** The zone of a point pick: the zone of the sampled pixels' mean lightness. */
export const samplePickedZone = (probe: Uint8Array, zoneTint: ZoneTint): number | null => {
  const lightness = meanLightness(probe);
  return lightness === null ? null : nearestZone(lightness, zoneTint);
};

/** What the hover readout shows: the zone under the cursor and its lightness (OKLab L, 0–1). */
export interface ZoneHover {
  zone: number;
  lightness: number;
}

/** The hover readout of a probe, read like a point pick. */
export const sampleZoneHover = (probe: Uint8Array, zoneTint: ZoneTint): ZoneHover | null => {
  const lightness = meanLightness(probe);
  return lightness === null ? null : { zone: nearestZone(lightness, zoneTint), lightness };
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
  return { zones: zones.sort((a, b) => a - b), anchor, gradeId: null };
};
