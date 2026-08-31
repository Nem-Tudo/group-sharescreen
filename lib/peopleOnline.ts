"use client";

// The "N pessoas online" number, fetched once for the whole page.
//
// It used to be two independent pollers — the landing page and the partner
// card each ran their own `setInterval` against /stats every 8 seconds — which
// meant every visitor generated two requests every eight seconds, forever, for
// one number that is identical in both places. That is the wrong shape at any
// size and an actively harmful one at scale: the request rate grows with the
// number of people online, and so does the cost of serving each request (the
// endpoint walks every socket in every room). At nine thousand people that
// arithmetic lands on roughly two thousand requests a second, each doing a
// nine-thousand-element walk, on the same event loop that has to accept new
// WebSocket connections — so the people already connected stayed fine while
// anyone opening the site fresh could not get in at all.
//
// The server now caches its side of it too (see /stats in server/signaling.ts),
// but halving the request count and pausing while nobody is looking are worth
// having regardless, and belong here.

import { useSyncExternalStore } from "react";
import { fetchPeopleOnline } from "./roomsApi";

// Slower than the 8s the two pollers used. This is a headline number on a
// landing page, not a live readout: nobody is watching it tick, and the extra
// freshness was being paid for by every visitor simultaneously.
const POLL_MS = 20_000;

// Null until the first successful load, and the callers depend on that: both
// of them hide the widget entirely rather than rendering "0 pessoas online"
// while the first request is still in the air.
let peopleOnline: number | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let inFlight: AbortController | null = null;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

async function load() {
  // A hidden tab is not showing this to anyone. Browsers already throttle
  // background timers, but they do not stop them, and a few thousand
  // backgrounded tabs politely asking for a headcount they will not draw is a
  // meaningful share of the traffic this endpoint sees.
  if (typeof document !== "undefined" && document.hidden) return;
  inFlight?.abort();
  const controller = new AbortController();
  inFlight = controller;
  try {
    const count = await fetchPeopleOnline(controller.signal);
    if (controller.signal.aborted) return;
    if (count !== peopleOnline) {
      peopleOnline = count;
      emit();
    }
  } catch {
    // Directory unreachable — leave the last known count in place rather than
    // flashing an error over a non-essential counter.
  } finally {
    if (inFlight === controller) inFlight = null;
  }
}

function start() {
  if (timer !== null) return;
  void load();
  timer = setInterval(() => void load(), POLL_MS);
  // Catching up on the way back is what makes pausing while hidden safe: a tab
  // that has been in the background for an hour shows a current number the
  // moment it is looked at again, instead of an hour-old one until the next
  // tick.
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", onVisibility);
  }
}

function stop() {
  if (timer === null) return;
  clearInterval(timer);
  timer = null;
  inFlight?.abort();
  inFlight = null;
  if (typeof document !== "undefined") {
    document.removeEventListener("visibilitychange", onVisibility);
  }
}

function onVisibility() {
  if (!document.hidden) void load();
}

/**
 * Subscribes to the shared count. The poll runs only while at least one
 * component is listening, so a page that never shows the number never asks for
 * it — and it stops the moment the last one unmounts.
 */
export function subscribePeopleOnline(listener: () => void): () => void {
  listeners.add(listener);
  start();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) stop();
  };
}

export function getPeopleOnline(): number | null {
  return peopleOnline;
}

// The server cannot know, and saying so is better than rendering a number that
// changes the moment the page hydrates.
export function getPeopleOnlineServer(): null {
  return null;
}

/** The shared count, or null while it has never successfully loaded. */
export function usePeopleOnline(): number | null {
  return useSyncExternalStore(subscribePeopleOnline, getPeopleOnline, getPeopleOnlineServer);
}
