import { useEffect, useLayoutEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useEditorStore } from '../../../../store/useEditorStore';
import { Coord } from '../../../../utils/adjustments';
import { ZONE_NAMES } from '../../../../utils/zoneTint';
import { placeHud } from './hudPlacement';

/**
 * Zone Color Grading's hover readout beside the cursor (owner 2026-11-15), like the Speed Edit
 * display: the zone under the cursor and its lightness, e.g. "Zone VI · L 0.62". The reading
 * comes from `useZoneHoverReadout` (`zoneTintHover`); hidden while Speed Edit shows its own.
 */
export default function ZoneHoverReadout() {
  const { t } = useTranslation();
  const hover = useEditorStore((state) => state.zoneTintHover);
  const isSpeedEditing = useEditorStore((state) => state.isSpeedEditActive);
  const overlayRef = useRef<HTMLDivElement>(null);
  const hudRef = useRef<HTMLDivElement>(null);
  const lastPointerRef = useRef<Coord | null>(null);

  useEffect(() => {
    const handlePointerMove = (e: PointerEvent) => {
      lastPointerRef.current = { x: e.clientX, y: e.clientY };
      placeHud(hudRef.current, overlayRef.current, lastPointerRef.current);
    };
    window.addEventListener('pointermove', handlePointerMove);
    return () => window.removeEventListener('pointermove', handlePointerMove);
  }, []);

  // A label that just appeared starts at the cursor instead of the overlay's corner.
  useLayoutEffect(() => {
    placeHud(hudRef.current, overlayRef.current, lastPointerRef.current);
  });

  return (
    <div className="absolute inset-0 z-40 pointer-events-none" ref={overlayRef}>
      {hover && !isSpeedEditing && (
        <div className="absolute" ref={hudRef}>
          <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-surface/95 backdrop-blur-md shadow-xl text-xs text-text-primary whitespace-nowrap">
            <span>{t('adjustments.zoneTint.zone', { zone: ZONE_NAMES[hover.zone] })}</span>
            <span className="text-text-secondary">·</span>
            <span className="font-mono tabular-nums">L {hover.lightness.toFixed(2)}</span>
          </div>
        </div>
      )}
    </div>
  );
}
