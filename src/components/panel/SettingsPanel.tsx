import { useEffect, useState } from 'react';
import { ArrowLeft, Check, ChevronDown, ExternalLink as ExternalLinkIcon, Save, Trash2, Wifi, WifiOff } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { relaunch } from '@tauri-apps/plugin-process';
import { open } from '@tauri-apps/plugin-dialog';
import { open as openLink } from '@tauri-apps/plugin-shell';
import { motion, AnimatePresence } from 'framer-motion';
import clsx from 'clsx';
import Button from '../ui/Button';
import ConfirmModal from '../modals/ConfirmModal';
import Dropdown, { OptionItem } from '../ui/Dropdown';
import Switch from '../ui/Switch';
import Input from '../ui/Input';
import { ThemeProps, THEMES, DEFAULT_THEME_ID } from '../../utils/themes';
import { Invokes } from '../ui/AppProperties';

interface ConfirmModalState {
  confirmText: string;
  confirmVariant: string;
  isOpen: boolean;
  message: string;
  onConfirm(): void;
  title: string;
}

interface DataActionItemProps {
  buttonAction(): void;
  buttonText: string;
  description: any;
  disabled?: boolean;
  icon: any;
  isProcessing: boolean;
  message: string;
  title: string;
}

interface KeybindItemProps {
  description: string;
  keys: Array<string>;
}

interface SettingItemProps {
  children: any;
  description?: string;
  label: string;
}

interface SettingsPanelProps {
  appSettings: any;
  onBack(): void;
  onLibraryRefresh(): void;
  onSettingsChange(settings: any): void;
  rootPath: string | null;
}

interface TestStatus {
  message: string;
  success: boolean | null;
  testing: boolean;
}

const EXECUTE_TIMEOUT = 3000;

const DEFAULT_WORKFLOW_CONFIG = {
  workflowPath: null,
  modelCheckpoints: { '4': 'XL_RealVisXL_V5.0_Lightning.safetensors' },
  vaeLoaders: { '67': 'sdxl_vae.safetensors' },
  controlnetLoaders: { '16': 'diffusion_pytorch_model_promax.safetensors' },
  sourceImageNodeId: '11',
  maskImageNodeId: '148',
  textPromptNodeId: '6',
  finalOutputNodeId: '252',
  samplerNodeId: '3',
  samplerSteps: 10,
  inpaintResolution: 1536,
};

const resolutions: Array<OptionItem> = [
  { value: 720, label: '720px' },
  { value: 1280, label: '1280px' },
  { value: 1920, label: '1920px' },
  { value: 2560, label: '2560px' },
  { value: 3840, label: '3840px' },
];

const KeybindItem = ({ keys, description }: KeybindItemProps) => (
  <div className="flex justify-between items-center py-2">
    <span className="text-text-secondary text-sm">{description}</span>
    <div className="flex items-center gap-1">
      {keys.map((key: string, index: number) => (
        <kbd
          key={index}
          className="px-2 py-1 text-xs font-sans font-semibold text-text-primary bg-bg-primary border border-border-color rounded-md"
        >
          {key}
        </kbd>
      ))}
    </div>
  </div>
);

const SettingItem = ({ children, description, label }: SettingItemProps) => (
  <div>
    <label className="block text-sm font-medium text-text-primary mb-2">{label}</label>
    {children}
    {description && <p className="text-xs text-text-secondary mt-2">{description}</p>}
  </div>
);

const DataActionItem = ({
  buttonAction,
  buttonText,
  description,
  disabled = false,
  icon,
  isProcessing,
  message,
  title,
}: DataActionItemProps) => (
  <div className="pb-6 border-b border-border-color last:border-b-0 last:pb-0">
    <h3 className="font-medium text-text-primary mb-1">{title}</h3>
    <p className="text-xs text-text-secondary mb-3">{description}</p>
    <Button variant="destructive" onClick={buttonAction} disabled={isProcessing || disabled}>
      {icon}
      {isProcessing ? 'Processing...' : buttonText}
    </Button>
    {message && <p className="text-sm text-accent mt-3">{message}</p>}
  </div>
);

const ExternalLink = ({ href, children }) => {
  const handleClick = async (e) => {
    e.preventDefault();
    try {
      await openLink(href);
    } catch (err) {
      console.error(`Failed to open link: ${href}`, err);
    }
  };

  return (
    <a href={href} onClick={handleClick} className="text-accent hover:underline inline-flex items-center gap-1">
      {children}
      <ExternalLinkIcon size={12} />
    </a>
  );
};

