import { type PointerEvent as ReactPointerEvent, useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import Text from './Text';
import { TextVariants } from '../../types/typography';

/** A range bar's values in percent: the fully selected span and the fades beyond each end. */
export interface RangeValues {
  min: number;
  max: number;
  minFade: number;
  maxFade: number;
}

/**
 * A Lightroom-style range bar: two handles bound the fully selected span, two smaller ones
 * set the fades beyond it; the span drags as a whole and clicking the title resets it.
 */
export function RangePicker({
  title,
  startLabel,
  endLabel,
  gradient,
  value,
  defaults,
  onChange,
  onDragStateChange,
}: {
  title: string;
  startLabel: string;
  endLabel: string;
  /** CSS background of the track, from the 0 end to the 100 end. */
  gradient: string;
  value: RangeValues;
  defaults: RangeValues;
  onChange: (values: RangeValues) => void;
  onDragStateChange?: (isDragging: boolean) => void;
}) {
  const { t } = useTranslation();
  const trackRef = useRef<HTMLDivElement>(null);
  const [activeHandle, setActiveHandle] = useState<string | null>(null);
  const [dragValues, setDragValues] = useState<RangeValues | null>(null);
  const rafRef = useRef<number>(0);
  const [isLabelHovered, setIsLabelHovered] = useState(false);

  const vals = dragValues ?? value;
  const fadeLeftEdge = Math.max(0, vals.min - vals.minFade);
  const fadeRightEdge = Math.min(100, vals.max + vals.maxFade);

  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const getVal = (e: { clientX: number }): number => {
    if (!trackRef.current) return 0;
    const rect = trackRef.current.getBoundingClientRect();
    return Math.max(0, Math.min(100, Math.round(((e.clientX - rect.left) / rect.width) * 100)));
  };

  const compute = (handle: string, val: number, init: RangeValues & { startVal: number }): RangeValues => {
    switch (handle) {
      case 'min': {
        const v = Math.max(0, Math.min(val, init.max));
        return { min: v, max: init.max, minFade: Math.min(init.minFade, v), maxFade: init.maxFade };
      }
      case 'max': {
        const v = Math.max(init.min, Math.min(100, val));
        return {
          min: init.min,
          max: v,
          minFade: init.minFade,
          maxFade: Math.min(init.maxFade, 100 - v),
        };
      }
      case 'fadeLeft': {
        const edge = Math.max(0, Math.min(val, init.min));
        return {
          min: init.min,
          max: init.max,
          minFade: init.min - edge,
          maxFade: init.maxFade,
        };
      }
      case 'fadeRight': {
        const edge = Math.max(init.max, Math.min(100, val));
        return {
          min: init.min,
          max: init.max,
          minFade: init.minFade,
          maxFade: edge - init.max,
        };
      }
      case 'range': {
        const delta = val - init.startVal;
        const width = init.max - init.min;
        let nMin = Math.round(init.min + delta);
        let nMax = Math.round(init.max + delta);
        if (nMin < 0) {
          nMin = 0;
          nMax = width;
        }
        if (nMax > 100) {
          nMax = 100;
          nMin = 100 - width;
        }
        return {
          min: nMin,
          max: nMax,
          minFade: Math.min(init.minFade, nMin),
          maxFade: Math.min(init.maxFade, 100 - nMax),
        };
      }
      default:
        return { min: init.min, max: init.max, minFade: init.minFade, maxFade: init.maxFade };
    }
  };

  const beginDrag = (handle: string) => (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    setActiveHandle(handle);
    onDragStateChange?.(true);

    const init = { ...vals, startVal: getVal(e) };
    let latest = { ...vals };
    let pending = false;
    const pointerId = e.pointerId;
    const previousTouchAction = document.documentElement.style.touchAction;
    const previousUserSelect = document.documentElement.style.userSelect;

    const target = e.currentTarget;

    target.setPointerCapture?.(pointerId);
    document.documentElement.style.touchAction = 'none';
    document.documentElement.style.userSelect = 'none';

    const onMove = (me: PointerEvent) => {
      if (me.pointerId !== pointerId) return;
      if (me.cancelable) me.preventDefault();
      latest = compute(handle, getVal(me), init);
      setDragValues(latest);

      if (!pending) {
        pending = true;
        rafRef.current = requestAnimationFrame(() => {
          onChange(latest);
          pending = false;
        });
      }
    };

    const onUp = (upEvent: PointerEvent) => {
      if (upEvent.pointerId !== pointerId) return;
      setActiveHandle(null);
      if (target.hasPointerCapture?.(pointerId)) target.releasePointerCapture(pointerId);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      onChange(latest);
      onDragStateChange?.(false);
      document.documentElement.style.touchAction = previousTouchAction;
      document.documentElement.style.userSelect = previousUserSelect;

      requestAnimationFrame(() => setDragValues(null));

      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);
    };

    document.addEventListener('pointermove', onMove, { passive: false });
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
  };

  const handleColor = (handle: string, isMain: boolean) =>
    activeHandle === handle
      ? 'var(--color-accent, #818cf8)'
      : isMain
        ? 'rgba(255,255,255,0.85)'
        : 'rgba(255,255,255,0.45)';

  const handleReset = () => {
    onChange(defaults);
  };

  const isDragging = activeHandle !== null;

  return (
    <div className="space-y-2">
      <div
        className="grid w-fit cursor-pointer"
        onClick={handleReset}
        onMouseEnter={() => setIsLabelHovered(true)}
        onMouseLeave={() => setIsLabelHovered(false)}
      >
        <Text
          variant={TextVariants.label}
          aria-hidden={isLabelHovered}
          className={`col-start-1 row-start-1 select-none transition-opacity duration-200 ease-in-out ${
            isLabelHovered ? 'opacity-0' : 'opacity-100'
          }`}
        >
          {title}
        </Text>
        <Text
          variant={TextVariants.label}
          aria-hidden={!isLabelHovered}
          className={`col-start-1 row-start-1 text-accent! select-none transition-opacity duration-200 ease-in-out pointer-events-none ${
            isLabelHovered ? 'opacity-100' : 'opacity-0'
          }`}
        >
          {t('ui.slider.reset')}
        </Text>
      </div>
      <div ref={trackRef} className="relative rounded-md overflow-hidden mt-2 select-none" style={{ height: 44 }}>
        {isDragging && (
          <div
            className="fixed inset-0 z-9999"
            style={{ cursor: activeHandle === 'range' ? 'grabbing' : 'ew-resize' }}
          />
        )}

        <div className="absolute inset-0" style={{ background: gradient }} />
        <div
          className="absolute inset-y-0 left-0 bg-black/60 pointer-events-none"
          style={{ width: `${fadeLeftEdge}%` }}
        />
        <div
          className="absolute inset-y-0 right-0 bg-black/60 pointer-events-none"
          style={{ width: `${100 - fadeRightEdge}%` }}
        />

        {vals.minFade > 0.5 && (
          <div
            className="absolute inset-y-0 pointer-events-none"
            style={{
              left: `${fadeLeftEdge}%`,
              width: `${vals.minFade}%`,
              background: 'linear-gradient(to right, rgba(0,0,0,0.6), transparent)',
            }}
          />
        )}
        {vals.maxFade > 0.5 && (
          <div
            className="absolute inset-y-0 pointer-events-none"
            style={{
              left: `${vals.max}%`,
              width: `${vals.maxFade}%`,
              background: 'linear-gradient(to right, transparent, rgba(0,0,0,0.6))',
            }}
          />
        )}

        {[0, 1].map((i) => (
          <div
            key={i}
            className="absolute h-px pointer-events-none"
            style={{
              left: `${vals.min}%`,
              width: `${Math.max(0, vals.max - vals.min)}%`,
              background: 'rgba(255,255,255,0.3)',
              ...(i === 0 ? { top: 0 } : { bottom: 0 }),
            }}
          />
        ))}

        {[
          { pos: fadeLeftEdge, key: 'fadeLeft', main: false },
          { pos: vals.min, key: 'min', main: true },
          { pos: vals.max, key: 'max', main: true },
          { pos: fadeRightEdge, key: 'fadeRight', main: false },
        ].map(({ pos, key, main }) => (
          <div
            key={`line-${key}`}
            className="absolute inset-y-0 pointer-events-none"
            style={{
              left: `${pos}%`,
              transform: 'translateX(-50%)',
              width: main ? 2 : 1,
              background: handleColor(key, main),
              transition: activeHandle ? 'none' : 'background 0.15s',
            }}
          />
        ))}

        <div
          className="absolute inset-y-0"
          style={{
            left: `${vals.min}%`,
            width: `${Math.max(0, vals.max - vals.min)}%`,
            cursor: activeHandle === 'range' ? 'grabbing' : 'grab',
            zIndex: 5,
          }}
          onPointerDown={beginDrag('range')}
        />

        {[
          { pos: fadeLeftEdge, key: 'fadeLeft' },
          { pos: fadeRightEdge, key: 'fadeRight' },
        ].map(({ pos, key }) => (
          <div
            key={key}
            className="absolute flex items-start justify-center cursor-ew-resize"
            style={{ left: `${pos}%`, transform: 'translateX(-50%)', top: 0, height: '50%', width: 28, zIndex: 15 }}
            onPointerDown={beginDrag(key)}
          >
            <svg width="8" height="5" viewBox="0 0 8 5" style={{ marginTop: 3 }}>
              <polygon points="4,5 8,0 0,0" fill={handleColor(key, false)} />
            </svg>
          </div>
        ))}

        {[
          { pos: vals.min, key: 'min' },
          { pos: vals.max, key: 'max' },
        ].map(({ pos, key }) => (
          <div
            key={key}
            className="absolute flex items-end justify-center cursor-ew-resize"
            style={{ left: `${pos}%`, transform: 'translateX(-50%)', bottom: 0, height: '50%', width: 28, zIndex: 20 }}
            onPointerDown={beginDrag(key)}
          >
            <svg width="10" height="6" viewBox="0 0 10 6" style={{ marginBottom: 3 }}>
              <polygon points="5,0 10,6 0,6" fill={handleColor(key, true)} />
            </svg>
          </div>
        ))}
      </div>
      <Text as="div" variant={TextVariants.small} className="flex justify-between select-none px-1">
        <span>{startLabel}</span>
        <span>{endLabel}</span>
      </Text>
    </div>
  );
}

