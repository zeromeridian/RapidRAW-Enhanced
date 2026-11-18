import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { motion } from 'framer-motion';
import clsx from 'clsx';
import { LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import Button from '../../ui/Button';
import Switch from '../../ui/Switch';
import Text from '../../ui/Text';
import { Invokes } from '../../ui/AppProperties';
import { TextColors, TextVariants } from '../../../types/typography';

/** How long a Settings action keeps its result message on screen. */
const RESULT_MESSAGE_MS = 3000;

interface SettingSwitchProps {
  checked: boolean;
  disabled?: boolean;
  id: string;
  /** The switch's accessible name; the row's label is what is seen. */
  label: string;
  onChange(checked: boolean): void;
}

/** A switch in a settings row, named by the row's label beside it. */
export const SettingSwitch = (props: SettingSwitchProps) => <Switch hideLabel {...props} />;

export interface SegmentOption<T extends string> {
  icon: LucideIcon;
  id: T;
  label: string;
}

interface SegmentedSwitchProps<T extends string> {
  /** Unique per switch, so its highlight slides only between its own options. */
  layoutId: string;
  onChange(value: T): void;
  options: SegmentOption<T>[];
  value: T;
}

/** A row of options with a highlight that slides to the chosen one. */
export const SegmentedSwitch = <T extends string>({ layoutId, onChange, options, value }: SegmentedSwitchProps<T>) => (
  <div className="relative flex w-full p-1 bg-bg-primary rounded-md border border-border-color">
    {options.map((option) => (
      <button
        key={option.id}
        onClick={() => onChange(option.id)}
        className={clsx(
          'relative flex-1 flex items-center justify-center gap-2 px-3 py-1.5 text-sm font-medium rounded-md transition-colors',
          value === option.id ? 'text-button-text' : 'text-text-primary hover:bg-surface',
        )}
        style={{ WebkitTapHighlightColor: 'transparent' }}
      >
        {value === option.id && (
          <motion.span
            layoutId={layoutId}
            className="absolute inset-0 z-0 bg-accent"
            style={{ borderRadius: 6 }}
            transition={{ type: 'spring', bounce: 0.2, duration: 0.6 }}
          />
        )}
        <span className="relative z-10 flex items-center">
          <option.icon size={16} className="mr-2 shrink-0" />
          {option.label}
        </span>
      </button>
    ))}
  </div>
);

interface ActionButtonProps {
  disabled?: boolean;
  icon: LucideIcon;
  isProcessing: boolean;
  onClick(): void;
  text: string;
}

/** The button of a Storage or tagging action, which deletes or changes data. */
export const ActionButton = ({ disabled = false, icon: Icon, isProcessing, onClick, text }: ActionButtonProps) => {
  const { t } = useTranslation();
  return (
    <Button variant="destructive" onClick={onClick} disabled={isProcessing || disabled}>
      <Icon size={16} className="mr-2" />
      {isProcessing ? t('settings.data.statuses.processing') : text}
    </Button>
  );
};

/** An action's progress or result. */
export const StatusMessage = ({ message }: { message: string }) => <Text color={TextColors.accent}>{message}</Text>;

/** A folder or file path shown in full. */
export const PathBox = ({ children }: { children: string }) => (
  <Text
    as="div"
    variant={TextVariants.small}
    className="font-mono bg-bg-primary p-2 rounded-sm break-all border border-border-color whitespace-pre-wrap"
  >
    {children}
  </Text>
);

/** Runs a Settings action, showing a progress message and then its result for a few seconds. */
export const useTimedAction = () => {
  const [isRunning, setIsRunning] = useState(false);
  const [message, setMessage] = useState('');

  const run = async (progressMessage: string, action: () => Promise<string>) => {
    setIsRunning(true);
    setMessage(progressMessage);
    try {
      setMessage(await action());
    } catch (err) {
      console.error('Settings action failed:', err);
      setMessage(`Error: ${err}`);
    } finally {
      setTimeout(() => {
        setIsRunning(false);
        setMessage('');
      }, RESULT_MESSAGE_MS);
    }
  };

  return { isRunning, message, run };
};

/** The size of an app cache that Storage can clear, and its clear action. */
export const useClearableCache = (
  getSize: Invokes,
  clear: Invokes,
  statuses: { clearing: string; success: string },
) => {
  const [size, setSize] = useState<number | null>(null);
  const action = useTimedAction();

  const refreshSize = useCallback(() => {
    invoke<number>(getSize).then(setSize).catch(console.error);
  }, [getSize]);

  useEffect(refreshSize, [refreshSize]);

  const clearCache = () =>
    action.run(statuses.clearing, async () => {
      try {
        await invoke(clear);
        return statuses.success;
      } finally {
        refreshSize();
      }
    });

  return { size, isClearing: action.isRunning, message: action.message, clearCache };
};
