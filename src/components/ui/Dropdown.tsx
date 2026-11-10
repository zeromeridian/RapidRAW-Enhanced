import { useState, useEffect, useLayoutEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, ChevronDown } from 'lucide-react';
import Input from './Input';
import Text from './Text';
import { TEXT_COLOR_KEYS, TextColors, TextVariants, TextWeights } from '../../types/typography';
import clsx from 'clsx';

/** Gap between the trigger and the list, and between the list and the window edge. */
const MENU_GAP = 8;

interface MenuPosition {
  left: number;
  width: number;
  top?: number;
  bottom?: number;
  maxHeight: number;
}

/** Below the trigger, or above it when there is more room there, using all the room available. */
const getMenuPosition = (trigger: DOMRect): MenuPosition => {
  const spaceBelow = window.innerHeight - trigger.bottom - MENU_GAP * 2;
  const spaceAbove = trigger.top - MENU_GAP * 2;
  const placeAbove = spaceAbove > spaceBelow;
  return {
    left: trigger.left,
    width: trigger.width,
    ...(placeAbove ? { bottom: window.innerHeight - trigger.top + MENU_GAP } : { top: trigger.bottom + MENU_GAP }),
    maxHeight: Math.max(placeAbove ? spaceAbove : spaceBelow, 0),
  };
};

export interface OptionItem<T extends React.Key> {
  label: string;
  value: T;
}

interface DropdownProps<T extends React.Key> {
  className?: string;
  onChange: (value: T) => void;
  options: Array<OptionItem<T>>;
  placeholder?: string;
  searchPlaceholder?: string;
  value: T | null;
  disabled?: boolean;
  triggerClassName?: string;
  selectedSuffix?: React.ReactNode;
}

const Dropdown = <T extends React.Key>({
  className = '',
  onChange,
  options,
  placeholder = 'Select an option',
  searchPlaceholder = 'Filter options...',
  value,
  disabled = false,
  triggerClassName = '',
  selectedSuffix,
}: DropdownProps<T>) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const selectedOption = options.find((opt) => opt.value === value) || null;

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      // The list is rendered into the document body, so it is outside `dropdownRef`.
      if (dropdownRef.current && !dropdownRef.current.contains(target) && !menuRef.current?.contains(target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  useEffect(() => {
    if (!isOpen) {
      setSearchTerm('');
      setShowSearch(false);
    }
  }, [isOpen]);

  // The list lives outside the panels (which clip their content), so it follows the trigger
  // through scrolling and window resizes.
  useLayoutEffect(() => {
    if (!isOpen) {
      setMenuPosition(null);
      return;
    }
    const update = () => {
      if (triggerRef.current) setMenuPosition(getMenuPosition(triggerRef.current.getBoundingClientRect()));
    };
    const onScroll = (event: Event) => {
      if (!menuRef.current?.contains(event.target as Node)) update();
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [isOpen]);

  const handleSelect = (option: OptionItem<T>) => {
    onChange(option.value);
    setIsOpen(false);
  };

  const filteredOptions = useMemo(() => {
    if (!searchTerm) return options;
    return options.filter((opt) => opt.label.toLowerCase().includes(searchTerm.toLowerCase()));
  }, [options, searchTerm]);

  const isPrintableKey = (e: React.KeyboardEvent<Element>): boolean => {
    if (e.metaKey || e.ctrlKey || e.altKey) return false;
    return e.key.length === 1;
  };

  const handleContainerKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      setIsOpen(false);
      return;
    }

    if (e.key === 'Enter') {
      if (isOpen && filteredOptions.length === 1) {
        e.stopPropagation();
        e.preventDefault();
        handleSelect(filteredOptions[0]);
      }
      return;
    }

    if (e.target === searchInputRef.current) return;

    if (isPrintableKey(e)) {
      e.stopPropagation();
      e.preventDefault();

      setIsOpen(true);
      setShowSearch(true);
      setSearchTerm((prev) => prev + e.key);
    }
  };

  return (
    <div className={`relative ${className}`} ref={dropdownRef} onKeyDown={handleContainerKeyDown}>
      <button
        ref={triggerRef}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        disabled={disabled}
        className={clsx(
          'w-full border border-border-color rounded-md px-3 mr-4 py-2 compact:py-1 flex justify-between items-center text-left disabled:opacity-50 disabled:cursor-not-allowed',
          'focus:ring-accent focus:border-accent focus:outline-hidden focus:ring-2',
          triggerClassName || 'bg-surface',
        )}
        onClick={() => setIsOpen(!isOpen)}
        type="button"
      >
        <span className="flex min-w-0 items-center gap-1">
          <Text as="span" variant={TextVariants.label} color={TextColors.primary} className="truncate compact:text-xs">
            {selectedOption ? selectedOption.label : placeholder}
          </Text>
          {selectedOption && selectedSuffix}
        </span>
        <ChevronDown
          className={`${TEXT_COLOR_KEYS[TextColors.secondary]} transition-transform duration-200 compact:size-4 ${isOpen ? 'rotate-180' : ''}`}
          size={20}
        />
      </button>

      {createPortal(
        <AnimatePresence>
          {isOpen && menuPosition && (
            <motion.div
              ref={menuRef}
              animate={{ opacity: 1, scale: 1 }}
              className={clsx('fixed z-[60]', menuPosition.bottom === undefined ? 'origin-top' : 'origin-bottom')}
              style={{
                left: menuPosition.left,
                width: menuPosition.width,
                top: menuPosition.top,
                bottom: menuPosition.bottom,
              }}
              exit={{ opacity: 0, scale: 0.95 }}
              initial={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.1, ease: 'easeOut' }}
            >
              <div
                aria-orientation="vertical"
                className="bg-surface/95 backdrop-blur-md rounded-lg shadow-xl p-2 overflow-y-auto"
                style={{ maxHeight: menuPosition.maxHeight }}
                role="listbox"
              >
                {showSearch && (
                  <Input
                    ref={searchInputRef}
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder={searchPlaceholder}
                    autoFocus={true}
                    className="mb-2"
                  />
                )}

                {filteredOptions.map((option: OptionItem<T>) => {
                  const isSelected = value === option.value;
                  return (
                    <button
                      key={option.value}
                      onClick={() => handleSelect(option)}
                      className={clsx(
                        'w-full text-left px-3 py-2 rounded-md flex items-center justify-between',
                        'transition-colors duration-150 hover:bg-bg-primary',
                        {
                          'bg-bg-primary': isSelected,
                        },
                      )}
                      role="option"
                      aria-selected={isSelected}
                    >
                      <Text color={TextColors.primary} weight={isSelected ? TextWeights.semibold : TextWeights.normal}>
                        {option.label}
                      </Text>
                      {isSelected && <Check size={16} className={TEXT_COLOR_KEYS[TextColors.primary]} />}
                    </button>
                  );
                })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </div>
  );
};

export default Dropdown;
