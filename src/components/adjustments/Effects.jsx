import Slider from '../ui/Slider';

export default function EffectsPanel({ adjustments, setAdjustments, isForMask = false }) {
  const handleAdjustmentChange = (key, value) => {
    const numericValue = parseInt(value, 10);
    setAdjustments(prev => ({ ...prev, [key]: numericValue }));
  };

  return (
    <div>
      <div className="mb-4 p-2 bg-bg-tertiary rounded-md">
        <p className="text-md font-semibold mb-2 text-primary">Presence</p>
        <Slider
          label="Clarity"
          value={adjustments.clarity}
          onChange={(e) => handleAdjustmentChange('clarity', e.target.value)}
          min="-100" max="100" step="1"
        />
        <Slider
          label="Dehaze"
          value={adjustments.dehaze}
          onChange={(e) => handleAdjustmentChange('dehaze', e.target.value)}
          min="-100" max="100" step="1"
        />
         <Slider
          label="Structure"
          value={adjustments.structure}
          onChange={(e) => handleAdjustmentChange('structure', e.target.value)}
          min="-100" max="100" step="1"
        />
      </div>

      {!isForMask && (
        <>
          <div className="mb-4 p-2 bg-bg-tertiary rounded-md">
            <p className="text-md font-semibold mb-2 text-primary">Vignette</p>
            <Slider
              label="Amount"
              value={adjustments.vignetteAmount}
              onChange={(e) => handleAdjustmentChange('vignetteAmount', e.target.value)}
              min="-100" max="100" step="1"
            />
            <Slider
              label="Midpoint"
              value={adjustments.vignetteMidpoint}
              onChange={(e) => handleAdjustmentChange('vignetteMidpoint', e.target.value)}
              min="0" max="100" step="1" defaultValue="50"
            />
            <Slider
              label="Roundness"
              value={adjustments.vignetteRoundness}
              onChange={(e) => handleAdjustmentChange('vignetteRoundness', e.target.value)}
              min="-100" max="100" step="1"
            />
            <Slider
              label="Feather"
              value={adjustments.vignetteFeather}
              onChange={(e) => handleAdjustmentChange('vignetteFeather', e.target.value)}
              min="0" max="100" step="1" defaultValue="50"
            />
          </div>

          <div className="p-2 bg-bg-tertiary rounded-md">
            <p className="text-md font-semibold mb-2 text-primary">Grain</p>
            <Slider
              label="Amount"
              value={adjustments.grainAmount}
              onChange={(e) => handleAdjustmentChange('grainAmount', e.target.value)}
              min="0" max="100" step="1"
            />
            <Slider
              label="Size"
              value={adjustments.grainSize}
              onChange={(e) => handleAdjustmentChange('grainSize', e.target.value)}
              min="0" max="100" step="1" defaultValue="25"
            />
            <Slider
              label="Roughness"
              value={adjustments.grainRoughness}
              onChange={(e) => handleAdjustmentChange('grainRoughness', e.target.value)}
              min="0" max="100" step="1" defaultValue="50"
            />
          </div>
        </>
      )}
    </div>
  );
};