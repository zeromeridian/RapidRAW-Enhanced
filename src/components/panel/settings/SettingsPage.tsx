import { ReactNode } from 'react';
import clsx from 'clsx';
import Text from '../../ui/Text';
import { TextColors, TextVariants } from '../../../types/typography';

/** One setting: its label and description on the left, its control on the right. */
export interface SettingRowDef {
  id: string;
  label: string;
  description?: string;
  control?: ReactNode;
  /** Shown under the row at full width: lists, folder paths, status messages. */
  details?: ReactNode;
  /** Puts the control under the label at full width, for controls too wide for the right column. */
  stacked?: boolean;
  /** Indents a row that depends on the one above it. */
  indent?: boolean;
}

export interface SettingsSectionDef {
  id: string;
  title?: string;
  intro?: string;
  /** `false`, `null` and `undefined` leave out rows that do not apply. */
  rows: Array<SettingRowDef | false | null | undefined>;
}

export interface SettingsPageProps {
  /** The search text, trimmed and lower-cased; empty shows the whole page. */
  query: string;
}

interface SettingsPageViewProps extends SettingsPageProps {
  sections: SettingsSectionDef[];
  title: string;
}

const matches = (text: string | undefined, query: string) => !!text && text.toLocaleLowerCase().includes(query);

/** The sections to show: all of them, or, while searching, the rows whose page, section or text matches. */
const visibleSections = (title: string, sections: SettingsSectionDef[], query: string) => {
  const showAll = !query || matches(title, query);
  return sections
    .map((section) => {
      const rows = section.rows.filter((row): row is SettingRowDef => !!row);
      if (showAll || matches(section.title, query)) return { ...section, rows };
      return { ...section, rows: rows.filter((row) => matches(row.label, query) || matches(row.description, query)) };
    })
    .filter((section) => section.rows.length > 0);
};

const SettingRow = ({ row }: { row: SettingRowDef }) => (
  <div className={clsx('py-3', row.indent && 'ml-1 pl-4 border-l-2 border-border-color')}>
    <div className={clsx(row.stacked ? 'space-y-3' : 'flex items-center justify-between gap-6')}>
      <div className="min-w-0 flex-1">
        <Text variant={TextVariants.label} color={TextColors.primary} as="div">
          {row.label}
        </Text>
        {row.description && (
          <Text variant={TextVariants.small} className="mt-0.5">
            {row.description}
          </Text>
        )}
      </div>
      {row.control && (
        <div className={clsx(row.stacked ? 'w-full' : 'flex justify-end shrink-0 w-64 max-w-[50%]')}>{row.control}</div>
      )}
    </div>
    {row.details && <div className="mt-3">{row.details}</div>}
  </div>
);

/** A Settings page: its title, then one card per section; nothing while a search finds nothing on it. */
export default function SettingsPage({ query, sections, title }: SettingsPageViewProps) {
  const shown = visibleSections(title, sections, query);
  if (shown.length === 0) return null;

  return (
    <section className="space-y-4">
      <Text variant={TextVariants.title} color={TextColors.accent}>
        {title}
      </Text>
      {shown.map((section) => (
        <div className="px-6 py-4 bg-surface rounded-xl shadow-md" key={section.id}>
          {section.title && (
            <Text variant={TextVariants.heading} className="pt-2 mb-1">
              {section.title}
            </Text>
          )}
          {section.intro && <Text className="mb-1">{section.intro}</Text>}
          <div className="divide-y divide-border-color">
            {section.rows.map((row) => (
              <SettingRow key={row.id} row={row} />
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}
