"use client";

import { useEffect, useRef, useState } from "react";
import {
  IFRAME_SANDBOX,
  NATIVE_BANNER,
  nativeSrcDoc,
  parseAdFrameMessage,
} from "@/lib/adsterra";
import { reportAdsterraFill, useAdsterraBlocked } from "@/lib/adsterraFill";
import { useAdsAllowed } from "@/lib/useAdsAllowed";

// The Adsterra native banner — a row of "recommended" cards that takes the
// width it is given and whatever height its contents need.
//
// Same sandboxed iframe as the fixed banner (see lib/adsterra.ts), with the
// one extra problem that follows from it: the parent cannot measure a
// document on an opaque origin, so the slot has no idea how tall to be. The
// iframe measures itself and posts the number out; everything below is about
// believing that number only when it is worth believing.

/** Before the ad has said anything. Roughly one row of cards. */
const INITIAL_HEIGHT = 260;

/**
 * A ceiling, because the height arrives from inside an ad. A creative that
 * reports 40000px — through a bug or otherwise — would otherwise be handed
 * the whole page.
 */
const MAX_HEIGHT = 1200;

export function AdsterraNative({
  className = "",
  label = true,
}: {
  className?: string;
  /** Defaults on here: a native ad is *designed* to look like site content. */
  label?: boolean;
}) {
  const allowed = useAdsAllowed();
  // See AdsterraBanner: one refusal anywhere takes every slot down, because
  // an ad blocker is a fact about the browser and not about this unit.
  const blocked = useAdsterraBlocked();
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const [height, setHeight] = useState(INITIAL_HEIGHT);

  const rendering = allowed && !blocked && NATIVE_BANNER !== null;

  useEffect(() => {
    if (!rendering) return;
    function onMessage(event: MessageEvent) {
      // The origin is opaque ("null") by design, so it cannot be checked —
      // the frame's own window is the identity that is checkable, and it is
      // the stronger check anyway: it rejects every other frame on the page
      // regardless of where it came from.
      if (!frameRef.current || event.source !== frameRef.current.contentWindow) return;
      const message = parseAdFrameMessage(event.data);
      if (!message) return;
      if (message.type === "status") {
        reportAdsterraFill(message.filled);
        return;
      }
      setHeight(Math.min(Math.round(message.height), MAX_HEIGHT));
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [rendering]);

  if (!rendering || !NATIVE_BANNER) return null;

  return (
    <div className={`flex w-full flex-col gap-1 ${className}`}>
      {label && (
        <span className="text-[10px] uppercase tracking-wide text-zinc-400 dark:text-zinc-600">
          Publicidade
        </span>
      )}
      <iframe
        ref={frameRef}
        title="Publicidade"
        srcDoc={nativeSrcDoc(NATIVE_BANNER)}
        sandbox={IFRAME_SANDBOX}
        scrolling="no"
        loading="lazy"
        referrerPolicy="no-referrer-when-downgrade"
        // Transitioned because the height lands in steps as the cards' images
        // load, and three instant jumps read as the page glitching.
        style={{ height }}
        className="w-full border-0 transition-[height] duration-200"
      />
    </div>
  );
}
