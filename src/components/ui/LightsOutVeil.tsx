import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

import { Invokes } from './AppProperties';
import { LightsOutMode, useUIStore } from '../../store/useUIStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import {
  buildLightsOutPaths,
  LIGHTS_OUT_DEACTIVATED_EVENT,
  LIGHTS_OUT_FADE_MS,
  LIGHTS_OUT_SCREEN_COLORS,
  lightsOutColor,
  normalizeLightsOutBorderColor,
  normalizeLightsOutBorderWidth,
  normalizeLightsOutDimLevel,
  normalizeLightsOutScreenColor,
} from '../../utils/lightsOut';

/**
 * Lightroom-style Lights Out: one full-window layer that darkens everything except the elements marked with
 * `lightsOutTarget`. The layout underneath never changes; the layer follows the lit elements every frame while it
 * is visible, so zooming, panning, scrolling, and resizing need no notifications. It is positioned inside the app
 * root rather than fixed, so the root's rounded macOS window corners clip it. The backend's cover windows darken the
 * rest of the screen with the same colour and opacity, and report when the window loses focus.
 */
export default function LightsOutVeil() {
  const lightsOutMode = useUIStore((s) => s.lightsOutMode);
  const dimLevel = useSettingsStore((s) => normalizeLightsOutDimLevel(s.appSettings?.lightsOutDimLevel));
  const screenColor = useSettingsStore((s) => normalizeLightsOutScreenColor(s.appSettings?.lightsOutScreenColor));
  const borderColor = useSettingsStore((s) => normalizeLightsOutBorderColor(s.appSettings?.lightsOutBorderColor));
  const borderWidth = useSettingsStore((s) => normalizeLightsOutBorderWidth(s.appSettings?.lightsOutBorderWidth));
  const isOut = lightsOutMode === 'out';
  const opacity = lightsOutMode === 'off' ? 0 : isOut ? 1 : dimLevel / 100;
  const pathRef = useRef<SVGPathElement>(null);
  const borderPathRef = useRef<SVGPathElement>(null);
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
    const cover =
      lightsOutMode === 'off'
        ? null
        : { blocksClicks: isOut, color: lightsOutColor(lightsOutMode, screenColor), opacity };
    invoke(Invokes.SetLightsOutCover, { cover }).catch((error) =>
      console.error('Failed to update the Lights Out screen cover:', error),
    );
  }, [isOut, lightsOutMode, opacity, screenColor]);

  useEffect(() => {
    const unlisten = listen(LIGHTS_OUT_DEACTIVATED_EVENT, () => useUIStore.getState().setUI({ lightsOutMode: 'off' }));
    return () => {
      unlisten.then((unlistenFn) => unlistenFn());
    };
  }, []);

  // The border belongs to full Lights Out only.
  const shownBorderWidth = shownMode === 'out' ? borderWidth : 0;

  useEffect(() => {
    const path = pathRef.current;
    const borderPath = borderPathRef.current;
    if (!isTracking || !path || !borderPath) return;

    let frame = 0;
    let last = { veil: '', border: '' };
    const track = () => {
      const next = buildLightsOutPaths(shownBorderWidth);
      if (next.veil !== last.veil) path.setAttribute('d', next.veil);
      if (next.border !== last.border) borderPath.setAttribute('d', next.border);
      last = next;
      frame = requestAnimationFrame(track);
    };
    track();

    return () => {
      cancelAnimationFrame(frame);
      path.removeAttribute('d');
      borderPath.removeAttribute('d');
    };
  }, [isTracking, shownBorderWidth]);

  const fill = lightsOutColor(shownMode, screenColor);
  const pointerEvents = isOut ? 'fill' : 'none';

  return (
    <svg
      aria-hidden="true"
      className="absolute inset-0 z-50 h-full w-full pointer-events-none"
      style={{ opacity, transition: `opacity ${LIGHTS_OUT_FADE_MS}ms ease-in-out` }}
    >
      <path
        fillRule="evenodd"
        pointerEvents={pointerEvents}
        ref={pathRef}
        style={{ fill, transition: `fill ${LIGHTS_OUT_FADE_MS}ms ease-in-out` }}
      />
      <path
        fill={LIGHTS_OUT_SCREEN_COLORS[borderColor]}
        fillRule="evenodd"
        pointerEvents={pointerEvents}
        ref={borderPathRef}
      />
    </svg>
  );
}
