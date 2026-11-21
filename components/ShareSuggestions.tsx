"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { MdCheck, MdClose, MdSearch, MdSend } from "react-icons/md";
import { DisplayUserName } from "@/components/DisplayUserName";
import { UserAvatar } from "@/components/UserAvatar";
import { ButtonSpinner } from "@/components/ButtonSpinner";
import { verifiedBadge } from "@/lib/entitlements";
import { sendDirectMessage } from "@/lib/dmApi";
import { trackFeatureEvent } from "@/lib/features";
import { useRecentConversations } from "@/lib/useRecentConversations";
import { useSocialGraph } from "@/lib/useSocialGraph";
import type { SocialUser } from "@/lib/socialApi";
import { useT } from "@/lib/useI18n";

// "Enviar para…" — what opens under "Compartilhar sala" right after the link
// was copied.
//
// Copying a link is the first half of inviting somebody; the second half is
// opening a conversation somewhere and pasting it. For the people this account
// already talks to on GoLive, that second half can be one click here: the room
// link goes to them as an ordinary DM, the same message they would have got
// had it been pasted by hand.
//
// Who is offered: the recent conversations first (the people this account is
// actually talking to), then friends, minus anybody already in the room and
// minus bots. A short list on purpose — it is a shortcut, not a contact book —
// with a filter over the whole set once there is more than fits.
//
// Experiment `share-suggestions` (see experiments.txt).

export const SHARE_SUGGESTIONS_FEATURE = "share-suggestions";

export const SHARE_SUGGESTIONS_EVENTS = {
  /** A click on any "share/copy the room's link" button, either side. */
  click: "share_click",
  /** The panel opened with at least one person in it. */
  shown: "share_sug_shown",
  /** A link sent from the panel. `value` = its position in the list (1-based). */
  sent: "share_sug_sent",
  /** A send the server refused. */
  failed: "share_sug_fail",
  /** The filter was used. */
  search: "share_sug_search",
} as const;

/** Rows shown before the filter is needed. */
const VISIBLE = 5;
/** How many conversations are read to build the list. */
const RECENT = 12;
const PANEL_WIDTH = 320;
/** Roughly the panel with search and five rows; less room than this below the button opens it above. */
const PANEL_MIN_HEIGHT = 360;

type RowState = "idle" | "sending" | "sent";

