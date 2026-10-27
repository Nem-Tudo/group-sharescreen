"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useSignalingSelector, shallow } from "@/lib/useSignalingSelector";
import { selectEventPromos } from "@/lib/signalingSelectors";
import { signalingClient } from "@/lib/signalingClient";
import { trackFeatureEvent, useFeature } from "@/lib/features";
import {
  eventPromoPhase,
  eventPromoPointsHere,
  eventPromoVisibleAt,
  readEventPromoState,
  writeEventPromoState,
  type EventPromo,
} from "@/lib/eventPromo";
import { EventPromoCard, EventPromoPill } from "./EventPromoCard";

export const EVENT_PROMO_FEATURE = "event-promo";

export const EVENT_PROMO_EVENTS = {
  view: "event_promo_view",
  click: "event_promo_click",
  minimize: "event_promo_minimize",
  expand: "event_promo_expand",
  dismiss: "event_promo_dismiss",
} as const;

function track(name: string) {
  trackFeatureEvent(name, { feature: EVENT_PROMO_FEATURE });
}

// The "acontecendo agora" card in a corner of every page. Everything it shows
// comes from the admin panel (Eventos tab) over the signaling socket, so a
// new, edited or deleted promo lands here the moment it is saved — see the
// API's eventPromoStore.ts.
//
// Behind the "event-promo" feature, so its reach and click-through can be
// read in the Features tab like any other experiment.
export function EventPromoWidget() {
  const { eventPromos } = useSignalingSelector(selectEventPromos, shallow);
  const pathname = usePathname();
  const inRoom = Boolean(pathname?.startsWith("/watch/"));

  // Safe to read during the first render: nothing is drawn until the socket
  // has delivered a promo, which is always after hydration, so the server
  // pass (no window, empty state) and the first client pass both render null.
  const [stored, setStored] = useState<{ minimized: string[]; dismissed: string[] }>(() =>
    typeof window === "undefined" ? { minimized: [], dismissed: [] } : readEventPromoState()
  );
  // Opened by hand inside a room this page load — overrides inRoom "minimized".
  const [roomExpanded, setRoomExpanded] = useState<Set<string>>(new Set());

  const [now, setNow] = useState(() => Date.now());

  const visible = useMemo(() => {
    return eventPromos.filter(
      (p) =>
        eventPromoVisibleAt(p, now) &&
        !stored.dismissed.includes(p.id) &&
        !eventPromoPointsHere(p.url, pathname) &&
        !(inRoom && p.inRoom === "hidden")
    );
  }, [eventPromos, stored, now, pathname, inRoom]);

  const [index, setIndex] = useState(0);
  const current: EventPromo | undefined = visible[Math.min(index, visible.length - 1)];

  // Ticks every second while a countdown is on screen; otherwise every 30 s,
  // just often enough to notice an event starting or ending on schedule.
  const counting = Boolean(current && eventPromoPhase(current, now) === "upcoming");
  const hasSchedule = eventPromos.some((p) => p.startsAt !== null || p.endsAt !== null);
  useEffect(() => {
    if (!hasSchedule) return;
    const timer = setInterval(() => setNow(Date.now()), counting ? 1000 : 30_000);
    return () => clearInterval(timer);
  }, [counting, hasSchedule]);

  const feature = useFeature(EVENT_PROMO_FEATURE, { track: visible.length > 0 });
  const shown = feature.enabled && current !== undefined && pathname !== null &&
    !pathname.startsWith("/stream") && !pathname.startsWith("/obs") && !pathname.startsWith("/cam");

  // One view per promo per page load, only while the tab is actually visible.
  const viewed = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!shown || !current) return;
    const report = () => {
      if (document.visibilityState !== "visible" || viewed.current.has(current.id)) return;
      viewed.current.add(current.id);
      signalingClient.reportEventPromoStat(current.id, "view");
      track(EVENT_PROMO_EVENTS.view);
    };
    report();
    document.addEventListener("visibilitychange", report);
    return () => document.removeEventListener("visibilitychange", report);
  }, [shown, current]);

  if (!shown || !current) return null;

  const minimized =
    stored.minimized.includes(current.id) ||
    (inRoom && current.inRoom === "minimized" && !roomExpanded.has(current.id));

  function save(next: { minimized: string[]; dismissed: string[] }) {
    setStored(next);
    writeEventPromoState(next);
  }

  function minimize() {
    if (!current) return;
    track(EVENT_PROMO_EVENTS.minimize);
    setRoomExpanded((prev) => {
      const next = new Set(prev);
      next.delete(current.id);
      return next;
    });
    save({ ...stored, minimized: [...stored.minimized.filter((id) => id !== current.id), current.id] });
  }

  function expand() {
    if (!current) return;
    track(EVENT_PROMO_EVENTS.expand);
    if (inRoom) setRoomExpanded((prev) => new Set(prev).add(current.id));
    save({ ...stored, minimized: stored.minimized.filter((id) => id !== current.id) });
  }

  function dismiss() {
    if (!current) return;
    track(EVENT_PROMO_EVENTS.dismiss);
    signalingClient.reportEventPromoStat(current.id, "dismiss");
    save({ ...stored, dismissed: [...stored.dismissed, current.id] });
  }

  function click() {
    if (!current) return;
    track(EVENT_PROMO_EVENTS.click);
    signalingClient.reportEventPromoStat(current.id, "click");
  }

  const side = current.position === "bottom-right" ? "right-4" : "left-4";

  return (
    <div
      // Above the mobile tab bar; z-40 like the install prompt, below dialogs.
      className={`fixed ${side} bottom-[calc(var(--app-tabbar-h)+1rem)] z-40`}
    >
      {minimized ? (
        <EventPromoPill
          key={`pill-${current.id}`}
          promo={current}
          now={now}
          onExpand={expand}
          onDismiss={current.dismissible ? dismiss : undefined}
        />
      ) : (
        <EventPromoCard
          key={`card-${current.id}`}
          promo={current}
          now={now}
          onClick={click}
          onMinimize={minimize}
          pager={
            visible.length > 1
              ? {
                  index: Math.min(index, visible.length - 1),
                  total: visible.length,
                  onPrev: () => setIndex((i) => (i - 1 + visible.length) % visible.length),
                  onNext: () => setIndex((i) => (i + 1) % visible.length),
                }
              : undefined
          }
        />
      )}
    </div>
  );
}
