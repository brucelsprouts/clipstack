/**
 * Shared TypeScript types for ClipStack.
 *
 * These types mirror the Rust structs and DTOs exposed via Tauri commands.
 * Keeping them in one place ensures the frontend never drifts from the backend.
 */

// ─── Clip ─────────────────────────────────────────────────────────────────────

/** The kind of content a clip holds. */
export type ClipKind = "text" | "image" | "html";

/** A single clipboard entry returned from the Rust backend. */
export interface Clip {
  id: number;
  kind: ClipKind;
  /** Plain text content OR base64-encoded PNG data URI for images. */
  content: string;
  /** Unix timestamp in milliseconds. */
  createdAt: number;
  pinned: boolean;
  /** Short human-readable label used for search and display. */
  preview: string;
}

// ─── Settings ─────────────────────────────────────────────────────────────────

/** Theme preference: follow system, force dark, or force light. */
export type ThemePreference = "system" | "dark" | "light";

/** Settings object passed between frontend and backend. */
export interface AppSettings {
  /** Global keyboard shortcut string, e.g. "CommandOrControl+Shift+V". */
  shortcut: string;
  /** Maximum number of non-pinned clips to retain. */
  maxHistory: number;
  /** Whether the app should launch on system startup. */
  launchAtStartup: boolean;
  /** Process names whose clipboard events are ignored. */
  excludedApps: string[];
  /** Theme override: "system" | "dark" | "light". */
  theme: ThemePreference;
}

// ─── Events ───────────────────────────────────────────────────────────────────

/** Tauri event name emitted when a new clip is added. */
export const EVENT_CLIP_ADDED = "clip-added" as const;
