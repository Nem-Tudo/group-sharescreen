"use client";

import { Fragment, useEffect, useSyncExternalStore } from "react";
import {
  activateLocale,
  getLocale,
  subscribeLocale,
  SERVER_LOCALE,
} from "@/lib/i18n";

/**
 * Turns the language on once hydration is over, and re-renders everything
 * under it when the language changes.
 *
 * Two jobs, both of which exist because the server cannot know what language
 * a browser wants:
 *
 * 1. The server renders English, so the store hands out English until this
 *    effect runs (see the note on `activated` in lib/i18n.ts). Flipping it
 *    here — after the first paint, in an effect — is what lets a Spanish
 *    browser end up in Spanish without React finding a different page than
 *    the one it was given to hydrate.
 *
 * 2. `key` on the subtree. Components that call useT re-render on their own,
 *    but a fair number of this app's labels come from tables built at module
 *    scope (the group permissions, the badges, the room themes) and reached
 *    through plain function calls. Remounting is the one move that re-reads
 *    all of it, whatever shape it arrived in, so a language change never
 *    leaves half a screen in the old words.
 *
 * The remount costs component state, which is why it is worth being precise
 * about when it happens: on a first load it lands immediately after
 * hydration, before anybody has typed or joined anything, and after that only
 * when someone deliberately picks a different language from the account menu.
 */
export function I18nGate({ children }: { children: React.ReactNode }) {
  const locale = useSyncExternalStore(subscribeLocale, getLocale, () => SERVER_LOCALE);

  useEffect(() => {
    activateLocale();
  }, []);

  // A keyed Fragment rather than a keyed element: this sits directly inside
  // <body>, and a wrapper div there would land in the middle of every
  // direct-child selector and layout rule the page already has.
  return <Fragment key={locale}>{children}</Fragment>;
}
