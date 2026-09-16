"use client";

import { useEffect, useMemo, useState } from "react";
import useNtPopups from "ntpopups";
import { MdCall, MdChatBubbleOutline, MdContentCopy, MdDoneAll, MdOpenInFull, MdPictureInPicture } from "react-icons/md";
import { Tooltip } from "@/components/Tooltip";
import { UserAvatar } from "@/components/UserAvatar";
import { useAuth } from "@/lib/AuthContext";
import { fetchConversations, type Conversation } from "@/lib/dmApi";
import { useDmLive } from "@/lib/dmLive";
import { liveConversationList, messageSummary } from "@/lib/dmThread";
import { openDirectMessages, useDirectMessagesWindow } from "@/lib/dmWindow";
import { selectDmReadSeq, selectDmSeq, selectRecentDms } from "@/lib/signalingSelectors";
import { useSignalingSelector } from "@/lib/useSignalingSelector";
import { useT, useTCount } from "@/lib/useI18n";
import { startCall } from "@/lib/callsApi";
import { copyText } from "@/lib/clipboard";
import { openContextMenu } from "@/lib/contextMenu";
import { markConversationRead } from "@/lib/dmApi";
import { avatarShapeClass } from "@/lib/avatarShape";

// The people this account talks to, one click from a group's top bar.
//
// A group is where somebody spends an evening, and a private message there
// used to be three clicks away behind the account menu. So the most recent
// conversations sit in the bar as faces — with their unread count and their
// "digitando" — and a click opens that thread straight away.
//
// How many faces depends on the room the bar has: none on a phone, where the
// bar is already full and the messages button alone stands in for them, and
// more as the screen widens. Classes rather than a measurement, because the
// group's own bar already measures itself (see lib/headerFit) and steps down
// when a call fills it — `compact` is that step, and hides the faces too.
//
// From lg up it stands where the group switcher used to (the groups are the
// column down the left there), so `leading` puts the messages button first,
// next to "início", with the faces reading outwards from it.

/** The most faces the bar ever shows. */
const MAX_FACES = 5;

/** How long after a nudge the list is re-read, so a burst is one request. */
const REFRESH_DEBOUNCE_MS = 800;

/** Which breakpoint each face appears from, by its position. */
const FACE_VISIBILITY = ["hidden sm:flex", "hidden sm:flex", "hidden md:flex", "hidden xl:flex", "hidden xl:flex"];

