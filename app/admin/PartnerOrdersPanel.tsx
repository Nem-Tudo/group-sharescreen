"use client";

import { useEffect, useState } from "react";
import { MdCheck, MdClose, MdExpandLess, MdExpandMore, MdOpenInNew } from "react-icons/md";
import { PartnerPreviewPanel, PartnerStatusPill } from "@/components/partnerOrders/PartnerOrderParts";
import { formatLocale } from "@/lib/i18n";
import { fetchAdminPartners, setPartnerLaunchSettings, type PartnerLaunchSettings } from "@/lib/adminApi";
import { useT } from "@/lib/useI18n";
import {
  approvePartnerOrder,
  fetchAdminPartnerOrders,
  packageDurationLabel,
  rejectPartnerOrder,
  type AdminPartnerOrder,
} from "@/lib/partnerOrders";

// Self-serve ad orders (the site's /partner dashboard), waiting on an admin.
// Approving a new one creates the live ad below, running for the hours it
// bought from now; approving an edit copies it onto the running ad. Refusing
// asks for a reason, which is what the advertiser reads.
//
// Fires PARTNER_ORDERS_CHANGED_EVENT after every decision, so the badge on the
// "Anúncios" tab (see admin/page.tsx) drops without waiting for its next poll.

export const PARTNER_ORDERS_CHANGED_EVENT = "golive:partner-orders-changed";

const POLL_MS = 20_000;

function when(ms: number | null): string {
  return ms ? new Date(ms).toLocaleString(formatLocale(), { dateStyle: "short", timeStyle: "short" }) : "—";
}

