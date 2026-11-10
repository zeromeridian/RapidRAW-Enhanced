import { useState, useEffect, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'react-toastify';
import { Circle, Hexagon, Octagon, Aperture, Plus, X, CopyPlus, Trash2 } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import { motion } from 'framer-motion';
import clsx from 'clsx';
import Slider, { SliderChangeEvent } from '../ui/Slider';
import AngleDial from '../ui/AngleDial';
import Switch from '../ui/Switch';
import {
  Adjustments,
  Effect,
  CreativeAdjustment,
  DEFAULT_GLOW_HUE,
  DEFAULT_HALATION_HUE,
  DEFAULT_MOTION_BLUR_DEPTH,
  DEFAULT_MOTION_BLUR_HIGHLIGHTS,
  EffectMapKey,
  MotionBlurLayer,
  MotionBlurType,
  LENS_BLUR_RANGE_DEFAULTS,
  RelightLight,
  createRelightLight,
  getRelightLightColor,
} from '../../utils/adjustments';
import Dropdown from '../ui/Dropdown';
import LUTControl from '../ui/LUTControl';
import ColorField, { normalizeHexColor, useParsedTextField } from '../ui/ColorField';
import { ColorSwatch } from './Color';
import { AppSettings } from '../ui/AppProperties';
import Text from '../ui/Text';
import { TextVariants } from '../../types/typography';
import { DepthRangePicker } from '../ui/DepthRangePicker';
import AiEffectSection, { EffectMapStatus } from './AiEffectSection';
import DepthScope from '../ui/depthScope/DepthScope';
import { ScenePatch } from '../ui/depthScope/scene';
import { useEditorStore } from '../../store/useEditorStore';
import { useEditorActions } from '../../hooks/useEditorActions';
import { useContextMenu } from '../../context/ContextMenuContext';

interface EffectsPanelProps {
  adjustments: Adjustments;
  isForMask?: boolean;
  setAdjustments(adjustments: Partial<Adjustments> | ((prev: Adjustments) => Adjustments)): any;
  handleLutSelect(path: string): void;
  onLutHover?: (path: string | null) => void;
  appSettings: AppSettings | null;
  onDragStateChange?: (isDragging: boolean) => void;
}

interface BokehShapeSwitchProps {
  selectedShape: string;
  onShapeChange: (shape: string) => void;
}

const BokehShapeSwitch = ({ selectedShape, onShapeChange }: BokehShapeSwitchProps) => {
  const { t } = useTranslation();
  const [bubbleStyle, setBubbleStyle] = useState({});
  const [isLabelHovered, setIsLabelHovered] = useState(false);
  const isInitialAnimation = useRef(true);

  const shapeOptions = useMemo(
    () => [
      { id: 'circle', icon: Circle, title: t('adjustments.effects.bokehCircular') },
      { id: 'hexagon', icon: Hexagon, title: t('adjustments.effects.bokehHexagonal') },
      { id: 'octagon', icon: Octagon, title: t('adjustments.effects.bokehOctagonal') },
      { id: 'ring', icon: Aperture, title: t('adjustments.effects.bokehRing') },
    ],
    [t],
  );

  useEffect(() => {
    const selectedIndex = shapeOptions.findIndex((m) => m.id === selectedShape);
    const safeIndex = selectedIndex >= 0 ? selectedIndex : 0;

    const widthPercent = 100 / shapeOptions.length;
    const targetX = `${safeIndex * 100}%`;
    const targetWidth = `${widthPercent}%`;

    if (isInitialAnimation.current) {
      setBubbleStyle({
        x: ['-25%', targetX],
        width: targetWidth,
      });
      isInitialAnimation.current = false;
    } else {
      setBubbleStyle({
        x: targetX,
        width: targetWidth,
      });
    }
  }, [selectedShape, shapeOptions]);

  const handleReset = () => {
    onShapeChange('circle');
  };

  return (
    <div className="flex flex-col gap-2 mt-3 compact:mt-2">
      <div
        className="grid w-fit cursor-pointer"
        onClick={handleReset}
        onMouseEnter={() => setIsLabelHovered(true)}
        onMouseLeave={() => setIsLabelHovered(false)}
      >
        <Text
          variant={TextVariants.label}
          aria-hidden={isLabelHovered}
          className={`col-start-1 row-start-1 text-text-secondary select-none transition-opacity duration-200 ease-in-out ${
            isLabelHovered ? 'opacity-0' : 'opacity-100'
          }`}
        >
          {t('adjustments.effects.bokehShape')}
        </Text>
        <Text
          variant={TextVariants.label}
          aria-hidden={!isLabelHovered}
          className={`col-start-1 row-start-1 text-accent! select-none transition-opacity duration-200 ease-in-out pointer-events-none ${
            isLabelHovered ? 'opacity-100' : 'opacity-0'
          }`}
        >
          {t('ui.slider.reset')}
        </Text>
      </div>

      <div className="w-full p-1 bg-bg-primary rounded-md">
        <div className="relative flex w-full">
          <motion.div
            className="absolute top-0 bottom-0 z-0 bg-accent"
            style={{ borderRadius: 6 }}
            animate={bubbleStyle}
            transition={{ type: 'spring', bounce: 0.2, duration: 0.6 }}
          />
          {shapeOptions.map((shape) => {
            const Icon = shape.icon;
            return (
              <button
                key={shape.id}
                data-tooltip={shape.title}
                onClick={() => onShapeChange(shape.id)}
                className={clsx(
                  'relative flex-1 flex items-center justify-center gap-2 px-3 py-1.5 compact:py-1 text-sm compact:text-xs font-medium rounded-md transition-colors',
                  {
                    'text-text-secondary hover:text-text-primary hover:bg-surface': selectedShape !== shape.id,
                    'text-button-text': selectedShape === shape.id,
                  },
                )}
                style={{ WebkitTapHighlightColor: 'transparent' }}
              >
                <span className="relative z-10 flex items-center">
                  <Icon size={16} strokeWidth={2} />
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};

/** The maps of the AI effect sections (Motion Blur's depth map is shared with masks, below). */
type SectionMapKey = Exclude<EffectMapKey, 'motionBlurDepthMap'>;

const EFFECT_MAPS: Record<
  SectionMapKey,
  { command: string; enabledKey: 'lensBlurEnabled' | 'relightEnabled' | 'fogEnabled'; errorLabel: string }
> = {
  lensBlurDepthMap: {
    command: 'generate_full_image_depth_map',
    enabledKey: 'lensBlurEnabled',
    errorLabel: 'depth map',
  },
  relightNormalMap: { command: 'generate_relight_normal_map', enabledKey: 'relightEnabled', errorLabel: 'normal map' },
  fogDepthMap: { command: 'generate_full_image_depth_map', enabledKey: 'fogEnabled', errorLabel: 'depth map' },
};

export default function EffectsPanel({
  adjustments,
  setAdjustments,
  isForMask = false,
  handleLutSelect,
  onLutHover,
  appSettings,
  onDragStateChange,
}: EffectsPanelProps) {
  const { t } = useTranslation();
  const [generatingMaps, setGeneratingMaps] = useState<Partial<Record<EffectMapKey, boolean>>>({});
  const [hoveredLightId, setHoveredLightId] = useState<string | null>(null);
  const isRelightPickerActive = useEditorStore((state) => state.isRelightPickerActive);
  const activeRelightLightId = useEditorStore((state) => state.activeRelightLightId);
  const setEditor = useEditorStore((state) => state.setEditor);
  // Motion Blur's depth map belongs to the photo, also when a mask's blur uses it.
  const motionBlurDepthMap = useEditorStore((state) => state.adjustments.motionBlurDepthMap);
  const { setAdjustments: setImageAdjustments } = useEditorActions();
  const { showContextMenu } = useContextMenu();

  const handleGenerateEffectMap = async (mapKey: SectionMapKey) => {
    const { command, enabledKey, errorLabel } = EFFECT_MAPS[mapKey];
    setGeneratingMaps((prev) => ({ ...prev, [mapKey]: true }));
    try {
      const b64: string = await invoke(command);
      setAdjustments((prev: Partial<Adjustments>) => ({ ...prev, [mapKey]: b64 }));
    } catch (e) {
      toast.error(`Failed to generate ${errorLabel}: ${e}`);
      setAdjustments((prev: Partial<Adjustments>) => ({ ...prev, [enabledKey]: false }));
    } finally {
      setGeneratingMaps((prev) => ({ ...prev, [mapKey]: false }));
    }
  };

  const handleAdjustmentChange = (key: string, value: any) => {
    const numericValue = typeof value === 'boolean' ? value : parseInt(value, 10);
    setAdjustments((prev: Partial<Adjustments>) => ({ ...prev, [key]: numericValue }));
  };

  const handleGenerateMotionBlurDepthMap = async () => {
    setGeneratingMaps((prev) => ({ ...prev, motionBlurDepthMap: true }));
    try {
      const b64: string = await invoke('generate_full_image_depth_map');
      setImageAdjustments((prev: Adjustments) => ({ ...prev, motionBlurDepthMap: b64 }));
    } catch (e) {
      toast.error(`Failed to generate depth map: ${e}`);
      setAdjustments((prev: Partial<Adjustments>) => ({ ...prev, motionBlurDepthEnabled: false }));
    } finally {
      setGeneratingMaps((prev) => ({ ...prev, motionBlurDepthMap: false }));
    }
  };

  const handleMotionBlurDepthToggle = (enabled: boolean) => {
    handleAdjustmentChange(Effect.MotionBlurDepthEnabled, enabled);
    if (enabled && !motionBlurDepthMap) {
      handleGenerateMotionBlurDepthMap();
    }
  };

  const motionBlurType: MotionBlurType = adjustments.motionBlurType ?? 'linear';

  const handleScenePatch = (patch: ScenePatch) => {
    setAdjustments((prev: Partial<Adjustments>) => ({ ...prev, ...patch }));
  };

  const handleLutIntensityChange = (intensity: number) => {
    setAdjustments((prev: Partial<Adjustments>) => ({ ...prev, lutIntensity: intensity }));
  };

  const handleLutClear = () => {
    setAdjustments((prev: Partial<Adjustments>) => ({
      ...prev,
      lutPath: null,
      lutName: null,
      lutData: null,
      lutSize: 0,
      lutIntensity: 100,
    }));
  };

  const handleSpatialEffectToggle = (mapKey: SectionMapKey) => (enabled: boolean) => {
    handleAdjustmentChange(EFFECT_MAPS[mapKey].enabledKey, enabled);
    if (enabled && !adjustments[mapKey]) {
      handleGenerateEffectMap(mapKey);
    }
  };

  const handleRelightToggle = (enabled: boolean) => {
    handleSpatialEffectToggle('relightNormalMap')(enabled);
    if (!enabled) {
      setEditor({ isRelightPickerActive: false });
    }
  };

  const relightLights: Array<RelightLight> = adjustments.relightLights || [];
  const activeLight = relightLights.find((light) => light.id === activeRelightLightId);

  const activateLight = (id: string) => {
    setEditor({ activeRelightLightId: id, isRelightPickerActive: true, isWbPickerActive: false });
  };

  const handleSelectLight = (id: string) => {
    if (activeLight?.id === id && isRelightPickerActive) {
      setEditor({ isRelightPickerActive: false });
      return;
    }
    activateLight(id);
  };

  const handleAddLight = () => {
    const light = createRelightLight(0.5, 0.5);
    setAdjustments((prev: Partial<Adjustments>) => ({
      ...prev,
      relightLights: [...(prev.relightLights || []), light],
    }));
    activateLight(light.id);
  };

  const handleLightPatch = (patch: Partial<RelightLight>) => {
    setAdjustments((prev: Partial<Adjustments>) => ({
      ...prev,
      relightLights: (prev.relightLights || []).map((light: RelightLight) =>
        light.id === activeRelightLightId ? { ...light, ...patch } : light,
      ),
    }));
  };

  const handleLightChange = (key: keyof RelightLight, value: number | string) => handleLightPatch({ [key]: value });

  const handleLightSliderChange = (key: keyof RelightLight) => (e: SliderChangeEvent) =>
    handleLightChange(key, parseInt(String(e.target.value), 10));

  const lightColorField = useParsedTextField(
    activeLight?.color ?? '#ffffff',
    (color) => handleLightChange('color', color),
    normalizeHexColor,
  );

  const handleRemoveLight = (id: string) => {
    setAdjustments((prev: Partial<Adjustments>) => ({
      ...prev,
      relightLights: (prev.relightLights || []).filter((light: RelightLight) => light.id !== id),
    }));
    if (id === activeRelightLightId) {
      setEditor({ activeRelightLightId: null, isRelightPickerActive: false });
    }
  };

  const handleDuplicateLight = (id: string) => {
    const source = relightLights.find((light) => light.id === id);
    if (!source) return;
    const light = { ...source, id: uuidv4() };
    setAdjustments((prev: Partial<Adjustments>) => {
      const lights = prev.relightLights || [];
      const index = lights.findIndex((l: RelightLight) => l.id === id);
      return { ...prev, relightLights: [...lights.slice(0, index + 1), light, ...lights.slice(index + 1)] };
    });
    activateLight(light.id);
  };

  const handleLightContextMenu = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    showContextMenu(e.clientX, e.clientY, [
      {
        label: t('adjustments.effects.relightDuplicateLight'),
        icon: CopyPlus,
        onClick: () => handleDuplicateLight(id),
      },
      {
        label: t('adjustments.effects.relightRemoveLight'),
        icon: Trash2,
        isDestructive: true,
        onClick: () => handleRemoveLight(id),
      },
    ]);
  };

  const adjustmentVisibility = appSettings?.adjustmentVisibility || {};

  return (
    <div className="space-y-4 compact:space-y-2">
      <div className="p-2 compact:p-1.5 bg-bg-tertiary rounded-md">
        <Text variant={TextVariants.heading} className="mb-2 compact:mb-1 compact:text-sm">
          {t('adjustments.effects.glow')}
        </Text>
        <Slider
          label={t('adjustments.effects.amount')}
          max={100}
          min={0}
          onChange={(e: any) => handleAdjustmentChange(CreativeAdjustment.GlowAmount, e.target.value)}
          step={1}
          value={adjustments.glowAmount}
          onDragStateChange={onDragStateChange}
        />
        {/* Glow and halation colours are global; mask glow and halation use them too. */}
        {!isForMask && (
          <>
            <Slider
              defaultValue={DEFAULT_GLOW_HUE}
              label={t('adjustments.color.hue')}
              max={360}
              min={0}
              onChange={(e: SliderChangeEvent) => handleAdjustmentChange(CreativeAdjustment.GlowHue, e.target.value)}
              step={1}
              value={adjustments.glowHue ?? DEFAULT_GLOW_HUE}
              trackClassName="hue-range-track"
              onDragStateChange={onDragStateChange}
            />
            <Slider
              label={t('adjustments.color.saturation')}
              max={100}
              min={0}
              onChange={(e: SliderChangeEvent) =>
                handleAdjustmentChange(CreativeAdjustment.GlowSaturation, e.target.value)
              }
              step={1}
              value={adjustments.glowSaturation ?? 0}
              onDragStateChange={onDragStateChange}
              fillOrigin="min"
            />
          </>
        )}
      </div>

      <div className="p-2 compact:p-1.5 bg-bg-tertiary rounded-md">
        <Text variant={TextVariants.heading} className="mb-2 compact:mb-1 compact:text-sm">
          {t('adjustments.effects.halation')}
        </Text>
        <Slider
          label={t('adjustments.effects.amount')}
          max={100}
          min={0}
          onChange={(e: any) => handleAdjustmentChange(CreativeAdjustment.HalationAmount, e.target.value)}
          step={1}
          value={adjustments.halationAmount}
          onDragStateChange={onDragStateChange}
        />
        {!isForMask && (
          <Slider
            defaultValue={DEFAULT_HALATION_HUE}
            label={t('adjustments.color.hue')}
            max={360}
            min={0}
            onChange={(e: SliderChangeEvent) => handleAdjustmentChange(CreativeAdjustment.HalationHue, e.target.value)}
            step={1}
            value={adjustments.halationHue ?? DEFAULT_HALATION_HUE}
            trackClassName="hue-range-track"
            onDragStateChange={onDragStateChange}
          />
        )}
      </div>

      <div className="p-2 compact:p-1.5 bg-bg-tertiary rounded-md">
        <Text variant={TextVariants.heading} className="mb-2 compact:mb-1 compact:text-sm">
          {t('adjustments.effects.lightFlares')}
        </Text>
        <Slider
          label={t('adjustments.effects.amount')}
          max={100}
          min={0}
          onChange={(e: any) => handleAdjustmentChange(CreativeAdjustment.FlareAmount, e.target.value)}
          step={1}
          value={adjustments.flareAmount}
          onDragStateChange={onDragStateChange}
        />
      </div>

      {!isForMask && (
        <div className="space-y-4 compact:space-y-2">
          <AiEffectSection
            title={t('adjustments.effects.lensBlur')}
            enabled={!!adjustments.lensBlurEnabled}
            onEnabledChange={handleSpatialEffectToggle('lensBlurDepthMap')}
            isGenerating={!!generatingMaps.lensBlurDepthMap}
            generatingLabel={t('editor.ai.generatingDepthMap')}
            isMapMissing={!adjustments.lensBlurDepthMap}
            mapMissingLabel={t('adjustments.effects.depthMapMissing')}
            generateMapLabel={t('adjustments.effects.generateDepthMap')}
            onGenerateMap={() => handleGenerateEffectMap('lensBlurDepthMap')}
          >
            {adjustments.lensBlurEnabled && (
              <DepthScope
                mapKey="lensBlurDepthMap"
                scene={{
                  kind: 'lensBlur',
                  minDepth: adjustments.lensBlurMinDepth ?? LENS_BLUR_RANGE_DEFAULTS.minDepth,
                  maxDepth: adjustments.lensBlurMaxDepth ?? LENS_BLUR_RANGE_DEFAULTS.maxDepth,
                  minFade: adjustments.lensBlurMinFade ?? LENS_BLUR_RANGE_DEFAULTS.minFade,
                  maxFade: adjustments.lensBlurMaxFade ?? LENS_BLUR_RANGE_DEFAULTS.maxFade,
                  amount: adjustments.lensBlurAmount ?? 50,
                }}
                onChange={handleScenePatch}
                onDragStateChange={onDragStateChange}
              />
            )}

            <Slider
              label={t('adjustments.effects.amount')}
              max={100}
              min={0}
              defaultValue={40}
              onChange={(e: SliderChangeEvent) => handleAdjustmentChange(Effect.LensBlurAmount, e.target.value)}
              step={1}
              value={adjustments.lensBlurAmount ?? 50}
              onDragStateChange={onDragStateChange}
              fillOrigin="min"
            />

            <Slider
              label={t('adjustments.effects.lensDiffusion')}
              max={100}
              min={0}
              defaultValue={0}
              onChange={(e: SliderChangeEvent) => handleAdjustmentChange(Effect.lensBlurDiffusion, e.target.value)}
              step={1}
              value={adjustments.lensBlurDiffusion ?? 0}
              onDragStateChange={onDragStateChange}
            />

            <BokehShapeSwitch
              selectedShape={adjustments.lensBlurShape || 'circle'}
              onShapeChange={(shapeId) =>
                setAdjustments((prev: Partial<Adjustments>) => ({ ...prev, [Effect.LensBlurShape]: shapeId }))
              }
            />

            <DepthRangePicker
              minDepth={100 - (adjustments.lensBlurMaxDepth ?? LENS_BLUR_RANGE_DEFAULTS.maxDepth)}
              maxDepth={100 - (adjustments.lensBlurMinDepth ?? LENS_BLUR_RANGE_DEFAULTS.minDepth)}
              minFade={adjustments.lensBlurMaxFade ?? LENS_BLUR_RANGE_DEFAULTS.maxFade}
              maxFade={adjustments.lensBlurMinFade ?? LENS_BLUR_RANGE_DEFAULTS.minFade}
              defaultMinDepth={0}
              defaultMaxDepth={80}
              defaultMinFade={20}
              defaultMaxFade={20}
              onChange={(values: { minDepth: number; maxDepth: number; minFade: number; maxFade: number }) => {
                setAdjustments((prev: Partial<Adjustments>) => ({
                  ...prev,
                  lensBlurMinDepth: 100 - values.maxDepth,
                  lensBlurMaxDepth: 100 - values.minDepth,
                  lensBlurMinFade: values.maxFade,
                  lensBlurMaxFade: values.minFade,
                }));
              }}
              onDragStateChange={onDragStateChange}
            />
          </AiEffectSection>

          <AiEffectSection
            title={t('adjustments.effects.relight')}
            enabled={!!adjustments.relightEnabled}
            onEnabledChange={handleRelightToggle}
            isGenerating={!!generatingMaps.relightNormalMap}
            generatingLabel={t('editor.ai.generatingNormalMap')}
            isMapMissing={!adjustments.relightNormalMap}
            mapMissingLabel={t('adjustments.effects.relightNormalMapMissing')}
            generateMapLabel={t('adjustments.effects.relightGenerateNormalMap')}
            onGenerateMap={() => handleGenerateEffectMap('relightNormalMap')}
            data-relight-lights
          >
            {adjustments.relightEnabled && (
              <DepthScope
                mapKey="relightNormalMap"
                scene={{
                  kind: 'relight',
                  lights: relightLights,
                  activeId: activeLight?.id ?? null,
                  ambient: adjustments.relightAmbient ?? 0,
                  softness: adjustments.relightSoftness ?? 25,
                  shine: adjustments.relightShine ?? 0,
                }}
                onChange={handleLightPatch}
                onDragStateChange={onDragStateChange}
              />
            )}

            <Slider
              label={t('adjustments.effects.relightAmbient')}
              max={100}
              min={-100}
              onChange={(e: SliderChangeEvent) => handleAdjustmentChange(Effect.RelightAmbient, e.target.value)}
              step={1}
              value={adjustments.relightAmbient ?? 0}
              onDragStateChange={onDragStateChange}
            />

            <Slider
              label={t('adjustments.effects.relightSoftness')}
              max={100}
              min={0}
              defaultValue={25}
              onChange={(e: SliderChangeEvent) => handleAdjustmentChange(Effect.RelightSoftness, e.target.value)}
              step={1}
              value={adjustments.relightSoftness ?? 25}
              onDragStateChange={onDragStateChange}
              fillOrigin="min"
            />

            <Slider
              label={t('adjustments.effects.relightShine')}
              max={100}
              min={0}
              onChange={(e: SliderChangeEvent) => handleAdjustmentChange(Effect.RelightShine, e.target.value)}
              step={1}
              value={adjustments.relightShine ?? 0}
              onDragStateChange={onDragStateChange}
            />

            <Switch
              label={t('adjustments.effects.relightShadows')}
              checked={!!adjustments.relightShadows}
              onChange={(enabled: boolean) => handleAdjustmentChange(Effect.RelightShadows, enabled)}
            />

            {adjustments.relightShadows && (
              <Slider
                label={t('adjustments.effects.relightShadowSoftness')}
                max={100}
                min={0}
                defaultValue={15}
                onChange={(e: SliderChangeEvent) =>
                  handleAdjustmentChange(Effect.RelightShadowSoftness, e.target.value)
                }
                step={1}
                value={adjustments.relightShadowSoftness ?? 15}
                onDragStateChange={onDragStateChange}
                fillOrigin="min"
              />
            )}

            <div className="p-3 compact:p-2 rounded-md bg-bg-primary space-y-4 compact:space-y-2">
              <div className="flex flex-wrap items-center gap-3 px-1">
                {relightLights.map((light, index) => (
                  <div
                    className="relative flex"
                    key={light.id}
                    onMouseEnter={() => setHoveredLightId(light.id)}
                    onMouseLeave={() => setHoveredLightId(null)}
                    onContextMenu={(e) => handleLightContextMenu(e, light.id)}
                  >
                    <ColorSwatch
                      color={getRelightLightColor(light)}
                      isActive={activeLight?.id === light.id}
                      name={light.id}
                      onClick={handleSelectLight}
                      ariaLabel={t('adjustments.effects.relightLight', { index: index + 1 })}
                    />
                    {hoveredLightId === light.id && (
                      <button
                        className="absolute -top-1 -right-1 z-10 p-0.5 rounded-full bg-card-active text-text-secondary hover:bg-red-500/20 hover:text-red-500 transition-all"
                        onClick={(e: React.MouseEvent) => {
                          e.stopPropagation();
                          handleRemoveLight(light.id);
                        }}
                        data-tooltip={t('adjustments.effects.relightRemoveLight')}
                      >
                        <X size={10} />
                      </button>
                    )}
                  </div>
                ))}
                <button
                  aria-label={t('adjustments.effects.relightAddLight')}
                  data-tooltip={t('adjustments.effects.relightAddLight')}
                  onClick={handleAddLight}
                  className="w-6 h-6 flex items-center justify-center rounded-full border-2 border-dashed border-text-secondary text-text-secondary hover:border-text-primary hover:text-text-primary transition-colors"
                >
                  <Plus size={14} />
                </button>
              </div>

              {activeLight ? (
                <>
                  <div>
                    <Text variant={TextVariants.label} className="mb-2 block">
                      {t('adjustments.effects.relightType')}
                    </Text>
                    <Dropdown
                      options={[
                        { label: t('adjustments.effects.relightTypes.point'), value: 'point' },
                        { label: t('adjustments.effects.relightTypes.spot'), value: 'spot' },
                        { label: t('adjustments.effects.relightTypes.directional'), value: 'directional' },
                      ]}
                      value={activeLight.type}
                      onChange={(val) => handleLightChange('type', val)}
                    />
                  </div>

                  <ColorField
                    color={activeLight.color || '#ffffff'}
                    disabled={false}
                    field={lightColorField}
                    label={t('adjustments.effects.relightColor')}
                    onColorChange={(color) => handleLightChange('color', color)}
                  />

                  <Slider
                    label={t('adjustments.effects.relightIntensity')}
                    max={100}
                    min={0}
                    defaultValue={60}
                    onChange={handleLightSliderChange('intensity')}
                    step={1}
                    value={activeLight.intensity}
                    onDragStateChange={onDragStateChange}
                    fillOrigin="min"
                  />

                  {activeLight.type !== 'directional' && (
                    <>
                      <Slider
                        label={t('adjustments.effects.relightDepth')}
                        max={100}
                        min={0}
                        defaultValue={0}
                        onChange={handleLightSliderChange('depth')}
                        step={1}
                        value={activeLight.depth}
                        onDragStateChange={onDragStateChange}
                        fillOrigin="min"
                      />

                      <Slider
                        label={t('adjustments.effects.relightFalloff')}
                        max={100}
                        min={0}
                        defaultValue={30}
                        onChange={handleLightSliderChange('radius')}
                        step={1}
                        value={activeLight.radius}
                        onDragStateChange={onDragStateChange}
                        fillOrigin="min"
                      />
                    </>
                  )}

                  {activeLight.type !== 'point' && (
                    <>
                      <Slider
                        label={t('adjustments.effects.relightAngle')}
                        max={360}
                        min={0}
                        defaultValue={135}
                        onChange={handleLightSliderChange('angle')}
                        step={1}
                        suffix="°"
                        value={activeLight.angle}
                        onDragStateChange={onDragStateChange}
                        fillOrigin="min"
                      />

                      <Slider
                        label={t('adjustments.effects.relightElevation')}
                        max={180}
                        min={-180}
                        defaultValue={60}
                        onChange={handleLightSliderChange('elevation')}
                        step={1}
                        suffix="°"
                        value={activeLight.elevation}
                        onDragStateChange={onDragStateChange}
                      />
                    </>
                  )}

                  {activeLight.type === 'spot' && (
                    <>
                      <Slider
                        label={t('adjustments.effects.relightCone')}
                        max={100}
                        min={0}
                        defaultValue={40}
                        onChange={handleLightSliderChange('cone')}
                        step={1}
                        value={activeLight.cone}
                        onDragStateChange={onDragStateChange}
                        fillOrigin="min"
                      />

                      <Slider
                        label={t('adjustments.effects.feather')}
                        max={100}
                        min={0}
                        defaultValue={50}
                        onChange={handleLightSliderChange('feather')}
                        step={1}
                        value={activeLight.feather}
                        onDragStateChange={onDragStateChange}
                        fillOrigin="min"
                      />
                    </>
                  )}

                  <Slider
                    label={t('adjustments.color.temperature')}
                    max={100}
                    min={-100}
                    onChange={handleLightSliderChange('temperature')}
                    step={1}
                    value={activeLight.temperature}
                    trackClassName="temperature-gradient-track"
                    onDragStateChange={onDragStateChange}
                  />

                  <Slider
                    label={t('adjustments.color.tint')}
                    max={100}
                    min={-100}
                    onChange={handleLightSliderChange('tint')}
                    step={1}
                    value={activeLight.tint}
                    trackClassName="tint-gradient-track"
                    onDragStateChange={onDragStateChange}
                  />
                </>
              ) : (
                <Text variant={TextVariants.small} className="text-text-secondary">
                  {t('adjustments.effects.relightHint')}
                </Text>
              )}
            </div>
          </AiEffectSection>

          <AiEffectSection
            title={t('adjustments.effects.fog')}
            enabled={!!adjustments.fogEnabled}
            onEnabledChange={handleSpatialEffectToggle('fogDepthMap')}
            isGenerating={!!generatingMaps.fogDepthMap}
            generatingLabel={t('editor.ai.generatingDepthMap')}
            isMapMissing={!adjustments.fogDepthMap}
            mapMissingLabel={t('adjustments.effects.depthMapMissing')}
            generateMapLabel={t('adjustments.effects.generateDepthMap')}
            onGenerateMap={() => handleGenerateEffectMap('fogDepthMap')}
          >
            {adjustments.fogEnabled && (
              <DepthScope
                mapKey="fogDepthMap"
                scene={{
                  kind: 'fog',
                  amount: adjustments.fogAmount ?? 50,
                  start: adjustments.fogStart ?? 0,
                  feather: adjustments.fogFeather ?? 0,
                  density: adjustments.fogDensity ?? 50,
                  height: adjustments.fogHeight ?? 0,
                  temperature: adjustments.fogTemperature ?? 0,
                  tint: adjustments.fogTint ?? 0,
                }}
                onChange={handleScenePatch}
                onDragStateChange={onDragStateChange}
              />
            )}

            <Slider
              label={t('adjustments.effects.amount')}
              max={100}
              min={0}
              defaultValue={50}
              onChange={(e: SliderChangeEvent) => handleAdjustmentChange(Effect.FogAmount, e.target.value)}
              step={1}
              value={adjustments.fogAmount ?? 50}
              onDragStateChange={onDragStateChange}
              fillOrigin="min"
            />
            <Slider
              label={t('adjustments.effects.fogStart')}
              max={100}
              min={0}
              defaultValue={0}
              onChange={(e: SliderChangeEvent) => handleAdjustmentChange(Effect.FogStart, e.target.value)}
              step={1}
              value={adjustments.fogStart ?? 0}
              onDragStateChange={onDragStateChange}
              fillOrigin="min"
            />
            <Slider
              label={t('adjustments.effects.feather')}
              max={100}
              min={0}
              defaultValue={0}
              onChange={(e: SliderChangeEvent) => handleAdjustmentChange(Effect.FogFeather, e.target.value)}
              step={1}
              value={adjustments.fogFeather ?? 0}
              onDragStateChange={onDragStateChange}
              fillOrigin="min"
            />
            <Slider
              label={t('adjustments.effects.fogDensity')}
              max={100}
              min={0}
              defaultValue={50}
              onChange={(e: SliderChangeEvent) => handleAdjustmentChange(Effect.FogDensity, e.target.value)}
              step={1}
              value={adjustments.fogDensity ?? 50}
              onDragStateChange={onDragStateChange}
              fillOrigin="min"
            />
            <Slider
              label={t('adjustments.effects.fogHeight')}
              max={100}
              min={0}
              defaultValue={0}
              onChange={(e: SliderChangeEvent) => handleAdjustmentChange(Effect.FogHeight, e.target.value)}
              step={1}
              value={adjustments.fogHeight ?? 0}
              onDragStateChange={onDragStateChange}
              fillOrigin="min"
            />
            <Slider
              label={t('adjustments.effects.fogVariation')}
              max={100}
              min={0}
              defaultValue={25}
              onChange={(e: SliderChangeEvent) => handleAdjustmentChange(Effect.FogVariation, e.target.value)}
              step={1}
              value={adjustments.fogVariation ?? 25}
              onDragStateChange={onDragStateChange}
              fillOrigin="min"
            />
            <Slider
              label={t('adjustments.effects.glow')}
              max={100}
              min={0}
              defaultValue={25}
              onChange={(e: SliderChangeEvent) => handleAdjustmentChange(Effect.FogGlow, e.target.value)}
              step={1}
              value={adjustments.fogGlow ?? 25}
              onDragStateChange={onDragStateChange}
              fillOrigin="min"
            />
            <Slider
              label={t('adjustments.color.temperature')}
              max={100}
              min={-100}
              onChange={(e: SliderChangeEvent) => handleAdjustmentChange(Effect.FogTemperature, e.target.value)}
              step={1}
              value={adjustments.fogTemperature ?? 0}
              trackClassName="temperature-gradient-track"
              onDragStateChange={onDragStateChange}
            />
            <Slider
              label={t('adjustments.color.tint')}
              max={100}
              min={-100}
              onChange={(e: SliderChangeEvent) => handleAdjustmentChange(Effect.FogTint, e.target.value)}
              step={1}
              value={adjustments.fogTint ?? 0}
              trackClassName="tint-gradient-track"
              onDragStateChange={onDragStateChange}
            />
          </AiEffectSection>

          <div className="p-2 compact:p-1.5 bg-bg-tertiary rounded-md">
            <Text variant={TextVariants.heading} className="mb-2 compact:mb-1 compact:text-sm">
              {t('adjustments.effects.lut')}
            </Text>
            <LUTControl
              lutPath={adjustments.lutPath || null}
              lutName={adjustments.lutName || null}
              lutIntensity={adjustments.lutIntensity || 100}
              onLutSelect={handleLutSelect}
              onLutHover={onLutHover}
              onIntensityChange={handleLutIntensityChange}
              onClear={handleLutClear}
              onDragStateChange={onDragStateChange}
            />
          </div>
        </div>
      )}

      {isForMask && (
        <div className="p-2 compact:p-1.5 bg-bg-tertiary rounded-md">
          <Text variant={TextVariants.heading} className="mb-2 compact:mb-1 compact:text-sm">
            {t('adjustments.effects.gaussianBlur')}
          </Text>
          <Slider
            label={t('adjustments.effects.amount')}
            max={100}
            min={0}
            defaultValue={0}
            onChange={(e: any) => handleAdjustmentChange(Effect.GaussianBlurAmount, e.target.value)}
            step={1}
            value={adjustments.gaussianBlurAmount ?? 0}
            onDragStateChange={onDragStateChange}
            fillOrigin="min"
          />
        </div>
      )}

      <div className="p-2 compact:p-1.5 bg-bg-tertiary rounded-md">
        <Text variant={TextVariants.heading} className="mb-2 compact:mb-1 compact:text-sm">
          {t('adjustments.effects.motionBlur')}
        </Text>
        <Slider
          label={t('adjustments.effects.amount')}
          max={100}
          min={0}
          defaultValue={0}
          onChange={(e: SliderChangeEvent) => handleAdjustmentChange(Effect.MotionBlurAmount, e.target.value)}
          step={1}
          value={adjustments.motionBlurAmount ?? 0}
          onDragStateChange={onDragStateChange}
          fillOrigin="min"
        />
        {motionBlurType === 'linear' && (
          <div className="flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <Slider
                label={t('adjustments.effects.motionBlurAngle')}
                max={90}
                min={-90}
                defaultValue={0}
                onChange={(e: SliderChangeEvent) => handleAdjustmentChange(Effect.MotionBlurAngle, e.target.value)}
                step={1}
                suffix="°"
                value={adjustments.motionBlurAngle ?? 0}
                onDragStateChange={onDragStateChange}
              />
            </div>
            <AngleDial
              label={t('adjustments.effects.motionBlurDirection')}
              onChange={(angle: number) => handleAdjustmentChange(Effect.MotionBlurAngle, angle)}
              onDragStateChange={onDragStateChange}
              value={adjustments.motionBlurAngle ?? 0}
            />
          </div>
        )}
        <Slider
          label={t('adjustments.effects.motionBlurHighlights')}
          max={100}
          min={0}
          defaultValue={DEFAULT_MOTION_BLUR_HIGHLIGHTS}
          onChange={(e: SliderChangeEvent) => handleAdjustmentChange(Effect.MotionBlurHighlights, e.target.value)}
          step={1}
          value={adjustments.motionBlurHighlights ?? DEFAULT_MOTION_BLUR_HIGHLIGHTS}
          onDragStateChange={onDragStateChange}
          fillOrigin="min"
        />
        <div className="mb-2">
          <Text variant={TextVariants.label} className="mb-2 block">
            {t('adjustments.effects.motionBlurType')}
          </Text>
          <Dropdown<MotionBlurType>
            options={[
              { label: t('adjustments.effects.motionBlurTypes.linear'), value: 'linear' },
              { label: t('adjustments.effects.motionBlurTypes.zoom'), value: 'zoom' },
              { label: t('adjustments.effects.motionBlurTypes.spin'), value: 'spin' },
              ...(isForMask
                ? [{ label: t('adjustments.effects.motionBlurTypes.smooth'), value: 'smooth' as const }]
                : []),
            ]}
            value={motionBlurType}
            onChange={(value) =>
              setAdjustments((prev: Partial<Adjustments>) => ({ ...prev, [Effect.MotionBlurType]: value }))
            }
          />
        </div>
        {isForMask && motionBlurType !== 'spin' && motionBlurType !== 'smooth' && (
          <div className="mb-2">
            <Text variant={TextVariants.label} className="mb-2 block">
              {t('adjustments.effects.motionBlurLayer')}
            </Text>
            <Dropdown<MotionBlurLayer>
              options={[
                { label: t('adjustments.effects.motionBlurLayers.auto'), value: 'auto' },
                { label: t('adjustments.effects.motionBlurLayers.subject'), value: 'subject' },
                { label: t('adjustments.effects.motionBlurLayers.panning'), value: 'panning' },
                { label: t('adjustments.effects.motionBlurLayers.uniform'), value: 'uniform' },
              ]}
              value={adjustments.motionBlurLayer ?? 'auto'}
              onChange={(value) =>
                setAdjustments((prev: Partial<Adjustments>) => ({ ...prev, [Effect.MotionBlurLayer]: value }))
              }
            />
          </div>
        )}
        {motionBlurType !== 'spin' && (
          <>
            <Switch
              label={t('adjustments.effects.motionBlurDepth')}
              checked={!!adjustments.motionBlurDepthEnabled}
              onChange={handleMotionBlurDepthToggle}
            />
            {adjustments.motionBlurDepthEnabled && (
              <div className="mt-2 space-y-2">
                <EffectMapStatus
                  enabled
                  isGenerating={!!generatingMaps.motionBlurDepthMap}
                  generatingLabel={t('editor.ai.generatingDepthMap')}
                  isMapMissing={!motionBlurDepthMap}
                  mapMissingLabel={t('adjustments.effects.depthMapMissing')}
                  generateMapLabel={t('adjustments.effects.generateDepthMap')}
                  onGenerateMap={handleGenerateMotionBlurDepthMap}
                >
                  <DepthScope
                    mapKey="motionBlurDepthMap"
                    scene={{
                      kind: 'motion',
                      amount: adjustments.motionBlurAmount ?? 0,
                      parallax: adjustments.motionBlurDepth ?? DEFAULT_MOTION_BLUR_DEPTH,
                      angle: adjustments.motionBlurAngle ?? 0,
                      radial: motionBlurType === 'zoom',
                    }}
                  />
                  <Slider
                    label={t('adjustments.effects.amount')}
                    max={100}
                    min={0}
                    defaultValue={DEFAULT_MOTION_BLUR_DEPTH}
                    onChange={(e: SliderChangeEvent) => handleAdjustmentChange(Effect.MotionBlurDepth, e.target.value)}
                    step={1}
                    value={adjustments.motionBlurDepth ?? DEFAULT_MOTION_BLUR_DEPTH}
                    onDragStateChange={onDragStateChange}
                    fillOrigin="min"
                  />
                </EffectMapStatus>
              </div>
            )}
          </>
        )}
      </div>

      {/* Masks offer no vignette; an older mask that has one keeps the controls to change or remove it. */}
      {adjustmentVisibility.vignette !== false && (!isForMask || !!adjustments.vignetteAmount) && (
        <div className="p-2 compact:p-1.5 bg-bg-tertiary rounded-md">
          <Text variant={TextVariants.heading} className="mb-2 compact:mb-1 compact:text-sm">
            {t('adjustments.effects.vignette')}
          </Text>
          <Slider
            label={t('adjustments.effects.amount')}
            max={100}
            min={-100}
            onChange={(e: any) => handleAdjustmentChange(Effect.VignetteAmount, e.target.value)}
            speedEditId={Effect.VignetteAmount}
            step={1}
            value={adjustments.vignetteAmount}
            onDragStateChange={onDragStateChange}
          />
          <Slider
            defaultValue={50}
            label={t('adjustments.effects.midpoint')}
            max={100}
            min={0}
            onChange={(e: any) => handleAdjustmentChange(Effect.VignetteMidpoint, e.target.value)}
            step={1}
            value={adjustments.vignetteMidpoint}
            onDragStateChange={onDragStateChange}
            fillOrigin="min"
          />
          <Slider
            label={t('adjustments.effects.roundness')}
            max={100}
            min={-100}
            onChange={(e: any) => handleAdjustmentChange(Effect.VignetteRoundness, e.target.value)}
            step={1}
            value={adjustments.vignetteRoundness}
            onDragStateChange={onDragStateChange}
          />
          <Slider
            defaultValue={50}
            label={t('adjustments.effects.feather')}
            max={100}
            min={0}
            onChange={(e: any) => handleAdjustmentChange(Effect.VignetteFeather, e.target.value)}
            step={1}
            value={adjustments.vignetteFeather}
            onDragStateChange={onDragStateChange}
            fillOrigin="min"
          />
        </div>
      )}

      {adjustmentVisibility.grain !== false && (
        <div className="p-2 compact:p-1.5 bg-bg-tertiary rounded-md">
          <Text variant={TextVariants.heading} className="mb-2 compact:mb-1 compact:text-sm">
            {t('adjustments.effects.grain')}
          </Text>
          <Slider
            label={t('adjustments.effects.amount')}
            max={100}
            min={0}
            onChange={(e: any) => handleAdjustmentChange(Effect.GrainAmount, e.target.value)}
            step={1}
            value={adjustments.grainAmount}
            onDragStateChange={onDragStateChange}
          />
          <Slider
            defaultValue={25}
            label={t('adjustments.effects.size')}
            max={100}
            min={0}
            onChange={(e: any) => handleAdjustmentChange(Effect.GrainSize, e.target.value)}
            step={1}
            value={adjustments.grainSize}
            onDragStateChange={onDragStateChange}
            fillOrigin="min"
          />
          <Slider
            defaultValue={50}
            label={t('adjustments.effects.roughness')}
            max={100}
            min={0}
            onChange={(e: any) => handleAdjustmentChange(Effect.GrainRoughness, e.target.value)}
            step={1}
            value={adjustments.grainRoughness}
            onDragStateChange={onDragStateChange}
            fillOrigin="min"
          />
        </div>
      )}
    </div>
  );
}
