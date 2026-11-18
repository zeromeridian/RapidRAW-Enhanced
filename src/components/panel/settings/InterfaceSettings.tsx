import { useMemo } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import type { ParseKeys } from 'i18next';
import { useTranslation } from 'react-i18next';
import Dropdown, { OptionItem } from '../../ui/Dropdown';
import {
  DEFAULT_PANEL_DENSITY,
  LIGHTS_OUT_BORDER_WIDTHS,
  LIGHTS_OUT_DIM_LEVELS,
  LightsOutBorderWidth,
  LightsOutDimLevel,
  LightsOutScreenColor,
  PanelDensity,
  Theme,
} from '../../ui/AppProperties';
import { DEFAULT_THEME_ID, THEMES } from '../../../utils/themes';
import {
  normalizeLightsOutBorderColor,
  normalizeLightsOutBorderWidth,
  normalizeLightsOutDimLevel,
  normalizeLightsOutScreenColor,
} from '../../../utils/lightsOut';
import SettingsPage, { SettingsPageProps } from './SettingsPage';
import { SettingSwitch } from './SettingControls';
import { useSettingsContext } from './SettingsContext';

const LANGUAGE_OPTIONS: OptionItem<string>[] = [
  { value: 'en', label: 'English' },
  { value: 'de', label: 'Deutsch' },
  { value: 'es', label: 'Español' },
  { value: 'fr', label: 'Français' },
  { value: 'it', label: 'Italiano' },
  { value: 'ja', label: '日本語' },
  { value: 'ko', label: '한국어' },
  { value: 'pl', label: 'Polski' },
  { value: 'pt', label: 'Português' },
  { value: 'ru', label: 'Русский' },
  { value: 'zh-CN', label: '简体中文' },
  { value: 'zh-TW', label: '繁體中文' },
];

