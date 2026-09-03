"use client";

import { useState } from "react";
import { MdBlock, MdCheck, MdClose, MdPersonAdd, MdPersonRemove } from "react-icons/md";
import { useAuth } from "@/lib/AuthContext";
import {
  acceptFriend,
  addFriend,
  blockUser,
  removeFriend,
  unblockUser,
} from "@/lib/socialApi";
import { relationshipWith, useSocialGraph } from "@/lib/useSocialGraph";

// The friend/block controls for one person, wherever that person is shown.
//
// One component rather than a button per surface, because the interesting part
// is not the button — it is that there are five states and each one offers a
// different thing. A profile that shows "adicionar" to somebody who already
// sent *you* a request is a profile that makes you send a second request for a
// friendship you could have accepted.
//
// Renders nothing at all for your own card, or for a viewer with no account:
// friendship attaches to an account, so there is nobody to be friends with.

export function SocialActions({
  userId,
  displayName,
  className = "",
}: {
  userId: string;
  displayName: string;
  className?: string;
}) {
  const { account } = useAuth();
  const { graph, refresh } = useSocialGraph();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!account || account.id === userId) return null;

  const relationship = relationshipWith(graph, userId);

  async function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    const result = await action();
    if (!result.ok) setError(result.error ?? "Não foi possível concluir.");
    // Re-read either way. A failure is often a failure *because* the graph
    // moved — they accepted while this button was being pressed — and the
    // screen showing the old state is what made the button wrong.
    refresh();
    setBusy(false);
  }

  const buttonBase =
    "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <div className="flex flex-wrap items-center gap-2">
        {relationship === "blocked" ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => run(() => unblockUser(userId))}
            className={`${buttonBase} border border-zinc-300 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900`}
          >
            <MdBlock className="h-4 w-4 shrink-0" />
            Desbloquear
          </button>
        ) : (
          <>
            {relationship === "none" && (
              <button
                type="button"
                disabled={busy}
                onClick={() => run(() => addFriend(userId))}
                className={`${buttonBase} bg-zinc-950 text-white hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200`}
              >
                <MdPersonAdd className="h-4 w-4 shrink-0" />
                Adicionar
              </button>
            )}

            {relationship === "incoming" && (
              <>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => run(() => acceptFriend(userId))}
                  className={`${buttonBase} bg-emerald-600 text-white hover:bg-emerald-700`}
                >
                  <MdCheck className="h-4 w-4 shrink-0" />
                  Aceitar
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => run(() => removeFriend(userId))}
                  className={`${buttonBase} border border-zinc-300 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900`}
                >
                  <MdClose className="h-4 w-4 shrink-0" />
                  Recusar
                </button>
              </>
            )}

            {relationship === "outgoing" && (
              <button
                type="button"
                disabled={busy}
                onClick={() => run(() => removeFriend(userId))}
                className={`${buttonBase} border border-zinc-300 text-zinc-500 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-900`}
              >
                <MdClose className="h-4 w-4 shrink-0" />
                Cancelar pedido
              </button>
            )}

            {relationship === "friends" && (
              <button
                type="button"
                disabled={busy}
                onClick={() => run(() => removeFriend(userId))}
                className={`${buttonBase} border border-zinc-300 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900`}
              >
                <MdPersonRemove className="h-4 w-4 shrink-0" />
                Desfazer amizade
              </button>
            )}

            <button
              type="button"
              disabled={busy}
              // Confirmed, because it is the one action here that also throws
              // away an existing friendship (see the API's blockAccount) and
              // there is no undo that gets it back.
              onClick={() => {
                if (!window.confirm(`Bloquear ${displayName}?`)) return;
                void run(() => blockUser(userId));
              }}
              className={`${buttonBase} text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40`}
            >
              <MdBlock className="h-4 w-4 shrink-0" />
              Bloquear
            </button>
          </>
        )}
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}
