"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useLocale, useT, useTCount } from "@/lib/useI18n";
import { LOCALE_TAGS } from "@/lib/i18n";
import { useAuth } from "@/lib/AuthContext";
import { useAccountToken } from "@/lib/accountApi";
import { ANNIVERSARY_EVENTS, fetchMyAnniversary, trackAnniversary, type AnniversaryRecap } from "@/lib/anniversary";
import {
  compareCall,
  compareMic,
  compareShare,
  earlierThanPercent,
  recapStyle,
  typingHours,
  type Comparison,
  type RecapStyle,
} from "@/lib/anniversaryRecap";
import { gsap, ScrollTrigger, useGSAP } from "../gsap";
import { Mascot } from "../Mascot";
import { SceneTitle, useNumberFormat } from "../shared";

// "Seu GoLive": the signed-in person's own three months, told like stories —
// pinned, one card per scroll step, with the bars on top. A guest gets the
// way in (sign in, then back here).

export const RECAP_ANCHOR = "seu-recap";

const STYLE_EMOJI: Record<RecapStyle, string> = {
  streamer: "🎥",
  talker: "🎙️",
  listener: "🎧",
  typist: "⌨️",
  starter: "🌱",
};

const DEVICE_LABEL: Record<string, string> = {
  windows: "🪟 Windows",
  macos: "🍏 macOS",
  linux: "🐧 Linux",
  android: "🤖 Android",
  ios: "📱 iPhone",
};

const TIER_LABEL: Record<string, string> = {
  premium: "💎 Go Live Pro",
  premium_max: "👑 Go Live Pro Max",
  pro_ultra: "🚀 Go Live Pro Ultra",
};

