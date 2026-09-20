"use client";

import { useEffect, useRef, useState } from "react";
import { MdClose, MdPushPin, MdSearch } from "react-icons/md";

import { UserAvatar } from "@/components/UserAvatar";
import { DisplayUserName } from "@/components/DisplayUserName";
import { formatLocale } from "@/lib/i18n";
import { MESSAGE_FINDER_EVENTS, trackFinderEvent, type FinderPanel } from "@/lib/messageFinder";
import { useT } from "@/lib/useI18n";

// The panel beside the messages: what is pinned, and what is in there
// somewhere.
//
// One component for both tabs and for both surfaces — a group's room and a
// private conversation. It knows nothing about either: it is handed two
// functions that answer with rows, and a row is already the one line it
// draws. That is what keeps a room's messages and a conversation's messages,
// which have nothing in common in memory, from needing two of this.
//
// The rows are deliberately *not* the real message rows. A hit is a pointer
// to a place in the conversation, not the conversation itself: one line,
// truncated, and a click that takes you there. Drawing the real thing would
// mean reactions that cannot be clicked, replies that cannot be followed and
// pictures that push the next hit off the screen.

/** How long after the last keystroke the search is sent. Mirrors the DMs' list. */
const SEARCH_DEBOUNCE_MS = 300;
/** Under this, the answer would be most of the conversation. The API agrees. */
export const FINDER_MIN_QUERY = 2;

/** One line of the panel: a message, flattened to what a pointer to it needs. */
export interface FinderRow {
  id: string;
  ts: number;
  name: string;
  avatarUrl: string | null;
  /** Whose face this is, or null for a guest, a webhook or somebody unknown. */
  userId: string | null;
  isGuest?: boolean;
  bot?: boolean;
  webhook?: boolean;
  nameColor?: string | null;
  /** The words, as a person reads them: mentions as names, no markdown. */
  snippet: string;
  /** Where it was said — a room's name, when the search crossed several. */
  context?: string;
  /** The room it belongs to, for a caller that has to go there first. */
  scopeId?: string;
}

/** Null means the read failed; an empty list means there is nothing there. */
export type FinderLoad = (signal: AbortSignal) => Promise<FinderRow[] | null>;

function dayLabel(ts: number): string {
  return new Date(ts).toLocaleDateString(formatLocale(), { day: "numeric", month: "short" });
}

function timeLabel(ts: number): string {
  return new Date(ts).toLocaleTimeString(formatLocale(), { hour: "2-digit", minute: "2-digit" });
}

