import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Eye, Lock, Plus, SlidersHorizontal, ArrowDown, ArrowUp } from 'lucide-react';
import { toast } from 'react-toastify';

import { Invokes } from '../../ui/AppProperties';
import { useEditorStore } from '../../../store/useEditorStore';
import { useLibraryStore } from '../../../store/useLibraryStore';
import { useSettingsStore } from '../../../store/useSettingsStore';
import { defaultInitialImageLayerPlacement } from '../../../utils/plusFeatures';
import { getEnabledCopySuffix } from '../../../utils/outputNaming';

interface LayersPanelProps {
  onCompositionCreated(path: string): Promise<void>;
}

type PreviewLayerKind = 'image' | 'adjustment';

interface PreviewLayer {
  id: string;
  name: string;
  kind: PreviewLayerKind;
  visible: boolean;
  locked: boolean;
  opacity: number;
}

export default function LayersPanel({ onCompositionCreated }: LayersPanelProps) {
  const [isCreating, setIsCreating] = useState(false);
  const [previewLayers, setPreviewLayers] = useState<PreviewLayer[]>([]);
  const [previewOpacity, setPreviewOpacity] = useState<Record<string, number>>({});
  const [previewVisibility, setPreviewVisibility] = useState<Record<string, boolean>>({});
  const [previewLocks, setPreviewLocks] = useState<Record<string, boolean>>({});
  const previewLayerNumber = useRef(0);
  const document = useEditorStore((state) => state.document);
  const selectedImage = useEditorStore((state) => state.selectedImage);
  const activeAlbumId = useLibraryStore((state) => state.activeAlbumId);
  const appSettings = useSettingsStore((state) => state.appSettings);

  useEffect(() => {
    setPreviewLayers([]);
    setPreviewOpacity({});
    setPreviewVisibility({});
    setPreviewLocks({});
    previewLayerNumber.current = 0;
  }, [document.mode === 'layered' ? document.id : null]);

  const addPreviewLayer = (kind: PreviewLayerKind) => {
    const number = ++previewLayerNumber.current;
    const label = kind === 'image' ? 'Image layer' : 'Adjustment layer';

    setPreviewLayers((current) => [
      {
        id: `preview-${kind}-${number}`,
        name: `${label} ${number}`,
        kind,
        visible: true,
        locked: false,
        opacity: 100,
      },
      ...current,
    ]);
  };

  const createLayeredVersion = async () => {
    if (!selectedImage?.isReady || isCreating) return;

    setIsCreating(true);
    try {
      const compositionPath = await invoke<string>(Invokes.CreateLayeredVirtualComposition, {
        sourceVirtualPath: selectedImage.path,
        canvasWidth: selectedImage.width,
        canvasHeight: selectedImage.height,
        initialImageLayerPlacement: defaultInitialImageLayerPlacement,
        targetAlbumId: activeAlbumId || null,
        copyNameSuffix: getEnabledCopySuffix(appSettings),
      });
      await onCompositionCreated(compositionPath);
      toast.success('Layered version created.');
    } catch (error) {
      toast.error(`Could not create layered version: ${error}`);
    } finally {
      setIsCreating(false);
    }
  };

  if (document.mode === 'single') {
    return (
      <section className="flex h-full flex-col gap-4 p-4">
        <div>
          <h2 className="text-sm font-semibold text-text-primary">ThisIsRAW Plus Layers</h2>
          <p className="mt-1 text-xs leading-5 text-text-secondary">
            Create a separate virtual composition. Your original image and edits stay unchanged.
          </p>
        </div>
        <button
          className="flex items-center justify-center gap-2 rounded-md bg-accent px-3 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
          disabled={!selectedImage?.isReady || isCreating}
          onClick={createLayeredVersion}
        >
          <Plus size={16} aria-hidden="true" />
          {isCreating ? 'Creating…' : 'Create Layered Version'}
        </button>
      </section>
    );
  }

  return (
    <section className="flex h-full flex-col p-4">
      <div className="mb-3">
        <h2 className="text-sm font-semibold text-text-primary">
          Layers <span className="font-normal text-text-secondary">(Plus prototype)</span>
        </h2>
        <p className="mt-1 text-xs leading-5 text-text-secondary">
          Interaction preview only. Changes below are not saved or rendered until GPU compositing is enabled.
        </p>
      </div>
      <div className="mb-3 rounded-md border border-surface bg-bg-tertiary px-3 py-2 text-xs text-text-secondary">
        Layers are shown front to back. The persisted document order remains bottom to top.
      </div>
      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
        {[...previewLayers, ...[...document.layers].reverse().map((layer) => ({ ...layer, isPreview: false }))].map(
          (layer) => {
            const visible = previewVisibility[layer.id] ?? layer.visible;
            const locked = previewLocks[layer.id] ?? layer.locked;
            const opacity = previewOpacity[layer.id] ?? layer.opacity;
            const isPreview = 'isPreview' in layer ? layer.isPreview : true;

            return (
              <div
                key={layer.id}
                className={`rounded-md border bg-bg-tertiary px-2 py-2 ${
                  isPreview ? 'border-dashed border-accent/60' : 'border-surface'
                }`}
              >
                <div className="flex items-center gap-2">
                  <button
                    aria-label={visible ? 'Hide layer preview' : 'Show layer preview'}
                    aria-pressed={visible}
                    className="text-text-secondary hover:text-text-primary"
                    onClick={() => setPreviewVisibility((current) => ({ ...current, [layer.id]: !visible }))}
                  >
                    <Eye size={15} />
                  </button>
                  <span className="min-w-0 flex-1 truncate text-sm text-text-primary">{layer.name}</span>
                  {isPreview && (
                    <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-accent">
                      Preview
                    </span>
                  )}
                  {layer.kind === 'adjustment' && (
                    <SlidersHorizontal size={15} className="shrink-0 text-text-secondary" />
                  )}
                  <button
                    aria-label={locked ? 'Unlock layer preview' : 'Lock layer preview'}
                    aria-pressed={locked}
                    className="text-text-secondary hover:text-text-primary"
                    onClick={() => setPreviewLocks((current) => ({ ...current, [layer.id]: !locked }))}
                  >
                    <Lock size={14} />
                  </button>
                </div>
                <div className="mt-2 flex items-center gap-2 text-xs text-text-secondary">
                  <label className="flex flex-1 items-center gap-2">
                    Opacity{' '}
                    <input
                      aria-label="Preview opacity"
                      type="range"
                      value={opacity}
                      min="0"
                      max="100"
                      className="min-w-0 flex-1"
                      onChange={(event) =>
                        setPreviewOpacity((current) => ({ ...current, [layer.id]: Number(event.target.value) }))
                      }
                    />
                  </label>
                  <button
                    aria-label="Move layer up unavailable until compositing is enabled"
                    disabled
                    className="opacity-50"
                  >
                    <ArrowUp size={14} />
                  </button>
                  <button
                    aria-label="Move layer down unavailable until compositing is enabled"
                    disabled
                    className="opacity-50"
                  >
                    <ArrowDown size={14} />
                  </button>
                </div>
              </div>
            );
          },
        )}
      </div>
      <div className="mt-3 flex gap-2 border-t border-surface pt-3">
        <button
          aria-label="Add preview image layer"
          className="flex flex-1 items-center justify-center gap-1 rounded-md border border-surface px-2 py-2 text-xs text-text-secondary hover:text-text-primary"
          onClick={() => addPreviewLayer('image')}
        >
          <Plus size={14} /> Add image
        </button>
        <button
          aria-label="Add preview adjustment layer"
          className="flex flex-1 items-center justify-center gap-1 rounded-md border border-surface px-2 py-2 text-xs text-text-secondary hover:text-text-primary"
          onClick={() => addPreviewLayer('adjustment')}
        >
          <SlidersHorizontal size={14} /> Adjustment layer
        </button>
      </div>
    </section>
  );
}
