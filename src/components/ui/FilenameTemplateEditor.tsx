import { useRef, useState } from 'react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import Text from './Text';
import { TextVariants } from '../../types/typography';
import { Invokes } from './AppProperties';
import NamedPresetBar from '../panel/right/NamedPresetBar';
import { useFilenameTemplates } from '../../hooks/useFilenameTemplates';
import {
  FILENAME_TOKEN_GROUPS,
  TemplateError,
  createFilenameTemplate,
  isFilenameTemplateDirty,
  sanitizeFilenameTemplates,
  usesCustomText,
  withTemplate,
} from '../../utils/filenameTemplates';

interface FilenameTemplateEditorProps {
  label: string;
  template: string;
  onTemplateChange(template: string): void;
  customText: string;
  onCustomTextChange(text: string): void;
  /** The template's problems, from a preview. */
  errors?: Array<TemplateError>;
  /** Group labels above their chips, for the narrow Export panel. */
  isNarrow?: boolean;
  autoFocus?: boolean;
  disabled?: boolean;
}

/**
 * The file-name template editor of rename, export and import (Lightroom's Filename Template
 * Editor): saved templates, the template field with its errors, grouped token chips, and the
 * Custom Text when the template uses `{text}`.
 */
export default function FilenameTemplateEditor({
  label,
  template,
  onTemplateChange,
  customText,
  onCustomTextChange,
  errors,
  isNarrow = false,
  autoFocus = false,
  disabled = false,
}: FilenameTemplateEditorProps) {
  const { t } = useTranslation();
  const { templates, saveTemplates } = useFilenameTemplates();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const trimmed = template.trim();
  // The template picked from the bar (shown as changed once edited), else a saved template
  // whose text the field holds, e.g. the last one used.
  const selected =
    templates.find((saved) => saved.id === selectedId) ?? templates.find((saved) => saved.template === trimmed) ?? null;

  const insertToken = (token: string) => {
    const input = inputRef.current;
    if (!input) return;
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? start;
    onTemplateChange(input.value.substring(0, start) + token + input.value.substring(end));
    setTimeout(() => {
      input.focus();
      input.setSelectionRange(start + token.length, start + token.length);
    }, 0);
  };

  const fieldClass =
    'w-full bg-bg-primary border border-surface rounded-md p-2 text-sm text-text-primary focus:ring-accent focus:border-accent disabled:opacity-50';

  return (
    <div className={clsx('space-y-4', disabled && 'pointer-events-none opacity-60')}>
      <NamedPresetBar
        create={(name) => createFilenameTemplate(name, trimmed, customText)}
        exportCommand={Invokes.ExportFilenameTemplates}
        importCommand={Invokes.ImportFilenameTemplates}
        isDirty={!!selected && isFilenameTemplateDirty(selected, trimmed, customText)}
        labels={{
          placeholder: t('modals.renameFile.templates.placeholder'),
          save: t('modals.renameFile.templates.save'),
          saveTitle: t('modals.renameFile.templates.saveTitle'),
          renameTitle: t('modals.renameFile.templates.renameTitle'),
          deleteTitle: t('modals.renameFile.templates.deleteTitle'),
          deleteMessage: (name) => t('modals.renameFile.templates.deleteMessage', { name }),
          nameConflict: t('modals.renameFile.templates.nameConflict'),
          fileName: t('modals.renameFile.templates.fileName'),
          importNone: t('modals.renameFile.templates.importNone'),
          imported: (count) => t('modals.renameFile.templates.imported', { count }),
        }}
        onLoad={(loaded) => {
          onTemplateChange(loaded.template);
          if (loaded.text !== undefined) onCustomTextChange(loaded.text);
          setSelectedId(loaded.id);
        }}
        onPresetsChange={saveTemplates}
        onSaved={(saved) => setSelectedId(saved.id)}
        presets={templates}
        sanitize={sanitizeFilenameTemplates}
        selected={selected}
        update={(preset) => withTemplate(preset, trimmed, customText)}
      />

      <div>
        <Text variant={TextVariants.heading} className="block mb-2">
          {label}
        </Text>
        <input
          autoFocus={autoFocus}
          className={clsx(fieldClass, 'font-mono')}
          disabled={disabled}
          onChange={(e) => onTemplateChange(e.target.value)}
          ref={inputRef}
          spellCheck={false}
          type="text"
          value={template}
        />
        {errors?.map((error) => (
          <Text key={`${error.position}-${error.kind}`} variant={TextVariants.small} className="mt-1 text-red-400">
            {t(`modals.renameFile.errors.${error.kind}`, { text: error.text, column: error.position + 1 })}
          </Text>
        ))}
      </div>

      <div className="space-y-2">
        {FILENAME_TOKEN_GROUPS.map((group) => (
          <div className={clsx('flex gap-2', isNarrow ? 'flex-col gap-1' : 'items-start')} key={group.id}>
            <Text variant={TextVariants.small} className={clsx('shrink-0', !isNarrow && 'w-20 pt-1')}>
              {t(`modals.renameFile.groups.${group.id}`)}
            </Text>
            <div className="flex flex-wrap gap-1.5">
              {group.tokens.map((token: string) => (
                <button
                  className="px-2 py-1 bg-bg-primary text-text-secondary text-xs font-mono rounded-md hover:bg-card-active transition-colors"
                  disabled={disabled}
                  key={token}
                  onClick={() => insertToken(token)}
                  type="button"
                >
                  {token}
                </button>
              ))}
            </div>
          </div>
        ))}
        <Text variant={TextVariants.small}>{t('modals.renameFile.filtersHint')}</Text>
      </div>

      {usesCustomText(trimmed) && (
        <div>
          <Text variant={TextVariants.heading} className="block mb-2">
            {t('modals.renameFile.customText')}
          </Text>
          <input
            className={fieldClass}
            disabled={disabled}
            onChange={(e) => onCustomTextChange(e.target.value)}
            type="text"
            value={customText}
          />
        </div>
      )}
    </div>
  );
}
