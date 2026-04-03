/**
 * SettingsPanel — settings view for ClipStack.
 *
 * Changes auto-save with a 600ms debounce — no save button required.
 * Theme changes apply immediately for live preview.
 */
import { useRef, useState, useEffect, useCallback } from "react";
import { AppSettings, ThemePreference } from "@/types";
import { ConfirmDialog } from "./ConfirmDialog";
import { openHistoryFolder, openUrl } from "@/lib/api";

interface SettingsPanelProps {
  settings: AppSettings;
  onSave: (next: AppSettings) => Promise<void>;
  onClearAll: () => Promise<void>;
  onClose: () => void;
}

// ── ShortcutRecorder ──────────────────────────────────────────────────────────

interface ShortcutRecorderProps {
  value: string;
  onChange: (shortcut: string) => void;
}

/** Converts a KeyboardEvent into a Tauri-compatible shortcut string. */
function keyEventToShortcut(e: React.KeyboardEvent): string | null {
  const ignored = new Set(["Control", "Shift", "Alt", "Meta", "CapsLock", "Tab"]);
  if (ignored.has(e.key)) return null;

  const parts: string[] = [];
  if (e.ctrlKey  || e.metaKey) parts.push("CommandOrControl");
  if (e.altKey)   parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");

  // Normalize the key name to Tauri's expected format
  let key = e.key;
  if (key.length === 1) key = key.toUpperCase();
  else if (key === "ArrowUp")    key = "Up";
  else if (key === "ArrowDown")  key = "Down";
  else if (key === "ArrowLeft")  key = "Left";
  else if (key === "ArrowRight") key = "Right";
  else if (key === " ")          key = "Space";

  // Require at least one modifier
  if (parts.length === 0) return null;

  parts.push(key);
  return parts.join("+");
}

function ShortcutRecorder({ value, onChange }: ShortcutRecorderProps) {
  const [recording, setRecording] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const shortcut = keyEventToShortcut(e);
    if (shortcut) {
      setPreview(shortcut);
    }
  }, []);

  const handleKeyUp = useCallback((e: React.KeyboardEvent) => {
    e.preventDefault();
    if (preview) {
      onChange(preview);
      setPreview(null);
      setRecording(false);
    }
  }, [preview, onChange]);

  const handleBlur = useCallback(() => {
    setRecording(false);
    setPreview(null);
  }, []);

  // Format shortcut string for display: replace "CommandOrControl" with "Ctrl"
  const display = (s: string) => s.replace("CommandOrControl", "Ctrl");

  return (
    <div
      className={`shortcut-recorder${recording ? " shortcut-recorder--recording" : ""}`}
      tabIndex={0}
      onFocus={() => setRecording(true)}
      onBlur={handleBlur}
      onKeyDown={recording ? handleKeyDown : undefined}
      onKeyUp={recording ? handleKeyUp : undefined}
      role="button"
      aria-label={recording ? "Press keys for shortcut" : `Current shortcut: ${value}`}
    >
      {recording ? (
        <span className="shortcut-recorder__hint">
          {preview ? display(preview) : "Press keys…"}
        </span>
      ) : (
        <span className="shortcut-recorder__keys">{display(value) || "Click to record"}</span>
      )}
      {!recording && (
        <span className="shortcut-recorder__badge">click to change</span>
      )}
    </div>
  );
}

function applyTheme(theme: string) {
  const root = document.documentElement;
  root.classList.add("theme-transitioning");
  // "glass" was removed; fall back to system if an old saved value slips through
  if (theme === "system" || theme === "glass") {
    root.removeAttribute("data-theme");
  } else {
    root.setAttribute("data-theme", theme);
  }
  setTimeout(() => root.classList.remove("theme-transitioning"), 350);
}

type SaveStatus = "idle" | "saving" | "saved" | "error";

