import { ExportPreset } from './ExportImportProperties';
import { Adjustments } from '../../utils/adjustments';
import { ToolType } from '../panel/right/Masks';

export const GLOBAL_KEYS = [
  ' ',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'f',
  'b',
  'a',
  's',
  'd',
  'r',
  'm',
  'k',
  'p',
  'i',
  'e',
  '0',
  '1',
  '2',
  '3',
  '4',
  '5',
  'Enter',
];
export const OPTION_SEPARATOR = 'separator';

export enum Invokes {
  AddTagForPaths = 'add_tag_for_paths',
  ApplyAdjustments = 'apply_adjustments',
  ApplyAdjustmentsToPaths = 'apply_adjustments_to_paths',
  ApplyAutoAdjustmentsToPaths = 'apply_auto_adjustments_to_paths',
  ApplyDenoising = 'apply_denoising',
  BatchExportImages = 'batch_export_images',
  CalculateAutoAdjustments = 'calculate_auto_adjustments',
  CancelExport = 'cancel_export',
  CheckAIConnectorStatus = 'check_ai_connector_status',
  ClearAllSidecars = 'clear_all_sidecars',
  ClearAiTags = 'clear_ai_tags',
  ClearAllTags = 'clear_all_tags',
  ClearThumbnailCache = 'clear_thumbnail_cache',
  CopyFiles = 'copy_files',
  CreateFolder = 'create_folder',
  CreateVirtualCopy = 'create_virtual_copy',
  CullImages = 'cull_images',
  DeleteFolder = 'delete_folder',
  DuplicateFile = 'duplicate_file',
  EstimateBatchExportSize = 'estimate_batch_export_size',
  EstimateExportSize = 'estimate_export_size',
  ExportImage = 'export_image',
  FrontendLog = 'frontend_log',
  GenerateAiForegroundMask = 'generate_ai_foreground_mask',
  GenerateAiSkyMask = 'generate_ai_sky_mask',
  GenerateAiSubjectMask = 'generate_ai_subject_mask',
  GenerateFullscreenPreview = 'generate_fullscreen_preview',
  GeneratePreviewForPath = 'generate_preview_for_path',
  GenerateMaskOverlay = 'generate_mask_overlay',
  GeneratePresetPreview = 'generate_preset_preview',
  GenerateThumbnailsProgressive = 'generate_thumbnails_progressive',
  GenerateUncroppedPreview = 'generate_uncropped_preview',
  GetFolderTree = 'get_folder_tree',
  GetFolderChildren = 'get_folder_children',
  GetLogFilePath = 'get_log_file_path',
  GetOrCreateInternalLibraryRoot = 'get_or_create_internal_library_root',
  GetPinnedFolderTrees = 'get_pinned_folder_trees',
  GetSupportedFileTypes = 'get_supported_file_types',
  HandleExportPresetsToFile = 'handle_export_presets_to_file',
  HandleImportPresetsFromFile = 'handle_import_presets_from_file',
  HandleImportLegacyPresetsFromFile = 'handle_import_legacy_presets_from_file',
  ImportFiles = 'import_files',
  InvokeGenerativeReplace = 'invoke_generative_replace',
  InvokeGenerativeReplaseWithMaskDef = 'invoke_generative_replace_with_mask_def',
  ListImagesInDir = 'list_images_in_dir',
  ListImagesRecursive = 'list_images_recursive',
  LoadImage = 'load_image',
  LoadMetadata = 'load_metadata',
  LoadPresets = 'load_presets',
  LoadSettings = 'load_settings',
  MoveFiles = 'move_files',
  ReadExifForPaths = 'read_exif_for_paths',
  RemoveTagForPaths = 'remove_tag_for_paths',
  RenameFiles = 'rename_files',
  RenameFolder = 'rename_folder',
  ResetAdjustmentsForPaths = 'reset_adjustments_for_paths',
  SaveMetadataAndUpdateThumbnail = 'save_metadata_and_update_thumbnail',
  SaveCollage = 'save_collage',
  SaveDenoisedImage = 'save_denoised_image',
  SavePanorama = 'save_panorama',
  SaveHdr = 'save_hdr',
  SavePresets = 'save_presets',
  SaveSettings = 'save_settings',
  SetColorLabelForPaths = 'set_color_label_for_paths',
  SetRatingForPaths = 'set_rating_for_paths',
  ShowInFinder = 'show_in_finder',
  StartBackgroundIndexing = 'start_background_indexing',
  StitchPanorama = 'stitch_panorama',
  MergeHdr = 'merge_hdr',
  TestAIConnectorConnection = 'test_ai_connector_connection',
  UpdateWgpuTransform = 'update_wgpu_transform',
  FetchCommunityPresets = 'fetch_community_presets',
  GenerateAllCommunityPreviews = 'generate_all_community_previews',
  SaveCommunityPreset = 'save_community_preset',
  SaveTempFile = 'save_temp_file',
}

