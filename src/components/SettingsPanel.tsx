/**
 * SettingsPanel — settings view for ClipStack.
 */
import { useRef, useState } from "react";
import { AppSettings, ThemePreference } from "@/types";
import { ConfirmDialog } from "./ConfirmDialog";
import { openHistoryFolder } from "@/lib/api";

interface SettingsPanelProps {
  settings: AppSettings;
  onSave: (next: AppSettings) => Promise<void>;
  onClearAll: () => Promise<void>;
  onClose: () => void;
}

function applyTheme(theme: string) {
  if (theme === "system") {
    document.documentElement.removeAttribute("data-theme");
  } else {
    document.documentElement.setAttribute("data-theme", theme);
  }
}

export function SettingsPanel({ settings, onSave, onClearAll, onClose }: SettingsPanelProps) {
  const [draft, setDraft] = useState<AppSettings>({ ...settings });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  // Remember the theme at the time settings panel opened so Cancel can revert it.
  const originalTheme = useRef(settings.theme);

  const isUnlimited = draft.maxHistory === 0;

  function set<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }));
    // Apply theme immediately so the user sees the change without saving.
    if (key === "theme") applyTheme(value as string);
  }

  function handleCancel() {
    // Revert any live theme preview back to the saved value.
    applyTheme(originalTheme.current);
    onClose();
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await onSave(draft);
      originalTheme.current = draft.theme;
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  async function handleClearConfirmed() {
    setShowClearConfirm(false);
    await onClearAll();
  }

  return (
    <>
      <div className="settings-panel">
        <div className="settings-panel__header" data-tauri-drag-region>
          <button className="icon-btn" onClick={handleCancel} aria-label="Back">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <h2 className="settings-panel__title">Settings</h2>
          <button className="icon-btn icon-btn--close" onClick={handleCancel} aria-label="Close">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="settings-panel__body">
          {/* Keyboard shortcut */}
          <section className="settings-section">
            <label className="settings-label" htmlFor="shortcut">Global Shortcut</label>
            <input
              id="shortcut"
              className="settings-input"
              value={draft.shortcut}
              onChange={(e) => set("shortcut", e.target.value)}
              placeholder="e.g. CommandOrControl+Shift+V"
              spellCheck={false}
            />
            <p className="settings-hint">
              Modifiers: <code>CommandOrControl</code> <code>Alt</code> <code>Shift</code>
            </p>
          </section>

          {/* History limit */}
          <section className="settings-section">
            <label className="settings-label">History Limit</label>
            <div className="settings-row">
              <input
                className="settings-input settings-input--number"
                type="number"
                min={10}
                max={10000}
                step={50}
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
                title="Open the folder containing your clipboard history database"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                </svg>
                Open Folder
              </button>
            </div>
          </section>

          {/* Appearance */}
          <section className="settings-section">
            <span className="settings-label">Appearance</span>
            <div className="settings-radio-group" role="group">
              {(["system", "light", "dark"] as ThemePreference[]).map((t) => (
                <label key={t} className="settings-radio">
                  <input
                    type="radio"
                    name="theme"
                    value={t}
                    checked={draft.theme === t}
                    onChange={() => set("theme", t)}
                  />
                  <span>{t.charAt(0).toUpperCase() + t.slice(1)}</span>
                </label>
              ))}
            </div>
          </section>

          {/* Launch at startup */}
          <section className="settings-section settings-section--toggle">
            <span className="settings-label">Launch at startup</span>
            <label className="toggle">
              <input
                type="checkbox"
                checked={draft.launchAtStartup}
                onChange={(e) => set("launchAtStartup", e.target.checked)}
              />
              <span className="toggle__track" />
            </label>
          </section>

          {/* Danger zone */}
          <section className="settings-section settings-section--danger">
            <span className="settings-label">Danger Zone</span>
            <button className="btn btn--danger btn--sm" onClick={() => setShowClearConfirm(true)}>
              Clear All History
            </button>
          </section>

          {error && <p className="settings-error">{error}</p>}
        </div>

        <div className="settings-panel__footer">
          <button className="btn btn--secondary" onClick={handleCancel} disabled={saving}>Cancel</button>
          <button className="btn btn--primary" onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : saved ? "Saved ✓" : "Save Changes"}
          </button>
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
