"use client";

import { useEffect, useRef, useState } from "react";
import { SM_BREAKPOINT_QUERY, useMediaQuery } from "@/lib/useMediaQuery";
import {
  DESKTOP_BANNER,
  IFRAME_SANDBOX,
  MOBILE_BANNER,
  ROOM_BANNER,
  BANNER_FILL_TIMEOUT_MS,
  adFrameUrl,
  parseAdFrameMessage,
  type AdsterraBanner as BannerUnit,
  type AdSlot,
} from "@/lib/adsterra";
import {
  reportAdsterraFill,
  useAdFrameWatchdog,
  useAdsterraBlocked,
} from "@/lib/adsterraFill";
import { useAdsAllowed } from "@/lib/useAdsAllowed";
import { useT } from "@/lib/useI18n";

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
  slot,
}: {
  className?: string;
  label?: boolean;
  slot?: "desktop" | "mobile" | "room";
}) {
  const t = useT();
  const allowed = useAdsAllowed();
  // Once anything has established that Adsterra cannot get through, this slot
  // stops rendering rather than holding a box open around nothing. That is
  // what puts the room's own ad back (see WatchRoom) and what keeps a page
  // with an ad blocker from showing a 728x90 hole where a banner was meant
  // to be.
  const blocked = useAdsterraBlocked();
  const wide = useMediaQuery(SM_BREAKPOINT_QUERY);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  // This unit specifically had nothing to serve. Kept local rather than told
  // to the shared store: it says nothing about whether Adsterra can reach
  // this browser, and treating it as if it did would take down every other
  // slot on the page over one empty response.
  const [empty, setEmpty] = useState(false);
  const [renderedSize, setRenderedSize] = useState<{ width: number; height: number } | null>(null);

  // The wide unit above `sm`, the phone one below, and each falls back to the
  // other when only one is configured — a deployment with a single key should
  // show it rather than show nothing half the time. useMediaQuery reports
  // false until the first client paint, so the phone unit is the one that
  // renders first, which is the right way round: it is the smaller hole to
  // leave in a layout that is about to reflow.
  const useDesktopUnit = wide ? DESKTOP_BANNER !== null : MOBILE_BANNER === null;
  const isRoom = slot === "room";
  const unit: BannerUnit | null = isRoom
    ? (ROOM_BANNER || (useDesktopUnit ? DESKTOP_BANNER : MOBILE_BANNER))
    : (useDesktopUnit ? DESKTOP_BANNER : MOBILE_BANNER);
  const frameSlot: AdSlot = isRoom && ROOM_BANNER ? "room" : useDesktopUnit ? "desktop" : "mobile";

  const rendering = allowed && !blocked && !empty && unit !== null;

  const markSettled = useAdFrameWatchdog(rendering, BANNER_FILL_TIMEOUT_MS + 3000);

  useEffect(() => {
    if (!rendering) return;
    function onMessage(event: MessageEvent) {
      // Matched on the frame's own window rather than the event's origin.
      // Same-origin now, so an origin check would pass for every frame and
      // every script on this page; the window identity is the one test that
      // means "this slot's frame and nothing else".
      if (!frameRef.current || event.source !== frameRef.current.contentWindow) return;
      const message = parseAdFrameMessage(event.data);
      if (!message) return;
      if (message.type === "size") {
        setRenderedSize({ width: message.width, height: message.height });
        return;
      }
      if (message.type !== "status") return;
      markSettled();
      if (message.width && message.height) {
        setRenderedSize({ width: message.width, height: message.height });
      }
      // Only a refused request is a fact about the browser. An empty
      // response is a fact about this unit, and hides just this slot.
      if (message.reason === "blocked") reportAdsterraFill(false);
      else if (message.filled) reportAdsterraFill(true);
      else setEmpty(true);
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [rendering, markSettled]);

  if (!rendering || !unit) return null;

  // What the frame measured, but never bigger than the unit this slot
  // declared. The declared size is the shape the slot *is* — 728x90 on the
  // home page, 300x250 in a room — and it is the space the layout already
  // reserved, so letting a measurement grow the box is the page-shifting this
  // component exists to avoid, and is how the home page's horizontal banner
  // ended up as a square. Shrinking is still allowed: a creative smaller than
  // the unit leaves dead space otherwise, which is the case renderedSize was
  // added for.
  const displayWidth = renderedSize ? Math.min(renderedSize.width, unit.width) : unit.width;
  const displayHeight = renderedSize ? Math.min(renderedSize.height, unit.height) : unit.height;

  return (
    <div className={`flex flex-col items-center gap-1 ${className}`}>
      {label && (
        <span className="text-[10px] uppercase tracking-wide text-zinc-400 dark:text-zinc-600">
          {t("common.advertising")}
        </span>
      )}
      {/* Sized on the wrapper as well as the iframe so the space is reserved
          before the ad paints. An ad that arrives and pushes the page down
          under somebody's thumb is the single most annoying thing a slot like
          this can do. */}
      <div
        style={{ width: displayWidth, height: displayHeight }}
        className="max-w-full overflow-hidden transition-[width,height] duration-200"
      >
        <iframe
          ref={frameRef}
          // Remounts when the unit changes, so the desktop/phone switch
          // actually fetches the other slot's document instead of resizing
          // the box around the one already loaded.
          key={`${unit.key}-${unit.width}x${unit.height}`}
          title={t("common.advertising")}
          // A URL on this site rather than srcDoc — that is what gives the ad
          // script an origin, its cookies and a referrer Adsterra recognises.
          // See lib/adsterra.ts's header for what happened without it.
          src={adFrameUrl(frameSlot)}
          sandbox={IFRAME_SANDBOX}
          width={displayWidth}
          height={displayHeight}
          scrolling="no"
          referrerPolicy="no-referrer-when-downgrade"
          className="block max-w-full border-0"
        />
      </div>
    </div>
  );
}
