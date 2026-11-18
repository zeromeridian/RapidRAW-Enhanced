import { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { Plus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import Button from '../../ui/Button';
import Dropdown, { OptionItem } from '../../ui/Dropdown';
import Input from '../../ui/Input';
import {
  DetectedEditor,
  EXTERNAL_EDIT_FORMAT_LABELS,
  EXTERNAL_EDIT_FORMATS,
  ExternalEditFormat,
  ExternalEditor,
  Invokes,
} from '../../ui/AppProperties';
import SettingsPage, { SettingsPageProps } from './SettingsPage';
import { SettingSwitch } from './SettingControls';
import { useSettingsContext } from './SettingsContext';

/** The format dropdown's value for an editor without a preferred format. */
const ASK_FOR_FORMAT = 'ask';

export default function ExportSettings({ query }: SettingsPageProps) {
  const { t } = useTranslation();
  const { appSettings, osPlatform, updateSetting } = useSettingsContext();
  const [detectedEditors, setDetectedEditors] = useState<DetectedEditor[]>([]);
  const externalEditors: ExternalEditor[] = appSettings?.externalEditors || [];

  useEffect(() => {
    invoke<DetectedEditor[]>(Invokes.DetectExternalEditors).then(setDetectedEditors).catch(console.error);
  }, []);

  const saveExternalEditors = (editors: ExternalEditor[]) => updateSetting('externalEditors', editors);

  const addExternalEditor = async () => {
    const selected = await openDialog({
      title: osPlatform === 'macos' ? 'Select an application' : 'Select an editor executable',
      directory: false,
      multiple: false,
      filters: osPlatform === 'macos' ? [{ name: 'Applications', extensions: ['app'] }] : undefined,
    });
    if (!selected || Array.isArray(selected)) return;
    const normalizedPath = selected.replace(/\\/g, '/');
    const filename = normalizedPath.split('/').pop() || 'External editor';
    const name = filename.replace(/\.app$/i, '').replace(/\.(exe|bat|cmd)$/i, '');
    if (externalEditors.some((editor) => editor.path === selected)) return;
    await saveExternalEditors([...externalEditors, { id: crypto.randomUUID(), name, path: selected }]);
  };

  const addDetectedEditor = (detected: DetectedEditor) =>
    saveExternalEditors([...externalEditors, { id: crypto.randomUUID(), ...detected }]);

  const removeExternalEditor = (id: string) =>
    saveExternalEditors(externalEditors.filter((editor) => editor.id !== id));

  const setExternalEditorFormat = (id: string, format: ExternalEditFormat | undefined) =>
    saveExternalEditors(externalEditors.map((editor) => (editor.id === id ? { ...editor, format } : editor)));

  const externalEditorFormatOptions = useMemo<OptionItem<string>[]>(
    () => [
      { value: ASK_FOR_FORMAT, label: t('settings.general.externalEditorAskFormat') },
      ...EXTERNAL_EDIT_FORMATS.map((format) => ({ value: format, label: EXTERNAL_EDIT_FORMAT_LABELS[format] })),
    ],
    [t],
  );

  return (
    <SettingsPage
      query={query}
      title={t('settings.categories.export')}
      sections={[
        {
          id: 'export',
          rows: [
            {
              id: 'export-file-suffix',
              label: t('settings.general.exportFileSuffix'),
              description: t('settings.general.exportFileSuffixDesc'),
              control: (
                <div className="flex items-center gap-3">
                  <SettingSwitch
                    checked={appSettings?.exportFileSuffixEnabled ?? false}
                    id="export-file-suffix-toggle"
                    label={t('settings.general.enableExportFileSuffix')}
                    onChange={(checked) => updateSetting('exportFileSuffixEnabled', checked)}
                  />
                  <Input
                    type="text"
                    value={appSettings?.exportFileSuffix ?? ''}
                    onChange={(event) => updateSetting('exportFileSuffix', event.target.value)}
                    placeholder={t('settings.general.fileSuffixPlaceholder')}
                    className="max-w-48"
                    bgClassName="bg-bg-primary"
                  />
                </div>
              ),
            },
            {
              id: 'external-editors',
              label: t('settings.general.externalEditors'),
              description: t('settings.general.externalEditorsDesc'),
              stacked: true,
              control: (
                <div className="flex flex-col items-start gap-2">
                  {externalEditors.map((editor) => (
                    <div key={editor.id} className="flex items-center gap-2 max-w-full">
                      <span className="text-sm text-text-primary truncate w-48" title={editor.path}>
                        {editor.name}
                      </span>
                      <Dropdown
                        onChange={(value: string) =>
                          setExternalEditorFormat(
                            editor.id,
                            value === ASK_FOR_FORMAT ? undefined : (value as ExternalEditFormat),
                          )
                        }
                        options={externalEditorFormatOptions}
                        value={editor.format ?? ASK_FOR_FORMAT}
                        triggerClassName="bg-bg-primary"
                      />
                      <Button
                        aria-label={t('settings.general.removeExternalEditor', { name: editor.name })}
                        className="p-1.5"
                        onClick={() => removeExternalEditor(editor.id)}
                        variant="secondary"
                      >
                        <Trash2 size={15} />
                      </Button>
                    </div>
                  ))}
                  {detectedEditors
                    .filter((detected) => !externalEditors.some((editor) => editor.path === detected.path))
                    .map((detected) => (
                      <div key={detected.path} className="flex items-center gap-2 max-w-full">
                        <span className="text-sm text-text-secondary truncate w-48" title={detected.path}>
                          {t('settings.general.externalEditorFound', { name: detected.name })}
                        </span>
                        <Button className="py-1.5" onClick={() => addDetectedEditor(detected)} variant="secondary">
                          <Plus size={15} /> {t('settings.general.addFoundExternalEditor')}
                        </Button>
                      </div>
                    ))}
                  <Button className="py-1.5" onClick={addExternalEditor} variant="secondary">
                    <Plus size={15} /> {t('settings.general.addExternalEditor')}
                  </Button>
                </div>
              ),
            },
          ],
        },
      ]}
    />
  );
}
