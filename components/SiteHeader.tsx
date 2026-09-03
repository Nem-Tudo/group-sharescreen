"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FaDiscord } from "react-icons/fa";
import { MdMonitor, MdOutlineMap } from "react-icons/md";
import { GlobeIcon, VerifiedBadgeIcon } from "@/components/icons";
import { AccountMenu } from "@/components/AccountMenu";
import { NotificationInboxBell } from "@/components/NotificationInboxBell";
import { ThemeMenuButton } from "@/components/ThemeToggle";
import { UpdateAppButton } from "@/components/UpdateAppButton";

// The site's top bar: everything GoLive offers besides the room form itself,
// in one place, on every page that isn't a room.
//
// Before this, /app and /discord-bot were reachable only from a line of small
// print in the footer — a page nobody scrolls to is a page nobody visits.
//
// The bar is in two halves on purpose. Finding a room is what someone is here
// to do, so the two ways of doing it sit beside the logo as buttons; the app
// and the bot are things to go read about later, so they are quiet links at
// the other end. Flattening the two groups into one row of equal links is
// exactly what would bury the rooms among them.
//
// Deliberately not shown in a room (app/watch): that screen is an app shell
// with its own header, and a nav bar over a live call is chrome nobody asked
// for mid-transmission.

const PRIMARY: any[] = [
  // { href: "/rooms", label: "Salas públicas", short: "Salas", Icon: GlobeIcon },
  // { href: "/worldmap", label: "Mapa de salas", short: "Mapa", Icon: MdOutlineMap },
];

function SquareIcon() {
  return <img style={{ width: "20px" }} src={"https://cdn.squarecloud.app/assets/logo.svg"} />
}

const SECONDARY = [
  { href: "https://go.nemtudo.me/square-link", target: "_blank", label: "Square Cloud", short: "Square", Icon: SquareIcon },
  // The same blue badge that marks a verified name (see DisplayUserName) —
  // it keeps its own colour rather than inheriting the row's grey, because it
  // only reads as *that* badge if it looks like it everywhere.
  {
    href: "/pro",
    label: "Pro",
    target: "",
    short: "Pro",
    Icon: VerifiedBadgeIcon,
    iconClassName: "text-blue-500",
    // The one row that keeps its mark and its name at every width. The others
    // drop their icon below `sm` and shorten their label below `lg`, which is
    // how four links fit on a phone — but this one *is* the badge plus the
    // word, and a badge that disappears on small screens is a product people
    // only find out exists on a desktop.
    alwaysVisible: true,
  },
  { href: "/app", label: "App para PC", target: "", short: "App", Icon: MdMonitor },
  { href: "/discord-bot", label: "Bot para Discord", target: "", short: "Bot", Icon: FaDiscord },
];

export function SiteHeader() {
  const pathname = usePathname();

  return (
    // Sticky and translucent: on the long marketing pages the way back to the
    // rest of the site should not be twelve screens up. The blur is what keeps
    // text readable as content scrolls under it, since the bar is see-through.
    <header className="sticky top-0 z-30 border-b border-black/5 bg-zinc-50/85 backdrop-blur-md dark:border-white/5 dark:bg-black/75">
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center gap-1.5 px-3 sm:gap-2 sm:px-4">
        <Link
          href="/"
          className="flex shrink-0 items-center gap-2 transition hover:opacity-80"
          aria-label="Início do GoLive"
        >
          {/* The same red square that app/opengraph-image.tsx draws and every
              Discord embed of the site shows — the mark people already
              associate with GoLive, rather than a second one invented here. */}
          <img src="/icon.png" alt="site icon" style={{ width: "20px" }} />
          <span className="hidden text-base font-semibold tracking-tight text-zinc-950 sm:inline dark:text-zinc-50">
            GoLive
          </span>
        </Link>

        {/* Rooms: real buttons, and the only ones in the bar with a border. */}
        <nav className="flex items-center gap-1.5">
          {PRIMARY.map(({ href, label, short, Icon }) => {
            const active = pathname === href;
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-sm font-medium transition ${active
                  ? "border-zinc-950 bg-zinc-950 text-white dark:border-zinc-50 dark:bg-zinc-50 dark:text-zinc-950"
                  : "border-zinc-300 bg-white text-zinc-800 hover:border-zinc-400 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:border-zinc-600 dark:hover:bg-zinc-900"
                  }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {/* Two full labels do not fit a phone, and two bare icons are
                    a guessing game — so the label shortens instead of
                    disappearing. */}
                <span className="hidden lg:inline">{label}</span>
                <span className="lg:hidden">{short}</span>
              </Link>
            );
          })}
        </nav>

        <nav className="ml-auto flex items-center gap-0.5 sm:gap-1">
          {SECONDARY.map(({ href, label, short, target, Icon, iconClassName, alwaysVisible }) => {
            const active = pathname === href;
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                title={label}
                target={target}
                className={`inline-flex items-center gap-1.5 rounded-lg px-1.5 py-1.5 text-sm transition sm:px-2.5 ${active
                  ? "font-medium text-zinc-950 dark:text-zinc-50"
                  : "text-zinc-500 hover:bg-zinc-200/60 hover:text-zinc-950 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-50"
                  }`}
              >
                {Icon && (
                  <Icon
                    className={`h-4 w-4 shrink-0 ${alwaysVisible ? "inline" : "hidden sm:inline"} ${
                      iconClassName ?? ""
                    }`}
                  />
                )}
                {alwaysVisible ? (
                  // One span, not the label/short pair: swapping between two
                  // strings at a breakpoint is exactly the "changes on a small
                  // screen" this row is meant not to do.
                  <span>{label}</span>
                ) : (
                  <>
                    <span className="hidden lg:inline">{label}</span>
                    <span className="lg:hidden">{short}</span>
                  </>
                )}
              </Link>
            );
          })}
          {/* Claro / escuro / sistema. Right of the links and left of the
              account, because it is a setting about the site rather than
              another place in it. */}
          {/* Left of the theme and the account, which are both settings about
              you; this is the one control in the row that has something to
              *tell* you. */}
          <NotificationInboxBell />
          <ThemeMenuButton />
          {/* Renders nothing until there is a name to show, so the bar looks
              the same on a first visit as it always did. */}
          <AccountMenu />
          {/* Same for this one, twice over: nothing in a browser, and nothing
              in the desktop app until an update has finished downloading. It
              used to live only in the room's own header, which meant the one
              moment somebody was *not* in a call — the moment an update is
              least disruptive to apply — was the one moment they could not
              reach the button. */}
          <UpdateAppButton />
        </nav>
      </div>
    </header>
  );
}
