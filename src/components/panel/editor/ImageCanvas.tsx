import { useState, useEffect, useRef, useCallback, memo, useMemo } from 'react';
import ReactCrop from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';
import { Stage, Layer, Ellipse, Line, Transformer, Group, Circle, Rect } from 'react-konva';
import { PercentCrop, Crop } from 'react-image-crop';
import { Adjustments, AiPatch, Coord, MaskContainer } from '../../../utils/adjustments';
import { Mask, SubMask, SubMaskMode, ToolType } from '../right/Masks';
import { BrushSettings, SelectedImage } from '../../ui/AppProperties';
import { RenderSize } from '../../../hooks/useImageRenderSize';
import type { OverlayMode } from '../right/CropPanel';
import CompositionOverlays from './overlays/CompositionOverlays';

interface CursorPreview {
  visible: boolean;
  x: number;
  y: number;
}

interface DrawnLine {
  brushSize: number;
  feather?: number;
  points: Array<Coord>;
  tool: ToolType;
}

interface ImageCanvasProps {
  activeAiPatchContainerId: string | null;
  activeAiSubMaskId: string | null;
  activeMaskContainerId: string | null;
  activeMaskId: string | null;
  adjustments: Adjustments;
  brushSettings: BrushSettings | null;
  crop: Crop | null;
  finalPreviewUrl: string | null;
  handleCropComplete(c: Crop, cp: PercentCrop): void;
  imageRenderSize: RenderSize;
  isAiEditing: boolean;
  isCropping: boolean;
  isMaskControlHovered: boolean;
  isMasking: boolean;
  isStraightenActive: boolean;
  isRotationActive?: boolean;
  maskOverlayUrl: string | null;
  onGenerateAiMask(id: string | null, start: Coord, end: Coord): void;
  onLiveMaskPreview?: (previewMaskDef: any) => void;
  onQuickErase(subMaskId: string | null, startPoint: Coord, endpoint: Coord): void;
  onSelectAiSubMask(id: string | null): void;
  onSelectMask(id: string | null): void;
  onStraighten(val: number): void;
  selectedImage: SelectedImage;
  setCrop(crop: Crop, perfentCrop: PercentCrop): void;
  setIsMaskHovered(isHovered: boolean): void;
  showOriginal: boolean;
  transformedOriginalUrl: string | null;
  uncroppedAdjustedPreviewUrl: string | null;
  updateSubMask(id: string | null, subMask: Partial<SubMask>): void;
  isWbPickerActive?: boolean;
  onWbPicked?: () => void;
  setAdjustments(fn: (prev: Adjustments) => Adjustments): void;
  overlayMode?: OverlayMode;
  overlayRotation?: number;
  cursorStyle: string;
  isMaxZoom?: boolean;
}

interface MaskOverlay {
  adjustments: Adjustments;
  imageHeight: number;
  imageWidth: number;
  isToolActive: boolean;
  isSelected: boolean;
  onMaskMouseEnter(): void;
  onMaskMouseLeave(): void;
  onPreviewUpdate?(id: string, subMask: Partial<SubMask>): void;
  onSelect(): void;
  onUpdate(id: string, subMask: Partial<SubMask>): void;
  scale: number;
  subMask: SubMask;
}

