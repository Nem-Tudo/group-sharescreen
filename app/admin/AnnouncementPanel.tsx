"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  clearAnnouncement,
  editAnnouncement,
  fetchCurrentAnnouncement,
  sendAnnouncement,
  type Announcement,
  type AnnouncementButtonAction,
  type AnnouncementColor,
  type AnnouncementDevice,
  type AnnouncementSound,
  type AnnouncementStats,
  type AnnouncementVisibility,
} from "@/lib/adminApi";
import { ANNOUNCEMENT_DEVICES, ANNOUNCEMENT_DEVICE_LABELS } from "@/lib/announcement";
import { AnnouncementBar } from "@/components/AnnouncementBar";
import { useT } from "@/lib/useI18n";
import { translate } from "@/lib/i18n";

const ACTION_OPTIONS: { value: AnnouncementButtonAction; label: string }[] = [
  { value: "open-new-tab", get label() { return translate("admin.announcementPanel.openLinkInANewTab"); } },
  { value: "open-same-tab", get label() { return translate("admin.announcementPanel.openLinkInTheCurrentTab"); } },
  { value: "reload", get label() { return translate("admin.announcementPanel.reloadThePage"); } },
];

const COLOR_OPTIONS: { value: AnnouncementColor; label: string }[] = [
  { value: "blue", get label() { return translate("common.blue"); } },
  { value: "green", get label() { return translate("common.green"); } },
  { value: "red", get label() { return translate("common.red"); } },
];

const VISIBILITY_OPTIONS: { value: AnnouncementVisibility; label: string; hint: string }[] = [
  {
    value: "all",
    get label() { return translate("admin.announcementPanel.whoeverIsOnlineNowWhoeverOpens"); },
    get hint() { return translate("admin.announcementPanel.itKeepsAppearingForAnyoneWho"); },
  },
  {
    value: "online-only",
    get label() { return translate("admin.announcementPanel.onlyWhoeverIsOnlineNow"); },
    get hint() { return translate("admin.announcementPanel.itIsOnlyDeliveredToThose"); },
  },
];

const SOUND_OPTIONS: { value: AnnouncementSound; label: string }[] = [
  { value: "always", get label() { return translate("admin.announcementPanel.playedEveryTimeItAppears"); } },
  { value: "live-only", get label() { return translate("admin.announcementPanel.playedOnlyForWhoeverReceivesIt"); } },
  { value: "off", get label() { return translate("common.off"); } },
];

const STATS_POLL_INTERVAL_MS = 3000;

type Mode = "create" | "edit";

