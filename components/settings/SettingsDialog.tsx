"use client";

import { useEffect, useState, type ComponentType, type FormEvent, type ReactNode } from "react";
import useNtPopups from "ntpopups";
import {
  MdAdminPanelSettings,
  MdArrowBack,
  MdBugReport,
  MdCall,
  MdChatBubbleOutline,
  MdChevronRight,
  MdClose,
  MdDeleteOutline,
  MdDescription,
  MdExtension,
  MdInfoOutline,
  MdLogin,
  MdLogout,
  MdMonitor,
  MdNotificationsNone,
  MdOutlineKeyboard,
  MdPalette,
  MdPeopleOutline,
  MdPersonAdd,
  MdPersonOutline,
  MdSmartToy,
  MdTune,
} from "react-icons/md";
import { BsCoin } from "react-icons/bs";
import { FaDiscord } from "react-icons/fa";
import {
  AppVersion,
  card,
  DiscordRpcSetting,
  MyEmojisSetting,
  PartnerAdsSetting,
  ReopenLastScreenSetting,
  Row,
  Section,
} from "@/app/me/MeScreen";
import { NotificationSettingsScreen } from "@/app/me/notifications/NotificationSettingsScreen";
import { AccountConnections } from "@/components/AccountConnections";
import type { AccountModalMode } from "@/components/AccountModal";
import { ReceiveCameraEffectsSetting } from "@/components/CameraEffectForOthers";
import { EmailVerification } from "@/components/EmailVerification";
import { ClearShortcutsButton, KeyboardShortcutsContent } from "@/components/KeyboardShortcutsModal";
import { LanguagePicker } from "@/components/LanguageToggle";
import { markFeatureUsed } from "@/components/NewBadge";
import { AuthorizedApps } from "@/components/oauth2/AuthorizedApps";
import {
  DoubleClickFocusToggle,
  OpenRoomsInAppToggle,
  ProfileSongToggle,
  RoomThemeToggle,
  SoundEffectsToggle,
} from "@/components/SitePreferenceToggles";
import { SocialLinks } from "@/components/SocialLinks";
import { ThemeSegmented } from "@/components/ThemeToggle";
import { DEFAULT_AVATAR_PATH } from "@/components/UserAvatar";
import { useDiscordBotHidden } from "@/lib/discordBotHidden";
import { useAuth } from "@/lib/AuthContext";
import { trackEvent } from "@/lib/analytics";
import { ACCOUNT_DELETE_FEATURE } from "@/lib/accountDelete";
import { avatarShapeClass } from "@/lib/avatarShape";
import { DEVELOPERS_URL } from "@/lib/botsApi";
import { useCallSession } from "@/lib/callSession";
import { openDirectMessages } from "@/lib/dmWindow";
import { useFeature } from "@/lib/features";
import { useIsAppShell } from "@/lib/mobileShell";
import { NOTIFICATION_SETTINGS_FEATURE } from "@/lib/notificationSettings";
import {
  closeSettings,
  setSettingsCallSlot,
  setSettingsSection,
  SETTINGS_HUB_BADGE,
  SETTINGS_HUB_EVENTS,
  trackSettingsEvent,
  useSettingsWindow,
  type SettingsSection,
} from "@/lib/settingsHub";
import { signalingClient } from "@/lib/signalingClient";
import { selectAccountMenu } from "@/lib/signalingSelectors";
import { useBackHandler } from "@/lib/useBackHandler";
import { useT } from "@/lib/useI18n";
import { SM_BREAKPOINT_QUERY, useMediaQuery } from "@/lib/useMediaQuery";
import { shallow, useSignalingSelector } from "@/lib/useSignalingSelector";

// "Configurações" — everything about how GoLive works for you, in one place,
// from any screen and without leaving it: a call stays where it is behind this.
//
// What it does not hold is what belongs to where you are: the room's "⋯" keeps
// the room's own things and the mic's panel keeps the device being used.
//
// From sm up it is a dialog with its sections down the side. Below that it is a
// whole screen, the list first and each section one step in.

type SectionEntry = {
  id: SettingsSection;
  label: string;
  icon: ComponentType<{ className?: string }>;
  /** Where this section's choices are kept, said under its title. */
  scope?: "device" | "account";
};