const MaskOverlay = memo(
  ({
    adjustments,
    imageHeight,
    imageWidth,
    isToolActive,
    isSelected,
    onMaskMouseEnter,
    onMaskMouseLeave,
    onPreviewUpdate,
    onSelect,
    onUpdate,
    scale,
    subMask,
  }: MaskOverlay) => {
    const shapeRef = useRef<any>(null);
    const trRef = useRef<any>(null);

    const crop = adjustments.crop;
    const isPercent = crop?.unit === '%';
    const cropX = crop ? (isPercent ? (crop.x / 100) * imageWidth : crop.x) : 0;
    const cropY = crop ? (isPercent ? (crop.y / 100) * imageHeight : crop.y) : 0;
    const cropW = crop ? (isPercent ? (crop.width / 100) * imageWidth : crop.width) : imageWidth;
    const cropH = crop ? (isPercent ? (crop.height / 100) * imageHeight : crop.height) : imageHeight;

    const [p, setP] = useState(subMask.parameters);
    const pRef = useRef(p);
    const isDragging = useRef(false);

    const dragStartPointer = useRef<Coord | null>(null);
    const dragStartParams = useRef<any>(null);

    useEffect(() => {
      if (!isDragging.current) {
        setP(subMask.parameters);
        pRef.current = subMask.parameters;
      }
    }, [subMask.parameters]);

    const updateP = useCallback((newP: any) => {
      setP(newP);
      pRef.current = newP;
    }, []);

    const handleSelect = isToolActive ? undefined : onSelect;

    useEffect(() => {
      if (isSelected && trRef.current && shapeRef.current) {
        trRef.current?.nodes([shapeRef.current]);
        trRef.current?.getLayer().batchDraw();
      }
    }, [isSelected]);

    const lockDragBoundFunc = useCallback(function (this: any) {
      return this.getAbsolutePosition();
    }, []);

    const handleRadialDragStart = useCallback((e: any) => {
      isDragging.current = true;
      dragStartPointer.current = e.target.getStage().getPointerPosition();
      dragStartParams.current = { ...pRef.current };
    }, []);

    const handleRadialDragMove = useCallback(
      (e: any) => {
        const pointerPos = e.target.getStage().getPointerPosition();
        if (!pointerPos || !dragStartPointer.current || !dragStartParams.current) return;

        const dx = (pointerPos.x - dragStartPointer.current.x) / scale;
        const dy = (pointerPos.y - dragStartPointer.current.y) / scale;

        const newP = {
          ...dragStartParams.current,
          centerX: dragStartParams.current.centerX + dx,
          centerY: dragStartParams.current.centerY + dy,
        };

        updateP(newP);
        if (onPreviewUpdate) onPreviewUpdate(subMask.id, { parameters: newP });
      },
      [scale, updateP, onPreviewUpdate, subMask.id],
    );

    const handleRadialDragEnd = useCallback(() => {
      isDragging.current = false;
      onUpdate(subMask.id, { parameters: pRef.current });
    }, [subMask.id, onUpdate]);

    const handleRadialTransformStart = useCallback(() => {
      isDragging.current = true;
    }, []);

    const handleRadialTransform = useCallback(() => {
      const node = shapeRef.current;
      if (!node) return;

      const scaleX = Math.abs(node.scaleX());
      const scaleY = Math.abs(node.scaleY());

      if (pRef.current.radiusX * scaleX < 5 || pRef.current.radiusY * scaleY < 5) {
        node.scaleX(node.lastValidScaleX || 1);
        node.scaleY(node.lastValidScaleY || 1);
      } else {
        node.lastValidScaleX = scaleX;
        node.lastValidScaleY = scaleY;
      }

      if (onPreviewUpdate) {
        const newRadiusX = pRef.current.radiusX * node.scaleX();
        const newRadiusY = pRef.current.radiusY * node.scaleY();
        onPreviewUpdate(subMask.id, {
          parameters: {
            ...pRef.current,
            centerX: node.x() / scale + cropX,
            centerY: node.y() / scale + cropY,
            radiusX: newRadiusX,
            radiusY: newRadiusY,
            rotation: node.rotation(),
          },
        });
      }
    }, [onPreviewUpdate, scale, cropX, cropY, subMask.id]);

    const handleRadialTransformEnd = useCallback(() => {
      const node = shapeRef.current;
      if (!node) return;

      const scaleX = node.scaleX();
      const scaleY = node.scaleY();

      const newRadiusX = pRef.current.radiusX * scaleX;
      const newRadiusY = pRef.current.radiusY * scaleY;

      node.scaleX(1);
      node.scaleY(1);

      const newP = {
        ...pRef.current,
        centerX: node.x() / scale + cropX,
        centerY: node.y() / scale + cropY,
        radiusX: newRadiusX,
        radiusY: newRadiusY,
        rotation: node.rotation(),
      };

      updateP(newP);
      isDragging.current = false;
      onUpdate(subMask.id, { parameters: newP });
    }, [scale, cropX, cropY, updateP, onUpdate, subMask.id]);

    const handleLinearGroupDragStart = useCallback((e: any) => {
      isDragging.current = true;
      dragStartPointer.current = e.target.getStage().getPointerPosition();
      dragStartParams.current = { ...pRef.current };
      e.cancelBubble = true;
    }, []);

    const handleLinearGroupDragMove = useCallback(
      (e: any) => {
        const pointerPos = e.target.getStage().getPointerPosition();
        if (!pointerPos || !dragStartPointer.current || !dragStartParams.current) return;

        const dx = (pointerPos.x - dragStartPointer.current.x) / scale;
        const dy = (pointerPos.y - dragStartPointer.current.y) / scale;

        const newP = {
          ...dragStartParams.current,
          startX: dragStartParams.current.startX + dx,
          startY: dragStartParams.current.startY + dy,
          endX: dragStartParams.current.endX + dx,
          endY: dragStartParams.current.endY + dy,
        };

        updateP(newP);
        if (onPreviewUpdate) onPreviewUpdate(subMask.id, { parameters: newP });
      },
      [scale, updateP, onPreviewUpdate, subMask.id],
    );

    const handleLinearGroupDragEnd = useCallback(
      (e: any) => {
        isDragging.current = false;
        e.cancelBubble = true;
        onUpdate(subMask.id, { parameters: pRef.current });
      },
      [subMask.id, onUpdate],
    );

    const handleLinearPointDragStart = useCallback((e: any) => {
      isDragging.current = true;
      e.cancelBubble = true;
    }, []);

    const handleLinearPointDragMove = useCallback(
      (e: any, pointType: string) => {
        const stage = e.target.getStage();
        const pointerPos = stage.getPointerPosition();
        if (!pointerPos) return;

        const newX = pointerPos.x / scale + cropX;
        const newY = pointerPos.y / scale + cropY;

        const newP = { ...pRef.current };
        if (pointType === 'start') {
          newP.startX = newX;
          newP.startY = newY;
        } else {
          newP.endX = newX;
          newP.endY = newY;
        }
        updateP(newP);
        if (onPreviewUpdate) onPreviewUpdate(subMask.id, { parameters: newP });
      },
      [scale, cropX, cropY, updateP, onPreviewUpdate, subMask.id],
    );

    const handleLinearRangeDragMove = useCallback(
      (e: any) => {
        const stage = e.target.getStage();
        const pointerPos = stage.getPointerPosition();
        if (!pointerPos) return;

        const { startX, startY, endX, endY } = pRef.current;
        const sX = (startX - cropX) * scale;
        const sY = (startY - cropY) * scale;
        const eX = (endX - cropX) * scale;
        const eY = (endY - cropY) * scale;

        const dx = eX - sX;
        const dy = eY - sY;
        const len = Math.sqrt(dx * dx + dy * dy);

        let newRange = pRef.current.range;
        if (len > 0) {
          const dist = Math.abs(dx * (sY - pointerPos.y) - (sX - pointerPos.x) * dy) / len;
          newRange = Math.max(0.1, dist / scale);
        }

        const newP = { ...pRef.current, range: newRange };
        updateP(newP);
        if (onPreviewUpdate) onPreviewUpdate(subMask.id, { parameters: newP });
      },
      [scale, cropX, cropY, updateP, onPreviewUpdate, subMask.id],
    );

    const handleLinearPointDragEnd = useCallback(
      (e: any) => {
        isDragging.current = false;
        e.cancelBubble = true;
        onUpdate(subMask.id, { parameters: pRef.current });
      },
      [subMask.id, onUpdate],
    );

    if (!subMask.visible) {
      return null;
    }

    const commonProps = {
      dash: [4, 4],
      onClick: handleSelect,
      onTap: handleSelect,
      opacity: isSelected ? 1 : 0.7,
      stroke: isSelected ? '#0ea5e9' : subMask.mode === SubMaskMode.Subtractive ? '#f43f5e' : 'white',
      strokeScaleEnabled: false,
      strokeWidth: isSelected ? 3 : 2,
    };

    if (subMask.type === Mask.AiSubject) {
      const { startX, startY, endX, endY } = p;
      if (endX > startX && endY > startY) {
        return (
          <Rect
            height={(endY - startY) * scale}
            onMouseEnter={onMaskMouseEnter}
            onMouseLeave={onMaskMouseLeave}
            width={(endX - startX) * scale}
            x={(startX - cropX) * scale}
            y={(startY - cropY) * scale}
            {...commonProps}
          />
        );
      }
      return null;
    }

    if (subMask.type === Mask.Brush) {
      const { lines = [] } = p;
      return (
        <Group onClick={handleSelect} onTap={handleSelect}>
          {lines.map((line: DrawnLine, i: number) => (
            <Line
              hitStrokeWidth={line.brushSize * scale}
              key={i}
              lineCap="round"
              lineJoin="round"
              points={line.points.flatMap((p: Coord) => [(p.x - cropX) * scale, (p.y - cropY) * scale])}
              stroke="transparent"
              strokeScaleEnabled={false}
              tension={0.5}
            />
          ))}
        </Group>
      );
    }

    if (subMask.type === Mask.Radial) {
      const { centerX, centerY, radiusX, radiusY, rotation } = p;
      return (
        <>
          <Ellipse
            {...commonProps}
            ref={shapeRef}
            draggable={!isToolActive}
            dragBoundFunc={lockDragBoundFunc}
            onDragStart={handleRadialDragStart}
            onDragMove={handleRadialDragMove}
            onDragEnd={handleRadialDragEnd}
            onMouseEnter={onMaskMouseEnter}
            onMouseLeave={onMaskMouseLeave}
            radiusX={radiusX * scale}
            radiusY={radiusY * scale}
            rotation={rotation}
            x={(centerX - cropX) * scale}
            y={(centerY - cropY) * scale}
          />
          {isSelected && (
            <Transformer
              ref={trRef}
              centeredScaling={true}
              rotateEnabled={true}
              enabledAnchors={[
                'top-left',
                'top-right',
                'bottom-left',
                'bottom-right',
                'top-center',
                'bottom-center',
                'middle-left',
                'middle-right',
              ]}
              onMouseDown={(e) => {
                e.cancelBubble = true;
                e.evt.preventDefault();
              }}
              boundBoxFunc={(oldBox, newBox) => {
                if (Math.abs(newBox.width) < 5 || Math.abs(newBox.height) < 5) {
                  return oldBox;
                }
                return newBox;
              }}
              onTransformStart={handleRadialTransformStart}
              onTransform={handleRadialTransform}
              onTransformEnd={handleRadialTransformEnd}
              onMouseEnter={onMaskMouseEnter}
              onMouseLeave={onMaskMouseLeave}
            />
          )}
        </>
      );
    }

    if (subMask.type === Mask.Linear) {
      const defaultRange = Math.min(cropW, cropH) * 0.1;
      const { startX, startY, endX, endY, range = defaultRange } = p;

      const sX = (startX - cropX) * scale;
      const sY = (startY - cropY) * scale;
      const eX = (endX - cropX) * scale;
      const eY = (endY - cropY) * scale;
      const r = range * scale;

      const idx = endX - startX;
      const idy = endY - startY;
      const angle = Math.atan2(idy, idx);
      const angleDeg = (angle * 180) / Math.PI;

      const centerX = sX + (eX - sX) / 2;
      const centerY = sY + (eY - sY) / 2;

      const nx = -Math.sin(angle);
      const ny = Math.cos(angle);
      const dx_norm = Math.cos(angle);
      const dy_norm = Math.sin(angle);

      const EXT = 5000;
      const topRangePts = [
        sX + nx * r - dx_norm * EXT,
        sY + ny * r - dy_norm * EXT,
        eX + nx * r + dx_norm * EXT,
        eY + ny * r + dy_norm * EXT,
      ];
      const botRangePts = [
        sX - nx * r - dx_norm * EXT,
        sY - ny * r - dy_norm * EXT,
        eX - nx * r + dx_norm * EXT,
        eY - ny * r + dy_norm * EXT,
      ];

      const lineProps = {
        ...commonProps,
        strokeWidth: isSelected ? 2.5 : 2,
        dash: [6, 6],
        hitStrokeWidth: 20,
      };

      return (
        <Group>
          <Group
            x={centerX}
            y={centerY}
            rotation={angleDeg}
            draggable={isSelected}
            dragBoundFunc={lockDragBoundFunc}
            onDragStart={handleLinearGroupDragStart}
            onDragMove={handleLinearGroupDragMove}
            onDragEnd={handleLinearGroupDragEnd}
            onClick={handleSelect}
            onTap={handleSelect}
            onMouseEnter={(e: any) => {
              onMaskMouseEnter();
              e.target.getStage().container().style.cursor = 'move';
            }}
            onMouseLeave={(e: any) => {
              onMaskMouseLeave();
              e.target.getStage().container().style.cursor = 'default';
            }}
          >
            <Line points={[-5000, 0, 5000, 0]} {...lineProps} dash={[2, 3]} />
          </Group>

          {isSelected && (
            <>
              <Line
                points={topRangePts}
                {...lineProps}
                draggable
                dragBoundFunc={lockDragBoundFunc}
                onDragStart={handleLinearPointDragStart}
                onDragMove={handleLinearRangeDragMove}
                onDragEnd={handleLinearPointDragEnd}
                onMouseEnter={(e: any) => {
                  onMaskMouseEnter();
                  e.target.getStage().container().style.cursor = 'row-resize';
                }}
                onMouseLeave={(e: any) => {
                  onMaskMouseLeave();
                  e.target.getStage().container().style.cursor = 'default';
                }}
              />
              <Line
                points={botRangePts}
                {...lineProps}
                draggable
                dragBoundFunc={lockDragBoundFunc}
                onDragStart={handleLinearPointDragStart}
                onDragMove={handleLinearRangeDragMove}
                onDragEnd={handleLinearPointDragEnd}
                onMouseEnter={(e: any) => {
                  onMaskMouseEnter();
                  e.target.getStage().container().style.cursor = 'row-resize';
                }}
                onMouseLeave={(e: any) => {
                  onMaskMouseLeave();
                  e.target.getStage().container().style.cursor = 'default';
                }}
              />
              <Circle
                x={sX}
                y={sY}
                radius={8}
                fill="#0ea5e9"
                stroke="white"
                strokeWidth={2}
                draggable
                dragBoundFunc={lockDragBoundFunc}
                onDragStart={handleLinearPointDragStart}
                onDragMove={(e) => handleLinearPointDragMove(e, 'start')}
                onDragEnd={handleLinearPointDragEnd}
                onMouseEnter={(e: any) => {
                  onMaskMouseEnter();
                  e.target.getStage().container().style.cursor = 'grab';
                }}
                onMouseLeave={(e: any) => {
                  onMaskMouseLeave();
                  e.target.getStage().container().style.cursor = 'default';
                }}
              />
              <Circle
                x={eX}
                y={eY}
                radius={8}
                fill="#0ea5e9"
                stroke="white"
                strokeWidth={2}
                draggable
                dragBoundFunc={lockDragBoundFunc}
                onDragStart={handleLinearPointDragStart}
                onDragMove={(e) => handleLinearPointDragMove(e, 'end')}
                onDragEnd={handleLinearPointDragEnd}
                onMouseEnter={(e: any) => {
                  onMaskMouseEnter();
                  e.target.getStage().container().style.cursor = 'grab';
                }}
                onMouseLeave={(e: any) => {
                  onMaskMouseLeave();
                  e.target.getStage().container().style.cursor = 'default';
                }}
              />
            </>
          )}

          {!isSelected && (
            <>
              <Line points={topRangePts} {...lineProps} opacity={0.7} stroke="white" listening={false} />
              <Line points={botRangePts} {...lineProps} opacity={0.7} stroke="white" listening={false} />
            </>
          )}
        </Group>
      );
    }
    return null;
  },
);