export enum Panel {
  Adjustments = 'adjustments',
  Ai = 'ai',
  Crop = 'crop',
  Export = 'export',
  Masks = 'masks',
  Metadata = 'metadata',
  Presets = 'presets',
}

export enum RawStatus {
  All = 'all',
  NonRawOnly = 'nonRawOnly',
  RawOnly = 'rawOnly',
  RawOverNonRaw = 'rawOverNonRaw',
}

export enum SortDirection {
  Ascending = 'asc',
  Descening = 'desc',
}

export enum Theme {
  Arctic = 'arctic',
  Blue = 'blue',
  Dark = 'dark',
  Grey = 'grey',
  Light = 'light',
  MutedGreen = 'muted-green',
  Sepia = 'sepia',
  Snow = 'snow',
}

export enum ThumbnailAspectRatio {
  Cover = 'cover',
  Contain = 'contain',
}

export interface AppSettings {
  aiConnectorAddress?: string;
  decorations?: any;
  editorPreviewResolution?: number;
  enableZoomHifi?: boolean;
  useFullDpiRendering?: boolean;
  highResZoomMultiplier?: number;
  enableLivePreviews?: boolean;
  livePreviewQuality?: string;
  enableAiTagging?: boolean;
  enableExifReading?: boolean;
  filterCriteria?: FilterCriteria;
  lastFolderState?: any;
  pinnedFolders?: any;
  lastRootPath: string | null;
  libraryViewMode?: LibraryViewMode;
  sortCriteria?: SortCriteria;
  theme: Theme;
  thumbnailSize?: ThumbnailSize;
  thumbnailAspectRatio?: ThumbnailAspectRatio;
  uiVisibility?: UiVisibility;
  adjustmentVisibility?: { [key: string]: boolean };
  activeTreeSection?: string | null;
  rawHighlightCompression?: number;
  processingBackend?: string;
  linuxGpuOptimization?: boolean;
  exportPresets?: ExportPreset[];
  myLenses?: any;
  enableFolderImageCounts?: boolean;
  linearRawMode?: string;
  enableXmpSync?: boolean;
  createXmpIfMissing?: boolean;
  isWaveformVisible?: boolean;
  waveformHeight?: number;
  activeWaveformChannel?: string;
  useWgpuRenderer?: boolean;
  canvasInputMode?: 'mouse' | 'trackpad';
  zoomSpeedMultiplier?: number;
  keybindings?: { [actionKey: string]: string[] };
}

export interface BrushSettings {
  feather: number;
  size: number;
  tool: ToolType;
}

export enum LibraryViewMode {
  Flat = 'flat',
  Recursive = 'recursive',
}

export interface FilterCriteria {
  colors: Array<string>;
  rating: number;
  rawStatus: RawStatus;
}

export interface Folder {
  children: any;
  id?: string | undefined;
  name?: string | undefined;
  imageCount?: number;
}

export interface ImageFile {
  is_edited: boolean;
  modified: number;
  path: string;
  rating: number;
  tags: Array<string> | null;
  exif: { [key: string]: string } | null;
  is_virtual_copy: boolean;
}

export interface Option {
  color?: string;
  disabled?: boolean;
  icon?: any;
  isDestructive?: boolean;
  label?: string;
  onClick?(): void;
  onRightClick?(): void;
  submenu?: any;
  type?: string;
}

export enum Orientation {
  Horizontal = 'horizontal',
  Vertical = 'vertical',
}

