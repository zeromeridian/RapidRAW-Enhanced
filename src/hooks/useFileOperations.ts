import { useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'react-toastify';
import { useLibraryStore } from '../store/useLibraryStore';
import { useEditorStore } from '../store/useEditorStore';
import { useUIStore } from '../store/useUIStore';
import { useProcessStore } from '../store/useProcessStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { Invokes, LibraryViewMode } from '../components/ui/AppProperties';
import { ImportSettings, Status } from '../components/ui/ExportImportProperties';
import { isCollectionView, isPathWithin } from '../utils/libraryViews';
import { debouncedSave } from './useEditorActions';
import { DEFAULT_IMPORT_TEMPLATE } from '../utils/filenameTemplates';
import { DEFAULT_DATE_FOLDER_FORMAT, pickImportFiles } from '../utils/importSettings';

export function useFileOperations(
  refreshImageList: () => Promise<void>,
  refreshAllFolderTrees: () => Promise<void>,
  handleImageSelect: (path: string) => void,
  handleBackToLibrary: () => void,
  sortedImageList: any[],
) {
  const getParentDir = (filePath: string): string => {
    const separator = filePath.includes('/') ? '/' : '\\';
    const lastSeparatorIndex = filePath.lastIndexOf(separator);
    if (lastSeparatorIndex === -1) return '';
    return filePath.substring(0, lastSeparatorIndex);
  };

  const executeDelete = useCallback(
    async (pathsToDelete: Array<string>, options = { includeAssociated: false }) => {
      if (!pathsToDelete || pathsToDelete.length === 0) return;

      const { libraryActivePath, setLibrary } = useLibraryStore.getState();
      const { selectedImage } = useEditorStore.getState();

      const activePath = selectedImage ? selectedImage.path : libraryActivePath;
      let nextImagePath: string | null = null;

      if (activePath) {
        const physicalPath = activePath.split('?vc=')[0];
        const isActiveImageDeleted = pathsToDelete.some((p) => p === activePath || p === physicalPath);

        if (isActiveImageDeleted) {
          // Deleting an image also deletes its virtual copies.
          const isDeleted = (path: string) =>
            pathsToDelete.includes(path) || pathsToDelete.includes(path.split('?vc=')[0]);
          const currentIndex = sortedImageList.findIndex((img) => img.path === activePath);
          if (currentIndex !== -1) {
            const nextCandidate = sortedImageList.slice(currentIndex + 1).find((img) => !isDeleted(img.path));

            if (nextCandidate) {
              nextImagePath = nextCandidate.path;
            } else {
              const prevCandidate = sortedImageList
                .slice(0, currentIndex)
                .reverse()
                .find((img) => !isDeleted(img.path));

              if (prevCandidate) {
                nextImagePath = prevCandidate.path;
              }
            }
          }
        } else {
          nextImagePath = activePath;
        }
      }

      try {
        const command = options.includeAssociated ? 'delete_files_with_associated' : 'delete_files_from_disk';
        await invoke(command, { paths: pathsToDelete });
        await refreshImageList();

        if (selectedImage) {
          const physicalPath = selectedImage.path.split('?vc=')[0];
          const isFileBeingEditedDeleted = pathsToDelete.some((p) => p === selectedImage.path || p === physicalPath);

          if (isFileBeingEditedDeleted) {
            if (nextImagePath) {
              handleImageSelect(nextImagePath);
            } else {
              handleBackToLibrary();
            }
          }
        } else {
          if (nextImagePath) {
            setLibrary({ multiSelectedPaths: [nextImagePath], libraryActivePath: nextImagePath });
          } else {
            setLibrary({ multiSelectedPaths: [], libraryActivePath: null });
          }
        }
      } catch (err) {
        console.error('Failed to delete files:', err);
        toast.error(`Failed to delete files: ${err}`);
      }
    },
    [refreshImageList, handleBackToLibrary, sortedImageList, handleImageSelect],
  );

  const handleDeleteSelected = useCallback(() => {
    const { multiSelectedPaths, imageList } = useLibraryStore.getState();
    const { setUI } = useUIStore.getState();

    const pathsToDelete = multiSelectedPaths;
    if (pathsToDelete.length === 0) {
      return;
    }

    const isSingle = pathsToDelete.length === 1;

    const selectionHasVirtualCopies =
      isSingle &&
      !pathsToDelete[0].includes('?vc=') &&
      imageList.some((image) => image.path.startsWith(`${pathsToDelete[0]}?vc=`));

    let modalTitle = 'Confirm Delete';
    let modalMessage = '';
    let confirmText = 'Delete';

    if (selectionHasVirtualCopies) {
      modalTitle = 'Delete Image and All Virtual Copies?';
      modalMessage = `Are you sure you want to permanently delete this image and all of its virtual copies? This action cannot be undone.`;
      confirmText = 'Delete All';
    } else if (isSingle) {
      modalMessage = `Are you sure you want to permanently delete this image? This action cannot be undone. Right-click for more options (e.g., deleting associated files).`;
      confirmText = 'Delete Selected Only';
    } else {
      modalMessage = `Are you sure you want to permanently delete these ${pathsToDelete.length} images? This action cannot be undone. Right-click for more options (e.g., deleting associated files).`;
      confirmText = 'Delete Selected Only';
    }

    setUI({
      confirmModalState: {
        confirmText,
        confirmVariant: 'destructive',
        isOpen: true,
        message: modalMessage,
        onConfirm: () => executeDelete(pathsToDelete, { includeAssociated: false }),
        title: modalTitle,
      },
    });
  }, [executeDelete]);

  const handleCreateFolder = useCallback(
    async (folderName: string) => {
      const { folderActionTarget } = useUIStore.getState();

      if (folderName && folderName.trim() !== '' && folderActionTarget) {
        try {
          await invoke(Invokes.CreateFolder, { path: `${folderActionTarget}/${folderName.trim()}` });
          await refreshAllFolderTrees();
        } catch (err) {
          toast.error(`Failed to create folder: ${err}`);
        }
      }
    },
    [refreshAllFolderTrees],
  );

  const handleRenameFolder = useCallback(
    async (newName: string) => {
      const { folderActionTarget } = useUIStore.getState();
      const { rootPaths, currentFolderPath, setLibrary } = useLibraryStore.getState();
      const { appSettings, handleSettingsChange } = useSettingsStore.getState();

      if (newName && newName.trim() !== '' && folderActionTarget) {
        try {
          const oldPath = folderActionTarget;
          const trimmedNewName = newName.trim();

          await invoke(Invokes.RenameFolder, { path: oldPath, newName: trimmedNewName });

          const parentDir = getParentDir(oldPath);
          const separator = oldPath.includes('/') ? '/' : '\\';
          const newPath = parentDir ? `${parentDir}${separator}${trimmedNewName}` : trimmedNewName;

          const isInRenamedFolder = (p: string) =>
            p === oldPath || p.startsWith(`${oldPath}/`) || p.startsWith(`${oldPath}\\`);
          const renamePath = (p: string) => (isInRenamedFolder(p) ? newPath + p.slice(oldPath.length) : p);

          const newAppSettings = { ...appSettings } as any;
          let settingsChanged = false;

          if (rootPaths.some(isInRenamedFolder)) {
            const newRoots = rootPaths.map(renamePath);
            setLibrary({ rootPaths: newRoots });
            newAppSettings.rootFolders = newRoots;
            settingsChanged = true;
          }
          if (currentFolderPath && isInRenamedFolder(currentFolderPath)) {
            setLibrary({ currentFolderPath: renamePath(currentFolderPath) });
          } else if (
            currentFolderPath &&
            isPathWithin(oldPath, currentFolderPath) &&
            appSettings?.libraryViewMode === LibraryViewMode.Recursive
          ) {
            // The recursive view of a parent folder still lists the old paths.
            await refreshImageList();
          }

          const currentPins = appSettings?.pinnedFolders || [];
          if (currentPins.some(isInRenamedFolder)) {
            const newPins = currentPins.map(renamePath).sort((a: string, b: string) => a.localeCompare(b));
            newAppSettings.pinnedFolders = newPins;
            settingsChanged = true;
          }

          if (settingsChanged) {
            handleSettingsChange(newAppSettings);
          }

          await refreshAllFolderTrees();
        } catch (err) {
          toast.error(`Failed to rename folder: ${err}`);
        }
      }
    },
    [refreshAllFolderTrees, refreshImageList],
  );

  const handleSaveRename = useCallback(
    async (nameTemplate: string, texts: Array<string> | null) => {
      const { renameTargetPaths, setUI } = useUIStore.getState();
      const { selectedImage } = useEditorStore.getState();
      const { libraryActivePath, setLibrary } = useLibraryStore.getState();

      if (renameTargetPaths.length > 0 && nameTemplate) {
        try {
          // A pending edit must reach the old name's sidecar before it moves,
          // or it would write a new sidecar under the old name afterwards.
          debouncedSave.flush();
          const newPaths: Array<string> = await invoke(Invokes.RenameFiles, {
            nameTemplate,
            paths: renameTargetPaths,
            texts,
          });

          await refreshImageList();

          if (selectedImage && renameTargetPaths.includes(selectedImage.path)) {
            const oldPathIndex = renameTargetPaths.indexOf(selectedImage.path);
            if (newPaths[oldPathIndex]) {
              handleImageSelect(newPaths[oldPathIndex]);
            } else {
              handleBackToLibrary();
            }
          }

          if (libraryActivePath && renameTargetPaths.includes(libraryActivePath)) {
            const oldPathIndex = renameTargetPaths.indexOf(libraryActivePath);
            if (newPaths[oldPathIndex]) {
              setLibrary({ libraryActivePath: newPaths[oldPathIndex] });
            } else {
              setLibrary({ libraryActivePath: null });
            }
          }

          setLibrary({ multiSelectedPaths: newPaths });
        } catch (err) {
          toast.error(`Failed to rename files: ${err}`);
        }
      }
      setUI({ renameTargetPaths: [] });
    },
    [refreshImageList, handleImageSelect, handleBackToLibrary],
  );

  // Sequence numbers follow the grid's order, as in Lightroom Classic, not the order the
  // photos were selected in; photos the grid does not show keep their order at the end.
  const handleRenameFiles = useCallback(
    (paths: Array<string>) => {
      if (paths && paths.length > 0) {
        const gridIndex = new Map(sortedImageList.map((image, index) => [image.path, index]));
        const ordered = [...paths].sort(
          (a, b) =>
            (gridIndex.get(a) ?? Infinity) - (gridIndex.get(b) ?? Infinity) || paths.indexOf(a) - paths.indexOf(b),
        );
        useUIStore.getState().setUI({ renameTargetPaths: ordered, isRenameFileModalOpen: true });
      }
    },
    [sortedImageList],
  );

  const startImportFiles = useCallback(
    async (sourcePaths: string[], destinationFolder: string, settings: ImportSettings) => {
      if (sourcePaths.length === 0 || !destinationFolder) return;

      try {
        await invoke(Invokes.ImportFiles, { destinationFolder, settings, sourcePaths });
      } catch (err) {
        console.error('Failed to start import:', err);
        useProcessStore
          .getState()
          .setImportState({ status: Status.Error, errorMessage: `Failed to start import: ${err}` });
      }
    },
    [],
  );

  const handleStartImport = useCallback(
    async (settings: ImportSettings, destination: string, sourcePaths: Array<string>) => {
      await startImportFiles(sourcePaths, destination, settings);
    },
    [startImportFiles],
  );

  /**
   * Opens the Import dialog, which picks its own source; `targetPath` is the folder it was
   * started on. Android has no dialog: the photos picked import into that folder at once.
   */
  const handleImportClick = useCallback(
    async (targetPath: string | null = null) => {
      if (useSettingsStore.getState().osPlatform !== 'android') {
        useUIStore.getState().setUI({ importSourcePaths: [], importTargetFolder: targetPath, isImportModalOpen: true });
        return;
      }
      const files = await pickImportFiles();
      const androidTarget = targetPath ?? useLibraryStore.getState().currentFolderPath;
      if (!files || !androidTarget) return;
      await startImportFiles(files, androidTarget, {
        filenameTemplate: DEFAULT_IMPORT_TEMPLATE,
        organizeByDate: false,
        dateFolderFormat: DEFAULT_DATE_FOLDER_FORMAT,
        deleteAfterImport: false,
      });
    },
    [startImportFiles],
  );

  const handlePasteFiles = useCallback(
    async (mode = 'copy') => {
      const { copiedFilePaths, setProcess } = useProcessStore.getState();
      const { currentFolderPath, setLibrary } = useLibraryStore.getState();

      if (copiedFilePaths.length === 0 || !currentFolderPath || isCollectionView(currentFolderPath)) return;

      try {
        if (mode === 'copy') {
          await invoke(Invokes.CopyFiles, { sourcePaths: copiedFilePaths, destinationFolder: currentFolderPath });
        } else {
          await invoke(Invokes.MoveFiles, { sourcePaths: copiedFilePaths, destinationFolder: currentFolderPath });
          setProcess({ copiedFilePaths: [] });
          setLibrary({ multiSelectedPaths: [] });
          await refreshAllFolderTrees();
        }
        await refreshImageList();
      } catch (err) {
        toast.error(`Failed to ${mode} files: ${err}`);
      }
    },
    [refreshImageList, refreshAllFolderTrees],
  );

  return {
    executeDelete,
    handleDeleteSelected,
    handleCreateFolder,
    handleRenameFolder,
    handleSaveRename,
    handleRenameFiles,
    handleStartImport,
    startImportFiles,
    handleImportClick,
    handlePasteFiles,
  };
}
