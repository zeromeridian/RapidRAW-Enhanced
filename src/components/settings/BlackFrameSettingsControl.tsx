import { useTranslation } from 'react-i18next';

import { AppSettings, BlackFrameSettings } from '../ui/AppProperties';
import Button from '../ui/Button';
import Dropdown from '../ui/Dropdown';
import Slider from '../ui/Slider';
import Switch from '../ui/Switch';
import Text from '../ui/Text';
import { TextColors, TextVariants } from '../../types/typography';
import {
  BLACK_FRAME_LIMITS,
  BLACK_FRAME_PRESETS,
  DEFAULT_BLACK_FRAME,
  normalizeBlackFrame,
} from '../../utils/lightsOutFrame';

interface BlackFrameSettingsControlProps {
  appSettings: AppSettings;
  onSettingsChange(settings: AppSettings): Promise<void>;
}

const SIDE_KEYS = ['top', 'right', 'bottom', 'left'] as const;
const PRESET_KEYS = ['none', 'narrow', 'standard', 'wide', 'cinema'] as const;

export default function BlackFrameSettingsControl({ appSettings, onSettingsChange }: BlackFrameSettingsControlProps) {
  const { t } = useTranslation();
  const frame = normalizeBlackFrame(appSettings.blackFrame);
  const limits = BLACK_FRAME_LIMITS[frame.unit];

  const save = (next: BlackFrameSettings) => void onSettingsChange({ ...appSettings, blackFrame: next });

  const setSide = (side: (typeof SIDE_KEYS)[number], value: number) => {
    if (frame.locked) {
      save({ ...frame, top: value, right: value, bottom: value, left: value });
    } else {
      save({ ...frame, [side]: value });
    }
  };

  const previewScale = frame.unit === 'percent' ? 1 : 25 / BLACK_FRAME_LIMITS.pixels.max;
  const previewPadding = SIDE_KEYS.map((side) => `${Math.min(25, frame[side] * previewScale)}%`).join(' ');

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2">
        {PRESET_KEYS.map((name) => (
          <Button
            className="bg-bg-primary text-text-primary border border-border-color"
            key={name}
            onClick={() => save({ ...BLACK_FRAME_PRESETS[name] })}
            type="button"
          >
            {t(`settings.general.blackFramePresets.${name}` as const)}
          </Button>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <Text variant={TextVariants.label} className="mb-2">
            {t('settings.general.blackFrameUnit')}
          </Text>
          <Dropdown
            onChange={(unit: 'percent' | 'pixels') => save({ ...frame, unit })}
            options={[
              { value: 'percent', label: t('settings.general.blackFramePercent') },
              { value: 'pixels', label: t('settings.general.blackFramePixels') },
            ]}
            value={frame.unit}
            triggerClassName="bg-bg-primary"
          />
        </div>
        <div className="flex items-end">
          <Switch
            checked={frame.locked}
            id="black-frame-lock-sides"
            label={t('settings.general.blackFrameLockSides')}
            onChange={(locked) =>
              save(
                locked
                  ? { ...frame, locked, right: frame.top, bottom: frame.top, left: frame.top }
                  : { ...frame, locked },
              )
            }
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
        {(frame.locked ? (['top'] as const) : SIDE_KEYS).map((side) => (
          <Slider
            defaultValue={DEFAULT_BLACK_FRAME[side]}
            fillOrigin="min"
            key={side}
            label={
              frame.locked
                ? t('settings.general.blackFrameAllSides')
                : t(`settings.general.blackFrameSides.${side}`)
            }
            max={limits.max}
            min={limits.min}
            onChange={(event) => setSide(side, Number(event.target.value))}
            step={limits.step}
            suffix={frame.unit === 'percent' ? '%' : 'px'}
            value={frame[side]}
          />
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-[minmax(180px,1fr)_auto] gap-4 items-center">
        <div className="h-32 rounded-lg border border-border-color bg-black p-1" style={{ padding: previewPadding }}>
          <div className="h-full w-full bg-text-secondary/60 rounded-xs" />
        </div>
        <div className="space-y-3">
          <Text variant={TextVariants.small} color={TextColors.secondary}>
            {t('settings.general.blackFramePreview')}
          </Text>
          <Button
            className="bg-bg-primary text-text-primary border border-border-color"
            onClick={() => save({ ...DEFAULT_BLACK_FRAME })}
            type="button"
          >
            {t('settings.general.blackFrameReset')}
          </Button>
        </div>
      </div>
    </div>
  );
}
