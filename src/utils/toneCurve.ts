import { Coord, ParametricCurveSettings } from './adjustments';

/** The shader keeps at most this many points per curve channel (`array<Point, 16>`). */
export const MAX_CURVE_POINTS = 16;

export type ParametricRegion = 'shadows' | 'darks' | 'lights' | 'highlights';

export function buildParametricPoints(settings: ParametricCurveSettings): Array<Coord> {
  const vH = settings.highlights / 100;
  const vL = settings.lights / 100;
  const vD = settings.darks / 100;
  const vS = settings.shadows / 100;

  const blackYOffset = settings.blackLevel;
  const whiteYOffset = settings.whiteLevel;

  const s1 = settings.split1 / 100;
  const s2 = settings.split2 / 100;
  const s3 = settings.split3 / 100;

  const xH = (s3 + 1) / 2;
  const xS = s1 / 2;
  const xs = [0, xS, s1, s2, s3, xH, 1];

  const SLIDER_GAIN = 1.2;
  const MAX_DISPLACEMENT = 0.35;

  const response = (v: number, x: number): number => {
    const headroom = v >= 0 ? 1 - x : x;
    const compressedHeadroom = Math.sqrt(headroom);
    const sigmoid = Math.tanh(v * SLIDER_GAIN);
    return sigmoid * MAX_DISPLACEMENT * compressedHeadroom;
  };

  const ys = [
    0,
    xS + response(vS, xS),
    s1 + (response(vS, s1) + response(vD, s1)) / 2,
    s2 + (response(vD, s2) + response(vL, s2)) / 2,
    s3 + (response(vL, s3) + response(vH, s3)) / 2,
    xH + response(vH, xH),
    1,
  ];

  const clamp = (v: number) => Math.max(0, Math.min(1, v));

  const points = xs.map((x, i) => ({
    x: x * 255,
    y: clamp(ys[i]) * 255,
  }));

  if (points.length >= 2) {
    points[0].y = Math.max(0, Math.min(255, points[0].y + blackYOffset));

    const lastIndex = points.length - 1;
    points[lastIndex].y = Math.max(0, Math.min(255, points[lastIndex].y + whiteYOffset));
  }

  return points;
}

/** The parametric region whose slider moves the curve at `x` (0–255). */
export const getParametricRegion = (settings: ParametricCurveSettings, x: number): ParametricRegion => {
  const position = (x / 255) * 100;
  if (position < settings.split1) return 'shadows';
  if (position < settings.split2) return 'darks';
  if (position < settings.split3) return 'lights';
  return 'highlights';
};

/** The curve's output (0–255) at `x` (0–255), as `apply_curve` in `shader.wgsl` computes it. */
export const evaluateToneCurve = (points: Array<Coord>, x: number): number => {
  const count = points.length;
  if (count < 2) return x;
  if (x <= points[0].x) return points[0].y;
  if (x >= points[count - 1].x) return points[count - 1].y;

  const i = points.findIndex((point, index) => index < count - 1 && x <= points[index + 1].x);
  const p0 = points[Math.max(0, i - 1)];
  const p1 = points[i];
  const p2 = points[i + 1];
  const p3 = points[Math.min(count - 1, i + 2)];
  const deltaBefore = (p1.y - p0.y) / Math.max(0.001, p1.x - p0.x);
  const deltaCurrent = (p2.y - p1.y) / Math.max(0.001, p2.x - p1.x);
  const deltaAfter = (p3.y - p2.y) / Math.max(0.001, p3.x - p2.x);

  const innerTangent = (before: number, after: number) => (before * after <= 0 ? 0 : (before + after) / 2);
  let m1 = i === 0 ? deltaCurrent : innerTangent(deltaBefore, deltaCurrent);
  let m2 = i + 1 === count - 1 ? deltaCurrent : innerTangent(deltaCurrent, deltaAfter);
  if (deltaCurrent !== 0) {
    const alpha = m1 / deltaCurrent;
    const beta = m2 / deltaCurrent;
    if (alpha * alpha + beta * beta > 9) {
      const tau = 3 / Math.sqrt(alpha * alpha + beta * beta);
      m1 *= tau;
      m2 *= tau;
    }
  }

  const dx = p2.x - p1.x;
  if (dx <= 0) return p1.y;
  const t = (x - p1.x) / dx;
  const t2 = t * t;
  const t3 = t2 * t;
  const y =
    (2 * t3 - 3 * t2 + 1) * p1.y + (t3 - 2 * t2 + t) * m1 * dx + (-2 * t3 + 3 * t2) * p2.y + (t3 - t2) * m2 * dx;
  return Math.max(0, Math.min(255, y));
};
