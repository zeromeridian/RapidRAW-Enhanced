import { useRef, useCallback, useMemo, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import debounce from 'lodash.debounce';
import { useLibraryStore } from '../store/useLibraryStore';

/** How often a visible cloud placeholder asks again until its file is downloaded. */
export const CLOUD_THUMBNAIL_RETRY_MS = 5000;
// A sent path is not sent again until its result arrives or this much time passes. It stays
// below the cloud retry interval so placeholders, which produce no result, still retry.
const REQUEST_RETRY_MS = 3000;

export function useThumbnails() {
  const thumbnailContext = useLibraryStore(
    (state) => state.pendingFolderPath ?? state.currentFolderPath ?? '__no-folder__',
  );
  const generatedRef = useRef<Set<string>>(new Set());
  const pendingQueueRef = useRef<Set<string>>(new Set());
  const requestedAtRef = useRef<Map<string, number>>(new Map());
  const contextRef = useRef(thumbnailContext);

  const flushQueueToBackend = useMemo(
    () =>
      debounce(
        () => {
          const pathsToSend = Array.from(pendingQueueRef.current);
          if (pathsToSend.length === 0) return;

          invoke('update_thumbnail_queue', { paths: pathsToSend, contextId: contextRef.current }).catch((err) => {
            console.error('Failed to update thumbnail queue:', err);
          });

          const sentAt = Date.now();
          pathsToSend.forEach((path) => requestedAtRef.current.set(path, sentAt));
          pendingQueueRef.current.clear();
        },
        150,
        { maxWait: 300 },
      ),
    [],
  );

  const requestThumbnails = useCallback(
    (visiblePaths: string[]) => {
      let addedToQueue = false;
      const now = Date.now();

      visiblePaths.forEach((p) => {
        if (generatedRef.current.has(p) || pendingQueueRef.current.has(p)) return;
        const requestedAt = requestedAtRef.current.get(p);
        if (requestedAt !== undefined && now - requestedAt < REQUEST_RETRY_MS) return;
        pendingQueueRef.current.add(p);
        addedToQueue = true;
      });

      if (addedToQueue) {
        flushQueueToBackend();
      }
    },
    [flushQueueToBackend],
  );

  const markGenerated = useCallback((path: string) => {
    generatedRef.current.add(path);
    pendingQueueRef.current.delete(path);
    requestedAtRef.current.delete(path);
  }, []);

  useEffect(() => {
    contextRef.current = thumbnailContext;
    pendingQueueRef.current.clear();
    // The backend drops the previous folder's queue, so its paths must be requestable again.
    requestedAtRef.current.clear();
    flushQueueToBackend.cancel();
    invoke('update_thumbnail_queue', { paths: [], contextId: thumbnailContext }).catch((err) => {
      console.error('Failed to activate thumbnail folder:', err);
    });
  }, [flushQueueToBackend, thumbnailContext]);

  useEffect(() => {
    return () => flushQueueToBackend.cancel();
  }, [flushQueueToBackend]);

  return { requestThumbnails, markGenerated };
}
