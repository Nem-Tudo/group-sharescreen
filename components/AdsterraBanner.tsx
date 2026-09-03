"use client";

import { useEffect, useRef } from "react";
import { SM_BREAKPOINT_QUERY, useMediaQuery } from "@/lib/useMediaQuery";
import {
  DESKTOP_BANNER,
  IFRAME_SANDBOX,
  MOBILE_BANNER,
  adFrameUrl,
  parseAdFrameMessage,
  type AdsterraBanner as BannerUnit,
} from "@/lib/adsterra";
import {
  reportAdsterraFill,
  useAdFrameWatchdog,
  useAdsterraBlocked,
} from "@/lib/adsterraFill";
import { useAdsAllowed } from "@/lib/useAdsAllowed";

// A fixed-size Adsterra banner, in a sandboxed iframe. See lib/adsterra.ts for
// why the iframe is not optional.

export function AdsterraBanner({
  className = "",
  /**
   * A label above the slot. Off by default: it is worth having where an ad
   * sits among the site's own content and could be mistaken for it, and noise
   * where the slot is obviously an ad.
   */
  label = false,
}: {
  className?: string;
  label?: boolean;
}) {
  const allowed = useAdsAllowed();
  // Once anything has established that Adsterra cannot get through, this slot
  // stops rendering rather than holding a box open around nothing. That is
  // what puts the room's own ad back (see WatchRoom) and what keeps a page
  // with an ad blocker from showing a 728x90 hole where a banner was meant
  // to be.
  const blocked = useAdsterraBlocked();
  const wide = useMediaQuery(SM_BREAKPOINT_QUERY);
  const frameRef = useRef<HTMLIFrameElement | null>(null);

  // The wide unit above `sm`, the phone one below, and each falls back to the
  // other when only one is configured — a deployment with a single key should
  // show it rather than show nothing half the time. useMediaQuery reports
  // false until the first client paint, so the phone unit is the one that
  // renders first, which is the right way round: it is the smaller hole to
  // leave in a layout that is about to reflow.
  const useDesktopUnit = wide ? DESKTOP_BANNER !== null : MOBILE_BANNER === null;
  const unit: BannerUnit | null = useDesktopUnit ? DESKTOP_BANNER : MOBILE_BANNER;

  const rendering = allowed && !blocked && unit !== null;

  const markSettled = useAdFrameWatchdog(rendering);

  useEffect(() => {
    if (!rendering) return;
    function onMessage(event: MessageEvent) {
      // Matched on the frame's own window rather than the event's origin.
      // Same-origin now, so an origin check would pass for every frame and
      // every script on this page; the window identity is the one test that
      // means "this slot's frame and nothing else".
      if (!frameRef.current || event.source !== frameRef.current.contentWindow) return;
      const message = parseAdFrameMessage(event.data);
      if (message?.type === "status") {
        markSettled();
        reportAdsterraFill(message.filled);
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [rendering, markSettled]);

  if (!rendering || !unit) return null;

  return (
    <div className={`flex flex-col items-center gap-1 ${className}`}>
      {label && (
        <span className="text-[10px] uppercase tracking-wide text-zinc-400 dark:text-zinc-600">
          Publicidade
        </span>
      )}
      {/* Sized on the wrapper as well as the iframe so the space is reserved
          before the ad paints. An ad that arrives and pushes the page down
          under somebody's thumb is the single most annoying thing a slot like
          this can do. */}
      <div
        style={{ width: unit.width, height: unit.height }}
        className="max-w-full overflow-hidden"
      >
        <iframe
          ref={frameRef}
          // Remounts when the unit changes, so the desktop/phone switch
          // actually fetches the other slot's document instead of resizing
          // the box around the one already loaded.
          key={`${unit.key}-${unit.width}x${unit.height}`}
          title="Publicidade"
          // A URL on this site rather than srcDoc — that is what gives the ad
          // script an origin, its cookies and a referrer Adsterra recognises.
          // See lib/adsterra.ts's header for what happened without it.
          src={adFrameUrl(useDesktopUnit ? "desktop" : "mobile")}
          sandbox={IFRAME_SANDBOX}
          width={unit.width}
          height={unit.height}
          scrolling="no"
          referrerPolicy="no-referrer-when-downgrade"
          className="block max-w-full border-0"
        />
      </div>
    </div>
  );
}
