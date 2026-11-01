"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  MdArrowBack,
  MdCheckCircle,
  MdContentCopy,
  MdEdit,
  MdHourglassTop,
  MdOpenInNew,
  MdRefresh,
  MdReportProblem,
} from "react-icons/md";
import { PartnerReportClient } from "@/app/ad/[token]/PartnerReportClient";
import { creativeProblem, PartnerCreativeForm } from "@/components/partnerOrders/PartnerCreativeForm";
import { PartnerCheckout } from "@/components/partnerOrders/PartnerCheckout";
import {
  PartnerAccountSuggestion,
  PartnerDiscordFloating,
  PartnerPreviewPanel,
  PartnerStatusPill,
} from "@/components/partnerOrders/PartnerOrderParts";
import { useAuth } from "@/lib/AuthContext";
import { formatLocale } from "@/lib/i18n";
import { useT } from "@/lib/useI18n";
import {
  SELF_SERVE_PARTNER_EVENTS,
  creativeOf,
  deletePartnerOrder,
  partnerOrderShareLink,
  rememberPartnerOrderKey,
  fetchPartnerOrder,
  fetchPartnerOrderConfig,
  packageDurationLabel,
  trackPartnerOrderEvent,
  updatePartnerOrder,
  withdrawPartnerOrderEdit,
  type PartnerCreative,
  type PartnerOrder,
  type PartnerOrderConfig,
} from "@/lib/partnerOrders";

// One ad: where it stands, what it says, how it is doing — and changing it.
// A running ad keeps running as it was while an edit waits for review.

const POLL_MS = 5000;

function when(ms: number | null): string {
  return ms ? new Date(ms).toLocaleString(formatLocale(), { dateStyle: "short", timeStyle: "short" }) : "—";
}

