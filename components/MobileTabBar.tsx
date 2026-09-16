"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ComponentType, type ReactNode } from "react";
import {
  MdChatBubble,
  MdChatBubbleOutline,
  MdExplore,
  MdGroups,
  MdHome,
  MdOutlineExplore,
  MdOutlineGroups,
  MdOutlineHome,
} from "react-icons/md";
import { DEFAULT_AVATAR_PATH } from "@/components/UserAvatar";
import { useAuth } from "@/lib/AuthContext";
import { openDirectMessages, useDirectMessagesWindow } from "@/lib/dmWindow";
import { haptic } from "@/lib/nativeApp";
import { isTabBarRoute, useDmUnreadTotal, useSoftKeyboardOpen, useTabBarEnabled } from "@/lib/mobileShell";
import { LG_BREAKPOINT_QUERY, useMediaQuery } from "@/lib/useMediaQuery";
import { refreshGroups, useGroupsSlice } from "@/lib/useGroups";
import { useSignalingSelector, shallow } from "@/lib/useSignalingSelector";
import { selectNameSlice } from "@/lib/signalingSelectors";
import { useT } from "@/lib/useI18n";
import { avatarShapeClass } from "@/lib/avatarShape";

// The app's bottom tabs, below lg — see lib/mobileShell for which screens show
// them and why the desktop app never does.
//
// Two things on screen, on purpose: the bar itself, pinned to the bottom, and
// a spacer of the same height in the page's own flow. The spacer is what keeps
// the end of a scrolling page from sitting under the bar, and what gives the
// fixed-height screens (the groups) their last 64px back — both without any
// page having to know the bar exists.

const TAB_HEIGHT = "h-16";

export function MobileTabBar() {
  const pathname = usePathname();
  const enabled = useTabBarEnabled();
  const wide = useMediaQuery(LG_BREAKPOINT_QUERY);
  const keyboard = useSoftKeyboardOpen();
  const onRoute = enabled && isTabBarRoute(pathname);
  const visible = onRoute && !keyboard;

  // Read by app/globals.css, which lifts what else floats at the bottom of
  // the screen (the call bar, the install prompt) above the tabs.
  useEffect(() => {
    const root = document.documentElement;
    if (visible) root.dataset.tabbar = "";
    else delete root.dataset.tabbar;
    return () => {
      delete root.dataset.tabbar;
    };
  }, [visible]);

  if (!visible) return null;
  return (
    <>
      <div aria-hidden className={`${TAB_HEIGHT} shrink-0 pb-[env(safe-area-inset-bottom)] lg:hidden`} />
      <TabBar pathname={pathname ?? "/"} counting={!wide} />
    </>
  );
}

