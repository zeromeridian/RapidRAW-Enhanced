import { useEffect, useRef, useState } from 'react';

import { LightsOutMode, useUIStore } from '../../store/useUIStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import {
  buildLightsOutPath,
  LIGHTS_OUT_FADE_MS,
  LIGHTS_OUT_SCREEN_COLORS,
  normalizeLightsOutDimLevel,
  normalizeLightsOutScreenColor,
} from '../../utils/lightsOut';

/**
 * Lightroom-style Lights Out: one full-window layer that darkens everything except the elements marked with
 * `lightsOutTarget`. The layout underneath never changes; the layer follows the lit elements every frame while it
 * is visible, so zooming, panning, scrolling, and resizing need no notifications. It is positioned inside the app
 * root rather than fixed, so the root's rounded macOS window corners clip it.
 */
export default function LightsOutVeil() {
  const lightsOutMode = useUIStore((s) => s.lightsOutMode);
  const dimLevel = useSettingsStore((s) => normalizeLightsOutDimLevel(s.appSettings?.lightsOutDimLevel));
  const screenColor = useSettingsStore((s) => normalizeLightsOutScreenColor(s.appSettings?.lightsOutScreenColor));
  const pathRef = useRef<SVGPathElement>(null);
  // The last active mode keeps its colour while the layer fades out.
  const [shownMode, setShownMode] = useState<Exclude<LightsOutMode, 'off'>>('dim');
  const [isTracking, setIsTracking] = useState(false);

  useEffect(() => {
    if (lightsOutMode !== 'off') {
      setShownMode(lightsOutMode);
      setIsTracking(true);
      return;
    }
    const timeout = window.setTimeout(() => setIsTracking(false), LIGHTS_OUT_FADE_MS);
    return () => window.clearTimeout(timeout);
  }, [lightsOutMode]);

  useEffect(() => {
    const path = pathRef.current;
    if (!isTracking || !path) return;

    let frame = 0;
    let lastPath = '';
    const track = () => {
      const nextPath = buildLightsOutPath();
      if (nextPath !== lastPath) {
        lastPath = nextPath;
        path.setAttribute('d', nextPath);
      }
      frame = requestAnimationFrame(track);
    };
    track();

    return () => {
      cancelAnimationFrame(frame);
      path.removeAttribute('d');
    };
  }, [isTracking]);

  const isOut = lightsOutMode === 'out';
  const opacity = lightsOutMode === 'off' ? 0 : isOut ? 1 : dimLevel / 100;
  const fill = shownMode === 'out' ? LIGHTS_OUT_SCREEN_COLORS[screenColor] : '#000000';

  return (
    <svg
      aria-hidden="true"
      className="absolute inset-0 z-50 h-full w-full pointer-events-none"
      style={{ opacity, transition: `opacity ${LIGHTS_OUT_FADE_MS}ms ease-in-out` }}
    >
      <path
        fillRule="evenodd"
        pointerEvents={isOut ? 'fill' : 'none'}
        ref={pathRef}
        style={{ fill, transition: `fill ${LIGHTS_OUT_FADE_MS}ms ease-in-out` }}
      />
    </svg>
  );
}
