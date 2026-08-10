import { useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { Check, Folder, Loader2, Search, SwatchBook, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';

import Button from '../ui/Button';
import { Invokes, Preset } from '../ui/AppProperties';
import Text from '../ui/Text';
import { TextColors, TextVariants } from '../../types/typography';
import { UserPreset } from '../../hooks/usePresets';
import { PresetBatchTarget } from '../../store/useUIStore';
import { useEditorStore } from '../../store/useEditorStore';
import { useLibraryStore } from '../../store/useLibraryStore';
import { normalizeLoadedAdjustments } from '../../utils/adjustments';

interface PresetBatchModalProps {
  isOpen: boolean;
  onClose(): void;
  target: PresetBatchTarget;
}

interface DisplayPreset {
  folderName: string | null;
  preset: Preset;
}

interface BatchProgress {
  cancelled: boolean;
  current: number;
  failed: number;
  jobId: string;
  stage: 'discovering' | 'applying' | 'complete';
  total: number;
}

interface BatchResult {
  applied: number;
  cancelled: boolean;
  failed: number;
  jobId: string;
  total: number;
}

export default function PresetBatchModal({ isOpen, onClose, target }: PresetBatchModalProps) {
  const { t } = useTranslation();
  const [presets, setPresets] = useState<DisplayPreset[]>([]);
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [includeSubfolders, setIncludeSubfolders] = useState(target.includeSubfolders);
  const [isLoading, setIsLoading] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [progress, setProgress] = useState<BatchProgress | null>(null);
  const [result, setResult] = useState<BatchResult | null>(null);
  const [activeTarget, setActiveTarget] = useState<PresetBatchTarget | null>(null);
  const activePathsApplied = useRef(new Set<string>());

  useEffect(() => {
    const unlisten = listen<BatchProgress>('preset-batch-progress', (event) => {
      setProgress(event.payload);
    });
    return () => {
      void unlisten.then((stop) => stop());
    };
  }, []);

  useEffect(() => {
    const unlisten = listen<{ path: string }>('preset-batch-image-applied', (event) => {
      const selectedPath = useEditorStore.getState().selectedImage?.path;
      const libraryPath = useLibraryStore.getState().libraryActivePath;
      if (event.payload.path === selectedPath || event.payload.path === libraryPath) {
        activePathsApplied.current.add(event.payload.path);
      }
    });
    return () => {
      void unlisten.then((stop) => stop());
    };
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    if (isApplying) return;
    setIncludeSubfolders(target.includeSubfolders);
    setSelectedPresetId(null);
    setSearch('');
    setProgress(null);
    setResult(null);
    setIsCancelling(false);
    activePathsApplied.current.clear();
    setIsLoading(true);
    invoke<UserPreset[]>(Invokes.LoadPresets)
      .then((items) => {
        const flattened: DisplayPreset[] = [];
        for (const item of items) {
          if (item.preset) {
            flattened.push({ folderName: null, preset: item.preset });
          } else if (item.folder) {
            for (const preset of item.folder.children) {
              flattened.push({ folderName: item.folder.name ?? null, preset });
            }
          }
        }
        setPresets(flattened);
      })
      .catch((error) => toast.error(t('presetBatch.loadFailed', { error })))
      .finally(() => setIsLoading(false));
  }, [isOpen, target.includeSubfolders, t]);

  const filteredPresets = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    if (!query) return presets;
    return presets.filter(
      ({ preset, folderName }) =>
        preset.name.toLocaleLowerCase().includes(query) || folderName?.toLocaleLowerCase().includes(query),
    );
  }, [presets, search]);

  const selectedPreset = presets.find(({ preset }) => preset.id === selectedPresetId)?.preset ?? null;
  const displayTarget = (isApplying || result) && activeTarget ? activeTarget : target;
  const isFolderTarget = displayTarget.folderPaths.length > 0;
  const targetLabel = isFolderTarget
    ? t('presetBatch.folderTarget', { count: displayTarget.folderPaths.length })
    : t('presetBatch.imageTarget', { count: displayTarget.imagePaths.length });

  const refreshActiveAdjustmentState = async () => {
    const selectedImage = useEditorStore.getState().selectedImage;
    const libraryActivePath = useLibraryStore.getState().libraryActivePath;
    const paths = [...new Set([selectedImage?.path, libraryActivePath].filter(Boolean) as string[])].filter((path) =>
      activePathsApplied.current.has(path),
    );
    for (const path of paths) {
      try {
        const metadata = await invoke<{ adjustments?: Record<string, unknown> }>(Invokes.LoadMetadata, { path });
        if (!metadata.adjustments || metadata.adjustments.is_null) continue;
        const normalized = normalizeLoadedAdjustments(metadata.adjustments);
        if (selectedImage?.path === path) {
          useEditorStore.getState().resetHistory(normalized);
        }
        if (libraryActivePath === path) {
          useLibraryStore.getState().setLibrary({ libraryActiveAdjustments: normalized });
        }
      } catch (error) {
        console.error(`Failed to refresh adjustments for ${path}:`, error);
      }
    }
  };

  const handleApply = async () => {
    if (!selectedPreset || isApplying) return;
    setIsApplying(true);
    setIsCancelling(false);
    setActiveTarget({ ...target, includeSubfolders });
    setProgress({ cancelled: false, current: 0, failed: 0, jobId: '', stage: 'discovering', total: 0 });
    try {
      const batchResult = await invoke<BatchResult>(Invokes.ApplyPresetBatch, {
        request: {
          adjustments: selectedPreset.adjustments,
          folders: target.folderPaths,
          includeSubfolders,
          paths: target.imagePaths,
        },
      });
      setResult(batchResult);
      await refreshActiveAdjustmentState();
      if (batchResult.cancelled) {
        toast.info(t('presetBatch.cancelledToast', { count: batchResult.applied }));
      } else if (batchResult.total === 0) {
        toast.info(t('presetBatch.noImagesFound'));
      } else if (batchResult.failed > 0) {
        toast.warning(
          t('presetBatch.completedWithFailures', {
            applied: batchResult.applied,
            failed: batchResult.failed,
          }),
        );
      } else {
        toast.success(t('presetBatch.completedToast', { count: batchResult.applied }));
      }
    } catch (error) {
      toast.error(t('presetBatch.applyFailed', { error }));
      setProgress(null);
    } finally {
      setIsApplying(false);
      setIsCancelling(false);
    }
  };

  const handleCancel = async () => {
    if (!isApplying || isCancelling) return;
    setIsCancelling(true);
    try {
      await invoke<boolean>(Invokes.CancelPresetBatch);
    } catch (error) {
      setIsCancelling(false);
      toast.error(t('presetBatch.cancelFailed', { error }));
    }
  };

  if (!isOpen) return null;

  const progressPercent = progress?.total ? Math.min(100, (progress.current / progress.total) * 100) : 0;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-2xl max-h-[80vh] rounded-xl bg-bg-secondary shadow-2xl border border-surface flex flex-col overflow-hidden">
        <div className="flex items-center justify-between gap-4 px-5 py-4 border-b border-surface">
          <div className="flex items-center gap-3 min-w-0">
            <SwatchBook size={20} className="text-accent shrink-0" />
            <div className="min-w-0">
              <Text variant={TextVariants.title}>{t('presetBatch.title')}</Text>
              <Text color={TextColors.secondary} className="truncate">
                {targetLabel}
              </Text>
            </div>
          </div>
          <button
            className="p-2 rounded-md hover:bg-surface disabled:opacity-40"
            onClick={onClose}
            aria-label={t('presetBatch.close')}
          >
            <X size={18} />
          </button>
        </div>

        {isApplying || result ? (
          <div className="p-6 flex flex-col gap-5">
            <div className="flex items-center gap-3">
              {isApplying ? (
                <Loader2 className="animate-spin text-accent" size={22} />
              ) : (
                <Check className="text-accent" />
              )}
              <div>
                <Text variant={TextVariants.title}>
                  {isApplying
                    ? progress?.stage === 'discovering'
                      ? t('presetBatch.discovering')
                      : t('presetBatch.applying')
                    : result?.cancelled
                      ? t('presetBatch.cancelled')
                      : t('presetBatch.complete')}
                </Text>
                <Text color={TextColors.secondary}>
                  {progress?.total
                    ? t('presetBatch.progress', {
                        current: progress.current,
                        total: progress.total,
                        failed: progress.failed,
                      })
                    : t('presetBatch.preparing')}
                </Text>
              </div>
            </div>
            <div className="h-2 rounded-full bg-surface overflow-hidden">
              <div
                className="h-full bg-accent transition-[width] duration-150"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            {result && (
              <Text color={TextColors.secondary}>
                {t('presetBatch.summary', {
                  applied: result.applied,
                  failed: result.failed,
                  total: result.total,
                })}
              </Text>
            )}
            <div className="flex justify-end gap-2">
              {isApplying ? (
                <>
                  <Button className="bg-surface" onClick={onClose}>
                    {t('presetBatch.runInBackground')}
                  </Button>
                  <Button className="bg-surface" disabled={isCancelling} onClick={handleCancel}>
                    {isCancelling ? t('presetBatch.cancelling') : t('presetBatch.cancel')}
                  </Button>
                </>
              ) : (
                <Button onClick={onClose}>{t('presetBatch.close')}</Button>
              )}
            </div>
          </div>
        ) : (
          <>
            <div className="p-4 border-b border-surface flex flex-col gap-3">
              <label className="relative block">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" />
                <input
                  autoFocus
                  className="w-full rounded-md bg-surface py-2 pl-9 pr-3 outline-none focus:ring-1 focus:ring-accent"
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder={t('presetBatch.search')}
                  value={search}
                />
              </label>
              {isFolderTarget && (
                <label className="flex items-center gap-2 cursor-pointer text-sm">
                  <input
                    type="checkbox"
                    checked={includeSubfolders}
                    onChange={(event) => setIncludeSubfolders(event.target.checked)}
                  />
                  {t('presetBatch.includeSubfolders')}
                </label>
              )}
            </div>
            <div className="min-h-48 grow overflow-y-auto custom-scrollbar p-2">
              {isLoading ? (
                <div className="h-40 flex items-center justify-center text-text-secondary">
                  <Loader2 className="animate-spin" />
                </div>
              ) : filteredPresets.length === 0 ? (
                <div className="h-40 flex items-center justify-center text-text-secondary">
                  {t('presetBatch.noPresets')}
                </div>
              ) : (
                filteredPresets.map(({ preset, folderName }) => (
                  <button
                    key={preset.id}
                    className={`w-full flex items-center gap-3 rounded-md px-3 py-2 text-left transition-colors ${
                      selectedPresetId === preset.id ? 'bg-accent/20 text-text-primary' : 'hover:bg-surface'
                    }`}
                    onClick={() => setSelectedPresetId(preset.id)}
                  >
                    <SwatchBook size={17} className="shrink-0" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{preset.name}</span>
                      {folderName && (
                        <span className="flex items-center gap-1 text-xs text-text-secondary truncate">
                          <Folder size={11} /> {folderName}
                        </span>
                      )}
                    </span>
                    {selectedPresetId === preset.id && <Check size={17} className="text-accent" />}
                  </button>
                ))
              )}
            </div>
            <div className="flex items-center justify-between gap-4 px-5 py-4 border-t border-surface">
              <Text color={TextColors.secondary} className="truncate">
                {selectedPreset?.name ?? t('presetBatch.selectPrompt')}
              </Text>
              <div className="flex gap-2 shrink-0">
                <Button className="bg-surface" onClick={onClose}>
                  {t('presetBatch.cancel')}
                </Button>
                <Button disabled={!selectedPreset} onClick={handleApply}>
                  {t('presetBatch.apply')}
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
