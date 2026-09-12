"use client";

import { useState } from "react";
import {
  MdCallMissed,
  MdCardGiftcard,
  MdChatBubbleOutline,
  MdFavorite,
  MdNotificationsNone,
  MdPersonAdd,
} from "react-icons/md";
import { useNotifications } from "@/lib/useNotifications";
import { FriendRequestsModal } from "@/components/FriendRequestsModal";
import { openDirectMessages } from "@/lib/dmWindow";
import { Popover } from "@/components/Tooltip";
import {
  clearNotifications,
  markAllRead,
  useNotificationInbox,
  type InboxNotification,
} from "@/lib/notificationInbox";
import { useT } from "@/lib/useI18n";

// The bell, and what is behind it.
//
// Deliberately not the same control as components/NotificationBell, which
// looks almost identical and does something else entirely: that one manages
// the browser *permission* to show system notifications. This one is the list
// of what happened. They sit at different ends of the same idea and merging
// them would give one button two unrelated jobs — "let us interrupt you" and
// "what did we interrupt you about".

function relativeTime(ts: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (seconds < 60) return "agora";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h`;
  return `${Math.round(hours / 24)} d`;
}

function Item({
  notification,
  onOpen,
}: {
  notification: InboxNotification;
  onOpen: (notification: InboxNotification) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(notification)}
      className={`flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left transition hover:bg-zinc-100 dark:hover:bg-zinc-900 ${
        notification.read ? "" : "bg-zinc-50 dark:bg-zinc-900/60"
      }`}
    >
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">
        {notification.kind === "dm" ? (
          <MdChatBubbleOutline className="h-4 w-4" />
        ) : notification.kind === "call-missed" ? (
          // The one row here that is red. A missed call is the only thing in
          // this list somebody was actively waiting on an answer to.
          <MdCallMissed className="h-4 w-4 text-red-500" />
        ) : notification.kind === "gift" ? (
          // The only good news in the list, and coloured like it — this is
          // somebody having spent money on the person reading it.
          <MdCardGiftcard className="h-4 w-4 text-emerald-500" />
        ) : notification.kind === "theme-like" ? (
          <MdFavorite className="h-4 w-4 text-pink-500" />
        ) : (
          <MdPersonAdd className="h-4 w-4" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-zinc-900 dark:text-zinc-100">
          {notification.title}
        </span>
        {notification.body && (
          <span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">
            {notification.body}
          </span>
        )}
      </span>
      <span className="shrink-0 text-[11px] text-zinc-400 dark:text-zinc-600">
        {relativeTime(notification.ts)}
      </span>
    </button>
  );
}

export function NotificationInboxBell({ className = "" }: { className?: string }) {
  const t = useT();
  const items = useNotificationInbox();
  const [open, setOpen] = useState(false);
  // Opened from a notification instead of navigating to /friends. Inside a
  // room, navigating would end the call to answer two buttons — see
  // FriendRequestsModal.
  const [requestsOpen, setRequestsOpen] = useState(false);
  const unread = items.filter((item) => !item.read).length;
  const { supported, permission, enable } = useNotifications();

  return (
    <>
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      placement="bottom-end"
      tooltip={t("common.notifications")}
      content={
        <div className="flex max-h-[70vh] w-80 max-w-[calc(100vw-1rem)] flex-col rounded-xl border border-zinc-200 bg-white p-2 shadow-2xl dark:border-zinc-800 dark:bg-zinc-950">
          <div className="flex items-center justify-between px-1 pb-1">
            <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{t("common.notifications")}</p>
            {items.length > 0 && (
              <button
                type="button"
                onClick={clearNotifications}
                className="text-xs font-medium text-zinc-500 underline-offset-2 transition hover:underline dark:text-zinc-400"
              >
                {t("notificationInboxBell.clear")}
              </button>
            )}
          </div>
          {/* The one place on every page where notifications can actually be
              turned on.
              The permission toggle used to live only in a room's chat header
              (components/NotificationBell), which meant somebody who never
              opened a room never had the chance to say yes — and being
              notified with the app closed is worth most precisely to the
              people who are *not* in a room. Shown only while there is
              something to gain by pressing it: absent once permission is
              granted, and absent where the browser blocked it, since that is
              undone in site settings and not here.

              This is also what registers the device for push, because asking
              is only allowed inside a user gesture and this is the gesture —
              see lib/useNotifications.ts's enable. */}
          {supported && permission === "default" && (
            <button
              type="button"
              onClick={() => void enable()}
              className="mb-1 flex w-full items-center gap-2 rounded-lg bg-zinc-100 px-2 py-2 text-left text-xs font-medium text-zinc-700 transition hover:bg-zinc-200 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              <MdNotificationsNone className="h-4 w-4 shrink-0" />
              {t("notificationInboxBell.turnOnNotificationsOnThisDevice")}
            </button>
          )}
          {items.length === 0 ? (
            <p className="px-2 py-6 text-center text-sm text-zinc-500 dark:text-zinc-400">
              {t("notificationInboxBell.nothingHereYet")}
            </p>
          ) : (
            <div className="flex flex-col gap-0.5 overflow-y-auto">
              {items.map((item) => (
                <Item
                  key={item.id}
                  notification={item}
                  onOpen={(notification) => {
                    setOpen(false);
                    if (notification.kind === "friend-request") setRequestsOpen(true);
                    // A missed call opens the conversation rather than calling
                    // back: the bell is read long after the fact, and a click
                    // that starts ringing somebody's phone is not what
                    // "ver o que perdi" should do. It is also where the push
                    // notification for the same event lands (see the API's
                    // pushCallEnded), so the two agree.
                    else if (notification.kind === "dm" || notification.kind === "call-missed") {
                      openDirectMessages(notification.userId);
                    }
                  }}
                />
              ))}
            </div>
          )}
        </div>
      }
    >
      <button
        type="button"
        onClick={() => {
          // Marked read on *open*, not on click-through: opening the panel is
          // the moment they were read, and requiring a click on each one would
          // leave the dot up for things already seen.
          if (!open) markAllRead();
          setOpen((current) => !current);
        }}
        aria-label={unread > 0 ? t("notificationInboxBell.notificationsUnreadUnread", { unread }) : t("common.notifications")}
        className={`relative shrink-0 rounded-lg p-2 text-zinc-500 transition hover:bg-zinc-200/60 hover:text-zinc-950 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-50 ${className}`}
      >
        <MdNotificationsNone className="h-5 w-5" />
        {unread > 0 && (
          // Ring in the page's background colour so the dot reads as separate
          // from the bell rather than as part of the glyph.
          <span
            aria-hidden
            className="absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full bg-red-500 ring-2 ring-white dark:ring-zinc-950"
          />
        )}
      </button>
    </Popover>
    <FriendRequestsModal open={requestsOpen} onClose={() => setRequestsOpen(false)} />
    </>
  );
}
