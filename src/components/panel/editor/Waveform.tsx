import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence, LayoutGroup } from 'framer-motion';
import { WaveformData } from '../../ui/AppProperties';
import { DisplayMode } from '../../../utils/adjustments';

interface WaveformProps {
  waveformData: WaveformData | null;
  displayMode: string;
  setDisplayMode: (mode: string) => void;
}

const modeButtons = [
  { mode: DisplayMode.Luma, label: 'L', tooltip: 'Luma', bgClass: 'bg-accent', textActiveClass: 'text-button-text' },
  {
    mode: DisplayMode.Rgb,
    label: 'RGB',
    tooltip: 'RGB Overlay',
    bgClass: 'bg-accent',
    textActiveClass: 'text-button-text',
  },
  {
    mode: DisplayMode.Parade,
    label: 'P',
    tooltip: 'Parade',
    bgClass: 'bg-accent',
    textActiveClass: 'text-button-text',
  },
  {
    mode: DisplayMode.Vectorscope,
    label: 'V',
    tooltip: 'Vectorscope',
    bgClass: 'bg-accent',
    textActiveClass: 'text-button-text',
  },
  { mode: DisplayMode.Red, label: 'R', tooltip: 'Red Channel', bgClass: 'bg-red-500', textActiveClass: 'text-white' },
  {
    mode: DisplayMode.Green,
    label: 'G',
    tooltip: 'Green Channel',
    bgClass: 'bg-green-500',
    textActiveClass: 'text-white',
  },
  {
    mode: DisplayMode.Blue,
    label: 'B',
    tooltip: 'Blue Channel',
    bgClass: 'bg-blue-500',
    textActiveClass: 'text-white',
  },
];

const useRawRgbaCanvas = (
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  base64Data: string,
  width: number,
  height: number,
) => {
  useEffect(() => {
    if (!base64Data || !canvasRef.current || !width || !height) return;

    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;

    ctx.imageSmoothingEnabled = false;

    const binary = atob(base64Data);
    const bytes = new Uint8ClampedArray(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }

    const imageData = new ImageData(bytes, width, height);
    ctx.putImageData(imageData, 0, 0);
  }, [base64Data, width, height, canvasRef]);
};

export default function Waveform({ waveformData, displayMode, setDisplayMode }: WaveformProps) {
  const [isHovered, setIsHovered] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hadDataOnMount = useRef(!!waveformData);

  const width = waveformData?.width || 256;
  const height = waveformData?.height || 256;

  const activeData = waveformData
    ? {
        [DisplayMode.Rgb]: waveformData.rgb,
        [DisplayMode.Luma]: waveformData.luma,
        [DisplayMode.Red]: waveformData.red,
        [DisplayMode.Green]: waveformData.green,
        [DisplayMode.Blue]: waveformData.blue,
        [DisplayMode.Parade]: waveformData.parade,
        [DisplayMode.Vectorscope]: waveformData.vectorscope,
      }[displayMode as DisplayMode]
    : '';

  useRawRgbaCanvas(canvasRef, activeData || '', width, height);

  const baseButtonClass =
    'relative flex-grow text-center px-1.5 py-1 text-xs rounded-lg font-medium transition-colors duration-150';
  const inactiveButtonClass = 'text-text-primary hover:bg-bg-tertiary';

  return (
    <div
      className="relative w-full h-full bg-surface rounded-lg overflow-hidden border-border-color shadow-inner"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <AnimatePresence initial={!hadDataOnMount.current}>
        {waveformData && (
          <motion.div
            key="waveform-canvas"
            initial={{ scaleY: 0, opacity: 0 }}
            animate={{
              scaleY: 1,
              opacity: 1,
              transition: {
                scaleY: { duration: 0.5, ease: [0.22, 1, 0.36, 1] },
                opacity: { duration: 0.4 },
              },
            }}
            exit={{
              scaleY: 0,
              opacity: 0,
              transition: {
                scaleY: { duration: 0.3, ease: [0.55, 0, 0.78, 0.34] },
                opacity: { duration: 0.25 },
              },
            }}
            style={{ transformOrigin: 'bottom' }}
            className="absolute inset-0"
          >
            <canvas ref={canvasRef} width={width} height={height} className="w-full h-full" />
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isHovered && waveformData && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            className="absolute inset-x-0 bottom-0 p-2 pt-6 bg-gradient-to-t from-black/80 to-transparent flex justify-center"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.1, ease: 'easeOut', delay: 0.05 }}
              className="flex justify-center gap-0.5 p-1 bg-surface/90 backdrop-blur-md rounded-lg w-full shadow-lg border border-white/5"
            >
              <LayoutGroup>
                {modeButtons.map(({ mode, label, tooltip, bgClass, textActiveClass }) => (
                  <button
                    key={mode}
                    onClick={() => setDisplayMode(mode)}
                    data-tooltip={tooltip}
                    className={`${baseButtonClass} ${displayMode === mode ? textActiveClass : inactiveButtonClass}`}
                  >
                    {displayMode === mode && (
                      <motion.div
                        layoutId="waveform-mode-indicator"
                        className={`absolute inset-0 ${bgClass} rounded-lg`}
                        transition={{ type: 'spring', bounce: 0.2, duration: 0.4 }}
                      />
                    )}
                    <span className="relative z-10">{label}</span>
                  </button>
                ))}
              </LayoutGroup>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
