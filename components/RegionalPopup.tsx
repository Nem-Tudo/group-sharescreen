"use client";

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/AuthContext";
import { useFeature } from "@/lib/features";
import { arrivedBefore } from "@/lib/newcomer";
import {
  REGIONAL_FEATURE,
  REGIONAL_HQ,
  REGIONAL_RADIUS_KM,
  distanceKm,
  locateVisitor,
  markRegionalPopupSeen,
  regionalPopupSeen,
  type RegionalSpot,
} from "@/lib/regional";

// The one-time "Uai, cê é aqui da região!" popup (see lib/regional.ts), for
// people in the regional-popup experiment whose IP puts them within ~100 km
// of Santa Rita do Sapucaí. Shown once per browser, never on someone's first
// day here. It does open during a call too (asked for on 2026-11-20): the
// call keeps running behind it.
//
// This part only decides; the card (map, shirt, ticket) is its own chunk,
// downloaded only by the few who will see it.
//
// Admins can see it anywhere with ?regional=preview (pretends to be in Pouso
// Alegre, or at &at=lat,lng; nothing is counted or remembered).

const loadCard = () => import("./RegionalPopupCard");
const RegionalPopupCard = dynamic(() => loadCard().then((m) => m.RegionalPopupCard), { ssr: false });

/** Not on somebody's first day: they came for something else. */
const SETTLED_MS = 24 * 60 * 60 * 1000;
/** A beat after the page appears, so it does not cover the first paint. */
const SHOW_AFTER_MS = 1500;
/** How often it looks again while something else holds the screen. */
const RETRY_MS = 2000;
/** Pages it never opens on: sign-in, and the ones OBS or another window shows. */
const EXCLUDED = ["/login", "/obs", "/stream", "/oauth", "/oauth2", "/cam", "/admin", "/ad", "/3-meses", "/redeem", "/gift"];

/** Pouso Alegre, give or take. */
const PREVIEW_SPOT: RegionalSpot = { lat: -22.22, lng: -45.95 };

export function RegionalPopup() {
  const pathname = usePathname();
  const { account, loading } = useAuth();
  const [seen, setSeen] = useState(true);
  const [open, setOpen] = useState(false);
  const [spot, setSpot] = useState<RegionalSpot | null>(null);
  /** When this tab started looking; null before hydration. */
  const [now, setNow] = useState<number | null>(null);
  const [preview, setPreview] = useState(false);

  useEffect(() => {
    // Storage and the clock are only read after hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSeen(regionalPopupSeen());
    setNow(Date.now());
  }, []);

  const admin = Boolean(account?.flags.includes("ADMIN"));
  // Read from the address after hydration (useSearchParams here, in the root
  // layout, would need a Suspense boundary around every page).
  const [wantsPreview, setWantsPreview] = useState<RegionalSpot | null>(null);
  useEffect(() => {
    let asked: RegionalSpot | null = null;
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get("regional") === "preview") {
        // &at=lat,lng places the pin somewhere else (e.g. -22.25,-45.70 is Santa Rita itself).
        const [lat, lng] = (params.get("at") ?? "").split(",").map(Number);
        asked = Number.isFinite(lat) && Number.isFinite(lng) && params.has("at") ? { lat, lng } : PREVIEW_SPOT;
      }
    } catch {
      asked = null;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setWantsPreview(asked);
  }, [pathname]);
  // Admins in production; anybody on a dev server (screenshots, tweaks).
  const previewAllowed = admin || process.env.NODE_ENV !== "production";
  useEffect(() => {
    if (!wantsPreview || !previewAllowed) return;
    // Once per address: closing it does not bring it back.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setWantsPreview(null);
    setPreview(true);
    setSpot(wantsPreview);
    setOpen(true);
  }, [wantsPreview, previewAllowed]);

  const routeOk = pathname !== null && !EXCLUDED.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  // This browser's own first visit answers without waiting for the account to load.
  const settled =
    now !== null &&
    (arrivedBefore(now - SETTLED_MS) || (!loading && account !== null && now - account.createdAt > SETTLED_MS));
  const candidate = !seen && !open && routeOk && settled;
  const km = spot ? distanceKm(spot, REGIONAL_HQ) : null;
  const near = km !== null && km <= REGIONAL_RADIUS_KM;
  // Exposure only for somebody who would actually get the popup — which needs
  // a location, and nobody outside the rollout is located.
  const { enabled } = useFeature(REGIONAL_FEATURE, { track: candidate && near });

  // Locate only somebody in the experiment who could still be shown it.
  useEffect(() => {
    if (!candidate || !enabled || spot) return;
    let cancelled = false;
    void locateVisitor().then((found) => {
      if (!cancelled && found) setSpot(found);
    });
    return () => {
      cancelled = true;
    };
  }, [candidate, enabled, spot]);

  useEffect(() => {
    if (!candidate || !enabled || !near || km === null) return;
    // The card's chunk downloads during the wait, not after it.
    void loadCard();
    let timer: ReturnType<typeof setTimeout>;
    const attempt = () => {
      // Not on top of another dialog, and not while a video is fullscreen
      // (it would open behind it, unseen, and it is shown only once): wait
      // and look again.
      const fullscreen = document.fullscreenElement ?? (document as Document & { webkitFullscreenElement?: Element | null }).webkitFullscreenElement;
      if (fullscreen || document.querySelector('[role="dialog"][aria-modal="true"]')) {
        timer = setTimeout(attempt, RETRY_MS);
        return;
      }
      if (regionalPopupSeen()) return;
      markRegionalPopupSeen();
      setSeen(true);
      setOpen(true);
      // The card counts the opening itself (with its attributes).
    };
    timer = setTimeout(attempt, SHOW_AFTER_MS);
    return () => clearTimeout(timer);
  }, [candidate, enabled, near, km]);

  if (!open || !spot) return null;
  return (
    <RegionalPopupCard
      spot={spot}
      signedIn={Boolean(account)}
      returnTo={pathname ?? "/"}
      preview={preview}
      onClose={() => setOpen(false)}
    />
  );
}
