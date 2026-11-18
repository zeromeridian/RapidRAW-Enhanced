import { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-shell';
import { Show, SignIn, useAuth, useClerk, useUser } from '@clerk/react';
import { Cpu, ExternalLink as ExternalLinkIcon, Server, Wifi, WifiOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import Button from '../../ui/Button';
import Input from '../../ui/Input';
import Text from '../../ui/Text';
import { Invokes } from '../../ui/AppProperties';
import { TextColors, TextVariants } from '../../../types/typography';
import SettingsPage, { SettingsPageProps } from './SettingsPage';
import { SegmentedSwitch, SegmentOption, SettingSwitch } from './SettingControls';
import { useSettingsContext } from './SettingsContext';

/** How long the connection test result stays on screen. */
const TEST_RESULT_MS = 3000;

type AiProvider = 'cpu' | 'ai-connector' | 'cloud';

interface TestStatus {
  message: string;
  success: boolean | null;
  testing: boolean;
}

const FeatureList = ({ items }: { items: string[] }) => (
  <Text as="ul" className="space-y-1 list-disc list-inside">
    {items.map((item) => (
      <li key={item}>{item}</li>
    ))}
  </Text>
);

const CloudDashboard = () => {
  const { user } = useUser();
  const { getToken } = useAuth();
  const { signOut } = useClerk();
  const [usage, setUsage] = useState<{ requests: number; limit: number; month: string } | null>(null);
  const { t } = useTranslation();

  useEffect(() => {
    const fetchUsage = async () => {
      try {
        const token = await getToken();
        if (!token) return;
        const res = await fetch('https://getrapidraw.com/api/usage', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          setUsage(await res.json());
        }
      } catch (e) {
        console.error('Failed to fetch cloud usage', e);
      }
    };
    fetchUsage();
  }, [getToken]);

  const isPro = user?.publicMetadata?.plan === 'pro';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between border-b border-border-color pb-4">
        <div>
          <Text variant={TextVariants.heading}>{user?.fullName || user?.primaryEmailAddress?.emailAddress}</Text>
          <Text variant={TextVariants.small} color={isPro ? TextColors.success : TextColors.error}>
            {isPro
              ? t('settings.processing.ai.cloud.signedIn.active')
              : t('settings.processing.ai.cloud.signedIn.inactive')}
          </Text>
        </div>
        <div className="flex gap-2">
          <Button
            variant="ghost"
            className="bg-transparent text-text-secondary hover:text-text-primary hover:bg-surface border-none shadow-none"
            onClick={() => open('https://www.getrapidraw.com/dashboard')}
          >
            {t('settings.processing.ai.cloud.signedIn.manage')} <ExternalLinkIcon size={14} className="ml-1" />
          </Button>
          <Button variant="ghost" onClick={() => signOut()}>
            {t('settings.processing.ai.cloud.signedIn.logout')}
          </Button>
        </div>
      </div>

      {isPro ? (
        <div className="bg-surface p-4 rounded-md">
          <div className="flex justify-between items-center mb-2">
            <Text variant={TextVariants.label}>{t('settings.processing.ai.cloud.signedIn.usage')}</Text>
            <Text variant={TextVariants.small}>
              {t('settings.processing.ai.cloud.signedIn.usageStats', {
                requests: usage?.requests ?? 0,
                limit: usage?.limit ?? 500,
              })}
            </Text>
          </div>
          <div className="w-full bg-bg-primary rounded-full h-2">
            <div
              className="bg-accent h-2 rounded-full transition-all duration-500"
              style={{ width: `${Math.min(100, ((usage?.requests ?? 0) / (usage?.limit ?? 500)) * 100)}%` }}
            />
          </div>
        </div>
      ) : (
        <div className="bg-red-900/10 border border-red-500/50 p-4 rounded-md text-center">
          <Text className="mb-3">{t('settings.processing.ai.cloud.signedOut.upgradeDesc')}</Text>
          <Button onClick={() => open('https://www.getrapidraw.com/cloud')}>
            {t('settings.processing.ai.cloud.signedOut.upgradeBtn')}
          </Button>
        </div>
      )}
    </div>
  );
};

const CloudAccount = () => {
  const { t } = useTranslation();
  return (
    <>
      <Show when="signed-in">
        <div className="p-6 bg-bg-primary rounded-xl border border-border-color shadow-inner">
          <CloudDashboard />
        </div>
      </Show>
      <Show when="signed-out">
        <div className="w-full max-w-md">
          <SignIn
            routing="hash"
            fallbackRedirectUrl="/"
            forceRedirectUrl="/"
            appearance={{
              variables: {
                colorBackground: 'transparent',
                colorInput: 'transparent',
                colorForeground: 'inherit',
                colorInputForeground: 'inherit',
                colorPrimaryForeground: 'inherit',
                colorBorder: 'transparent',
                colorShadow: 'none',
                colorNeutral: 'inherit',
              },
              elements: {
                rootBox: '',
                cardBox: '!shadow-none !m-0 !p-0 !rounded-none',
                card: '!bg-transparent !border-none !shadow-none !py-0 !px-1 !rounded-none',
                header: '!hidden',
                formFieldLabel: '!text-base !font-semibold !text-text-primary !block !mb-2',
                formFieldAction:
                  '!text-text-secondary hover:!text-text-primary !transition-colors !no-underline hover:!underline',
                formFieldInput:
                  '!bg-bg-primary !border !border-border-color !text-text-primary focus:!border-accent focus:!ring-1 focus:!ring-accent !rounded-md !px-3 !py-2',
                formButtonPrimary:
                  '!bg-accent !text-button-text hover:!bg-accent/90 !shadow-none !transition-colors !rounded-md !mt-4 !py-2',
                footer: '!bg-transparent !p-0 !mt-4 opacity-50 hover:opacity-100 transition-opacity',
                footerAction: '!hidden',
                identityPreview: '!bg-bg-primary !border !border-border-color !rounded-md !mb-4',
                identityPreviewText: '!text-text-primary !font-medium',
                identityPreviewEditButtonIcon: '!text-text-secondary hover:!text-text-primary !transition-colors',
              },
            }}
          />
          <div className="mt-6">
            <Text variant={TextVariants.small}>
              {t('settings.processing.ai.cloud.signedOut.noAccount')}{' '}
              <button
                onClick={() => open('https://www.getrapidraw.com/dashboard')}
                className="text-accent hover:underline focus:outline-none"
              >
                {t('settings.processing.ai.cloud.signedOut.signup')}
              </button>
            </Text>
          </div>
        </div>
      </Show>
    </>
  );
};

export default function AiSettings({ query }: SettingsPageProps) {
  const { t } = useTranslation();
  const { appSettings, osPlatform, updateSetting } = useSettingsContext();
  const aiProvider = (appSettings.aiProvider || 'cpu') as AiProvider;
  const [aiConnectorAddress, setAiConnectorAddress] = useState<string>(appSettings?.aiConnectorAddress || '');
  const [testStatus, setTestStatus] = useState<TestStatus>({ message: '', success: null, testing: false });

  useEffect(() => {
    setAiConnectorAddress(appSettings?.aiConnectorAddress || '');
  }, [appSettings?.aiConnectorAddress]);

  // The cloud provider is not offered yet; a setting that already names it still shows its page.
  const aiProviders = useMemo<SegmentOption<AiProvider>[]>(
    () => [
      { id: 'cpu', label: t('settings.processing.ai.providers.cpu'), icon: Cpu },
      { id: 'ai-connector', label: t('settings.processing.ai.providers.aiConnector'), icon: Server },
    ],
    [t],
  );

  const handleTestConnection = async () => {
    if (!aiConnectorAddress) return;
    setTestStatus({ testing: true, message: t('settings.processing.ai.connector.testing'), success: null });
    try {
      await invoke(Invokes.TestAIConnectorConnection, { address: aiConnectorAddress });
      setTestStatus({ testing: false, message: t('settings.processing.ai.connector.success'), success: true });
    } catch (err) {
      setTestStatus({ testing: false, message: t('settings.processing.ai.connector.failed'), success: false });
      console.error('AI Connector connection test failed:', err);
    } finally {
      setTimeout(() => setTestStatus({ testing: false, message: '', success: null }), TEST_RESULT_MS);
    }
  };

  const featureList = (provider: 'cpu' | 'connector' | 'cloud') => (
    <FeatureList items={([1, 2, 3] as const).map((index) => t(`settings.processing.ai.${provider}.feature${index}`))} />
  );

  return (
    <SettingsPage
      query={query}
      title={t('settings.categories.ai')}
      sections={[
        {
          id: 'generative-ai',
          title: t('settings.processing.ai.title'),
          intro: t('settings.processing.ai.description'),
          rows: [
            {
              id: 'ai-provider',
              label: t('settings.processing.ai.provider'),
              stacked: true,
              control: (
                <SegmentedSwitch
                  layoutId="ai-provider-switch-bubble"
                  onChange={(provider) => updateSetting('aiProvider', provider)}
                  options={aiProviders}
                  value={aiProvider}
                />
              ),
            },
            aiProvider === 'cpu' && {
              id: 'ai-provider-cpu',
              label: t('settings.processing.ai.cpu.title'),
              description: t('settings.processing.ai.cpu.description'),
              details: featureList('cpu'),
            },
            aiProvider === 'cpu' &&
              osPlatform === 'macos' && {
                id: 'ai-gpu-acceleration',
                label: t('settings.processing.ai.cpu.gpuAcceleration'),
                description: t('settings.processing.ai.cpu.gpuAccelerationDesc'),
                control: (
                  <SettingSwitch
                    checked={appSettings?.aiGpuAcceleration ?? true}
                    id="ai-gpu-acceleration-toggle"
                    label={t('settings.processing.ai.cpu.gpuAccelerationLabel')}
                    onChange={(checked) => updateSetting('aiGpuAcceleration', checked)}
                  />
                ),
              },
            aiProvider === 'ai-connector' && {
              id: 'ai-provider-connector',
              label: t('settings.processing.ai.connector.title'),
              description: t('settings.processing.ai.connector.description'),
              details: featureList('connector'),
            },
            aiProvider === 'ai-connector' && {
              id: 'ai-connector-address',
              label: t('settings.processing.ai.connector.address'),
              description: t('settings.processing.ai.connector.addressDesc'),
              stacked: true,
              control: (
                <div className="flex items-center gap-2">
                  <Input
                    className="grow"
                    id="ai-connector-address"
                    onBlur={() => updateSetting('aiConnectorAddress', aiConnectorAddress)}
                    onChange={(e) => setAiConnectorAddress(e.target.value)}
                    onKeyDown={(e) => e.stopPropagation()}
                    placeholder="127.0.0.1:8188"
                    type="text"
                    value={aiConnectorAddress}
                    bgClassName="bg-bg-primary"
                  />
                  <Button
                    className="w-32"
                    disabled={testStatus.testing || !aiConnectorAddress}
                    onClick={handleTestConnection}
                  >
                    {testStatus.testing
                      ? t('settings.processing.ai.connector.testing')
                      : t('settings.processing.ai.connector.test')}
                  </Button>
                </div>
              ),
              details: testStatus.message && (
                <Text
                  color={testStatus.success ? TextColors.success : TextColors.error}
                  className="flex items-center gap-2"
                >
                  {testStatus.success === true && <Wifi size={16} />}
                  {testStatus.success === false && <WifiOff size={16} />}
                  {testStatus.message}
                </Text>
              ),
            },
            aiProvider === 'cloud' && {
              id: 'ai-provider-cloud',
              label: t('settings.processing.ai.cloud.title'),
              description: t('settings.processing.ai.cloud.description'),
              details: (
                <div className="space-y-6">
                  {featureList('cloud')}
                  <CloudAccount />
                </div>
              ),
            },
          ],
        },
      ]}
    />
  );
}
