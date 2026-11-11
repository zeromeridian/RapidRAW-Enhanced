import { RefObject } from 'react';
import { create } from 'zustand';
import debounce from 'lodash.debounce';
import {
  Adjustments,
  INITIAL_ADJUSTMENTS,
  MaskContainer,
  AiPatch,
  CropGeometry,
  pickCropGeometry,
} from '../utils/adjustments';
import { SelectedImage, WaveformData, BrushSettings } from '../components/ui/AppProperties';
import { ChannelConfig } from '../components/adjustments/Curves';
import { ImageDimensions } from '../hooks/useImageRenderSize';
import type { PhotoSwapPhase } from '../hooks/usePhotoSwap';
import { ToolType } from '../components/panel/right/Masks';
import { OverlayMode } from '../components/panel/right/CropPanel';
import type { SpeedEditTarget } from '../components/ui/Slider';
import { describeHistoryChange } from '../utils/editHistory';
import type { TargetedAdjustment } from '../utils/targetedAdjustment';

/** Undo history keeps at most this many steps; the oldest is dropped first. */
const MAX_HISTORY_STEPS = 50;

export interface InteractivePatch {
  url: string;
  normX: number;
  normY: number;
  normW: number;
  normH: number;
}

interface BaseRenderSize extends ImageDimensions {
  containerHeight: number;
  containerWidth: number;
  offsetX: number;
  offsetY: number;
}

interface EditorState {
  // Core Image & Adjustments
  selectedImage: SelectedImage | null;
  adjustments: Adjustments;
  previewOverride: Adjustments | null;
  /** Guided Perspective guides are being drawn on the image. */
  isGuidedPerspectiveActive: boolean;

  // History State
  history: Adjustments[];
  /** One readable name per history step, recorded when it is pushed; the initial step is ''. */
  historyLabels: string[];
  historyIndex: number;

  // Previews & Overlays
  finalPreviewUrl: string | null;
  uncroppedAdjustedPreviewUrl: string | null;
  transformedOriginalUrl: string | null;
  interactivePatch: InteractivePatch | null;
  showOriginal: boolean;
  maskOverlayVisible: boolean;

  // Analytics
  histogram: ChannelConfig | null;
  waveform: WaveformData | null;
  isWaveformVisible: boolean;
  activeWaveformChannel: string;
  waveformHeight: number;

  // Interaction State
  isSliderDragging: boolean;
  speedEditTarget: RefObject<SpeedEditTarget | null> | null;
  isSpeedEditActive: boolean;
  zoom: number;
  displaySize: ImageDimensions;
  previewSize: ImageDimensions;
  baseRenderSize: BaseRenderSize;
  originalSize: ImageDimensions;

  // Tools State
  isRotationActive: boolean;
  overlayMode: OverlayMode;
  overlayRotation: number;
  isStraightenActive: boolean;
  isWbPickerActive: boolean;
  isRelightPickerActive: boolean;
  /** The colour mixer or tone curve pipette acting on the photo, or null. */
  targetedAdjustment: TargetedAdjustment | null;
  /** The Point Color the Color Mixer edits, and whether the preview shows its range only. */
  activePointColorId: string | null;
  isPointColorRangeVisualized: boolean;
  activeRelightLightId: string | null;
  liveRotation: number | null;
  /** The Crop panel's values when it was opened (null outside Crop); Escape restores them. */
  cropSessionSnapshot: { path: string | null; geometry: CropGeometry } | null;
  brushSettings: BrushSettings | null;

  // Masks & AI
  activeMaskContainerId: string | null;
  activeMaskId: string | null;
  activeAiPatchContainerId: string | null;
  activeAiSubMaskId: string | null;
  isMaskControlHovered: boolean;
  isGeneratingAiMask: boolean;
  isGeneratingAi: boolean;
  aiDenoiseProgress: Record<string, number>;
  isAIConnectorConnected: boolean;
  hasRenderedFirstFrame: boolean;
  photoSwapPhase: PhotoSwapPhase;
  patchesSentToBackend: Set<string>;

  // Clipboard
  copiedSectionAdjustments: any | null;
  copiedMask: MaskContainer | null;
  copiedAdjustments: Adjustments | null;

  // Actions
  setEditor: (updater: Partial<EditorState> | ((state: EditorState) => Partial<EditorState>)) => void;
  pushHistory: (newAdjustments: Adjustments, label?: string) => void;
  undo: () => void;
  redo: () => void;
  resetHistory: (initialState: Adjustments) => void;
  goToHistoryIndex: (index: number) => void;
}

type CanvasToolState = Pick<EditorState, 'isWbPickerActive' | 'isRelightPickerActive' | 'targetedAdjustment'>;

