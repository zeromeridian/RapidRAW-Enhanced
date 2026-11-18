import { createContext, useContext } from 'react';
import { AppSettings } from '../../ui/AppProperties';
import { ProcessingSettingsState } from './useProcessingSettings';

/** A destructive action the user confirms first. */
export interface ConfirmRequest {
  confirmText: string;
  message: string;
  onConfirm(): void;
  title: string;
}

export interface SettingsContextValue {
  appSettings: AppSettings;
  onSettingsChange(settings: AppSettings): Promise<void>;
  /** Saves one setting. */
  updateSetting<K extends keyof AppSettings>(key: K, value: AppSettings[K]): Promise<void>;
  onLibraryRefresh(): void;
  /** The library folders that the tagging and Storage actions run on. */
  rootPaths: string[];
  osPlatform: string;
  requestConfirm(request: ConfirmRequest): void;
  processing: ProcessingSettingsState;
}

export const SettingsContext = createContext<SettingsContextValue | null>(null);

export const useSettingsContext = () => {
  const context = useContext(SettingsContext);
  if (!context) throw new Error('useSettingsContext must be used inside the Settings window');
  return context;
};
