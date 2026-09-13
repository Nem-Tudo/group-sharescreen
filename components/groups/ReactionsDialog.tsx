"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { MdClose, MdSearch } from "react-icons/md";
import { DisplayUserName } from "@/components/DisplayUserName";
import { Twemoji } from "@/components/Twemoji";
import { UserAvatar } from "@/components/UserAvatar";
import { clickPerson, contextPerson } from "@/components/groups/groupProfile";
import { verifiedBadge } from "@/lib/entitlements";
import { canManage, roleColorOf } from "@/lib/groupPermissions";
import {
  fetchReactionUsers,
  removeReactionOf,
  type GroupDetail,
  type GroupReaction,
  type GroupUser,
  type ReactionSort,
} from "@/lib/groupsApi";
import { prefetchUserProfile } from "@/lib/userProfile";
import { useT, useTCount } from "@/lib/useI18n";

// "Ver reações": who reacted to a message, and with what — Discord's dialog.
// The message's emoji down the left, each with its count; everybody on the
// one picked down the right, a page at a time (see the API's reactions GET),
// with a search and a choice of order.
//
// Paged rather than handed over whole because a message in a big group can
// carry thousands of reactions, and each of them would be a face and a name to
// resolve and draw. The next page is asked for as the list nears its end.
//
// Live: the counts on the left are the message's own, which the room keeps
// current; when the picked emoji's count moves, the list is read again.
//
// Each row has an × for taking that reaction off: on your own row always, on
// everybody else's with "Gerenciar reações". The row goes at once; the room's
// update that follows is what moves the counts.

const PAGE_SIZE = 50;
/** How close to the end of the list the next page is asked for, in px. */
const LOAD_AHEAD_PX = 240;
/** How long typing may pause before the search is sent. */
const SEARCH_DEBOUNCE_MS = 250;

const SORTS: ReactionSort[] = ["recent", "oldest", "name"];

type ListState = {
  /** What this list is for — a list for anything else is stale and reads as loading. */
  key: string;
  people: GroupUser[];
  total: number;
  next: string | null;
  failed: boolean;
};

const subscribeNothing = () => () => {};