/** A depth range in nearness percent (100 nearest), as Lens Blur and depth masks store it. */
export interface DepthRange {
  minDepth: number;
  maxDepth: number;
  minFade: number;
  maxFade: number;
}

const DEPTH_RANGE_GRADIENT = 'linear-gradient(to right, #ddd 0%, #bbb 20%, #999 35%, #666 55%, #333 80%, #111 100%)';

/** The bar shows Near on the left, so it runs opposite to the stored nearness. */
const depthToBar = ({ minDepth, maxDepth, minFade, maxFade }: DepthRange): RangeValues => ({
  min: 100 - maxDepth,
  max: 100 - minDepth,
  minFade: maxFade,
  maxFade: minFade,
});

/** A range bar over depth, from Near to Far. */
export function DepthRangePicker({
  value,
  defaults,
  onChange,
  onDragStateChange,
}: {
  value: DepthRange;
  defaults: DepthRange;
  onChange: (range: DepthRange) => void;
  onDragStateChange?: (isDragging: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <RangePicker
      title={t('editor.masks.depthRange.title')}
      startLabel={t('editor.masks.depthRange.near')}
      endLabel={t('editor.masks.depthRange.far')}
      gradient={DEPTH_RANGE_GRADIENT}
      value={depthToBar(value)}
      defaults={depthToBar(defaults)}
      onChange={({ min, max, minFade, maxFade }) =>
        onChange({ minDepth: 100 - max, maxDepth: 100 - min, minFade: maxFade, maxFade: minFade })
      }
      onDragStateChange={onDragStateChange}
    />
  );
}
