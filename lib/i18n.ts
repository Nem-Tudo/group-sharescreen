// The site's language, and the one place that decides which words are shown.
//
// Built to the same shape as lib/theme.ts, deliberately: a module-level store
// with subscribe/emit, read through useSyncExternalStore, so the switch in
// the account menu and every string on the page are the same setting rather
// than a value threaded through props. The two even share the "system is a
// real choice" idea — "auto" follows the browser's own language list and
// stays the default, so a first visit is already in the right language and
// nobody has to find a switch to get there.
//
// Catalogs are flat JSON maps of dotted key -> string (see locales/*.json).
// Flat rather than nested so adding a language is one file and one entry in
// `catalogs` below, and so a missing key is a one-line diff rather than a
// tree merge.

import en from "@/locales/en.json";
import es from "@/locales/es.json";
import pt from "@/locales/pt.json";

export const LOCALES = ["en", "es", "pt"] as const;
export type Locale = (typeof LOCALES)[number];

/** What the user picked. "auto" means "whatever the browser asks for". */
export type LocalePreference = "auto" | Locale;

// English is the fallback for everything: the server renders it (a browser's
// language is not knowable at build time), and any key missing from another
// catalog reads from here rather than showing a raw key to a person.
export const DEFAULT_LOCALE: Locale = "en";

export const LOCALE_STORAGE_KEY = "sharescreen:locale";

/** Written in the language itself — a language picker nobody can read is a
 *  picker for people who did not need it. */
export const LOCALE_LABELS: Record<Locale, string> = {
  en: "English",
  es: "Español",
  pt: "Português",
};

/** The `lang` attribute / BCP-47 tag for each locale. */
export const LOCALE_TAGS: Record<Locale, string> = {
  en: "en",
  es: "es",
  // The catalog is the Brazilian wording the site was originally written in,
  // and the tag is what decides 23/08 over 08/23 and 1.234,5 over 1,234.5.
  pt: "pt-BR",
};

export type Catalog = Record<string, string>;