/** Turns every tool that takes clicks on the photo off, except `activeTool` if given (one is active at a time). */
export const canvasToolState = (activeTool: Partial<CanvasToolState> = {}): CanvasToolState => ({
  isWbPickerActive: false,
  isRelightPickerActive: false,
  targetedAdjustment: null,
  ...activeTool,
});

export const useEditorStore = create<EditorState>((set) => ({
  selectedImage: null,
  adjustments: INITIAL_ADJUSTMENTS,
  previewOverride: null,
  isGuidedPerspectiveActive: false,
  history: [INITIAL_ADJUSTMENTS],
  historyLabels: [''],
  historyIndex: 0,

  finalPreviewUrl: null,
  uncroppedAdjustedPreviewUrl: null,
  showOriginal: false,
  maskOverlayVisible: true,
  histogram: null,
  waveform: null,
  isWaveformVisible: false,
  activeWaveformChannel: 'luma',
  waveformHeight: 220,

  isSliderDragging: false,
  speedEditTarget: null,
  isSpeedEditActive: false,
  interactivePatch: null,
  activeMaskContainerId: null,
  activeMaskId: null,
  activeAiPatchContainerId: null,
  activeAiSubMaskId: null,

  zoom: 1,
  displaySize: { width: 0, height: 0 },
  previewSize: { width: 0, height: 0 },
  baseRenderSize: { width: 0, height: 0, offsetX: 0, offsetY: 0, containerWidth: 0, containerHeight: 0 },
  originalSize: { width: 0, height: 0 },

  isRotationActive: false,
  overlayMode: 'thirds',
  overlayRotation: 0,
  transformedOriginalUrl: null,
  isStraightenActive: false,
  isWbPickerActive: false,
  isRelightPickerActive: false,
  targetedAdjustment: null,
  activePointColorId: null,
  isPointColorRangeVisualized: false,
  activeRelightLightId: null,
  liveRotation: null,
  cropSessionSnapshot: null,

  copiedSectionAdjustments: null,
  copiedMask: null,
  brushSettings: { size: 50, feather: 50, tool: ToolType.Brush },
  copiedAdjustments: null,

  isGeneratingAiMask: false,
  isAIConnectorConnected: false,
  isGeneratingAi: false,
  aiDenoiseProgress: {},
  isMaskControlHovered: false,
  hasRenderedFirstFrame: false,
  photoSwapPhase: 'idle',
  patchesSentToBackend: new Set<string>(),

  setEditor: (updater) => set((state) => (typeof updater === 'function' ? updater(state) : updater)),

  pushHistory: (newAdj, label) =>
    set((state) => {
      const newHistory = state.history.slice(0, state.historyIndex + 1);
      const newLabels = state.historyLabels.slice(0, state.historyIndex + 1);
      newLabels.push(label || describeHistoryChange(state.history[state.historyIndex], newAdj));
      newHistory.push(newAdj);
      if (newHistory.length > MAX_HISTORY_STEPS) {
        newHistory.shift();
        newLabels.shift();
      }
      return { history: newHistory, historyLabels: newLabels, historyIndex: newHistory.length - 1 };
    }),

  undo: () => {
    debouncedSetHistory.flush();
    set((state) => {
      if (state.historyIndex > 0) {
        const newIndex = state.historyIndex - 1;
        return { historyIndex: newIndex, adjustments: state.history[newIndex] };
      }
      return state;
    });
  },

  redo: () => {
    debouncedSetHistory.flush();
    set((state) => {
      if (state.historyIndex < state.history.length - 1) {
        const newIndex = state.historyIndex + 1;
        return { historyIndex: newIndex, adjustments: state.history[newIndex] };
      }
      return state;
    });
  },

  resetHistory: (initialState) =>
    set((state) => ({
      history: [initialState],
      historyLabels: [''],
      historyIndex: 0,
      adjustments: initialState,
      // A photo loaded while Crop is open starts a new crop session from its own values.
      ...(state.cropSessionSnapshot
        ? {
            cropSessionSnapshot: {
              path: state.selectedImage?.path ?? null,
              geometry: pickCropGeometry(initialState),
            },
          }
        : {}),
    })),

  goToHistoryIndex: (index) => {
    debouncedSetHistory.flush();
    set((state) => {
      if (index >= 0 && index < state.history.length) {
        return { historyIndex: index, adjustments: state.history[index] };
      }
      return state;
    });
  },
}));

/**
 * Records an edit in the undo history once it settles. Undo, redo, and history jumps flush it
 * first, so an edit made just before them is recorded instead of skipped.
 */
export const debouncedSetHistory = debounce((newAdj: Adjustments, label?: string) => {
  useEditorStore.getState().pushHistory(newAdj, label);
}, 500);

/** Whether undo has something to restore: an earlier entry, or an edit not yet recorded. */
export const canUndoEdit = (state: Pick<EditorState, 'adjustments' | 'history' | 'historyIndex'>) =>
  state.historyIndex > 0 || state.adjustments !== state.history[state.historyIndex];
