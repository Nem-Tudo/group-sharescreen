"use client";

import { useEffect, useState } from "react";
import { MdCheck, MdClose } from "react-icons/md";
import { DisplayUserName } from "@/components/DisplayUserName";
import { hasVerifiedBadge } from "@/lib/entitlements";
import { acceptFriend, removeFriend } from "@/lib/socialApi";
import { useSocialGraph } from "@/lib/useSocialGraph";

// Answering a friend request without going anywhere.
//
// A dialog rather than a link to /amigos, and the reason is the room: that
// page is a *navigation*, and navigating out of a room ends the call (see
// WatchRoom's unmount, which calls leaveRoom). Somebody answering a request
// mid-conversation should not lose the conversation to do it — the whole
// interaction is two buttons, and two buttons do not need a page.

export function FriendRequestsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { graph, refresh } = useSocialGraph();
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  async function run(userId: string, action: () => Promise<unknown>) {
    if (busyId) return;
    setBusyId(userId);
    await action();
    refresh();
    setBusyId(null);
  }

  const action =
    "flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Pedidos de amizade"
        // Without this a click anywhere inside the card bubbles to the
        // backdrop and closes the dialog — including a click on "aceitar".
        onClick={(e) => e.stopPropagation()}
        className="max-h-[80vh] w-full max-w-md overflow-y-auto rounded-2xl border border-black/10 bg-white p-6 shadow-xl dark:border-white/10 dark:bg-zinc-950"
      >
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-lg font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
            Pedidos de amizade
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="-mr-1 rounded-lg p-1 text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-900 dark:hover:text-zinc-100"
          >
            <MdClose className="h-5 w-5" />
          </button>
        </div>

        {graph.incoming.length === 0 ? (
          // Reachable by answering the last one without closing first, which
          // is the common way to leave this screen.
          <p className="mt-4 text-sm text-zinc-500 dark:text-zinc-400">
            Nenhum pedido esperando por você.
          </p>
        ) : (
          <ul className="mt-4 flex flex-col gap-2">
            {graph.incoming.map((user) => (
              <li
                key={user.id}
                className="flex items-center gap-3 rounded-lg border border-zinc-200 px-3 py-2 dark:border-zinc-800"
              >
                <span className="min-w-0 flex-1">
                  <DisplayUserName
                    name={user.displayName}
                    verified={hasVerifiedBadge(user.flags)}
                    className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100"
                  />
                  <span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">
                    @{user.username}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-1.5">
                  <button
                    type="button"
                    disabled={busyId === user.id}
                    onClick={() => run(user.id, () => acceptFriend(user.id))}
                    className={`${action} bg-emerald-600 text-white hover:bg-emerald-700`}
                  >
                    <MdCheck className="h-3.5 w-3.5" />
                    Aceitar
                  </button>
                  <button
                    type="button"
                    disabled={busyId === user.id}
                    onClick={() => run(user.id, () => removeFriend(user.id))}
                    className={`${action} border border-zinc-300 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-900`}
                  >
                    <MdClose className="h-3.5 w-3.5" />
                    Recusar
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
