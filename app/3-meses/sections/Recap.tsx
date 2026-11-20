"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useLocale, useT, useTCount } from "@/lib/useI18n";
import { LOCALE_TAGS } from "@/lib/i18n";
import { useAuth } from "@/lib/AuthContext";
import { useAccountToken } from "@/lib/accountApi";
import { ANNIVERSARY_EVENTS, ANNIVERSARY_HASHTAG, anniversaryShareUrl, fetchMyAnniversary, trackAnniversary, type AnniversaryRecap } from "@/lib/anniversary";
import {
  compareCall,
  compareMic,
  compareShare,
  earlierThanPercent,
  recapStyle,
  typingHours,
  type Comparison,
} from "@/lib/anniversaryRecap";
import { gsap, ScrollTrigger, useGSAP } from "../gsap";
import { Mascot } from "../Mascot";
import { SceneTitle, useNumberFormat } from "../shared";
import { ShareSheet } from "../ShareSheet";
import { drawRecapCard } from "../shareCard";

// "Seu GoLive": the signed-in person's own three months, told like stories —
// pinned, one card per scroll step, with the bars on top. A guest gets the
// way in (sign in, then back here).

export const RECAP_ANCHOR = "seu-recap";

const DEVICE_LABEL: Record<string, string> = {
  windows: "Windows",
  macos: "macOS",
  linux: "Linux",
  android: "Android",
  ios: "iPhone",
};

const TIER_LABEL: Record<string, string> = {
  premium: "Go Live Pro",
  premium_max: "Go Live Pro Max",
  pro_ultra: "Go Live Pro Ultra",
};

/** Draws the signed-in person's recap picture; `face` swaps the look on it. */
export type RecapCardDrawer = (face?: string | null) => Promise<Blob | null>;

