"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchPeopleOnline, getSignalingHttpBase } from "@/lib/roomsApi";
import { trackEvent } from "@/lib/analytics";
import { useSignaling } from "@/lib/useSignaling";
import { signalingClient } from "@/lib/signalingClient";
import { ArrowLeftIcon, ChartIcon, ChevronUpIcon } from "@/components/icons";
import { BsCoin } from "react-icons/bs";
import { PartnerAdCustomizer, type AdForm } from "@/components/PartnerAdCustomizer";
import useNtPopups from "ntpopups";
import {
  claimPartnerClickReward,
  clickRewardAppliesTo,
  hasClaimedPartnerClickRewardLocally,
  hasClaimedPartnerRewardLocally,
  markPartnerClickRewardClaimedLocally,
  type PartnerClickRewardPlacement,
} from "@/lib/partner";
import { useAuth } from "@/lib/AuthContext";
import { useVideoDurationLabel } from "@/lib/useVideoDuration";
import { Popover } from "@/components/Tooltip";

const STATS_DASHBOARD_URL = process.env.NEXT_PUBLIC_STATS_DASHBOARD_URL;
const PEOPLE_COUNT_POLL_MS = 8000;

// How often the slot asks the server for a different ad. Long on purpose: an
// ad that changes while someone is still reading it is worse than no rotation
// at all, and a room is often open for hours, so this is about not showing
// the same thing for the whole session rather than about churn.
const ROTATE_INTERVAL_MS = 5 * 60 * 1000;

// How long "Resgatado!" stays in the CTA after a click reward is collected,
// before the button goes back to its ordinary label.
const CLICK_REWARD_CLAIMED_MS = 4000;

// Room the participant list keeps no matter what an ad's description says:
// four rows plus the "Participantes" heading above them. Measured off
// ParticipantRow's own markup (px-3 py-2 text-sm) and the list's gap-1.5 —
// an estimate on purpose, since reading the real rows would couple this card
// to a list it doesn't own and that may not even be mounted (below lg the
// drawer shows chat instead).
const PARTICIPANT_ROW_PX = 36;
const PARTICIPANT_LIST_GAP_PX = 6;
const PARTICIPANT_LIST_HEADING_PX = 28;
const MIN_VISIBLE_PARTICIPANTS = 2;
const RESERVED_FOR_LIST_PX =
  MIN_VISIBLE_PARTICIPANTS * PARTICIPANT_ROW_PX +
  (MIN_VISIBLE_PARTICIPANTS - 1) * PARTICIPANT_LIST_GAP_PX +
  PARTICIPANT_LIST_HEADING_PX;
// Floor: a column too short to hold both still leaves the ad something to be.
const MIN_CARD_HEIGHT_PX = 150;
// Below lg the card shares one drawer with the list *and* chat, and that
// drawer's height is content-driven — measuring it to size the card would be
// measuring something the card is part of, which is a feedback loop. A share
// of the viewport instead, matching the drawer's own max-h-[60vh].
const SMALL_SCREEN_CARD_HEIGHT_FRACTION = 0.33;
// Same boundary WatchRoom's isWideLayout uses to give this card its own
// column instead of the shared drawer.
const WIDE_LAYOUT_QUERY = "(min-width: 1024px)";

// Naming everything "partner" instead of "ad"/"advertisement" throughout —
// element ids, class names, API path, etc. — is deliberate: ad blockers
// filter on those words, and this card would otherwise get silently hidden
// for a chunk of visitors.
type PartnerCardData = {
  // Only present for a real, backend-sourced ad (server/signaling.ts's
  // publicPartner always includes it) — never on FALLBACK_PARTNER/
  // EXAMPLE_PARTNER below, which is what tells them apart for view/click
  // reporting (see the effects below) and expiration.
  id?: string;
  title: string;
  description: string;
  imageUrl?: string | null;
  buttonLabel: string;
  buttonUrl: string;
  backgroundColor?: string | null;
  textColor?: string | null;
  buttonBackgroundColor?: string | null;
  buttonTextColor?: string | null;
  // epoch ms; null/absent = never expires. Drives the expiration effect
  // below, which removes the card the instant this passes without waiting
  // for a reload or a live update.
  expiresAt?: number | null;
  // Watch-to-earn reward (see PartnerRewardModal.tsx) — absent/null on
  // FALLBACK_PARTNER/EXAMPLE_PARTNER, same as `id`, since neither is a real
  // ad with points to give out.
  rewardVideoUrl?: string | null;
  rewardPoints?: number | null;
  // Click-to-earn reward (points for clicking the CTA below) — absent/null
  // on FALLBACK_PARTNER/EXAMPLE_PARTNER for the same reason as the video
  // reward above. `clickRewardPlacement` decides whether those points are
  // offered here, in the reward-video popup, or in both.
  clickRewardPoints?: number | null;
  clickRewardPlacement?: PartnerClickRewardPlacement | null;
};

