"use client";

import { useSyncExternalStore } from "react";
import {
  getResolvedTheme,
  getThemePreference,
  setThemePreference,
  subscribeTheme,
  SERVER_RESOLVED_THEME,
  SERVER_THEME_PREFERENCE,
  type ResolvedTheme,
  type ThemePreference,
} from "@/lib/theme";

// useSyncExternalStore rather than an effect, for the same reason
// components/NtPopups.tsx already used it for the OS preference: the server
// render needs a defined answer, and this is the sanctioned way to say "the
// value the server saw is not the value this browser has" without rendering
// the wrong one first and correcting it after a paint.
//
// Both hooks read one shared module-level store (see lib/theme.ts), so the
// switch in the site header and the one in the room's "Mais opções" are the
// same switch, and everything painted from the resolved answer follows both.

export function useThemePreference(): ThemePreference {
  return useSyncExternalStore(
    subscribeTheme,
    getThemePreference,
    () => SERVER_THEME_PREFERENCE
  );
}

export function useResolvedTheme(): ResolvedTheme {
  return useSyncExternalStore(
    subscribeTheme,
    getResolvedTheme,
    () => SERVER_RESOLVED_THEME
  );
}

export function useTheme(): {
  theme: ThemePreference;
  resolvedTheme: ResolvedTheme;
  setTheme: (next: ThemePreference) => void;
} {
  return {
    theme: useThemePreference(),
    resolvedTheme: useResolvedTheme(),
    setTheme: setThemePreference,
  };
}
