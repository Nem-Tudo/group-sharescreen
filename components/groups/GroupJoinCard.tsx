"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { CreateAccountForm } from "@/components/CreateAccountForm";
import { LoginForm } from "@/components/LoginForm";
import { GroupIcon } from "@/components/groups/GroupIcon";
import { GroupName } from "@/components/groups/GroupName";
import { useAuth } from "@/lib/AuthContext";
import { useGuestToken } from "@/lib/guestToken";
import type { InvitePreview } from "@/lib/groupLinks";
import { signalingClient } from "@/lib/signalingClient";
import { useSignalingSelector } from "@/lib/useSignalingSelector";
import { selectName } from "@/lib/signalingSelectors";

// The card that lets somebody into a group: which group, how many people, and
// the one button. Drawn by an invite link (InviteClient) and by a public
// group's own page (GroupPages' PublicGroupGate) — the only difference between
// the two is what the button spends.
//
// Somebody arriving with no identity at all picks a guest name (or signs in)
// right here, and the join goes through the moment that identity exists — a
// link that first sent people off to the home page to "choose a name" would
// lose most of them on the way back.

export function GroupJoinCard({
  group,
  member,
  headline,
  acceptLabel,
  blocked,
  onOpen,
  join,
}: {
  group: InvitePreview["group"];
  /** Already in — the button just opens the group. */
  member: boolean;
  /** The line above the group's name — "Você foi convidado para entrar em". */
  headline: string;
  /** "Aceitar convite", "Entrar no grupo". */
  acceptLabel: string;
  /** Why nobody can get in this way right now (an expired invite, say), or null. */
  blocked?: ReactNode;
  onOpen: () => void;
  /** Does the joining; `name` is a guest's, null for an account. Resolves when done, or with the error to show. */
  join: (name: string | null) => Promise<{ ok: true } | { ok: false; error: string }>;
}) {
  const { account, loading } = useAuth();
  const guestToken = useGuestToken();
  const registeredName = useSignalingSelector(selectName);

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"guest" | "login" | "create">("guest");
  const [nameInput, setNameInput] = useState("");
  // Set when a guest has just typed a name: join as soon as the server has
  // handed this browser the identity that name registered under.
  const [joinWhenReady, setJoinWhenReady] = useState(false);
  const joinStarted = useRef(false);

  const hasIdentity = Boolean(account) || Boolean(guestToken && registeredName);

  async function accept() {
    if (joinStarted.current) return;
    joinStarted.current = true;
    setBusy(true);
    setError(null);
    const result = await join(account ? null : registeredName ?? nameInput.trim());
    if (!result.ok) {
      joinStarted.current = false;
      setBusy(false);
      setJoinWhenReady(false);
      setError(result.error);
    }
  }

  // The identity a guest just asked for arrives over the socket; join on the
  // next tick after it does, rather than inside the render that noticed it.
  useEffect(() => {
    if (!joinWhenReady || !hasIdentity) return;
    const timer = setTimeout(() => void accept(), 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [joinWhenReady, hasIdentity]);

  function submitGuestName(e: FormEvent) {
    e.preventDefault();
    const trimmed = nameInput.trim();
    if (!trimmed) return;
    signalingClient.register(trimmed);
    setJoinWhenReady(true);
  }

  return (
    <>
      <GroupIcon name={group.name} iconUrl={group.iconUrl} seed={group.id} size={80} className="rounded-3xl" />
      <p className="text-sm text-zinc-500 dark:text-zinc-400">{headline}</p>
      <h1 className="flex max-w-full justify-center text-2xl font-bold tracking-tight text-zinc-950 dark:text-zinc-50">
        <GroupName name={group.name} flags={group.flags} badgeClassName="h-6 w-6" />
      </h1>
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
          <button type="button" onClick={onOpen} className={primaryClass}>
            Você já está aqui — abrir o grupo
          </button>
        ) : blocked ? (
          <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">{blocked}</p>
        ) : loading ? (
          <p className="text-sm text-zinc-500">Carregando…</p>
        ) : hasIdentity && !joinWhenReady ? (
          <button type="button" onClick={() => void accept()} disabled={busy} className={primaryClass}>
            {busy ? "Entrando…" : account ? acceptLabel : `${acceptLabel} como ${registeredName}`}
          </button>
        ) : joinWhenReady ? (
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
            <label htmlFor="join-name" className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Como quer ser chamado?
            </label>
            <div className="flex gap-2">
              <input
                id="join-name"
                autoFocus
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                maxLength={24}
                placeholder="Ex: Maria"
                className="min-w-0 flex-1 rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-zinc-950 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
              />
              <button type="submit" disabled={!nameInput.trim()} className={`${primaryBase} shrink-0`}>
                Entrar
              </button>
            </div>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
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

// Without a width: a class string that says both w-full and w-auto is settled
// by the stylesheet's order, not the string's — and w-full wins, which is how
// the guest form's button once ate the whole row and crushed the name field.
const primaryBase =
  "cursor-pointer rounded-lg bg-zinc-950 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200";
const primaryClass = `w-full ${primaryBase}`;
