// The site's colour scheme, and the one place that decides how it is applied.
//
// Three states, not two. "Sistema" is a real choice rather than the absence
// of one — it follows the OS as the OS changes (a laptop that goes dark at
// sunset), which neither "claro" nor "escuro" does — and it stays the
// default, so nothing moves for anyone who never opens the switch.
//
// Whatever it resolves to is written to `<html data-theme>`, which is what
// every Tailwind `dark:` utility keys off (see globals.css's
// `@custom-variant dark`). Before this, `dark:` meant the
// prefers-color-scheme media query and there was nothing to toggle.

export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "sharescreen:theme";
export const SYSTEM_DARK_QUERY = "(prefers-color-scheme: dark)";

// Runs in the document before anything paints, so it is a string of plain ES5
// rather than an import: at that point no bundle has loaded, and the theme is
// the one thing that cannot wait for React without the page flashing white
// first. It lives here, next to the code it mirrors, so the storage key and
// the attribute can't quietly drift apart. See app/layout.tsx.
export const THEME_INIT_SCRIPT = `(function(){try{var k=${JSON.stringify(
  THEME_STORAGE_KEY
)};var p=localStorage.getItem(k);if(p!=="light"&&p!=="dark")p="system";var d=p==="dark"||(p==="system"&&window.matchMedia(${JSON.stringify(
  SYSTEM_DARK_QUERY
)}).matches);var r=document.documentElement;r.setAttribute("data-theme",d?"dark":"light");r.style.colorScheme=d?"dark":"light";}catch(e){}})();`;

function readStoredPreference(): ThemePreference {
  if (typeof window === "undefined") return "system";
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
    return raw === "light" || raw === "dark" ? raw : "system";
  } catch {
    // localStorage may be unavailable (private mode, quota, embedded views).
    return "system";
  }
}

function writeStoredPreference(value: ThemePreference) {
  if (typeof window === "undefined") return;
  try {
    // "system" is stored as the absence of a choice rather than as the word,
    // so a browser that has never been told anything and one that was told
    // "sistema" behave identically.
    if (value === "system") window.localStorage.removeItem(THEME_STORAGE_KEY);
    else window.localStorage.setItem(THEME_STORAGE_KEY, value);
  } catch {
    // ignored — same reasons as above; the preference just won't survive.
  }
}

export function getSystemTheme(): ResolvedTheme {
  if (typeof window === "undefined" || !window.matchMedia) return "light";
  return window.matchMedia(SYSTEM_DARK_QUERY).matches ? "dark" : "light";
}

export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  return preference === "system" ? getSystemTheme() : preference;
}

// A module-level store rather than per-component state: the switch lives in
// two different places (the site header and the room's "Mais opções"), and
// two more components render off the *resolved* answer (the popup library and
// the world map). All of them have to move together.
let preference: ThemePreference | null = null;
let resolved: ResolvedTheme = "light";
const listeners = new Set<() => void>();
let watchingSystem = false;

function emit() {
  for (const listener of listeners) listener();
}

// Writes the answer onto <html> — the same two properties the init script
// sets, so the running app and the pre-paint script never disagree.
// `color-scheme` is what gets the browser's own furniture (form controls, the
// scrollbar gutter, the canvas behind the page) to match.
function paint(next: ResolvedTheme) {
  resolved = next;
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.setAttribute("data-theme", next);
  root.style.colorScheme = next;
}

export function getThemePreference(): ThemePreference {
  if (preference === null) {
    preference = readStoredPreference();
    resolved = resolveTheme(preference);
  }
  return preference;
}

export function getResolvedTheme(): ResolvedTheme {
  getThemePreference();
  return resolved;
}

export function setThemePreference(next: ThemePreference) {
  preference = next;
  writeStoredPreference(next);
  paint(resolveTheme(next));
  emit();
}

export function subscribeTheme(listener: () => void): () => void {
  listeners.add(listener);

  // Installed on the first subscriber rather than at import time, so this
  // module stays inert on the server and in any context without a window.
  if (!watchingSystem && typeof window !== "undefined" && window.matchMedia) {
    watchingSystem = true;
    const query = window.matchMedia(SYSTEM_DARK_QUERY);
    query.addEventListener("change", () => {
      // Only "sistema" tracks the OS — that is the whole difference between
      // it and picking the same theme by hand.
      if (getThemePreference() !== "system") return;
      paint(getSystemTheme());
      emit();
    });
    // Another tab of the same site changing the setting. Cheap to support and
    // confusing without: the room and the home page are commonly two tabs.
    window.addEventListener("storage", (event) => {
      if (event.key !== null && event.key !== THEME_STORAGE_KEY) return;
      preference = readStoredPreference();
      paint(resolveTheme(preference));
      emit();
    });
  }

  return () => {
    listeners.delete(listener);
  };
}

// The server (and the very first client render, before hydration finishes)
// has no way to know what a browser stored — see useTheme's server snapshots.
export const SERVER_THEME_PREFERENCE: ThemePreference = "system";
export const SERVER_RESOLVED_THEME: ResolvedTheme = "light";
