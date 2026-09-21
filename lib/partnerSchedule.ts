"use client";

import { useEffect, useMemo, useState } from "react";
import type { PartnerCardData, PartnerSchedule } from "./partner";

// Dayparting for a partner ad: which of its windows is running right now, and
// what the card looks like while it is.
//
// Resolved here, in the browser, rather than on the server — "das 12:00 as
// 19:00" is the advertiser writing about the visitor's afternoon, and the
// server has no idea what time it is where any given visitor is. One socket
// push reaches every timezone at once, so a server that picked a window would
// have to pick the wrong one for most of the people receiving it.

const MINUTES_IN_DAY = 24 * 60;

/** Minutes since local midnight, in the visitor's own clock. */
export function minuteOfDay(at: Date): number {
  return at.getHours() * 60 + at.getMinutes();
}

/** "13:05" from 785. */
export function formatMinuteOfDay(minute: number): string {
  const safe = ((Math.round(minute) % MINUTES_IN_DAY) + MINUTES_IN_DAY) % MINUTES_IN_DAY;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(safe / 60))}:${pad(safe % 60)}`;
}

/** "13:05" back to 785, or null when it isn't a time of day. */
export function parseMinuteOfDay(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/**
 * Whether `minute` falls inside a window, both ends included.
 *
 * A window whose end is before its start wraps past midnight — "19:01 as
 * 11:59" is the evening and the morning after it, one window, which is how an
 * advertiser writes the other half of a day.
 */
export function scheduleCovers(schedule: PartnerSchedule, minute: number): boolean {
  const { startMinute, endMinute } = schedule;
  if (startMinute <= endMinute) return minute >= startMinute && minute <= endMinute;
  return minute >= startMinute || minute <= endMinute;
}

/**
 * The window running at `minute`, or null for none.
 *
 * First match wins, so overlapping windows are decided by the order the admin
 * put them in rather than by which one is "more specific" — a rule an admin
 * can see on the screen and reorder, unlike a scoring one.
 */
export function activePartnerSchedule(
  partner: Pick<PartnerCardData, "schedules">,
  minute: number
): PartnerSchedule | null {
  const schedules = partner.schedules;
  if (!schedules || schedules.length === 0) return null;
  return schedules.find((schedule) => scheduleCovers(schedule, minute)) ?? null;
}

/**
 * The ad as it should be shown right now: its own fields, with the running
 * window's overrides laid on top.
 *
 * Overrides, not a replacement — a window that only swaps the banner keeps the
 * ad's headline, copy, button and colours (see the API's Partner.schedules).
 * Everything that isn't a creative field (the id, the rewards, expiry) is the
 * ad's alone: a daypart changes what the card says, never what it pays.
 *
 * `schedules` is dropped from the result, which makes this idempotent —
 * resolving an already-resolved ad answers the same object's worth of fields
 * rather than resolving twice against a clock that moved in between.
 */
export function resolvePartnerCreative(
  partner: PartnerCardData,
  minute: number
): PartnerCardData {
  const schedule = activePartnerSchedule(partner, minute);
  const base: PartnerCardData = { ...partner };
  delete base.schedules;
  if (!schedule) return base;
  return {
    ...base,
    title: schedule.title ?? base.title,
    description: schedule.description ?? base.description,
    imageUrl: schedule.imageUrl ?? base.imageUrl,
    iconUrl: schedule.iconUrl ?? base.iconUrl,
    buttonLabel: schedule.buttonLabel ?? base.buttonLabel,
    buttonUrl: schedule.buttonUrl ?? base.buttonUrl,
    backgroundColor: schedule.backgroundColor ?? base.backgroundColor,
    textColor: schedule.textColor ?? base.textColor,
    buttonBackgroundColor: schedule.buttonBackgroundColor ?? base.buttonBackgroundColor,
    buttonTextColor: schedule.buttonTextColor ?? base.buttonTextColor,
  };
}

/**
 * When the card next has to be redrawn: the soonest window edge after `minute`,
 * as a delay in ms.
 *
 * Every start and every end counts, including the ends of windows that aren't
 * running — the moment one finishes is the moment the ad falls back to its own
 * creative, and that is as much a change as a window beginning.
 *
 * Null when the ad has no windows at all, which is the overwhelming majority
 * of them: nothing to wait for, so no timer is set.
 */
export function msUntilNextScheduleBoundary(
  partner: Pick<PartnerCardData, "schedules">,
  at: Date
): number | null {
  const schedules = partner.schedules;
  if (!schedules || schedules.length === 0) return null;
  const edges = new Set<number>();
  for (const schedule of schedules) {
    edges.add(schedule.startMinute);
    // The minute *after* the last one it covers: the window is inclusive, so
    // 19:00 as the end means the change lands at 19:01.
    edges.add((schedule.endMinute + 1) % MINUTES_IN_DAY);
  }
  const now = minuteOfDay(at);
  let best = MINUTES_IN_DAY;
  for (const edge of edges) {
    const delta = (edge - now + MINUTES_IN_DAY) % MINUTES_IN_DAY;
    // A boundary sitting exactly on this minute is the one we already applied,
    // so it is a full day away rather than zero — waiting zero would spin.
    if (delta > 0 && delta < best) best = delta;
  }
  // Down to the top of the minute the boundary falls on, not a whole number of
  // minutes from an arbitrary point inside this one, so a window that starts
  // at 19:00 starts at 19:00 and not at 19:00:43.
  const msIntoMinute = at.getSeconds() * 1000 + at.getMilliseconds();
  return best * 60_000 - msIntoMinute;
}

/**
 * The ad as it should be shown, kept right as the day goes on: re-renders on
 * each window edge and nowhere in between.
 *
 * Idempotent, so it is safe on an ad some other layer already resolved — the
 * resolved one carries no windows, and an ad with no windows sets no timer.
 */
export function usePartnerCreative(partner: PartnerCardData | null): PartnerCardData | null {
  const [now, setNow] = useState(() => new Date());

  const schedules = partner?.schedules;
  useEffect(() => {
    if (!schedules || schedules.length === 0) return;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const at = new Date();
      setNow(at);
      const wait = msUntilNextScheduleBoundary({ schedules }, at);
      // A minute's floor: a clock nudged backwards (an NTP correction, a
      // laptop waking up) can hand back a delay of nearly nothing, and a
      // timer that reschedules itself instantly is a busy loop.
      timer = setTimeout(tick, Math.max(60_000, wait ?? 60_000));
    };
    const at = new Date();
    timer = setTimeout(tick, Math.max(1_000, msUntilNextScheduleBoundary({ schedules }, at) ?? 60_000));
    return () => clearTimeout(timer);
  }, [schedules]);

  return useMemo(
    () => (partner ? resolvePartnerCreative(partner, minuteOfDay(now)) : null),
    [partner, now]
  );
}
