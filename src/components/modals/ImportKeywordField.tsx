import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import clsx from 'clsx';
import Text from '../ui/Text';
import { TextVariants } from '../../types/typography';
import { useKeywordIndex } from '../../hooks/useKeywordIndex';
import { USER_TAG_PREFIX, displayTag, formatKeyword, isSameKeyword, parseKeywordPath } from '../../utils/keywords';

/** Suggestions shown at most while typing. */
const MAX_SUGGESTIONS = 8;

interface ImportKeywordFieldProps {
  /** Stored tags (`user:Places|Berlin`). */
  keywords: Array<string>;
  onChange(keywords: Array<string>): void;
}

/**
 * The Import dialog's keywords: typed and added with Enter or a comma (`>` for a hierarchy, as in
 * the Tagging panel), or picked from the library's keywords while typing; an existing spelling wins.
 */
export default function ImportKeywordField({ keywords, onChange }: ImportKeywordFieldProps) {
  const { t } = useTranslation();
  const [input, setInput] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const { keywords: libraryKeywords } = useKeywordIndex();

  const keywordPaths = keywords.map((tag) => tag.slice(USER_TAG_PREFIX.length));
  const query = input.trim().toLowerCase();
  const suggestions = useMemo(() => {
    if (!query) return [];
    return libraryKeywords
      .filter(({ keyword }) => formatKeyword(keyword, ' > ').toLowerCase().includes(query))
      .filter(({ keyword }) => !keywordPaths.some((path) => isSameKeyword(path, keyword)))
      .sort((left, right) => right.count - left.count)
      .slice(0, MAX_SUGGESTIONS);
  }, [libraryKeywords, query, keywordPaths]);

  const add = (typed: string) => {
    const path = parseKeywordPath(typed);
    if (!path) return;
    const known = libraryKeywords.find(({ keyword }) => isSameKeyword(keyword, path))?.keyword ?? path;
    if (!keywordPaths.some((existing) => isSameKeyword(existing, known))) {
      onChange([...keywords, `${USER_TAG_PREFIX}${known}`]);
    }
    setInput('');
  };

  return (
    <div>
      {keywords.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2">
          {keywords.map((tag) => (
            <span key={tag} className="flex items-center gap-1 rounded-md bg-bg-primary pl-2.5 pr-1.5 py-1">
              <Text as="span" variant={TextVariants.small}>
                {displayTag(tag)}
              </Text>
              <button
                className="text-text-secondary hover:text-red-400 transition-colors"
                data-tooltip={t('editor.tagging.removeTooltip')}
                onClick={() => onChange(keywords.filter((existing) => existing !== tag))}
                type="button"
              >
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="relative">
        <input
          className={clsx(
            'w-full bg-bg-primary border rounded-md p-2 text-sm text-text-primary placeholder-text-tertiary outline-hidden',
            isFocused ? 'border-accent' : 'border-surface',
          )}
          onBlur={() => {
            setIsFocused(false);
            add(input);
          }}
          onChange={(event) => {
            const parts = event.target.value.split(',');
            parts.slice(0, -1).forEach(add);
            setInput(parts[parts.length - 1]);
          }}
          onFocus={() => setIsFocused(true)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              event.stopPropagation();
              add(input);
            }
          }}
          placeholder={t('modals.importSettings.keywordsPlaceholder')}
          type="text"
          value={input}
        />
        {isFocused && suggestions.length > 0 && (
          <div className="absolute z-10 left-0 right-0 mt-1 rounded-md bg-surface shadow-xl border border-border-color/30 p-1">
            {suggestions.map(({ keyword, count }) => (
              <button
                className="w-full flex justify-between gap-2 px-2 py-1.5 rounded text-left hover:bg-bg-primary"
                key={keyword}
                // Before the input's blur, which would add the typed text instead.
                onMouseDown={(event) => {
                  event.preventDefault();
                  add(formatKeyword(keyword, ' > '));
                }}
                type="button"
              >
                <Text as="span" variant={TextVariants.small}>
                  {formatKeyword(keyword)}
                </Text>
                <Text as="span" variant={TextVariants.small}>
                  {count}
                </Text>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
