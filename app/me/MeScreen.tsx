"use client";

import Link from "next/link";
import { useState, type ComponentType, type FormEvent, type ReactNode } from "react";
import { BsCoin } from "react-icons/bs";
import { FaDiscord } from "react-icons/fa";
import { useDiscordBotHidden } from "@/lib/discordBotHidden";
import {
  MdAdminPanelSettings,
  MdAutoAwesome,
  MdArrowBack,
  MdChatBubbleOutline,
  MdChevronRight,
  MdDescription,
  MdEdit,
  MdLogin,
  MdLogout,
  MdMonitor,
  MdNotificationsNone,
  MdOutlineMap,
  MdPalette,
  MdPeopleOutline,
  MdPersonAdd,
  MdPersonOutline,
  MdSmartToy,
} from "react-icons/md";
import { AccountConnections } from "@/components/AccountConnections";
import { EmailVerification } from "@/components/EmailVerification";
import { AuthorizedApps } from "@/components/oauth2/AuthorizedApps";
import { DEVELOPERS_URL } from "@/lib/botsApi";
import { CompleteOAuthSignupForm } from "@/components/CompleteOAuthSignupForm";
import { CreateAccountForm } from "@/components/CreateAccountForm";
import { GlobeIcon } from "@/components/icons";
import { LanguagePicker } from "@/components/LanguageToggle";
import { LoginForm } from "@/components/LoginForm";
import { OAuthButtons } from "@/components/OAuthButtons";
import { useProOffer } from "@/components/ProOffer";
import { SocialLinks } from "@/components/SocialLinks";
import { ThemeSegmented } from "@/components/ThemeToggle";
import { DEFAULT_AVATAR_PATH } from "@/components/UserAvatar";
import { useAuth } from "@/lib/AuthContext";
import { trackEvent } from "@/lib/analytics";
import { getDesktopBridge } from "@/lib/desktop";
import { BUILD_VERSION } from "@/lib/buildVersion";
import { useIsAppShell } from "@/lib/mobileShell";
import { setReopenLastScreenEnabled, useReopenLastScreen } from "@/lib/lastScreen";
import { useBackHandler } from "@/lib/useBackHandler";
import { openDirectMessages } from "@/lib/dmWindow";
import type { OAuthResult } from "@/lib/oauthApi";
import { signalingClient } from "@/lib/signalingClient";
import { useSignalingSelector, shallow } from "@/lib/useSignalingSelector";
import { selectAccountMenu } from "@/lib/signalingSelectors";
import { useT } from "@/lib/useI18n";
import { avatarShapeClass } from "@/lib/avatarShape";
import useNtPopups from "ntpopups";
import { NewBadge } from "@/components/NewBadge";
import { PlanLink, PlanRing, planRowClass } from "@/components/UserProfileCard";
import { WIDE_POPUP_SIZE } from "@/components/groups/dialogKit";
import { accountTierOf } from "@/lib/entitlements";
import { ACCOUNT_EMOJI_LIMITS, CUSTOM_EMOJI_BADGE, CUSTOM_EMOJI_FEATURE } from "@/lib/customEmoji";
import { useFeature } from "@/lib/features";
import {
  NOTIFICATION_SETTINGS_BADGE,
  NOTIFICATION_SETTINGS_FEATURE,
} from "@/lib/notificationSettings";

// "Você" — the last of the bottom tabs (see components/MobileTabBar), and the
// one screen that holds everything about the person and the app that the
// desktop keeps in the header and the account menu: who you are, your
// account's pages, the look and the language, the premium offer, and the pages
// about GoLive itself (the desktop app, the Discord bot, the terms).
//
// Nothing here is new; it is the header's links and the account menu's rows
// on one screen, so a phone — which has neither — can reach all of it.

type Mode = "home" | "rename" | "create" | "login";

const card = "overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950";
const rowClass =
  "flex w-full items-center gap-3 px-4 py-3 text-left text-[15px] font-medium text-zinc-800 transition active:bg-zinc-100 dark:text-zinc-200 dark:active:bg-zinc-900 lg:hover:bg-zinc-50 lg:dark:hover:bg-zinc-900";
const primaryButton =
  "flex items-center justify-center gap-2 rounded-xl bg-zinc-950 px-4 py-2.5 text-sm font-semibold text-white transition active:scale-[0.98] disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-950";
const secondaryButton =
  "flex items-center justify-center gap-2 rounded-xl border border-zinc-300 px-4 py-2.5 text-sm font-semibold text-zinc-800 transition active:scale-[0.98] dark:border-zinc-700 dark:text-zinc-200";

