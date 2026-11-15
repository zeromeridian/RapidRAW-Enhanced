import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useEditorStore } from '../store/useEditorStore';
import { stripSentMaskData } from '../utils/maskUtils';
import { Invokes } from '../components/ui/AppProperties';

/**
 * Zone Color Grading's Alt/Option mask preview (owner 2026-11-15: like the mask overlay): while
 * `isEnabled`, the overlay of where `zoneTintPreviewZones` colour the photo, rendered by
 * `generate_zone_tint_overlay`, or null. One render runs at a time and the latest choice
 * renders when it returns, so sweeping over the scale never queues GPU work; nothing renders
 * while a slider or the wheel is dragged, and the preview follows an edit once it lands.
 */
export function useZoneTintOverlay(isEnabled: boolean): string | null {
  const zones = useEditorStore((state) => state.zoneTintPreviewZones);
  const [overlayUrl, setOverlayUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!isEnabled) return;
    let isRendering = false;
    let isPending = false;
    let isLive = true;

    const render = () => {
      const { zoneTintPreviewZones, adjustments, patchesSentToBackend, isSliderDragging } = useEditorStore.getState();
      if (!zoneTintPreviewZones?.length || isSliderDragging) return;
      if (isRendering) {
        isPending = true;
        return;
      }
      isRendering = true;
      isPending = false;
      invoke<string>(Invokes.GenerateZoneTintOverlay, {
        jsAdjustments: stripSentMaskData(adjustments, patchesSentToBackend),
        zones: zoneTintPreviewZones,
      })
        .then((url) => {
          // A result for zones no longer chosen is dropped; the pending render follows.
          if (isLive && useEditorStore.getState().zoneTintPreviewZones === zoneTintPreviewZones) {
            setOverlayUrl(url || null);
          }
        })
        // The preview may not be ready yet (a photo is opening); the next change renders again.
        .catch(() => undefined)
        .finally(() => {
          isRendering = false;
          if (isLive && isPending) render();
        });
    };

    render();
    const unsubscribe = useEditorStore.subscribe((state, previous) => {
      // Released: the next preview must not flash this one's overlay first.
      if (!state.zoneTintPreviewZones && previous.zoneTintPreviewZones) setOverlayUrl(null);
      if (
        state.zoneTintPreviewZones !== previous.zoneTintPreviewZones ||
        (state.zoneTintPreviewZones &&
          (state.adjustments !== previous.adjustments || (previous.isSliderDragging && !state.isSliderDragging)))
      ) {
        render();
      }
    });
    return () => {
      isLive = false;
      unsubscribe();
      setOverlayUrl(null);
    };
  }, [isEnabled]);

  return isEnabled && zones?.length ? overlayUrl : null;
}
