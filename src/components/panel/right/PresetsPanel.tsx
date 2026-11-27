import { useState, useEffect, useCallback, useMemo, useRef, ReactNode } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { useTranslation } from 'react-i18next';
import type { ParseKeys } from 'i18next';
import {
  findPresetFolderId,
  PresetFolder,
  PresetImportFailure,
  PresetListType,
  usePresets,
  UserPreset,
} from '../../../hooks/usePresets';
import { useContextMenu } from '../../../context/ContextMenuContext';
import {
  CopyPlus,
  Crop,
  Edit,
  FileDown,
  FileUp,
  Folder as FolderIcon,
  FolderInput,
  FolderOpen,
  FolderPlus,
  Layers,
  Loader2,
  Plus,
  Save,
  Settings2,
  SortAsc,
  Star,
  Trash2,
  Users,
} from 'lucide-react';
import CreateFolderModal from '../../modals/CreateFolderModal';
import RenameFolderModal from '../../modals/RenameFolderModal';
import Button from '../../ui/Button';
import Text from '../../ui/Text';
import Slider from '../../ui/Slider';
import LooksHeader from './LooksHeader';
import BrowserSection from '../../ui/LooksBrowser/BrowserSection';
import BrowserToolbar, { matchesQuery } from '../../ui/LooksBrowser/BrowserToolbar';
import { BrowserItemProps, BrowserItems, BrowserRow, BrowserTile } from '../../ui/LooksBrowser/BrowserItem';
import { NO_GROUP } from '../../ui/LooksBrowser/GroupPicker';
import { useLooksBrowser } from '../../ui/LooksBrowser/useLooksBrowser';
import { TextColors, TextVariants, TextWeights } from '../../../types/typography';
import { Adjustments, INITIAL_ADJUSTMENTS } from '../../../utils/adjustments';
import { describePresetSettings, presetHoldsSection } from '../../../utils/presetSettings';
import { Invokes, OPTION_SEPARATOR, Panel, Preset } from '../../ui/AppProperties';
import { useEditorStore } from '../../../store/useEditorStore';
import { useUIStore } from '../../../store/useUIStore';
import { useEditorActions } from '../../../hooks/useEditorActions';
import { openLookDialog } from '../../../hooks/useLookDialog';

/** New Group: on its own, or for Move to Group of `presetId`. */
interface NewGroupState {
  isOpen: boolean;
  presetId: string | null;
}

interface PresetsPanelProps {
  onNavigateToCommunity(): void;
}

/** A section of the browser: Favorites, a folder (preset group), or the presets in no folder. */
interface PresetSection {
  key: string;
  title: string;
  presets: Array<Preset>;
  folder?: PresetFolder;
  /** Folders start closed, as before Looks, so their previews render only once opened. */
  defaultOpen: boolean;
}

const FAVORITES_SECTION = 'favorites';
const UNGROUPED_SECTION = 'ungrouped';

const evaluateCurveY = (curve: Array<{ x: number; y: number }>, targetX: number): number => {
  const len = curve.length;
  if (len === 1) return curve[0].y;
  if (targetX <= curve[0].x) return curve[0].y;
  if (targetX >= curve[len - 1].x) return curve[len - 1].y;

  for (let i = 0; i < len - 1; i++) {
    const p2 = curve[i + 1];
    if (targetX <= p2.x) {
      const p1 = curve[i];
      const range = p2.x - p1.x;
      return range === 0 ? p1.y : p1.y + ((targetX - p1.x) / range) * (p2.y - p1.y);
    }
  }
  return targetX;
};

