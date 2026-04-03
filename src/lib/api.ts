/**
 * Typed API layer between React and the Tauri Rust backend.
 */
import { invoke } from "@tauri-apps/api/core";
import { AppSettings, Clip } from "@/types";

// ─── Clips ────────────────────────────────────────────────────────────────────

/** Fetch clipboard history, optionally filtered by a search string.
 *  Pass limit=0 for unlimited results. */
export async function getClips(search?: string, limit?: number): Promise<Clip[]> {
  return invoke<Clip[]>("get_clips", {
    search: search || null,
    limit: limit ?? 500,
  });
}

export async function copyClip(id: number): Promise<void> {
  return invoke<void>("copy_clip", { id });
}

export async function togglePin(id: number): Promise<void> {
  return invoke<void>("toggle_pin", { id });
}

export async function deleteClip(id: number): Promise<void> {
  return invoke<void>("delete_clip", { id });
}

export async function clearAllClips(): Promise<void> {
  return invoke<void>("clear_all_clips");
}

// ─── Settings ─────────────────────────────────────────────────────────────────

export async function getSettings(): Promise<AppSettings> {
  return invoke<AppSettings>("get_settings");
}

export async function updateSettings(settings: AppSettings): Promise<void> {
  return invoke<void>("update_settings", { payload: settings });
}

// ─── Window ───────────────────────────────────────────────────────────────────

export async function hideWindow(): Promise<void> {
  return invoke<void>("hide_window");
}

/** Hide the window and inject a paste keystroke into the previously focused app. */
export async function pasteAndHide(): Promise<void> {
  return invoke<void>("paste_and_hide");
}

/** Persist a new drag-reordered sequence for one group (pinned or regular). */
export async function reorderClips(orderedIds: number[]): Promise<void> {
  return invoke<void>("reorder_clips", { orderedIds });
}

// ─── Utility ──────────────────────────────────────────────────────────────────

/** Open the app data directory in the system file manager. */
export async function openHistoryFolder(): Promise<void> {
  return invoke<void>("open_history_folder");
}

/** Open a URL in the system default browser. */
export async function openUrl(url: string): Promise<void> {
  return invoke<void>("open_url", { url });
}