export function MeScreen() {
  const t = useT();
  const { show: showBot } = useDiscordBotHidden();
  const state = useSignalingSelector(selectAccountMenu, shallow);
  const { account, points, logout } = useAuth();
  const pro = useProOffer();
  const [mode, setMode] = useState<Mode>("home");
  const [nameInput, setNameInput] = useState("");
  const [oauthTicket, setOAuthTicket] = useState<Extract<OAuthResult, { kind: "ticket" }> | null>(null);
  const appShell = useIsAppShell();
  // The exposure is counted here because this row is the only place the
  // screen is offered — see lib/notificationSettings.ts.
  const notificationSettings = useFeature(NOTIFICATION_SETTINGS_FEATURE);

  const name = account?.displayName ?? state.name ?? "";
  const isAdmin = Boolean(account?.flags?.includes("ADMIN") || state.account?.flags?.includes("ADMIN"));
  const backHome = () => {
    setMode("home");
    setOAuthTicket(null);
  };

  // Android's back button leaves a form for this screen, not the screen.
  useBackHandler(mode !== "home" || oauthTicket !== null, backHome);

  function handleRename(e: FormEvent) {
    e.preventDefault();
    const trimmed = nameInput.trim();
    if (!trimmed || trimmed === state.name) return;
    trackEvent("name_change");
    signalingClient.register(trimmed);
    setMode("home");
  }

  // A step that takes the whole screen: the forms are what the account menu
  // opens in its popover, here with room to breathe and a way back.
  if (oauthTicket || mode !== "home") {
    return (
      <Screen>
        <button type="button" onClick={backHome} className="flex items-center gap-1.5 self-start text-sm font-medium text-zinc-600 dark:text-zinc-400">
          <MdArrowBack className="h-5 w-5" />
          {t("common.back")}
        </button>
        <div className={`${card} p-4`}>
          {oauthTicket ? (
            <CompleteOAuthSignupForm
              ticket={oauthTicket.ticket}
              provider={oauthTicket.provider}
              suggestedUsername={oauthTicket.suggestedUsername}
              suggestedDisplayName={oauthTicket.suggestedDisplayName}
              onSuccess={backHome}
              onCancel={() => setOAuthTicket(null)}
            />
          ) : mode === "create" ? (
            <CreateAccountForm
              initialDisplayName={state.name ?? ""}
              onSuccess={backHome}
              onCancel={backHome}
              onSwitchToLogin={() => setMode("login")}
            />
          ) : mode === "login" ? (
            <LoginForm
              onSuccess={backHome}
              onCancel={backHome}
              onSwitchToCreate={() => setMode("create")}
              onTicket={setOAuthTicket}
            />
          ) : (
            <form onSubmit={handleRename} className="flex flex-col gap-3">
              <label htmlFor="me-name" className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                {t("common.newName")}
              </label>
              <input
                id="me-name"
                autoFocus
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                maxLength={24}
                placeholder={state.name ?? ""}
                className="rounded-xl border border-zinc-300 bg-white px-4 py-3 text-zinc-950 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
              />
              {state.nameError && <p className="text-sm text-red-500">{state.nameError}</p>}
              <button type="submit" disabled={!nameInput.trim() || nameInput.trim() === state.name} className={primaryButton}>
                {t("common.save")}
              </button>
            </form>
          )}
        </div>
      </Screen>
    );
  }

  return (
    <Screen>
      {/* Who you are. */}
      <section className={`${card} p-4`}>
        <div className="flex items-center gap-3.5">
          {/* eslint-disable-next-line @next/next/no-img-element -- an avatar from any host */}
          <img
            src={account?.avatarUrl || DEFAULT_AVATAR_PATH}
            alt=""
            className={`h-16 w-16 shrink-0 ${avatarShapeClass(account?.avatarUrl)} object-cover ring-1 ring-black/5 dark:ring-white/10`}
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-lg font-semibold text-zinc-950 dark:text-zinc-50">
              {name || t("mobile.noNameYet")}
            </p>
            <p className="truncate text-sm text-zinc-500 dark:text-zinc-400">
              {account ? `@${account.username}` : name ? t("mobile.guest") : t("mobile.notSignedIn")}
            </p>
            {name && (
              <p className="mt-1 flex items-center gap-1 text-xs font-medium tabular-nums text-zinc-500 dark:text-zinc-400">
                <BsCoin className="h-3.5 w-3.5" />
                {points}
              </p>
            )}
          </div>
          {account && (
            <Link
              href={`/user/${account.username}`}
              aria-label={t("accountMenu.myProfile")}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-zinc-700 transition active:scale-95 dark:bg-zinc-900 dark:text-zinc-300"
            >
              <MdEdit className="h-5 w-5" />
            </Link>
          )}
        </div>

        {!account && (
          <div className="mt-4 flex flex-col gap-2">
            <p className="text-sm text-zinc-600 dark:text-zinc-400">{t("mobile.accountPitch")}</p>
            <button type="button" onClick={() => setMode("create")} className={primaryButton}>
              <MdPersonAdd className="h-5 w-5" />
              {t("common.createAnAccount")}
            </button>
            <button type="button" onClick={() => setMode("login")} className={secondaryButton}>
              <MdLogin className="h-5 w-5" />
              {t("common.iAlreadyHaveAnAccount")}
            </button>
            <OAuthButtons onSuccess={backHome} onTicket={setOAuthTicket} />
          </div>
        )}
      </section>

      {/* Your account's own places. */}
      <Section>
        {account ? (
          <>
            <Row href={`/user/${account.username}`} icon={MdPersonOutline} label={t("accountMenu.myProfile")} />
            <Row onClick={() => openDirectMessages(null)} icon={MdChatBubbleOutline} label={t("common.messages")} />
            <Row href="/friends" icon={MdPeopleOutline} label={t("common.friends")} />
            {/* The one screen that answers "por que meu celular não tocou":
                the permission, the devices this account receives on, what it
                is told about and when it is not. Behind a feature flag (see
                lib/notificationSettings.ts) because it is new; the fixes it
                was built with are not. Counted as an exposure here, which is
                the one place it is actually offered. */}
            {notificationSettings.enabled && (
              <Row
                href="/me/notifications"
                icon={MdNotificationsNone}
                label={t("common.notifications")}
                badge={<NewBadge id={NOTIFICATION_SETTINGS_BADGE} />}
              />
            )}
            {/* Bots live in the developer dashboard, its own site — opened
                outside, where the same account signs in. */}
            {!account.bot && (
              <Row
                onClick={() => window.open(DEVELOPERS_URL, "_blank", "noopener")}
                icon={MdSmartToy}
                label={t("accountMenu.developerPortal")}
              />
            )}
            {isAdmin && <Row href="/admin" icon={MdAdminPanelSettings} label={t("accountMenu.adminPanel")} tone="purple" />}
          </>
        ) : (
          // A name without an account is a browser's thing: the app itself is
          // account-only (see the home page), so there it is not offered.
          !appShell && (
            <Row
              onClick={() => {
                setNameInput(state.name ?? "");
                setMode("rename");
              }}
              icon={MdEdit}
              label={name ? t("accountMenu.changeName") : t("mobile.pickAName")}
            />
          )
        )}
        <Row href={pro.href} onClick={pro.onClick} icon={pro.Icon} iconClassName={pro.iconClassName} label={pro.label} />
      </Section>

      {account && !account.bot && <MyEmojisSetting flags={account.flags} />}

      {account && (
        // Its own collapsible block, padding included — see AccountConnections.
        // AuthorizedApps sits in the same card and hides itself when this
        // account has never signed into anything with "Entrar com GoLive",
        // so the card stays a single row for almost everybody.
        <div className={`${card} py-1 empty:hidden`}>
          <EmailVerification />
          <AccountConnections />
          <AuthorizedApps />
        </div>
      )}

      {/* The rest of what there is to find. */}
      <Section title={t("mobile.explore")}>
        <Row href="/rooms" icon={GlobeIcon} label={t("page.seePublicRooms")} />
        <Row href="/worldmap" icon={MdOutlineMap} label={t("page.seeTheRoomMap")} />
        <Row href="/workshop" icon={MdPalette} label={t("common.themes")} />
      </Section>

      <section className={`${card} p-4`}>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{t("common.theme")}</p>
        <ThemeSegmented />
        <p className="mt-4 mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          {t("languageToggle.language")}
        </p>
        <LanguagePicker />
      </section>

      {/* Only the app is ever reopened anywhere (see lib/lastScreen). */}
      {appShell && <ReopenLastScreenSetting />}

      <Section title={t("mobile.about")}>
        {/* The desktop app's page is about a program for a computer: worth
            finding from a phone's browser, pointless from inside the app. */}
        {!appShell && <Row href="/app" icon={MdMonitor} label={t("common.desktopApp")} />}
        {showBot && <Row href="/discord-bot" icon={FaDiscord} label={t("common.discordBot")} />}
        <Row href="/terms" icon={MdDescription} label={t("common.termsOfUse")} />
      </Section>

      {account && (
        <Section>
          <Row onClick={logout} icon={MdLogout} label={t("accountMenu.signOut")} tone="red" chevron={false} />
        </Section>
      )}

      <SocialLinks title={null} className="-mt-1 text-center" />
      <a
        href="https://go.nemtudo.me/square-link"
        target="_blank"
        rel="noopener noreferrer"
        className="mx-auto opacity-80 transition hover:opacity-100"
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- the sponsor's own badge */}
        <img src="https://cdn.squarecloud.app/assets/powered-by.svg" alt={t("siteHeader.squareCloud")} className="w-44" />
      </a>
      <AppVersion />
    </Screen>
  );
}

