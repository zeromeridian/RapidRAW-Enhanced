import { useEffect, useId, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

import { Invokes } from './AppProperties';
import { LightsOutMode, useUIStore } from '../../store/useUIStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { PHOTO_SWAP_FADE_IN_MS, PHOTO_SWAP_FADE_OUT_MS } from '../../hooks/usePhotoSwap';
import {
  buildLightsOutPaths,
  LIGHTS_OUT_DEACTIVATED_EVENT,
  LIGHTS_OUT_FADE_MS,
  LIGHTS_OUT_SCREEN_COLORS,
  lightsOutColor,
  lightsOutOpacity,
  normalizeLightsOutBorderColor,
  normalizeLightsOutBorderWidth,
  normalizeLightsOutDimLevel,
  normalizeLightsOutScreenColor,
} from '../../utils/lightsOut';

/** After a change that can move a lit element, it is followed every frame this long, covering the transitions it starts. */
const TRACK_AFTER_CHANGE_MS = 500;
/** Catches the rare layout change that none of the watched events announce. */
const SAFETY_REFRESH_MS = 1000;
/** Document events after which lit elements may have moved; `load` and `scroll` do not bubble, so they are captured. */
const WAKE_EVENTS = ['animationstart', 'load', 'scroll', 'transitionend', 'transitionrun'] as const;
const WAKE_EVENT_OPTIONS: AddEventListenerOptions = { capture: true, passive: true };

/**
 * Lightroom-style Lights Out: one full-window layer that darkens everything except the elements marked with
 * `lightsOutTarget`. The layout underneath never changes. While the layer is visible it re-measures the lit elements
 * only after something that can move them (DOM and style changes, scrolling, resizing, loading, CSS transitions),
 * following every frame for a moment afterwards, so zooming, panning, and animated layout changes need no
 * notifications and an idle screen costs nothing. It is positioned inside the app root rather than fixed, so the
 * root's rounded macOS window corners clip it. The backend's cover windows darken the rest of the screen with the
 * same colour and opacity, and report when the window loses focus.
 */
export default function LightsOutVeil() {
  const lightsOutMode = useUIStore((s) => s.lightsOutMode);
  const dimLevel = useSettingsStore((s) => normalizeLightsOutDimLevel(s.appSettings?.lightsOutDimLevel));
  const screenColor = useSettingsStore((s) => normalizeLightsOutScreenColor(s.appSettings?.lightsOutScreenColor));
  const borderColor = useSettingsStore((s) => normalizeLightsOutBorderColor(s.appSettings?.lightsOutBorderColor));
  const borderWidth = useSettingsStore((s) => normalizeLightsOutBorderWidth(s.appSettings?.lightsOutBorderWidth));
  const isOut = lightsOutMode === 'out';
  const opacity = lightsOutOpacity(lightsOutMode, dimLevel);
  const svgRef = useRef<SVGSVGElement>(null);
  const pathRef = useRef<SVGPathElement>(null);
  const borderPathRef = useRef<SVGPathElement>(null);
  const borderClipRef = useRef<SVGPathElement>(null);
  const borderClipId = `lights-out-border-clip-${useId().replace(/:/g, '')}`;
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
    const svg = svgRef.current;
    const path = pathRef.current;
    const borderPath = borderPathRef.current;
    const borderClip = borderClipRef.current;
    if (!isTracking || !svg || !path || !borderPath || !borderClip) return;

    let veil = '';
    // The last border drawn. When the border goes away it fades out in this shape, inside the clip it had, so the
    // photo it framed can change underneath; it fades in again with the next photo's border.
    let border = '';
    let isBorderShown = false;
    borderPath.style.opacity = '0';
    const update = () => {
      const next = buildLightsOutPaths(shownBorderWidth);
      if (next.veil !== veil) path.setAttribute('d', next.veil);
      if (next.border) {
        if (next.border !== border) borderPath.setAttribute('d', next.border);
        if (next.veil !== veil || !isBorderShown) borderClip.setAttribute('d', next.veil);
        border = next.border;
      }
      veil = next.veil;
      if (!!next.border !== isBorderShown) {
        isBorderShown = !!next.border;
        borderPath.style.transition = `opacity ${isBorderShown ? PHOTO_SWAP_FADE_IN_MS : PHOTO_SWAP_FADE_OUT_MS}ms ease-in-out`;
        borderPath.style.opacity = isBorderShown ? '1' : '0';
      }
    };

    let frame = 0;
    let trackUntil = 0;
    const track = () => {
      update();
      frame = performance.now() < trackUntil ? requestAnimationFrame(track) : 0;
    };
    const wake = () => {
      trackUntil = performance.now() + TRACK_AFTER_CHANGE_MS;
      if (!frame) frame = requestAnimationFrame(track);
    };
    // The layer's own updates are not changes to follow.
    const observer = new MutationObserver((records) => {
      if (records.some((record) => !svg.contains(record.target))) wake();
    });
    observer.observe(document.body, { attributes: true, childList: true, subtree: true });
    WAKE_EVENTS.forEach((type) => document.addEventListener(type, wake, WAKE_EVENT_OPTIONS));
    window.addEventListener('resize', wake);
    const refresh = window.setInterval(update, SAFETY_REFRESH_MS);
    update();
    wake();

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      WAKE_EVENTS.forEach((type) => document.removeEventListener(type, wake, WAKE_EVENT_OPTIONS));
      window.removeEventListener('resize', wake);
      window.clearInterval(refresh);
      path.removeAttribute('d');
      borderPath.removeAttribute('d');
      borderPath.style.removeProperty('opacity');
      borderPath.style.removeProperty('transition');
      borderClip.removeAttribute('d');
    };
  }, [isTracking, shownBorderWidth]);

  const fill = lightsOutColor(shownMode, screenColor);
  const pointerEvents = isOut ? 'fill' : 'none';

  return (
    <svg
      aria-hidden="true"
      ref={svgRef}
      className="absolute inset-0 z-50 h-full w-full pointer-events-none"
      style={{ opacity, transition: `opacity ${LIGHTS_OUT_FADE_MS}ms ease-in-out` }}
    >
      <path
        fillRule="evenodd"
        pointerEvents={pointerEvents}
        ref={pathRef}
        style={{ fill, transition: `fill ${LIGHTS_OUT_FADE_MS}ms ease-in-out` }}
      />
      <defs>
        <clipPath id={borderClipId}>
          <path clipRule="evenodd" ref={borderClipRef} />
        </clipPath>
      </defs>
      <path
        clipPath={`url(#${borderClipId})`}
        fill={LIGHTS_OUT_SCREEN_COLORS[borderColor]}
        fillRule="nonzero"
        pointerEvents={pointerEvents}
        ref={borderPathRef}
      />
    </svg>
  );
}
