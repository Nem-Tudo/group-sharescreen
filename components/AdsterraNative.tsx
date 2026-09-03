"use client";

import { useEffect, useRef, useState } from "react";
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
//
// Same sandboxed iframe as the fixed banner (see lib/adsterra.ts), with the
// one extra problem that follows from it: the parent cannot measure a
// document on an opaque origin, so the slot has no idea how tall to be. The
// iframe measures itself and posts the number out; everything below is about
// believing that number only when it is worth believing.

/** Before the ad has said anything. Roughly one row of cards. */
const INITIAL_HEIGHT = 260;

/**
 * How long the placeholder holds its space before folding away.
 *
 * The native unit can legitimately take ten seconds to paint — a big script,
 * then its own ad request, then images — and reserving 260px for all of it is
 * how a page ends up with a white rectangle sitting in it. So the space is
 * offered briefly and then withdrawn, while the frame keeps loading in a box
 * of no height: an ad that turns up late still gets shown, and one that never
 * turns up was never taking up room.
 */
const PLACEHOLDER_GRACE_MS = 3000;

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
  // null until the frame reports one. Distinguishing "not yet" from a number
  // is what lets the placeholder below know it is still a placeholder.
  const [height, setHeight] = useState<number | null>(null);
  const [placeholderExpired, setPlaceholderExpired] = useState(false);
  // See AdsterraBanner: an empty response hides this slot and nothing else.
  const [empty, setEmpty] = useState(false);

  const rendering = allowed && !blocked && !empty && NATIVE_BANNER !== null;

  const markSettled = useAdFrameWatchdog(rendering, NATIVE_FILL_TIMEOUT_MS + 3000);

  useEffect(() => {
    if (!rendering) return;
    function onMessage(event: MessageEvent) {
      // See AdsterraBanner: matched on the frame's own window, which stays
      // the strict test now that the document is same-origin.
      if (!frameRef.current || event.source !== frameRef.current.contentWindow) return;
      const message = parseAdFrameMessage(event.data);
      if (!message) return;
      if (message.type === "status") {
        markSettled();
        if (message.reason === "blocked") reportAdsterraFill(false);
        else if (message.filled) reportAdsterraFill(true);
        else setEmpty(true);
        return;
      }
      setHeight(Math.min(Math.round(message.height), MAX_HEIGHT));
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [rendering, markSettled]);

  useEffect(() => {
    if (!rendering) return;
    const timer = setTimeout(() => setPlaceholderExpired(true), PLACEHOLDER_GRACE_MS);
    return () => clearTimeout(timer);
  }, [rendering]);

  if (!rendering || !NATIVE_BANNER) return null;

  // A real height once the ad has one; the placeholder until the grace period
  // runs out; nothing after that.
  const boxHeight = height ?? (placeholderExpired ? 0 : INITIAL_HEIGHT);

  return (
    <div className={`flex w-full flex-col gap-1 ${className}`}>
      {/* The label goes with the ad, not with the space where one might
          appear — an "Publicidade" caption over an empty box is worse than
          no caption. */}
      {label && height !== null && (
        <span className="text-[10px] uppercase tracking-wide text-zinc-400 dark:text-zinc-600">
          Publicidade
        </span>
      )}
      <iframe
        ref={frameRef}
        title="Publicidade"
        // See AdsterraBanner: a real URL, not srcDoc, so the script has an
        // origin to work in.
        src={adFrameUrl("native")}
        sandbox={IFRAME_SANDBOX}
        scrolling="no"
        referrerPolicy="no-referrer-when-downgrade"
        // Transitioned because the height lands in steps as the cards' images
        // load, and three instant jumps read as the page glitching.
        style={{ height: boxHeight }}
        className="w-full border-0 transition-[height] duration-200"
      />
    </div>
  );
}
