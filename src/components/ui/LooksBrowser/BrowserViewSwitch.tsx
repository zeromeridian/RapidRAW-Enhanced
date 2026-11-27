import { LayoutGrid, List } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';

interface BrowserViewSwitchProps {
  isGrid: boolean;
  onChange(isGrid: boolean): void;
}

/** A Looks browser's layout: a grid of previews or a list. */
export default function BrowserViewSwitch({ isGrid, onChange }: BrowserViewSwitchProps) {
  const { t } = useTranslation();
  return (
    <div className="flex gap-1">
      {[
        { value: true, icon: LayoutGrid, label: t('editor.looks.viewGrid') },
        { value: false, icon: List, label: t('editor.looks.viewList') },
      ].map(({ value, icon: Icon, label }) => (
        <button
          key={label}
          aria-pressed={isGrid === value}
          className={clsx(
            'p-1 rounded-sm transition-colors',
            isGrid === value ? 'text-accent' : 'text-text-secondary hover:text-text-primary',
          )}
          data-tooltip={label}
          onClick={() => onChange(value)}
        >
          <Icon size={14} />
        </button>
      ))}
    </div>
  );
}
