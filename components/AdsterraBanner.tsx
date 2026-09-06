"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
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

// A fixed-size Adsterra banner, in a sandboxed iframe. See lib/adsterra.ts for
// why the iframe is not optional.

export function AdsterraBanner({
  className = "",
  label = false,
  slot,
  fallback = null,
  onEmpty,
}: {
  className?: string;
  label?: boolean;
  slot?: "desktop" | "mobile" | "room";
  fallback?: ReactNode;
  onEmpty?: () => void;
}) {
  const allowed = useAdsAllowed();
  const blocked = useAdsterraBlocked();
  const wide = useMediaQuery(SM_BREAKPOINT_QUERY);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const [empty, setEmpty] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const [renderedSize, setRenderedSize] = useState<{ width: number; height: number } | null>(null);

  const useDesktopUnit = wide ? DESKTOP_BANNER !== null : MOBILE_BANNER === null;
  const isRoom = slot === "room";
  const unit: BannerUnit | null = isRoom
    ? (ROOM_BANNER || (useDesktopUnit ? DESKTOP_BANNER : MOBILE_BANNER))
    : (useDesktopUnit ? DESKTOP_BANNER : MOBILE_BANNER);
  const frameSlot: AdSlot = isRoom && ROOM_BANNER ? "room" : useDesktopUnit ? "desktop" : "mobile";

  const rendering = allowed && !blocked && !empty && unit !== null;

  const handleTimeout = () => {
    setEmpty(true);
    onEmpty?.();
  };

  const markSettled = useAdFrameWatchdog(rendering, BANNER_FILL_TIMEOUT_MS + 3000, handleTimeout);

  // If empty (e.g. temporary no-fill), schedule a retry after 60s
  useEffect(() => {
    if (!empty) return;
    const retryTimer = setTimeout(() => {
      setEmpty(false);
      setIsLoaded(false);
    }, 60000);
    return () => clearTimeout(retryTimer);
  }, [empty]);

  useEffect(() => {
    if (!rendering) return;
    function onMessage(event: MessageEvent) {
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
      if (message.reason === "blocked") {
        reportAdsterraFill(false, "blocked");
      } else if (message.filled) {
        reportAdsterraFill(true);
        setIsLoaded(true);
      } else {
        setEmpty(true);
        onEmpty?.();
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [rendering, markSettled, onEmpty]);

  if (!rendering || !unit) {
    return fallback ? <>{fallback}</> : null;
  }

  const displayWidth = renderedSize ? renderedSize.width : unit.width;
  const displayHeight = renderedSize ? renderedSize.height : unit.height;

  return (
    <div className={`flex flex-col items-center gap-1 ${className}`}>
      {label && (
        <span className="text-[10px] uppercase tracking-wide text-zinc-400 dark:text-zinc-600">
          Publicidade
        </span>
      )}
      <div
        style={{ width: displayWidth, height: displayHeight }}
        className="relative max-w-full overflow-hidden rounded-xl bg-zinc-100/60 dark:bg-zinc-900/60 transition-[width,height] duration-200"
      >
        {!isLoaded && (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-400/80 dark:text-zinc-500/80 animate-pulse">
              Publicidade
            </span>
          </div>
        )}
        <iframe
          ref={frameRef}
          key={`${unit.key}-${unit.width}x${unit.height}`}
          title="Publicidade"
          src={adFrameUrl(frameSlot)}
          sandbox={IFRAME_SANDBOX}
          width={displayWidth}
          height={displayHeight}
          scrolling="no"
          referrerPolicy="no-referrer-when-downgrade"
          allowTransparency={true}
          style={{ backgroundColor: "transparent" }}
          className={`block max-w-full border-0 transition-opacity duration-300 ${
            isLoaded ? "opacity-100" : "opacity-0 pointer-events-none"
          }`}
        />
      </div>
    </div>
  );
}
