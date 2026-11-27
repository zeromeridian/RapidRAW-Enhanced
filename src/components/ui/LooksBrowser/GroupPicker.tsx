import { useTranslation } from 'react-i18next';
import Dropdown from '../Dropdown';
import Text from '../Text';
import { TextVariants } from '../../../types/typography';

export interface BrowserGroup {
  id: string;
  name: string;
}

/** Where a new or saved item goes: no group, an existing group, or a group created with it. */
export type GroupChoice = { type: 'none' } | { type: 'existing'; id: string } | { type: 'new'; name: string };

export const NO_GROUP: GroupChoice = { type: 'none' };

/** A new group needs a name. */
export const isGroupChoiceValid = (choice: GroupChoice) => choice.type !== 'new' || choice.name.trim() !== '';

/** The choice that keeps an item in `groupId`, or in no group. */
export const groupChoiceOf = (groupId: string | null | undefined): GroupChoice =>
  groupId ? { type: 'existing', id: groupId } : NO_GROUP;

const NONE_VALUE = '\u0000none';
const NEW_VALUE = '\u0000new';

interface GroupPickerProps {
  groups: ReadonlyArray<BrowserGroup>;
  value: GroupChoice;
  onChange(choice: GroupChoice): void;
}

/** The Group field of the dialogs that create or save a preset, profile or LUT. */
export default function GroupPicker({ groups, value, onChange }: GroupPickerProps) {
  const { t } = useTranslation();
  const options = [
    { label: t('editor.looks.noGroup'), value: NONE_VALUE },
    ...groups.map((group) => ({ label: group.name, value: group.id })),
    { label: t('editor.looks.newGroup'), value: NEW_VALUE },
  ];
  const selected = value.type === 'none' ? NONE_VALUE : value.type === 'new' ? NEW_VALUE : value.id;

  const handleChange = (next: string) => {
    if (next === NONE_VALUE) onChange(NO_GROUP);
    else if (next === NEW_VALUE) onChange({ type: 'new', name: value.type === 'new' ? value.name : '' });
    else onChange({ type: 'existing', id: next });
  };

  return (
    <div className="flex items-center gap-3">
      <Text variant={TextVariants.label} className="shrink-0">
        {t('editor.looks.group')}
      </Text>
      <Dropdown className="flex-1 min-w-0" onChange={handleChange} options={options} value={selected} />
      {value.type === 'new' && (
        <input
          autoFocus
          className="flex-1 min-w-0 bg-bg-primary text-text-primary border border-border rounded-md px-3 py-2 compact:py-1 focus:outline-none focus:ring-2 focus:ring-accent"
          onChange={(event) => onChange({ type: 'new', name: event.target.value })}
          placeholder={t('editor.looks.newGroupPlaceholder')}
          type="text"
          value={value.name}
        />
      )}
    </div>
  );
}
