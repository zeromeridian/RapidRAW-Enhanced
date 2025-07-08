import { useState, useEffect, useRef } from 'react';
import { RotateCcw, Copy, ClipboardPaste } from 'lucide-react';
import BasicAdjustments from '../../adjustments/Basic';
import CurveGraph from '../../adjustments/Curves';
import ColorPanel from '../../adjustments/Color';
import DetailsPanel from '../../adjustments/Details';
import EffectsPanel from '../../adjustments/Effects';
import CollapsibleSection from '../../ui/CollapsibleSection';
import { INITIAL_ADJUSTMENTS, ADJUSTMENT_SECTIONS } from '../../../App';
import { useContextMenu } from '../../../context/ContextMenuContext';

export default function Controls({
  theme,
  adjustments,
  setAdjustments,
  selectedImage,
  histogram,
  collapsibleState,
  setCollapsibleState,
  copiedSectionAdjustments,
  setCopiedSectionAdjustments,
}) {
  const { showContextMenu } = useContextMenu();
  const [sectionVisibility, setSectionVisibility] = useState({
    basic: true,
    curves: true,
    color: true,
    details: true,
    effects: true,
  });
  const [stashedAdjustments, setStashedAdjustments] = useState({});

  const isInitialMount = useRef(true);

  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }

    setSectionVisibility({
      basic: true,
      curves: true,
      color: true,
      details: true,
      effects: true,
    });
    setStashedAdjustments({});

  }, [selectedImage.path]);

  const handleToggleVisibility = (sectionName) => {
    const isCurrentlyVisible = sectionVisibility[sectionName];
    const sectionKeys = ADJUSTMENT_SECTIONS[sectionName];

    if (isCurrentlyVisible) {
      const valuesToStash = {};
      for (const key of sectionKeys) {
        valuesToStash[key] = JSON.parse(JSON.stringify(adjustments[key]));
      }
      setStashedAdjustments(prev => ({ ...prev, [sectionName]: valuesToStash }));

      const resetValues = {};
      for (const key of sectionKeys) {
        resetValues[key] = JSON.parse(JSON.stringify(INITIAL_ADJUSTMENTS[key]));
      }
      setAdjustments(prev => ({ ...prev, ...resetValues }));

    } else {
      if (stashedAdjustments[sectionName]) {
        setAdjustments(prev => ({ ...prev, ...stashedAdjustments[sectionName] }));
        const newStash = { ...stashedAdjustments };
        delete newStash[sectionName];
        setStashedAdjustments(newStash);
      }
    }

    setSectionVisibility(prev => ({ ...prev, [sectionName]: !prev[sectionName] }));
  };

  const handleResetAdjustments = () => {
    setSectionVisibility({ basic: true, curves: true, color: true, details: true, effects: true });
    setStashedAdjustments({});

    setAdjustments(prev => ({
      ...prev,
      ...Object.keys(ADJUSTMENT_SECTIONS).flatMap(s => ADJUSTMENT_SECTIONS[s]).reduce((acc, key) => {
        acc[key] = INITIAL_ADJUSTMENTS[key];
        return acc;
      }, {})
    }));
  };

  const handleToggleSection = (section) => {
    setCollapsibleState(prev => ({ ...prev, [section]: !prev[section] }));
  };

  const handleSectionContextMenu = (event, sectionName) => {
    event.preventDefault();
    event.stopPropagation();

    const sectionKeys = ADJUSTMENT_SECTIONS[sectionName];
    if (!sectionKeys) return;

    const handleCopy = () => {
      const adjustmentsToCopy = {};
      for (const key of sectionKeys) {
        if (adjustments.hasOwnProperty(key)) {
          adjustmentsToCopy[key] = JSON.parse(JSON.stringify(adjustments[key]));
        }
      }
      setCopiedSectionAdjustments({ section: sectionName, values: adjustmentsToCopy });
    };

    const handlePaste = () => {
      if (!copiedSectionAdjustments || copiedSectionAdjustments.section !== sectionName) return;
      setAdjustments(prev => ({ ...prev, ...copiedSectionAdjustments.values }));
      if (!sectionVisibility[sectionName]) {
        setSectionVisibility(prev => ({ ...prev, [sectionName]: true }));
      }
    };

    const handleReset = () => {
      const resetValues = {};
      for (const key of sectionKeys) {
        resetValues[key] = JSON.parse(JSON.stringify(INITIAL_ADJUSTMENTS[key]));
      }
      setAdjustments(prev => ({ ...prev, ...resetValues }));
      setSectionVisibility(prev => ({ ...prev, [sectionName]: true }));
      if (stashedAdjustments[sectionName]) {
        const newStash = { ...stashedAdjustments };
        delete newStash[sectionName];
        setStashedAdjustments(newStash);
      }
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

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 flex justify-between items-center flex-shrink-0 border-b border-surface">
        <h2 className="text-xl font-bold text-primary text-shadow-shiny">Adjustments</h2>
        <button
          onClick={handleResetAdjustments}
          disabled={!selectedImage}
          className="p-2 rounded-full hover:bg-surface disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          title="Reset All Adjustments"
        >
          <RotateCcw size={18} />
        </button>
      </div>
      <div className="flex-grow overflow-y-auto p-4 flex flex-col gap-2">
        {Object.keys(ADJUSTMENT_SECTIONS).map(sectionName => {
          const SectionComponent = {
            basic: BasicAdjustments,
            curves: CurveGraph,
            color: ColorPanel,
            details: DetailsPanel,
            effects: EffectsPanel,
          }[sectionName];

          const title = sectionName.charAt(0).toUpperCase() + sectionName.slice(1);

          return (
            <div className="flex-shrink-0" key={sectionName}>
              <CollapsibleSection
                title={title}
                isOpen={collapsibleState[sectionName]}
                onToggle={() => handleToggleSection(sectionName)}
                onContextMenu={(e) => handleSectionContextMenu(e, sectionName)}
                isContentVisible={sectionVisibility[sectionName]}
                onToggleVisibility={() => handleToggleVisibility(sectionName)}
              >
                <SectionComponent
                  adjustments={adjustments}
                  setAdjustments={setAdjustments}
                  histogram={histogram}
                  theme={theme}
                />
              </CollapsibleSection>
            </div>
          );
        })}
      </div>
    </div>
  );
}