const ImageCanvas = memo(
  ({
    activeAiPatchContainerId,
    activeAiSubMaskId,
    activeMaskContainerId,
    activeMaskId,
    adjustments,
    brushSettings,
    crop,
    finalPreviewUrl,
    handleCropComplete,
    imageRenderSize,
    isAiEditing,
    isCropping,
    isMaskControlHovered,
    isMasking,
    isStraightenActive,
    isRotationActive,
    maskOverlayUrl,
    onGenerateAiMask,
    onLiveMaskPreview,
    onQuickErase,
    onSelectAiSubMask,
    onSelectMask,
    onStraighten,
    selectedImage,
    setCrop,
    setIsMaskHovered,
    showOriginal,
    transformedOriginalUrl,
    uncroppedAdjustedPreviewUrl,
    updateSubMask,
    isWbPickerActive = false,
    onWbPicked,
    setAdjustments,
    overlayRotation,
    overlayMode,
    cursorStyle,
    isMaxZoom,
  }: ImageCanvasProps) => {
    const [isCropViewVisible, setIsCropViewVisible] = useState(false);
    const cropImageRef = useRef<HTMLImageElement>(null);
    const [displayedMaskUrl, setDisplayedMaskUrl] = useState<string | null>(null);
    const [originalLoaded, setOriginalLoaded] = useState(false);

    const isDrawing = useRef(false);
    const drawingStageRef = useRef<any>(null);
    const lastBrushPoint = useRef<Coord | null>(null);
    const currentLine = useRef<DrawnLine | null>(null);
    const [previewLine, setPreviewLine] = useState<DrawnLine | null>(null);
    const [cursorPreview, setCursorPreview] = useState<CursorPreview>({ x: 0, y: 0, visible: false });
    const [straightenLine, setStraightenLine] = useState<any>(null);
    const isStraightening = useRef(false);

    const activeContainer = useMemo(() => {
      if (isMasking) {
        return adjustments.masks.find((c: MaskContainer) => c.id === activeMaskContainerId);
      }
      if (isAiEditing) {
        return adjustments.aiPatches.find((p: AiPatch) => p.id === activeAiPatchContainerId);
      }
      return null;
    }, [
      adjustments.masks,
      adjustments.aiPatches,
      activeMaskContainerId,
      activeAiPatchContainerId,
      isMasking,
      isAiEditing,
    ]);

    const activeSubMask = useMemo(() => {
      if (!activeContainer) {
        return null;
      }
      if (isMasking) {
        return activeContainer.subMasks.find((m: SubMask) => m.id === activeMaskId);
      }
      if (isAiEditing) {
        return activeContainer.subMasks.find((m: SubMask) => m.id === activeAiSubMaskId);
      }
      return null;
    }, [activeContainer, activeMaskId, activeAiSubMaskId, isMasking, isAiEditing]);

    const effectiveImageDimensions = useMemo(() => {
      const steps = adjustments.orientationSteps || 0;
      const w = selectedImage.width || 0;
      const h = selectedImage.height || 0;
      if (steps === 1 || steps === 3) {
        return { width: h, height: w };
      }
      return { width: w, height: h };
    }, [selectedImage.width, selectedImage.height, adjustments.orientationSteps]);

    const isBrushActive = (isMasking || isAiEditing) && activeSubMask?.type === Mask.Brush;
    const isAiSubjectActive =
      (isMasking || isAiEditing) &&
      (activeSubMask?.type === Mask.AiSubject || activeSubMask?.type === Mask.QuickEraser);
    const isToolActive = isBrushActive || isAiSubjectActive;

    useEffect(() => {
      if (maskOverlayUrl && (isMasking || isAiEditing)) {
        setDisplayedMaskUrl(maskOverlayUrl);
      } else {
        setDisplayedMaskUrl(null);
      }
    }, [maskOverlayUrl, isMasking, isAiEditing]);

    useEffect(() => {
      if (isToolActive) {
        return;
      }
      isDrawing.current = false;
      drawingStageRef.current = null;
      currentLine.current = null;
      lastBrushPoint.current = null;
      setPreviewLine(null);
    }, [isToolActive]);

    const sortedSubMasks = useMemo(() => {
      if (!activeContainer) {
        return [];
      }
      const activeId = isMasking ? activeMaskId : activeAiSubMaskId;
      const selectedMask = activeContainer.subMasks.find((m: SubMask) => m.id === activeId);
      const otherMasks = activeContainer.subMasks.filter((m: SubMask) => m.id !== activeId);
      return selectedMask ? [...otherMasks, selectedMask] : activeContainer.subMasks;
    }, [activeContainer, activeMaskId, activeAiSubMaskId, isMasking, isAiEditing]);

    useEffect(() => {
      if (isCropping && uncroppedAdjustedPreviewUrl) {
        const timer = setTimeout(() => setIsCropViewVisible(true), 10);
        return () => clearTimeout(timer);
      } else {
        setIsCropViewVisible(false);
      }
    }, [isCropping, uncroppedAdjustedPreviewUrl]);

    const handleWbClick = useCallback(
      (e: any) => {
        if (!isWbPickerActive || !finalPreviewUrl || !onWbPicked) return;

        const stage = e.target.getStage();
        const pointerPos = stage.getPointerPosition();
        if (!pointerPos) return;

        const x = pointerPos.x / imageRenderSize.scale;
        const y = pointerPos.y / imageRenderSize.scale;

        const imgLogicalWidth = imageRenderSize.width / imageRenderSize.scale;
        const imgLogicalHeight = imageRenderSize.height / imageRenderSize.scale;

        if (x < 0 || x > imgLogicalWidth || y < 0 || y > imgLogicalHeight) return;

        const img = new Image();
        img.crossOrigin = 'Anonymous';
        img.src = finalPreviewUrl;

        img.onload = () => {
          const radius = 5;
          const side = radius * 2 + 1;

          const canvas = document.createElement('canvas');
          canvas.width = side;
          canvas.height = side;
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          if (!ctx) return;

          const scaleX = img.width / imgLogicalWidth;
          const scaleY = img.height / imgLogicalHeight;
          const srcX = Math.floor(x * scaleX);
          const srcY = Math.floor(y * scaleY);

          const startX = Math.max(0, srcX - radius);
          const startY = Math.max(0, srcY - radius);
          const endX = Math.min(img.width, srcX + radius + 1);
          const endY = Math.min(img.height, srcY + radius + 1);
          const sw = endX - startX;
          const sh = endY - startY;

          if (sw <= 0 || sh <= 0) return;

          ctx.drawImage(img, startX, startY, sw, sh, 0, 0, sw, sh);

          const imageData = ctx.getImageData(0, 0, sw, sh);
          const data = imageData.data;

          let rTotal = 0,
            gTotal = 0,
            bTotal = 0;
          let count = 0;

          for (let i = 0; i < data.length; i += 4) {
            rTotal += data[i];
            gTotal += data[i + 1];
            bTotal += data[i + 2];
            count++;
          }

          if (count === 0) return;

          const avgR = rTotal / count;
          const avgG = gTotal / count;
          const avgB = bTotal / count;

          const linR = Math.pow(avgR / 255.0, 2.2);
          const linG = Math.pow(avgG / 255.0, 2.2);
          const linB = Math.pow(avgB / 255.0, 2.2);

          const sumRB = linR + linB;
          const deltaTemp = sumRB > 0.0001 ? ((linB - linR) / sumRB) * 125.0 : 0;

          const linM = sumRB / 2.0;
          const sumGM = linG + linM;
          const deltaTint = sumGM > 0.0001 ? ((linG - linM) / sumGM) * 400.0 : 0;

          setAdjustments((prev: Adjustments) => ({
            ...prev,
            temperature: Math.max(-100, Math.min(100, (prev.temperature || 0) + deltaTemp)),
            tint: Math.max(-100, Math.min(100, (prev.tint || 0) + deltaTint)),
          }));

          onWbPicked();
        };
      },
      [isWbPickerActive, finalPreviewUrl, imageRenderSize, onWbPicked, setAdjustments],
    );

    const handleMouseDown = useCallback(
      (e: any) => {
        e.evt.preventDefault();

        if (isWbPickerActive) {
          handleWbClick(e);
          return;
        }

        if (isToolActive) {
          const stage = e.target.getStage();
          const pos = stage.getPointerPosition();
          if (!pos) {
            isDrawing.current = false;
            currentLine.current = null;
            setPreviewLine(null);
            return;
          }

          const toolType = isAiSubjectActive ? ToolType.AiSeletor : ToolType.Brush;
          const isShiftClick = isBrushActive && e.evt.shiftKey && lastBrushPoint.current;

          if (isShiftClick) {
            const { scale } = imageRenderSize;
            const crop = adjustments.crop;
            const isPercent = crop?.unit === '%';
            const cropX = crop ? (isPercent ? (crop.x / 100) * effectiveImageDimensions.width : crop.x) : 0;
            const cropY = crop ? (isPercent ? (crop.y / 100) * effectiveImageDimensions.height : crop.y) : 0;

            const startImageSpace = lastBrushPoint.current!;
            const endImageSpace = {
              x: pos.x / scale + cropX,
              y: pos.y / scale + cropY,
            };

            const dx = endImageSpace.x - startImageSpace.x;
            const dy = endImageSpace.y - startImageSpace.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            const steps = Math.max(Math.ceil(distance), 2);
            const interpolatedPoints: Coord[] = [];
            for (let i = 0; i <= steps; i++) {
              const t = i / steps;
              interpolatedPoints.push({
                x: startImageSpace.x + dx * t,
                y: startImageSpace.y + dy * t,
              });
            }

            const imageSpaceLine: DrawnLine = {
              brushSize: (brushSettings?.size ?? 0) / scale,
              feather: brushSettings?.feather ? brushSettings?.feather / 100 : 0,
              points: interpolatedPoints,
              tool: brushSettings?.tool ?? ToolType.Brush,
            };

            const activeId = isMasking ? activeMaskId : activeAiSubMaskId;
            const existingLines = activeSubMask?.parameters?.lines || [];

            updateSubMask(activeId, {
              parameters: {
                ...activeSubMask?.parameters,
                lines: [...existingLines, imageSpaceLine],
              },
            });

            lastBrushPoint.current = endImageSpace;
            isDrawing.current = false;
            currentLine.current = null;
            return;
          }

          isDrawing.current = true;
          drawingStageRef.current = stage;

          const newLine: DrawnLine = {
            brushSize: isBrushActive && brushSettings?.size ? brushSettings.size : 2,
            points: [pos],
            tool: toolType,
          };
          currentLine.current = newLine;

          if (isAiSubjectActive) {
            setPreviewLine(newLine);
          }
        } else {
          if (e.target === e.target.getStage()) {
            if (isMasking) {
              onSelectMask(null);
            }
            if (isAiEditing) {
              onSelectAiSubMask(null);
            }
          }
        }
      },
      [
        isWbPickerActive,
        handleWbClick,
        isBrushActive,
        isAiSubjectActive,
        brushSettings,
        onSelectMask,
        onSelectAiSubMask,
        isMasking,
        isAiEditing,
        imageRenderSize,
        adjustments.crop,
        activeMaskId,
        activeAiSubMaskId,
        activeSubMask,
        updateSubMask,
        effectiveImageDimensions,
      ],
    );

    const handleMouseMove = useCallback(
      (e: any) => {
        if (isWbPickerActive) {
          return;
        }

        let pos;
        if (e && typeof e.target?.getStage === 'function') {
          const stage = e.target.getStage();
          pos = stage.getPointerPosition();
        } else if (e && e.clientX != null && e.clientY != null) {
          const stage = drawingStageRef.current;
          if (stage) {
            stage.setPointersPositions(e);
            pos = stage.getPointerPosition();
          }
        }

        if (isToolActive) {
          if (pos) {
            setCursorPreview({ x: pos.x, y: pos.y, visible: true });
          } else {
            setCursorPreview((p: CursorPreview) => ({ ...p, visible: false }));
          }
        }

        if (!isDrawing.current || !isToolActive) {
          return;
        }

        if (!pos) {
          return;
        }

        if (currentLine.current) {
          const updatedLine = {
            ...currentLine.current,
            points: [...currentLine.current.points, pos],
          };
          currentLine.current = updatedLine;

          if (isAiSubjectActive) {
            setPreviewLine(updatedLine);
          }

          if (onLiveMaskPreview && activeContainer && activeSubMask && isBrushActive) {
            const { scale } = imageRenderSize;
            const crop = adjustments.crop;
            const isPercent = crop?.unit === '%';
            const cropX = crop ? (isPercent ? (crop.x / 100) * effectiveImageDimensions.width : crop.x) : 0;
            const cropY = crop ? (isPercent ? (crop.y / 100) * effectiveImageDimensions.height : crop.y) : 0;

            const imageSpaceLine: DrawnLine = {
              brushSize: (brushSettings?.size ?? 0) / scale,
              feather: brushSettings?.feather ? brushSettings?.feather / 100 : 0,
              points: updatedLine.points.map((p: Coord) => ({
                x: p.x / scale + cropX,
                y: p.y / scale + cropY,
              })),
              tool: brushSettings?.tool ?? ToolType.Brush,
            };

            const existingLines = activeSubMask.parameters?.lines || [];
            const previewSubMask = {
              ...activeSubMask,
              parameters: {
                ...activeSubMask.parameters,
                lines: [...existingLines, imageSpaceLine],
              },
            };

            const previewContainer = {
              ...activeContainer,
              subMasks: activeContainer.subMasks.map((sm: SubMask) =>
                sm.id === activeSubMask.id ? previewSubMask : sm,
              ),
            };

            onLiveMaskPreview(previewContainer);
          }
        }
      },
      [
        isToolActive,
        isWbPickerActive,
        onLiveMaskPreview,
        activeContainer,
        activeSubMask,
        isBrushActive,
        isAiSubjectActive,
        imageRenderSize,
        adjustments.crop,
        effectiveImageDimensions,
        brushSettings,
      ],
    );

    const handleMouseUp = useCallback(() => {
      if (!isDrawing.current || !currentLine.current) {
        return;
      }

      const wasDrawing = isDrawing.current;
      isDrawing.current = false;
      const line = currentLine.current;
      currentLine.current = null;
      setPreviewLine(null);
      drawingStageRef.current = null;

      if (!wasDrawing || !line) {
        return;
      }

      const { scale } = imageRenderSize;
      const crop = adjustments.crop;
      const isPercent = crop?.unit === '%';
      const cropX = crop ? (isPercent ? (crop.x / 100) * effectiveImageDimensions.width : crop.x) : 0;
      const cropY = crop ? (isPercent ? (crop.y / 100) * effectiveImageDimensions.height : crop.y) : 0;

      const activeId = isMasking ? activeMaskId : activeAiSubMaskId;

      if (activeSubMask?.type === Mask.AiSubject || activeSubMask?.type === Mask.QuickEraser) {
        const points = line.points;
        if (points.length > 1) {
          const xs = points.map((p: Coord) => p.x);
          const ys = points.map((p: Coord) => p.y);
          const minX = Math.min(...xs);
          const minY = Math.min(...ys);
          const maxX = Math.max(...xs);
          const maxY = Math.max(...ys);

          const startPoint = { x: minX / scale + cropX, y: minY / scale + cropY };
          const endPoint = { x: maxX / scale + cropX, y: maxY / scale + cropY };

          if (activeSubMask.type === Mask.QuickEraser && onQuickErase) {
            onQuickErase(activeId, startPoint, endPoint);
          } else if (activeSubMask.type === Mask.AiSubject && onGenerateAiMask) {
            onGenerateAiMask(activeId, startPoint, endPoint);
          }
        }
      } else if (isBrushActive) {
        const imageSpaceLine: DrawnLine = {
          brushSize: (brushSettings?.size ?? 0) / scale,
          feather: brushSettings?.feather ? brushSettings?.feather / 100 : 0,
          points: line.points.map((p: Coord) => ({
            x: p.x / scale + cropX,
            y: p.y / scale + cropY,
          })),
          tool: brushSettings?.tool ?? ToolType.Brush,
        };

        const existingLines = activeSubMask.parameters.lines || [];

        updateSubMask(activeId, {
          parameters: {
            ...activeSubMask.parameters,
            lines: [...existingLines, imageSpaceLine],
          },
        });

        const lastPoint = line.points[line.points.length - 1];
        if (lastPoint) {
          lastBrushPoint.current = {
            x: lastPoint.x / scale + cropX,
            y: lastPoint.y / scale + cropY,
          };
        }
      }
    }, [
      activeAiSubMaskId,
      activeMaskId,
      activeSubMask,
      adjustments.crop,
      brushSettings,
      imageRenderSize.scale,
      isAiEditing,
      isBrushActive,
      isMasking,
      onGenerateAiMask,
      onQuickErase,
      updateSubMask,
      effectiveImageDimensions,
    ]);

    const handleMouseEnter = useCallback(() => {
      if (isToolActive) {
        setCursorPreview((p: CursorPreview) => ({ ...p, visible: true }));
      }
    }, [isToolActive]);

    const handleMouseLeave = useCallback(() => {
      setCursorPreview((p: CursorPreview) => ({ ...p, visible: false }));
    }, []);

    useEffect(() => {
      if (isToolActive) {
        setCursorPreview((p: CursorPreview) => ({ ...p, visible: false }));
      }
    }, [isToolActive]);

    useEffect(() => {
      if (!isToolActive) return;

      function onMove(e: MouseEvent) {
        if (!isDrawing.current) {
          return;
        }
        handleMouseMove(e);
      }

      function onUp() {
        if (!isDrawing.current) {
          return;
        }
        handleMouseUp();
      }

      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
      return () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
    }, [isToolActive, handleMouseMove, handleMouseUp]);

    const handleStraightenMouseDown = (e: any) => {
      if (e.evt.button !== 0) {
        return;
      }

      isStraightening.current = true;
      const pos = e.target.getStage().getPointerPosition();
      setStraightenLine({ start: pos, end: pos });
    };

    const handleStraightenMouseMove = (e: any) => {
      if (!isStraightening.current) {
        return;
      }

      const pos = e.target.getStage().getPointerPosition();
      setStraightenLine((prev: any) => ({ ...prev, end: pos }));
    };

    const handleStraightenMouseUp = () => {
      if (!isStraightening.current) {
        return;
      }
      isStraightening.current = false;
      if (
        !straightenLine ||
        (straightenLine.start.x === straightenLine.end.x && straightenLine.start.y === straightenLine.start.y)
      ) {
        setStraightenLine(null);
        return;
      }

      const { start, end } = straightenLine;
      const { rotation = 0 } = adjustments;
      const theta_rad = (rotation * Math.PI) / 180;
      const cos_t = Math.cos(theta_rad);
      const sin_t = Math.sin(theta_rad);
      const width = uncroppedImageRenderSize?.width ?? 0;
      const height = uncroppedImageRenderSize?.height ?? 0;
      const cx = width / 2;
      const cy = height / 2;

      const unrotate = (p: Coord) => {
        const x = p.x - cx;
        const y = p.y - cy;
        return {
          x: cx + x * cos_t + y * sin_t,
          y: cy - x * sin_t + y * cos_t,
        };
      };

      const start_unrotated = unrotate(start);
      const end_unrotated = unrotate(end);
      const dx = end_unrotated.x - start_unrotated.x;
      const dy = end_unrotated.y - start_unrotated.y;
      const angle = Math.atan2(dy, dx) * (180 / Math.PI);
      let targetAngle;

      if (angle > -45 && angle <= 45) {
        targetAngle = 0;
      } else if (angle > 45 && angle <= 135) {
        targetAngle = 90;
      } else if (angle > 135 || angle <= -135) {
        targetAngle = 180;
      } else {
        targetAngle = -90;
      }

      let correction = targetAngle - angle;
      if (correction > 180) {
        correction -= 360;
      }
      if (correction < -180) {
        correction += 360;
      }

      onStraighten(correction);
      setStraightenLine(null);
    };

    const handleStraightenMouseLeave = () => {
      if (isStraightening.current) {
        isStraightening.current = false;
        setStraightenLine(null);
      }
    };

    const cropPreviewUrl = uncroppedAdjustedPreviewUrl || selectedImage.thumbnailUrl;
    const editedSrc = finalPreviewUrl || selectedImage.thumbnailUrl;
    const originalSrc = transformedOriginalUrl;
    const isShowingOriginal = showOriginal && !!originalSrc;

    useEffect(() => {
      if (!originalSrc) {
        setOriginalLoaded(false);
        return;
      }

      const img = new Image();
      img.src = originalSrc;

      if (img.complete) {
        setOriginalLoaded(true);
      } else {
        setOriginalLoaded(false);
        img.onload = () => setOriginalLoaded(true);
      }

      return () => {
        img.onload = null;
      };
    }, [originalSrc]);

    const uncroppedImageRenderSize = useMemo<Partial<RenderSize> | null>(() => {
      if (!selectedImage?.width || !selectedImage?.height || !imageRenderSize?.width || !imageRenderSize?.height) {
        return null;
      }

      const viewportWidth = imageRenderSize.width + 2 * imageRenderSize.offsetX;
      const viewportHeight = imageRenderSize.height + 2 * imageRenderSize.offsetY;

      let uncroppedEffectiveWidth = selectedImage.width;
      let uncroppedEffectiveHeight = selectedImage.height;
      const orientationSteps = adjustments.orientationSteps || 0;
      if (orientationSteps === 1 || orientationSteps === 3) {
        [uncroppedEffectiveWidth, uncroppedEffectiveHeight] = [uncroppedEffectiveHeight, uncroppedEffectiveWidth];
      }

      if (uncroppedEffectiveWidth <= 0 || uncroppedEffectiveHeight <= 0 || viewportWidth <= 0 || viewportHeight <= 0) {
        return null;
      }

      const scale = Math.min(viewportWidth / uncroppedEffectiveWidth, viewportHeight / uncroppedEffectiveHeight);

      const renderWidth = uncroppedEffectiveWidth * scale;
      const renderHeight = uncroppedEffectiveHeight * scale;

      return { width: renderWidth, height: renderHeight };
    }, [selectedImage?.width, selectedImage?.height, imageRenderSize, adjustments.orientationSteps]);

    const cropImageTransforms = useMemo(() => {
      const transforms = [`rotate(${adjustments.rotation || 0}deg)`];
      return transforms.join(' ');
    }, [adjustments.rotation]);

    const getCropDimensions = () => {
      if (!crop || !uncroppedImageRenderSize?.width || !uncroppedImageRenderSize?.height) {
        return { width: 0, height: 0 };
      }

      const width = crop.unit === '%' ? uncroppedImageRenderSize.width * (crop.width / 100) : crop.width;

      const height = crop.unit === '%' ? uncroppedImageRenderSize.height * (crop.height / 100) : crop.height;

      return { width, height };
    };

    const effectiveCursor = useMemo(() => {
      if (isWbPickerActive) return 'crosshair';
      if (isBrushActive) return 'none';
      if (isAiSubjectActive) return 'crosshair';
      return cursorStyle;
    }, [isWbPickerActive, isBrushActive, isAiSubjectActive, cursorStyle]);

    const handlePreviewUpdate = useCallback(
      (id: string, subMaskPreview: Partial<SubMask>) => {
        if (!activeContainer || !onLiveMaskPreview) return;
        const previewContainer = {
          ...activeContainer,
          subMasks: activeContainer.subMasks.map((sm: SubMask) => (sm.id === id ? { ...sm, ...subMaskPreview } : sm)),
        };
        onLiveMaskPreview(previewContainer);
      },
      [activeContainer, onLiveMaskPreview],
    );

    return (
      <div className="relative" style={{ width: '100%', height: '100%' }}>
        <div
          className="absolute inset-0 w-full h-full transition-opacity duration-200 flex items-center justify-center"
          style={{
            opacity: isCropViewVisible ? 0 : 1,
            pointerEvents: isCropViewVisible ? 'none' : 'auto',
          }}
        >
          <div
            className="opacity-100"
            style={{
              height: '100%',
              position: 'relative',
              width: '100%',
            }}
          >
            <div className="absolute inset-0 w-full h-full">
              {editedSrc && (
                <img
                  alt="Edited"
                  className={
                    imageRenderSize.width > 0 && imageRenderSize.height > 0
                      ? 'pointer-events-none'
                      : 'absolute inset-0 w-full h-full object-contain pointer-events-none'
                  }
                  src={editedSrc}
                  style={
                    imageRenderSize.width > 0 && imageRenderSize.height > 0
                      ? {
                          position: 'absolute',
                          left: `${imageRenderSize.offsetX}px`,
                          top: `${imageRenderSize.offsetY}px`,
                          width: `${imageRenderSize.width}px`,
                          height: `${imageRenderSize.height}px`,
                          imageRendering: isMaxZoom ? 'pixelated' : 'auto',
                        }
                      : {
                          imageRendering: isMaxZoom ? 'pixelated' : 'auto',
                        }
                  }
                />
              )}

              {originalSrc && (
                <img
                  alt="Original"
                  className={
                    imageRenderSize.width > 0 && imageRenderSize.height > 0
                      ? 'pointer-events-none'
                      : 'absolute inset-0 w-full h-full object-contain pointer-events-none'
                  }
                  src={originalSrc}
                  style={
                    imageRenderSize.width > 0 && imageRenderSize.height > 0
                      ? {
                          position: 'absolute',
                          left: `${imageRenderSize.offsetX}px`,
                          top: `${imageRenderSize.offsetY}px`,
                          width: `${imageRenderSize.width}px`,
                          height: `${imageRenderSize.height}px`,
                          imageRendering: isMaxZoom ? 'pixelated' : 'auto',
                          opacity: isShowingOriginal && originalLoaded ? 1 : 0,
                          transition: originalLoaded ? 'opacity 150ms ease-in-out' : 'none',
                          zIndex: 2,
                        }
                      : {
                          imageRendering: isMaxZoom ? 'pixelated' : 'auto',
                          opacity: isShowingOriginal && originalLoaded ? 1 : 0,
                          transition: originalLoaded ? 'opacity 150ms ease-in-out' : 'none',
                          zIndex: 2,
                        }
                  }
                />
              )}
              {displayedMaskUrl && (
                <img
                  alt="Mask Overlay"
                  className="absolute object-contain pointer-events-none"
                  src={displayedMaskUrl}
                  style={{
                    height: `${imageRenderSize.height}px`,
                    left: `${imageRenderSize.offsetX}px`,
                    opacity: isShowingOriginal || isMaskControlHovered ? 0 : 1,
                    top: `${imageRenderSize.offsetY}px`,
                    transition: 'opacity 300ms ease-in-out',
                    width: `${imageRenderSize.width}px`,
                    imageRendering: isMaxZoom ? 'pixelated' : 'auto',
                    zIndex: 3,
                  }}
                />
              )}
            </div>
          </div>

          <Stage
            height={imageRenderSize.height}
            onMouseDown={handleMouseDown}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            style={{
              cursor: effectiveCursor,
              left: `${imageRenderSize.offsetX}px`,
              opacity: isShowingOriginal ? 0 : 1,
              transition: 'opacity 300ms ease-in-out',
              pointerEvents: showOriginal ? 'none' : 'auto',
              position: 'absolute',
              top: `${imageRenderSize.offsetY}px`,
              zIndex: 4,
              touchAction: 'none',
              userSelect: 'none',
            }}
            width={imageRenderSize.width}
          >
            <Layer>
              {(isMasking || isAiEditing) &&
                activeContainer &&
                sortedSubMasks.map((subMask: SubMask) => (
                  <MaskOverlay
                    adjustments={adjustments}
                    imageHeight={effectiveImageDimensions.height}
                    imageWidth={effectiveImageDimensions.width}
                    isSelected={subMask.id === (isMasking ? activeMaskId : activeAiSubMaskId)}
                    isToolActive={isToolActive}
                    key={subMask.id}
                    onMaskMouseEnter={() => !isToolActive && setIsMaskHovered(true)}
                    onMaskMouseLeave={() => !isToolActive && setIsMaskHovered(false)}
                    onPreviewUpdate={handlePreviewUpdate}
                    onSelect={() => (isMasking ? onSelectMask(subMask.id) : onSelectAiSubMask(subMask.id))}
                    onUpdate={updateSubMask}
                    scale={imageRenderSize.scale}
                    subMask={subMask}
                  />
                ))}
              {previewLine && previewLine.tool === ToolType.AiSeletor && (
                <Line
                  dash={[4, 4]}
                  lineCap="round"
                  lineJoin="round"
                  listening={false}
                  opacity={0.8}
                  points={previewLine.points.flatMap((p: Coord) => [p.x, p.y])}
                  stroke="#0ea5e9"
                  strokeWidth={2}
                  tension={0.5}
                />
              )}
              {isBrushActive && cursorPreview.visible && (
                <Circle
                  listening={false}
                  perfectDrawEnabled={false}
                  stroke={brushSettings?.tool === ToolType.Eraser ? '#f43f5e' : '#0ea5e9'}
                  radius={brushSettings?.size ? brushSettings.size / 2 : 0}
                  strokeWidth={1}
                  x={cursorPreview.x}
                  y={cursorPreview.y}
                />
              )}
            </Layer>
          </Stage>
        </div>

        <div
          className="absolute inset-0 w-full h-full flex items-center justify-center transition-opacity duration-200"
          style={{
            opacity: isCropViewVisible ? 1 : 0,
            pointerEvents: isCropViewVisible ? 'auto' : 'none',
          }}
        >
          {cropPreviewUrl && uncroppedImageRenderSize && (
            <div
              style={{
                height: uncroppedImageRenderSize.height,
                position: 'relative',
                width: uncroppedImageRenderSize.width,
              }}
            >
              <ReactCrop
                aspect={adjustments.aspectRatio}
                crop={crop}
                onChange={setCrop}
                onComplete={handleCropComplete}
                ruleOfThirds={false}
                renderSelectionAddon={() => {
                  const { width, height } = getCropDimensions();
                  if (width <= 0 || height <= 0) {
                    return null;
                  }
                  const showDenseGrid = isRotationActive && !isStraightenActive;
                  const currentOverlayMode = isRotationActive || isStraightenActive ? 'none' : overlayMode || 'none';
                  return (
                    <CompositionOverlays
                      width={width}
                      height={height}
                      mode={currentOverlayMode}
                      rotation={overlayRotation || 0}
                      denseVisible={showDenseGrid}
                    />
                  );
                }}
              >
                <img
                  alt="Crop preview"
                  ref={cropImageRef}
                  src={cropPreviewUrl}
                  style={{
                    display: 'block',
                    width: `${uncroppedImageRenderSize.width}px`,
                    height: `${uncroppedImageRenderSize.height}px`,
                    objectFit: 'contain',
                    transform: cropImageTransforms,
                    imageRendering: isMaxZoom ? 'pixelated' : 'auto',
                  }}
                />
              </ReactCrop>

              {isStraightenActive && (
                <Stage
                  height={uncroppedImageRenderSize.height}
                  onMouseDown={handleStraightenMouseDown}
                  onMouseLeave={handleStraightenMouseLeave}
                  onMouseMove={handleStraightenMouseMove}
                  onMouseUp={handleStraightenMouseUp}
                  style={{ position: 'absolute', top: 0, left: 0, zIndex: 10, cursor: 'crosshair' }}
                  width={uncroppedImageRenderSize.width}
                >
                  <Layer>
                    {straightenLine && (
                      <Line
                        dash={[4, 4]}
                        listening={false}
                        points={[
                          straightenLine.start.x,
                          straightenLine.start.y,
                          straightenLine.end.x,
                          straightenLine.end.y,
                        ]}
                        stroke="#0ea5e9"
                        strokeWidth={2}
                      />
                    )}
                  </Layer>
                </Stage>
              )}
            </div>
          )}
        </div>
      </div>
    );
  },
);

export default ImageCanvas;