function Screen({ children }: { children: ReactNode }) {
  return <div className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-4 px-4 pt-4 pb-6">{children}</div>;
}

function Section({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section>
      {title && (
        <p className="mb-1.5 px-1 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{title}</p>
      )}
      <div className={`${card} divide-y divide-zinc-100 dark:divide-zinc-900`}>{children}</div>
    </section>
  );
}

function Row({
  href,
  onClick,
  icon: Icon,
  iconClassName = "",
  label,
  tone,
  chevron = true,
  badge,
}: {
  href?: string;
  onClick?: () => void;
  icon: ComponentType<{ className?: string }>;
  iconClassName?: string;
  label: string;
  tone?: "red" | "purple";
  chevron?: boolean;
  /** The blue "NOVO", for a row that has just appeared. */
  badge?: ReactNode;
}) {
  const color =
    tone === "red" ? "text-red-600 dark:text-red-500" : tone === "purple" ? "text-purple-600 dark:text-purple-400" : "";
  const inner = (
    <>
      <Icon className={`h-5 w-5 shrink-0 opacity-80 ${iconClassName}`} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {badge}
      {chevron && <MdChevronRight className="h-5 w-5 shrink-0 text-zinc-400" />}
    </>
  );
  return href ? (
    <Link href={href} onClick={onClick} className={`${rowClass} ${color}`}>
      {inner}
    </Link>
  ) : (
    <button type="button" onClick={onClick} className={`${rowClass} ${color} cursor-pointer`}>
      {inner}
    </button>
  );
}

