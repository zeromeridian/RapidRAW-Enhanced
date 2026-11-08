import { useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useEditorStore } from '../store/useEditorStore';
import { ImageFile, Invokes } from '../components/ui/AppProperties';

const requestPreload = (anchor: string, paths: string[]) =>
  invoke(Invokes.PreloadImages, { anchor, paths }).catch((err) => console.warn('Preload request failed:', err));

/**
 * Once the photo open in Develop is on screen, asks the backend to decode its
 * neighbours, the one in the direction of travel first. Navigation wraps, so
 * the neighbours do too.
 */
export function useImagePreloader(sortedImageList: ImageFile[]) {
  const path = useEditorStore((s) => s.selectedImage?.path ?? null);
  const isReady = useEditorStore((s) => Boolean(s.selectedImage?.isReady));
  const isOnScreen = useEditorStore((s) => s.hasRenderedFirstFrame || Boolean(s.finalPreviewUrl));

  const listRef = useRef(sortedImageList);
  const previousPathRef = useRef<string | null>(null);
  const directionRef = useRef(1);
  const anchorRef = useRef<string | null>(null);

  useEffect(() => {
    listRef.current = sortedImageList;
  }, [sortedImageList]);

  useEffect(() => {
    const previousPath = previousPathRef.current;
    previousPathRef.current = path;
    if (!path) {
      if (anchorRef.current) requestPreload(anchorRef.current, []);
      anchorRef.current = null;
      return;
    }
    if (!previousPath) return;
    const list = listRef.current;
    const index = list.findIndex((img) => img.path === path);
    const previousIndex = list.findIndex((img) => img.path === previousPath);
    if (index === -1 || previousIndex === -1) return;
    const step = index - previousIndex;
    if (step === 1 || step === 1 - list.length) directionRef.current = 1;
    else if (step === -1 || step === list.length - 1) directionRef.current = -1;
  }, [path]);

  useEffect(() => {
    if (!path || !isReady || !isOnScreen) return;
    const index = sortedImageList.findIndex((img) => img.path === path);
    if (index === -1 || sortedImageList.length < 2) return;
    const length = sortedImageList.length;
    const at = (offset: number) => sortedImageList[(((index + offset) % length) + length) % length].path;
    const direction = directionRef.current;
    anchorRef.current = path;
    requestPreload(path, [at(direction), at(-direction)]);
  }, [path, isReady, isOnScreen, sortedImageList]);
}
