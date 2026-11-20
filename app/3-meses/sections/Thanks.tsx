"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useT } from "@/lib/useI18n";
import {
  ANNIVERSARY_EVENTS,
  fetchAdvertisers,
  fetchSupporters,
  trackAnniversary,
  type Advertiser,
  type Supporter,
  type SupporterTier,
} from "@/lib/anniversary";
import { UserAvatar } from "@/components/UserAvatar";
import { SceneTitle, useNumberFormat } from "../shared";
import { Ticker } from "../Ticker";

// "Nada disso seria possível sem...": the closing credits. The partner that
// hosts the site, then rows that keep sliding by — everyone who has advertised,
// and everyone subscribed today, by plan. Each face opens its profile.
//
// Subscribers come a page at a time (see the API's anniversaryThanks.ts):
// a row asks for the next page as it comes round to the end of what it has,
// so all of them pass by without anyone downloading thousands at once.

const SQUARE_CLOUD_URL = "https://squarecloud.app";
const PAGE = 40;
const TIERS: { tier: SupporterTier; label: string; color: string; speed: number }[] = [
  { tier: "pro_ultra", label: "Pro Ultra", color: "var(--a-amber)", speed: 34 },
  { tier: "premium_max", label: "Pro Max", color: "#c084fc", speed: 42 },
  { tier: "premium", label: "Pro", color: "var(--a-blue)", speed: 50 },
];

