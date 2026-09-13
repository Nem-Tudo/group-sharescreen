"use client";

import { useState } from "react";
import useNtPopups from "ntpopups";
import {
  MdArrowBack,
  MdChatBubbleOutline,
  MdContentCopy,
  MdLink,
  MdMoreVert,
  MdPeopleOutline,
  MdPersonAdd,
  MdSettings,
  MdShare,
  MdVolumeUp,
} from "react-icons/md";
import { MobileSheet } from "@/components/MobileSheet";
import { NotificationInboxBell } from "@/components/NotificationInboxBell";
import { GroupIcon } from "@/components/groups/GroupIcon";
import { GroupName } from "@/components/groups/GroupName";
import { GroupSwitcher } from "@/components/groups/GroupSwitcher";
import { GroupActions, GroupRoomsPanel } from "@/components/groups/GroupSidebar";
import { useOpenChannelSettings } from "@/components/groups/ChannelSettingsDialog";
import { copyText } from "@/lib/clipboard";
import { groupPath, type GroupsRoute } from "@/lib/groupLinks";
import { useGroupNavigation } from "@/lib/groupNavigation";
import { canManage } from "@/lib/groupPermissions";
import type { GroupChannel, GroupDetail } from "@/lib/groupsApi";
import { canShareNatively, haptic, shareLink } from "@/lib/nativeApp";
import { useT, useTCount } from "@/lib/useI18n";

// The groups on a phone, laid out the way a chat app is: a screen per level.
//
//   /groups            your groups (GroupsHome), with the bottom tabs
//   /groups/:id        the group's rooms, as the page itself (GroupMobileHome)
//   /groups/:id/:room  the room, full screen, with a back arrow to the rooms
//
// On a desktop /groups/:id goes straight on to the room last opened, because
// the rooms are a column beside it there. On a phone that column is this
// page, and jumping past it meant the only way to another room was a drawer
// behind a button.

const barButton =
  "flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-full text-zinc-700 transition active:bg-zinc-200 dark:text-zinc-300 dark:active:bg-zinc-800";

/**
 * The group shell's top bar below lg: a back arrow and where you are, and the
 * few things that belong up there. The call's own buttons are portalled into
 * `rightSlot` by the room, as on the desktop bar.
 */
