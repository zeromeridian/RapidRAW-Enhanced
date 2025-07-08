import { useState, useRef, useEffect } from 'react';

function getCurvePath(points, tension = 0.5) {
  if (points.length < 2) return '';
  let path = `M ${points[0].x} ${255 - points[0].y}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = i > 0 ? points[i - 1] : points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = i < points.length - 2 ? points[i + 2] : p2;

    const cp1x = p1.x + (p2.x - p0.x) / 6 * tension;
    const cp1y = p1.y + (p2.y - p0.y) / 6 * tension;
    const cp2x = p2.x - (p3.x - p1.x) / 6 * tension;
    const cp2y = p2.y - (p3.y - p1.y) / 6 * tension;

    path += ` C ${cp1x} ${255 - cp1y}, ${cp2x} ${255 - cp2y}, ${p2.x} ${255 - p2.y}`;
  }
  return path;
}

function getHistogramPath(data) {
    if (!data || data.length === 0) return "";
    const maxVal = Math.max(...data);
    if (maxVal === 0) return "";

    const pathData = data.map((value, index) => {
        const x = (index / 255) * 255;
        const y = (value / maxVal) * 255;
        return `${x},${255 - y}`;
    }).join(' ');

    return `M0,255 L${pathData} L255,255 Z`;
}

export default function CurveGraph({ adjustments, setAdjustments, histogram, theme }) {
  const [activeChannel, setActiveChannel] = useState('luma');
  const [draggingPointIndex, setDraggingPointIndex] = useState(null);
  const [localPoints, setLocalPoints] = useState(null);
  const svgRef = useRef(null);

  const isLightTheme = theme === 'light' || theme === 'arctic';
  const histogramOpacity = isLightTheme ? 0.6 : 0.15;

  const channelConfig = {
    luma: { color: 'rgb(var(--color-accent))', data: histogram?.luma },
    red: { color: '#FF6B6B', data: histogram?.red },
    green: { color: '#6BCB77', data: histogram?.green },
    blue: { color: '#4D96FF', data: histogram?.blue },
  };

  const propPoints = adjustments?.curves?.[activeChannel];
  const points = localPoints ?? propPoints;
  const { color, data: histogramData } = channelConfig[activeChannel];

  if (!propPoints) {
    return (
      <div className="w-full aspect-square bg-surface-secondary p-1 rounded-md flex items-center justify-center text-text-secondary text-xs">
        Curve data not available.
      </div>
    );
  }

  useEffect(() => {
    if (draggingPointIndex === null) {
      setLocalPoints(null);
    }
  }, [propPoints]);

  useEffect(() => {
    setLocalPoints(null);
    setDraggingPointIndex(null);
  }, [activeChannel]);

  const getMousePos = (e) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    const x = Math.max(0, Math.min(255, (e.clientX - rect.left) / rect.width * 255));
    const y = Math.max(0, Math.min(255, 255 - (e.clientY - rect.top) / rect.height * 255));
    return { x, y };
  };

  const handlePointMouseDown = (e, index) => {
    e.preventDefault();
    setLocalPoints(points);
    setDraggingPointIndex(index);
  };

  const handleMouseMove = (e) => {
    if (draggingPointIndex === null) return;
    
    let { x, y } = getMousePos(e);

    const newPoints = [...points];
    const isEndPoint = draggingPointIndex === 0 || draggingPointIndex === points.length - 1;

    if (isEndPoint) {
      x = newPoints[draggingPointIndex].x;
    } else {
      const prevX = points[draggingPointIndex - 1].x;
      const nextX = points[draggingPointIndex + 1].x;
      x = Math.max(prevX + 1, Math.min(nextX - 1, x));
    }

    newPoints[draggingPointIndex] = { x, y };

    setLocalPoints(newPoints);

    setAdjustments(prev => ({
      ...prev,
      curves: { ...prev.curves, [activeChannel]: newPoints }
    }));
  };

  const handleMouseUp = () => {
    setDraggingPointIndex(null);
  };

  const handleContainerMouseDown = (e) => {
    if (e.button !== 0) return;

    if (e.target.tagName === 'circle') return;

    const { x, y } = getMousePos(e);
    
    const newPoints = [...points, { x, y }]
      .sort((a, b) => a.x - b.x);

    const newPointIndex = newPoints.findIndex(p => p.x === x && p.y === y);

    setLocalPoints(newPoints);
    setAdjustments(prev => ({
      ...prev,
      curves: { ...prev.curves, [activeChannel]: newPoints }
    }));

    setDraggingPointIndex(newPointIndex);
  };

  const handlePointContextMenu = (e, index) => {
    e.preventDefault();
    if (index === 0 || index === points.length - 1) return;

    const newPoints = points.filter((_, i) => i !== index);

    setLocalPoints(newPoints);
    setAdjustments(prev => ({
      ...prev,
      curves: { ...prev.curves, [activeChannel]: newPoints }
    }));
  };

  const handleDoubleClick = () => {
    const defaultPoints = [{ x: 0, y: 0 }, { x: 255, y: 255 }];

    setLocalPoints(defaultPoints);
    setAdjustments(prev => ({
      ...prev,
      curves: { ...prev.curves, [activeChannel]: defaultPoints }
    }));
  };

  useEffect(() => {
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [draggingPointIndex, points, activeChannel, setAdjustments]);

  return (
    <div className="select-none">
      <div className="flex items-center justify-start gap-1 mb-2 mt-2">
        {Object.keys(channelConfig).map(channel => (
          <button
            key={channel}
            onClick={() => setActiveChannel(channel)}
            className={`w-7 h-7 rounded-full text-xs font-bold flex items-center justify-center transition-all
              ${activeChannel === channel ? 'ring-2 ring-offset-2 ring-offset-surface ring-accent' : 'bg-surface-secondary'}
              ${channel === 'luma' ? 'text-text-primary' : ''}`}
            style={{ backgroundColor: channel !== 'luma' && activeChannel !== channel ? channelConfig[channel].color + '40' : undefined }}
          >
            {channel.charAt(0).toUpperCase()}
          </button>
        ))}
      </div>

      <div 
        className="w-full aspect-square bg-surface-secondary p-1 rounded-md relative" 
        onMouseDown={handleContainerMouseDown}
        onDoubleClick={handleDoubleClick}
      >
        <svg ref={svgRef} viewBox="0 0 255 255" className="w-full h-full overflow-visible">
          <path d="M 63.75,0 V 255 M 127.5,0 V 255 M 191.25,0 V 255 M 0,63.75 H 255 M 0,127.5 H 255 M 0,191.25 H 255" stroke="rgba(255,255,255,0.1)" strokeWidth="0.5" />
          
          {histogramData && (
            <path d={getHistogramPath(histogramData)} fill={color} opacity={histogramOpacity} />
          )}

          <line x1="0" y1="255" x2="255" y2="0" stroke="rgba(255,255,255,0.2)" strokeWidth="1" strokeDasharray="2 2" />

          <path d={getCurvePath(points)} fill="none" stroke={color} strokeWidth="2.5" />

          {points.map((p, i) => (
            <circle
              key={i}
              cx={p.x}
              cy={255 - p.y}
              r="6"
              fill={color}
              stroke="#1e1e1e"
              strokeWidth="2"
              className="cursor-pointer"
              onMouseDown={(e) => handlePointMouseDown(e, i)}
              onContextMenu={(e) => handlePointContextMenu(e, i)}
            />
          ))}
        </svg>
      </div>
    </div>
  );
}