export function RecapSection() {
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
        <RecapStory recap={recap} />
      ) : (
        <div className="px-4 py-28 sm:py-36">
          <SceneTitle kicker={t("anniversary.recap.kicker")} title={t("anniversary.recap.title")} color="var(--a-green)" />
          <div className="mx-auto mt-12 flex max-w-md flex-col items-center rounded-[32px] border border-[var(--a-line)] bg-[var(--a-card)] p-8 text-center">
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
                  className="mt-6 rounded-2xl bg-[var(--a-green)] px-7 py-3.5 font-extrabold text-zinc-900 transition hover:scale-[1.04] active:scale-95"
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
    <span className="inline-flex items-center gap-1.5 rounded-full bg-black/15 px-3 py-1.5 text-sm font-extrabold">{children}</span>
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

function RecapStory({ recap }: { recap: AnniversaryRecap }) {
  const t = useT();
  const tc = useTCount();
  const locale = useLocale();
  const fmt = useNumberFormat();
  const ref = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);

  const hoursDigits = (h: number) => (h > 0 && h < 10 ? 1 : 0);
  const messages = (recap.groupMessages ?? 0) + (recap.directMessages ?? 0);
  const hasMessages = recap.groupMessages !== null || recap.directMessages !== null;
  const style = recapStyle({ callHours: recap.callHours, shareHours: recap.shareHours, micHours: recap.micHours, messages });
  const joined = new Intl.DateTimeFormat(LOCALE_TAGS[locale], { day: "numeric", month: "long", timeZone: "America/Sao_Paulo" }).format(
    new Date(recap.joinedAt)
  );
  const earlier = earlierThanPercent(recap.accountNumber, recap.accountsTotal);

  const cmp = (c: Comparison | null) => (c ? tc(`anniversary.recap.cmp.${c.key}`, c.n, { n: fmt(c.n) }) : null);
  const beat = (pct: number) => (pct > 0 ? <Chip>🏆 {t("anniversary.recap.moreThan", { pct })}</Chip> : null);

  const timeSlide = (
    id: string,
    hours: number,
    pct: number,
    comparison: string | null,
    emoji: string,
    bg: string,
    ink: string
  ): Slide => ({
    id,
    bg,
    ink,
    body: (
      <>
        <p className="text-lg font-extrabold opacity-80">{t(`anniversary.recap.${id}.lead`)}</p>
        <p className="mt-2 text-[5.5rem] font-black leading-none tracking-tighter sm:text-[6.5rem]">
          <Count value={hours} digits={hoursDigits(hours)} />
          <span className="text-5xl">h</span>
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
        <span className="rc-emoji pointer-events-none absolute -bottom-6 -right-4 text-[9rem] opacity-30" aria-hidden="true">
          {emoji}
        </span>
      </>
    ),
  });

  const slides: Slide[] = [
    {
      id: "hello",
      bg: "linear-gradient(160deg,#6366f1 0%,#a21caf 70%,#f43f5e 100%)",
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
          <p className="mt-2 text-[4.5rem] font-black leading-none tracking-tighter sm:text-[5.5rem]">#{fmt(recap.accountNumber)}</p>
          <p className="mt-2 text-lg font-bold opacity-90">{t("anniversary.recap.hello.number")}</p>
          <div className="mt-6 flex flex-wrap gap-2">
            {earlier > 0 && <Chip>🐣 {t("anniversary.recap.hello.earlier", { pct: earlier })}</Chip>}
            <Chip>📅 {tc("anniversary.recap.hello.days", recap.daysWithUs, { n: fmt(recap.daysWithUs) })}</Chip>
          </div>
        </>
      ),
    },
    timeSlide("call", recap.callHours, recap.callPercent, cmp(compareCall(recap.callHours)), "📞", "#fbbf24", "#1c1400"),
    timeSlide("share", recap.shareHours, recap.sharePercent, cmp(compareShare(recap.shareHours)), "🖥️", "#38bdf8", "#04223a"),
    timeSlide("mic", recap.micHours, recap.micPercent, cmp(compareMic(recap.micHours)), "🎙️", "#fb7185", "#3b0712"),
    {
      id: "social",
      bg: "#34d399",
      ink: "#032b1d",
      body: (
        <>
          <p className="text-lg font-extrabold opacity-80">{t("anniversary.recap.social.lead")}</p>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="rounded-3xl bg-black/10 p-4">
              <p className="text-5xl font-black">
                <Count value={recap.friends} />
              </p>
              <p className="mt-1 font-extrabold">{tc("anniversary.recap.social.friends", recap.friends)}</p>
            </div>
            <div className="rounded-3xl bg-black/10 p-4">
              <p className="text-5xl font-black">
                <Count value={recap.groups} />
              </p>
              <p className="mt-1 font-extrabold">{tc("anniversary.recap.social.groups", recap.groups)}</p>
            </div>
          </div>
          {recap.ownedGroups > 0 && (
            <div className="mt-3">
              <Chip>🏰 {tc("anniversary.recap.social.owned", recap.ownedGroups, { n: recap.ownedGroups })}</Chip>
            </div>
          )}
          {recap.topGroup ? (
            <div className="mt-6 flex items-center gap-3 rounded-3xl bg-white/40 p-4">
              {recap.topGroup.iconUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={recap.topGroup.iconUrl} alt="" className="h-14 w-14 shrink-0 rounded-2xl object-cover" />
              ) : (
                <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-black/15 text-2xl">🏰</span>
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
          <span className="pointer-events-none absolute -bottom-6 -right-4 text-[9rem] opacity-25" aria-hidden="true">
            🤝
          </span>
        </>
      ),
    },
  ];

  if (hasMessages) {
    const typing = typingHours(messages);
    slides.push({
      id: "messages",
      bg: "#818cf8",
      ink: "#10123d",
      body: (
        <>
          <p className="text-lg font-extrabold opacity-80">{t("anniversary.recap.messages.lead")}</p>
          <p className="mt-2 text-[5rem] font-black leading-none tracking-tighter sm:text-[6rem]">
            <Count value={messages} />
          </p>
          <p className="mt-2 text-xl font-extrabold">{tc("anniversary.recap.messages.label", messages)}</p>
          {typing && <p className="mt-5 text-2xl font-black leading-tight">{tc("anniversary.recap.messages.typing", typing, { n: fmt(typing) })}</p>}
          {messages === 0 && <p className="mt-5 text-xl font-bold">{t("anniversary.recap.messages.zero")}</p>}
          {recap.topFriend && (
            <div className="mt-6 flex items-center gap-3 rounded-3xl bg-white/40 p-4">
              <Avatar src={recap.topFriend.avatarUrl} name={recap.topFriend.displayName} size={52} />
              <div className="min-w-0">
                <p className="text-xs font-extrabold uppercase opacity-70">💌 {t("anniversary.recap.messages.topFriend")}</p>
                <p className="truncate text-xl font-black">{recap.topFriend.displayName}</p>
                <p className="text-sm font-bold opacity-80">
                  {tc("anniversary.recap.messages.topFriendMsgs", recap.topFriend.messages, { n: fmt(recap.topFriend.messages) })}
                </p>
              </div>
            </div>
          )}
          <span className="pointer-events-none absolute -bottom-6 -right-4 text-[9rem] opacity-25" aria-hidden="true">
            💬
          </span>
        </>
      ),
    });
  }

  if (recap.lastRoom || (recap.calls ?? 0) > 0) {
    slides.push({
      id: "rooms",
      bg: "#fdba74",
      ink: "#3a1702",
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
                {recap.lastRoom.handle ? `#${recap.lastRoom.handle}` : `🤫 ${t("anniversary.recap.rooms.private")}`}
              </p>
            </>
          )}
          {(recap.calls ?? 0) > 0 && (
            <div className="mt-8 rounded-3xl bg-black/10 p-5">
              <p className="text-5xl font-black">
                <Count value={recap.calls ?? 0} />
              </p>
              <p className="mt-1 text-lg font-extrabold">{tc("anniversary.recap.rooms.calls", recap.calls ?? 0)}</p>
              {(recap.callMinutes ?? 0) > 0 && (
                <p className="mt-1 font-bold opacity-80">{tc("anniversary.recap.rooms.callMinutes", recap.callMinutes ?? 0, { n: fmt(recap.callMinutes ?? 0) })}</p>
              )}
            </div>
          )}
          <span className="pointer-events-none absolute -bottom-6 -right-4 text-[9rem] opacity-25" aria-hidden="true">
            🚪
          </span>
        </>
      ),
    });
  }

  const share = async () => {
    trackAnniversary(ANNIVERSARY_EVENTS.recapShare);
    const url = `${window.location.origin}/3-meses`;
    const text = t("anniversary.recap.shareText", {
      call: fmt(recap.callHours, hoursDigits(recap.callHours)),
      share: fmt(recap.shareHours, hoursDigits(recap.shareHours)),
      style: t(`anniversary.recap.style.${style}`),
    });
    try {
      if (navigator.share) {
        await navigator.share({ title: t("anniversary.meta.title"), text, url });
        return;
      }
    } catch {
      // Cancelled: copy instead.
    }
    try {
      await navigator.clipboard.writeText(`${text} ${url}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      // Nothing more to try.
    }
  };

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
    bg: "linear-gradient(165deg,#0f1226 0%,#1e1b4b 55%,#3b0a45 100%)",
    ink: "#ffffff",
    body: (
      <>
        <div className="flex items-center gap-3">
          <Avatar src={recap.avatarUrl} name={recap.displayName} size={48} />
          <div className="min-w-0">
            <p className="truncate text-lg font-black">{recap.displayName}</p>
            <p className="anniv-pixel text-[9px] text-[var(--a-amber)]">{t("anniversary.recap.summary.kicker")}</p>
          </div>
        </div>
        <div className="mt-5 rounded-3xl bg-white/10 p-4 text-center">
          <p className="text-xs font-extrabold uppercase tracking-wider text-white/60">{t("anniversary.recap.summary.styleLead")}</p>
          <p className="mt-1 text-3xl font-black">
            {STYLE_EMOJI[style]} <span className="anniv-grad-text">{t(`anniversary.recap.style.${style}`)}</span>
          </p>
          <p className="mt-1 text-sm font-semibold text-white/70">{t(`anniversary.recap.styleText.${style}`)}</p>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2">
          {summary.map((s) => (
            <div key={s.l} className="rounded-2xl bg-white/[0.07] px-2 py-3 text-center">
              <p className="text-xl font-black tabular-nums">{s.v}</p>
              <p className="text-[11px] font-bold leading-tight text-white/60">{s.l}</p>
            </div>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap gap-1.5 text-xs font-bold">
          {TIER_LABEL[recap.tier] && <span className="rounded-full bg-white/15 px-2.5 py-1">{TIER_LABEL[recap.tier]}</span>}
          {recap.points > 0 && <span className="rounded-full bg-white/15 px-2.5 py-1">🪙 {tc("anniversary.recap.summary.points", recap.points, { n: fmt(recap.points) })}</span>}
          {recap.devices.map((d) => DEVICE_LABEL[d] && <span key={d} className="rounded-full bg-white/15 px-2.5 py-1">{DEVICE_LABEL[d]}</span>)}
        </div>
        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={share}
            className="flex-1 rounded-2xl bg-white px-4 py-3 text-sm font-extrabold text-zinc-900 transition hover:scale-[1.03] active:scale-95"
          >
            {copied ? `✔ ${t("anniversary.finale.copied")}` : `📣 ${t("anniversary.recap.summary.share")}`}
          </button>
        </div>
        <p className="mt-3 text-center text-xs font-semibold text-white/50">📸 {t("anniversary.recap.summary.screenshot")}</p>
      </>
    ),
  });

  useGSAP(
    () => {
      const move = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const els = gsap.utils.toArray<HTMLElement>(".rc-slide");
      const bars = gsap.utils.toArray<HTMLElement>(".rc-bar");
      gsap.set(els.slice(1), { autoAlpha: 0 });

      const tl = gsap.timeline({
        defaults: { ease: "power2.out" },
        scrollTrigger: {
          trigger: ref.current,
          pin: ".rc-pin",
          start: "top top",
          end: () => `+=${els.length * 85}%`,
          scrub: 0.6,
          anticipatePin: 1,
        },
      });

      els.forEach((slide, i) => {
        if (i > 0) {
          const prev = els[i - 1];
          tl.to(prev, { autoAlpha: 0, scale: move ? 0.88 : 1, rotate: move ? (i % 2 ? -4 : 4) : 0, duration: 0.4 }, `s${i}`);
          tl.fromTo(
            slide,
            { autoAlpha: 0, y: move ? "60%" : 0, rotate: move ? (i % 2 ? 6 : -6) : 0, scale: move ? 0.9 : 1 },
            { autoAlpha: 1, y: 0, rotate: 0, scale: 1, duration: 0.5, ease: "back.out(1.4)" },
            `s${i}`
          );
          for (const el of slide.querySelectorAll<HTMLElement>(".rc-count")) {
            const to = Number(el.dataset.to) || 0;
            const digits = Number(el.dataset.digits) || 0;
            const state = { v: 0 };
            tl.fromTo(
              state,
              { v: 0 },
              {
                v: to,
                duration: 0.5,
                ease: "power2.out",
                onUpdate: () => {
                  el.textContent = state.v.toLocaleString(LOCALE_TAGS[locale], { maximumFractionDigits: digits, minimumFractionDigits: 0 });
                },
              },
              `s${i}+=0.1`
            );
          }
          if (move) {
            const emoji = slide.querySelector(".rc-emoji");
            if (emoji) tl.fromTo(emoji, { rotate: -30, scale: 0.4 }, { rotate: 0, scale: 1, duration: 0.6, ease: "back.out(2)" }, `s${i}`);
          }
        }
        tl.fromTo(bars[i], { scaleX: 0 }, { scaleX: 1, duration: 0.6, ease: "none" });
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
          <p className="anniv-pixel text-[10px] text-[var(--a-green)] sm:text-xs">{t("anniversary.recap.kicker")}</p>
          <h2 className="mt-2 text-3xl font-extrabold tracking-tight sm:text-4xl">{t("anniversary.recap.storyTitle")}</h2>
        </div>
        <div className="relative h-[min(74svh,600px)] w-full max-w-[400px]">
          <div className="absolute inset-x-4 top-3 z-20 flex gap-1.5">
            {slides.map((s) => (
              <span key={s.id} className="h-1 flex-1 overflow-hidden rounded-full bg-white/30">
                <span className="rc-bar block h-full origin-left scale-x-0 rounded-full bg-white" />
              </span>
            ))}
          </div>
          {slides.map((s) => (
            <article
              key={s.id}
              className="rc-slide absolute inset-0 flex flex-col overflow-hidden rounded-[32px] px-6 pb-6 pt-10 shadow-[0_30px_80px_rgba(0,0,0,0.5)]"
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
