import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent, SVGProps } from 'react';
import { Crosshair, Eye, EyeOff, RotateCcw, Stamp, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import { v4 as uuidv4 } from 'uuid';
import clsx from 'clsx';
import PanelHeader from '../../ui/PanelHeader';
import BlendPadPresetBar from './BlendPadPresetBar';
import Slider from '../../ui/Slider';
import Dropdown from '../../ui/Dropdown';
import Switch from '../../ui/Switch';
import Text from '../../ui/Text';
import { TextVariants } from '../../../types/typography';
import { useEditorStore } from '../../../store/useEditorStore';
import { useEditorActions } from '../../../hooks/useEditorActions';
import { useBlendPadParameters } from '../../../hooks/useBlendPadParameters';
import { useControlLabel } from '../../../hooks/useControlLabel';
import type {
  BlendPad,
  BlendPadAnchor,
  BlendPadCurve,
  BlendPadMode,
  BlendPadShape,
  Coord,
} from '../../../utils/adjustments';
import {
  BLEND_PAD_CURVES,
  BLEND_PAD_MODES,
  BLEND_PAD_SHAPES,
  MAX_BLEND_PAD_ANCHORS,
  anchorPoint,
  anchorValues,
  bakeBlendPad,
  clampToPad,
  createBlendPad,
  largestGapPosition,
  loadBlendPadPreset,
  oppositePoint,
  positionOf,
  resolveBlendPad,
  shapeCorners,
  switchAnchorTool,
  targetWithShare,
} from '../../../utils/blendPad';

/** The pad's drawing space: the unit circle with room around it for the labels. */
const VIEW_HALF = 1.6;
const VIEW_SIZE = VIEW_HALF * 2;
const PUCK_RADIUS = 0.07;
/** How close to the puck or an anchor a press must be to grab it. */
const PUCK_GRAB_RADIUS = 0.15;
const ANCHOR_GRAB_RADIUS = 0.12;
const FINE_DRAG = 0.25;
const NUDGE = 0.02;
const FINE_NUDGE = 0.005;
/** A new tool's target: this share of its slider's reach. */
const NEW_TOOL_SHARE = 0.4;
const WARM = 'rgb(199 144 61)';
const COOL = 'rgb(80 140 134)';

const ARROW_NUDGES: Record<string, Coord> = {
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: 1 },
  ArrowDown: { x: 0, y: -1 },
};

const decimalsOf = (step: number) => Math.max(0, -Math.floor(Math.log10(step)));

/** "+60", "−25", "0" with the parameter's step as precision. */
const formatSigned = (value: number, step: number) => {
  const text = Math.abs(value).toFixed(decimalsOf(step));
  if (Number(text) === 0) return '0';
  return `${value > 0 ? '+' : '−'}${text}`;
};

/** The pad in drawing space, y down. */
const toView = (point: Coord) => ({ x: point.x, y: -point.y });

type Drag = { kind: 'puck'; last: Coord; virtual: Coord } | { kind: 'anchor'; id: string };

/**
 * The selected tool's line from its dot through the centre to its opposite edge point, with
 * the value it gives at the far end (the target's reverse, or 0 without reverse).
 */
function SelectedAxis({ anchor, shape, step }: { anchor: BlendPadAnchor; shape: BlendPadShape; step: number }) {
  const at = toView(anchorPoint(shape, anchor.t));
  const oppositePad = oppositePoint(shape, anchor.t);
  const opposite = toView(oppositePad);
  const reach = Math.hypot(oppositePad.x, oppositePad.y) || 1;
  const away = { x: oppositePad.x / reach, y: oppositePad.y / reach };
  const textAnchor = Math.abs(away.x) <= 0.3 ? 'middle' : away.x > 0 ? 'start' : 'end';
  const farValue = anchor.reverse === false ? 0 : -anchor.target;
  return (
    <g className="pointer-events-none">
      <line
        className="stroke-accent"
        strokeDasharray="0.03 0.025"
        strokeOpacity={0.7}
        strokeWidth={0.01}
        x1={at.x}
        x2={opposite.x}
        y1={at.y}
        y2={opposite.y}
      />
      <text
        className="fill-accent font-mono"
        dominantBaseline="middle"
        fontSize={0.085}
        textAnchor={textAnchor}
        x={opposite.x + away.x * 0.09}
        y={opposite.y - away.y * 0.09}
      >
        {formatSigned(farValue, step)}
      </text>
    </g>
  );
}

