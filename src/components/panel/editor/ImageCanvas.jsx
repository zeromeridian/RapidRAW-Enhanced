import { useState, useEffect, useRef, useCallback, memo, useMemo } from 'react';
import ReactCrop from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';
import { Stage, Layer, Ellipse, Line, Transformer, Group, Circle, Rect } from 'react-konva';
import clsx from 'clsx';

function linesIntersect(eraserLine, drawnLine) {
  // This is a simplified intersection check. For more accuracy, you might need a more complex algorithm.
  const threshold = (eraserLine.brushSize / 2) + (drawnLine.brushSize / 2);
  for (const p1 of eraserLine.points) {
    for (const p2 of drawnLine.points) {
      const distance = Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
      if (distance < threshold) return true;
    }
  }
  return false;
}

const MaskOverlay = memo(({ mask, scale, onUpdate, isSelected, onSelect, onMaskMouseEnter, onMaskMouseLeave, adjustments }) => {
  const shapeRef = useRef();
  const trRef = useRef();

  const crop = adjustments.crop;
  const cropX = crop ? crop.x : 0;
  const cropY = crop ? crop.y : 0;

  useEffect(() => {
    if (isSelected && trRef.current && shapeRef.current) {
      trRef.current.nodes([shapeRef.current]);
      trRef.current.getLayer().batchDraw();
    }
  }, [isSelected]);

  const handleRadialDrag = useCallback((e) => {
    onUpdate(mask.id, {
      parameters: { 
        ...mask.parameters, 
        centerX: (e.target.x() / scale) + cropX, 
        centerY: (e.target.y() / scale) + cropY 
      },
    });
  }, [mask.id, mask.parameters, onUpdate, scale, cropX, cropY]);

  const handleRadialTransform = useCallback(() => {
    const node = shapeRef.current;
    if (!node) return;

    onUpdate(mask.id, {
      parameters: {
        ...mask.parameters,
        centerX: (node.x() / scale) + cropX,
        centerY: (node.y() / scale) + cropY,
        radiusX: (node.radiusX() * node.scaleX()) / scale,
        radiusY: (node.radiusY() * node.scaleY()) / scale,
        rotation: node.rotation(),
      },
    });
  }, [mask.id, mask.parameters, onUpdate, scale, cropX, cropY]);

  const handleRadialTransformEnd = useCallback(() => {
    const node = shapeRef.current;
    if (!node) return;
    
    const scaleX = node.scaleX();
    const scaleY = node.scaleY();

    node.scaleX(1);
    node.scaleY(1);

    onUpdate(mask.id, {
      parameters: {
        ...mask.parameters,
        centerX: (node.x() / scale) + cropX,
        centerY: (node.y() / scale) + cropY,
        radiusX: (node.radiusX() * scaleX) / scale,
        radiusY: (node.radiusY() * scaleY) / scale,
        rotation: node.rotation(),
      },
    });
  }, [mask.id, mask.parameters, onUpdate, scale, cropX, cropY]);

  const handleGroupDragEnd = (e) => {
    const group = e.target;
    const { startX, startY, endX, endY } = mask.parameters;
    const dx = endX - startX;
    const dy = endY - startY;
    const centerX = startX + dx / 2;
    const centerY = startY + dy / 2;
    const groupX = (centerX - cropX) * scale;
    const groupY = (centerY - cropY) * scale;
    const moveX = group.x() - groupX;
    const moveY = group.y() - groupY;
    onUpdate(mask.id, {
      parameters: {
        ...mask.parameters,
        startX: startX + moveX / scale,
        startY: startY + moveY / scale,
        endX: endX + moveX / scale,
        endY: endY + moveY / scale,
      }
    });
  };

  const handlePointDrag = (e, point) => {
    const stage = e.target.getStage();
    const pointerPos = stage.getPointerPosition();
    if (!pointerPos) return;

    const newX = (pointerPos.x / scale) + cropX;
    const newY = (pointerPos.y / scale) + cropY;

    const newParams = { ...mask.parameters };
    if (point === 'start') {
      newParams.startX = newX;
      newParams.startY = newY;
    } else {
      newParams.endX = newX;
      newParams.endY = newY;
    }
    onUpdate(mask.id, { parameters: newParams });
  };
  
  const handleRangeDrag = (e) => {
    const newRange = Math.abs(e.target.y() / scale);
    onUpdate(mask.id, {
      parameters: { ...mask.parameters, range: newRange }
    });
  };

  if (!mask.visible) {
    return null;
  }

  const commonProps = {
    onClick: onSelect,
    onTap: onSelect,
    stroke: isSelected ? '#0ea5e9' : 'white',
    strokeWidth: isSelected ? 3 : 2,
    strokeScaleEnabled: false,
    dash: [4, 4],
    opacity: isSelected ? 1 : 0.7,
  };

  if (mask.type === 'ai-subject') {
    const { startX, startY, endX, endY } = mask.parameters;
    // Only show the bounding box if it has been defined and the mask is selected
    if (isSelected && endX > startX && endY > startY) {
      return (
        <Rect
          x={(startX - cropX) * scale}
          y={(startY - cropY) * scale}
          width={(endX - startX) * scale}
          height={(endY - startY) * scale}
          onMouseEnter={onMaskMouseEnter}
          onMouseLeave={onMaskMouseLeave}
          {...commonProps}
        />
      );
    }
    return null; // Don't show anything if not selected or not yet generated
  }

  if (mask.type === 'brush') {
    const { lines = [] } = mask.parameters;
    return (
      <Group onClick={onSelect} onTap={onSelect}>
        {lines.map((line, i) => (
          <Line
            key={i}
            points={line.points.flatMap(p => [(p.x - cropX) * scale, (p.y - cropY) * scale])}
            stroke={isSelected ? 'transparent' : 'white'}
            strokeWidth={2}
            dash={[4, 4]}
            opacity={isSelected ? 0 : 0.7}
            hitStrokeWidth={line.brushSize * scale}
            strokeScaleEnabled={false}
            tension={0.5}
            lineCap="round"
            lineJoin="round"
          />
        ))}
      </Group>
    );
  }

  if (mask.type === 'radial') {
    const { centerX, centerY, radiusX, radiusY, rotation } = mask.parameters;
    return (
      <>
        <Ellipse
          ref={shapeRef}
          x={(centerX - cropX) * scale}
          y={(centerY - cropY) * scale}
          radiusX={radiusX * scale}
          radiusY={radiusY * scale}
          rotation={rotation}
          draggable
          onDragMove={handleRadialDrag}
          onDragEnd={handleRadialDrag}
          onTransform={handleRadialTransform}
          onTransformEnd={handleRadialTransformEnd}
          onMouseEnter={onMaskMouseEnter}
          onMouseLeave={onMaskMouseLeave}
          {...commonProps}
        />
        {isSelected && (
          <Transformer ref={trRef} boundBoxFunc={(oldBox, newBox) => newBox} onMouseEnter={onMaskMouseEnter} onMouseLeave={onMaskMouseLeave} />
        )}
      </>
    );
  }

  if (mask.type === 'linear') {
    const { startX, startY, endX, endY, range = 50 } = mask.parameters;
    const dx = endX - startX;
    const dy = endY - startY;
    const len = Math.sqrt(dx * dx + dy * dy);
    const angle = Math.atan2(dy, dx);
    const centerX = startX + dx / 2;
    const centerY = startY + dy / 2;
    const groupX = (centerX - cropX) * scale;
    const groupY = (centerY - cropY) * scale;
    const scaledLen = len * scale;
    const r = range * scale;

    const lineProps = {
      ...commonProps,
      strokeWidth: isSelected ? 2.5 : 2,
      dash: [6, 6],
      hitStrokeWidth: 20,
    };

    const perpendicularDragBoundFunc = function(pos) {
      const group = this.getParent();
      const transform = group.getAbsoluteTransform().copy();
      transform.invert();
      const localPos = transform.point(pos);
      const constrainedLocalPos = { x: 0, y: localPos.y };
      return group.getAbsoluteTransform().point(constrainedLocalPos);
    };

    return (
      <Group
        x={groupX}
        y={groupY}
        rotation={angle * 180 / Math.PI}
        draggable={isSelected}
        onDragEnd={handleGroupDragEnd}
        onMouseEnter={(e) => {
          onMaskMouseEnter();
          const stage = e.target.getStage();
          if (stage) stage.container().style.cursor = 'move';
        }}
        onMouseLeave={(e) => {
          onMaskMouseLeave();
          const stage = e.target.getStage();
          if (stage) stage.container().style.cursor = 'default';
        }}
        onClick={onSelect}
        onTap={onSelect}
      >
        <Line points={[-5000, 0, 5000, 0]} {...lineProps} dash={[2, 3]} />
        <Line
          y={-r}
          points={[-scaledLen / 2, 0, scaledLen / 2, 0]}
          {...lineProps}
          draggable={isSelected}
          onDragMove={handleRangeDrag}
          onDragEnd={(e) => { handleRangeDrag(e); e.cancelBubble = true; }}
          dragBoundFunc={perpendicularDragBoundFunc}
          onMouseEnter={(e) => { e.target.getStage().container().style.cursor = 'row-resize'; onMaskMouseEnter(); }}
          onMouseLeave={(e) => { e.target.getStage().container().style.cursor = 'move'; onMaskMouseLeave(); }}
        />
        <Line
          y={r}
          points={[-scaledLen / 2, 0, scaledLen / 2, 0]}
          {...lineProps}
          draggable={isSelected}
          onDragMove={handleRangeDrag}
          onDragEnd={(e) => { handleRangeDrag(e); e.cancelBubble = true; }}
          dragBoundFunc={perpendicularDragBoundFunc}
          onMouseEnter={(e) => { e.target.getStage().container().style.cursor = 'row-resize'; onMaskMouseEnter(); }}
          onMouseLeave={(e) => { e.target.getStage().container().style.cursor = 'move'; onMaskMouseLeave(); }}
        />
        {isSelected && (
          <>
            <Circle
              x={-scaledLen / 2}
              y={0}
              radius={8}
              fill="#0ea5e9"
              stroke="white"
              strokeWidth={2}
              draggable
              onDragMove={(e) => handlePointDrag(e, 'start')}
              onDragEnd={(e) => { handlePointDrag(e, 'start'); e.cancelBubble = true; }}
              onMouseEnter={(e) => { e.target.getStage().container().style.cursor = 'grab'; onMaskMouseEnter(); }}
              onMouseLeave={(e) => { e.target.getStage().container().style.cursor = 'move'; onMaskMouseLeave(); }}
            />
            <Circle
              x={scaledLen / 2}
              y={0}
              radius={8}
              fill="#0ea5e9"
              stroke="white"
              strokeWidth={2}
              draggable
              onDragMove={(e) => handlePointDrag(e, 'end')}
              onDragEnd={(e) => { handlePointDrag(e, 'end'); e.cancelBubble = true; }}
              onMouseEnter={(e) => { e.target.getStage().container().style.cursor = 'grab'; onMaskMouseEnter(); }}
              onMouseLeave={(e) => { e.target.getStage().container().style.cursor = 'move'; onMaskMouseLeave(); }}
            />
          </>
        )}
      </Group>
    );
  }
  return null;
});

