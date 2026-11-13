import { create } from 'zustand';
import {
  CollapsibleSectionsState,
  ImageFile,
  LibraryViewMode,
  Panel,
  UiVisibility,
  CullingSuggestions,
} from '../components/ui/AppProperties';
import { pickCropGeometry } from '../utils/adjustments';
import { useEditorStore } from './useEditorStore';

/** Opening Crop records its values for Escape to restore; leaving Crop forgets them. */
const updateCropSession = (current: Panel | null, next: Panel | null) => {
  if (next === current) return;
  const { selectedImage, adjustments, setEditor } = useEditorStore.getState();
  if (next === Panel.Crop) {
    setEditor({
      cropSessionSnapshot: { path: selectedImage?.path ?? null, geometry: pickCropGeometry(adjustments) },
    });
  } else if (current === Panel.Crop) {
    setEditor({ cropSessionSnapshot: null });
  }
};

const RIGHT_PANEL_ORDER = [
  Panel.Metadata,
  Panel.Adjustments,
  Panel.Favorites,
  Panel.Crop,
  Panel.Geometry,
  Panel.LensCorrection,
  Panel.Masks,
  Panel.Ai,
  Panel.Tagging,
  Panel.Presets,
  Panel.Export,
];

export type LightsOutMode = 'off' | 'dim' | 'out';

/** Right panels next to the Library grid. */
export type LibraryPanel = 'metadata' | 'tagging' | 'export';

/** Develop's right panels that the top bar switches to; every other Develop panel is an editing tool. */
export const DEVELOP_PANEL_BY_LIBRARY_PANEL: Record<LibraryPanel, Panel> = {
  metadata: Panel.Metadata,
  tagging: Panel.Tagging,
  export: Panel.Export,
};
const isEditingPanel = (panel: Panel) => !Object.values(DEVELOP_PANEL_BY_LIBRARY_PANEL).includes(panel);

/**
 * The Library right panel that is shown. Export is opened per task and covers the others; Metadata
 * or Tagging stays open, also across restarts, until hidden, and only next to the grid.
 */
export const getLibraryPanel = (
  ui: Pick<UIState, 'isLibraryExportPanelVisible' | 'uiVisibility'>,
  isLibraryGridShown: boolean,
): LibraryPanel | null => {
  if (ui.isLibraryExportPanelVisible) return 'export';
  if (!isLibraryGridShown) return null;
  if (ui.uiVisibility.libraryMetadata) return 'metadata';
  return ui.uiVisibility.libraryTagging ? 'tagging' : null;
};

export interface ConfirmModalState {
  confirmText?: string;
  confirmVariant?: string;
  isOpen: boolean;
  message?: string;
  onConfirm?(): void;
  title?: string;
}

export interface CollageModalState {
  isOpen: boolean;
  sourceImages: Array<Pick<ImageFile, 'path'>>;
}

export interface PanoramaModalState {
  error: string | null;
  finalImageBase64: string | null;
  isOpen: boolean;
  isProcessing: boolean;
  progressMessage: string | null;
  stitchingSourcePaths: Array<string>;
}

export interface HdrModalState {
  error: string | null;
  finalImageBase64: string | null;
  isOpen: boolean;
  isProcessing: boolean;
  progressMessage: string | null;
  stitchingSourcePaths: Array<string>;
}

export interface DenoiseModalState {
  isOpen: boolean;
  isProcessing: boolean;
  previewBase64: string | null;
  originalBase64?: string | null;
  error: string | null;
  targetPaths: string[];
  progressMessage: string | null;
  isRaw: boolean;
}

export interface NegativeConversionModalState {
  isOpen: boolean;
  targetPaths: Array<string>;
}

export interface CullingModalState {
  isOpen: boolean;
  suggestions: CullingSuggestions | null;
  progress: { current: number; total: number; stage: string } | null;
  error: string | null;
  pathsToCull: Array<string>;
}

export interface PresetBatchTarget {
  folderPaths: string[];
  imagePaths: string[];
  includeSubfolders: boolean;
}

export interface PresetBatchModalState {
  isOpen: boolean;
  target: PresetBatchTarget;
}

export interface LightroomImportModalState {
  isOpen: boolean;
  targetPaths: string[];
}

export interface CaptureTimeStackModalState {
  isOpen: boolean;
  targetPaths: string[];
}

