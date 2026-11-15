import { RefObject, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useEditorStore } from '../store/useEditorStore';
import { createZoneTint } from '../utils/adjustments';
import { stripSentMaskData } from '../utils/maskUtils';
import { sampleZoneHover } from '../utils/zoneTint';
import { Invokes } from '../components/ui/AppProperties';
import { TARGETED_SAMPLE_SCREEN_SIZE } from './useTargetedAdjustment';

/** Where on the photo the readout samples: the probe's centre and half-size, as fractions. */
interface HoverPoint {
  x: number;
  y: number;
  radiusX: number;
  radiusY: number;
}

/**
 * Zone Color Grading's hover readout (owner 2026-11-15: whenever its panel is open): while
 * `isEnabled`, the pointer over `frame` (the photo's on-screen rectangle) reads the zone under
 * it through the pickers' `zoneTint` probe into `zoneTintHover`. One probe runs at a time and
 * the latest position is read when it returns, so a fast pointer never queues GPU work; nothing
 * is read while a slider or the wheel is dragged, and the last position is read again after
 * an edit.
 */
export function useZoneHoverReadout(frame: RefObject<Element | null>, isEnabled: boolean) {
  useEffect(() => {
    if (!isEnabled) return;
    const { setEditor } = useEditorStore.getState();
    let point: HoverPoint | null = null;
    let isSampling = false;
    let isPending = false;
    let isLive = true;

    const clear = () => {
      point = null;
      isPending = false;
      if (useEditorStore.getState().zoneTintHover) setEditor({ zoneTintHover: null });
    };

    const sample = () => {
      if (!point) return;
      if (isSampling) {
        isPending = true;
        return;
      }
      const { adjustments, patchesSentToBackend, isSliderDragging } = useEditorStore.getState();
      if (isSliderDragging) return;
      isSampling = true;
      isPending = false;
      invoke<ArrayBuffer>(Invokes.SampleAdjustmentProbe, {
        jsAdjustments: stripSentMaskData(adjustments, patchesSentToBackend),
        ...point,
        probe: 'zoneTint',
      })
        .then((pixels) => {
          if (!isLive || !point) return;
          const zoneTint = useEditorStore.getState().adjustments.zoneTint ?? createZoneTint();
          setEditor({ zoneTintHover: sampleZoneHover(new Uint8Array(pixels), zoneTint) });
        })
        // The preview may not be ready yet (a photo is opening); the next move reads again.
        .catch(() => undefined)
        .finally(() => {
          isSampling = false;
          if (isLive && isPending) sample();
        });
    };

    const handlePointerMove = (e: PointerEvent) => {
      const rect = frame.current?.getBoundingClientRect();
      if (!rect || rect.width <= 0 || rect.height <= 0) return;
      const x = (e.clientX - rect.left) / rect.width;
      const y = (e.clientY - rect.top) / rect.height;
      // Only the photo itself: not the canvas around it, nor a panel or menu above it.
      const isOverPhoto =
        x >= 0 && x <= 1 && y >= 0 && y <= 1 && !!(e.target as Element | null)?.closest?.('[data-zone-hover-area]');
      if (!isOverPhoto) {
        if (point) clear();
        return;
      }
      const half = TARGETED_SAMPLE_SCREEN_SIZE / 2;
      point = { x, y, radiusX: half / rect.width, radiusY: half / rect.height };
      sample();
    };

    const handlePointerOut = (e: PointerEvent) => {
      if (!e.relatedTarget) clear();
    };

    const unsubscribe = useEditorStore.subscribe((state, previous) => {
      if (state.adjustments !== previous.adjustments || (previous.isSliderDragging && !state.isSliderDragging)) {
        sample();
      }
    });

    window.addEventListener('pointermove', handlePointerMove);
    document.addEventListener('pointerout', handlePointerOut);
    window.addEventListener('blur', clear);
    return () => {
      isLive = false;
      unsubscribe();
      window.removeEventListener('pointermove', handlePointerMove);
      document.removeEventListener('pointerout', handlePointerOut);
      window.removeEventListener('blur', clear);
      clear();
    };
  }, [frame, isEnabled]);
}
