import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'react-toastify';
import { useTranslation } from 'react-i18next';

import { RenderSize } from '../../../hooks/useImageRenderSize';
import { useEditorActions } from '../../../hooks/useEditorActions';
import { useEditorStore } from '../../../store/useEditorStore';
import { Adjustments, Coord, GuideLine } from '../../../utils/adjustments';
import {
  GuidedPerspectiveFrame,
  canAddGuide,
  classifyDrawnGuide,
  displayToSource,
  sourceToDisplay,
  swapOrientationForQuarterTurn,
  withGuideLines,
} from '../../../utils/guidedPerspective';
import { Invokes } from '../../ui/AppProperties';

/** Shorter strokes, in preview pixels, are treated as clicks. */
const MIN_GUIDE_LENGTH = 15;
const GUIDE_COLOR = '#38bdf8';

type Endpoint = 'p1' | 'p2';

interface Drag {
  id: string;
  endpoint: Endpoint;
  point: Coord;
}

interface GuidedPerspectiveOverlayProps {
  imageRenderSize: RenderSize;
}

/**
 * Draws and edits Guided Perspective guides on the uncropped, corrected
 * preview (upstream RapidRAW's on-canvas guides). Guides are stored in
 * source coordinates, so each one is mapped through the current geometry.
 */
export default function GuidedPerspectiveOverlay({ imageRenderSize }: GuidedPerspectiveOverlayProps) {
  const { t } = useTranslation();
  const adjustments = useEditorStore((state) => state.adjustments);
  const { setAdjustments } = useEditorActions();
  const [frame, setFrame] = useState<GuidedPerspectiveFrame | null>(null);
  const [draft, setDraft] = useState<{ start: Coord; end: Coord } | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const { width, height } = imageRenderSize;

  useEffect(() => {
    let isCurrent = true;
    invoke<GuidedPerspectiveFrame>(Invokes.GetGuidedPerspectiveFrame, { jsAdjustments: adjustments })
      .then((nextFrame) => {
        if (isCurrent) setFrame(nextFrame);
      })
      .catch((error) => console.error('Failed to map the guided perspective guides:', error));
    return () => {
      isCurrent = false;
    };
  }, [adjustments]);

  if (!frame || !width || !height) return null;

  const toScreen = (point: Coord): Coord | null => {
    const display = sourceToDisplay(point, frame, adjustments);
    return display && { x: display.x * width, y: display.y * height };
  };
  const toSource = (point: Coord) => displayToSource({ x: point.x / width, y: point.y / height }, frame, adjustments);

  const pointerPosition = (event: React.PointerEvent<SVGSVGElement>): Coord => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.min(width, Math.max(0, ((event.clientX - rect.left) / rect.width) * width)),
      y: Math.min(height, Math.max(0, ((event.clientY - rect.top) / rect.height) * height)),
    };
  };

  const commitLines = (update: (lines: GuideLine[]) => GuideLine[] | null) =>
    setAdjustments((previous: Adjustments) => {
      const lines = update(previous.guidedPerspective.lines);
      return lines ? withGuideLines(previous, lines) : previous;
    });

  const addGuide = (start: Coord, end: Coord) => {
    if (Math.hypot(end.x - start.x, end.y - start.y) < MIN_GUIDE_LENGTH) return;
    const onScreen = classifyDrawnGuide(start, end);
    if (!onScreen) {
      toast.error(t('editor.geometry.guided.angleRejected'));
      return;
    }
    const p1 = toSource(start);
    const p2 = toSource(end);
    if (!p1 || !p2) return;
    const type = swapOrientationForQuarterTurn(onScreen, adjustments.orientationSteps || 0);
    if (!canAddGuide(adjustments.guidedPerspective.lines, type)) {
      toast.error(t('editor.geometry.guided.maxLines'));
      return;
    }
    commitLines((lines) => (canAddGuide(lines, type) ? [...lines, { id: crypto.randomUUID(), type, p1, p2 }] : null));
  };

  const moveEndpoint = ({ id, endpoint, point }: Drag) => {
    const source = toSource(point);
    if (!source) return;
    commitLines((lines) => lines.map((line) => (line.id === id ? { ...line, [endpoint]: source } : line)));
  };

  const handlePointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = pointerPosition(event);
    const handle = (event.target as Element).closest<SVGElement>('[data-guide-endpoint]');
    if (handle?.dataset.guideId) {
      setDrag({ id: handle.dataset.guideId, endpoint: handle.dataset.guideEndpoint as Endpoint, point });
    } else {
      setDraft({ start: point, end: point });
    }
  };

  const handlePointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    if (!drag && !draft) return;
    event.stopPropagation();
    const point = pointerPosition(event);
    if (drag) setDrag({ ...drag, point });
    else if (draft) setDraft({ ...draft, end: point });
  };

  const handlePointerUp = (event: React.PointerEvent<SVGSVGElement>) => {
    if (!drag && !draft) return;
    event.stopPropagation();
    const point = pointerPosition(event);
    if (drag) moveEndpoint({ ...drag, point });
    else if (draft) addGuide(draft.start, point);
    setDrag(null);
    setDraft(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const renderGuide = (key: string, start: Coord, end: Coord, guideId?: string) => (
    <g key={key}>
      <line
        stroke="rgba(0, 0, 0, 0.6)"
        strokeWidth={3}
        vectorEffect="non-scaling-stroke"
        x1={start.x}
        x2={end.x}
        y1={start.y}
        y2={end.y}
      />
      <line
        stroke={GUIDE_COLOR}
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
        x1={start.x}
        x2={end.x}
        y1={start.y}
        y2={end.y}
      />
      {guideId &&
        (['p1', 'p2'] as const).map((endpoint) => {
          const point = endpoint === 'p1' ? start : end;
          return (
            <g key={endpoint}>
              <circle cx={point.x} cy={point.y} fill={GUIDE_COLOR} r={4} stroke="white" strokeWidth={1.5} />
              <circle
                className="cursor-grab active:cursor-grabbing"
                cx={point.x}
                cy={point.y}
                data-guide-endpoint={endpoint}
                data-guide-id={guideId}
                fill="transparent"
                r={12}
              />
            </g>
          );
        })}
    </g>
  );

  return (
    <svg
      aria-label={t('editor.geometry.guided.overlayLabel')}
      className="absolute z-40 touch-none overflow-visible"
      onClick={(event) => event.stopPropagation()}
      onPointerCancel={handlePointerUp}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      style={{ cursor: 'crosshair', height, left: imageRenderSize.offsetX, top: imageRenderSize.offsetY, width }}
      viewBox={`0 0 ${width} ${height}`}
    >
      {adjustments.guidedPerspective.lines.map((line) => {
        const start = drag?.id === line.id && drag.endpoint === 'p1' ? drag.point : toScreen(line.p1);
        const end = drag?.id === line.id && drag.endpoint === 'p2' ? drag.point : toScreen(line.p2);
        return start && end ? renderGuide(line.id, start, end, line.id) : null;
      })}
      {draft && renderGuide('draft', draft.start, draft.end)}
    </svg>
  );
}
