import { useCallback, useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';
import { Invokes } from '../components/ui/AppProperties';
import { useSettingsStore } from '../store/useSettingsStore';
import {
  FilenameTemplate,
  TemplateError,
  filenameTemplatesFromSettings,
  normalizeCustomTexts,
} from '../utils/filenameTemplates';

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

  /** The Custom Texts for `template` until the user types: a saved template's own, else the last ones used. */
  const defaultCustomTexts = useCallback(
    (template: string) =>
      normalizeCustomTexts(
        templates.find((saved) => saved.template === template.trim())?.texts ?? appSettings?.filenameCustomTexts,
      ),
    [templates, appSettings?.filenameCustomTexts],
  );

  /** Keeps the Custom Texts just used (rename, export, import) for the next time. */
  const rememberCustomTexts = useCallback(
    (texts: Array<string> | null) => {
      if (!texts || !appSettings) return;
      if (JSON.stringify(texts) === JSON.stringify(normalizeCustomTexts(appSettings.filenameCustomTexts))) return;
      void handleSettingsChange({ ...appSettings, filenameCustomTexts: texts });
    },
    [appSettings, handleSettingsChange],
  );

  return { templates, saveTemplates, defaultCustomTexts, rememberCustomTexts };
}

/** `naming::FilenameTemplatePreview`. */
export interface FilenameTemplatePreview {
  stem: string;
  errors: Array<TemplateError>;
}

/** The stem `template` gives `path` and the template's problems, checked shortly after typing stops. */
export function useFilenameTemplatePreview(path: string | null, template: string, texts: Array<string> | null) {
  const [preview, setPreview] = useState<FilenameTemplatePreview | null>(null);
  // Compared by value: callers build a new array on every render.
  const textsKey = JSON.stringify(texts);
  useEffect(() => {
    if (!template.trim()) {
      setPreview(null);
      return;
    }
    let isCurrent = true;
    const timer = setTimeout(() => {
      invoke<FilenameTemplatePreview>(Invokes.PreviewFilenameTemplate, {
        path,
        template: template.trim(),
        texts: JSON.parse(textsKey),
      })
        .then((result) => isCurrent && setPreview(result))
        .catch(() => isCurrent && setPreview(null));
    }, TEMPLATE_PREVIEW_DELAY_MS);
    return () => {
      isCurrent = false;
      clearTimeout(timer);
    };
  }, [path, template, textsKey]);
  return preview;
}
