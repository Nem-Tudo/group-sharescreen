"use client";

import { useEffect, useMemo, useState } from "react";
import { MdCall, MdClose, MdSearch } from "react-icons/md";
import { DisplayUserName } from "@/components/DisplayUserName";
import { UserAvatar } from "@/components/UserAvatar";
import { ButtonSpinner } from "@/components/ButtonSpinner";
import { verifiedBadge } from "@/lib/entitlements";
import { startCall } from "@/lib/callsApi";
import { useSocialGraph } from "@/lib/useSocialGraph";
import type { SocialUser } from "@/lib/socialApi";

// "Chamar um amigo para esta sala".
//
// The same ring as any other call — their phone rings, they answer, they walk
// into a room — with one difference that is the whole point: the room they walk
// into is *this* one, already full of people, instead of an empty one minted
// for the two of them. The server is what enforces that (see its callRoutes:
// naming a room is refused unless the caller is standing in it), so this file
// only has to say which room it is.
//
// A dialog rather than a page, for the reason every dialog in a room exists:
// navigating away from a room ends the call you are in. Which also rules out
// the obvious alternative of sending people to /amigos to do this.
//
// Deliberately friends only, and deliberately not a search: pulling somebody
// into a room with other people in it is a bigger thing than messaging them,
// and "who can I do this to" should be a list you already curated rather than
// anybody whose username can be typed. Somebody not on this list can still be
// sent the room link, which is the thing this is a shortcut for.

const ACTION =
  "flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-50";

/** Past this many friends the list gets a filter above it. */
const SEARCH_THRESHOLD = 8;

type RowState = "idle" | "calling" | "called" | "present";

function FriendRow({
  user,
  state,
  error,
  onCall,
}: {
  user: SocialUser;
  state: RowState;
  error?: string;
  onCall: () => void;
}) {
  return (
    <li className="flex items-center gap-2.5 rounded-lg border border-zinc-200 bg-white px-2.5 py-2 dark:border-zinc-800 dark:bg-zinc-950">
      <UserAvatar
        src={user.avatarUrl}
        name={user.displayName}
        size={32}
        className="shrink-0"
        userId={user.id}
      />
      <span className="min-w-0 flex-1">
        <DisplayUserName
          name={user.displayName}
          verified={verifiedBadge(user.flags)}
          color={user.nameColor}
          className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100"
        />
        <span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">
          {/* The error takes the username's place rather than adding a line:
              the row is in a scrolling list of identical rows, and one that
              grows taller than its neighbours is the one thing that makes a
              list like this jump under the cursor. */}
          {error ? <span className="text-red-500">{error}</span> : `@${user.username}`}
        </span>
      </span>

      {state === "present" ? (
        // Not a disabled "chamar": there is nothing to retry here, and a
        // greyed-out button invites a click to find out why. A plain label
        // says the thing that is actually true.
        <span className="shrink-0 rounded-lg bg-emerald-50 px-2.5 py-1.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400">
          Já está aqui
        </span>
      ) : (
        <button
          type="button"
          disabled={state !== "idle"}
          onClick={onCall}
          aria-label={`Chamar ${user.displayName} para a sala`}
          className={`${ACTION} border border-emerald-600/40 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-500/40 dark:text-emerald-400 dark:hover:bg-emerald-950/40`}
        >
          {state === "calling" ? <ButtonSpinner /> : <MdCall className="h-4 w-4" />}
          {state === "called" ? "Chamando…" : "Chamar"}
        </button>
      )}
    </li>
  );
}

export function InviteToRoomModal({
  roomHandle,
  presentUserIds,
  onClose,
}: {
  roomHandle: string;
  /**
   * Who is already in the room, by account id.
   *
   * Passed in rather than looked up, because the room's participant list is
   * the only thing that knows — and it is live, so somebody who walks in while
   * this is open stops being callable without the dialog doing anything.
   */
  presentUserIds: Set<string>;
  onClose: () => void;
}) {
  const { graph } = useSocialGraph();
  const [query, setQuery] = useState("");
  // Per person, because several can be rung one after another without the
  // dialog closing — which is the normal way to get three friends into a room.
  const [calling, setCalling] = useState<Record<string, RowState>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const friends = graph.friends;
  const showSearch = friends.length > SEARCH_THRESHOLD;
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return friends;
    return friends.filter(
      (user) =>
        user.displayName.toLowerCase().includes(needle) ||
        user.username.toLowerCase().includes(needle)
    );
  }, [friends, query]);

  async function call(user: SocialUser) {
    setCalling((current) => ({ ...current, [user.id]: "calling" }));
    setErrors((current) => {
      if (!current[user.id]) return current;
      const next = { ...current };
      delete next[user.id];
      return next;
    });

    const result = await startCall(user.id, roomHandle);

    if (result.ok) {
      // Left as "chamando…" rather than reset: the ring lasts 45 seconds and
      // the button coming back to life the instant the request returned would
      // read as "that did nothing, press it again" — which would be a second
      // call to somebody whose phone is already ringing.
      setCalling((current) => ({ ...current, [user.id]: "called" }));
      return;
    }
    setCalling((current) => ({ ...current, [user.id]: "idle" }));
    setErrors((current) => ({ ...current, [user.id]: result.error }));
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 pt-[10vh]"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Chamar amigo para a sala"
        // Without this a click anywhere inside the card bubbles to the backdrop
        // and closes the dialog — including a click on the search field.
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-[80vh] w-full max-w-md flex-col rounded-2xl border border-black/10 bg-white p-6 shadow-xl dark:border-white/10 dark:bg-zinc-950"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
              Chamar para a sala
            </h2>
            <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
              O telefone deles toca e, ao atender, entram aqui.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="cursor-pointer rounded-lg p-1 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-900 dark:hover:text-zinc-200"
          >
            <MdClose className="h-5 w-5" />
          </button>
        </div>

        {showSearch && (
          <div className="relative mt-4">
            <MdSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filtrar amigos"
              aria-label="Filtrar amigos"
              className="w-full rounded-lg border border-zinc-300 bg-white py-2 pl-9 pr-3 text-sm text-zinc-950 outline-none transition focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
            />
          </div>
        )}

        {friends.length === 0 ? (
          <p className="mt-6 text-sm text-zinc-500 dark:text-zinc-400">
            Você ainda não tem amigos para chamar. Enquanto isso, o link desta
            sala funciona para qualquer pessoa.
          </p>
        ) : shown.length === 0 ? (
          <p className="mt-6 text-sm text-zinc-500 dark:text-zinc-400">
            Nenhum amigo com esse nome.
          </p>
        ) : (
          <ul className="mt-4 flex flex-col gap-1.5 overflow-y-auto">
            {shown.map((user) => (
              <FriendRow
                key={user.id}
                user={user}
                state={presentUserIds.has(user.id) ? "present" : calling[user.id] ?? "idle"}
                error={errors[user.id]}
                onCall={() => void call(user)}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