export function DmRecentStrip({ compact = false, leading = false }: { compact?: boolean; leading?: boolean }) {
  const t = useT();
  const tCount = useTCount();
  const { openPopup } = useNtPopups();
  const { account } = useAuth();
  const live = useDmLive();
  const recentDms = useSignalingSelector(selectRecentDms);
  const dmSeq = useSignalingSelector(selectDmSeq);
  const dmReadSeq = useSignalingSelector(selectDmReadSeq);
  const { open: windowOpen } = useDirectMessagesWindow();
  const [conversations, setConversations] = useState<Conversation[] | null>(null);

  // Re-read when a message arrives or leaves anywhere, when a conversation is
  // read on another device, and when the window closes — which is when this
  // account most likely just read something here.
  useEffect(() => {
    if (!account) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void fetchConversations(controller.signal).then((data) => {
        if (!controller.signal.aborted && data) setConversations(data.conversations);
      });
    }, REFRESH_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [account, dmSeq, dmReadSeq, windowOpen]);

  // What arrived since the read, laid over it, so the order moves the moment
  // a message lands rather than a beat later.
  const rows = useMemo(
    () =>
      conversations && account
        ? liveConversationList(conversations, recentDms, account.id).slice(0, MAX_FACES)
        : [],
    [conversations, recentDms, account]
  );

  if (!account) return null;

  const totalUnread = (conversations ?? []).reduce((total, c) => total + c.unread, 0);

  /**
   * Rings `userId`, and says why if it could not — blocked, rate-limited,
   * "recebendo outras chamadas agora". A popup rather than an inline error
   * (as DirectMessagesModal's own call button uses) because this strip has no
   * composer of its own to show one on: this button rings without opening the
   * conversation at all. `startCall` used to be fired here without ever
   * looking at what it returned, unlike every other caller of it in the app.
   */
  async function placeCall(userId: string) {
    const result = await startCall(userId);
    if (!result.ok) {
      void openPopup("generic", { data: { title: t("common.couldNotCall"), message: result.error } });
    }
  }

  const allMessages = (
    <Tooltip content={t("dmRecentStrip.allMessages")} placement="bottom">
      <button
        type="button"
        // Everything at once is what full screen is for: the conversations
        // beside the thread, beside the groups.
        onClick={() => openDirectMessages(null, { expanded: true })}
        onContextMenu={(e) =>
          openContextMenu(e, {
            entries: [
              {
                label: t("directMessagesModal.expand"),
                icon: <MdOpenInFull className="h-4 w-4" />,
                onSelect: () => openDirectMessages(null, { expanded: true }),
              },
              {
                label: t("dmMenu.openInWindow"),
                icon: <MdPictureInPicture className="h-4 w-4" />,
                onSelect: () => openDirectMessages(null, { expanded: false }),
              },
            ],
          })
        }
        aria-label={t("dmRecentStrip.allMessages")}
        className="relative shrink-0 cursor-pointer rounded-lg p-2 text-zinc-500 transition hover:bg-zinc-200/60 hover:text-zinc-950 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-50"
      >
        <MdChatBubbleOutline className="h-5 w-5" />
        {totalUnread > 0 && (
          <span
            aria-hidden
            className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-emerald-500 px-1 text-[10px] font-semibold leading-none text-white ring-2 ring-white dark:ring-zinc-950"
          >
            {totalUnread > 99 ? "99+" : totalUnread}
          </span>
        )}
      </button>
    </Tooltip>
  );

  return (
    <div role="group" className="flex shrink-0 items-center gap-1" aria-label={t("dmRecentStrip.recentConversations")}>
      {leading && allMessages}
      {!compact &&
        rows.map((conversation, index) => {
          const { user, lastMessage, unread } = conversation;
          const typing = Boolean(live.typing[user.id]);
          const line = typing
            ? t("directMessagesModal.typing")
            : lastMessage.from === account.id
              ? t("directMessagesModal.youLine", { line: messageSummary(lastMessage) })
              : messageSummary(lastMessage);
          return (
            <Tooltip
              key={user.id}
              placement="bottom"
              content={
                <span className="block max-w-56">
                  <span className="block font-semibold">{user.displayName}</span>
                  <span className="block truncate opacity-80">{line}</span>
                  {unread > 0 && (
                    <span className="block font-medium text-emerald-300">
                      {tCount("dmRecentStrip.unread", unread)}
                    </span>
                  )}
                </span>
              }
            >
              <button
                type="button"
                onClick={() => openDirectMessages(user.id)}
                onContextMenu={(e) =>
                  openContextMenu(e, {
                    title: user.displayName,
                    entries: [
                      {
                        label: t("dmMenu.openConversation"),
                        icon: <MdChatBubbleOutline className="h-4 w-4" />,
                        onSelect: () => openDirectMessages(user.id),
                      },
                      {
                        label: t("common.callDisplayname", { displayName: user.displayName }),
                        icon: <MdCall className="h-4 w-4" />,
                        onSelect: () => void placeCall(user.id),
                      },
                      {
                        label: t("groups.groupRail.markAsRead"),
                        icon: <MdDoneAll className="h-4 w-4" />,
                        disabled: unread === 0,
                        onSelect: () => {
                          markConversationRead(user.id);
                          setConversations((current) =>
                            current?.map((c) => (c.user.id === user.id ? { ...c, unread: 0 } : c)) ?? current
                          );
                        },
                      },
                      { type: "divider" },
                      {
                        label: t("groups.memberMenu.copyId"),
                        icon: <MdContentCopy className="h-4 w-4" />,
                        onSelect: () => void copyText(user.id),
                      },
                    ],
                  })
                }
                aria-label={t("common.chatWithDisplayname", { displayName: user.displayName })}
                className={`${FACE_VISIBILITY[index]} relative shrink-0 cursor-pointer items-center justify-center ${avatarShapeClass(user.avatarUrl)} p-0.5 transition hover:bg-zinc-200/60 dark:hover:bg-zinc-900`}
              >
                <UserAvatar
                  src={user.avatarUrl}
                  name={user.displayName}
                  size={30}
                  userId={user.id}
                  presenceSurface="page"
                />
                {unread > 0 && (
                  <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-emerald-500 px-1 text-[10px] font-semibold leading-none text-white ring-2 ring-white dark:ring-zinc-950">
                    {unread > 9 ? "9+" : unread}
                  </span>
                )}
                {typing && (
                  // Their "digitando", as the dots their bubble would show.
                  <span
                    aria-hidden
                    className="absolute -bottom-1 left-1/2 flex -translate-x-1/2 items-center gap-0.5 rounded-full bg-emerald-500 px-1 py-[3px] ring-2 ring-white dark:ring-zinc-950"
                  >
                    {[0, 150, 300].map((delay) => (
                      <span
                        key={delay}
                        className="h-1 w-1 animate-bounce rounded-full bg-white"
                        style={{ animationDelay: `${delay}ms` }}
                      />
                    ))}
                  </span>
                )}
              </button>
            </Tooltip>
          );
        })}
      {!leading && allMessages}
    </div>
  );
}
