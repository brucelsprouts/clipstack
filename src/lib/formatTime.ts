/**
 * Format a Unix timestamp (ms) as a human-readable relative time string.
 * e.g. "just now", "2 min ago", "3 hours ago", "Yesterday", "Mar 12"
 */
export function formatRelativeTime(timestampMs: number): string {
  const now = Date.now();
  const diff = now - timestampMs; // ms since the clip was copied

  if (diff < 10_000) return "just now";
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 172_800_000) return "Yesterday";

  const date = new Date(timestampMs);
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