export interface Preset {
  adjustments: Partial<Adjustments>;
  folder?: Folder;
  id: string;
  name: string;
  includeMasks?: boolean;
  includeCropTransform?: boolean;
  presetType?: 'tool' | 'style';
}

export interface Progress {
  completed?: number;
  current?: number;
  total: number;
}

export interface SelectedImage {
  exif: any;
  height: number;
  isRaw: boolean;
  isReady: boolean;
  metadata?: any;
  original_base64?: string;
  originalUrl: string | null;
  path: string;
  thumbnailUrl: string;
  width: number;
}

export interface SortCriteria {
  key: string;
  label?: string;
  order: string;
}

export interface SupportedTypes {
  nonRaw: Array<string>;
  raw: Array<string>;
}

export enum ThumbnailSize {
  Large = 'large',
  Medium = 'medium',
  Small = 'small',
  List = 'list',
}

export interface TransformState {
  positionX: number;
  positionY: number;
  scale: number;
}

export interface UiVisibility {
  folderTree: boolean;
  filmstrip: boolean;
}

export interface WaveformData {
  blue: string;
  green: string;
  height: number;
  luma: string;
  red: string;
  rgb: string;
  parade: string;
  vectorscope: string;
  width: number;
}

export interface CullingSettings {
  similarityThreshold: number;
  blurThreshold: number;
  groupSimilar: boolean;
  filterBlurry: boolean;
}

export interface ImageAnalysisResult {
  path: string;
  qualityScore: number;
  sharpnessMetric: number;
  centerFocusMetric: number;
  exposureMetric: number;
  width: number;
  height: number;
}

export interface CullGroup {
  representative: ImageAnalysisResult;
  duplicates: ImageAnalysisResult[];
}

export interface CullingSuggestions {
  similarGroups: CullGroup[];
  blurryImages: ImageAnalysisResult[];
  failedPaths: string[];
}

export interface KeybindingDefinition {
  actionKey: string;
  description: string;
  defaultCombo: string[];
  section: 'library' | 'view' | 'rating' | 'panels' | 'editing';
}

export interface ActionHandler {
  shouldFire?: () => boolean;
  execute: (event: KeyboardEvent) => void;
}

