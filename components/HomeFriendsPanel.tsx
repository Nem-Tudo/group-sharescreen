"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { MdCall, MdChatBubbleOutline, MdPersonAdd } from "react-icons/md";
import { DisplayUserName } from "@/components/DisplayUserName";
import { UserAvatar } from "@/components/UserAvatar";
import { UserProfileDialog } from "@/components/UserProfileDialog";
import { Tooltip } from "@/components/Tooltip";
import { AddFriendDialog } from "@/components/AddFriendDialog";
import { useAuth } from "@/lib/AuthContext";
import { verifiedBadge } from "@/lib/entitlements";
import type { PresenceInfo } from "@/lib/signalingClient";
import { usePresenceMap } from "@/lib/presence";
import type { SocialUser } from "@/lib/socialApi";
import { useSocialGraph } from "@/lib/useSocialGraph";
import { openDirectMessages } from "@/lib/dmWindow";
import { startCall } from "@/lib/callsApi";

// The friends list beside the home page's room form.
//
// The whole point is the two buttons on each row: the people somebody opens
// GoLive to talk to were already one page away (/amigos) and one page away is
// exactly far enough that the home page's answer to "call a friend" was "type
// a room name and send them the link". This is the same list that page shows,
// with the same faces and the same name colors a room's participant list
// draws, so nobody has to recognise a different rendering of the same person.
//
// Accounts only, and it renders *nothing* without one rather than an invite to
// sign up: the home page already asks for an account in the one place it makes
// sense to ask (see the identity area it sits next to), and a second pitch in
// the corner would be the same request twice on one screen. A guest simply
// sees the page they always saw.
//
// Deliberately not everything /amigos does: no blocks, no accept/decline, no
// remove. Those are the page's job, and a sidebar that grows them is a second
// copy of that page which has to stay in step with the first. What it does
// carry is a pointer when somebody is waiting on an answer, because that is
// the one thing on that page you would want to be told about rather than go
// looking for.

// Whoever can answer right now, first.
//
// The list is capped and scrolls (see the ul below), so the bottom of a long
// friends list is behind a scroll — and the two buttons on every row are worth
// exactly as much as the person on the other end being there to hear them.
// Somebody offline is still callable, and stays on the list; they are just no
// longer what the panel opens on.
//
// Connected is one tier, not three: the dot on each face already separates
// looking-at-it from another-tab from app-in-the-tray (see PresenceDot), and
// promoting those to sort keys would mean a friend alt-tabbing rearranges a
// list somebody is reaching for. All three answer a call, which is what this
// panel is for, so all three sort the same.
//
// "Unknown" — an account whose presence has not arrived yet — sorts with
// offline rather than ahead of it. Presence lands a moment after the graph
// does, and the alternative is every friend jumping to the top on load and
// then falling back one by one.
function connected(presence: PresenceInfo | undefined): boolean {
  return presence !== undefined && presence.state !== "offline";
}

function byPresence(friends: SocialUser[], presence: Record<string, PresenceInfo>): SocialUser[] {
  // A copy, and a stable sort: whatever order the server sent is what decides
  // ties, so the list only ever moves when somebody's presence actually moved.
  return [...friends].sort(
    (a, b) => Number(connected(presence[b.id])) - Number(connected(presence[a.id]))
  );
}

const ICON_ACTION =
  "flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border transition disabled:cursor-not-allowed disabled:opacity-50";

function FriendRow({
  user,
  busy,
  onCall,
  onOpenProfile,
}: {
  user: SocialUser;
  busy: boolean;
  onCall: () => void;
  onOpenProfile: () => void;
}) {
  return (
    <li className="flex items-center gap-2.5 rounded-lg border border-zinc-200 bg-white px-2.5 py-2 dark:border-zinc-800 dark:bg-zinc-950">
      {/* A button, not a link, and for the same reason the room's participant
          list uses one (see ParticipantRow): this goes nowhere. Marking it up
          as navigation would promise a middle-click and a "copiar endereço do
          link" that do not exist — and the profile itself still offers the
          page, through the "abrir em nova aba" control in the dialog's corner.

          Leaving the home page was the wrong cost for "who is this?": the room
          form beside this list is often half-filled when somebody glances at a
          friend, and a full navigation threw that away to answer a question
          the dialog answers in place. */}
      <button
        type="button"
        onClick={onOpenProfile}
        aria-label={`Ver o perfil de ${user.displayName}`}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 text-left"
      >
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
            // The cosmetic they bought, same as anywhere else their name is
            // drawn — a name that is purple in a room and plain here reads as
            // two different people.
            color={user.nameColor}
            className="truncate text-sm font-medium text-zinc-900 hover:underline dark:text-zinc-100"
          />
          <span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">
            @{user.username}
          </span>
        </span>
      </button>
      <span className="flex shrink-0 items-center gap-1.5">
        <Tooltip content={`Ligar para ${user.displayName}`}>
          <button
            type="button"
            disabled={busy}
            onClick={onCall}
            aria-label={`Ligar para ${user.displayName}`}
            className={`${ICON_ACTION} border-emerald-600/40 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-500/40 dark:text-emerald-400 dark:hover:bg-emerald-950/40`}
          >
            <MdCall className="h-4 w-4" />
          </button>
        </Tooltip>
        <Tooltip content={`Conversar com ${user.displayName}`}>
          <button
            type="button"
            onClick={() => openDirectMessages(user.id)}
            aria-label={`Conversar com ${user.displayName}`}
            className={`${ICON_ACTION} border-zinc-300 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-900`}
          >
            <MdChatBubbleOutline className="h-4 w-4" />
          </button>
        </Tooltip>
      </span>
    </li>
  );
}

