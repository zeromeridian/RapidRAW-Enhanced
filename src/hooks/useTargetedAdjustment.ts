import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type Konva from 'konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import { useEditorStore } from '../store/useEditorStore';
import { Adjustments, MAX_POINT_COLORS, createPointColor, createZoneTint } from '../utils/adjustments';
import { samplePickedColor } from '../utils/pointColor';
import { ZoneSelectionModifiers, nextZoneSelection, sampleAreaZones, samplePickedZone } from '../utils/zoneTint';
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
/** A rectangle pick narrower or lower than this, in screen pixels, counts as a click. */
const MIN_PICK_AREA_SCREEN_SIZE = 4;
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

/** A rectangle on the photo, in the canvas's render pixels. */
export interface PickArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Pick {
  target: TargetedAdjustment;
  maskId: string | null;
  point: Coord;
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

const areaBetween = (a: Coord, b: Coord): PickArea => ({
  x: Math.min(a.x, b.x),
  y: Math.min(a.y, b.y),
  width: Math.abs(b.x - a.x),
  height: Math.abs(b.y - a.y),
});

const currentZoneTint = () => useEditorStore.getState().adjustments.zoneTint ?? createZoneTint();

/**
 * Runs the colour mixer, tone curve, Point Color and Zone Color Grading pipettes
 * (`targetedAdjustment` in the editor store) on the canvas.
 */
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
  const [pickArea, setPickArea] = useState<PickArea | null>(null);
  const dragRef = useRef<ActiveDrag | null>(null);
  const detachRef = useRef<(() => void) | null>(null);

  /** The preview's pixels in `area` as `target` reads them. */
  const sampleArea = useCallback(
    async (target: TargetedAdjustment, maskId: string | null, area: PickArea) => {
      const { width, height } = imageRenderSize;
      const { adjustments, patchesSentToBackend } = useEditorStore.getState();
      const pixels = await invoke<ArrayBuffer>(Invokes.SampleAdjustmentProbe, {
        jsAdjustments: stripSentMaskData(adjustments, patchesSentToBackend),
        x: (area.x + area.width / 2) / width,
        y: (area.y + area.height / 2) / height,
        radiusX: area.width / 2 / width,
        radiusY: area.height / 2 / height,
        probe: getSampleProbe(target, maskId),
      });
      return new Uint8Array(pixels);
    },
    [imageRenderSize],
  );

  const getPick = useCallback(
    (e: KonvaEventObject<MouseEvent | TouchEvent>): Pick | null => {
      const stage = e.target.getStage();
      const pos = stage && getCanvasPointer(stage);
      const maskId = isMasking ? activeMaskContainerId : null;
      if (!target || !pos || (isMasking && !maskId)) return null;
      const { width, height } = imageRenderSize;
      if (pos.x < 0 || pos.y < 0 || pos.x > width || pos.y > height) return null;
      const size = TARGETED_SAMPLE_SCREEN_SIZE / zoomScale;
      const square = { x: pos.x - size / 2, y: pos.y - size / 2, width: size, height: size };
      return { target, maskId, point: pos, sample: () => sampleArea(target, maskId, square) };
    },
    [target, isMasking, activeMaskContainerId, imageRenderSize, zoomScale, getCanvasPointer, sampleArea],
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
    setPickArea(null);
    if (!dragRef.current) return;
    dragRef.current = null;
    setIsDragging(false);
    setEditor({ isSliderDragging: false });
  }, [setEditor]);

  /** Point Color: a click adds a point on the colour under the cursor and selects it. */
  const addPointColor = useCallback(
    (pick: Pick) => {
      pick
        .sample()
        .then((pixels) => {
          const picked = samplePickedColor(pixels);
          if (!picked || (useEditorStore.getState().adjustments.pointColors?.length ?? 0) >= MAX_POINT_COLORS) return;
          const point = createPointColor(picked.hue, picked.saturation, picked.luminance);
          setAdjustments((prev) => ({ ...prev, pointColors: [...(prev.pointColors ?? []), point] }));
          setEditor({ activePointColorId: point.id });
        })
        .catch((err) => console.error('Failed to sample the preview for Point Color:', err));
    },
    [setAdjustments, setEditor],
  );

  /** Zone Color Grading: a click selects the zone under the cursor (Shift and Cmd/Ctrl as on its scale). */
  const pickZone = useCallback(
    (pick: Pick, modifiers: ZoneSelectionModifiers) => {
      pick
        .sample()
        .then((pixels) => {
          const zone = samplePickedZone(pixels, currentZoneTint());
          if (zone === null) return;
          setEditor((state) => ({ zoneTintSelection: nextZoneSelection(state.zoneTintSelection, zone, modifiers) }));
        })
        .catch((err) => console.error('Failed to sample the preview for Zone Color Grading:', err));
    },
    [setEditor],
  );

  /**
   * Zone Color Grading's rectangle: a drag selects the zones inside it on release (Shift or
   * Cmd/Ctrl adds them to the selection); a click without a drag picks one zone.
   */
  const startZoneArea = useCallback(
    (stage: Konva.Stage, pick: Pick, modifiers: ZoneSelectionModifiers) => {
      end();
      const { width, height } = imageRenderSize;
      const origin = pick.point;
      let area = areaBetween(origin, origin);

      const onMove = (ev: MouseEvent | TouchEvent) => {
        if (ev.cancelable) ev.preventDefault();
        stage.setPointersPositions(ev);
        const pos = getCanvasPointer(stage);
        if (!pos) return;
        area = areaBetween(origin, {
          x: Math.max(0, Math.min(width, pos.x)),
          y: Math.max(0, Math.min(height, pos.y)),
        });
        setPickArea(area);
      };
      const onUp = () => {
        end();
        const minSize = MIN_PICK_AREA_SCREEN_SIZE / zoomScale;
        if (area.width < minSize || area.height < minSize) {
          pickZone(pick, modifiers);
          return;
        }
        sampleArea(pick.target, pick.maskId, area)
          .then((pixels) =>
            setEditor((state) => ({
              zoneTintSelection:
                sampleAreaZones(pixels, currentZoneTint(), state.zoneTintSelection, modifiers) ??
                state.zoneTintSelection,
            })),
          )
          .catch((err) => console.error('Failed to sample the preview for Zone Color Grading:', err));
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('touchmove', onMove, { passive: false });
      window.addEventListener('mouseup', onUp);
      window.addEventListener('touchend', onUp);
      window.addEventListener('touchcancel', end);
      detachRef.current = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('touchmove', onMove);
        window.removeEventListener('mouseup', onUp);
        window.removeEventListener('touchend', onUp);
        window.removeEventListener('touchcancel', end);
      };
    },
    [end, imageRenderSize, getCanvasPointer, zoomScale, pickZone, sampleArea, setEditor],
  );

  const start = useCallback(
    (e: KonvaEventObject<MouseEvent | TouchEvent>) => {
      const pick = getPick(e);
      const clientPoint = getClientPoint(e.evt);
      if (!pick || !clientPoint) return;
      if (pick.target.tool === 'pointColor') {
        if (!pick.maskId) addPointColor(pick);
        return;
      }
      if (pick.target.tool === 'zoneTint') {
        const stage = e.target.getStage();
        if (pick.maskId || !stage) return;
        if (pick.target.area) startZoneArea(stage, pick, e.evt);
        else pickZone(pick, e.evt);
        return;
      }

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
    [getPick, setEditor, applyDrag, end, addPointColor, pickZone, startZoneArea],
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

  return { isActive: target !== null, isDragging, pickArea, start, reset };
}
