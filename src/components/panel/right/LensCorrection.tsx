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
import Button from '../../ui/Button';
import { TextVariants } from '../../../types/typography';
import { Adjustments, LENS_CORRECTION_VERSION } from '../../../utils/adjustments';
import { SelectedImage } from '../../ui/AppProperties';

interface MyLens {
  maker: string;
  model: string;
}

/** The lens a version 2 edit's choice resolves to for its photo (`get_lens_correction_info`). */
interface LensCorrectionInfo {
  maker: string;
  model: string;
  distortion: boolean;
  tca: boolean;
  vignetting: boolean;
}

export interface LensParams {
  lensCorrectionMode: 'auto' | 'manual';
  lensCorrectionVersion: number;
  lensMaker: string | null;
  lensModel: string | null;
  lensDistortionAmount: number;
  lensVignetteAmount: number;
  lensTcaAmount: number;
  lensDistortionEnabled: boolean;
  lensTcaEnabled: boolean;
  lensVignetteEnabled: boolean;
  lensDistortionParams: Adjustments['lensDistortionParams'];
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
  lensCorrectionVersion: LENS_CORRECTION_VERSION,
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
  lensCorrectionVersion: adjustments.lensCorrectionVersion ?? 1,
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

/**
 * `params` with a changed lens choice (mode or lens). Changing it moves an edit to the current
 * lens correction, which looks the profile up for the photo instead of storing it (decision D1).
 */
const withLensChoice = (params: LensParams, choice: Partial<LensParams>): LensParams => ({
  ...params,
  ...choice,
  lensCorrectionVersion: LENS_CORRECTION_VERSION,
  lensDistortionParams: null,
});

/** What a version 1 edit's stored profile corrects. */
const storedAvailability = (p: LensParams['lensDistortionParams']) => ({
  distortion: !!p && (Math.abs(p.k1) > 1e-6 || Math.abs(p.k2) > 1e-6 || Math.abs(p.k3) > 1e-6),
  tca: !!p && (Math.abs(p.tca_vr - 1.0) > 1e-5 || Math.abs(p.tca_vb - 1.0) > 1e-5),
  vignetting: !!p && (Math.abs(p.vig_k1) > 1e-6 || Math.abs(p.vig_k2) > 1e-6 || Math.abs(p.vig_k3) > 1e-6),
});

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
  // Version 2: undefined while looking it up, null when the photo has no matching profile.
  const [lensInfo, setLensInfo] = useState<LensCorrectionInfo | null | undefined>(undefined);

  const [modeBubbleStyle, setModeBubbleStyle] = useState({});
  const isModeInitialAnimation = useRef(true);

  const isPreviousCorrection = params.lensCorrectionVersion < LENS_CORRECTION_VERSION;
  const hasLensChoice = params.lensCorrectionMode === 'auto' || !!(params.lensMaker && params.lensModel);

  useEffect(() => {
    if (isPreviousCorrection || !selectedImage?.path) {
      setLensInfo(null);
      return;
    }
    let active = true;
    setLensInfo(undefined);
    invoke<LensCorrectionInfo | null>('get_lens_correction_info', {
      path: selectedImage.path,
      selection: {
        lensCorrectionMode: params.lensCorrectionMode,
        lensMaker: params.lensMaker,
        lensModel: params.lensModel,
      },
    })
      .then((info) => active && setLensInfo(info))
      .catch(() => active && setLensInfo(null));
    return () => {
      active = false;
    };
  }, [selectedImage?.path, isPreviousCorrection, params.lensCorrectionMode, params.lensMaker, params.lensModel]);

  const availability = useMemo(
    () =>
      isPreviousCorrection
        ? storedAvailability(params.lensDistortionParams)
        : { distortion: !!lensInfo?.distortion, tca: !!lensInfo?.tca, vignetting: !!lensInfo?.vignetting },
    [isPreviousCorrection, params.lensDistortionParams, lensInfo],
  );

  // The lens automatic mode found: the stored one for version 1, the looked-up one for version 2.
  const detectedLens: Pick<LensCorrectionInfo, 'maker' | 'model'> | null | undefined = isPreviousCorrection
    ? params.lensMaker && params.lensModel
      ? { maker: params.lensMaker, model: params.lensModel }
      : null
    : lensInfo;

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
    adjustments.lensCorrectionVersion,
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

  const loadLensesForMaker = (maker: string) =>
    invoke<string[]>('get_lensfun_lenses_for_maker', { maker }).then(setLenses).catch(console.error);

  const handleMakerChange = (maker: string) => {
    updateParams(withLensChoice(params, { lensMaker: maker, lensModel: null }));
    setLenses([]);
    loadLensesForMaker(maker);
  };

  const handleModelChange = (model: string) => {
    updateParams(withLensChoice(params, { lensModel: model }));
  };

  const handleMyLensSelect = (val: string) => {
    if (!val || val === 'none') return;
    const selected = myLenses[parseInt(val)];
    if (!selected) return;
    updateParams(withLensChoice(params, { lensMaker: selected.maker, lensModel: selected.model }));
    loadLensesForMaker(selected.maker);
  };

  const handleParamChange = (key: keyof LensParams, value: number | boolean) => {
    updateParams({ ...params, [key]: value });
  };

  const handleReset = () => {
    setParams(DEFAULT_LENS_PARAMS);
    onReset(DEFAULT_LENS_PARAMS);
    setLenses([]);
  };

  const handleModeChange = (mode: 'auto' | 'manual') => {
    updateParams(withLensChoice(params, { lensCorrectionMode: mode }));
  };

  // Decision D2: the same lens choice, corrected the current way.
  const handleUpgrade = () => updateParams(withLensChoice(params, {}));

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
              style={{ borderRadius: 'var(--radius-md)' }}
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

        {isPreviousCorrection && hasLensChoice && (
          <div className="p-3 bg-surface rounded-md border border-surface flex flex-col gap-2">
            <Text as="div" variant={TextVariants.small} className="flex items-center gap-2">
              <Info size={16} className="shrink-0" />
              {t('modals.lensCorrection.previousCorrection')}
            </Text>
            <Button className="bg-surface text-text-primary w-full" onClick={handleUpgrade}>
              {t('modals.lensCorrection.useUpdatedCorrection')}
            </Button>
          </div>
        )}

        {params.lensCorrectionMode === 'auto' ? (
          <div>
            <Text variant={TextVariants.heading} className="mb-2">
              {t('modals.lensCorrection.autoDetectStatus')}
            </Text>
            <div
              className={clsx(
                'w-full flex items-center justify-center gap-2 px-3 py-3 text-sm font-semibold rounded-md border',
                detectedLens === null
                  ? 'bg-red-500/10 text-red-400 border-red-500/20'
                  : detectedLens
                    ? 'bg-green-500/10 text-green-400 border-green-500/20'
                    : 'bg-surface text-text-secondary border-surface',
              )}
            >
              {detectedLens === undefined ? (
                <>
                  <Loader size={16} className="animate-spin" /> {t('modals.lensCorrection.detectingExif')}
                </>
              ) : detectedLens === null ? (
                t('modals.lensCorrection.lensProfileNotFound')
              ) : (
                <>
                  <Check size={16} /> {detectedLens.maker} - {detectedLens.model}
                </>
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