export function PartnerOrdersPanel() {
  const t = useT();
  const [orders, setOrders] = useState<AdminPartnerOrder[] | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      fetchAdminPartnerOrders()
        .then((data) => {
          if (!cancelled) setOrders(data.orders);
        })
        .catch(() => {
          if (!cancelled) setOrders((prev) => prev ?? []);
        });
    void load();
    const id = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  function replace(updated: AdminPartnerOrder) {
    setOrders((prev) => prev?.map((o) => (o.id === updated.id ? updated : o)) ?? prev);
    window.dispatchEvent(new Event(PARTNER_ORDERS_CHANGED_EVENT));
  }

  const waiting = orders?.filter((o) => o.needsReview) ?? [];
  const history = orders?.filter((o) => !o.needsReview) ?? [];

  return (
    <div className="mb-8 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">{t("admin.partnerOrders.title")}</h2>
        {waiting.length > 0 && (
          <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1.5 text-[11px] font-bold text-white">
            {waiting.length}
          </span>
        )}
      </div>
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{t("admin.partnerOrders.subtitle")}</p>

      <LaunchSettingsBox />

      {orders === null ? (
        <p className="mt-4 text-sm text-zinc-500">{t("common.loading")}</p>
      ) : waiting.length === 0 ? (
        <p className="mt-4 rounded-lg bg-zinc-50 p-3 text-sm text-zinc-500 dark:bg-zinc-900/40 dark:text-zinc-400">
          {t("admin.partnerOrders.nothingWaiting")}
        </p>
      ) : (
        <div className="mt-4 flex flex-col gap-3">
          {waiting.map((order) => (
            <ReviewCard key={order.id} order={order} onDone={replace} />
          ))}
        </div>
      )}

      {history.length > 0 && (
        <div className="mt-4">
          <button
            type="button"
            onClick={() => setShowHistory((v) => !v)}
            className="flex items-center gap-1 text-xs font-semibold text-zinc-600 dark:text-zinc-300"
          >
            {showHistory ? <MdExpandLess className="h-4 w-4" /> : <MdExpandMore className="h-4 w-4" />}
            {t("admin.partnerOrders.history", { count: history.length })}
          </button>
          {showHistory && (
            <ul className="mt-2 flex flex-col gap-1.5">
              {history.map((order) => (
                <li
                  key={order.id}
                  className="flex flex-wrap items-center gap-2 rounded-lg border border-zinc-200 px-3 py-2 text-xs dark:border-zinc-800"
                >
                  <span className="min-w-0 flex-1 truncate font-medium text-zinc-800 dark:text-zinc-200">
                    {order.creative.title}
                  </span>
                  <PartnerStatusPill order={order} />
                  <span className="text-zinc-500">@{order.username}</span>
                  <span className="text-zinc-500">
                    {packageDurationLabel(order.hours)} · {order.amountLabel}
                  </span>
                  {order.status === "rejected" && order.reviewNote && (
                    <span className="w-full text-red-600 dark:text-red-400">“{order.reviewNote}”</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function ReviewCard({ order, onDone }: { order: AdminPartnerOrder; onDone: (o: AdminPartnerOrder) => void }) {
  const t = useT();
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isEdit = order.status === "approved" && order.pendingCreative !== null;
  const proposed = order.pendingCreative ?? order.creative;

  async function act(kind: "approve" | "reject") {
    setBusy(true);
    setError(null);
    try {
      const updated = kind === "approve" ? await approvePartnerOrder(order.id) : await rejectPartnerOrder(order.id, note.trim());
      onDone(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("admin.partnerOrders.failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50/50 p-3 dark:border-amber-900/60 dark:bg-amber-950/20">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span
          className={`rounded-full px-2 py-0.5 font-semibold uppercase ${
            isEdit
              ? "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300"
              : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
          }`}
        >
          {isEdit ? t("admin.partnerOrders.kindEdit") : t("admin.partnerOrders.kindNew")}
        </span>
        <span className="font-semibold text-zinc-800 dark:text-zinc-200">@{order.username}</span>
        <span className="text-zinc-500">
          {packageDurationLabel(order.hours)} · {order.amountLabel}
        </span>
        <span className="text-zinc-500">{t("admin.partnerOrders.paidAt", { date: when(order.paidAt) })}</span>
        <span className="text-zinc-500">
          {order.provider ?? "—"} {order.paidPaymentId ? `#${order.paidPaymentId}` : ""}
        </span>
      </div>

      {/* One column: each preview carries the horizontal card at its real width. */}
      <div className="mt-3 grid gap-4">
        {isEdit && (
          <div>
            <p className="mb-1 text-[11px] font-semibold uppercase text-zinc-500">{t("admin.partnerOrders.current")}</p>
            <PartnerPreviewPanel creative={order.creative} />
          </div>
        )}
        <div>
          {isEdit && <p className="mb-1 text-[11px] font-semibold uppercase text-sky-600">{t("admin.partnerOrders.proposed")}</p>}
          <PartnerPreviewPanel creative={proposed} />
        </div>
        {!isEdit && (
          <dl className="grid content-start gap-1 text-xs">
            <Detail label={t("common.buttonLink")}>
              <a href={proposed.buttonUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 break-all text-emerald-700 underline dark:text-emerald-400">
                {proposed.buttonUrl}
                <MdOpenInNew className="h-3 w-3 shrink-0" />
              </a>
            </Detail>
            {proposed.rewardVideoUrl && (
              <Detail label={t("admin.partnerOrders.video")}>
                <a href={proposed.rewardVideoUrl} target="_blank" rel="noopener noreferrer" className="break-all underline">
                  {proposed.rewardVideoUrl}
                </a>{" "}
                (+{proposed.rewardPoints} pts)
              </Detail>
            )}
            {proposed.clickRewardPoints && (
              <Detail label={t("admin.partnerOrders.clickReward")}>
                +{proposed.clickRewardPoints} pts ({proposed.clickRewardPlacement})
              </Detail>
            )}
            {(proposed.schedules ?? []).length > 0 && (
              <Detail label={t("admin.partnerOrders.schedules")}>{(proposed.schedules ?? []).length}</Detail>
            )}
            {proposed.extendedDescription && (
              <Detail label={t("admin.partnerOrders.extended")}>
                <span className="line-clamp-4 whitespace-pre-line">{proposed.extendedDescription}</span>
              </Detail>
            )}
          </dl>
        )}
      </div>

      {rejecting && (
        <div className="mt-3">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
            rows={2}
            placeholder={t("admin.partnerOrders.rejectPlaceholder")}
            className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
          />
        </div>
      )}
      {error && <p className="mt-2 text-xs text-red-500">{error}</p>}

      <div className="mt-3 flex flex-wrap gap-2">
        {!rejecting ? (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => void act("approve")}
              className="flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-50"
            >
              <MdCheck className="h-4 w-4" />
              {isEdit ? t("admin.partnerOrders.approveEdit") : t("admin.partnerOrders.approve")}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setRejecting(true)}
              className="flex items-center gap-1 rounded-lg border border-red-300 px-3 py-1.5 text-sm font-semibold text-red-600 transition hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/30"
            >
              <MdClose className="h-4 w-4" />
              {t("admin.partnerOrders.reject")}
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              disabled={busy || !note.trim()}
              onClick={() => void act("reject")}
              className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-red-500 disabled:opacity-50"
            >
              {t("admin.partnerOrders.confirmReject")}
            </button>
            <button
              type="button"
              onClick={() => setRejecting(false)}
              className="rounded-lg px-3 py-1.5 text-sm font-semibold text-zinc-500"
            >
              {t("common.cancel")}
            </button>
          </>
        )}
      </div>
      {!isEdit && <p className="mt-2 text-[11px] text-zinc-500">{t("admin.partnerOrders.refundNote")}</p>}
    </div>
  );
}

/**
 * What approving an order does to the slot: the new ad is served at the launch
 * weight for the first minutes — so nearly everybody sees it — and then at the
 * default weight. Saved on the server (PUT /admin/partner-settings).
 */
function LaunchSettingsBox() {
  const t = useT();
  const [saved, setSaved] = useState<PartnerLaunchSettings | null>(null);
  const [form, setForm] = useState({ launchWeight: "", launchMinutes: "", defaultWeight: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchAdminPartners()
      .then((data) => {
        if (cancelled) return;
        const settings = {
          launchWeight: data.launchWeight,
          launchMinutes: data.launchMinutes,
          defaultWeight: data.defaultWeight,
        };
        setSaved(settings);
        setForm({
          launchWeight: String(settings.launchWeight),
          launchMinutes: String(settings.launchMinutes),
          defaultWeight: String(settings.defaultWeight),
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const dirty =
    saved !== null &&
    (form.launchWeight !== String(saved.launchWeight) ||
      form.launchMinutes !== String(saved.launchMinutes) ||
      form.defaultWeight !== String(saved.defaultWeight));

  async function save() {
    setBusy(true);
    setError(null);
    setDone(false);
    try {
      const next = await setPartnerLaunchSettings({
        launchWeight: Number(form.launchWeight),
        launchMinutes: Number(form.launchMinutes),
        defaultWeight: Number(form.defaultWeight),
      });
      setSaved(next);
      setForm({
        launchWeight: String(next.launchWeight),
        launchMinutes: String(next.launchMinutes),
        defaultWeight: String(next.defaultWeight),
      });
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("admin.partnerOrders.failed"));
    } finally {
      setBusy(false);
    }
  }

  const field = (key: keyof typeof form, label: string, suffix?: string) => (
    <label className="flex flex-col gap-1 text-xs font-medium text-zinc-600 dark:text-zinc-400">
      {label}
      <span className="flex items-center gap-1.5">
        <input
          type="number"
          min={key === "launchMinutes" ? 0 : 1}
          step={key === "launchMinutes" ? 0.5 : 1}
          value={form[key]}
          onChange={(e) => {
            setForm((prev) => ({ ...prev, [key]: e.target.value }));
            setDone(false);
          }}
          className="w-24 rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 text-sm text-zinc-950 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
        />
        {suffix && <span className="text-zinc-500">{suffix}</span>}
      </span>
    </label>
  );

  return (
    <div className="mt-4 rounded-lg border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900/40">
      <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">{t("admin.partnerOrders.launchTitle")}</p>
      <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{t("admin.partnerOrders.launchHint")}</p>
      <div className="mt-2 flex flex-wrap items-end gap-3">
        {field("launchWeight", t("admin.partnerOrders.launchWeight"))}
        {field("launchMinutes", t("admin.partnerOrders.launchMinutes"), "min")}
        {field("defaultWeight", t("admin.partnerOrders.defaultWeight"))}
        <button
          type="button"
          onClick={() => void save()}
          disabled={busy || !dirty}
          className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          {busy ? t("common.saving") : t("common.save")}
        </button>
        {done && <span className="text-xs text-emerald-600">{t("admin.partnerOrders.launchSaved")}</span>}
      </div>
      {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
    </div>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase text-zinc-500">{label}</dt>
      <dd className="text-zinc-800 dark:text-zinc-200">{children}</dd>
    </div>
  );
}
