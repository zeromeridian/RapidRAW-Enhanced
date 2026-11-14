import React, { useCallback } from 'react';
import { RotateCcw, Copy, ClipboardPaste, PencilSparkles, ChartArea } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { ADJUSTMENT_SECTION_COMPONENTS } from '../../adjustments/sectionComponents';
import { CustomizePanelsButton, customizePanelsMenuOption } from './AdjustmentSectionsSubMenu';
import { AdjustmentPanelContext, FavoriteStar } from '../../adjustments/AdjustmentTool';
import CollapsibleSection from '../../ui/CollapsibleSection';
import Waveform from '../editor/Waveform';
import Resizer from '../../ui/Resizer';
import {
  Adjustments,
  SectionVisibility,
  INITIAL_ADJUSTMENTS,
  ADJUSTMENT_SECTIONS,
  getAdjustmentSectionOrder,
  getInitialAdjustments,
  isAdjustmentSectionShown,
} from '../../../utils/adjustments';
import { useContextMenu } from '../../../context/ContextMenuContext';
import { OPTION_SEPARATOR, Orientation } from '../../ui/AppProperties';
import PanelHeader from '../../ui/PanelHeader';
import { useShallow } from 'zustand/react/shallow';
import { useEditorStore } from '../../../store/useEditorStore';
import { useUIStore } from '../../../store/useUIStore';
import { useEditorActions } from '../../../hooks/useEditorActions';
import { useWaveformControls } from '../../../hooks/useWaveformControls';
import { useAdjustmentSectionProps } from '../../../hooks/useAdjustmentSectionProps';
import { useFavorites } from '../../../hooks/useFavorites';
import { favoriteKey } from '../../../utils/adjustmentControls';

const PHOTO_PANEL_CONTEXT = { canFavorite: true };

