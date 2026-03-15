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

const FakeWaveformLoader = ({ mode }: { mode: string }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lastTimeRef = useRef<number>(0);
  const spawnAccumulatorRef = useRef<number>(0);

  const MAX_PARTICLES = 15000;
  const particles = useRef(
    Array.from({ length: MAX_PARTICLES }, () => ({
      x: 0,
      y: 0,
      targetX: 0,
      targetY: 0,
      life: 0,
      maxLife: 1,
      r: 255,
      g: 255,
      b: 255,
      active: false,
    })),
  ).current;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    const WIDTH = 256;
    const HEIGHT = 256;
    canvas.width = WIDTH;
    canvas.height = HEIGHT;

    particles.forEach((p) => (p.active = false));
    lastTimeRef.current = 0;
    spawnAccumulatorRef.current = 0;
    let isPrewarmed = false;

    const imgData = ctx.createImageData(WIDTH, HEIGHT);
    const data = imgData.data;

    const gridBuffer = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
    if (mode === DisplayMode.Vectorscope) {
      for (let py = 0; py < HEIGHT; py++) {
        for (let px = 0; px < WIDTH; px++) {
          const dx = px - 128.0;
          const dy = 128.0 - py;
          const min_d = Math.min(Math.abs(dx), Math.abs(dy));
          const dist = Math.sqrt(dx * dx + dy * dy);
          const off = (py * WIDTH + px) * 4;

          if (min_d <= 1.0) {
            const alpha = Math.max(0, 40.0 - min_d * 30.0);
            gridBuffer[off] = 255;
            gridBuffer[off + 1] = 255;
            gridBuffer[off + 2] = 255;
            gridBuffer[off + 3] = alpha;
          } else if (Math.abs(dist - 127.0) < 0.8 || Math.abs(dist - 64.0) < 0.8) {
            gridBuffer[off] = 255;
            gridBuffer[off + 1] = 255;
            gridBuffer[off + 2] = 255;
            gridBuffer[off + 3] = 15;
          } else if (dx < 0.0 && dy > 0.0 && Math.abs(dy + 1.53 * dx) < 1.0) {
            gridBuffer[off] = 255;
            gridBuffer[off + 1] = 200;
            gridBuffer[off + 2] = 150;
            gridBuffer[off + 3] = 120;
          }
        }
      }
    }

    let animationFrameId: number;

    const render = (time: number) => {
      if (lastTimeRef.current === 0) lastTimeRef.current = time;
      let dt = (time - lastTimeRef.current) / 1000;
      lastTimeRef.current = time;

      if (dt > 0.05) dt = 0.05;

      let frameDt = dt;

      if (!isPrewarmed) {
        frameDt = 0.25;
        isPrewarmed = true;
      }

      data.set(gridBuffer);

      const SPAWN_RATE = 1000;
      spawnAccumulatorRef.current += SPAWN_RATE * frameDt;

      const dotsToSpawn = Math.floor(spawnAccumulatorRef.current);
      if (dotsToSpawn > 0) {
        spawnAccumulatorRef.current -= dotsToSpawn;
        let spawnedCount = 0;

        for (let i = 0; i < MAX_PARTICLES && spawnedCount < dotsToSpawn; i++) {
          const p = particles[i];
          if (!p.active) {
            p.active = true;

            if (mode === DisplayMode.Vectorscope) {
            } else {
              p.x = Math.random() * WIDTH;
              p.targetX = p.x;

              p.y = HEIGHT - Math.random() * 2;

              const isPot = Math.random() < 0.4;

              if (isPot) {
                p.targetY = HEIGHT - Math.random() * 6;
              } else {
                const randomCurve = Math.pow(Math.random(), 1.2);
                p.targetY = HEIGHT - randomCurve * HEIGHT;
              }

              if (mode === DisplayMode.Parade) {
                const section = Math.floor((p.x / WIDTH) * 3);
                if (section === 0) {
                  p.r = 255;
                  p.g = 70;
                  p.b = 70;
                } else if (section === 1) {
                  p.r = 70;
                  p.g = 255;
                  p.b = 70;
                } else {
                  p.r = 70;
                  p.g = 150;
                  p.b = 255;
                }
              } else if (mode === DisplayMode.Rgb) {
                const rand = Math.random();
                if (rand > 0.85) {
                  p.r = 255;
                  p.g = 80;
                  p.b = 80;
                } else if (rand > 0.7) {
                  p.r = 80;
                  p.g = 255;
                  p.b = 80;
                } else if (rand > 0.55) {
                  p.r = 80;
                  p.g = 150;
                  p.b = 255;
                } else {
                  p.r = 255;
                  p.g = 255;
                  p.b = 255;
                }
              } else {
                p.r = 255;
                p.g = 255;
                p.b = 255;
              }
            }

            const life = Math.random() * 5.0 + 8.0;
            p.life = life;
            p.maxLife = life;

            spawnedCount++;
          }
        }
      }

      const speedMultiplier = 1;
      const interpolation = 1 - Math.exp(-speedMultiplier * frameDt);

      for (let i = 0; i < MAX_PARTICLES; i++) {
        const p = particles[i];
        if (p.active) {
          p.life -= frameDt;

          if (p.life <= 0) {
            p.active = false;
            continue;
          }

          p.x += (p.targetX - p.x) * interpolation;
          p.y += (p.targetY - p.y) * interpolation;

          const lifeRatio = p.life / p.maxLife;

          let opacity = 1.0;
          if (lifeRatio > 0.8) {
            opacity = (1 - lifeRatio) / 0.12;
          } else if (lifeRatio < 0.2) {
            opacity = lifeRatio / 0.2;
          }

          const alpha = opacity * 0.18;

          const px = Math.floor(p.x);
          const py = Math.floor(p.y);

          for (let dy = 0; dy < 3; dy++) {
            for (let dx = 0; dx < 1.5; dx++) {
              const cx = px + dx;
              const cy = py + dy;

              if (cx >= 0 && cx < WIDTH && cy >= 0 && cy < HEIGHT) {
                const idx = (cy * WIDTH + cx) * 4;
                data[idx] = Math.min(255, data[idx] + p.r * alpha);
                data[idx + 1] = Math.min(255, data[idx + 1] + p.g * alpha);
                data[idx + 2] = Math.min(255, data[idx + 2] + p.b * alpha);
                data[idx + 3] = Math.min(255, data[idx + 3] + alpha * 255);
              }
            }
          }
        }
      }

      ctx.putImageData(imgData, 0, 0);
      animationFrameId = requestAnimationFrame(render);
    };

    animationFrameId = requestAnimationFrame(render);

    return () => cancelAnimationFrame(animationFrameId);
  }, [mode, particles]);

  return <canvas ref={canvasRef} className="w-full h-full" />;
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
        [DisplayMode.Parade]: waveformData.parade,
        [DisplayMode.Vectorscope]: waveformData.vectorscope,
      }[displayMode as DisplayMode]
    : '';

  useRawRgbaCanvas(canvasRef, activeData || '', width, height);

  const baseButtonClass =
    'relative flex-grow text-center px-1.5 py-1 text-xs rounded-lg font-medium transition-colors duration-150';
  const inactiveButtonClass = 'text-text-primary hover:bg-bg-tertiary';

  const isLoaderMode = [DisplayMode.Luma, DisplayMode.Rgb, DisplayMode.Parade, DisplayMode.Vectorscope].includes(
    displayMode as DisplayMode,
  );

  const isVectorscope = displayMode === DisplayMode.Vectorscope;

  return (
    <div
      className="relative w-full h-full bg-surface rounded-lg overflow-hidden border-border-color shadow-inner"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <AnimatePresence initial={!hadDataOnMount.current} mode="sync">
        {waveformData ? (
          <motion.div
            key="waveform-canvas"
            initial={{ opacity: 0, ...(isVectorscope ? {} : { scaleY: 0 }) }}
            animate={{ opacity: 1, ...(isVectorscope ? {} : { scaleY: 1 }) }}
            exit={{ opacity: 0, ...(isVectorscope ? {} : { scaleY: 0 }) }}
            transition={{
              duration: 0.5,
              ease: [0.22, 1, 0.36, 1],
              opacity: { duration: 0.4 },
            }}
            style={{ transformOrigin: 'bottom' }}
            className="absolute inset-0 z-10"
          >
            <canvas ref={canvasRef} width={width} height={height} className="w-full h-full" />
          </motion.div>
        ) : isLoaderMode ? (
          <motion.div
            key="waveform-loader"
            initial={{ opacity: 0 }}
            animate={{
              opacity: 1,
              transition: { duration: 0.6, ease: 'easeOut' },
            }}
            exit={{
              opacity: 0,
              transition: { duration: 0.2, ease: 'easeIn' },
            }}
            className="absolute inset-0 pointer-events-none z-0"
          >
            <FakeWaveformLoader mode={displayMode} />
          </motion.div>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {isHovered && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            className="absolute inset-x-0 bottom-0 p-2 pt-6 bg-gradient-to-t from-black/80 to-transparent flex justify-center z-20"
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