export function ReactionsDialog({
  detail,
  channelId,
  messageId,
  reactions,
  initialEmoji,
  onClose,
}: {
  detail: GroupDetail;
  channelId: string;
  messageId: string;
  /** The message's reactions as the room holds them now. */
  reactions: GroupReaction[];
  initialEmoji?: string | null;
  onClose: () => void;
}) {
  const t = useT();
  const tc = useTCount();
  const onClient = useSyncExternalStore(subscribeNothing, () => true, () => false);
  const groupId = detail.group.id;
  const selfId = detail.me.id;
  const canManageReactions = canManage(detail, "manageReactions");

  const [picked, setPicked] = useState<string | null>(initialEmoji ?? null);
  const [sort, setSort] = useState<ReactionSort>("recent");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [list, setList] = useState<ListState | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const moreInFlight = useRef(false);

  // The emoji on screen: the one picked while it is still on the message, the
  // first one otherwise (somebody took the last reaction of it back).
  const emoji = reactions.some((r) => r.emoji === picked) ? picked! : reactions[0]?.emoji ?? null;
  const count = reactions.find((r) => r.emoji === emoji)?.users.length ?? 0;
  // Everything the first page depends on — the count included, so a reaction
  // landing or leaving reads the list again.
  const key = `${emoji}|${sort}|${query}|${count}`;
  const current = list?.key === key ? list : null;

  // The search, sent once the typing pauses.
  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(search.trim()), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [search]);

  // The first page, whenever what it is for changes.
  useEffect(() => {
    if (!emoji) return;
    const controller = new AbortController();
    moreInFlight.current = false;
    void fetchReactionUsers(groupId, channelId, messageId, { emoji, sort, q: query, limit: PAGE_SIZE }, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setList(
          result.ok
            ? { key, people: result.people, total: result.total, next: result.next, failed: false }
            : { key, people: [], total: 0, next: null, failed: true }
        );
        scrollRef.current?.scrollTo({ top: 0 });
      })
      .catch(() => {
        // Aborted: a newer list is on its way.
      });
    return () => controller.abort();
  }, [groupId, channelId, messageId, emoji, sort, query, key]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Not while somebody's profile is open over this — Escape is theirs then.
      if (event.key !== "Escape" || document.querySelectorAll(".golive-dialog-backdrop").length > 1) return;
      onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function loadMore() {
    if (!current || !current.next || !emoji || moreInFlight.current) return;
    moreInFlight.current = true;
    setLoadingMore(true);
    const forKey = current.key;
    const result = await fetchReactionUsers(groupId, channelId, messageId, {
      emoji,
      sort,
      q: query,
      after: current.next,
      limit: PAGE_SIZE,
    }).catch(() => null);
    moreInFlight.current = false;
    setLoadingMore(false);
    if (!result || !result.ok) return;
    setList((prev) => {
      if (!prev || prev.key !== forKey) return prev;
      const known = new Set(prev.people.map((p) => p.id));
      return {
        ...prev,
        people: [...prev.people, ...result.people.filter((p) => !known.has(p.id))],
        next: result.next,
        total: result.total,
      };
    });
  }

  async function removeReaction(person: GroupUser) {
    if (!emoji || !current) return;
    const forKey = current.key;
    const before = current;
    setRemoveError(null);
    // Off the list now; the room's reactions update right behind it moves the
    // count on the left, which re-reads the list (see `key`).
    setList((prev) =>
      prev && prev.key === forKey
        ? { ...prev, people: prev.people.filter((p) => p.id !== person.id), total: Math.max(0, prev.total - 1) }
        : prev
    );
    const result = await removeReactionOf(groupId, channelId, messageId, emoji, person.id);
    if (result.ok) return;
    setList((prev) => (prev && prev.key === forKey ? before : prev));
    setRemoveError(result.error);
  }

  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < LOAD_AHEAD_PX) void loadMore();
  }

  if (!onClient) return null;

  const sortLabel: Record<ReactionSort, string> = {
    recent: t("groups.reactionsDialog.sortRecent"),
    oldest: t("groups.reactionsDialog.sortOldest"),
    name: t("groups.reactionsDialog.sortName"),
  };

  return createPortal(
    <div
      className="golive-dialog-backdrop fixed inset-0 z-50 flex select-none items-stretch justify-center bg-black/60 sm:items-center sm:p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label={t("groups.reactionsDialog.title")}
    >
      <div className="golive-dialog-card flex h-dvh w-full flex-col overflow-hidden bg-white shadow-2xl sm:h-[min(36rem,85dvh)] sm:max-w-2xl sm:rounded-2xl sm:border sm:border-black/10 dark:bg-zinc-950 sm:dark:border-white/10">
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <h2 className="text-base font-semibold text-zinc-950 dark:text-zinc-50">{t("groups.reactionsDialog.title")}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.close")}
            className="cursor-pointer rounded-full p-1.5 text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-900 dark:hover:text-zinc-100"
          >
            <MdClose className="h-5 w-5" />
          </button>
        </div>

        <div className="flex min-h-0 flex-1">
          {/* The emoji, each with how many. */}
          <nav
            aria-label={t("groups.reactionsDialog.title")}
            className="flex w-20 shrink-0 flex-col gap-1 overflow-y-auto border-r border-zinc-200 p-2 sm:w-36 dark:border-zinc-800"
          >
            {reactions.map((reaction) => {
              const on = reaction.emoji === emoji;
              const mine = reaction.users.includes(selfId);
              return (
                <button
                  key={reaction.emoji}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setPicked(reaction.emoji)}
                  className={`flex cursor-pointer items-center justify-center gap-2 rounded-lg px-2 py-2 text-sm font-medium tabular-nums transition sm:justify-start ${
                    on
                      ? "bg-zinc-100 text-zinc-950 dark:bg-zinc-900 dark:text-zinc-50"
                      : "text-zinc-600 hover:bg-zinc-50 dark:text-zinc-400 dark:hover:bg-zinc-900/60"
                  }`}
                >
                  <Twemoji emoji={reaction.emoji} size={22} />
                  <span className={mine ? "text-blue-600 dark:text-blue-400" : ""}>{reaction.users.length}</span>
                </button>
              );
            })}
          </nav>

          {/* Who, with the one picked. */}
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex shrink-0 flex-col gap-2 border-b border-zinc-200 p-3 dark:border-zinc-800">
              <label className="flex items-center gap-2 rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 focus-within:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900">
                <MdSearch className="h-4 w-4 shrink-0 text-zinc-400" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t("groups.reactionsDialog.search")}
                  maxLength={64}
                  aria-label={t("groups.reactionsDialog.search")}
                  className="min-w-0 flex-1 bg-transparent text-sm text-zinc-950 outline-none dark:text-zinc-50"
                />
                {search && (
                  <button
                    type="button"
                    onClick={() => setSearch("")}
                    aria-label={t("groups.reactionsDialog.clearSearch")}
                    className="cursor-pointer text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
                  >
                    <MdClose className="h-4 w-4" />
                  </button>
                )}
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-zinc-500 dark:text-zinc-400">{t("groups.reactionsDialog.sortBy")}</span>
                <div role="radiogroup" className="flex rounded-lg bg-zinc-100 p-0.5 dark:bg-zinc-900">
                  {SORTS.map((option) => (
                    <button
                      key={option}
                      type="button"
                      role="radio"
                      aria-checked={sort === option}
                      onClick={() => setSort(option)}
                      className={`cursor-pointer rounded-md px-2 py-1 text-xs font-medium transition ${
                        sort === option
                          ? "bg-white text-zinc-950 shadow-sm dark:bg-zinc-800 dark:text-zinc-50"
                          : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
                      }`}
                    >
                      {sortLabel[option]}
                    </button>
                  ))}
                </div>
                {current && !current.failed && (
                  <span className="ml-auto text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
                    {tc("groups.reactionsDialog.peopleCount", current.total)}
                  </span>
                )}
              </div>
            </div>

            {removeError && (
              <p className="shrink-0 px-3 pt-2 text-xs text-red-600 dark:text-red-400">{removeError}</p>
            )}
            <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto p-2">
              {!emoji ? (
                <p className="px-2 py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
                  {t("groups.reactionsDialog.empty")}
                </p>
              ) : !current ? (
                <ul className="flex flex-col gap-1" aria-hidden>
                  {[0, 1, 2, 3, 4].map((row) => (
                    <li key={row} className="flex items-center gap-3 px-2 py-1.5">
                      <span className="h-8 w-8 animate-pulse rounded-full bg-zinc-200 dark:bg-zinc-800" />
                      <span className="h-3 w-1/3 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
                    </li>
                  ))}
                </ul>
              ) : current.failed ? (
                <p className="px-2 py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
                  {t("groups.reactionsDialog.couldNotLoad")}
                </p>
              ) : current.people.length === 0 ? (
                <p className="px-2 py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
                  {query ? t("groups.reactionsDialog.noMatch") : t("groups.reactionsDialog.empty")}
                </p>
              ) : (
                <ul className="flex flex-col gap-0.5">
                  {current.people.map((person) => (
                    // The person and the × side by side, not one inside the other: a
                    // button inside a button is not something a browser builds.
                    <li key={person.id} className="group/row flex items-center gap-1 rounded-lg transition hover:bg-zinc-100 dark:hover:bg-zinc-900">
                      <button
                        type="button"
                        onClick={(e) => clickPerson(e, person)}
                        onContextMenu={(e) => contextPerson(e, person)}
                        onMouseEnter={() => !person.guest && prefetchUserProfile(person.id)}
                        title={t("groups.people.profileHint")}
                        className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 text-left"
                      >
                        <UserAvatar
                          src={person.avatarUrl}
                          name={person.name}
                          size={32}
                          userId={person.guest ? null : person.id}
                          isGuest={person.guest}
                        />
                        <span className="min-w-0 flex-1">
                          <DisplayUserName
                            name={person.name}
                            isGuest={person.guest}
                            verified={verifiedBadge(person.flags)}
                            bot={person.bot}
                            color={roleColorOf(detail, { id: person.id }) ?? person.nameColor}
                            className="block truncate text-sm font-medium text-zinc-900 dark:text-zinc-100"
                          />
                          {person.username && (
                            <span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">@{person.username}</span>
                          )}
                        </span>
                        {person.id === selfId && (
                          <span className="shrink-0 rounded-full bg-blue-500/10 px-2 py-0.5 text-[11px] font-medium text-blue-700 dark:text-blue-300">
                            {t("common.you")}
                          </span>
                        )}
                      </button>
                      {(person.id === selfId || canManageReactions) && (
                        <button
                          type="button"
                          onClick={() => void removeReaction(person)}
                          aria-label={
                            person.id === selfId
                              ? t("groups.reactionsDialog.removeMyReaction")
                              : t("groups.reactionsDialog.removeReaction", { name: person.name })
                          }
                          title={
                            person.id === selfId
                              ? t("groups.reactionsDialog.removeMyReaction")
                              : t("groups.reactionsDialog.removeReaction", { name: person.name })
                          }
                          // Always there on a touch screen; on hover (or focus) with a mouse.
                          className="mr-1 shrink-0 cursor-pointer rounded-full p-1.5 text-zinc-400 transition hover:bg-red-500/10 hover:text-red-600 focus-visible:opacity-100 sm:opacity-0 sm:group-hover/row:opacity-100 dark:hover:text-red-400"
                        >
                          <MdClose className="h-4 w-4" />
                        </button>
                      )}
                    </li>
                  ))}
                  {(loadingMore || current.next) && (
                    <li className="py-2 text-center text-xs text-zinc-500 dark:text-zinc-400">
                      {loadingMore ? (
                        t("common.loading")
                      ) : (
                        <button type="button" onClick={() => void loadMore()} className="cursor-pointer underline underline-offset-2">
                          {t("groups.reactionsDialog.loadMore")}
                        </button>
                      )}
                    </li>
                  )}
                </ul>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
