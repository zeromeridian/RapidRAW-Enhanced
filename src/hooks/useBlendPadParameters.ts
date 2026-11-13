import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Invokes } from '../components/ui/AppProperties';
import type { BlendPadParameter } from '../utils/blendPad';

/** Read once: the list is fixed in `blend_pad::PARAMETERS`. */
let parametersRequest: Promise<Array<BlendPadParameter>> | null = null;

/** The sliders the Orbit Blend Pad can drive; empty until the backend has answered. */
export function useBlendPadParameters(): Array<BlendPadParameter> {
  const [parameters, setParameters] = useState<Array<BlendPadParameter>>([]);

  useEffect(() => {
    let isCurrent = true;
    parametersRequest ??= invoke<Array<BlendPadParameter>>(Invokes.GetBlendPadParameters);
    parametersRequest
      .then((loaded) => isCurrent && setParameters(loaded))
      .catch((err) => {
        parametersRequest = null;
        console.error('Failed to load the blend pad parameters:', err);
      });
    return () => {
      isCurrent = false;
    };
  }, []);

  return parameters;
}
