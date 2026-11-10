// Parts shared by the Masks and AI panels. Each panel passes its own labels, translated with
// literal `t()` keys so the i18n extractor still finds them.
import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import {
  Circle,
  ClipboardPaste,
  Copy,
  Eye,
  EyeOff,
  FileEdit,
  Loader2,
  Minus,
  Plus,
  PlusSquare,
  RotateCcw,
  SquaresIntersect,
  Trash2,
} from 'lucide-react';

import Slider from '../../ui/Slider';
import Text from '../../ui/Text';
import { Mask, MASK_ICON_MAP, SubMask, SubMaskMode, ToolType, getSubMaskName } from './Masks';
import { useContextMenu } from '../../../context/ContextMenuContext';
import { BRUSH_SIZE_MAX, BRUSH_SIZE_MIN, BrushSettings, OPTION_SEPARATOR } from '../../ui/AppProperties';
import { TextColors, TextVariants, TextWeights } from '../../../types/typography';

export interface BrushToolsLabels {
  size: string;
  feather: string;
  brush: string;
  eraser: string;
}

export const BrushTools = ({
  settings,
  onSettingsChange,
  onDragStateChange,
  labels,
}: {
  settings: BrushSettings;
  onSettingsChange(updater: (settings: BrushSettings) => BrushSettings): void;
  onDragStateChange?: (isDragging: boolean) => void;
  labels: BrushToolsLabels;
}) => (
  <div>
    <Slider
      defaultValue={100}
      label={labels.size}
      max={BRUSH_SIZE_MAX}
      min={BRUSH_SIZE_MIN}
      onChange={(e) => onSettingsChange((s) => ({ ...s, size: Number(e.target.value) }))}
      step={1}
      value={settings.size}
      fillOrigin="min"
      onDragStateChange={onDragStateChange}
    />
    <Slider
      defaultValue={50}
      label={labels.feather}
      max={100}
      min={0}
      onChange={(e) => onSettingsChange((s) => ({ ...s, feather: Number(e.target.value) }))}
      step={1}
      value={settings.feather}
      fillOrigin="min"
      onDragStateChange={onDragStateChange}
    />
    <div className="grid grid-cols-2 gap-2 pt-2">
      <button
        className={`p-2 rounded-md text-sm font-medium transition-colors flex items-center justify-center gap-2 ${settings.tool === ToolType.Brush ? 'text-primary bg-surface' : 'bg-surface text-text-secondary hover:bg-card-active'}`}
        onClick={() => onSettingsChange((s) => ({ ...s, tool: ToolType.Brush }))}
      >
        {labels.brush}
      </button>
      <button
        className={`p-2 rounded-md text-sm font-medium transition-colors flex items-center justify-center gap-2 ${settings.tool === ToolType.Eraser ? 'text-primary bg-surface' : 'bg-surface text-text-secondary hover:bg-card-active'}`}
        onClick={() => onSettingsChange((s) => ({ ...s, tool: ToolType.Eraser }))}
      >
        {labels.eraser}
      </button>
    </div>
  </div>
);

export function NewMaskDropZone({ isOver, text }: { isOver: boolean; text: string }) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, height: 0, marginTop: 0 }}
      animate={{ opacity: 1, height: 'auto', marginTop: '4px' }}
      exit={{ opacity: 0, height: 0, marginTop: 0 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      className={`p-4 compact:p-2.5 rounded-lg text-center ${isOver ? 'border border-accent/80 bg-bg-tertiary/50' : ''}`}
    >
      <Text weight={TextWeights.medium}>{text}</Text>
    </motion.div>
  );
}

export interface SubMaskRowLabels {
  rename: string;
  duplicate: string;
  duplicateAndInvert: string;
  copy: string;
  paste: string;
  delete: string;
  deleteTooltip: string;
  switchToSubtract: string;
  switchToIntersect: string;
  switchToAdd: string;
}

/** The Masks panel's show/hide button; the AI panel has none. */
export interface SubMaskVisibilityToggle {
  hideLabel: string;
  showLabel: string;
  onHoverChange(isHovered: boolean): void;
}

