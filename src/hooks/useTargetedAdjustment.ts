import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type Konva from 'konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import { useEditorStore } from '../store/useEditorStore';
import { Adjustments } from '../utils/adjustments';
import { stripSentMaskData } from '../utils/maskUtils';
import {
  TargetedAdjustment,
  TargetedDrag,
  beginTargetedDrag,
  getSampleProbe,
  resetTargetedAdjustment,
} from '../utils/targetedAdjustment';
import { RenderSize } from './useImageRenderSize';
import { Invokes } from '../components/ui/AppProperties';
import { FINE_ADJUSTMENT_MULTIPLIER, hasFineAdjustmentModifier } from '../components/ui/Slider';

/** The side of the sampled square, in screen pixels at any zoom. */
export const TARGETED_SAMPLE_SCREEN_SIZE = 16;
/** Value units per pixel dragged (right or up raises). */
const DRAG_GAIN = 0.5;

interface Coord {
  x: number;
  y: number;
}

interface ActiveDrag {
  last: Coord;
  offset: number;
  appliedOffset: number | null;
  edit: TargetedDrag | null;
}

interface Pick {
  target: TargetedAdjustment;
  maskId: string | null;
  sample(): Promise<Uint8Array>;
}

interface TargetedAdjustmentOptions {
  activeMaskContainerId: string | null;
  getCanvasPointer(stage: Konva.Stage): Coord | null;
  imageRenderSize: RenderSize;
  isMasking: boolean;
  zoomScale: number;
  setAdjustments(fn: (prev: Adjustments) => Adjustments): void;
}

const getClientPoint = (e: MouseEvent | TouchEvent): Coord | undefined => {
  const point = 'touches' in e ? e.touches[0] : e;
  return point && { x: point.clientX, y: point.clientY };
};

const clampOffset = ({ edit }: ActiveDrag, offset: number) =>
  edit ? Math.max(edit.range[0], Math.min(edit.range[1], offset)) : offset;

/** Runs the colour mixer and tone curve pipettes (`targetedAdjustment` in the editor store) on the canvas. */
export function useTargetedAdjustment({
  activeMaskContainerId,
  getCanvasPointer,
  imageRenderSize,
  isMasking,
  zoomScale,
  setAdjustments,
}: TargetedAdjustmentOptions) {
  const target = useEditorStore((state) => state.targetedAdjustment);
  const setEditor = useEditorStore((state) => state.setEditor);
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef<ActiveDrag | null>(null);
  const detachRef = useRef<(() => void) | null>(null);

  const getPick = useCallback(
    (e: KonvaEventObject<MouseEvent | TouchEvent>): Pick | null => {
      const stage = e.target.getStage();
      const pos = stage && getCanvasPointer(stage);
      const maskId = isMasking ? activeMaskContainerId : null;
      if (!target || !pos || (isMasking && !maskId)) return null;
      const { width, height } = imageRenderSize;
      if (pos.x < 0 || pos.y < 0 || pos.x > width || pos.y > height) return null;
      const radius = TARGETED_SAMPLE_SCREEN_SIZE / 2 / zoomScale / width;
      const probe = getSampleProbe(target, maskId);
      return {
        target,
        maskId,
        sample: async () => {
          const { adjustments, patchesSentToBackend } = useEditorStore.getState();
          const pixels = await invoke<ArrayBuffer>(Invokes.SampleAdjustmentProbe, {
            jsAdjustments: stripSentMaskData(adjustments, patchesSentToBackend),
            x: pos.x / width,
            y: pos.y / height,
            radius,
            probe,
          });
          return new Uint8Array(pixels);
        },
      };
    },
    [target, isMasking, activeMaskContainerId, imageRenderSize, zoomScale, getCanvasPointer],
  );

  const applyDrag = useCallback(
    (drag: ActiveDrag) => {
      const { edit } = drag;
      const offset = Math.round(drag.offset);
      // A click without a drag changes nothing (a double-click resets instead).
      if (!edit || offset === (drag.appliedOffset ?? 0)) return;
      drag.appliedOffset = offset;
      setAdjustments((prev) => edit.apply(prev, offset));
    },
    [setAdjustments],
  );

  const end = useCallback(() => {
    detachRef.current?.();
    detachRef.current = null;
    if (!dragRef.current) return;
    dragRef.current = null;
    setIsDragging(false);
    setEditor({ isSliderDragging: false });
  }, [setEditor]);

  const start = useCallback(
    (e: KonvaEventObject<MouseEvent | TouchEvent>) => {
      const pick = getPick(e);
      const clientPoint = getClientPoint(e.evt);
      if (!pick || !clientPoint) return;

      end();
      const drag: ActiveDrag = { last: clientPoint, offset: 0, appliedOffset: null, edit: null };
      dragRef.current = drag;
      setIsDragging(true);
      setEditor({ isSliderDragging: true });

      const onMove = (ev: MouseEvent | TouchEvent) => {
        const point = getClientPoint(ev);
        if (!point) return;
        if (ev.cancelable) ev.preventDefault();
        const multiplier = hasFineAdjustmentModifier(ev) ? FINE_ADJUSTMENT_MULTIPLIER : 1;
        const delta = point.x - drag.last.x - (point.y - drag.last.y);
        drag.offset = clampOffset(drag, drag.offset + delta * DRAG_GAIN * multiplier);
        drag.last = point;
        applyDrag(drag);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('touchmove', onMove, { passive: false });
      window.addEventListener('mouseup', end);
      window.addEventListener('touchend', end);
      window.addEventListener('touchcancel', end);
      detachRef.current = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('touchmove', onMove);
        window.removeEventListener('mouseup', end);
        window.removeEventListener('touchend', end);
        window.removeEventListener('touchcancel', end);
      };

      // The drag can start before the sample arrives; its offset so far applies once it does.
      pick
        .sample()
        .then((pixels) => {
          if (dragRef.current !== drag) return;
          drag.edit = beginTargetedDrag(pick.target, pick.maskId, pixels, useEditorStore.getState().adjustments);
          drag.offset = clampOffset(drag, drag.offset);
          applyDrag(drag);
        })
        .catch((err) => console.error('Failed to sample the preview for a targeted adjustment:', err));
    },
    [getPick, setEditor, applyDrag, end],
  );

  const reset = useCallback(
    (e: KonvaEventObject<MouseEvent>) => {
      const pick = getPick(e);
      if (!pick) return;
      pick
        .sample()
        .then((pixels) => {
          setAdjustments((prev) => resetTargetedAdjustment(pick.target, pick.maskId, pixels, prev) ?? prev);
        })
        .catch((err) => console.error('Failed to sample the preview for a targeted adjustment:', err));
    },
    [getPick, setAdjustments],
  );

  useEffect(() => {
    if (!target) end();
  }, [target, end]);

  useEffect(() => end, [end]);

  return { isActive: target !== null, isDragging, start, reset };
}