const mixAdjustments = (presetObj: any, intensity: number, initialObj: any = INITIAL_ADJUSTMENTS): any => {
  const fraction = intensity / 100;

  if (fraction === 1) return { ...presetObj };
  if (fraction === 0) return { ...initialObj };

  const result: any = {};
  const keys = Object.keys(presetObj);

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const presetVal = presetObj[key];
    const initialVal = initialObj[key] !== undefined ? initialObj[key] : (INITIAL_ADJUSTMENTS as any)[key];

    if (typeof presetVal === 'number') {
      result[key] = typeof initialVal === 'number' ? initialVal + (presetVal - initialVal) * fraction : presetVal;
    } else if (Array.isArray(presetVal)) {
      if (!Array.isArray(initialVal)) {
        result[key] = fraction > 0 ? presetVal : initialVal;
        continue;
      }

      if (presetVal.length > 0 && presetVal[0].x !== undefined && presetVal[0].y !== undefined) {
        const xVals: number[] = [];
        let p1 = 0,
          p2 = 0;
        const len1 = initialVal.length,
          len2 = presetVal.length;

        while (p1 < len1 && p2 < len2) {
          const x1 = initialVal[p1].x,
            x2 = presetVal[p2].x;
          if (x1 < x2) {
            xVals.push(x1);
            p1++;
          } else if (x1 > x2) {
            xVals.push(x2);
            p2++;
          } else {
            xVals.push(x1);
            p1++;
            p2++;
          }
        }
        while (p1 < len1) xVals.push(initialVal[p1++].x);
        while (p2 < len2) xVals.push(presetVal[p2++].x);

        const newCurve = new Array(xVals.length);

        for (let j = 0; j < xVals.length; j++) {
          const x = xVals[j];
          const yInit = evaluateCurveY(initialVal, x);
          const yPreset = evaluateCurveY(presetVal, x);
          const yInterp = yInit + (yPreset - yInit) * fraction;

          newCurve[j] = {
            x,
            y: yInterp < 0 ? 0 : yInterp > 255 ? 255 : yInterp,
          };
        }
        result[key] = newCurve;
      } else {
        result[key] = fraction > 0 ? presetVal : initialVal;
      }
    } else if (presetVal !== null && typeof presetVal === 'object') {
      result[key] = mixAdjustments(presetVal, intensity, initialVal || {});
    } else {
      result[key] = fraction > 0 ? presetVal : initialVal;
    }
  }
  return result;
};

const revokeBlobUrl = (url: string | null | undefined) => {
  if (url && url.startsWith('blob:')) URL.revokeObjectURL(url);
};

/** The masks and crop marks of a preset that holds those settings. */
function presetBadges(preset: Preset): ReactNode | undefined {
  const supportsMasks = presetHoldsSection(preset, 'masks');
  const supportsGeometry = presetHoldsSection(preset, 'geometry');
  if (!supportsMasks && !supportsGeometry) return undefined;
  return (
    <span className="bg-primary rounded-full px-1.5 py-0.5 flex items-center gap-1 shadow-xs shrink-0">
      {supportsMasks && <Layers size={11} className="text-white" />}
      {supportsGeometry && <Crop size={11} className="text-white" />}
    </span>
  );
}

/** The list's second line: how many settings the preset holds, named in its tooltip. */
function PresetDetails({ preset }: { preset: Preset }) {
  const { t } = useTranslation();
  const settings = useMemo(() => describePresetSettings(preset), [preset]);
  return (
    <Text
      variant={TextVariants.small}
      color={TextColors.secondary}
      className="text-[10px] uppercase tracking-wider mt-0.5"
      data-tooltip={settings.groupLabels.map((label) => t(label as ParseKeys)).join(', ')}
    >
      {t('editor.presets.settingsCount', { count: settings.count })}
    </Text>
  );
}

/** A preset that can be dragged onto a folder or another preset. */
function DraggablePreset({ preset, children }: { preset: Preset; children: ReactNode }) {
  const {
    attributes,
    listeners,
    setNodeRef: setDraggableNodeRef,
    isDragging,
  } = useDraggable({ id: preset.id, data: { type: PresetListType.Preset, preset } });
  const { setNodeRef: setDroppableNodeRef, isOver } = useDroppable({
    id: preset.id,
    data: { type: PresetListType.Preset, preset },
  });
  const setCombinedRef = useCallback(
    (node: HTMLElement | null) => {
      setDraggableNodeRef(node);
      setDroppableNodeRef(node);
    },
    [setDraggableNodeRef, setDroppableNodeRef],
  );

  return (
    <div
      {...listeners}
      {...attributes}
      ref={setCombinedRef}
      style={{
        borderRadius: 'var(--radius-lg)',
        opacity: isDragging ? 0.4 : 1,
        outline: isOver ? '2px solid var(--color-primary)' : '2px solid transparent',
        outlineOffset: '-2px',
        touchAction: 'none',
      }}
    >
      {children}
    </div>
  );
}

interface FolderSectionProps {
  folder: PresetFolder;
  isOpen: boolean;
  onToggle(): void;
  onContextMenu(event: React.MouseEvent): void;
  children: ReactNode;
}

/** A folder's section: a drop target for presets, dragged by its folder icon. */
function FolderSection({ folder, isOpen, onToggle, onContextMenu, children }: FolderSectionProps) {
  const {
    attributes,
    listeners,
    setNodeRef: setDraggableNodeRef,
  } = useDraggable({ id: folder.id, data: { type: PresetListType.Folder, folder } });
  const { setNodeRef: setDroppableNodeRef, isOver } = useDroppable({
    id: folder.id,
    data: { type: PresetListType.Folder, folder },
  });
  const Icon = isOpen ? FolderOpen : FolderIcon;

  return (
    <BrowserSection
      containerRef={setDroppableNodeRef}
      count={folder.children.length}
      icon={
        <span className="cursor-grab" ref={setDraggableNodeRef} {...listeners} {...attributes}>
          <Icon size={14} className={isOpen ? 'text-primary' : undefined} />
        </span>
      }
      isDropTarget={isOver}
      isOpen={isOpen}
      onContextMenu={onContextMenu}
      onToggle={onToggle}
      title={folder.name}
    >
      {children}
    </BrowserSection>
  );
}