interface PadFieldProps {
  pad: BlendPad;
  /** What each tool adds right now, by anchor id (`anchorValues`). */
  currentValues: Record<string, number>;
  selectedId: string | null;
  getLabel(anchor: BlendPadAnchor): string;
  getStep(anchor: BlendPadAnchor): number;
  onAnchorMove(id: string, t: number): void;
  onDragStateChange(isDragging: boolean): void;
  onPuckChange(puck: Coord): void;
  onSelect(id: string): void;
}

/** The circle with its anchors and the puck: drag the puck to blend, an anchor to move it. */
function PadField({
  pad,
  currentValues,
  selectedId,
  getLabel,
  getStep,
  onAnchorMove,
  onDragStateChange,
  onPuckChange,
  onSelect,
}: PadFieldProps) {
  const { t } = useTranslation();
  const gradientId = useId();
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<Drag | null>(null);
  const pendingUpdate = useRef<(() => void) | null>(null);
  const frame = useRef(0);
  const [isDragging, setIsDragging] = useState(false);
  const { shape } = pad;
  // Only Axis has a reverse side: opposite rings, the selected line and Reverse belong to it.
  const isAxis = (pad.mode ?? 'axis') === 'axis';
  const puck = clampToPad(shape, pad.puck);
  const corners = shapeCorners(shape);
  /** The pad's outline, for the clip and the stroke. */
  const outline = (props: SVGProps<SVGCircleElement> & SVGProps<SVGPolygonElement>) =>
    corners ? (
      <polygon points={corners.map((corner) => `${corner.x},${-corner.y}`).join(' ')} {...props} />
    ) : (
      <circle r={1} {...props} />
    );

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  /** Only the latest change of a frame is applied. */
  const scheduleUpdate = useCallback((update: () => void) => {
    pendingUpdate.current = update;
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      pendingUpdate.current?.();
      pendingUpdate.current = null;
    });
  }, []);

  /** The pointer in pad space (y up). */
  const toPad = (event: { clientX: number; clientY: number }): Coord => {
    const rect = svgRef.current!.getBoundingClientRect();
    const scale = VIEW_SIZE / rect.width;
    return {
      x: (event.clientX - rect.left) * scale - VIEW_HALF,
      y: VIEW_HALF - (event.clientY - rect.top) * scale,
    };
  };

  const isOnPuck = (point: Coord) => Math.hypot(point.x - puck.x, point.y - puck.y) <= PUCK_GRAB_RADIUS;

  const anchorAt = (point: Coord) =>
    pad.anchors.find((anchor) => {
      const at = anchorPoint(shape, anchor.t);
      return Math.hypot(point.x - at.x, point.y - at.y) <= ANCHOR_GRAB_RADIUS;
    });

  const startDrag = (event: PointerEvent<SVGSVGElement>, next: Drag) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = next;
    setIsDragging(true);
    onDragStateChange(true);
  };

  const handlePointerDown = (event: PointerEvent<SVGSVGElement>) => {
    const point = toPad(event);
    if (isOnPuck(point)) {
      startDrag(event, { kind: 'puck', last: point, virtual: puck });
      return;
    }
    const anchor = anchorAt(point);
    // The puck moves only when grabbed; a press on empty pad space does nothing.
    if (!anchor) return;
    onSelect(anchor.id);
    startDrag(event, { kind: 'anchor', id: anchor.id });
  };

  const handlePointerMove = (event: PointerEvent<SVGSVGElement>) => {
    const current = drag.current;
    if (!current) return;
    const point = toPad(event);
    if (current.kind === 'anchor') {
      scheduleUpdate(() => onAnchorMove(current.id, positionOf(shape, point)));
      return;
    }
    const factor = event.shiftKey ? FINE_DRAG : 1;
    const virtual = {
      x: current.virtual.x + (point.x - current.last.x) * factor,
      y: current.virtual.y + (point.y - current.last.y) * factor,
    };
    drag.current = { kind: 'puck', last: point, virtual };
    scheduleUpdate(() => onPuckChange(clampToPad(shape, virtual)));
  };

  const endDrag = () => {
    if (!drag.current) return;
    drag.current = null;
    setIsDragging(false);
    onDragStateChange(false);
  };

  const handleDoubleClick = (event: { clientX: number; clientY: number }) => {
    if (isOnPuck(toPad(event))) onPuckChange({ x: 0, y: 0 });
  };

  const handleKeyDown = (event: KeyboardEvent<SVGSVGElement>) => {
    const direction = ARROW_NUDGES[event.key];
    if (!direction) return;
    event.preventDefault();
    const step = event.shiftKey ? FINE_NUDGE : NUDGE;
    onPuckChange(clampToPad(shape, { x: puck.x + direction.x * step, y: puck.y + direction.y * step }));
  };

  const puckView = toView(puck);
  const selected = pad.anchors.find((anchor) => anchor.id === selectedId);

  return (
    <svg
      ref={svgRef}
      aria-label={t('editor.blendPad.hint')}
      className={clsx(
        'w-full aspect-square rounded-lg bg-bg-primary touch-none select-none outline-none focus-visible:ring-1 focus-visible:ring-accent',
        isDragging ? 'cursor-grabbing' : 'cursor-default',
      )}
      onDoubleClick={handleDoubleClick}
      onKeyDown={handleKeyDown}
      onLostPointerCapture={endDrag}
      onPointerCancel={endDrag}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      role="application"
      tabIndex={0}
      viewBox={`${-VIEW_HALF} ${-VIEW_HALF} ${VIEW_SIZE} ${VIEW_SIZE}`}
    >
      <defs>
        <clipPath id={`${gradientId}-clip`}>{outline({})}</clipPath>
        {pad.anchors.map((anchor) => {
          const at = toView(anchorPoint(shape, anchor.t));
          const opposite = toView(oppositePoint(shape, anchor.t));
          const [toward, away] = anchor.target >= 0 ? [WARM, COOL] : [COOL, WARM];
          return (
            <linearGradient
              gradientUnits="userSpaceOnUse"
              id={`${gradientId}-${anchor.id}`}
              key={anchor.id}
              x1={at.x}
              x2={opposite.x}
              y1={at.y}
              y2={opposite.y}
            >
              <stop offset={0} stopColor={toward} stopOpacity={anchor.muted ? 0 : 0.2} />
              <stop offset={0.5} stopColor={toward} stopOpacity={0} />
              <stop
                offset={1}
                stopColor={away}
                stopOpacity={anchor.muted || !isAxis || anchor.reverse === false ? 0 : 0.1}
              />
            </linearGradient>
          );
        })}
      </defs>

      <g clipPath={`url(#${gradientId}-clip)`}>
        {pad.anchors.map((anchor) => (
          <rect fill={`url(#${gradientId}-${anchor.id})`} height={2} key={anchor.id} width={2} x={-1} y={-1} />
        ))}
      </g>
      {outline({
        className: 'fill-none stroke-text-secondary',
        strokeLinejoin: 'round',
        strokeOpacity: 0.6,
        strokeWidth: 0.008,
      })}
      <path className="stroke-text-secondary" d="M -0.05 0 H 0.05 M 0 -0.05 V 0.05" strokeWidth={0.008} />

      {/* Where each anchor's reverse sits (faint when the tool has no reverse). */}
      {isAxis &&
        pad.anchors.map((anchor) => {
          const opposite = toView(oppositePoint(shape, anchor.t));
          const isSelected = anchor.id === selectedId;
          return (
            <circle
              className="fill-none stroke-text-secondary"
              cx={opposite.x}
              cy={opposite.y}
              key={anchor.id}
              r={0.025}
              strokeOpacity={anchor.reverse === false ? 0.15 : isSelected ? 0.9 : 0.35}
              strokeWidth={0.008}
            />
          );
        })}

      {/* The selected tool's line, with what it gives at both ends. */}
      {isAxis && selected && <SelectedAxis anchor={selected} shape={shape} step={getStep(selected)} />}

      {pad.anchors.map((anchor) => {
        const point = anchorPoint(shape, anchor.t);
        const at = toView(point);
        const reach = Math.hypot(point.x, point.y) || 1;
        const direction = { x: point.x / reach, y: point.y / reach };
        const isCorner = Math.abs(direction.x) > 0.3 && Math.abs(direction.y) > 0.3;
        // Corner anchors label above or below the dot; others outward, so no label leaves the pad.
        const labelAt = isCorner
          ? { x: at.x, y: at.y + (direction.y > 0 ? -0.12 : 0.18) }
          : { x: at.x + direction.x * 0.18, y: at.y - direction.y * 0.18 };
        const textAnchor = isCorner || Math.abs(direction.x) <= 0.3 ? 'middle' : direction.x > 0 ? 'start' : 'end';
        const isAbove = direction.y > 0.3;
        const current = formatSigned(currentValues[anchor.id] ?? 0, getStep(anchor));
        return (
          <g className="cursor-grab" key={anchor.id} opacity={anchor.muted ? 0.4 : 1}>
            {anchor.id === selectedId && (
              <circle className="fill-none stroke-accent" cx={at.x} cy={at.y} r={0.065} strokeWidth={0.015} />
            )}
            <circle className="fill-text-primary" cx={at.x} cy={at.y} r={0.035} />
            <text
              className="fill-text-primary font-medium uppercase"
              dominantBaseline="middle"
              fontSize={0.095}
              textAnchor={textAnchor}
              x={labelAt.x}
              y={labelAt.y + (isAbove ? -0.13 : 0)}
            >
              {getLabel(anchor)}
            </text>
            {/* What the tool gives now, then its target at the dot. */}
            <text
              className="font-mono"
              dominantBaseline="middle"
              fontSize={0.09}
              textAnchor={textAnchor}
              x={labelAt.x}
              y={labelAt.y + (isAbove ? 0 : 0.13)}
            >
              <tspan className="fill-accent">{t('editor.blendPad.now', { value: current })}</tspan>
              <tspan className="fill-text-secondary" fontSize={0.075}>
                {` → ${formatSigned(anchor.target, getStep(anchor))}`}
              </tspan>
            </text>
          </g>
        );
      })}

      <line
        className="stroke-text-secondary"
        strokeOpacity={0.5}
        strokeWidth={0.008}
        x1={0}
        x2={puckView.x}
        y1={0}
        y2={puckView.y}
      />
      <circle
        className={clsx('fill-text-primary stroke-bg-primary', !isDragging && 'cursor-grab')}
        cx={puckView.x}
        cy={puckView.y}
        r={PUCK_RADIUS}
        strokeWidth={0.02}
      />
    </svg>
  );
}

