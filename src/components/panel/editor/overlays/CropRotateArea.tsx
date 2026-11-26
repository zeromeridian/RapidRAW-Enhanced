import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { FINE_ADJUSTMENT_MULTIPLIER } from '../../../ui/Slider';
import { Coord } from '../../../../utils/adjustments';
import { MAX_FINE_ROTATION } from '../../../../utils/cropUtils';
import { placeHud } from './hudPlacement';

const CURSOR_STEP = 45;
const CROP_SELECTION_SELECTOR = '.ReactCrop__crop-selection';

// Upstream's curved double arrow, turned in 45° steps to face away from the crop centre.
const rotateCursor = (angle: number) => {
  const arrow = 'M6 17A11 11 0 0 1 17 6M3 14L6 18L9 14M14 3L18 6L14 9';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round"><g transform="rotate(${angle} 12 12)"><path d="${arrow}" stroke="black" stroke-width="4"/><path d="${arrow}" stroke="white" stroke-width="2"/></g></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 12 12, grab`;
};

const ROTATE_CURSORS = Array.from({ length: 360 / CURSOR_STEP }, (_, i) => rotateCursor(i * CURSOR_STEP));

interface RotateDrag {
  pointerId: number;
  pivot: Coord;
  lastAngle: number;
  angleDelta: number;
  startRotation: number;
  rotation: number;
}

const clientPoint = (e: React.PointerEvent): Coord => ({ x: e.clientX, y: e.clientY });

const angleAround = (pivot: Coord, point: Coord) => (Math.atan2(point.y - pivot.y, point.x - pivot.x) * 180) / Math.PI;

const centerOf = (rect: DOMRect): Coord => ({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });

// Ctrl/Cmd outside the frame moves the crop (`Editor.tsx`), so a modified press never rotates.
const hasMoveModifier = (e: React.PointerEvent) => e.metaKey || e.ctrlKey;

/** Whether `point` lies outside the selection, where a drag rotates (Lightroom style, owner 2026-11-26). */
const isOutsideSelection = (point: Coord, selection: DOMRect) =>
  point.x < selection.left || point.x > selection.right || point.y < selection.top || point.y > selection.bottom;

interface CropRotateAreaProps extends React.HTMLAttributes<HTMLDivElement> {
  enabled: boolean;
  rotation: number;
  onRotateStart(rotation: number): void;
  onRotate(rotation: number): void;
  onRotateEnd(rotation: number): void;
}

/**
 * The crop view's container, Lightroom style (Plan items 37 and 80): dragging anywhere outside the
 * crop frame rotates the photo around the frame's centre (Shift for fine rotation), with the angle
 * in a label beside the cursor, so a drag there never draws a new frame. Inside the frame, and
 * Ctrl/Cmd-drags outside it, the crop gestures stay as they are.
 */
export default function CropRotateArea({
  enabled,
  rotation,
  onRotateStart,
  onRotate,
  onRotateEnd,
  children,
  style,
  ...divProps
}: CropRotateAreaProps) {
  const areaRef = useRef<HTMLDivElement>(null);
  const hudRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<RotateDrag | null>(null);
  const lastPointerRef = useRef<Coord | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const getSelectionRect = () =>
    areaRef.current?.querySelector(CROP_SELECTION_SELECTOR)?.getBoundingClientRect() ?? null;

  const setCursor = (cursor: string) => {
    const area = areaRef.current;
    if (!area || area.style.cursor === cursor) return;
    area.style.cursor = cursor;
    area.toggleAttribute('data-crop-rotate-zone', cursor !== '');
  };

  const setRotateCursor = (pivot: Coord, point: Coord) => {
    const index = Math.round((angleAround(pivot, point) + 135) / CURSOR_STEP);
    setCursor(ROTATE_CURSORS[((index % ROTATE_CURSORS.length) + ROTATE_CURSORS.length) % ROTATE_CURSORS.length]);
  };

  const finishDrag = () => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    setIsDragging(false);
    onRotateEnd(drag.rotation);
  };

  // Leaving Crop (or starting Straighten) mid-drag still commits the angle reached so far.
  useEffect(() => {
    if (!enabled) return;
    const area = areaRef.current;
    return () => {
      if (area) {
        area.style.cursor = '';
        area.removeAttribute('data-crop-rotate-zone');
      }
      const drag = dragRef.current;
      if (!drag) return;
      dragRef.current = null;
      setIsDragging(false);
      onRotateEnd(drag.rotation);
    };
  }, [enabled, onRotateEnd]);

  // A label that just appeared starts at the cursor instead of the area's corner.
  useLayoutEffect(() => {
    if (isDragging) placeHud(hudRef.current, areaRef.current, lastPointerRef.current);
  }, [isDragging]);

  const handlePointerDownCapture = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!enabled || e.button !== 0 || hasMoveModifier(e)) return;
    if (dragRef.current) {
      e.stopPropagation();
      return;
    }
    if (e.target instanceof Element && e.target.closest(CROP_SELECTION_SELECTOR)) return;
    const selection = getSelectionRect();
    const point = clientPoint(e);
    if (!selection || !isOutsideSelection(point, selection)) return;

    // Keep ReactCrop from starting a new selection and the canvas from panning.
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const pivot = centerOf(selection);
    dragRef.current = {
      pointerId: e.pointerId,
      pivot,
      lastAngle: angleAround(pivot, point),
      angleDelta: 0,
      startRotation: rotation,
      rotation,
    };
    lastPointerRef.current = point;
    setIsDragging(true);
    onRotateStart(rotation);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!enabled) return;
    const point = clientPoint(e);
    const drag = dragRef.current;
    if (!drag) {
      if (e.buttons !== 0) return;
      const selection = getSelectionRect();
      if (selection && !hasMoveModifier(e) && isOutsideSelection(point, selection)) {
        setRotateCursor(centerOf(selection), point);
      } else {
        setCursor('');
      }
      return;
    }
    if (drag.pointerId !== e.pointerId) return;
    lastPointerRef.current = point;
    setRotateCursor(drag.pivot, point);
    placeHud(hudRef.current, areaRef.current, point);

    const angle = angleAround(drag.pivot, point);
    let step = angle - drag.lastAngle;
    if (step > 180) step -= 360;
    if (step < -180) step += 360;
    drag.lastAngle = angle;
    drag.angleDelta += e.shiftKey ? step * FINE_ADJUSTMENT_MULTIPLIER : step;

    const next = Math.max(-MAX_FINE_ROTATION, Math.min(MAX_FINE_ROTATION, drag.startRotation + drag.angleDelta));
    const rounded = Math.round(next * 10) / 10;
    if (rounded === drag.rotation) return;
    drag.rotation = rounded;
    onRotate(rounded);
  };

  const handlePointerEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId === e.pointerId) finishDrag();
  };

  return (
    <div
      {...divProps}
      ref={areaRef}
      style={{ ...style, touchAction: isDragging ? 'none' : style?.touchAction }}
      onPointerDownCapture={handlePointerDownCapture}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      onLostPointerCapture={handlePointerEnd}
    >
      {children}
      {isDragging && (
        <div className="absolute z-40 pointer-events-none" ref={hudRef}>
          <div className="px-2 py-1.5 rounded-lg bg-surface/95 backdrop-blur-md shadow-xl text-xs text-text-primary font-mono tabular-nums whitespace-nowrap">
            {rotation.toFixed(1)}°
          </div>
        </div>
      )}
    </div>
  );
}
