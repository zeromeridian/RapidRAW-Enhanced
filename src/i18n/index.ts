import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import en from './locales/en.json';

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    // You can add 'de' here later: de: { translation: de }
  },
  lng: 'en',
  fallbackLng: 'en',
  interpolation: {
    escapeValue: false,
  },
});

export default i18n;
