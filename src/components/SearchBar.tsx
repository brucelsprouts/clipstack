/**
 * SearchBar — the top input field for filtering clipboard history.
 *
 * Auto-focuses when the overlay opens. Shows a clear button when there's
 * text and a keyboard shortcut hint when empty.
 */
import { useEffect, useRef } from "react";

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  /** Whether the parent overlay is currently visible (triggers auto-focus). */
  active: boolean;
}

export function SearchBar({ value, onChange, active }: SearchBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-focus the search input whenever the overlay becomes visible.
  useEffect(() => {
    if (active) {
      // Small timeout ensures the window animation has finished.
      const id = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(id);
    }
  }, [active]);

  return (
    <div className="search-bar">
      <span className="search-icon" aria-hidden="true">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
      </span>

      <input
        ref={inputRef}
        type="text"
        className="search-input"
        placeholder="Search clipboard history…"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Search clipboard history"
        autoComplete="off"
        spellCheck={false}
      />

      {value && (
        <button
          className="search-clear"
          onClick={() => onChange("")}
          aria-label="Clear search"
          tabIndex={-1}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      )}
    </div>
  );
}
