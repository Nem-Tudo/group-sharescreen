"use client";

import { PartnerCard } from "@/components/PartnerCard";
import { useFeature } from "@/lib/features";
import { usePartnerAd } from "@/lib/usePartnerAd";

// The ad square under the conversations in the expanded messages — the same
// slot a group has under its rooms (see GroupPartnerSlot). Behind an experiment
// that compares the partner_* events of the two sides (see lib/partnerExperiment).

/** The feature's key in the admin panel. Target: user. */
export const DM_PARTNER_SLOT_FEATURE = "dm-partner-slot";

// What the list above keeps from lg up: its header, search box and about four
// conversations. The ad gives way below that, and scrolls.
const RESERVED_FOR_CONVERSATIONS_PX = 360;

function DmPartnerCard() {
  const { rawPartner, loaded, hidden } = usePartnerAd();
  // A Pro subscriber who turned partner ads off: the list takes the column.
  if (hidden) return null;
  return <PartnerCard partner={rawPartner} loaded={loaded} reservedAbove={RESERVED_FOR_CONVERSATIONS_PX} />;
}

export function DmPartnerSlot() {
  const { enabled } = useFeature(DM_PARTNER_SLOT_FEATURE, { track: true });
  // Its own component, so nobody outside the experiment fetches or counts an ad.
  return enabled ? <DmPartnerCard /> : null;
}
