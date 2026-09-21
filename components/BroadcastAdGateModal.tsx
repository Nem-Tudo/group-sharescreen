"use client";

import { useEffect, useRef, useState } from "react";
import { MdClose, MdPauseCircleOutline } from "react-icons/md";
import { MicIcon, CheckIcon, VerifiedBadgeIcon } from "./icons";
import { useT } from "@/lib/useI18n";
import { useAuth } from "@/lib/AuthContext";
import { signalingClient } from "@/lib/signalingClient";
import { useOpenPro } from "@/lib/proModal";
import { trackPartnerClick } from "@/lib/partnerExperiment";
import {
  AD_GATE_EVENTS,
  MAX_GATE_SECONDS,
  NO_AD_WAIT_SECONDS,
  formatGateHours,
  trackAdGate,
  useAdGatePartner,
  useCheapestProPrice,
  type BroadcastAdGate,
} from "@/lib/broadcastAdGate";
import { playBroadcastPausedSound } from "@/lib/soundEffects";

// The popup in front of a broadcast the ad gate has paused (see
// lib/broadcastAdGate.ts).
//
// The thing this has to get right is not the mechanism — that is twenty lines
// — it is the tone. Somebody was mid-stream and their picture just went
// black, and whatever this says is being read by a person who is annoyed
// before they start reading. So:
//
//   - it opens by saying what did *not* happen. The call is still up, the
//     mic never stopped, nobody was disconnected. Most of the first reaction
//     to a black screen is "did I just lose the room", and answering that
//     before anything else is worth more than any amount of apologising;
//   - it says why, with the real number, rather than gesturing at policy. Six
//     hours of free broadcasting is a generous thing to have had, and saying
//     so plainly is the strongest argument available;
//   - the way out is a video that ends by itself and a button that is not
//     asked for twice. Nothing here nags;
//   - Pro is offered as the way to never see this again, which is what it
//     honestly is, and it is a second option rather than the headline. A
//     popup that leads with the upsell is a toll booth.
//
// The video cannot be skipped — no controls, and the guards below snap any
// attempt to jump ahead back. That is the same arrangement the reward popup
// uses (see PartnerRewardModal), including the part where none of it is
// airtight against somebody at a console: the point is the ordinary viewer,
// and the server is what actually decides the broadcast may resume.

// Reapplied on an interval rather than only on a `ratechange` listener: a
// console script setting the rate does not have to fire an event it does not
// want observed, but it cannot stop this from running.
const RATE_GUARD_MS = 400;
// How far past the furthest point genuinely reached a seek may land — covers
// ordinary timeupdate granularity, nowhere near enough to skip anything.
const SEEK_TOLERANCE_SECONDS = 0.75;
// Below this the locked player counts as silenced and goes back up. An ad
// nobody can hear is an ad nobody watched.
const MIN_LOCKED_VOLUME = 0.2;

