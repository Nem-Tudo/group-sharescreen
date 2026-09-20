"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  MdArrowBack,
  MdBedtime,
  MdCall,
  MdCardGiftcard,
  MdChatBubbleOutline,
  MdDevices,
  MdGroups,
  MdNotificationsActive,
  MdPalette,
  MdPersonAdd,
} from "react-icons/md";
import { useAuth } from "@/lib/AuthContext";
import { useNotifications } from "@/lib/useNotifications";
import {
  formatTimeOfDay,
  parseTimeOfDay,
  useNotifyPrefs,
} from "@/lib/notifyPrefs";
import {
  fetchPushDevices,
  fetchPushConfig,
  removePushDevice,
  sendTestPush,
  type NotifyKind,
  type PushDevice,
} from "@/lib/pushApi";
import { trackFeatureEvent } from "@/lib/features";
import { markFeatureUsed } from "@/components/NewBadge";
import { NOTIFICATION_SETTINGS_BADGE, NOTIFICATION_SETTINGS_EVENTS } from "@/lib/notificationSettings";
import { useT } from "@/lib/useI18n";

// "Notificações" — everything about being told something, on one screen.
//
// It exists because the answer to "por que meu celular não tocou" was, until
// now, unanswerable from inside the app: the permission lived behind a bell in
// a chat header, the list of devices was written to the database and never
// read back, the switch that silences everything only silenced the half of it
// that runs with the app open, and the probe that tests the whole chain had no
// button. Each of those is a row here.
//
// Four blocks, in the order somebody debugging would want them:
//
//   1. Is this device allowed to show notifications at all, and does the whole
//      chain work? (permission, mute, the test)
//   2. What am I told about? (a switch per kind)
//   3. When am I *not* told? (quiet hours)
//   4. Where does it arrive? (the devices, and turning one off)
//
// The first block is per browser; the rest is per account and follows the
// person to a new phone.

const card =
  "overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950";

/** The icon and label for each kind, in the order the screen lists them. */
const KINDS: { kind: NotifyKind; icon: typeof MdChatBubbleOutline; labelKey: string }[] = [
  { kind: "dm", icon: MdChatBubbleOutline, labelKey: "notificationSettings.kindDm" },
  { kind: "call", icon: MdCall, labelKey: "notificationSettings.kindCall" },
  { kind: "group-message", icon: MdGroups, labelKey: "notificationSettings.kindGroup" },
  { kind: "friend-request", icon: MdPersonAdd, labelKey: "notificationSettings.kindFriend" },
  { kind: "theme-like", icon: MdPalette, labelKey: "notificationSettings.kindThemeLike" },
  { kind: "gift", icon: MdCardGiftcard, labelKey: "notificationSettings.kindGift" },
];

