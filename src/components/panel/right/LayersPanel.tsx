import { useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Eye, Lock, Plus, SlidersHorizontal, ArrowDown, ArrowUp, Trash2 } from 'lucide-react';
import { toast } from 'react-toastify';

import { ImageFile, Invokes } from '../../ui/AppProperties';
import { useEditorStore } from '../../../store/useEditorStore';
import { useLibraryStore } from '../../../store/useLibraryStore';
import { useSettingsStore } from '../../../store/useSettingsStore';
import { defaultInitialImageLayerPlacement } from '../../../utils/plusFeatures';
import { getEnabledCopySuffix } from '../../../utils/outputNaming';
import { INITIAL_ADJUSTMENTS, normalizeLoadedAdjustments } from '../../../utils/adjustments';
import type { AdjustmentLayer, ImageLayer, Layer, LayeredDocument } from '../../../utils/editorDocument';
import { v4 as uuidv4 } from 'uuid';

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
  sourcePath?: string;
}

interface LayerDockPreviewState {
  version: 1;
  layers: PreviewLayer[];
  order: string[];
  opacity: Record<string, number>;
  visibility: Record<string, boolean>;
  locks: Record<string, boolean>;
}

interface ResolvedLayerSource {
  originalPath: string;
  displayName: string;
  sourceAdjustments: unknown;
}

const emptyPreviewState = (): LayerDockPreviewState => ({
  version: 1,
  layers: [],
  order: [],
  opacity: {},
  visibility: {},
  locks: {},
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const readPreviewState = (document: LayeredDocument): LayerDockPreviewState => {
  const value = document.unknownFields.layerDockPreview;
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.layers) || !Array.isArray(value.order)) {
    return emptyPreviewState();
  }

  const layers = value.layers.flatMap((layer) => {
    if (
      !isRecord(layer) ||
      typeof layer.id !== 'string' ||
      typeof layer.name !== 'string' ||
      (layer.kind !== 'image' && layer.kind !== 'adjustment') ||
      typeof layer.visible !== 'boolean' ||
      typeof layer.locked !== 'boolean' ||
      typeof layer.opacity !== 'number' ||
      (layer.sourcePath !== undefined && typeof layer.sourcePath !== 'string')
    ) {
      return [];
    }

    return [layer as unknown as PreviewLayer];
  });
  const stringValues = (value: unknown): Record<string, string | number | boolean> => (isRecord(value) ? value : {});
  const numberValues = Object.fromEntries(
    Object.entries(stringValues(value.opacity)).filter(([, item]) => typeof item === 'number'),
  ) as Record<string, number>;
  const booleanValues = (value: unknown) =>
    Object.fromEntries(Object.entries(stringValues(value)).filter(([, item]) => typeof item === 'boolean')) as Record<
      string,
      boolean
    >;

  return {
    version: 1,
    layers,
    order: value.order.filter((id): id is string => typeof id === 'string'),
    opacity: numberValues,
    visibility: booleanValues(value.visibility),
    locks: booleanValues(value.locks),
  };
};

const toPersistedDocument = (document: LayeredDocument) => {
  const { unknownFields, ...knownFields } = document;
  return { ...unknownFields, ...knownFields };
};

