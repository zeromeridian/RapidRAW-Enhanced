import { useEffect, useRef, useState } from 'react';

import { useEditorStore } from '../store/useEditorStore';

/**
 * How Develop changes photos on the native display: the previous photo stays on screen while the next one renders
 * (`held`), is covered by the background once the next one is ready (`fadingOut`), and the next one is uncovered
 * where it belongs (`fadingIn`).
 */
export type PhotoSwapPhase = 'idle' | 'held' | 'fadingOut' | 'fadingIn';

export const PHOTO_SWAP_FADE_OUT_MS = 100;
export const PHOTO_SWAP_FADE_IN_MS = 150;

/** The native display still shows the previous photo, so the editor must not show or light the next one yet. */
export const isPhotoHeld = (phase: PhotoSwapPhase) => phase === 'held' || phase === 'fadingOut';

/** A photo's place on screen, in pixels relative to the image container. */
export interface PhotoRect {
  height: number;
  left: number;
  top: number;
  width: number;
}

/**
 * Drives the photo swap when another photo is opened. `isPhotoShown` is whether the native display shows the
 * current photo's final render and `photoRect` where it is. `canHold` is false when nothing can be held: without the
 * native display, or while the crop view replaces it. Returns the phase and where the held photo is.
 */
export const usePhotoSwap = (
  photoPath: string | null,
  isPhotoShown: boolean,
  canHold: boolean,
  photoRect: PhotoRect | null,
) => {
  const phase = useEditorStore((s) => s.photoSwapPhase);
  const setEditor = useEditorStore((s) => s.setEditor);
  const [heldRect, setHeldRect] = useState<PhotoRect | null>(null);
  const shownRef = useRef<{ path: string; rect: PhotoRect } | null>(null);

  useEffect(() => {
    if (!isPhotoShown || isPhotoHeld(phase)) return;
    shownRef.current = photoPath && photoRect ? { path: photoPath, rect: photoRect } : null;
  }, [isPhotoShown, phase, photoPath, photoRect]);

  useEffect(() => {
    if (!photoPath || !canHold) {
      shownRef.current = null;
      if (phase !== 'idle') setEditor({ photoSwapPhase: 'idle' });
      return;
    }
    if (isPhotoShown) {
      if (phase === 'held') setEditor({ photoSwapPhase: 'fadingOut' });
      return;
    }
    // Stepping on while the cover fades in keeps holding the photo that is still on the display.
    if (phase === 'fadingOut') {
      setEditor({ photoSwapPhase: 'held' });
    } else if (!isPhotoHeld(phase) && shownRef.current && shownRef.current.path !== photoPath) {
      setHeldRect(shownRef.current.rect);
      setEditor({ photoSwapPhase: 'held' });
    }
  }, [canHold, isPhotoShown, phase, photoPath, setEditor]);

  useEffect(() => {
    if (phase !== 'fadingOut' && phase !== 'fadingIn') return;
    const isFadingOut = phase === 'fadingOut';
    const timeout = window.setTimeout(
      () => setEditor({ photoSwapPhase: isFadingOut ? 'fadingIn' : 'idle' }),
      isFadingOut ? PHOTO_SWAP_FADE_OUT_MS : PHOTO_SWAP_FADE_IN_MS,
    );
    return () => window.clearTimeout(timeout);
  }, [phase, setEditor]);

  useEffect(() => () => setEditor({ photoSwapPhase: 'idle' }), [setEditor]);

  return { heldRect, phase };
};
