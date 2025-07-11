import { useState, useEffect, useRef } from 'react';
import Draggable from 'react-draggable';
import { X, Waves } from 'lucide-react';
import { motion } from 'framer-motion';

const LumaWaveformDisplay = ({ data, width, height, maxVal, color }) => {
  const canvasRef = useRef(null);

  useEffect(() => {
    if (!data || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, width, height);

    const imageData = ctx.createImageData(width, height);
    const pixels = imageData.data;

    const scale = maxVal > 0 ? 255 / Math.log(1 + maxVal) : 0;

    for (let i = 0; i < data.length; i++) {
      if (data[i] > 0) {
        const intensity = Math.log(1 + data[i]) * scale;
        const pixelIndex = i * 4;
        
        pixels[pixelIndex] = color[0];
        pixels[pixelIndex + 1] = color[1];
        pixels[pixelIndex + 2] = color[2];
        pixels[pixelIndex + 3] = intensity;
      }
    }
    ctx.putImageData(imageData, 0, 0);
  }, [data, width, height, maxVal, color]);

  return <canvas ref={canvasRef} width={width} height={height} className="absolute inset-0" />;
};

const RgbWaveformDisplay = ({ redData, greenData, blueData, width, height, maxVals }) => {
  const canvasRef = useRef(null);

  useEffect(() => {
    if (!redData || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, width, height);

    const imageData = ctx.createImageData(width, height);
    const pixels = imageData.data;

    const scaleR = maxVals.red > 0 ? 255 / Math.log(1 + maxVals.red) : 0;
    const scaleG = maxVals.green > 0 ? 255 / Math.log(1 + maxVals.green) : 0;
    const scaleB = maxVals.blue > 0 ? 255 / Math.log(1 + maxVals.blue) : 0;

    for (let i = 0; i < redData.length; i++) {
      const pixelIndex = i * 4;
      const r = redData[i] > 0 ? Math.log(1 + redData[i]) * scaleR : 0;
      const g = greenData[i] > 0 ? Math.log(1 + greenData[i]) * scaleG : 0;
      const b = blueData[i] > 0 ? Math.log(1 + blueData[i]) * scaleB : 0;

      pixels[pixelIndex] = r;
      pixels[pixelIndex + 1] = g;
      pixels[pixelIndex + 2] = b;
      pixels[pixelIndex + 3] = Math.max(r, g, b);
    }
    ctx.putImageData(imageData, 0, 0);
  }, [redData, greenData, blueData, width, height, maxVals]);

  return <canvas ref={canvasRef} width={width} height={height} className="absolute inset-0" />;
};

export default function Waveform({ waveformData, onClose }) {
  const [displayMode, setDisplayMode] = useState('rgb');
  const nodeRef = useRef(null);

  const { red, green, blue, luma, width, height } = waveformData || {};

  const maxVals = waveformData ? {
    luma: Math.max(...luma),
    red: Math.max(...red),
    green: Math.max(...green),
    blue: Math.max(...blue),
  } : {};

  const baseButtonClass = "flex-grow text-center px-2 py-1 text-xs rounded font-medium transition-colors duration-150";
  const inactiveButtonClass = "text-text-secondary hover:bg-bg-tertiary";

  return (
    <Draggable nodeRef={nodeRef} handle=".handle" bounds="parent">
      <div
        ref={nodeRef}
        className="absolute top-20 left-20 w-[280px] z-50"
      >
        <motion.div
          key="waveform-content"
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className="bg-bg-secondary/80 backdrop-blur-sm rounded-lg shadow-lg text-text-secondary border border-surface/40 overflow-hidden"
          style={{ transformOrigin: 'top left' }}
        >
          <div className="handle flex items-center justify-between p-2 cursor-move">
            <div className="flex items-center gap-2">
              <Waves size={16} className="text-text-secondary" />
              <h3 className="text-sm font-semibold text-text-primary [text-shadow:0_1px_3px_rgba(0,0,0,0.4)]">Waveform</h3>
            </div>
            <button onClick={onClose} className="p-1 rounded-md text-text-secondary hover:bg-surface hover:text-text-primary transition-colors">
              <X size={16} />
            </button>
          </div>
          {waveformData && (
            <div className="p-2 pt-0">
              <div className="relative w-[256px] h-[256px] bg-black/50 rounded">
                {displayMode === 'rgb' && <RgbWaveformDisplay redData={red} greenData={green} blueData={blue} width={width} height={height} maxVals={maxVals} />}
                {displayMode === 'luma' && <LumaWaveformDisplay data={luma} width={width} height={height} maxVal={maxVals.luma} color={[255, 255, 255]} />}
                {displayMode === 'red' && <LumaWaveformDisplay data={red} width={width} height={height} maxVal={maxVals.red} color={[255, 0, 0]} />}
                {displayMode === 'green' && <LumaWaveformDisplay data={green} width={width} height={height} maxVal={maxVals.green} color={[0, 255, 0]} />}
                {displayMode === 'blue' && <LumaWaveformDisplay data={blue} width={width} height={height} maxVal={maxVals.blue} color={[0, 0, 255]} />}
              </div>
              <div className="flex justify-center gap-1 mt-2 p-1 bg-surface rounded-lg">
                <button onClick={() => setDisplayMode('luma')} className={`${baseButtonClass} ${displayMode === 'luma' ? 'bg-accent text-primary' : inactiveButtonClass}`}>Luma</button>
                <button onClick={() => setDisplayMode('rgb')} className={`${baseButtonClass} ${displayMode === 'rgb' ? 'bg-accent text-primary' : inactiveButtonClass}`}>RGB</button>
                <button onClick={() => setDisplayMode('red')} className={`${baseButtonClass} ${displayMode === 'red' ? 'bg-red-500 text-white' : inactiveButtonClass}`}>R</button>
                <button onClick={() => setDisplayMode('green')} className={`${baseButtonClass} ${displayMode === 'green' ? 'bg-green-500 text-white' : inactiveButtonClass}`}>G</button>
                <button onClick={() => setDisplayMode('blue')} className={`${baseButtonClass} ${displayMode === 'blue' ? 'bg-blue-500 text-white' : inactiveButtonClass}`}>B</button>
              </div>
            </div>
          )}
        </motion.div>
      </div>
    </Draggable>
  );
}