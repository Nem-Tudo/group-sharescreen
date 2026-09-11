"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { CreateAccountForm } from "@/components/CreateAccountForm";
import { LoginForm } from "@/components/LoginForm";
import { GroupIcon } from "@/components/groups/GroupIcon";
import { useAuth } from "@/lib/AuthContext";
import { useAccountToken } from "@/lib/accountApi";
import { useGuestToken } from "@/lib/guestToken";
import { acceptInvite } from "@/lib/groupsApi";
import { fetchInvitePreview, groupPath, type InvitePreview } from "@/lib/groupLinks";
import { signalingClient } from "@/lib/signalingClient";
import { useSignaling } from "@/lib/useSignaling";
import { refreshGroups } from "@/lib/useGroups";

// The invite card: which group, how many people, and the one button. Somebody
// arriving with no identity at all picks a guest name (or signs in) right here,
// and the invite is accepted the moment that identity exists — an invite link
// that first sent people off to the home page to "choose a name" would lose
// most of them on the way back.

const STATE_TEXT: Record<Exclude<InvitePreview["invite"]["state"], "ok">, string> = {
  expired: "Este convite expirou.",
  revoked: "Este convite foi revogado.",
  exhausted: "Este convite já foi usado o máximo de vezes.",
};

export function InviteClient({ code, initialPreview }: { code: string; initialPreview: InvitePreview | null }) {
  const router = useRouter();
  const { account, loading } = useAuth();
  const accountToken = useAccountToken();
  const guestToken = useGuestToken();
  const { name: registeredName } = useSignaling();
  const token = accountToken ?? guestToken;

  const [preview, setPreview] = useState(initialPreview);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"guest" | "login" | "create">("guest");
  const [nameInput, setNameInput] = useState("");
  // Set when a guest has just typed a name: accept as soon as the server has
  // handed this browser the identity that name registered under.
  const [acceptWhenReady, setAcceptWhenReady] = useState(false);
  const acceptStarted = useRef(false);

  // Re-read with whoever this is, to learn whether they are already in.
  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    void fetchInvitePreview(code, token, controller.signal).then((next) => {
      if (next && !controller.signal.aborted) setPreview(next);
    });
    return () => controller.abort();
  }, [code, token]);

  const hasIdentity = Boolean(account) || Boolean(guestToken && registeredName);

  async function accept() {
    if (acceptStarted.current) return;
    acceptStarted.current = true;
    setBusy(true);
    setError(null);
    const result = await acceptInvite(code, account ? null : registeredName ?? nameInput.trim());
    if (!result.ok) {
      acceptStarted.current = false;
      setBusy(false);
      setAcceptWhenReady(false);
      setError(result.error);
      return;
    }
    await refreshGroups();
    router.push(groupPath(result.groupId));
  }

  // The identity a guest just asked for arrives over the socket; accept on the
  // next tick after it does, rather than inside the render that noticed it.
  useEffect(() => {
    if (!acceptWhenReady || !hasIdentity) return;
    const timer = setTimeout(() => void accept(), 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [acceptWhenReady, hasIdentity]);

  function submitGuestName(e: FormEvent) {
    e.preventDefault();
    const trimmed = nameInput.trim();
    if (!trimmed) return;
    signalingClient.register(trimmed);
    setAcceptWhenReady(true);
  }

  let body: React.ReactNode;
  if (!preview) {
    body = (
      <>
        <h1 className="text-xl font-semibold text-zinc-950 dark:text-zinc-50">Convite inválido</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Esse link não leva a nenhum grupo. Confira se foi copiado inteiro, ou peça um novo.
        </p>
        <Link href="/" className="mt-2 text-sm font-medium underline underline-offset-4">
          Ir para o início
        </Link>
      </>
    );
  } else {
    const { group, invite, member } = preview;
    body = (
      <>
        <GroupIcon name={group.name} iconUrl={group.iconUrl} seed={group.id} size={80} className="rounded-3xl" />
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Você foi convidado para entrar em</p>
        <h1 className="text-2xl font-bold tracking-tight text-zinc-950 dark:text-zinc-50">{group.name}</h1>
        {group.description && <p className="max-w-sm text-sm text-zinc-600 dark:text-zinc-400">{group.description}</p>}
        <p className="flex items-center gap-3 text-sm text-zinc-500 dark:text-zinc-400">
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
            {group.onlineCount} online
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-zinc-400" />
            {group.memberCount} {group.memberCount === 1 ? "membro" : "membros"}
          </span>
        </p>

        <div className="mt-4 w-full">
          {member ? (
            <button type="button" onClick={() => router.push(groupPath(group.id))} className={primaryClass}>
              Você já está aqui — abrir o grupo
            </button>
          ) : invite.state !== "ok" ? (
            <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">
              {STATE_TEXT[invite.state]} Peça um novo convite a alguém do grupo.
            </p>
          ) : loading ? (
            <p className="text-sm text-zinc-500">Carregando…</p>
          ) : hasIdentity && !acceptWhenReady ? (
            <button type="button" onClick={() => void accept()} disabled={busy} className={primaryClass}>
              {busy ? "Entrando…" : account ? "Aceitar convite" : `Aceitar convite como ${registeredName}`}
            </button>
          ) : acceptWhenReady ? (
            <p className="text-sm text-zinc-500">Entrando…</p>
          ) : mode === "login" ? (
            <div className="text-left">
              <LoginForm onCancel={() => setMode("guest")} onSwitchToCreate={() => setMode("create")} />
            </div>
          ) : mode === "create" ? (
            <div className="text-left">
              <CreateAccountForm
                initialDisplayName={nameInput}
                onCancel={() => setMode("guest")}
                onSwitchToLogin={() => setMode("login")}
              />
            </div>
          ) : (
            <form onSubmit={submitGuestName} className="flex flex-col gap-2 text-left">
              <label htmlFor="invite-name" className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Como quer ser chamado?
              </label>
              <div className="flex gap-2">
                <input
                  id="invite-name"
                  autoFocus
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  maxLength={24}
                  placeholder="Ex: Maria"
                  className="min-w-0 flex-1 rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-zinc-950 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
                />
                <button type="submit" disabled={!nameInput.trim()} className={`${primaryClass} w-auto shrink-0`}>
                  Entrar
                </button>
              </div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Sem conta dá para participar de até 2 grupos.{" "}
                <button type="button" onClick={() => setMode("create")} className="cursor-pointer font-medium underline underline-offset-2">
                  Criar conta
                </button>{" "}
                ·{" "}
                <button type="button" onClick={() => setMode("login")} className="cursor-pointer font-medium underline underline-offset-2">
                  Já tenho conta
                </button>
              </p>
            </form>
          )}
          {error && <p className="mt-3 text-sm text-red-500">{error}</p>}
        </div>
      </>
    );
  }

  return (
    <div className="flex flex-1 items-center justify-center px-4 py-12">
      <main className="flex w-full max-w-md flex-col items-center gap-2 rounded-2xl border border-black/10 bg-white p-8 text-center shadow-sm dark:border-white/10 dark:bg-zinc-950">
        {body}
      </main>
    </div>
  );
}

const primaryClass =
  "w-full cursor-pointer rounded-lg bg-zinc-950 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200";
