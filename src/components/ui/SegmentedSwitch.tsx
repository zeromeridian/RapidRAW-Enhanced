import { ReactNode } from 'react';
import clsx from 'clsx';

interface SegmentedSwitchOption<T extends string> {
  value: T;
  label: ReactNode;
}

interface SegmentedSwitchProps<T extends string> {
  className?: string;
  onChange(value: T): void;
  options: ReadonlyArray<SegmentedSwitchOption<T>>;
  value: T;
}

/** Equal-width buttons of which one is chosen (the Color Mixer's mode, the Adjustments view). */
export default function SegmentedSwitch<T extends string>({
  className,
  onChange,
  options,
  value,
}: SegmentedSwitchProps<T>) {
  return (
    <div className={clsx('grid gap-1', className)} style={{ gridTemplateColumns: `repeat(${options.length}, 1fr)` }}>
      {options.map((option) => (
        <button
          aria-pressed={value === option.value}
          className={clsx(
            'py-1 rounded-md text-xs transition-colors',
            value === option.value
              ? 'bg-accent text-button-text shadow-sm'
              : 'bg-surface text-text-secondary hover:bg-card-active hover:text-text-primary',
          )}
          key={option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
