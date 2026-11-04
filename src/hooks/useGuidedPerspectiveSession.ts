import { useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';

import { Invokes } from '../components/ui/AppProperties';
import { useEditorStore } from '../store/useEditorStore';
import { Adjustments, hasGuidedPerspective } from '../utils/adjustments';
import { GuidedPerspectiveFrame } from '../utils/guidedPerspective';
import { useEditorActions } from './useEditorActions';

/**
 * Ends guide drawing when the image changes or the panel closes, and then
 * crops to the largest rectangle without empty borders (upstream's
 * `autoCrop`) when the guides changed. The guides define the rotation, so
 * the crop also resets Straighten.
 */
export function useGuidedPerspectiveSession() {
  const isActive = useEditorStore((state) => state.isGuidedPerspectiveActive);
  const selectedImagePath = useEditorStore((state) => state.selectedImage?.path ?? null);
  const setEditor = useEditorStore((state) => state.setEditor);
  const { setAdjustments } = useEditorActions();

  useEffect(() => () => setEditor({ isGuidedPerspectiveActive: false }), [setEditor]);

  useEffect(() => {
    setEditor({ isGuidedPerspectiveActive: false });
  }, [selectedImagePath, setEditor]);

  useEffect(() => {
    if (!isActive) return;
    const session = useEditorStore.getState();
    const sessionPath = session.selectedImage?.path;
    const initialLines = session.adjustments.guidedPerspective.lines;

    return () => {
      const { adjustments, selectedImage } = useEditorStore.getState();
      const { guidedPerspective } = adjustments;
      if (
        selectedImage?.path !== sessionPath ||
        guidedPerspective.lines === initialLines ||
        !guidedPerspective.autoCrop ||
        !hasGuidedPerspective(guidedPerspective)
      ) {
        return;
      }
      invoke<GuidedPerspectiveFrame>(Invokes.GetGuidedPerspectiveFrame, { jsAdjustments: adjustments })
        .then(({ crop }) => {
          if (!crop || useEditorStore.getState().selectedImage?.path !== sessionPath) return;
          setAdjustments((previous: Adjustments) => ({ ...previous, crop: { unit: 'px', ...crop }, rotation: 0 }));
        })
        .catch((error) => console.error('Failed to crop the guided perspective correction:', error));
    };
  }, [isActive, setAdjustments]);
}
