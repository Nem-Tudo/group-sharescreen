"use client";

import { useCallback, useSyncExternalStore } from "react";
import {
  getLocale,
  getLocalePreference,
  setLocalePreference,
  subscribeLocale,
  translate,
  translateCount,
  SERVER_LOCALE,
  SERVER_LOCALE_PREFERENCE,
  type Locale,
  type LocalePreference,
  type TranslateVars,
} from "@/lib/i18n";

// useSyncExternalStore rather than an effect, for the same reason
// lib/useTheme.ts uses it: the server render needs a defined answer, and this
// is the sanctioned way to say "the value the server saw is not the value
// this browser has" without rendering the wrong one and correcting it after a
// paint. The server says English; the store corrects it during hydration.

export function useLocale(): Locale {
  return useSyncExternalStore(subscribeLocale, getLocale, () => SERVER_LOCALE);
}

export function useLocalePreference(): LocalePreference {
  return useSyncExternalStore(
    subscribeLocale,
    getLocalePreference,
    () => SERVER_LOCALE_PREFERENCE
  );
}

/**
 * The hook nearly every component wants: `const t = useT()`, then
 * `t("some.key")`.
 *
 * The identity of `t` changes when the language does, which is what makes it
 * safe to list in a dependency array — a `useMemo` that builds labels will
 * rebuild them on a language change instead of holding the old words.
 */
export function useT(): (key: string, vars?: TranslateVars) => string {
  const locale = useLocale();
  return useCallback(
    (key: string, vars?: TranslateVars) => translate(key, vars, locale),
    [locale]
  );
}

/** The count-aware form; see translateCount. */
export function useTCount(): (key: string, count: number, vars?: TranslateVars) => string {
  const locale = useLocale();
  return useCallback(
    (key: string, count: number, vars?: TranslateVars) =>
      translateCount(key, count, vars, locale),
    [locale]
  );
}

export function useI18n(): {
  locale: Locale;
  preference: LocalePreference;
  setLocale: (next: LocalePreference) => void;
  t: (key: string, vars?: TranslateVars) => string;
  tc: (key: string, count: number, vars?: TranslateVars) => string;
} {
  return {
    locale: useLocale(),
    preference: useLocalePreference(),
    setLocale: setLocalePreference,
    t: useT(),
    tc: useTCount(),
  };
}
