"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MdCheck, MdGroups, MdRefresh, MdVolumeUp } from "react-icons/md";
import { GroupIcon } from "@/components/groups/GroupIcon";
import { GroupLink } from "@/components/groups/GroupLink";
import { GroupName } from "@/components/groups/GroupName";
import { groupPath } from "@/lib/groupLinks";
import {
  fetchPublicGroupDirectory,
  searchPublicGroups,
  type PublicGroupListing,
  type PublicGroupSort,
} from "@/lib/groupsApi";
import { prefetchGroup } from "@/lib/useGroups";
import { useI18n } from "@/lib/useI18n";

// Every public group, on /groups — browsable with nothing typed, a page at a
// time as it scrolls, in the same cards as the other directories (/bots, the
// themes). It used to be search-only: public groups showed up once two letters
// were typed, and never more than twenty.
//
// The words come from the page's own search bar (see GroupsHome), which also
// narrows your own groups above; here they go to the server (the API's GET
// /groups/public). Opening a card is opening the group, which for a group you
// are not in is its join card (see GroupPages' GroupGate).

const PAGE_SIZE = 24;
const SEARCH_DEBOUNCE_MS = 250;

const SORTS: { id: PublicGroupSort; key: string }[] = [
  { id: "online", key: "groups.publicDirectory.sortOnline" },
  { id: "members", key: "groups.publicDirectory.sortMembers" },
  { id: "recent", key: "groups.publicDirectory.sortRecent" },
];

interface Page {
  key: string;
  groups: PublicGroupListing[];
  total: number;
  hasMore: boolean;
  failed: boolean;
}

function pageKey(sort: PublicGroupSort, query: string): string {
  return JSON.stringify([sort, query.trim().toLowerCase()]);
}

/** A colour of its own for each group's card, from its id — its icon is on top. */
function bannerFor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  const hue = Math.abs(hash) % 360;
  return `linear-gradient(135deg, hsl(${hue} 65% 52%), hsl(${(hue + 40) % 360} 60% 30%))`;
}

