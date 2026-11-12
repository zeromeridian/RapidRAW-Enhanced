import { useState, useMemo, CSSProperties } from 'react';
import { Pipette, Sliders } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import Slider from '../ui/Slider';
import Switch from '../ui/Switch';
import ColorWheel from '../ui/ColorWheel';
import {
  ColorAdjustment,
  ColorCalibration,
  HueSatLum,
  INITIAL_ADJUSTMENTS,
  MAX_POINT_COLORS,
} from '../../utils/adjustments';
import { Adjustments, ColorGrading } from '../../utils/adjustments';
import { AppSettings } from '../ui/AppProperties';
import Text from '../ui/Text';
import { ColorSwatch } from '../ui/ColorSwatch';
import { TextColors, TextVariants, TextWeights } from '../../types/typography';
import { canvasToolState, useEditorStore } from '../../store/useEditorStore';
import { HSL_MIXER_BANDS, HslMixerBand, HslMixerProperty } from '../../utils/hslMixer';
import PointColorPanel from './PointColor';
import AdjustmentSlider from './AdjustmentSlider';
import AdjustmentTool from './AdjustmentTool';

interface ColorProps {
  color: string;
  name: string;
  label: string;
}

interface ColorPanelProps {
  adjustments: Adjustments;
  setAdjustments(adjustments: Partial<Adjustments>): any;
  appSettings: AppSettings | null;
  isForMask?: boolean;
  isWbPickerActive?: boolean;
  toggleWbPicker?: () => void;
  onDragStateChange?: (isDragging: boolean) => void;
}

const MIXER_SWATCHES: Record<HslMixerBand, { color: string; hue: number }> = {
  reds: { color: '#f87171', hue: 0 },
  oranges: { color: '#fb923c', hue: 30 },
  yellows: { color: '#facc15', hue: 60 },
  greens: { color: '#4ade80', hue: 120 },
  aquas: { color: '#2dd4bf', hue: 180 },
  blues: { color: '#60a5fa', hue: 240 },
  purples: { color: '#a78bfa', hue: 300 },
  magentas: { color: '#f472b6', hue: 340 },
};

const MIXER_TRACK_PREFIX: Record<HslMixerProperty, string> = { hue: 'hue', saturation: 'sat', luminance: 'lum' };

const MIXER_TAB_ICONS: Record<HslMixerProperty, string> = {
  hue: 'conic-gradient(#f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)',
  saturation: 'linear-gradient(135deg, #f43f5e 50%, #777 50%)',
  luminance: 'linear-gradient(135deg, #fff 50%, #111 50%)',
};

/** The round tab buttons of Color Grading and the expanded Color Mixer. */
const tabPillClassName = (isActive: boolean) =>
  `w-7 h-7 compact:w-6 compact:h-6 rounded-full flex items-center justify-center transition-all focus:outline-none ${
    isActive
      ? 'ring-2 ring-offset-2 ring-offset-surface ring-accent text-text-primary'
      : 'bg-bg-secondary text-text-secondary hover:text-text-primary hover:bg-bg-secondary/80'
  }`;

/** The section header buttons for the pickers and the expanded Color Mixer. */
export const headerToggleClassName = (isActive: boolean) =>
  `p-1.5 rounded-md transition-colors ${isActive ? 'bg-accent text-button-text' : 'hover:bg-bg-secondary text-text-secondary'}`;