export function ShareSuggestions({
  url,
  anchor,
  presentUserIds,
  onClose,
}: {
  url: string;
  /** The button that opened it; null puts the panel at the top centre. */
  anchor: DOMRect | null;
  presentUserIds: Set<string>;
  onClose: () => void;
}) {
  const t = useT();
  const { rows: conversations } = useRecentConversations(RECENT);
  const { graph } = useSocialGraph();
  const [query, setQuery] = useState("");
  const [states, setStates] = useState<Record<string, RowState>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const panelRef = useRef<HTMLDivElement>(null);
  const shownTracked = useRef(false);
  const searchTracked = useRef(false);
  const [viewport, setViewport] = useState<{ w: number; h: number } | null>(null);

  useLayoutEffect(() => {
    const read = () => setViewport({ w: window.innerWidth, h: window.innerHeight });
    read();
    window.addEventListener("resize", read);
    return () => window.removeEventListener("resize", read);
  }, []);

  // Everybody worth offering, in order: conversations, then friends.
  const candidates = useMemo(() => {
    const seen = new Set<string>();
    const list: SocialUser[] = [];
    const add = (user: SocialUser) => {
      if (seen.has(user.id) || user.bot) return;
      seen.add(user.id);
      // Somebody already here has been sent, effectively. Except a row this
      // panel just sent to, which stays put so the list does not jump under
      // the cursor when they walk in.
      if (presentUserIds.has(user.id) && !states[user.id]) return;
      list.push(user);
    };
    for (const conversation of conversations) add(conversation.user);
    for (const friend of graph.friends) add(friend);
    return list;
  }, [conversations, graph.friends, presentUserIds, states]);

  const needle = query.trim().toLowerCase();
  const shown = useMemo(() => {
    if (!needle) return candidates.slice(0, VISIBLE);
    return candidates
      .filter(
        (user) =>
          user.displayName.toLowerCase().includes(needle) ||
          user.username.toLowerCase().includes(needle)
      )
      .slice(0, VISIBLE * 2);
  }, [candidates, needle]);

  useEffect(() => {
    if (shownTracked.current || candidates.length === 0) return;
    shownTracked.current = true;
    trackFeatureEvent(SHARE_SUGGESTIONS_EVENTS.shown, { feature: SHARE_SUGGESTIONS_FEATURE });
  }, [candidates.length]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    // A press outside closes it — including on the button that opened it,
    // which then copies again and opens a fresh one.
    function onPointerDown(event: PointerEvent) {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [onClose]);

  async function send(user: SocialUser, position: number) {
    setStates((current) => ({ ...current, [user.id]: "sending" }));
    setErrors((current) => {
      if (!current[user.id]) return current;
      const next = { ...current };
      delete next[user.id];
      return next;
    });
    const result = await sendDirectMessage(user.id, {
      text: t("shareSuggestions.message", { url }),
    });
    if (result.ok) {
      setStates((current) => ({ ...current, [user.id]: "sent" }));
      trackFeatureEvent(SHARE_SUGGESTIONS_EVENTS.sent, {
        feature: SHARE_SUGGESTIONS_FEATURE,
        value: position,
      });
      return;
    }
    setStates((current) => {
      const next = { ...current };
      delete next[user.id];
      return next;
    });
    setErrors((current) => ({ ...current, [user.id]: result.error }));
    trackFeatureEvent(SHARE_SUGGESTIONS_EVENTS.failed, { feature: SHARE_SUGGESTIONS_FEATURE });
  }

  // Nobody to suggest (no conversations, no friends): the copy alone is the
  // whole answer, as it was before.
  if (candidates.length === 0 || !viewport) return null;

  // Under the button, right edges aligned, kept inside the window — or above
  // it when the window has no room below (a button low on a short screen,
  // like the invite field on the stage). Its height is capped to the side it
  // opened on, so the list scrolls instead of running off the screen. On a
  // phone-width window, a sheet at the bottom instead.
  const narrow = viewport.w < 640;
  const MARGIN = 8;
  let style: CSSProperties;
  if (narrow) {
    style = { left: MARGIN, right: MARGIN, bottom: MARGIN, maxHeight: viewport.h - 2 * MARGIN };
  } else if (anchor) {
    const left = Math.max(MARGIN, Math.min(anchor.right - PANEL_WIDTH, viewport.w - PANEL_WIDTH - MARGIN));
    const below = viewport.h - anchor.bottom - 2 * MARGIN;
    const above = anchor.top - 2 * MARGIN;
    style =
      below >= PANEL_MIN_HEIGHT || below >= above
        ? { top: anchor.bottom + MARGIN, left, width: PANEL_WIDTH, maxHeight: below }
        : { bottom: viewport.h - anchor.top + MARGIN, left, width: PANEL_WIDTH, maxHeight: above };
  } else {
    style = { top: 72, left: Math.max(MARGIN, (viewport.w - PANEL_WIDTH) / 2), width: PANEL_WIDTH, maxHeight: viewport.h - 72 - MARGIN };
  }

  const showSearch = candidates.length > VISIBLE;

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label={t("shareSuggestions.title")}
      style={style}
      className="fixed z-[60] flex flex-col rounded-2xl border border-black/10 bg-white p-3 shadow-xl dark:border-white/10 dark:bg-zinc-950"
    >
      <div className="flex items-start justify-between gap-2 px-1">
        <div className="min-w-0">
          <p className="flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-500">
            <MdCheck className="h-3.5 w-3.5" />
            {t("common.linkCopied")}
          </p>
          <h2 className="mt-0.5 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            {t("shareSuggestions.title")}
          </h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("common.close")}
          className="cursor-pointer rounded-lg p-1 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-900 dark:hover:text-zinc-200"
        >
          <MdClose className="h-4 w-4" />
        </button>
      </div>

      {showSearch && (
        <div className="relative mt-2">
          <MdSearch className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              if (!searchTracked.current && event.target.value.trim()) {
                searchTracked.current = true;
                trackFeatureEvent(SHARE_SUGGESTIONS_EVENTS.search, { feature: SHARE_SUGGESTIONS_FEATURE });
              }
            }}
            placeholder={t("shareSuggestions.search")}
            aria-label={t("shareSuggestions.search")}
            className="w-full rounded-lg border border-zinc-300 bg-white py-1.5 pl-8 pr-2 text-sm text-zinc-950 outline-none transition focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
          />
        </div>
      )}

      {shown.length === 0 ? (
        <p className="px-1 py-3 text-sm text-zinc-500 dark:text-zinc-400">{t("shareSuggestions.nobody")}</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-0.5 overflow-y-auto">
          {shown.map((user, index) => {
            const state = states[user.id] ?? "idle";
            const error = errors[user.id];
            return (
              <li key={user.id} className="flex items-center gap-2.5 rounded-lg px-1.5 py-1.5">
                <UserAvatar
                  src={user.avatarUrl}
                  name={user.displayName}
                  size={30}
                  className="shrink-0"
                  userId={user.id}
                />
                <span className="min-w-0 flex-1">
                  <DisplayUserName
                    name={user.displayName}
                    verified={verifiedBadge(user.flags)}
                    flags={user.flags}
                    bot={user.bot}
                    color={user.nameColor}
                    className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100"
                  />
                  <span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">
                    {error ? <span className="text-red-500">{error}</span> : `@${user.username}`}
                  </span>
                </span>
                <button
                  type="button"
                  disabled={state !== "idle"}
                  onClick={() => void send(user, index + 1)}
                  aria-label={t("shareSuggestions.sendTo", { displayName: user.displayName })}
                  className={`flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold transition disabled:cursor-default ${
                    state === "sent"
                      ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400"
                      : "bg-zinc-900 text-white hover:bg-zinc-700 disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
                  }`}
                >
                  {state === "sending" ? (
                    <ButtonSpinner />
                  ) : state === "sent" ? (
                    <MdCheck className="h-4 w-4" />
                  ) : (
                    <MdSend className="h-3.5 w-3.5" />
                  )}
                  {state === "sent" ? t("shareSuggestions.sent") : t("shareSuggestions.send")}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