export function NotificationSettingsScreen() {
  const t = useT();
  const { account } = useAuth();
  const { supported, permission, muted, enable, setMuted } = useNotifications();
  const { prefs, ready, setKindMuted, setQuietHours, setQuietAllowCalls } = useNotifyPrefs();
  const [devices, setDevices] = useState<PushDevice[] | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  // Whether the deployment can send anything at all. Without it the screen
  // would offer switches over a chain that has no sender behind it, which is
  // the one thing worse than no screen.
  const [pushEnabled, setPushEnabled] = useState<boolean | null>(null);

  // The badge next to the row that leads here goes away the moment somebody
  // arrives — the feature *is* the screen, so opening it is using it.
  useEffect(() => {
    markFeatureUsed(NOTIFICATION_SETTINGS_BADGE);
    trackFeatureEvent(NOTIFICATION_SETTINGS_EVENTS.open);
  }, []);

  const reloadDevices = useCallback(async () => {
    setDevices(await fetchPushDevices());
  }, []);

  useEffect(() => {
    if (!account) return;
    void fetchPushDevices().then(setDevices);
    void fetchPushConfig().then((config) => setPushEnabled(config?.enabled ?? false));
  }, [account]);

  async function onTest() {
    setTesting(true);
    setTestResult(null);
    trackFeatureEvent(NOTIFICATION_SETTINGS_EVENTS.test);
    const result = await sendTestPush();
    setTesting(false);
    // Said under the button rather than in a dialog: the answer to "chegou?"
    // is the notification itself, and a modal covering the screen is the one
    // thing guaranteed to be in the way of seeing it.
    setTestResult(
      result.ok
        ? { ok: true, message: t("notificationSettings.testSent") }
        : { ok: false, message: result.error ?? t("common.couldNotSend") }
    );
  }

  async function onRemoveDevice(device: PushDevice) {
    if (!window.confirm(t("notificationSettings.removeDeviceConfirm"))) return;
    trackFeatureEvent(NOTIFICATION_SETTINGS_EVENTS.deviceRemoved);
    if (await removePushDevice(device.id)) await reloadDevices();
  }

  if (!account) {
    return (
      <Screen title={t("common.notifications")}>
        <p className="px-1 py-6 text-center text-sm text-zinc-500 dark:text-zinc-400">
          {t("notificationSettings.signInFirst")}
        </p>
      </Screen>
    );
  }

  const quietOn = prefs.quietFrom !== null && prefs.quietTo !== null;

  return (
    <Screen title={t("common.notifications")}>
      {/* 1 — this device */}
      <section className={`${card} p-4`}>
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          {t("notificationSettings.thisDevice")}
        </p>

        {!supported ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            {t("notificationSettings.unsupported")}
          </p>
        ) : permission === "denied" ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            {t("notificationBell.notificationsBlockedInTheBrowserSettings")}
          </p>
        ) : permission !== "granted" ? (
          <button
            type="button"
            onClick={() => void enable()}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition active:scale-[0.98]"
          >
            <MdNotificationsActive className="h-4 w-4" />
            {t("notificationInboxBell.turnOnNotificationsOnThisDevice")}
          </button>
        ) : (
          <>
            <Toggle
              label={t("notificationSettings.muteThisBrowser")}
              hint={t("notificationSettings.muteThisBrowserHint")}
              on={muted}
              onChange={(next) => setMuted(next)}
            />
            <button
              type="button"
              onClick={() => void onTest()}
              disabled={testing}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-zinc-300 px-4 py-2.5 text-sm font-semibold text-zinc-800 transition active:scale-[0.98] disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200"
            >
              <MdNotificationsActive className="h-4 w-4" />
              {testing ? t("notificationSettings.testing") : t("notificationSettings.test")}
            </button>
            {testResult && (
              <p
                className={`mt-2 text-xs leading-snug ${
                  testResult.ok
                    ? "text-emerald-600 dark:text-emerald-500"
                    : "text-red-600 dark:text-red-400"
                }`}
              >
                {testResult.message}
              </p>
            )}
            <p className="mt-2 text-xs leading-snug text-zinc-500 dark:text-zinc-400">
              {t("notificationSettings.testHint")}
            </p>
          </>
        )}
      </section>

      {pushEnabled === false && (
        <p className="px-1 text-xs leading-snug text-amber-600 dark:text-amber-500">
          {t("notificationSettings.pushUnavailable")}
        </p>
      )}

      {/* 2 — what about */}
      <section className={`${card} p-4`}>
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          {t("notificationSettings.whatAbout")}
        </p>
        <p className="mb-3 text-xs leading-snug text-zinc-500 dark:text-zinc-400">
          {t("notificationSettings.whatAboutHint")}
        </p>
        <div className="flex flex-col gap-1">
          {KINDS.map(({ kind, icon: Icon, labelKey }) => (
            <Toggle
              key={kind}
              icon={Icon}
              label={t(labelKey)}
              // The switch reads as "on", so the stored value — which is the
              // list of what is *off* — is inverted here rather than in the
              // store. See the API's NotifyPrefsDoc on why it is stored that way.
              on={ready && !prefs.mutedKinds.includes(kind)}
              disabled={!ready}
              onChange={(next) => {
                trackFeatureEvent(NOTIFICATION_SETTINGS_EVENTS.kindMuted);
                void setKindMuted(kind, !next);
              }}
            />
          ))}
        </div>
      </section>

      {/* 3 — quiet hours */}
      <section className={`${card} p-4`}>
        <p className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          <MdBedtime className="h-4 w-4" />
          {t("notificationSettings.quietHours")}
        </p>
        <p className="mb-3 text-xs leading-snug text-zinc-500 dark:text-zinc-400">
          {t("notificationSettings.quietHoursHint")}
        </p>
        <Toggle
          label={t("notificationSettings.quietHoursOn")}
          on={quietOn}
          disabled={!ready}
          onChange={(next) => {
            trackFeatureEvent(NOTIFICATION_SETTINGS_EVENTS.quietHours);
            // A first "on" needs a window to be a window at all; 23:00–07:00
            // is the one somebody who presses this almost always means.
            void setQuietHours(next ? 23 * 60 : null, next ? 7 * 60 : null);
          }}
        />
        {quietOn && (
          <>
            <div className="mt-3 flex items-center gap-3">
              <TimeField
                label={t("notificationSettings.from")}
                value={formatTimeOfDay(prefs.quietFrom)}
                onChange={(value) => {
                  const minutes = parseTimeOfDay(value);
                  if (minutes !== null) void setQuietHours(minutes, prefs.quietTo);
                }}
              />
              <TimeField
                label={t("notificationSettings.to")}
                value={formatTimeOfDay(prefs.quietTo)}
                onChange={(value) => {
                  const minutes = parseTimeOfDay(value);
                  if (minutes !== null) void setQuietHours(prefs.quietFrom, minutes);
                }}
              />
            </div>
            <div className="mt-3">
              <Toggle
                icon={MdCall}
                label={t("notificationSettings.quietAllowCalls")}
                hint={t("notificationSettings.quietAllowCallsHint")}
                on={prefs.quietAllowCalls}
                onChange={(next) => void setQuietAllowCalls(next)}
              />
            </div>
          </>
        )}
      </section>

      {/* 4 — where it arrives */}
      <section className={`${card} p-4`}>
        <p className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          <MdDevices className="h-4 w-4" />
          {t("notificationSettings.devices")}
        </p>
        <p className="mb-3 text-xs leading-snug text-zinc-500 dark:text-zinc-400">
          {t("notificationSettings.devicesHint")}
        </p>
        {devices === null ? (
          <p className="py-2 text-sm text-zinc-500 dark:text-zinc-400">{t("common.loading")}</p>
        ) : devices.length === 0 ? (
          <p className="py-2 text-sm text-zinc-500 dark:text-zinc-400">
            {t("notificationSettings.noDevices")}
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {devices.map((device) => (
              <li
                key={device.id}
                className="flex items-center gap-3 rounded-lg px-1 py-2"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    {describeDevice(device)}
                    {device.current && (
                      <span className="ml-2 rounded-md bg-blue-600 px-1.5 py-0.5 text-[10px] font-bold uppercase text-white">
                        {t("notificationSettings.thisOne")}
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 block text-xs text-zinc-500 dark:text-zinc-400">
                    {t("notificationSettings.lastUsed", { when: relativeDay(device.lastSeenAt, t) })}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => void onRemoveDevice(device)}
                  className="shrink-0 rounded-lg px-2 py-1 text-xs font-semibold text-red-600 transition hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
                >
                  {t("notificationSettings.removeDevice")}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </Screen>
  );
}

// ─── Pieces ───────────────────────────────────────────────────────────────

function Screen({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-3 p-3 pb-10">
      <div className="flex items-center gap-2 px-1 pt-1">
        <Link
          href="/me"
          aria-label={title}
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 transition hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900"
        >
          <MdArrowBack className="h-5 w-5" />
        </Link>
        <h1 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">{title}</h1>
      </div>
      {children}
    </div>
  );
}

function Toggle({
  label,
  hint,
  on,
  onChange,
  disabled,
  icon: Icon,
}: {
  label: string;
  hint?: string;
  on: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  icon?: typeof MdChatBubbleOutline;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className="flex w-full cursor-pointer items-start gap-3 rounded-lg p-2 text-left disabled:opacity-50"
    >
      {Icon && <Icon className="mt-0.5 h-5 w-5 shrink-0 text-zinc-500 dark:text-zinc-400" />}
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-zinc-900 dark:text-zinc-100">{label}</span>
        {hint && (
          <span className="mt-0.5 block text-xs leading-snug text-zinc-500 dark:text-zinc-400">
            {hint}
          </span>
        )}
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
  );
}

function TimeField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex flex-1 flex-col gap-1">
      <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{label}</span>
      <input
        type="time"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
      />
    </label>
  );
}

/**
 * A device as a person would name it.
 *
 * Read off the user agent the device sent when it registered, which is the
 * only thing we have: nobody is asked to name their phone, and a row that
 * said "webpush" would not tell anybody which of their three browsers it was.
 * Crude on purpose — the goal is "that is my phone" and not a fingerprint.
 */
function describeDevice(device: PushDevice): string {
  if (device.kind === "fcm") return "Android";
  const ua = device.userAgent;
  const os = /Windows/i.test(ua)
    ? "Windows"
    : /Macintosh|Mac OS/i.test(ua)
      ? "Mac"
      : /iPhone|iPad/i.test(ua)
        ? "iPhone"
        : /Android/i.test(ua)
          ? "Android"
          : /Linux/i.test(ua)
            ? "Linux"
            : "";
  // Order matters: every Chromium browser also says "Chrome", and Chrome
  // itself says "Safari" — so the more specific names have to be tried first
  // or everything comes out as Chrome.
  const browser = /Edg\//i.test(ua)
    ? "Edge"
    : /OPR\//i.test(ua)
      ? "Opera"
      : /Firefox\//i.test(ua)
        ? "Firefox"
        : /Chrome\//i.test(ua)
          ? "Chrome"
          : /Safari\//i.test(ua)
            ? "Safari"
            : "";
  const parts = [browser, os].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : "Navegador";
}

/** "hoje", "ontem", or a date — enough to recognise a device nobody uses. */
function relativeDay(at: number, t: (key: string) => string): string {
  const days = Math.floor((Date.now() - at) / 86_400_000);
  if (days <= 0) return t("notificationSettings.today");
  if (days === 1) return t("notificationSettings.yesterday");
  return new Date(at).toLocaleDateString();
}
