"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useT } from "@/lib/useI18n";
import { useAuth } from "@/lib/AuthContext";
import { useAccountToken } from "@/lib/accountApi";
import { equipCosmetic } from "@/lib/cosmetics";
import { withAvatarDecoration } from "@/lib/avatarShape";
import {
  ANNIVERSARY_EVENTS,
  anniversaryShareUrl,
  claimAnniversaryGift,
  fetchAnniversaryGift,
  spinAnniversaryGift,
  trackAnniversary,
  type AnniversaryGift,
} from "@/lib/anniversary";
import { UserAvatar } from "@/components/UserAvatar";
import { SceneTitle } from "../shared";
import { ShareSheet, type ShareTarget } from "../ShareSheet";
import { drawGiftCard } from "../shareCard";
import type { RecapCardDrawer, RecapShareText } from "./Recap";

// "Temos um presente pra você": an avatar decoration (see the API's
// anniversaryGift.ts). Three steps, each one waiting for the one before:
//   1. the roulette — lights run between the two anniversary frames and stop
//      on the one the server drew. The draw is stored before it is shown, so
//      it is the same frame forever, however many times the page is opened;
//   2. sharing the page gives it (the claim);
//   3. wearing it, or not — the shop's equip, here in one button.

export const GIFT_ANCHOR = "presente";

/** The roulette's steps: quick at first, slowing to a stop (ms between lights). */
function spinDelays(): number[] {
  const steps = 22;
  return Array.from({ length: steps }, (_, i) => 60 + Math.pow(i / (steps - 1), 2.4) * 460);
}

