import { useCallback, useEffect, useRef } from 'react';
import clsx from 'clsx';

interface AngleDialProps {
  defaultValue?: number;
  disabled?: boolean;
  label: string;
  onChange(value: number): void;
  onDragStateChange?(isDragging: boolean): void;
  size?: number;
  value: number;
}

const SNAP_DEGREES = 15;
const TICK_ANGLES = [0, 45, 90, 135, 180, 225, 270, 315];
const KEY_DIRECTIONS: Record<string, number> = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 };

// The dial sets an undirected line, so opposite directions are the same angle
// and every value folds into (-90, 90].
const foldAngle = (degrees: number) => {
  const folded = ((((degrees + 90) % 180) + 180) % 180) - 90;
  if (folded === -90) return 90;
  return Object.is(folded, -0) ? 0 : folded;
};

/**
 * A compass-style dial for choosing a line direction in degrees,
 * counter-clockwise from horizontal. Drag to aim, hold Shift to snap to 15°,
 * double-click to reset, or use the arrow keys.
 */
const AngleDial = ({
  defaultValue = 0,
  disabled = false,
  label,
  onChange,
  onDragStateChange = () => {},
  size = 48,
  value,
}: AngleDialProps) => {
  const isDraggingRef = useRef(false);
  const frameRef = useRef<number | undefined>(undefined);
  const pendingValueRef = useRef<number | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(
    () => () => {
      if (frameRef.current !== undefined) cancelAnimationFrame(frameRef.current);
    },
    [],
  );

  const flushChange = useCallback(() => {
    frameRef.current = undefined;
    const pendingValue = pendingValueRef.current;
    pendingValueRef.current = null;
    if (pendingValue !== null) onChangeRef.current(pendingValue);
  }, []);

  const scheduleChange = useCallback(
    (nextValue: number) => {
      pendingValueRef.current = nextValue;
      if (frameRef.current === undefined) frameRef.current = requestAnimationFrame(flushChange);
    },
    [flushChange],
  );

  const angleFromPointer = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const dx = event.clientX - (rect.left + rect.width / 2);
    const dy = event.clientY - (rect.top + rect.height / 2);
    if (dx === 0 && dy === 0) return null;
    const degrees = (Math.atan2(-dy, dx) * 180) / Math.PI;
    const step = event.shiftKey ? SNAP_DEGREES : 1;
    return foldAngle(Math.round(degrees / step) * step);
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (disabled || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.focus();
    isDraggingRef.current = true;
    onDragStateChange(true);
    const nextValue = angleFromPointer(event);
    if (nextValue !== null) scheduleChange(nextValue);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current) return;
    const nextValue = angleFromPointer(event);
    if (nextValue !== null) scheduleChange(nextValue);
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current) return;
    isDraggingRef.current = false;
    event.currentTarget.releasePointerCapture(event.pointerId);
    if (frameRef.current !== undefined) {
      cancelAnimationFrame(frameRef.current);
      flushChange();
    }
    onDragStateChange(false);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const direction = KEY_DIRECTIONS[event.key];
    if (direction === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    onChange(foldAngle(value + direction * (event.shiftKey ? SNAP_DEGREES : 1)));
  };

  const center = size / 2;
  const radius = center - 3;
  const radians = (value * Math.PI) / 180;
  const dx = Math.cos(radians) * (radius - 3);
  const dy = -Math.sin(radians) * (radius - 3);

  return (
    <div
      aria-label={label}
      aria-valuemax={90}
      aria-valuemin={-90}
      aria-valuenow={value}
      aria-disabled={disabled}
      className={clsx(
        'shrink-0 rounded-full outline-none focus-visible:ring-1 focus-visible:ring-accent',
        disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer',
      )}
      data-tooltip={label}
      onDoubleClick={() => !disabled && onChange(defaultValue)}
      onKeyDown={handleKeyDown}
      onLostPointerCapture={handlePointerUp}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      role="slider"
      style={{ height: size, width: size, touchAction: 'none' }}
      tabIndex={disabled ? -1 : 0}
    >
      <svg height={size} viewBox={`0 0 ${size} ${size}`} width={size}>
        <circle className="fill-bg-primary stroke-surface" cx={center} cy={center} r={radius} strokeWidth={1.5} />
        {TICK_ANGLES.map((tick) => {
          const tickRadians = (tick * Math.PI) / 180;
          const inner = tick % 90 === 0 ? radius - 4 : radius - 2.5;
          return (
            <line
              className="stroke-text-secondary"
              key={tick}
              opacity={0.5}
              strokeWidth={1}
              x1={center + Math.cos(tickRadians) * inner}
              x2={center + Math.cos(tickRadians) * radius}
              y1={center - Math.sin(tickRadians) * inner}
              y2={center - Math.sin(tickRadians) * radius}
            />
          );
        })}
        <line
          className="stroke-accent"
          strokeLinecap="round"
          strokeWidth={2}
          x1={center - dx}
          x2={center + dx}
          y1={center - dy}
          y2={center + dy}
        />
        <circle className="fill-accent" cx={center + dx} cy={center + dy} r={2.5} />
        <circle className="fill-accent" cx={center - dx} cy={center - dy} r={2.5} />
      </svg>
    </div>
  );
};

export default AngleDial;
