"use client";

import { useCallback, useSyncExternalStore } from "react";
import { useAuth } from "./AuthContext";
import { setGroupTheme } from "./groupsApi";
import {
  applyRoomTheme,
  applyTheme,
  buyTheme,
  getWornOverride,
  getWornOverrideServer,
  setThemePreview,
  setWornOverride,
  subscribeWornOverride,
  type RoomTheme,
} from "./roomThemes";
import { signalingClient } from "./signalingClient";
import { refreshGroup } from "./useGroups";
import { translate } from "./i18n";

// Choosing a theme, from either of the two places that choose one — the
// theme button's own dialog (your look, in every room without one of its own)
// and "Tema da sala" / "Tema do grupo" (a look for everybody in it) — and
// looking at one on the real room before choosing it.
//
// Both dialogs and the bar a preview leaves on screen (see ThemePreviewBar) go
// through here, so "usar", "aplicar" and "comprar" mean one thing wherever
// they are pressed.

/** What a choice is for. */
export type ThemeTarget =
  | { kind: "self" }
  | {
      kind: "room";
      /** The theme the room (or the group) is wearing when the dialog opened. */
      currentThemeId: string | null;
      /** Set when it is a group's theme — the whole group, over HTTP. */
      groupId: string | null;
    };

/**
 * The actions, bound to a target. Each answers with an error to show, or null
 * when it took.
 */
export function useThemeChoice(target: ThemeTarget) {
  const { account, points, refresh } = useAuth();
  // The override first, so a button's label flips on the press rather than
  // when /auth/me answers — the same store the room reads (see useRoomTheme).
  const pending = useSyncExternalStore(subscribeWornOverride, getWornOverride, getWornOverrideServer);
  const worn = pending !== undefined ? pending : (account?.roomThemeId ?? null);
  const current = target.kind === "self" ? worn : target.currentThemeId;
  const groupId = target.kind === "room" ? target.groupId : null;
  const kind = target.kind;

  const choose = useCallback(
    async (themeId: string | null): Promise<string | null> => {
      if (kind === "self") {
        // Painted first, asked second — the palette is already in this tab (it
        // came down with the list it was picked from), so the room changes on
        // the press and the server is told afterwards.
        setWornOverride(themeId);
        const ok = await applyTheme(themeId);
        if (!ok) {
          setWornOverride(undefined);
          return translate("themeBrowser.couldNotApply");
        }
        await refresh();
        setWornOverride(undefined);
        return null;
      }
      if (!groupId) {
        // Over the socket; a refusal comes back the way every other one in the
        // room does.
        signalingClient.setRoomTheme(themeId);
        return null;
      }
      const result = await setGroupTheme(groupId, themeId);
      if (!result.ok) return result.error;
      void refreshGroup(groupId);
      return null;
    },
    [kind, groupId, refresh]
  );

  const buy = useCallback(
    async (theme: RoomTheme): Promise<string | null> => {
      const result = await buyTheme(theme.id);
      if (!result.ok) return result.error;
      // The points moved, and so did ownership — both on the account.
      void refresh();
      return null;
    },
    [refresh]
  );

  return { account, points, current, choose, buy };
}

// ─── Looking before choosing ──────────────────────────────────────────────
//
// A palette cannot be judged on a card, and a paid one used to be judgeable
// only by paying for it. A preview paints the theme onto the room behind — the
// real chat, the real tiles — through the editor's own channel (see
// roomThemes' setThemePreview), which nothing saves: the room, the account and
// everybody else are none the wiser. The dialog steps out of the way while it
// is up, and a bar is left on screen to take it, buy it, or go back.

export interface ThemePreviewSession {
  theme: RoomTheme;
  target: ThemeTarget;
}

let previewSession: ThemePreviewSession | null = null;
const previewListeners = new Set<() => void>();

function notifyPreview() {
  for (const listener of previewListeners) listener();
}

export function startThemePreview(next: ThemePreviewSession): void {
  previewSession = next;
  setThemePreview(next.theme.spec);
  notifyPreview();
}

/**
 * Takes the preview down. Whatever paints the page (see useRoomTheme) puts the
 * real theme back on its own the moment the preview ends — except on a page
 * that has nothing painting it, which is why `leftPage` clears the colours
 * first: somebody who walked off mid-preview must not keep them.
 */
export function endThemePreview({ leftPage = false }: { leftPage?: boolean } = {}): void {
  if (!previewSession) return;
  previewSession = null;
  if (leftPage) applyRoomTheme(null);
  setThemePreview(null);
  notifyPreview();
}

/** Replaces the theme under preview with a fresher copy of itself (bought, liked). */
export function updateThemePreview(theme: RoomTheme): void {
  if (!previewSession || previewSession.theme.id !== theme.id) return;
  previewSession = { ...previewSession, theme };
  notifyPreview();
}

export function useThemePreviewSession(): ThemePreviewSession | null {
  return useSyncExternalStore(
    (listener) => {
      previewListeners.add(listener);
      return () => previewListeners.delete(listener);
    },
    () => previewSession,
    () => null
  );
}
