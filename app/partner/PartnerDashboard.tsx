"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { MdAdd, MdChevronRight } from "react-icons/md";
import { partnerWideImage } from "@/lib/partner";
import { useAuth } from "@/lib/AuthContext";
import { useFeature } from "@/lib/features";
import { formatLocale } from "@/lib/i18n";
import { useT } from "@/lib/useI18n";
import { SELF_SERVE_PARTNER_FEATURE, fetchMyPartnerOrders, packageDurationLabel, type PartnerOrder } from "@/lib/partnerOrders";
import {
  PartnerAccountSuggestion,
  PartnerAudienceStats,
  PartnerDiscordBanner,
  PartnerStatusPill,
} from "@/components/partnerOrders/PartnerOrderParts";

// "Meus anúncios": every order this account made, the running ones first,
// with the numbers that matter at a glance. Each opens its own page.

const POLL_MS = 15_000;

export function PartnerDashboard() {
  const t = useT();
  const { account, loading } = useAuth();
  // Counted here: the builder and the dashboard are where the experiment's
  // feature actually is (see SELF_SERVE_PARTNER_FEATURE).
  useFeature(SELF_SERVE_PARTNER_FEATURE, { track: true });
  const [orders, setOrders] = useState<PartnerOrder[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    // Signed in or not: the account's orders plus the ones this browser holds
    // keys to (see fetchMyPartnerOrders). Waits for the session to settle so
    // the first answer already includes the account's.
    if (loading) return;
    let cancelled = false;
    const load = () =>
      fetchMyPartnerOrders()
        .then((list) => {
          if (cancelled) return;
          setOrders(list);
          setError(false);
        })
        .catch(() => {
          if (!cancelled) setError(true);
        });
    void load();
    const id = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [account, loading]);

  const live = orders?.filter((o) => o.live) ?? [];
  const totals = live.reduce(
    (acc, o) => ({
      views: acc.views + (o.stats?.views ?? 0),
      clicks: acc.clicks + (o.stats?.clicks ?? 0) + (o.stats?.clicksByVideo ?? 0),
    }),
    { views: 0, clicks: 0 }
  );
  const sorted = [...(orders ?? [])].sort((a, b) => Number(b.live) - Number(a.live) || b.createdAt - a.createdAt);
  const number = (n: number) => n.toLocaleString(formatLocale());

  return (
    <main className="mx-auto w-full max-w-5xl grow px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
            {t("partnerPitch.eyebrow")}
          </p>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-950 dark:text-zinc-50">{t("partnerOrders.myAds")}</h1>
        </div>
        <Link
          href="/partner/new"
          className="flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-emerald-500"
        >
          <MdAdd className="h-5 w-5" />
          {t("partnerOrders.createAd")}
        </Link>
      </div>

      {/* No account needed — but this browser only knows the orders it made. */}
      {!loading && !account && (
        <div className="mt-4 flex flex-col gap-2">
          <PartnerAccountSuggestion />
          <p className="text-xs text-zinc-500 dark:text-zinc-400">{t("partnerOrders.dashboard.guestHint")}</p>
        </div>
      )}

      {live.length > 0 && (
        <div className="mt-5 grid grid-cols-3 gap-2">
          <Tile label={t("partnerOrders.dashboard.liveNow")} value={number(live.length)} />
          <Tile label={t("partnerOrders.dashboard.impressions")} value={number(totals.views)} />
          <Tile label={t("partnerOrders.dashboard.clicks")} value={number(totals.clicks)} />
        </div>
      )}

      <section className="mt-6">
        {orders === null ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">{error ? t("partnerOrders.loadFailed") : t("common.loading")}</p>
        ) : sorted.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-zinc-300 bg-white p-8 text-center dark:border-zinc-700 dark:bg-zinc-950">
            <p className="text-lg font-semibold text-zinc-950 dark:text-zinc-50">{t("partnerOrders.dashboard.emptyTitle")}</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-zinc-500 dark:text-zinc-400">{t("partnerOrders.dashboard.emptyText")}</p>
            <Link
              href="/partner/new"
              className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-emerald-500"
            >
              <MdAdd className="h-5 w-5" />
              {t("partnerOrders.createAd")}
            </Link>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {sorted.map((order) => {
              const hero = partnerWideImage(order.creative);
              const clicks = (order.stats?.clicks ?? 0) + (order.stats?.clicksByVideo ?? 0);
              return (
                <li key={order.id}>
                  <Link
                    href={`/partner/${encodeURIComponent(order.id)}`}
                    className="flex items-center gap-3 rounded-xl border border-zinc-200 bg-white p-3 transition hover:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-zinc-600"
                  >
                    <div
                      className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg"
                      style={{ backgroundColor: order.creative.backgroundColor ?? "#111827" }}
                    >
                      {hero ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={hero} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <span className="text-xl font-bold" style={{ color: order.creative.textColor ?? "#fff" }}>
                          {order.creative.title.slice(0, 1).toUpperCase()}
                        </span>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="min-w-0 truncate font-semibold text-zinc-950 dark:text-zinc-50">{order.creative.title}</p>
                        <PartnerStatusPill order={order} />
                      </div>
                      <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                        {packageDurationLabel(order.hours)} · {order.amountLabel}
                        {order.endsAt && order.status === "approved"
                          ? ` · ${order.live ? t("partnerOrders.endsAt") : t("partnerOrders.endedAt")} ${new Date(order.endsAt).toLocaleString(formatLocale(), { dateStyle: "short", timeStyle: "short" })}`
                          : ""}
                      </p>
                      {order.stats && (
                        <p className="mt-0.5 text-xs text-zinc-600 dark:text-zinc-300">
                          {t("partnerOrders.dashboard.rowStats", {
                            views: number(order.stats.views),
                            people: number(order.stats.uniqueViews ?? 0),
                            clicks: number(clicks),
                          })}
                        </p>
                      )}
                    </div>
                    <MdChevronRight className="h-5 w-5 shrink-0 text-zinc-400" />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <div className="mt-8 flex flex-col gap-5">
        <PartnerAudienceStats />
        <PartnerDiscordBanner source="dashboard" />
      </div>
    </main>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950">
      <p className="text-xl font-bold tabular-nums text-zinc-950 dark:text-zinc-50">{value}</p>
      <p className="text-xs text-zinc-500 dark:text-zinc-400">{label}</p>
    </div>
  );
}
