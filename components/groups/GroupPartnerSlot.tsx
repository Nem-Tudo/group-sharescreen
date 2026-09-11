"use client";

import { AdsterraBanner } from "@/components/AdsterraBanner";
import { AdsterraNative } from "@/components/AdsterraNative";
import { PartnerCard } from "@/components/PartnerCard";
import { NATIVE_BANNER } from "@/lib/adsterra";
import { useAdsterraBlocked } from "@/lib/adsterraFill";
import { useAdsterraAvailable } from "@/lib/useAdsAllowed";
import { useAdRotation } from "@/lib/useAdRotation";
import { usePartnerAd } from "@/lib/usePartnerAd";

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

export function GroupPartnerSlot() {
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
  const showAdsterra = useAdRotation(adsterraReady);
  const { rawPartner, loaded } = usePartnerAd({ visible: !showAdsterra });

  if (showAdsterra) {
    return format === "native" ? (
      <AdsterraNative className="shrink-0" label={false} maxHeight={280} />
    ) : (
      <AdsterraBanner slot="room" className="shrink-0" />
    );
  }
  return <PartnerCard partner={rawPartner} loaded={loaded} />;
}
