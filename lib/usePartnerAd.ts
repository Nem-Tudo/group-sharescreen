"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSignaling } from "./useSignaling";
import { signalingClient } from "./signalingClient";
import {
  fetchPartner,
  FALLBACK_PARTNER,
  type PartnerCardData,
} from "./partner";

const ROTATE_INTERVAL_MS = 3 * 60 * 1000;

/**
 * The room's partner ad: which one is on screen, and everything that decides
 * that — the first fetch, the rotation, live admin edits, expiry, and the two
 * counters the admin panel reads.
 *
 * `visible` is what the slot's other tenant made necessary. The card now
 * shares its square with Adsterra and is off screen roughly half the time
 * (see useAdRotation), and two things here are only correct while somebody
 * can actually see the ad: an impression, and spending a serve on a
 * rotation. Both are already withheld from a hidden *tab*; a hidden *slot* is
 * the same fact arriving a level down, so it goes through the same gates.
 */
export function usePartnerAd({ visible = true }: { visible?: boolean } = {}) {
  const signalingState = useSignaling();
  const [partner, setPartner] = useState<PartnerCardData | null>(null);
  const [loaded, setLoaded] = useState(false);

  const applyServedPartner = useCallback((next: PartnerCardData | null) => {
    setPartner(next);
    setLoaded(true);
  }, []);

  // Initial HTTP fetch
  useEffect(() => {
    const controller = new AbortController();
    fetchPartner(controller.signal)
      .then(applyServedPartner)
      .catch(() => {
        applyServedPartner(null);
      });
    return () => controller.abort();
  }, [applyServedPartner]);

  // Rotation timer
  const currentIdRef = useRef<string | null>(null);
  useEffect(() => {
    currentIdRef.current = partner?.id ?? null;
  }, [partner]);

  const rotate = useCallback(
    (signal: AbortSignal) => {
      fetchPartner(signal, currentIdRef.current)
        .then(applyServedPartner)
        .catch(() => {
          // Keep whatever is currently on screen
        });
    },
    [applyServedPartner]
  );

  // Read by the timer below rather than listed as a dependency: rebuilding the
  // interval every time the slot changes hands would restart its countdown
  // once a minute, and a three-minute timer reset every sixty seconds never
  // fires at all.
  const visibleRef = useRef(visible);
  useEffect(() => {
    visibleRef.current = visible;
  }, [visible]);

  // A tick that landed while Adsterra had the slot. Deferred rather than
  // dropped, which is the difference between "rotates every three minutes"
  // and "rotates every six": with a one-minute swap, half of all ticks fall on
  // a minute this card is not on screen, and skipping those outright would
  // quietly halve the rotation the interval promises.
  const pendingRotationRef = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      if (!visibleRef.current) {
        pendingRotationRef.current = true;
        return;
      }
      rotate(controller.signal);
    }, ROTATE_INTERVAL_MS);
    return () => {
      clearInterval(timer);
      controller.abort();
    };
  }, [rotate]);

  // The deferred tick, paid the moment the card gets its square back.
  useEffect(() => {
    if (!visible || !pendingRotationRef.current) return;
    if (document.visibilityState !== "visible") return;
    pendingRotationRef.current = false;
    const controller = new AbortController();
    rotate(controller.signal);
    return () => controller.abort();
  }, [visible, rotate]);

  // Live socket updates
  const lastHandledPartnerSeq = useRef(0);
  useEffect(() => {
    if (
      signalingState.partnerSeq === 0 ||
      signalingState.partnerSeq === lastHandledPartnerSeq.current
    ) {
      return;
    }
    lastHandledPartnerSeq.current = signalingState.partnerSeq;
    applyServedPartner(signalingState.partner);
  }, [signalingState.partnerSeq, signalingState.partner, applyServedPartner]);

  // Expiration handling
  useEffect(() => {
    if (!partner?.expiresAt) return;
    const remaining = Math.max(0, partner.expiresAt - Date.now());
    const timer = setTimeout(() => setPartner(null), remaining);
    return () => clearTimeout(timer);
  }, [partner]);

  // Impressions and session views reporting
  const reportedServeRef = useRef<PartnerCardData | null>(null);
  const reportedSessionIds = useRef<Set<string>>(new Set());
  useEffect(() => {
    const serve = partner;
    const id = serve?.id;
    if (!serve || !id) return;
    function maybeReport() {
      if (document.visibilityState !== "visible") return;
      // Nothing is owed for an ad the slot is not currently showing. Not a
      // lost count either: `visible` is a dependency, so this effect runs
      // again when the card comes back and reports then — the dedupe below is
      // by the served object's identity, so the same serve is still counted
      // exactly once however many times this re-runs.
      if (!visible) return;
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
  }, [partner, visible]);

  const activeAd: PartnerCardData = partner ?? FALLBACK_PARTNER;
  const isFallback = partner === null;

  return {
    ad: activeAd,
    rawPartner: partner,
    loaded,
    isFallback,
  };
}