export default function LayersPanel({ onCompositionCreated }: LayersPanelProps) {
  const [isCreating, setIsCreating] = useState(false);
  const [previewLayers, setPreviewLayers] = useState<PreviewLayer[]>([]);
  const [previewOrder, setPreviewOrder] = useState<string[]>([]);
  const [previewOpacity, setPreviewOpacity] = useState<Record<string, number>>({});
  const [previewVisibility, setPreviewVisibility] = useState<Record<string, boolean>>({});
  const [previewLocks, setPreviewLocks] = useState<Record<string, boolean>>({});
  const [liveOpacity, setLiveOpacity] = useState<Record<string, number>>({});
  const [isSelectingImage, setIsSelectingImage] = useState(false);
  const [imageSearch, setImageSearch] = useState('');
  const document = useEditorStore((state) => state.document);
  const selectedImage = useEditorStore((state) => state.selectedImage);
  const activeAlbumId = useLibraryStore((state) => state.activeAlbumId);
  const imageList = useLibraryStore((state) => state.imageList);
  const appSettings = useSettingsStore((state) => state.appSettings);
  const setEditor = useEditorStore((state) => state.setEditor);
  const opacitySaveTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    const state = document.mode === 'layered' ? readPreviewState(document) : emptyPreviewState();
    setPreviewLayers(state.layers);
    setPreviewOrder(state.order);
    setPreviewOpacity(state.opacity);
    setPreviewVisibility(state.visibility);
    setPreviewLocks(state.locks);
    setLiveOpacity({});
    opacitySaveTimers.current.forEach(clearTimeout);
    opacitySaveTimers.current.clear();
  }, [document.mode === 'layered' ? document.id : null]);

  const persistPreviewState = async (state: LayerDockPreviewState) => {
    if (document.mode !== 'layered' || !selectedImage?.path) return;

    const updatedDocument: LayeredDocument = {
      ...document,
      unknownFields: { ...document.unknownFields, layerDockPreview: state },
    };
    await persistDocument(updatedDocument);
  };

  const persistDocument = async (updatedDocument: LayeredDocument) => {
    if (!selectedImage?.path) return;

    try {
      await invoke(Invokes.SavePlusDocument, {
        path: selectedImage.path,
        document: toPersistedDocument(updatedDocument),
      });
      await invoke(Invokes.ClearImageCaches);
      setEditor({ document: updatedDocument });
    } catch (error) {
      toast.error(`Could not save layer preview settings: ${error}`);
    }
  };

  const updatePreviewState = (state: Partial<LayerDockPreviewState>) => {
    const nextState: LayerDockPreviewState = {
      version: 1,
      layers: state.layers ?? previewLayers,
      order: state.order ?? previewOrder,
      opacity: state.opacity ?? previewOpacity,
      visibility: state.visibility ?? previewVisibility,
      locks: state.locks ?? previewLocks,
    };
    setPreviewLayers(nextState.layers);
    setPreviewOrder(nextState.order);
    setPreviewOpacity(nextState.opacity);
    setPreviewVisibility(nextState.visibility);
    setPreviewLocks(nextState.locks);
    void persistPreviewState(nextState);
  };

  const availableImages = useMemo(() => {
    const query = imageSearch.trim().toLocaleLowerCase();

    return imageList.filter((image) => {
      if (image.path === selectedImage?.path) return false;
      return !query || image.path.toLocaleLowerCase().includes(query);
    });
  }, [imageList, imageSearch, selectedImage?.path]);

  const addDocumentLayer = async (source?: ImageFile) => {
    if (document.mode !== 'layered') return;

    const imageLayerCount = document.layers.filter((layer) => layer.kind === 'image').length;
    const adjustmentLayerCount = document.layers.filter((layer) => layer.kind === 'adjustment').length;

    try {
      let layer: Layer;
      if (source) {
        const resolvedSource = await invoke<ResolvedLayerSource>(Invokes.ResolveLayerSource, {
          sourceVirtualPath: source.path,
        });
        const sourceAdjustments =
          resolvedSource.sourceAdjustments && typeof resolvedSource.sourceAdjustments === 'object'
            ? normalizeLoadedAdjustments(resolvedSource.sourceAdjustments)
            : INITIAL_ADJUSTMENTS;
        layer = {
          id: uuidv4(),
          name: resolvedSource.displayName || `Image layer ${imageLayerCount + 1}`,
          kind: 'image',
          visible: true,
          opacity: 100,
          blendMode: 'normal',
          locked: false,
          source: {
            originalPath: resolvedSource.originalPath,
            displayName: resolvedSource.displayName || `Image layer ${imageLayerCount + 1}`,
          },
          sourceAdjustments,
          creativeAdjustments: {},
          arrange: {
            initialSizing: defaultInitialImageLayerPlacement,
            centerX: 0.5,
            centerY: 0.5,
            scaleX: 1,
            scaleY: 1,
            rotation: 0,
            flipHorizontal: false,
            flipVertical: false,
          },
        } satisfies ImageLayer;
      } else {
        layer = {
          id: uuidv4(),
          name: `Adjustment layer ${adjustmentLayerCount + 1}`,
          kind: 'adjustment',
          visible: true,
          opacity: 100,
          blendMode: 'normal',
          locked: false,
          creativeAdjustments: {},
        } satisfies AdjustmentLayer;
      }

      await persistDocument({ ...document, layers: [...document.layers, layer] });
      setImageSearch('');
      setIsSelectingImage(false);
    } catch (error) {
      toast.error(`Could not add layer: ${error}`);
    }
  };

  const selectImageLayerSource = (source: ImageFile) => {
    void addDocumentLayer(source);
  };

  const layerRows = useMemo(
    () => [
      ...previewLayers.map((layer) => ({ ...layer, isPreview: true })),
      ...(document.mode === 'layered'
        ? [...document.layers].reverse().map((layer) => ({ ...layer, isPreview: false }))
        : []),
    ],
    [document, previewLayers],
  );

  const orderedLayerRows = useMemo(() => {
    if (previewOrder.length === 0) return layerRows;

    const layersById = new Map(layerRows.map((layer) => [layer.id, layer]));
    const ordered = previewOrder.flatMap((id) => {
      const layer = layersById.get(id);
      return layer ? [layer] : [];
    });
    const orderedIds = new Set(previewOrder);

    return [...ordered, ...layerRows.filter((layer) => !orderedIds.has(layer.id))];
  }, [layerRows, previewOrder]);

  const movePreviewLayer = (id: string, direction: -1 | 1) => {
    const currentOrder =
      previewOrder.length > 0
        ? [...previewOrder, ...layerRows.filter((layer) => !previewOrder.includes(layer.id)).map((layer) => layer.id)]
        : layerRows.map((layer) => layer.id);
    const currentIndex = currentOrder.indexOf(id);
    const nextIndex = currentIndex + direction;
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= currentOrder.length) return;

    [currentOrder[currentIndex], currentOrder[nextIndex]] = [currentOrder[nextIndex], currentOrder[currentIndex]];
    updatePreviewState({ order: currentOrder });
  };

  const updateDocumentLayer = (id: string, updater: (layer: Layer) => Layer) => {
    if (document.mode !== 'layered') return;
    void persistDocument({
      ...document,
      layers: document.layers.map((layer) => (layer.id === id ? updater(layer) : layer)),
    });
  };

  const saveDocumentOpacity = (id: string, opacity: number) => {
    if (document.mode !== 'layered') return;
    updateDocumentLayer(id, (current) => ({ ...current, opacity }));
  };

  const scheduleDocumentOpacity = (id: string, opacity: number, immediately = false) => {
    setLiveOpacity((current) => ({ ...current, [id]: opacity }));
    const existingTimer = opacitySaveTimers.current.get(id);
    if (existingTimer) clearTimeout(existingTimer);

    if (immediately) {
      opacitySaveTimers.current.delete(id);
      saveDocumentOpacity(id, opacity);
      return;
    }

    opacitySaveTimers.current.set(
      id,
      setTimeout(() => {
        opacitySaveTimers.current.delete(id);
        saveDocumentOpacity(id, opacity);
      }, 70),
    );
  };

  const moveDocumentLayer = (id: string, direction: -1 | 1) => {
    if (document.mode !== 'layered') return;
    const frontToBack = [...document.layers].reverse();
    const currentIndex = frontToBack.findIndex((layer) => layer.id === id);
    const nextIndex = currentIndex + direction;
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= frontToBack.length) return;

    [frontToBack[currentIndex], frontToBack[nextIndex]] = [frontToBack[nextIndex], frontToBack[currentIndex]];
    void persistDocument({ ...document, layers: frontToBack.reverse() });
  };

  const removePreviewLayer = (id: string) => {
    const { [id]: _removedOpacity, ...opacity } = previewOpacity;
    const { [id]: _removedVisibility, ...visibility } = previewVisibility;
    const { [id]: _removedLock, ...locks } = previewLocks;

    updatePreviewState({
      layers: previewLayers.filter((layer) => layer.id !== id),
      order: previewOrder.filter((layerId) => layerId !== id),
      opacity,
      visibility,
      locks,
    });
  };

  const removeDocumentLayer = (id: string) => {
    if (document.mode !== 'layered' || document.layers[0]?.id === id) return;
    void persistDocument({ ...document, layers: document.layers.filter((layer) => layer.id !== id) });
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
      {isSelectingImage ? (
        <div className="min-h-0 flex-1 rounded-md border border-surface bg-bg-tertiary p-2">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-sm font-medium text-text-primary">Choose image from current library</span>
            <button
              className="text-xs text-text-secondary hover:text-text-primary"
              onClick={() => setIsSelectingImage(false)}
            >
              Cancel
            </button>
          </div>
          <input
            aria-label="Search current library images"
            autoFocus
            className="mb-2 w-full rounded-md border border-surface bg-bg-primary px-2 py-1.5 text-sm text-text-primary outline-none focus:border-accent"
            placeholder="Search current library"
            value={imageSearch}
            onChange={(event) => setImageSearch(event.target.value)}
          />
          <div className="max-h-72 space-y-1 overflow-y-auto">
            {availableImages.map((image) => {
              const name = image.path.split(/[\\/]/).pop() || image.path;

              return (
                <button
                  key={image.path}
                  className="block w-full rounded-md px-2 py-1.5 text-left text-sm text-text-secondary hover:bg-surface hover:text-text-primary"
                  onClick={() => selectImageLayerSource(image)}
                  title={image.path}
                >
                  <span className="block truncate">{name}</span>
                </button>
              );
            })}
            {availableImages.length === 0 && (
              <p className="px-2 py-3 text-xs text-text-secondary">
                No other images are available in the current library.
              </p>
            )}
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
          {orderedLayerRows.map((layer, index) => {
            const isPreview = 'isPreview' in layer ? layer.isPreview : true;
            const visible = isPreview ? (previewVisibility[layer.id] ?? layer.visible) : layer.visible;
            const locked = isPreview ? (previewLocks[layer.id] ?? layer.locked) : layer.locked;
            const opacity = isPreview
              ? (previewOpacity[layer.id] ?? layer.opacity)
              : (liveOpacity[layer.id] ?? layer.opacity);

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
                    onClick={() => {
                      if (isPreview) {
                        updatePreviewState({ visibility: { ...previewVisibility, [layer.id]: !visible } });
                      } else {
                        updateDocumentLayer(layer.id, (current) => ({ ...current, visible: !visible }));
                      }
                    }}
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
                    onClick={() => {
                      if (isPreview) {
                        updatePreviewState({ locks: { ...previewLocks, [layer.id]: !locked } });
                      } else {
                        updateDocumentLayer(layer.id, (current) => ({ ...current, locked: !locked }));
                      }
                    }}
                  >
                    <Lock size={14} />
                  </button>
                  {isPreview ? (
                    <button
                      aria-label={`Remove ${layer.name}`}
                      className="text-text-secondary hover:text-red-400"
                      onClick={() => removePreviewLayer(layer.id)}
                    >
                      <Trash2 size={14} />
                    </button>
                  ) : (
                    <button
                      aria-label={`Remove ${layer.name}`}
                      disabled={document.layers[0]?.id === layer.id}
                      className="text-text-secondary hover:text-red-400 disabled:opacity-50"
                      onClick={() => removeDocumentLayer(layer.id)}
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
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
                      onChange={(event) => {
                        const nextOpacity = Number(event.target.value);
                        if (isPreview) {
                          updatePreviewState({ opacity: { ...previewOpacity, [layer.id]: nextOpacity } });
                        } else {
                          scheduleDocumentOpacity(layer.id, nextOpacity);
                        }
                      }}
                      onPointerDown={() => {
                        if (!isPreview) setEditor({ isSliderDragging: true });
                      }}
                      onPointerUp={(event) => {
                        if (!isPreview) {
                          scheduleDocumentOpacity(layer.id, Number(event.currentTarget.value), true);
                          setEditor({ isSliderDragging: false });
                        }
                      }}
                    />
                  </label>
                  <button
                    aria-label="Move layer up in preview stack"
                    disabled={isPreview ? index === 0 : document.layers[document.layers.length - 1]?.id === layer.id}
                    className="text-text-secondary hover:text-text-primary disabled:opacity-50"
                    onClick={() => (isPreview ? movePreviewLayer(layer.id, -1) : moveDocumentLayer(layer.id, -1))}
                  >
                    <ArrowUp size={14} />
                  </button>
                  <button
                    aria-label="Move layer down in preview stack"
                    disabled={isPreview ? index === orderedLayerRows.length - 1 : document.layers[0]?.id === layer.id}
                    className="text-text-secondary hover:text-text-primary disabled:opacity-50"
                    onClick={() => (isPreview ? movePreviewLayer(layer.id, 1) : moveDocumentLayer(layer.id, 1))}
                  >
                    <ArrowDown size={14} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {!isSelectingImage && (
        <div className="mt-3 flex gap-2 border-t border-surface pt-3">
          <button
            aria-label="Choose an image from the current library"
            className="flex flex-1 items-center justify-center gap-1 rounded-md border border-surface px-2 py-2 text-xs text-text-secondary hover:text-text-primary"
            onClick={() => setIsSelectingImage(true)}
          >
            <Plus size={14} /> Add image
          </button>
          <button
            aria-label="Add preview adjustment layer"
            className="flex flex-1 items-center justify-center gap-1 rounded-md border border-surface px-2 py-2 text-xs text-text-secondary hover:text-text-primary"
            onClick={() => void addDocumentLayer()}
          >
            <SlidersHorizontal size={14} /> Adjustment layer
          </button>
        </div>
      )}
    </section>
  );
}
