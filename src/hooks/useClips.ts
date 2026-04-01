/**
 * useClips — manages clipboard history state.
 *
 * Loads clips on mount, subscribes to the `clip-added` Tauri event so the
 * list refreshes automatically whenever a new copy is detected, and exposes
 * handlers for all user-initiated actions (copy, pin, delete, clear).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  clearAllClips,
  copyClip,
  deleteClip,
  getClips,
  togglePin,
} from "@/lib/api";
import { Clip, EVENT_CLIP_ADDED } from "@/types";

interface UseClipsResult {
  clips: Clip[];
  loading: boolean;
  error: string | null;
  search: string;
  setSearch: (query: string) => void;
  handleCopy: (id: number) => Promise<void>;
  handleTogglePin: (id: number) => Promise<void>;
  handleDelete: (id: number) => Promise<void>;
  handleClearAll: () => Promise<void>;
  refresh: () => Promise<void>;
}

export function useClips(): UseClipsResult {
  const [clips, setClips] = useState<Clip[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearchState] = useState("");

  // Keep the latest search value accessible in the event callback
  // without causing the listener to re-register on every keystroke.
  const searchRef = useRef(search);
  searchRef.current = search;

  // ── Data loading ──────────────────────────────────────────────────────────

  const refresh = useCallback(async () => {
    try {
      setError(null);
      const data = await getClips(searchRef.current || undefined);
      setClips(data);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Search with debounce ─────────────────────────────────────────────────

  const setSearch = useCallback((query: string) => {
    setSearchState(query);
  }, []);

  // Re-fetch whenever the search query changes (debounced 150ms).
  useEffect(() => {
    const timer = setTimeout(async () => {
      try {
        setError(null);
        const data = await getClips(search || undefined);
        setClips(data);
      } catch (e) {
        setError(String(e));
      }
    }, 150);
    return () => clearTimeout(timer);
  }, [search]);

  // ── Initial load + event subscription ────────────────────────────────────

  useEffect(() => {
    refresh();

    // Subscribe to new-clip events from the Rust clipboard monitor.
    let unlisten: (() => void) | undefined;
    listen(EVENT_CLIP_ADDED, () => {
      // Debounce rapid-fire events (e.g. paste + copy in quick succession).
      refresh();
    }).then((fn) => {
      unlisten = fn;
    });

    return () => unlisten?.();
  }, [refresh]);

  // ── Action handlers ───────────────────────────────────────────────────────

  const handleCopy = useCallback(async (id: number) => {
    await copyClip(id);
  }, []);

  const handleTogglePin = useCallback(
    async (id: number) => {
      await togglePin(id);
      await refresh();
    },
    [refresh]
  );

  const handleDelete = useCallback(
    async (id: number) => {
      await deleteClip(id);
      setClips((prev) => prev.filter((c) => c.id !== id));
    },
    []
  );

  const handleClearAll = useCallback(async () => {
    await clearAllClips();
    setClips([]);
  }, []);

  return {
    clips,
    loading,
    error,
    search,
    setSearch,
    handleCopy,
    handleTogglePin,
    handleDelete,
    handleClearAll,
    refresh,
  };
}