// `currentId` tells the server which ad this slot is showing right now, so a
// rotation can deliberately land on a *different* one. Sent as a hint, not as
// an instruction: the server still owns the choice (weights, the "show
// nothing X% of the time" roll, expiry), and a server that ignores the
// parameter entirely still behaves exactly as it does today.
async function fetchPartner(
  signal?: AbortSignal,
  currentId?: string | null
): Promise<PartnerCardData | null> {
  const query = currentId ? `?current=${encodeURIComponent(currentId)}` : "";
  const res = await fetch(`${getSignalingHttpBase()}/partner${query}`, { signal });
  if (!res.ok) throw new Error(`Falha ao carregar parceiro (status ${res.status})`);
  const data = (await res.json()) as { partner: PartnerCardData | null };
  return data.partner;
}

// Shown whenever there's no real partner ad to display — either the site
// has none active at all, or this request landed on the server's "show
// nothing X% of the time" roll (see server/signaling.ts's GET /partner) —
// a house ad for this site's own Discord instead of an empty slot.
const FALLBACK_PARTNER: PartnerCardData = {
  title: "Anuncie aqui pra todo mundo!",
  description: "Esse site é visitado por mais de 50 mil pessoas por dia!\n\nAbra um ticket no meu Discord e vamos combinar um anúncio",
  buttonLabel: "Abrir ticket no Discord",
  buttonUrl: "https://go.nemtudo.me/golive-partner-nemtudodiscord",
  backgroundColor: "#111827",
  textColor: "#f4f4f5",
  buttonBackgroundColor: "#5865f2",
  buttonTextColor: "#ffffff",
};

// The "ver exemplo de anúncio" button shows this — a real slot advertising
// NemTudo's own X/Twitter, styled in X's black/white so it visibly reads as
// a real ad rather than another site UI element.
const EXAMPLE_PARTNER: PartnerCardData = {
  title: "Me segue no Twitter!",
  description: "Posto updates dos meus projetos, coisas aleatórias, coisas da vida, eventos, etc.\n\nSegue aí gay",
  buttonLabel: "Sou lindo e vou seguir",
  imageUrl: "https://cdn.nemtudo.me/f/nemtudo/MjAyNi8wOC8yMC9JTUFHRS8wMl8yOF8wMl9fMTc4NzIwMzY4MjQyNC02NzMxNDIwNTI.webp",
  buttonUrl: "https://go.nemtudo.me/golive-partner-twitter",
  backgroundColor: "#000000",
  textColor: "#ffffff",
  buttonBackgroundColor: "#ffffff",
  buttonTextColor: "#000000",
};

// Starting point handed to the customizer — generic placeholders (not a
// copy of EXAMPLE_PARTNER's Twitter branding) so it reads as "your ad here"
// rather than nudging everyone toward black-and-white.
const CUSTOMIZER_STARTING_POINT: AdForm = {
  title: "Sua marca aqui",
  description: "Escreva uma descrição curta e chamativa sobre o que você quer anunciar.",
  imageUrl: "",
  buttonLabel: "Saiba mais",
  buttonUrl: "https://",
  backgroundColor: "#111827",
  textColor: "#f4f4f5",
  buttonBackgroundColor: "#10b981",
  buttonTextColor: "#ffffff",
};

