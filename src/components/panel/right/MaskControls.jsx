import { useState, useEffect, useRef } from 'react';
import { RotateCcw, Copy, ClipboardPaste } from 'lucide-react';
import CollapsibleSection from '../../ui/CollapsibleSection';
import Switch from '../../ui/Switch';
import Slider from '../../ui/Slider';

import BasicAdjustments from '../../adjustments/Basic';
import CurveGraph from '../../adjustments/Curves';
import ColorPanel from '../../adjustments/Color';
import DetailsPanel from '../../adjustments/Details';
import EffectsPanel from '../../adjustments/Effects';

import { INITIAL_MASK_ADJUSTMENTS, ADJUSTMENT_SECTIONS } from '../../../App';
import { useContextMenu } from '../../../context/ContextMenuContext';

const MASK_TYPE_CONFIG = {
  radial: {
    parameters: [
      { key: 'feather', label: 'Feather', min: 0, max: 100, step: 1, multiplier: 100 },
    ],
  },
  brush: { showBrushTools: true },
  linear: { parameters: [] },
  color: { parameters: [] },
  luminance: { parameters: [] },
  'ai-subject': { parameters: [] },
  'ai-foreground': { parameters: [] },
};

const BrushTools = ({ settings, onSettingsChange }) => (
  <div className="space-y-4 pt-4 border-t border-surface mt-4">
    <Slider label="Brush Size" value={settings.size} onChange={(e) => onSettingsChange(s => ({ ...s, size: Number(e.target.value) }))} min="1" max="200" step="1" />
    <Slider label="Brush Feather" value={settings.feather} onChange={(e) => onSettingsChange(s => ({ ...s, feather: Number(e.target.value) }))} min="0" max="100" step="1" />
    <div className="grid grid-cols-2 gap-2 pt-2">
      <button onClick={() => onSettingsChange(s => ({ ...s, tool: 'brush' }))} className={`p-2 rounded-md text-sm font-medium transition-colors flex items-center justify-center gap-2 ${settings.tool === 'brush' ? 'text-primary bg-surface' : 'bg-surface text-text-secondary hover:bg-card-active'}`}>Brush</button>
      <button onClick={() => onSettingsChange(s => ({ ...s, tool: 'eraser' }))} className={`p-2 rounded-md text-sm font-medium transition-colors flex items-center justify-center gap-2 ${settings.tool === 'eraser' ? 'text-primary bg-surface' : 'bg-surface text-text-secondary hover:bg-card-active'}`}>Eraser</button>
    </div>
  </div>
);