export function SettingsDialog({ onRequestAccount }: { onRequestAccount: (mode: AccountModalMode) => void }) {
  const t = useT();
  const { section: requested } = useSettingsWindow();
  const { account } = useAuth();
  const wide = useMediaQuery(SM_BREAKPOINT_QUERY);
  const call = useCallSession();
  // Counted here, the one place the screen is offered from in this experiment.
  const notifications = useFeature(NOTIFICATION_SETTINGS_FEATURE, { track: Boolean(account) }).enabled;

  const sections: SectionEntry[] = [
    { id: "account", label: t("settingsHub.section.account"), icon: MdPersonOutline, scope: account ? "account" : undefined },
    { id: "appearance", label: t("settingsHub.section.appearance"), icon: MdPalette, scope: "device" },
    ...(account && notifications
      ? [{ id: "notifications" as const, label: t("common.notifications"), icon: MdNotificationsNone }]
      : []),
    { id: "general", label: t("settingsHub.section.general"), icon: MdTune, scope: "device" },
    // Only with a call running: these are drawn by the room (see lib/settingsHub).
    ...(call ? [{ id: "call" as const, label: t("settingsHub.section.call"), icon: MdCall, scope: "device" as const }] : []),
    // A keyboard's shortcuts, for the screens that have one.
    ...(wide ? [{ id: "shortcuts" as const, label: t("settingsHub.section.shortcuts"), icon: MdOutlineKeyboard, scope: "device" as const }] : []),
    ...(account && !account.bot
      ? [{ id: "extras" as const, label: t("settingsHub.section.extras"), icon: MdExtension }]
      : []),
    { id: "about", label: t("mobile.about"), icon: MdInfoOutline },
  ];

  // A section can go away under the dialog (the call ends, the window narrows).
  const offered = sections.find((s) => s.id === requested) ?? null;
  const current = offered ?? (wide ? sections[0] : null);

  useEffect(() => {
    markFeatureUsed(SETTINGS_HUB_BADGE);
  }, []);

  const currentId = current?.id ?? null;
  useEffect(() => {
    if (currentId) trackSettingsEvent(SETTINGS_HUB_EVENTS.section(currentId));
  }, [currentId]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") closeSettings();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Android's back button goes up a level on a phone before it closes.
  useBackHandler(true, () => {
    if (!wide && current) setSettingsSection(null);
    else closeSettings();
  });

  const closeButton = (
    <button
      type="button"
      onClick={closeSettings}
      aria-label={t("common.close")}
      className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-lg text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-100"
    >
      <MdClose className="h-5 w-5" />
    </button>
  );

  const scope = current?.scope && (
    <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
      {current.scope === "device" ? t("settingsHub.scopeDevice") : t("settingsHub.scopeAccount")}
    </p>
  );

  const content = current && <SectionContent id={current.id} onRequestAccount={onRequestAccount} />;

  if (!wide) {
    return (
      <div role="dialog" aria-modal="true" aria-label={t("settingsHub.title")} className="fixed inset-0 z-50 flex flex-col bg-zinc-50 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] dark:bg-black">
        <div className="flex shrink-0 items-center gap-2 border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
          {current && (
            <button
              type="button"
              onClick={() => setSettingsSection(null)}
              aria-label={t("common.back")}
              className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-lg text-zinc-600 dark:text-zinc-300"
            >
              <MdArrowBack className="h-5 w-5" />
            </button>
          )}
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-base font-semibold text-zinc-950 dark:text-zinc-50">
              {current ? current.label : t("settingsHub.title")}
            </h2>
            {scope}
          </div>
          {closeButton}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
          {content ?? (
            <div className={`${card} divide-y divide-zinc-100 dark:divide-zinc-900`}>
              {sections.map((s) => (
                <Row key={s.id} onClick={() => setSettingsSection(s.id)} icon={s.icon} label={s.label} />
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={closeSettings}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("settingsHub.title")}
        onClick={(e) => e.stopPropagation()}
        className="golive-dialog-card flex h-[min(44rem,90dvh)] w-full max-w-3xl overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-950"
      >
        <nav className="flex w-52 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-zinc-200 p-3 dark:border-zinc-800">
          <p className="px-2 pt-1 pb-2 text-base font-semibold text-zinc-950 dark:text-zinc-50">{t("settingsHub.title")}</p>
          {sections.map((s) => {
            const active = s.id === current?.id;
            return (
              <button
                key={s.id}
                type="button"
                aria-current={active ? "page" : undefined}
                onClick={() => setSettingsSection(s.id)}
                className={`flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-left text-sm font-medium transition ${
                  active
                    ? "bg-zinc-100 text-zinc-950 dark:bg-zinc-900 dark:text-zinc-50"
                    : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-50"
                }`}
              >
                <s.icon className="h-4 w-4 shrink-0" />
                <span className="min-w-0 flex-1 truncate">{s.label}</span>
              </button>
            );
          })}
        </nav>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex shrink-0 items-start justify-between gap-2 px-5 pt-4 pb-3">
            <div className="min-w-0">
              <h2 className="truncate text-lg font-semibold text-zinc-950 dark:text-zinc-50">{current?.label}</h2>
              {scope}
            </div>
            {closeButton}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-5">{content}</div>
        </div>
      </div>
    </div>
  );
}

function SectionContent({
  id,
  onRequestAccount,
}: {
  id: SettingsSection;
  onRequestAccount: (mode: AccountModalMode) => void;
}) {
  switch (id) {
    case "account":
      return <AccountSection onRequestAccount={onRequestAccount} />;
    case "appearance":
      return <AppearanceSection />;
    case "notifications":
      return <NotificationSettingsScreen embedded />;
    case "general":
      return <GeneralSection />;
    case "call":
      return <div ref={setSettingsCallSlot} className="flex flex-col gap-1" />;
    case "shortcuts":
      return <ShortcutsSection onRequestAccount={() => onRequestAccount("create")} />;
    case "extras":
      return <ExtrasSection />;
    case "about":
      return <AboutSection />;
  }
}

function FieldLabel({ children }: { children: ReactNode }) {
  return <p className="mb-1.5 text-xs font-semibold text-zinc-500 dark:text-zinc-400">{children}</p>;
}

function AccountSection({ onRequestAccount }: { onRequestAccount: (mode: AccountModalMode) => void }) {
  const t = useT();
  const { account, points, logout } = useAuth();
  const state = useSignalingSelector(selectAccountMenu, shallow);
  const appShell = useIsAppShell();
  // Counted here when it is what this person sees — see lib/accountDelete.ts.
  const accountDelete = useFeature(ACCOUNT_DELETE_FEATURE, { track: Boolean(account && !account.bot) });
  const [renaming, setRenaming] = useState(false);
  const [nameInput, setNameInput] = useState("");

  const name = account?.displayName ?? state.name ?? "";
  const isAdmin = Boolean(account?.flags?.includes("ADMIN") || state.account?.flags?.includes("ADMIN"));

  function handleRename(e: FormEvent) {
    e.preventDefault();
    const trimmed = nameInput.trim();
    if (!trimmed || trimmed === state.name) return;
    trackEvent("name_change");
    signalingClient.register(trimmed);
    setRenaming(false);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className={`${card} flex items-center gap-3 p-4`}>
        {/* eslint-disable-next-line @next/next/no-img-element -- an avatar from any host */}
        <img
          src={account?.avatarUrl || DEFAULT_AVATAR_PATH}
          alt=""
          className={`h-12 w-12 shrink-0 ${avatarShapeClass(account?.avatarUrl)} object-cover`}
        />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-zinc-950 dark:text-zinc-50">{name || t("mobile.noNameYet")}</p>
          <p className="truncate text-sm text-zinc-500 dark:text-zinc-400">
            {account ? `@${account.username}` : name ? t("mobile.guest") : t("mobile.notSignedIn")}
          </p>
        </div>
        {name && (
          <span className="flex shrink-0 items-center gap-1 text-sm font-medium tabular-nums text-zinc-500 dark:text-zinc-400">
            <BsCoin className="h-4 w-4 text-amber-500" />
            {points}
          </span>
        )}
      </div>

      {account ? (
        <>
          <Section>
            <Row href={`/user/${account.username}`} onClick={closeSettings} icon={MdPersonOutline} label={t("accountMenu.myProfile")} />
            <Row
              onClick={() => {
                closeSettings();
                openDirectMessages(null);
              }}
              icon={MdChatBubbleOutline}
              label={t("common.messages")}
            />
            <Row href="/friends" onClick={closeSettings} icon={MdPeopleOutline} label={t("common.friends")} />
            {!account.bot && (
              <Row
                onClick={() => window.open(DEVELOPERS_URL, "_blank", "noopener")}
                icon={MdSmartToy}
                label={t("accountMenu.developerPortal")}
              />
            )}
            {isAdmin && (
              <Row href="/admin" onClick={closeSettings} icon={MdAdminPanelSettings} label={t("accountMenu.adminPanel")} tone="purple" />
            )}
          </Section>

          {/* Each brings its own collapsible block, padding included. */}
          <div className={`${card} py-1 empty:hidden`}>
            <EmailVerification />
            <AccountConnections />
            <AuthorizedApps />
          </div>

          <Section>
            <Row
              onClick={() => {
                logout();
                closeSettings();
              }}
              icon={MdLogout}
              label={t("accountMenu.signOut")}
              tone="red"
              chevron={false}
            />
            {accountDelete.enabled && !account.bot && (
              <Row href="/me/excluir" onClick={closeSettings} icon={MdDeleteOutline} label={t("accountDelete.row")} tone="danger" />
            )}
          </Section>
        </>
      ) : (
        <>
          {/* A name without an account is a browser's thing: the app itself is
              account-only (see the home page), so there it is not offered. */}
          {!appShell &&
            (renaming ? (
              <form onSubmit={handleRename} className={`${card} flex flex-col gap-3 p-4`}>
                <label htmlFor="settings-name" className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  {t("common.newName")}
                </label>
                <input
                  id="settings-name"
                  autoFocus
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  maxLength={24}
                  placeholder={state.name ?? ""}
                  className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
                />
                {state.nameError && <p className="text-sm text-red-500">{state.nameError}</p>}
                <button
                  type="submit"
                  disabled={!nameInput.trim() || nameInput.trim() === state.name}
                  className="cursor-pointer rounded-lg bg-zinc-950 px-3 py-2 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
                >
                  {t("common.save")}
                </button>
              </form>
            ) : (
              <Section>
                <Row
                  onClick={() => {
                    setNameInput(state.name ?? "");
                    setRenaming(true);
                  }}
                  icon={MdPersonOutline}
                  label={name ? t("accountMenu.changeName") : t("mobile.pickAName")}
                />
              </Section>
            ))}
          <div className={`${card} flex flex-col gap-2 p-4`}>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">{t("mobile.accountPitch")}</p>
            <button
              type="button"
              onClick={() => onRequestAccount("create")}
              className="flex cursor-pointer items-center justify-center gap-2 rounded-lg bg-zinc-950 px-3 py-2 text-sm font-medium text-white transition hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
            >
              <MdPersonAdd className="h-4 w-4" />
              {t("common.createAnAccount")}
            </button>
            <button
              type="button"
              onClick={() => onRequestAccount("login")}
              className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
            >
              <MdLogin className="h-4 w-4" />
              {t("common.iAlreadyHaveAnAccount")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function AppearanceSection() {
  const t = useT();
  const { openPopup } = useNtPopups();
  return (
    <div className="flex flex-col gap-4">
      <div>
        <FieldLabel>{t("common.theme")}</FieldLabel>
        <ThemeSegmented />
      </div>
      <div>
        <FieldLabel>{t("languageToggle.language")}</FieldLabel>
        <LanguagePicker />
      </div>
      <div className="flex flex-col gap-1">
        <RoomThemeToggle />
        {/* The published themes, worn or made, are their own place. */}
        <button
          type="button"
          onClick={() => {
            closeSettings();
            void openPopup("theme_hub", { data: {} });
          }}
          className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg px-2 py-2 text-left text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-900"
        >
          {t("common.themes")}
          <MdChevronRight className="h-5 w-5 shrink-0 text-zinc-400" />
        </button>
      </div>
    </div>
  );
}

function GeneralSection() {
  const appShell = useIsAppShell();
  return (
    <div className="flex flex-col gap-1">
      <SoundEffectsToggle />
      <ProfileSongToggle />
      <DoubleClickFocusToggle />
      <OpenRoomsInAppToggle />
      {/* Only the app is ever reopened anywhere (see lib/lastScreen). */}
      {appShell && (
        <div className="mt-3">
          <ReopenLastScreenSetting />
        </div>
      )}
    </div>
  );
}

function ShortcutsSection({ onRequestAccount }: { onRequestAccount: () => void }) {
  const { account } = useAuth();
  const hasAccount = Boolean(account);
  return (
    <div className="flex flex-col gap-4">
      <div>
        <KeyboardShortcutsContent onClose={closeSettings} hasAccount={hasAccount} onRequestAccount={onRequestAccount} />
      </div>
      <div className="self-start">
        <ClearShortcutsButton onClose={closeSettings} hasAccount={hasAccount} onRequestAccount={onRequestAccount} />
      </div>
    </div>
  );
}

function ExtrasSection() {
  const { account } = useAuth();
  if (!account) return null;
  return (
    <div className="flex flex-col gap-4">
      <DiscordRpcSetting />
      <MyEmojisSetting flags={account.flags} />
      <PartnerAdsSetting features={account.features} />
      <ReceiveCameraEffectsSetting cardClassName={card} />
    </div>
  );
}

function AboutSection() {
  const t = useT();
  const appShell = useIsAppShell();
  const { show: showBot } = useDiscordBotHidden();
  return (
    <div className="flex flex-col gap-4">
      <Section>
        <Row
          onClick={() => window.open("https://discord.gg/nemtudo", "_blank", "noopener")}
          icon={MdBugReport}
          label={t("watch.watchRoom.reportABug")}
        />
        {!appShell && <Row href="/app" onClick={closeSettings} icon={MdMonitor} label={t("common.desktopApp")} />}
        {showBot && <Row href="/discord-bot" onClick={closeSettings} icon={FaDiscord} label={t("common.discordBot")} />}
        <Row href="/terms" onClick={closeSettings} icon={MdDescription} label={t("common.termsOfUse")} />
      </Section>
      <SocialLinks title={null} className="text-center" />
      <AppVersion />
    </div>
  );
}
