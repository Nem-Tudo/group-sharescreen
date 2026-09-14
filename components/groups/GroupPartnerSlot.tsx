"use client";

import { useState, useSyncExternalStore } from "react";
import { AdsterraBanner } from "@/components/AdsterraBanner";
import { AdsterraNative } from "@/components/AdsterraNative";
import { PartnerCard, PartnerCardMinimized } from "@/components/PartnerCard";
import { ChevronUpIcon } from "@/components/icons";
import { useAuth } from "@/lib/AuthContext";
import { accountTierOf } from "@/lib/entitlements";
import { NATIVE_BANNER } from "@/lib/adsterra";
import { useAdsterraBlocked } from "@/lib/adsterraFill";
import { useAdsterraAvailable } from "@/lib/useAdsAllowed";
import { useAdRotation } from "@/lib/useAdRotation";
import { usePartnerAd } from "@/lib/usePartnerAd";
import { useT } from "@/lib/useI18n";

// The ad square under a group's rooms — the same slot a room has under its
// participant list, and the same arrangement in it: the partner and Adsterra
// taking turns a minute at a time, with the partner keeping the slot to itself
// whenever Adsterra cannot actually fill it (see WatchRoom, which this mirrors).
//
// Lives in the group shell rather than in the call, so it is on screen for the
// whole of a group — reading a text room included — and the call inside a
// group draws no ad of its own (see WatchRoom's usePartnerAd `visible`).
//
// Only mounted from lg up, by the shell: below that the rooms column does not
// exist, and an ad counting impressions while hidden would be counting nothing.
//
// A Pro Max subscriber may put it away, here and nowhere else — folded down
// to one slim row at the foot of the column rather than closed outright (see
// PartnerCardMinimized): the online count and "Anuncie aqui você também!" stay,
// being the site's own rather than anybody's ad, and the chevron brings the
// card back. Folded is remembered per browser (localStorage), so it stays the
// way it was left — across groups, out of the groups and back, and across
// reloads — until it is opened again. Held in this module too, so every slot
// mounted in the tab reads the one answer and hears when it changes.

const MINIMIZED_KEY = "sharescreen:groupAdMinimized";

// Null until first read: the storage is only there in a browser, and only
// read once there — every later answer is this variable.
let dismissed: boolean | null = null;
const dismissListeners = new Set<() => void>();

function readMinimized(): boolean {
  if (dismissed !== null) return dismissed;
  try {
    dismissed = window.localStorage.getItem(MINIMIZED_KEY) === "1";
  } catch {
    // Private mode, or storage refused: open, which is the default anyway.
    dismissed = false;
  }
  return dismissed;
}

function setGroupAdMinimized(next: boolean) {
  if (readMinimized() === next) return;
  dismissed = next;
  try {
    if (next) window.localStorage.setItem(MINIMIZED_KEY, "1");
    else window.localStorage.removeItem(MINIMIZED_KEY);
  } catch {
    // Kept for this visit either way — a choice that cannot be written down
    // still holds for as long as the tab is open.
  }
  dismissListeners.forEach((l) => l());
}

const minimizeGroupAd = () => setGroupAdMinimized(true);

function useGroupAdDismissed(): boolean {
  return useSyncExternalStore(
    (listener) => {
      dismissListeners.add(listener);
      return () => dismissListeners.delete(listener);
    },
    readMinimized,
    () => false
  );
}

/**
 * Whether this person folded the group's ad away — for the call too, which
 * draws it in its grid while the rooms column is hidden (see WatchRoom), and
 * must not put back at full size an ad that was folded down.
 */
export function useGroupAdHidden(): boolean {
  const { account } = useAuth();
  const closed = useGroupAdDismissed();
  return accountTierOf(account?.flags) === "premium_max" && closed;
}

export function GroupPartnerSlot({
  reservedAbove,
}: {
  /** What the rooms above it keep — their first five (see the shell). */
  reservedAbove?: number;
}) {
  const t = useT();
  const { account } = useAuth();
  const canDismiss = accountTierOf(account?.flags) === "premium_max";
  const hidden = useGroupAdHidden();
  // "Anuncie aqui você também!" pressed on the folded row: the card comes back
  // on the house ad that pitch is about, whoever's turn it was — until its
  // "Voltar", or until it is folded again.
  const [pitch, setPitch] = useState(false);
  // The column is the room's 300px sidebar, where only the fluid native unit
  // is worth anything — the fixed banner is the fallback when there is none.
  const hasValidNative = Boolean(
    NATIVE_BANNER &&
      !NATIVE_BANNER.src.includes("localhost") &&
      !NATIVE_BANNER.src.includes("127.0.0.1")
  );
  const format = hasValidNative ? "native" : "banner";
  const adsterraBlocked = useAdsterraBlocked();
  const adsterraReady = useAdsterraAvailable(format) && !adsterraBlocked;
  const showAdsterra = useAdRotation(adsterraReady && !hidden && !pitch);
  // Not visible while folded, so a folded ad counts no impressions — nor while
  // the house ad is standing in for it.
  const { rawPartner, loaded } = usePartnerAd({ visible: !showAdsterra && !hidden && !pitch });
  const dismiss = canDismiss
    ? () => {
        setPitch(false);
        minimizeGroupAd();
      }
    : undefined;

  if (hidden) {
    return (
      <PartnerCardMinimized
        partner={loaded ? rawPartner : null}
        onRestore={() => setGroupAdMinimized(false)}
        onAdvertise={() => {
          setPitch(true);
          setGroupAdMinimized(false);
        }}
      />
    );
  }

  if (pitch) {
    // Keyed apart from the ordinary card, so it starts on the house ad and the
    // ordinary one starts on the served ad again after "Voltar".
    return (
      <PartnerCard
        key="pitch"
        partner={rawPartner}
        loaded={loaded}
        reservedAbove={reservedAbove}
        onDismiss={dismiss}
        startWithHouseAd
        onLeaveHouseAd={() => setPitch(false)}
      />
    );
  }

  if (showAdsterra) {
    // In a box that gives way to the rooms above it and scrolls what no longer
    // fits (see the shell). `empty:hidden`, so a unit that renders nothing
    // leaves no gap behind in the column either.
    return (
      // The button sits beside the unit rather than in its box, so the box can
      // still be `empty:hidden` — and the whole slot goes with it (`has-`).
      <div className="relative flex min-h-0 flex-col has-[>div:empty]:hidden">
        <div className="min-h-0 overflow-y-auto empty:hidden">
          {format === "native" ? (
            <AdsterraNative label={false} maxHeight={280} />
          ) : (
            <AdsterraBanner slot="room" />
          )}
        </div>
        {dismiss && (
          <button
            type="button"
            onClick={dismiss}
            aria-label={t("partnerCard.collapseAd")}
            title={t("partnerCard.collapseAd")}
            className="absolute right-1.5 top-1.5 z-10 flex h-6 w-6 cursor-pointer items-center justify-center rounded-full bg-black/60 text-white transition hover:bg-black/80"
          >
            <ChevronUpIcon className="h-3.5 w-3.5 rotate-180" />
          </button>
        )}
      </div>
    );
  }
  // Not in that box: the card sizes itself to the column it is in — capped at
  // what the rooms leave it, scrolling past that — and a wrapper would be the
  // column it measured.
  return (
    <PartnerCard key="ad" partner={rawPartner} loaded={loaded} reservedAbove={reservedAbove} onDismiss={dismiss} />
  );
}