const ColorGradingPanel = ({ adjustments, setAdjustments, onDragStateChange }: ColorPanelProps) => {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<'3way' | 'global'>('3way');
  const [isExpanded, setIsExpanded] = useState(false);
  const colorGrading = adjustments.colorGrading || INITIAL_ADJUSTMENTS.colorGrading;

  const handleChange = (grading: ColorGrading, newValue: HueSatLum) => {
    setAdjustments((prev: Partial<Adjustments>) => ({
      ...prev,
      colorGrading: {
        ...(prev.colorGrading || INITIAL_ADJUSTMENTS.colorGrading),
        [grading]: newValue,
      },
    }));
  };

  const handleColorGradingSliderChange = (grading: ColorGrading, value: string) => {
    setAdjustments((prev: Partial<Adjustments>) => ({
      ...prev,
      colorGrading: {
        ...(prev.colorGrading || INITIAL_ADJUSTMENTS.colorGrading),
        [grading]: parseFloat(value),
      },
    }));
  };

  const tabs = useMemo(
    () => [
      {
        id: '3way',
        icon: (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="12" cy="6" r="4.5" />
            <circle cx="5" cy="18" r="4.5" />
            <circle cx="19" cy="18" r="4.5" />
          </svg>
        ),
      },
      {
        id: 'global',
        icon: (
          <div className="w-3.5 h-3.5 rounded-full" style={{ background: 'linear-gradient(to top, #666, #fff)' }} />
        ),
      },
    ],
    [],
  );

  return (
    <div>
      <div className="flex items-center justify-start gap-2 mb-4 compact:mb-2 mt-2">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as '3way' | 'global')}
              className={tabPillClassName(isActive)}
            >
              {tab.icon}
            </button>
          );
        })}

        <div className="w-px h-5 bg-text-secondary/20 mx-1" />

        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className={`w-7 h-7 compact:w-6 compact:h-6 rounded-full flex items-center justify-center transition-all focus:outline-none
            ${
              isExpanded
                ? 'bg-accent text-button-text'
                : 'bg-bg-secondary text-text-secondary hover:text-text-primary hover:bg-bg-secondary/80'
            }`}
          data-tooltip={t('adjustments.color.toggleSliders')}
        >
          <Sliders size={14} />
        </button>
      </div>

      <div className="relative w-full mb-4 compact:mb-2">
        <AnimatePresence mode="wait">
          {activeTab === '3way' ? (
            <motion.div
              key="3way"
              initial={{ opacity: 0, x: -15 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -15 }}
              transition={{ duration: 0.2 }}
              className="w-full"
            >
              <div className="flex justify-center mb-4 compact:mb-2">
                <div className="w-[calc(50%-0.5rem)]">
                  <ColorWheel
                    defaultValue={INITIAL_ADJUSTMENTS.colorGrading.midtones}
                    label={t('adjustments.color.grading.midtones')}
                    onChange={(val: HueSatLum) => handleChange(ColorGrading.Midtones, val)}
                    value={colorGrading.midtones}
                    onDragStateChange={onDragStateChange}
                    isExpanded={isExpanded}
                  />
                </div>
              </div>
              <div className="flex justify-between mb-2 gap-4">
                <div className="w-full flex-1 min-w-0">
                  <ColorWheel
                    defaultValue={INITIAL_ADJUSTMENTS.colorGrading.shadows}
                    label={t('adjustments.color.grading.shadows')}
                    onChange={(val: HueSatLum) => handleChange(ColorGrading.Shadows, val)}
                    value={colorGrading.shadows}
                    onDragStateChange={onDragStateChange}
                    isExpanded={isExpanded}
                  />
                </div>
                <div className="w-full flex-1 min-w-0">
                  <ColorWheel
                    defaultValue={INITIAL_ADJUSTMENTS.colorGrading.highlights}
                    label={t('adjustments.color.grading.highlights')}
                    onChange={(val: HueSatLum) => handleChange(ColorGrading.Highlights, val)}
                    value={colorGrading.highlights}
                    onDragStateChange={onDragStateChange}
                    isExpanded={isExpanded}
                  />
                </div>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="global"
              initial={{ opacity: 0, x: 15 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 15 }}
              transition={{ duration: 0.2 }}
              className="w-full flex justify-center pb-2"
            >
              <div className="w-full max-w-70">
                <ColorWheel
                  defaultValue={INITIAL_ADJUSTMENTS.colorGrading.global}
                  label={t('adjustments.color.grading.global')}
                  onChange={(val: HueSatLum) => handleChange(ColorGrading.Global, val)}
                  value={colorGrading.global || INITIAL_ADJUSTMENTS.colorGrading.global}
                  onDragStateChange={onDragStateChange}
                  isExpanded={isExpanded}
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div>
        <Slider
          defaultValue={50}
          label={t('adjustments.color.grading.blending')}
          max={100}
          min={0}
          onChange={(e: any) => handleColorGradingSliderChange(ColorGrading.Blending, e.target.value)}
          step={1}
          value={colorGrading.blending}
          onDragStateChange={onDragStateChange}
        />
        <Slider
          defaultValue={0}
          label={t('adjustments.color.grading.balance')}
          max={100}
          min={-100}
          onChange={(e: any) => handleColorGradingSliderChange(ColorGrading.Balance, e.target.value)}
          step={1}
          value={colorGrading.balance}
          onDragStateChange={onDragStateChange}
        />
      </div>
    </div>
  );
};