export default function InterfaceSettings({ query }: SettingsPageProps) {
  const { t } = useTranslation();
  const { appSettings, osPlatform, updateSetting } = useSettingsContext();

  const themeOptions = useMemo<OptionItem<Theme>[]>(
    () => THEMES.map((theme) => ({ value: theme.id, label: t(theme.name as ParseKeys) })),
    [t],
  );

  const fontOptions = useMemo<OptionItem<string>[]>(
    () => [
      { value: 'poppins', label: t('settings.general.poppins') },
      { value: 'system', label: t('settings.general.system') },
    ],
    [t],
  );

  const panelDensityOptions = useMemo<OptionItem<PanelDensity>[]>(
    () => [
      { value: PanelDensity.Compact, label: t('settings.general.panelDensityCompact') },
      { value: PanelDensity.Comfortable, label: t('settings.general.panelDensityComfortable') },
    ],
    [t],
  );

  const lightsOutDimLevelOptions = useMemo<OptionItem<LightsOutDimLevel>[]>(
    () => LIGHTS_OUT_DIM_LEVELS.map((level) => ({ value: level, label: `${level}%` })),
    [],
  );

  const lightsOutScreenColorOptions = useMemo<OptionItem<LightsOutScreenColor>[]>(
    () =>
      Object.values(LightsOutScreenColor).map((color) => ({
        value: color,
        label: t(`settings.general.lightsOutScreenColors.${color}`),
      })),
    [t],
  );

  const lightsOutBorderWidthOptions = useMemo<OptionItem<LightsOutBorderWidth>[]>(
    () =>
      LIGHTS_OUT_BORDER_WIDTHS.map((width) => ({
        value: width,
        label: width === 0 ? t('settings.general.lightsOutBorderNone') : `${width} px`,
      })),
    [t],
  );

  const lightsOutBorderWidth = normalizeLightsOutBorderWidth(appSettings?.lightsOutBorderWidth);

  return (
    <SettingsPage
      query={query}
      title={t('settings.categories.interface')}
      sections={[
        {
          id: 'appearance',
          rows: [
            {
              id: 'theme',
              label: t('settings.general.theme'),
              description: t('settings.general.themeDesc'),
              control: (
                <Dropdown
                  onChange={(value) => updateSetting('theme', value)}
                  options={themeOptions}
                  value={appSettings?.theme || DEFAULT_THEME_ID}
                  className="w-full"
                  triggerClassName="bg-bg-primary"
                />
              ),
            },
            {
              id: 'language',
              label: t('settings.language'),
              description: t('settings.languageDesc'),
              control: (
                <Dropdown
                  onChange={(value) => updateSetting('language', value)}
                  options={LANGUAGE_OPTIONS}
                  value={appSettings?.language || 'en'}
                  className="w-full"
                  triggerClassName="bg-bg-primary"
                />
              ),
            },
            {
              id: 'font',
              label: t('settings.general.font'),
              description: t('settings.general.fontDesc'),
              control: (
                <Dropdown
                  onChange={(value) => updateSetting('fontFamily', value)}
                  options={fontOptions}
                  value={appSettings?.fontFamily || 'poppins'}
                  className="w-full"
                  triggerClassName="bg-bg-primary"
                />
              ),
            },
            {
              id: 'panel-density',
              label: t('settings.general.panelDensity'),
              description: t('settings.general.panelDensityDesc'),
              control: (
                <Dropdown
                  onChange={(value) => updateSetting('panelDensity', value)}
                  options={panelDensityOptions}
                  value={appSettings?.panelDensity || DEFAULT_PANEL_DENSITY}
                  className="w-full"
                  triggerClassName="bg-bg-primary"
                />
              ),
            },
            {
              id: 'neutral-grey-canvas',
              label: t('settings.general.neutralGreyCanvas'),
              description: t('settings.general.neutralGreyCanvasDesc'),
              control: (
                <SettingSwitch
                  checked={appSettings?.editorNeutralGreyBg ?? false}
                  id="neutral-grey-bg-toggle"
                  label={t('settings.general.enableNeutralGreyCanvas')}
                  onChange={(checked) => updateSetting('editorNeutralGreyBg', checked)}
                />
              ),
            },
            {
              id: 'focus-mode',
              label: t('settings.general.focusMode'),
              description: t('settings.general.focusModeDesc'),
              control: (
                <SettingSwitch
                  checked={appSettings?.enableFocusMode ?? false}
                  id="focus-mode-toggle"
                  label={t('settings.general.enableFocusMode')}
                  onChange={(checked) => updateSetting('enableFocusMode', checked)}
                />
              ),
            },
            {
              id: 'skip-splash-screen',
              label: t('settings.general.skipSplashScreen'),
              description: t('settings.general.skipSplashScreenDesc'),
              control: (
                <SettingSwitch
                  checked={appSettings?.skipSplashScreen ?? false}
                  id="skip-splash-screen-toggle"
                  label={t('settings.general.enableSkipSplashScreen')}
                  onChange={(checked) => updateSetting('skipSplashScreen', checked)}
                />
              ),
            },
            osPlatform === 'linux' && {
              id: 'native-titlebar',
              label: t('settings.general.nativeTitlebar'),
              description: t('settings.general.nativeTitlebarDesc'),
              control: (
                <SettingSwitch
                  checked={appSettings?.decorations ?? false}
                  id="native-titlebar-toggle"
                  label={t('settings.general.enableOsTitlebar')}
                  onChange={(checked) => {
                    updateSetting('decorations', checked);
                    getCurrentWindow().setDecorations(checked).catch(console.error);
                  }}
                />
              ),
            },
          ],
        },
        {
          id: 'lights-out',
          title: t('settings.sections.lightsOut'),
          rows: [
            {
              id: 'lights-out-dim-level',
              label: t('settings.general.lightsOutDimLevel'),
              description: t('settings.general.lightsOutDimLevelDesc'),
              control: (
                <Dropdown
                  onChange={(value) => updateSetting('lightsOutDimLevel', value)}
                  options={lightsOutDimLevelOptions}
                  value={normalizeLightsOutDimLevel(appSettings?.lightsOutDimLevel)}
                  className="w-full"
                  triggerClassName="bg-bg-primary"
                />
              ),
            },
            {
              id: 'lights-out-screen-color',
              label: t('settings.general.lightsOutScreenColor'),
              description: t('settings.general.lightsOutScreenColorDesc'),
              control: (
                <Dropdown
                  onChange={(value) => updateSetting('lightsOutScreenColor', value)}
                  options={lightsOutScreenColorOptions}
                  value={normalizeLightsOutScreenColor(appSettings?.lightsOutScreenColor)}
                  className="w-full"
                  triggerClassName="bg-bg-primary"
                />
              ),
            },
            {
              id: 'lights-out-border-width',
              label: t('settings.general.lightsOutBorderWidth'),
              description: t('settings.general.lightsOutBorderWidthDesc'),
              control: (
                <Dropdown
                  onChange={(value) => updateSetting('lightsOutBorderWidth', value)}
                  options={lightsOutBorderWidthOptions}
                  value={lightsOutBorderWidth}
                  className="w-full"
                  triggerClassName="bg-bg-primary"
                />
              ),
            },
            lightsOutBorderWidth > 0 && {
              id: 'lights-out-border-color',
              label: t('settings.general.lightsOutBorderColor'),
              description: t('settings.general.lightsOutBorderColorDesc'),
              indent: true,
              control: (
                <Dropdown
                  onChange={(value) => updateSetting('lightsOutBorderColor', value)}
                  options={lightsOutScreenColorOptions}
                  value={normalizeLightsOutBorderColor(appSettings?.lightsOutBorderColor)}
                  className="w-full"
                  triggerClassName="bg-bg-primary"
                />
              ),
            },
          ],
        },
      ]}
    />
  );
}