export function AnnouncementPanel() {
  const t = useT();
  // undefined = still loading the current state from the server.
  const [active, setActive] = useState<Announcement | null | undefined>(undefined);
  const [stats, setStats] = useState<AnnouncementStats | null>(null);

  const [mode, setMode] = useState<Mode>("create");
  const [customId, setCustomId] = useState("");
  const [text, setText] = useState("");
  const [hasButton, setHasButton] = useState(true);
  const [buttonLabel, setButtonLabel] = useState("");
  const [buttonAction, setButtonAction] = useState<AnnouncementButtonAction>("open-new-tab");
  const [buttonUrl, setButtonUrl] = useState("");
  const [color, setColor] = useState<AnnouncementColor>("blue");
  const [dismissible, setDismissible] = useState(true);
  const [visibility, setVisibility] = useState<AnnouncementVisibility>("all");
  const [sound, setSound] = useState<AnnouncementSound>("always");
  const [persistent, setPersistent] = useState(false);
  // Everything ticked by default: an announcement is site-wide unless
  // somebody deliberately narrows it.
  const [devices, setDevices] = useState<AnnouncementDevice[]>(ANNOUNCEMENT_DEVICES);

  const [previewing, setPreviewing] = useState(false);
  const [sending, setSending] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Guards the stats-polling effect against overwriting `active`/`stats`
  // with a response that landed after this component unmounted.
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    fetchCurrentAnnouncement()
      .then(({ announcement, stats }) => {
        if (!mountedRef.current) return;
        setActive(announcement);
        setStats(stats);
      })
      .catch(() => {
        if (mountedRef.current) setActive(null);
      });
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Polls the currently active announcement's live engagement numbers —
  // deliberately only refreshes `active`/`stats`, never the form fields
  // below, so this doesn't clobber whatever the admin is mid-typing in an
  // edit.
  useEffect(() => {
    if (!active) return;
    const interval = setInterval(() => {
      fetchCurrentAnnouncement()
        .then(({ announcement, stats }) => {
          if (!mountedRef.current) return;
          setActive(announcement);
          setStats(stats);
        })
        .catch(() => {
          // Transient poll failure — keep showing the last known numbers.
        });
    }, STATS_POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [active?.id]);

  const needsUrl = buttonAction !== "reload";

  function toggleDevice(device: AnnouncementDevice) {
    setDevices((prev) =>
      prev.includes(device) ? prev.filter((d) => d !== device) : [...prev, device]
    );
  }

  const previewAnnouncement: Announcement = {
    id: "preview",
    version: 1,
    text: text.trim() || t("admin.announcementPanel.theNoticeTextAppearsHere"),
    hasButton,
    buttonLabel: buttonLabel.trim() || t("common.button"),
    buttonAction,
    buttonUrl: needsUrl ? buttonUrl.trim() || null : null,
    color,
    dismissible,
    visibility,
    sound,
    persistent,
    devices,
  };

  function resetForm() {
    setMode("create");
    setCustomId("");
    setText("");
    setHasButton(true);
    setButtonLabel("");
    setButtonAction("open-new-tab");
    setButtonUrl("");
    setColor("blue");
    setDismissible(true);
    setVisibility("all");
    setSound("always");
    setPersistent(false);
    setDevices(ANNOUNCEMENT_DEVICES);
  }

  function startEditing() {
    if (!active) return;
    setMode("edit");
    setCustomId(active.id);
    setText(active.text);
    setHasButton(active.hasButton);
    setButtonLabel(active.buttonLabel);
    setButtonAction(active.buttonAction);
    setButtonUrl(active.buttonUrl ?? "");
    setColor(active.color);
    setDismissible(active.dismissible);
    setVisibility(active.visibility);
    setSound(active.sound);
    setPersistent(active.persistent);
    // A stored announcement from before this field existed (or from an older
    // API) has no list — that means every device, so that is what the form
    // shows rather than an empty, unsubmittable selection.
    setDevices(active.devices?.length ? active.devices : ANNOUNCEMENT_DEVICES);
    setPreviewing(false);
    setError(null);
  }

  async function handleSend(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSending(true);
    try {
      const input = {
        text: text.trim(),
        hasButton,
        buttonLabel: buttonLabel.trim(),
        buttonAction,
        buttonUrl: needsUrl ? buttonUrl.trim() : undefined,
        color,
        dismissible,
        visibility,
        sound,
        persistent,
        devices,
      };
      const { announcement, stats } =
        mode === "edit" && active
          ? await editAnnouncement(active.id, input)
          : await sendAnnouncement({ ...input, id: customId.trim() || undefined });
      setActive(announcement);
      setStats(stats);
      setPreviewing(false);
      resetForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("admin.announcementPanel.couldNotSaveTheNotice"));
    } finally {
      setSending(false);
    }
  }

  async function handleClear() {
    setClearing(true);
    setError(null);
    try {
      await clearAnnouncement();
      setActive(null);
      setStats(null);
      if (mode === "edit") resetForm();
    } catch {
      setError(t("admin.announcementPanel.couldNotRemoveTheNotice"));
    } finally {
      setClearing(false);
    }
  }

  return (
    <div className="mb-8 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">{t("admin.announcementPanel.siteNotice")}</h2>
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
        {t("admin.announcementPanel.sendsAMessageAtTheTop")}
      </p>

      {active && (
        <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
          <div className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 flex-1 truncate">{t("admin.announcementPanel.thereIsAnActiveNoticeRight")}{active.text}&quot;</span>
            <button
              type="button"
              onClick={startEditing}
              className="shrink-0 font-semibold underline underline-offset-2"
            >
              {t("common.edit")}
            </button>
            <button
              type="button"
              onClick={handleClear}
              disabled={clearing}
              className="shrink-0 font-semibold underline underline-offset-2 disabled:opacity-50"
            >
              {clearing ? t("common.removing") : t("common.remove")}
            </button>
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 border-t border-amber-300/60 pt-2 dark:border-amber-900/60">
            <span>
              {t("admin.announcementPanel.views")} <strong>{stats?.views ?? 0}</strong>
            </span>
            <span>
              {t("admin.announcementPanel.clicksOnTheButton")} <strong>{stats?.buttonClicks ?? 0}</strong>
            </span>
            <span>
              {t("admin.announcementPanel.clicksOnTheX")} <strong>{stats?.xClicks ?? 0}</strong>
            </span>
          </div>
        </div>
      )}

      {mode === "edit" && (
        <div className="mt-3 flex items-center justify-between gap-2 rounded-lg border border-blue-300 bg-blue-50 px-3 py-2 text-xs text-blue-800 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-300">
          <span>{t("admin.announcementPanel.editingTheActiveNoticeTheSame")}</span>
          <button type="button" onClick={resetForm} className="shrink-0 font-semibold underline underline-offset-2">
            {t("admin.announcementPanel.cancelEditing")}
          </button>
        </div>
      )}

      <form onSubmit={handleSend} className="mt-4 flex flex-col gap-3">
        <div>
          <label
            htmlFor="announcement-text"
            className="text-xs font-medium text-zinc-600 dark:text-zinc-400"
          >
            {t("common.text")}
          </label>
          <textarea
            id="announcement-text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={300}
            rows={2}
            placeholder={t("admin.announcementPanel.exScheduledMaintenanceAt10pm")}
            className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
          />
        </div>

        {mode === "create" && (
          <div>
            <label
              htmlFor="announcement-id"
              className="text-xs font-medium text-zinc-600 dark:text-zinc-400"
            >
              {t("admin.announcementPanel.idOptional")}
            </label>
            <input
              id="announcement-id"
              value={customId}
              onChange={(e) => setCustomId(e.target.value)}
              maxLength={64}
              placeholder={t("admin.announcementPanel.leaveBlankToGenerateAutomatically")}
              className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
            />
          </div>
        )}

        <label className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
          <input
            type="checkbox"
            checked={hasButton}
            onChange={(e) => setHasButton(e.target.checked)}
            className="h-4 w-4 rounded border-zinc-300 dark:border-zinc-700"
          />
          {t("admin.announcementPanel.showButton")}
        </label>

        {hasButton && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label
                htmlFor="announcement-button-label"
                className="text-xs font-medium text-zinc-600 dark:text-zinc-400"
              >
                {t("common.buttonLabel")}
              </label>
              <input
                id="announcement-button-label"
                value={buttonLabel}
                onChange={(e) => setButtonLabel(e.target.value)}
                maxLength={40}
                placeholder={t("admin.announcementPanel.exLearnMore")}
                className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
              />
            </div>
            <div>
              <label
                htmlFor="announcement-action"
                className="text-xs font-medium text-zinc-600 dark:text-zinc-400"
              >
                {t("admin.announcementPanel.buttonAction")}
              </label>
              <select
                id="announcement-action"
                value={buttonAction}
                onChange={(e) => setButtonAction(e.target.value as AnnouncementButtonAction)}
                className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
              >
                {ACTION_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}

        {hasButton && needsUrl && (
          <div>
            <label
              htmlFor="announcement-url"
              className="text-xs font-medium text-zinc-600 dark:text-zinc-400"
            >
              {t("common.link")}
            </label>
            <input
              id="announcement-url"
              value={buttonUrl}
              onChange={(e) => setButtonUrl(e.target.value)}
              placeholder="https://..."
              className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
            />
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:items-end">
          <div>
            <label
              htmlFor="announcement-color"
              className="text-xs font-medium text-zinc-600 dark:text-zinc-400"
            >
              {t("common.color")}
            </label>
            <select
              id="announcement-color"
              value={color}
              onChange={(e) => setColor(e.target.value as AnnouncementColor)}
              className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
            >
              {COLOR_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
            <input
              type="checkbox"
              checked={dismissible}
              onChange={(e) => setDismissible(e.target.checked)}
              className="h-4 w-4 rounded border-zinc-300 dark:border-zinc-700"
            />
            {t("admin.announcementPanel.showXToClose")}
          </label>
        </div>

        <div>
          <label
            htmlFor="announcement-visibility"
            className="text-xs font-medium text-zinc-600 dark:text-zinc-400"
          >
            {t("admin.announcementPanel.whoSeesIt")}
          </label>
          <select
            id="announcement-visibility"
            value={visibility}
            onChange={(e) => setVisibility(e.target.value as AnnouncementVisibility)}
            className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
          >
            {VISIBILITY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            {VISIBILITY_OPTIONS.find((opt) => opt.value === visibility)?.hint}
          </p>
        </div>

        <fieldset>
          <legend className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
            {t("admin.announcementPanel.whereItAppears")}
          </legend>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {ANNOUNCEMENT_DEVICES.map((device) => (
              <label
                key={device}
                className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400"
              >
                <input
                  type="checkbox"
                  checked={devices.includes(device)}
                  onChange={() => toggleDevice(device)}
                  className="h-4 w-4 rounded border-zinc-300 dark:border-zinc-700"
                />
                {ANNOUNCEMENT_DEVICE_LABELS[device]}
              </label>
            ))}
          </div>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            {devices.length === 0
              ? t("admin.announcementPanel.selectAtLeastOneWithNone")
              : t("admin.announcementPanel.theNoticeIsDeliveredToEveryone")}
          </p>
        </fieldset>

        <label className="flex items-start gap-2 text-sm text-zinc-600 dark:text-zinc-400">
          <input
            type="checkbox"
            checked={persistent}
            onChange={(e) => setPersistent(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 rounded border-zinc-300 dark:border-zinc-700"
          />
          <span>
            {t("admin.announcementPanel.persistent")}
            <span className="block text-xs text-zinc-500 dark:text-zinc-400">
              {visibility === "online-only"
                ? t("admin.announcementPanel.itKeepsAppearingForThoseWho")
                : t("admin.announcementPanel.itOnlyGoesAwayWhenThe")}
            </span>
          </span>
        </label>

        <div>
          <label
            htmlFor="announcement-sound"
            className="text-xs font-medium text-zinc-600 dark:text-zinc-400"
          >
            {t("admin.announcementPanel.soundEffect")}
          </label>
          <select
            id="announcement-sound"
            value={sound}
            onChange={(e) => setSound(e.target.value as AnnouncementSound)}
            className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
          >
            {SOUND_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {error && <p className="text-sm text-red-500">{error}</p>}

        <div className="mt-1 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setPreviewing((p) => !p)}
            className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            {previewing ? t("admin.announcementPanel.hidePreview") : t("common.preview")}
          </button>
          <button
            type="submit"
            disabled={
              sending ||
              !text.trim() ||
              devices.length === 0 ||
              (hasButton && (!buttonLabel.trim() || (needsUrl && !buttonUrl.trim())))
            }
            className="rounded-lg bg-zinc-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
          >
            {sending ? t("common.saving") : mode === "edit" ? t("common.saveChanges") : t("admin.announcementPanel.sendNotice")}
          </button>
        </div>
      </form>

      {previewing && (
        <div className="mt-4 overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
          <AnnouncementBar announcement={previewAnnouncement} onDismiss={() => setPreviewing(false)} />
        </div>
      )}
    </div>
  );
}
