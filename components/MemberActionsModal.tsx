"use client";

import { useState } from "react";
import { MdGavel, MdLogout } from "react-icons/md";
import { signalingClient } from "@/lib/signalingClient";
import { DisplayUserName } from "./DisplayUserName";

export type MemberActions = {
  // The stable user id (see the server's stableUserId) — what every room
  // action is addressed to, and what a ban is recorded against. Never the
  // connection id, which is reissued on every reconnect and would ban a
  // socket rather than a person.
  userId: string;
  name: string;
  isGuest?: boolean;
  verified?: boolean;
  nameColor?: string | null;
  // What this viewer may do to them, decided by the caller — which is the
  // only place that knows both who is asking and who the room's owner and
  // admins are. Re-checked server-side either way.
  canKick: boolean;
  canBan: boolean;
  // Why they cannot, when they cannot. Shown instead of the buttons, because
  // "the menu opened and did nothing" is the worst of the three outcomes.
  blockedReason?: string | null;
};

export type MemberActionsPopupData = MemberActions;

// The room's actions for one person. Two shells, one body:
//
//   - on a desktop it is a panel anchored beside the person it is about (see
//     ParticipantRow and ChatPanel, which open it in a Popover). A menu about
//     somebody belongs next to them — a box in the middle of the screen makes
//     you check twice that it is aimed at who you think;
//   - on a phone it is the popup below, because a panel hanging off a row in
//     a 360px column has nowhere to hang, and a sheet is the gesture that
//     platform already uses for exactly this.
//
// Two actions for now, and they are different things rather than degrees of
// one: kicking ends this visit, banning ends every future one. Which is why
// the second asks again before it happens — it is the one that cannot be
// undone by the person who did it (only the room's owner lifts a ban).
export function MemberActionsMenu({
  actions: { userId, name, isGuest, verified, nameColor, canKick, canBan, blockedReason },
  onDone,
  // The phone's shell has a title bar of its own with a close button; the
  // anchored one is titled by the row it is pointing at.
  showHeader = false,
}: {
  actions: MemberActions;
  onDone: () => void;
  showHeader?: boolean;
}) {
  const [confirmingBan, setConfirmingBan] = useState(false);

  return (
    <div className="flex w-72 max-w-[calc(100vw-1rem)] flex-col gap-3 rounded-xl bg-white p-4 text-zinc-900 shadow-lg dark:bg-zinc-950 dark:text-zinc-50">
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 text-sm font-semibold">
          <DisplayUserName name={name} isGuest={isGuest} verified={verified} color={nameColor} className="truncate" />
        </p>
        {showHeader && (
          <button
            type="button"
            onClick={onDone}
            aria-label="Fechar"
            className="-mr-1 -mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-lg leading-none opacity-60 transition hover:bg-black/10 hover:opacity-100 dark:hover:bg-white/10"
          >
            ×
          </button>
        )}
      </div>

      {blockedReason ? (
        <p className="text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">{blockedReason}</p>
      ) : (
        <div className="flex flex-col gap-2">
          {canKick && (
            <button
              type="button"
              onClick={() => {
                signalingClient.kickMember(userId);
                onDone();
              }}
              className="flex items-center gap-2.5 rounded-lg border border-zinc-300 px-3 py-2.5 text-left transition hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
            >
              <MdLogout className="h-4 w-4 shrink-0 text-amber-500" />
              <span className="min-w-0">
                <span className="block text-sm font-medium">Expulsar da sala</span>
                <span className="block text-[11px] text-zinc-500 dark:text-zinc-400">
                  Sai agora, mas pode voltar
                </span>
              </span>
            </button>
          )}

          {canBan &&
            (confirmingBan ? (
              <div className="rounded-lg border border-red-300 p-3 dark:border-red-900">
                <p className="text-xs leading-relaxed text-zinc-600 dark:text-zinc-300">
                  Banir tira {name} da sala e impede que volte. Só o dono da sala pode desfazer,
                  na aba <span className="font-medium">Banimentos</span> de Gerenciar sala.
                </p>
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      signalingClient.banMember(userId);
                      onDone();
                    }}
                    className="flex-1 rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-red-700"
                  >
                    Banir
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmingBan(false)}
                    className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-600 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-900"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmingBan(true)}
                className="flex items-center gap-2.5 rounded-lg border border-red-300 px-3 py-2.5 text-left transition hover:bg-red-50 dark:border-red-900 dark:hover:bg-red-950/40"
              >
                <MdGavel className="h-4 w-4 shrink-0 text-red-500" />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-red-600 dark:text-red-400">
                    Banir da sala
                  </span>
                  <span className="block text-[11px] text-zinc-500 dark:text-zinc-400">
                    Sai agora e não consegue voltar
                  </span>
                </span>
              </button>
            ))}
        </div>
      )}
    </div>
  );
}

// The phone's shell — an ntpopups popup, registered as "member_actions" in
// NtPopups.tsx.
export function MemberActionsModal({
  closePopup,
  data,
}: {
  closePopup: (hasAction?: boolean) => void;
  data: MemberActionsPopupData;
}) {
  return <MemberActionsMenu actions={data} onDone={() => closePopup(true)} showHeader />;
}
