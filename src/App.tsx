/**
 * App — root component for ClipStack.
 */
import { useState, useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { useClips } from "@/hooks/useClips";
import { useSettings } from "@/hooks/useSettings";
import { useKeyboard } from "@/hooks/useKeyboard";
import { SearchBar } from "@/components/SearchBar";
import { ClipList } from "@/components/ClipList";
import { SettingsPanel } from "@/components/SettingsPanel";
import { pasteAndHide, reorderClips } from "@/lib/api";

type View = "clips" | "settings";

export default function App() {
  const [view, setView] = useState<View>("clips");
  // -1 = nothing highlighted; only highlight on hover/keyboard nav
  const [selectedIndex, setSelectedIndex] = useState(-1);
  // Incremented each time the window gains focus to re-trigger entrance animation.
  const [focusKey, setFocusKey] = useState(0);
  const appRef = useRef<HTMLDivElement>(null);
  const [isClosing, setIsClosing] = useState(false);
  // ID of the clip that was just activated (clicked) — shows accent flash
  const [activatedId, setActivatedId] = useState<number | null>(null);

  // Refs for pending hide timers so they can be cancelled if the window re-opens.
  const closingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pasteTimerRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Set true between mousedown and mouseup to suppress animation restarts during drags.
  const isDraggingRef = useRef(false);

  const {
    clips,
    loading,
    error: clipError,
    search,
    setSearch,
    handleCopy,
    handleTogglePin,
    handleDelete,
    handleClearAll,
  } = useClips();

  const { settings, loading: settingsLoading, saveSettings } = useSettings();

  const handleReorder = useCallback(async (orderedIds: number[]) => {
    await reorderClips(orderedIds).catch(console.error);
  }, []);

  // Apply the user's theme preference to the document root so CSS vars kick in.
  useEffect(() => {
    const theme = settings.theme;
    if (theme === "system") {
      document.documentElement.removeAttribute("data-theme");
    } else {
      document.documentElement.setAttribute("data-theme", theme);
    }
  }, [settings.theme]);

  // Re-trigger entrance animation each time the window is shown.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen("tauri://focus", () => {
      // Cancel any pending hide timers — window re-opened before they fired.
      if (closingTimerRef.current) { clearTimeout(closingTimerRef.current); closingTimerRef.current = null; }
      if (pasteTimerRef.current)   { clearTimeout(pasteTimerRef.current);   pasteTimerRef.current   = null; }
      setIsClosing(false);
      setActivatedId(null);
      setSelectedIndex(-1);
      setFocusKey((k) => k + 1);
      setView("clips");
    }).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, []);

  // Track pointer drag state so animation restart is suppressed mid-drag.
  // useRef keeps the value stable; listeners use capture so they fire first.
  useEffect(() => {
    const onDown = () => { isDraggingRef.current = true;  };
    const onUp   = () => { isDraggingRef.current = false; };
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('mouseup',   onUp,   true);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('mouseup',   onUp,   true);
    };
  }, []);

  // Restart the entrance animation in-place without remounting the tree.
  // useLayoutEffect runs before paint, preventing the one-frame opacity-1→0 flash.
  // Skip on initial mount (focusKey=0) and during any pointer drag.
  useLayoutEffect(() => {
    if (focusKey === 0 || isDraggingRef.current) return;
    const el = appRef.current;
    if (!el) return;
    el.style.animation = 'none';
    void el.offsetHeight; // force reflow so the browser registers the reset
    el.style.animation = '';
  }, [focusKey]);

  const handleSearch = useCallback(
    (q: string) => {
      setSearch(q);
      setSelectedIndex(0);
    },
    [setSearch]
  );

  // Copy clip, flash the item, fade-shrink the window, then paste into previous app.
  const handleCopyAndPaste = useCallback(
    (id: number) => {
      handleCopy(id);
      setActivatedId(id);          // accent flash on the clicked item
      setTimeout(() => {
        setIsClosing(true);        // window starts fade+scale-down
        setTimeout(() => {
          pasteAndHide().catch(console.error);
        }, 160);
      }, 80);
    },
    [handleCopy]
  );

  const handleConfirmSelection = useCallback(
    (index: number) => {
      const clip = clips[index];
      if (clip) handleCopyAndPaste(clip.id);
    },
    [clips, handleCopyAndPaste]
  );

  useKeyboard({
    itemCount: clips.length,
    selectedIndex,
    onSelectIndex: setSelectedIndex,
    onConfirm: handleConfirmSelection,
  });

  return (
    <div ref={appRef} className={`app${isClosing ? " app--closing" : ""}`}>
      {view === "clips" ? (
        <div key="clips" className="view">
          <header className="app-header" data-tauri-drag-region>
            <div className="app-header__brand" data-tauri-drag-region>
              {/* pointer-events:none so the SVG doesn't swallow the drag region */}
              <svg width="22" height="22" viewBox="1 1 20 20" aria-hidden="true" style={{ pointerEvents: "none" }}>
                <rect x="3.5" y="5.5" width="13" height="15" rx="2" fill="#93c5fd" opacity="0.70" transform="rotate(-5 10 13)"/>
                <rect x="3.5" y="5.5" width="13" height="15" rx="2" fill="#bfdbfe" opacity="0.88" transform="rotate(-2 10 13)"/>
                <rect x="3" y="5" width="13" height="15" rx="2" fill="#dbeafe"/>
                <rect x="7" y="3" width="5.5" height="4" rx="1.2" fill="#1e40af"/>
                <rect x="7.5" y="3.4" width="4.5" height="2.6" rx="0.8" fill="#3b82f6" opacity="0.55"/>
                <rect x="5.5" y="10"   width="8"   height="1.6" rx="0.8" fill="#2563eb" opacity="0.85"/>
                <rect x="5.5" y="12.5" width="6.5" height="1.4" rx="0.7" fill="#2563eb" opacity="0.45"/>
                <rect x="5.5" y="14.8" width="7.5" height="1.4" rx="0.7" fill="#2563eb" opacity="0.40"/>
                <rect x="5.5" y="17"   width="5.5" height="1.4" rx="0.7" fill="#2563eb" opacity="0.35"/>
              </svg>
              <span className="app-header__title">ClipStack</span>
            </div>
            <div className="app-header__actions">
              <button
                className="icon-btn"
                onClick={() => setView("settings")}
                aria-label="Settings"
                title="Settings"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                </svg>
              </button>
              <button
                className="icon-btn icon-btn--close"
                onClick={() => { setIsClosing(true); setTimeout(() => pasteAndHide().catch(console.error), 170); }}
                aria-label="Close"
                title="Close"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          </header>

          <SearchBar value={search} onChange={handleSearch} active={true} />

          <main className="app-main">
            {loading ? (
              <div className="app-loading">
                <div className="spinner" />
              </div>
            ) : clipError ? (
              <div className="app-error">
                <p>Failed to load history</p>
                <small>{clipError}</small>
              </div>
            ) : (
              <ClipList
                clips={clips}
                selectedIndex={selectedIndex}
                onSelectIndex={setSelectedIndex}
                onCopy={handleCopyAndPaste}
                onTogglePin={handleTogglePin}
                onDelete={handleDelete}
                activatedId={activatedId}
                onReorder={handleReorder}
              />
            )}
          </main>

          <footer className="app-footer">
            <span className="app-footer__count">
              {loading ? "…" : `${clips.length} clip${clips.length !== 1 ? "s" : ""}`}
            </span>
          </footer>
        </div>
      ) : (
        !settingsLoading && (
          <div key="settings" className="view">
            <SettingsPanel
              settings={settings}
              onSave={saveSettings}
              onClearAll={handleClearAll}
              onClose={() => setView("clips")}
            />
          </div>
        )
      )}
    </div>
  );
}
