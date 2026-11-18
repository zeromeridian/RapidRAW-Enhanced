import { ComponentType, useState } from 'react';
import {
  ArrowLeft,
  Cpu,
  HardDrive,
  Info,
  Keyboard,
  Library,
  LucideIcon,
  Palette,
  Search,
  Share2,
  SlidersHorizontal,
  Sparkles,
  Tags,
  X,
} from 'lucide-react';
import { AnimatePresence, LayoutGroup, motion } from 'framer-motion';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import Button from '../ui/Button';
import ConfirmModal from '../modals/ConfirmModal';
import Input from '../ui/Input';
import Text from '../ui/Text';
import { AppSettings } from '../ui/AppProperties';
import { TextColors, TextVariants } from '../../types/typography';
import { useOsPlatform } from '../../hooks/useOsPlatform';
import { ConfirmRequest, SettingsContext, SettingsContextValue } from './settings/SettingsContext';
import { SettingsPageProps } from './settings/SettingsPage';
import { useProcessingSettings } from './settings/useProcessingSettings';
import AboutSettings from './settings/AboutSettings';
import AiSettings from './settings/AiSettings';
import EditorSettings from './settings/EditorSettings';
import ExportSettings from './settings/ExportSettings';
import InterfaceSettings from './settings/InterfaceSettings';
import LibrarySettings from './settings/LibrarySettings';
import ProcessingSettings from './settings/ProcessingSettings';
import ShortcutsSettings from './settings/ShortcutsSettings';
import StorageSettings from './settings/StorageSettings';
import TaggingSettings from './settings/TaggingSettings';

interface SettingsPanelProps {
  appSettings: AppSettings | null;
  onBack(): void;
  onLibraryRefresh(): void;
  onSettingsChange(settings: AppSettings): Promise<void>;
  rootPaths: string[];
}

type SettingsPageId =
  'interface' | 'library' | 'editor' | 'tagging' | 'processing' | 'ai' | 'export' | 'storage' | 'shortcuts' | 'about';

interface SettingsPageEntry {
  icon: LucideIcon;
  id: SettingsPageId;
  Page: ComponentType<SettingsPageProps>;
}

/** The Settings pages in the order of the category list; each is named by `settings.categories.<id>`. */
const SETTINGS_PAGES: SettingsPageEntry[] = [
  { id: 'interface', icon: Palette, Page: InterfaceSettings },
  { id: 'library', icon: Library, Page: LibrarySettings },
  { id: 'editor', icon: SlidersHorizontal, Page: EditorSettings },
  { id: 'tagging', icon: Tags, Page: TaggingSettings },
  { id: 'processing', icon: Cpu, Page: ProcessingSettings },
  { id: 'ai', icon: Sparkles, Page: AiSettings },
  { id: 'export', icon: Share2, Page: ExportSettings },
  { id: 'storage', icon: HardDrive, Page: StorageSettings },
  { id: 'shortcuts', icon: Keyboard, Page: ShortcutsSettings },
  { id: 'about', icon: Info, Page: AboutSettings },
];

