"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSignaling } from "./useSignaling";
import { signalingClient } from "./signalingClient";
import {
  fetchPartner,
  FALLBACK_PARTNER,
  type PartnerCardData,
} from "./partner";

const ROTATE_INTERVAL_MS = 5 * 60 * 1000;

export function usePartnerAd() {
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

  useEffect(() => {
    const controller = new AbortController();
    const timer = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      fetchPartner(controller.signal, currentIdRef.current)
        .then(applyServedPartner)
        .catch(() => {
          // Keep whatever is currently on screen
        });
    }, ROTATE_INTERVAL_MS);
    return () => {
      clearInterval(timer);
      controller.abort();
    };
  }, [applyServedPartner]);

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

  const activeAd: PartnerCardData = partner ?? FALLBACK_PARTNER;
  const isFallback = partner === null;

  return {
    ad: activeAd,
    rawPartner: partner,
    loaded,
    isFallback,
  };
}