// Every catalog is imported statically, and that is load-bearing rather than
// lazy. Plenty of labels in this app are built at module scope — the group
// permission table, the badge list, the room themes, the keyboard shortcuts —
// and those run the moment their file is imported. A catalog that arrived a
// tick later would leave every one of them frozen in English for the session.
// Synchronous catalogs are what make `translate` safe to call anywhere.
//
// Adding a language is two lines: an import, and an entry here.
const catalogs: Record<Locale, Catalog> = {
  en: en as Catalog,
  es: es as Catalog,
  pt: pt as Catalog,
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

// Runs in the document before anything paints, so it is a string of plain ES5
// rather than an import — same reason as THEME_INIT_SCRIPT, and it sets the
// same kind of thing: `<html lang>`, which is what a screen reader picks a
// voice from and what the browser offers to translate against. The words
// themselves still arrive with React; this is only the document's own label.
export const LOCALE_INIT_SCRIPT = `(function(){try{var k=${JSON.stringify(
  LOCALE_STORAGE_KEY
)};var s=${JSON.stringify(LOCALES)};var p=localStorage.getItem(k);if(s.indexOf(p)<0){p=null;var n=(navigator.languages&&navigator.languages.length?navigator.languages:[navigator.language||"en"]);for(var i=0;i<n.length&&!p;i++){var b=String(n[i]||"").toLowerCase().split("-")[0];if(s.indexOf(b)>=0)p=b;}}document.documentElement.lang=p||${JSON.stringify(
  DEFAULT_LOCALE
)};}catch(e){}})();`;

/** The first of the browser's languages we actually have words for. */
export function detectBrowserLocale(): Locale {
  if (typeof navigator === "undefined") return DEFAULT_LOCALE;
  const list =
    navigator.languages && navigator.languages.length
      ? navigator.languages
      : [navigator.language || DEFAULT_LOCALE];
  for (const entry of list) {
    // "pt-BR" and "pt" are the same answer to this question, and a browser
    // may say either. Region only matters once two regions disagree, which
    // none of the catalogs do yet.
    const base = String(entry || "").toLowerCase().split("-")[0];
    if (isLocale(base)) return base;
  }
  return DEFAULT_LOCALE;
}

function readStoredPreference(): LocalePreference {
  if (typeof window === "undefined") return "auto";
  try {
    const raw = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    return isLocale(raw) ? raw : "auto";
  } catch {
    // localStorage may be unavailable (private mode, quota, embedded views).
    return "auto";
  }
}

function writeStoredPreference(value: LocalePreference) {
  if (typeof window === "undefined") return;
  try {
    // "auto" is stored as the absence of a choice rather than as the word, so
    // a browser that was never asked and one that was told "follow my
    // browser" behave identically — including later, if the browser changes.
    if (value === "auto") window.localStorage.removeItem(LOCALE_STORAGE_KEY);
    else window.localStorage.setItem(LOCALE_STORAGE_KEY, value);
  } catch {
    // ignored — the preference just won't survive this browser.
  }
}

export function resolveLocale(preference: LocalePreference): Locale {
  return preference === "auto" ? detectBrowserLocale() : preference;
}

// The module-level store. One language for the whole tab: the account menu's
// picker, a dialog three levels deep and a toast fired from a socket callback
// all read this.
let preference: LocalePreference | null = null;
let resolved: Locale = DEFAULT_LOCALE;
const listeners = new Set<() => void>();
let watching = false;

// Nothing is translated until the app says hydration is over — see
// activateLocale and components/I18nGate.tsx.
//
// The server has no way to know what a browser stored or asks for, so it
// renders English. If the store handed out "es" during hydration, the first
// client render would disagree with the HTML that is already on screen and
// React would throw the subtree away. Staying English until hydration
// finishes makes the two renders identical by construction, for every string
// on the page at once — a component's label, a helper called mid-render, a
// toast — rather than one hook at a time.
let activated = false;

function emit() {
  for (const listener of listeners) listener();
}

function paint(next: Locale) {
  resolved = next;
  if (typeof document === "undefined") return;
  document.documentElement.lang = LOCALE_TAGS[next];
}

/** The stored choice, read once and cached. Not gated — internal. */
function ensurePreference(): LocalePreference {
  if (preference === null) {
    preference = readStoredPreference();
    resolved = resolveLocale(preference);
  }
  return preference;
}

// Both of these are gated, so that everything React renders before hydration
// finishes agrees with the HTML the server sent.
export function getLocalePreference(): LocalePreference {
  ensurePreference();
  return activated ? (preference as LocalePreference) : "auto";
}

export function getLocale(): Locale {
  ensurePreference();
  return activated ? resolved : DEFAULT_LOCALE;
}

/**
 * Hands the real language over, once, after hydration. Called by I18nGate.
 *
 * Safe to call repeatedly; only the first call that actually changes the
 * answer notifies anybody.
 */
export function activateLocale() {
  if (activated) return;
  ensurePreference();
  activated = true;
  paint(resolved);
  if (resolved !== DEFAULT_LOCALE) emit();
}

export function isLocaleActive(): boolean {
  return activated;
}

export function setLocalePreference(next: LocalePreference) {
  preference = next;
  writeStoredPreference(next);
  // A choice made by hand is as good as hydration being over: there is a
  // person looking at the page, so there is nothing left to match.
  activated = true;
  paint(resolveLocale(next));
  emit();
}

export function subscribeLocale(listener: () => void): () => void {
  listeners.add(listener);

  // Installed on the first subscriber rather than at import time, so this
  // module stays inert on the server.
  if (!watching && typeof window !== "undefined") {
    watching = true;
    // Another tab of the same site changing the language. The room and the
    // home page are commonly two tabs, and a language that only applied to
    // the tab it was set in would read as the setting not having worked.
    window.addEventListener("storage", (event) => {
      if (event.key !== null && event.key !== LOCALE_STORAGE_KEY) return;
      preference = readStoredPreference();
      activated = true;
      paint(resolveLocale(preference));
      emit();
    });
  }

  return () => {
    listeners.delete(listener);
  };
}

// The server (and the first client render, before hydration finishes) has no
// way to know what a browser stored or asks for — see useLocale's server
// snapshot. English is what it renders, and the store corrects it in place.
export const SERVER_LOCALE_PREFERENCE: LocalePreference = "auto";
export const SERVER_LOCALE: Locale = DEFAULT_LOCALE;

// Nullable on purpose: a placeholder is usually filled from whatever the
// caller already has — `account.displayName`, `premium?.daysLeft` — and
// forcing every call site to narrow first would be noise. `interpolate`
// leaves the placeholder written out when it gets nothing, which shows up as
// a bug rather than hiding as an empty gap.
export type TranslateVars = Record<string, string | number | null | undefined>;

const PLACEHOLDER = /\{(\w+)\}/g;

function interpolate(template: string, vars?: TranslateVars): string {
  if (!vars) return template;
  return template.replace(PLACEHOLDER, (whole, name: string) => {
    const value = vars[name];
    // An unknown placeholder is left as written rather than blanked: seeing
    // "{count}" in the UI points at the bug, an empty gap hides it.
    return value === undefined || value === null ? whole : String(value);
  });
}

function lookup(locale: Locale, key: string): string | undefined {
  const catalog = catalogs[locale];
  const value = catalog ? catalog[key] : undefined;
  // An empty string in a catalog means "not translated yet" rather than "this
  // label is blank" — no label in this app is deliberately empty.
  return value ? value : undefined;
}

/**
 * The translation lookup, callable outside React too — a toast fired from a
 * socket callback and a label in a component should read the same catalog.
 *
 * Falls back locale -> English -> the key itself, so a half-translated
 * catalog degrades to English rather than to blanks.
 */
export function translate(key: string, vars?: TranslateVars, locale?: Locale): string {
  const active = locale ?? getLocale();
  const value = lookup(active, key) ?? lookup(DEFAULT_LOCALE, key);
  if (value === undefined) {
    // Shipping a key to the screen is ugly, and meant to be: it is how a
    // missed string gets noticed at all.
    if (process.env.NODE_ENV !== "production") {
      console.warn(`[i18n] missing key: ${key}`);
    }
    return interpolate(key, vars);
  }
  return interpolate(value, vars);
}

/**
 * Count-aware lookup: picks `<key>.one` or `<key>.other`, and exposes the
 * count as `{count}`. Only the two English/Spanish forms — both languages
 * agree on which two, so a full plural-rules table would be machinery for a
 * distinction neither of them makes.
 */
export function translateCount(
  key: string,
  count: number,
  vars?: TranslateVars,
  locale?: Locale
): string {
  const suffix = Math.abs(count) === 1 ? "one" : "other";
  return translate(`${key}.${suffix}`, { count, ...vars }, locale);
}

export type TranslateFn = typeof translate;

/**
 * The tag to hand `Intl` and `toLocaleString`.
 *
 * Dates, times and numbers were formatted as "pt-BR" everywhere, which is a
 * second language setting hiding inside the first: it decides 1.234,5 versus
 * 1,234.5 and 23/08 versus 08/23. It follows the chosen language now, so a
 * page cannot end up with English words above Brazilian numbers.
 *
 * Call it at the point of formatting rather than hoisting the result into a
 * module-level `Intl` instance — those are built once at import, which is
 * exactly when the language is not known yet.
 */
export function formatLocale(): string {
  return LOCALE_TAGS[getLocale()];
}