export const KEYBINDING_DEFINITIONS: KeybindingDefinition[] = [
  { actionKey: 'open_image', description: 'Open selected image', defaultCombo: ['Enter'], section: 'library' },
  { actionKey: 'copy_files', description: 'Copy selected file(s)', defaultCombo: ['ctrl', 'shift', 'KeyC'], section: 'library' },
  { actionKey: 'paste_files', description: 'Paste file(s) to current folder', defaultCombo: ['ctrl', 'shift', 'KeyV'], section: 'library' },
  { actionKey: 'select_all', description: 'Select all images', defaultCombo: ['ctrl', 'KeyA'], section: 'library' },
  { actionKey: 'delete_selected', description: 'Delete selected file(s)', defaultCombo: ['Delete'], section: 'library' },
  { actionKey: 'preview_prev', description: 'Previous image', defaultCombo: ['ArrowLeft'], section: 'library' },
  { actionKey: 'preview_next', description: 'Next image', defaultCombo: ['ArrowRight'], section: 'library' },
  { actionKey: 'zoom_in_step', description: 'Zoom in (by step)', defaultCombo: ['ArrowUp'], section: 'view' },
  { actionKey: 'zoom_out_step', description: 'Zoom out (by step)', defaultCombo: ['ArrowDown'], section: 'view' },
  { actionKey: 'cycle_zoom', description: 'Cycle zoom (Fit, 2x Fit, 100%)', defaultCombo: ['Space'], section: 'view' },
  { actionKey: 'zoom_in', description: 'Zoom in', defaultCombo: ['ctrl', 'Equal'], section: 'view' },
  { actionKey: 'zoom_out', description: 'Zoom out', defaultCombo: ['ctrl', 'Minus'], section: 'view' },
  { actionKey: 'zoom_fit', description: 'Zoom to fit', defaultCombo: ['ctrl', 'Digit0'], section: 'view' },
  { actionKey: 'zoom_100', description: 'Zoom to 100%', defaultCombo: ['ctrl', 'Digit1'], section: 'view' },
  { actionKey: 'toggle_fullscreen', description: 'Toggle fullscreen', defaultCombo: ['KeyF'], section: 'view' },
  { actionKey: 'show_original', description: 'Show original (before/after)', defaultCombo: ['KeyB'], section: 'view' },
  { actionKey: 'rate_0', description: 'Star rating: 0', defaultCombo: ['Digit0'], section: 'rating' },
  { actionKey: 'rate_1', description: 'Star rating: 1', defaultCombo: ['Digit1'], section: 'rating' },
  { actionKey: 'rate_2', description: 'Star rating: 2', defaultCombo: ['Digit2'], section: 'rating' },
  { actionKey: 'rate_3', description: 'Star rating: 3', defaultCombo: ['Digit3'], section: 'rating' },
  { actionKey: 'rate_4', description: 'Star rating: 4', defaultCombo: ['Digit4'], section: 'rating' },
  { actionKey: 'rate_5', description: 'Star rating: 5', defaultCombo: ['Digit5'], section: 'rating' },  
  { actionKey: 'color_label_none', description: 'Color label: None', defaultCombo: ['shift', 'Digit0'], section: 'rating' },
  { actionKey: 'color_label_red', description: 'Color label: Red', defaultCombo: ['shift', 'Digit1'], section: 'rating' },
  { actionKey: 'color_label_yellow', description: 'Color label: Yellow', defaultCombo: ['shift', 'Digit2'], section: 'rating' },
  { actionKey: 'color_label_green', description: 'Color label: Green', defaultCombo: ['shift', 'Digit3'], section: 'rating' },
  { actionKey: 'color_label_blue', description: 'Color label: Blue', defaultCombo: ['shift', 'Digit4'], section: 'rating' },
  { actionKey: 'color_label_purple', description: 'Color label: Purple', defaultCombo: ['shift', 'Digit5'], section: 'rating' },
  { actionKey: 'toggle_adjustments', description: 'Toggle Adjustments panel', defaultCombo: ['KeyD'], section: 'panels' },
  { actionKey: 'toggle_crop_panel', description: 'Toggle Crop panel', defaultCombo: ['KeyR'], section: 'panels' },
  { actionKey: 'toggle_masks', description: 'Toggle Masks panel', defaultCombo: ['KeyM'], section: 'panels' },
  { actionKey: 'toggle_ai', description: 'Toggle AI panel', defaultCombo: ['KeyK'], section: 'panels' },
  { actionKey: 'toggle_presets', description: 'Toggle Presets panel', defaultCombo: ['KeyP'], section: 'panels' },
  { actionKey: 'toggle_metadata', description: 'Toggle Metadata panel', defaultCombo: ['KeyI'], section: 'panels' },
  { actionKey: 'toggle_analytics', description: 'Toggle Analytics display', defaultCombo: ['KeyA'], section: 'panels' },
  { actionKey: 'toggle_export', description: 'Toggle Export panel', defaultCombo: ['KeyE'], section: 'panels' },
  { actionKey: 'undo', description: 'Undo adjustment', defaultCombo: ['ctrl', 'KeyZ'], section: 'editing' },
  { actionKey: 'redo', description: 'Redo adjustment', defaultCombo: ['ctrl', 'KeyY'], section: 'editing' },
  { actionKey: 'copy_adjustments', description: 'Copy selected adjustments', defaultCombo: ['ctrl', 'KeyC'], section: 'editing' },
  { actionKey: 'paste_adjustments', description: 'Paste copied adjustments', defaultCombo: ['ctrl', 'KeyV'], section: 'editing' },
  { actionKey: 'rotate_left', description: 'Rotate 90° counter-clockwise', defaultCombo: ['BracketLeft'], section: 'editing' },
  { actionKey: 'rotate_right', description: 'Rotate 90° clockwise', defaultCombo: ['BracketRight'], section: 'editing' },
  { actionKey: 'toggle_crop', description: 'Straighten Image', defaultCombo: ['KeyS'], section: 'editing' },
  { actionKey: 'brush_size_up', description: 'Increase brush size', defaultCombo: ['ctrl', 'ArrowUp'], section: 'editing' },
  { actionKey: 'brush_size_down', description: 'Decrease brush size', defaultCombo: ['ctrl', 'ArrowDown'], section: 'editing' },
];