/**
 * The account's own custom emoji (see lib/customEmoji) — opens the "Seus
 * emojis" popup. Without Pro Max it is shown locked, the way the profile
 * editor shows a perk that belongs to a plan (see UserProfileCard's
 * PlanRing): the gold ring, the button off, and "Disponível no Pro Max" as
 * the way to it. Only inside the experiment.
 */
function MyEmojisSetting({ flags }: { flags: readonly string[] }) {
  const t = useT();
  const { openPopup } = useNtPopups();
  const { enabled } = useFeature(CUSTOM_EMOJI_FEATURE, { track: true });
  if (!enabled) return null;
  const limit = ACCOUNT_EMOJI_LIMITS[accountTierOf(flags)];
  const locked = limit === 0;
  return (
    <section className={`${card} p-4`}>
      <div className={planRowClass(locked, "flex flex-col gap-2")}>
        <PlanRing tier="proMax" locked={locked} />
        <div className="flex items-center gap-3">
          <MdAutoAwesome className="h-5 w-5 shrink-0 text-violet-500" />
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1.5 text-[15px] font-medium text-zinc-800 dark:text-zinc-200">
              {t("customEmoji.yourEmojis")}
              <NewBadge id={CUSTOM_EMOJI_BADGE} />
            </p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              {locked ? t("customEmoji.yoursLimitHint") : t("customEmoji.meHint", { limit })}
            </p>
          </div>
          <button
            type="button"
            disabled={locked}
            onClick={() => void openPopup("my_emojis", { ...WIDE_POPUP_SIZE, data: {} })}
            className="shrink-0 cursor-pointer rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-800 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900"
          >
            {t("customEmoji.configure")}
          </button>
        </div>
        {locked && <PlanLink tier="proMax" className="self-start text-xs text-zinc-500 dark:text-zinc-400" />}
      </div>
    </section>
  );
}

/** Whether the app reopens on the screen it was closed on — this device only. */
function ReopenLastScreenSetting() {
  const t = useT();
  const on = useReopenLastScreen();
  return (
    <section className={`${card} p-2`}>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        onClick={() => setReopenLastScreenEnabled(!on)}
        className="flex w-full cursor-pointer items-start gap-3 rounded-lg p-2 text-left"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-zinc-900 dark:text-zinc-100">{t("mobile.reopenLastScreen")}</span>
          <span className="mt-0.5 block text-xs leading-snug text-zinc-500 dark:text-zinc-400">
            {t("mobile.reopenLastScreenHint")}
          </span>
        </span>
        <span
          aria-hidden
          className={`relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors ${
            on ? "bg-emerald-500" : "bg-zinc-300 dark:bg-zinc-700"
          }`}
        >
          <span
            className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
              on ? "translate-x-4" : "translate-x-0"
            }`}
          />
        </span>
      </button>
    </section>
  );
}

/**
 * Which build this is, for a bug report: the site's `<package>-<commit>`
 * everywhere, plus the desktop shell's own version inside the app — the two
 * move independently (the site deploys without a new installer).
 */
function AppVersion() {
  const shell = useIsAppShell();
  const shellVersion = shell ? getDesktopBridge()?.appVersion ?? null : null;
  return (
    <p className="select-text text-center font-mono text-xs text-zinc-400 dark:text-zinc-600">
      GoLive {BUILD_VERSION}
      {shellVersion && <> · app {shellVersion}</>}
    </p>
  );
}