const ColorCalibrationPanel = ({ adjustments, setAdjustments, onDragStateChange }: ColorPanelProps) => {
  const { t } = useTranslation();
  const [activePrimary, setActivePrimary] = useState('red');
  const colorCalibration = adjustments.colorCalibration || INITIAL_ADJUSTMENTS.colorCalibration;

  const PRIMARY_COLORS = useMemo(
    () => [
      { name: 'red', color: '#f87171', label: t('adjustments.color.calibration.colors.red') },
      { name: 'green', color: '#4ade80', label: t('adjustments.color.calibration.colors.green') },
      { name: 'blue', color: '#60a5fa', label: t('adjustments.color.calibration.colors.blue') },
    ],
    [t],
  );

  const handleShadowsChange = (value: string) => {
    setAdjustments((prev: Partial<Adjustments>) => ({
      ...prev,
      colorCalibration: {
        ...(prev.colorCalibration || INITIAL_ADJUSTMENTS.colorCalibration),
        shadowsTint: parseFloat(value),
      },
    }));
  };

  const handlePrimaryChange = (key: 'Hue' | 'Saturation', value: string) => {
    const fullKey = `${activePrimary}${key}` as keyof ColorCalibration;
    setAdjustments((prev: Partial<Adjustments>) => ({
      ...prev,
      colorCalibration: {
        ...(prev.colorCalibration || INITIAL_ADJUSTMENTS.colorCalibration),
        [fullKey]: parseFloat(value),
      },
    }));
  };

  const currentValues = {
    hue: colorCalibration[`${activePrimary}Hue` as keyof ColorCalibration] || 0,
    saturation: colorCalibration[`${activePrimary}Saturation` as keyof ColorCalibration] || 0,
  };

  const trackSuffix = `${activePrimary}s`;

  return (
    <AdjustmentTool id="colorCalibration">
      <div>
        <Text color={TextColors.primary} weight={TextWeights.medium} className="mb-1">
          {t('adjustments.color.calibration.shadows')}
        </Text>
        <Slider
          label={t('adjustments.color.calibration.tint')}
          min={-100}
          max={100}
          step={1}
          defaultValue={0}
          value={colorCalibration.shadowsTint}
          onChange={(e: any) => handleShadowsChange(e.target.value)}
          onDragStateChange={onDragStateChange}
          trackClassName="tint-gradient-track"
        />
      </div>
      <div className="mt-3 compact:mt-2">
        <Text color={TextColors.primary} weight={TextWeights.medium} className="mb-3">
          {t('adjustments.color.calibration.primaries')}
        </Text>
        <div className="flex justify-center gap-6 mb-4 compact:mb-2 px-1">
          {PRIMARY_COLORS.map(({ name, color, label }) => (
            <ColorSwatch
              color={color}
              isActive={activePrimary === name}
              key={name}
              name={name}
              onClick={setActivePrimary}
              ariaLabel={t('adjustments.color.ariaSelectColor', { name: label })}
            />
          ))}
        </div>
        <Slider
          label={t('adjustments.color.calibration.hue')}
          min={-100}
          max={100}
          step={1}
          defaultValue={0}
          value={currentValues.hue}
          onChange={(e: any) => handlePrimaryChange('Hue', e.target.value)}
          onDragStateChange={onDragStateChange}
          trackClassName={`hue-slider-${trackSuffix}`}
        />
        <Slider
          label={t('adjustments.color.calibration.saturation')}
          min={-100}
          max={100}
          step={1}
          defaultValue={0}
          value={currentValues.saturation}
          onChange={(e: any) => handlePrimaryChange('Saturation', e.target.value)}
          onDragStateChange={onDragStateChange}
          trackClassName={`sat-slider-${trackSuffix}`}
        />
      </div>
    </AdjustmentTool>
  );
};