interface UIState {
  // View & Layout
  activeView: string;
  isFullScreen: boolean;
  isWindowFullScreen: boolean;
  isInstantTransition: boolean;
  isLayoutReady: boolean;
  // Horizontal extent of the main pane in window pixels, published by the mounted BottomBar so the
  // title bar can align its controls with the pane; null when no BottomBar is shown.
  mainPaneBounds: { left: number; right: number } | null;
  uiVisibility: UiVisibility;
  isLibraryExportPanelVisible: boolean;
  isSettingsOpen: boolean;
  lightsOutMode: LightsOutMode;

  // Dimensions
  leftPanelWidth: number;
  rightPanelWidth: number;
  bottomPanelHeight: number;
  compactEditorPanelHeightOverride: number | null;

  // Right Panel
  activeRightPanel: Panel | null;
  renderedRightPanel: Panel | null;
  // The editing tool (Adjustments, Crop, Masks, ...) last shown in Develop, reopened by the Develop switch.
  lastEditingPanel: Panel;
  slideDirection: number;
  collapsibleSectionsState: CollapsibleSectionsState;

  // Modals & Dialogs
  isCreateFolderModalOpen: boolean;
  isRenameFolderModalOpen: boolean;
  isRenameFileModalOpen: boolean;
  renameTargetPaths: Array<string>;
  isImportModalOpen: boolean;
  isCopyPasteSettingsModalOpen: boolean;
  importTargetFolder: string | null;
  importSourcePaths: Array<string>;
  folderActionTarget: string | null;

  // Album Modals
  isCreateAlbumModalOpen: boolean;
  isCreateAlbumGroupModalOpen: boolean;
  isRenameAlbumModalOpen: boolean;
  albumActionTarget: string | null;

  // Complex Modal States
  confirmModalState: ConfirmModalState;
  panoramaModalState: PanoramaModalState;
  hdrModalState: HdrModalState;
  negativeModalState: NegativeConversionModalState;
  denoiseModalState: DenoiseModalState;
  cullingModalState: CullingModalState;
  collageModalState: CollageModalState;
  presetBatchModalState: PresetBatchModalState;
  lightroomImportModalState: LightroomImportModalState;
  captureTimeStackModalState: CaptureTimeStackModalState;

  // Actions
  setUI: (updater: Partial<UIState> | ((state: UIState) => Partial<UIState>)) => void;
  setRightPanel: (panel: Panel | null) => void;
  // Shows a Library right panel in place of the one shown, or hides it when it is the one shown.
  toggleLibraryPanel: (panel: LibraryPanel) => void;
  customEscapeHandler: (() => void) | null;
  setCustomEscapeHandler: (handler: (() => void) | null) => void;
  imageSelectHandler: ((path: string) => void) | null;
  setImageSelectHandler: (handler: ((path: string) => void) | null) => void;
  keywordSelectHandler: ((tag: string) => void) | null;
  setKeywordSelectHandler: (handler: ((tag: string) => void) | null) => void;
  // Open state of the Tagging panel sections that the user has toggled, by section id
  taggingSectionsOpen: Record<string, boolean>;
  toggleTaggingSection: (section: string, defaultOpen: boolean) => void;
  searchFocusRequest: number;
  requestSearchFocus: () => void;
  selectionClearRequest: number;
  requestSelectionClear: () => void;
  cycleLightsOut: (direction?: 1 | -1) => void;
}

/** Whether a modal dialog owns the keyboard. */
export const isModalOpen = (ui: UIState) =>
  ui.isCreateFolderModalOpen ||
  ui.isRenameFolderModalOpen ||
  ui.isRenameFileModalOpen ||
  ui.isImportModalOpen ||
  ui.isCopyPasteSettingsModalOpen ||
  ui.confirmModalState.isOpen ||
  ui.panoramaModalState.isOpen ||
  ui.cullingModalState.isOpen ||
  ui.collageModalState.isOpen ||
  ui.lightroomImportModalState.isOpen ||
  ui.denoiseModalState.isOpen ||
  ui.negativeModalState.isOpen;

export const DEFAULT_LEFT_PANEL_WIDTH = 240;
export const DEFAULT_RIGHT_PANEL_WIDTH = 296;
export const DEFAULT_BOTTOM_PANEL_HEIGHT = 144;