function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.ceil(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export function BroadcastAdGateModal({
  gate,
  onClose,
}: {
  gate: BroadcastAdGate;
  /** Hides the popup while leaving the broadcast paused — see the ✕ below. */
  onClose: () => void;
}) {
  const t = useT();
  const { account } = useAuth();
  const openPro = useOpenPro();
  const { loading, partner } = useAdGatePartner();
  const proPrice = useCheapestProPrice();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  // The furthest point genuinely reached by real playback. A ref, not state:
  // it is read and written synchronously inside media handlers that fire many
  // times a second.
  const maxTimeRef = useRef(0);
  const [remaining, setRemaining] = useState<number | null>(null);
  // The furthest point actually reached, as state rather than only as the ref
  // above: this one is rendered (it decides when the way out appears), and a
  // ref does not re-render.
  const [watched, setWatched] = useState(0);
  const [finished, setFinished] = useState(false);
  const [started, setStarted] = useState(false);
  // The no-ad wait (see NO_AD_WAIT_SECONDS). Counted down in wall-clock
  // seconds, deliberately without pausing when the tab is hidden: there is
  // nothing to watch, so there is nothing to miss by looking away, and a
  // timer that only runs while somebody stares at it would be punishing them
  // for our own empty shelf.
  const [waitLeft, setWaitLeft] = useState(NO_AD_WAIT_SECONDS);

  // One sound, once, as it opens. The popup can appear while the person is
  // looking at the game they are streaming rather than at the browser, and a
  // picture that goes black in silence is how a broadcast looks when it
  // breaks — see playBroadcastPausedSound.
  useEffect(() => {
    playBroadcastPausedSound();
  }, []);

  // They became Pro while this was open (the button below leads straight
  // there). Nothing for them to watch any more, so the gate clears itself —
  // asking somebody who has just paid to also sit through the ad would be the
  // single worst thing this popup could do.
  const entitled = account?.features?.includes("no_ads") === true;
  useEffect(() => {
    if (entitled) signalingClient.clearBroadcastAdGate("pro");
  }, [entitled]);

  // Nothing to show them (see the API's GET /partner/ad-gate). Not an instant
  // release: "we have no inventory right now" would otherwise be the cheapest
  // way past the gate, and a gate with a free door is not a gate. So it
  // becomes a minute of waiting instead — our shelf is the empty one, so it
  // is a minute of nothing rather than a minute of being sold to.
  const noAd = !loading && !partner && !entitled;
  useEffect(() => {
    if (!noAd) return;
    trackAdGate(AD_GATE_EVENTS.noAd);
  }, [noAd]);

  useEffect(() => {
    if (!noAd) return;
    const startedAt = Date.now();
    const timer = setInterval(() => {
      // Off the clock rather than by decrementing: a background tab throttles
      // intervals to once a minute, and a counter that subtracts one per tick
      // would still be showing 58 five minutes later.
      const left = NO_AD_WAIT_SECONDS - Math.floor((Date.now() - startedAt) / 1000);
      setWaitLeft(Math.max(0, left));
      if (left <= 0) clearInterval(timer);
    }, 250);
    return () => clearInterval(timer);
  }, [noAd]);

  const waitDone = noAd && waitLeft <= 0;

  function handleWaitConfirm() {
    trackAdGate(AD_GATE_EVENTS.waitConfirmed);
    signalingClient.reportBroadcastAdGateNoAd();
  }

  const partnerId = partner?.id ?? null;
  useEffect(() => {
    if (partnerId) trackAdGate(AD_GATE_EVENTS.opened);
  }, [partnerId]);

  // The anti-skip guards, for as long as the video is locked.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || finished) return;
    const onTimeUpdate = () => {
      if (video.currentTime > maxTimeRef.current) maxTimeRef.current = video.currentTime;
      // Off maxTimeRef, not currentTime: rewinding is allowed (there is no
      // reason to forbid it), and it must not take back a minute already sat
      // through.
      setWatched(maxTimeRef.current);
      const left = (video.duration || 0) - video.currentTime;
      setRemaining(Number.isFinite(left) ? left : null);
    };
    const onSeeking = () => {
      if (video.currentTime > maxTimeRef.current + SEEK_TOLERANCE_SECONDS) {
        video.currentTime = maxTimeRef.current;
      }
    };
    const guard = setInterval(() => {
      if (video.playbackRate !== 1) video.playbackRate = 1;
      if (video.muted) video.muted = false;
      if (video.volume < MIN_LOCKED_VOLUME) video.volume = 1;
    }, RATE_GUARD_MS);
    video.addEventListener("timeupdate", onTimeUpdate);
    video.addEventListener("seeking", onSeeking);
    return () => {
      clearInterval(guard);
      video.removeEventListener("timeupdate", onTimeUpdate);
      video.removeEventListener("seeking", onSeeking);
    };
  }, [finished, partnerId]);

  function handleEnded() {
    if (finished) return;
    setFinished(true);
    // Straight through rather than behind a "continuar" button. They watched
    // the whole thing; making them click once more to get their own screen
    // back is a toll on top of a toll. The popup closes when the server
    // confirms, which is what actually un-blanks the picture.
    signalingClient.clearBroadcastAdGate("ad", partnerId);
  }

  // A long ad, left behind at the minute mark. Counts as watched — they gave
  // the gate everything it asks of anyone — with its own event beside it so
  // the two can be told apart when reading the numbers.
  function handleSkip() {
    if (finished) return;
    setFinished(true);
    trackAdGate(AD_GATE_EVENTS.skipped, watched);
    signalingClient.clearBroadcastAdGate("ad", partnerId);
  }

  function handlePro() {
    trackAdGate(AD_GATE_EVENTS.proClick);
    signalingClient.reportBroadcastAdGateProClick();
    openPro();
  }

  function handleAdClick() {
    if (!partnerId) return;
    trackAdGate(AD_GATE_EVENTS.adClick);
    trackPartnerClick("video");
    signalingClient.reportPartnerClick(partnerId, "video");
  }

  function handleClose() {
    trackAdGate(AD_GATE_EVENTS.dismissed);
    onClose();
  }

  // How long until they get their screen back, whichever comes first: the ad
  // ending, or the minute being up. One number, always meaning the same
  // thing — showing the ad's own remaining time on a three-minute video would
  // be telling somebody they have three minutes to go when they have one.
  const untilSkip = Math.max(0, MAX_GATE_SECONDS - watched);
  const canSkip = Boolean(partner) && !finished && untilSkip <= 0;
  const untilFree = remaining === null ? untilSkip : Math.min(remaining, untilSkip);

  const hoursLabel = formatGateHours(gate.firstHours);
  const intervalLabel = formatGateHours(gate.intervalHours);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-3 backdrop-blur-sm sm:p-4">
      {/* dvh rather than vh: on a phone the browser's own chrome slides in and
          out as you scroll, and vh measures the tallest it ever is — which is
          exactly how a popup ends up with its buttons under the address bar. */}
      <div className="flex max-h-[96dvh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-950 sm:max-h-[92dvh]">
        <div className="flex shrink-0 items-start justify-between gap-3 px-4 pb-3 pt-4 sm:px-5 sm:pt-5">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sky-500/10 text-sky-600 dark:text-sky-400 sm:h-10 sm:w-10">
              <MdPauseCircleOutline className="h-5 w-5 sm:h-6 sm:w-6" />
            </span>
            <h2 className="text-[15px] font-semibold leading-tight text-zinc-900 dark:text-white sm:text-base">
              {t("broadcastAdGate.title")}
            </h2>
          </div>
          {/* A way out that leaves the broadcast paused. It exists because
              the alternative is trapping somebody who simply wants to stop
              streaming and carry on talking — and a popup with no ✕ is the
              thing people close the whole tab over. */}
          <button
            type="button"
            onClick={handleClose}
            aria-label={t("common.close")}
            className="-mr-1 shrink-0 rounded-full p-1.5 text-zinc-500 transition hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
          >
            <MdClose className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 sm:px-5">
          <p className="text-[13px] leading-relaxed text-zinc-600 dark:text-zinc-400 sm:text-sm">
            {t("broadcastAdGate.explanation", { hours: hoursLabel, interval: intervalLabel })}
          </p>

          {/* What did *not* just happen. */}
          {/* Tighter on a phone, and the first thing given up when the
              screen is short: it is reassurance, and reassurance below a
              button nobody can reach is worth nothing. */}
          <ul className="mt-3 space-y-1.5 rounded-xl bg-zinc-50 p-3 text-[13px] text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400 sm:mt-4 sm:space-y-2 sm:p-3.5 sm:text-sm">
            <li className="flex items-start gap-2.5">
              <CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
              <span>{t("broadcastAdGate.stillInTheRoom")}</span>
            </li>
            <li className="flex items-start gap-2.5">
              <MicIcon className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
              <span>{t("broadcastAdGate.micUntouched")}</span>
            </li>
            <li className="flex items-start gap-2.5">
              <CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
              <span>{t("broadcastAdGate.comesBackAsItWas")}</span>
            </li>
          </ul>

          <div className="mt-3 overflow-hidden rounded-xl border border-zinc-200 bg-black dark:border-zinc-800 sm:mt-4">
            {loading && (
              <div className="flex aspect-video items-center justify-center">
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-white/20 border-t-white/80" />
              </div>
            )}
            {!loading && partner?.rewardVideoUrl && (
              <video
                ref={videoRef}
                src={partner.rewardVideoUrl}
                autoPlay
                playsInline
                onPlay={() => {
                  if (started) return;
                  setStarted(true);
                  trackAdGate(AD_GATE_EVENTS.adStart);
                }}
                onEnded={handleEnded}
                // No `controls` while it is locked: there is nothing here to
                // operate, and a seek bar that refuses to seek is a worse
                // experience than no seek bar at all.
                controls={finished}
                className="aspect-video w-full bg-black"
              />
            )}
            {noAd && (
              <div className="flex aspect-video flex-col items-center justify-center gap-2 px-4 text-center sm:gap-3 sm:px-6">
                <p className="text-[13px] text-zinc-400 sm:text-sm">
                  {t("broadcastAdGate.noAdAvailable")}
                </p>
                {!waitDone && (
                  <>
                    <span className="text-3xl font-semibold tabular-nums text-white sm:text-4xl">
                      {formatClock(waitLeft)}
                    </span>
                    <p className="text-xs text-zinc-500">{t("broadcastAdGate.noAdWaitHint")}</p>
                  </>
                )}
                {waitDone && (
                  <p className="text-sm font-medium text-emerald-400">
                    {t("broadcastAdGate.noAdWaitDone")}
                  </p>
                )}
              </div>
            )}
          </div>

          {partner && !finished && (
            <div className="mt-2 flex items-center justify-between gap-3">
              <p className="min-w-0 truncate text-xs text-zinc-500 dark:text-zinc-400">
                {partner.title}
              </p>
              {remaining !== null && !canSkip && (
                <span className="shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium tabular-nums text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
                  {formatClock(untilFree)}
                </span>
              )}
            </div>
          )}

          {finished && (
            <p className="mt-3 text-center text-sm font-medium text-emerald-600 dark:text-emerald-400">
              {t("broadcastAdGate.thanksResuming")}
            </p>
          )}

        </div>

        {/* Outside the scrolling body on purpose. A phone held in landscape —
            which is how somebody streaming a game is holding it — has barely
            three hundred pixels of height, and in a single scrolling column
            both ways out of this popup end up below the fold. Somebody who
            cannot see how to get their broadcast back assumes there is no
            way, so the buttons are pinned and the explanation is what
            scrolls. */}
        <div className="shrink-0 border-t border-zinc-200 px-4 pb-4 pt-3 dark:border-zinc-800 sm:px-5 sm:pb-5">
          {/* The way out of the no-ad wait. A button rather than the
              broadcast simply coming back on its own: the minute passes while
              they are looking at something else as often as not, and a
              picture that returns unannounced is a picture nobody knows is
              live again. */}
          {(noAd || canSkip) && (
            <button
              type="button"
              onClick={noAd ? handleWaitConfirm : handleSkip}
              disabled={noAd && !waitDone}
              className="mb-3 w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-zinc-200 disabled:text-zinc-400 dark:disabled:bg-zinc-800 dark:disabled:text-zinc-500"
            >
              {!noAd || waitDone
                ? t("broadcastAdGate.backToBroadcast")
                : t("broadcastAdGate.backToBroadcastIn", { seconds: String(waitLeft) })}
            </button>
          )}

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
            {partner?.buttonUrl ? (
              <a
                href={partner.buttonUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={handleAdClick}
                className="truncate rounded-lg px-4 py-2 text-center text-[13px] font-medium text-zinc-600 transition hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900 sm:py-2.5 sm:text-sm"
              >
                {partner.buttonLabel}
              </a>
            ) : (
              <span className="hidden sm:block" />
            )}
            <div className="flex flex-col items-stretch gap-1 sm:items-end">
              <button
                type="button"
                onClick={handlePro}
                className="flex items-center justify-center gap-2 rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-sky-500"
              >
                <VerifiedBadgeIcon className="h-4 w-4 shrink-0" />
                <span className="truncate">{t("broadcastAdGate.getProNoAds")}</span>
              </button>
              {/* Only when there is a real number. A price is the one thing
                  in this popup that must never be a placeholder, so a plan
                  list that has not loaded simply renders nothing. */}
              {proPrice && (
                <span className="text-center text-xs font-medium text-emerald-600 dark:text-emerald-400 sm:text-right">
                  {t("broadcastAdGate.forOnlyPrice", { price: proPrice })}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
