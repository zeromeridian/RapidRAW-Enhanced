import clsx from 'clsx';
import { RefreshCw, Settings } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import Switch from '../../ui/Switch';
import Text from '../../ui/Text';
import { TextColors, TextVariants } from '../../../types/typography';
import { toggleAutoSync } from '../../../hooks/useEditorActions';
import { useLibraryStore } from '../../../store/useLibraryStore';
import { useSettingsStore } from '../../../store/useSettingsStore';
import { useUIStore } from '../../../store/useUIStore';

/** Lightroom-style Auto Sync control pinned to the bottom of the Develop sidebar. */
export default function AutoSyncFooter() {
  const { t } = useTranslation();
  const isAutoSyncOn = useSettingsStore((state) => state.appSettings?.copyPasteSettings?.autoSync === true);
  const selectedCount = useLibraryStore((state) => state.multiSelectedPaths.length);
  const setUI = useUIStore((state) => state.setUI);
  const isSyncing = isAutoSyncOn && selectedCount > 1;

  const status = !isAutoSyncOn
    ? t('editor.autoSync.off')
    : isSyncing
      ? t('editor.autoSync.syncing', { count: selectedCount })
      : t('editor.autoSync.single');

  return (
    <div className="shrink-0 border-t border-surface p-2">
      <div
        className={clsx(
          'flex items-center gap-2 rounded-lg px-3 py-2 transition-colors',
          isSyncing ? 'bg-accent/15 ring-1 ring-accent/60' : 'bg-surface',
        )}
      >
        <RefreshCw size={18} className={clsx('shrink-0', isSyncing ? 'text-accent' : 'text-text-secondary')} />
        <div className="min-w-0 flex-1">
          <Switch label={t('editor.autoSync.title')} checked={isAutoSyncOn} onChange={toggleAutoSync} />
          <Text variant={TextVariants.small} color={TextColors.secondary} className="truncate">
            {status}
          </Text>
        </div>
        <button
          className="w-8 h-8 shrink-0 flex items-center justify-center rounded-md text-text-secondary hover:bg-card-active hover:text-text-primary transition-colors"
          onClick={() => setUI({ isCopyPasteSettingsModalOpen: true })}
          data-tooltip={t('editor.autoSync.chooseSettings')}
        >
          <Settings size={16} />
        </button>
      </div>
    </div>
  );
}
