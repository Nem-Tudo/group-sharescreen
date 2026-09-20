"use client";

import { useState } from "react";
import { MdChatBubbleOutline } from "react-icons/md";
import { DisplayUserName } from "@/components/DisplayUserName";
import { UserAvatar } from "@/components/UserAvatar";
import { UserProfileDialog } from "@/components/UserProfileDialog";
import { useAuth } from "@/lib/AuthContext";
import { useDmLive } from "@/lib/dmLive";
import { messageSummary } from "@/lib/dmThread";
import { openDirectMessages } from "@/lib/dmWindow";
import { verifiedBadge } from "@/lib/entitlements";
import { useRecentConversations } from "@/lib/useRecentConversations";
import { useT } from "@/lib/useI18n";

// The last few conversations, at the top of the home page's friends panel.
//
// The header's faces (DmRecentStrip) say *who* is waiting; this says what
// they said. On the home page there is room for the line, and "quem me
// mandou mensagem?" answered by a row of avatars is a hover away from an
// answer — here it is already on the screen.
//
// Deliberately not the whole list: the messages window is the whole list, and
// a second copy of it beside the room form would be a page competing with the
// form somebody came here to fill in. Three rows and a way through.
//
// Nothing at all when there are no conversations — an empty "Mensagens" box
// over the friends list is a heading explaining that nothing is there.

/** How many conversations the block shows before "ver todas". */
const MAX_ROWS = 3;

export function HomeRecentMessages() {
  const t = useT();
  // Whose profile is open, if any. One dialog for the block rather than one
  // per row, as the panel below it and the room both do.
  const [profileId, setProfileId] = useState<string | null>(null);
  const { account } = useAuth();
  const live = useDmLive();
  const { rows, totalUnread } = useRecentConversations(MAX_ROWS);

  if (!account || rows.length === 0) return null;

  /** The props that turn a span inside the row into "abrir o perfil". */
  function profileOpener(userId: string) {
    const open = (e: { preventDefault: () => void; stopPropagation: () => void }) => {
      e.preventDefault();
      // Without this the row under it would open the conversation too.
      e.stopPropagation();
      setProfileId(userId);
    };
    return {
      role: "button",
      tabIndex: 0,
      title: t("common.viewProfile"),
      onClick: open,
      onKeyDown: (e: React.KeyboardEvent) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        open(e);
      },
    } as const;
  }

  return (
    <section className="mb-4 border-b border-black/5 pb-4 dark:border-white/5">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          {t("common.messages")}
          {totalUnread > 0 && (
            <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-emerald-500 px-1.5 text-[11px] font-semibold text-white">
              {totalUnread > 99 ? "99+" : totalUnread}
            </span>
          )}
        </h2>
        {/* Expanded, like the header's button: "todas" means the list beside
            the thread, not a thread on its own. */}
        <button
          type="button"
          onClick={() => openDirectMessages(null, { expanded: true })}
          className="shrink-0 cursor-pointer text-xs font-medium text-zinc-500 underline underline-offset-2 transition hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
        >
          {t("dmRecentStrip.allMessages")}
        </button>
      </div>

      <ul className="mt-3 flex flex-col gap-1.5">
        {rows.map(({ user, lastMessage, unread }) => {
          const typing = Boolean(live.typing[user.id]);
          const line =
            lastMessage.from === account.id
              ? t("directMessagesModal.youLine", { line: messageSummary(lastMessage) })
              : messageSummary(lastMessage);
          return (
            <li key={user.id}>
              <button
                type="button"
                onClick={() => openDirectMessages(user.id)}
                aria-label={t("common.chatWithDisplayname", { displayName: user.displayName })}
                className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg border border-zinc-200 bg-white px-2.5 py-2 text-left transition hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:bg-zinc-900"
              >
                {/* Spans rather than buttons: the row is already one, and a
                    button inside a button is not valid markup. The face and
                    the name open the profile; everything else on the row —
                    the message line, the empty space, the badge — opens the
                    conversation. Same split the messages window's own list
                    uses (see DirectMessagesModal). */}
                <span {...profileOpener(user.id)} className="shrink-0 cursor-pointer">
                  <UserAvatar
                    src={user.avatarUrl}
                    name={user.displayName}
                    size={32}
                    userId={user.id}
                    presenceSurface="page"
                  />
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    {...profileOpener(user.id)}
                    className="inline-block max-w-full cursor-pointer align-bottom hover:underline"
                  >
                    <DisplayUserName
                      name={user.displayName}
                      verified={verifiedBadge(user.flags)}
                      bot={user.bot}
                      color={user.nameColor}
                      className={`block truncate text-sm text-zinc-900 dark:text-zinc-100 ${
                        unread > 0 ? "font-semibold" : "font-medium"
                      }`}
                    />
                  </span>
                  {typing ? (
                    <span className="block truncate text-xs font-medium text-emerald-600 dark:text-emerald-400">
                      {t("directMessagesModal.typing")}
                    </span>
                  ) : (
                    <span
                      className={`block truncate text-xs ${
                        unread > 0
                          ? "font-medium text-zinc-800 dark:text-zinc-200"
                          : "text-zinc-500 dark:text-zinc-400"
                      }`}
                    >
                      {line}
                    </span>
                  )}
                </span>
                {unread > 0 ? (
                  <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500 px-1.5 text-[11px] font-semibold text-white">
                    {unread > 99 ? "99+" : unread}
                  </span>
                ) : (
                  <MdChatBubbleOutline className="h-4 w-4 shrink-0 text-zinc-400 dark:text-zinc-600" />
                )}
              </button>
            </li>
          );
        })}
      </ul>
      {/* Portalled to the body by the dialog itself, so the panel's own
          scrolling list never clips it. */}
      {profileId && <UserProfileDialog userId={profileId} onClose={() => setProfileId(null)} />}
    </section>
  );
}
