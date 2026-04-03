/**
 * ClipList — scrollable list of clipboard entries.
 *
 * Pinned clips appear first in a collapsible group (auto-collapsed when >4).
 * Drag-to-reorder uses pointer events (not HTML5 drag), which works reliably
 * in WebView2 transparent windows where the HTML5 drag API is broken.
 */
import { useCallback, useRef, useEffect, useState, MutableRefObject } from "react";
import { Clip } from "@/types";
import { ClipItem } from "./ClipItem";

const PINNED_PREVIEW_COUNT = 4;

interface ClipListProps {
  clips: Clip[];
  selectedIndex: number;
  onSelectIndex: (index: number) => void;
  onCopy: (id: number) => void;
  onTogglePin: (id: number) => void;
  onDelete: (id: number) => void;
  activatedId?: number | null;
  onReorder?: (orderedIds: number[]) => void;
  /** Ref set to true by useKeyboard before arrow-key nav; cleared after scroll. */
  keyboardNavRef?: MutableRefObject<boolean>;
}

export function ClipList({
  clips,
  selectedIndex,
  onSelectIndex,
  onCopy,
  onTogglePin,
  onDelete,
  activatedId,
  onReorder,
  keyboardNavRef,
}: ClipListProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const [pinnedCollapsed, setPinnedCollapsed] = useState(false);

  // Visual drag state for rendering
  const [dragId,     setDragId]     = useState<number | null>(null);
  const [dragOverId, setDragOverId] = useState<number | null>(null);

  // Refs for drag logic (avoids stale closures in document listeners)
  const dragIdRef     = useRef<number | null>(null);
  const dragOverIdRef = useRef<number | null>(null);
  const clipsRef      = useRef(clips);
  useEffect(() => { clipsRef.current = clips; }, [clips]);

  // Suppress hover-selection and scrollIntoView while pointer is held.
  const isPointerDownRef = useRef(false);
  useEffect(() => {
    const onDown = () => { isPointerDownRef.current = true; };
    const onUp   = () => { isPointerDownRef.current = false; };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("pointerup",   onUp,   true);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("pointerup",   onUp,   true);
    };
  }, []);

  const pinned  = clips.filter((c) =>  c.pinned);
  const regular = clips.filter((c) => !c.pinned);

  // Auto-collapse pinned section when many items are pinned.
  useEffect(() => {
    if (pinned.length > PINNED_PREVIEW_COUNT) setPinnedCollapsed(true);
  }, [pinned.length]);

  // Scroll selected item into view — only when triggered by keyboard arrow keys.
  useEffect(() => {
    if (selectedIndex < 0 || !listRef.current || !keyboardNavRef?.current) return;
    keyboardNavRef.current = false;
    const items = listRef.current.querySelectorAll<HTMLElement>("[data-clip-item]");
    items[selectedIndex]?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selectedIndex, keyboardNavRef]);

  // ── Pointer-based drag-to-reorder ─────────────────────────────────────────
  // HTML5 drag events are unreliable in WebView2 transparent windows (the source
  // element disappears from the compositing layer during the drag snapshot).
  // Pointer events bypass this entirely: pointermove on document tracks position,
  // elementFromPoint finds the drop target, pointerup commits the reorder.

  const startPointerDrag = useCallback(
    (itemId: number, startY: number) => {
      let activated = false;

      const onMove = (e: PointerEvent) => {
        // Require 6px movement before activating drag to distinguish from clicks.
        if (!activated) {
          if (Math.abs(e.clientY - startY) < 6) return;
          activated = true;
          dragIdRef.current = itemId;
          setDragId(itemId);
          document.body.style.userSelect = "none";
          document.body.style.cursor     = "grabbing";
        }

        // Find which clip the pointer is currently over.
        const el     = document.elementFromPoint(e.clientX, e.clientY);
        const itemEl = el?.closest("[data-clip-item]") as HTMLElement | null;
        if (itemEl) {
          const overId = Number(itemEl.dataset.clipId);
          if (!isNaN(overId) && overId !== itemId && overId !== dragOverIdRef.current) {
            dragOverIdRef.current = overId;
            setDragOverId(overId);
          }
        }
      };

      const onUp = () => {
        const dId   = dragIdRef.current;
        const dOver = dragOverIdRef.current;

        if (activated && dId !== null && dOver !== null && dId !== dOver && onReorder) {
          const allClips = clipsRef.current;
          const dragClip = allClips.find((c) => c.id === dId);
          const dropClip = allClips.find((c) => c.id === dOver);
          if (dragClip && dropClip && dragClip.pinned === dropClip.pinned) {
            const group = dragClip.pinned
              ? allClips.filter((c) => c.pinned)
              : allClips.filter((c) => !c.pinned);
            const from = group.findIndex((c) => c.id === dId);
            const to   = group.findIndex((c) => c.id === dOver);
            if (from >= 0 && to >= 0 && from !== to) {
              const reordered = [...group];
              const [moved]   = reordered.splice(from, 1);
              reordered.splice(to, 0, moved);
              onReorder(reordered.map((c) => c.id));
            }
          }
        }

        // After a real drag, absorb the click the browser fires on pointerup
        // so the item under the pointer doesn't trigger copy+paste.
        if (activated) {
          const absorbClick = (e: MouseEvent) => {
            e.stopPropagation();
            e.preventDefault();
          };
          document.addEventListener("click", absorbClick, true);
          setTimeout(() => document.removeEventListener("click", absorbClick, true), 0);
        }

        // Reset
        dragIdRef.current     = null;
        dragOverIdRef.current = null;
        setDragId(null);
        setDragOverId(null);
        document.body.style.userSelect = "";
        document.body.style.cursor     = "";
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup",   onUp);
      };

      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup",   onUp);
    },
    [onReorder]
  );

  // ── Render ────────────────────────────────────────────────────────────────

  if (clips.length === 0) {
    return (
      <div className="clip-list-empty">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="9" y="2" width="6" height="4" rx="1" />
          <path d="M9 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2H15" />
        </svg>
        <p>No clips yet</p>
        <small>Start copying to build your history</small>
      </div>
    );
  }

  const visiblePinned = pinnedCollapsed ? pinned.slice(0, PINNED_PREVIEW_COUNT) : pinned;
  let absIndex = 0;

  return (
    <div
      className="clip-list"
      ref={listRef}
      role="listbox"
      aria-label="Clipboard history"
      onMouseLeave={() => onSelectIndex(-1)}
    >
      {/* ── Pinned section ── */}
      {pinned.length > 0 && (
        <>
          <div className="clip-list__section-label" role="presentation">
            <span className="clip-list__section-title">
              Pinned
              <span className="clip-list__section-count">{pinned.length}</span>
            </span>
            {pinned.length > PINNED_PREVIEW_COUNT && (
              <button
                className="clip-list__collapse-btn"
                onClick={() => setPinnedCollapsed((v) => !v)}
                aria-label={pinnedCollapsed ? "Show all pinned" : "Collapse pinned"}
                title={pinnedCollapsed ? `Show ${pinned.length - PINNED_PREVIEW_COUNT} more` : "Collapse"}
              >
                {pinnedCollapsed && (
                  <span className="clip-list__more-pill">+{pinned.length - PINNED_PREVIEW_COUNT}</span>
                )}
                <svg
                  className={`clip-list__chevron${pinnedCollapsed ? "" : " clip-list__chevron--open"}`}
                  width="11" height="11" viewBox="0 0 24 24"
                  fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                >
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
            )}
          </div>

          {visiblePinned.map((clip) => {
            const idx = absIndex++;
            return (
              <ClipItem
                key={clip.id}
                clip={clip}
                isSelected={idx === selectedIndex}
                isActivated={activatedId === clip.id}
                isDragOver={dragOverId === clip.id}
                isDragging={dragId === clip.id}
                onCopy={onCopy}
                onTogglePin={onTogglePin}
                onDelete={onDelete}
                onMouseEnter={() => { if (!isPointerDownRef.current) onSelectIndex(idx); }}
                onDragHandlePointerDown={(startY) => startPointerDrag(clip.id, startY)}
              />
            );
          })}

          {regular.length > 0 && <div className="clip-list__divider" role="separator" />}
        </>
      )}

      {/* ── Recent section ── */}
      {regular.length > 0 && (
        <>
          {pinned.length > 0 && (
            <div className="clip-list__section-label" role="presentation">
              <span>Recent</span>
            </div>
          )}
          {regular.map((clip) => {
            const idx = absIndex++;
            return (
              <ClipItem
                key={clip.id}
                clip={clip}
                isSelected={idx === selectedIndex}
                isActivated={activatedId === clip.id}
                isDragOver={dragOverId === clip.id}
                isDragging={dragId === clip.id}
                onCopy={onCopy}
                onTogglePin={onTogglePin}
                onDelete={onDelete}
                onMouseEnter={() => { if (!isPointerDownRef.current) onSelectIndex(idx); }}
                onDragHandlePointerDown={(startY) => startPointerDrag(clip.id, startY)}
              />
            );
          })}
        </>
      )}
    </div>
  );
}