export function GroupMobileBar({
  route,
  detail,
  channel,
  setRightSlot,
  setCenterSlot,
  onOpenMembers,
}: {
  route: GroupsRoute | null;
  detail: GroupDetail | null;
  channel: GroupChannel | null;
  setRightSlot: (el: HTMLDivElement | null) => void;
  setCenterSlot: (el: HTMLDivElement | null) => void;
  onOpenMembers: () => void;
}) {
  const t = useT();
  const navigation = useGroupNavigation();
  const [roomMenu, setRoomMenu] = useState(false);
  const kind = route?.kind ?? "home";
  const groupId = route && route.kind !== "home" ? route.groupId : null;

  const back = () => {
    haptic("tap");
    if (kind === "room" && groupId) navigation.push(groupPath(groupId));
    else navigation.push("/groups");
  };

  return (
    <div className="flex h-12 items-center gap-1">
      {kind !== "home" && (
        <button type="button" onClick={back} aria-label={t("common.back")} className={`${barButton} -ml-1.5`}>
          <MdArrowBack className="h-6 w-6" />
        </button>
      )}

      <div className="flex min-w-0 flex-1 items-center gap-2">
        {kind === "home" ? (
          <h1 className="truncate px-1 text-lg font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
            {t("common.groups")}
          </h1>
        ) : kind === "group" ? (
          <GroupSwitcher
            activeGroupId={groupId}
            fallbackName={detail?.group.name}
            fallbackIconUrl={detail?.group.iconUrl}
            fallbackFlags={detail?.group.flags}
          />
        ) : (
          <div className="flex min-w-0 items-center gap-2">
            {channel?.kind === "voice" ? (
              <MdVolumeUp className="h-5 w-5 shrink-0 text-emerald-600" />
            ) : (
              <MdChatBubbleOutline className="h-5 w-5 shrink-0 text-zinc-500" />
            )}
            <div className="min-w-0">
              <p className="truncate text-[15px] font-semibold leading-tight text-zinc-950 dark:text-zinc-50">
                {channel?.name ?? t("common.room")}
              </p>
              {detail && (
                <p className="truncate text-xs leading-tight text-zinc-500 dark:text-zinc-400">{detail.group.name}</p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Kept for the room to portal into, as on the desktop bar; the
          controls themselves are the bottom bar on a phone (see WatchRoom). */}
      <div ref={setCenterSlot} className="hidden" />

      <div className="flex shrink-0 items-center gap-0.5">
        <div ref={setRightSlot} className="contents" />
        {kind === "room" && channel?.kind === "text" && detail && (
          <>
            <button type="button" onClick={onOpenMembers} aria-label={t("common.members")} className={barButton}>
              <MdPeopleOutline className="h-6 w-6" />
            </button>
            <button
              type="button"
              onClick={() => setRoomMenu(true)}
              aria-label={t("mobile.roomOptions")}
              className={barButton}
            >
              <MdMoreVert className="h-6 w-6" />
            </button>
            <RoomOptionsSheet
              open={roomMenu}
              onClose={() => setRoomMenu(false)}
              detail={detail}
              channel={channel}
              onOpenMembers={onOpenMembers}
            />
          </>
        )}
        {kind === "group" && detail && <GroupActions detail={detail} />}
        {kind !== "room" && <NotificationInboxBell />}
      </div>
    </div>
  );
}

/** A text room's own menu — what right-clicking its title does on a desktop. */
function RoomOptionsSheet({
  open,
  onClose,
  detail,
  channel,
  onOpenMembers,
}: {
  open: boolean;
  onClose: () => void;
  detail: GroupDetail;
  channel: GroupChannel;
  onOpenMembers: () => void;
}) {
  const t = useT();
  const openChannelSettings = useOpenChannelSettings();
  const groupId = detail.group.id;
  const link = typeof window === "undefined" ? "" : `${window.location.origin}/groups/${groupId}/${channel.id}`;
  const act = (fn: () => void) => () => {
    onClose();
    fn();
  };
  return (
    <MobileSheet open={open} onClose={onClose} title={channel.name}>
      <div className="flex flex-col pb-1">
        {canShareNatively() && (
          <SheetRow
            icon={MdShare}
            label={t("mobile.share")}
            onClick={act(() => void shareLink({ title: channel.name, url: link }))}
          />
        )}
        <SheetRow icon={MdLink} label={t("groups.groupRail.copyLink")} onClick={act(() => void copyText(link))} />
        <SheetRow icon={MdContentCopy} label={t("groups.memberMenu.copyId")} onClick={act(() => void copyText(channel.id))} />
        <SheetRow icon={MdPeopleOutline} label={t("groups.textChannelView.groupMembers")} onClick={act(onOpenMembers)} />
        {canManage(detail, "manageChannels") && (
          <SheetRow
            icon={MdSettings}
            label={t("groups.groupSidebar.roomSettings")}
            onClick={act(() => openChannelSettings(groupId, channel.id))}
          />
        )}
      </div>
    </MobileSheet>
  );
}

function SheetRow({
  icon: Icon,
  label,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full cursor-pointer items-center gap-3 rounded-xl px-3 py-3 text-left text-[15px] font-medium text-zinc-800 transition active:bg-zinc-100 dark:text-zinc-200 dark:active:bg-zinc-900"
    >
      <Icon className="h-5 w-5 shrink-0 opacity-75" />
      {label}
    </button>
  );
}

/**
 * /groups/:id on a phone: the group, and its rooms as the page. Tapping a room
 * opens it full screen; the back arrow there returns here.
 */
export function GroupMobileHome({ detail, onOpenMembers }: { detail: GroupDetail; onOpenMembers: () => void }) {
  const t = useT();
  const tc = useTCount();
  const { openPopup } = useNtPopups();
  const { group } = detail;
  const canInvite = canManage(detail, "createInvites");
  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
      <div className="flex flex-col gap-3 p-3">
        <section className="flex items-center gap-3 rounded-2xl border border-zinc-200 bg-white p-3.5 dark:border-zinc-800 dark:bg-zinc-950">
          <GroupIcon name={group.name} iconUrl={group.iconUrl} seed={group.id} size={52} className="rounded-2xl" />
          <div className="min-w-0 flex-1">
            <GroupName
              name={group.name}
              flags={group.flags}
              className="flex w-full text-base font-semibold text-zinc-950 dark:text-zinc-50"
            />
            {group.description && (
              <p className="line-clamp-2 text-sm text-zinc-600 dark:text-zinc-400">{group.description}</p>
            )}
            <p className="text-xs text-zinc-500 dark:text-zinc-400">{tc("mobile.memberCount", group.memberCount)}</p>
          </div>
        </section>

        <div className="grid grid-cols-2 gap-2">
          {canInvite && (
            <button
              type="button"
              onClick={() => void openPopup("group_invite", { data: { groupId: group.id, groupName: group.name } })}
              className="flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-3 py-2.5 text-sm font-semibold text-white transition active:scale-[0.98]"
            >
              <MdPersonAdd className="h-5 w-5" />
              {t("groups.groupSidebar.invite")}
            </button>
          )}
          <button
            type="button"
            onClick={onOpenMembers}
            className={`flex items-center justify-center gap-2 rounded-xl border border-zinc-300 bg-white px-3 py-2.5 text-sm font-semibold text-zinc-800 transition active:scale-[0.98] dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200 ${
              canInvite ? "" : "col-span-2"
            }`}
          >
            <MdPeopleOutline className="h-5 w-5" />
            {t("common.members")}
          </button>
        </div>

        <section className="rounded-2xl border border-zinc-200 bg-white p-2 dark:border-zinc-800 dark:bg-zinc-950">
          <GroupRoomsPanel bare detail={detail} activeChannelId={null} />
        </section>
      </div>
    </div>
  );
}
