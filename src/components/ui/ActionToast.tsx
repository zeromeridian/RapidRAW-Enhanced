import { toast } from 'react-toastify';

/** The time an action toast stays, long enough to reach its button. */
const ACTION_TOAST_MS = 8000;

/** A toast with one button beside its message, such as Undo; pressing it closes the toast and runs `onAction`. */
export const showActionToast = (message: string, actionLabel: string, onAction: () => void) =>
  toast.success(
    ({ closeToast }) => (
      <div className="flex items-center justify-between gap-3">
        <span>{message}</span>
        <button
          className="shrink-0 font-semibold text-accent hover:underline"
          onClick={() => {
            closeToast();
            onAction();
          }}
          type="button"
        >
          {actionLabel}
        </button>
      </div>
    ),
    { autoClose: ACTION_TOAST_MS, closeOnClick: false },
  );
