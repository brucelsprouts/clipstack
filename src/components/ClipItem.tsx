/**
 * ClipItem — a single row in the clipboard history list.
 *
 * Drag-to-reorder uses pointer events (not HTML5 drag API), which works
 * reliably in WebView2 transparent windows. The parent ClipList owns all
 * drag logic; this component only signals when the drag handle is pressed.
 */
import React, { memo, useCallback, useRef, useState, useEffect } from "react";
import { Clip } from "@/types";
import { formatRelativeTime } from "@/lib/formatTime";

interface ClipItemProps {
  clip: Clip;
  isSelected: boolean;
  isActivated?: boolean;
  isDragOver?: boolean;
  isDragging?: boolean;
  onCopy: (id: number) => void;
  onTogglePin: (id: number) => void;
  onDelete: (id: number) => void;
  onMouseEnter: () => void;
  /** Called when the drag handle receives pointerdown; passes the clientY origin. */
  onDragHandlePointerDown?: (startY: number) => void;
}

export const ClipItem = memo(function ClipItem({
  clip,
  isSelected,
  isActivated,
  isDragOver,
  isDragging,
  onCopy,
  onTogglePin,
  onDelete,
  onMouseEnter,
  onDragHandlePointerDown,
}: ClipItemProps) {
  const [pendingDelete, setPendingDelete] = useState(false);
  const deleteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (deleteTimerRef.current) clearTimeout(deleteTimerRef.current);
    };
  }, []);

  const handleCopy = useCallback(() => onCopy(clip.id), [clip.id, onCopy]);
  const handlePin = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onTogglePin(clip.id);
    },
    [clip.id, onTogglePin]
  );
  const handleDelete = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (pendingDelete) {
        if (deleteTimerRef.current) clearTimeout(deleteTimerRef.current);
        setPendingDelete(false);
        onDelete(clip.id);
      } else {
        setPendingDelete(true);
        deleteTimerRef.current = setTimeout(() => setPendingDelete(false), 1500);
      }
    },
    [clip.id, onDelete, pendingDelete]
  );

  const cls = [
    "clip-item",
    isSelected   ? "clip-item--selected"  : "",
    isActivated  ? "clip-item--activated" : "",
    isDragOver   ? "clip-item--drag-over" : "",
    isDragging   ? "clip-item--dragging"  : "",
    clip.pinned  ? "clip-item--pinned"    : "",
  ].filter(Boolean).join(" ");

  return (
    <li
      className={cls}
      data-clip-item
      data-clip-id={clip.id}
      onClick={handleCopy}
      onMouseEnter={onMouseEnter}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && handleCopy()}
      aria-label={`Copy: ${clip.preview}`}
    >
      {/* Drag handle — pointer events only, click is absorbed here */}
      <div
        className="clip-item__drag-handle"
        aria-hidden="true"
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => {
          e.stopPropagation();
          onDragHandlePointerDown?.(e.clientY);
        }}
      >
        <DragHandleIcon />
      </div>

      {/* Left: content preview */}
      <div className="clip-item__body">
        {clip.kind === "image" ? (
          <ImagePreview content={clip.content} preview={clip.preview} />
        ) : clip.kind === "html" ? (
          <HtmlPreview preview={clip.preview} />
        ) : (
          <TextPreview content={clip.preview} />
        )}
      </div>

      {/* Right: meta + actions */}
      <div className="clip-item__meta">
        <span className="clip-item__time">{formatRelativeTime(clip.createdAt)}</span>
        <div className="clip-item__actions">
          <button
            className={`clip-action clip-action--pin${clip.pinned ? " clip-action--active" : ""}`}
            onClick={handlePin}
            aria-label={clip.pinned ? "Unpin" : "Pin"}
            title={clip.pinned ? "Unpin" : "Pin to top"}
          >
            <PinIcon pinned={clip.pinned} />
          </button>
          <button
            className={`clip-action clip-action--delete${pendingDelete ? " clip-action--delete-pending" : ""}`}
            onClick={handleDelete}
            aria-label={pendingDelete ? "Click again to confirm delete" : "Delete"}
            title={pendingDelete ? "Click again to delete" : "Delete"}
          >
            {pendingDelete ? <ConfirmDeleteIcon /> : <TrashIcon />}
          </button>
        </div>
      </div>
    </li>
  );
});

// ── Sub-components ────────────────────────────────────────────────────────────

function TextPreview({ content }: { content: string }) {
  return <span className="clip-item__text">{content}</span>;
}

function HtmlPreview({ preview }: { preview: string }) {
  return <span className="clip-item__text">{preview}</span>;
}

function ImagePreview({ content, preview }: { content: string; preview: string }) {
  const mime = content.startsWith("iVBOR") ? "image/png"
             : content.startsWith("Qk")    ? "image/bmp"
             : "image/png";
  return (
    <div className="clip-item__image-wrap">
      <ImageWithFallback src={`data:${mime};base64,${content}`} alt={preview} />
      <span className="clip-item__image-label">{preview}</span>
    </div>
  );
}

function ImageWithFallback({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = React.useState(false);
  if (failed) {
    return <div className="clip-item__image-fallback" aria-label={alt}>🖼</div>;
  }
  return (
    <img
      className="clip-item__image"
      src={src}
      alt={alt}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

function PinIcon({ pinned }: { pinned: boolean }) {
  return pinned ? (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" stroke="none">
      <path d="M16 12V4a1 1 0 0 0-1-1H9a1 1 0 0 0-1 1v8l-2 2v1h6v7l1 1 1-1v-7h6v-1l-2-2z" />
    </svg>
  ) : (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M16 12V4a1 1 0 0 0-1-1H9a1 1 0 0 0-1 1v8l-2 2v1h6v7l1 1 1-1v-7h6v-1l-2-2z" />
    </svg>
  );
}

function DragHandleIcon() {
  return (
    <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor">
      <circle cx="3" cy="2.5" r="1.2" />
      <circle cx="7" cy="2.5" r="1.2" />
      <circle cx="3" cy="7"   r="1.2" />
      <circle cx="7" cy="7"   r="1.2" />
      <circle cx="3" cy="11.5" r="1.2" />
      <circle cx="7" cy="11.5" r="1.2" />
    </svg>
  );
}

function ConfirmDeleteIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </svg>
  );
}
