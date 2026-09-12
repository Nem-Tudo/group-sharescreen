"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  createPartner,
  deletePartner,
  editPartner,
  fetchAdminPartners,
  setPartnerEmptyPercent,
  type AdminPartner,
  type PartnerInput,
  type PartnerStats,
} from "@/lib/adminApi";
import type { PartnerClickRewardPlacement } from "@/lib/partner";
import { useVideoDurationLabel } from "@/lib/useVideoDuration";
import { BsCoin } from "react-icons/bs";
import { MdContentCopy, MdOpenInNew } from "react-icons/md";
import { useT } from "@/lib/useI18n";
import { translate } from "@/lib/i18n";
import { formatLocale } from "@/lib/i18n";

const STATS_POLL_INTERVAL_MS = 3000;

// One wording for the click-reward placement, shared by the form's select and
// the badge on each ad in the list.
const CLICK_REWARD_PLACEMENT_LABELS: Record<PartnerClickRewardPlacement, string> = {
  get both() { return translate("admin.partnerAdsPanel.cardAndVideo"); },
  get video() { return translate("admin.partnerAdsPanel.videoPopupOnly"); },
  get card() { return translate("admin.partnerAdsPanel.cardOnly"); },
};

const inputClass =
  "mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50";
const colorInputClass =
  "mt-1 h-9 w-full cursor-pointer rounded-md border border-zinc-300 bg-white p-1 dark:border-zinc-700 dark:bg-zinc-900";
const labelClass = "text-xs font-medium text-zinc-600 dark:text-zinc-400";

type Mode = "closed" | "create" | "edit";

const emptyFormDefaults = {
  title: "",
  description: "",
  imageUrl: "",
  buttonLabel: "",
  buttonUrl: "",
  backgroundColor: "#111827",
  textColor: "#f4f4f5",
  buttonBackgroundColor: "#10b981",
  buttonTextColor: "#ffffff",
};