export default function ColorPanel({
  adjustments,
  setAdjustments,
  appSettings,
  isForMask = false,
  isWbPickerActive = false,
  toggleWbPicker,
  onDragStateChange,
}: ColorPanelProps) {
  const { t } = useTranslation();
  const [activeColor, setActiveColor] = useState<HslMixerBand>('reds');
  const [isMixerExpanded, setIsMixerExpanded] = useState(false);
  const [mixerTab, setMixerTab] = useState<HslMixerProperty>('hue');
  const adjustmentVisibility = appSettings?.adjustmentVisibility || {};
  const isWgpuEnabled = appSettings?.useWgpuRenderer !== false;
  const [mixerMode, setMixerMode] = useState<'mixer' | 'pointColor'>('mixer');
  // Point Color is for the whole photo for now (Plan item 4); masks keep the mixer only.
  const isPointColorMode = !isForMask && mixerMode === 'pointColor';
  const isMixerPickerActive = useEditorStore((state) => state.targetedAdjustment?.tool === 'colorMixer');
  const isPointColorPickerActive = useEditorStore((state) => state.targetedAdjustment?.tool === 'pointColor');
  const isPointColorFull = (adjustments.pointColors?.length ?? 0) >= MAX_POINT_COLORS;
  const isMixerPickerDragging = useEditorStore(
    (state) => state.targetedAdjustment?.tool === 'colorMixer' && state.isSliderDragging,
  );
  const setEditor = useEditorStore((state) => state.setEditor);

  const HSL_COLORS = useMemo<Array<ColorProps>>(
    () =>
      HSL_MIXER_BANDS.map((name) => ({
        name,
        color: MIXER_SWATCHES[name].color,
        label: t(`adjustments.color.mixerColors.${name}`),
      })),
    [t],
  );

  const mixerTabs = useMemo<Array<{ id: HslMixerProperty; label: string }>>(
    () => [
      { id: 'hue', label: t('adjustments.color.hue') },
      { id: 'saturation', label: t('adjustments.color.saturation') },
      { id: 'luminance', label: t('adjustments.color.luminance') },
    ],
    [t],
  );

  const hsl = { ...INITIAL_ADJUSTMENTS.hsl, ...adjustments?.hsl };
  const mixerTrackStyle = Object.fromEntries(
    HSL_MIXER_BANDS.flatMap((name) => [
      [`--hsl-mixer-hue-${name}`, `${(((MIXER_SWATCHES[name].hue + hsl[name].hue) % 360) + 360) % 360}`],
      [`--hsl-mixer-sat-${name}`, `${(hsl[name].saturation + 100) / 2}%`],
    ]),
  ) as CSSProperties;

  // The pipette moves several bands at once, so it shows the expanded mixer.
  const toggleMixerPicker = () => {
    if (!isMixerPickerActive) setIsMixerExpanded(true);
    setEditor(
      canvasToolState(isMixerPickerActive ? {} : { targetedAdjustment: { tool: 'colorMixer', property: mixerTab } }),
    );
  };

  const togglePointColorPicker = () =>
    setEditor(canvasToolState(isPointColorPickerActive ? {} : { targetedAdjustment: { tool: 'pointColor' } }));

  const selectMixerMode = (mode: 'mixer' | 'pointColor') => {
    if (isMixerPickerActive || isPointColorPickerActive) setEditor({ targetedAdjustment: null });
    setMixerMode(mode);
  };

  const toggleMixerExpanded = () => {
    if (isMixerExpanded && isMixerPickerActive) setEditor({ targetedAdjustment: null });
    setIsMixerExpanded(!isMixerExpanded);
  };

  const selectMixerTab = (property: HslMixerProperty) => {
    setMixerTab(property);
    if (isMixerPickerActive) setEditor({ targetedAdjustment: { tool: 'colorMixer', property } });
  };

  const handleMonochromeChange = (monochrome: boolean) => {
    setAdjustments((prev: Partial<Adjustments>) => ({ ...prev, monochrome }));
  };

  const handleHslChange = (color: HslMixerBand, key: HslMixerProperty, value: string) => {
    setAdjustments((prev: Partial<Adjustments>) => ({
      ...prev,
      hsl: {
        ...(prev.hsl || {}),
        [color]: {
          ...(prev.hsl?.[color] || {}),
          [key]: parseFloat(value),
        },
      },
    }));
  };

  const renderMixerSlider = (color: HslMixerBand, property: HslMixerProperty, label: string) => (
    <Slider
      animateValueChanges={!isMixerPickerDragging}
      key={`${color}-${property}`}
      label={label}
      max={100}
      min={-100}
      onChange={(e: any) => handleHslChange(color, property, e.target.value)}
      step={1}
      value={hsl[color][property]}
      trackClassName={`${MIXER_TRACK_PREFIX[property]}-slider-${color}`}
      onDragStateChange={onDragStateChange}
    />
  );

  const sliderProps = { adjustments, setAdjustments, isForMask, onDragStateChange };

  return (
    <div className="flex flex-col gap-4 compact:gap-2">
      <AdjustmentTool id="blackAndWhite" isUntitled>
        <Switch
          checked={!!adjustments.monochrome}
          label={t('adjustments.color.blackAndWhite')}
          onChange={handleMonochromeChange}
          tooltip={t('adjustments.color.monochromeDesc')}
        />
      </AdjustmentTool>

      <AdjustmentTool
        id="whiteBalance"
        actions={
          !isForMask &&
          toggleWbPicker && (
            <button
              onClick={toggleWbPicker}
              disabled={isWgpuEnabled}
              className={
                isWgpuEnabled
                  ? 'p-1.5 rounded-md transition-colors cursor-not-allowed text-text-secondary hover:bg-transparent'
                  : headerToggleClassName(isWbPickerActive)
              }
              data-tooltip={
                isWgpuEnabled ? t('adjustments.color.wbPickerWgpuDisabled') : t('adjustments.color.wbPickerTooltip')
              }
            >
              <Pipette size={16} />
            </button>
          )
        }
      >
        <AdjustmentSlider control={ColorAdjustment.Temperature} {...sliderProps} />
        <AdjustmentSlider control={ColorAdjustment.Tint} {...sliderProps} />
      </AdjustmentTool>

      <AdjustmentTool id="colorPresence">
        <AdjustmentSlider control={ColorAdjustment.Vibrance} {...sliderProps} />
        <AdjustmentSlider control={ColorAdjustment.Saturation} {...sliderProps} />
      </AdjustmentTool>

      <AdjustmentTool id="hue" title={isForMask ? t('adjustments.color.localHue') : undefined}>
        <AdjustmentSlider control={ColorAdjustment.Hue} {...sliderProps} />
      </AdjustmentTool>

      <AdjustmentTool id="colorGrading" titleClassName="mb-3 compact:mb-1">
        <ColorGradingPanel
          adjustments={adjustments}
          setAdjustments={setAdjustments}
          appSettings={appSettings}
          onDragStateChange={onDragStateChange}
        />
      </AdjustmentTool>

      <AdjustmentTool
        id="colorMixer"
        titleClassName="mb-3 compact:mb-1"
        actions={
          <div className="flex items-center gap-1">
            {isPointColorMode ? (
              <button
                onClick={togglePointColorPicker}
                disabled={isPointColorFull && !isPointColorPickerActive}
                className={`${headerToggleClassName(isPointColorPickerActive)} disabled:opacity-40 disabled:cursor-not-allowed`}
                data-tooltip={
                  isPointColorFull
                    ? t('adjustments.color.pointColor.full', { count: MAX_POINT_COLORS })
                    : t('adjustments.color.pointColor.pickerTooltip')
                }
              >
                <Pipette size={16} />
              </button>
            ) : (
              <>
                <button
                  onClick={toggleMixerPicker}
                  className={headerToggleClassName(isMixerPickerActive)}
                  data-tooltip={t('adjustments.color.mixerPickerTooltip')}
                >
                  <Pipette size={16} />
                </button>
                <button
                  onClick={toggleMixerExpanded}
                  className={headerToggleClassName(isMixerExpanded)}
                  data-tooltip={t('adjustments.color.toggleSliders')}
                >
                  <Sliders size={16} />
                </button>
              </>
            )}
          </div>
        }
      >
        {!isForMask && (
          <div className="grid grid-cols-2 gap-1 mb-3 compact:mb-2">
            {(['mixer', 'pointColor'] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => selectMixerMode(mode)}
                className={`py-1 rounded-md text-xs transition-colors ${
                  mixerMode === mode
                    ? 'bg-accent text-button-text shadow-sm'
                    : 'bg-surface text-text-secondary hover:bg-card-active hover:text-text-primary'
                }`}
              >
                {t(`adjustments.color.pointColor.${mode}Mode`)}
              </button>
            ))}
          </div>
        )}
        <div style={mixerTrackStyle}>
          {isPointColorMode ? (
            <PointColorPanel
              adjustments={adjustments}
              setAdjustments={setAdjustments}
              onDragStateChange={onDragStateChange}
            />
          ) : isMixerExpanded ? (
            <>
              <div className="flex items-center gap-2 mb-4 compact:mb-2 px-1">
                {mixerTabs.map(({ id, label }) => (
                  <button
                    key={id}
                    onClick={() => selectMixerTab(id)}
                    className={tabPillClassName(mixerTab === id)}
                    data-tooltip={label}
                  >
                    <div className="w-3.5 h-3.5 rounded-full" style={{ background: MIXER_TAB_ICONS[id] }} />
                  </button>
                ))}
              </div>
              {HSL_COLORS.map(({ name, label }) => renderMixerSlider(name as HslMixerBand, mixerTab, label))}
            </>
          ) : (
            <>
              <div className="flex justify-between mb-4 compact:mb-2 px-1">
                {HSL_COLORS.map(({ name, color, label }) => (
                  <ColorSwatch
                    color={color}
                    isActive={activeColor === name}
                    key={name}
                    name={name}
                    onClick={(band) => setActiveColor(band as HslMixerBand)}
                    ariaLabel={t('adjustments.color.ariaSelectColor', { name: label })}
                  />
                ))}
              </div>
              {mixerTabs.map(({ id, label }) => renderMixerSlider(activeColor, id, label))}
            </>
          )}
        </div>
      </AdjustmentTool>

      {adjustmentVisibility.colorCalibration !== false && (
        <ColorCalibrationPanel
          adjustments={adjustments}
          setAdjustments={setAdjustments}
          appSettings={appSettings}
          onDragStateChange={onDragStateChange}
        />
      )}
    </div>
  );
}