export function HomeFriendsPanel({ className = "" }: { className?: string }) {
  // Whose profile is open, if any. Held here rather than per row so there is
  // one dialog on the page instead of one per friend — the same arrangement
  // the room uses (see WatchRoom's profileUserId).
  const [profileUserId, setProfileUserId] = useState<string | null>(null);
  const { account, loading: resolvingAccount } = useAuth();
  const { graph, loading } = useSocialGraph();
  // Subscribed here rather than per row so the panel holds one subscription
  // for the whole list — and because the order is the list's decision, which
  // means the list is what has to know who is around. Each face asks for its
  // own dot on top of this (UserAvatar does it from `userId`); the interest is
  // reference-counted, so the two do not fight (see lib/presence).
  const presence = usePresenceMap(graph.friends.map((user) => user.id));
  const friends = useMemo(() => byPresence(graph.friends, presence), [graph.friends, presence]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  // What a call refused, if it refused. "Ligar" changes nothing on this page
  // when it works — the ring is a dialog of its own (see CallHost) — so
  // without this a refusal is a button that did nothing, silently. Same
  // reasoning as the friends page's own error line.
  const [error, setError] = useState<string | null>(null);

  // Nothing at all for a guest, and nothing while we still don't know: the
  // panel appearing a beat after the page settled would shove the room form
  // sideways under somebody's cursor.
  if (resolvingAccount || !account) return null;

  async function call(user: SocialUser) {
    if (busyId) return;
    setBusyId(user.id);
    setError(null);
    const result = await startCall(user.id);
    if (!result.ok) setError(result.error ?? "Não foi possível ligar.");
    setBusyId(null);
  }

  return (
    <aside
      className={`w-full max-w-md rounded-2xl border border-black/10 bg-white p-5 shadow-sm lg:w-88 dark:border-white/10 dark:bg-zinc-950 ${className}`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          Amigos
          {graph.friends.length > 0 && (
            <span className="ml-1.5 font-normal text-zinc-400">{graph.friends.length}</span>
          )}
        </h2>
        <span className="flex shrink-0 items-center gap-2">
          <Tooltip content="Adicionar amigo">
            <button
              type="button"
              onClick={() => setAdding(true)}
              aria-label="Adicionar amigo"
              className="flex h-7 w-7 items-center justify-center rounded-lg border border-zinc-300 text-zinc-600 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-900"
            >
              <MdPersonAdd className="h-4 w-4" />
            </button>
          </Tooltip>
          <Link
            href="/amigos"
            className="text-xs font-medium text-zinc-500 underline underline-offset-2 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
          >
            Ver todos
          </Link>
        </span>
      </div>

      {/* Somebody waiting on an answer is the one thing worth interrupting
          this list for — and answering it is the friends page's job, so this
          is a pointer and not a second set of buttons. */}
      {graph.incoming.length > 0 && (
        <Link
          href="/amigos"
          className="mt-3 block rounded-lg border border-emerald-600/30 bg-emerald-50 px-2.5 py-2 text-xs font-medium text-emerald-700 transition hover:bg-emerald-100 dark:border-emerald-500/30 dark:bg-emerald-950/30 dark:text-emerald-400 dark:hover:bg-emerald-950/60"
        >
          {graph.incoming.length === 1
            ? "1 pedido de amizade esperando"
            : `${graph.incoming.length} pedidos de amizade esperando`}
        </Link>
      )}

      {error && (
        <p
          role="alert"
          className="mt-3 rounded-lg border border-red-200 bg-red-50 px-2.5 py-2 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300"
        >
          {error}
        </p>
      )}

      {loading ? (
        <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">Carregando…</p>
      ) : graph.friends.length === 0 ? (
        <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
          Você ainda não tem amigos aqui.{" "}
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="font-medium underline underline-offset-2 hover:text-zinc-900 dark:hover:text-zinc-100"
          >
            Adicionar alguém
          </button>
          , ou adicione pelo perfil e pela lista de participantes de uma sala.
        </p>
      ) : (
        // Capped and scrolled rather than allowed to run: this sits next to a
        // form, and a list of forty people would decide how tall the whole
        // page is.
        <ul className="mt-3 flex max-h-[26rem] flex-col gap-1.5 overflow-y-auto">
          {friends.map((user) => (
            <FriendRow
              key={user.id}
              user={user}
              busy={busyId === user.id}
              onCall={() => void call(user)}
              onOpenProfile={() => setProfileUserId(user.id)}
            />
          ))}
        </ul>
      )}

      {adding && <AddFriendDialog onClose={() => setAdding(false)} />}
      {/* Portalled to the body by the dialog itself, so it is not clipped by
          this panel's own scroll container — the friends list above is capped
          and scrolls, and a profile rendered inside it would open into a
          26rem-tall box. */}
      {profileUserId && (
        <UserProfileDialog
          userId={profileUserId}
          onClose={() => setProfileUserId(null)}
        />
      )}
    </aside>
  );
}
