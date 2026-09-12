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
import { useT } from "@/lib/useI18n";

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

// There used to be a "fold the placeholder away after three seconds" here, to
// avoid holding a white rectangle open while the ad loaded. It was removed
// because it was breaking the thing it was decorating: collapsing the iframe
// to zero height gives the widget inside a viewport of no height to lay out
// in — and this unit measures the space it has (its own config carries
// `increaseBannerSize` and it reads clientHeight) — so the ad that was still
// deciding decided on nothing. The reserved space is the lesser cost: it is
// the size the ad is about to be, and a slot that turns out empty removes
// itself entirely a few seconds later.

/**
 * A ceiling, because the height arrives from inside an ad. A creative that
 * reports 40000px — through a bug or otherwise — would otherwise be handed
 * the whole page.
 *
 * It is the default rather than the rule: 1200px is a sane cap for a slot
 * that owns the width of a page, and a catastrophe for one in a 300px column,
 * where the same cards stack vertically instead of sitting in a row. See the
 * `maxHeight` prop, and the room's use of it.
 */
const MAX_HEIGHT = 1200;

export function AdsterraNative({
  className = "",
  label = true,
  maxHeight = MAX_HEIGHT,
}: {
  className?: string;
  /** Defaults on here: a native ad is *designed* to look like site content. */
  label?: boolean;
  /**
   * How tall this slot may get, whatever the ad says it needs.
   *
   * The height of a native unit is decided by its own contents, so the space
   * it takes is the *page's* decision to make, not the creative's: dropped
   * into the room's participant column it laid its cards out in a single
   * 1200px stack and buried the column it was sitting in. Anything past this
   * is clipped (the frame does not scroll), which for a stack of cards means
   * showing the first ones — the right way to be wrong, since the alternative
   * is an ad that eats the room.
   */
  maxHeight?: number;
}) {
  const t = useT();
  const allowed = useAdsAllowed();
  // See AdsterraBanner: one refusal anywhere takes every slot down, because
  // an ad blocker is a fact about the browser and not about this unit.
  const blocked = useAdsterraBlocked();
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  // null until the frame reports one. Distinguishing "not yet" from a number
  // is what lets the placeholder below know it is still a placeholder.
  const [height, setHeight] = useState<number | null>(null);
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
      setHeight(Math.min(Math.round(message.height), maxHeight));
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [rendering, markSettled, maxHeight]);

  if (!rendering || !NATIVE_BANNER) return null;

  // The ad's real height once it reports one, and the placeholder until then.
  // The cap applies to the placeholder too: a slot that opens at 260px and
  // then shrinks to its limit is the same jump this transition exists to
  // avoid, just in the other direction.
  const boxHeight = Math.min(height ?? INITIAL_HEIGHT, maxHeight);

  return (
    <div className={`flex w-full flex-col gap-1 ${className}`}>
      {/* The label goes with the ad, not with the space where one might
          appear — an "Publicidade" caption over an empty box is worse than
          no caption. */}
      {label && height !== null && (
        <span className="text-[10px] uppercase tracking-wide text-zinc-400 dark:text-zinc-600">
          {t("common.advertising")}
        </span>
      )}
      <iframe
        ref={frameRef}
        title={t("common.advertising")}
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
