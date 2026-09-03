"use client";

import { StatsOverview } from "./StatsOverview";
import { AnnouncementPanel } from "./AnnouncementPanel";
import { PartnerAdsPanel } from "./PartnerAdsPanel";
import { AdsterraPanel } from "./AdsterraPanel";
import { AntiSpamPanel } from "./AntiSpamPanel";
import { BannedWordsPanel } from "./BannedWordsPanel";
import { BansPanel } from "./BansPanel";
import { SupportersPanel } from "./SupportersPanel";
import { DesktopUpdatePanel } from "./DesktopUpdatePanel";
import { EvalPanel } from "./EvalPanel";

export function DashboardPanel() {
  return (
    <div className="flex flex-col gap-6">
      <StatsOverview />
      <AnnouncementPanel />
      <PartnerAdsPanel />
      <AdsterraPanel />
      <SupportersPanel />
      <DesktopUpdatePanel />
      <AntiSpamPanel />
      <BannedWordsPanel />
      <BansPanel />
      <EvalPanel />
    </div>
  );
}
