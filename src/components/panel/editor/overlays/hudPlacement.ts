import { Coord } from '../../../../utils/adjustments';

/** How far a pointer label sits from the cursor, in screen pixels. */
const HUD_OFFSET = 16;

const toLocalPoint = (element: HTMLElement | null, client: Coord | null): Coord | null => {
  if (!element || !client) return null;
  const rect = element.getBoundingClientRect();
  const x = client.x - rect.left;
  const y = client.y - rect.top;
  return x >= 0 && y >= 0 && x <= rect.width && y <= rect.height ? { x, y } : null;
};

/**
 * Places a pointer label (Speed Edit, the Zone Color Grading readout) beside the cursor inside
 * `overlay`, flipped to the cursor's other side near the right and bottom edges. Once placed, it
 * stays where it was while the cursor is outside the overlay.
 */
export const placeHud = (hud: HTMLElement | null, overlay: HTMLElement | null, client: Coord | null) => {
  if (!hud || !overlay || !client) return;
  if (hud.style.transform && !toLocalPoint(overlay, client)) return;
  const rect = overlay.getBoundingClientRect();
  const x = Math.min(Math.max(client.x - rect.left, 0), rect.width);
  const y = Math.min(Math.max(client.y - rect.top, 0), rect.height);
  const shift = (isFlipped: boolean) => (isFlipped ? `calc(-100% - ${HUD_OFFSET}px)` : `${HUD_OFFSET}px`);
  hud.style.transition = hud.style.transform ? 'transform 150ms ease-out' : 'none';
  hud.style.left = `${x}px`;
  hud.style.top = `${y}px`;
  hud.style.transform = `translate(${shift(x > rect.width * 0.75)}, ${shift(y > rect.height * 0.75)})`;
};
