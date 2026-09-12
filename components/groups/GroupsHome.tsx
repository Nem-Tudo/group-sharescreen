"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import useNtPopups from "ntpopups";
import { MdAdd, MdChevronRight, MdClose, MdSearch } from "react-icons/md";
import { GroupIcon } from "@/components/groups/GroupIcon";
import { GroupLink } from "@/components/groups/GroupLink";
import { GroupName } from "@/components/groups/GroupName";
import { nameMatches, searchWords, setGroupsHomeQuery, useGroupsHomeQuery } from "@/components/groups/groupSearch";
import { useAuth } from "@/lib/AuthContext";
import { groupPath, inviteCodeFromInput, invitePath } from "@/lib/groupLinks";
import { searchPublicGroups, type GroupSearchResult, type GroupSummary } from "@/lib/groupsApi";
import { prefetchGroup, useMyGroups } from "@/lib/useGroups";
import { useI18n } from "@/lib/useI18n";
import { translate } from "@/lib/i18n";

// /groups — every group this person is in, and the two ways to get another.
// Laid out like the site's other list pages (see /friends): a title, a line
// under it, and rows in bordered cards.
//
// Above the rows, one search bar for every group there is: typing narrows your
// own list at once, and asks the server for public groups by the same words
// (see the API's searchPublicGroups) — which is also how somebody with no
// groups yet finds one to join.

const primaryButton =
  "inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-zinc-950 px-3 py-2 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200";
const secondaryButton =
  "inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900";
const rowClass =
  "flex items-center gap-3 rounded-lg border border-zinc-200 bg-white px-3 py-2.5 transition hover:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-zinc-600";
const sectionHeading = "text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400";

const ROLE_LABEL = { get owner() { return translate("common.owner"); }, get admin() { return translate("common.admin"); }, get member() { return translate("common.member"); } } as const;

/** The shortest query worth asking the server about. */
const MIN_PUBLIC_QUERY = 2;
const SEARCH_DEBOUNCE_MS = 250;

