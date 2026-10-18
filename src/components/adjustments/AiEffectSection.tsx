import { HTMLAttributes, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import Button from '../ui/Button';
import Switch from '../ui/Switch';
import Text from '../ui/Text';
import { TextVariants } from '../../types/typography';
import { useProcessStore } from '../../store/useProcessStore';

interface AiEffectSectionProps extends HTMLAttributes<HTMLDivElement> {
  title: string;
  enabled: boolean;
  onEnabledChange(enabled: boolean): void;
  isGenerating: boolean;
  generatingLabel: string;
  generationProgress?: number;
  isMapMissing?: boolean;
  mapMissingLabel?: string;
  generateMapLabel?: string;
  onGenerateMap?(): void;
  children: ReactNode;
}

/** A toggled adjustment section whose result depends on an AI model run. */
export default function AiEffectSection({
  title,
  enabled,
  onEnabledChange,
  isGenerating,
  generatingLabel,
  generationProgress,
  isMapMissing = false,
  mapMissingLabel,
  generateMapLabel,
  onGenerateMap,
  children,
  ...props
}: AiEffectSectionProps) {
  const { t } = useTranslation();
  const aiModelDownloadStatus = useProcessStore((state) => state.aiModelDownloadStatus);
  const progressDetail =
    aiModelDownloadStatus || (generationProgress !== undefined ? `${Math.round(generationProgress * 100)}%` : null);

  return (
    <div className="p-2 bg-bg-tertiary rounded-md" {...props}>
      <Text variant={TextVariants.heading} className="mb-2">
        {title}
      </Text>

      <Switch label={title} checked={enabled} onChange={onEnabledChange} />

      <div
        className={`grid transition-all duration-300 ease-in-out ${
          enabled ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
        }`}
      >
        <div className="overflow-hidden">
          <div className="space-y-4 pt-4 pb-1">
            {isGenerating ? (
              <div className="flex flex-col items-center justify-center gap-1 p-4 text-text-secondary text-center">
                <div className="flex items-center gap-2">
                  <Loader2 size={16} className="animate-spin shrink-0" />
                  <Text variant={TextVariants.label}>
                    {aiModelDownloadStatus ? t('editor.masks.settings.aiModelDownloading') : generatingLabel}
                  </Text>
                </div>
                {progressDetail && (
                  <Text variant={TextVariants.small} className="text-accent">
                    {progressDetail}
                  </Text>
                )}
              </div>
            ) : (
              <>
                {enabled && isMapMissing && onGenerateMap && (
                  <div className="flex flex-col gap-2 p-3 rounded-md bg-bg-primary">
                    <Text variant={TextVariants.small} className="text-text-secondary">
                      {mapMissingLabel}
                    </Text>
                    <Button className="bg-surface" onClick={onGenerateMap}>
                      {generateMapLabel}
                    </Button>
                  </div>
                )}
                {children}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
