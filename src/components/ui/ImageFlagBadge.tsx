import { Clock3, Flag, FlagOff, X } from 'lucide-react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { ImageFlag } from '../../utils/imageFlags';

export function ImageFlagIcon({ flag, size = 12, className }: { flag: ImageFlag; size?: number; className?: string }) {
  const Icon =
    flag === ImageFlag.Rejected
      ? X
      : flag === ImageFlag.Deferred
        ? Clock3
        : flag === ImageFlag.Unflagged
          ? FlagOff
          : Flag;

  return <Icon size={size} className={clsx(flag === ImageFlag.Selected && 'fill-current', className)} />;
}

export default function ImageFlagBadge({ flag, className }: { flag: ImageFlag; className?: string }) {
  const { t } = useTranslation();
  if (flag === ImageFlag.Unflagged) return null;

  return (
    <div
      className={clsx(
        'flex h-5 w-5 items-center justify-center rounded-sm bg-black/65 text-white/90 shadow-[0_1px_3px_rgba(0,0,0,0.65)]',
        className,
      )}
      data-tooltip={t(`flags.${flag}`)}
    >
      <ImageFlagIcon flag={flag} />
    </div>
  );
}