export function GiftSection({
  onCelebrate,
  recapCard,
  recapText,
}: {
  onCelebrate: () => void;
  recapCard: RecapCardDrawer | null;
  recapText: RecapShareText | null;
}) {
  const t = useT();
  const { account, loading, refresh } = useAuth();
  const token = useAccountToken();
  const signedIn = Boolean(account && token);
  const [gift, setGift] = useState<AnniversaryGift | null>(null);
  const [failed, setFailed] = useState(false);
  const [spinning, setSpinning] = useState(false);
  /** The frame the lights are on (index into gift.options). */
  const [lit, setLit] = useState(0);
  const [busy, setBusy] = useState(false);
  const [skipped, setSkipped] = useState(false);
  const timers = useRef<number[]>([]);

  useEffect(() => {
    if (!signedIn || !token) return;
    let cancelled = false;
    fetchAnniversaryGift(token)
      .then((data) => {
        if (cancelled) return;
        setGift(data);
        if (data.pick) setLit(Math.max(0, data.options.findIndex((o) => o.id === data.pick!.id)));
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [signedIn, token]);

  useEffect(() => () => timers.current.forEach((id) => window.clearTimeout(id)), []);

  const spin = async () => {
    if (!token || spinning || gift?.pick) return;
    trackAnniversary(ANNIVERSARY_EVENTS.giftSpin);
    setSpinning(true);
    let result: AnniversaryGift;
    try {
      result = await spinAnniversaryGift(token);
    } catch {
      setSpinning(false);
      setFailed(true);
      return;
    }
    const target = Math.max(0, result.options.findIndex((o) => o.id === result.pick?.id));
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const delays = reduced ? [] : spinDelays();
    // The lights run, and the last step lands on the drawn frame.
    let at = 0;
    let index = lit;
    delays.forEach((delay, i) => {
      at += delay;
      const remaining = delays.length - 1 - i;
      timers.current.push(
        window.setTimeout(() => {
          index = remaining === 0 ? target : (index + 1) % result.options.length;
          setLit(index);
        }, at)
      );
    });
    timers.current.push(
      window.setTimeout(() => {
        setLit(target);
        setGift(result);
        setSpinning(false);
        onCelebrate();
      }, at + 250)
    );
  };

  const claim = async (target: ShareTarget) => {
    if (!token || !gift?.pick || gift.claimed) return;
    try {
      const next = await claimAnniversaryGift(token, target);
      setGift(next);
      trackAnniversary(ANNIVERSARY_EVENTS.giftClaim);
      onCelebrate();
    } catch {
      setFailed(true);
    }
  };

  const wear = async (on: boolean) => {
    if (!gift?.pick || busy) return;
    setBusy(true);
    try {
      await equipCosmetic(on ? gift.pick.id : null, "avatar_decoration");
      setGift({ ...gift, equipped: on });
      trackAnniversary(on ? ANNIVERSARY_EVENTS.giftEquip : ANNIVERSARY_EVENTS.giftSkip);
      await refresh();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  const name = account?.displayName ?? "Go Live";
  const options = gift?.options ?? [];
  const shown = options[lit]?.value ?? null;
  const optionName = (id: string) => t(`anniversary.gift.option.${id}`);
  const step = !gift?.pick ? 1 : !gift.claimed ? 2 : 3;

  // The same sheet before and after the frame is given: sharing more is still welcome.
  // Signed in with a recap, it is the recap's own share (its words and its
  // picture, with the drawn frame on the face); otherwise the gift's card.
  const useRecap = Boolean(recapCard && recapText);
  const shareSheet = gift?.pick ? (
                    <ShareSheet
                      key={`${gift.pick.id}-${useRecap ? "recap" : "gift"}`}
                      text={useRecap ? recapText!.text : t("anniversary.gift.shareText")}
                      xText={useRecap ? recapText!.xText : undefined}
                      url={anniversaryShareUrl("gift")}
                      cardName={useRecap ? "meu-recap-go-live.png" : "meu-presente-go-live.png"}
                      card={() =>
                        useRecap
                          ? recapCard!(withAvatarDecoration(account?.avatarUrl, gift.pick!.value))
                          : drawGiftCard(
                          {
                            kicker: t("anniversary.gift.cardKicker"),
                            name,
                            face: account?.avatarUrl ?? null,
                            decoration: gift.pick!.value,
                            title: optionName(gift.pick!.id),
                            text: t("anniversary.gift.cardText"),
                          },
                          {
                            live: t("anniversary.card.live"),
                            brand: t("anniversary.card.brand"),
                            hashtag: "#GoLive3Meses",
                            url: "golive.nemtudo.me/3-meses",
                          }
                        )
                      }
                      onShare={(target) => void claim(target)}
                    />
  ) : null;

  return (
    <section id={GIFT_ANCHOR} data-scene="gift" className="relative overflow-hidden px-4 py-28 sm:px-8 sm:py-36">
      <SceneTitle kicker={t("anniversary.gift.kicker")} title={t("anniversary.gift.title")} sub={t("anniversary.gift.sub")} color="var(--a-tally)" />

      <div className="mx-auto mt-14 grid max-w-6xl items-center gap-12 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        {/* The stage: your face, wearing whatever frame the lights are on. */}
        <div className="flex flex-col items-center">
          <div className="relative flex h-72 w-72 items-center justify-center sm:h-80 sm:w-80">
            <div
              className={`absolute inset-0 rounded-full ${spinning ? "animate-spin" : ""}`}
              style={{
                background: "conic-gradient(from 0deg, #c0c0c0, #c0c000, #00c0c0, #00c000, #c000c0, #c00000, #0000c0, #c0c0c0)",
                opacity: 0.18,
                animationDuration: "1.2s",
              }}
              aria-hidden
            />
            <UserAvatar src={withAvatarDecoration(account?.avatarUrl, spinning || gift?.pick ? shown : null)} name={name} size={176} />
          </div>
          {options.length > 0 && (
            <ul className="mt-6 grid w-full max-w-sm grid-cols-2 gap-3">
              {options.map((o, i) => {
                const on = i === lit && (spinning || Boolean(gift?.pick));
                return (
                  <li
                    key={o.id}
                    className={`flex flex-col items-center gap-2 border px-3 py-4 transition-colors duration-100 ${
                      on ? "border-[var(--a-tally)] bg-[var(--a-tally)]/15" : "border-[var(--a-line)] bg-[var(--a-card)]"
                    } ${gift?.pick && !on && !spinning ? "opacity-40" : ""}`}
                  >
                    <UserAvatar src={withAvatarDecoration(account?.avatarUrl, o.value)} name={name} size={56} />
                    <span className="anniv-mono text-[11px] uppercase">{optionName(o.id)}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* The steps */}
        <div>
          {!signedIn ? (
            <div className="border border-[var(--a-line)] bg-[var(--a-card)] p-7">
              <p className="text-2xl font-extrabold">{t("anniversary.gift.loginTitle")}</p>
              <p className="mt-2 text-[15px] leading-relaxed text-[var(--a-mute)]">{t("anniversary.gift.loginText")}</p>
              {!loading && (
                <Link
                  href={`/login?next=${encodeURIComponent(`/3-meses#${GIFT_ANCHOR}`)}`}
                  onClick={() => trackAnniversary(ANNIVERSARY_EVENTS.giftLogin)}
                  className="anniv-mono mt-6 inline-flex bg-[var(--a-tally)] px-6 py-3.5 text-sm font-semibold uppercase text-white transition hover:brightness-110"
                >
                  {t("anniversary.gift.loginCta")}
                </Link>
              )}
            </div>
          ) : failed && !gift ? (
            <p className="text-lg font-bold">{t("anniversary.gift.failed")}</p>
          ) : !gift ? (
            <div className="h-40 animate-pulse bg-white/[0.04]" />
          ) : (
            <>
              <ol className="anniv-mono mb-7 flex gap-2 text-[11px] uppercase">
                {[1, 2, 3].map((n) => (
                  <li
                    key={n}
                    className={`flex-1 border-t-2 pt-2 ${n < step ? "border-[var(--a-green)] text-[var(--a-green)]" : n === step ? "border-[var(--a-tally)] text-[var(--a-ink)]" : "border-[var(--a-line)] text-[var(--a-mute)]"}`}
                  >
                    {n}. {t(`anniversary.gift.step${n}`)}
                  </li>
                ))}
              </ol>

              {step === 1 && (
                <>
                  <p className="text-lg leading-relaxed text-[var(--a-mute)]">{t("anniversary.gift.spinText")}</p>
                  <button
                    type="button"
                    onClick={spin}
                    disabled={spinning}
                    className="anniv-mono mt-6 bg-[var(--a-tally)] px-8 py-4 text-base font-semibold uppercase text-white transition hover:brightness-110 disabled:opacity-70"
                  >
                    {spinning ? t("anniversary.gift.spinning") : t("anniversary.gift.spin")}
                  </button>
                </>
              )}

              {step === 2 && gift.pick && (
                <>
                  <p className="anniv-display text-5xl sm:text-6xl">{t("anniversary.gift.landed", { name: optionName(gift.pick.id) })}</p>
                  <p className="mt-3 text-[15px] text-[var(--a-mute)]">{t("anniversary.gift.once")}</p>
                  <p className="mt-7 text-lg font-bold">{t("anniversary.gift.shareLead")}</p>
                  <div className="mt-4">{shareSheet}</div>
                </>
              )}

              {step === 3 && gift.pick && (
                <>
                  <p className="anniv-display text-5xl sm:text-6xl">{t("anniversary.gift.claimed")}</p>
                  <p className="mt-3 max-w-xl text-lg leading-relaxed text-[var(--a-mute)]">
                    {gift.equipped
                      ? t("anniversary.gift.wearingText")
                      : skipped
                        ? t("anniversary.gift.skippedText")
                        : t("anniversary.gift.claimedText")}
                  </p>
                  <div className="mt-6 flex flex-wrap gap-3">
                    {gift.equipped ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void wear(false)}
                        className="anniv-mono border border-white/20 px-6 py-3.5 text-sm font-semibold uppercase transition hover:border-white/50 disabled:opacity-60"
                      >
                        {t("anniversary.gift.takeOff")}
                      </button>
                    ) : (
                      <>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void wear(true)}
                          className="anniv-mono bg-[var(--a-green)] px-6 py-3.5 text-sm font-semibold uppercase text-zinc-900 transition hover:brightness-110 disabled:opacity-60"
                        >
                          {t("anniversary.gift.wear")}
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            setSkipped(true);
                            trackAnniversary(ANNIVERSARY_EVENTS.giftSkip);
                          }}
                          className="anniv-mono border border-white/20 px-6 py-3.5 text-sm font-semibold uppercase transition hover:border-white/50 disabled:opacity-60"
                        >
                          {t("anniversary.gift.skip")}
                        </button>
                      </>
                    )}
                  </div>
                  <p className="mt-5 text-sm text-[var(--a-mute)]">{t("anniversary.gift.later")}</p>
                  <p className="mt-8 text-lg font-bold">{t("anniversary.gift.shareMore")}</p>
                  <div className="mt-4">{shareSheet}</div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
