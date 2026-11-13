import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { ParseKeys } from 'i18next';
import { ADJUSTMENT_TOOLS_BY_ID } from '../utils/adjustments';
import { ADJUSTMENT_CONTROLS_BY_ID } from '../utils/adjustmentControls';

/**
 * A slider's name outside its tool block: the label alone, or "Tool: Label" when the label does
 * not say what it changes ("Vignette: Amount").
 */
export function useControlLabel() {
  const { t } = useTranslation();

  const sectionLabel = useCallback((section: string) => t(`editor.adjustments.sections.${section}` as ParseKeys), [t]);

  const controlLabel = useCallback(
    (id: string): string => {
      const control = ADJUSTMENT_CONTROLS_BY_ID[id];
      const label = t(control.label as ParseKeys);
      if (!control.qualify) return label;
      const parent = ADJUSTMENT_TOOLS_BY_ID[control.parent];
      const tool = parent ? t(parent.label as ParseKeys) : sectionLabel(control.parent);
      return t('editor.favorites.qualifiedLabel', { tool, control: label });
    },
    [t, sectionLabel],
  );

  return { controlLabel, sectionLabel };
}
