"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { MdCheck, MdClose, MdPersonAdd, MdSearch } from "react-icons/md";
import { DisplayUserName } from "@/components/DisplayUserName";
import { UserAvatar } from "@/components/UserAvatar";
import { ButtonSpinner } from "@/components/ButtonSpinner";
import { verifiedBadge } from "@/lib/entitlements";
import { acceptFriend, addFriend, searchPeople, type SocialSearchHit } from "@/lib/socialApi";
import { useSocialGraph } from "@/lib/useSocialGraph";
import { useT } from "@/lib/useI18n";

// "Adicionar amigo": type a username, add whoever comes back.
//
// A dialog rather than a page, for the same reason FriendRequestsModal is one:
// this can be opened from inside a room, and navigating out of a room ends the
// call. It is also why the results are the API's answer and not a local filter
// of the friends list — the whole point is finding somebody you do *not* have.
//
// The search is deliberately thin: the server decides who is findable (never
// yourself, never anybody either side blocked — see its /social/search) and
// hands back the relationship with each hit, so this file never has to work
// out whether "adicionar" is even the right word for a given row.

// How long typing has to settle before asking. Same shape as the home page's
// room lookup: a name typed straight through costs one request instead of one
// per letter.
const SEARCH_DEBOUNCE_MS = 300;

const ACTION =
  "flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-50";

function HitRow({
  hit,
  busy,
  linkProfile,
  onAdd,
  onAccept,
}: {
  hit: SocialSearchHit;
  busy: boolean;
  /** Whether the name leads to the person's page. Off inside a room. */
  linkProfile: boolean;
  onAdd: () => void;
  onAccept: () => void;
}) {
  const t = useT();
  const identity = (
    <>
      <UserAvatar
        src={hit.avatarUrl}
        name={hit.displayName}
        size={32}
        className="shrink-0"
        userId={hit.id}
      />
      <span className="min-w-0 flex-1">
        <DisplayUserName
          name={hit.displayName}
          verified={verifiedBadge(hit.flags)}
          bot={hit.bot}
          color={hit.nameColor}
          className={`truncate text-sm font-medium text-zinc-900 dark:text-zinc-100 ${
            linkProfile ? "hover:underline" : ""
          }`}
        />
        <span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">
          @{hit.username}
        </span>
      </span>
    </>
  );
  return (
    <li className="flex items-center gap-2.5 rounded-lg border border-zinc-200 bg-white px-2.5 py-2 dark:border-zinc-800 dark:bg-zinc-950">
      {linkProfile ? (
        <Link href={`/user/${hit.username}`} className="flex min-w-0 flex-1 items-center gap-2.5">
          {identity}
        </Link>
      ) : (
        // Inside a room the name is just a name. Following a link out of a
        // room ends the call, and a search result is the easiest thing on
        // screen to click by accident on the way to "adicionar".
        <span className="flex min-w-0 flex-1 items-center gap-2.5">{identity}</span>
      )}
      {/* One verb per row, decided by the server's `relationship`. A request
          already coming this way becomes "aceitar" rather than a second
          "adicionar" — the API treats those as the same call, but the button
          should say what it is about to do. */}
      <span className="shrink-0">
        {hit.relationship === "friends" ? (
          <span className="text-xs font-medium text-zinc-400 dark:text-zinc-500">{t("addFriendDialog.alreadyAFriend")}</span>
        ) : hit.relationship === "outgoing" ? (
          <span className="text-xs font-medium text-zinc-400 dark:text-zinc-500">{t("addFriendDialog.requestSent")}</span>
        ) : hit.relationship === "incoming" ? (
          <button
            type="button"
            disabled={busy}
            onClick={onAccept}
            className={`${ACTION} bg-emerald-600 text-white hover:bg-emerald-700`}
          >
            {busy ? <ButtonSpinner /> : <MdCheck className="h-3.5 w-3.5" />}
            {t("common.accept")}
          </button>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={onAdd}
            className={`${ACTION} bg-zinc-950 text-white hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200`}
          >
            {busy ? <ButtonSpinner /> : <MdPersonAdd className="h-3.5 w-3.5" />}
            {t("common.add")}
          </button>
        )}
      </span>
    </li>
  );
}

/**
 * Mounted only while open (see HomeFriendsPanel), not hidden behind an `open`
 * prop: unmounting is what throws away the last search, so reopening is a
 * fresh box rather than the previous query's results sitting under a field
 * that has been cleared.
 */