export default function Controls() {
  const { t } = useTranslation();
  const { showContextMenu } = useContextMenu();
  const { isResizingWaveform, onToggleWaveform, setActiveWaveformChannel, handleWaveformResize } =
    useWaveformControls();
  const { handleAutoAdjustments } = useEditorActions();
  const sectionProps = useAdjustmentSectionProps();
  const { adjustments, appSettings, histogram, setAdjustments, theme } = sectionProps;
  const { getFavoriteMenuOptions } = useFavorites();

  const { collapsibleSectionsState, setUI } = useUIStore(
    useShallow((state) => ({
      collapsibleSectionsState: state.collapsibleSectionsState,
      setUI: state.setUI,
    })),
  );

  const {
    copiedSectionAdjustments,
    selectedImage,
    isWaveformVisible,
    waveform,
    activeWaveformChannel,
    waveformHeight,
    setEditor,
  } = useEditorStore(
    useShallow((state) => ({
      copiedSectionAdjustments: state.copiedSectionAdjustments,
      selectedImage: state.selectedImage,
      isWaveformVisible: state.isWaveformVisible,
      waveform: state.waveform,
      activeWaveformChannel: state.activeWaveformChannel,
      waveformHeight: state.waveformHeight,
      setEditor: state.setEditor,
    })),
  );

  const setCopiedSectionAdjustments = useCallback(
    (val: any) => setEditor({ copiedSectionAdjustments: val }),
    [setEditor],
  );

  const setCollapsibleState = useCallback(
    (updater: any) =>
      setUI((state) => ({
        collapsibleSectionsState: typeof updater === 'function' ? updater(state.collapsibleSectionsState) : updater,
      })),
    [setUI],
  );

  const handleToggleVisibility = (sectionName: string) => {
    setAdjustments((prev: Adjustments) => {
      const currentVisibility: SectionVisibility = prev.sectionVisibility || INITIAL_ADJUSTMENTS.sectionVisibility;
      return {
        ...prev,
        sectionVisibility: {
          ...currentVisibility,
          [sectionName]: !currentVisibility[sectionName],
        },
      };
    });
  };

  const handleResetAdjustments = () => {
    const initialAdjustments = getInitialAdjustments(selectedImage?.isRaw ?? false);
    setAdjustments(
      (prev: Adjustments) => ({
        ...prev,
        ...Object.keys(ADJUSTMENT_SECTIONS)
          .flatMap((s) => ADJUSTMENT_SECTIONS[s])
          .reduce((acc: any, key: string) => {
            acc[key] = initialAdjustments[key as keyof Adjustments];
            return acc;
          }, {}),
        sectionVisibility: { ...INITIAL_ADJUSTMENTS.sectionVisibility },
      }),
      t('contextMenus.editor.resetAdjustments'),
    );
  };

  const handleToggleSection = (section: string) => {
    setCollapsibleState((prev: any) => {
      const isOpening = !prev[section];
      if (appSettings?.enableFocusMode && isOpening) {
        const newState = { ...prev };
        Object.keys(newState).forEach((key) => {
          newState[key] = false;
        });
        newState[section] = true;
        return newState;
      }
      return { ...prev, [section]: !prev[section] };
    });
  };

  const handleSectionContextMenu = (event: any, sectionName: string) => {
    event.preventDefault();
    event.stopPropagation();

    const sectionKeys = ADJUSTMENT_SECTIONS[sectionName];
    if (!sectionKeys) {
      return;
    }

    const handleCopy = () => {
      const adjustmentsToCopy: any = {};
      for (const key of sectionKeys) {
        if (Object.prototype.hasOwnProperty.call(adjustments, key)) {
          adjustmentsToCopy[key] = JSON.parse(JSON.stringify(adjustments[key as keyof Adjustments]));
        }
      }
      setCopiedSectionAdjustments({ section: sectionName, values: adjustmentsToCopy });
    };

    const handlePaste = () => {
      if (!copiedSectionAdjustments || copiedSectionAdjustments.section !== sectionName) {
        return;
      }
      setAdjustments((prev: Adjustments) => ({
        ...prev,
        ...copiedSectionAdjustments.values,
        sectionVisibility: {
          ...(prev.sectionVisibility || INITIAL_ADJUSTMENTS.sectionVisibility),
          [sectionName]: true,
        },
      }));
    };

    const handleReset = () => {
      const initialAdjustments = getInitialAdjustments(selectedImage?.isRaw ?? false);
      const resetValues: any = {};
      for (const key of sectionKeys) {
        resetValues[key] = JSON.parse(JSON.stringify(initialAdjustments[key as keyof Adjustments]));
      }
      setAdjustments((prev: Adjustments) => ({
        ...prev,
        ...resetValues,
        sectionVisibility: {
          ...(prev.sectionVisibility || INITIAL_ADJUSTMENTS.sectionVisibility),
          [sectionName]: true,
        },
      }));
    };

    const isPasteAllowed = copiedSectionAdjustments && copiedSectionAdjustments.section === sectionName;
    const translatedSection = t(`editor.adjustments.sections.${sectionName}`);

    const pasteLabel = copiedSectionAdjustments
      ? t('editor.adjustments.actions.pasteLabel', { section: translatedSection })
      : t('editor.adjustments.actions.pasteSettings');

    const options: any = [
      {
        label: t('editor.adjustments.actions.copySectionSettings', { section: translatedSection }),
        icon: Copy,
        onClick: handleCopy,
      },
      { label: pasteLabel, icon: ClipboardPaste, onClick: handlePaste, disabled: !isPasteAllowed },
      { type: OPTION_SEPARATOR },
      {
        label: t('editor.adjustments.actions.resetSectionSettings', { section: translatedSection }),
        icon: RotateCcw,
        onClick: handleReset,
      },
      { type: OPTION_SEPARATOR },
      ...getFavoriteMenuOptions(event.target, sectionName),
      { type: OPTION_SEPARATOR },
      customizePanelsMenuOption(t('editor.adjustments.actions.customizePanels')),
    ];

    showContextMenu(event.clientX, event.clientY, options);
  };

  return (
    <div className="flex flex-col h-full">
      <PanelHeader
        title={t('editor.adjustments.title')}
        actions={
          <>
            <button
              className="p-2 rounded-full hover:bg-surface disabled:cursor-not-allowed transition-colors"
              disabled={!selectedImage?.isReady}
              onClick={handleAutoAdjustments}
              data-tooltip={t('editor.adjustments.tooltips.autoAdjust')}
            >
              <PencilSparkles size={18} />
            </button>
            <button
              className={clsx(
                'p-2 rounded-full transition-colors',
                isWaveformVisible ? 'bg-surface hover:bg-card-active' : 'hover:bg-surface',
              )}
              onClick={onToggleWaveform}
              data-tooltip={t('editor.adjustments.tooltips.toggleAnalytics')}
            >
              <ChartArea size={18} />
            </button>
            <CustomizePanelsButton />
            <button
              className="p-2 rounded-full hover:bg-surface disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              disabled={!selectedImage}
              onClick={handleResetAdjustments}
              data-tooltip={t('editor.adjustments.tooltips.resetAdjustments')}
            >
              <RotateCcw size={18} />
            </button>
          </>
        }
      />

      <AnimatePresence initial={false}>
        {isWaveformVisible && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: waveformHeight || 256, opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: isResizingWaveform ? 0 : 0.2, ease: 'easeOut' }}
            className="shrink-0 flex flex-col relative border-b border-surface overflow-hidden"
          >
            <div className="grow w-full h-full p-4 pb-2 compact:p-2 min-h-0">
              <Waveform
                waveformData={waveform || null}
                histogram={histogram}
                displayMode={activeWaveformChannel || 'luma'}
                setDisplayMode={setActiveWaveformChannel}
                showClipping={adjustments.showClipping || false}
                onToggleClipping={() => {
                  setAdjustments((prev: Adjustments) => ({
                    ...prev,
                    showClipping: !prev.showClipping,
                  }));
                }}
                theme={theme}
              />
            </div>
            <Resizer direction={Orientation.Horizontal} onMouseDown={handleWaveformResize} />
          </motion.div>
        )}
      </AnimatePresence>

      <AdjustmentPanelContext.Provider value={PHOTO_PANEL_CONTEXT}>
        <div className="grow overflow-y-scroll p-4 compact:p-0 flex flex-col gap-2 compact:gap-2.5">
          {getAdjustmentSectionOrder(appSettings?.adjustmentLayout?.sectionOrder)
            .filter((sectionName) => isAdjustmentSectionShown(sectionName, adjustments, false))
            .map((sectionName: string) => {
              const SectionComponent = ADJUSTMENT_SECTION_COMPONENTS[sectionName];

              const title = t(`editor.adjustments.sections.${sectionName}`);
              const sectionVisibility = adjustments.sectionVisibility || INITIAL_ADJUSTMENTS.sectionVisibility;

              return (
                <div className="shrink-0 group" key={sectionName}>
                  <CollapsibleSection
                    isContentVisible={sectionVisibility[sectionName as keyof SectionVisibility]}
                    isOpen={collapsibleSectionsState[sectionName as keyof typeof collapsibleSectionsState]}
                    onContextMenu={(e: any) => handleSectionContextMenu(e, sectionName)}
                    onToggle={() => handleToggleSection(sectionName)}
                    onToggleVisibility={() => handleToggleVisibility(sectionName)}
                    title={title}
                    titleAddon={<FavoriteStar favorite={favoriteKey('section', sectionName)} />}
                  >
                    <SectionComponent {...sectionProps} />
                  </CollapsibleSection>
                </div>
              );
            })}
        </div>
      </AdjustmentPanelContext.Provider>
    </div>
  );
}
