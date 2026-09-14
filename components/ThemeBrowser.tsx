"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  MdClose,
  MdEdit,
  MdFavorite,
  MdFavoriteBorder,
  MdOpenInNew,
  MdPeople,
  MdRefresh,
  MdSearch,
  MdVisibility,
} from "react-icons/md";
import { BsCoin } from "react-icons/bs";
import { AccountModal, type AccountModalMode } from "@/components/AccountModal";
import { CopyButton } from "@/components/CopyButton";
import { DisplayUserName } from "@/components/DisplayUserName";
import { NoThemeMiniPreview, ThemeMiniPreview } from "@/components/ThemeMiniPreview";
import { Tooltip } from "@/components/Tooltip";
import { UserAvatar } from "@/components/UserAvatar";
import { UserProfileCard } from "@/components/UserProfileCard";
import { verifiedBadge } from "@/lib/entitlements";
import { formatLocale } from "@/lib/i18n";
import {
  fetchMyThemes,
  fetchOwnedThemes,
  fetchTheme,
  fetchWorkshopPage,
  getCachedTheme,
  isDarkTheme,
  likeTheme,
  themeLink,
  type RoomTheme,
  type WorkshopPrice,
  type WorkshopSort,
} from "@/lib/roomThemes";
import { endThemePreview, startThemePreview, useThemeChoice, type ThemeTarget } from "@/lib/themeChoice";
import { useT } from "@/lib/useI18n";

// Every theme there is, to pick one from — the body of both theme dialogs: the
// theme button's own (what you wear, see ThemeHubDialog) and "Tema da sala" /
// "Tema do grupo" (what everybody in it sees, see RoomThemePicker).
//
// It replaced two short lists: the hub's first sixty "most used" and the room
// picker's first twelve, neither searchable, so a theme outside those could
// only be reached by its link. This is the whole workshop, a page at a time as
// it scrolls, searchable by name, description and author, filterable by
// price — and every card can be tried on the real room first (see
// lib/themeChoice's preview), paid ones included, without buying or applying
// anything.

type Scope = "discover" | "mine";

const PAGE_SIZE = 24;

const SORTS: { id: WorkshopSort; key: string }[] = [
  { id: "popular", key: "workshop.workshopPanel.mostUsed" },
  { id: "liked", key: "workshop.workshopPanel.mostLiked" },
  { id: "recent", key: "workshop.workshopPanel.recent" },
];

const PRICES: { id: WorkshopPrice; key: string }[] = [
  { id: "all", key: "themeBrowser.priceAll" },
  { id: "free", key: "themeBrowser.priceFree" },
  { id: "paid", key: "themeBrowser.pricePaid" },
];

interface Page {
  /** The query this page answers — see pageKey. */
  key: string;
  themes: RoomTheme[];
  hasMore: boolean;
  failed: boolean;
}

interface BrowseState {
  scope: Scope;
  query: string;
  sort: WorkshopSort;
  price: WorkshopPrice;
  page: Page | null;
  scrollTop: number;
}

// Where each dialog was left, so coming back from a preview (see
// ThemePreviewBar) lands on the same search, the same filters, the same pages
// and the same scroll — not back at the top of a list somebody had scrolled
// half-way down. Per kind of dialog, and for this page load only.
const lastBrowse: Partial<Record<ThemeTarget["kind"], BrowseState>> = {};
// The list's scroll, kept as it moves: by the time a closing dialog's effects
// are cleaned up the list is already gone from the page, and so is its scroll.
const lastScroll: Partial<Record<ThemeTarget["kind"], number>> = {};

function pageKey(sort: WorkshopSort, price: WorkshopPrice, query: string): string {
  return JSON.stringify([sort, price, query.trim().toLowerCase()]);
}

function matchesTheme(theme: RoomTheme, folded: string, price: WorkshopPrice): boolean {
  if (price === "free" && theme.price > 0) return false;
  if (price === "paid" && theme.price === 0) return false;
  if (!folded) return true;
  return (
    theme.name.toLowerCase().includes(folded) ||
    theme.description.toLowerCase().includes(folded) ||
    (theme.author?.displayName.toLowerCase().includes(folded) ?? false) ||
    (theme.author?.username.toLowerCase().includes(folded) ?? false)
  );
}

