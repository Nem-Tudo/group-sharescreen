"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FaDiscord } from "react-icons/fa";
import { MdCardGiftcard, MdMonitor, MdOutlineMap, MdPalette } from "react-icons/md";
import { GlobeIcon, GoldVerifiedBadgeIcon, VerifiedBadgeIcon } from "@/components/icons";
import useNtPopups from "ntpopups";
import { AccountMenu } from "@/components/AccountMenu";
import { NotificationInboxBell } from "@/components/NotificationInboxBell";
import { UpdateAppButton } from "@/components/UpdateAppButton";
import { useAuth } from "@/lib/AuthContext";
import { useT } from "@/lib/useI18n";
import { translate } from "@/lib/i18n";

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

/** One entry in the right-hand group: a link, or a button when it opens something. */
type SecondaryItem = {
  /** Stable across the Pro row's three states, which is what keeps React from
   *  remounting it — see proItem below. */
  key: string;
  href?: string;
  onClick?: () => void;
  target?: string;
  label: string;
  short: string;
  Icon?: React.ComponentType<{ className?: string }>;
  iconClassName?: string;
  /** Keeps its mark at every width, where the others drop theirs below `sm`. */
  alwaysVisible?: boolean;
  /** Gone on a phone — not shrunk, not iconified. See SECONDARY. */
  desktopOnly?: boolean;
};

const SECONDARY: SecondaryItem[] = [
  // The sponsor, and the one row a phone does not get at all.
  //
  // Every other entry here shortens: the icon goes below `sm`, the label goes
  // below `lg`. That works for a destination somebody might be looking for —
  // "App", "Bot" — and not for this one, which is an outbound link to another
  // company. Shrunk to a bare logo it is an unlabelled image next to the
  // account menu, competing for the narrowest part of the bar with the things
  // the site is actually for.
  {
    key: "square",
    href: "https://go.nemtudo.me/square-link",
    target: "_blank",
    get label() { return translate("siteHeader.squareCloud"); },
    get short() { return translate("siteHeader.square"); },
    Icon: SquareIcon,
    desktopOnly: true,
  },
  // Before the app and the bot: it is a place to browse and come back to,
  // which those two are not — they are read once and installed.
  {
    key: "workshop",
    href: "/workshop",
    target: "",
    get label() { return translate("common.themes"); },
    get short() { return translate("common.themes"); },
    Icon: MdPalette,
  },
  { key: "app", href: "/app", get label() { return translate("common.desktopApp"); }, target: "", get short() { return translate("siteHeader.app"); }, Icon: MdMonitor },
  {
    key: "bot",
    href: "/discord-bot",
    get label() { return translate("common.discordBot"); },
    target: "",
    get short() { return translate("siteHeader.bot"); },
    Icon: FaDiscord,
  },
];