export function AddFriendDialog({
  onClose,
  inRoom = false,
}: {
  onClose: () => void;
  /**
   * Opened from inside a room (see InviteToRoomModal). Turns the names into
   * plain text, because every way out of a room ends the call.
   */
  inRoom?: boolean;
}) {
  const t = useT();
  const { refresh } = useSocialGraph();
  const [query, setQuery] = useState("");
  // The last answer, tagged with the query that produced it. Tagged rather
  // than stored bare so "is this list an answer to what is typed right now?"
  // is a comparison instead of a second piece of state to keep in step — the
  // same reason the results are not cleared while a new query is in flight.
  const [result, setResult] = useState<{ query: string; hits: SocialSearchHit[] } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  // Whether the press that became this click began on the backdrop itself.
  const pressedBackdropRef = useRef(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // The field is certainly empty and certainly what the person came for.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const trimmed = query.trim().replace(/^@/, "");
  // Mirrors the server's own minimum. Kept here as well so a one-letter query
  // is never even sent, rather than sent and answered with an empty list.
  const searchable = trimmed.length >= 2;
  // The previous answer stays on screen while the next one is in flight —
  // clearing it on every keystroke makes the list blink through empty on the
  // way to the result, which is worse than a list that is briefly one letter
  // behind. `result.query` is what tells the two apart when it matters.
  const hits = result ? result.hits : null;

  useEffect(() => {
    if (!searchable) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void searchPeople(trimmed, controller.signal).then((results) => {
        if (controller.signal.aborted) return;
        setResult({ query: trimmed, hits: results });
      });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [searchable, trimmed]);

  async function run(hit: SocialSearchHit, action: () => Promise<{ ok: boolean; error?: string }>) {
    if (busyId) return;
    setBusyId(hit.id);
    setError(null);
    const outcome = await action();
    if (!outcome.ok) {
      setError(outcome.error ?? t("common.couldNotComplete"));
    } else {
      // Patched in place rather than re-searched: the row is still under the
      // person's cursor, and re-running the query would reorder the list
      // beneath it. The graph itself is re-read (refresh) so every other
      // surface — the friends panel, the requests bell — agrees immediately.
      setResult((current) =>
        current === null
          ? current
          : {
              ...current,
              hits: current.hits.map((row) =>
                row.id === hit.id
                  ? { ...row, relationship: row.relationship === "incoming" ? "friends" : "outgoing" }
                  : row
              ),
            }
      );
      refresh();
    }
    setBusyId(null);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 pt-[10vh]"
      // Only a press that began *and* ended on the backdrop closes. A plain
      // onClick also fired for a text selection started in the field and let
      // go past the card's edge — the browser reports that click on the
      // nearest common ancestor, which is this.
      onPointerDown={(e) => {
        pressedBackdropRef.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        const began = pressedBackdropRef.current;
        pressedBackdropRef.current = false;
        if (began && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("common.addFriend")}
        className="flex max-h-[80vh] w-full max-w-md flex-col rounded-2xl border border-black/10 bg-white p-6 shadow-xl dark:border-white/10 dark:bg-zinc-950"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
              {t("common.addFriend")}
            </h2>
            <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
              {t("addFriendDialog.searchByUsername")}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.close")}
            className="rounded-lg p-1 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-900 dark:hover:text-zinc-200"
          >
            <MdClose className="h-5 w-5" />
          </button>
        </div>

        <div className="relative mt-4">
          <MdSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            // A search box, not a form: there is nothing to submit — the
            // results are already there by the time a key would be pressed.
            placeholder={t("addFriendDialog.exMaria")}
            maxLength={32}
            aria-label={t("addFriendDialog.username")}
            className="w-full rounded-lg border border-zinc-300 bg-white py-2.5 pl-9 pr-3 text-sm text-zinc-950 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
          />
        </div>

        {error && (
          <p
            role="alert"
            className="mt-3 rounded-lg border border-red-200 bg-red-50 px-2.5 py-2 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300"
          >
            {error}
          </p>
        )}

        <div className="mt-3 min-h-24 flex-1 overflow-y-auto">
          {!searchable ? (
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              {t("addFriendDialog.typeAtLeastTwoLetters")}
            </p>
          ) : hits === null ? (
            <p className="text-xs text-zinc-500 dark:text-zinc-400">{t("addFriendDialog.searching")}</p>
          ) : hits.length === 0 ? (
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              {t("common.nobodyFoundWithThatName")}
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {hits.map((hit) => (
                <HitRow
                  key={hit.id}
                  hit={hit}
                  busy={busyId === hit.id}
                  linkProfile={!inRoom}
                  onAdd={() => void run(hit, () => addFriend(hit.id))}
                  onAccept={() => void run(hit, () => acceptFriend(hit.id))}
                />
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
