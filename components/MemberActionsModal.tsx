"use client";

import { useState, type ReactNode } from "react";
import { MdBlock, MdCheck, MdChatBubbleOutline, MdPersonOutline, MdPersonRemove } from "react-icons/md";
import { FaCrown } from "react-icons/fa";
import { signalingClient } from "@/lib/signalingClient";
import { useSignalingSelector } from "@/lib/useSignalingSelector";
import { selectRoom } from "@/lib/signalingSelectors";
import { isActiveGroupVoiceRoom } from "@/lib/groupVoiceSession";
import { DisplayUserName } from "./DisplayUserName";
import { UserAvatar } from "./UserAvatar";
import { VolumeSlider } from "./VolumeSlider";
import type { VerifiedTone } from "@/lib/entitlements";
import { useT } from "@/lib/useI18n";

// Same look as the group's member menu (see GroupMemberActions.tsx) — one
// person opens one kind of menu, wherever they're found, so it never reads as
// two different products bolted together.
const menuItem =
  "flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm text-zinc-700 transition hover:bg-zinc-100 disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent dark:text-zinc-200 dark:hover:bg-zinc-900";
const dangerItem =
  "flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm text-red-600 transition hover:bg-red-500/10 dark:text-red-400";
const menuIcon = "h-4 w-4 shrink-0 opacity-70";

function MenuDivider() {
  return <div className="my-1 border-t border-zinc-200 dark:border-zinc-800" />;
}

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
  avatarUrl?: string | null;
  isOwner?: boolean;
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
  // The everyday actions, offered to whoever opens the menu regardless of
  // whether they run the room — unlike promote/kick/ban below, which are the
  // room's own business. Absent where there is nothing to do (this is your
  // own row, or the caller has nowhere to put a profile/DM).
  onOpenProfile?: () => void;
  onSendMessage?: () => void;
  // This listener's own dial for them — never sent anywhere, just how loud
  // they play locally. Omitted where there is no audio to turn down (your own
  // row, or a peer this client isn't receiving audio from).
  volume?: number;
  muted?: boolean;
  onVolumeChange?: (volume: number) => void;
  onToggleMute?: () => void;
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
    avatarUrl,
    isOwner,
    canKick,
    canBan: canBanRoom,
    canPromote: canPromoteRoom,
    isAdmin,
    blockedReason,
    onOpenProfile,
    onSendMessage,
    volume,
    muted,
    onVolumeChange,
    onToggleMute,
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

  let body: ReactNode;
  if (confirmingBan) {
    body = (
      <div className="flex flex-col gap-2 p-1.5">
        <p className="text-sm text-zinc-700 dark:text-zinc-200">
          {t("memberActionsModal.banningRemoves")} {name} {t("memberActionsModal.fromTheRoomAndStopsThem")}{" "}
          <span className="font-medium">{t("common.bans")}</span> {t("memberActionsModal.tabOfManageRoom")}
        </p>
        <div className="flex justify-end gap-1.5">
          <button
            type="button"
            onClick={() => setConfirmingBan(false)}
            className="cursor-pointer rounded-lg px-2.5 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            onClick={() => {
              signalingClient.banMember(userId);
              onDone();
            }}
            className="cursor-pointer rounded-lg bg-red-600 px-2.5 py-1 text-xs font-semibold text-white transition hover:bg-red-700"
          >
            {t("common.ban")}
          </button>
        </div>
      </div>
    );
  } else {
    body = (
      <>
        {onOpenProfile && (
          <button
            type="button"
            onClick={() => {
              onOpenProfile();
              onDone();
            }}
            className={menuItem}
          >
            <MdPersonOutline className={menuIcon} />
            {t("common.viewProfile")}
          </button>
        )}
        {onSendMessage && (
          <button
            type="button"
            onClick={() => {
              onSendMessage();
              onDone();
            }}
            className={menuItem}
          >
            <MdChatBubbleOutline className={menuIcon} />
            {t("groups.memberMenu.sendMessage")}
          </button>
        )}

        {onVolumeChange && (
          <>
            <MenuDivider />
            <p className="px-2 pb-0.5 pt-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              {t("groups.memberMenu.userVolume")}
            </p>
            <div className="px-2 py-1">
              <VolumeSlider
                value={volume ?? 1}
                label={t("common.nameSAudioVolume", { name })}
                onChange={onVolumeChange}
                muted={muted}
                onToggleMute={onToggleMute}
                className="w-full text-zinc-500 dark:text-zinc-400"
              />
            </div>
            {onToggleMute && (
              <button type="button" role="menuitemcheckbox" aria-checked={muted} onClick={onToggleMute} className={menuItem}>
                <span
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                    muted ? "border-emerald-500 bg-emerald-500 text-white" : "border-zinc-300 dark:border-zinc-600"
                  }`}
                >
                  {muted && <MdCheck className="h-3 w-3" />}
                </span>
                {t("groups.memberMenu.muteForMe")}
              </button>
            )}
          </>
        )}

        {(canPromote || canKick || canBan) && (
          <>
            <MenuDivider />
            {canPromote && (
              <button
                type="button"
                onClick={() => {
                  if (isAdmin) signalingClient.removeRoomAdmin(userId);
                  else signalingClient.addRoomAdmin(userId);
                  onDone();
                }}
                className={menuItem}
              >
                <FaCrown className={`${menuIcon} text-amber-500 opacity-100`} />
                {isAdmin ? t("memberActionsModal.removeAdministrator") : t("memberActionsModal.makeAdministrator")}
              </button>
            )}
            {canKick && (
              <button
                type="button"
                onClick={() => {
                  signalingClient.kickMember(userId);
                  onDone();
                }}
                className={dangerItem}
              >
                <MdPersonRemove className="h-4 w-4 shrink-0" />
                {t("memberActionsModal.kickFromTheRoom")}
              </button>
            )}
            {canBan && (
              <button type="button" onClick={() => setConfirmingBan(true)} className={dangerItem}>
                <MdBlock className="h-4 w-4 shrink-0" />
                {t("memberActionsModal.banFromTheRoom")}
              </button>
            )}
          </>
        )}

        {blockedReason && <p className="px-2 pt-1 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">{blockedReason}</p>}
      </>
    );
  }

  return (
    <div
      role="menu"
      className="flex w-60 flex-col gap-0.5 rounded-xl border border-zinc-200 bg-white p-1.5 shadow-xl dark:border-zinc-800 dark:bg-zinc-950"
    >
      <div className="flex min-w-0 items-center gap-2 px-2 pb-1.5 pt-1">
        <UserAvatar src={avatarUrl} name={name} size={28} userId={isGuest ? null : userId} isGuest={isGuest} />
        <DisplayUserName
          name={name}
          isGuest={isGuest}
          verified={verified}
          bot={bot}
          color={nameColor}
          className="min-w-0 truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100"
        />
        {isOwner && <FaCrown className="h-3 w-3 shrink-0 text-amber-500" aria-label={t("common.owner")} />}
        {showHeader && (
          <button
            type="button"
            onClick={onDone}
            aria-label={t("common.close")}
            className="-mr-1 ml-auto flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-lg leading-none opacity-60 transition hover:bg-black/10 hover:opacity-100 dark:hover:bg-white/10"
          >
            ×
          </button>
        )}
      </div>
      {body}
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
