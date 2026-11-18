import { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Bookmark, Mouse, Plus, Touchpad, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import Button from '../../ui/Button';
import Dropdown from '../../ui/Dropdown';
import Slider from '../../ui/Slider';
import Text from '../../ui/Text';
import { TextColors, TextVariants, TextWeights } from '../../../types/typography';
import SettingsPage, { SettingsPageProps } from './SettingsPage';
import { SegmentedSwitch, SegmentOption, SettingSwitch } from './SettingControls';
import { useSettingsContext } from './SettingsContext';

interface MyLens {
  maker: string;
  model: string;
}

type CanvasInputMode = 'mouse' | 'trackpad';

const adjustmentVisibilityDefaults = {
  sharpening: true,
  presence: true,
  noiseReduction: true,
  chromaticAberration: false,
  vignette: true,
  colorCalibration: false,
  grain: true,
};

/** The tools that can be hidden from Develop, and whether each shows when never set. */
const ADJUSTMENT_VISIBILITY_SWITCHES = [
  { key: 'chromaticAberration', label: 'settings.adjustments.chromaticAberration', shownByDefault: false },
  { key: 'grain', label: 'settings.adjustments.grain', shownByDefault: true },
  { key: 'colorCalibration', label: 'settings.adjustments.colorCalibration', shownByDefault: true },
  { key: 'noiseReduction', label: 'settings.adjustments.noiseReduction', shownByDefault: true },
] as const;

export default function EditorSettings({ query }: SettingsPageProps) {
  const { t } = useTranslation();
  const { appSettings, updateSetting } = useSettingsContext();
  const [lensMakers, setLensMakers] = useState<string[]>([]);
  const [lensModels, setLensModels] = useState<string[]>([]);
  const [tempLensMaker, setTempLensMaker] = useState('');
  const [tempLensModel, setTempLensModel] = useState('');
  const myLenses: MyLens[] = appSettings?.myLenses || [];

  useEffect(() => {
    invoke<string[]>('get_lensfun_makers').then(setLensMakers).catch(console.error);
  }, []);

  const canvasInputModes = useMemo<SegmentOption<CanvasInputMode>[]>(
    () => [
      { id: 'mouse', label: t('settings.controls.modes.mouse'), icon: Mouse },
      { id: 'trackpad', label: t('settings.controls.modes.trackpad'), icon: Touchpad },
    ],
    [t],
  );

  const handleTempMakerChange = (maker: string) => {
    setTempLensMaker(maker);
    setTempLensModel('');
    setLensModels([]);
    if (maker) {
      invoke<string[]>('get_lensfun_lenses_for_maker', { maker }).then(setLensModels).catch(console.error);
    }
  };

  const handleAddLens = () => {
    if (!tempLensMaker || !tempLensModel) return;
    if (myLenses.some((lens) => lens.maker === tempLensMaker && lens.model === tempLensModel)) return;
    const newLenses = [...myLenses, { maker: tempLensMaker, model: tempLensModel }].sort(
      (a, b) => a.maker.localeCompare(b.maker) || a.model.localeCompare(b.model),
    );
    updateSetting('myLenses', newLenses);
    setTempLensMaker('');
    setTempLensModel('');
    setLensModels([]);
  };

  const handleRemoveLens = (index: number) =>
    updateSetting(
      'myLenses',
      myLenses.filter((_, lensIndex) => lensIndex !== index),
    );

  return (
    <SettingsPage
      query={query}
      title={t('settings.categories.editor')}
      sections={[
        {
          id: 'adjustment-visibility',
          title: t('settings.adjustments.title'),
          intro: t('settings.adjustments.description'),
          rows: ADJUSTMENT_VISIBILITY_SWITCHES.map(({ key, label, shownByDefault }) => ({
            id: `adjustment-visibility-${key}`,
            label: t(label),
            control: (
              <SettingSwitch
                checked={appSettings?.adjustmentVisibility?.[key] ?? shownByDefault}
                id={`adjustment-visibility-${key}`}
                label={t(label)}
                onChange={(checked) =>
                  updateSetting('adjustmentVisibility', {
                    ...(appSettings?.adjustmentVisibility || adjustmentVisibilityDefaults),
                    [key]: checked,
                  })
                }
              />
            ),
          })),
        },
        {
          id: 'lenses',
          title: t('settings.lenses.title'),
          intro: t('settings.lenses.description'),
          rows: [
            {
              id: 'auto-apply-lens-profile',
              label: t('settings.lenses.autoApplyProfile'),
              description: t('settings.lenses.autoApplyProfileDesc'),
              control: (
                <SettingSwitch
                  checked={appSettings?.autoApplyLensProfile ?? true}
                  id="auto-apply-lens-profile-toggle"
                  label={t('settings.lenses.autoApplyProfileLabel')}
                  onChange={(checked) => updateSetting('autoApplyLensProfile', checked)}
                />
              ),
            },
            {
              id: 'add-lens',
              label: t('settings.lenses.addNew'),
              stacked: true,
              control: (
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex-1 min-w-48">
                    <Dropdown
                      options={lensMakers.map((maker) => ({ label: maker, value: maker }))}
                      value={tempLensMaker}
                      onChange={handleTempMakerChange}
                      placeholder={t('settings.lenses.manufacturerPlaceholder')}
                      triggerClassName="bg-bg-primary"
                    />
                  </div>
                  <div className="flex-1 min-w-48">
                    <Dropdown
                      options={lensModels.map((model) => ({ label: model, value: model }))}
                      value={tempLensModel}
                      onChange={setTempLensModel}
                      placeholder={t('settings.lenses.modelPlaceholder')}
                      disabled={!tempLensMaker}
                      triggerClassName="bg-bg-primary"
                    />
                  </div>
                  <Button onClick={handleAddLens} disabled={!tempLensMaker || !tempLensModel}>
                    <Plus size={16} className="mr-1" />
                    {t('settings.lenses.addButton')}
                  </Button>
                </div>
              ),
            },
            {
              id: 'saved-lenses',
              label: t('settings.lenses.saved'),
              stacked: true,
              control:
                myLenses.length === 0 ? (
                  <Text className="italic">{t('settings.lenses.noLenses')}</Text>
                ) : (
                  <div className="divide-y divide-border-color">
                    {myLenses.map((lens, index) => (
                      <div
                        key={`${lens.maker}-${lens.model}-${index}`}
                        className="flex justify-between items-center py-2 first:pt-0 last:pb-0"
                      >
                        <div className="flex items-center gap-3">
                          <div className="p-2 bg-bg-primary rounded-md text-accent">
                            <Bookmark size={16} />
                          </div>
                          <div>
                            <Text color={TextColors.primary} weight={TextWeights.medium}>
                              {lens.model}
                            </Text>
                            <Text variant={TextVariants.small}>{lens.maker}</Text>
                          </div>
                        </div>
                        <button
                          onClick={() => handleRemoveLens(index)}
                          className="p-2 text-text-secondary hover:text-red-400 hover:bg-bg-primary rounded-md transition-colors"
                          data-tooltip={t('settings.lenses.removeTooltip')}
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    ))}
                  </div>
                ),
            },
          ],
        },
        {
          id: 'mouse-controls',
          title: t('settings.controls.title'),
          rows: [
            {
              id: 'canvas-input-mode',
              label: t('settings.controls.optimization'),
              description: t('settings.controls.optimizationDesc'),
              stacked: true,
              control: (
                <SegmentedSwitch
                  layoutId="canvas-input-mode-switch-bubble"
                  onChange={(value) => updateSetting('canvasInputMode', value)}
                  options={canvasInputModes}
                  value={(appSettings?.canvasInputMode as CanvasInputMode) || 'mouse'}
                />
              ),
            },
            {
              id: 'zoom-speed',
              label: t('settings.controls.zoom'),
              description: t('settings.controls.zoomDesc'),
              control: (
                <div className="w-full">
                  <Slider
                    label={t('settings.controls.speed')}
                    min={0.1}
                    max={3.0}
                    step={0.1}
                    value={appSettings?.zoomSpeedMultiplier ?? 1.0}
                    defaultValue={1.0}
                    onChange={(e) => updateSetting('zoomSpeedMultiplier', parseFloat(String(e.target.value)))}
                    fillOrigin="min"
                  />
                </div>
              ),
            },
            {
              id: 'zoom-photo-to-pixel-click',
              label: t('settings.controls.zoomClick'),
              description: t('settings.controls.zoomClickInfo'),
              control: (
                <SettingSwitch
                  checked={appSettings?.zoomPhotoToPixelClick ?? false}
                  id="zoom-photo-to-pixel-click"
                  label={t('settings.controls.zoomClickDesc')}
                  onChange={(checked) => updateSetting('zoomPhotoToPixelClick', checked)}
                />
              ),
            },
          ],
        },
      ]}
    />
  );
}