function toDatetimeLocalValue(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function PartnerAdsPanel() {
  const t = useT();
  // undefined = still loading.
  const [partners, setPartners] = useState<AdminPartner[] | undefined>(undefined);
  const [stats, setStats] = useState<Record<string, PartnerStats>>({});
  // Wall-clock time as of the last successful load/poll — used for the
  // "Expirado" badge below. Captured here (inside applyList, only ever
  // called from a fetch's `.then()`) rather than calling Date.now() during
  // render, which would make the render itself impure/non-deterministic.
  const [asOf, setAsOf] = useState(0);
  const [emptyPercent, setEmptyPercent] = useState(0);
  const [emptyPercentInput, setEmptyPercentInput] = useState("0");
  const [savingPercent, setSavingPercent] = useState(false);
  const [percentError, setPercentError] = useState<string | null>(null);

  const [mode, setMode] = useState<Mode>("closed");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyFormDefaults);
  const [weight, setWeight] = useState(1);
  const [neverExpires, setNeverExpires] = useState(true);
  const [expiresInput, setExpiresInput] = useState("");
  // Watch-to-earn reward — kept out of `form` (which is all plain strings
  // fed straight into controlled text inputs) since rewardPoints needs to
  // travel as a number on submit, same reasoning as `weight` above.
  const [rewardVideoUrl, setRewardVideoUrl] = useState("");
  const [rewardPointsInput, setRewardPointsInput] = useState("");
  // Click-to-earn reward — same "kept out of `form`" reasoning as the video
  // reward above. Empty amount means the ad has none, in which case the
  // placement below is never sent.
  const [clickRewardPointsInput, setClickRewardPointsInput] = useState("");
  const [clickRewardPlacement, setClickRewardPlacement] =
    useState<PartnerClickRewardPlacement>("both");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Which ad's report link was just copied, so the button can say so for a
  // couple of seconds. Null also covers "the copy failed" — the link itself is
  // always reachable through the "abrir" anchor next to it, so a browser that
  // refuses clipboard access (an insecure origin, a denied permission) costs
  // the admin a right-click, not the link.
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // What the preview's two buttons should show, from the form as it stands
  // right now. The duration badge is measured off the video the same way the
  // real card measures it, so a bad URL simply shows no badge here either.
  const previewRewardVideo = Boolean(rewardVideoUrl.trim() && rewardPointsInput.trim());
  const previewRewardDuration = useVideoDurationLabel(
    previewRewardVideo ? rewardVideoUrl.trim() : null
  );
  const previewCardClickReward =
    Boolean(clickRewardPointsInput.trim()) && clickRewardPlacement !== "video";

  const mountedRef = useRef(true);
  const initialLoadDone = useRef(false);

  function applyList(data: { partners: AdminPartner[]; emptyPercent: number; stats: Record<string, PartnerStats> }) {
    if (!mountedRef.current) return;
    setPartners(data.partners);
    setStats(data.stats);
    setEmptyPercent(data.emptyPercent);
    setAsOf(Date.now());
    if (!initialLoadDone.current) {
      setEmptyPercentInput(String(data.emptyPercent));
      initialLoadDone.current = true;
    }
  }

  useEffect(() => {
    mountedRef.current = true;
    fetchAdminPartners()
      .then(applyList)
      .catch(() => {
        if (mountedRef.current) setPartners([]);
      });
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Polls live engagement numbers — deliberately only refreshes the list/
  // stats/current-percent display, never emptyPercentInput or the create/
  // edit form fields, so it doesn't clobber whatever the admin is mid-typing.
  useEffect(() => {
    const interval = setInterval(() => {
      fetchAdminPartners()
        .then(applyList)
        .catch(() => {
          // Transient poll failure — keep showing the last known numbers.
        });
    }, STATS_POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  function update<K extends keyof typeof emptyFormDefaults>(key: K, value: (typeof emptyFormDefaults)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function resetForm() {
    setMode("closed");
    setEditingId(null);
    setForm(emptyFormDefaults);
    setWeight(1);
    setNeverExpires(true);
    setExpiresInput("");
    setRewardVideoUrl("");
    setRewardPointsInput("");
    setClickRewardPointsInput("");
    setClickRewardPlacement("both");
    setError(null);
  }

  function startEditing(p: AdminPartner) {
    setMode("edit");
    setEditingId(p.id);
    setForm({
      title: p.title,
      description: p.description,
      imageUrl: p.imageUrl ?? "",
      buttonLabel: p.buttonLabel,
      buttonUrl: p.buttonUrl,
      backgroundColor: p.backgroundColor ?? "#111827",
      textColor: p.textColor ?? "#f4f4f5",
      buttonBackgroundColor: p.buttonBackgroundColor ?? "#10b981",
      buttonTextColor: p.buttonTextColor ?? "#ffffff",
    });
    setWeight(p.weight);
    setNeverExpires(p.expiresAt === null);
    setExpiresInput(p.expiresAt ? toDatetimeLocalValue(p.expiresAt) : "");
    setRewardVideoUrl(p.rewardVideoUrl ?? "");
    setRewardPointsInput(p.rewardPoints != null ? String(p.rewardPoints) : "");
    setClickRewardPointsInput(p.clickRewardPoints != null ? String(p.clickRewardPoints) : "");
    setClickRewardPlacement(p.clickRewardPlacement ?? "both");
    setError(null);
  }

  // The public report lives on this same site (see app/ad/[token]), so
  // the link is built from wherever the panel is open — localhost while
  // developing, the real domain in production — instead of a hardcoded host.
  function reportUrl(token: string): string {
    if (typeof window === "undefined") return "";
    return `${window.location.origin}/ad/${encodeURIComponent(token)}`;
  }

  async function copyReportLink(p: AdminPartner) {
    if (!p.reportToken) return;
    try {
      await navigator.clipboard.writeText(reportUrl(p.reportToken));
      setCopiedId(p.id);
      setTimeout(() => {
        if (mountedRef.current) setCopiedId((current) => (current === p.id ? null : current));
      }, 2000);
    } catch {
      // No clipboard — the anchor beside this button still opens the report.
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const trimmedRewardVideoUrl = rewardVideoUrl.trim();
    const trimmedClickRewardPoints = clickRewardPointsInput.trim();
    if (trimmedRewardVideoUrl && !rewardPointsInput.trim()) {
      setError(t("admin.partnerAdsPanel.setHowManyPointsTheVideo"));
      return;
    }
    setSending(true);
    try {
      const input: PartnerInput = {
        title: form.title.trim(),
        description: form.description.trim(),
        imageUrl: form.imageUrl.trim() || undefined,
        buttonLabel: form.buttonLabel.trim(),
        buttonUrl: form.buttonUrl.trim(),
        backgroundColor: form.backgroundColor.trim() || undefined,
        textColor: form.textColor.trim() || undefined,
        buttonBackgroundColor: form.buttonBackgroundColor.trim() || undefined,
        buttonTextColor: form.buttonTextColor.trim() || undefined,
        weight,
        expiresAt: neverExpires || !expiresInput ? null : new Date(expiresInput).getTime(),
        rewardVideoUrl: trimmedRewardVideoUrl || undefined,
        rewardPoints: trimmedRewardVideoUrl && rewardPointsInput.trim() ? Number(rewardPointsInput) : undefined,
        clickRewardPoints: trimmedClickRewardPoints ? Number(trimmedClickRewardPoints) : undefined,
        clickRewardPlacement: trimmedClickRewardPoints ? clickRewardPlacement : undefined,
      };
      if (mode === "edit" && editingId) {
        await editPartner(editingId, input);
      } else {
        await createPartner(input);
      }
      const fresh = await fetchAdminPartners();
      applyList(fresh);
      resetForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("admin.partnerAdsPanel.couldNotSaveTheAd"));
    } finally {
      setSending(false);
    }
  }

  async function handleDelete(id: string) {
    setError(null);
    try {
      await deletePartner(id);
      const fresh = await fetchAdminPartners();
      applyList(fresh);
      if (editingId === id) resetForm();
    } catch {
      setError(t("admin.partnerAdsPanel.couldNotRemoveTheAd"));
    }
  }

  async function handleSavePercent() {
    setPercentError(null);
    const value = Number(emptyPercentInput);
    if (!Number.isFinite(value) || value < 0 || value > 100) {
      setPercentError(t("admin.partnerAdsPanel.useANumberBetween0And"));
      return;
    }
    setSavingPercent(true);
    try {
      const saved = await setPartnerEmptyPercent(value);
      setEmptyPercent(saved);
      setEmptyPercentInput(String(saved));
    } catch {
      setPercentError(t("admin.partnerAdsPanel.couldNotSaveThePercentage"));
    } finally {
      setSavingPercent(false);
    }
  }

  const needsSave = String(emptyPercent) !== emptyPercentInput.trim();

  return (
    <div className="mb-8 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">{t("admin.partnerAdsPanel.partnerAds")}</h2>
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
        {t("admin.partnerAdsPanel.managesTheAdsShownOnThe")}
      </p>

      <div className="mt-4 rounded-lg border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900/40">
        <label htmlFor="partner-empty-percent" className={labelClass}>
          {t("admin.partnerAdsPanel.percentageOfRequestsThatReturnEmpty")}
        </label>
        <div className="mt-1 flex items-center gap-2">
          <input
            id="partner-empty-percent"
            type="number"
            min={0}
            max={100}
            value={emptyPercentInput}
            onChange={(e) => setEmptyPercentInput(e.target.value)}
            className="w-24 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-950 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
          />
          <span className="text-sm text-zinc-500 dark:text-zinc-400">%</span>
          <button
            type="button"
            onClick={handleSavePercent}
            disabled={savingPercent || !needsSave}
            className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            {savingPercent ? t("common.saving") : t("common.save")}
          </button>
        </div>
        {percentError && <p className="mt-1 text-xs text-red-500">{percentError}</p>}
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          {t("admin.partnerAdsPanel.itOnlyAffectsWhoeverOpensOr")}
        </p>
      </div>

      {partners === undefined ? (
        <p className="mt-4 text-sm text-zinc-500 dark:text-zinc-400">{t("admin.partnerAdsPanel.loadingAds")}</p>
      ) : partners.length === 0 && mode === "closed" ? (
        <p className="mt-4 text-sm text-zinc-500 dark:text-zinc-400">{t("admin.partnerAdsPanel.noAdRegistered")}</p>
      ) : (
        <div className="mt-4 flex flex-col gap-2">
          {partners.map((p) => {
            const expired = p.expiresAt !== null && p.expiresAt <= asOf;
            const s = stats[p.id] ?? { views: 0, clicks: 0 };
            // Click-through rate against unique people, not against total
            // impressions: with rotation the same person can be served the
            // same ad several times in one session, and a ratio whose
            // denominator grows every five minutes while nobody new arrives
            // is a number that only ever falls.
            const clicksByVideo = s.clicksByVideo ?? 0;
            const totalClicks = s.clicks + clicksByVideo;
            const ctr =
              s.uniqueViews && s.uniqueViews > 0
                ? `${((totalClicks / s.uniqueViews) * 100).toFixed(1)}%`
                : null;
            return (
              <div
                key={p.id}
                className={`rounded-lg border px-3 py-2 text-xs ${
                  expired
                    ? "border-zinc-200 bg-zinc-50 opacity-60 dark:border-zinc-800 dark:bg-zinc-900/40"
                    : "border-zinc-200 dark:border-zinc-800"
                }`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 flex-1 truncate font-medium text-zinc-800 dark:text-zinc-200">
                    {p.title}
                  </span>
                  {expired && (
                    <span className="shrink-0 rounded-full bg-zinc-200 px-2 py-0.5 text-[10px] font-semibold uppercase text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                      {t("common.expired")}
                    </span>
                  )}
                  {p.rewardVideoUrl && p.rewardPoints && (
                    <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-900/40 dark:text-amber-400">
                      +{p.rewardPoints} {t("admin.partnerAdsPanel.ptsPerVideo")}
                    </span>
                  )}
                  {p.clickRewardPoints && (
                    <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-900/40 dark:text-amber-400">
                      +{p.clickRewardPoints} pts por clique (
                      {CLICK_REWARD_PLACEMENT_LABELS[p.clickRewardPlacement ?? "both"]})
                    </span>
                  )}
                  <span className="shrink-0 text-zinc-500 dark:text-zinc-400">peso {p.weight}</span>
                  <button
                    type="button"
                    onClick={() => startEditing(p)}
                    className="shrink-0 font-semibold text-zinc-700 underline underline-offset-2 dark:text-zinc-300"
                  >
                    {t("common.edit")}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(p.id)}
                    className="shrink-0 font-semibold text-red-600 underline underline-offset-2 dark:text-red-400"
                  >
                    {t("common.remove")}
                  </button>
                  {/* The advertiser's own link. Read-only and account-free:
                      whoever holds it watches this one ad's numbers live and
                      can reach nothing else (see the API's
                      GET /partner-report/:token). */}
                  {p.reportToken && (
                    <span className="flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        onClick={() => copyReportLink(p)}
                        title={t("admin.partnerAdsPanel.copyThisAdSPublicStats")}
                        className="flex items-center gap-1 font-semibold text-emerald-700 underline underline-offset-2 dark:text-emerald-400"
                      >
                        <MdContentCopy className="h-3 w-3" />
                        {copiedId === p.id ? t("common.linkCopied") : t("admin.partnerAdsPanel.copyReport")}
                      </button>
                      <a
                        href={reportUrl(p.reportToken)}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={t("admin.partnerAdsPanel.openTheReportInANew")}
                        className="flex items-center gap-1 text-zinc-500 underline underline-offset-2 dark:text-zinc-400"
                      >
                        <MdOpenInNew className="h-3 w-3" />
                        abrir
                      </a>
                    </span>
                  )}
                </div>
                <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-zinc-500 dark:text-zinc-400">
                  <span>{t("admin.partnerAdsPanel.expires")} {p.expiresAt ? new Date(p.expiresAt).toLocaleString(formatLocale()) : "nunca"}</span>
                  <span>
                    {t("admin.partnerAdsPanel.impressions")} <strong>{s.views}</strong>
                  </span>
                  <span>
                    {t("admin.partnerAdsPanel.sessions")} <strong>{s.sessionViews ?? "—"}</strong>
                  </span>
                  <span>
                    {t("admin.partnerAdsPanel.uniquePeople")}{" "}
                    <strong>{s.uniqueViews ?? "—"}</strong>
                  </span>
                  <span>
                    {t("admin.partnerAdsPanel.clicksOnTheCard")} <strong>{s.clicks}</strong>
                  </span>
                  <span>
                    {t("admin.partnerAdsPanel.clicksOnTheVideo")} <strong>{clicksByVideo}</strong>
                  </span>
                  <span>
                    {t("admin.partnerAdsPanel.totalClicks")} <strong>{totalClicks}</strong>
                    {ctr ? ` (${ctr})` : ""}
                  </span>
                  <span>
                    {t("admin.partnerAdsPanel.minimises")} <strong>{s.minimizes ?? 0}</strong>
                  </span>
                  {p.rewardVideoUrl && p.rewardPoints && (
                    <>
                      <span>
                        {t("admin.partnerAdsPanel.pressesToWatchTheVideo")} <strong>{s.rewardVideoOpens ?? 0}</strong>
                      </span>
                      <span>
                        {t("admin.partnerAdsPanel.watchedItFully")} <strong>{s.rewardVideoCompletions ?? 0}</strong>
                      </span>
                      <span>
                        {t("admin.partnerAdsPanel.redeemedThePoints")} <strong>{s.rewardClaims ?? 0}</strong>
                      </span>
                    </>
                  )}
                  {p.clickRewardPoints && (
                    <span>
                      {t("admin.partnerAdsPanel.redeemedThePointsPerClick")}{" "}
                      <strong>{s.clickRewardClaims ?? 0}</strong>
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {mode === "closed" ? (
        <button
          type="button"
          onClick={() => setMode("create")}
          className="mt-4 rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
        >
          {t("admin.partnerAdsPanel.newAd")}
        </button>
      ) : (
        <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-3 border-t border-zinc-200 pt-4 dark:border-zinc-800">
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-500">
            {mode === "edit" ? t("admin.partnerAdsPanel.editingAd") : t("admin.partnerAdsPanel.newAd2")}
          </p>

          <div>
            <label htmlFor="partner-title" className={labelClass}>
              {t("common.title")}
            </label>
            <input
              id="partner-title"
              value={form.title}
              onChange={(e) => update("title", e.target.value)}
              maxLength={80}
              className={inputClass}
            />
          </div>

          <div>
            <label htmlFor="partner-description" className={labelClass}>
              {t("common.description")}
            </label>
            <textarea
              id="partner-description"
              value={form.description}
              onChange={(e) => update("description", e.target.value)}
              maxLength={400}
              rows={2}
              className={inputClass}
            />
          </div>

          <div>
            <label htmlFor="partner-image" className={labelClass}>
              {t("admin.partnerAdsPanel.imageUrlOptional")}
            </label>
            <input
              id="partner-image"
              value={form.imageUrl}
              onChange={(e) => update("imageUrl", e.target.value)}
              placeholder="https://..."
              className={inputClass}
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="partner-button-label" className={labelClass}>
                {t("common.buttonLabel")}
              </label>
              <input
                id="partner-button-label"
                value={form.buttonLabel}
                onChange={(e) => update("buttonLabel", e.target.value)}
                maxLength={40}
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="partner-button-url" className={labelClass}>
                {t("common.buttonLink")}
              </label>
              <input
                id="partner-button-url"
                value={form.buttonUrl}
                onChange={(e) => update("buttonUrl", e.target.value)}
                placeholder="https://..."
                className={inputClass}
              />
            </div>
          </div>

          <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900/40">
            <p className={labelClass}>{t("admin.partnerAdsPanel.videoRewardOptional")}</p>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              {t("admin.partnerAdsPanel.ifFilledInTheCardShows")}
            </p>
            <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto]">
              <div>
                <label htmlFor="partner-reward-video" className={labelClass}>
                  {t("admin.partnerAdsPanel.videoLinkMp4")}
                </label>
                <input
                  id="partner-reward-video"
                  value={rewardVideoUrl}
                  onChange={(e) => setRewardVideoUrl(e.target.value)}
                  placeholder="https://cdn.../video.mp4"
                  className={inputClass}
                />
              </div>
              <div>
                <label htmlFor="partner-reward-points" className={labelClass}>
                  {t("admin.partnerAdsPanel.pointsForWatching")}
                </label>
                <input
                  id="partner-reward-points"
                  type="number"
                  min={1}
                  max={100000}
                  value={rewardPointsInput}
                  onChange={(e) => setRewardPointsInput(e.target.value)}
                  disabled={!rewardVideoUrl.trim()}
                  className={`${inputClass} sm:w-32 disabled:cursor-not-allowed disabled:opacity-50`}
                />
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900/40">
            <p className={labelClass}>{t("admin.partnerAdsPanel.pointsPerClickOptional")}</p>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              {t("admin.partnerAdsPanel.ifFilledInTheAdS")} {"{label}"}{t("admin.partnerAdsPanel.andGivesThosePointsTheFirst")}
            </p>
            <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-[auto_1fr]">
              <div>
                <label htmlFor="partner-click-reward-points" className={labelClass}>
                  {t("admin.partnerAdsPanel.pointsForClicking")}
                </label>
                <input
                  id="partner-click-reward-points"
                  type="number"
                  min={1}
                  max={100000}
                  value={clickRewardPointsInput}
                  onChange={(e) => setClickRewardPointsInput(e.target.value)}
                  className={`${inputClass} sm:w-32`}
                />
              </div>
              <div>
                <label htmlFor="partner-click-reward-placement" className={labelClass}>
                  {t("admin.partnerAdsPanel.whereItApplies")}
                </label>
                <select
                  id="partner-click-reward-placement"
                  value={clickRewardPlacement}
                  onChange={(e) =>
                    setClickRewardPlacement(e.target.value as PartnerClickRewardPlacement)
                  }
                  disabled={!clickRewardPointsInput.trim()}
                  className={`${inputClass} disabled:cursor-not-allowed disabled:opacity-50`}
                >
                  <option value="both">{CLICK_REWARD_PLACEMENT_LABELS.both}</option>
                  <option value="video">{CLICK_REWARD_PLACEMENT_LABELS.video}</option>
                  <option value="card">{CLICK_REWARD_PLACEMENT_LABELS.card}</option>
                </select>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <label htmlFor="partner-bg" className={labelClass}>
                {t("common.background")}
              </label>
              <input
                id="partner-bg"
                type="color"
                value={form.backgroundColor}
                onChange={(e) => update("backgroundColor", e.target.value)}
                className={colorInputClass}
              />
            </div>
            <div>
              <label htmlFor="partner-text" className={labelClass}>
                {t("common.text")}
              </label>
              <input
                id="partner-text"
                type="color"
                value={form.textColor}
                onChange={(e) => update("textColor", e.target.value)}
                className={colorInputClass}
              />
            </div>
            <div>
              <label htmlFor="partner-btn-bg" className={labelClass}>
                {t("admin.partnerAdsPanel.buttonBackground")}
              </label>
              <input
                id="partner-btn-bg"
                type="color"
                value={form.buttonBackgroundColor}
                onChange={(e) => update("buttonBackgroundColor", e.target.value)}
                className={colorInputClass}
              />
            </div>
            <div>
              <label htmlFor="partner-btn-text" className={labelClass}>
                {t("common.buttonText")}
              </label>
              <input
                id="partner-btn-text"
                type="color"
                value={form.buttonTextColor}
                onChange={(e) => update("buttonTextColor", e.target.value)}
                className={colorInputClass}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:items-end">
            <div>
              <label htmlFor="partner-weight" className={labelClass}>
                {t("admin.partnerAdsPanel.weightDistributionAmongActiveAds")}
              </label>
              <input
                id="partner-weight"
                type="number"
                min={1}
                max={100}
                value={weight}
                onChange={(e) => setWeight(Math.max(1, Number(e.target.value) || 1))}
                className={inputClass}
              />
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                1 = mesma chance que os outros, 2 = o dobro, etc.
              </p>
            </div>
            <label className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
              <input
                type="checkbox"
                checked={neverExpires}
                onChange={(e) => setNeverExpires(e.target.checked)}
                className="h-4 w-4 rounded border-zinc-300 dark:border-zinc-700"
              />
              {t("common.neverExpires")}
            </label>
          </div>

          {!neverExpires && (
            <div>
              <label htmlFor="partner-expires" className={labelClass}>
                {t("admin.partnerAdsPanel.expiresOn")}
              </label>
              <input
                id="partner-expires"
                type="datetime-local"
                value={expiresInput}
                onChange={(e) => setExpiresInput(e.target.value)}
                className={inputClass}
              />
            </div>
          )}

          {error && <p className="text-sm text-red-500">{error}</p>}

          <div className="mt-1 flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={sending || !form.title.trim() || !form.buttonLabel.trim() || !form.buttonUrl.trim()}
              className="rounded-lg bg-zinc-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
            >
              {sending ? t("common.saving") : mode === "edit" ? t("common.saveChanges") : t("admin.partnerAdsPanel.createAd")}
            </button>
            <button
              type="button"
              onClick={resetForm}
              className="rounded-lg px-4 py-2 text-sm font-medium text-zinc-500 transition hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
            >
              {t("common.cancel")}
            </button>
          </div>

          {/* Always on. It costs one narrow column and answers the question
              the form otherwise leaves open — what the two reward buttons
              actually end up saying — so there is nothing here worth hiding
              behind a toggle. Mirrors PartnerCard's real markup; when the two
              drift, that one is the original. */}
          <div>
            <p className={labelClass}>{t("common.preview")}</p>
            <div
              className="mt-1 w-72 max-w-full overflow-hidden rounded-lg border border-zinc-200 p-4 dark:border-zinc-800"
              style={{ backgroundColor: form.backgroundColor, color: form.textColor }}
            >
              <div className="mb-2 flex items-center">
                <span className="rounded-full bg-black/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide opacity-70 dark:bg-white/10">
                  {t("common.sponsored")}
                </span>
              </div>
              {form.imageUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={form.imageUrl} alt="" className="mb-2 max-h-32 w-full rounded-lg object-cover" />
              )}
              <p className="text-sm font-semibold">{form.title || t("common.adTitle")}</p>
              <p className="mt-1 whitespace-pre-line text-xs opacity-80">
                {form.description || t("common.adDescription")}
              </p>
              <div
                className="mt-3 flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-center text-sm font-semibold"
                style={{ backgroundColor: form.buttonBackgroundColor, color: form.buttonTextColor }}
              >
                {previewCardClickReward && (
                  <>
                    <BsCoin className="h-4 w-4 shrink-0" />
                    <span className="shrink-0 tabular-nums">{clickRewardPointsInput.trim()}</span>
                  </>
                )}
                <span className="truncate">{form.buttonLabel || t("common.button")}</span>
              </div>
              {previewRewardVideo && (
                <div
                  className={`mt-2 flex w-full items-center ${
                    previewRewardDuration ? "justify-between" : "justify-center"
                  } gap-2 rounded-lg border border-current px-3 py-1.5 text-xs font-semibold opacity-90`}
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    {t("common.redeem")}
                    <BsCoin className="h-3.5 w-3.5 shrink-0" />
                    {rewardPointsInput.trim()}
                  </span>
                  {previewRewardDuration && (
                    <span className="shrink-0 rounded-full bg-black/10 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums dark:bg-white/10">
                      {previewRewardDuration}
                    </span>
                  )}
                </div>
              )}
            </div>
            {clickRewardPointsInput.trim() && clickRewardPlacement === "video" && (
              <p className="mt-1.5 w-72 max-w-full text-xs text-zinc-500 dark:text-zinc-400">
                {t("admin.partnerAdsPanel.thePointsPerClickDoNot")}
              </p>
            )}
          </div>
        </form>
      )}
    </div>
  );
}
