import { useCallback, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  Aperture,
  Check,
  ClipboardPaste,
  Clock,
  Copy,
  CopyPlus,
  Edit,
  FileEdit,
  FileInput,
  Flag,
  Folder,
  FolderInput,
  FolderPlus,
  Images,
  LayoutTemplate,
  Layers,
  PencilSparkles,
  Redo,
  RefreshCw,
  RotateCcw,
  Star,
  SquaresUnite,
  Palette,
  Tag,
  Trash2,
  Undo,
  X,
  Pin,
  PinOff,
  Users,
  Gauge,
  Grip,
  Film,
  Home,
  Plane,
  Mountain,
  Sun,
  Camera,
  Map,
  Heart,
  Car,
  Briefcase,
  User,
  Album as AlbumIcon,
  SwatchBook,
  FileSearch,
  ExternalLink,
} from 'lucide-react';
import { toast } from 'react-toastify';
import { useTranslation } from 'react-i18next';
import { useContextMenu } from '../context/ContextMenuContext';
import { canUndoEdit, useEditorStore } from '../store/useEditorStore';
import { useLibraryStore } from '../store/useLibraryStore';
import { useProcessStore } from '../store/useProcessStore';
import { useUIStore } from '../store/useUIStore';
import { useSettingsStore } from '../store/useSettingsStore';
import {
  Invokes,
  Option,
  OPTION_SEPARATOR,
  Panel,
  AlbumItem,
  AlbumGroup,
  ExternalEditor,
  ExternalEditFormat,
  EXTERNAL_EDIT_FORMATS,
  EXTERNAL_EDIT_FORMAT_LABELS,
  LibraryViewMode,
} from '../components/ui/AppProperties';
import { Status } from '../components/ui/ExportImportProperties';
import { Color, COLOR_LABELS } from '../utils/adjustments';
import TaggingSubMenu from '../context/TaggingSubMenu';
import { useEditorActions } from './useEditorActions';
import {
  canRefinePhotos,
  getActionPaths,
  moveImageToStackTop,
  saveImageStacks,
  stackImages,
  useLibraryActions,
} from './useLibraryActions';
import { aiBaseTools, PhotoCommand, usePhotoCommands } from './usePhotoCommands';
import { findImageStack, findToggleTargetStack, toggleImageStacks } from '../utils/imageStacks';
import { isCollectionView, isPathWithin } from '../utils/libraryViews';
import type { MenuOptionSource } from '../utils/menuBar';
import { getRejectedPathsForLoadedFolder, isImageFlagTag } from '../utils/imageFlags';
import { USER_TAG_PREFIX } from '../utils/keywords';

/** Open as Layers asks first above this many photos: each is a full-size 16-bit layer. */
const OPEN_AS_LAYERS_CONFIRM_ABOVE = 10;

export interface UseAppContextMenusProps {
  handleImageSelect: (path: string) => void;
  handleBackToLibrary: () => void;
  handleRenameFiles: (paths: string[]) => void;
  handleImportClick: (path: string) => void;
  handleLibraryRefresh: () => Promise<void>;
  refreshAllFolderTrees: () => Promise<void>;
  refreshImageList: () => Promise<void>;
  executeDelete: (paths: string[], options: any) => Promise<void>;
  handleDeleteRejected: () => void;
  handleTogglePinFolder: (path: string) => Promise<void>;
}

