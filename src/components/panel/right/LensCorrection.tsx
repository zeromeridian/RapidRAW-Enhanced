import { ReactNode, useState, useEffect, useMemo, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation, Trans } from 'react-i18next';
import { Activity, Check, CircleDashed, Info, Loader, RotateCcw, SquareDashed, type LucideIcon } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import clsx from 'clsx';
import Slider from '../../ui/Slider';
import Dropdown from '../../ui/Dropdown';
import Switch from '../../ui/Switch';
import Text from '../../ui/Text';
import { TextVariants } from '../../../types/typography';
import { Adjustments } from '../../../utils/adjustments';
import { SelectedImage } from '../../ui/AppProperties';

interface MyLens {
  maker: string;
  model: string;
}

export interface LensParams {
  lensCorrectionMode: 'auto' | 'manual';
  lensMaker: string | null;
  lensModel: string | null;
  lensDistortionAmount: number;
  lensVignetteAmount: number;
  lensTcaAmount: number;
  lensDistortionEnabled: boolean;
  lensTcaEnabled: boolean;
  lensVignetteEnabled: boolean;
  lensDistortionParams: {
    k1: number;
    k2: number;
    k3: number;
    model: number;
    tca_vr: number;
    tca_vb: number;
    vig_k1: number;
    vig_k2: number;
    vig_k3: number;
  } | null;
}

interface LensCorrectionProps {
  adjustments: Adjustments;
  /** Every change applies at once, as one history step. */
  onChange(params: LensParams): void;
  /** Resets the manual chromatic aberration together with the lens profile. */
  onReset(params: LensParams): void;
  selectedImage: SelectedImage | null;
  /** The manual chromatic aberration sliders, shown below the profile's switch. */
  children: ReactNode;
}

export const DEFAULT_LENS_PARAMS: LensParams = {
  lensCorrectionMode: 'manual',
  lensMaker: null,
  lensModel: null,
  lensDistortionAmount: 100,
  lensVignetteAmount: 100,
  lensTcaAmount: 100,
  lensDistortionEnabled: true,
  lensTcaEnabled: true,
  lensVignetteEnabled: true,
  lensDistortionParams: null,
};

const lensParamsFromAdjustments = (adjustments: Adjustments): LensParams => ({
  lensCorrectionMode: adjustments.lensCorrectionMode || 'manual',
  lensMaker: adjustments.lensMaker,
  lensModel: adjustments.lensModel,
  lensDistortionAmount: adjustments.lensDistortionAmount ?? 100,
  lensVignetteAmount: adjustments.lensVignetteAmount ?? 100,
  lensTcaAmount: adjustments.lensTcaAmount ?? 100,
  lensDistortionEnabled: adjustments.lensDistortionEnabled ?? true,
  lensTcaEnabled: adjustments.lensTcaEnabled ?? true,
  lensVignetteEnabled: adjustments.lensVignetteEnabled ?? true,
  lensDistortionParams: adjustments.lensDistortionParams,
});

/** An EXIF field read with `parseFloat` (so "f/2.8" gives null); null when missing. */
const parseExifFloat = (exif: any, key: 'FocalLength' | 'FNumber' | 'SubjectDistance'): number | null => {
  if (!exif || !exif[key]) return null;
  const val = parseFloat(exif[key]);
  return isNaN(val) ? null : val;
};

interface ProfileCorrectionProps {
  amount: number;
  available: boolean;
  enabled: boolean;
  icon: LucideIcon;
  label: string;
  onAmountChange(amount: number): void;
  onEnabledChange(enabled: boolean): void;
}

