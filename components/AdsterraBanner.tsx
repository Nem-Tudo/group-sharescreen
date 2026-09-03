"use client";

import { useEffect, useRef } from "react";
import { SM_BREAKPOINT_QUERY, useMediaQuery } from "@/lib/useMediaQuery";
import {
  DESKTOP_BANNER,
  IFRAME_SANDBOX,
  MOBILE_BANNER,
  bannerSrcDoc,
  parseAdFrameMessage,
  type AdsterraBanner as BannerUnit,
} from "@/lib/adsterra";
import { reportAdsterraFill, useAdsterraBlocked } from "@/lib/adsterraFill";
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
  const unit: BannerUnit | null = wide
    ? DESKTOP_BANNER ?? MOBILE_BANNER
    : MOBILE_BANNER ?? DESKTOP_BANNER;

  const rendering = allowed && !blocked && unit !== null;

  useEffect(() => {
    if (!rendering) return;
    function onMessage(event: MessageEvent) {
      // The frame's own window, not its origin: the sandbox gives it an
      // opaque origin, so there is nothing to compare, and this is the
      // stricter check regardless.
      if (!frameRef.current || event.source !== frameRef.current.contentWindow) return;
      const message = parseAdFrameMessage(event.data);
      if (message?.type === "status") reportAdsterraFill(message.filled);
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [rendering]);

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
          // Remounts when the unit changes, which is what makes the desktop/
          // phone switch actually swap creatives: srcDoc is only read when
          // the frame is created, so without a key React would keep the old
          // document and just resize the box around it.
          key={`${unit.key}-${unit.width}x${unit.height}`}
          title="Publicidade"
          srcDoc={bannerSrcDoc(unit)}
          sandbox={IFRAME_SANDBOX}
          width={unit.width}
          height={unit.height}
          scrolling="no"
          // Lazy because a slot below the fold should not compete with the
          // room's own connection for bandwidth on load.
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
          className="block max-w-full border-0"
        />
      </div>
    </div>
  );
}
