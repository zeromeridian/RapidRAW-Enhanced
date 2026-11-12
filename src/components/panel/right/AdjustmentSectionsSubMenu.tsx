import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, DragControls, motion, Reorder, useDragControls } from 'framer-motion';
import { ChevronDown, GripVertical, LayoutList, RotateCcw } from 'lucide-react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import type { ParseKeys } from 'i18next';
import { useShallow } from 'zustand/react/shallow';
import { AdjustmentLayout } from '../../ui/AppProperties';
import { useSettingsStore } from '../../../store/useSettingsStore';
import { useReorderableList } from '../../../hooks/useReorderableList';
import {
  ADJUSTMENT_SECTIONS,
  ADJUSTMENT_TOOLS_BY_ID,
  getAdjustmentSectionOrder,
  getAdjustmentToolOrder,
  withAdjustmentLayout,
} from '../../../utils/adjustments';

interface DragHandleProps {
  dragControls: DragControls;
  label: string;
}

interface ToolRowProps {
  onDragEnd(): void;
  tool: string;
}

interface SectionRowProps {
  isExpanded: boolean;
  onDragEnd(): void;
  onReorderTools(order: string[]): void;
  onToggleExpanded(): void;
  section: string;
  toolOrder: string[];
}

const DEFAULT_SECTION_ORDER = Object.keys(ADJUSTMENT_SECTIONS);

function DragHandle({ dragControls, label }: DragHandleProps) {
  return (
    <div
      className="flex items-center gap-2 grow min-w-0 py-2 cursor-grab active:cursor-grabbing touch-none select-none"
      onPointerDown={(e) => dragControls.start(e)}
    >
      <GripVertical size={16} className="shrink-0 text-text-secondary" />
      <span className="text-sm truncate text-text-primary">{label}</span>
    </div>
  );
}

function ToolRow({ onDragEnd, tool }: ToolRowProps) {
  const { t } = useTranslation();
  const dragControls = useDragControls();

  return (
    <Reorder.Item
      as="div"
      className="flex items-center gap-1 pl-6 pr-1 rounded-md bg-surface hover:bg-bg-primary transition-colors"
      dragControls={dragControls}
      dragListener={false}
      layout="position"
      onDragEnd={onDragEnd}
      transition={{ duration: 0 }}
      value={tool}
    >
      <DragHandle dragControls={dragControls} label={t(ADJUSTMENT_TOOLS_BY_ID[tool].label as ParseKeys)} />
    </Reorder.Item>
  );
}

function SectionRow({ isExpanded, onDragEnd, onReorderTools, onToggleExpanded, section, toolOrder }: SectionRowProps) {
  const { t } = useTranslation();
  const dragControls = useDragControls();
  const tools = useReorderableList(toolOrder, onReorderTools);

  return (
    <Reorder.Item
      as="div"
      className="rounded-md bg-surface"
      dragControls={dragControls}
      dragListener={false}
      layout="position"
      onDragEnd={onDragEnd}
      transition={{ duration: 0 }}
      value={section}
    >
      <div className="flex items-center gap-1 pl-2 pr-1 rounded-md hover:bg-bg-primary transition-colors">
        <DragHandle dragControls={dragControls} label={t(`editor.adjustments.sections.${section}` as ParseKeys)} />
        {toolOrder.length > 0 && (
          <button
            className="p-1 rounded-full text-text-secondary hover:text-text-primary hover:bg-card-active transition-colors"
            onClick={onToggleExpanded}
            data-tooltip={t('editor.adjustments.tooltips.reorderTools')}
          >
            <ChevronDown size={16} className={clsx('transition-transform duration-200', isExpanded && 'rotate-180')} />
          </button>
        )}
      </div>
      {isExpanded && (
        <Reorder.Group as="div" axis="y" className="flex flex-col" onReorder={tools.handleReorder} values={tools.order}>
          {tools.order.map((tool) => (
            <ToolRow key={tool} onDragEnd={tools.handleDragEnd} tool={tool} />
          ))}
        </Reorder.Group>
      )}
    </Reorder.Item>
  );
}

/**
 * Customize Panels: drag the adjustment sections, and the tools inside a section, into a new order.
 * The order is an app setting shared by the photo's and the masks' adjustments.
 */
