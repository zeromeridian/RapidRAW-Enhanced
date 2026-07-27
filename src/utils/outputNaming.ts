import { AppSettings } from '../components/ui/AppProperties';

const INVALID_FILENAME_CHARACTERS = /[<>:"/\\|?*&%#\u0000-\u001f]/g;

export const sanitizeFilenameSuffix = (suffix: string | undefined): string =>
  (suffix || '').trim().replace(INVALID_FILENAME_CHARACTERS, '');

export const getEnabledCopySuffix = (settings: AppSettings | null | undefined): string | null => {
  if (!settings?.copyNameSuffixEnabled) return null;
  return sanitizeFilenameSuffix(settings.copyNameSuffix) || null;
};

export const getEnabledExportSuffix = (settings: AppSettings | null | undefined): string | null => {
  if (!settings?.exportFileSuffixEnabled) return null;
  return sanitizeFilenameSuffix(settings.exportFileSuffix) || null;
};

export const getDisplayFilename = (path: string): { baseName: string; isVirtualCopy: boolean; vcId: string | null } => {
  const fullFileName = path.split(/[\\/]/).pop() || '';
  const [physicalName, virtualQuery] = fullFileName.split('?vc=');
  if (!virtualQuery) {
    return { baseName: physicalName, isVirtualCopy: false, vcId: null };
  }

  const [vcId, copyName] = virtualQuery.split('&name=', 2);
  if (!copyName) {
    return { baseName: physicalName, isVirtualCopy: true, vcId };
  }

  const extensionIndex = physicalName.lastIndexOf('.');
  const stem = extensionIndex > 0 ? physicalName.slice(0, extensionIndex) : physicalName;
  const extension = extensionIndex > 0 ? physicalName.slice(extensionIndex) : '';
  return {
    baseName: `${stem}${decodeURIComponent(copyName)}${extension}`,
    isVirtualCopy: true,
    vcId,
  };
};
