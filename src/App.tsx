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
import { applyTheme } from "@/lib/theme";

type View = "clips" | "settings";

export default function App() {
  const [view, setView] = useState<View>("clips");
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [focusKey, setFocusKey] = useState(0);
  const appRef = useRef<HTMLDivElement>(null);
  const [isClosing, setIsClosing] = useState(false);
  const [activatedId, setActivatedId] = useState<number | null>(null);

  const closingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pasteTimerRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isDraggingRef   = useRef(false);
  // Set to true only when Arrow Up/Down triggered the selection change so that
  // ClipList knows to scroll the selected item into view.
  const keyboardNavRef  = useRef(false);

  const {
    clips, loading, error: clipError,
    search, setSearch,
    handleCopy, handleTogglePin, handleDelete, handleClearAll,
    refresh,
  } = useClips();

  const { settings, saveSettings } = useSettings();

  // Persist the new order then refresh so the list reflects the DB order.
  const handleReorder = useCallback(async (orderedIds: number[]) => {
    await reorderClips(orderedIds).catch(console.error);
    await refresh().catch(console.error);
  }, [refresh]);

  // Apply theme whenever settings change.
  useEffect(() => {
    applyTheme(settings.theme);
  }, [settings.theme]);

  // Re-trigger entrance animation each time the window is shown.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen("tauri://focus", () => {
      if (closingTimerRef.current) { clearTimeout(closingTimerRef.current); closingTimerRef.current = null; }
      if (pasteTimerRef.current)   { clearTimeout(pasteTimerRef.current);   pasteTimerRef.current   = null; }
      setIsClosing(false);
      setActivatedId(null);
      setSelectedIndex(-1);
      setFocusKey((k) => k + 1);
      setView("clips");
    }).then((fn) => { unlisten = fn; });
    return () => unlisten?.();
  }, []);

  useEffect(() => {
    const onDown = () => { isDraggingRef.current = true;  };
    const onUp   = () => { isDraggingRef.current = false; };
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("mouseup",   onUp,   true);
    return () => {
      document.removeEventListener("mousedown", onDown, true);
      document.removeEventListener("mouseup",   onUp,   true);
    };
  }, []);

  useLayoutEffect(() => {
    if (focusKey === 0 || isDraggingRef.current) return;
    const el = appRef.current;
    if (!el) return;
    el.style.animation = "none";
    void el.offsetHeight;
    el.style.animation = "";
  }, [focusKey]);

  const handleSearch = useCallback((q: string) => {
    setSearch(q);
    setSelectedIndex(0);
  }, [setSearch]);

  const handleCopyAndPaste = useCallback(
    async (id: number) => {
      const clip = clips.find((c) => c.id === id);
      if (clip?.kind === "image") {
        await handleCopy(id);
        try {
          const mime = clip.content.startsWith("iVBOR") ? "image/png" : "image/bmp";
          const raw = atob(clip.content);
          const buf = new Uint8Array(raw.length);
          for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i);
          await navigator.clipboard.write([
            new ClipboardItem({ [mime]: new Blob([buf], { type: mime }) }),
          ]);
        } catch { /* Web Clipboard API unavailable — Rust write is fallback */ }
      } else {
        await handleCopy(id);
      }
      setActivatedId(id);
      setTimeout(() => {
        setIsClosing(true);
        setTimeout(() => { pasteAndHide().catch(console.error); }, 160);
      }, 80);
    },
    [handleCopy, clips]
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
    keyboardNavRef,
  });

  const inSettings = view === "settings";

  return (
    <div ref={appRef} className={`app${isClosing ? " app--closing" : ""}`}>
      {/* View stack — both views stay mounted so the slide transition is smooth */}
      <div className="view-stack">

        {/* ── Clips view ── */}
        <div className={`view${inSettings ? " view--slid-left" : ""}`}>
          <header className="app-header" data-tauri-drag-region>
            <div className="app-header__brand" data-tauri-drag-region>
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

          <SearchBar value={search} onChange={handleSearch} active={!inSettings} />

          <main className="app-main">
            {loading ? (
              <div className="app-loading"><div className="spinner" /></div>
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
                keyboardNavRef={keyboardNavRef}
              />
            )}
          </main>

          <footer className="app-footer">
            <span className="app-footer__count">
              {loading ? "…" : `${clips.length} clip${clips.length !== 1 ? "s" : ""}`}
            </span>
            <span className="app-footer__watermark">brucelsprouts</span>
          </footer>
        </div>

        {/* ── Settings view ── */}
        <div className={`view${!inSettings ? " view--slid-right" : ""}`}>
          <SettingsPanel
            settings={settings}
            onSave={saveSettings}
            onClearAll={handleClearAll}
            onClose={() => setView("clips")}
          />
        </div>

      </div>
    </div>
  );
}