function formatPoints(value: number): string {
  return value.toLocaleString(formatLocale());
}

export function ThemeBrowser({
  target,
  onClose,
  resume = false,
  onEditTheme,
}: {
  target: ThemeTarget;
  /** Closes the dialog this is in. `true` when something was chosen. */
  onClose: (hasAction?: boolean) => void;
  /** Coming back from a preview: pick up where the dialog was left. */
  resume?: boolean;
  /** Opens the editor on one of your own — the hub's, which has an editor to open. */
  onEditTheme?: (theme: RoomTheme) => void;
}) {
  const t = useT();
  const { account, points, current, choose, buy } = useThemeChoice(target);
  const accountId = account?.id ?? null;
  const [initial] = useState(() => (resume ? (lastBrowse[target.kind] ?? null) : null));

  const [scope, setScope] = useState<Scope>(initial?.scope ?? "discover");
  const [query, setQuery] = useState(initial?.query ?? "");
  const [debounced, setDebounced] = useState(initial?.query ?? "");
  const [sort, setSort] = useState<WorkshopSort>(initial?.sort ?? "popular");
  const [price, setPrice] = useState<WorkshopPrice>(initial?.price ?? "all");
  const [page, setPage] = useState<Page | null>(initial?.page ?? null);
  const [attempt, setAttempt] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [mine, setMine] = useState<{ authored: RoomTheme[]; owned: RoomTheme[]; loaded: boolean }>({
    authored: [],
    owned: [],
    loaded: false,
  });
  const [busyId, setBusyId] = useState<string | null>(null);
  // A purchase takes two presses: the first turns the button into the
  // confirmation, with the price on it, and it turns back on its own.
  const [confirmBuyId, setConfirmBuyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [accountModal, setAccountModal] = useState<AccountModalMode | null>(null);
  // Whose profile is open, inside this dialog rather than over it: the dialog
  // library keeps one popup at a time, and a profile opened as a second
  // window would close this one — or be closed with it by the same Escape.
  const [profileId, setProfileId] = useState<string | null>(null);
  const [currentFetched, setCurrentFetched] = useState<RoomTheme | null>(null);

  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const loadedKeyRef = useRef<string | null>(initial?.page?.key ?? null);
  const loadingMoreRef = useRef(false);
  const [sentinel, setSentinel] = useState<HTMLDivElement | null>(null);

  const key = pageKey(sort, price, debounced);
  const folded = debounced.trim().toLowerCase();

  // A preview left on from before — the bar's own theme, if this opened while
  // it was up — is over now: the dialog is what is being looked at.
  useEffect(() => {
    endThemePreview();
  }, []);

  // Searching as you type, a beat after the typing stops.
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query), 300);
    return () => clearTimeout(timer);
  }, [query]);

  // The search box has the keyboard from the start where there is a keyboard
  // — on a phone that would be the on-screen one covering half the grid.
  useEffect(() => {
    if (window.matchMedia("(hover: hover) and (pointer: fine)").matches) searchRef.current?.focus();
  }, []);

  // Back where it was left, once the pages are there to scroll through. A
  // dialog opened afresh starts at the top, and remembers from there.
  useEffect(() => {
    if (!initial) lastScroll[target.kind] = 0;
    else if (initial.scrollTop && scrollerRef.current) scrollerRef.current.scrollTop = initial.scrollTop;
  }, [initial, target.kind]);

  // Remembered on the way out — see lastBrowse. Written on every change as
  // well as the last, which costs nothing and means the last one is always
  // what the dialog looked like when it closed.
  useEffect(() => {
    const kind = target.kind;
    return () => {
      lastBrowse[kind] = {
        scope,
        query,
        sort,
        price,
        page,
        scrollTop: lastScroll[kind] ?? 0,
      };
    };
  }, [target.kind, scope, query, sort, price, page]);

  // The first page for whatever the search and the filters now say. Only
  // while the workshop is the tab on screen, and not again for a page already
  // in hand (switching tabs, coming back from a preview).
  useEffect(() => {
    if (scope !== "discover") return;
    if (loadedKeyRef.current === key) return;
    const controller = new AbortController();
    void fetchWorkshopPage({ sort, price, query: debounced, limit: PAGE_SIZE }, controller.signal).then(
      (result) => {
        if (controller.signal.aborted) return;
        loadedKeyRef.current = key;
        setPage({ key, themes: result.themes, hasMore: result.hasMore, failed: !result.ok });
      }
    );
    return () => controller.abort();
  }, [scope, key, sort, price, debounced, attempt]);

  // Yours: the ones you made (private ones included) and the ones you bought.
  useEffect(() => {
    if (!accountId) return;
    const controller = new AbortController();
    void Promise.all([fetchMyThemes(controller.signal), fetchOwnedThemes(controller.signal)]).then(
      ([authored, owned]) => {
        if (!controller.signal.aborted) setMine({ authored, owned, loaded: true });
      }
    );
    return () => controller.abort();
  }, [accountId]);

  // The confirmation stands for a few seconds, then the button is a button again.
  useEffect(() => {
    if (!confirmBuyId) return;
    const timer = setTimeout(() => setConfirmBuyId(null), 5000);
    return () => clearTimeout(timer);
  }, [confirmBuyId]);

  // Escape closes the profile, not the dialog — caught before the dialog
  // library's own listener (on the document) ever hears it.
  useEffect(() => {
    if (!profileId) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setProfileId(null);
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [profileId]);

  const loadMore = useCallback(async () => {
    if (!page || page.key !== key || !page.hasMore || loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    const result = await fetchWorkshopPage({
      sort,
      price,
      query: debounced,
      offset: page.themes.length,
      limit: PAGE_SIZE,
    });
    loadingMoreRef.current = false;
    setLoadingMore(false);
    setPage((prev) => {
      if (!prev || prev.key !== key) return prev;
      if (!result.ok) return { ...prev, failed: true };
      const seen = new Set(prev.themes.map((theme) => theme.id));
      return {
        ...prev,
        themes: [...prev.themes, ...result.themes.filter((theme) => !seen.has(theme.id))],
        hasMore: result.hasMore,
        failed: false,
      };
    });
  }, [page, key, sort, price, debounced]);

  // The next page as the end of the list comes into view. The sentinel is
  // re-created with every page (see its key), and a fresh observer reports
  // at once whether it is already in view — which is what fetches the next
  // page when one page was not enough to fill the dialog.
  const loadMoreRef = useRef(loadMore);
  useEffect(() => {
    loadMoreRef.current = loadMore;
  }, [loadMore]);
  useEffect(() => {
    const root = scrollerRef.current;
    if (!sentinel || !root) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void loadMoreRef.current();
      },
      { root, rootMargin: "0px 0px 480px 0px" }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [sentinel]);

  const myThemes = (() => {
    if (!accountId) return [];
    const seen = new Set<string>();
    return [...mine.authored, ...mine.owned].filter((theme) => {
      if (seen.has(theme.id)) return false;
      seen.add(theme.id);
      return true;
    });
  })();

  const loading = scope === "discover" && page?.key !== key;
  const shown = scope === "discover" ? (page?.themes ?? []) : myThemes.filter((theme) => matchesTheme(theme, folded, price));

  // The theme on now, for the strip at the top: from any list that has it,
  // then from what this tab already read, then asked for.
  const currentTheme =
    (current &&
      (myThemes.find((theme) => theme.id === current) ??
        page?.themes.find((theme) => theme.id === current) ??
        getCachedTheme(current) ??
        (currentFetched?.id === current ? currentFetched : null))) ||
    null;
  const needsCurrent = Boolean(current && !currentTheme);
  useEffect(() => {
    if (!needsCurrent || !current) return;
    const controller = new AbortController();
    void fetchTheme(current, controller.signal).then((theme) => {
      if (!controller.signal.aborted && theme) setCurrentFetched(theme);
    });
    return () => controller.abort();
  }, [needsCurrent, current]);

  function patchTheme(id: string, patch: Partial<RoomTheme>) {
    const apply = (list: RoomTheme[]) => list.map((theme) => (theme.id === id ? { ...theme, ...patch } : theme));
    setPage((prev) => (prev ? { ...prev, themes: apply(prev.themes) } : prev));
    setMine((prev) => ({ ...prev, authored: apply(prev.authored), owned: apply(prev.owned) }));
  }

  function preview(theme: RoomTheme) {
    startThemePreview({ theme, target });
    onClose(false);
  }

  async function run(id: string, action: () => Promise<string | null>): Promise<boolean> {
    setBusyId(id);
    setError(null);
    const failure = await action();
    setBusyId(null);
    if (failure) setError(failure);
    return !failure;
  }

  async function primary(theme: RoomTheme) {
    if (!account) {
      setAccountModal("create");
      return;
    }
    if (!theme.owned) {
      if (confirmBuyId !== theme.id) {
        setConfirmBuyId(theme.id);
        return;
      }
      setConfirmBuyId(null);
      if (await run(theme.id, () => buy(theme))) {
        patchTheme(theme.id, { owned: true });
        setMine((prev) =>
          prev.owned.some((own) => own.id === theme.id)
            ? prev
            : { ...prev, owned: [{ ...theme, owned: true }, ...prev.owned] }
        );
      }
      return;
    }
    if (target.kind === "self") {
      await run(theme.id, () => choose(current === theme.id ? null : theme.id));
      return;
    }
    if (current === theme.id) return;
    if (await run(theme.id, () => choose(theme.id))) onClose(true);
  }

  async function removeCurrent() {
    const ok = await run("__none__", () => choose(null));
    if (ok && target.kind === "room") onClose(true);
  }

  async function toggleLike(theme: RoomTheme) {
    if (!account) {
      setAccountModal("create");
      return;
    }
    // Flipped now, confirmed after — the workshop's own arrangement.
    const liked = !theme.liked;
    patchTheme(theme.id, { liked, likes: Math.max(0, theme.likes + (liked ? 1 : -1)) });
    const result = await likeTheme(theme.id, liked);
    patchTheme(theme.id, result ?? { liked: theme.liked, likes: theme.likes });
  }

  function retry() {
    loadedKeyRef.current = null;
    setPage(null);
    setAttempt((n) => n + 1);
  }

  const isGroup = target.kind === "room" && Boolean(target.groupId);
  const currentLabel =
    target.kind === "self"
      ? t("themeBrowser.yourCurrentTheme")
      : isGroup
        ? t("themeBrowser.groupCurrentTheme")
        : t("themeBrowser.roomCurrentTheme");

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {/* The search and the filters. */}
      <div className="flex shrink-0 flex-col gap-2.5 border-b border-zinc-200 px-4 py-3 sm:px-5 dark:border-zinc-800">
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg bg-zinc-100 p-0.5 dark:bg-zinc-900">
            {(["discover", "mine"] as const).map((entry) => (
              <button
                key={entry}
                type="button"
                onClick={() => setScope(entry)}
                aria-pressed={scope === entry}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                  scope === entry
                    ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-50"
                    : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                }`}
              >
                {entry === "discover" ? t("common.discover") : t("common.yourThemes")}
                {entry === "mine" && mine.loaded && myThemes.length > 0 && (
                  <span className="ml-1 font-normal text-zinc-400">{myThemes.length}</span>
                )}
              </button>
            ))}
          </div>
          {account && (
            <span
              title={t("themeBrowser.yourPoints")}
              className="ml-auto flex items-center gap-1 rounded-full bg-amber-500/10 px-2.5 py-1 text-xs font-semibold text-amber-700 dark:text-amber-400"
            >
              <BsCoin className="h-3.5 w-3.5 shrink-0" />
              {formatPoints(points)}
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="relative flex min-w-0 flex-[1_1_16rem] items-center">
            <MdSearch className="pointer-events-none absolute left-2.5 h-4 w-4 text-zinc-400" />
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("themeBrowser.searchPlaceholder")}
              aria-label={t("themeBrowser.searchPlaceholder")}
              maxLength={80}
              className="w-full rounded-lg border border-zinc-300 bg-white py-2 pl-8 pr-8 text-sm text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:border-zinc-500 [&::-webkit-search-cancel-button]:hidden"
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
          <div className="flex flex-wrap items-center gap-2">
            {scope === "discover" && (
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as WorkshopSort)}
                aria-label={t("themeBrowser.sortBy")}
                className="rounded-lg border border-zinc-300 bg-white px-2.5 py-2 text-xs font-medium text-zinc-700 outline-none transition focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-300"
              >
                {SORTS.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {t(entry.key)}
                  </option>
                ))}
              </select>
            )}
            <div className="inline-flex rounded-lg border border-zinc-300 p-0.5 dark:border-zinc-700" role="group">
              {PRICES.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => setPrice(entry.id)}
                  aria-pressed={price === entry.id}
                  className={`flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium transition ${
                    price === entry.id
                      ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                      : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                  }`}
                >
                  {entry.id === "paid" && <BsCoin className="h-3 w-3 shrink-0" />}
                  {t(entry.key)}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div
        ref={scrollerRef}
        onScroll={(e) => {
          lastScroll[target.kind] = e.currentTarget.scrollTop;
        }}
        className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5"
      >
        {/* What is on now, and the way to take it off. */}
        <div className="mb-4 flex items-center gap-3 rounded-xl border border-zinc-200 bg-zinc-50 p-2.5 dark:border-zinc-800 dark:bg-zinc-900/40">
          {currentTheme ? (
            <ThemeMiniPreview theme={currentTheme} className="aspect-[16/10] w-20 shrink-0" />
          ) : (
            <NoThemeMiniPreview className="aspect-[16/10] w-20 shrink-0" />
          )}
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              {currentLabel}
            </p>
            <p className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              {current ? (currentTheme?.name ?? t("common.loading")) : t("roomThemePicker.noTheme")}
            </p>
            <p className="truncate text-[11px] text-zinc-500 dark:text-zinc-400">
              {target.kind === "self"
                ? t("themeHubDialog.itAppliesInRoomsWithNo")
                : current
                  ? isGroup
                    ? t("roomThemePicker.everyoneInTheGroupWillSee")
                    : t("roomThemePicker.everyoneInTheRoomWillSee")
                  : t("roomThemePicker.eachPersonSeesTheThemeThey")}
            </p>
          </div>
          {current && (
            <button
              type="button"
              onClick={() => void removeCurrent()}
              disabled={busyId !== null}
              className="shrink-0 rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 transition hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
            >
              {t("themeBrowser.removeTheme")}
            </button>
          )}
        </div>

        {error && (
          <div
            role="alert"
            className="mb-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300"
          >
            <span className="flex-1">{error}</span>
            <button type="button" onClick={() => setError(null)} aria-label={t("common.close")} className="shrink-0">
              <MdClose className="h-4 w-4" />
            </button>
          </div>
        )}

        {loading && shown.length === 0 ? (
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,10rem),1fr))] gap-3 sm:grid-cols-[repeat(auto-fill,minmax(13rem,1fr))]">
            {Array.from({ length: 8 }, (_, index) => (
              <li
                key={index}
                className="flex flex-col overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800"
              >
                <span className="aspect-[16/10] animate-pulse bg-zinc-100 dark:bg-zinc-900" />
                <span className="m-2.5 h-3 w-2/3 animate-pulse rounded bg-zinc-100 dark:bg-zinc-900" />
                <span className="mx-2.5 mb-2.5 h-7 animate-pulse rounded-lg bg-zinc-100 dark:bg-zinc-900" />
              </li>
            ))}
          </ul>
        ) : scope === "discover" && page?.failed && shown.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-12 text-center">
            <p className="text-sm text-zinc-500 dark:text-zinc-400">{t("themeBrowser.loadFailed")}</p>
            <button
              type="button"
              onClick={retry}
              className="flex items-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
            >
              <MdRefresh className="h-4 w-4" />
              {t("themeBrowser.tryAgain")}
            </button>
          </div>
        ) : shown.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-12 text-center">
            <p className="max-w-sm text-sm text-zinc-500 dark:text-zinc-400">
              {folded
                ? t("themeBrowser.noResultsFor", { query: debounced.trim() })
                : price !== "all"
                  ? t("themeBrowser.noResultsFilters")
                  : scope === "mine"
                    ? account
                      ? t("themeBrowser.noOwnThemes")
                      : t("themeBrowser.signInForOwnThemes")
                    : t("themeHubDialog.thereAreNoThemesPublishedBy")}
            </p>
            {(folded || price !== "all") && (
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  setPrice("all");
                }}
                className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
              >
                {t("themeBrowser.clearFilters")}
              </button>
            )}
          </div>
        ) : (
          <>
            <ul
              className={`grid grid-cols-[repeat(auto-fill,minmax(min(100%,10rem),1fr))] gap-3 transition-opacity sm:grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] ${
                loading ? "opacity-50" : ""
              }`}
            >
              {shown.map((theme) => (
                <ThemeCard
                  key={theme.id}
                  theme={theme}
                  target={target}
                  current={current === theme.id}
                  busy={busyId === theme.id}
                  confirming={confirmBuyId === theme.id}
                  missing={account && !theme.owned ? Math.max(0, theme.price - points) : 0}
                  onPrimary={() => void primary(theme)}
                  onPreview={() => preview(theme)}
                  onLike={() => void toggleLike(theme)}
                  onOpenAuthor={() => setProfileId(theme.authorId)}
                  onEdit={
                    onEditTheme && accountId && theme.authorId === accountId ? () => onEditTheme(theme) : undefined
                  }
                />
              ))}
            </ul>
            {scope === "discover" && page?.hasMore && (
              <div className="mt-4 flex flex-col items-center gap-2">
                {/* Keyed by how much is loaded: see the observer above. */}
                <div key={shown.length} ref={setSentinel} aria-hidden className="h-px w-full" />
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
      </div>

      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-zinc-200 px-4 py-2.5 text-[11px] text-zinc-500 sm:px-5 dark:border-zinc-800 dark:text-zinc-400">
        <span className="flex items-center gap-1.5">
          <MdVisibility className="h-3.5 w-3.5 shrink-0" />
          {t("themeBrowser.previewHint")}
        </span>
        <Link
          href="/workshop"
          target="_blank"
          className="flex items-center gap-1 font-medium underline-offset-2 transition hover:text-zinc-900 hover:underline dark:hover:text-zinc-100"
        >
          {t("themeBrowser.openThemesPage")}
          <MdOpenInNew className="h-3 w-3" />
        </Link>
      </div>

      {/* The author's profile, over the list and inside the dialog. */}
      {profileId && (
        <div
          className="absolute inset-0 z-20 overflow-y-auto bg-white/80 p-3 backdrop-blur-sm sm:p-6 dark:bg-zinc-950/80"
          onClick={() => setProfileId(null)}
          role="dialog"
          aria-modal="true"
          aria-label={t("common.profile")}
        >
          <div className="mx-auto w-full max-w-xl" onClick={(e) => e.stopPropagation()}>
            <div className="relative">
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
              <UserProfileCard id={profileId} onNavigate={() => onClose(false)} />
            </div>
          </div>
        </div>
      )}

      <AccountModal mode={accountModal} onModeChange={setAccountModal} />
    </div>
  );
}

/** One theme in the grid. */
function ThemeCard({
  theme,
  target,
  current,
  busy,
  confirming,
  missing,
  onPrimary,
  onPreview,
  onLike,
  onOpenAuthor,
  onEdit,
}: {
  theme: RoomTheme;
  target: ThemeTarget;
  current: boolean;
  busy: boolean;
  confirming: boolean;
  /** Points short of the price — 0 when affordable, free, owned, or signed out. */
  missing: number;
  onPrimary: () => void;
  onPreview: () => void;
  onLike: () => void;
  onOpenAuthor: () => void;
  onEdit?: () => void;
}) {
  const t = useT();
  const paid = theme.price > 0;
  const isGroup = target.kind === "room" && Boolean(target.groupId);

  // One verb, and which one is a fact the server sends (`owned`): a price
  // alone cannot tell "comprar" from "usar", because the author owns theirs by
  // having written it and a buyer owns it for good.
  let label: string;
  let style: string;
  let disabled = busy;
  if (!theme.owned) {
    if (missing > 0) {
      label = t("themeBrowser.missingPoints", { points: formatPoints(missing) });
      style = "border border-amber-500/40 text-amber-700 dark:text-amber-400";
      disabled = true;
    } else if (confirming) {
      label = t("themeBrowser.confirmBuy", { price: formatPoints(theme.price) });
      style = "bg-amber-600 text-white ring-2 ring-amber-500/40 hover:bg-amber-700";
    } else {
      label = t("themeBrowser.buyFor", { price: formatPoints(theme.price) });
      style = "bg-amber-500 text-white hover:bg-amber-600";
    }
  } else if (target.kind === "self") {
    label = current ? t("common.inUseRemove") : t("common.useTheme");
    style = current
      ? "border border-zinc-300 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
      : "bg-zinc-950 text-white hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200";
  } else {
    label = current
      ? isGroup
        ? t("themeBrowser.onTheGroup")
        : t("themeBrowser.onTheRoom")
      : isGroup
        ? t("themeBrowser.applyToGroup")
        : t("themeBrowser.applyToRoom");
    style = current
      ? "border border-emerald-500/50 text-emerald-700 dark:text-emerald-400"
      : "bg-zinc-950 text-white hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200";
    if (current) disabled = true;
  }

  return (
    <li
      className={`group/card flex min-w-0 flex-col overflow-hidden rounded-xl border bg-white transition dark:bg-zinc-950 ${
        current
          ? "border-emerald-500 ring-1 ring-emerald-500"
          : "border-zinc-200 hover:border-zinc-300 dark:border-zinc-800 dark:hover:border-zinc-700"
      }`}
    >
      <div className="relative">
        {/* The picture is the way to try it on — the largest target on the
            card, and the question the picture raises. */}
        <button
          type="button"
          onClick={onPreview}
          aria-label={t("themeBrowser.previewName", { name: theme.name })}
          className="block w-full cursor-pointer"
        >
          <ThemeMiniPreview theme={theme} className="aspect-[16/10] w-full rounded-none border-0" />
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition group-hover/card:bg-black/35 group-hover/card:opacity-100">
            <span className="flex items-center gap-1.5 rounded-full bg-black/70 px-3 py-1.5 text-xs font-semibold text-white">
              <MdVisibility className="h-4 w-4" />
              {t("themeBrowser.preview")}
            </span>
          </span>
        </button>
        <div className="pointer-events-none absolute left-1.5 top-1.5 flex flex-wrap gap-1">
          {current && (
            <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-semibold text-white shadow">
              {target.kind === "self" ? t("themeBrowser.inUse") : isGroup ? t("themeBrowser.onTheGroup") : t("themeBrowser.onTheRoom")}
            </span>
          )}
          {paid && (
            <span
              className={`flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[10px] font-semibold shadow ${
                theme.owned ? "bg-black/60 text-white" : "bg-amber-500 text-white"
              }`}
            >
              <BsCoin className="h-2.5 w-2.5 shrink-0" />
              {theme.owned ? t("themeBrowser.owned") : formatPoints(theme.price)}
            </span>
          )}
          {!theme.published && (
            <span className="rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-semibold text-white shadow">
              {t("common.privateAdj")}
            </span>
          )}
        </div>
        {theme.published && (
          <button
            type="button"
            onClick={onLike}
            aria-label={theme.liked ? t("common.removeLike") : t("common.likeTheme")}
            aria-pressed={theme.liked}
            className="absolute right-1.5 top-1.5 flex items-center gap-1 rounded-full bg-black/55 px-2 py-1 text-[11px] font-semibold text-white backdrop-blur-sm transition hover:bg-black/75"
          >
            {theme.liked ? (
              <MdFavorite className="h-3.5 w-3.5 shrink-0 text-rose-400" />
            ) : (
              <MdFavoriteBorder className="h-3.5 w-3.5 shrink-0" />
            )}
            {theme.likes}
          </button>
        )}
        {/* Always there, for a screen with no hover to reveal the overlay. */}
        <span className="pointer-events-none absolute bottom-1.5 right-1.5 flex rounded-full bg-black/55 p-1 text-white group-hover/card:opacity-0">
          <MdVisibility className="h-3.5 w-3.5" />
        </span>
      </div>

      <div className="flex flex-1 flex-col gap-1.5 border-t border-zinc-100 p-2.5 dark:border-zinc-900">
        <div className="flex min-w-0 items-center gap-1">
          <p className="min-w-0 flex-1 truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100" title={theme.name}>
            {theme.name}
          </p>
          {theme.published && (
            <CopyButton
              value={themeLink(theme.id)}
              label={t("themeHubDialog.copyTheThemeSLink")}
              compact
              className="flex shrink-0 items-center rounded-md p-1 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-900 dark:hover:text-zinc-100"
            />
          )}
        </div>
        {theme.author && (
          <button
            type="button"
            onClick={onOpenAuthor}
            aria-label={t("common.seeDisplaynameSProfile", { displayName: theme.author.displayName })}
            className="-mx-1 flex min-w-0 cursor-pointer items-center gap-1.5 rounded-md px-1 py-0.5 text-left text-xs text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-100"
          >
            <UserAvatar
              src={theme.author.avatarUrl}
              name={theme.author.displayName}
              size={16}
              className="shrink-0"
              userId={theme.author.id}
            />
            <DisplayUserName
              name={theme.author.displayName}
              verified={verifiedBadge(theme.author.flags)}
              bot={theme.author.bot}
              color={theme.author.nameColor}
              className="truncate"
            />
          </button>
        )}
        {theme.description && (
          <p className="line-clamp-2 text-[11px] leading-snug text-zinc-500 dark:text-zinc-400">{theme.description}</p>
        )}
        <div className="flex items-center gap-2 text-[11px] text-zinc-500 dark:text-zinc-400">
          <span>{isDarkTheme(theme.spec) ? t("common.dark") : t("common.light")}</span>
          <span className="flex items-center gap-0.5" title={t("themeBrowser.usesTitle")}>
            <MdPeople className="h-3.5 w-3.5 shrink-0" />
            {theme.uses}
          </span>
        </div>
        <div className="mt-auto flex items-center gap-1.5 pt-1">
          <button
            type="button"
            onClick={onPrimary}
            disabled={disabled}
            title={missing > 0 ? t("themeBrowser.notEnoughPoints") : undefined}
            className={`flex min-w-0 flex-1 items-center justify-center gap-1 truncate rounded-lg px-2 py-1.5 text-xs font-semibold transition disabled:cursor-not-allowed ${
              busy ? "opacity-60" : ""
            } ${style}`}
          >
            {!theme.owned && missing === 0 && <BsCoin className="h-3.5 w-3.5 shrink-0" />}
            <span className="truncate">{busy ? t("common.loading") : label}</span>
          </button>
          {onEdit && (
            <Tooltip content={t("common.edit")}>
              <button
                type="button"
                onClick={onEdit}
                aria-label={t("common.edit")}
                className="shrink-0 rounded-lg border border-zinc-300 p-1.5 text-zinc-600 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
              >
                <MdEdit className="h-4 w-4" />
              </button>
            </Tooltip>
          )}
        </div>
      </div>
    </li>
  );
}