export function GroupsHome() {
  const { t, tc } = useI18n();
  const { openPopup } = useNtPopups();
  const { account, loading } = useAuth();
  const { groups } = useMyGroups();
  const canCreate = Boolean(account);
  const hasGroups = Boolean(groups && groups.length > 0);

  // Kept outside the page, so the dock's "search public groups" can fill it in
  // (see groupSearch) — and so it is still there on coming back.
  const query = useGroupsHomeQuery();
  const setQuery = setGroupsHomeQuery;
  const inputRef = useRef<HTMLInputElement | null>(null);
  const words = searchWords(query);
  const searching = words.length > 0;
  const mine = searching ? (groups ?? []).filter((g) => nameMatches(g.name, words)) : groups ?? [];
  const publicSearch = usePublicGroupSearch(query);
  // Your own groups are already in the list above; the public ones are the rest.
  const myIds = new Set((groups ?? []).map((g) => g.id));
  const discovered = publicSearch.results?.filter((g) => !g.member && !myIds.has(g.id)) ?? null;

  // "/" anywhere on the page puts the cursor in the search bar.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      e.preventDefault();
      inputRef.current?.focus();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  function createGroup() {
    if (canCreate) void openPopup("create_group", { data: {} });
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-2xl px-4 py-8 sm:py-10">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">{t("common.yourGroups")}</h1>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              {hasGroups
                ? tc("common.groupCount", groups!.length)
                : t("groups.groupsHome.severalVoiceAndTextRoomsIn")}
            </p>
          </div>
          {hasGroups && (
            <div className="flex gap-2">
              <button type="button" onClick={() => void openPopup("join_group", { data: {} })} className={secondaryButton}>
                {t("common.joinWithAnInvite")}
              </button>
              <button
                type="button"
                onClick={createGroup}
                disabled={!canCreate}
                title={canCreate ? undefined : t("common.createAnAccountToCreateGroups")}
                className={primaryButton}
              >
                <MdAdd className="h-4 w-4" />
                {t("common.newGroup")}
              </button>
            </div>
          )}
        </div>

        {!loading && !account && (
          <p className="mt-4 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
            {t("groups.groupsHome.toCreateGroups")}{" "}
            <Link href="/" className="font-medium underline underline-offset-2">
              crie uma conta
            </Link>
            .
          </p>
        )}

        <div className="relative mt-6">
          <MdSearch className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-zinc-400" />
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape" && query) {
                e.preventDefault();
                setQuery("");
              }
            }}
            placeholder={t("groups.groupsHome.searchPlaceholder")}
            aria-label={t("groups.groupsHome.searchPlaceholder")}
            maxLength={100}
            enterKeyHint="search"
            className="w-full rounded-xl border border-zinc-300 bg-white py-2.5 pl-10 pr-10 text-sm text-zinc-950 outline-none transition placeholder:text-zinc-400 focus:border-zinc-500 focus:ring-4 focus:ring-zinc-500/10 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 [&::-webkit-search-cancel-button]:hidden"
          />
          {query ? (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                inputRef.current?.focus();
              }}
              aria-label={t("groups.groupsHome.clearSearch")}
              className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 cursor-pointer items-center justify-center rounded-md text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
            >
              <MdClose className="h-4 w-4" />
            </button>
          ) : (
            <kbd className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 rounded border border-zinc-300 px-1.5 text-[11px] font-medium text-zinc-400 sm:block dark:border-zinc-700">
              /
            </kbd>
          )}
        </div>

        {searching ? (
          <div className="mt-6 flex flex-col gap-8">
            {hasGroups && (
              <section className="flex flex-col gap-2">
                <h2 className={sectionHeading}>{t("common.yourGroups")}</h2>
                {mine.length > 0 ? (
                  <MyGroupRows groups={mine} />
                ) : (
                  <p className="text-sm text-zinc-500 dark:text-zinc-400">
                    {t("groups.groupsHome.noneOfYourGroupsMatch", { query: query.trim() })}
                  </p>
                )}
              </section>
            )}
            <section className="flex flex-col gap-2">
              <h2 className={sectionHeading}>{t("groups.groupsHome.publicGroups")}</h2>
              {query.trim().length < MIN_PUBLIC_QUERY ? (
                <p className="text-sm text-zinc-500 dark:text-zinc-400">{t("groups.groupsHome.typeMoreToSearch")}</p>
              ) : publicSearch.error ? (
                <p className="text-sm text-red-500">{publicSearch.error}</p>
              ) : discovered === null ? (
                <p className="text-sm text-zinc-500 dark:text-zinc-400">{t("groups.groupsHome.searching")}</p>
              ) : discovered.length > 0 ? (
                <ul className={`flex flex-col gap-2 transition-opacity ${publicSearch.stale ? "opacity-60" : ""}`}>
                  {discovered.map((group) => (
                    <li key={group.id}>
                      <PublicGroupRow group={group} />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                  {t("groups.groupsHome.noPublicGroupsFound", { query: query.trim() })}
                </p>
              )}
            </section>
          </div>
        ) : groups === null ? (
          <p className="mt-6 text-sm text-zinc-500 dark:text-zinc-400">{t("common.loading")}</p>
        ) : hasGroups ? (
          <div className="mt-6">
            <MyGroupRows groups={groups} />
          </div>
        ) : (
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <section className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
              <div>
                <h2 className="font-semibold text-zinc-950 dark:text-zinc-50">{t("common.createAGroup")}</h2>
                <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                  {t("groups.groupsHome.itStartsWithAVoiceRoom")}
                </p>
              </div>
              <button
                type="button"
                onClick={createGroup}
                disabled={!canCreate}
                title={canCreate ? undefined : t("common.createAnAccountToCreateGroups")}
                className={`${primaryButton} mt-auto self-start`}
              >
                <MdAdd className="h-4 w-4" />
                {t("common.newGroup")}
              </button>
            </section>
            <section className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
              <div>
                <h2 className="font-semibold text-zinc-950 dark:text-zinc-50">{t("common.joinAGroup")}</h2>
                <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{t("groups.groupsHome.pasteTheInviteLinkYouWere")}</p>
              </div>
              <JoinByInvite />
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

function MyGroupRows({ groups }: { groups: GroupSummary[] }) {
  const { t } = useI18n();
  return (
    <ul className="flex flex-col gap-2">
      {groups.map((group) => (
        <li key={group.id}>
          <GroupLink
            href={groupPath(group.id)}
            onMouseEnter={() => prefetchGroup(group.id)}
            onFocus={() => prefetchGroup(group.id)}
            className={`${rowClass} ${group.suspended ? "opacity-60" : ""}`}
          >
            <GroupIcon name={group.name} iconUrl={group.iconUrl} seed={group.id} size={40} className="rounded-lg" />
            <span className="min-w-0 flex-1">
              <GroupName
                name={group.name}
                flags={group.flags}
                className={`flex w-full text-sm ${group.unread ? "font-semibold text-zinc-950 dark:text-zinc-50" : "font-medium text-zinc-900 dark:text-zinc-100"}`}
              />
              <span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">
                {group.suspended ? (
                  <span className="font-medium text-amber-600 dark:text-amber-400">{t("common.suspended")}</span>
                ) : (
                  <>
                    {ROLE_LABEL[group.role]}
                    {group.unread && t("groups.groupsHome.newMessages")}
                  </>
                )}
              </span>
            </span>
            {!group.suspended && group.mentions > 0 && (
              <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-red-600 px-1 text-[11px] font-bold text-white">
                {group.mentions}
              </span>
            )}
            <MdChevronRight className="h-5 w-5 shrink-0 text-zinc-400" />
          </GroupLink>
        </li>
      ))}
    </ul>
  );
}

/** A public group from the search — opening it lands on its join card (see GroupPages). */
function PublicGroupRow({ group }: { group: GroupSearchResult }) {
  const { t, tc } = useI18n();
  return (
    <GroupLink href={groupPath(group.id)} className={rowClass}>
      <GroupIcon name={group.name} iconUrl={group.iconUrl} seed={group.id} size={40} className="rounded-lg" />
      <span className="min-w-0 flex-1">
        <GroupName name={group.name} flags={group.flags} className="flex w-full text-sm font-medium text-zinc-900 dark:text-zinc-100" />
        {group.description && (
          <span className="block truncate text-xs text-zinc-600 dark:text-zinc-300">{group.description}</span>
        )}
        <span className="flex items-center gap-1.5 truncate text-xs text-zinc-500 dark:text-zinc-400">
          {tc("common.memberCount", group.memberCount)}
          {group.onlineCount > 0 && (
            <>
              <span aria-hidden>·</span>
              <span className="inline-flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                {t("groups.groupRail.onlineCount", { count: group.onlineCount })}
              </span>
            </>
          )}
        </span>
      </span>
      <span className="shrink-0 rounded-lg border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-700 dark:border-zinc-700 dark:text-zinc-300">
        {t("groups.homeGroupsPanel.open")}
      </span>
    </GroupLink>
  );
}

/**
 * Public groups for what is typed, asked for once the typing pauses. The last
 * answer stays on screen (marked stale) while the next one is on its way, so
 * the list does not blink empty between keystrokes.
 */
function usePublicGroupSearch(query: string): {
  results: GroupSearchResult[] | null;
  error: string | null;
  stale: boolean;
} {
  const trimmed = query.trim();
  const [answer, setAnswer] = useState<{ query: string; results: GroupSearchResult[]; error: string | null } | null>(null);

  useEffect(() => {
    if (trimmed.length < MIN_PUBLIC_QUERY) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      searchPublicGroups(trimmed, controller.signal)
        .then((result) => {
          setAnswer(
            result.ok
              ? { query: trimmed, results: result.groups, error: null }
              : // An API from before the search answers 404: nothing public to show, not a fault.
                { query: trimmed, results: [], error: result.status === 404 ? null : result.error }
          );
        })
        .catch(() => {
          // Aborted: a newer query took its place.
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [trimmed]);

  if (trimmed.length < MIN_PUBLIC_QUERY || !answer) return { results: null, error: null, stale: false };
  return { results: answer.results, error: answer.error, stale: answer.query !== trimmed };
}

/** The invite field, inline — pasting a link here beats opening a popup to paste it into. */
function JoinByInvite() {
  const { t } = useI18n();
  const router = useRouter();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submit(e: FormEvent) {
    e.preventDefault();
    const code = inviteCodeFromInput(value);
    if (!code) {
      setError(t("groups.groupsHome.thatDoesNotLookLikeAn"));
      return;
    }
    router.push(invitePath(code));
  }

  return (
    <form onSubmit={submit} className="mt-auto flex flex-col gap-1.5">
      <div className="flex gap-2">
        <input
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setError(null);
          }}
          placeholder={t("groups.groupsHome.goliveNemtudoMeInvite")}
          className="min-w-0 flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
        />
        <button type="submit" disabled={!value.trim()} className={secondaryButton}>
          {t("common.signIn")}
        </button>
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
    </form>
  );
}