// Docked at the bottom of the sidebar (participants/chat) column, not a
// floating overlay — deliberately named "partner" everywhere (component,
// api, props, tracked events) rather than "ad" so it doesn't get swept up by
// ad-blocker filter lists that key off that word.
export function PartnerCard() {
  const signalingState = useSignaling();
  const [partner, setPartner] = useState<PartnerCardData | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [peopleOnline, setPeopleOnline] = useState<number | null>(null);
  const [statsOpen, setStatsOpen] = useState(false);
  const [showingExample, setShowingExample] = useState(false);
  // Lets someone looking at a real, paid ad discover they could buy this
  // slot too — toggled by the "Anuncie aqui você também!" header shown over
  // a real ad below, and swaps the card to the same house ad that's shown
  // by default when no real partner is active (FALLBACK_PARTNER).
  const [showingHouseAd, setShowingHouseAd] = useState(false);
  const [customizerOpen, setCustomizerOpen] = useState(false);
  // The watch-to-earn popup (see PartnerRewardModal.tsx) is opened through
  // ntpopups rather than rendered here, so there's no open/closed state for
  // it on this side. The ad's data is handed over at open time, which is
  // also what keeps it playing the same ad's video if a rotation swaps
  // `partner` underneath it while the popup is up.
  const { openPopup } = useNtPopups();
  // Bumped when the popup reports a claim or closes, purely to force the
  // rewardClaimedLocally read below to happen again — it reads localStorage,
  // which React has no way to observe on its own.
  const [, bumpRewardState] = useState(0);
  // Always deferred, never called straight from the popup callbacks: ntpopups
  // fires its `onClose` from inside a setPopups updater (see
  // removePopupFromState in the library), which React runs during
  // NtPopupProvider's render — a setState on this component from in there is
  // the "Cannot update a component while rendering a different component"
  // warning. Nothing about this bump is urgent: it re-reads a localStorage
  // flag, so it can wait for that render to finish.
  const bumpRewardStateSoon = useCallback(() => {
    queueMicrotask(() => bumpRewardState((n) => n + 1));
  }, []);
  // What to say under the CTA after a click-reward attempt on this card —
  // null while there's nothing to report. Guests earn these too now (their
  // guest token is the identity credited, see lib/partner.ts); what still
  // lands here is a repeat claim, or a visitor who hasn't chosen a name yet
  // and so has no identity to pay at all. Either way the button never
  // withholds the click itself.
  const [clickRewardError, setClickRewardError] = useState<string | null>(null);
  // Success is reported inside the button instead (see CLICK_REWARD_CLAIMED_MS
  // and the CTA below) — a line of text under it would push the rest of the
  // card down for four seconds, on a card that is already fighting the room
  // for vertical space.
  const [clickRewardJustClaimed, setClickRewardJustClaimed] = useState(false);

  // Sizing (see the measuring effect below). The card is capped at whatever
  // its column can spare after the participant list's four rows, and the
  // description is clamped only when the card wouldn't fit in that — a short
  // ad in a tall column is never truncated.
  const rootRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const descriptionRef = useRef<HTMLParagraphElement | null>(null);
  const [maxCardHeight, setMaxCardHeight] = useState<number | null>(null);
  const [descriptionTruncated, setDescriptionTruncated] = useState(false);
  // Which description text the reader asked to see in full — the text itself
  // rather than a boolean, so a rotation onto a different ad (or a switch to
  // the house ad) starts collapsed again without anything having to reset it.
  const [expandedDescription, setExpandedDescription] = useState<string | null>(null);
  // Only for the points total in the app's own header — the claim itself is
  // server-side. Re-resolves whichever identity is here, account or guest
  // (see AuthContext's refresh).
  const { refresh: refreshIdentity } = useAuth();
  // Below lg, this starts collapsed to just a slim title bar — full-size,
  // it was eating a big enough chunk of a phone's height (image, multi-line
  // description, two buttons) to fight the room's own video/chat for space.
  // Tapping the bar expands it back to the full card. Ignored (always
  // expanded) from lg: on, same as the participants/chat drawer in
  // WatchRoom.tsx — see its collapsed/expanded reasoning for why this
  // pattern beats just shrinking things responsively: a phone screen is
  // short enough that even a "compact" card still costs real space by
  // default, so it should cost none until asked for.
  const [collapsed, setCollapsed] = useState(true);

  // Every path that puts a *served* ad on screen goes through here, so each
  // one is one impression. See the impression effect below, which keys off
  // this object's identity: a fresh object means the server served the slot
  // again, even if it happened to serve the same ad.
  const applyServedPartner = useCallback((next: PartnerCardData | null) => {
    setPartner(next);
    setLoaded(true);
  }, []);

  // Initial value, over plain HTTP — respects the server's "show nothing
  // X% of the time" roll (see server/signaling.ts's GET /partner and
  // partnerStore.ts's emptyPercent). A live socket update (the effect
  // below) always overrides this once one arrives, since that path
  // deliberately never rolls that percentage — see its own comment.
  useEffect(() => {
    const controller = new AbortController();
    fetchPartner(controller.signal)
      .then(applyServedPartner)
      .catch(() => {
        // Treated the same as "no partner configured" — a broken /partner
        // endpoint shouldn't take the house ad down with it.
        applyServedPartner(null);
      });
    return () => controller.abort();
  }, [applyServedPartner]);

  // Read by the rotation timer below. Refs rather than deps so that timer is
  // installed once and never torn down and rebuilt — rebuilding it on every
  // hover or state change would restart its five-minute countdown each time,
  // which in a card the mouse passes over regularly means it never fires.
  const hoveredRef = useRef(false);
  const currentIdRef = useRef<string | null>(null);
  useEffect(() => {
    currentIdRef.current = partner?.id ?? null;
  }, [partner]);
  // "The person is doing something with this card": reading the example ad,
  // browsing the house ad, or in the customizer. Swapping the slot underneath
  // any of those is the same interruption as swapping it under the cursor.
  const interactingRef = useRef(false);
  useEffect(() => {
    interactingRef.current = showingExample || showingHouseAd || customizerOpen || statsOpen;
  }, [showingExample, showingHouseAd, customizerOpen, statsOpen]);

  // Rotation. Skipped — not deferred — whenever the person is on the card:
  // the next tick five minutes later tries again. Retrying the instant the
  // mouse leaves would technically honour the interval better, at the cost of
  // the ad appearing to change *because* they moved away, which reads as the
  // page reacting to them rather than to a clock.
  useEffect(() => {
    const controller = new AbortController();
    const timer = setInterval(() => {
      if (hoveredRef.current || interactingRef.current) return;
      // A hidden tab has nobody to show an ad to. Rotating there would burn
      // a serve — and, once the tab came back, an impression — on a slot
      // nobody was looking at.
      if (document.visibilityState !== "visible") return;
      fetchPartner(controller.signal, currentIdRef.current)
        .then(applyServedPartner)
        .catch(() => {
          // Keep whatever is already on screen: a failed rotation is not a
          // reason to blank the slot.
        });
    }, ROTATE_INTERVAL_MS);
    return () => {
      clearInterval(timer);
      controller.abort();
    };
  }, [applyServedPartner]);

  // Live updates while this card stays mounted — pushed by the server after
  // every admin create/edit/delete (see broadcastPartnerUpdate), so an
  // already-open tab updates immediately instead of only on its next
  // reload. `partnerSeq` (see signalingClient.ts) is what tells "a live
  // update actually arrived, and it's authoritative" apart from "nothing's
  // arrived yet, the HTTP fetch above is still the freshest thing we know"
  // — both would otherwise look identical as a bare `partner: null`.
  const lastHandledPartnerSeq = useRef(0);
  useEffect(() => {
    if (signalingState.partnerSeq === 0 || signalingState.partnerSeq === lastHandledPartnerSeq.current) {
      return;
    }
    lastHandledPartnerSeq.current = signalingState.partnerSeq;
    applyServedPartner(signalingState.partner);
  }, [signalingState.partnerSeq, signalingState.partner, applyServedPartner]);

  // Removes an expired ad the instant it expires, without waiting for a
  // reload or a live update to do it — falls back to the house ad exactly
  // like any other "no partner active" state.
  useEffect(() => {
    if (!partner?.expiresAt) return;
    // Already-expired (remaining <= 0) still goes through setTimeout rather
    // than calling setPartner synchronously right here — deferring it to a
    // callback (even a same-tick one) keeps this a pure "schedule a
    // reaction," not a synchronous state write during the effect itself.
    const remaining = Math.max(0, partner.expiresAt - Date.now());
    const timer = setTimeout(() => setPartner(null), remaining);
    return () => clearTimeout(timer);
  }, [partner]);

  // One impression per serve.
  //
  // Impressions only count for a genuinely visible tab — same reasoning as
  // AnnouncementBanner.tsx's identical guard — and only for a real,
  // backend-sourced ad (never the fallback/example ones, which have no id
  // and aren't things the admin is tracking engagement for).
  //
  // The guard is the served object's *identity*, not its id. That is what
  // makes rotation countable: this used to remember which ids it had already
  // reported for the whole session, so an ad shown again an hour later was
  // silently not counted — fine when a slot was filled once per page load,
  // wrong now that it refills every five minutes. Identity also still absorbs
  // a double-invoked effect in development, since that re-runs with the same
  // object.
  const reportedServeRef = useRef<PartnerCardData | null>(null);
  // The second counter, and the one that survived from before rotation
  // existed: at most one report per ad id for as long as this card stays
  // mounted. Its own dedupe rather than a mode of the one above, because the
  // two answer different questions and neither can be derived from the other
  // — impressions cannot be divided down into sessions, and sessions cannot
  // be multiplied up into impressions.
  const reportedSessionIds = useRef<Set<string>>(new Set());
  useEffect(() => {
    const serve = partner;
    const id = serve?.id;
    if (!serve || !id) return;
    function maybeReport() {
      if (document.visibilityState !== "visible") return;
      if (!reportedSessionIds.current.has(id!)) {
        reportedSessionIds.current.add(id!);
        signalingClient.reportPartnerSessionView(id!);
      }
      if (reportedServeRef.current === serve) return;
      reportedServeRef.current = serve;
      signalingClient.reportPartnerView(id!);
    }
    maybeReport();
    document.addEventListener("visibilitychange", maybeReport);
    return () => document.removeEventListener("visibilitychange", maybeReport);
  }, [partner]);

  // Badge on the reward button — the ad carries no duration field, so it's
  // read off the video itself (see the hook).
  const rewardDurationLabel = useVideoDurationLabel(partner?.rewardVideoUrl);

  // Everything about how tall this card may be, and whether the description
  // has to be cut to stay that way.
  //
  // All of it runs from the ResizeObserver callback (which fires once as soon
  // as it observes, so the first measurement needs no separate pass) rather
  // than from the effect body — a setState there would be a cascading render.
  useEffect(() => {
    if (!loaded) return;
    const root = rootRef.current;
    if (!root) return;

    function measure() {
      const card = rootRef.current;
      const description = descriptionRef.current;
      if (!card) return;
      const column = card.parentElement;
      const wide = window.matchMedia(WIDE_LAYOUT_QUERY).matches;
      const available = Math.max(
        MIN_CARD_HEIGHT_PX,
        wide && column
          ? column.clientHeight - RESERVED_FOR_LIST_PX
          : Math.round(window.innerHeight * SMALL_SCREEN_CARD_HEIGHT_FRACTION)
      );
      setMaxCardHeight(available);
      if (!description) {
        setDescriptionTruncated(false);
        return;
      }
      // How tall the card *would* be with the description shown in full.
      // Computed the same way whether it's currently clamped or not — which
      // is what stops the answer from flip-flopping, since clamping changes
      // the very height that decided to clamp.
      const naturalHeight =
        card.scrollHeight - description.clientHeight + description.scrollHeight;
      setDescriptionTruncated(naturalHeight > available);
    }

    const observer = new ResizeObserver(measure);
    observer.observe(root);
    // The column, for how much space there is...
    if (root.parentElement) observer.observe(root.parentElement);
    // ...and the card's own content, for how much it needs: the root itself
    // stops growing at the cap, so it alone would report nothing once the ad
    // is over it.
    if (contentRef.current) observer.observe(contentRef.current);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [loaded]);

  useEffect(() => {
    if (!clickRewardJustClaimed) return;
    const timer = setTimeout(() => setClickRewardJustClaimed(false), CLICK_REWARD_CLAIMED_MS);
    return () => clearTimeout(timer);
  }, [clickRewardJustClaimed]);

  // Runs regardless of whether a real partner is configured: the count now
  // shows next to "Anuncie aqui você também!" over a real ad too, not just
  // inside the house ad itself, so there's no state where it's unneeded.
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    async function load() {
      try {
        const count = await fetchPeopleOnline(controller.signal);
        if (!cancelled) setPeopleOnline(count);
      } catch {
        // Directory unreachable — leave the last known count in place
        // rather than flashing an error over a non-essential counter.
      }
    }

    load();
    const interval = setInterval(load, PEOPLE_COUNT_POLL_MS);
    return () => {
      cancelled = true;
      controller.abort();
      clearInterval(interval);
    };
  }, []);

  if (!loaded) return null;

  const data = partner ?? FALLBACK_PARTNER;
  const isFallback = partner === null;
  // Per-browser hint (see hasClaimedPartnerRewardLocally's doc comment) —
  // recomputed on every render, so it stays current across a rotation
  // landing back on an ad this browser already collected the reward for, and
  // right after the reward popup closes having just claimed one.
  const rewardClaimedLocally = Boolean(data.id && hasClaimedPartnerRewardLocally(data.id));
  const clickRewardClaimedLocally = Boolean(
    data.id && hasClaimedPartnerClickRewardLocally(data.id)
  );
  // True only when the real ad is what's actually on screen — false for the
  // plain house ad, the "ver exemplo" preview, and a real ad temporarily
  // swapped out for the house ad via showingHouseAd below. Drives both the
  // header above the card and what counts as a click on the real ad.
  const showingRealAd = !isFallback && !showingHouseAd;
  // True whenever FALLBACK_PARTNER is what's on screen — the plain default
  // (no real ad configured) as much as a real ad temporarily swapped out via
  // showingHouseAd. Everything that's specific to the house ad (the online
  // counter, the "ver exemplo" button) keys off this, not off isFallback
  // alone, so toggling into the house ad from a real one gets the full
  // experience instead of a stripped-down version of it.
  const showingHouseAdContent = !showingRealAd && !showingExample;
  // Whether the online-count popover has a trigger to anchor to anywhere on
  // the card right now — one renders inside the house ad, another sits next
  // to "Anuncie aqui você também!" over a real ad (see below), but never
  // during showingExample: the whole point of the example is to be a
  // faithful preview of a real ad slot, which never has this site's own
  // counter riding inside it.
  const showOnlineWidget = !showingExample && peopleOnline !== null;
  const displayData = showingRealAd ? data : showingExample ? EXAMPLE_PARTNER : FALLBACK_PARTNER;
  // "Ler mais" is per-text, so this is false again the moment the slot
  // rotates onto another ad. Expanding doesn't uncap the card — the extra
  // lines scroll inside it, so the participant list keeps its room either
  // way; the reader just chose to scroll for them.
  const showFullDescription = expandedDescription === displayData.description;
  // Whether the CTA below should advertise (and pay) click points right now:
  // a real ad, configured to offer them on the card, not already collected by
  // this browser. Once collected the button quietly goes back to being a
  // plain CTA rather than promising points it can no longer give.
  const cardClickRewardActive =
    showingRealAd &&
    Boolean(data.id) &&
    clickRewardAppliesTo(data, "card") &&
    !clickRewardClaimedLocally;

  function claimCardClickReward() {
    const id = data.id;
    if (!id) return;
    claimPartnerClickReward(id)
      .then(() => {
        markPartnerClickRewardClaimedLocally(id);
        setClickRewardError(null);
        setClickRewardJustClaimed(true);
        trackEvent("partner_click_reward_claimed", { partnerId: id });
        // Re-resolves the current identity so the header's total updates
        // without a reload, same as the video reward does.
        void refreshIdentity();
      })
      .catch((err: unknown) => {
        setClickRewardError(err instanceof Error ? err.message : "Falha ao resgatar os pontos.");
      });
  }
  // One panel, two possible triggers (the counter inside the house ad, and
  // the one next to "Anuncie aqui também!" over a real ad) — only ever one of
  // them is on screen at a time, so they share both this markup and the
  // statsOpen state.
  const statsPanel = (
    <div className="w-72 max-w-[calc(100vw-1rem)] rounded-lg border border-zinc-200 bg-white p-3 shadow-lg dark:border-zinc-800 dark:bg-zinc-950">
      <p className="text-xs text-zinc-600 dark:text-zinc-400">
        Curioso(a) pra saber quantas pessoas estão compartilhando tela agora, quantas
        salas estão rolando e muito mais? Acompanhe tudo ao vivo no painel de
        estatísticas do site!
      </p>
      {STATS_DASHBOARD_URL && (
        <a
          href={STATS_DASHBOARD_URL}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => trackEvent("stats_dashboard_opened")}
          className="mt-2 flex items-center justify-center gap-1.5 rounded-lg bg-zinc-950 px-3 py-1.5 text-center text-xs font-semibold text-white transition hover:opacity-90 dark:bg-zinc-50 dark:text-zinc-950"
        >
          <ChartIcon className="h-3.5 w-3.5" />
          Ver estatísticas ao vivo
        </a>
      )}
    </div>
  );

  return (
    <div
      // Height-capped everywhere, with its own scroll past the cap. The card
      // sits at the bottom of a column it shares with the participant list —
      // its own `w-64` aside from lg up, one drawer with the list *and* chat
      // below that (see WatchRoom) — and in both the list is the flexible
      // one: a `flex-1` next to this `shrink-0` shrinks to nothing, so an ad
      // with a long description used to take the entire column and leave the
      // list with no room at all. The cap is what makes that impossible
      // regardless of what an advertiser writes; the clamps below are what
      // keep it from being reached in the first place.
      ref={rootRef}
      // The measured cap (see the effect above) wins once it exists; the
      // classes are what hold the line on the very first paint, before
      // anything has been measured.
      style={maxCardHeight === null ? undefined : { maxHeight: maxCardHeight }}
      className="relative mt-auto max-h-[33dvh] w-full shrink-0 overflow-y-auto lg:max-h-[45dvh]"
      // Pointer events rather than mouse ones so a pen or a hovering trackpad
      // counts too; a touch device never hovers, so there the rotation simply
      // always proceeds.
      onPointerEnter={() => {
        hoveredRef.current = true;
      }}
      onPointerLeave={() => {
        hoveredRef.current = false;
      }}
      // Keyboard equivalent: someone tabbing through the card's buttons is
      // just as much "on it" as someone pointing at it.
      onFocusCapture={() => {
        hoveredRef.current = true;
      }}
      onBlurCapture={() => {
        hoveredRef.current = false;
      }}
    >
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        aria-expanded={!collapsed}
        className="mb-1.5 flex w-full items-center justify-between gap-2 rounded-lg bg-zinc-100 px-3 py-1.5 text-left text-xs font-medium text-zinc-600 transition hover:bg-zinc-200 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 lg:hidden"
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="shrink-0 rounded-full bg-black/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide dark:bg-white/10">
            Patrocinado
          </span>
          <span className="truncate">{displayData.title}</span>
        </span>
        <ChevronUpIcon
          className={`h-3.5 w-3.5 shrink-0 transition-transform ${collapsed ? "rotate-180" : ""}`}
        />
      </button>

      <div ref={contentRef} className={`${collapsed ? "hidden" : "block"} lg:block`}>
      {showingExample && (
        <div className="mb-2">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setShowingExample(false)}
              className="flex items-center gap-1 text-xs font-medium text-zinc-500 transition hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
            >
              <ArrowLeftIcon className="h-3 w-3" />
              Voltar
            </button>
            <span className="text-[10px] font-medium uppercase tracking-wide text-zinc-400 dark:text-zinc-600">
              Exemplo de anúncio
            </span>
          </div>
          <button
            type="button"
            onClick={() => {
              trackEvent("partner_customizer_opened");
              setCustomizerOpen(true);
            }}
            className="block w-full rounded-lg border border-emerald-500/60 bg-emerald-500/10 px-3 py-1.5 text-center text-xs font-semibold text-emerald-700 transition hover:bg-emerald-500/20 dark:border-emerald-400/50 dark:text-emerald-400 dark:hover:bg-emerald-400/10"
          >
            Ver como vai ficar meu anúncio
          </button>
        </div>
      )}

      {showingRealAd && (
        <div className="mb-1.5 flex items-center gap-2">
          {peopleOnline !== null && (
            <Popover
              open={statsOpen}
              onClose={() => setStatsOpen(false)}
              placement="top"
              content={statsPanel}
            >
              <button
                type="button"
                onClick={() => setStatsOpen((open) => !open)}
                className="flex shrink-0 items-center gap-1 rounded-lg bg-zinc-100 px-2.5 py-1.5 text-xs font-medium text-emerald-600 transition hover:bg-zinc-200 dark:bg-zinc-900 dark:text-emerald-400 dark:hover:bg-zinc-800"
              >
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
                {peopleOnline} on
                <ChevronUpIcon
                  className={`h-3 w-3 transition-transform ${statsOpen ? "rotate-180" : ""}`}
                />
              </button>
            </Popover>
          )}
          <button
            type="button"
            onClick={() => {
              trackEvent("partner_house_ad_from_real_ad");
              setShowingHouseAd(true);
            }}
            className="flex-1 rounded-lg bg-zinc-100 px-3 py-1.5 text-center text-xs font-semibold text-zinc-600 transition hover:bg-zinc-200 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800"
          >
            Anuncie aqui também!
          </button>
        </div>
      )}

      {!isFallback && showingHouseAd && !showingExample && (
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setShowingHouseAd(false)}
            className="flex items-center gap-1 text-xs font-medium text-zinc-500 transition hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
          >
            <ArrowLeftIcon className="h-3 w-3" />
            Voltar
          </button>
          <span className="text-[10px] font-medium uppercase tracking-wide text-zinc-400 dark:text-zinc-600">
            Anuncie aqui
          </span>
        </div>
      )}

      <div
        className="w-full overflow-hidden rounded-lg border border-zinc-200 p-3 dark:border-zinc-800 sm:p-4"
        style={{
          backgroundColor: displayData.backgroundColor ?? "#ffffff",
          color: displayData.textColor ?? "#18181b",
        }}
      >
        <div className="mb-2 flex items-center justify-between gap-2">
          {showingHouseAdContent && showOnlineWidget && (
            <Popover
              open={statsOpen}
              onClose={() => setStatsOpen(false)}
              placement="top"
              content={statsPanel}
            >
              <button
                type="button"
                onClick={() => setStatsOpen((open) => !open)}
                className="flex items-center gap-1 text-xs font-medium text-emerald-400 cursor-pointer"
              >
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" />
                {peopleOnline} online agora
                <ChevronUpIcon
                  className={`h-3 w-3 transition-transform ${statsOpen ? "rotate-180" : ""}`}
                />
              </button>
            </Popover>
          )}
          <span className="shrink-0 rounded-full bg-black/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide opacity-70 dark:bg-white/10">
            Patrocinado
          </span>
        </div>

        {displayData.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={displayData.imageUrl}
            alt=""
            // Grows only from lg, not from sm: between the two the card is
            // still inside the shared drawer, where every pixel it takes is
            // one the participant list loses.
            className="mb-2 max-h-20 w-full rounded-lg object-cover lg:max-h-32"
          />
        )}

        <p className="text-sm font-semibold">{displayData.title}</p>
        {/* Cut only when the card wouldn't otherwise fit beside four
            participants (see the measuring effect) — a short ad in a tall
            column reads in full, exactly as written. */}
        <p
          ref={descriptionRef}
          className={`mt-1 whitespace-pre-line text-xs opacity-80 ${
            descriptionTruncated && !showFullDescription ? "line-clamp-3" : ""
          }`}
        >
          {displayData.description}
        </p>
        {descriptionTruncated && (
          <button
            type="button"
            onClick={() =>
              setExpandedDescription(showFullDescription ? null : displayData.description)
            }
            className="mt-0.5 text-xs font-semibold underline underline-offset-2 opacity-70 transition hover:opacity-100"
          >
            {showFullDescription ? "Ler menos" : "Ler mais"}
          </button>
        )}

        <a
          href={displayData.buttonUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => {
            // Only counts as a click on the real ad while it's actually the
            // thing being shown — not while a real advertiser's slot is
            // temporarily swapped out for the house ad via showingHouseAd.
            if (showingRealAd && data.id) signalingClient.reportPartnerClick(data.id);
            // Fire-and-forget alongside the navigation: the link opens in a
            // new tab, so this request isn't racing a page unload.
            if (cardClickRewardActive) claimCardClickReward();
            trackEvent("partner_card_clicked", {
              fallback: isFallback,
              example: showingExample,
              houseAd: !isFallback && showingHouseAd,
            });
          }}
          className="relative mt-3 flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-center text-sm font-semibold transition hover:opacity-90"
          style={{
            backgroundColor: displayData.buttonBackgroundColor ?? "#18181b",
            color: displayData.buttonTextColor ?? "#ffffff",
          }}
        >
          {/* "Resgatado!" is laid over the label rather than replacing it:
              the real content stays in the box (just invisible), so the
              button keeps the exact size it had a moment ago instead of
              resizing itself around a shorter word and back. */}
          <span
            className={`flex min-w-0 items-center justify-center gap-1.5 ${
              clickRewardJustClaimed ? "invisible" : ""
            }`}
          >
            {cardClickRewardActive && (
              <>
                <BsCoin className="h-4 w-4 shrink-0" />
                <span className="shrink-0 tabular-nums">{data.clickRewardPoints}</span>
              </>
            )}
            <span className="truncate">{displayData.buttonLabel}</span>
          </span>
          {clickRewardJustClaimed && (
            <span className="absolute inset-0 flex items-center justify-center">Resgatado!</span>
          )}
        </a>

        {clickRewardError && (
          <p className="mt-1.5 text-center text-[11px] font-medium text-amber-500">
            {clickRewardError}
          </p>
        )}

        {showingRealAd && data.id && data.rewardVideoUrl && data.rewardPoints && (
          <button
            type="button"
            onClick={() => {
              trackEvent("partner_reward_video_opened", { partnerId: data.id });
              openPopup("partner_reward", {
                // Sized to give the video roughly the room it had back when
                // this was a full-screen takeover, without becoming one: the
                // backdrop stays translucent and the call keeps running
                // behind it.
                width: "min(1100px, calc(100vw - 30px))",
                maxWidth: "1100px",
                maxHeight: "94dvh",
                // The popup's own × is deliberately the only way out —
                // losing an almost-finished video to a stray backdrop click
                // or Escape means watching the whole thing again.
                closeOnEscape: false,
                closeOnClickOutside: false,
                requireAction: true,
                onClose: bumpRewardStateSoon,
                data: {
                  partnerId: data.id,
                  videoUrl: data.rewardVideoUrl,
                  points: data.rewardPoints,
                  title: data.title,
                  description: data.description,
                  imageUrl: data.imageUrl,
                  buttonLabel: data.buttonLabel,
                  buttonUrl: data.buttonUrl,
                  buttonBackgroundColor: data.buttonBackgroundColor,
                  buttonTextColor: data.buttonTextColor,
                  clickRewardPoints: clickRewardAppliesTo(data, "video")
                    ? data.clickRewardPoints
                    : null,
                  onClaimed: bumpRewardStateSoon,
                },
              });
            }}
            // Glows in the main CTA's own color (same trick, same reason as
            // PartnerRewardModal's --partner-cta-glow-color): this button is
            // an outline sitting under that solid one, and sharing its color
            // is what makes the two read as one offer.
            style={{
              ["--partner-reward-glow-color" as string]:
                displayData.buttonBackgroundColor ?? "#18181b",
            }}
            // The glow (see globals.css) runs only while there are still
            // points on the table. Once this browser has collected them the
            // button is a plain "assistir de novo" — animating it then would
            // be advertising a reward it can no longer pay.
            className={`mt-2 flex w-full items-center cursor-pointer ${
              rewardDurationLabel ? "justify-between" : "justify-center"
            } gap-2 rounded-lg border border-current px-3 py-1.5 text-xs font-semibold opacity-90 transition hover:opacity-100 ${
              rewardClaimedLocally ? "" : "partner-reward-glow"
            }`}
          >
            {/* Rewatching is always allowed — only the reward itself is
                one-time (see PartnerRewardModal, which knows not to let a
                rewatch pay out again). */}
            <span className="flex min-w-0 items-center gap-1.5">
              {rewardClaimedLocally ? (
                "Assistir de novo"
              ) : (
                <>
                  Resgatar
                  <BsCoin className="h-3.5 w-3.5 shrink-0" />
                  {data.rewardPoints}
                </>
              )}
            </span>
            {rewardDurationLabel && (
              <span className="shrink-0 rounded-full bg-black/10 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums dark:bg-white/10">
                {rewardDurationLabel}
              </span>
            )}
          </button>
        )}

        {showingHouseAdContent && (
          <button
            type="button"
            onClick={() => {
              trackEvent("partner_example_viewed");
              setStatsOpen(false);
              setShowingExample(true);
            }}
            className="mt-2 block w-full rounded-lg border border-current px-3 py-1.5 text-center text-xs font-medium opacity-70 transition hover:opacity-100"
          >
            Ver exemplo de anúncio
          </button>
        )}
      </div>
      </div>

      {customizerOpen && (
        <PartnerAdCustomizer
          initial={CUSTOMIZER_STARTING_POINT}
          onClose={() => setCustomizerOpen(false)}
        />
      )}
    </div>
  );
}
