/**
 * ClipItem — a single row in the clipboard history list.
 *
 * Displays:
 *   - Pin indicator (★ / ☆)
 *   - Content preview (text truncated, image thumbnail)
 *   - Relative timestamp
 *   - Action buttons that appear on hover
 */
import React, { memo, useCallback } from "react";
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
  onDragStart?: () => void;
  onDragOver?: () => void;
  onDrop?: () => void;
  onDragEnd?: () => void;
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
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: ClipItemProps) {
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
      onDelete(clip.id);
    },
    [clip.id, onDelete]
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
      draggable
      onClick={handleCopy}
      onMouseEnter={onMouseEnter}
      onDragStart={(e) => {
        // WebView2 transparent-window bug: the browser briefly removes the
        // source element from its compositing layer to snapshot the drag ghost,
        // making it invisible. Providing a pre-built offscreen clone as the
        // drag image decouples the capture from the live element entirely.
        const el = e.currentTarget;
        const ghost = el.cloneNode(true) as HTMLElement;
        ghost.style.cssText = `width:${el.offsetWidth}px;position:fixed;top:-9999px;left:-9999px;pointer-events:none;`;
        document.body.appendChild(ghost);
        e.dataTransfer.setDragImage(ghost, e.nativeEvent.offsetX, e.nativeEvent.offsetY);
        setTimeout(() => { if (ghost.parentNode) ghost.parentNode.removeChild(ghost); }, 0);
        onDragStart?.();
      }}
      onDragOver={(e) => { e.preventDefault(); onDragOver?.(); }}
      onDrop={(e) => { e.preventDefault(); onDrop?.(); }}
      onDragEnd={onDragEnd}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && handleCopy()}
      aria-label={`Copy: ${clip.preview}`}
    >
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
        {clip.kind === "html" && (
          <span className="clip-item__kind-badge" aria-label="Rich text">HTML</span>
        )}
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
            className="clip-action clip-action--delete"
            onClick={handleDelete}
            aria-label="Delete"
            title="Delete"
          >
            <TrashIcon />
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
  // Detect format from base64 magic bytes: PNG starts with iVBOR, BMP with Qk
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