/** One correction of the lens profile: its switch, and its amount while it is on. */
function ProfileCorrection({
  amount,
  available,
  enabled,
  icon: Icon,
  label,
  onAmountChange,
  onEnabledChange,
}: ProfileCorrectionProps) {
  const { t } = useTranslation();
  return (
    <div>
      <div
        className={clsx(
          'flex items-center gap-3 p-2 rounded-md transition-colors',
          available ? 'bg-surface' : 'bg-surface/30',
        )}
      >
        <Text as="div" className="p-1.5 bg-bg-primary rounded-sm">
          <Icon size={16} />
        </Text>
        <Switch
          className="grow"
          label={label}
          checked={enabled && available}
          onChange={onEnabledChange}
          disabled={!available}
        />
      </div>
      <AnimatePresence initial={false}>
        {available && enabled && (
          <motion.div
            initial={{ height: 0, opacity: 0, marginTop: 0 }}
            animate={{ height: 'auto', opacity: 1, marginTop: 8 }}
            exit={{ height: 0, opacity: 0, marginTop: 0 }}
            transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
            className="overflow-hidden px-2"
          >
            <Slider
              label={t('modals.lensCorrection.amount')}
              value={amount}
              min={0}
              max={200}
              defaultValue={100}
              step={1}
              onChange={(e) => onAmountChange(Number(e.target.value))}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * Lens & Geometry's lens parts: the Lensfun profile (Auto or Manual, the lens, Distortion and
 * Vignetting), then Chromatic Aberration (the profile's switch and the manual sliders).
 */
export default function LensCorrection({
  adjustments,
  onChange,
  onReset,
  selectedImage,
  children,
}: LensCorrectionProps) {
  const { t } = useTranslation();
  const [params, setParams] = useState<LensParams>(() => lensParamsFromAdjustments(adjustments));
  const [makers, setMakers] = useState<string[]>([]);
  const [lenses, setLenses] = useState<string[]>([]);
  const [myLenses, setMyLenses] = useState<MyLens[]>([]);
  const [detectionStatus, setDetectionStatus] = useState<'idle' | 'detecting' | 'not_found' | 'success'>('idle');

  const [modeBubbleStyle, setModeBubbleStyle] = useState({});
  const isModeInitialAnimation = useRef(true);

  const focalLength = useMemo(() => parseExifFloat(selectedImage?.exif, 'FocalLength'), [selectedImage?.exif]);
  const aperture = useMemo(() => parseExifFloat(selectedImage?.exif, 'FNumber'), [selectedImage?.exif]);
  const distance = useMemo(() => parseExifFloat(selectedImage?.exif, 'SubjectDistance'), [selectedImage?.exif]);

  const availability = useMemo(() => {
    if (!params.lensDistortionParams) return { distortion: false, tca: false, vignetting: false };
    const p = params.lensDistortionParams;
    return {
      distortion: Math.abs(p.k1) > 1e-6 || Math.abs(p.k2) > 1e-6 || Math.abs(p.k3) > 1e-6,
      tca: Math.abs(p.tca_vr - 1.0) > 1e-5 || Math.abs(p.tca_vb - 1.0) > 1e-5,
      vignetting: Math.abs(p.vig_k1) > 1e-6 || Math.abs(p.vig_k2) > 1e-6 || Math.abs(p.vig_k3) > 1e-6,
    };
  }, [params.lensDistortionParams]);

  useEffect(() => {
    const selectedIndex = params.lensCorrectionMode === 'auto' ? 0 : 1;
    const targetX = `${selectedIndex * 100}%`;
    const targetWidth = '50%';

    if (isModeInitialAnimation.current) {
      const initialX = params.lensCorrectionMode === 'manual' ? '100%' : '-25%';
      setModeBubbleStyle({
        x: [initialX, targetX],
        width: targetWidth,
      });
      isModeInitialAnimation.current = false;
    } else {
      setModeBubbleStyle({
        x: targetX,
        width: targetWidth,
      });
    }
  }, [params.lensCorrectionMode]);

  const fetchDistortionParams = async (maker: string, model: string) => {
    try {
      const distParams: any = await invoke('get_lens_distortion_params', {
        maker,
        model,
        focalLength: focalLength,
        aperture: aperture,
        distance: distance,
      });
      return distParams;
    } catch (error) {
      console.error('Failed to fetch lens params', error);
      return null;
    }
  };

  const updateParams = (newParams: LensParams) => {
    setParams(newParams);
    onChange(newParams);
  };

  useEffect(() => {
    invoke('load_settings').then((settings: any) => {
      if (settings?.myLenses) {
        setMyLenses(settings.myLenses);
      }
    });

    const initParams = lensParamsFromAdjustments(adjustments);
    setParams(initParams);
    setDetectionStatus('idle');

    invoke('get_lensfun_makers')
      .then((m: any) => setMakers(m))
      .catch(console.error);

    if (initParams.lensMaker) {
      invoke('get_lensfun_lenses_for_maker', { maker: initParams.lensMaker })
        .then((l: any) => setLenses(l))
        .catch(console.error);
    }
  }, [selectedImage?.path]);

  // Undo, paste and presets change the lens outside this panel.
  useEffect(() => {
    setParams(lensParamsFromAdjustments(adjustments));
  }, [
    adjustments.lensCorrectionMode,
    adjustments.lensMaker,
    adjustments.lensModel,
    adjustments.lensDistortionAmount,
    adjustments.lensVignetteAmount,
    adjustments.lensTcaAmount,
    adjustments.lensDistortionEnabled,
    adjustments.lensTcaEnabled,
    adjustments.lensVignetteEnabled,
    adjustments.lensDistortionParams,
  ]);

  const handleMakerChange = (maker: string) => {
    const newParams = {
      ...params,
      lensMaker: maker,
      lensModel: null,
      lensDistortionParams: null,
    };
    updateParams(newParams);
    setLenses([]);
    setDetectionStatus('idle');

    invoke('get_lensfun_lenses_for_maker', { maker })
      .then((l: any) => setLenses(l))
      .catch(console.error);
  };

  const handleModelChange = async (model: string) => {
    const tempParams = { ...params, lensModel: model };
    updateParams(tempParams);
    setDetectionStatus('idle');

    if (params.lensMaker) {
      const distortionParams = await fetchDistortionParams(params.lensMaker, model);
      const finalParams = { ...tempParams, lensDistortionParams: distortionParams };
      updateParams(finalParams);
    }
  };

  const handleMyLensSelect = async (val: string) => {
    if (!val || val === 'none') return;
    const index = parseInt(val);
    const selected = myLenses[index];
    if (!selected) return;

    const tempParams = { ...params, lensMaker: selected.maker, lensModel: selected.model };
    updateParams(tempParams);
    setDetectionStatus('idle');

    invoke('get_lensfun_lenses_for_maker', { maker: selected.maker })
      .then((l: any) => setLenses(l))
      .catch(console.error);

    const distortionParams = await fetchDistortionParams(selected.maker, selected.model);
    const finalParams = { ...tempParams, lensDistortionParams: distortionParams };
    updateParams(finalParams);
  };

  const handleParamChange = (key: keyof LensParams, value: number | boolean) => {
    updateParams({ ...params, [key]: value });
  };

  const handleAutoDetect = async (baseParams?: LensParams) => {
    if (!selectedImage?.exif) {
      setDetectionStatus('not_found');
      return;
    }
    const exifMaker = selectedImage.exif.Make || '';
    const exifModel = selectedImage.exif.LensModel || '';
    const exifCameraModel = selectedImage.exif.Model || '';

    if (!exifModel && !exifCameraModel) {
      setDetectionStatus('not_found');
      return;
    }

    setDetectionStatus('detecting');

    try {
      const result: [string, string] | null = await invoke('autodetect_lens', {
        maker: exifMaker,
        model: exifModel,
        cameraModel: exifCameraModel,
      });

      if (result) {
        const [detectedMaker, detectedModel] = result;

        invoke('get_lensfun_lenses_for_maker', { maker: detectedMaker })
          .then((l: any) => setLenses(l))
          .catch(console.error);

        const distortionParams = await fetchDistortionParams(detectedMaker, detectedModel);

        setParams((prev) => {
          const newParams = {
            ...(baseParams ?? prev),
            lensMaker: detectedMaker,
            lensModel: detectedModel,
            lensDistortionParams: distortionParams,
          };
          onChange(newParams);
          return newParams;
        });

        setDetectionStatus('success');

        setTimeout(() => {
          setDetectionStatus('idle');
        }, 2000);
      } else {
        setParams((prev) => {
          const clearedParams = {
            ...(baseParams ?? prev),
            lensMaker: null,
            lensModel: null,
            lensDistortionParams: null,
          };
          onChange(clearedParams);
          return clearedParams;
        });
        setDetectionStatus('not_found');
      }
    } catch (error) {
      console.error('Autodetection failed with error:', error);
      setDetectionStatus('not_found');
    }
  };

  const handleReset = () => {
    setParams(DEFAULT_LENS_PARAMS);
    onReset(DEFAULT_LENS_PARAMS);
    setLenses([]);
    setDetectionStatus('idle');
  };

  const handleModeChange = (mode: 'auto' | 'manual') => {
    const newParams = { ...params, lensCorrectionMode: mode };
    updateParams(newParams);

    if (mode === 'auto') {
      handleAutoDetect(newParams);
    }
  };

  const makerOptions = makers.map((m) => ({ label: m, value: m }));
  const lensOptions = lenses.map((m) => ({ label: m, value: m }));

  const myLensOptions = useMemo(() => {
    if (myLenses.length === 0) {
      return [{ label: t('modals.lensCorrection.manageLensesPlaceholder'), value: 'none' }];
    }
    return myLenses.map((l, i) => ({
      label: `${l.maker} - ${l.model}`,
      value: i.toString(),
    }));
  }, [myLenses, t]);

  const modeButtonClassName = (mode: 'auto' | 'manual') =>
    clsx(
      'relative flex-1 flex items-center justify-center gap-2 px-3 p-1.5 text-sm font-medium rounded-md transition-colors',
      params.lensCorrectionMode === mode ? 'text-button-text' : 'text-text-primary hover:bg-surface',
    );

  return (
    <>
      <section className="flex flex-col gap-4 compact:gap-2.5">
        <div className="flex items-center justify-between">
          <Text variant={TextVariants.title}>{t('editor.geometry.lensProfile')}</Text>
          <button
            onClick={handleReset}
            data-tooltip={t('modals.lensCorrection.resetTooltip')}
            className="p-2 rounded-full hover:bg-surface transition-colors"
          >
            <RotateCcw size={18} />
          </button>
        </div>

        <div className="w-full p-2 bg-card-active rounded-md">
          <div className="relative flex w-full">
            <motion.div
              className="absolute top-0 bottom-0 z-0 bg-accent"
              style={{ borderRadius: 6 }}
              animate={modeBubbleStyle}
              transition={{ type: 'spring', bounce: 0.2, duration: 0.6 }}
            />
            <button
              onClick={() => handleModeChange('auto')}
              className={modeButtonClassName('auto')}
              style={{ WebkitTapHighlightColor: 'transparent' }}
            >
              <span className="relative z-10 flex items-center">{t('modals.lensCorrection.modeAuto')}</span>
            </button>
            <button
              onClick={() => handleModeChange('manual')}
              className={modeButtonClassName('manual')}
              style={{ WebkitTapHighlightColor: 'transparent' }}
            >
              <span className="relative z-10 flex items-center">{t('modals.lensCorrection.modeManual')}</span>
            </button>
          </div>
        </div>

        {params.lensCorrectionMode === 'auto' ? (
          <div>
            <Text variant={TextVariants.heading} className="mb-2">
              {t('modals.lensCorrection.autoDetectStatus')}
            </Text>
            <div
              className={clsx(
                'w-full flex items-center justify-center gap-2 px-3 py-3 text-sm font-semibold rounded-md border',
                detectionStatus === 'not_found'
                  ? 'bg-red-500/10 text-red-400 border-red-500/20'
                  : params.lensMaker
                    ? 'bg-green-500/10 text-green-400 border-green-500/20'
                    : 'bg-surface text-text-secondary border-surface',
              )}
            >
              {detectionStatus === 'detecting' ? (
                <>
                  <Loader size={16} className="animate-spin" /> {t('modals.lensCorrection.detectingExif')}
                </>
              ) : detectionStatus === 'not_found' ? (
                t('modals.lensCorrection.lensProfileNotFound')
              ) : params.lensMaker && params.lensModel ? (
                <>
                  <Check size={16} /> {params.lensMaker} - {params.lensModel}
                </>
              ) : (
                t('modals.lensCorrection.waitingAutoDetect')
              )}
            </div>
          </div>
        ) : (
          <div>
            <Text variant={TextVariants.heading} className="mb-2">
              {t('modals.lensCorrection.manualSelection')}
            </Text>
            <div className="space-y-4">
              <Dropdown
                options={myLensOptions}
                value=""
                onChange={handleMyLensSelect}
                placeholder={t('modals.lensCorrection.chooseSavedLens')}
              />
              <Dropdown
                options={makerOptions}
                value={params.lensMaker}
                onChange={handleMakerChange}
                placeholder={t('modals.lensCorrection.selectManufacturer')}
              />
              {params.lensMaker && (
                <Dropdown
                  options={lensOptions}
                  value={params.lensModel}
                  onChange={handleModelChange}
                  placeholder={t('modals.lensCorrection.selectLensModel')}
                />
              )}
            </div>
          </div>
        )}

        <ProfileCorrection
          amount={params.lensDistortionAmount}
          available={availability.distortion}
          enabled={params.lensDistortionEnabled}
          icon={SquareDashed}
          label={t('modals.lensCorrection.distortion')}
          onAmountChange={(amount) => handleParamChange('lensDistortionAmount', amount)}
          onEnabledChange={(enabled) => handleParamChange('lensDistortionEnabled', enabled)}
        />
        <ProfileCorrection
          amount={params.lensVignetteAmount}
          available={availability.vignetting}
          enabled={params.lensVignetteEnabled}
          icon={CircleDashed}
          label={t('modals.lensCorrection.vignetting')}
          onAmountChange={(amount) => handleParamChange('lensVignetteAmount', amount)}
          onEnabledChange={(enabled) => handleParamChange('lensVignetteEnabled', enabled)}
        />
      </section>

      <section className="flex flex-col gap-4 compact:gap-2.5">
        <Text variant={TextVariants.title}>{t('modals.lensCorrection.chromaticAberration')}</Text>
        <ProfileCorrection
          amount={params.lensTcaAmount}
          available={availability.tca}
          enabled={params.lensTcaEnabled}
          icon={Activity}
          label={t('editor.geometry.lensProfile')}
          onAmountChange={(amount) => handleParamChange('lensTcaAmount', amount)}
          onEnabledChange={(enabled) => handleParamChange('lensTcaEnabled', enabled)}
        />
        {children}
      </section>
    </>
  );
}

/** The panel's notes: masks shift with lens correction, and the Lensfun credit. */
export function LensNotices({ hasMasks }: { hasMasks: boolean }) {
  const { t } = useTranslation();
  const noteClassName = 'p-3 bg-surface rounded-md border border-surface flex items-center gap-3';
  return (
    <div className="mt-auto space-y-2">
      {hasMasks && (
        <Text as="div" variant={TextVariants.small} className={noteClassName}>
          <Info size={16} className="shrink-0" />
          <p className="leading-relaxed">{t('modals.lensCorrection.maskWarning')}</p>
        </Text>
      )}
      <Text as="div" variant={TextVariants.small} className={noteClassName}>
        <Info size={16} className="shrink-0" />
        <div className="leading-tight space-y-1">
          <Trans i18nKey="modals.lensCorrection.databaseNotice">
            Lens database provided by the{' '}
            <a
              href="https://lensfun.github.io/"
              target="_blank"
              rel="noreferrer"
              className="underline hover:text-primary transition-colors"
            >
              Lensfun Project
            </a>{' '}
            (
            <a
              href="https://creativecommons.org/licenses/by-sa/3.0/"
              target="_blank"
              rel="noreferrer"
              className="underline hover:text-primary transition-colors"
            >
              CC BY-SA 3.0
            </a>
            ).
          </Trans>
        </div>
      </Text>
    </div>
  );
}
