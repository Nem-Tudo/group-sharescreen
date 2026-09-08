"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  IFRAME_SANDBOX,
  NATIVE_BANNER,
  NATIVE_FILL_TIMEOUT_MS,
  adFrameUrl,
  parseAdFrameMessage,
} from "@/lib/adsterra";
import {
  reportAdsterraFill,
  useAdFrameWatchdog,
  useAdsterraBlocked,
} from "@/lib/adsterraFill";
import { useAdsAllowed } from "@/lib/useAdsAllowed";

// The Adsterra native banner — a row of "recommended" cards that takes the
// width it is given and whatever height its contents need.

const INITIAL_HEIGHT = 260;
const MAX_HEIGHT = 1200;

export function AdsterraNative({
  className = "",
  label = true,
  fallback = null,
  onEmpty,
}: {
  className?: string;
  label?: boolean;
  fallback?: ReactNode;
  onEmpty?: () => void;
}) {
  const allowed = useAdsAllowed();
  const blocked = useAdsterraBlocked();
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const [height, setHeight] = useState<number | null>(null);
  const [empty, setEmpty] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);

  const rendering = allowed && !blocked && !empty && NATIVE_BANNER !== null;

  const handleTimeout = () => {
    setEmpty(true);
    onEmpty?.();
  };

  const markSettled = useAdFrameWatchdog(rendering, NATIVE_FILL_TIMEOUT_MS + 3000, handleTimeout);

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
      if (message.type === "status") {
        markSettled();
        if (message.reason === "blocked") {
          reportAdsterraFill(false, "blocked");
        } else if (message.filled) {
          reportAdsterraFill(true);
          setIsLoaded(true);
        } else {
          setEmpty(true);
          onEmpty?.();
        }
        return;
      }
      setHeight(Math.min(Math.round(message.height), MAX_HEIGHT));
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [rendering, markSettled, onEmpty]);

  if (!rendering || !NATIVE_BANNER) {
    return fallback ? <>{fallback}</> : null;
  }

  const boxHeight = height ?? INITIAL_HEIGHT;

  return (
    <div className={`flex w-full flex-col gap-1 ${className}`}>
      {label && height !== null && (
        <span className="text-[10px] uppercase tracking-wide text-zinc-400 dark:text-zinc-600">
          Publicidade
        </span>
      )}
      <div
        style={{ height: boxHeight }}
        className="relative w-full overflow-hidden rounded-xl bg-zinc-100/60 dark:bg-zinc-900/60 transition-[height] duration-200"
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
          title="Publicidade"
          src={adFrameUrl("native")}
          sandbox={IFRAME_SANDBOX}
          scrolling="no"
          referrerPolicy="no-referrer-when-downgrade"
          allowTransparency={true}
          style={{ height: boxHeight, backgroundColor: "transparent" }}
          className={`w-full border-0 transition-opacity duration-300 ${
            isLoaded ? "opacity-100" : "opacity-0 pointer-events-none"
          }`}
        />
      </div>
    </div>
  );
}
