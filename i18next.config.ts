import { defineConfig } from 'i18next-cli';

export default defineConfig({
  locales: ['en'],
  extract: {
    input: ['src/**/*.{ts,tsx}'],
    output: 'src/i18n/locales/{{language}}.json',
    defaultNS: false,
    removeUnusedKeys: false,
    sort: true,
    defaultValue: '',
  },
  types: {
    input: ['src/i18n/locales/en.json'],
    output: 'src/@types/i18next.d.ts',
  },
});
