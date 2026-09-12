"use client";

import Link from "next/link";
import { MdBlock, MdCall, MdChatBubbleOutline, MdCheck, MdClose, MdPersonRemove } from "react-icons/md";
import { DisplayUserName } from "@/components/DisplayUserName";
import { PresenceDot } from "@/components/PresenceDot";
import { usePresence } from "@/lib/presence";
import { AccountModal, type AccountModalMode } from "@/components/AccountModal";
import { useAuth } from "@/lib/AuthContext";
import { hasVerifiedBadge, verifiedBadge } from "@/lib/entitlements";
import { acceptFriend, removeFriend, unblockUser, type SocialUser } from "@/lib/socialApi";
import { useSocialGraph } from "@/lib/useSocialGraph";
import { openDirectMessages } from "@/lib/dmWindow";
import { startCall } from "@/lib/callsApi";
import { useState } from "react";

// The friends page: who you are friends with, who is waiting on you, who you
// are waiting on, and who you have blocked.
//
// Requests received come first, above the friends list, and that ordering is
// the only opinion in this file: it is the one section with something to *do*
// in it, and a list of people you already added is not what you opened this
// page for when somebody is waiting.
//
// Adding is deliberately not here. Somebody is added from where you met them
// — their profile, a room's participant list (see components/SocialActions) —
// and a search box on this page would be a second way to find people that has
// to stay in step with the first.

function Row({
  user,
  children,
}: {
  user: SocialUser;
  children?: React.ReactNode;
}) {
  // No picture in this list, so the dot sits against the name — the one
  // place it is the row's only face.
  const presence = usePresence(user.id);
  return (
    <li className="flex items-center gap-3 rounded-lg border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-950">
      <Link href={`/user/${user.username}`} className="min-w-0 flex-1 hover:underline">
        <span className="flex min-w-0 items-center gap-1.5">
          <PresenceDot presence={presence} size={8} />
          <DisplayUserName
            name={user.displayName}
            verified={verifiedBadge(user.flags)}
            bot={user.bot}
            className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100"
          />
        </span>
        <span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">
          @{user.username}
        </span>
      </Link>
      <span className="flex shrink-0 items-center gap-1.5">{children}</span>
    </li>
  );
}

const ACTION =
  "flex cursor-pointer items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-50";

function Section({
  title,
  count,
  empty,
  children,
}: {
  title: string;
  count: number;
  empty: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-6">
      <h2 className="mb-2 text-sm font-semibold text-zinc-700 dark:text-zinc-300">
        {title}
        {count > 0 && <span className="ml-1.5 text-zinc-400">{count}</span>}
      </h2>
      {count === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">{empty}</p>
      ) : (
        <ul className="flex flex-col gap-2">{children}</ul>
      )}
    </section>
  );
}

