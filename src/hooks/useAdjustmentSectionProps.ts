import { useCallback } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { canvasToolState, useEditorStore } from '../store/useEditorStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useEditorActions } from './useEditorActions';

/** The props every adjustment section component takes for the photo's own adjustments. */
export function useAdjustmentSectionProps() {
  const { setAdjustments, handleLutSelect, setLutPreviewOverride } = useEditorActions();
  const { appSettings, theme } = useSettingsStore(
    useShallow((state) => ({ appSettings: state.appSettings, theme: state.theme })),
  );
  const { adjustments, histogram, isWbPickerActive, setEditor } = useEditorStore(
    useShallow((state) => ({
      adjustments: state.adjustments,
      histogram: state.histogram,
      isWbPickerActive: state.isWbPickerActive,
      setEditor: state.setEditor,
    })),
  );

  const toggleWbPicker = useCallback(
    () => setEditor((state) => canvasToolState({ isWbPickerActive: !state.isWbPickerActive })),
    [setEditor],
  );

  const onDragStateChange = useCallback(
    (isDragging: boolean) => setEditor({ isSliderDragging: isDragging }),
    [setEditor],
  );

  return {
    adjustments,
    setAdjustments,
    histogram,
    theme,
    handleLutSelect,
    onLutHover: setLutPreviewOverride,
    appSettings,
    isWbPickerActive,
    toggleWbPicker,
    onDragStateChange,
  };
}