/** Looks → Presets: the presets in their folders (groups), as a grid of previews or a list. */
export default function PresetsPanel({ onNavigateToCommunity }: PresetsPanelProps) {
  const { t } = useTranslation();
  const selectedImage = useEditorStore((s) => s.selectedImage);
  const adjustments = useEditorStore((s) => s.adjustments);
  const activePanel = useUIStore((s) => s.activeRightPanel);
  const setEditor = useEditorStore((s) => s.setEditor);
  const { setAdjustments } = useEditorActions();
  const { favorites, toggleFavorite, isGrid, setGrid, isSectionOpen, toggleSection } = useLooksBrowser('presets');

  const {
    addFolder,
    deleteFolder,
    deleteItem,
    duplicatePreset,
    exportPresetsToFile,
    importPresetsFromFiles,
    isLoading,
    movePreset,
    movePresetToGroup,
    presets,
    renameItem,
    reorderItems,
    sortAllPresetsAlphabetically,
  } = usePresets(adjustments);
  const { showContextMenu } = useContextMenu();
  const [previews, setPreviews] = useState<Record<string, string | null>>({});
  const [query, setQuery] = useState('');
  const [newGroupState, setNewGroupState] = useState<NewGroupState>({ isOpen: false, presetId: null });
  const [renameFolder, setRenameFolder] = useState<PresetFolder | null>(null);
  const [activeItem, setActiveItem] = useState<any>(null);

  const [activePresetId, setActivePresetId] = useState<string | null>(null);
  const [presetIntensity, setPresetIntensity] = useState<number>(100);
  const [baseAdjustments, setBaseAdjustments] = useState<Adjustments | null>(null);

  const previewsRef = useRef(previews);
  previewsRef.current = previews;
  const previewQueue = useRef<Array<Preset>>([]);
  const isProcessingQueue = useRef(false);
  /** The presets shown in an open section, the only ones whose previews are rendered. */
  const wantedIdsRef = useRef<Set<string>>(new Set());
  const currentImagePathRef = useRef<string | null>(selectedImage?.path || null);

  const handleDragStateChange = useCallback(
    (isDragging: boolean) => {
      setEditor({ isSliderDragging: isDragging });
    },
    [setEditor],
  );

  const folders = useMemo(() => presets.flatMap((item: UserPreset) => (item.folder ? [item.folder] : [])), [presets]);
  const rootPresets = useMemo(
    () => presets.flatMap((item: UserPreset) => (item.preset ? [item.preset] : [])),
    [presets],
  );
  const allPresets = useMemo(
    () => [...folders.flatMap((folder) => folder.children), ...rootPresets],
    [folders, rootPresets],
  );

  const allItemsMap = useMemo(() => {
    const map = new Map();
    presets.forEach((item: UserPreset) => {
      if (item.preset) {
        map.set(item.preset.id, { type: PresetListType.Preset, data: item.preset });
      } else if (item.folder) {
        map.set(item.folder.id, { type: PresetListType.Folder, data: item.folder });
        item.folder.children.forEach((p: Preset) => map.set(p.id, { type: PresetListType.Preset, data: p }));
      }
    });
    return map;
  }, [presets]);

  const itemParentMap = useMemo(() => {
    const map = new Map<string, string | null>();
    presets.forEach((item: UserPreset) => {
      if (item.preset) {
        map.set(item.preset.id, null);
      } else if (item.folder) {
        const folderId = item.folder.id;
        map.set(folderId, null);
        item.folder.children.forEach((p: Preset) => map.set(p.id, folderId));
      }
    });
    return map;
  }, [presets]);

  // Favorites first (a favorite also stays in its folder), then the folders, then the presets in
  // no folder. A search shows only the matches, in open sections.
  const isSearching = query.trim() !== '';
  const sections = useMemo<Array<PresetSection>>(() => {
    const matches = (preset: Preset) => matchesQuery(preset.name, query);
    const favoritePresets = allPresets.filter((preset) => favorites.has(preset.id) && matches(preset));
    const folderSections = folders
      .map((folder) => ({
        key: folder.id,
        title: folder.name,
        presets: folder.children.filter(matches),
        folder,
        defaultOpen: false,
      }))
      .filter((section) => !isSearching || section.presets.length > 0);
    const ungrouped = rootPresets.filter(matches);
    return [
      ...(favoritePresets.length > 0
        ? [
            {
              key: FAVORITES_SECTION,
              title: t('editor.looks.favorites'),
              presets: favoritePresets,
              defaultOpen: true,
            },
          ]
        : []),
      ...folderSections,
      ...(ungrouped.length > 0
        ? [{ key: UNGROUPED_SECTION, title: t('editor.looks.noGroup'), presets: ungrouped, defaultOpen: true }]
        : []),
    ];
  }, [allPresets, favorites, folders, isSearching, query, rootPresets, t]);

  const isOpen = useCallback(
    (section: PresetSection) => isSearching || isSectionOpen(section.key, section.defaultOpen),
    [isSearching, isSectionOpen],
  );

  const wantedPresets = useMemo(() => {
    const seen = new Map<string, Preset>();
    sections.filter(isOpen).forEach((section) => section.presets.forEach((preset) => seen.set(preset.id, preset)));
    return [...seen.values()];
  }, [isOpen, sections]);

  // A preset deleted or saved again (New Look's Update or Configure) loses its preview; the
  // preview queue below renders a changed one again.
  const renderedPresetsRef = useRef(new Map<string, Preset>());
  useEffect(() => {
    const current = new Map(allPresets.map((preset) => [preset.id, preset]));
    const stale = Object.keys(previewsRef.current).filter((id) => {
      const rendered = renderedPresetsRef.current.get(id);
      return !current.has(id) || (rendered !== undefined && rendered !== current.get(id));
    });
    renderedPresetsRef.current = current;
    if (stale.length > 0) {
      const remaining = { ...previewsRef.current };
      stale.forEach((id) => {
        revokeBlobUrl(remaining[id]);
        delete remaining[id];
      });
      previewsRef.current = remaining;
      setPreviews(remaining);
    }
  }, [allPresets]);

  useEffect(() => {
    return () => {
      Object.values(previewsRef.current).forEach(revokeBlobUrl);
      previewQueue.current = [];
    };
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 10,
      },
    }),
  );

  const { setNodeRef: setRootNodeRef, isOver: isRootOver } = useDroppable({ id: 'root' });

  /** Renders the queued previews one by one; one rendered for a photo no longer open is dropped. */
  const processPreviewQueue = useCallback(async () => {
    if (isProcessingQueue.current) {
      return;
    }
    isProcessingQueue.current = true;

    while (previewQueue.current.length > 0) {
      const preset = previewQueue.current.shift();
      if (!preset) break;
      if (previewsRef.current[preset.id] !== undefined || !wantedIdsRef.current.has(preset.id)) {
        continue;
      }
      const pathAtStart = currentImagePathRef.current;

      try {
        const imageData: Uint8Array = await invoke(Invokes.GeneratePresetPreview, {
          jsAdjustments: { ...INITIAL_ADJUSTMENTS, ...preset.adjustments },
        });
        if (pathAtStart !== currentImagePathRef.current) continue;

        const url = URL.createObjectURL(new Blob([new Uint8Array(imageData)], { type: 'image/jpeg' }));
        previewsRef.current = { ...previewsRef.current, [preset.id]: url };
        setPreviews((prev: Record<string, string | null>) => {
          revokeBlobUrl(prev[preset.id]);
          return { ...prev, [preset.id]: url };
        });
      } catch (error) {
        console.error(`Failed to generate preview for preset ${preset.name}:`, error);
        if (pathAtStart === currentImagePathRef.current) {
          previewsRef.current = { ...previewsRef.current, [preset.id]: null };
          setPreviews((prev: Record<string, string | null>) => ({ ...prev, [preset.id]: null }));
        }
      }
    }

    isProcessingQueue.current = false;
  }, []);

  const enqueuePreviews = useCallback(
    (presetsToGenerate: Array<Preset>) => {
      const queued = new Set(previewQueue.current.map((preset) => preset.id));
      const newItems = presetsToGenerate.filter(
        (preset) => previewsRef.current[preset.id] === undefined && !queued.has(preset.id),
      );
      if (newItems.length > 0) {
        previewQueue.current.push(...newItems);
        processPreviewQueue();
      }
    },
    [processPreviewQueue],
  );

  // Another photo (or one not ready yet) drops the previews and the applied preset.
  useEffect(() => {
    const isPathChanged = selectedImage?.path !== currentImagePathRef.current;
    if (isPathChanged || !selectedImage?.isReady) {
      Object.values(previewsRef.current).forEach(revokeBlobUrl);
      previewsRef.current = {};
      previewQueue.current = [];
      setPreviews({});
      setActivePresetId(null);
      setBaseAdjustments(null);
      if (isPathChanged && selectedImage?.path) {
        currentImagePathRef.current = selectedImage.path;
      }
    }
  }, [selectedImage?.isReady, selectedImage?.path]);

  useEffect(() => {
    wantedIdsRef.current = new Set(wantedPresets.map((preset) => preset.id));
    if (activePanel === Panel.Presets && selectedImage?.isReady) {
      enqueuePreviews(wantedPresets);
    }
  }, [activePanel, enqueuePreviews, selectedImage?.isReady, selectedImage?.path, wantedPresets]);

  const handleApplyPreset = (preset: Preset) => {
    if (activePresetId === preset.id) {
      setActivePresetId(null);
      if (baseAdjustments) {
        setAdjustments(baseAdjustments);
      }
      setBaseAdjustments(null);
      return;
    }

    setBaseAdjustments(adjustments);
    setActivePresetId(preset.id);
    setPresetIntensity(100);

    setAdjustments(
      (prevAdjustments: Adjustments) => ({
        ...prevAdjustments,
        ...preset.adjustments,
      }),
      `${t('editor.presets.types.preset')}: ${preset.name}`,
    );
  };

  const handleIntensityChange = useCallback(
    (preset: Preset, intensity: number) => {
      setPresetIntensity(intensity);
      const mixed = mixAdjustments(preset.adjustments, intensity);
      setAdjustments((prev: Adjustments) => ({
        ...prev,
        ...mixed,
      }));
    },
    [setAdjustments],
  );

  /** Hovering a preset shows it on the photo, as profiles and LUTs do. */
  const startPreview = (preset: Preset) =>
    setEditor((state) => ({ previewOverride: { ...state.adjustments, ...preset.adjustments } }));
  const endPreview = useCallback(() => setEditor({ previewOverride: null }), [setEditor]);
  useEffect(() => endPreview, [endPreview]);

  const handleNewGroupSave = (name: string) => {
    if (newGroupState.presetId) {
      movePresetToGroup(newGroupState.presetId, { type: 'new', name });
    } else {
      addFolder(name);
    }
    setNewGroupState({ isOpen: false, presetId: null });
  };

  const handleRenameFolderSave = (newName: string) => {
    if (renameFolder) {
      renameItem(renameFolder.id, newName);
    }
    setRenameFolder(null);
  };

  /** Delete Group asks first; its presets stay, in no group. */
  const confirmDeleteFolder = (folder: PresetFolder) => {
    useUIStore.getState().setUI({
      confirmModalState: {
        confirmText: t('editor.looks.deleteGroup'),
        confirmVariant: 'destructive',
        isOpen: true,
        message: t('editor.looks.deleteGroupMessage', { name: folder.name, count: folder.children.length }),
        onConfirm: () => deleteFolder(folder.id),
        title: t('editor.looks.deleteGroup'),
      },
    });
  };

  /** Opens the folder a preset was dropped into, so it stays in view. */
  const openFolder = (folderId: string) => {
    if (!isSectionOpen(folderId, false)) toggleSection(folderId, false);
  };

  const handleDragStart = (event: any) => {
    setActiveItem(allItemsMap.get(event.active.id) ?? null);
  };

  const handleDragEnd = (event: any) => {
    const { active, over } = event;
    setActiveItem(null);

    const activeId = active.id;
    const activeParentId = itemParentMap.get(activeId);
    const activeType = active.data.current?.type;

    if (!over) {
      if (activeParentId !== null) {
        movePreset(activeId, null, null);
      }
      return;
    }

    if (active.id === over.id) {
      return;
    }

    const overId = over.id;
    const overParentId = itemParentMap.get(overId);
    const overType = over.data.current?.type;

    const targetFolderId = overType === PresetListType.Folder ? overId : overParentId;

    if (activeType === PresetListType.Preset && targetFolderId) {
      if (activeParentId !== targetFolderId) {
        movePreset(activeId, targetFolderId);
        openFolder(targetFolderId);
      } else {
        reorderItems(activeId, overId);
      }
      return;
    }

    if (activeParentId !== null && !targetFolderId) {
      movePreset(activeId, null, overId);
      return;
    }

    if (activeParentId === null && !targetFolderId) {
      reorderItems(activeId, overId);
      return;
    }
  };

  const handleImportPresets = async () => {
    try {
      const selectedPaths = await openDialog({
        filters: [
          { name: t('editor.presets.dialog.allPresetFiles'), extensions: ['rrpreset', 'xmp', 'lrtemplate'] },
          { name: t('editor.presets.dialog.rapidRawPreset'), extensions: ['rrpreset'] },
          { name: t('editor.presets.dialog.legacyPreset'), extensions: ['xmp', 'lrtemplate'] },
        ],
        multiple: true,
        title: t('editor.presets.dialog.importPresetsTitle'),
      });

      if (!selectedPaths) {
        return;
      }

      const paths = Array.isArray(selectedPaths) ? selectedPaths : [selectedPaths];
      if (paths.length === 0) {
        return;
      }

      const { failures } = await importPresetsFromFiles(paths);

      failures.forEach((failure: PresetImportFailure) =>
        console.error(`Failed to import ${failure.fileName}: ${failure.error}`),
      );
    } catch (error) {
      console.error('Failed to import presets:', error);
    }
  };

  const handleExport = async (item: UserPreset) => {
    const isFolder = !!item.folder;
    const name = isFolder ? item.folder?.name : item.preset?.name;
    const itemsToExport = [item];

    try {
      const filePath = await saveDialog({
        defaultPath: `${name}.rrpreset`.replace(/[<>:"/\\|?*]/g, '_'),
        filters: [{ name: t('editor.presets.dialog.presetFile'), extensions: ['rrpreset'] }],
        title: t('editor.presets.dialog.exportTitle', {
          type: isFolder ? t('editor.presets.types.group') : t('editor.presets.types.preset'),
        }),
      });

      if (filePath) {
        await exportPresetsToFile(itemsToExport, filePath);
      }
    } catch (error) {
      console.error(`Failed to export ${isFolder ? PresetListType.Folder : PresetListType.Preset}:`, error);
    }
  };

  const handleExportAllPresets = async () => {
    if (presets.length === 0) {
      return;
    }
    try {
      const filePath = await saveDialog({
        defaultPath: 'all_presets.rrpreset',
        filters: [{ name: t('editor.presets.dialog.presetFile'), extensions: ['rrpreset'] }],
        title: t('editor.presets.dialog.exportAllTitle'),
      });

      if (filePath) {
        await exportPresetsToFile(presets, filePath);
      }
    } catch (error) {
      console.error('Failed to export all presets:', error);
    }
  };

  const handleFolderContextMenu = (event: React.MouseEvent, folder: PresetFolder) => {
    event.preventDefault();
    event.stopPropagation();
    showContextMenu(event.clientX, event.clientY, [
      {
        icon: Plus,
        label: t('editor.presets.menu.newPreset'),
        onClick: () => openLookDialog({ mode: 'new', type: 'preset', group: { type: 'existing', id: folder.id } }),
      },
      {
        icon: Edit,
        label: t('editor.looks.renameGroup'),
        onClick: () => setRenameFolder(folder),
      },
      {
        icon: FileDown,
        label: t('editor.presets.menu.exportGroup'),
        onClick: () => handleExport({ folder }),
      },
      { type: OPTION_SEPARATOR },
      {
        icon: Trash2,
        isDestructive: true,
        label: t('editor.looks.deleteGroup'),
        onClick: () => confirmDeleteFolder(folder),
      },
    ]);
  };

  const handlePresetContextMenu = (event: React.MouseEvent, preset: Preset) => {
    event.preventDefault();
    event.stopPropagation();
    const folderId = findPresetFolderId(presets, preset.id) ?? null;
    showContextMenu(event.clientX, event.clientY, [
      {
        icon: Save,
        label: t('editor.presets.menu.updateWithCurrent'),
        onClick: () => openLookDialog({ mode: 'updatePreset', preset }),
      },
      {
        icon: Settings2,
        label: t('editor.presets.menu.configurePreset'),
        onClick: () => openLookDialog({ mode: 'configurePreset', preset }),
      },
      {
        icon: FolderInput,
        label: t('editor.looks.moveToGroup'),
        submenu: [
          {
            label: t('editor.looks.noGroup'),
            checked: folderId === null,
            onClick: () => movePresetToGroup(preset.id, NO_GROUP),
          },
          ...folders.map((folder) => ({
            label: folder.name,
            checked: folderId === folder.id,
            onClick: () => movePresetToGroup(preset.id, { type: 'existing', id: folder.id }),
          })),
          { type: OPTION_SEPARATOR },
          {
            icon: FolderPlus,
            label: t('editor.looks.newGroup'),
            onClick: () => setNewGroupState({ isOpen: true, presetId: preset.id }),
          },
        ],
      },
      { type: OPTION_SEPARATOR },
      {
        icon: CopyPlus,
        label: t('editor.presets.menu.duplicatePreset'),
        onClick: () => duplicatePreset(preset.id),
      },
      {
        icon: FileDown,
        label: t('editor.presets.menu.exportPreset'),
        onClick: () => handleExport({ preset }),
      },
      { type: OPTION_SEPARATOR },
      {
        icon: Trash2,
        isDestructive: true,
        label: t('editor.presets.menu.deletePreset'),
        onClick: () => deleteItem(preset.id),
      },
    ]);
  };

  const handleBackgroundContextMenu = (event: React.MouseEvent) => {
    if (!event.currentTarget.contains(event.target as Node)) {
      return;
    }
    event.preventDefault();
    showContextMenu(event.clientX, event.clientY, [
      {
        icon: Plus,
        label: t('editor.presets.menu.newPreset'),
        onClick: () => openLookDialog({ mode: 'new', type: 'preset' }),
      },
      {
        icon: FolderPlus,
        label: t('editor.looks.newGroup'),
        onClick: () => setNewGroupState({ isOpen: true, presetId: null }),
      },
      { type: OPTION_SEPARATOR },
      {
        disabled: presets.length === 0,
        icon: SortAsc,
        label: t('editor.presets.menu.sortAll'),
        onClick: sortAllPresetsAlphabetically,
      },
    ]);
  };

  const supportsTooltip = (preset: Preset) => {
    const features = [];
    if (presetHoldsSection(preset, 'masks')) features.push(t('editor.presets.supports.masks'));
    if (presetHoldsSection(preset, 'geometry')) features.push(t('editor.presets.supports.cropTransform'));
    return features.length > 0 ? t('editor.presets.supports.label', { features: features.join(' + ') }) : undefined;
  };

  const renderPreset = (preset: Preset, isDraggable: boolean) => {
    const itemProps: BrowserItemProps = {
      name: preset.name,
      preview: previews[preset.id],
      isSelected: preset.id === activePresetId,
      isFavorite: favorites.has(preset.id),
      onToggleFavorite: () => toggleFavorite(preset.id),
      onClick: () => {
        endPreview();
        handleApplyPreset(preset);
      },
      onMouseEnter: () => startPreview(preset),
      onContextMenu: (event) => handlePresetContextMenu(event, preset),
      badges: presetBadges(preset),
      details: <PresetDetails preset={preset} />,
      tooltip: isGrid ? undefined : supportsTooltip(preset),
    };
    const item = isGrid ? <BrowserTile {...itemProps} /> : <BrowserRow {...itemProps} />;
    return isDraggable ? <DraggablePreset preset={preset}>{item}</DraggablePreset> : item;
  };

  const activePreset = activePresetId ? (allItemsMap.get(activePresetId)?.data as Preset | undefined) : undefined;
  // The Amount slider shows once: in the first open section that lists the applied preset.
  const activeSectionKey = activePresetId
    ? sections.find((section) => isOpen(section) && section.presets.some((preset) => preset.id === activePresetId))?.key
    : undefined;
  const activeContent = activePreset && (
    <div className="px-1 pt-1 pb-2 cursor-auto" onClick={(event) => event.stopPropagation()}>
      <Slider
        min={0}
        max={200}
        defaultValue={100}
        value={presetIntensity}
        onChange={(event: any) => handleIntensityChange(activePreset, Number(event.target.value))}
        onDragStateChange={handleDragStateChange}
        label={t('editor.presets.amount')}
        step={1}
      />
    </div>
  );

  const renderSectionItems = (section: PresetSection) => (
    <BrowserItems
      isGrid={isGrid}
      items={section.presets}
      getKey={(preset) => preset.id}
      renderItem={(preset) => renderPreset(preset, section.key !== FAVORITES_SECTION)}
      activeKey={section.key === activeSectionKey ? activePresetId : null}
      activeContent={activeContent}
    />
  );

  // The presets outside folders need no header when nothing else is listed.
  const hasOnlyUngrouped = sections.length === 1 && sections[0].key === UNGROUPED_SECTION;

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="flex flex-col h-full">
        <LooksHeader
          actions={
            <>
              <button
                className="p-2 rounded-full hover:bg-surface transition-colors"
                onClick={onNavigateToCommunity}
                data-tooltip={t('editor.presets.tooltips.explore')}
              >
                <Users size={18} />
              </button>
              <button
                className="p-2 rounded-full hover:bg-surface transition-colors"
                disabled={isLoading}
                onClick={handleImportPresets}
                data-tooltip={t('editor.presets.tooltips.import')}
              >
                <FileUp size={18} />
              </button>
              <button
                className="p-2 rounded-full hover:bg-surface transition-colors"
                disabled={presets.length === 0 || isLoading}
                onClick={handleExportAllPresets}
                data-tooltip={t('editor.presets.tooltips.export')}
              >
                <FileDown size={18} />
              </button>
              <button
                className="p-2 rounded-full hover:bg-surface transition-colors"
                disabled={isLoading}
                onClick={() => openLookDialog({ mode: 'new', type: 'preset' })}
                data-tooltip={t('editor.presets.tooltips.saveNew')}
              >
                <Plus size={18} />
              </button>
            </>
          }
        />

        {presets.length > 0 && (
          <BrowserToolbar
            query={query}
            onQueryChange={setQuery}
            placeholder={t('editor.looks.searchPresets')}
            isGrid={isGrid}
            onGridChange={setGrid}
          />
        )}

        <div
          className={`grow overflow-y-auto p-4 compact:p-2 space-y-2 compact:space-y-1 rounded-lg transition-colors ${
            isRootOver ? 'bg-surface-hover' : ''
          }`}
          onContextMenu={handleBackgroundContextMenu}
          onMouseLeave={endPreview}
          ref={setRootNodeRef}
        >
          {isLoading && presets.length === 0 && (
            <Text
              as="div"
              variant={TextVariants.heading}
              color={TextColors.secondary}
              weight={TextWeights.normal}
              className="text-center mt-4"
            >
              <Loader2 size={14} className="animate-spin inline-block mr-2" /> {t('editor.presets.status.loading')}
            </Text>
          )}
          {!isLoading && presets.length === 0 ? (
            <div className="text-center text-text-secondary flex flex-col items-center gap-4 compact:gap-2 pt-4 compact:pt-2">
              <Text className="max-w-xs">{t('editor.presets.status.empty')}</Text>
              <Button variant="secondary" onClick={onNavigateToCommunity}>
                <Users size={16} className="mr-2" />
                {t('editor.presets.status.getCommunity')}
              </Button>
            </div>
          ) : isSearching && sections.length === 0 ? (
            <Text color={TextColors.secondary} className="text-center pt-4">
              {t('editor.looks.noMatches')}
            </Text>
          ) : hasOnlyUngrouped ? (
            renderSectionItems(sections[0])
          ) : (
            sections.map((section) => {
              const sectionIsOpen = isOpen(section);
              const onToggle = () => toggleSection(section.key, section.defaultOpen);
              if (section.folder) {
                return (
                  <FolderSection
                    key={section.key}
                    folder={section.folder}
                    isOpen={sectionIsOpen}
                    onToggle={onToggle}
                    onContextMenu={(event) => handleFolderContextMenu(event, section.folder!)}
                  >
                    {section.presets.length > 0 ? (
                      renderSectionItems(section)
                    ) : (
                      <Text variant={TextVariants.small} color={TextColors.secondary} className="px-2">
                        {t('editor.looks.emptyGroup')}
                      </Text>
                    )}
                  </FolderSection>
                );
              }
              return (
                <BrowserSection
                  key={section.key}
                  count={section.presets.length}
                  icon={
                    section.key === FAVORITES_SECTION ? (
                      <Star size={14} className="text-accent" fill="currentColor" />
                    ) : undefined
                  }
                  isOpen={sectionIsOpen}
                  onToggle={onToggle}
                  title={section.title}
                >
                  {renderSectionItems(section)}
                </BrowserSection>
              );
            })
          )}
        </div>

        <CreateFolderModal
          isOpen={newGroupState.isOpen}
          onClose={() => setNewGroupState({ isOpen: false, presetId: null })}
          onSave={handleNewGroupSave}
          placeholder={t('editor.looks.newGroupPlaceholder')}
          title={t('editor.looks.newGroupTitle')}
        />
        <RenameFolderModal
          currentName={renameFolder?.name ?? ''}
          isOpen={renameFolder !== null}
          onClose={() => setRenameFolder(null)}
          onSave={handleRenameFolderSave}
          title={t('editor.looks.renameGroupTitle')}
        />
      </div>
      <DragOverlay>
        {activeItem ? (
          activeItem.type === PresetListType.Preset ? (
            <div className="w-64">
              <BrowserRow
                name={activeItem.data.name}
                preview={previews[activeItem.data.id]}
                isSelected={false}
                isFavorite={favorites.has(activeItem.data.id)}
                onToggleFavorite={() => undefined}
                onClick={() => undefined}
              />
            </div>
          ) : (
            <div className="flex items-center gap-2 p-2 rounded-lg bg-surface w-64">
              <FolderIcon size={16} />
              <Text color={TextColors.primary} weight={TextWeights.medium} className="grow truncate select-none">
                {activeItem.data.name}
              </Text>
            </div>
          )
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