export default function SettingsPanel({
  appSettings,
  onBack,
  onLibraryRefresh,
  onSettingsChange,
  rootPath,
}: SettingsPanelProps) {
  const [isClearing, setIsClearing] = useState(false);
  const [clearMessage, setClearMessage] = useState('');
  const [isClearingCache, setIsClearingCache] = useState(false);
  const [cacheClearMessage, setCacheClearMessage] = useState('');
  const [isClearingTags, setIsClearingTags] = useState(false);
  const [tagsClearMessage, setTagsClearMessage] = useState('');
  const [confirmModalState, setConfirmModalState] = useState<ConfirmModalState>({
    confirmText: 'Confirm',
    confirmVariant: 'primary',
    isOpen: false,
    message: '',
    onConfirm: () => {},
    title: '',
  });
  const [testStatus, setTestStatus] = useState<TestStatus>({ message: '', success: null, testing: false });
  const [saveStatus, setSaveStatus] = useState({ saving: false, message: '' });
  const [isConfigExpanded, setIsConfigExpanded] = useState(false);

  const [comfyUiAddress, setComfyUiAddress] = useState<string>(appSettings?.comfyuiAddress || '');
  const [comfyConfig, setComfyConfig] = useState(appSettings?.comfyuiWorkflowConfig || DEFAULT_WORKFLOW_CONFIG);

  const resetToDefaults = () => {
    setComfyConfig(DEFAULT_WORKFLOW_CONFIG);
  };

  useEffect(() => {
    if (appSettings?.comfyuiAddress !== comfyUiAddress) {
      setComfyUiAddress(appSettings?.comfyuiAddress || '');
    }
    setComfyConfig(appSettings?.comfyuiWorkflowConfig || DEFAULT_WORKFLOW_CONFIG);
  }, [appSettings]);

  const handleConfigChange = (field, value) => {
    setComfyConfig((prev) => ({ ...prev, [field]: value }));
  };

  const handleSaveComfyConfig = () => {
    setSaveStatus({ saving: true, message: 'Saving...' });
    const newConfig = { ...comfyConfig };
    onSettingsChange({ ...appSettings, comfyuiWorkflowConfig: newConfig });
    setTimeout(() => {
      setSaveStatus({ saving: false, message: 'Saved!' });
      setTimeout(() => setSaveStatus({ saving: false, message: '' }), EXECUTE_TIMEOUT - 500);
    }, 500);
  };

  const handleSelectWorkflowFile = async () => {
    try {
      const selected = await open({
        filters: [{ name: 'ComfyUI Workflow', extensions: ['json'] }],
        multiple: false,
      });
      if (typeof selected === 'string') {
        handleConfigChange('workflowPath', selected);
      }
    } catch (err) {
      console.error('Failed to open workflow file dialog:', err);
    }
  };

  const effectiveRootPath = rootPath || appSettings?.lastRootPath;

  const executeClearSidecars = async () => {
    setIsClearing(true);
    setClearMessage('Deleting sidecar files, please wait...');
    try {
      const count: number = await invoke(Invokes.ClearAllSidecars, { rootPath: effectiveRootPath });
      setClearMessage(`${count} sidecar files deleted successfully.`);
      onLibraryRefresh();
    } catch (err) {
      console.error('Failed to clear sidecars:', err);
      setClearMessage(`Error: ${err}`);
    } finally {
      setTimeout(() => {
        setIsClearing(false);
        setClearMessage('');
      }, EXECUTE_TIMEOUT);
    }
  };

  const handleClearSidecars = () => {
    setConfirmModalState({
      confirmText: 'Delete All Edits',
      confirmVariant: 'destructive',
      isOpen: true,
      message:
        'Are you sure you want to delete all sidecar files?\n\nThis will permanently remove all your edits for all images inside the current root folder and its subfolders.',
      onConfirm: executeClearSidecars,
      title: 'Confirm Deletion',
    });
  };

  const executeClearTags = async () => {
    setIsClearingTags(true);
    setTagsClearMessage('Clearing AI tags from all sidecar files...');
    try {
      const count = await invoke(Invokes.ClearAllTags, { rootPath: effectiveRootPath });
      setTagsClearMessage(`${count} files updated. Tags removed.`);
      onLibraryRefresh();
    } catch (err) {
      console.error('Failed to clear tags:', err);
      setTagsClearMessage(`Error: ${err}`);
    } finally {
      setTimeout(() => {
        setIsClearingTags(false);
        setTagsClearMessage('');
      }, EXECUTE_TIMEOUT);
    }
  };

  const handleClearTags = () => {
    setConfirmModalState({
      confirmText: 'Clear All Tags',
      confirmVariant: 'destructive',
      isOpen: true,
      message:
        'Are you sure you want to remove all AI-generated tags from all images in the current root folder?\n\nThis action cannot be undone.',
      onConfirm: executeClearTags,
      title: 'Confirm AI Tag Deletion',
    });
  };

  const executeSetTransparent = async (transparent: boolean) => {
    onSettingsChange({ ...appSettings, transparent });
    await relaunch();
  };

  const handleSetTransparent = (transparent: boolean) => {
    setConfirmModalState({
      confirmText: 'Toggle Transparency',
      confirmVariant: 'primary',
      isOpen: true,
      message: `Are you sure you want to ${transparent ? 'enable' : 'disable'} window transparency effects?\n\n${
        transparent ? 'These effects may reduce application performance.' : ''
      }\n\nThe application will relaunch to make this change.`,
      onConfirm: () => executeSetTransparent(transparent),
      title: 'Confirm Window Transparency',
    });
  };

  const executeClearCache = async () => {
    setIsClearingCache(true);
    setCacheClearMessage('Clearing thumbnail cache...');
    try {
      await invoke(Invokes.ClearThumbnailCache);
      setCacheClearMessage('Thumbnail cache cleared successfully.');
      onLibraryRefresh();
    } catch (err) {
      console.error('Failed to clear thumbnail cache:', err);
      setCacheClearMessage(`Error: ${err}`);
    } finally {
      setTimeout(() => {
        setIsClearingCache(false);
        setCacheClearMessage('');
      }, EXECUTE_TIMEOUT);
    }
  };

  const handleClearCache = () => {
    setConfirmModalState({
      confirmText: 'Clear Cache',
      confirmVariant: 'destructive',
      isOpen: true,
      message:
        'Are you sure you want to clear the thumbnail cache?\n\nAll thumbnails will need to be regenerated, which may be slow for large folders.',
      onConfirm: executeClearCache,
      title: 'Confirm Cache Deletion',
    });
  };

  const handleTestConnection = async () => {
    if (!comfyUiAddress) {
      return;
    }
    setTestStatus({ testing: true, message: 'Testing...', success: null });
    try {
      await invoke(Invokes.TestComfyuiConnection, { address: comfyUiAddress });
      setTestStatus({ testing: false, message: 'Connection successful!', success: true });
    } catch (err) {
      setTestStatus({ testing: false, message: `Connection failed.`, success: false });
      console.error('ComfyUI connection test failed:', err);
    } finally {
      setTimeout(() => setTestStatus({ testing: false, message: '', success: null }), EXECUTE_TIMEOUT);
    }
  };

  const closeConfirmModal = () => {
    setConfirmModalState({ ...confirmModalState, isOpen: false });
  };

  return (
    <>
      <ConfirmModal {...confirmModalState} onClose={closeConfirmModal} />
      <div className="flex flex-col h-full w-full text-text-primary">
        <header className="flex-shrink-0 flex items-center mb-6">
          <Button
            className="mr-4 hover:bg-surface text-text-primary rounded-full"
            onClick={onBack}
            size="icon"
            variant="ghost"
          >
            <ArrowLeft />
          </Button>
          <h1 className="text-3xl font-bold text-accent">Settings</h1>
        </header>
        <div className="flex-1 overflow-y-auto pr-2 -mr-2 space-y-8 custom-scrollbar">
          <div className="p-6 bg-surface rounded-xl shadow-md">
            <h2 className="text-xl font-semibold mb-6 text-accent">General Settings</h2>
            <div className="space-y-6">
              <SettingItem label="Theme" description="Change the look and feel of the application.">
                <Dropdown
                  onChange={(value: ThemeProps) => onSettingsChange({ ...appSettings, theme: value })}
                  options={THEMES.map((theme: ThemeProps) => ({ value: theme.id, label: theme.name }))}
                  value={appSettings?.theme || DEFAULT_THEME_ID}
                />
              </SettingItem>

              <SettingItem
                description="Dynamically changes editor colors based on the current image."
                label="Editor Theme"
              >
                <Switch
                  checked={appSettings?.adaptiveEditorTheme ?? false}
                  id="adaptive-theme-toggle"
                  label="Adaptive Editor Theme"
                  onChange={(checked) => onSettingsChange({ ...appSettings, adaptiveEditorTheme: checked })}
                />
              </SettingItem>

              <SettingItem
                description="Enables automatic image tagging using an AI (CLIP) model. This will download an additional model file (~600MB). Tags are used for searching a folder."
                label="AI Tagging"
              >
                <Switch
                  checked={appSettings?.enableAiTagging ?? false}
                  id="ai-tagging-toggle"
                  label="Enable Automatic AI Tagging"
                  onChange={(checked) => onSettingsChange({ ...appSettings, enableAiTagging: checked })}
                />
              </SettingItem>

              <SettingItem
                description="Enables or disables transparency effects for the application window. Relaunch required."
                label="Window Effects"
              >
                <Switch
                  checked={appSettings?.transparent ?? true}
                  id="window-effects-toggle"
                  label="Transparency"
                  onChange={handleSetTransparent}
                />
              </SettingItem>

              <SettingItem
                description="Higher resolutions provide a sharper preview but may impact performance on less powerful systems."
                label="Preview Resolution"
              >
                <Dropdown
                  onChange={(value: number) => onSettingsChange({ ...appSettings, editorPreviewResolution: value })}
                  options={resolutions}
                  value={appSettings?.editorPreviewResolution || 1920}
                />
              </SettingItem>
            </div>
          </div>

          <div className="p-6 bg-surface rounded-xl shadow-md">
            <h2 className="text-xl font-semibold mb-6 text-accent">ComfyUI</h2>
            <div className="space-y-6">
              <SettingItem
                label="ComfyUI Address"
                description="Enter the address and port of your running ComfyUI instance. Required for generative AI features."
              >
                <div className="flex items-center gap-2">
                  <Input
                    className="flex-grow"
                    id="comfyui-address"
                    onBlur={() => onSettingsChange({ ...appSettings, comfyuiAddress: comfyUiAddress })}
                    onChange={(e: any) => setComfyUiAddress(e.target.value)}
                    onKeyDown={(e: any) => e.stopPropagation()}
                    placeholder="127.0.0.1:8188"
                    type="text"
                    value={comfyUiAddress}
                  />
                  <Button
                    className="w-32"
                    disabled={testStatus.testing || !comfyUiAddress}
                    onClick={handleTestConnection}
                  >
                    {testStatus.testing ? 'Testing...' : 'Test'}
                  </Button>
                </div>
                {testStatus.message && (
                  <p
                    className={`text-sm mt-2 flex items-center gap-2 ${
                      testStatus.success ? 'text-green-400' : 'text-red-400'
                    }`}
                  >
                    {testStatus.success === true && <Wifi size={16} />}
                    {testStatus.success === false && <WifiOff size={16} />}
                    {testStatus.message}
                  </p>
                )}
              </SettingItem>

              <SettingItem
                label="Custom Workflow File"
                description="Select a custom ComfyUI API format JSON file. If not set, the built-in workflow will be used."
              >
                <div className="flex items-center gap-2">
                  <Input
                    readOnly
                    value={comfyConfig.workflowPath || 'Using built-in workflow'}
                    className="flex-grow"
                  />
                  <Button onClick={handleSelectWorkflowFile}>Select</Button>
                  <Button variant="secondary" onClick={resetToDefaults}>
                    Reset
                  </Button>
                </div>
              </SettingItem>

              <div
                className="flex items-center justify-between cursor-pointer"
                onClick={() => setIsConfigExpanded(!isConfigExpanded)}
              >
                <h3 className="font-medium text-text-primary">Advanced Configuration</h3>
                <ChevronDown
                  className={clsx('transition-transform', isConfigExpanded && 'rotate-180')}
                  size={20}
                />
              </div>

              <AnimatePresence>
                {isConfigExpanded && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.3, ease: 'easeInOut' }}
                    className="overflow-hidden"
                  >
                    <div className="pt-4 border-t border-border-color space-y-6">
                      <div className="text-xs text-text-secondary space-y-2">
                        <p className="font-semibold">How to find Node IDs:</p>
                        <ol className="list-decimal list-inside space-y-1 pl-2">
                          <li>
                            In ComfyUI, build your workflow, then click{' '}
                            <code className="bg-bg-primary px-1 rounded text-text-primary">Save (API Format)</code>.
                          </li>
                          <li>Open the saved JSON file in a text editor. Each node has a number ID.</li>
                          <li>Find the IDs for the required nodes and enter them below.</li>
                        </ol>
                      </div>

                      {!comfyConfig.workflowPath && (
                        <div className="p-3 bg-bg-primary rounded-lg border border-border-color text-xs text-text-secondary space-y-2">
                          <p className="font-semibold text-text-primary">Default Workflow Requirements:</p>
                          <p>
                            The built-in workflow handles resolution scaling automatically and requires the following
                            custom nodes. Please install them using the ComfyUI Manager.
                          </p>
                          <ul className="list-disc list-inside space-y-1 pl-2">
                            <li>
                              <ExternalLink href="https://github.com/BadCafeCode/masquerade-nodes-comfyui">
                                Masquerade Nodes
                              </ExternalLink>
                            </li>
                            <li>
                              <ExternalLink href="https://github.com/kijai/ComfyUI-KJNodes">KJNodes</ExternalLink>
                            </li>
                          </ul>
                        </div>
                      )}

                      <h4 className="text-base font-semibold text-accent-secondary pt-2">Node Configuration</h4>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-4">
                        <SettingItem label="Source Image Node ID">
                          <Input
                            type="number"
                            value={comfyConfig.sourceImageNodeId || ''}
                            onChange={(e) => handleConfigChange('sourceImageNodeId', e.target.value)}
                          />
                        </SettingItem>
                        <SettingItem label="Mask Image Node ID">
                          <Input
                            type="number"
                            value={comfyConfig.maskImageNodeId || ''}
                            onChange={(e) => handleConfigChange('maskImageNodeId', e.target.value)}
                          />
                        </SettingItem>
                        <SettingItem label="Text Prompt Node ID">
                          <Input
                            type="number"
                            value={comfyConfig.textPromptNodeId || ''}
                            onChange={(e) => handleConfigChange('textPromptNodeId', e.target.value)}
                          />
                        </SettingItem>
                        <SettingItem label="Final Output Node ID">
                          <Input
                            type="number"
                            value={comfyConfig.finalOutputNodeId || ''}
                            onChange={(e) => handleConfigChange('finalOutputNodeId', e.target.value)}
                          />
                        </SettingItem>
                        <SettingItem label="Sampler Node ID">
                          <Input
                            type="number"
                            value={comfyConfig.samplerNodeId || ''}
                            onChange={(e) => handleConfigChange('samplerNodeId', e.target.value)}
                          />
                        </SettingItem>
                        <SettingItem label="Sampler Steps">
                          <Input
                            type="number"
                            value={comfyConfig.samplerSteps || 10}
                            onChange={(e) => handleConfigChange('samplerSteps', parseInt(e.target.value, 10) || 0)}
                          />
                        </SettingItem>
                        <SettingItem label="Inpaint Resolution">
                          <Input
                            type="number"
                            value={comfyConfig.inpaintResolution || 1536}
                            onChange={(e) =>
                              handleConfigChange('inpaintResolution', parseInt(e.target.value, 10) || 0)
                            }
                          />
                        </SettingItem>
                      </div>

                      <h4 className="text-base font-semibold text-accent-secondary pt-2">Model Configuration</h4>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-4">
                        <SettingItem label="Checkpoint Node ID">
                          <Input
                            type="number"
                            value={Object.keys(comfyConfig.modelCheckpoints || {})[0] || ''}
                            onChange={(e) =>
                              handleConfigChange('modelCheckpoints', {
                                [e.target.value]: Object.values(comfyConfig.modelCheckpoints || {})[0] || '',
                              })
                            }
                          />
                        </SettingItem>
                        <SettingItem
                          label="Checkpoint Name"
                          description={
                            !comfyConfig.workflowPath && (
                              <>
                                Recommended:{' '}
                                <ExternalLink href="https://civitai.com/models/139562/realvisxl-v50">
                                  RealVisXL V5.0
                                </ExternalLink>
                              </>
                            )
                          }
                        >
                          <Input
                            value={Object.values(comfyConfig.modelCheckpoints || {})[0] || ''}
                            onChange={(e) =>
                              handleConfigChange('modelCheckpoints', {
                                [Object.keys(comfyConfig.modelCheckpoints || {})[0] || '']: e.target.value,
                              })
                            }
                          />
                        </SettingItem>
                        <SettingItem label="VAE Node ID">
                          <Input
                            type="number"
                            value={Object.keys(comfyConfig.vaeLoaders || {})[0] || ''}
                            onChange={(e) =>
                              handleConfigChange('vaeLoaders', {
                                [e.target.value]: Object.values(comfyConfig.vaeLoaders || {})[0] || '',
                              })
                            }
                          />
                        </SettingItem>
                        <SettingItem
                          label="VAE Name"
                          description={
                            !comfyConfig.workflowPath && (
                              <>
                                Recommended:{' '}
                                <ExternalLink href="https://huggingface.co/stabilityai/sdxl-vae/blob/main/sdxl_vae.safetensors">
                                  SDXL VAE
                                </ExternalLink>
                              </>
                            )
                          }
                        >
                          <Input
                            value={Object.values(comfyConfig.vaeLoaders || {})[0] || ''}
                            onChange={(e) =>
                              handleConfigChange('vaeLoaders', {
                                [Object.keys(comfyConfig.vaeLoaders || {})[0] || '']: e.target.value,
                              })
                            }
                          />
                        </SettingItem>
                        <SettingItem label="ControlNet Node ID">
                          <Input
                            type="number"
                            value={Object.keys(comfyConfig.controlnetLoaders || {})[0] || ''}
                            onChange={(e) =>
                              handleConfigChange('controlnetLoaders', {
                                [e.target.value]: Object.values(comfyConfig.controlnetLoaders || {})[0] || '',
                              })
                            }
                          />
                        </SettingItem>
                        <SettingItem
                          label="ControlNet Name"
                          description={
                            !comfyConfig.workflowPath && (
                              <>
                                Recommended:{' '}
                                <ExternalLink href="https://huggingface.co/xinsir/controlnet-union-sdxl-1.0/blob/main/diffusion_pytorch_model_promax.safetensors">
                                  Promax ControlNet
                                </ExternalLink>
                              </>
                            )
                          }
                        >
                          <Input
                            value={Object.values(comfyConfig.controlnetLoaders || {})[0] || ''}
                            onChange={(e) =>
                              handleConfigChange('controlnetLoaders', {
                                [Object.keys(comfyConfig.controlnetLoaders || {})[0] || '']: e.target.value,
                              })
                            }
                          />
                        </SettingItem>
                      </div>

                      <div className="flex justify-end items-center gap-4 pt-4">
                        {saveStatus.message && (
                          <p className="text-sm text-green-400 flex items-center gap-2">
                            <Check size={16} />
                            {saveStatus.message}
                          </p>
                        )}
                        <Button onClick={handleSaveComfyConfig} disabled={saveStatus.saving} className="w-48">
                          {saveStatus.saving ? (
                            'Saving...'
                          ) : (
                            <>
                              <Save size={16} className="mr-2" />
                              Save Config
                            </>
                          )}
                        </Button>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          <div className="p-6 bg-surface rounded-xl shadow-md">
            <h2 className="text-xl font-semibold mb-6 text-accent">Data Management</h2>
            <div className="space-y-6">
              <DataActionItem
                buttonAction={handleClearSidecars}
                buttonText="Delete All Edits in Folder"
                description={
                  <>
                    This will delete all <code className="bg-bg-primary px-1 rounded text-text-primary">.rrdata</code>{' '}
                    files (containing your edits) within the current root folder:
                    <span className="block font-mono text-xs bg-bg-primary p-2 rounded mt-2 break-all border border-border-color">
                      {effectiveRootPath || 'No folder selected'}
                    </span>
                  </>
                }
                disabled={!effectiveRootPath}
                icon={<Trash2 size={16} className="mr-2" />}
                isProcessing={isClearing}
                message={clearMessage}
                title="Clear All Sidecar Files"
              />

              <DataActionItem
                buttonAction={handleClearTags}
                buttonText="Clear All Tags"
                description="This will remove all AI-generated tags from your .rrdata files in the current root folder."
                disabled={!effectiveRootPath}
                icon={<Trash2 size={16} className="mr-2" />}
                isProcessing={isClearingTags}
                message={tagsClearMessage}
                title="Clear All Tags"
              />

              <DataActionItem
                buttonAction={handleClearCache}
                buttonText="Clear Thumbnail Cache"
                description="This will delete all cached thumbnail images. They will be regenerated automatically as you browse your library."
                icon={<Trash2 size={16} className="mr-2" />}
                isProcessing={isClearingCache}
                message={cacheClearMessage}
                title="Clear Thumbnail Cache"
              />
            </div>
          </div>

          <div className="p-6 bg-surface rounded-xl shadow-md">
            <h2 className="text-xl font-semibold mb-6 text-accent">Keyboard Shortcuts</h2>
            <div className="space-y-4">
              <div>
                <h3 className="text-lg font-semibold pt-3 pb-2 text-accent">General</h3>
                <div className="divide-y divide-border-color">
                  <KeybindItem keys={['Ctrl/Cmd', '+', 'C']} description="Copy selected adjustments" />
                  <KeybindItem keys={['Ctrl/Cmd', '+', 'V']} description="Paste copied adjustments" />
                  <KeybindItem keys={['Ctrl/Cmd', '+', 'Shift', '+', 'C']} description="Copy selected file(s)" />
                  <KeybindItem
                    description="Paste file(s) to current folder"
                    keys={['Ctrl/Cmd', '+', 'Shift', '+', 'V']}
                  />
                  <KeybindItem keys={['Ctrl/Cmd', '+', 'A']} description="Select all images" />
                  <KeybindItem keys={['Delete']} description="Delete selected file(s)" />
                  <KeybindItem keys={['0-5']} description="Set star rating for selected image(s)" />
                  <KeybindItem keys={['Shift', '+', '0-5']} description="Set color label for selected image(s)" />
                  <KeybindItem keys={['↑', '↓', '←', '→']} description="Navigate images in library" />
                </div>
              </div>
              <div>
                <h3 className="text-lg font-semibold pt-3 pb-2 text-accent">Editor</h3>
                <div className="divide-y divide-border-color">
                  <KeybindItem keys={['Esc']} description="Deselect mask, exit crop/fullscreen/editor" />
                  <KeybindItem keys={['Ctrl/Cmd', '+', 'Z']} description="Undo adjustment" />
                  <KeybindItem keys={['Ctrl/Cmd', '+', 'Y']} description="Redo adjustment" />
                  <KeybindItem keys={['Delete']} description="Delete selected mask/patch or image" />
                  <KeybindItem keys={['Space']} description="Cycle zoom (Fit, 2x Fit, 100%)" />
                  <KeybindItem keys={['←', '→']} description="Previous / Next image" />
                  <KeybindItem keys={['↑', '↓']} description="Zoom in / Zoom out (by step)" />
                  <KeybindItem keys={['Ctrl/Cmd', '+', '+']} description="Zoom in" />
                  <KeybindItem keys={['Ctrl/Cmd', '+', '-']} description="Zoom out" />
                  <KeybindItem keys={['Ctrl/Cmd', '+', '0']} description="Zoom to fit" />
                  <KeybindItem keys={['Ctrl/Cmd', '+', '1']} description="Zoom to 100%" />
                  <KeybindItem keys={['F']} description="Toggle fullscreen" />
                  <KeybindItem keys={['B']} description="Show original (before/after)" />
                  <KeybindItem keys={['D']} description="Toggle Adjustments panel" />
                  <KeybindItem keys={['R']} description="Toggle Crop panel" />
                  <KeybindItem keys={['M']} description="Toggle Masks panel" />
                  <KeybindItem keys={['K']} description="Toggle AI panel" />
                  <KeybindItem keys={['P']} description="Toggle Presets panel" />
                  <KeybindItem keys={['I']} description="Toggle Metadata panel" />
                  <KeybindItem keys={['W']} description="Toggle Waveform display" />
                  <KeybindItem keys={['E']} description="Toggle Export panel" />
                </div>
              </div>
            </div>
          </div>

          <div className="p-6 bg-surface rounded-xl shadow-md">
            <h2 className="text-xl font-semibold mb-4 text-accent">Information</h2>
            {appSettings?.lastRootPath ? (
              <div className="mt-4">
                <h3 className="font-medium text-text-primary mb-2">Last Used Folder</h3>
                <p className="text-sm text-text-secondary bg-bg-primary p-3 rounded-md font-mono break-all border border-border-color">
                  {appSettings.lastRootPath}
                </p>
              </div>
            ) : (
              <p className="text-sm text-text-secondary">No folder has been opened yet.</p>
            )}
          </div>
        </div>
      </div>
    </>
  );
}