export function PartnerOrderDetail({ id }: { id: string }) {
  const t = useT();
  const router = useRouter();
  const search = useSearchParams();
  const justPaid = search.get("paid") === "1";
  const { account, loading } = useAuth();
  const [order, setOrder] = useState<PartnerOrder | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [config, setConfig] = useState<PartnerOrderConfig | null>(null);
  const [editing, setEditing] = useState(false);
  const [editTab, setEditTab] = useState<"card" | "extras">("card");
  const [draft, setDraft] = useState<PartnerCreative | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);

  useEffect(() => {
    fetchPartnerOrderConfig().then(setConfig).catch(() => undefined);
  }, []);

  useEffect(() => {
    // The emailed link carries the order's key: kept in this browser, so the
    // order is reachable without an account from here on.
    const key = search.get("key");
    if (key) rememberPartnerOrderKey(id, key);
    if (loading) return;
    let cancelled = false;
    const controller = new AbortController();
    const load = () =>
      fetchPartnerOrder(id, controller.signal)
        .then((fresh) => {
          if (!cancelled) setOrder(fresh);
        })
        .catch((err: Error) => {
          if (!cancelled && /not found/i.test(err.message)) setNotFound(true);
        });
    void load();
    const timer = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      controller.abort();
      clearInterval(timer);
    };
  }, [account, loading, id, search]);

  if (notFound) {
    return (
      <main className="mx-auto flex w-full max-w-md grow flex-col items-center justify-center gap-3 px-4 py-20 text-center">
        <h1 className="text-xl font-semibold text-zinc-950 dark:text-zinc-50">{t("partnerOrders.detail.notFound")}</h1>
        <Link href="/partner" className="text-sm font-semibold text-emerald-600 underline">
          {t("partnerOrders.myAds")}
        </Link>
      </main>
    );
  }

  if (!order) {
    return (
      <main className="mx-auto flex w-full max-w-md grow flex-col items-center justify-center gap-3 px-4 py-20">
        <span className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-300 border-t-transparent dark:border-zinc-700 dark:border-t-transparent" />
      </main>
    );
  }

  const current = order;
  // What the page shows as "the ad": a waiting edit when there is one.
  const shown = editing && draft ? draft : (current.pendingCreative ?? current.creative);
  const reportUrl =
    current.reportToken && typeof window !== "undefined"
      ? `${window.location.origin}/ad/${encodeURIComponent(current.reportToken)}`
      : null;

  function startEditing() {
    setDraft(creativeOf(current.pendingCreative ?? current.creative));
    setEditTab("card");
    setEditing(true);
    setError(null);
  }

  async function saveEdit() {
    if (!draft) return;
    const why = creativeProblem(draft, t);
    if (why) {
      setError(why);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const saved = await updatePartnerOrder(current.id, draft);
      setOrder(saved);
      setEditing(false);
      trackPartnerOrderEvent(SELF_SERVE_PARTNER_EVENTS.edit);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("partnerOrders.detail.saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  async function withdrawEdit() {
    try {
      setOrder(await withdrawPartnerOrderEdit(current.id));
    } catch {
      // The poll shows the truth in a moment.
    }
  }

  async function remove() {
    if (!window.confirm(t("partnerOrders.detail.deleteConfirm"))) return;
    try {
      await deletePartnerOrder(current.id);
      router.push("/partner");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("partnerOrders.detail.saveFailed"));
    }
  }

  async function copyOrderLink() {
    const link = partnerOrderShareLink(current.id);
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    } catch {
      // Nothing to fall back to but the email we sent.
    }
  }

  async function copyReport() {
    if (!reportUrl) return;
    try {
      await navigator.clipboard.writeText(reportUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // The "abrir" link beside it still works.
    }
  }

  const ended = current.status === "approved" && !current.live;
  const editLabel =
    current.status === "approved" ? t("partnerOrders.detail.sendEdit") : current.status === "rejected" ? t("partnerOrders.detail.resubmit") : t("common.saveChanges");

  return (
    <main className="mx-auto w-full max-w-7xl grow px-4 pb-24 pt-6 sm:px-6">
      <Link
        href="/partner"
        className="flex w-fit items-center gap-1 text-sm text-zinc-500 transition hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
      >
        <MdArrowBack className="h-4 w-4" />
        {t("partnerOrders.myAds")}
      </Link>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <h1 className="min-w-0 truncate text-2xl font-bold tracking-tight text-zinc-950 dark:text-zinc-50">{current.creative.title}</h1>
        <PartnerStatusPill order={current} />
      </div>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        {packageDurationLabel(current.hours)} · {current.amountLabel} · {t("partnerOrders.detail.createdAt", { date: when(current.createdAt) })}
      </p>

      {/* Bought without an account: this link is the only way back. */}
      {current.guest && partnerOrderShareLink(current.id) && (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
          <p className="min-w-0 flex-1">
            {current.contactEmail
              ? t("partnerOrders.detail.keepLinkEmail", { email: current.contactEmail })
              : t("partnerOrders.detail.keepLink")}
          </p>
          <button
            type="button"
            onClick={() => void copyOrderLink()}
            className="flex shrink-0 items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-amber-500"
          >
            <MdContentCopy className="h-4 w-4" />
            {linkCopied ? t("common.linkCopied") : t("partnerOrders.detail.copyOrderLink")}
          </button>
        </div>
      )}

      {current.guest && !account && !loading && (
        <div className="mt-3">
          <PartnerAccountSuggestion compact />
        </div>
      )}

      {/* Where it stands, and what to do about it. */}
      <div className="mt-5">
        {justPaid && current.status === "awaiting_payment" && (
          <Banner tone="sky" icon={<MdHourglassTop className="h-5 w-5" />} title={t("partnerOrders.detail.confirmingTitle")}>
            {t("partnerOrders.detail.confirmingText")}
          </Banner>
        )}
        {current.status === "awaiting_payment" && !justPaid && (
          <Banner tone="zinc" icon={<MdHourglassTop className="h-5 w-5" />} title={t("partnerOrders.detail.unpaidTitle")}>
            {t("partnerOrders.detail.unpaidText")}
          </Banner>
        )}
        {current.status === "pending_review" && (
          <Banner tone="amber" icon={<MdHourglassTop className="h-5 w-5" />} title={t("partnerOrders.detail.reviewTitle")}>
            {t("partnerOrders.detail.reviewText", { date: when(current.paidAt) })}
          </Banner>
        )}
        {current.status === "rejected" && (
          <Banner tone="red" icon={<MdReportProblem className="h-5 w-5" />} title={t("partnerOrders.detail.rejectedTitle")}>
            <span className="block font-medium">“{current.reviewNote}”</span>
            <span className="mt-1 block">{t("partnerOrders.detail.rejectedText")}</span>
          </Banner>
        )}
        {current.status === "approved" && current.live && !current.pendingCreative && (
          <Banner tone="emerald" icon={<MdCheckCircle className="h-5 w-5" />} title={t("partnerOrders.detail.liveTitle")}>
            {t("partnerOrders.detail.liveText", { date: when(current.endsAt) })}
            {current.reviewNote && (
              <span className="mt-1 block text-red-600 dark:text-red-400">
                {t("partnerOrders.detail.editRejected", { note: current.reviewNote })}
              </span>
            )}
          </Banner>
        )}
        {current.status === "approved" && current.pendingCreative && (
          <Banner tone="sky" icon={<MdHourglassTop className="h-5 w-5" />} title={t("partnerOrders.detail.editReviewTitle")}>
            {t("partnerOrders.detail.editReviewText")}
            <button type="button" onClick={() => void withdrawEdit()} className="mt-1 block font-semibold underline">
              {t("partnerOrders.detail.withdrawEdit")}
            </button>
          </Banner>
        )}
        {ended && (
          <Banner tone="zinc" icon={<MdCheckCircle className="h-5 w-5" />} title={t("partnerOrders.detail.endedTitle")}>
            {t("partnerOrders.detail.endedText", { date: when(current.endsAt) })}
          </Banner>
        )}
      </div>

      {/* Two halves: what to do (or the editor) on the left, the previews on
          the right at their real size; the live report runs full width below. */}
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div className="min-w-0 flex flex-col gap-4">
          {editing && draft ? (
            <>
              <div className="flex w-fit gap-1 rounded-lg bg-zinc-100 p-1 dark:bg-zinc-900">
                {(["card", "extras"] as const).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setEditTab(tab)}
                    className={`rounded-md px-3 py-1.5 text-sm font-semibold transition ${
                      editTab === tab
                        ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-50"
                        : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400"
                    }`}
                  >
                    {tab === "card" ? t("partnerOrders.wizard.stepCard") : t("partnerOrders.wizard.stepExtras")}
                  </button>
                ))}
              </div>
              <PartnerCreativeForm section={editTab} value={draft} onChange={setDraft} />
              {current.status === "approved" && (
                <p className="text-xs text-zinc-500 dark:text-zinc-400">{t("partnerOrders.detail.editNotice")}</p>
              )}
              {error && <p className="text-sm text-red-500">{error}</p>}
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void saveEdit()}
                  disabled={saving}
                  className="rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-emerald-500 disabled:opacity-50"
                >
                  {saving ? t("common.saving") : editLabel}
                </button>
                <button
                  type="button"
                  onClick={() => setEditing(false)}
                  className="rounded-xl px-4 py-2.5 text-sm font-semibold text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-900"
                >
                  {t("common.cancel")}
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                {current.status !== "cancelled" && !ended && (
                  <button
                    type="button"
                    onClick={startEditing}
                    className="flex items-center gap-1.5 rounded-xl border border-zinc-300 px-4 py-2 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
                  >
                    <MdEdit className="h-4 w-4" />
                    {current.status === "rejected" ? t("partnerOrders.detail.fix") : t("common.edit")}
                  </button>
                )}
                {(current.status === "approved" || ended) && (
                  <Link
                    href={`/partner/new?from=${encodeURIComponent(current.id)}`}
                    className="flex items-center gap-1.5 rounded-xl border border-zinc-300 px-4 py-2 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
                  >
                    <MdRefresh className="h-4 w-4" />
                    {t("partnerOrders.detail.renew")}
                  </Link>
                )}
                {reportUrl && (
                  <>
                    <button
                      type="button"
                      onClick={() => void copyReport()}
                      className="flex items-center gap-1.5 rounded-xl border border-zinc-300 px-4 py-2 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
                    >
                      <MdContentCopy className="h-4 w-4" />
                      {copied ? t("common.linkCopied") : t("partnerOrders.detail.copyReport")}
                    </button>
                    <a
                      href={reportUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-semibold text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                    >
                      <MdOpenInNew className="h-4 w-4" />
                      {t("partnerOrders.detail.openReport")}
                    </a>
                  </>
                )}
                {current.status === "awaiting_payment" && (
                  <button
                    type="button"
                    onClick={() => void remove()}
                    className="rounded-xl px-4 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30"
                  >
                    {t("partnerOrders.detail.delete")}
                  </button>
                )}
              </div>
              {error && <p className="text-sm text-red-500">{error}</p>}

              {current.status === "awaiting_payment" && config && (
                <section className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
                  <h2 className="mb-3 text-lg font-semibold text-zinc-950 dark:text-zinc-50">{t("partnerOrders.wizard.payTitle")}</h2>
                  <PartnerCheckout
                    order={current}
                    amountLabel={current.amountLabel}
                    methods={config.methods}
                    prepare={async () => current}
                    onPaid={(paid) => setOrder(paid)}
                  />
                </section>
              )}

              {!current.reportToken && (
                <p className="rounded-xl border border-dashed border-zinc-300 p-4 text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
                  {t("partnerOrders.detail.statsLater")}
                </p>
              )}
            </>
          )}
        </div>

        <aside className="flex flex-col gap-4 lg:sticky lg:top-4 lg:self-start">
          <PartnerPreviewPanel creative={shown} />
          {current.pendingCreative && !editing && (
            <p className="text-xs text-sky-700 dark:text-sky-300">{t("partnerOrders.detail.previewIsEdit")}</p>
          )}
          <dl className="rounded-xl border border-zinc-200 bg-white p-3 text-xs dark:border-zinc-800 dark:bg-zinc-950">
            <Row label={t("partnerOrders.detail.paidAt")} value={when(current.paidAt)} />
            <Row label={t("partnerOrders.detail.approvedAt")} value={when(current.approvedAt)} />
            <Row label={t("partnerOrders.detail.endsAt")} value={when(current.endsAt)} />
            <Row label={t("partnerOrders.detail.method")} value={current.paymentMethod === "card" ? t("partnerOrders.checkout.card") : current.paymentMethod === "pix" ? "Pix" : "—"} />
          </dl>
        </aside>
      </div>

      {/* The full live report, the same one the public link opens. */}
      {!editing && current.reportToken && (
        <section className="-mx-4 mt-6 sm:-mx-6">
          <PartnerReportClient token={current.reportToken} />
        </section>
      )}
      <PartnerDiscordFloating source="detail" />
    </main>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2 py-1">
      <dt className="text-zinc-500 dark:text-zinc-400">{label}</dt>
      <dd className="text-right font-medium text-zinc-800 dark:text-zinc-200">{value}</dd>
    </div>
  );
}

const BANNER_TONES = {
  zinc: "border-zinc-200 bg-white text-zinc-700 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300",
  amber: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200",
  red: "border-red-200 bg-red-50 text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200",
  emerald: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-200",
  sky: "border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900/50 dark:bg-sky-950/30 dark:text-sky-200",
} as const;

function Banner({
  tone,
  icon,
  title,
  children,
}: {
  tone: keyof typeof BANNER_TONES;
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`flex gap-3 rounded-xl border p-4 ${BANNER_TONES[tone]}`}>
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div className="min-w-0 text-sm">
        <p className="font-semibold">{title}</p>
        <div className="mt-0.5 opacity-90">{children}</div>
      </div>
    </div>
  );
}