export function FriendsPanel() {
  const { account, loading: resolvingAccount } = useAuth();
  const { graph, loading, refresh } = useSocialGraph();
  const [accountModal, setAccountModal] = useState<AccountModalMode | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  // What the last action refused, if it refused.
  //
  // Every verb on this page already returned one and nothing showed it, which
  // was survivable while they were all "remover"/"aceitar" — the list simply
  // did not change and you could see that. "Ligar" changes nothing visible on
  // this page at all, so a refusal (they blocked you, the account is gone)
  // would have been a button that does nothing, silently.
  const [error, setError] = useState<string | null>(null);

  async function run(
    userId: string,
    action: () => Promise<{ ok: boolean; error?: string } | unknown>
  ) {
    if (busyId) return;
    setBusyId(userId);
    setError(null);
    const result = (await action()) as { ok?: boolean; error?: string } | undefined;
    if (result && result.ok === false) setError(result.error ?? "Não foi possível concluir.");
    // Re-read either way. A failure is often a failure *because* the graph
    // moved — the same reasoning as components/SocialActions.
    refresh();
    setBusyId(null);
  }

  if (!resolvingAccount && !account) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-10">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
          Amigos
        </h1>
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
          {/* A friendship has to attach to something that survives clearing a
              browser, and a guest identity by design does not. */}
          É preciso ter uma conta para adicionar amigos.{" "}
          <button
            type="button"
            onClick={() => setAccountModal("create")}
            className="font-medium underline underline-offset-2"
          >
            Criar conta
          </button>
        </p>
        <AccountModal mode={accountModal} onModeChange={setAccountModal} />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-10">
      <h1 className="text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
        Amigos
      </h1>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        Adicione alguém pelo perfil, ou pela lista de participantes de uma sala.
      </p>

      {error && (
        <p
          role="alert"
          className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300"
        >
          {error}
        </p>
      )}

      {loading ? (
        <p className="mt-6 text-sm text-zinc-500 dark:text-zinc-400">Carregando…</p>
      ) : (
        <>
          <Section
            title="Pedidos recebidos"
            count={graph.incoming.length}
            empty="Nenhum pedido esperando por você."
          >
            {graph.incoming.map((user) => (
              <Row key={user.id} user={user}>
                <button
                  type="button"
                  disabled={busyId === user.id}
                  onClick={() => run(user.id, () => acceptFriend(user.id))}
                  className={`${ACTION} bg-emerald-600 text-white hover:bg-emerald-700`}
                >
                  <MdCheck className="h-3.5 w-3.5" />
                  Aceitar
                </button>
                <button
                  type="button"
                  disabled={busyId === user.id}
                  onClick={() => run(user.id, () => removeFriend(user.id))}
                  className={`${ACTION} border border-zinc-300 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-900`}
                >
                  <MdClose className="h-3.5 w-3.5" />
                  Recusar
                </button>
              </Row>
            ))}
          </Section>

          <Section
            title="Seus amigos"
            count={graph.friends.length}
            empty="Você ainda não tem amigos aqui."
          >
            {graph.friends.map((user) => (
              <Row key={user.id} user={user}>
                {/* The two things this page was missing: it lists exactly the
                    people you would want to reach, and until now the only way
                    to reach any of them was to open their profile first. */}
                <button
                  type="button"
                  disabled={busyId === user.id}
                  onClick={() =>
                    run(user.id, async () => {
                      const result = await startCall(user.id);
                      return result.ok ? { ok: true } : { ok: false, error: result.error };
                    })
                  }
                  aria-label={`Ligar para ${user.displayName}`}
                  className={`${ACTION} border border-emerald-600/40 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-500/40 dark:text-emerald-400 dark:hover:bg-emerald-950/40`}
                >
                  <MdCall className="h-3.5 w-3.5" />
                  Ligar
                </button>
                <button
                  type="button"
                  onClick={() => openDirectMessages(user.id)}
                  aria-label={`Conversar com ${user.displayName}`}
                  className={`${ACTION} border border-zinc-300 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-900`}
                >
                  <MdChatBubbleOutline className="h-3.5 w-3.5" />
                  Mensagem
                </button>
                <button
                  type="button"
                  disabled={busyId === user.id}
                  onClick={() => run(user.id, () => removeFriend(user.id))}
                  className={`${ACTION} border border-zinc-300 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-900`}
                >
                  <MdPersonRemove className="h-3.5 w-3.5" />
                  Remover
                </button>
              </Row>
            ))}
          </Section>

          <Section
            title="Pedidos enviados"
            count={graph.outgoing.length}
            empty="Nenhum pedido enviado."
          >
            {graph.outgoing.map((user) => (
              <Row key={user.id} user={user}>
                <button
                  type="button"
                  disabled={busyId === user.id}
                  onClick={() => run(user.id, () => removeFriend(user.id))}
                  className={`${ACTION} border border-zinc-300 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-900`}
                >
                  <MdClose className="h-3.5 w-3.5" />
                  Cancelar
                </button>
              </Row>
            ))}
          </Section>

          <Section
            title="Bloqueados"
            count={graph.blocked.length}
            empty="Ninguém bloqueado."
          >
            {graph.blocked.map((user) => (
              <Row key={user.id} user={user}>
                <button
                  type="button"
                  disabled={busyId === user.id}
                  onClick={() => run(user.id, () => unblockUser(user.id))}
                  className={`${ACTION} border border-zinc-300 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-900`}
                >
                  <MdBlock className="h-3.5 w-3.5" />
                  Desbloquear
                </button>
              </Row>
            ))}
          </Section>
        </>
      )}
    </div>
  );
}