export function PublicGroupsDirectory({ query, myGroupIds }: { query: string; myGroupIds: ReadonlySet<string> }) {
  const { t, tc } = useI18n();
  const [debounced, setDebounced] = useState(query);
  const [sort, setSort] = useState<PublicGroupSort>("online");
  const [page, setPage] = useState<Page | null>(null);
  // An API from before the directory: fall back to the old search, which
  // wants words.
  const [unsupported, setUnsupported] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const loadedKeyRef = useRef<string | null>(null);
  const loadingMoreRef = useRef(false);
  const [sentinel, setSentinel] = useState<HTMLDivElement | null>(null);

  const key = pageKey(sort, debounced);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (loadedKeyRef.current === key) return;
    const controller = new AbortController();
    const trimmed = debounced.trim();
    const load = unsupported
      ? // The old search: words only, one page of twenty.
        trimmed.length >= 2
        ? searchPublicGroups(trimmed, controller.signal).then((result) =>
            result.ok
              ? {
                  groups: result.groups.map((g) => ({ ...g, inCallCount: 0, createdAt: 0 })),
                  total: result.groups.length,
                  hasMore: false,
                  failed: false,
                }
              : { groups: [], total: 0, hasMore: false, failed: result.status !== 404 }
          )
        : Promise.resolve({ groups: [], total: 0, hasMore: false, failed: false })
      : fetchPublicGroupDirectory({ query: debounced, sort, limit: PAGE_SIZE }, controller.signal).then((result) => {
          if (!result.ok && result.status === 404) {
            setUnsupported(true);
            return null;
          }
          return result.ok
            ? { groups: result.groups, total: result.total, hasMore: result.hasMore, failed: false }
            : { groups: [], total: 0, hasMore: false, failed: true };
        });
    void load
      .then((next) => {
        if (controller.signal.aborted || !next) return;
        loadedKeyRef.current = key;
        setPage({ key, ...next });
      })
      .catch(() => {
        // Aborted: a newer query took its place.
      });
    return () => controller.abort();
  }, [key, debounced, sort, unsupported, attempt]);

  const loadMore = useCallback(async () => {
    if (!page || page.key !== key || !page.hasMore || loadingMoreRef.current || unsupported) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    const result = await fetchPublicGroupDirectory({ query: debounced, sort, offset: page.groups.length, limit: PAGE_SIZE });
    loadingMoreRef.current = false;
    setLoadingMore(false);
    setPage((prev) => {
      if (!prev || prev.key !== key) return prev;
      if (!result.ok) return { ...prev, failed: true };
      const seen = new Set(prev.groups.map((g) => g.id));
      return {
        ...prev,
        groups: [...prev.groups, ...result.groups.filter((g) => !seen.has(g.id))],
        total: result.total,
        hasMore: result.hasMore,
        failed: false,
      };
    });
  }, [page, key, debounced, sort, unsupported]);

  // The next page as the end of the list comes into view — see the same
  // arrangement, and why the sentinel is keyed, in BotBrowser.
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
      { rootMargin: "0px 0px 480px 0px" }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [sentinel]);

  function retry() {
    loadedKeyRef.current = null;
    setPage(null);
    setAttempt((n) => n + 1);
  }

  const loading = page?.key !== key;
  const groups = page?.groups ?? [];
  const searched = debounced.trim();

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          {page && !loading && !page.failed && page.total > 0
            ? tc("groups.publicDirectory.count", page.total)
            : t("groups.publicDirectory.subtitle")}
        </p>
        {!unsupported && (
          <div className="inline-flex rounded-lg border border-zinc-300 p-0.5 dark:border-zinc-700" role="group">
            {SORTS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => setSort(entry.id)}
                aria-pressed={sort === entry.id}
                className={`cursor-pointer rounded-md px-2.5 py-1.5 text-xs font-medium transition ${
                  sort === entry.id
                    ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                    : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                }`}
              >
                {t(entry.key)}
              </button>
            ))}
          </div>
        )}
      </div>

      {loading && groups.length === 0 ? (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,14rem),1fr))] gap-3">
          {Array.from({ length: 6 }, (_, index) => (
            <li key={index} className="overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800">
              <span className="block h-14 animate-pulse bg-zinc-100 dark:bg-zinc-900" />
              <span className="m-3 block h-3 w-2/3 animate-pulse rounded bg-zinc-100 dark:bg-zinc-900" />
              <span className="mx-3 mb-3 block h-8 animate-pulse rounded-lg bg-zinc-100 dark:bg-zinc-900" />
            </li>
          ))}
        </ul>
      ) : page?.failed && groups.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <p className="text-sm text-zinc-500 dark:text-zinc-400">{t("groups.publicDirectory.loadFailed")}</p>
          <button
            type="button"
            onClick={retry}
            className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            <MdRefresh className="h-4 w-4" />
            {t("themeBrowser.tryAgain")}
          </button>
        </div>
      ) : groups.length === 0 ? (
        <p className="py-6 text-center text-sm text-zinc-500 dark:text-zinc-400">
          {unsupported && searched.length < 2
            ? t("groups.groupsHome.typeMoreToSearch")
            : searched
              ? t("groups.groupsHome.noPublicGroupsFound", { query: searched })
              : t("groups.publicDirectory.empty")}
        </p>
      ) : (
        <>
          <ul
            className={`grid grid-cols-[repeat(auto-fill,minmax(min(100%,14rem),1fr))] gap-3 transition-opacity ${
              loading ? "opacity-50" : ""
            }`}
          >
            {groups.map((group) => (
              <PublicGroupCard key={group.id} group={group} member={group.member || myGroupIds.has(group.id)} />
            ))}
          </ul>
          {page?.hasMore && !unsupported && (
            <div className="mt-1 flex flex-col items-center gap-2">
              <div key={groups.length} ref={setSentinel} aria-hidden className="h-px w-full" />
              <button
                type="button"
                onClick={() => void loadMore()}
                disabled={loadingMore}
                className="cursor-pointer rounded-lg border border-zinc-300 px-4 py-2 text-xs font-medium text-zinc-700 transition hover:bg-zinc-100 disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
              >
                {loadingMore ? t("common.loading") : t("themeBrowser.loadMore")}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** One public group: its face on a colour of its own, its blurb, how alive it is, and the way in. */
function PublicGroupCard({ group, member }: { group: PublicGroupListing; member: boolean }) {
  const { t, tc } = useI18n();
  return (
    <li className="min-w-0">
      <GroupLink
        href={groupPath(group.id)}
        onMouseEnter={() => (member ? prefetchGroup(group.id) : undefined)}
        className="flex h-full min-w-0 flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white transition hover:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-zinc-600"
      >
        <span className="block h-14 w-full shrink-0" style={{ background: bannerFor(group.id) }} />
        <span className="flex flex-1 flex-col gap-1.5 px-3 pb-3">
          <span className="-mt-7 self-start rounded-xl bg-white ring-4 ring-white dark:bg-zinc-950 dark:ring-zinc-950">
            <GroupIcon name={group.name} iconUrl={group.iconUrl} seed={group.id} size={52} className="rounded-xl" />
          </span>
          <span className="flex min-w-0 items-center gap-1.5">
            <GroupName
              name={group.name}
              flags={group.flags}
              className="min-w-0 text-sm font-semibold text-zinc-900 dark:text-zinc-100"
              badgeClassName="h-3.5 w-3.5"
            />
            {member && (
              <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-400">
                <MdCheck className="h-3 w-3" />
                {t("groups.publicDirectory.member")}
              </span>
            )}
          </span>
          {group.description && (
            <span className="line-clamp-2 text-xs leading-snug text-zinc-600 dark:text-zinc-400">{group.description}</span>
          )}
          <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-zinc-500 dark:text-zinc-400">
            <span className="inline-flex items-center gap-1">
              <MdGroups className="h-3.5 w-3.5 shrink-0" />
              {tc("common.memberCount", group.memberCount)}
            </span>
            {group.onlineCount > 0 && (
              <span className="inline-flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                {t("groups.groupRail.onlineCount", { count: group.onlineCount })}
              </span>
            )}
            {group.inCallCount > 0 && (
              <span className="inline-flex items-center gap-1 font-medium text-emerald-700 dark:text-emerald-400">
                <MdVolumeUp className="h-3.5 w-3.5 shrink-0" />
                {t("groups.publicDirectory.inCall", { count: group.inCallCount })}
              </span>
            )}
          </span>
          <span
            className={`mt-auto flex items-center justify-center rounded-lg px-3 py-1.5 text-xs font-semibold ${
              member
                ? "border border-zinc-300 text-zinc-700 dark:border-zinc-700 dark:text-zinc-300"
                : "bg-zinc-950 text-white dark:bg-zinc-50 dark:text-zinc-950"
            }`}
          >
            {member ? t("groups.homeGroupsPanel.open") : t("groups.publicDirectory.join")}
          </span>
        </span>
      </GroupLink>
    </li>
  );
}
