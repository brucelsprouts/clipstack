/**
 * ClipList — scrollable list of clipboard entries.
 *
 * Pinned clips appear first in a collapsible group (auto-collapsed when >4).
 * All clips support drag-to-reorder within their group.
 */
import { useCallback, useRef, useEffect, useState } from "react";
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
}: ClipListProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const [pinnedCollapsed, setPinnedCollapsed] = useState(false);
  const [dragId, setDragId] = useState<number | null>(null);
  const [dragOverId, setDragOverId] = useState<number | null>(null);

  const pinned = clips.filter((c) => c.pinned);
  const regular = clips.filter((c) => !c.pinned);

  // Auto-collapse pinned section when many items are pinned.
  useEffect(() => {
    if (pinned.length > PINNED_PREVIEW_COUNT) {
      setPinnedCollapsed(true);
    }
  }, [pinned.length]);

  // Scroll selected item into view on keyboard navigation.
  useEffect(() => {
    if (selectedIndex < 0 || !listRef.current) return;
    const items = listRef.current.querySelectorAll<HTMLElement>("[data-clip-item]");
    items[selectedIndex]?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selectedIndex]);

  // ── Drag-to-reorder ───────────────────────────────────────────────────────

  const handleDragStart = useCallback((id: number) => setDragId(id), []);
  const handleDragOver  = useCallback((id: number) => setDragOverId(id), []);
  const handleDragEnd   = useCallback(() => { setDragId(null); setDragOverId(null); }, []);

  const handleDrop = useCallback(
    (dropOnId: number) => {
      if (!dragId || dragId === dropOnId || !onReorder) {
        setDragId(null); setDragOverId(null); return;
      }
      const dragClip = clips.find((c) => c.id === dragId);
      const dropClip = clips.find((c) => c.id === dropOnId);
      // Only allow reorder within the same group (pinned↔pinned, regular↔regular).
      if (!dragClip || !dropClip || dragClip.pinned !== dropClip.pinned) {
        setDragId(null); setDragOverId(null); return;
      }
      const group = dragClip.pinned ? pinned : regular;
      const from = group.findIndex((c) => c.id === dragId);
      const to   = group.findIndex((c) => c.id === dropOnId);
      if (from === to) { setDragId(null); setDragOverId(null); return; }
      const reordered = [...group];
      const [moved] = reordered.splice(from, 1);
      reordered.splice(to, 0, moved);
      onReorder(reordered.map((c) => c.id));
      setDragId(null); setDragOverId(null);
    },
    [dragId, clips, pinned, regular, onReorder]
  );

  if (clips.length === 0) {
    return (
      <div className="clip-list-empty">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="9" y="2" width="6" height="4" rx="1" />
          <path d="M5 4h-1a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-1" />
        </svg>
        <p>No clips yet</p>
        <small>Start copying to build your history</small>
      </div>
    );
  }

  const visiblePinned = pinnedCollapsed ? pinned.slice(0, PINNED_PREVIEW_COUNT) : pinned;
  let absIndex = 0;

  return (
    <div className="clip-list" ref={listRef} role="listbox" aria-label="Clipboard history"
      onMouseLeave={() => onSelectIndex(-1)}
    >
      {/* ── Pinned section ── */}
      {pinned.length > 0 && (
        <>
          <div className="clip-list__section-label" role="presentation">
            <span>Pinned</span>
            {pinned.length > PINNED_PREVIEW_COUNT && (
              <button
                className="clip-list__collapse-btn"
                onClick={() => setPinnedCollapsed((v) => !v)}
                aria-label={pinnedCollapsed ? "Show all pinned" : "Collapse pinned"}
              >
                {pinnedCollapsed ? `Show ${pinned.length - PINNED_PREVIEW_COUNT} more` : "Collapse"}
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
                onMouseEnter={() => onSelectIndex(idx)}
                onDragStart={() => handleDragStart(clip.id)}
                onDragOver={() => handleDragOver(clip.id)}
                onDrop={() => handleDrop(clip.id)}
                onDragEnd={handleDragEnd}
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
                onMouseEnter={() => onSelectIndex(idx)}
                onDragStart={() => handleDragStart(clip.id)}
                onDragOver={() => handleDragOver(clip.id)}
                onDrop={() => handleDrop(clip.id)}
                onDragEnd={handleDragEnd}
              />
            );
          })}
        </>
      )}
    </div>
  );
}
