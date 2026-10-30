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
// Roots already scanned this session; tag edits update the index directly, so reopening the panel does not rescan.
let refreshedRootsKey: string | null = null;

/**
 * The library-wide keyword index, scanned in the background once per session and whenever the
 * library roots change, and reloaded whenever the backend reports an update.
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
    if (refreshedRootsKey === rootsKey) return;
    refreshedRootsKey = rootsKey;
    invoke(Invokes.RefreshKeywordIndex, { rootPaths }).catch((error) =>
      console.error('Failed to refresh the keyword index:', error),
    );
  }, [rootPaths, rootsKey]);

  return index;
}
