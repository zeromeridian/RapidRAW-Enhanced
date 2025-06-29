import { RotateCcw, X, RectangleHorizontal, RectangleVertical, FlipHorizontal, FlipVertical } from 'lucide-react';
import { useState, useEffect, useCallback } from 'react';
import { INITIAL_ADJUSTMENTS } from '../../../App';

const PRESETS = [
  { name: 'Free', value: null },
  { name: 'Original', value: 'original' },
  { name: '1:1', value: 1 },
  { name: '5:4', value: 5 / 4 },
  { name: '4:3', value: 4 / 3 },
  { name: '3:2', value: 3 / 2 },
  { name: '16:9', value: 16 / 9 },
];

const doesRatioMatchPreset = (ratio, preset, originalImage) => {
  if (preset.value === null && ratio === null) return true;

  let presetBaseRatio = preset.value;
  if (preset.value === 'original') {
    presetBaseRatio = originalImage?.width && originalImage?.height
      ? originalImage.width / originalImage.height
      : null;
  }

  if (!presetBaseRatio || !ratio) return presetBaseRatio === ratio;

  return Math.abs(ratio - presetBaseRatio) < 0.001 || Math.abs(ratio - (1 / presetBaseRatio)) < 0.001;
};


export default function CropPanel({ selectedImage, adjustments, setAdjustments }) {
  const [customW, setCustomW] = useState('');
  const [customH, setCustomH] = useState('');

  const { aspectRatio, rotation = 0, flipHorizontal = false, flipVertical = false } = adjustments;
  const activePreset = PRESETS.find(p => doesRatioMatchPreset(aspectRatio, p, selectedImage));

  let orientation = 'horizontal';
  if (activePreset && activePreset.value && activePreset.value !== 1) {
    let baseRatio = activePreset.value;
    if (activePreset.value === 'original') {
      baseRatio = selectedImage?.width && selectedImage?.height ? selectedImage.width / selectedImage.height : null;
    }
    if (baseRatio && Math.abs(aspectRatio - baseRatio) > 0.001) {
      orientation = 'vertical';
    }
  }

  const isCustomActive = aspectRatio !== null && !activePreset;

  useEffect(() => {
    if (isCustomActive && aspectRatio) {
      const w = Math.abs(aspectRatio * 100).toFixed(1);
      const h = (100).toFixed(1);
      setCustomW(w);
      setCustomH(h);
    } else {
      setCustomW('');
      setCustomH('');
    }
  }, [isCustomActive, aspectRatio]);

  const handleCustomInputChange = (w, h) => {
    setCustomW(w);
    setCustomH(h);
    const numW = parseFloat(w);
    const numH = parseFloat(h);
    if (numW > 0 && numH > 0) {
      const newAspectRatio = numW / numH;
      if (aspectRatio !== newAspectRatio) {
        setAdjustments(prev => ({ ...prev, aspectRatio: newAspectRatio, crop: null }));
      }
    }
  };

  const handlePresetClick = (preset) => {
    let baseRatio = preset.value;
    if (preset.value === 'original') {
      baseRatio = selectedImage?.width && selectedImage?.height
        ? selectedImage.width / selectedImage.height
        : null;
    }

    let newAspectRatio = baseRatio;
    if (baseRatio && baseRatio !== 1 && orientation === 'vertical') {
      newAspectRatio = 1 / baseRatio;
    }

    setAdjustments(prev => ({ ...prev, aspectRatio: newAspectRatio, crop: null }));
  };

  const handleOrientationToggle = useCallback(() => {
    if (aspectRatio && aspectRatio !== 1) {
      setAdjustments(prev => ({
        ...prev,
        aspectRatio: 1 / prev.aspectRatio,
        crop: null
      }));
    }
  }, [aspectRatio, setAdjustments]);

  const handleReset = () => {
    setAdjustments(prev => ({
      ...prev,
      crop: INITIAL_ADJUSTMENTS.crop,
      aspectRatio: INITIAL_ADJUSTMENTS.aspectRatio,
      rotation: INITIAL_ADJUSTMENTS.rotation || 0,
      flipHorizontal: INITIAL_ADJUSTMENTS.flipHorizontal || false,
      flipVertical: INITIAL_ADJUSTMENTS.flipVertical || false,
    }));
  };

  const isPresetActive = (preset) => {
    return preset === activePreset;
  };

  const isOrientationToggleDisabled = !aspectRatio || aspectRatio === 1;

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 flex justify-between items-center flex-shrink-0 border-b border-surface">
        <h2 className="text-xl font-bold text-primary text-shadow-shiny">Crop & Transform</h2>
        <button
          onClick={handleReset}
          className="p-2 rounded-full hover:bg-surface transition-colors"
          title="Reset All"
        >
          <RotateCcw size={18} />
        </button>
      </div>

      <div className="flex-grow overflow-y-auto p-4 text-text-secondary space-y-6">
        {selectedImage ? (
          <>
            <div>
              <div className="flex justify-between items-center mb-3">
                <p className="text-sm font-semibold text-text-primary">Aspect Ratio</p>
                <button
                  onClick={handleOrientationToggle}
                  className="p-1.5 rounded-md hover:bg-surface disabled:text-text-tertiary disabled:cursor-not-allowed"
                  title="Switch Orientation"
                  disabled={isOrientationToggleDisabled}
                >
                  {orientation === 'vertical' ? <RectangleVertical size={16} /> : <RectangleHorizontal size={16} />}
                </button>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {PRESETS.map(preset => (
                  <button
                    key={preset.name}
                    onClick={() => handlePresetClick(preset)}
                    className={`px-2 py-1.5 text-sm rounded-md transition-colors ${
                      isPresetActive(preset)
                        ? 'bg-surface text-text-primary'
                        : 'bg-surface hover:bg-card-active'
                    }`}
                  >
                    {preset.name}
                  </button>
                ))}
              </div>
              <div className="mt-3">
                <button
                  onClick={() => {
                    const baseRatio = 1.618;
                    const newAspectRatio = orientation === 'vertical' ? 1 / baseRatio : baseRatio;
                    setAdjustments(prev => ({ ...prev, aspectRatio: newAspectRatio, crop: null }))
                  }}
                  className={`w-full px-2 py-1.5 text-sm rounded-md transition-colors ${
                    isCustomActive
                      ? 'bg-surface text-white'
                      : 'bg-surface hover:bg-card-active'
                  }`}
                >
                  Custom
                </button>
                <div className={`mt-2 bg-surface p-2 rounded-md transition-opacity ${isCustomActive ? 'opacity-100' : 'opacity-50'}`}>
                  <div className="flex items-center justify-center gap-2">
                    <input
                      type="number"
                      placeholder="W"
                      value={customW}
                      onChange={(e) => handleCustomInputChange(e.target.value, customH)}
                      className="w-full bg-bg-primary text-center rounded-md p-1 border border-surface focus:border-accent focus:ring-accent disabled:bg-bg-secondary"
                      min="1"
                      disabled={!isCustomActive}
                    />
                    <X size={16} className="text-text-tertiary flex-shrink-0" />
                    <input
                      type="number"
                      placeholder="H"
                      value={customH}
                      onChange={(e) => handleCustomInputChange(customW, e.target.value)}
                      className="w-full bg-bg-primary text-center rounded-md p-1 border border-surface focus:border-accent focus:ring-accent disabled:bg-bg-secondary"
                      min="1"
                      disabled={!isCustomActive}
                    />
                  </div>
                </div>
              </div>
            </div>

            <div>
              <p className="text-sm mb-3 font-semibold text-text-primary">Transform</p>
              <div className="space-y-4">
                {/* Rotation Slider */}
                <div className="flex items-center gap-2">
                  <label className="text-sm w-20">Rotation</label>
                  <input
                    type="range"
                    min="-45"
                    max="45"
                    step="0.1"
                    value={rotation}
                    onChange={(e) => setAdjustments(prev => ({ ...prev, rotation: parseFloat(e.target.value) }))}
                    className="w-full h-1 bg-surface rounded-lg appearance-none cursor-pointer accent-accent"
                  />
                  <span className="text-sm font-mono w-12 text-right">{rotation.toFixed(1)}°</span>
                  <button onClick={() => setAdjustments(prev => ({ ...prev, rotation: 0 }))} title="Reset Rotation">
                    <RotateCcw size={14} className="hover:text-white" />
                  </button>
                </div>
                {/* Flip Buttons */}
                <div className="flex items-center gap-2">
                  <label className="text-sm w-20">Flip</label>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setAdjustments(prev => ({ ...prev, flipHorizontal: !prev.flipHorizontal }))}
                      className={`p-2 rounded-md transition-colors ${flipHorizontal ? 'bg-surface text-white' : 'bg-surface hover:bg-card-active'}`}
                      title="Flip Horizontal"
                    >
                      <FlipHorizontal size={18} />
                    </button>
                    <button
                      onClick={() => setAdjustments(prev => ({ ...prev, flipVertical: !prev.flipVertical }))}
                      className={`p-2 rounded-md transition-colors ${flipVertical ? 'bg-surface text-white' : 'bg-surface hover:bg-card-active'}`}
                      title="Flip Vertical"
                    >
                      <FlipVertical size={18} />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </>
        ) : (
          <p className="text-center text-text-tertiary mt-4">No image selected.</p>
        )}
      </div>
    </div>
  );
}