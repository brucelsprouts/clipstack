/**
 * useKeyboard — global keyboard event handling within the overlay window.
 *
 * Handles:
 *   - Escape → hide the window
 *   - Arrow Up/Down → move selection through the clip list
 *   - Enter → copy the selected clip
 */
import { useEffect, MutableRefObject } from "react";
import { hideWindow } from "@/lib/api";

interface UseKeyboardOptions {
  itemCount: number;
  selectedIndex: number;
  onSelectIndex: (index: number) => void;
  onConfirm: (index: number) => void;
  /** Set to true before each keyboard-driven selection so ClipList can scroll. */
  keyboardNavRef: MutableRefObject<boolean>;
}

export function useKeyboard({
  itemCount,
  selectedIndex,
  onSelectIndex,
  onConfirm,
  keyboardNavRef,
}: UseKeyboardOptions): void {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      switch (e.key) {
        case "Escape":
          e.preventDefault();
          hideWindow();
          break;

        case "ArrowDown":
          e.preventDefault();
          keyboardNavRef.current = true;
          onSelectIndex(Math.min(selectedIndex + 1, itemCount - 1));
          break;

        case "ArrowUp":
          e.preventDefault();
          keyboardNavRef.current = true;
          onSelectIndex(Math.max(selectedIndex - 1, 0));
          break;

        case "Enter":
          e.preventDefault();
          if (selectedIndex >= 0) {
            onConfirm(selectedIndex);
          }
          break;
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [itemCount, selectedIndex, onSelectIndex, onConfirm, keyboardNavRef]);
}
