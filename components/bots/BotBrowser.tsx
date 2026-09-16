"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { MdCheck, MdClose, MdGroups, MdOpenInNew, MdRefresh, MdSearch, MdSmartToy } from "react-icons/md";
import { BotTag } from "@/components/BotTag";
import { Tooltip } from "@/components/Tooltip";
import { UserAvatar } from "@/components/UserAvatar";
import { UserProfileCard } from "@/components/UserProfileCard";
import { UserProfileDialog } from "@/components/UserProfileDialog";
import { VerifiedBadge } from "@/components/VerifiedBadge";
import {
  addBotToGroup,
  botAddPath,
  DEVELOPERS_URL,
  fetchBotDirectory,
  type BotDirectorySort,
  type DirectoryBot,
} from "@/lib/botsApi";
import { kickMember } from "@/lib/groupsApi";
import { refreshGroup } from "@/lib/useGroups";
import { useI18n } from "@/lib/useI18n";
import { avatarShapeClass } from "@/lib/avatarShape";

// Every public bot, to find one for a group — the body of a group's
// "Explorar bots" (see BotExplorerDialog) and of the /bots page.
//
// Public means anybody who runs a group may add it (see the API's
// AccountDoc.botPublic); a private bot is its owner's alone and is not listed.
// The list is the API's GET /bots, a page at a time as it scrolls, searched by
// name, @username and bio. Opened from a group whose settings this person may
// change, a card adds the bot straight to it; anywhere else it leads to the
// add page (/bots/:id/add), which asks which group.

const PAGE_SIZE = 24;

const SORTS: { id: BotDirectorySort; key: string }[] = [
  // The default: online bots first, then the ones more groups use.
  { id: "relevant", key: "botDirectory.sortRelevant" },
  { id: "popular", key: "botDirectory.sortPopular" },
  { id: "recent", key: "botDirectory.sortRecent" },
];

interface Page {
  /** The query this page answers — see pageKey. */
  key: string;
  bots: DirectoryBot[];
  total: number;
  hasMore: boolean;
  failed: boolean;
}

function pageKey(sort: BotDirectorySort, query: string): string {
  return JSON.stringify([sort, query.trim().toLowerCase()]);
}

/** The group a directory was opened from. */
export type BotBrowserGroup = {
  id: string;
  name: string;
  /** Whether this person may add bots to it — "Gerenciar grupo". */
  canAdd: boolean;
  /** Whether this person may take a bot out of it — "Expulsar membros". */
  canKick?: boolean;
};