export default function SettingsPanel({
  appSettings,
  onBack,
  onLibraryRefresh,
  onSettingsChange,
  rootPaths,
}: SettingsPanelProps) {
  const { t } = useTranslation();
  const osPlatform = useOsPlatform();
  const [activePageId, setActivePageId] = useState<SettingsPageId>(SETTINGS_PAGES[0].id);
  const [search, setSearch] = useState('');
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(null);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const processing = useProcessingSettings(appSettings, onSettingsChange, osPlatform);
  const query = search.trim().toLocaleLowerCase();
  const ActivePage = (SETTINGS_PAGES.find((page) => page.id === activePageId) ?? SETTINGS_PAGES[0]).Page;

  // The settings are loaded before the library opens, so this only guards the type.
  if (!appSettings) return null;

  const settingsContext: SettingsContextValue = {
    appSettings,
    onSettingsChange,
    updateSetting: (key, value) => onSettingsChange({ ...appSettings, [key]: value }),
    onLibraryRefresh,
    rootPaths: rootPaths?.length > 0 ? rootPaths : appSettings.rootFolders || [],
    osPlatform,
    requestConfirm: (request) => {
      setConfirmRequest(request);
      setIsConfirmOpen(true);
    },
    processing,
  };

  const openPage = (id: SettingsPageId) => {
    setActivePageId(id);
    setSearch('');
  };

  return (
    <SettingsContext.Provider value={settingsContext}>
      <ConfirmModal
        {...(confirmRequest ?? {})}
        confirmVariant="destructive"
        isOpen={isConfirmOpen}
        onClose={() => setIsConfirmOpen(false)}
      />
      <LayoutGroup id="settings-panel">
        <div className="flex flex-col h-full w-full text-text-primary">
          <header className="shrink-0 flex items-center mb-6 pt-4">
            <Button
              className="mr-4 hover:bg-surface text-text-primary rounded-full"
              onClick={onBack}
              size="icon"
              variant="ghost"
              data-tooltip={t('settings.tooltips.goHome')}
            >
              <ArrowLeft />
            </Button>
            <Text variant={TextVariants.display} color={TextColors.accent} className="whitespace-nowrap">
              {t('settings.title')}
            </Text>
          </header>

          <div className="flex flex-1 min-h-0 gap-6">
            <nav className="w-56 shrink-0 flex flex-col gap-3 overflow-y-auto custom-scrollbar">
              <div className="relative">
                <Search
                  size={16}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary pointer-events-none"
                />
                <Input
                  className="pl-9 pr-9"
                  id="settings-search"
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Escape') setSearch('');
                  }}
                  placeholder={t('settings.search.placeholder')}
                  type="search"
                  value={search}
                />
                {search && (
                  <button
                    aria-label={t('settings.search.clear')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-full text-text-secondary hover:text-text-primary hover:bg-bg-primary"
                    onClick={() => setSearch('')}
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
              <div className="flex flex-col gap-1 p-2 bg-surface rounded-md">
                {SETTINGS_PAGES.map(({ icon: Icon, id }) => {
                  const isActive = !query && activePageId === id;
                  return (
                    <button
                      key={id}
                      onClick={() => openPage(id)}
                      className={clsx(
                        'relative flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-md transition-colors text-left',
                        isActive ? 'text-button-text' : 'text-text-primary hover:bg-bg-primary',
                      )}
                      style={{ WebkitTapHighlightColor: 'transparent' }}
                    >
                      {isActive && (
                        <motion.span
                          layoutId="settings-category-switch-bubble"
                          className="absolute inset-0 z-0 bg-accent"
                          style={{ borderRadius: 6 }}
                          transition={{ type: 'spring', bounce: 0.2, duration: 0.6 }}
                        />
                      )}
                      <span className="relative z-10 flex items-center min-w-0">
                        <Icon size={16} className="mr-2 shrink-0" />
                        <span className="truncate">{t(`settings.categories.${id}`)}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </nav>

            <div className="flex-1 min-w-0 flex flex-col">
              {processing.restartRequired && (
                <div className="shrink-0 mb-4 p-3 bg-blue-900/10 border border-blue-500/50 rounded-lg flex flex-wrap items-center gap-3">
                  <Text as="div" color={TextColors.info} className="flex flex-1 items-center gap-3">
                    <Info size={18} className="shrink-0" />
                    <p>{t('settings.processing.restartRequired')}</p>
                  </Text>
                  <Button onClick={processing.saveAndRelaunch}>{t('settings.processing.saveRelaunch')}</Button>
                </div>
              )}
              <div className="flex-1 overflow-y-auto overflow-x-hidden pr-2 -mr-2 pb-6 custom-scrollbar">
                {query ? (
                  <div>
                    <div className="peer space-y-10">
                      {SETTINGS_PAGES.map(({ id, Page }) => (
                        <Page key={id} query={query} />
                      ))}
                    </div>
                    <Text className="hidden peer-empty:block py-10 text-center">
                      {t('settings.search.noResults', { query: search.trim() })}
                    </Text>
                  </div>
                ) : (
                  <AnimatePresence mode="wait">
                    <motion.div
                      key={activePageId}
                      initial={{ opacity: 0, x: 10 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -10 }}
                      transition={{ duration: 0.2 }}
                    >
                      <ActivePage query="" />
                    </motion.div>
                  </AnimatePresence>
                )}
              </div>
            </div>
          </div>
        </div>
      </LayoutGroup>
    </SettingsContext.Provider>
  );
}
