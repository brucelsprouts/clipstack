/**
 * ConfirmDialog — a simple modal confirmation prompt.
 *
 * Used before destructive actions (e.g. clearing all history).
 * Traps focus inside the dialog and handles Escape to cancel.
 */
import { useEffect, useRef } from "react";

interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  danger = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  // Focus the cancel button by default (safer UX — requires deliberate action to confirm).
  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  // Close on Escape.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onCancel]);

  return (
    <div className="dialog-overlay" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
      <div className="dialog">
        <h2 className="dialog__title" id="dialog-title">{title}</h2>
        <p className="dialog__message">{message}</p>
        <div className="dialog__actions">
          <button
            ref={cancelRef}
            className="btn btn--secondary"
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
          <button
            className={`btn ${danger ? "btn--danger" : "btn--primary"}`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