export function BotBrowser({
  variant,
  group = null,
  onNavigate,
}: {
  /** Inside a dialog (its own scroll, profiles inside it) or as a page. */
  variant: "dialog" | "page";
  group?: BotBrowserGroup | null;
  /** Called before following a link out — the dialog closes itself. */
  onNavigate?: () => void;
}) {
  const { t, tc } = useI18n();
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [sort, setSort] = useState<BotDirectorySort>("relevant");
  const [page, setPage] = useState<Page | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  // Added from here, so the card says so without a round trip.
  const [addedIds, setAddedIds] = useState<ReadonlySet<string>>(() => new Set());
  // Taken out from here, which outranks what the list said when it loaded.
  const [removedIds, setRemovedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string; hint?: string } | null>(null);
  const [profileId, setProfileId] = useState<string | null>(null);

  const searchRef = useRef<HTMLInputElement | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const loadedKeyRef = useRef<string | null>(null);
  const loadingMoreRef = useRef(false);
  const [sentinel, setSentinel] = useState<HTMLDivElement | null>(null);

  const key = pageKey(sort, debounced);
  const groupId = group?.id ?? null;

  // Searching as you type, a beat after the typing stops.
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query), 300);
    return () => clearTimeout(timer);
  }, [query]);

  // The keyboard goes to the search where there is a keyboard — on a phone
  // that would be the on-screen one covering half the list.
  useEffect(() => {
    if (window.matchMedia("(hover: hover) and (pointer: fine)").matches) searchRef.current?.focus();
  }, []);

  useEffect(() => {
    if (loadedKeyRef.current === key) return;
    const controller = new AbortController();
    void fetchBotDirectory({ query: debounced, sort, limit: PAGE_SIZE, groupId }, controller.signal).then(
      (result) => {
        if (controller.signal.aborted) return;
        loadedKeyRef.current = key;
        setPage({
          key,
          bots: result?.bots ?? [],
          total: result?.total ?? 0,
          hasMore: result?.hasMore ?? false,
          failed: !result,
        });
      }
    );
    return () => controller.abort();
  }, [key, sort, debounced, groupId, attempt]);

  // The notice after adding one stands for a few seconds.
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(timer);
  }, [notice]);

  // In a dialog, Escape closes the profile rather than the dialog — caught
  // before the dialog library's own listener (on the document) hears it.
  useEffect(() => {
    if (!profileId || variant !== "dialog") return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setProfileId(null);
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [profileId, variant]);

  const loadMore = useCallback(async () => {
    if (!page || page.key !== key || !page.hasMore || loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    const result = await fetchBotDirectory({
      query: debounced,
      sort,
      offset: page.bots.length,
      limit: PAGE_SIZE,
      groupId,
    });
    loadingMoreRef.current = false;
    setLoadingMore(false);
    setPage((prev) => {
      if (!prev || prev.key !== key) return prev;
      if (!result) return { ...prev, failed: true };
      const seen = new Set(prev.bots.map((bot) => bot.id));
      return {
        ...prev,
        bots: [...prev.bots, ...result.bots.filter((bot) => !seen.has(bot.id))],
        total: result.total,
        hasMore: result.hasMore,
        failed: false,
      };
    });
  }, [page, key, debounced, sort, groupId]);

  // The next page as the end of the list comes into view. The sentinel is
  // made again with every page (see its key), and a new observer says at once
  // whether it is already in view — which is what loads the next page when one
  // page did not fill the space.
  const loadMoreRef = useRef(loadMore);
  useEffect(() => {
    loadMoreRef.current = loadMore;
  }, [loadMore]);
  useEffect(() => {
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void loadMoreRef.current();
      },
      { root: variant === "dialog" ? scrollerRef.current : null, rootMargin: "0px 0px 480px 0px" }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [sentinel, variant]);

  async function add(bot: DirectoryBot) {
    if (!group) return;
    setBusyId(bot.id);
    setNotice(null);
    const result = await addBotToGroup(group.id, bot.id);
    setBusyId(null);
    if (!result.ok) {
      setNotice({ tone: "error", text: result.error });
      return;
    }
    setAddedIds((prev) => new Set(prev).add(bot.id));
    setRemovedIds((prev) => {
      const next = new Set(prev);
      next.delete(bot.id);
      return next;
    });
    setNotice({
      tone: "ok",
      text: t("addBot.botAddedTo", { bot: bot.displayName, group: group.name }),
      hint: t("addBot.giveItARoleToModerate"),
    });
    void refreshGroup(group.id);
  }

  /** Kicks the bot out of the group — the same kick as anybody's. It can be added again. */
  async function remove(bot: DirectoryBot) {
    if (!group) return;
    setBusyId(bot.id);
    setNotice(null);
    const result = await kickMember(group.id, bot.id);
    setBusyId(null);
    if (!result.ok) {
      setNotice({ tone: "error", text: result.error });
      return;
    }
    setRemovedIds((prev) => new Set(prev).add(bot.id));
    setAddedIds((prev) => {
      const next = new Set(prev);
      next.delete(bot.id);
      return next;
    });
    setNotice({ tone: "ok", text: t("botDirectory.removedFrom", { bot: bot.displayName, group: group.name }) });
    void refreshGroup(group.id);
  }

  function retry() {
    loadedKeyRef.current = null;
    setPage(null);
    setAttempt((n) => n + 1);
  }

  const loading = page?.key !== key;
  const bots = page?.bots ?? [];
  const searched = debounced.trim();

  const toolbar = (
    <div className="flex flex-wrap items-center gap-2">
      <label className="relative flex min-w-0 flex-[1_1_16rem] items-center">
        <MdSearch className="pointer-events-none absolute left-2.5 h-4 w-4 text-zinc-400" />
        <input
          ref={searchRef}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("botDirectory.searchPlaceholder")}
          aria-label={t("botDirectory.searchPlaceholder")}
          maxLength={60}
          className="w-full rounded-lg border border-zinc-300 bg-white py-2 pl-8 pr-8 text-sm text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 [&::-webkit-search-cancel-button]:hidden"
        />
        {query && (
          <button
            type="button"
            onClick={() => {
              setQuery("");
              searchRef.current?.focus();
            }}
            aria-label={t("themeBrowser.clearSearch")}
            className="absolute right-1.5 rounded-md p-1 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-900 dark:hover:text-zinc-200"
          >
            <MdClose className="h-4 w-4" />
          </button>
        )}
      </label>
      <div className="inline-flex rounded-lg border border-zinc-300 p-0.5 dark:border-zinc-700" role="group" aria-label={t("themeBrowser.sortBy")}>
        {SORTS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => setSort(entry.id)}
            aria-pressed={sort === entry.id}
            className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition ${
              sort === entry.id
                ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
            }`}
          >
            {t(entry.key)}
          </button>
        ))}
      </div>
    </div>
  );

  const grid = (
    <>
      {group && !group.canAdd && (
        <p className="mb-3 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/40 dark:text-zinc-400">
          {t("botDirectory.cannotManageHint", { group: group.name })}
        </p>
      )}
      {notice && (
        <div
          role={notice.tone === "error" ? "alert" : "status"}
          className={`mb-3 flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${
            notice.tone === "error"
              ? "border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300"
              : "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300"
          }`}
        >
          <span className="flex-1">
            {notice.text}
            {notice.hint && <span className="mt-0.5 block text-xs opacity-80">{notice.hint}</span>}
          </span>
          <button type="button" onClick={() => setNotice(null)} aria-label={t("common.close")} className="shrink-0">
            <MdClose className="h-4 w-4" />
          </button>
        </div>
      )}

      {!loading && page && !page.failed && page.total > 0 && (
        <p className="mb-2 text-xs text-zinc-500 dark:text-zinc-400">{tc("botDirectory.count", page.total)}</p>
      )}

      {loading && bots.length === 0 ? (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,15rem),1fr))] gap-3">
          {Array.from({ length: 6 }, (_, index) => (
            <li key={index} className="overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800">
              <span className="block h-16 animate-pulse bg-zinc-100 dark:bg-zinc-900" />
              <span className="m-3 block h-3 w-2/3 animate-pulse rounded bg-zinc-100 dark:bg-zinc-900" />
              <span className="mx-3 mb-3 block h-8 animate-pulse rounded-lg bg-zinc-100 dark:bg-zinc-900" />
            </li>
          ))}
        </ul>
      ) : page?.failed && bots.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-12 text-center">
          <p className="text-sm text-zinc-500 dark:text-zinc-400">{t("botDirectory.loadFailed")}</p>
          <button
            type="button"
            onClick={retry}
            className="flex items-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            <MdRefresh className="h-4 w-4" />
            {t("themeBrowser.tryAgain")}
          </button>
        </div>
      ) : bots.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-12 text-center">
          <MdSmartToy className="h-10 w-10 text-zinc-300 dark:text-zinc-700" />
          <p className="max-w-sm text-sm text-zinc-500 dark:text-zinc-400">
            {searched ? t("botDirectory.noResultsFor", { query: searched }) : t("botDirectory.noBots")}
          </p>
          {searched ? (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
            >
              {t("themeBrowser.clearSearch")}
            </button>
          ) : (
            <a
              href={DEVELOPERS_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-medium underline underline-offset-2"
            >
              {t("botDirectory.createYourOwn")}
            </a>
          )}
        </div>
      ) : (
        <>
          <ul
            className={`grid grid-cols-[repeat(auto-fill,minmax(min(100%,15rem),1fr))] gap-3 transition-opacity ${
              loading ? "opacity-50" : ""
            }`}
          >
            {bots.map((bot) => (
              <BotCard
                key={bot.id}
                bot={bot}
                group={group}
                inGroup={!removedIds.has(bot.id) && (Boolean(bot.inGroup) || addedIds.has(bot.id))}
                busy={busyId === bot.id}
                onAdd={() => void add(bot)}
                onRemove={() => void remove(bot)}
                onOpenProfile={() => setProfileId(bot.id)}
                onNavigate={onNavigate}
              />
            ))}
          </ul>
          {page?.hasMore && (
            <div className="mt-4 flex flex-col items-center gap-2">
              {/* Keyed by how much is loaded: see the observer above. */}
              <div key={bots.length} ref={setSentinel} aria-hidden className="h-px w-full" />
              <button
                type="button"
                onClick={() => void loadMore()}
                disabled={loadingMore}
                className="rounded-lg border border-zinc-300 px-4 py-2 text-xs font-medium text-zinc-700 transition hover:bg-zinc-100 disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
              >
                {loadingMore ? t("common.loading") : t("themeBrowser.loadMore")}
              </button>
            </div>
          )}
        </>
      )}
    </>
  );

  if (variant === "page") {
    return (
      <>
        <div className="sticky top-0 z-10 -mx-4 border-b border-zinc-200 bg-zinc-50/90 px-4 py-3 backdrop-blur dark:border-zinc-800 dark:bg-black/80">
          {toolbar}
        </div>
        <div className="pt-4">{grid}</div>
        {profileId && <UserProfileDialog userId={profileId} onClose={() => setProfileId(null)} />}
      </>
    );
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b border-zinc-200 px-4 py-3 sm:px-5 dark:border-zinc-800">{toolbar}</div>
      <div ref={scrollerRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
        {grid}
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-zinc-200 px-4 py-2.5 text-[11px] text-zinc-500 sm:px-5 dark:border-zinc-800 dark:text-zinc-400">
        <a
          href={DEVELOPERS_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 font-medium underline-offset-2 transition hover:text-zinc-900 hover:underline dark:hover:text-zinc-100"
        >
          <MdSmartToy className="h-3.5 w-3.5" />
          {t("botDirectory.createYourOwn")}
        </a>
        <Link
          href="/bots"
          onClick={onNavigate}
          className="flex items-center gap-1 font-medium underline-offset-2 transition hover:text-zinc-900 hover:underline dark:hover:text-zinc-100"
        >
          {t("botDirectory.openBotsPage")}
          <MdOpenInNew className="h-3 w-3" />
        </Link>
      </div>

      {/* The bot's profile, over the list and inside the dialog: the dialog
          library keeps one popup at a time, so a second window would close
          this one. */}
      {profileId && (
        <div
          className="absolute inset-0 z-20 overflow-y-auto bg-white/80 p-3 backdrop-blur-sm sm:p-6 dark:bg-zinc-950/80"
          onClick={() => setProfileId(null)}
          role="dialog"
          aria-modal="true"
          aria-label={t("common.profile")}
        >
          <div className="relative mx-auto w-full max-w-xl" onClick={(e) => e.stopPropagation()}>
            <div className="absolute right-3 top-3 z-10 flex items-center gap-1.5">
              <Tooltip content={t("userProfileDialog.openTheProfileInANew")}>
                <Link
                  href={`/user/${profileId}`}
                  target="_blank"
                  aria-label={t("userProfileDialog.openTheProfileInANew")}
                  className="flex rounded-full bg-black/50 p-2 text-white transition hover:bg-black/70"
                >
                  <MdOpenInNew className="h-4 w-4" />
                </Link>
              </Tooltip>
              <Tooltip content={t("common.close")}>
                <button
                  type="button"
                  onClick={() => setProfileId(null)}
                  aria-label={t("userProfileDialog.closeProfile")}
                  className="flex rounded-full bg-black/50 p-2 text-white transition hover:bg-black/70"
                >
                  <MdClose className="h-4 w-4" />
                </button>
              </Tooltip>
            </div>
            <UserProfileCard id={profileId} onNavigate={onNavigate} />
          </div>
        </div>
      )}
    </div>
  );
}

/** One bot: its banner and face, what it says about itself, and the one verb. */
function BotCard({
  bot,
  group,
  inGroup,
  busy,
  onAdd,
  onRemove,
  onOpenProfile,
  onNavigate,
}: {
  bot: DirectoryBot;
  group: BotBrowserGroup | null;
  inGroup: boolean;
  busy: boolean;
  onAdd: () => void;
  /** Kicks it out of the group — offered only to somebody who may. */
  onRemove: () => void;
  onOpenProfile: () => void;
  onNavigate?: () => void;
}) {
  const { t, tc } = useI18n();
  const accent = bot.nameColor ?? "#6366f1";
  const profileLabel = t("common.seeDisplaynameSProfile", { displayName: bot.displayName });

  let action: React.ReactNode;
  if (group && inGroup) {
    // Already in: out again, for whoever may kick — "no grupo" for the rest.
    action = group.canKick ? (
      <button
        type="button"
        onClick={onRemove}
        disabled={busy}
        className="w-full cursor-pointer rounded-lg border border-red-300 px-3 py-2 text-xs font-semibold text-red-600 transition hover:bg-red-50 disabled:opacity-60 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/40"
      >
        {busy ? t("common.removing") : t("botDirectory.removeFromGroup")}
      </button>
    ) : (
      <span className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-emerald-500/50 px-3 py-2 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
        <MdCheck className="h-4 w-4" />
        {t("botDirectory.inThisGroup")}
      </span>
    );
  } else if (group?.canAdd) {
    action = (
      <button
        type="button"
        onClick={onAdd}
        disabled={busy}
        className="w-full rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-indigo-500 disabled:opacity-60"
      >
        {busy ? t("addBot.adding") : t("addBot.addToGroup")}
      </button>
    );
  } else {
    action = (
      <Link
        href={botAddPath(bot.id)}
        onClick={onNavigate}
        className="flex w-full items-center justify-center rounded-lg border border-indigo-500/50 px-3 py-2 text-xs font-semibold text-indigo-700 transition hover:bg-indigo-500/10 dark:text-indigo-300"
      >
        {t("addBot.addToAGroup")}
      </Link>
    );
  }

  return (
    <li className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white transition hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-zinc-700">
      <button
        type="button"
        onClick={onOpenProfile}
        aria-label={profileLabel}
        className="relative block h-16 w-full shrink-0 cursor-pointer overflow-hidden"
        style={{ background: `linear-gradient(135deg, ${accent}, #18181b)` }}
      >
        {bot.bannerUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- a banner from any host
          <img src={bot.bannerUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
        )}
      </button>
      <div className="flex flex-1 flex-col gap-1.5 px-3 pb-3">
        <button
          type="button"
          onClick={onOpenProfile}
          aria-label={profileLabel}
          // Positioned, so it paints over the banner above — which is itself
          // positioned, and would otherwise cover the half that overlaps it.
          className={`relative z-10 -mt-7 self-start ${avatarShapeClass(bot.avatarUrl)} ring-4 ring-white dark:ring-zinc-950`}
        >
          {/* The avatar draws its own presence dot from the user id. */}
          <UserAvatar src={bot.avatarUrl} name={bot.displayName} size={52} userId={bot.id} />
        </button>
        <button type="button" onClick={onOpenProfile} className="min-w-0 cursor-pointer text-left">
          <span className="flex min-w-0 items-center gap-1.5">
            <span
              className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100"
              style={bot.nameColor ? { color: bot.nameColor } : undefined}
            >
              {bot.displayName}
            </span>
            <VerifiedBadge flags={bot.flags} className="h-4 w-4 shrink-0" />
            <BotTag className="shrink-0" />
          </span>
          <span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">@{bot.username}</span>
        </button>
        {bot.bio && (
          <p className="line-clamp-2 whitespace-pre-line text-xs leading-snug text-zinc-600 dark:text-zinc-400">{bot.bio}</p>
        )}
        <p className="flex items-center gap-1 text-[11px] text-zinc-500 dark:text-zinc-400">
          <MdGroups className="h-3.5 w-3.5 shrink-0" />
          {tc("botDirectory.inGroups", bot.groupCount)}
        </p>
        <div className="mt-auto flex items-center gap-1.5 pt-1">
          {/* The profile, in its dialog — the same one the picture and the
              name open, as a button somebody does not have to discover. */}
          <button
            type="button"
            onClick={onOpenProfile}
            className="shrink-0 cursor-pointer rounded-lg border border-zinc-300 px-3 py-2 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            {t("botDirectory.viewProfile")}
          </button>
          <div className="min-w-0 flex-1">{action}</div>
        </div>
      </div>
    </li>
  );
}
