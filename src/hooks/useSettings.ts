/**
 * useSettings — loads and persists application settings.
 *
 * Autostart is managed here via the @tauri-apps/plugin-autostart JS API
 * rather than from the Rust backend, which avoids a generic trait resolution
 * issue with AppHandle<R> and keeps the architecture cleaner.
 */
import { useCallback, useEffect, useState } from "react";
import { enable, disable } from "@tauri-apps/plugin-autostart";
import { getSettings, updateSettings } from "@/lib/api";
import { AppSettings } from "@/types";

const DEFAULT_SETTINGS: AppSettings = {
  shortcut: "Alt+Shift+V",
  maxHistory: 500,
  launchAtStartup: true,
  excludedApps: [],
  theme: "system",
};

interface UseSettingsResult {
  settings: AppSettings;
  loading: boolean;
  error: string | null;
  saveSettings: (next: AppSettings) => Promise<void>;
}

export function useSettings(): UseSettingsResult {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getSettings()
      .then((s) => setSettings(s))
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  const saveSettings = useCallback(async (next: AppSettings) => {
    try {
      setError(null);
      // Persist all settings to the Rust backend (SQLite + in-memory state).
      await updateSettings(next);
      // Apply the autostart toggle via the OS-level JS plugin.
      if (next.launchAtStartup) {
        await enable();
      } else {
        await disable();
      }
      setSettings(next);
    } catch (e) {
      setError(String(e));
      throw e;
    }
  }, []);

  return { settings, loading, error, saveSettings };
}
