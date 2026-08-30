"use client";

import Link from "next/link";
import { BsCoin } from "react-icons/bs";
import { MdLogin } from "react-icons/md";
import { useAuth } from "@/lib/AuthContext";
import { useSignaling } from "@/lib/useSignaling";
import { trackEvent } from "@/lib/analytics";
import { Tooltip } from "@/components/Tooltip";
import { VerifiedBadgeIcon } from "@/components/icons";

// Who you are, at the foot of the room's chat column (see WatchRoom, from lg
// up). It used to be a chip wedged into the header between "Compartilhar
// sala" and "Apoiar projeto", where it was competing for space with the
// mid-call controls and had room for a truncated name and a number — the
// header dropped even the name on a narrow desktop.
//
// Down here it has a column's width to itself and nothing to compete with, so
// it can be what it actually is: an identity card. That is also where the
// avatar goes when there is one to show; the slot below is drawn as a real
// avatar already, just filled with an initial.
//
// Below lg there is no chat column, and the header keeps its chip.
//
// Everything it costs comes off the chat above it, so it answers to the
// viewport's *height* rather than its width: a laptop 768px tall is where it
// was too big, and that screen is plenty wide. Past the threshold below, the
// points stop being a row of their own and ride on the same line as the name
// — see `basis-full` on that chip. The whole thing is CSS, so there is one
// copy of the markup rather than a tall and a short variant to keep in step.
// 52rem lands 1080p windows on the roomy side and 768/800px laptops on the
// compact one.
export function RoomAccountCard({ onCreateAccount }: { onCreateAccount: () => void }) {
  const state = useSignaling();
  const { account, points } = useAuth();

  // Nothing to show before an identity exists — a name is what mints even the
  // guest one, and until then the room is still asking for it.
  if (!state.name) return null;

  const isAccount = Boolean(account);
  const initial = state.name.trim().slice(0, 1).toUpperCase();
  const verified = state.account?.flags?.includes("VERIFIED");

  const avatar = (
    <span
      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-base font-semibold text-white [@media(max-height:52rem)]:h-8 [@media(max-height:52rem)]:w-8 [@media(max-height:52rem)]:rounded-lg [@media(max-height:52rem)]:text-sm ${
        // The same two gradients components/AccountMenu.tsx uses for the same
        // distinction: an account and a guest name are genuinely different
        // things — one survives this browser, the other does not — and the
        // avatar says which without spending a word on it.
        isAccount
          ? "bg-gradient-to-br from-emerald-500 to-teal-600"
          : "bg-gradient-to-br from-zinc-400 to-zinc-500"
        }`}
    >
      {initial}
    </span>
  );

  const identity = (
    <div className="flex min-w-0 flex-col">
      <span className="flex min-w-0 items-center gap-1">
        <span className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          {state.name}
        </span>
        {verified && <VerifiedBadgeIcon className="h-4 w-4 shrink-0 text-blue-500" />}
      </span>
      {/* The second line is the first thing to go when the card has to be
          short: "@fulano" is context, and the name above it is the point. */}
      <span className="truncate text-xs text-zinc-500 [@media(max-height:46rem)]:hidden dark:text-zinc-400">
        {account ? `@${account.username}` : "Convidado"}
      </span>
    </div>
  );

  return (
    <div className="mt-2 shrink-0 rounded-xl border border-zinc-200 bg-white p-3 [@media(max-height:52rem)]:mt-1.5 [@media(max-height:52rem)]:p-2 dark:border-zinc-800 dark:bg-zinc-950">
      {/* Wrapping, and it is the points chip below that decides whether it
          wraps: `basis-full` gives it a line of its own, and dropping that on
          a short viewport pulls it up beside the name. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 [@media(max-height:52rem)]:gap-x-2 [@media(max-height:52rem)]:gap-y-1.5">
        {/* Only an account has somewhere to go — a guest has no public
            profile, so theirs is the same block without the link rather than
            a link that lands nowhere. */}
        {account ? (
          <Tooltip content="Ver seu perfil" placement="top">
            <Link
              href={`/user/${account.id}`}
              target="_blank"
              className="flex min-w-0 flex-1 items-center gap-3 rounded-lg transition hover:opacity-80 [@media(max-height:52rem)]:gap-2"
            >
              {avatar}
              {identity}
            </Link>
          </Tooltip>
        ) : (
          <div className="flex min-w-0 flex-1 items-center gap-3 [@media(max-height:52rem)]:gap-2">
            {avatar}
            {identity}
          </div>
        )}

        {/* A row of its own where there is height for it, a chip on the name's
            line where there isn't. Same coin the rest of the site uses for
            points; the word "Pontos" is what gets dropped in the narrow form,
            since a coin next to a number does not need it spelled out. */}
        <Tooltip
          content={
            isAccount
              ? "Pontos ganhos assistindo aos anúncios dos parceiros"
              : "Seus pontos de convidado ficam salvos só neste navegador. Limpar os dados do site, ou entrar de outro navegador, começa do zero — crie uma conta para não perdê-los."
          }
          placement="top"
        >
          <div className="flex shrink-0 basis-full items-center justify-between gap-2 rounded-lg bg-zinc-100 px-3 py-2 [@media(max-height:52rem)]:basis-auto [@media(max-height:52rem)]:px-2 [@media(max-height:52rem)]:py-1 dark:bg-zinc-900">
            <span className="flex items-center gap-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-400">
              <BsCoin className="h-3.5 w-3.5 shrink-0 text-amber-500" />
              <span className="[@media(max-height:52rem)]:hidden">Pontos</span>
            </span>
            <span className="text-sm font-semibold tabular-nums text-zinc-900 [@media(max-height:52rem)]:text-xs dark:text-zinc-100">
              {points.toLocaleString("pt-BR")}
            </span>
          </div>
        </Tooltip>
      </div>

      {/* Guests only. The offer belongs next to the thing it protects — the
          points right above it, which this browser is the only copy of. */}
      {!isAccount && (
        <button
          type="button"
          onClick={() => {
            trackEvent("account_button_clicked");
            onCreateAccount();
          }}
          className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-zinc-950 bg-zinc-950 px-3 py-2 text-sm font-medium text-white transition hover:bg-zinc-800 [@media(max-height:52rem)]:mt-1.5 [@media(max-height:52rem)]:py-1.5 [@media(max-height:52rem)]:text-xs dark:border-zinc-50 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
        >
          <MdLogin className="h-4 w-4 shrink-0" />
          <span className="[@media(max-height:52rem)]:hidden">Criar conta ou entrar</span>
          <span className="hidden [@media(max-height:52rem)]:inline">Criar conta</span>
        </button>
      )}
    </div>
  );
}