const ImageCanvas = memo(({
  isCropping, crop, setCrop, handleCropComplete, adjustments, selectedImage,
  isMasking, imageRenderSize, showOriginal, finalPreviewUrl, isAdjusting,
  uncroppedAdjustedPreviewUrl, maskOverlayUrl,
  onSelectMask, activeMaskId, handleUpdateMask, setIsMaskHovered,
  brushSettings, onGenerateAiMask
}) => {
  const [isCropViewVisible, setIsCropViewVisible] = useState(false);
  const imagePathRef = useRef(null);
  const latestEditedUrlRef = useRef(null);
  const [layers, setLayers] = useState([]);
  const cropImageRef = useRef(null);

  const isDrawing = useRef(false);
  const currentLine = useRef(null);
  const [previewLine, setPreviewLine] = useState(null);
  const [cursorPreview, setCursorPreview] = useState({ x: 0, y: 0, visible: false });

  const activeMask = useMemo(() => adjustments.masks.find(m => m.id === activeMaskId), [adjustments.masks, activeMaskId]);
  const isBrushActive = isMasking && activeMask?.type === 'brush';
  const isAiSubjectActive = isMasking && activeMask?.type === 'ai-subject';

  const sortedMasks = useMemo(() => {
    if (!activeMaskId) {
      return adjustments.masks;
    }
    const selectedMask = adjustments.masks.find(m => m.id === activeMaskId);
    const otherMasks = adjustments.masks.filter(m => m.id !== activeMaskId);
    
    if (!selectedMask) {
      return adjustments.masks;
    }

    return [...otherMasks, selectedMask];
  }, [adjustments.masks, activeMaskId]);

  useEffect(() => {
    const { path: currentImagePath, originalUrl, thumbnailUrl } = selectedImage;
    const topLayer = layers[layers.length - 1];

    if (currentImagePath !== imagePathRef.current) {
      imagePathRef.current = currentImagePath;
      const initialUrl = finalPreviewUrl || originalUrl || thumbnailUrl;
      if (initialUrl) {
        latestEditedUrlRef.current = initialUrl;
        setLayers([{ id: initialUrl, url: initialUrl, opacity: 1 }]);
      } else {
        setLayers([]);
      }
      return;
    }

    if (showOriginal && topLayer?.id !== 'original') {
      setLayers(prev => [...prev, { id: 'original', url: originalUrl, opacity: 0 }]);
      return;
    }
    if (!showOriginal && topLayer?.id === 'original') {
      setLayers(prev => [...prev, { id: latestEditedUrlRef.current, url: latestEditedUrlRef.current, opacity: 0 }]);
      return;
    }

    if (finalPreviewUrl && finalPreviewUrl !== latestEditedUrlRef.current) {
      latestEditedUrlRef.current = finalPreviewUrl;
      const img = new Image();
      img.src = finalPreviewUrl;
      img.onload = () => {
        if (img.src === latestEditedUrlRef.current) {
          setLayers(prev => [...prev, { id: img.src, url: img.src, opacity: 0 }]);
        }
      };
      return () => { img.onload = null; };
    }
  }, [selectedImage, finalPreviewUrl, showOriginal, layers]);

  useEffect(() => {
    const layerToFadeIn = layers.find(l => l.opacity === 0);
    if (layerToFadeIn) {
      const timer = setTimeout(() => {
        setLayers(prev =>
          prev.map(l => (l.id === layerToFadeIn.id ? { ...l, opacity: 1 } : l))
        );
      }, 10);

      return () => clearTimeout(timer);
    }
  }, [layers]);

  const handleTransitionEnd = useCallback((finishedId) => {
    setLayers(prev => prev.length > 1 ? prev.filter(l => l.id === finishedId) : prev);
  }, []);

  useEffect(() => {
    if (isCropping) {
      const timer = setTimeout(() => setIsCropViewVisible(true), 10);
      return () => clearTimeout(timer);
    } else {
      setIsCropViewVisible(false);
    }
  }, [isCropping]);

  const handleMouseDown = useCallback((e) => {
    if (isBrushActive || isAiSubjectActive) {
      e.evt.preventDefault();
      
      isDrawing.current = true;
      const stage = e.target.getStage();
      const pos = stage.getPointerPosition();
      if (!pos) return;

      const newLine = {
        tool: isBrushActive ? brushSettings.tool : 'ai-selector',
        brushSize: isBrushActive ? brushSettings.size : 2,
        points: [pos]
      };
      currentLine.current = newLine;
      setPreviewLine(newLine);
    } else {
      if (e.target === e.target.getStage()) {
        onSelectMask(null);
      }
    }
  }, [isBrushActive, isAiSubjectActive, brushSettings, onSelectMask]);

  const handleMouseMove = useCallback((e) => {
    if (isBrushActive || isAiSubjectActive) {
      const stage = e.target.getStage();
      const pos = stage.getPointerPosition();
      if (pos) {
        setCursorPreview({ x: pos.x, y: pos.y, visible: true });
      } else {
        setCursorPreview(p => ({ ...p, visible: false }));
      }
    }

    if (!isDrawing.current || !(isBrushActive || isAiSubjectActive)) return;
    
    const stage = e.target.getStage();
    const pos = stage.getPointerPosition();
    if (!pos) return;

    const updatedLine = {
      ...currentLine.current,
      points: [...currentLine.current.points, pos]
    };
    currentLine.current = updatedLine;
    setPreviewLine(updatedLine);
  }, [isBrushActive, isAiSubjectActive]);

  const handleMouseUp = useCallback(() => {
    if (!isDrawing.current || !currentLine.current) return;
    
    const wasDrawing = isDrawing.current;
    isDrawing.current = false;
    const line = currentLine.current;
    currentLine.current = null;
    setPreviewLine(null);

    if (!wasDrawing || !line) return;

    const { scale } = imageRenderSize;
    const cropX = adjustments.crop?.x || 0;
    const cropY = adjustments.crop?.y || 0;

    if (isAiSubjectActive) {
      console.log("[ImageCanvas] AI Subject mask tool is active. Processing drawn shape.");
      const points = line.points;
      if (points.length > 1) {
        const xs = points.map(p => p.x);
        const ys = points.map(p => p.y);
        const minX = Math.min(...xs);
        const minY = Math.min(...ys);
        const maxX = Math.max(...xs);
        const maxY = Math.max(...ys);

        const startPoint = {
          x: minX / scale + cropX,
          y: minY / scale + cropY,
        };
        const endPoint = {
          x: maxX / scale + cropX,
          y: maxY / scale + cropY,
        };
        
        console.log("[ImageCanvas] Calculated bounding box for AI mask:", {
          maskId: activeMaskId,
          start: startPoint,
          end: endPoint,
        });

        if (onGenerateAiMask) {
            console.log("[ImageCanvas] Calling onGenerateAiMask prop to trigger backend...");
            onGenerateAiMask(activeMaskId, startPoint, endPoint);
        } else {
            console.error("[ImageCanvas] ERROR: onGenerateAiMask prop is not defined!");
        }

      } else {
        console.log("[ImageCanvas] AI Subject mask draw was too short. Not generating mask.");
      }
    } else if (isBrushActive) {
      const imageSpaceLine = {
        tool: line.tool,
        brushSize: line.brushSize / scale,
        feather: brushSettings.feather,
        points: line.points.map(p => ({
          x: p.x / scale + cropX,
          y: p.y / scale + cropY,
        }))
      };

      const existingLines = activeMask.parameters.lines || [];

      if (brushSettings.tool === 'eraser') {
        const remainingLines = existingLines.filter(
          drawnLine => !linesIntersect(imageSpaceLine, drawnLine)
        );
        if (remainingLines.length !== existingLines.length) {
          handleUpdateMask(activeMaskId, {
            parameters: { ...activeMask.parameters, lines: remainingLines }
          });
        }
      } else {
        handleUpdateMask(activeMaskId, {
          parameters: {
            ...activeMask.parameters,
            lines: [...existingLines, imageSpaceLine]
          }
        });
      }
    }
  }, [isBrushActive, isAiSubjectActive, activeMask, activeMaskId, handleUpdateMask, adjustments.crop, imageRenderSize.scale, brushSettings, onGenerateAiMask]);

  const handleMouseEnter = useCallback(() => {
    if (isBrushActive || isAiSubjectActive) {
      setCursorPreview(p => ({ ...p, visible: true }));
    }
  }, [isBrushActive, isAiSubjectActive]);

  const handleMouseLeave = useCallback(() => {
    setCursorPreview(p => ({ ...p, visible: false }));
    if (isDrawing.current) {
      handleMouseUp();
    }
  }, [handleMouseUp]);

  const cropPreviewUrl = uncroppedAdjustedPreviewUrl || selectedImage.originalUrl;
  const isContentReady = layers.length > 0 || selectedImage.thumbnailUrl;

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
          className={clsx(
            "transition-opacity duration-300",
            isAdjusting && !showOriginal ? 'opacity-70' : 'opacity-100'
          )}
          style={{ 
            opacity: isContentReady ? 1 : 0,
            width: '100%',
            height: '100%',
            position: 'relative'
          }}
        >
          <div className="absolute inset-0 w-full h-full">
            {layers.map(layer => (
              <img
                key={layer.id}
                src={layer.url}
                alt={layer.id === 'original' ? 'Original' : 'Edited'}
                onTransitionEnd={() => handleTransitionEnd(layer.id)}
                className="absolute inset-0 w-full h-full object-contain"
                style={{
                  opacity: layer.opacity,
                  transition: 'opacity 150ms ease-in-out',
                }}
              />
            ))}
            {isMasking && maskOverlayUrl && (
              <img
                src={maskOverlayUrl}
                alt="Mask Overlay"
                className="absolute object-contain pointer-events-none"
                style={{
                  width: `${imageRenderSize.width}px`,
                  height: `${imageRenderSize.height}px`,
                  left: `${imageRenderSize.offsetX}px`,
                  top: `${imageRenderSize.offsetY}px`,
                  opacity: showOriginal ? 0 : 1,
                  transition: 'opacity 150ms ease-in-out',
                }}
              />
            )}
          </div>
        </div>

        {isMasking && imageRenderSize.width > 0 && (
          <Stage
            width={imageRenderSize.width}
            height={imageRenderSize.height}
            className="transition-opacity duration-300"
            style={{
              position: 'absolute',
              left: `${imageRenderSize.offsetX}px`,
              top: `${imageRenderSize.offsetY}px`,
              zIndex: 4,
              opacity: showOriginal ? 0 : 1,
              pointerEvents: showOriginal ? 'none' : 'auto',
              cursor: (isBrushActive || isAiSubjectActive) ? 'crosshair' : 'default',
            }}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
          >
            <Layer>
              {sortedMasks.map(mask => (
                <MaskOverlay
                  key={mask.id}
                  mask={mask}
                  scale={imageRenderSize.scale}
                  onUpdate={handleUpdateMask}
                  isSelected={mask.id === activeMaskId}
                  onSelect={() => onSelectMask(mask.id)}
                  onMaskMouseEnter={() => !(isBrushActive || isAiSubjectActive) && setIsMaskHovered(true)}
                  onMaskMouseLeave={() => !(isBrushActive || isAiSubjectActive) && setIsMaskHovered(false)}
                  adjustments={adjustments}
                />
              ))}
              {previewLine && (
                <Line
                  points={previewLine.points.flatMap(p => [p.x, p.y])}
                  stroke={previewLine.tool === 'eraser' ? '#f43f5e' : '#0ea5e9'}
                  strokeWidth={previewLine.tool === 'ai-selector' ? 2 : previewLine.brushSize}
                  tension={0.5}
                  lineCap="round"
                  lineJoin="round"
                  opacity={0.8}
                  listening={false}
                  dash={previewLine.tool === 'ai-selector' ? [4, 4] : undefined}
                />
              )}
              {isBrushActive && cursorPreview.visible && (
                <Circle
                  x={cursorPreview.x}
                  y={cursorPreview.y}
                  radius={brushSettings.size / 2}
                  stroke={brushSettings.tool === 'eraser' ? '#f43f5e' : '#0ea5e9'}
                  strokeWidth={1}
                  listening={false}
                  perfectDrawEnabled={false}
                />
              )}
            </Layer>
          </Stage>
        )}
      </div>

      <div
        className="absolute inset-0 w-full h-full flex items-center justify-center transition-opacity duration-200"
        style={{
          opacity: isCropViewVisible ? 1 : 0,
          pointerEvents: isCropViewVisible ? 'auto' : 'none',
        }}
      >
        {cropPreviewUrl && (
          <ReactCrop
            crop={crop}
            onChange={(_, percentCrop) => setCrop(percentCrop)}
            onComplete={(c, pc) => handleCropComplete(c, pc, cropImageRef.current)}
            aspect={adjustments.aspectRatio}
            ruleOfThirds
          >
            <img
              ref={cropImageRef}
              alt="Crop preview"
              src={cropPreviewUrl}
              style={{ 
                display: 'block', 
                maxWidth: '100%', 
                maxHeight: '100%', 
                objectFit: 'contain',
                transform: `rotate(${adjustments.rotation}deg)`,
              }}
            />
          </ReactCrop>
        )}
      </div>
    </div>
  );
});

export default ImageCanvas;