/** The Orbit Blend Pad: tools on a circle, blended by dragging one puck. */
export default function BlendPadPanel() {
  const { t } = useTranslation();
  const { setAdjustments } = useEditorActions();
  const { blendPad, setEditor } = useEditorStore(
    useShallow((state) => ({ blendPad: state.adjustments.blendPad, setEditor: state.setEditor })),
  );
  const parameters = useBlendPadParameters();
  const { controlLabel } = useControlLabel();
  const defaultPad = useMemo(createBlendPad, []);
  // A photo without a pad shows the default one; the first change stores it.
  const pad = blendPad ?? defaultPad;
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const parametersById = useMemo(
    () => Object.fromEntries(parameters.map((parameter) => [parameter.id, parameter])),
    [parameters],
  );
  const toolOptions = useMemo(
    () => parameters.map((parameter) => ({ label: controlLabel(parameter.id), value: parameter.id })),
    [parameters, controlLabel],
  );
  const curveOptions = useMemo(
    () => BLEND_PAD_CURVES.map((curve) => ({ label: t(`editor.blendPad.curves.${curve}`), value: curve })),
    [t],
  );
  const shapeOptions = useMemo(
    () => BLEND_PAD_SHAPES.map((shape) => ({ label: t(`editor.blendPad.shapes.${shape}`), value: shape })),
    [t],
  );
  const modeOptions = useMemo(
    () => BLEND_PAD_MODES.map((mode) => ({ label: t(`editor.blendPad.modes.${mode}`), value: mode })),
    [t],
  );
  const isAxis = (pad.mode ?? 'axis') === 'axis';
  /** What each tool adds right now, by anchor id, for the pad's labels and the tool cards. */
  const currentValues = useMemo(() => {
    const values = anchorValues(pad, parameters);
    return Object.fromEntries(pad.anchors.map((anchor, index) => [anchor.id, values[index]]));
  }, [pad, parameters]);
  const canBake = useMemo(
    () => Object.values(resolveBlendPad(pad, parameters)).some((offset) => offset !== 0),
    [pad, parameters],
  );
  const canAddTool = pad.anchors.length < MAX_BLEND_PAD_ANCHORS;

  const updatePad = useCallback(
    (change: (current: BlendPad) => BlendPad, label?: string) =>
      setAdjustments((prev) => ({ ...prev, blendPad: change(prev.blendPad ?? createBlendPad()) }), label),
    [setAdjustments],
  );

  const updateAnchor = useCallback(
    (id: string, change: Partial<BlendPadAnchor>) =>
      updatePad((current) => ({
        ...current,
        anchors: current.anchors.map((anchor) => (anchor.id === id ? { ...anchor, ...change } : anchor)),
      })),
    [updatePad],
  );

  const handleDragStateChange = useCallback(
    (isDragging: boolean) => setEditor({ isSliderDragging: isDragging }),
    [setEditor],
  );

  const handlePuckChange = useCallback((puck: Coord) => updatePad((current) => ({ ...current, puck })), [updatePad]);

  const handleAnchorMove = useCallback(
    (id: string, position: number) => updateAnchor(id, { t: position }),
    [updateAnchor],
  );

  /** Switching back to a tool restores its value at the dot; a new one keeps the share of its range. */
  const handleToolChange = (anchor: BlendPadAnchor, param: string) => {
    const switched = switchAnchorTool(anchor, param, parameters);
    if (switched !== anchor) updateAnchor(anchor.id, switched);
  };

  const handleAddTool = (param: string) => {
    const parameter = parametersById[param];
    if (!parameter || !canAddTool) return;
    const id = uuidv4();
    updatePad(
      (current) => ({
        ...current,
        anchors: [
          ...current.anchors,
          {
            id,
            param,
            t: largestGapPosition(current.anchors),
            target: targetWithShare(NEW_TOOL_SHARE, parameter),
            curve: 'linear',
            muted: false,
            reverse: true,
          },
        ],
      }),
      t('editor.blendPad.addTool'),
    );
    setSelectedId(id);
  };

  const handleRemove = (id: string) => {
    updatePad(
      (current) => ({ ...current, anchors: current.anchors.filter((anchor) => anchor.id !== id) }),
      t('editor.blendPad.remove'),
    );
    if (selectedId === id) setSelectedId(null);
  };

  /** Writes the pad's offsets into the sliders and centres the puck: the photo looks the same. */
  const handleBake = () =>
    setAdjustments(
      (prev) => ({
        ...prev,
        ...bakeBlendPad(prev, prev.blendPad, parameters),
        blendPad: prev.blendPad && { ...prev.blendPad, puck: { x: 0, y: 0 } },
      }),
      t('editor.blendPad.bake'),
    );

  const getStep = useCallback((anchor: BlendPadAnchor) => parametersById[anchor.param]?.step ?? 1, [parametersById]);
  const getLabel = useCallback((anchor: BlendPadAnchor) => controlLabel(anchor.param), [controlLabel]);

  return (
    <div className="flex flex-col h-full">
      <PanelHeader
        title={t('editor.blendPad.title')}
        actions={
          <>
            <button
              className="p-2 rounded-full hover:bg-surface transition-colors"
              data-tooltip={t('editor.blendPad.center')}
              onClick={() => handlePuckChange({ x: 0, y: 0 })}
            >
              <Crosshair size={18} />
            </button>
            <button
              className="p-2 rounded-full hover:bg-surface transition-colors disabled:opacity-40 disabled:hover:bg-transparent"
              data-tooltip={t('editor.blendPad.bakeTooltip')}
              disabled={!canBake}
              onClick={handleBake}
            >
              <Stamp size={18} />
            </button>
            <button
              className="p-2 rounded-full hover:bg-surface transition-colors"
              data-tooltip={t('editor.blendPad.reset')}
              onClick={() => {
                updatePad(createBlendPad, t('editor.blendPad.reset'));
                setSelectedId(null);
              }}
            >
              <RotateCcw size={18} />
            </button>
          </>
        }
      />
      <div className="grow overflow-y-auto p-4 compact:p-3 flex flex-col gap-4 compact:gap-3">
        <BlendPadPresetBar
          onLoad={(preset) => {
            updatePad(() => loadBlendPadPreset(preset), preset.name);
            setSelectedId(null);
          }}
          onSaved={(preset) => updatePad((current) => ({ ...current, presetId: preset.id }))}
          pad={pad}
          parameters={parameters}
        />
        <div className={clsx('transition-opacity', !pad.enabled && 'opacity-40')}>
          <PadField
            currentValues={currentValues}
            getLabel={getLabel}
            getStep={getStep}
            onAnchorMove={handleAnchorMove}
            onDragStateChange={handleDragStateChange}
            onPuckChange={handlePuckChange}
            onSelect={setSelectedId}
            pad={pad}
            selectedId={selectedId}
          />
        </div>
        <Text variant={TextVariants.small} className="text-text-secondary">
          {t('editor.blendPad.hint')}
        </Text>

        <div className="flex flex-col gap-3 compact:gap-2">
          <Switch
            checked={pad.enabled}
            label={t('editor.blendPad.enabled')}
            onChange={(enabled: boolean) => updatePad((current) => ({ ...current, enabled }))}
          />
          <div className="flex items-center gap-2">
            <Text variant={TextVariants.label} className="w-16 shrink-0 text-text-secondary">
              {t('editor.blendPad.shape')}
            </Text>
            <Dropdown
              className="grow min-w-0"
              onChange={(shape: BlendPadShape) =>
                // Anchors keep their place along the outline; the puck stays inside the new one.
                updatePad((current) => ({ ...current, shape, puck: clampToPad(shape, current.puck) }))
              }
              options={shapeOptions}
              value={pad.shape}
            />
          </div>
          <div className="flex items-center gap-2" data-tooltip={t(`editor.blendPad.modeHints.${pad.mode ?? 'axis'}`)}>
            <Text variant={TextVariants.label} className="w-16 shrink-0 text-text-secondary">
              {t('editor.blendPad.mode')}
            </Text>
            <Dropdown
              className="grow min-w-0"
              onChange={(mode: BlendPadMode) => updatePad((current) => ({ ...current, mode }))}
              options={modeOptions}
              value={pad.mode ?? 'axis'}
            />
          </div>
          <Slider
            defaultValue={100}
            fillOrigin="min"
            label={t('adjustments.effects.amount')}
            max={100}
            min={0}
            onChange={(event) => updatePad((current) => ({ ...current, amount: Number(event.target.value) / 100 }))}
            onDragStateChange={handleDragStateChange}
            step={1}
            value={Math.round(pad.amount * 100)}
          />
        </div>

        {pad.anchors.map((anchor) => {
          const parameter = parametersById[anchor.param];
          if (!parameter) return null;
          const reach = Math.max(Math.abs(parameter.min), Math.abs(parameter.max));
          return (
            <div
              className={clsx(
                'flex flex-col gap-2 p-3 compact:p-2 rounded-md border bg-surface transition-colors',
                anchor.id === selectedId ? 'border-accent' : 'border-transparent',
                anchor.muted && 'opacity-60',
              )}
              key={anchor.id}
              onPointerDown={() => setSelectedId(anchor.id)}
            >
              <div className="flex items-center gap-1">
                <Dropdown
                  className="grow min-w-0"
                  onChange={(param: string) => handleToolChange(anchor, param)}
                  options={toolOptions}
                  value={anchor.param}
                />
                <button
                  className="p-1.5 rounded-full hover:bg-bg-primary transition-colors text-text-secondary"
                  data-tooltip={t(anchor.muted ? 'editor.blendPad.unmute' : 'editor.blendPad.mute')}
                  onClick={() => updateAnchor(anchor.id, { muted: !anchor.muted })}
                >
                  {anchor.muted ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
                <button
                  className="p-1.5 rounded-full hover:bg-bg-primary transition-colors text-text-secondary disabled:opacity-40 disabled:hover:bg-transparent"
                  data-tooltip={t('editor.blendPad.remove')}
                  disabled={pad.anchors.length <= 1}
                  onClick={() => handleRemove(anchor.id)}
                >
                  <Trash2 size={16} />
                </button>
              </div>
              <Slider
                defaultValue={targetWithShare(NEW_TOOL_SHARE, parameter)}
                label={t('editor.blendPad.atTheDot')}
                labelAddon={
                  <span className="text-xs font-mono text-accent">
                    {t('editor.blendPad.now', {
                      value: formatSigned(currentValues[anchor.id] ?? 0, parameter.step),
                    })}
                  </span>
                }
                max={reach}
                min={-reach}
                onChange={(event) => updateAnchor(anchor.id, { target: Number(event.target.value) })}
                onDragStateChange={handleDragStateChange}
                step={parameter.step}
                value={anchor.target}
              />
              <div className="flex items-center gap-2">
                <Text variant={TextVariants.label} className="w-16 shrink-0 text-text-secondary">
                  {t('editor.blendPad.curve')}
                </Text>
                <Dropdown
                  className="grow min-w-0"
                  onChange={(curve: BlendPadCurve) => updateAnchor(anchor.id, { curve })}
                  options={curveOptions}
                  value={anchor.curve}
                />
              </div>
              {isAxis && (
                <Switch
                  checked={anchor.reverse !== false}
                  id={`blend-pad-reverse-${anchor.id}`}
                  label={t('editor.blendPad.reverse')}
                  onChange={(reverse: boolean) => updateAnchor(anchor.id, { reverse })}
                  tooltip={t('editor.blendPad.reverseHint')}
                />
              )}
            </div>
          );
        })}

        <div data-tooltip={canAddTool ? undefined : t('editor.blendPad.maxTools', { count: MAX_BLEND_PAD_ANCHORS })}>
          <Dropdown
            disabled={!canAddTool}
            onChange={handleAddTool}
            options={toolOptions}
            placeholder={t('editor.blendPad.addTool')}
            value={null}
          />
        </div>
      </div>
    </div>
  );
}
