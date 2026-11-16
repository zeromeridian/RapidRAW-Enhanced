import { useCallback, useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';
import { Invokes } from '../components/ui/AppProperties';
import { useSettingsStore } from '../store/useSettingsStore';
import { FilenameTemplate, TemplateError, filenameTemplatesFromSettings } from '../utils/filenameTemplates';

/** How long a template check waits after the last keystroke. */
export const TEMPLATE_PREVIEW_DELAY_MS = 150;

/**
 * The saved file-name templates shared by rename, export and import (owner 2026-11-16), and
 * the Custom Text they start with.
 */
export function useFilenameTemplates() {
  const { t } = useTranslation();
  const appSettings = useSettingsStore((state) => state.appSettings);
  const handleSettingsChange = useSettingsStore((state) => state.handleSettingsChange);

  const templates = useMemo(
    () =>
      filenameTemplatesFromSettings(appSettings?.filenameTemplates, {
        filename: t('modals.renameFile.templates.starters.filename'),
        filenameEdited: t('modals.renameFile.templates.starters.filenameEdited'),
        customSequence: t('modals.renameFile.templates.starters.customSequence'),
        customNumber: t('modals.renameFile.templates.starters.customNumber'),
        dateFilename: t('modals.renameFile.templates.starters.dateFilename'),
        dateTimeCamera: t('modals.renameFile.templates.starters.dateTimeCamera'),
      }),
    [appSettings?.filenameTemplates, t],
  );

  const saveTemplates = useCallback(
    (next: Array<FilenameTemplate>) => {
      if (appSettings) void handleSettingsChange({ ...appSettings, filenameTemplates: next });
    },
    [appSettings, handleSettingsChange],
  );

  /** The Custom Text for `template` until the user types one: a saved template's own, else the last one used. */
  const defaultCustomText = useCallback(
    (template: string) =>
      templates.find((saved) => saved.template === template.trim())?.text ?? appSettings?.filenameCustomText ?? '',
    [templates, appSettings?.filenameCustomText],
  );

  /** Keeps the Custom Text just used (rename, export, import) for the next time. */
  const rememberCustomText = useCallback(
    (text: string | null) => {
      if (text !== null && appSettings && text !== appSettings.filenameCustomText) {
        void handleSettingsChange({ ...appSettings, filenameCustomText: text });
      }
    },
    [appSettings, handleSettingsChange],
  );

  return { templates, saveTemplates, defaultCustomText, rememberCustomText };
}

/** `naming::FilenameTemplatePreview`. */
export interface FilenameTemplatePreview {
  stem: string;
  errors: Array<TemplateError>;
}

/** The stem `template` gives `path` and the template's problems, checked shortly after typing stops. */
export function useFilenameTemplatePreview(path: string | null, template: string, text: string | null) {
  const [preview, setPreview] = useState<FilenameTemplatePreview | null>(null);
  useEffect(() => {
    if (!template.trim()) {
      setPreview(null);
      return;
    }
    let isCurrent = true;
    const timer = setTimeout(() => {
      invoke<FilenameTemplatePreview>(Invokes.PreviewFilenameTemplate, { path, template: template.trim(), text })
        .then((result) => isCurrent && setPreview(result))
        .catch(() => isCurrent && setPreview(null));
    }, TEMPLATE_PREVIEW_DELAY_MS);
    return () => {
      isCurrent = false;
      clearTimeout(timer);
    };
  }, [path, template, text]);
  return preview;
}
