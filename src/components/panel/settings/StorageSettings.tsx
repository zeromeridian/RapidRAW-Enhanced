import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { ParseKeys } from 'i18next';
import { ExternalLink as ExternalLinkIcon, FolderOpen, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Invokes } from '../../ui/AppProperties';
import { formatBytes } from '../../../utils/formatBytes';
import SettingsPage, { SettingRowDef, SettingsPageProps } from './SettingsPage';
import { ActionButton, PathBox, StatusMessage, useClearableCache, useTimedAction } from './SettingControls';
import { useSettingsContext } from './SettingsContext';

interface SidecarImportResult {
  imported: number;
  skipped: number;
  invalid: number;
  failed: number;
}

export default function StorageSettings({ query }: SettingsPageProps) {
  const { t } = useTranslation();
  const { onLibraryRefresh, requestConfirm, rootPaths } = useSettingsContext();
  const [isImportingSidecars, setIsImportingSidecars] = useState(false);
  const [sidecarImportMessage, setSidecarImportMessage] = useState('');
  const clearSidecars = useTimedAction();
  const clearThumbnails = useTimedAction();
  const [logPath, setLogPath] = useState<string | null>(null);
  const [logPathLoading, setLogPathLoading] = useState(true);
  const [logPathError, setLogPathError] = useState(false);

  const aiDenoiseCache = useClearableCache(Invokes.GetAiDenoiseCacheSize, Invokes.ClearAiDenoiseCache, {
    clearing: t('settings.data.statuses.clearingAiDenoise'),
    success: t('settings.data.statuses.aiDenoiseSuccess'),
  });
  const aiUpscaleCache = useClearableCache(Invokes.GetAiUpscaleCacheSize, Invokes.ClearAiUpscaleCache, {
    clearing: t('settings.data.statuses.clearingAiUpscale'),
    success: t('settings.data.statuses.aiUpscaleSuccess'),
  });
  const externalEditCache = useClearableCache(Invokes.GetEditorRoundTripCacheSize, Invokes.ClearEditorRoundTrips, {
    clearing: t('settings.data.statuses.clearingExternalEdits'),
    success: t('settings.data.statuses.externalEditsSuccess'),
  });

  useEffect(() => {
    invoke<string>(Invokes.GetLogFilePath)
      .then(setLogPath)
      .catch((error) => {
        console.error('Failed to get log file path:', error);
        setLogPathError(true);
      })
      .finally(() => setLogPathLoading(false));
  }, []);

  const handleImportRapidRawSidecars = async () => {
    setIsImportingSidecars(true);
    setSidecarImportMessage(t('settings.data.statuses.importingSidecars'));
    try {
      const totals: SidecarImportResult = { imported: 0, skipped: 0, invalid: 0, failed: 0 };
      for (const rootPath of rootPaths) {
        const result = await invoke<SidecarImportResult>(Invokes.ImportRapidRawSidecars, { rootPath });
        totals.imported += result.imported;
        totals.skipped += result.skipped;
        totals.invalid += result.invalid;
        totals.failed += result.failed;
      }
      setSidecarImportMessage(t('settings.data.statuses.sidecarImportSuccess', { ...totals }));
      if (totals.imported > 0) onLibraryRefresh();
    } catch (err: unknown) {
      console.error('Failed to import RapidRAW sidecars:', err);
      setSidecarImportMessage(`Error: ${String(err)}`);
    } finally {
      setIsImportingSidecars(false);
    }
  };

  const handleClearSidecars = () =>
    requestConfirm({
      confirmText: t('settings.data.modals.confirmDeleteAllEdits'),
      message: t('settings.data.modals.sidecarMessage'),
      title: t('settings.data.modals.confirmTitle'),
      onConfirm: () =>
        clearSidecars.run(t('settings.data.statuses.deleting'), async () => {
          let count = 0;
          for (const rootPath of rootPaths) {
            count += await invoke<number>(Invokes.ClearAllSidecars, { rootPath });
          }
          onLibraryRefresh();
          return t('settings.data.statuses.sidecarSuccess', { count });
        }),
    });

  const handleClearThumbnails = () =>
    requestConfirm({
      confirmText: t('settings.data.modals.confirmClearCache'),
      message: t('settings.data.modals.cacheMessage'),
      title: t('settings.data.modals.confirmCacheTitle'),
      onConfirm: () =>
        clearThumbnails.run(t('settings.data.statuses.clearingCache'), async () => {
          await invoke(Invokes.ClearThumbnailCache);
          onLibraryRefresh();
          return t('settings.data.statuses.cacheSuccess');
        }),
    });

  /** A row that clears one of the app's caches, showing its size. */
  const cacheRow = (
    id: string,
    cache: ReturnType<typeof useClearableCache>,
    keys: { title: ParseKeys; description: ParseKeys; button: ParseKeys; message: ParseKeys },
  ): SettingRowDef => ({
    id,
    label: t(keys.title),
    description: t(keys.description, { size: cache.size === null ? '…' : formatBytes(cache.size, t) }),
    control: (
      <ActionButton
        disabled={!cache.size}
        icon={Trash2}
        isProcessing={cache.isClearing}
        onClick={() =>
          requestConfirm({
            confirmText: t('settings.data.modals.confirmClearCache'),
            message: t(keys.message),
            title: t('settings.data.modals.confirmCacheTitle'),
            onConfirm: cache.clearCache,
          })
        }
        text={t(keys.button)}
      />
    ),
    details: cache.message && <StatusMessage message={cache.message} />,
  });

  return (
    <SettingsPage
      query={query}
      title={t('settings.categories.storage')}
      sections={[
        {
          id: 'data-management',
          title: t('settings.data.title'),
          rows: [
            {
              id: 'import-sidecars',
              label: t('settings.data.importSidecars'),
              description: t('settings.data.importSidecarsDesc'),
              control: (
                <ActionButton
                  disabled={rootPaths.length === 0}
                  icon={FolderOpen}
                  isProcessing={isImportingSidecars}
                  onClick={handleImportRapidRawSidecars}
                  text={t('settings.data.importSidecarsButton')}
                />
              ),
              details: sidecarImportMessage && <StatusMessage message={sidecarImportMessage} />,
            },
            {
              id: 'clear-sidecars',
              label: t('settings.data.clearSidecars'),
              description: t('settings.data.clearSidecarsDesc'),
              control: (
                <ActionButton
                  disabled={rootPaths.length === 0}
                  icon={Trash2}
                  isProcessing={clearSidecars.isRunning}
                  onClick={handleClearSidecars}
                  text={t('settings.data.clearSidecarsButton')}
                />
              ),
              details: (
                <div className="space-y-2">
                  <PathBox>{rootPaths.length > 0 ? rootPaths.join('\n') : t('settings.data.noFolders')}</PathBox>
                  {clearSidecars.message && <StatusMessage message={clearSidecars.message} />}
                </div>
              ),
            },
            {
              id: 'clear-thumbnails',
              label: t('settings.data.clearThumbnail'),
              description: t('settings.data.clearThumbnailDesc'),
              control: (
                <ActionButton
                  icon={Trash2}
                  isProcessing={clearThumbnails.isRunning}
                  onClick={handleClearThumbnails}
                  text={t('settings.data.clearThumbnailButton')}
                />
              ),
              details: clearThumbnails.message && <StatusMessage message={clearThumbnails.message} />,
            },
            cacheRow('clear-ai-denoise', aiDenoiseCache, {
              title: 'settings.data.clearAiDenoise',
              description: 'settings.data.clearAiDenoiseDesc',
              button: 'settings.data.clearAiDenoiseButton',
              message: 'settings.data.modals.aiDenoiseMessage',
            }),
            cacheRow('clear-ai-upscale', aiUpscaleCache, {
              title: 'settings.data.clearAiUpscale',
              description: 'settings.data.clearAiUpscaleDesc',
              button: 'settings.data.clearAiUpscaleButton',
              message: 'settings.data.modals.aiUpscaleMessage',
            }),
            cacheRow('clear-external-edits', externalEditCache, {
              title: 'settings.data.clearExternalEdits',
              description: 'settings.data.clearExternalEditsDesc',
              button: 'settings.data.clearExternalEditsButton',
              message: 'settings.data.modals.externalEditsMessage',
            }),
            {
              id: 'logs',
              label: t('settings.data.logs'),
              description: t('settings.data.logsDesc'),
              control: (
                <ActionButton
                  disabled={logPathLoading || logPathError || !logPath}
                  icon={ExternalLinkIcon}
                  isProcessing={false}
                  onClick={() => logPath && invoke(Invokes.ShowInFinder, { path: logPath })}
                  text={t('settings.data.logsButton')}
                />
              ),
              details: (
                <PathBox>
                  {logPathLoading
                    ? t('settings.data.loading')
                    : logPathError
                      ? t('settings.data.statuses.failedToGetPath')
                      : (logPath ?? '')}
                </PathBox>
              ),
            },
          ],
        },
      ]}
    />
  );
}