export function useAppContextMenus(props: UseAppContextMenusProps) {
  const { t } = useTranslation();
  const { showContextMenu } = useContextMenu();

  const { handleResetAdjustments, handleResetEdit, handleCopyAdjustments, handlePasteAdjustments } = useEditorActions();
  const { commands: photoCommands, readXmpFromFolder } = usePhotoCommands({
    refreshImageList: props.refreshImageList,
  });
  // A right-click entry for a shared photo command on `paths`.
  const photoCommandOption = useCallback(
    (command: PhotoCommand, paths: string[], option: Omit<Option, 'onClick' | 'disabled'>): Option => ({
      ...option,
      disabled: !photoCommands[command].canRun(paths),
      onClick: () => photoCommands[command].run(paths),
    }),
    [photoCommands],
  );
  const { handleRate, handleRefinePhotos, handleSetColorLabel, handleTagsChanged } = useLibraryActions();

  // The bottom bar's Delete Rejected Files, offered in the Library and Develop menus too (Plan item 68).
  const buildDeleteRejectedOption = useCallback((): Option => {
    const { imageList, currentFolderPath } = useLibraryStore.getState();
    return {
      disabled: getRejectedPathsForLoadedFolder(imageList, currentFolderPath).length === 0,
      icon: Trash2,
      isDestructive: true,
      label: t('flags.deleteRejected'),
      onClick: props.handleDeleteRejected,
    };
  }, [props.handleDeleteRejected, t]);

  const refreshFolders = useCallback(
    async (folderPaths: string[]) => {
      // The tree remembers folder photo counts; Refresh counts these folders again (Plan item 71).
      await invoke(Invokes.RefreshFolderPhotoCounts, { folderPaths }).catch((err) =>
        console.error('Failed to refresh folder photo counts:', err),
      );
      await props.refreshAllFolderTrees();
      const includeSubfolders = useSettingsStore.getState().appSettings?.libraryViewMode === 'recursive';
      await invoke(Invokes.RefreshFolderThumbnails, { folderPaths, includeSubfolders }).catch((err) => {
        console.error('Failed to refresh folder thumbnails:', err);
        toast.error(`Failed to refresh folder thumbnails: ${err}`);
      });
    },
    [props.refreshAllFolderTrees],
  );

  const openPresetBatchForFolders = useCallback((folderPaths: string[], includeSubfolders: boolean) => {
    useUIStore.getState().setUI({
      presetBatchModalState: {
        isOpen: true,
        target: { imagePaths: [], folderPaths, includeSubfolders },
      },
    });
  }, []);

  const albumIcons = useMemo(
    () => [
      { label: t('contextMenus.albumIcons.default'), value: undefined, icon: Folder },
      { label: t('contextMenus.albumIcons.travel'), value: 'plane', icon: Plane },
      { label: t('contextMenus.albumIcons.nature'), value: 'mountain', icon: Mountain },
      { label: t('contextMenus.albumIcons.summer'), value: 'sun', icon: Sun },
      { label: t('contextMenus.albumIcons.photography'), value: 'camera', icon: Camera },
      { label: t('contextMenus.albumIcons.locations'), value: 'map', icon: Map },
      { label: t('contextMenus.albumIcons.favorites'), value: 'heart', icon: Heart },
      { label: t('contextMenus.albumIcons.featured'), value: 'star', icon: Star },
      { label: t('contextMenus.albumIcons.people'), value: 'users', icon: Users },
      { label: t('contextMenus.albumIcons.person'), value: 'user', icon: User },
      { label: t('contextMenus.albumIcons.automotive'), value: 'car', icon: Car },
      { label: t('contextMenus.albumIcons.portfolio'), value: 'briefcase', icon: Briefcase },
    ],
    [t],
  );

  const getCommonTags = useCallback((paths: string[]): { tag: string; isUser: boolean }[] => {
    const { imageList } = useLibraryStore.getState();
    if (paths.length === 0) return [];
    const imageFiles = imageList.filter((img) => paths.includes(img.path));
    if (imageFiles.length === 0) return [];

    const allTagsSets = imageFiles.map((img) => {
      const tagsWithPrefix = (img.tags || []).filter((t: string) => !t.startsWith('color:') && !isImageFlagTag(t));
      return new Set(tagsWithPrefix);
    });

    if (allTagsSets.length === 0) return [];

    const commonTagsWithPrefix = allTagsSets.reduce((intersection, currentSet) => {
      return new Set([...intersection].filter((tag) => currentSet.has(tag)));
    });

    return Array.from(commonTagsWithPrefix)
      .map((tag: string) => ({
        tag: tag.startsWith(USER_TAG_PREFIX) ? tag.substring(USER_TAG_PREFIX.length) : tag,
        isUser: tag.startsWith(USER_TAG_PREFIX),
      }))
      .sort((a, b) => a.tag.localeCompare(b.tag));
  }, []);

  const buildAddToAlbumMenu = useCallback(
    (items: AlbumItem[], pathsToAdd: string[]): Option[] => {
      return items.map((item) => {
        const customIconDef = item.icon ? albumIcons.find((i) => i.value === item.icon) : null;
        const ResolvedIcon = customIconDef?.icon || (item.type === 'group' ? Folder : AlbumIcon);

        if (item.type === 'group') {
          return {
            label: item.name,
            icon: ResolvedIcon,
            submenu:
              (item as AlbumGroup).children.length > 0
                ? buildAddToAlbumMenu((item as AlbumGroup).children, pathsToAdd)
                : [{ label: t('contextMenus.album.emptyGroup'), disabled: true }],
          };
        } else {
          return {
            label: item.name,
            icon: ResolvedIcon,
            onClick: () => {
              invoke(Invokes.AddToAlbum, { albumId: item.id, paths: pathsToAdd })
                .then(() => {
                  console.log(`Added image(s) to ${item.name}`);
                  invoke(Invokes.GetAlbums).then((res: any) =>
                    useLibraryStore.getState().setLibrary({ albumTree: res }),
                  );
                })
                .catch((err) => toast.error(t('contextMenus.toasts.failedAddToAlbum', { err })));
            },
          };
        }
      });
    },
    [albumIcons, t],
  );

  // `paths` in selection order: each photo opens as its own rendered copy (one after another, as Lightroom's
  // Edit In does), several also as the layers of one file (Open as Layers, the first on top), and a single
  // non-RAW photo as itself.
  const buildOpenInOption = useCallback(
    (paths: string[], { canEditOriginal }: { canEditOriginal: boolean }): Option => {
      const [sourcePath] = paths;
      const runExternalEdit = async (command: Invokes, args: Record<string, unknown>) => {
        const { selectedImage, adjustments } = useEditorStore.getState();
        useProcessStore.getState().setExportState({
          status: Status.Exporting,
          progress: { current: 0, total: paths.length },
          errorMessage: '',
        });
        try {
          await invoke(command, {
            ...args,
            currentEditPath: selectedImage?.path || null,
            currentEditAdjustments: adjustments || null,
          });
        } catch (error) {
          const message = typeof error === 'string' ? error : 'External edit failed';
          toast.error(message);
          useProcessStore.getState().setExportState({ status: Status.Error, errorMessage: message });
        }
      };
      const startExternalEdit = async (format: ExternalEditFormat, editor: ExternalEditor) => {
        for (const path of paths) {
          await runExternalEdit(Invokes.StartEditorRoundTrip, { sourcePath: path, editorPath: editor.path, format });
        }
      };
      const openAsLayers = (editor: ExternalEditor) => {
        const start = () =>
          runExternalEdit(Invokes.StartLayeredRoundTrip, { sourcePaths: paths, editorPath: editor.path });
        if (paths.length <= OPEN_AS_LAYERS_CONFIRM_ABOVE) {
          void start();
          return;
        }
        useUIStore.getState().setUI({
          confirmModalState: {
            confirmText: t('contextMenus.thumbnail.openAsLayersConfirm'),
            isOpen: true,
            message: t('contextMenus.thumbnail.openAsLayersMessage', { count: paths.length }),
            onConfirm: start,
            title: t('contextMenus.thumbnail.openAsLayers'),
          },
        });
      };

      const editOriginal = async (editor: ExternalEditor) => {
        try {
          await invoke(Invokes.StartEditingOriginal, { path: sourcePath, editorPath: editor.path });
        } catch (error) {
          toast.error(typeof error === 'string' ? error : 'External edit failed');
        }
      };

      const externalEditors = (useSettingsStore.getState().appSettings?.externalEditors || []).filter(
        (editor: ExternalEditor) => editor.path,
      );
      const menu = {
        disabled: externalEditors.length === 0,
        icon: ExternalLink,
        label: t('contextMenus.thumbnail.openIn'),
      };
      const editorSubmenu = (onClick: (editor: ExternalEditor) => void) =>
        externalEditors.map((editor: ExternalEditor) => ({ label: editor.name, onClick: () => onClick(editor) }));
      return {
        ...menu,
        submenu: [
          ...externalEditors.map((editor: ExternalEditor) => {
            const { format } = editor;
            return format
              ? {
                  label: `${editor.name} (${EXTERNAL_EDIT_FORMAT_LABELS[format]})`,
                  onClick: () => startExternalEdit(format, editor),
                }
              : {
                  label: editor.name,
                  submenu: EXTERNAL_EDIT_FORMATS.map((choice) => ({
                    label: EXTERNAL_EDIT_FORMAT_LABELS[choice],
                    onClick: () => startExternalEdit(choice, editor),
                  })),
                };
          }),
          { type: OPTION_SEPARATOR },
          paths.length > 1
            ? { label: t('contextMenus.thumbnail.openAsLayers'), submenu: editorSubmenu(openAsLayers) }
            : {
                disabled: !canEditOriginal,
                label: t('contextMenus.thumbnail.originalFile'),
                submenu: editorSubmenu(editOriginal),
              },
        ],
      };
    },
    [t],
  );

  // Open in for library photos; RAW files have no pixels an editor could save back, so only a rendered copy.
  const buildOpenInOptionForPaths = useCallback(
    (paths: string[]): Option =>
      buildOpenInOption(paths, {
        canEditOriginal: useLibraryStore.getState().imageList.some((image) => image.path === paths[0] && !image.is_raw),
      }),
    [buildOpenInOption],
  );

  const buildAddToAlbumOption = useCallback(
    (paths: string[]): Option => {
      const { albumTree } = useLibraryStore.getState();
      return {
        label: t('contextMenus.thumbnail.addToAlbum'),
        icon: FolderPlus,
        submenu:
          albumTree.length > 0
            ? buildAddToAlbumMenu(albumTree, paths)
            : [{ label: t('contextMenus.thumbnail.noAlbums'), disabled: true }],
      };
    },
    [buildAddToAlbumMenu, t],
  );

  const handleEditorContextMenu = useCallback(
    (event: any) => {
      event.preventDefault();
      event.stopPropagation();

      const editorState = useEditorStore.getState();
      const { selectedImage, history, historyIndex, undo, redo, copiedAdjustments } = editorState;
      const { appSettings } = useSettingsStore.getState();
      const { setRightPanel } = useUIStore.getState();

      if (!selectedImage) return;

      const paths = [selectedImage.path];
      const canUndo = canUndoEdit(editorState);
      const canRedo = historyIndex < history.length - 1;
      const commonTags = getCommonTags(paths);

      const options: Array<Option> = [
        {
          label: t('contextMenus.editor.exportImage'),
          icon: FileInput,
          onClick: () => setRightPanel(Panel.Export),
        },
        // RAW files have no pixels an editor could save back, so only a rendered copy is offered.
        buildOpenInOption([selectedImage.path], { canEditOriginal: !selectedImage.isRaw }),
        { type: OPTION_SEPARATOR },
        { label: t('contextMenus.editor.undo'), icon: Undo, onClick: undo, disabled: !canUndo },
        { label: t('contextMenus.editor.redo'), icon: Redo, onClick: redo, disabled: !canRedo },
        { type: OPTION_SEPARATOR },
        {
          label: t('contextMenus.editor.copyAdjustments'),
          icon: Copy,
          onClick: () => handleCopyAdjustments(),
        },
        {
          label: t('contextMenus.editor.pasteAdjustments'),
          icon: ClipboardPaste,
          onClick: () => handlePasteAdjustments(),
          disabled: copiedAdjustments === null,
        },
        photoCommandOption('importLightroomEdits', paths, {
          label: t('contextMenus.thumbnail.importLightroomEdits', { count: 1 }),
          icon: FileSearch,
        }),
        {
          label: t('contextMenus.editor.productivity'),
          icon: Gauge,
          submenu: [
            photoCommandOption('applyPreset', paths, { label: t('presetBatch.applyPreset'), icon: SwatchBook }),
            photoCommandOption('autoAdjust', paths, {
              label: t('contextMenus.editor.autoAdjust'),
              icon: PencilSparkles,
            }),
            photoCommandOption('autoLensCorrection', paths, {
              label: t('contextMenus.editor.autoLensCorrection'),
              icon: Aperture,
            }),
            photoCommandOption('denoise', paths, { label: t('contextMenus.editor.denoise'), icon: Grip }),
            ...aiBaseTools(t).map(({ key, icon, label, removeLabel, enable, remove }) =>
              editorState.adjustments[key]
                ? photoCommandOption(remove, paths, { label: removeLabel, icon })
                : photoCommandOption(enable, paths, { label, icon }),
            ),
            photoCommandOption('convertNegative', paths, {
              label: t('contextMenus.editor.convertNegative'),
              icon: Film,
            }),
            photoCommandOption('panorama', paths, {
              icon: SquaresUnite,
              label: t('contextMenus.editor.stitchPanorama'),
            }),
            photoCommandOption('hdr', paths, { icon: Images, label: t('contextMenus.editor.mergeHdr') }),
            photoCommandOption('collage', paths, { icon: LayoutTemplate, label: t('contextMenus.editor.frameImage') }),
            photoCommandOption('cullSimilar', paths, { label: t('contextMenus.editor.cullImage'), icon: Users }),
          ],
        },
        { type: OPTION_SEPARATOR },
        {
          label: t('contextMenus.editor.rating'),
          icon: Star,
          submenu: [0, 1, 2, 3, 4, 5].map((rating: number) => ({
            label:
              rating === 0
                ? t('contextMenus.editor.noRating')
                : t('contextMenus.editor.ratingLabel', { count: rating }),
            onClick: () => handleRate(rating),
          })),
        },
        {
          label: t('contextMenus.editor.colorLabel'),
          icon: Palette,
          submenu: [
            { label: t('contextMenus.editor.noLabel'), onClick: () => handleSetColorLabel(null) },
            ...COLOR_LABELS.map((label: Color) => ({
              label: t(`contextMenus.colors.${label.name}`),
              color: label.color,
              onClick: () => handleSetColorLabel(label.name),
            })),
          ],
        },
        {
          label: t('contextMenus.editor.tagging'),
          icon: Tag,
          submenu: [
            {
              customComponent: TaggingSubMenu,
              customProps: {
                paths: [selectedImage.path],
                initialTags: commonTags,
                onTagsChanged: handleTagsChanged,
                appSettings,
              },
            },
          ],
        },
        { type: OPTION_SEPARATOR },
        { label: t('contextMenus.editor.resetAdjustments'), icon: RotateCcw, onClick: handleResetEdit },
        buildDeleteRejectedOption(),
      ];
      showContextMenu(event.clientX, event.clientY, options);
    },
    [
      buildOpenInOption,
      buildDeleteRejectedOption,
      getCommonTags,
      handleCopyAdjustments,
      handlePasteAdjustments,
      handleResetEdit,
      photoCommandOption,
      handleRate,
      handleSetColorLabel,
      handleTagsChanged,
      showContextMenu,
      t,
    ],
  );

  const handleThumbnailContextMenu = useCallback(
    (event: any, path: string, forceSingleSelection: boolean = false) => {
      event.preventDefault();
      event.stopPropagation();

      const { selectedImage, copiedAdjustments, setEditor } = useEditorStore.getState();
      const { multiSelectedPaths, imageList, libraryActivePath, activeAlbumId, setLibrary } =
        useLibraryStore.getState();
      const { appSettings } = useSettingsStore.getState();
      const { setUI, setRightPanel } = useUIStore.getState();
      const { setProcess } = useProcessStore.getState();

      if (useLibraryStore.getState().selectedFolderPaths.length > 0) {
        setLibrary({ selectedFolderPaths: [] });
      }

      const isTargetInSelection = multiSelectedPaths.includes(path);
      let finalSelection: string[];

      if (forceSingleSelection) {
        finalSelection = [path];
      } else if (!isTargetInSelection) {
        finalSelection = [path];
        setLibrary({ multiSelectedPaths: [path] });
        if (!selectedImage) {
          setLibrary({ libraryActivePath: path });
        }
      } else {
        finalSelection = multiSelectedPaths;
      }

      const commonTags = getCommonTags(finalSelection);

      const selectionCount = finalSelection.length;
      const isSingleSelection = selectionCount === 1;
      const isEditingThisImage = selectedImage?.path === path;
      const deleteLabel = t('contextMenus.thumbnail.deleteImage', { count: selectionCount });
      const exportLabel = t('contextMenus.thumbnail.exportImage', { count: selectionCount });

      const selectionHasVirtualCopies =
        isSingleSelection &&
        !finalSelection[0].includes('?vc=') &&
        imageList.some((image) => image.path.startsWith(`${finalSelection[0]}?vc=`));

      const hasAssociatedFiles = finalSelection.some((selectedPath) => {
        const image = imageList.find((img) => img.path === selectedPath);
        if (image?.group_id != null) return true;

        const getBasePath = (p: string) => {
          const qMark = p.indexOf('?');
          const clean = qMark === -1 ? p : p.substring(0, qMark);
          const dot = clean.lastIndexOf('.');
          return dot === -1 ? clean : clean.substring(0, dot);
        };
        const basePath = getBasePath(selectedPath);

        return imageList.some((img) => img.path !== selectedPath && getBasePath(img.path) === basePath);
      });

      let deleteSubmenu;
      if (selectionHasVirtualCopies) {
        deleteSubmenu = [
          { label: t('contextMenus.editor.cancel'), icon: X, onClick: () => {} },
          {
            label: t('contextMenus.thumbnail.confirmDeleteVc'),
            icon: Check,
            isDestructive: true,
            onClick: () => props.executeDelete(finalSelection, { includeAssociated: false }),
          },
        ];
      } else if (hasAssociatedFiles) {
        deleteSubmenu = [
          { label: t('contextMenus.editor.cancel'), icon: X, onClick: () => {} },
          {
            label: t('contextMenus.thumbnail.deleteSelected'),
            icon: Check,
            isDestructive: true,
            onClick: () => props.executeDelete(finalSelection, { includeAssociated: false }),
          },
          {
            label: t('contextMenus.thumbnail.deleteAssociated'),
            icon: Check,
            isDestructive: true,
            onClick: () => props.executeDelete(finalSelection, { includeAssociated: true }),
          },
        ];
      } else {
        deleteSubmenu = [
          { label: t('contextMenus.editor.cancel'), icon: X, onClick: () => {} },
          {
            label: t('contextMenus.thumbnail.confirmDelete'),
            icon: Check,
            isDestructive: true,
            onClick: () => props.executeDelete(finalSelection, { includeAssociated: false }),
          },
        ];
      }

      const pasteLabel = t('contextMenus.thumbnail.pasteAdjustments', { count: selectionCount });
      const resetLabel = t('contextMenus.thumbnail.resetAdjustments', { count: selectionCount });
      const copyLabel = t('contextMenus.thumbnail.copyImage', { count: selectionCount });
      const autoAdjustLabel = t('contextMenus.thumbnail.autoAdjust', { count: selectionCount });
      const renameLabel = t('contextMenus.thumbnail.renameImage', { count: selectionCount });
      const cullLabel = t('contextMenus.thumbnail.cullImage', { count: selectionCount });
      const collageLabel = t('contextMenus.thumbnail.collage', { count: selectionCount });
      const stitchLabel = t('contextMenus.editor.stitchPanorama');
      const conversionLabel = t('contextMenus.thumbnail.convertNegative', { count: selectionCount });
      const denoiseLabel = t('contextMenus.thumbnail.denoise', { count: selectionCount });
      const mergeLabel = t('contextMenus.editor.mergeHdr');
      const imageStacks = appSettings?.imageStacks || [];
      const targetStack = findImageStack(imageStacks, path);
      const toggleTargetStack = findToggleTargetStack(imageStacks, finalSelection, path);

      const handleStackSelected = () => {
        if (finalSelection.length < 2) return;
        stackImages(finalSelection, path);
      };

      const handleToggleStack = () => saveImageStacks((stacks) => toggleImageStacks(stacks, finalSelection, path));

      const handleMoveToTopOfStack = () => moveImageToStackTop(path);

      // Develop exports only the photo being edited, so several photos are exported from the Library.
      const onExportClick = () => {
        if (selectedImage && finalSelection.length <= 1) {
          if (selectedImage.path !== path) {
            props.handleImageSelect(path);
          }
          setLibrary({ multiSelectedPaths: finalSelection });
          setRightPanel(Panel.Export);
        } else {
          if (selectedImage) props.handleBackToLibrary();
          setLibrary({ multiSelectedPaths: finalSelection, libraryActivePath: path });
          setUI({ isLibraryExportPanelVisible: true });
        }
      };

      const options = [
        ...(!isEditingThisImage
          ? [
              {
                disabled: !isSingleSelection,
                icon: Edit,
                label: t('contextMenus.editor.editImage'),
                onClick: () => props.handleImageSelect(finalSelection[0]),
              },
              { icon: FileInput, label: exportLabel, onClick: onExportClick },
              { type: OPTION_SEPARATOR },
            ]
          : [{ icon: FileInput, label: exportLabel, onClick: onExportClick }, { type: OPTION_SEPARATOR }]),
        buildOpenInOptionForPaths(finalSelection),
        {
          icon: Copy,
          label: t('contextMenus.editor.copyAdjustments'),
          onClick: () => handleCopyAdjustments(path),
        },
        {
          disabled: copiedAdjustments === null,
          icon: ClipboardPaste,
          label: pasteLabel,
          onClick: () => handlePasteAdjustments(finalSelection),
        },
        photoCommandOption('importLightroomEdits', finalSelection, {
          icon: FileSearch,
          label: t('contextMenus.thumbnail.importLightroomEdits', { count: selectionCount }),
        }),
        {
          label: t('contextMenus.editor.productivity'),
          icon: Gauge,
          submenu: [
            photoCommandOption('applyPreset', finalSelection, {
              label: t('presetBatch.applyPreset'),
              icon: SwatchBook,
            }),
            photoCommandOption('autoAdjust', finalSelection, { label: autoAdjustLabel, icon: PencilSparkles }),
            photoCommandOption('autoLensCorrection', finalSelection, {
              label: t('contextMenus.thumbnail.autoLensCorrection', { count: selectionCount }),
              icon: Aperture,
            }),
            photoCommandOption('upgradeLensCorrection', finalSelection, {
              label: t('contextMenus.thumbnail.upgradeLensCorrection', { count: selectionCount }),
              icon: Aperture,
            }),
            photoCommandOption('denoise', finalSelection, { label: denoiseLabel, icon: Grip }),
            ...aiBaseTools(t).map(({ icon, label, enable, remove }) => ({
              label,
              icon,
              disabled: !photoCommands[enable].canRun(finalSelection),
              submenu: [
                photoCommandOption(enable, finalSelection, { label: t('contextMenus.thumbnail.enable'), icon: Check }),
                photoCommandOption(remove, finalSelection, { label: t('contextMenus.thumbnail.remove'), icon: X }),
              ],
            })),
            photoCommandOption('convertNegative', finalSelection, { label: conversionLabel, icon: Film }),
            photoCommandOption('panorama', finalSelection, { icon: SquaresUnite, label: stitchLabel }),
            photoCommandOption('hdr', finalSelection, { icon: Images, label: mergeLabel }),
            photoCommandOption('collage', finalSelection, { icon: LayoutTemplate, label: collageLabel }),
            photoCommandOption('cullSimilar', finalSelection, { label: cullLabel, icon: Users }),
          ],
        },
        {
          label: t('contextMenus.thumbnail.stacking'),
          icon: Layers,
          submenu: [
            {
              label: t('contextMenus.thumbnail.stackSelected', { count: selectionCount }),
              icon: Layers,
              disabled: selectionCount < 2,
              onClick: handleStackSelected,
            },
            {
              label: toggleTargetStack?.collapsed
                ? t('contextMenus.thumbnail.expandStack')
                : t('contextMenus.thumbnail.collapseStack'),
              icon: Layers,
              disabled: !toggleTargetStack,
              onClick: handleToggleStack,
            },
            {
              label: t('contextMenus.thumbnail.moveToTopOfStack'),
              icon: Star,
              disabled: !targetStack || targetStack.coverPath === path,
              onClick: handleMoveToTopOfStack,
            },
            photoCommandOption('unstack', finalSelection, { label: t('contextMenus.thumbnail.unstack'), icon: Layers }),
            photoCommandOption('autoStack', finalSelection, {
              label: t('contextMenus.thumbnail.autoStackByCaptureTime'),
              icon: Clock,
            }),
          ],
        },
        { type: OPTION_SEPARATOR },
        {
          label: copyLabel,
          icon: Copy,
          onClick: () => {
            setProcess({ copiedFilePaths: finalSelection, isCopied: true });
          },
        },
        {
          icon: CopyPlus,
          label: t('contextMenus.thumbnail.duplicateImage'),
          disabled: !isSingleSelection,
          submenu: [
            photoCommandOption('duplicateFile', finalSelection, {
              label: t('contextMenus.thumbnail.physicalCopy'),
              icon: Copy,
            }),
            photoCommandOption('createVirtualCopy', finalSelection, {
              label: t('contextMenus.thumbnail.virtualCopy'),
              icon: CopyPlus,
            }),
          ],
        },
        { icon: FileEdit, label: renameLabel, onClick: () => props.handleRenameFiles(finalSelection) },
        { type: OPTION_SEPARATOR },
        {
          icon: Star,
          label: t('contextMenus.editor.rating'),
          submenu: [0, 1, 2, 3, 4, 5].map((rating: number) => ({
            label:
              rating === 0
                ? t('contextMenus.editor.noRating')
                : t('contextMenus.editor.ratingLabel', { count: rating }),
            onClick: () => handleRate(rating, finalSelection),
          })),
        },
        {
          label: t('contextMenus.editor.colorLabel'),
          icon: Palette,
          submenu: [
            { label: t('contextMenus.editor.noLabel'), onClick: () => handleSetColorLabel(null, finalSelection) },
            ...COLOR_LABELS.map((label: Color) => ({
              label: t(`contextMenus.colors.${label.name}`),
              color: label.color,
              onClick: () => handleSetColorLabel(label.name, finalSelection),
            })),
          ],
        },
        {
          label: t('contextMenus.editor.tagging'),
          icon: Tag,
          submenu: [
            {
              customComponent: TaggingSubMenu,
              customProps: {
                paths: finalSelection,
                initialTags: commonTags,
                onTagsChanged: handleTagsChanged,
                appSettings,
              },
            },
          ],
        },
        { type: OPTION_SEPARATOR },
        buildAddToAlbumOption(finalSelection),
        ...(activeAlbumId
          ? [
              photoCommandOption('removeFromAlbum', finalSelection, {
                label: t('contextMenus.thumbnail.removeFromAlbum', { count: selectionCount }),
                icon: Trash2,
                isDestructive: true,
              }),
            ]
          : []),
        { type: OPTION_SEPARATOR },
        {
          disabled: !isSingleSelection,
          icon: Folder,
          label: t('contextMenus.thumbnail.showExplorer'),
          onClick: () => {
            invoke(Invokes.ShowInFinder, { path: finalSelection[0] }).catch((err) =>
              toast.error(t('contextMenus.toasts.couldNotShowExplorer', { err })),
            );
          },
        },
        {
          label: resetLabel,
          icon: RotateCcw,
          submenu: [
            { label: t('contextMenus.editor.cancel'), icon: X, onClick: () => {} },
            {
              label: t('contextMenus.editor.confirmReset'),
              icon: Check,
              isDestructive: true,
              onClick: () => handleResetAdjustments(finalSelection),
            },
          ],
        },
        {
          label: deleteLabel,
          icon: Trash2,
          isDestructive: true,
          submenu: deleteSubmenu,
        },
        buildDeleteRejectedOption(),
      ];
      showContextMenu(event.clientX, event.clientY, options);
    },
    [
      buildOpenInOptionForPaths,
      buildDeleteRejectedOption,
      getCommonTags,
      buildAddToAlbumOption,
      handleCopyAdjustments,
      handlePasteAdjustments,
      photoCommandOption,
      photoCommands,
      handleRate,
      handleSetColorLabel,
      handleTagsChanged,
      handleResetAdjustments,
      showContextMenu,
      props,
      t,
    ],
  );

  const handleFolderTreeContextMenu = useCallback(
    (event: any, path: string | null, isCurrentlyPinned?: boolean) => {
      event.preventDefault();
      event.stopPropagation();

      if (!path) {
        showContextMenu(event.clientX, event.clientY, [
          {
            icon: RefreshCw,
            label: t('contextMenus.folders.refresh'),
            onClick: () => refreshFolders(useLibraryStore.getState().rootPaths),
          },
        ]);
        return;
      }

      const { rootPaths, currentFolderPath, folderTrees, selectedFolderPaths, setLibrary } = useLibraryStore.getState();
      const { copiedFilePaths, setProcess } = useProcessStore.getState();
      const { appSettings, handleSettingsChange } = useSettingsStore.getState();
      const { setUI } = useUIStore.getState();
      const targetPath = path;
      const folderTargets = selectedFolderPaths.includes(targetPath) ? selectedFolderPaths : [targetPath];
      if (!selectedFolderPaths.includes(targetPath)) {
        setLibrary({ selectedFolderPaths: folderTargets, multiSelectedPaths: [] });
      }
      const isRoot = rootPaths.includes(targetPath);
      const numCopied = copiedFilePaths.length;
      const copyPastedLabel = t('contextMenus.folders.copyHere', { count: numCopied });
      const movePastedLabel = t('contextMenus.folders.moveHere', { count: numCopied });

      const pinOption = isCurrentlyPinned
        ? {
            icon: PinOff,
            label: t('contextMenus.folders.unpin'),
            onClick: () => props.handleTogglePinFolder(targetPath),
          }
        : { icon: Pin, label: t('contextMenus.folders.pin'), onClick: () => props.handleTogglePinFolder(targetPath) };

      const options = [
        ...(isRoot
          ? [
              {
                icon: Trash2,
                label: t('contextMenus.folders.removeRoot'),
                isDestructive: true,
                onClick: () => {
                  const newRoots = rootPaths.filter((r: string) => r !== targetPath);
                  const newFolderTrees = folderTrees.filter((t: any) => t.path !== targetPath);

                  const isCurrentInTarget =
                    currentFolderPath === targetPath ||
                    currentFolderPath?.startsWith(targetPath + '/') ||
                    currentFolderPath?.startsWith(targetPath + '\\');

                  const updates: any = {
                    rootPaths: newRoots,
                    folderTrees: newFolderTrees,
                  };

                  if (isCurrentInTarget) {
                    updates.currentFolderPath = null;
                    updates.imageList = [];
                    updates.libraryActivePath = null;
                    updates.multiSelectedPaths = [];
                    updates.selectionAnchorPath = null;
                    props.handleBackToLibrary();
                  }

                  setLibrary(updates);

                  const { appSettings, handleSettingsChange } = useSettingsStore.getState();
                  if (appSettings) {
                    const newSettings = { ...appSettings, rootFolders: newRoots } as any;
                    if (newRoots.length === 0) {
                      newSettings.lastRootPath = null;
                      newSettings.lastFolderState = null;
                    } else if (newSettings.lastRootPath === targetPath) {
                      newSettings.lastRootPath = newRoots[0];
                    }

                    if (isCurrentInTarget) {
                      newSettings.lastFolderState = null;
                    }

                    handleSettingsChange(newSettings);
                  }
                },
              },
              { type: OPTION_SEPARATOR },
            ]
          : []),
        pinOption,
        { type: OPTION_SEPARATOR },
        {
          label: t('contextMenus.editor.productivity'),
          icon: Gauge,
          submenu: [
            {
              label: t('presetBatch.applyPreset'),
              icon: SwatchBook,
              submenu: [
                {
                  label: t('presetBatch.selectedFolders'),
                  onClick: () => openPresetBatchForFolders(folderTargets, false),
                },
                {
                  label: t('presetBatch.selectedFoldersRecursive'),
                  onClick: () => openPresetBatchForFolders(folderTargets, true),
                },
              ],
            },
          ],
        },
        { type: OPTION_SEPARATOR },
        {
          icon: FolderPlus,
          label: t('contextMenus.folders.newFolder'),
          onClick: () => {
            setUI({ folderActionTarget: targetPath, isCreateFolderModalOpen: true });
          },
        },
        {
          disabled: isRoot,
          icon: FileEdit,
          label: t('contextMenus.folders.renameFolder'),
          onClick: () => {
            setUI({ folderActionTarget: targetPath, isRenameFolderModalOpen: true });
          },
        },
        {
          label: t('contextMenus.folders.changeIcon'),
          icon: Palette,
          submenu: albumIcons.map((iconDef) => ({
            label: iconDef.label,
            icon: iconDef.icon,
            onClick: () => {
              if (appSettings) {
                const currentIcons = appSettings.folderIcons || {};
                const newIcons = { ...currentIcons };

                if (iconDef.value) {
                  newIcons[targetPath] = iconDef.value;
                } else {
                  delete newIcons[targetPath];
                }

                handleSettingsChange({ ...appSettings, folderIcons: newIcons });
              }
            },
          })),
        },
        { type: OPTION_SEPARATOR },
        {
          disabled: copiedFilePaths.length === 0,
          icon: ClipboardPaste,
          label: t('contextMenus.folders.paste'),
          submenu: [
            {
              label: copyPastedLabel,
              onClick: async () => {
                try {
                  await invoke(Invokes.CopyFiles, { sourcePaths: copiedFilePaths, destinationFolder: targetPath });
                  if (targetPath === currentFolderPath) props.handleLibraryRefresh();
                } catch (err) {
                  toast.error(t('contextMenus.toasts.failedCopy', { err }));
                }
              },
            },
            {
              label: movePastedLabel,
              onClick: async () => {
                try {
                  await invoke(Invokes.MoveFiles, { sourcePaths: copiedFilePaths, destinationFolder: targetPath });
                  setProcess({ copiedFilePaths: [] });
                  setLibrary({ multiSelectedPaths: [] });
                  props.refreshAllFolderTrees();
                  props.handleLibraryRefresh();
                } catch (err) {
                  toast.error(t('contextMenus.toasts.failedMove', { err }));
                }
              },
            },
          ],
        },
        {
          icon: FolderInput,
          label: t('contextMenus.folders.importImages'),
          onClick: () => props.handleImportClick(targetPath),
        },
        { type: OPTION_SEPARATOR },
        {
          icon: Folder,
          label: t('contextMenus.folders.showExplorer'),
          onClick: () =>
            invoke(Invokes.ShowInFinder, { path: targetPath }).catch((err) =>
              toast.error(t('contextMenus.toasts.couldNotShowFolder', { err })),
            ),
        },
        {
          icon: RefreshCw,
          label: t('contextMenus.folders.refresh'),
          onClick: () => refreshFolders(folderTargets),
        },
        {
          icon: FileInput,
          label: t('contextMenus.folders.readXmp'),
          onClick: () => readXmpFromFolder(targetPath),
        },
        {
          disabled: isRoot,
          icon: Trash2,
          isDestructive: true,
          label: t('contextMenus.folders.deleteFolder'),
          submenu: [
            { label: t('contextMenus.editor.cancel'), icon: X, onClick: () => {} },
            {
              label: t('contextMenus.folders.confirm'),
              icon: Check,
              isDestructive: true,
              onClick: async () => {
                try {
                  await invoke(Invokes.DeleteFolder, { path: targetPath });

                  const isCurrentInTarget =
                    currentFolderPath === targetPath ||
                    currentFolderPath?.startsWith(targetPath + '/') ||
                    currentFolderPath?.startsWith(targetPath + '\\');

                  if (isCurrentInTarget) {
                    props.handleBackToLibrary();
                    setLibrary({
                      currentFolderPath: null,
                      imageList: [],
                      libraryActivePath: null,
                      multiSelectedPaths: [],
                      selectionAnchorPath: null,
                    });

                    const { appSettings, handleSettingsChange } = useSettingsStore.getState();
                    if (appSettings) {
                      handleSettingsChange({ ...appSettings, lastFolderState: null } as any);
                    }
                  } else if (
                    currentFolderPath &&
                    isPathWithin(targetPath, currentFolderPath) &&
                    useSettingsStore.getState().appSettings?.libraryViewMode === LibraryViewMode.Recursive
                  ) {
                    // The recursive view of a parent folder still lists the deleted images.
                    props.refreshImageList();
                  }

                  props.refreshAllFolderTrees();
                } catch (err) {
                  toast.error(t('contextMenus.toasts.failedDeleteFolder', { err }));
                }
              },
            },
          ],
        },
      ];
      showContextMenu(event.clientX, event.clientY, options);
    },
    [props, readXmpFromFolder, showContextMenu, albumIcons, t],
  );

  const handleAlbumTreeContextMenu = useCallback(
    (event: any, item: AlbumItem | null) => {
      event.preventDefault();
      event.stopPropagation();

      const { setUI } = useUIStore.getState();
      const { albumTree, setLibrary } = useLibraryStore.getState();

      const findParentId = (
        nodes: AlbumItem[],
        childId: string,
        parentId: string | null = null,
      ): string | null | undefined => {
        for (const n of nodes) {
          if (n.id === childId) return parentId;
          if (n.type === 'group') {
            const found = findParentId((n as AlbumGroup).children, childId, n.id);
            if (found !== undefined) return found;
          }
        }
        return undefined;
      };

      const currentParentId = item ? findParentId(albumTree, item.id) : undefined;

      const handleMove = (targetId: string | null) => {
        if (!item) return;
        const newTree = structuredClone(albumTree);
        let extractedItem: AlbumItem | null = null;

        const removeAndGet = (nodes: AlbumItem[], id: string): AlbumItem | null => {
          for (let i = 0; i < nodes.length; i++) {
            if (nodes[i].id === id) return nodes.splice(i, 1)[0];
            if (nodes[i].type === 'group') {
              const res = removeAndGet((nodes[i] as AlbumGroup).children, id);
              if (res) return res;
            }
          }
          return null;
        };

        extractedItem = removeAndGet(newTree, item.id);
        if (!extractedItem) return;

        if (!targetId) {
          newTree.push(extractedItem);
        } else {
          let inserted = false;

          const insert = (nodes: AlbumItem[]) => {
            for (const n of nodes) {
              if (n.id === targetId && n.type === 'group') {
                n.children.push(extractedItem!);
                inserted = true;
                return;
              } else if (n.type === 'group') {
                insert(n.children);
                if (inserted) return;
              }
            }
          };

          insert(newTree);

          if (!inserted) {
            toast.error(t('contextMenus.toasts.failedMoveInvalid'));
            return;
          }
        }

        invoke(Invokes.SaveAlbums, { tree: newTree })
          .then(() => invoke(Invokes.GetAlbums))
          .then((sortedTree: any) => setLibrary({ albumTree: sortedTree }))
          .catch((err) => toast.error(t('contextMenus.toasts.failedMoveError', { err })));
      };

      const buildMoveSubmenu = (nodes: AlbumItem[]): Option[] => {
        let opts: Option[] = [];
        nodes.forEach((n) => {
          if (n.type === 'group' && n.id !== item?.id) {
            const isCurrentParent = n.id === currentParentId;
            const subOpts = buildMoveSubmenu((n as AlbumGroup).children);

            const customIconDef = n.icon ? albumIcons.find((i) => i.value === n.icon) : null;
            const ResolvedIcon = customIconDef?.icon || Folder;

            if (subOpts.length > 0) {
              opts.push({
                label: n.name,
                icon: ResolvedIcon,
                submenu: [
                  {
                    label: isCurrentParent ? t('contextMenus.albums.alreadyHere') : t('contextMenus.albums.moveHere'),
                    icon: Check,
                    disabled: isCurrentParent,
                    onClick: isCurrentParent ? undefined : () => handleMove(n.id),
                  },
                  { type: OPTION_SEPARATOR },
                  ...subOpts,
                ],
              });
            } else {
              opts.push({
                label: isCurrentParent ? `${n.name} (Current)` : n.name,
                icon: ResolvedIcon,
                disabled: isCurrentParent,
                onClick: isCurrentParent ? undefined : () => handleMove(n.id),
              });
            }
          }
        });
        return opts;
      };

      const moveOptions = buildMoveSubmenu(albumTree);
      const isAtRoot = currentParentId === null;
      const isMoveDisabled = moveOptions.length === 0 && isAtRoot;

      const options: Option[] = [
        {
          label: t('contextMenus.albums.newAlbum'),
          icon: Images,
          onClick: () => setUI({ albumActionTarget: item?.id || null, isCreateAlbumModalOpen: true }),
        },
        {
          label: t('contextMenus.albums.newGroup'),
          icon: FolderPlus,
          onClick: () => setUI({ albumActionTarget: item?.id || null, isCreateAlbumGroupModalOpen: true }),
        },
        ...(item
          ? [
              { type: OPTION_SEPARATOR },
              {
                label:
                  item.type === 'group' ? t('contextMenus.albums.renameGroup') : t('contextMenus.albums.renameAlbum'),
                icon: FileEdit,
                onClick: () => setUI({ albumActionTarget: item.id, isRenameAlbumModalOpen: true }),
              },
              {
                label: t('contextMenus.folders.changeIcon'),
                icon: Palette,
                submenu: albumIcons.map((iconDef) => ({
                  label: iconDef.label,
                  icon: iconDef.icon,
                  onClick: () => {
                    const newTree = structuredClone(albumTree);
                    const updateIcon = (nodes: AlbumItem[]) => {
                      for (const n of nodes) {
                        if (n.id === item.id) {
                          n.icon = iconDef.value;
                          return true;
                        }
                        if (n.type === 'group' && updateIcon((n as AlbumGroup).children)) return true;
                      }
                      return false;
                    };

                    if (updateIcon(newTree)) {
                      invoke(Invokes.SaveAlbums, { tree: newTree })
                        .then(() => invoke(Invokes.GetAlbums))
                        .then((sorted: any) => setLibrary({ albumTree: sorted }))
                        .catch((err) => toast.error(t('contextMenus.toasts.failedChangeIcon', { err })));
                    }
                  },
                })),
              },
              {
                label: t('contextMenus.albums.moveTo'),
                icon: FolderInput,
                disabled: isMoveDisabled,
                submenu: isMoveDisabled
                  ? []
                  : [
                      {
                        label: isAtRoot ? t('contextMenus.albums.alreadyAtRoot') : t('contextMenus.albums.rootDir'),
                        icon: Home,
                        disabled: isAtRoot,
                        onClick: isAtRoot ? undefined : () => handleMove(null),
                      },
                      ...(moveOptions.length > 0 ? [{ type: OPTION_SEPARATOR }, ...moveOptions] : []),
                    ],
              },
              { type: OPTION_SEPARATOR },
              {
                label:
                  item.type === 'group' ? t('contextMenus.albums.deleteGroup') : t('contextMenus.albums.deleteAlbum'),
                icon: Trash2,
                isDestructive: true,
                submenu: [
                  { label: t('contextMenus.editor.cancel'), icon: X, onClick: () => {} },
                  {
                    label:
                      item.type === 'album'
                        ? t('contextMenus.albums.confirmDeleteAlbum')
                        : (item as AlbumGroup).children.length > 0
                          ? t('contextMenus.albums.confirmDeleteGroupNested')
                          : t('contextMenus.albums.confirmDeleteGroupEmpty'),
                    icon: Check,
                    isDestructive: true,
                    onClick: () => {
                      const newTree = structuredClone(albumTree);
                      const del = (nodes: AlbumItem[]) => {
                        const idx = nodes.findIndex((n) => n.id === item.id);
                        if (idx !== -1) nodes.splice(idx, 1);
                        else
                          nodes.forEach((n) => {
                            if (n.type === 'group') del((n as AlbumGroup).children);
                          });
                      };
                      del(newTree);
                      invoke(Invokes.SaveAlbums, { tree: newTree })
                        .then(() => invoke(Invokes.GetAlbums))
                        .then((sorted: any) => setLibrary({ albumTree: sorted }))
                        .catch((err) => toast.error(t('contextMenus.toasts.failedDelete', { err })));
                    },
                  },
                ],
              },
            ]
          : []),
      ];

      showContextMenu(event.clientX, event.clientY, options);
    },
    [showContextMenu, albumIcons, t],
  );

  const handleMainLibraryContextMenu = useCallback(
    (event: any) => {
      event.preventDefault();
      event.stopPropagation();

      const { copiedFilePaths, setProcess } = useProcessStore.getState();
      const { currentFolderPath, activeAlbumId, setLibrary } = useLibraryStore.getState();

      const numCopied = copiedFilePaths.length;
      const copyPastedLabel = t('contextMenus.folders.copyHere', { count: numCopied });
      const movePastedLabel = t('contextMenus.folders.moveHere', { count: numCopied });
      const addCopiedToAlbumLabel = t('contextMenus.library.addCopiedToAlbum', { count: numCopied });

      const isAlbumView = !!activeAlbumId;
      const hasNoFolder = isCollectionView(currentFolderPath);

      const pasteOption = isAlbumView
        ? {
            label: addCopiedToAlbumLabel,
            icon: ClipboardPaste,
            disabled: copiedFilePaths.length === 0,
            onClick: async () => {
              try {
                await invoke(Invokes.AddToAlbum, { albumId: activeAlbumId, paths: copiedFilePaths });
                console.log(`Added ${numCopied} image(s) to album`);
                const updatedTree = await invoke<AlbumItem[]>(Invokes.GetAlbums);
                setLibrary({ albumTree: updatedTree });
                await props.refreshImageList();
              } catch (err) {
                toast.error(t('contextMenus.toasts.failedAddToAlbum', { err }));
              }
            },
          }
        : {
            label: t('contextMenus.folders.paste'),
            icon: ClipboardPaste,
            disabled: copiedFilePaths.length === 0 || hasNoFolder,
            submenu: [
              {
                label: copyPastedLabel,
                onClick: async () => {
                  try {
                    await invoke(Invokes.CopyFiles, {
                      sourcePaths: copiedFilePaths,
                      destinationFolder: currentFolderPath,
                    });
                    props.handleLibraryRefresh();
                  } catch (err) {
                    toast.error(t('contextMenus.toasts.failedCopy', { err }));
                  }
                },
              },
              {
                label: movePastedLabel,
                onClick: async () => {
                  try {
                    await invoke(Invokes.MoveFiles, {
                      sourcePaths: copiedFilePaths,
                      destinationFolder: currentFolderPath,
                    });
                    setProcess({ copiedFilePaths: [] });
                    setLibrary({ multiSelectedPaths: [] });
                    props.refreshAllFolderTrees();
                    props.handleLibraryRefresh();
                  } catch (err) {
                    toast.error(t('contextMenus.toasts.failedMove', { err }));
                  }
                },
              },
            ],
          };

      const options = [
        { label: t('contextMenus.library.refreshView'), icon: RefreshCw, onClick: props.handleLibraryRefresh },
        { type: OPTION_SEPARATOR },
        pasteOption,
        {
          icon: FolderInput,
          label: t('contextMenus.folders.importImages'),
          onClick: () => props.handleImportClick(currentFolderPath as string),
          disabled: !currentFolderPath || hasNoFolder,
        },
        { type: OPTION_SEPARATOR },
        {
          disabled: !canRefinePhotos(),
          icon: Flag,
          label: t('flags.refinePhotos'),
          onClick: handleRefinePhotos,
        },
        buildDeleteRejectedOption(),
      ];

      showContextMenu(event.clientX, event.clientY, options);
    },
    [buildDeleteRejectedOption, handleRefinePhotos, props, showContextMenu, t],
  );

  // The menu bar's submenus that list the user's editors and albums, for the photos the menus act on.
  const menuOptions = useMemo<Record<MenuOptionSource, () => Option>>(() => {
    const forActionPaths = (build: (paths: string[]) => Option) => () => {
      const paths = getActionPaths();
      const option = build(paths);
      return paths.length > 0 ? option : { ...option, disabled: true };
    };
    return {
      addToAlbum: forActionPaths(buildAddToAlbumOption),
      openIn: forActionPaths(buildOpenInOptionForPaths),
    };
  }, [buildAddToAlbumOption, buildOpenInOptionForPaths]);

  return {
    handleEditorContextMenu,
    handleThumbnailContextMenu,
    handleFolderTreeContextMenu,
    handleAlbumTreeContextMenu,
    handleMainLibraryContextMenu,
    menuOptions,
    photoCommands,
    readXmpFromFolder,
  };
}