export function MessageFinderPanel({
  panel,
  onPanelChange,
  onClose,
  onJump,
  loadPins,
  search,
  onUnpin,
  refreshKey,
  groupId = null,
  scope,
}: {
  panel: FinderPanel;
  onPanelChange: (panel: FinderPanel) => void;
  onClose: () => void;
  onJump: (row: FinderRow) => void;
  loadPins: FinderLoad;
  search: (query: string, signal: AbortSignal) => Promise<FinderRow[] | null>;
  /** Absent when this person may not unpin — the row then has no ✕. */
  onUnpin?: (row: FinderRow) => void;
  /** Bumped by the caller whenever a message changed, so the pins read again. */
  refreshKey: number;
  /** The group a click belongs to, for the statistics. Null in a conversation. */
  groupId?: string | null;
  /**
   * Where the search looks, when there is more than one answer — a group can
   * be searched whole or one room at a time. Absent in a conversation, which
   * is only ever itself.
   */
  scope?: { wideLabel: string; narrowLabel: string; wide: boolean; onChange: (wide: boolean) => void };
}) {
  const t = useT();
  const [pins, setPins] = useState<FinderRow[] | null>(null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<{ query: string; rows: FinderRow[] } | null>(null);
  const [failed, setFailed] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Read on opening, and again whenever the caller says a message changed —
  // which is how somebody else's pin lands here without this panel having an
  // opinion about sockets.
  useEffect(() => {
    if (panel !== "pins") return;
    const controller = new AbortController();
    void (async () => {
      const rows = await loadPins(controller.signal).catch(() => null);
      if (controller.signal.aborted) return;
      if (!rows) {
        setFailed(true);
        return;
      }
      setFailed(false);
      setPins(rows);
    })();
    return () => controller.abort();
    // loadPins is re-made every render by callers that close over their own
    // state; the panel and the refresh are what decide when to read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panel, refreshKey]);

  // The search box is ready to type in the moment it opens: it was opened to
  // be typed in, and nothing else here takes a keystroke.
  useEffect(() => {
    if (panel === "search") inputRef.current?.focus({ preventScroll: true });
  }, [panel]);

  // Debounced — a request per letter of "aniversário" is not a search. Nothing
  // is cleared when the query changes: the answer is tagged with what it
  // answered, and a stale one simply stops being shown.
  useEffect(() => {
    if (panel !== "search") return;
    const needle = query.trim();
    if (needle.length < FINDER_MIN_QUERY) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void (async () => {
        const rows = await search(needle, controller.signal).catch(() => null);
        if (controller.signal.aborted) return;
        if (!rows) {
          setFailed(true);
          return;
        }
        setFailed(false);
        setHits({ query: needle, rows });
        trackFinderEvent(MESSAGE_FINDER_EVENTS.searchRun, groupId);
      })();
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
    // Same reasoning as the pins' effect: `search` is a closure the caller
    // re-makes, and the query is what decides.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panel, query, scope?.wide]);

  const rows = panel === "pins" ? pins ?? [] : hits && hits.query === query.trim() ? hits.rows : [];
  // Derived rather than held: "still searching" is exactly "what came back is
  // not an answer to what is typed" — the same reading the conversation
  // list's own search makes. A state for it would be a second source of
  // truth, kept in step by hand.
  const searching = query.trim().length >= FINDER_MIN_QUERY && hits?.query !== query.trim();

  const empty =
    panel === "pins"
      ? pins === null
        ? t("common.loading")
        : t("messageFinder.noPins")
      : query.trim().length < FINDER_MIN_QUERY
        ? t("messageFinder.typeToSearch")
        : searching
          ? t("messageFinder.searching")
          : t("messageFinder.nothingFound");

  return (
    <div
      role="complementary"
      aria-label={panel === "pins" ? t("messageFinder.pinned") : t("messageFinder.search")}
      // Over the messages rather than beside them: the chat column is already
      // as narrow as it can be on a laptop, and a panel that pushed it
      // narrower would rewrap every line in the conversation each time it
      // opened.
      className="absolute inset-y-0 right-0 z-20 flex w-full max-w-sm flex-col border-l border-zinc-200 bg-white shadow-xl dark:border-zinc-800 dark:bg-zinc-950"
    >
      <div className="flex shrink-0 items-center gap-1 border-b border-zinc-200 px-2 py-1.5 dark:border-zinc-800">
        <TabButton
          active={panel === "pins"}
          onClick={() => onPanelChange("pins")}
          icon={<MdPushPin className="h-4 w-4" />}
          label={t("messageFinder.pinned")}
        />
        <TabButton
          active={panel === "search"}
          onClick={() => onPanelChange("search")}
          icon={<MdSearch className="h-4 w-4" />}
          label={t("messageFinder.search")}
        />
        <button
          type="button"
          onClick={onClose}
          aria-label={t("common.close")}
          className="ml-auto cursor-pointer rounded-lg p-1.5 text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-800 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
        >
          <MdClose className="h-4 w-4" />
        </button>
      </div>

      {panel === "search" && (
        <div className="shrink-0 px-2 py-2">
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("messageFinder.searchPlaceholder")}
            aria-label={t("messageFinder.searchPlaceholder")}
            className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 text-sm text-zinc-900 outline-none transition focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:border-zinc-600"
          />
          {scope && (
            <div className="mt-1.5 flex gap-1">
              <ScopeButton active={scope.wide} onClick={() => scope.onChange(true)} label={scope.wideLabel} />
              <ScopeButton active={!scope.wide} onClick={() => scope.onChange(false)} label={scope.narrowLabel} />
            </div>
          )}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {failed && <p className="px-1 py-3 text-sm text-red-500">{t("common.didnTWork")}</p>}
        {rows.length === 0 && !failed ? (
          <p className="px-1 py-6 text-center text-sm text-zinc-500 dark:text-zinc-400">{empty}</p>
        ) : (
          <ul className="flex flex-col gap-1 pt-1">
            {rows.map((row) => (
              <li key={row.id} className="group/row relative">
                <button
                  type="button"
                  onClick={() => {
                    trackFinderEvent(
                      panel === "pins" ? MESSAGE_FINDER_EVENTS.pinJump : MESSAGE_FINDER_EVENTS.searchJump,
                      groupId
                    );
                    onJump(row);
                  }}
                  title={t("messageFinder.jumpToMessage")}
                  className="flex w-full cursor-pointer flex-col gap-0.5 rounded-lg px-2 py-1.5 text-left transition hover:bg-zinc-100 dark:hover:bg-zinc-900"
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    <UserAvatar
                      src={row.avatarUrl}
                      name={row.name}
                      size={18}
                      userId={row.userId}
                      isGuest={row.isGuest}
                    />
                    <DisplayUserName
                      name={row.name}
                      isGuest={row.isGuest}
                      bot={row.bot}
                      webhook={row.webhook}
                      color={row.nameColor ?? null}
                      className="min-w-0 text-xs font-medium text-zinc-700 dark:text-zinc-300"
                    />
                    <span className="ml-auto shrink-0 pl-1 text-[11px] tabular-nums text-zinc-400 dark:text-zinc-600">
                      {dayLabel(row.ts)} {timeLabel(row.ts)}
                    </span>
                  </span>
                  <span className="line-clamp-3 break-words text-xs text-zinc-600 dark:text-zinc-400">
                    {row.snippet}
                  </span>
                  {row.context && (
                    <span className="truncate text-[11px] text-zinc-400 dark:text-zinc-600">#{row.context}</span>
                  )}
                </button>
                {panel === "pins" && onUnpin && (
                  <button
                    type="button"
                    onClick={() => {
                      // Off the list at once. The caller reads the list again
                      // either way, which is what puts it back on a refusal.
                      setPins((current) => current?.filter((r) => r.id !== row.id) ?? current);
                      onUnpin(row);
                    }}
                    aria-label={t("messageFinder.unpin")}
                    title={t("messageFinder.unpin")}
                    // Shown on hover, always reachable by keyboard: a row is
                    // mostly read, and a button on every one of them competes
                    // with the words.
                    className="absolute right-1 top-1 cursor-pointer rounded-md p-1 text-zinc-400 opacity-0 transition hover:bg-zinc-200 hover:text-zinc-700 focus-visible:opacity-100 group-hover/row:opacity-100 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                  >
                    <MdClose className="h-3.5 w-3.5" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function ScopeButton({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`cursor-pointer rounded-full px-2 py-0.5 text-[11px] font-medium transition ${
        active
          ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
          : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800"
      }`}
    >
      {label}
    </button>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium transition ${
        active
          ? "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100"
          : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
