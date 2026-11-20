import { Check, Minus } from 'lucide-react';
import clsx from 'clsx';

export type TickState = 'all' | 'some' | 'none';

/** The tick state of a list from how many of its `total` items are ticked. */
export const getTickState = (ticked: number, total: number): TickState =>
  ticked === 0 ? 'none' : ticked === total ? 'all' : 'some';

/** A box that shows ✓ when every item is ticked, − when some are. */
export default function TickBox({ state }: { state: TickState }) {
  return (
    <span
      className={clsx(
        'flex items-center justify-center w-4 h-4 rounded-sm border shrink-0',
        state === 'none' ? 'border-text-secondary bg-bg-primary/70' : 'border-accent bg-accent text-button-text',
      )}
    >
      {state === 'all' && <Check size={12} strokeWidth={3} />}
      {state === 'some' && <Minus size={12} strokeWidth={3} />}
    </span>
  );
}
