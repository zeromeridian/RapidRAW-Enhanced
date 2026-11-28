import { toast, type TypeOptions } from 'react-toastify';

/**
 * A loading toast with a progress bar for a longer Library task (Read XMP from Folder,
 * Refresh Folders), so it is clear something is happening.
 */
export function showProgressToast(message: string) {
  const id = toast.loading(message);
  const finish = (render: string, type: TypeOptions, autoClose: number) =>
    // `progress: undefined` hands the bar back to `autoClose`.
    toast.update(id, { autoClose, isLoading: false, progress: undefined, render, type });
  return {
    /** A controlled bar closes the toast at 1, so it stops just short until `done`. */
    update: (render: string, current: number, total: number) =>
      toast.update(id, { progress: total > 0 ? Math.min(current / total, 0.99) : undefined, render }),
    done: (render: string, type: TypeOptions = 'success') => finish(render, type, 5000),
    fail: (render: string) => finish(render, 'error', 8000),
  };
}