export function SettingsPanel({ settings, onSave, onClearAll, onClose }: SettingsPanelProps) {
  const [draft, setDraft] = useState<AppSettings>({ ...settings });
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  const isDirtyRef   = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync draft when settings arrive from backend (initial load, external change).
  useEffect(() => {
    if (!isDirtyRef.current) {
      setDraft({ ...settings });
    }
  }, [settings]);

  // Auto-save with debounce whenever draft changes.
  useEffect(() => {
    if (!isDirtyRef.current) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    setSaveStatus("saving");
    saveTimerRef.current = setTimeout(async () => {
      try {
        await onSave(draft);
        setSaveStatus("saved");
        setTimeout(() => setSaveStatus("idle"), 2000);
      } catch {
        setSaveStatus("error");
        setTimeout(() => setSaveStatus("idle"), 3000);
      }
    }, 600);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [draft, onSave]);

  function set<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
    isDirtyRef.current = true;
    setDraft((prev) => ({ ...prev, [key]: value }));
    if (key === "theme") applyTheme(value as string);
  }

  async function handleClearConfirmed() {
    setShowClearConfirm(false);
    await onClearAll();
  }

  const isUnlimited = draft.maxHistory === 0;

  const statusLabel =
    saveStatus === "saving" ? "Saving…" :
    saveStatus === "saved"  ? "Saved ✓" :
    saveStatus === "error"  ? "Error saving" : null;

  return (
    <>
      <div className="settings-panel">
        <div className="settings-panel__header" data-tauri-drag-region>
          <button className="icon-btn" onClick={onClose} aria-label="Back">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <h2 className="settings-panel__title">Settings</h2>
          <div className="settings-panel__status">
            {statusLabel && (
              <span className={`settings-autosave-badge settings-autosave-badge--${saveStatus}`}>
                {statusLabel}
              </span>
            )}
          </div>
        </div>

        <div className="settings-panel__body">

          {/* ── Shortcut ── */}
          <div className="settings-card">
            <div className="settings-card__header">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="6" width="20" height="12" rx="2" />
                <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8" />
              </svg>
              <span>Global Shortcut</span>
            </div>
            <ShortcutRecorder
              value={draft.shortcut}
              onChange={(v) => set("shortcut", v)}
            />
          </div>

          {/* ── History ── */}
          <div className="settings-card">
            <div className="settings-card__header">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 8v4l3 3" />
                <circle cx="12" cy="12" r="9" />
              </svg>
              <span>History</span>
            </div>
            <div className="settings-row">
              <input
                className="settings-input settings-input--number"
                type="number"
                min={10} max={10000} step={50}
                value={isUnlimited ? "" : draft.maxHistory}
                disabled={isUnlimited}
                placeholder={isUnlimited ? "∞" : ""}
                onChange={(e) => set("maxHistory", Math.max(10, Number(e.target.value)))}
              />
              <label className="settings-checkbox">
                <input
                  type="checkbox"
                  checked={isUnlimited}
                  onChange={(e) => set("maxHistory", e.target.checked ? 0 : 500)}
                />
                <span>Unlimited</span>
              </label>
              <button
                className="btn btn--secondary btn--sm"
                onClick={() => openHistoryFolder().catch(console.error)}
                title="Open the folder containing your clipboard history"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                </svg>
                Open Folder
              </button>
            </div>
          </div>

          {/* ── Appearance ── */}
          <div className="settings-card">
            <div className="settings-card__header">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="5" />
                <line x1="12" y1="1" x2="12" y2="3" />
                <line x1="12" y1="21" x2="12" y2="23" />
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                <line x1="1" y1="12" x2="3" y2="12" />
                <line x1="21" y1="12" x2="23" y2="12" />
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
              </svg>
              <span>Appearance</span>
            </div>
            <div className="settings-theme-grid" role="group" aria-label="Theme">
              {([
                { value: "system", label: "Auto",  desc: "Follow system" },
                { value: "light",  label: "Light", desc: "Always light" },
                { value: "dark",   label: "Dark",  desc: "Always dark" },
              ] as { value: ThemePreference; label: string; desc: string }[]).map(({ value, label, desc }) => (
                <label
                  key={value}
                  className={`settings-theme-option${draft.theme === value ? " settings-theme-option--active" : ""}`}
                >
                  <input
                    type="radio"
                    name="theme"
                    value={value}
                    checked={draft.theme === value}
                    onChange={() => set("theme", value)}
                  />
                  <span className="settings-theme-option__label">{label}</span>
                  <span className="settings-theme-option__desc">{desc}</span>
                </label>
              ))}
            </div>
          </div>

          {/* ── Startup ── */}
          <div className="settings-card settings-card--row">
            <div className="settings-card__header">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
              </svg>
              <span>Launch at startup</span>
            </div>
            <label className="toggle">
              <input
                type="checkbox"
                checked={draft.launchAtStartup}
                onChange={(e) => set("launchAtStartup", e.target.checked)}
              />
              <span className="toggle__track" />
            </label>
          </div>

          {/* ── Danger ── */}
          <div className="settings-card settings-card--danger">
            <div className="settings-card__header">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
              <span>Danger Zone</span>
            </div>
            <button className="btn btn--danger btn--sm" onClick={() => setShowClearConfirm(true)}>
              Clear All History
            </button>
          </div>

          {/* ── Watermark ── */}
          <div className="settings-watermark">
            <span>ClipStack</span>
            <span className="settings-watermark__sep">·</span>
            <span>v0.1.0</span>
            <span className="settings-watermark__sep">·</span>
            <button
              className="settings-watermark__link"
              onClick={() => openUrl("https://github.com/brucelsprouts/clipstack").catch(console.error)}
            >
              GitHub ↗
            </button>
          </div>

        </div>
      </div>

      {showClearConfirm && (
        <ConfirmDialog
          title="Clear All History?"
          message="This will permanently delete all clipboard history. This cannot be undone."
          confirmLabel="Yes, clear all"
          cancelLabel="Cancel"
          danger
          onConfirm={handleClearConfirmed}
          onCancel={() => setShowClearConfirm(false)}
        />
      )}
    </>
  );
}