/** One plan's subscribers, loaded a page at a time once the wall is near. */
function useSupporters(tier: SupporterTier, active: boolean) {
  const [people, setPeople] = useState<Supporter[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const next = useRef<number | null>(0);
  const loading = useRef(false);

  const more = useCallback(() => {
    if (loading.current || next.current === null) return;
    loading.current = true;
    fetchSupporters(tier, next.current, PAGE)
      .then((page) => {
        next.current = page.next;
        setTotal(page.total);
        setPeople((list) => {
          const known = new Set(list.map((p) => p.id));
          return [...list, ...page.people.filter((p) => !known.has(p.id))];
        });
      })
      .catch(() => {
        // Tried again the next time the row asks.
      })
      .finally(() => {
        loading.current = false;
      });
  }, [tier]);

  useEffect(() => {
    if (active && total === null) more();
  }, [active, total, more]);

  return { people, total, more };
}

export function ThanksSection() {
  const t = useT();
  const fmt = useNumberFormat();
  const ref = useRef<HTMLElement>(null);
  const [near, setNear] = useState(false);
  const [ads, setAds] = useState<Advertiser[] | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setNear(true);
          observer.disconnect();
        }
      },
      { rootMargin: "800px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!near) return;
    fetchAdvertisers()
      .then(setAds)
      .catch(() => setAds([]));
  }, [near]);

  const ultra = useSupporters("pro_ultra", near);
  const max = useSupporters("premium_max", near);
  const pro = useSupporters("premium", near);
  const rows = [ultra, max, pro];

  const label = "anniv-mono flex items-center gap-2.5 text-xs uppercase";

  return (
    <section ref={ref} data-scene="thanks" className="relative overflow-hidden py-28 sm:py-36">
      <div className="px-4 sm:px-8">
        <SceneTitle kicker={t("anniversary.thanks.kicker")} title={t("anniversary.thanks.title")} sub={t("anniversary.thanks.sub")} color="var(--a-green)" />

        {/* The partner */}
        <a
          href={SQUARE_CLOUD_URL}
          target="_blank"
          rel="noreferrer"
          onClick={() => trackAnniversary(ANNIVERSARY_EVENTS.thanksPartner)}
          className="group mx-auto mt-14 flex max-w-6xl flex-col gap-5 border border-[var(--a-line)] bg-[var(--a-card)] p-7 transition-colors hover:border-[var(--a-ink)] sm:flex-row sm:items-center sm:justify-between sm:p-9"
        >
          <div>
            <p className={`${label} text-[var(--a-green)]`}>
              <span className="h-2 w-2 bg-[var(--a-green)]" aria-hidden="true" />
              {t("anniversary.thanks.partnerKicker")}
            </p>
            <p className="anniv-display mt-3 text-6xl sm:text-7xl">Square Cloud</p>
            <p className="mt-3 max-w-2xl text-lg leading-relaxed text-[var(--a-mute)]">{t("anniversary.thanks.partnerText")}</p>
          </div>
          <span className="anniv-mono shrink-0 self-start bg-[var(--a-ink)] px-5 py-3 text-xs font-semibold uppercase text-[var(--a-bg)] transition group-hover:bg-white sm:self-center">
            {t("anniversary.thanks.partnerCta")} ↗
          </span>
        </a>
      </div>

      {/* The rolls */}
      <div className="mt-16 flex flex-col gap-12">
        <div>
          <p className={`${label} mx-auto mb-4 max-w-6xl px-4 text-[var(--a-tally)] sm:px-8`}>
            <span className="h-2 w-2 bg-[var(--a-tally)]" aria-hidden="true" />
            {t("anniversary.thanks.advertisers")}
            {ads && <span className="text-[var(--a-mute)]">· {fmt(ads.length)}</span>}
          </p>
          {ads === null ? (
            <div className="mx-auto h-14 max-w-6xl animate-pulse bg-white/[0.04]" />
          ) : ads.length === 0 ? (
            <p className="mx-auto max-w-6xl px-4 text-sm text-[var(--a-mute)] sm:px-8">{t("anniversary.thanks.empty")}</p>
          ) : (
            <Ticker
              items={ads}
              itemKey={(a) => a.name}
              speed={36}
              render={(a) => {
                const chip = (
                  <span className="flex h-14 items-center gap-3 border border-[var(--a-line)] bg-[var(--a-card)] px-4 pr-5">
                    {a.iconUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={a.iconUrl} alt="" className="h-8 w-8 shrink-0 rounded-sm object-cover" loading="lazy" />
                    ) : (
                      <span className="anniv-display flex h-8 w-8 items-center justify-center bg-white/10 text-lg">{a.name.slice(0, 1)}</span>
                    )}
                    <span className="max-w-[16rem] truncate text-base font-bold">{a.name}</span>
                  </span>
                );
                return a.url ? (
                  <a href={a.url} target="_blank" rel="noreferrer sponsored" onClick={() => trackAnniversary(ANNIVERSARY_EVENTS.thanksAd)} className="block transition-opacity hover:opacity-80">
                    {chip}
                  </a>
                ) : (
                  chip
                );
              }}
            />
          )}
        </div>

        {TIERS.map((row, i) => {
          const data = rows[i];
          return (
            <div key={row.tier}>
              <p className={`${label} mx-auto mb-4 max-w-6xl px-4 sm:px-8`} style={{ color: row.color }}>
                <span className="h-2 w-2" style={{ background: row.color }} aria-hidden="true" />
                {row.label}
                {data.total !== null && <span className="text-[var(--a-mute)]">· {fmt(data.total)}</span>}
              </p>
              {data.total === null ? (
                <div className="mx-auto h-24 max-w-6xl animate-pulse bg-white/[0.04]" />
              ) : data.people.length === 0 ? (
                <p className="mx-auto max-w-6xl px-4 text-sm text-[var(--a-mute)] sm:px-8">{t("anniversary.thanks.empty")}</p>
              ) : (
                <Ticker
                  items={data.people}
                  itemKey={(p) => p.id}
                  speed={row.speed}
                  onNeedMore={data.more}
                  render={(p) => (
                    <a
                      href={`/user/${encodeURIComponent(p.username)}`}
                      target="_blank"
                      rel="noreferrer"
                      onClick={() => trackAnniversary(ANNIVERSARY_EVENTS.thanksProfile)}
                      className="group flex w-24 flex-col items-center gap-2 pt-2"
                      title={`@${p.username}`}
                    >
                      <span className="flex transition-transform group-hover:scale-110">
                        <UserAvatar src={p.avatarUrl} name={p.name} size={56} />
                      </span>
                      <span className="w-full truncate text-center text-xs font-semibold text-[var(--a-ink)]/85 group-hover:text-[var(--a-ink)]">{p.name}</span>
                    </a>
                  )}
                />
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
