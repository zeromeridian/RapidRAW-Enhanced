import { useEffect, useMemo, useState } from 'react';
import { Image as ImageIcon, Scaling } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import Dropdown, { OptionItem } from '../../ui/Dropdown';
import Slider from '../../ui/Slider';
import SettingsPage, { SettingsPageProps } from './SettingsPage';
import { SegmentedSwitch, SegmentOption, SettingSwitch } from './SettingControls';
import { useSettingsContext } from './SettingsContext';

type PreviewMode = 'static' | 'dynamic';

const resolutions: OptionItem<number>[] = [
  { value: 720, label: '720px' },
  { value: 1280, label: '1280px' },
  { value: 1920, label: '1920px' },
  { value: 2560, label: '2560px' },
  { value: 3840, label: '3840px' },
];

const thumbnailResolutions: OptionItem<number>[] = [
  { value: 640, label: '640px' },
  { value: 720, label: '720px' },
  { value: 960, label: '960px' },
  { value: 1080, label: '1080px' },
];

const zoomMultiplierOptions: OptionItem<number>[] = [
  { value: 1.0, label: '1.0x (Native)' },
  { value: 0.75, label: '0.75x' },
  { value: 0.5, label: '0.50x (Half)' },
  { value: 0.25, label: '0.25x' },
];

/** The display's pixel ratio, kept current when the window moves to another display. */
const useDevicePixelRatio = () => {
  const [dpr, setDpr] = useState(() => (typeof window !== 'undefined' ? window.devicePixelRatio : 1));

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const updateDpr = () => setDpr(window.devicePixelRatio);
    const mediaQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    mediaQuery.addEventListener('change', updateDpr);
    window.addEventListener('resize', updateDpr);
    return () => {
      mediaQuery.removeEventListener('change', updateDpr);
      window.removeEventListener('resize', updateDpr);
    };
  }, []);

  return dpr;
};

