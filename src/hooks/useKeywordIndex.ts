import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

import { Invokes } from '../components/ui/AppProperties';
import { useLibraryStore } from '../store/useLibraryStore';

export interface KeywordCount {
  keyword: string;
  count: number;
}

export interface KeywordIndex {
  // User keyword paths without the `user:` prefix
  keywords: KeywordCount[];
  aiTags: KeywordCount[];
  isScanning: boolean;
}

const EMPTY_INDEX: KeywordIndex = { keywords: [], aiTags: [], isScanning: false };
// Roots already requested this session; the backend scans only roots it never scanned.
let refreshedRootsKey: string | null = null;

/** The Keyword List's Rescan Keywords: reads every library root, re-reading changed sidecars. */
export const rescanKeywordIndex = () =>
  invoke(Invokes.RefreshKeywordIndex, { rootPaths: useLibraryStore.getState().rootPaths, rescanAll: true }).catch(
    (error) => console.error('Failed to rescan the keyword index:', error),
  );

/**
 * The library-wide keyword index, reloaded whenever the backend reports an update. A library root
 * is scanned once, the first time; afterwards opened folders and ThisIsRAW's own keyword edits
 * keep it current, so a launch reads nothing (Plan item 71).
 */
export function useKeywordIndex() {
  const [index, setIndex] = useState<KeywordIndex>(EMPTY_INDEX);
  const rootPaths = useLibraryStore((state) => state.rootPaths);
  const rootsKey = rootPaths.join('\n');

  useEffect(() => {
    let isActive = true;
    const load = () =>
      invoke<KeywordIndex>(Invokes.GetKeywordIndex)
        .then((loaded) => isActive && setIndex(loaded))
        .catch((error) => console.error('Failed to load the keyword index:', error));

    const unlisten = listen('keyword-index-updated', load);
    void load();
    return () => {
      isActive = false;
      void unlisten.then((stop) => stop());
    };
  }, []);

  useEffect(() => {
    // Before the roots are loaded there is nothing to scan.
    if (rootPaths.length === 0 || refreshedRootsKey === rootsKey) return;
    refreshedRootsKey = rootsKey;
    invoke(Invokes.RefreshKeywordIndex, { rootPaths }).catch((error) =>
      console.error('Failed to refresh the keyword index:', error),
    );
  }, [rootPaths, rootsKey]);

  return index;
}
