import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { FolderOpen, RotateCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import Button from '../../ui/Button';
import Input from '../../ui/Input';
import Text from '../../ui/Text';
import { Invokes } from '../../ui/AppProperties';
import { TextColors, TextVariants } from '../../../types/typography';
import SettingsPage, { SettingsPageProps } from './SettingsPage';
import { SettingSwitch } from './SettingControls';
import { useSettingsContext } from './SettingsContext';

interface CatalogMoveResult {
  databasePath: string;
  directory: string | null;
}

export default function LibrarySettings({ query }: SettingsPageProps) {
  const { t } = useTranslation();
  const { appSettings, onSettingsChange, updateSetting } = useSettingsContext();
  const [catalogLocation, setCatalogLocation] = useState('');
  const [catalogLocationMessage, setCatalogLocationMessage] = useState('');
  const [isMovingCatalog, setIsMovingCatalog] = useState(false);

  useEffect(() => {
    invoke<string>(Invokes.GetCatalogLocation).then(setCatalogLocation).catch(console.error);
  }, [appSettings?.catalogDirectory]);

  const moveCatalog = async (directory: string | null) => {
    setIsMovingCatalog(true);
    setCatalogLocationMessage('');
    try {
      const result = await invoke<CatalogMoveResult>(Invokes.MoveLibraryCatalog, { directory });
      await onSettingsChange({ ...appSettings, catalogDirectory: result.directory ?? undefined });
      setCatalogLocation(result.databasePath);
      setCatalogLocationMessage(t('settings.general.catalogMoveSuccess'));
    } catch (error) {
      console.error('Failed to move library catalog:', error);
      setCatalogLocationMessage(`${t('settings.general.catalogMoveFailed')}: ${error}`);
    } finally {
      setIsMovingCatalog(false);
    }
  };

  const handleChooseCatalogLocation = async () => {
    const selected = await openDialog({
      directory: true,
      multiple: false,
      defaultPath: appSettings?.catalogDirectory || undefined,
      title: t('settings.general.catalogChooseFolder'),
    });
    if (typeof selected === 'string') await moveCatalog(selected);
  };

  const isXmpSyncEnabled = appSettings?.enableXmpSync ?? true;

  return (
    <SettingsPage
      query={query}
      title={t('settings.categories.library')}
      sections={[
        {
          id: 'library',
          rows: [
            {
              id: 'catalog-location',
              label: t('settings.general.catalogLocation'),
              description: t('settings.general.catalogLocationDesc'),
              stacked: true,
              control: (
                <div className="space-y-2">
                  <Input
                    disabled
                    onChange={() => {}}
                    value={catalogLocation || t('settings.general.catalogLocationLoading')}
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button disabled={isMovingCatalog} onClick={handleChooseCatalogLocation} type="button">
                      <FolderOpen size={16} />
                      {isMovingCatalog
                        ? t('settings.general.catalogMoving')
                        : t('settings.general.catalogChooseFolder')}
                    </Button>
                    <Button
                      className="bg-surface text-text-primary border border-border-color"
                      disabled={isMovingCatalog || !appSettings?.catalogDirectory}
                      onClick={() => moveCatalog(null)}
                      type="button"
                    >
                      <RotateCcw size={16} />
                      {t('settings.general.catalogUseDefault')}
                    </Button>
                  </div>
                  {catalogLocationMessage && (
                    <Text variant={TextVariants.small} color={TextColors.secondary}>
                      {catalogLocationMessage}
                    </Text>
                  )}
                </div>
              ),
            },
            {
              id: 'xmp-sync',
              label: t('settings.general.xmpSync'),
              description: t('settings.general.xmpSyncDesc'),
              control: (
                <SettingSwitch
                  checked={isXmpSyncEnabled}
                  id="enable-xmp-sync-toggle"
                  label={t('settings.general.enableXmpSync')}
                  onChange={(checked) =>
                    onSettingsChange({
                      ...appSettings,
                      enableXmpSync: checked,
                      ...(checked ? {} : { createXmpIfMissing: false }),
                    })
                  }
                />
              ),
            },
            isXmpSyncEnabled && {
              id: 'create-xmp',
              label: t('settings.general.createXmp'),
              description: t('settings.general.createXmpDesc'),
              indent: true,
              control: (
                <SettingSwitch
                  checked={appSettings?.createXmpIfMissing ?? false}
                  id="create-xmp-missing-toggle"
                  label={t('settings.general.createXmpMissing')}
                  onChange={(checked) => updateSetting('createXmpIfMissing', checked)}
                />
              ),
            },
            {
              id: 'folder-image-counts',
              label: t('settings.general.folderImageCounts'),
              description: t('settings.general.folderImageCountsDesc'),
              control: (
                <SettingSwitch
                  checked={appSettings?.enableFolderImageCounts ?? false}
                  id="folder-image-counts-toggle"
                  label={t('settings.general.showImageCounts')}
                  onChange={(checked) => updateSetting('enableFolderImageCounts', checked)}
                />
              ),
            },
            {
              id: 'hide-empty-folders',
              label: t('settings.general.hideEmptyFolders'),
              description: t('settings.general.hideEmptyFoldersDesc'),
              control: (
                <SettingSwitch
                  checked={appSettings?.hideEmptyFolders ?? false}
                  id="hide-empty-folders-toggle"
                  label={t('settings.general.hideEmptyFolders')}
                  onChange={(checked) => updateSetting('hideEmptyFolders', checked)}
                />
              ),
            },
            {
              id: 'display-edit-icon',
              label: t('settings.general.displayEditIcon'),
              description: t('settings.general.displayEditIconDesc'),
              control: (
                <SettingSwitch
                  checked={appSettings?.displayEditIcon ?? true}
                  id="display-edit-icon-toggle"
                  label={t('settings.general.displayEditIcon')}
                  onChange={(checked) => updateSetting('displayEditIcon', checked)}
                />
              ),
            },
            {
              id: 'auto-stack-created-images',
              label: t('settings.general.autoStackCreatedImages'),
              description: t('settings.general.autoStackCreatedImagesDesc'),
              control: (
                <SettingSwitch
                  checked={appSettings?.autoStackCreatedImages ?? true}
                  id="auto-stack-created-images-toggle"
                  label={t('settings.general.enableAutoStackCreatedImages')}
                  onChange={(checked) => updateSetting('autoStackCreatedImages', checked)}
                />
              ),
            },
            {
              id: 'expand-auto-created-stacks',
              label: t('settings.general.expandAutoCreatedStacks'),
              description: t('settings.general.expandAutoCreatedStacksDesc'),
              control: (
                <SettingSwitch
                  checked={appSettings?.expandAutoCreatedStacks ?? true}
                  id="expand-auto-created-stacks-toggle"
                  label={t('settings.general.enableExpandAutoCreatedStacks')}
                  onChange={(checked) => updateSetting('expandAutoCreatedStacks', checked)}
                />
              ),
            },
            {
              id: 'copy-name-suffix',
              label: t('settings.general.copyNameSuffix'),
              description: t('settings.general.copyNameSuffixDesc'),
              control: (
                <div className="flex items-center gap-3">
                  <SettingSwitch
                    checked={appSettings?.copyNameSuffixEnabled ?? false}
                    id="copy-name-suffix-toggle"
                    label={t('settings.general.enableCopyNameSuffix')}
                    onChange={(checked) => updateSetting('copyNameSuffixEnabled', checked)}
                  />
                  <Input
                    type="text"
                    value={appSettings?.copyNameSuffix ?? ''}
                    onChange={(event) => updateSetting('copyNameSuffix', event.target.value)}
                    placeholder={t('settings.general.copySuffixPlaceholder')}
                    className="max-w-48"
                    bgClassName="bg-bg-primary"
                  />
                </div>
              ),
            },
          ],
        },
      ]}
    />
  );
}
