import Input from '../Input';
import BrowserViewSwitch from './BrowserViewSwitch';

interface BrowserToolbarProps {
  query: string;
  onQueryChange(query: string): void;
  placeholder: string;
  isGrid: boolean;
  onGridChange(isGrid: boolean): void;
}

/** A Looks browser's name search and its grid/list switch. */
export default function BrowserToolbar({
  query,
  onQueryChange,
  placeholder,
  isGrid,
  onGridChange,
}: BrowserToolbarProps) {
  return (
    <div className="flex items-center gap-2 px-4 compact:px-3 pt-3 compact:pt-2 shrink-0">
      <Input
        className="h-8 compact:h-7"
        onChange={(event) => onQueryChange(event.target.value)}
        placeholder={placeholder}
        value={query}
      />
      <BrowserViewSwitch isGrid={isGrid} onChange={onGridChange} />
    </div>
  );
}

/** Whether `name` matches a search (case-insensitive; an empty search matches everything). */
export const matchesQuery = (name: string, query: string) => {
  const normalized = query.trim().toLocaleLowerCase();
  return normalized === '' || name.toLocaleLowerCase().includes(normalized);
};
