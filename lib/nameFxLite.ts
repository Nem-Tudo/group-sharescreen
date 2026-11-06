"use client";

import { useFeature } from "./features";

// Experiment "name-fx-lite": the points shop's sliding names ("shimmer:", see
// lib/nameStyle) hold still in the lists where the same name repeats — a chat log,
// a member list — and slide only under the pointer.
//
// The slide animates background-position, which no browser can hand to the
// compositor: every frame, at the monitor's refresh rate, each one is repainted on
// the main thread. One name in the participant list is nothing. A chat log keeps up
// to 200 messages, each with its author's name, and 60 of them measured 17% of the
// page's main thread at 60 Hz (2.4 times that at 144) — on the machine that is also
// encoding and decoding the call. Outside these lists (a profile, a tile, the
// participants) nothing changes. An experiment because it changes how something
// people bought looks.
export const NAME_FX_LITE_FEATURE = "name-fx-lite";

/** Spread onto a list where names repeat; empty outside the experiment. See app/globals.css. */
export function useNameFxListAttrs(): { "data-name-fx-list"?: "" } {
  const { enabled } = useFeature(NAME_FX_LITE_FEATURE);
  return enabled ? { "data-name-fx-list": "" } : {};
}