interface SubMaskRowProps {
  subMask: SubMask;
  /** 1-based position in its container. */
  index: number;
  totalCount: number;
  containerId: string;
  isActive: boolean;
  parentVisible?: boolean;
  onSelect(): void;
  updateSubMask(id: string, data: Partial<SubMask>): void;
  handleDelete(): void;
  handleDuplicate(): void;
  handleDuplicateAndInvert(): void;
  handlePaste(): void;
  handleCopy(): void;
  hasCopiedSubMask: boolean;
  activeDragItem: { type: string } | null;
  analyzingSubMaskId?: string | null;
  renamingId: string | null;
  setRenamingId(id: string | null): void;
  tempName: string;
  setTempName(name: string): void;
  labels: SubMaskRowLabels;
  visibilityToggle?: SubMaskVisibilityToggle;
  isParentLoading?: boolean;
}

export function SubMaskRow({
  subMask,
  index,
  totalCount,
  containerId,
  isActive,
  parentVisible,
  onSelect,
  updateSubMask,
  handleDelete,
  handleDuplicate,
  handleDuplicateAndInvert,
  handlePaste,
  handleCopy,
  hasCopiedSubMask,
  activeDragItem,
  analyzingSubMaskId,
  renamingId,
  setRenamingId,
  tempName,
  setTempName,
  labels,
  visibilityToggle,
  isParentLoading,
}: SubMaskRowProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: subMask.id,
    data: { type: 'SubMask', item: subMask, parentId: containerId },
  });
  const { setNodeRef: setDroppableRef, isOver } = useDroppable({
    id: subMask.id,
    data: { type: 'SubMask', item: subMask, parentId: containerId },
  });
  const setCombinedRef = (node: HTMLElement | null) => {
    setNodeRef(node);
    setDroppableRef(node);
  };
  const MaskIcon = MASK_ICON_MAP[subMask.type] || Circle;
  const { showContextMenu } = useContextMenu();
  const [isHovered, setIsHovered] = useState(false);
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isDraggingContainer = activeDragItem?.type === 'Container';
  // An AI patch shows its Quick Eraser as busy while the patch itself is generated.
  const isAnalyzing = subMask.id === analyzingSubMaskId || (isParentLoading && subMask.type === Mask.QuickEraser);

  const handleMouseEnter = () => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
    setIsHovered(true);
  };

  const handleMouseLeave = () => {
    hoverTimeoutRef.current = setTimeout(() => setIsHovered(false), 1000);
  };

  useEffect(() => {
    return () => {
      if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    };
  }, []);

  const handleRenameSubmit = () => {
    if (tempName.trim()) {
      const newName = tempName.trim();
      updateSubMask(subMask.id, { name: newName });
    }
    setRenamingId(null);
  };

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    showContextMenu(e.clientX, e.clientY, [
      {
        label: labels.rename,
        icon: FileEdit,
        onClick: () => {
          setRenamingId(subMask.id);
          setTempName(getSubMaskName(subMask));
        },
      },
      { label: labels.duplicate, icon: PlusSquare, onClick: handleDuplicate },
      { label: labels.duplicateAndInvert, icon: RotateCcw, onClick: handleDuplicateAndInvert },
      { label: labels.copy, icon: Copy, onClick: handleCopy },
      {
        label: labels.paste,
        icon: ClipboardPaste,
        disabled: !hasCopiedSubMask,
        onClick: handlePaste,
      },
      { type: OPTION_SEPARATOR },
      { label: labels.delete, icon: Trash2, isDestructive: true, onClick: handleDelete },
    ]);
  };

  const showNumber = isHovered && totalCount > 1;

  return (
    <motion.div
      layout="position"
      initial={{ opacity: 0, x: -15 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: -15, scale: 0.95, transition: { duration: 0.2 } }}
      ref={setCombinedRef}
      {...attributes}
      {...listeners}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className={`flex items-center gap-2 p-2 compact:py-1 rounded-md transition-colors group cursor-pointer
            ${isActive ? 'bg-surface' : 'hover:bg-card-active'}
            ${isOver && !isDraggingContainer ? 'border-t-2 border-accent' : ''}
            ${isDragging ? 'opacity-40 z-50' : ''}
            ${parentVisible === false ? 'opacity-50' : ''}
            ${isDraggingContainer ? 'opacity-30 pointer-events-none' : ''}
            transition-opacity duration-300`}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      onContextMenu={onContextMenu}
    >
      <Text
        as="div"
        variant={TextVariants.small}
        weight={TextWeights.bold}
        className="relative w-4 h-4 ml-1 shrink-0 flex items-center justify-center"
      >
        <AnimatePresence mode="wait" initial={false}>
          {isAnalyzing ? (
            <motion.div
              key="analyzing"
              initial={{ opacity: 0, scale: 0.5 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.5 }}
              transition={{ duration: 0.15 }}
              className="absolute"
            >
              <Loader2 size={16} className="animate-spin" />
            </motion.div>
          ) : showNumber ? (
            <motion.span
              key="number"
              initial={{ opacity: 0, scale: 0.5 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.5 }}
              transition={{ duration: 0.15 }}
              className="absolute"
            >
              {index}
            </motion.span>
          ) : (
            <motion.div
              key="icon"
              initial={{ opacity: 0, scale: 0.5 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.5 }}
              transition={{ duration: 0.15 }}
              className="absolute"
            >
              <MaskIcon size={16} />
            </motion.div>
          )}
        </AnimatePresence>
      </Text>
      {renamingId === subMask.id ? (
        <input
          autoFocus
          className="bg-bg-primary text-sm w-full rounded px-1 outline-none border border-accent"
          value={tempName}
          onChange={(e) => setTempName(e.target.value)}
          onBlur={handleRenameSubmit}
          onKeyDown={(e) => e.key === 'Enter' && handleRenameSubmit()}
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <Text color={TextColors.primary} className="flex-1 truncate select-none">
          {getSubMaskName(subMask)}
        </Text>
      )}
      <div className="flex opacity-0 group-hover:opacity-100 transition-opacity">
        {index > 1 && (
          <button
            className="p-1 hover:text-text-primary text-text-secondary"
            data-tooltip={
              subMask.mode === SubMaskMode.Additive
                ? labels.switchToSubtract
                : subMask.mode === SubMaskMode.Subtractive
                  ? labels.switchToIntersect
                  : labels.switchToAdd
            }
            onClick={(e) => {
              e.stopPropagation();
              updateSubMask(subMask.id, {
                mode:
                  subMask.mode === SubMaskMode.Additive
                    ? SubMaskMode.Subtractive
                    : subMask.mode === SubMaskMode.Subtractive
                      ? SubMaskMode.Intersect
                      : SubMaskMode.Additive,
              });
            }}
          >
            {subMask.mode === SubMaskMode.Additive ? (
              <Plus size={16} />
            ) : subMask.mode === SubMaskMode.Subtractive ? (
              <Minus size={16} />
            ) : (
              <SquaresIntersect size={16} />
            )}
          </button>
        )}
        {visibilityToggle && (
          <button
            className="p-1 hover:text-text-primary text-text-secondary"
            data-tooltip={subMask.visible ? visibilityToggle.hideLabel : visibilityToggle.showLabel}
            onMouseEnter={() => visibilityToggle.onHoverChange(true)}
            onMouseLeave={() => visibilityToggle.onHoverChange(false)}
            onClick={(e) => {
              e.stopPropagation();
              updateSubMask(subMask.id, { visible: !subMask.visible });
            }}
          >
            {subMask.visible ? <Eye size={16} /> : <EyeOff size={16} />}
          </button>
        )}
        <button
          className="p-1 hover:text-red-500 text-text-secondary"
          data-tooltip={labels.deleteTooltip}
          onClick={(e) => {
            e.stopPropagation();
            handleDelete();
          }}
        >
          <Trash2 size={16} />
        </button>
      </div>
    </motion.div>
  );
}
