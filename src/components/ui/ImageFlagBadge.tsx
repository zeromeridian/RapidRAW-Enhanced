import { Clock3, Flag, X } from 'lucide-react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { ImageFlag } from '../../utils/imageFlags';

const FLAG_STYLES: Record<Exclude<ImageFlag, 'unflagged'>, string> = {
  rejected: 'text-red-400',
  selected: 'text-emerald-400',
  deferred: 'text-amber-400',
};

export default function ImageFlagBadge({ flag, className }: { flag: ImageFlag; className?: string }) {
  const { t } = useTranslation();
  if (flag === ImageFlag.Unflagged) return null;

  const Icon = flag === ImageFlag.Rejected ? X : flag === ImageFlag.Deferred ? Clock3 : Flag;

  return (
    <div
      className={clsx(
        'flex h-5 w-5 items-center justify-center rounded-sm bg-black/75 shadow-[0_1px_3px_rgba(0,0,0,0.65)]',
        FLAG_STYLES[flag],
        className,
      )}
      data-tooltip={t(`flags.${flag}`)}
    >
      <Icon size={12} className={flag === ImageFlag.Selected ? 'fill-current' : undefined} />
    </div>
  );
}
