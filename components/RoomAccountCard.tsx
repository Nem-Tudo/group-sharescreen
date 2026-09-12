"use client";

import Link from "next/link";
import useNtPopups from "ntpopups";
import { BsCoin, BsShop } from "react-icons/bs";
import { MdLogin, MdPalette } from "react-icons/md";
import { useAuth } from "@/lib/AuthContext";
import { useSignaling } from "@/lib/useSignaling";
import { trackEvent } from "@/lib/analytics";
import { Tooltip } from "@/components/Tooltip";
import { ObsSourceIcon } from "@/components/icons";
import { VerifiedBadge } from "@/components/VerifiedBadge";
import { BetaMark } from "@/components/BetaMark";
import { DEFAULT_AVATAR_PATH } from "@/components/UserAvatar";
import { useT } from "@/lib/useI18n";
import { formatLocale } from "@/lib/i18n";

// Who you are, at the foot of the room's chat column (see WatchRoom, from lg
// up). It used to be a chip wedged into the header between "Compartilhar
// sala" and "Apoiar projeto", where it was competing for space with the
// mid-call controls and had room for a truncated name and a number — the
// header dropped even the name on a narrow desktop.
//
// Down here it has a column's width to itself and nothing to compete with, so
// it can be what it actually is: an identity card. That is also where the
// avatar goes when there is one to show; the slot below is drawn as a real
// avatar already, just filled with an initial.
//
// Below lg there is no chat column, and the header keeps its chip.
//
// Everything it costs comes off the chat above it, so it answers to the
// viewport's *height* rather than its width: a laptop 768px tall is where it
// was too big, and that screen is plenty wide. Past the threshold below, the
// points stop being a row of their own and ride on the same line as the name
// — see `basis-full` on that chip. The whole thing is CSS, so there is one
// copy of the markup rather than a tall and a short variant to keep in step.
// 52rem lands 1080p windows on the roomy side and 768/800px laptops on the
// compact one.
export function RoomAccountCard({
  onCreateAccount,
  onOpenProfile,
  canUseStreamerMode,
  streamerMode,
  onToggleStreamerMode,
}: {
  onCreateAccount: () => void;
  // Open your own profile in the room's dialog. Absent where there is no
  // dialog to open it in, which keeps the new-tab link as the fallback rather
  // than making the card unclickable.
  onOpenProfile?: (userId: string) => void;
  canUseStreamerMode?: boolean;
  streamerMode?: boolean;
  onToggleStreamerMode?: () => void;
}) {
  const t = useT();
  const state = useSignaling();
  const { account, points } = useAuth();
  const { openPopup } = useNtPopups();

  // Nothing to show before an identity exists — a name is what mints even the
  // guest one, and until then the room is still asking for it.
  if (!state.name) return null;

  const isAccount = Boolean(account);
  const initial = state.name.trim().slice(0, 1).toUpperCase();

  // Same rule as AccountMenu: a signed-in account with no picture gets the
  // first default, a guest keeps the coloured initial that says so.
  const avatar = account ? (
    <img
      src={account.avatarUrl ?? DEFAULT_AVATAR_PATH}
      alt={state.name}
      className="h-10 w-10 shrink-0 rounded-xl object-cover [@media(max-height:52rem)]:h-8 [@media(max-height:52rem)]:w-8 [@media(max-height:52rem)]:rounded-lg"
    />
  ) : (
    <span
      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-base font-semibold text-white [@media(max-height:52rem)]:h-8 [@media(max-height:52rem)]:w-8 [@media(max-height:52rem)]:rounded-lg [@media(max-height:52rem)]:text-sm ${
        // The same two gradients components/AccountMenu.tsx uses for the same
        // distinction: an account and a guest name are genuinely different
        // things — one survives this browser, the other does not — and the
        // avatar says which without spending a word on it.
        isAccount
          ? "bg-gradient-to-br from-emerald-500 to-teal-600"
          : "bg-gradient-to-br from-zinc-400 to-zinc-500"
        }`}
    >
      {initial}
    </span>
  );

  const identity = (
    <div className="flex min-w-0 flex-col">
      <span className="flex min-w-0 items-center gap-1">
        <span
          className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100"
          style={account?.equippedNameColor ? { color: account.equippedNameColor } : undefined}
        >
          {state.name}
        </span>
        <VerifiedBadge flags={state.account?.flags} className="h-4 w-4 shrink-0" />
      </span>
      {/* The second line is the first thing to go when the card has to be
          short: "@fulano" is context, and the name above it is the point. */}
      <span className="truncate text-xs text-zinc-500 [@media(max-height:46rem)]:hidden dark:text-zinc-400">
        {account ? `@${account.username}` : t("common.guest")}
      </span>
    </div>
  );

  return (
    <div className="mt-2 shrink-0 rounded-xl border border-zinc-200 bg-white p-3 [@media(max-height:52rem)]:mt-1.5 [@media(max-height:52rem)]:p-2 dark:border-zinc-800 dark:bg-zinc-950">
      {/* Wrapping, and it is the points chip below that decides whether it
          wraps: `basis-full` gives it a line of its own, and dropping that on
          a short viewport pulls it up beside the name. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 [@media(max-height:52rem)]:gap-x-2 [@media(max-height:52rem)]:gap-y-1.5">
        {/* Only an account has somewhere to go — a guest has no public
            profile, so theirs is the same block without the link rather than
            a link that lands nowhere. */}
        {account && onOpenProfile ? (
          <Tooltip content={t("common.seeYourProfile")} placement="top">
            {/* Your own profile opens the same way everybody else's does —
                see WatchRoom's UserProfileDialog. It was the one name in the
                room that still took you out to a new tab. A button rather
                than a styled link, for the reason ParticipantRow gives: this
                navigates nowhere. */}
            <button
              type="button"
              onClick={() => onOpenProfile(account.id)}
              className="flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left transition hover:opacity-80 [@media(max-height:52rem)]:gap-2"
            >
              {avatar}
              {identity}
            </button>
          </Tooltip>
        ) : account ? (
          <Tooltip content={t("common.seeYourProfile")} placement="top">
            <Link
              href={`/user/${account.username}`}
              target="_blank"
              className="flex min-w-0 flex-1 items-center gap-3 rounded-lg transition hover:opacity-80 [@media(max-height:52rem)]:gap-2"
            >
              {avatar}
              {identity}
            </Link>
          </Tooltip>
        ) : (
          <div className="flex min-w-0 flex-1 items-center gap-3 [@media(max-height:52rem)]:gap-2">
            {avatar}
            {identity}
          </div>
        )}

        {/* Themes, from inside a room — which is the only place they are worth
            judging. The editor behind this previews onto the room itself (see
            ThemeEditorDialog), so every colour is read against the real chat,
            the real dock and the real video tiles instead of against a drawing
            of them.
            Beside the shop because they are the same errand seen twice: both
            are "change how this looks", and somebody reaching for one has
            usually just thought about the other.
            Shown to everybody, including guests. It used to be Pro-only, which
            was the wrong gate on the wrong thing — wearing a theme somebody
            published is free to any account, and the two paid doors behind it
            explain themselves (see ThemeHubDialog). */}
        <Tooltip content={t("common.themes")} placement="top">
          <button
            type="button"
            onClick={() => openPopup("theme_hub", { data: {} })}
            aria-label={t("common.themes")}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-zinc-200 text-zinc-600 transition hover:bg-zinc-100 [@media(max-height:52rem)]:h-7 [@media(max-height:52rem)]:w-7 dark:border-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-900"
          >
            <MdPalette className="h-4 w-4 shrink-0 [@media(max-height:52rem)]:h-3.5 [@media(max-height:52rem)]:w-3.5" />
          </button>
        </Tooltip>

        {/* Beside the identity block rather than its own row, so it never
            competes with the points chip's own wrap behavior — see the
            comment on the card's outer div. */}
        <Tooltip content={t("common.cosmeticsShop")} placement="top">
          <button
            type="button"
            onClick={() => openPopup("cosmetics_store", { data: {} })}
            aria-label={t("common.cosmeticsShop")}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-zinc-200 text-zinc-600 transition hover:bg-zinc-100 [@media(max-height:52rem)]:h-7 [@media(max-height:52rem)]:w-7 dark:border-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-900"
          >
            <BsShop className="h-4 w-4 shrink-0 [@media(max-height:52rem)]:h-3.5 [@media(max-height:52rem)]:w-3.5" />
          </button>
        </Tooltip>

        {/* A row of its own where there is height for it, a chip on the name's
            line where there isn't. Same coin the rest of the site uses for
            points; the word "Pontos" is what gets dropped in the narrow form,
            since a coin next to a number does not need it spelled out. */}
        <Tooltip
          content={
            isAccount
              ? t("roomAccountCard.pointsEarnedByWatchingPartnerAds")
              : t("common.yourGuestPointsAreSavedOnly")
          }
          placement="top"
        >
          <div className="flex shrink-0 basis-full items-center gap-1.5 rounded-lg bg-zinc-100 px-3 py-2 [@media(max-height:52rem)]:basis-auto [@media(max-height:52rem)]:px-2 [@media(max-height:52rem)]:py-1 dark:bg-zinc-900">
            <BsCoin className="h-3.5 w-3.5 shrink-0 text-amber-500" />
            <span className="text-xs font-medium text-zinc-600 [@media(max-height:52rem)]:hidden dark:text-zinc-400">
              {t("common.points")}
            </span>
            <span className="text-sm font-semibold tabular-nums text-zinc-900 [@media(max-height:52rem)]:text-xs dark:text-zinc-100">
              {points.toLocaleString(formatLocale())}
            </span>
          </div>
        </Tooltip>
      </div>

      {/* Streamer Mode button for room managers with an account */}
      {canUseStreamerMode && onToggleStreamerMode && (
        <Tooltip
          content={
            streamerMode
              ? t("roomAccountCard.streamerModeOnRoomCodeHidden")
              : t("roomAccountCard.turnOnStreamerModeHidesThe")
          }
          placement="top"
        >
          <button
            type="button"
            onClick={onToggleStreamerMode}
            aria-label={streamerMode ? t("roomAccountCard.turnOffStreamerMode") : t("roomAccountCard.turnOnStreamerMode")}
            className={`mt-2 flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition [@media(max-height:52rem)]:mt-1.5 [@media(max-height:52rem)]:py-1.5 ${
              streamerMode
                ? "border-purple-500 bg-purple-600 text-white shadow-sm shadow-purple-500/25 hover:bg-purple-700"
                : "border-zinc-200 bg-zinc-50 text-zinc-700 hover:border-purple-300 hover:bg-purple-50 hover:text-purple-700 dark:border-zinc-800 dark:bg-zinc-900/70 dark:text-zinc-300 dark:hover:border-purple-700 dark:hover:bg-purple-950/40 dark:hover:text-purple-300"
            }`}
          >
            <div className="flex items-center gap-2">
              <ObsSourceIcon className="h-4 w-4 shrink-0" />
              <span className="font-semibold">{t("common.streamerMode")}</span>
              <span className="text-[10px] font-bold"><BetaMark /></span>
            </div>
            <div className="flex items-center gap-1.5">
              <span
                className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                  streamerMode
                    ? "bg-white/20 text-white"
                    : "bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
                }`}
              >
                {streamerMode ? t("roomAccountCard.active") : t("common.off")}
              </span>
              {streamerMode && (
                <span className="relative flex h-2 w-2 shrink-0">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-white" />
                </span>
              )}
            </div>
          </button>
        </Tooltip>
      )}

      {/* Guests only. The offer belongs next to the thing it protects — the
          points right above it, which this browser is the only copy of. */}
      {!isAccount && (
        <button
          type="button"
          onClick={() => {
            trackEvent("account_button_clicked");
            onCreateAccount();
          }}
          className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-zinc-950 bg-zinc-950 px-3 py-2 text-sm font-medium text-white transition hover:bg-zinc-800 [@media(max-height:52rem)]:mt-1.5 [@media(max-height:52rem)]:py-1.5 [@media(max-height:52rem)]:text-xs dark:border-zinc-50 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
        >
          <MdLogin className="h-4 w-4 shrink-0" />
          <span className="[@media(max-height:52rem)]:hidden">{t("common.createAnAccountOrSignIn")}</span>
          <span className="hidden [@media(max-height:52rem)]:inline">{t("common.createAccount")}</span>
        </button>
      )}
    </div>
  );
}