export function RecapSection({ onCard }: { onCard?: (draw: RecapCardDrawer) => void }) {
  const t = useT();
  const { account, loading } = useAuth();
  const token = useAccountToken();
  const [recap, setRecap] = useState<AnniversaryRecap | null>(null);
  const [failed, setFailed] = useState(false);
  const signedIn = Boolean(account && token);

  useEffect(() => {
    if (!signedIn || !token) return;
    const controller = new AbortController();
    fetchMyAnniversary(token, controller.signal)
      .then((data) => {
        setRecap(data);
        trackAnniversary(ANNIVERSARY_EVENTS.recapView);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, [signedIn, token]);

  return (
    <section id={RECAP_ANCHOR} data-scene="recap" className="relative">
      {recap ? (
        <RecapStory recap={recap} onCard={onCard} />
      ) : (
        <div className="px-4 py-28 sm:py-36">
          <SceneTitle kicker={t("anniversary.recap.kicker")} title={t("anniversary.recap.title")} color="var(--a-green)" />
          <div className="mx-auto mt-12 flex max-w-md flex-col items-center rounded-lg border border-[var(--a-line)] bg-[var(--a-card)] p-8 text-center">
            <div className="w-28">
              <Mascot mood={failed ? "sweat" : signedIn || loading ? "think" : "wave"} />
            </div>
            {failed ? (
              <p className="mt-4 text-lg font-bold">{t("anniversary.recap.failed")}</p>
            ) : signedIn || loading ? (
              <>
                <p className="mt-4 text-lg font-bold">{t("anniversary.recap.loading")}</p>
                <div className="mt-5 h-2 w-40 overflow-hidden rounded-full bg-white/10">
                  <div className="h-full w-1/2 animate-pulse rounded-full bg-[var(--a-green)]" />
                </div>
              </>
            ) : (
              <>
                <p className="mt-4 text-xl font-extrabold">{t("anniversary.recap.guestTitle")}</p>
                <p className="mt-2 text-[15px] leading-relaxed text-[var(--a-mute)]">{t("anniversary.recap.guestText")}</p>
                <Link
                  href={`/login?next=${encodeURIComponent(`/3-meses#${RECAP_ANCHOR}`)}`}
                  onClick={() => trackAnniversary(ANNIVERSARY_EVENTS.recapLogin)}
                  className="anniv-mono mt-6 rounded-sm bg-[var(--a-green)] px-6 py-3.5 text-sm font-semibold uppercase text-zinc-900 transition hover:brightness-110"
                >
                  {t("anniversary.recap.guestCta")}
                </Link>
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

type Slide = { id: string; bg: string; ink: string; body: ReactNode };

/** A number that rolls up as its slide comes in (see the timeline below). */
function Count({ value, digits = 0 }: { value: number; digits?: number }) {
  const fmt = useNumberFormat();
  return (
    <span className="rc-count tabular-nums" data-to={value} data-digits={digits}>
      {fmt(value, digits)}
    </span>
  );
}

function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="anniv-mono inline-flex items-center gap-1.5 rounded-sm bg-black/15 px-2.5 py-1.5 text-xs font-semibold uppercase">{children}</span>
  );
}

function Avatar({ src, name, size = 64 }: { src: string | null; name: string; size?: number }) {
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" className="shrink-0 rounded-full object-cover ring-4 ring-white/40" style={{ width: size, height: size }} />
  ) : (
    <span
      className="flex shrink-0 items-center justify-center rounded-full bg-white/30 font-black ring-4 ring-white/40"
      style={{ width: size, height: size, fontSize: size * 0.42 }}
    >
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

function RecapStory({ recap, onCard }: { recap: AnniversaryRecap; onCard?: (draw: RecapCardDrawer) => void }) {
  const t = useT();
  const tc = useTCount();
  const locale = useLocale();
  const fmt = useNumberFormat();
  const ref = useRef<HTMLDivElement>(null);
  const { account } = useAuth();

  const hoursDigits = (h: number) => (h > 0 && h < 10 ? 1 : 0);
  const messages = (recap.groupMessages ?? 0) + (recap.directMessages ?? 0);
  const hasMessages = recap.groupMessages !== null || recap.directMessages !== null;
  const style = recapStyle({ callHours: recap.callHours, shareHours: recap.shareHours, micHours: recap.micHours, messages });
  const joined = new Intl.DateTimeFormat(LOCALE_TAGS[locale], { day: "numeric", month: "long", timeZone: "America/Sao_Paulo" }).format(
    new Date(recap.joinedAt)
  );
  const earlier = earlierThanPercent(recap.accountNumber, recap.accountsTotal);

  const cmp = (c: Comparison | null) => (c ? tc(`anniversary.recap.cmp.${c.key}`, c.n, { n: fmt(c.n) }) : null);
  const beat = (pct: number) => (pct > 0 ? <Chip>{t("anniversary.recap.moreThan", { pct })}</Chip> : null);

  const timeSlide = (
    id: string,
    hours: number,
    pct: number,
    comparison: string | null,
    bg: string,
    ink: string
  ): Slide => ({
    id,
    bg,
    ink,
    body: (
      <>
        <p className="text-lg font-extrabold opacity-80">{t(`anniversary.recap.${id}.lead`)}</p>
        <p className="anniv-display mt-3 text-[6.5rem] leading-none sm:text-[7.5rem]">
          <Count value={hours} digits={hoursDigits(hours)} />
          <span className="text-5xl opacity-60">h</span>
        </p>
        <p className="mt-2 text-xl font-extrabold">{t(`anniversary.recap.${id}.label`)}</p>
        {hours > 0 ? (
          <>
            {comparison && <p className="mt-6 text-2xl font-black leading-tight">{comparison}</p>}
            <div className="mt-5">{beat(pct)}</div>
          </>
        ) : (
          <p className="mt-6 text-xl font-bold leading-snug">{t(`anniversary.recap.${id}.zero`)}</p>
        )}
      </>
    ),
  });

  const slides: Slide[] = [
    {
      id: "hello",
      bg: "#4c86ff",
      ink: "#ffffff",
      body: (
        <>
          <div className="flex items-center gap-4">
            <Avatar src={recap.avatarUrl} name={recap.displayName} />
            <div className="min-w-0">
              <p className="truncate text-2xl font-black">{t("anniversary.recap.hello.hi", { name: recap.displayName })}</p>
              <p className="truncate text-sm font-bold opacity-75">@{recap.username}</p>
            </div>
          </div>
          <p className="mt-8 text-lg font-bold opacity-90">{t("anniversary.recap.hello.joined", { date: joined })}</p>
          <p className="anniv-display mt-3 text-[5rem] leading-none sm:text-[6rem]">#{fmt(recap.accountNumber)}</p>
          <p className="mt-2 text-lg font-bold opacity-90">{t("anniversary.recap.hello.number")}</p>
          <div className="mt-6 flex flex-wrap gap-2">
            {earlier > 0 && <Chip>{t("anniversary.recap.hello.earlier", { pct: earlier })}</Chip>}
            <Chip>{tc("anniversary.recap.hello.days", recap.daysWithUs, { n: fmt(recap.daysWithUs) })}</Chip>
          </div>
        </>
      ),
    },
    timeSlide("call", recap.callHours, recap.callPercent, cmp(compareCall(recap.callHours)), "#ece9e2", "#111215"),
    timeSlide("share", recap.shareHours, recap.sharePercent, cmp(compareShare(recap.shareHours)), "#f2b705", "#111215"),
    timeSlide("mic", recap.micHours, recap.micPercent, cmp(compareMic(recap.micHours)), "#ff3b2f", "#ffffff"),
    {
      id: "social",
      bg: "#1f2a44",
      ink: "#ffffff",
      body: (
        <>
          <p className="text-lg font-extrabold opacity-80">{t("anniversary.recap.social.lead")}</p>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="rounded-md bg-black/10 p-4">
              <p className="text-5xl font-black">
                <Count value={recap.friends} />
              </p>
              <p className="mt-1 font-extrabold">{tc("anniversary.recap.social.friends", recap.friends)}</p>
            </div>
            <div className="rounded-md bg-black/10 p-4">
              <p className="text-5xl font-black">
                <Count value={recap.groups} />
              </p>
              <p className="mt-1 font-extrabold">{tc("anniversary.recap.social.groups", recap.groups)}</p>
            </div>
          </div>
          {recap.ownedGroups > 0 && (
            <div className="mt-3">
              <Chip>{tc("anniversary.recap.social.owned", recap.ownedGroups, { n: recap.ownedGroups })}</Chip>
            </div>
          )}
          {recap.topGroup ? (
            <div className="mt-6 flex items-center gap-3 rounded-md bg-white/40 p-4">
              {recap.topGroup.iconUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={recap.topGroup.iconUrl} alt="" className="h-14 w-14 shrink-0 rounded-md object-cover" />
              ) : (
                <span className="anniv-display flex h-14 w-14 shrink-0 items-center justify-center rounded-md bg-black/15 text-3xl">{recap.topGroup.name.slice(0, 1)}</span>
              )}
              <div className="min-w-0">
                <p className="text-xs font-extrabold uppercase opacity-70">{t("anniversary.recap.social.topGroup")}</p>
                <p className="truncate text-xl font-black">{recap.topGroup.name}</p>
                <p className="text-sm font-bold opacity-80">
                  {tc("anniversary.recap.social.topGroupMsgs", recap.topGroup.messages, { n: fmt(recap.topGroup.messages) })}
                </p>
              </div>
            </div>
          ) : (
            recap.groups === 0 && <p className="mt-6 text-lg font-bold">{t("anniversary.recap.social.noGroups")}</p>
          )}
        </>
      ),
    },
  ];

  if (hasMessages) {
    const typing = typingHours(messages);
    slides.push({
      id: "messages",
      bg: "#ece9e2",
      ink: "#111215",
      body: (
        <>
          <p className="text-lg font-extrabold opacity-80">{t("anniversary.recap.messages.lead")}</p>
          <p className="anniv-display mt-3 text-[5.5rem] leading-none sm:text-[6.5rem]">
            <Count value={messages} />
          </p>
          <p className="mt-2 text-xl font-extrabold">{tc("anniversary.recap.messages.label", messages)}</p>
          {typing && <p className="mt-5 text-2xl font-black leading-tight">{tc("anniversary.recap.messages.typing", typing, { n: fmt(typing) })}</p>}
          {messages === 0 && <p className="mt-5 text-xl font-bold">{t("anniversary.recap.messages.zero")}</p>}
          {recap.topFriend && (
            <div className="mt-6 flex items-center gap-3 rounded-md bg-white/40 p-4">
              <Avatar src={recap.topFriend.avatarUrl} name={recap.topFriend.displayName} size={52} />
              <div className="min-w-0">
                <p className="text-xs font-extrabold uppercase opacity-70">{t("anniversary.recap.messages.topFriend")}</p>
                <p className="truncate text-xl font-black">{recap.topFriend.displayName}</p>
                <p className="text-sm font-bold opacity-80">
                  {tc("anniversary.recap.messages.topFriendMsgs", recap.topFriend.messages, { n: fmt(recap.topFriend.messages) })}
                </p>
              </div>
            </div>
          )}
        </>
      ),
    });
  }

  if (recap.lastRoom || (recap.calls ?? 0) > 0) {
    slides.push({
      id: "rooms",
      bg: "#4c86ff",
      ink: "#ffffff",
      body: (
        <>
          {recap.lastRoom && (
            <>
              <p className="text-lg font-extrabold opacity-80">{t("anniversary.recap.rooms.lastRoom")}</p>
              <p
                className={`mt-3 break-words font-black leading-tight ${
                  (recap.lastRoom.handle?.length ?? 0) > 16 ? "text-2xl" : (recap.lastRoom.handle?.length ?? 0) > 10 ? "text-3xl" : "text-5xl"
                }`}
              >
                {recap.lastRoom.handle ? `#${recap.lastRoom.handle}` : t("anniversary.recap.rooms.private")}
              </p>
            </>
          )}
          {(recap.calls ?? 0) > 0 && (
            <div className="mt-8 rounded-md bg-black/10 p-5">
              <p className="text-5xl font-black">
                <Count value={recap.calls ?? 0} />
              </p>
              <p className="mt-1 text-lg font-extrabold">{tc("anniversary.recap.rooms.calls", recap.calls ?? 0)}</p>
              {(recap.callMinutes ?? 0) > 0 && (
                <p className="mt-1 font-bold opacity-80">{tc("anniversary.recap.rooms.callMinutes", recap.callMinutes ?? 0, { n: fmt(recap.callMinutes ?? 0) })}</p>
              )}
            </div>
          )}
        </>
      ),
    });
  }

  const shareText = t("anniversary.recap.shareText", {
    call: fmt(recap.callHours, hoursDigits(recap.callHours)),
    share: fmt(recap.shareHours, hoursDigits(recap.shareHours)),
    style: t(`anniversary.recap.style.${style}`),
  });
  const shareTextX = t("anniversary.recap.shareTextX", {
    call: fmt(recap.callHours, hoursDigits(recap.callHours)),
    share: fmt(recap.shareHours, hoursDigits(recap.shareHours)),
    style: t(`anniversary.recap.style.${style}`),
  });

  // The story picture: everything worth posting, Wrapped-style.
  // `face`: another look to draw (the gift shows the frame just won).
  const drawCard = (face?: string | null) => {
    trackAnniversary(ANNIVERSARY_EVENTS.recapCard);
    const stats = [
      { value: `${fmt(recap.shareHours, hoursDigits(recap.shareHours))}h`, label: t("anniversary.recap.card.streaming") },
      { value: `${fmt(recap.micHours, hoursDigits(recap.micHours))}h`, label: t("anniversary.recap.card.mic") },
      ...(hasMessages ? [{ value: fmt(messages), label: t("anniversary.recap.card.messages") }] : []),
      ...(recap.calls ? [{ value: fmt(recap.calls), label: t("anniversary.recap.card.calls") }] : []),
      { value: fmt(recap.friends), label: t("anniversary.recap.card.friends") },
      { value: fmt(recap.groups), label: t("anniversary.recap.card.groups") },
      { value: fmt(recap.daysWithUs), label: t("anniversary.recap.card.days") },
      { value: `#${fmt(recap.accountNumber)}`, label: t("anniversary.recap.card.number") },
      ...(recap.points > 0 ? [{ value: fmt(recap.points), label: t("anniversary.recap.card.points") }] : []),
    ].slice(0, 9);
    const footnote = [
      t("anniversary.recap.hello.joined", { date: joined }),
      earlier > 0 ? t("anniversary.recap.hello.earlier", { pct: earlier }) : null,
      recap.topGroup ? t("anniversary.recap.card.topGroup", { name: recap.topGroup.name }) : null,
      recap.topFriend ? t("anniversary.recap.card.topFriend", { name: recap.topFriend.displayName }) : null,
      TIER_LABEL[recap.tier] ?? null,
    ]
      .filter(Boolean)
      .join(" · ");
    return drawRecapCard(
      {
        kicker: t("anniversary.recap.summary.kicker"),
        name: recap.displayName,
        handle: `@${recap.username}`,
        // The face as the site shows it now: with the decoration, if one is on.
        face: face !== undefined ? face : account?.avatarUrl ?? recap.avatarUrl,
        bigLabel: t("anniversary.recap.card.call"),
        bigValue: `${fmt(recap.callHours, hoursDigits(recap.callHours))}h`,
        comparison: recap.callHours > 0 ? cmp(compareCall(recap.callHours)) : null,
        stats,
        styleLead: t("anniversary.recap.summary.styleLead"),
        style: t(`anniversary.recap.style.${style}`),
        footnote,
      },
      { live: t("anniversary.card.live"), brand: t("anniversary.card.brand"), hashtag: ANNIVERSARY_HASHTAG, url: "golive.nemtudo.me/3-meses" }
    );
  };

  // The rest of the page (the gift, the finale) shares this picture too.
  useEffect(() => {
    onCard?.(drawCard);
  });

  const summary = [
    { v: `${fmt(recap.callHours, hoursDigits(recap.callHours))}h`, l: t("anniversary.recap.summary.call") },
    { v: `${fmt(recap.shareHours, hoursDigits(recap.shareHours))}h`, l: t("anniversary.recap.summary.streaming") },
    { v: `${fmt(recap.micHours, hoursDigits(recap.micHours))}h`, l: t("anniversary.recap.summary.mic") },
    ...(hasMessages ? [{ v: fmt(messages), l: t("anniversary.recap.summary.messages") }] : []),
    { v: fmt(recap.friends), l: t("anniversary.recap.summary.friends") },
    { v: fmt(recap.groups), l: t("anniversary.recap.summary.groups") },
  ];

  slides.push({
    id: "summary",
    bg: "#16181c",
    ink: "#ffffff",
    body: (
      <>
        <div className="flex items-center gap-3">
          <Avatar src={recap.avatarUrl} name={recap.displayName} size={48} />
          <div className="min-w-0">
            <p className="truncate text-lg font-black">{recap.displayName}</p>
            <p className="anniv-mono text-[9px] text-[var(--a-amber)]">{t("anniversary.recap.summary.kicker")}</p>
          </div>
        </div>
        <div className="mt-5 rounded-md bg-white/10 p-4 text-center">
          <p className="text-xs font-extrabold uppercase tracking-wider text-white/60">{t("anniversary.recap.summary.styleLead")}</p>
          <p className="mt-1 text-3xl font-black">
            <span className="anniv-accent">{t(`anniversary.recap.style.${style}`)}</span>
          </p>
          <p className="mt-1 text-sm font-semibold text-white/70">{t(`anniversary.recap.styleText.${style}`)}</p>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2">
          {summary.map((s) => (
            <div key={s.l} className="rounded-md bg-white/[0.07] px-2 py-3 text-center">
              <p className="text-xl font-black tabular-nums">{s.v}</p>
              <p className="text-[11px] font-bold leading-tight text-white/60">{s.l}</p>
            </div>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap gap-1.5 text-xs font-bold">
          {TIER_LABEL[recap.tier] && <span className="anniv-mono rounded-sm bg-white/15 px-2 py-1 uppercase">{TIER_LABEL[recap.tier]}</span>}
          {recap.points > 0 && <span className="anniv-mono rounded-sm bg-white/15 px-2 py-1 uppercase">{tc("anniversary.recap.summary.points", recap.points, { n: fmt(recap.points) })}</span>}
          {recap.devices.map((d) => DEVICE_LABEL[d] && <span key={d} className="anniv-mono rounded-sm bg-white/15 px-2 py-1 uppercase">{DEVICE_LABEL[d]}</span>)}
        </div>
        <p className="anniv-mono mt-5 text-[10px] uppercase text-white/60">{t("anniversary.recap.summary.share")}</p>
        <div className="mt-2">
          <ShareSheet
            text={shareText}
            xText={shareTextX}
            url={anniversaryShareUrl("recap")}
            card={drawCard}
            cardName="meu-recap-go-live.png"
            compact
            onShare={() => trackAnniversary(ANNIVERSARY_EVENTS.recapShare)}
          />
        </div>
      </>
    ),
  });

  useGSAP(
    () => {
      const move = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const els = gsap.utils.toArray<HTMLElement>(".rc-slide");
      const bars = gsap.utils.toArray<HTMLElement>(".rc-bar");
      gsap.set(els.slice(1), { autoAlpha: 0 });

      // Counts climb on their own clock as their slide comes in, never with
      // the scroll: a number caught halfway by a pause reads as the real one.
      const playCounts = (slide: HTMLElement) => {
        for (const el of slide.querySelectorAll<HTMLElement>(".rc-count")) {
          const to = Number(el.dataset.to) || 0;
          const digits = Number(el.dataset.digits) || 0;
          const state = { v: 0 };
          gsap.to(state, {
            v: to,
            duration: 1.1,
            ease: "power3.out",
            onUpdate: () => {
              el.textContent = state.v.toLocaleString(LOCALE_TAGS[locale], { maximumFractionDigits: digits, minimumFractionDigits: 0 });
            },
          });
        }
      };
      if (move) {
        for (const slide of els.slice(1)) {
          for (const el of slide.querySelectorAll<HTMLElement>(".rc-count")) el.textContent = "0";
        }
      }

      const tl = gsap.timeline({
        defaults: { ease: "power2.out" },
        scrollTrigger: {
          trigger: ref.current,
          pin: ".rc-pin",
          start: "top top",
          end: () => `+=${els.length * 55}%`,
          scrub: 0.3,
          anticipatePin: 1,
          // One slide per stop, like tapping through stories.
          snap: { snapTo: "labelsDirectional", duration: { min: 0.2, max: 0.5 }, delay: 0.05, ease: "power1.inOut" },
        },
      });
      const forward = () => (tl.scrollTrigger?.direction ?? 1) > 0;
      let ended = false;

      els.forEach((slide, i) => {
        if (i > 0) {
          const prev = els[i - 1];
          tl.call(() => {
            if (forward() && move) playCounts(slide);
          });
          tl.to(prev, { autoAlpha: 0, scale: move ? 0.94 : 1, duration: 0.35 });
          tl.fromTo(
            slide,
            { autoAlpha: 0, y: move ? "18%" : 0 },
            { autoAlpha: 1, y: 0, duration: 0.4, ease: "power3.out" },
            "<0.05"
          );
        }
        tl.addLabel(`s${i}`);
        if (i === els.length - 1) {
          tl.call(() => {
            if (forward() && !ended) {
              ended = true;
              trackAnniversary(ANNIVERSARY_EVENTS.recapEnd);
            }
          });
        }
        tl.fromTo(bars[i], { scaleX: 0 }, { scaleX: 1, duration: 0.4, ease: "none" });
      });

      // Made after the pins above it (it waits for the API), so it is put back
      // in page order before measuring: a pin is placed after every pin above.
      ScrollTrigger.sort();
      ScrollTrigger.refresh();

      // Back from signing in (/login?next=/3-meses#seu-recap): land on the
      // story itself — again after each re-measure of the first seconds, as
      // the numbers above arriving moves everything down.
      if (window.location.hash === `#${RECAP_ANCHOR}` && tl.scrollTrigger) {
        const st = tl.scrollTrigger;
        const land = () => window.scrollTo({ top: st.start + 2 });
        land();
        ScrollTrigger.addEventListener("refresh", land);
        const stop = () => ScrollTrigger.removeEventListener("refresh", land);
        const timer = setTimeout(stop, 6000);
        window.addEventListener("wheel", stop, { once: true, passive: true });
        window.addEventListener("touchstart", stop, { once: true, passive: true });
        return () => {
          clearTimeout(timer);
          stop();
        };
      }
    },
    { scope: ref }
  );

  return (
    <div ref={ref}>
      <div className="rc-pin flex min-h-[100svh] flex-col items-center justify-center gap-5 px-4 py-16">
        <div className="text-center">
          <p className="anniv-mono flex items-center justify-center gap-2.5 text-xs uppercase text-[var(--a-green)]">
            <span className="h-2 w-2 bg-[var(--a-green)]" aria-hidden="true" />
            {t("anniversary.recap.kicker")}
          </p>
          <h2 className="anniv-display mt-3 text-5xl sm:text-6xl">{t("anniversary.recap.storyTitle")}</h2>
        </div>
        <div className="relative h-[min(74svh,600px)] w-full max-w-[400px]">
          <div className="absolute inset-x-4 top-3 z-20 flex gap-1.5">
            {slides.map((s) => (
              <span key={s.id} className="h-[3px] flex-1 overflow-hidden bg-white/35">
                <span className="rc-bar block h-full origin-left scale-x-0 bg-white" />
              </span>
            ))}
          </div>
          {slides.map((s) => (
            <article
              key={s.id}
              className="rc-slide absolute inset-0 flex flex-col overflow-hidden rounded-xl px-6 pb-6 pt-10 shadow-[0_24px_60px_rgba(0,0,0,0.45)]"
              style={{ background: s.bg, color: s.ink }}
            >
              {s.body}
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}