export const useUIStore = create<UIState>((set, get) => ({
  activeView: 'library',
  isFullScreen: false,
  isWindowFullScreen: false,
  isInstantTransition: false,
  isLayoutReady: false,
  mainPaneBounds: null,
  uiVisibility: { folderTree: true, filmstrip: true, quickFilter: false, editorExif: true },
  isLibraryExportPanelVisible: false,
  isSettingsOpen: false,
  lightsOutMode: 'off',

  leftPanelWidth: DEFAULT_LEFT_PANEL_WIDTH,
  rightPanelWidth: DEFAULT_RIGHT_PANEL_WIDTH,
  bottomPanelHeight: DEFAULT_BOTTOM_PANEL_HEIGHT,
  compactEditorPanelHeightOverride: null,

  activeRightPanel: Panel.Adjustments,
  renderedRightPanel: Panel.Adjustments,
  lastEditingPanel: Panel.Adjustments,
  slideDirection: 1,
  collapsibleSectionsState: { basic: true, color: false, curves: true, details: false, effects: false },

  isCreateFolderModalOpen: false,
  isRenameFolderModalOpen: false,
  isRenameFileModalOpen: false,
  renameTargetPaths: [],
  isImportModalOpen: false,
  isCopyPasteSettingsModalOpen: false,
  importTargetFolder: null,
  importSourcePaths: [],
  folderActionTarget: null,

  isCreateAlbumModalOpen: false,
  isCreateAlbumGroupModalOpen: false,
  isRenameAlbumModalOpen: false,
  albumActionTarget: null,

  confirmModalState: { isOpen: false },
  panoramaModalState: {
    error: null,
    finalImageBase64: null,
    isOpen: false,
    isProcessing: false,
    progressMessage: '',
    stitchingSourcePaths: [],
  },
  hdrModalState: {
    error: null,
    finalImageBase64: null,
    isOpen: false,
    isProcessing: false,
    progressMessage: '',
    stitchingSourcePaths: [],
  },
  negativeModalState: { isOpen: false, targetPaths: [] },
  denoiseModalState: {
    isOpen: false,
    isProcessing: false,
    previewBase64: null,
    error: null,
    targetPaths: [],
    progressMessage: null,
    isRaw: false,
  },
  cullingModalState: { isOpen: false, suggestions: null, progress: null, error: null, pathsToCull: [] },
  collageModalState: { isOpen: false, sourceImages: [] },
  presetBatchModalState: {
    isOpen: false,
    target: { folderPaths: [], imagePaths: [], includeSubfolders: false },
  },
  lightroomImportModalState: { isOpen: false, targetPaths: [] },
  captureTimeStackModalState: { isOpen: false, targetPaths: [] },

  setUI: (updater) => set((state) => (typeof updater === 'function' ? updater(state) : updater)),

  toggleLibraryPanel: (panel) =>
    set((state) => {
      const isShown = getLibraryPanel(state, true) === panel;
      if (panel === 'export') return { isLibraryExportPanelVisible: !isShown };
      return {
        isLibraryExportPanelVisible: false,
        uiVisibility: {
          ...state.uiVisibility,
          libraryMetadata: panel === 'metadata' && !isShown,
          libraryTagging: panel === 'tagging' && !isShown,
        },
      };
    }),

  setRightPanel: (panelId) => {
    const current = get().activeRightPanel;
    updateCropSession(current, panelId === current ? null : panelId);
    if (panelId === current) {
      set({ activeRightPanel: null });
    } else {
      const currentIndex = current ? RIGHT_PANEL_ORDER.indexOf(current) : -1;
      const newIndex = panelId ? RIGHT_PANEL_ORDER.indexOf(panelId) : -1;
      set({
        slideDirection: newIndex > currentIndex ? 1 : -1,
        activeRightPanel: panelId,
        renderedRightPanel: panelId,
        ...(panelId && isEditingPanel(panelId) && { lastEditingPanel: panelId }),
      });
    }
  },

  customEscapeHandler: null,
  setCustomEscapeHandler: (handler) => set({ customEscapeHandler: handler }),
  imageSelectHandler: null,
  setImageSelectHandler: (handler) => set({ imageSelectHandler: handler }),
  keywordSelectHandler: null,
  setKeywordSelectHandler: (handler) => set({ keywordSelectHandler: handler }),
  taggingSectionsOpen: {},
  toggleTaggingSection: (section, defaultOpen) =>
    set((state) => ({
      taggingSectionsOpen: {
        ...state.taggingSectionsOpen,
        [section]: !(state.taggingSectionsOpen[section] ?? defaultOpen),
      },
    })),

  searchFocusRequest: 0,
  requestSearchFocus: () => set((state) => ({ searchFocusRequest: state.searchFocusRequest + 1 })),
  selectionClearRequest: 0,
  requestSelectionClear: () => set((state) => ({ selectionClearRequest: state.selectionClearRequest + 1 })),
  cycleLightsOut: (direction = 1) =>
    set((state) => {
      const modes: LightsOutMode[] = ['off', 'dim', 'out'];
      const currentIndex = modes.indexOf(state.lightsOutMode);
      return { lightsOutMode: modes[(currentIndex + direction + modes.length) % modes.length] };
    }),
}));
