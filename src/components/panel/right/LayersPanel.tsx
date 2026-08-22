import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Eye, Lock, Plus, SlidersHorizontal } from 'lucide-react';
import { toast } from 'react-toastify';

import { Invokes } from '../../ui/AppProperties';
import { useEditorStore } from '../../../store/useEditorStore';
import { useLibraryStore } from '../../../store/useLibraryStore';
import { useSettingsStore } from '../../../store/useSettingsStore';
import { defaultInitialImageLayerPlacement } from '../../../utils/plusFeatures';
import { getEnabledCopySuffix } from '../../../utils/outputNaming';

interface LayersPanelProps {
  onCompositionCreated(): Promise<void>;
}

export default function LayersPanel({ onCompositionCreated }: LayersPanelProps) {
  const [isCreating, setIsCreating] = useState(false);
  const document = useEditorStore((state) => state.document);
  const selectedImage = useEditorStore((state) => state.selectedImage);
  const activeAlbumId = useLibraryStore((state) => state.activeAlbumId);
  const appSettings = useSettingsStore((state) => state.appSettings);

  const createLayeredVersion = async () => {
    if (!selectedImage?.isReady || isCreating) return;

    setIsCreating(true);
    try {
      await invoke<string>(Invokes.CreateLayeredVirtualComposition, {
        sourceVirtualPath: selectedImage.path,
        canvasWidth: selectedImage.width,
        canvasHeight: selectedImage.height,
        initialImageLayerPlacement: defaultInitialImageLayerPlacement,
        targetAlbumId: activeAlbumId || null,
        copyNameSuffix: getEnabledCopySuffix(appSettings),
      });
      await onCompositionCreated();
      toast.success('Layered version created. Select it from the filmstrip to review the Layer dock.');
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
          <Plus size={16} />
          {isCreating ? 'Creating…' : 'Create Layered Version'}
        </button>
      </section>
    );
  }

  return (
    <section className="flex h-full flex-col p-4">
      <div className="mb-3">
        <h2 className="text-sm font-semibold text-text-primary">ThisIsRAW Plus Layers</h2>
        <p className="mt-1 text-xs leading-5 text-text-secondary">
          Prototype layout only. GPU compositing and layer editing are not enabled yet.
        </p>
      </div>
      <div className="mb-3 rounded-md border border-surface bg-bg-tertiary px-3 py-2 text-xs text-text-secondary">
        Layers are shown front to back. The persisted document order remains bottom to top.
      </div>
      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
        {[...document.layers].reverse().map((layer) => (
          <div
            key={layer.id}
            className="flex items-center gap-2 rounded-md border border-surface bg-bg-tertiary px-2 py-2"
          >
            <Eye size={15} className="shrink-0 text-text-secondary" />
            <span className="min-w-0 flex-1 truncate text-sm text-text-primary">{layer.name}</span>
            {layer.kind === 'adjustment' && <SlidersHorizontal size={15} className="shrink-0 text-text-secondary" />}
            {layer.locked && <Lock size={14} className="shrink-0 text-text-secondary" />}
          </div>
        ))}
      </div>
      <div className="mt-3 border-t border-surface pt-3 text-xs text-text-secondary">
        Add, visibility, opacity, blend, and reorder controls will activate with the compositor.
      </div>
    </section>
  );
}
