"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { useSignaling } from "@/lib/useSignaling";
import { signalingClient } from "@/lib/signalingClient";
import { AnnouncementBar } from "./AnnouncementBar";
import {
  getHiddenAnnouncementIds,
  hideAnnouncementId,
  getStoredPersistentAnnouncement,
  storePersistentAnnouncement,
  clearStoredPersistentAnnouncement,
  announcementTargetsDevice,
  currentAnnouncementDevice,
  type Announcement,
  type AnnouncementDevice,
} from "@/lib/announcement";
import { trackEvent } from "@/lib/analytics";
import { playWarningSound } from "@/lib/soundEffects";

// Nothing ever notifies: the device a page is running on cannot change
// without a reload, so the "store" behind useSyncExternalStore below has no
// updates to publish and only needs to be read once.
function noopSubscribe() {
  return () => {};
}
function getDeviceServerSnapshot(): AnnouncementDevice | null {
  return null;
}

// Site-wide, rendered once in the root layout — not scoped to any room.
// Three things permanently hide a given announcement id (persisted, so it
// stays hidden across a reload/reconnect, not just this mount):
//   1. The person dismissed it via "x" (only possible when the admin marked
//      it dismissible).
//   2. It's a non-persistent "reload"-action one — those only ever make
//      sense once, so the moment it's actually shown it's marked as
//      already-seen for next time without hiding it *this* time (so the
//      person can still read it and click the button now). A persistent one
//      skips this entirely — see the doc comment on Announcement.persistent.
//   3. The admin removed it.
// A non-dismissible, non-persistent, non-reload announcement has none of
// these and stays up until the admin clears or replaces it.
export function AnnouncementBanner() {
  const state = useSignaling();
  const liveAnnouncement = state.announcement;

  // The last `persistent: true` announcement this browser actually received
  // — see lib/announcement.ts's doc comment on this function for why this
  // exists (in short: it's the only way an "online-only" + persistent
  // announcement survives *this* browser reloading). Starts `null` — same as
  // the server-rendered pass, which has no `window`/localStorage at all —
  // and is filled in from localStorage by an effect below, *after*
  // hydration. Reading it eagerly here (e.g. a lazy useState initializer)
  // would make the client's very first render show the cached banner while
  // the server-rendered HTML has none, which is a hydration mismatch.
  const [cachedPersistent, setCachedPersistent] = useState<Announcement | null>(null);
  // Only trust `liveAnnouncement === null` as "it's actually gone" once a
  // real message has arrived to say so — otherwise (see announcementSeq's
  // doc comment) it just means nothing's come in yet, which for an
  // "online-only" announcement is the permanent, expected state.
  const announcement = liveAnnouncement ?? (state.announcementSeq === 0 ? cachedPersistent : null);
  // A version bump means "treat this as freshly delivered" even though the
  // id didn't change (an edit) — see server/signaling.ts's Announcement.version.
  const deliveryKey = announcement ? `${announcement.id}:${announcement.version}` : null;

  // Loaded once per mount — ids already dealt with in a previous
  // session/reload. A live dismiss (below) is tracked separately so it can
  // hide the banner immediately without waiting for a remount.
  const [hiddenIds] = useState(() => getHiddenAnnouncementIds());
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
  // Keyed by plain id (not deliveryKey) — deliberately *not* re-triggered by
  // a version bump, so editing an announcement this browser is already
  // showing never replays the sound (or the "shown" analytics event) for it.
  // Per-mount only (unlike hiddenIds/localStorage) — just stops a brief
  // signaling reconnect from re-firing either for an id it already handled
  // this page load.
  const trackedShownIds = useRef<Set<string>>(new Set());
  // Separate from trackedShownKeys: a "view" only counts once the tab is
  // actually visible (see the effect below), which can happen well after
  // the banner first mounts (a background tab) — so it needs its own
  // independent dedup instead of piggybacking on the shown/sound tracker.
  const reportedViewKeys = useRef<Set<string>>(new Set());

  // Null on the server and through hydration, then the real answer — the
  // same shape as useHasStoredName in lib/useSignaling.ts, and for the same
  // reason: this depends on `navigator` and on which shell is running,
  // neither of which exists during the server render, so reading it eagerly
  // would be a hydration mismatch. useSyncExternalStore rather than an
  // effect because the value never changes for the life of the page — there
  // is nothing to synchronise, just a client-only constant to read safely.
  //
  // "Never changes" is load-bearing here, and it is why isMobileApp() asks
  // Capacitor instead of waiting for `window.golive` to be filled in: paired
  // with a no-op subscribe, a device that only became knowable a few hundred
  // ms into the page would be read as "mobile-browser" and never corrected
  // on its own.
  const device = useSyncExternalStore(
    noopSubscribe,
    currentAnnouncementDevice,
    getDeviceServerSnapshot
  );

  const willShow =
    announcement != null &&
    !hiddenIds.has(announcement.id) &&
    !dismissedIds.has(announcement.id) &&
    // An announcement aimed at other devices is filtered here rather than
    // server-side on purpose: only the client can tell the Electron shell
    // from a browser tab, or a phone from a laptop. Nothing downstream runs
    // for a filtered-out banner — no sound, no "shown" event, and no view
    // reported to the admin panel's counters, which is what keeps those
    // numbers meaning "people who actually saw it".
    device !== null &&
    announcementTargetsDevice(announcement, device);

  // Without this, a brand new visitor who hasn't registered a display name
  // yet (see signalingClient's constructor — it only auto-connects when
  // there's already a stored name/account token) never opens a WebSocket
  // connection at all, and so never receives the "announcement" push no
  // matter what its visibility is set to. A no-op once some other flow
  // (registering a name, logging in) has already opened one.
  useEffect(() => {
    signalingClient.connect();
  }, []);

  // Runs once, client-only, after hydration — see cachedPersistent's doc
  // comment above for why this can't just be the useState initializer.
  // Deferred one tick via setTimeout (imperceptible) rather than calling
  // setCachedPersistent synchronously in the effect body — same reasoning
  // as the cache-sync effect right below.
  useEffect(() => {
    const id = setTimeout(() => setCachedPersistent(getStoredPersistentAnnouncement()), 0);
    return () => clearTimeout(id);
  }, []);

  // Keeps the localStorage cache in sync with every real "announcement"
  // message: refreshed on every persistent one (so an edit while this
  // browser is connected updates what a later reload restores), dropped on
  // every non-persistent one or explicit clear. Deliberately keyed off
  // announcementSeq rather than liveAnnouncement itself, since the latter
  // going back to `null` doesn't distinguish "a message just said so" from
  // "no message has arrived at all" (see the `announcement` derivation
  // above) — only the former should touch the cache. The actual state write
  // is deferred via setTimeout (not called synchronously in the effect
  // body) so this stays a "react to an external change" effect rather than
  // a synchronous render-triggering one; the ref guard above (not React
  // state) is what actually prevents re-entrance and can run synchronously.
  const lastHandledSeq = useRef(0);
  useEffect(() => {
    if (state.announcementSeq === 0 || state.announcementSeq === lastHandledSeq.current) return;
    lastHandledSeq.current = state.announcementSeq;
    const id = setTimeout(() => {
      if (liveAnnouncement && liveAnnouncement.persistent) {
        storePersistentAnnouncement(liveAnnouncement);
        setCachedPersistent(liveAnnouncement);
      } else {
        clearStoredPersistentAnnouncement();
        setCachedPersistent(null);
      }
    }, 0);
    return () => clearTimeout(id);
  }, [state.announcementSeq, liveAnnouncement]);

  useEffect(() => {
    if (!announcement || !willShow) return;
    if (!announcement.persistent && announcement.buttonAction === "reload" && !hiddenIds.has(announcement.id)) {
      hideAnnouncementId(announcement.id);
    }
    if (!trackedShownIds.current.has(announcement.id)) {
      trackedShownIds.current.add(announcement.id);
      const shouldPlaySound =
        announcement.sound === "always" ||
        (announcement.sound === "live-only" && state.announcementLive);
      if (shouldPlaySound) playWarningSound();
      trackEvent("announcement_shown", {
        id: announcement.id,
        color: announcement.color,
        buttonAction: announcement.buttonAction,
        dismissible: announcement.dismissible,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [announcement, willShow]);

  // Views only count for a genuinely visible tab — a background tab that
  // technically received the socket push doesn't mean anyone actually saw
  // it. Reported once the tab becomes visible while the banner is showing,
  // and re-checked on every visibility change in case it started hidden.
  useEffect(() => {
    if (!announcement || !deliveryKey || !willShow) return;
    function maybeReportView() {
      if (document.visibilityState !== "visible") return;
      if (!deliveryKey || reportedViewKeys.current.has(deliveryKey)) return;
      reportedViewKeys.current.add(deliveryKey);
      signalingClient.reportAnnouncementView(announcement!.id);
    }
    maybeReportView();
    document.addEventListener("visibilitychange", maybeReportView);
    return () => document.removeEventListener("visibilitychange", maybeReportView);
  }, [announcement, deliveryKey, willShow]);

  const pathname = usePathname();
  if (pathname?.startsWith("/obs")) return null;
  if (!willShow || !announcement) return null;

  return (
    <AnnouncementBar
      announcement={announcement}
      onButtonClick={() => {
        signalingClient.reportAnnouncementButtonClick(announcement.id);
        trackEvent("announcement_button_clicked", {
          id: announcement.id,
          color: announcement.color,
          buttonAction: announcement.buttonAction,
        });
      }}
      onDismiss={() => {
        hideAnnouncementId(announcement.id);
        setDismissedIds((prev) => new Set(prev).add(announcement.id));
        clearStoredPersistentAnnouncement();
        setCachedPersistent(null);
        signalingClient.reportAnnouncementXClick(announcement.id);
        trackEvent("announcement_dismissed", { id: announcement.id, color: announcement.color });
      }}
    />
  );
}