function AdjustmentSectionsSubMenu() {
  const { t } = useTranslation();

  const { appSettings, handleSettingsChange } = useSettingsStore(
    useShallow((state) => ({
      appSettings: state.appSettings,
      handleSettingsChange: state.handleSettingsChange,
    })),
  );

  const layout = appSettings?.adjustmentLayout;
  const savedOrder = useMemo(() => getAdjustmentSectionOrder(layout?.sectionOrder), [layout?.sectionOrder]);
  const savedToolOrder = useMemo(
    () =>
      Object.fromEntries(
        DEFAULT_SECTION_ORDER.map((section) => [section, getAdjustmentToolOrder(section, layout?.toolOrder)]),
      ),
    [layout?.toolOrder],
  );
  const [expandedSection, setExpandedSection] = useState<string | null>(null);

  const updateLayout = (changes: Partial<AdjustmentLayout>) => {
    if (appSettings) {
      handleSettingsChange(withAdjustmentLayout(appSettings, changes));
    }
  };

  const sections = useReorderableList(savedOrder, (order) => updateLayout({ sectionOrder: order }));

  const handleReorderTools = (section: string, order: string[]) => {
    updateLayout({ toolOrder: { ...layout?.toolOrder, [section]: order } });
  };

  const handleReset = () => {
    updateLayout({ sectionOrder: [], toolOrder: {} });
  };

  const isDefaultLayout =
    savedOrder.join() === DEFAULT_SECTION_ORDER.join() &&
    Object.entries(savedToolOrder).every(([section, order]) => order.join() === getAdjustmentToolOrder(section).join());

  return (
    <div
      className="bg-surface/95 p-2 w-64 flex flex-col rounded-lg"
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <Reorder.Group
        as="div"
        axis="y"
        className="flex flex-col"
        onReorder={sections.handleReorder}
        values={sections.order}
      >
        {sections.order.map((section) => (
          <SectionRow
            isExpanded={expandedSection === section}
            key={section}
            onDragEnd={sections.handleDragEnd}
            onReorderTools={(order) => handleReorderTools(section, order)}
            onToggleExpanded={() => setExpandedSection(expandedSection === section ? null : section)}
            section={section}
            toolOrder={savedToolOrder[section]}
          />
        ))}
      </Reorder.Group>
      <div className="h-px bg-text-secondary/20 my-1 mx-2" />
      <button
        className="w-full text-left px-3 py-2 text-sm rounded-md flex items-center gap-3 transition-colors duration-150 text-text-primary hover:bg-bg-primary disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent"
        disabled={isDefaultLayout}
        onClick={handleReset}
        role="menuitem"
      >
        <RotateCcw size={16} />
        <span>{t('editor.adjustments.actions.resetPanelLayout')}</span>
      </button>
    </div>
  );
}

// Memoized: the context menu re-renders a submenu while placing it, which would make the
// draggable rows animate in from the unplaced position.
const MemoizedAdjustmentSectionsSubMenu = memo(AdjustmentSectionsSubMenu);
export default MemoizedAdjustmentSectionsSubMenu;

/** The section context menu's Customize Panels entry (photo and masks). */
export const customizePanelsMenuOption = (label: string) => ({
  label,
  icon: LayoutList,
  submenu: [{ customComponent: MemoizedAdjustmentSectionsSubMenu }],
});

/** The Adjustments header button that opens Customize Panels below it. */
export function CustomizePanelsButton() {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; right: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!isOpen || !buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    setPosition({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handlePointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!menuRef.current?.contains(target) && !buttonRef.current?.contains(target)) setIsOpen(false);
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  return (
    <>
      <button
        className={clsx(
          'p-2 rounded-full transition-colors',
          isOpen ? 'bg-surface hover:bg-card-active' : 'hover:bg-surface',
        )}
        onClick={() => setIsOpen(!isOpen)}
        ref={buttonRef}
        data-tooltip={t('editor.adjustments.actions.customizePanels')}
      >
        <LayoutList size={18} />
      </button>
      {createPortal(
        <AnimatePresence>
          {isOpen && position && (
            <motion.div
              animate={{ opacity: 1, scale: 1 }}
              className="fixed z-50 origin-top-right backdrop-blur-md rounded-lg shadow-xl"
              exit={{ opacity: 0, scale: 0.95 }}
              initial={{ opacity: 0, scale: 0.95 }}
              ref={menuRef}
              role="menu"
              style={position}
              transition={{ duration: 0.1, ease: 'easeOut' }}
            >
              <MemoizedAdjustmentSectionsSubMenu />
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}