export default function MaskControls({ editingMask, updateMask, brushSettings, setBrushSettings, histogram, isGeneratingAiMask, aiModelDownloadStatus }) {
  const { showContextMenu } = useContextMenu();
  const [isSettingsSectionOpen, setSettingsSectionOpen] = useState(true);
  const [copiedSectionAdjustments, setCopiedSectionAdjustments] = useState(null);
  const [collapsibleState, setCollapsibleState] = useState({
    basic: true,
    curves: false,
    color: false,
    details: false,
    effects: false,
  });
  const [showAnalyzingMessage, setShowAnalyzingMessage] = useState(false);
  const analyzingTimeoutRef = useRef(null);

  useEffect(() => {
    if (isGeneratingAiMask) {
      analyzingTimeoutRef.current = setTimeout(() => {
        setShowAnalyzingMessage(true);
      }, 1000);
    } else {
      if (analyzingTimeoutRef.current) {
        clearTimeout(analyzingTimeoutRef.current);
      }
      setShowAnalyzingMessage(false);
    }

    return () => {
      if (analyzingTimeoutRef.current) {
        clearTimeout(analyzingTimeoutRef.current);
      }
    };
  }, [isGeneratingAiMask]);

  if (!editingMask) return null;

  const maskConfig = MASK_TYPE_CONFIG[editingMask.type] || {};

  const setMaskAdjustments = (updater) => {
    const currentAdjustments = editingMask.adjustments;
    const newAdjustments = typeof updater === 'function' ? updater(currentAdjustments) : updater;
    updateMask(editingMask.id, { ...editingMask, adjustments: newAdjustments });
  };

  const handleToggleSection = (section) => {
    setCollapsibleState(prev => ({ ...prev, [section]: !prev[section] }));
  };

  const handleParameterChange = (key, value) => {
    updateMask(editingMask.id, { ...editingMask, parameters: { ...editingMask.parameters, [key]: value } });
  };

  const handleMaskPropertyChange = (key, value) => {
    updateMask(editingMask.id, { ...editingMask, [key]: value });
  };

  const handleSectionContextMenu = (event, sectionName) => {
    event.preventDefault();
    event.stopPropagation();

    const sectionKeys = ADJUSTMENT_SECTIONS[sectionName];
    if (!sectionKeys) return;

    const handleCopy = () => {
      const adjustmentsToCopy = {};
      for (const key of sectionKeys) {
        if (editingMask.adjustments.hasOwnProperty(key)) {
          adjustmentsToCopy[key] = JSON.parse(JSON.stringify(editingMask.adjustments[key]));
        }
      }
      setCopiedSectionAdjustments({ section: sectionName, values: adjustmentsToCopy });
    };

    const handlePaste = () => {
      if (!copiedSectionAdjustments || copiedSectionAdjustments.section !== sectionName) return;
      setMaskAdjustments(prev => ({ ...prev, ...copiedSectionAdjustments.values }));
    };

    const handleReset = () => {
      const resetValues = {};
      for (const key of sectionKeys) {
        resetValues[key] = JSON.parse(JSON.stringify(INITIAL_MASK_ADJUSTMENTS[key]));
      }
      setMaskAdjustments(prev => ({ ...prev, ...resetValues }));
    };

    const isPasteAllowed = copiedSectionAdjustments && copiedSectionAdjustments.section === sectionName;
    const pasteLabel = copiedSectionAdjustments ? `Paste ${copiedSectionAdjustments.section.charAt(0).toUpperCase() + copiedSectionAdjustments.section.slice(1)} Settings` : 'Paste Settings';

    const options = [
      { label: `Copy ${sectionName.charAt(0).toUpperCase() + sectionName.slice(1)} Settings`, icon: Copy, onClick: handleCopy },
      { label: pasteLabel, icon: ClipboardPaste, onClick: handlePaste, disabled: !isPasteAllowed },
      { type: 'separator' },
      { label: `Reset ${sectionName.charAt(0).toUpperCase() + sectionName.slice(1)} Settings`, icon: RotateCcw, onClick: handleReset },
    ];

    showContextMenu(event.clientX, event.clientY, options);
  };

  const isAiMask = editingMask.type === 'ai-subject' || editingMask.type === 'ai-foreground';

  return (
    <div className="flex-grow overflow-y-auto p-4 flex flex-col gap-2">
      <CollapsibleSection title="Mask Settings" isOpen={isSettingsSectionOpen} onToggle={() => setSettingsSectionOpen(prev => !prev)}>
        <div className="space-y-4">
          {isAiMask && (
            <>
              {aiModelDownloadStatus && (
                <div className="text-sm text-text-secondary p-2 bg-surface rounded-md text-center">
                  Downloading AI Model ({aiModelDownloadStatus})...
                </div>
              )}
              {showAnalyzingMessage && !aiModelDownloadStatus && (
                <div className="text-sm text-text-secondary p-2 bg-surface rounded-md text-center animate-pulse">
                  Analyzing Image...
                </div>
              )}
            </>
          )}
          <Switch label="Invert Mask" checked={!!editingMask.invert} onChange={(checked) => handleMaskPropertyChange('invert', checked)} />
          {maskConfig.parameters?.map(param => (
            <Slider key={param.key} label={param.label} value={(editingMask.parameters[param.key] || 0) * (param.multiplier || 1)} onChange={(e) => handleParameterChange(param.key, parseFloat(e.target.value) / (param.multiplier || 1))} min={param.min} max={param.max} step={param.step} />
          ))}
          {maskConfig.showBrushTools && brushSettings && setBrushSettings && (
            <BrushTools settings={brushSettings} onSettingsChange={setBrushSettings} />
          )}
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="Basic" isOpen={collapsibleState.basic} onToggle={() => handleToggleSection('basic')} onContextMenu={(e) => handleSectionContextMenu(e, 'basic')}>
        <BasicAdjustments adjustments={editingMask.adjustments} setAdjustments={setMaskAdjustments} />
      </CollapsibleSection>

      <CollapsibleSection title="Curves" isOpen={collapsibleState.curves} onToggle={() => handleToggleSection('curves')} onContextMenu={(e) => handleSectionContextMenu(e, 'curves')}>
        <CurveGraph adjustments={editingMask.adjustments} setAdjustments={setMaskAdjustments} histogram={histogram} />
      </CollapsibleSection>

      <CollapsibleSection title="Color" isOpen={collapsibleState.color} onToggle={() => handleToggleSection('color')} onContextMenu={(e) => handleSectionContextMenu(e, 'color')}>
        <ColorPanel adjustments={editingMask.adjustments} setAdjustments={setMaskAdjustments} />
      </CollapsibleSection>

      <CollapsibleSection title="Details" isOpen={collapsibleState.details} onToggle={() => handleToggleSection('details')} onContextMenu={(e) => handleSectionContextMenu(e, 'details')}>
        <DetailsPanel adjustments={editingMask.adjustments} setAdjustments={setMaskAdjustments} />
      </CollapsibleSection>

      <CollapsibleSection title="Effects" isOpen={collapsibleState.effects} onToggle={() => handleToggleSection('effects')} onContextMenu={(e) => handleSectionContextMenu(e, 'effects')}>
        <EffectsPanel adjustments={editingMask.adjustments} setAdjustments={setMaskAdjustments} isForMask={true} />
      </CollapsibleSection>
    </div>
  );
}