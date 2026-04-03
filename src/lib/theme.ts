/**
 * Apply a theme to the document root with a smooth CSS transition.
 * "system" removes the data-theme attribute, letting the OS preference decide.
 * "glass" was removed; stored values fall back to system silently.
 */
export function applyTheme(theme: string) {
  const root = document.documentElement;
  root.classList.add("theme-transitioning");
  if (theme === "system" || theme === "glass") {
    root.removeAttribute("data-theme");
  } else {
    root.setAttribute("data-theme", theme);
  }
  setTimeout(() => root.classList.remove("theme-transitioning"), 350);
}