function TabBar({ pathname, counting }: { pathname: string; counting: boolean }) {
  const t = useT();
  const router = useRouter();
  const { account } = useAuth();
  const state = useSignalingSelector(selectNameSlice, shallow);
  const dmWindow = useDirectMessagesWindow();
  const dmUnread = useDmUnreadTotal(counting);
  // Read without asking on a wide screen, where the bar is not drawn.
  const groups = useGroupsSlice((s) => s.groups, null);
  useEffect(() => {
    if (counting && groups === null) void refreshGroups();
  }, [counting, groups]);
  const groupMentions = (groups ?? []).reduce((sum, g) => sum + (g.suspended ? 0 : g.mentions), 0);
  const groupUnread = (groups ?? []).some((g) => !g.suspended && g.unread);

  const path = pathname.replace(/\/+$/, "") || "/";
  const onGroups = path === "/groups" || path.startsWith("/groups/");
  const active = {
    home: path === "/" && !dmWindow.open,
    rooms: (path === "/rooms" || path === "/worldmap") && !dmWindow.open,
    groups: onGroups && !dmWindow.open,
    messages: dmWindow.open,
    me: (path === "/me" || path === "/friends") && !dmWindow.open,
  };

  const avatar = account?.avatarUrl || DEFAULT_AVATAR_PATH;
  const name = account?.displayName ?? state.name ?? "";

  return (
    <nav
      aria-label={t("mobile.tabs")}
      className="fixed inset-x-0 bottom-0 z-40 select-none border-t border-black/10 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden dark:border-white/10 dark:bg-zinc-950/95"
    >
      <ul className={`mx-auto flex ${TAB_HEIGHT} max-w-lg items-stretch`}>
        <Tab href="/" label={t("common.home")} active={active.home} icon={MdOutlineHome} activeIcon={MdHome} />
        <Tab href="/rooms" label={t("common.rooms")} active={active.rooms} icon={MdOutlineExplore} activeIcon={MdExplore} />
        <Tab
          href="/groups"
          label={t("common.groups")}
          active={active.groups}
          icon={MdOutlineGroups}
          activeIcon={MdGroups}
          badge={groupMentions > 0 ? groupMentions : groupUnread ? "dot" : null}
        />
        <Tab
          label={t("mobile.chats")}
          active={active.messages}
          icon={MdChatBubbleOutline}
          activeIcon={MdChatBubble}
          badge={dmUnread > 0 ? dmUnread : null}
          badgeTone="emerald"
          // Conversations belong to an account: without one, the Você screen
          // is where one is made.
          onPress={() => (account ? openDirectMessages(null) : router.push("/me"))}
        />
        <Tab
          href="/me"
          label={t("mobile.you")}
          active={active.me}
          custom={
            <span
              className={`flex h-7 w-7 items-center justify-center overflow-hidden ${avatarShapeClass(avatar)} ring-2 transition ${
                active.me ? "ring-zinc-950 dark:ring-zinc-50" : "ring-transparent"
              }`}
            >
              {name ? (
                // eslint-disable-next-line @next/next/no-img-element -- a 28px avatar from any host
                <img src={avatar} alt="" className={`h-6 w-6 ${avatarShapeClass(avatar)} object-cover`} />
              ) : (
                <span className="h-6 w-6 rounded-full bg-zinc-300 dark:bg-zinc-700" />
              )}
            </span>
          }
        />
      </ul>
    </nav>
  );
}

function Tab({
  href,
  onPress,
  label,
  active,
  icon: Icon,
  activeIcon: ActiveIcon,
  custom,
  badge = null,
  badgeTone = "red",
}: {
  href?: string;
  onPress?: () => void;
  label: string;
  active: boolean;
  icon?: ComponentType<{ className?: string }>;
  activeIcon?: ComponentType<{ className?: string }>;
  custom?: ReactNode;
  badge?: number | "dot" | null;
  badgeTone?: "red" | "emerald";
}) {
  const Shown = active ? ActiveIcon ?? Icon : Icon;
  const tone = badgeTone === "emerald" ? "bg-emerald-500" : "bg-red-600";
  const inner = (
    <>
      <span
        className={`relative flex h-8 w-14 items-center justify-center rounded-full transition-colors ${
          active && !custom ? "bg-zinc-200/80 dark:bg-zinc-800" : ""
        }`}
      >
        {custom ?? (Shown && <Shown className="h-6 w-6" />)}
        {badge === "dot" ? (
          <span className={`absolute right-2.5 top-1 h-2.5 w-2.5 rounded-full ${tone} ring-2 ring-white dark:ring-zinc-950`} />
        ) : badge ? (
          <span
            className={`absolute right-1 -top-0.5 flex h-[1.125rem] min-w-[1.125rem] items-center justify-center rounded-full px-1 text-[10px] font-bold leading-none text-white ring-2 ring-white dark:ring-zinc-950 ${tone}`}
          >
            {badge > 99 ? "99+" : badge}
          </span>
        ) : null}
      </span>
      <span className={`text-[11px] leading-none ${active ? "font-semibold" : "font-medium"}`}>{label}</span>
    </>
  );
  const className = `flex h-full w-full flex-col items-center justify-center gap-1 transition active:scale-95 ${
    active ? "text-zinc-950 dark:text-zinc-50" : "text-zinc-500 dark:text-zinc-400"
  }`;
  return (
    <li className="flex min-w-0 flex-1">
      {href ? (
        <Link
          href={href}
          aria-current={active ? "page" : undefined}
          onClick={() => haptic("tap")}
          className={className}
        >
          {inner}
        </Link>
      ) : (
        <button
          type="button"
          aria-pressed={active}
          onClick={() => {
            haptic("tap");
            onPress?.();
          }}
          className={`${className} cursor-pointer`}
        >
          {inner}
        </button>
      )}
    </li>
  );
}