export default function ProcessingSettings({ query }: SettingsPageProps) {
  const { t } = useTranslation();
  const { appSettings, osPlatform, processing, updateSetting } = useSettingsContext();
  const { values, change } = processing;
  const dpr = useDevicePixelRatio();
  const isDynamicPreview = appSettings?.enableZoomHifi ?? true;
  const isLivePreviewEnabled = appSettings?.enableLivePreviews ?? true;
  const isTonemapperOverrideEnabled = appSettings?.tonemapperOverrideEnabled ?? false;

  const previewModes = useMemo<SegmentOption<PreviewMode>[]>(
    () => [
      { id: 'static', label: t('settings.processing.modes.static'), icon: ImageIcon },
      { id: 'dynamic', label: t('settings.processing.modes.dynamic'), icon: Scaling },
    ],
    [t],
  );

  const livePreviewQualityOptions = useMemo<OptionItem<string>[]>(
    () => [
      { value: 'full', label: t('settings.processing.qualities.full') },
      { value: 'high', label: t('settings.processing.qualities.high') },
      { value: 'performance', label: t('settings.processing.qualities.performance') },
    ],
    [t],
  );

  const backendOptions = useMemo<OptionItem<string>[]>(
    () =>
      [
        { value: 'auto', label: t('settings.processing.backends.auto') },
        { value: 'vulkan', label: t('settings.processing.backends.vulkan') },
        { value: 'dx12', label: t('settings.processing.backends.dx12') },
        { value: 'metal', label: t('settings.processing.backends.metal') },
        { value: 'gl', label: t('settings.processing.backends.gl') },
      ].filter(
        (option) =>
          !(option.value === 'metal' && osPlatform !== 'macos') && !(option.value === 'dx12' && osPlatform === 'macos'),
      ),
    [t, osPlatform],
  );

  const linearRawOptions = useMemo<OptionItem<string>[]>(
    () => [
      { value: 'auto', label: t('settings.processing.preprocessing.linearOptions.auto') },
      { value: 'gamma', label: t('settings.processing.preprocessing.linearOptions.gamma') },
      { value: 'skip_calib', label: t('settings.processing.preprocessing.linearOptions.skip_calib') },
      { value: 'gamma_skip_calib', label: t('settings.processing.preprocessing.linearOptions.gamma_skip_calib') },
    ],
    [t],
  );

  const tonemapperOptions = useMemo<OptionItem<string>[]>(
    () => [
      { value: 'agx', label: t('settings.processing.preprocessing.tonemapperOptions.agx') },
      { value: 'basic', label: t('settings.processing.preprocessing.tonemapperOptions.basic') },
      { value: 'natural', label: t('settings.processing.preprocessing.tonemapperOptions.natural') },
    ],
    [t],
  );

  const previewResolutionDropdown = (
    <Dropdown
      onChange={(value) => change('editorPreviewResolution', value)}
      options={resolutions}
      value={values.editorPreviewResolution}
      className="w-full"
      triggerClassName="bg-bg-primary"
    />
  );

  return (
    <SettingsPage
      query={query}
      title={t('settings.categories.processing')}
      sections={[
        {
          id: 'engine',
          title: t('settings.processing.title'),
          rows: [
            {
              id: 'preview-strategy',
              label: t('settings.processing.previewStrategy'),
              description: isDynamicPreview
                ? t('settings.processing.dynamicDesc')
                : t('settings.processing.staticDesc'),
              stacked: true,
              control: (
                <SegmentedSwitch
                  layoutId="preview-mode-switch-bubble"
                  onChange={(mode) => updateSetting('enableZoomHifi', mode === 'dynamic')}
                  options={previewModes}
                  value={isDynamicPreview ? 'dynamic' : 'static'}
                />
              ),
            },
            !isDynamicPreview && {
              id: 'preview-resolution',
              label: t('settings.processing.previewRes'),
              description: t('settings.processing.previewResDesc'),
              indent: true,
              control: previewResolutionDropdown,
            },
            isDynamicPreview && {
              id: 'static-preview-resolution',
              label: t('settings.processing.staticPreviewRes'),
              description: t('settings.processing.staticPreviewResDesc'),
              indent: true,
              control: previewResolutionDropdown,
            },
            isDynamicPreview && {
              id: 'render-scale',
              label: t('settings.processing.renderScale'),
              description: t('settings.processing.renderScaleDesc'),
              indent: true,
              control: (
                <Dropdown
                  onChange={(value) => change('highResZoomMultiplier', value)}
                  options={zoomMultiplierOptions}
                  value={values.highResZoomMultiplier}
                  className="w-full"
                  triggerClassName="bg-bg-primary"
                />
              ),
            },
            isDynamicPreview && {
              id: 'high-dpi',
              label: t('settings.processing.highDpi'),
              description:
                dpr > 1 ? t('settings.processing.highDpiDesc', { dpr }) : t('settings.processing.highDpiDescStandard'),
              indent: true,
              control: (
                <SettingSwitch
                  checked={values.useFullDpiRendering}
                  disabled={dpr <= 1}
                  id="full-dpi-rendering-toggle"
                  label={t('settings.processing.nativeDpi')}
                  onChange={(checked) => change('useFullDpiRendering', checked)}
                />
              ),
            },
            {
              id: 'live-previews',
              label: t('settings.processing.livePreviews'),
              description: t('settings.processing.livePreviewsDesc'),
              control: (
                <SettingSwitch
                  checked={isLivePreviewEnabled}
                  id="live-previews-toggle"
                  label={t('settings.processing.enableLivePreviews')}
                  onChange={(checked) => updateSetting('enableLivePreviews', checked)}
                />
              ),
            },
            isLivePreviewEnabled && {
              id: 'live-preview-quality',
              label: t('settings.processing.livePreviewQuality'),
              description: t('settings.processing.livePreviewQualityDesc'),
              indent: true,
              control: (
                <Dropdown
                  onChange={(value) => updateSetting('livePreviewQuality', value)}
                  options={livePreviewQualityOptions}
                  value={appSettings?.livePreviewQuality || 'high'}
                  className="w-full"
                  triggerClassName="bg-bg-primary"
                />
              ),
            },
            {
              id: 'thumbnail-resolution',
              label: t('settings.processing.thumbnailRes'),
              description: t('settings.processing.thumbnailResDesc'),
              control: (
                <Dropdown
                  onChange={(value) => change('thumbnailResolution', value)}
                  options={thumbnailResolutions}
                  value={values.thumbnailResolution}
                  className="w-full"
                  triggerClassName="bg-bg-primary"
                />
              ),
            },
            {
              id: 'always-decode-raw-thumbnails',
              label: t('settings.processing.alwaysDecodeRaw'),
              description: t('settings.processing.alwaysDecodeRawDesc'),
              control: (
                <SettingSwitch
                  checked={appSettings?.alwaysDecodeRawThumbnails ?? false}
                  id="always-decode-raw-thumbnails-toggle"
                  label={t('settings.processing.alwaysDecodeRawLabel')}
                  onChange={(checked) => updateSetting('alwaysDecodeRawThumbnails', checked)}
                />
              ),
            },
            {
              id: 'worker-threads',
              label: t('settings.processing.workerThreads'),
              description: t('settings.processing.workerThreadsDesc'),
              control: (
                <div className="w-full">
                  <Slider
                    label={t('settings.processing.threads')}
                    min={2}
                    max={10}
                    step={1}
                    value={values.thumbnailWorkerThreads}
                    defaultValue={4}
                    onChange={(e) => change('thumbnailWorkerThreads', parseInt(String(e.target.value)))}
                    fillOrigin="min"
                  />
                </div>
              ),
            },
            {
              id: 'image-cache',
              label: t('settings.processing.imageCache'),
              description: t('settings.processing.imageCacheDesc'),
              control: (
                <div className="w-full">
                  <Slider
                    label={t('settings.processing.images')}
                    min={2}
                    max={10}
                    step={1}
                    value={values.imageCacheSize}
                    defaultValue={5}
                    onChange={(e) => change('imageCacheSize', parseInt(String(e.target.value)))}
                    fillOrigin="min"
                  />
                </div>
              ),
            },
            {
              id: 'wgpu-renderer',
              label: t('settings.processing.wgpu'),
              description:
                osPlatform === 'linux'
                  ? t('settings.processing.wgpuDescLinux')
                  : osPlatform === 'android'
                    ? t('settings.processing.wgpuDescAndroid')
                    : t('settings.processing.wgpuDescRecommended'),
              control: (
                <SettingSwitch
                  checked={values.useWgpuRenderer}
                  disabled={osPlatform === 'linux' || osPlatform === 'android'}
                  id="wgpu-renderer-toggle"
                  label={t('settings.processing.wgpuLabel')}
                  onChange={(checked) => change('useWgpuRenderer', checked)}
                />
              ),
            },
            {
              id: 'processing-backend',
              label: t('settings.processing.backend'),
              description: t('settings.processing.backendDesc'),
              control: (
                <Dropdown
                  onChange={(value) => change('processingBackend', value)}
                  options={backendOptions}
                  value={
                    backendOptions.some((option) => option.value === values.processingBackend)
                      ? values.processingBackend
                      : 'auto'
                  }
                  className="w-full"
                  triggerClassName="bg-bg-primary"
                />
              ),
            },
            osPlatform !== 'macos' &&
              osPlatform !== 'windows' && {
                id: 'linux-gpu-compatibility',
                label: t('settings.processing.linuxCompat'),
                description: t('settings.processing.linuxCompatDesc'),
                control: (
                  <SettingSwitch
                    checked={values.linuxGpuOptimization}
                    id="gpu-compat-toggle"
                    label={t('settings.processing.linuxCompatLabel')}
                    onChange={(checked) => change('linuxGpuOptimization', checked)}
                  />
                ),
              },
          ],
        },
        {
          id: 'preprocessing',
          title: t('settings.processing.preprocessing.title'),
          rows: [
            {
              id: 'highlight-recovery',
              label: t('settings.processing.preprocessing.highlightRecovery'),
              description: t('settings.processing.preprocessing.highlightRecoveryDesc'),
              control: (
                <div className="w-full">
                  <Slider
                    label={t('settings.tagging.amount')}
                    min={1}
                    max={10}
                    step={0.1}
                    value={values.rawHighlightCompression}
                    defaultValue={2.5}
                    onChange={(e) => change('rawHighlightCompression', parseFloat(String(e.target.value)))}
                    fillOrigin="min"
                  />
                </div>
              ),
            },
            {
              id: 'color-noise-reduction',
              label: t('settings.processing.preprocessing.colorNr'),
              description: t('settings.processing.preprocessing.colorNrDesc'),
              control: (
                <div className="w-full">
                  <Slider
                    label={t('settings.tagging.amount')}
                    min={0}
                    max={1.0}
                    step={0.05}
                    value={values.rawPreprocessingColorNr}
                    defaultValue={0.5}
                    onChange={(e) => change('rawPreprocessingColorNr', parseFloat(String(e.target.value)))}
                    fillOrigin="min"
                  />
                </div>
              ),
            },
            {
              id: 'preprocessing-sharpening',
              label: t('settings.processing.preprocessing.sharpening'),
              description: t('settings.processing.preprocessing.sharpeningDesc'),
              control: (
                <div className="w-full">
                  <Slider
                    label={t('settings.tagging.amount')}
                    min={0}
                    max={1.0}
                    step={0.05}
                    value={values.rawPreprocessingSharpening}
                    defaultValue={0.35}
                    onChange={(e) => change('rawPreprocessingSharpening', parseFloat(String(e.target.value)))}
                    fillOrigin="min"
                  />
                </div>
              ),
            },
            {
              id: 'preprocessing-non-raws',
              label: t('settings.processing.preprocessing.applyPreprocessing'),
              description: t('settings.processing.preprocessing.applyPreprocessingDesc'),
              control: (
                <SettingSwitch
                  checked={values.applyPreprocessingToNonRaws}
                  id="preprocessing-non-raws-toggle"
                  label={t('settings.processing.preprocessing.enablePreprocessingNonRaws')}
                  onChange={(checked) => change('applyPreprocessingToNonRaws', checked)}
                />
              ),
            },
            {
              id: 'linear-raw',
              label: t('settings.processing.preprocessing.linearRaw'),
              description: t('settings.processing.preprocessing.linearRawDesc'),
              control: (
                <Dropdown
                  onChange={(value) => updateSetting('linearRawMode', value)}
                  options={linearRawOptions}
                  value={appSettings?.linearRawMode || 'auto'}
                  className="w-full"
                  triggerClassName="bg-bg-primary"
                />
              ),
            },
            {
              id: 'tonemapper-override',
              label: t('settings.processing.preprocessing.tonemapperOverride'),
              description: t('settings.processing.preprocessing.tonemapperOverrideDesc'),
              control: (
                <SettingSwitch
                  checked={isTonemapperOverrideEnabled}
                  id="tonemapper-override-toggle"
                  label={t('settings.processing.preprocessing.enableTonemapperOverride')}
                  onChange={(checked) => updateSetting('tonemapperOverrideEnabled', checked)}
                />
              ),
            },
            isTonemapperOverrideEnabled && {
              id: 'default-raw-tonemapper',
              label: t('settings.processing.preprocessing.defaultRawTonemapper'),
              description: t('settings.processing.preprocessing.defaultRawTonemapperDesc'),
              indent: true,
              control: (
                <Dropdown
                  onChange={(value) => updateSetting('defaultRawTonemapper', value)}
                  options={tonemapperOptions}
                  value={appSettings?.defaultRawTonemapper || 'agx'}
                  className="w-full"
                  triggerClassName="bg-bg-primary"
                />
              ),
            },
            isTonemapperOverrideEnabled && {
              id: 'default-non-raw-tonemapper',
              label: t('settings.processing.preprocessing.defaultNonRawTonemapper'),
              description: t('settings.processing.preprocessing.defaultNonRawTonemapperDesc'),
              indent: true,
              control: (
                <Dropdown
                  onChange={(value) => updateSetting('defaultNonRawTonemapper', value)}
                  options={tonemapperOptions}
                  value={appSettings?.defaultNonRawTonemapper || 'basic'}
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
