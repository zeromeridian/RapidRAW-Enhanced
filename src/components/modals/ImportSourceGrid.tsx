import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { ImageOff, Loader2 } from 'lucide-react';
import clsx from 'clsx';
import { Invokes } from '../ui/AppProperties';
import { ImportCandidate } from '../ui/ExportImportProperties';
import Text from '../ui/Text';
import TickBox, { getTickState } from '../ui/TickBox';
import { TextColors, TextVariants } from '../../types/typography';

/** Previews made at once; the rest wait, so a card of thousands does not swamp the backend. */
const MAX_THUMBNAIL_LOADS = 4;
let activeThumbnailLoads = 0;
const waitingThumbnailLoads: Array<() => void> = [];

const loadThumbnail = async (path: string): Promise<string> => {
  if (activeThumbnailLoads >= MAX_THUMBNAIL_LOADS) {
    await new Promise<void>((resolve) => waitingThumbnailLoads.push(resolve));
  }
  activeThumbnailLoads += 1;
  try {
    const bytes = await invoke<Uint8Array>(Invokes.GenerateImportThumbnail, { path });
    return URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' }));
  } finally {
    activeThumbnailLoads -= 1;
    waitingThumbnailLoads.shift()?.();
  }
};

const fileName = (path: string) => path.split(/[\\/]/).pop() ?? path;

/** One photo's tile; its preview loads once the tile scrolls into view. */
function ImportTile({
  candidate,
  isChecked,
  onToggle,
}: {
  candidate: ImportCandidate;
  isChecked: boolean;
  onToggle(): void;
}) {
  const tileRef = useRef<HTMLButtonElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [hasFailed, setHasFailed] = useState(false);

  useEffect(() => {
    const tile = tileRef.current;
    if (!tile) return;
    let isCurrent = true;
    let loadedUrl: string | null = null;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      loadThumbnail(candidate.path)
        .then((objectUrl) => {
          loadedUrl = objectUrl;
          if (isCurrent) setUrl(objectUrl);
          else URL.revokeObjectURL(objectUrl);
        })
        .catch(() => isCurrent && setHasFailed(true));
    });
    observer.observe(tile);
    return () => {
      isCurrent = false;
      observer.disconnect();
      if (loadedUrl) URL.revokeObjectURL(loadedUrl);
    };
  }, [candidate.path]);

  return (
    <button
      className={clsx(
        'relative aspect-square rounded-md overflow-hidden bg-bg-primary transition-opacity',
        isChecked ? 'ring-2 ring-accent' : 'opacity-50 hover:opacity-80',
      )}
      data-tooltip={fileName(candidate.path)}
      onClick={onToggle}
      ref={tileRef}
      type="button"
    >
      {url ? (
        <img alt="" className="w-full h-full object-contain" draggable={false} src={url} />
      ) : (
        <span className="flex w-full h-full items-center justify-center text-text-secondary">
          {hasFailed ? <ImageOff size={18} /> : <Loader2 className="animate-spin" size={16} />}
        </span>
      )}
      <span className="absolute top-1 left-1">
        <TickBox state={isChecked ? 'all' : 'none'} />
      </span>
    </button>
  );
}

interface ImportSourceGridProps {
  candidates: Array<ImportCandidate>;
  checked: ReadonlySet<string>;
  onCheckedChange(checked: Set<string>): void;
  isScanning: boolean;
}

/** The photos of an import source by capture day, each day with its own tick (Lightroom Classic's grid). */
export default function ImportSourceGrid({ candidates, checked, onCheckedChange, isScanning }: ImportSourceGridProps) {
  const { t, i18n } = useTranslation();

  const days = useMemo(() => {
    const groups = new Map<string, Array<ImportCandidate>>();
    for (const candidate of candidates) {
      const day = candidate.captureTime.slice(0, 10);
      groups.set(day, [...(groups.get(day) ?? []), candidate]);
    }
    return Array.from(groups, ([day, photos]) => ({ day, photos }));
  }, [candidates]);

  const dayFormat = useMemo(() => new Intl.DateTimeFormat(i18n.language, { dateStyle: 'full' }), [i18n.language]);

  const setPaths = (paths: Array<string>, isOn: boolean) => {
    const next = new Set(checked);
    for (const path of paths) {
      if (isOn) next.add(path);
      else next.delete(path);
    }
    onCheckedChange(next);
  };

  if (isScanning) {
    return (
      <div className="flex-1 flex items-center justify-center gap-2 text-text-secondary">
        <Loader2 className="animate-spin" size={18} />
        <Text>{t('modals.importSettings.scanning')}</Text>
      </div>
    );
  }
  if (candidates.length === 0) {
    return null;
  }

  return (
    // The padding keeps each tile's selection ring inside the scrolling area, which clips.
    <div className="flex-1 overflow-y-auto p-1 pr-2 space-y-4">
      {days.map(({ day, photos }) => {
        const tickedCount = photos.filter((photo) => checked.has(photo.path)).length;
        const state = getTickState(tickedCount, photos.length);
        // `YYYY-MM-DD` read as a local date, so the day shown is the camera's day.
        const [year, month, date] = day.split('-').map(Number);
        return (
          <section key={day}>
            <button
              className="flex items-center gap-2 mb-2 text-left"
              onClick={() =>
                setPaths(
                  photos.map((photo) => photo.path),
                  state !== 'all',
                )
              }
              type="button"
            >
              <TickBox state={state} />
              <Text as="span" variant={TextVariants.label} color={TextColors.primary}>
                {dayFormat.format(new Date(year, month - 1, date))}
              </Text>
              <Text as="span" variant={TextVariants.small}>
                {t('modals.importSettings.selectedCount', { selected: tickedCount, total: photos.length })}
              </Text>
            </button>
            <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(186px, 1fr))' }}>
              {photos.map((photo) => (
                <ImportTile
                  candidate={photo}
                  isChecked={checked.has(photo.path)}
                  key={photo.path}
                  onToggle={() => setPaths([photo.path], !checked.has(photo.path))}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
