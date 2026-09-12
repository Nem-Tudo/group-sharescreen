"use client";

import { useState } from "react";
import { MdGavel, MdLogout } from "react-icons/md";
import { FaCrown } from "react-icons/fa";
import { signalingClient } from "@/lib/signalingClient";
import { useSignalingSelector } from "@/lib/useSignalingSelector";
import { selectRoom } from "@/lib/signalingSelectors";
import { isActiveGroupVoiceRoom } from "@/lib/groupVoiceSession";
import { DisplayUserName } from "./DisplayUserName";
import type { VerifiedTone } from "@/lib/entitlements";
import { useT } from "@/lib/useI18n";

export type MemberActions = {
  // The stable user id (see the server's stableUserId) — what every room
  // action is addressed to, and what a ban is recorded against. Never the
  // connection id, which is reissued on every reconnect and would ban a
  // socket rather than a person.
  userId: string;
  name: string;
  isGuest?: boolean;
  verified?: VerifiedTone | boolean;
  bot?: boolean;
  nameColor?: string | null;
  // What this viewer may do to them, decided by the caller — which is the
  // only place that knows both who is asking and who the room's owner and
  // admins are. Re-checked server-side either way.
  canKick: boolean;
  canBan: boolean;
  /**
   * Whether this viewer may make them an administrator, or stop them being
   * one. The owner alone — an admin who could grow their own ranks is an admin
   * who can outvote the person whose room it is (see the server's
   * "room-admin-add", which ignores anybody else).
   */
  canPromote: boolean;
  /** Whether they already are one, which is what the one button says. */
  isAdmin: boolean;
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
// Three actions, and they are different things rather than degrees of one:
// kicking ends this visit, banning ends every future one, and promoting hands
// over the room's own controls.
//
// Only the ban asks again, and the rule behind that is worth stating because
// promoting looks like it deserves a confirmation too: the question is not how
// *big* the action is, it is whether the person doing it can take it back.
// A ban can only be lifted by the room's owner, from a panel two screens away.
// An admin is un-made by pressing the same button again.
export function MemberActionsMenu({
  actions: {
    userId,
    name,
    isGuest,
    verified,
    bot,
    nameColor,
    canKick,
    canBan: canBanRoom,
    canPromote: canPromoteRoom,
    isAdmin,
    blockedReason,
  },
  onDone,
  // The phone's shell has a title bar of its own with a close button; the
  // anchored one is titled by the row it is pointing at.
  showHeader = false,
}: {
  actions: MemberActions;
  onDone: () => void;
  showHeader?: boolean;
}) {
  const t = useT();
  const [confirmingBan, setConfirmingBan] = useState(false);
  // In a group's voice room, admins and bans are the group's (see the API's
  // syncGroupRoomManagers) and the server refuses both from inside the room —
  // so neither button is offered there. Kicking out of the call still is.
  const room = useSignalingSelector(selectRoom);
  const inGroupRoom = isActiveGroupVoiceRoom(room);
  const canBan = canBanRoom && !inGroupRoom;
  const canPromote = canPromoteRoom && !inGroupRoom;

  return (
    <div className="flex w-72 max-w-[calc(100vw-1rem)] flex-col gap-3 rounded-xl bg-white p-4 text-zinc-900 shadow-lg dark:bg-zinc-950 dark:text-zinc-50">
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 text-sm font-semibold">
          <DisplayUserName name={name} isGuest={isGuest} verified={verified} bot={bot} color={nameColor} className="truncate" />
        </p>
        {showHeader && (
          <button
            type="button"
            onClick={onDone}
            aria-label={t("common.close")}
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
          {canPromote && (
            <button
              type="button"
              onClick={() => {
                if (isAdmin) signalingClient.removeRoomAdmin(userId);
                else signalingClient.addRoomAdmin(userId);
                onDone();
              }}
              className="flex items-center gap-2.5 rounded-lg border border-amber-300 px-3 py-2.5 text-left transition hover:bg-amber-50 dark:border-amber-900 dark:hover:bg-amber-950/40"
            >
              <FaCrown className="h-4 w-4 shrink-0 text-amber-500" />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-zinc-900 dark:text-zinc-100">
                  {isAdmin ? t("memberActionsModal.removeAdministrator") : t("memberActionsModal.makeAdministrator")}
                </span>
                <span className="block text-[11px] text-zinc-500 dark:text-zinc-400">
                  {isAdmin
                    ? t("memberActionsModal.goesBackToBeingAnOrdinary")
                    : t("memberActionsModal.canKickBanAndManageThe")}
                </span>
              </span>
            </button>
          )}
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
                <span className="block text-sm font-medium">{t("memberActionsModal.kickFromTheRoom")}</span>
                <span className="block text-[11px] text-zinc-500 dark:text-zinc-400">
                  {t("memberActionsModal.leavesNowButCanComeBack")}
                </span>
              </span>
            </button>
          )}

          {canBan &&
            (confirmingBan ? (
              <div className="rounded-lg border border-red-300 p-3 dark:border-red-900">
                <p className="text-xs leading-relaxed text-zinc-600 dark:text-zinc-300">
                  {t("memberActionsModal.banningRemoves")} {name} {t("memberActionsModal.fromTheRoomAndStopsThem")} <span className="font-medium">{t("common.bans")}</span> {t("memberActionsModal.tabOfManageRoom")}
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
                    {t("common.ban")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmingBan(false)}
                    className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-600 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-900"
                  >
                    {t("common.cancel")}
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
                    {t("memberActionsModal.banFromTheRoom")}
                  </span>
                  <span className="block text-[11px] text-zinc-500 dark:text-zinc-400">
                    {t("memberActionsModal.leavesNowAndCannotComeBack")}
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