export function SiteHeader() {
  const t = useT();
  const pathname = usePathname();
  const { account } = useAuth();
  const { openPopup } = useNtPopups();

  // The premium row, which is three different offers wearing one slot.
  //
  // The slot has always sold whatever the reader has not got, and until now
  // that was only ever "Pro" — which is the wrong thing to keep advertising to
  // somebody who already pays for it, and the *only* thing a subscriber saw of
  // the plan above theirs. So it climbs with them:
  //
  //   no plan  → "Pro", the blue badge. What the site sells.
  //   Pro      → "Pro Max", in that plan's own gold mark (see planIcons), and
  //              pointing at /pro already opened on it — a reader who has Pro
  //              should not have to find the picker to see what is above it.
  //   Pro Max  → "Presentear Pro". There is nothing left to sell them, and the
  //              one thing they can still buy is a plan for somebody else.
  //
  // Read from `flags` rather than from `features`: the question here is which
  // *plan* somebody holds, not what they may do, and the two flags are exactly
  // that answer (see the API's entitlements.ts — PRO_MAX carries PRO too,
  // which is why it is tested first).
  const flags = account?.flags ?? [];
  const proItem: SecondaryItem = flags.includes("PRO_MAX")
    ? {
        key: "pro",
        // By name rather than as markup here: the bar is translucent, and a
        // dialog rendered inside a `backdrop-filter` is a dialog whose backdrop
        // covers the bar instead of the page (see GiftPlanDialog).
        onClick: () => void openPopup("gift_plan", { data: {} }),
        label: t("common.giftPro"),
        // The only row whose two labels differ in *words* rather than in
        // length. It has to: "Presentear Pro" beside an account menu is most
        // of a phone's bar, and the verb alone is the half that says what
        // happens.
        short: t("common.sendAsAGift"),
        Icon: MdCardGiftcard,
        iconClassName: "text-emerald-500",
        alwaysVisible: true,
      }
    : flags.includes("PRO")
      ? {
          key: "pro",
          href: "/pro?plan=premium_max",
          target: "",
          label: t("common.proMax"),
          short: t("common.proMax"),
          // The plan's own mark, which carries its colour in its gradients and
          // therefore takes no colour class of its own.
          Icon: GoldVerifiedBadgeIcon,
          alwaysVisible: true,
        }
      : {
          key: "pro",
          href: "/pro",
          target: "",
          label: t("common.pro"),
          short: t("common.pro"),
          // The same blue badge that marks a verified name (see
          // DisplayUserName) — it keeps its own colour rather than inheriting
          // the row's grey, because it only reads as *that* badge if it looks
          // like it everywhere.
          Icon: VerifiedBadgeIcon,
          iconClassName: "text-blue-500",
          alwaysVisible: true,
        };

  // Ahead of the app and the bot, where "Pro" has always sat.
  const secondary: SecondaryItem[] = [SECONDARY[0], proItem, ...SECONDARY.slice(1)];

  return (
    // Sticky and translucent: on the long marketing pages the way back to the
    // rest of the site should not be twelve screens up. The blur is what keeps
    // text readable as content scrolls under it, since the bar is see-through.
    <header className="sticky top-0 z-30 border-b border-black/5 bg-zinc-50/85 backdrop-blur-md dark:border-white/5 dark:bg-black/75">
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center gap-1.5 px-3 sm:gap-2 sm:px-4">
        <Link
          href="/"
          className="flex shrink-0 items-center gap-2 transition hover:opacity-80"
          aria-label={t("siteHeader.goliveHome")}
        >
          {/* The same red square every Discord embed of the site shows (see
              the openGraph image in app/layout.tsx) — the mark people already
              associate with GoLive, rather than a second one invented here. */}
          <img src="/icon.png" alt="site icon" style={{ width: "20px" }} />
          <span className="hidden text-base font-semibold tracking-tight text-zinc-950 sm:inline dark:text-zinc-50">
            {t("common.golive")}
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
          {secondary.map((item) => {
            const { key, href, onClick, label, short, target, Icon, iconClassName } = item;
            const active = Boolean(href) && pathname === href;
            // One display utility, chosen here rather than layered: "hidden"
            // and "inline-flex" both set `display`, and which of two classes
            // in the same attribute wins is decided by the order Tailwind
            // happened to emit them in — not by the order they are written.
            const display = item.desktopOnly ? "hidden sm:inline-flex" : "inline-flex";
            const className = `${display} items-center gap-1.5 rounded-lg px-1.5 py-1.5 text-sm transition sm:px-2.5 ${
              active
              ? "font-medium text-zinc-950 dark:text-zinc-50"
              : "text-zinc-500 hover:bg-zinc-200/60 hover:text-zinc-950 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-50"
              }`;
            const inner = (
              <>
                {Icon && (
                  <Icon
                    className={`h-4 w-4 shrink-0 ${
                      item.alwaysVisible ? "inline" : "hidden sm:inline"
                    } ${iconClassName ?? ""}`}
                  />
                )}
                {/* Two full labels do not fit a phone, so the label shortens
                    below `lg` rather than disappearing. Most rows write the
                    same word twice and nothing swaps; see the Pro row for the
                    one that does. */}
                <span className="hidden lg:inline">{label}</span>
                <span className="lg:hidden">{short}</span>
              </>
            );
            // A button when it opens something here, a link when it goes
            // somewhere. Marking the first as navigation would promise a
            // middle-click and an address to copy that do not exist.
            return href ? (
              <Link
                key={key}
                href={href}
                aria-current={active ? "page" : undefined}
                title={label}
                target={target}
                className={className}
              >
                {inner}
              </Link>
            ) : (
              <button
                key={key}
                type="button"
                onClick={onClick}
                title={label}
                className={`${className} cursor-pointer`}
              >
                {inner}
              </button>
            );
          })}
          {/* Left of the account, which is the other control in the row about
              you; this is the one with something to *tell* you.

              The theme picker used to sit here too and now lives inside the
              account menu (see AccountMenu): it is a setting somebody changes
              once, and a permanent button in the bar spent header room on a
              decision nobody revisits. */}
          <NotificationInboxBell />
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
