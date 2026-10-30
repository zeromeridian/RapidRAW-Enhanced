import { ReactNode } from 'react';
import Text from './Text';
import { TextVariants } from '../../types/typography';

interface PanelHeaderProps {
  actions?: ReactNode;
  icon?: ReactNode;
  title: string;
}

/** Title bar of a side panel, with optional leading icon and trailing action buttons. */
export default function PanelHeader({ actions, icon, title }: PanelHeaderProps) {
  return (
    <div className="p-4 compact:px-3 compact:py-2 flex items-center gap-2 shrink-0 border-b border-surface compact:[&_button]:p-1">
      {icon}
      <Text variant={TextVariants.title} className="grow compact:text-base">
        {title}
      </Text>
      {actions && <div className="flex items-center gap-1 shrink-0">{actions}</div>}
    </div>
  );
}
