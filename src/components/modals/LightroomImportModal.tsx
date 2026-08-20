import { useCallback, useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { AlertTriangle, CheckCircle2, LoaderCircle } from 'lucide-react';
import { toast } from 'react-toastify';
import { useTranslation } from 'react-i18next';
import Button from '../ui/Button';
import Text from '../ui/Text';
import { Invokes } from '../ui/AppProperties';
import { TextVariants } from '../../types/typography';
import { globalImageCache } from '../../utils/ImageLRUCache';
import { Adjustments, INITIAL_ADJUSTMENTS, normalizeLoadedAdjustments } from '../../utils/adjustments';
import { useEditorStore } from '../../store/useEditorStore';
import { useLibraryStore } from '../../store/useLibraryStore';

interface LightroomAdjustmentChange {
  source: string;
  target: string;
  previous: unknown;
  proposed: unknown;
  confidence: 'close' | 'approximate';
}

interface LightroomImportPreview {
  path: string;
  xmpPath: string | null;
  xmpDigest: string | null;
  sidecarDigest: string | null;
  processVersion: string | null;
  changes: LightroomAdjustmentChange[];
  warnings: string[];
  error: string | null;
}

interface LightroomApplyResult {
  applied: number;
  skipped: number;
  appliedPaths: string[];
}

interface LightroomImportModalProps {
  isOpen: boolean;
  targetPaths: string[];
  onClose: () => void;
  onApplied: () => Promise<void>;
}

const displayValue = (value: unknown) => {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
};

const filename = (path: string) => path.split(/[\\/]/).pop() || path;

export default function LightroomImportModal({ isOpen, targetPaths, onClose, onApplied }: LightroomImportModalProps) {
  const { t } = useTranslation();
  const [previews, setPreviews] = useState<LightroomImportPreview[]>([]);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    setPreviews([]);
    setSelectedPaths(new Set());
    invoke<LightroomImportPreview[]>(Invokes.PreviewLightroomXmpEdits, { paths: targetPaths })
      .then((results) => {
        if (cancelled) return;
        setPreviews(results);
        setSelectedPaths(
          new Set(results.filter((preview) => !preview.error && preview.changes.length > 0).map((p) => p.path)),
        );
      })
      .catch((reason) => {
        if (!cancelled) setError(String(reason));
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, targetPaths]);

  const approvable = useMemo(
    () =>
      previews.filter(
        (preview) => !preview.error && preview.xmpDigest && preview.sidecarDigest && preview.changes.length > 0,
      ),
    [previews],
  );

  const togglePath = (path: string) => {
    setSelectedPaths((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const refreshOpenAdjustments = useCallback(async (approvedPaths: string[]) => {
    const editorState = useEditorStore.getState();
    if (editorState.selectedImage && approvedPaths.includes(editorState.selectedImage.path)) {
      const metadata = await invoke<{ adjustments?: Adjustments }>(Invokes.LoadMetadata, {
        path: editorState.selectedImage.path,
      });
      const adjustments = normalizeLoadedAdjustments(metadata.adjustments || INITIAL_ADJUSTMENTS);
      editorState.setEditor({ adjustments });
      editorState.resetHistory(adjustments);
    }

    const libraryState = useLibraryStore.getState();
    if (libraryState.libraryActivePath && approvedPaths.includes(libraryState.libraryActivePath)) {
      const metadata = await invoke<{ adjustments?: Adjustments }>(Invokes.LoadMetadata, {
        path: libraryState.libraryActivePath,
      });
      libraryState.setLibrary({
        libraryActiveAdjustments: normalizeLoadedAdjustments(metadata.adjustments || INITIAL_ADJUSTMENTS),
      });
    }
  }, []);

  const applyApproved = async () => {
    const selected = approvable.filter((preview) => selectedPaths.has(preview.path));
    if (selected.length === 0) return;
    setIsApplying(true);
    setError(null);
    try {
      const result = await invoke<LightroomApplyResult>(Invokes.ApplyApprovedLightroomXmpEdits, {
        approvals: selected.map((preview) => ({
          path: preview.path,
          xmpDigest: preview.xmpDigest!,
          sidecarDigest: preview.sidecarDigest!,
        })),
      });
      result.appliedPaths.forEach((path) => globalImageCache.delete(path));
      await refreshOpenAdjustments(result.appliedPaths);
      await invoke<number>(Invokes.RegenerateThumbnails, { paths: result.appliedPaths });
      await onApplied();
      toast.success(t('modals.lightroomImport.applied', { count: result.applied }));
      onClose();
    } catch (reason) {
      setError(String(reason));
    } finally {
      setIsApplying(false);
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && !isApplying) {
      event.preventDefault();
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4"
      role="dialog"
      onKeyDown={handleKeyDown}
    >
      <div className="flex max-h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg bg-surface shadow-2xl">
        <div className="border-b border-border-color p-5">
          <Text variant={TextVariants.title}>{t('modals.lightroomImport.title')}</Text>
          <Text className="mt-2 text-text-secondary">{t('modals.lightroomImport.description')}</Text>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {isLoading && (
            <div className="flex items-center justify-center gap-2 py-16 text-text-secondary">
              <LoaderCircle className="animate-spin" size={20} />
              {t('modals.lightroomImport.reading')}
            </div>
          )}
          {error && <div className="mb-4 rounded-md bg-red-500/10 p-3 text-red-400">{error}</div>}
          {!isLoading &&
            previews.map((preview) => {
              const canApply =
                !preview.error &&
                Boolean(preview.xmpDigest) &&
                Boolean(preview.sidecarDigest) &&
                preview.changes.length > 0;
              return (
                <section key={preview.path} className="mb-4 rounded-lg border border-border-color bg-bg-secondary p-4">
                  <div className="flex items-start gap-3">
                    <input
                      aria-label={t('modals.lightroomImport.approveImage', { filename: filename(preview.path) })}
                      checked={canApply && selectedPaths.has(preview.path)}
                      className="mt-1 h-4 w-4 accent-accent"
                      disabled={!canApply || isApplying}
                      onChange={() => togglePath(preview.path)}
                      type="checkbox"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Text className="font-semibold">{filename(preview.path)}</Text>
                        {preview.processVersion && (
                          <span className="rounded bg-surface px-2 py-0.5 text-xs text-text-secondary">
                            {t('modals.lightroomImport.processVersion', { version: preview.processVersion })}
                          </span>
                        )}
                      </div>
                      {preview.xmpPath && <div className="truncate text-xs text-text-secondary">{preview.xmpPath}</div>}
                      {preview.error ? (
                        <div className="mt-3 flex items-start gap-2 text-sm text-text-secondary">
                          <AlertTriangle className="mt-0.5 shrink-0" size={16} /> {preview.error}
                        </div>
                      ) : (
                        <div className="mt-3 overflow-hidden rounded border border-border-color">
                          {preview.changes.map((change, index) => (
                            <div
                              className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto] gap-3 border-b border-border-color px-3 py-2 text-sm last:border-b-0"
                              key={`${change.target}-${index}`}
                            >
                              <div className="min-w-0">
                                <div className="truncate font-medium">{change.target}</div>
                                <div className="truncate text-xs text-text-secondary">{change.source}</div>
                              </div>
                              <div className="truncate text-text-secondary">
                                {displayValue(change.previous)} →{' '}
                                <span className="text-text-primary">{displayValue(change.proposed)}</span>
                              </div>
                              <span
                                className={`self-center rounded px-2 py-0.5 text-xs ${
                                  change.confidence === 'close'
                                    ? 'bg-green-500/15 text-green-400'
                                    : 'bg-amber-500/15 text-amber-400'
                                }`}
                              >
                                {t(`modals.lightroomImport.${change.confidence}`)}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                      {preview.warnings.map((warning) => (
                        <div className="mt-2 flex items-start gap-2 text-xs text-amber-400" key={warning}>
                          <AlertTriangle className="mt-0.5 shrink-0" size={14} /> {warning}
                        </div>
                      ))}
                    </div>
                  </div>
                </section>
              );
            })}
        </div>

        <div className="border-t border-border-color p-5">
          <div className="mb-4 flex items-start gap-2 rounded-md bg-green-500/10 p-3 text-sm text-green-300">
            <CheckCircle2 className="mt-0.5 shrink-0" size={16} />
            {t('modals.lightroomImport.safety')}
          </div>
          <div className="flex justify-end gap-3">
            <Button disabled={isApplying} onClick={onClose} variant="ghost">
              {t('modals.lightroomImport.cancel')}
            </Button>
            <Button disabled={isApplying || selectedPaths.size === 0} onClick={applyApproved}>
              {isApplying
                ? t('modals.lightroomImport.applying')
                : t('modals.lightroomImport.applySelected', { count: selectedPaths.size })}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
