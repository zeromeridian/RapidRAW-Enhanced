import { useEffect, useState } from 'react';

/**
 * Whether Alt/Option is held right now, kept current from key and pointer events (a pointer
 * event also reports Alt pressed while the window was not focused); cleared when the window
 * loses focus.
 */
export function useIsAltHeld(): boolean {
  const [isAltHeld, setIsAltHeld] = useState(false);
  useEffect(() => {
    const track = (e: KeyboardEvent | PointerEvent) => setIsAltHeld(e.altKey);
    const release = () => setIsAltHeld(false);
    window.addEventListener('keydown', track);
    window.addEventListener('keyup', track);
    window.addEventListener('pointermove', track);
    window.addEventListener('blur', release);
    return () => {
      window.removeEventListener('keydown', track);
      window.removeEventListener('keyup', track);
      window.removeEventListener('pointermove', track);
      window.removeEventListener('blur', release);
    };
  }, []);
  return isAltHeld;
}
