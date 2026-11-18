import { useTranslation } from 'react-i18next';
import Text from '../../ui/Text';
import SettingsPage, { SettingsPageProps } from './SettingsPage';

/** The projects ThisIsRAW builds on, each with its `settings.thanks.list` key. */
const CREDITS = [
  { name: 'rawler', url: 'https://github.com/dnglab/dnglab/tree/main/rawler', key: 'rawler' },
  { name: 'lensfun', url: 'https://lensfun.github.io/', key: 'lensfun' },
  { name: 'NegPy', url: 'https://github.com/marcinz606/NegPy', key: 'negpy' },
  { name: 'LaMa', url: 'https://github.com/advimman/lama', key: 'lama' },
  { name: 'SAM 2', url: 'https://github.com/facebookresearch/sam2', key: 'sam2' },
  { name: 'EfficientSAM3', url: 'https://github.com/SimonZeng7108/efficientsam3', key: 'efficientsam3' },
  { name: 'BiRefNet', url: 'https://github.com/ZhengPeng7/BiRefNet', key: 'birefnet' },
  { name: 'Depth Anything V2', url: 'https://github.com/DepthAnything/Depth-Anything-V2', key: 'depth' },
  { name: 'nind-denoise', url: 'https://github.com/trougnouf/nind-denoise', key: 'nind' },
  {
    name: '2xBHI_small_span_pretrain',
    url: 'https://github.com/Phhofm/models/releases/tag/2xBHI_small_span_pretrain',
    key: 'span',
  },
  { name: 'darktable & co.', url: 'https://github.com/darktable-org/darktable', key: 'darktable' },
] as const;

export default function AboutSettings({ query }: SettingsPageProps) {
  const { t } = useTranslation();

  return (
    <SettingsPage
      query={query}
      title={t('settings.categories.about')}
      sections={[
        {
          id: 'thanks',
          rows: [
            {
              id: 'thanks',
              label: t('settings.thanks.title'),
              description: t('settings.thanks.description'),
              details: (
                <Text as="ul" className="space-y-3 list-disc ml-5 pl-1">
                  {CREDITS.map(({ name, url, key }) => (
                    <li key={key}>
                      <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-semibold text-accent hover:underline"
                      >
                        {name}
                      </a>
                      : {t(`settings.thanks.list.${key}`)}
                    </li>
                  ))}
                  <li>
                    <span className="font-semibold text-accent">{t('settings.thanks.list.youLabel')}</span>:{' '}
                    {t('settings.thanks.list.you')}
                  </li>
                </Text>
              ),
            },
          ],
        },
      ]}
    />
  );
}
