import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import { Crosshair, RotateCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import clsx from 'clsx';
import PanelHeader from '../../ui/PanelHeader';
import Slider from '../../ui/Slider';
import Dropdown from '../../ui/Dropdown';
import Switch from '../../ui/Switch';
import Text from '../../ui/Text';
import { TextVariants } from '../../../types/typography';
import { useEditorStore } from '../../../store/useEditorStore';
import { useEditorActions } from '../../../hooks/useEditorActions';
import { useBlendPadParameters } from '../../../hooks/useBlendPadParameters';
import { useControlLabel } from '../../../hooks/useControlLabel';
import type { BlendPad, BlendPadAnchor, Coord } from '../../../utils/adjustments';
import {
  BLEND_PAD_SLOTS,
  type BlendPadParameter,
  anchorPoint,
  anchorValue,
  clampToPad,
  createBlendPad,
} from '../../../utils/blendPad';

/** The pad's drawing space: the unit circle with room around it for the labels. */
const VIEW_HALF = 1.6;
const VIEW_SIZE = VIEW_HALF * 2;
const PUCK_RADIUS = 0.07;
/** How close to the puck a press must be to grab it. */
const PUCK_GRAB_RADIUS = 0.15;
const FINE_DRAG = 0.25;
const NUDGE = 0.02;
const FINE_NUDGE = 0.005;
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

interface PadFieldProps {
  pad: BlendPad;
  getLabel(anchor: BlendPadAnchor): string;
  getStep(anchor: BlendPadAnchor): number;
  onDragStateChange(isDragging: boolean): void;
  onPuckChange(puck: Coord): void;
}

/** The circle with its anchors and the puck; dragging the puck blends every anchor. */
function PadField({ pad, getLabel, getStep, onDragStateChange, onPuckChange }: PadFieldProps) {
  const { t } = useTranslation();
  const gradientId = useId();
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ last: Coord; virtual: Coord } | null>(null);
  const pendingPuck = useRef<Coord | null>(null);
  const frame = useRef(0);
  const [isDragging, setIsDragging] = useState(false);
  const puck = clampToPad(pad.puck);

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  /** Only the latest position of a frame is applied. */
  const schedulePuck = useCallback(
    (next: Coord) => {
      pendingPuck.current = next;
      if (frame.current) return;
      frame.current = requestAnimationFrame(() => {
        frame.current = 0;
        if (pendingPuck.current) onPuckChange(pendingPuck.current);
        pendingPuck.current = null;
      });
    },
    [onPuckChange],
  );

  /** The pointer in pad space (y up). */
  const toPad = (event: PointerEvent | { clientX: number; clientY: number }): Coord => {
    const rect = svgRef.current!.getBoundingClientRect();
    const scale = VIEW_SIZE / rect.width;
    return {
      x: (event.clientX - rect.left) * scale - VIEW_HALF,
      y: VIEW_HALF - (event.clientY - rect.top) * scale,
    };
  };

  const isOnPuck = (point: Coord) => Math.hypot(point.x - puck.x, point.y - puck.y) <= PUCK_GRAB_RADIUS;

  const handlePointerDown = (event: PointerEvent<SVGSVGElement>) => {
    const point = toPad(event);
    // The puck moves only when grabbed; a press on empty pad space does nothing.
    if (!isOnPuck(point)) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { last: point, virtual: puck };
    setIsDragging(true);
    onDragStateChange(true);
  };

  const handlePointerMove = (event: PointerEvent<SVGSVGElement>) => {
    if (!drag.current) return;
    const point = toPad(event);
    const factor = event.shiftKey ? FINE_DRAG : 1;
    const virtual = {
      x: drag.current.virtual.x + (point.x - drag.current.last.x) * factor,
      y: drag.current.virtual.y + (point.y - drag.current.last.y) * factor,
    };
    drag.current = { last: point, virtual };
    schedulePuck(clampToPad(virtual));
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
    onPuckChange(clampToPad({ x: puck.x + direction.x * step, y: puck.y + direction.y * step }));
  };

  const puckView = toView(puck);

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
        <clipPath id={`${gradientId}-clip`}>
          <circle r={1} />
        </clipPath>
        {pad.anchors.map((anchor) => {
          const at = toView(anchorPoint(anchor.t));
          const [toward, away] = anchor.target >= 0 ? [WARM, COOL] : [COOL, WARM];
          return (
            <linearGradient
              gradientUnits="userSpaceOnUse"
              id={`${gradientId}-${anchor.id}`}
              key={anchor.id}
              x1={at.x}
              x2={-at.x}
              y1={at.y}
              y2={-at.y}
            >
              <stop offset={0} stopColor={toward} stopOpacity={anchor.muted ? 0 : 0.2} />
              <stop offset={0.5} stopColor={toward} stopOpacity={0} />
              <stop offset={1} stopColor={away} stopOpacity={anchor.muted ? 0 : 0.1} />
            </linearGradient>
          );
        })}
      </defs>

      <g clipPath={`url(#${gradientId}-clip)`}>
        {pad.anchors.map((anchor) => (
          <rect fill={`url(#${gradientId}-${anchor.id})`} height={2} key={anchor.id} width={2} x={-1} y={-1} />
        ))}
      </g>
      <circle className="fill-none stroke-text-secondary" r={1} strokeOpacity={0.6} strokeWidth={0.008} />
      <path className="stroke-text-secondary" d="M -0.05 0 H 0.05 M 0 -0.05 V 0.05" strokeWidth={0.008} />

      {pad.anchors.map((anchor) => {
        const direction = anchorPoint(anchor.t);
        const at = toView(direction);
        const isCorner = Math.abs(direction.x) > 0.3 && Math.abs(direction.y) > 0.3;
        // Corner anchors label above or below the dot; others outward, so no label leaves the pad.
        const labelAt = isCorner
          ? { x: at.x, y: at.y + (direction.y > 0 ? -0.12 : 0.18) }
          : { x: direction.x * 1.18, y: -direction.y * 1.18 };
        const textAnchor = isCorner || Math.abs(direction.x) <= 0.3 ? 'middle' : direction.x > 0 ? 'start' : 'end';
        const isAbove = direction.y > 0.3;
        const value = isDragging
          ? formatSigned(anchorValue(anchor, puck, pad.amount), getStep(anchor))
          : `→ ${formatSigned(anchor.target, getStep(anchor))}`;
        return (
          <g key={anchor.id} opacity={anchor.muted ? 0.4 : 1}>
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
            <text
              className={clsx('font-mono', isDragging ? 'fill-accent' : 'fill-text-secondary')}
              dominantBaseline="middle"
              fontSize={0.09}
              textAnchor={textAnchor}
              x={labelAt.x}
              y={labelAt.y + (isAbove ? 0 : 0.13)}
            >
              {value}
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

/** The Orbit Blend Pad: three fixed tools on a circle, blended by dragging one puck. */
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

  const parametersById = useMemo(
    () => Object.fromEntries(parameters.map((parameter) => [parameter.id, parameter])),
    [parameters],
  );
  const toolOptions = useMemo(
    () => parameters.map((parameter) => ({ label: controlLabel(parameter.id), value: parameter.id })),
    [parameters, controlLabel],
  );

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

  /** A new tool keeps the target's share of its range, so the anchor stays as strong. */
  const handleToolChange = (anchor: BlendPadAnchor, param: string) => {
    const before = parametersById[anchor.param];
    const after = parametersById[param];
    if (!after) return;
    const reach = (parameter: BlendPadParameter) => Math.max(Math.abs(parameter.min), Math.abs(parameter.max));
    const share = before ? anchor.target / reach(before) : 0;
    const target = Math.round((share * reach(after)) / after.step) * after.step;
    updateAnchor(anchor.id, { param, target: Math.min(after.max, Math.max(after.min, target)) });
  };

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
              className="p-2 rounded-full hover:bg-surface transition-colors"
              data-tooltip={t('editor.blendPad.reset')}
              onClick={() => updatePad(createBlendPad, t('editor.blendPad.reset'))}
            >
              <RotateCcw size={18} />
            </button>
          </>
        }
      />
      <div className="grow overflow-y-auto p-4 compact:p-3 flex flex-col gap-4 compact:gap-3">
        <div className={clsx('transition-opacity', !pad.enabled && 'opacity-40')}>
          <PadField
            getLabel={getLabel}
            getStep={getStep}
            onDragStateChange={handleDragStateChange}
            onPuckChange={handlePuckChange}
            pad={pad}
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

        {BLEND_PAD_SLOTS.map((slot) => {
          const anchor = pad.anchors.find((candidate) => candidate.id === slot.id);
          const parameter = anchor && parametersById[anchor.param];
          if (!anchor || !parameter) return null;
          return (
            <div className="flex flex-col gap-2 pt-3 compact:pt-2 border-t border-surface" key={slot.id}>
              <div className="flex items-center gap-2">
                <Text variant={TextVariants.label} className="w-24 shrink-0 text-text-secondary">
                  {t(`editor.blendPad.slots.${slot.id}`)}
                </Text>
                <Dropdown
                  className="grow min-w-0"
                  onChange={(param: string) => handleToolChange(anchor, param)}
                  options={toolOptions}
                  value={anchor.param}
                />
              </div>
              <Slider
                defaultValue={anchor.param === slot.param ? slot.target : 0}
                label={t('editor.blendPad.target')}
                max={parameter.max}
                min={parameter.min}
                onChange={(event) => updateAnchor(anchor.id, { target: Number(event.target.value) })}
                onDragStateChange={handleDragStateChange}
                step={parameter.step}
                value={anchor.target}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
