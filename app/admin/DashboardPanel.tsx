"use client";

import { StatsOverview } from "./StatsOverview";
import { StreamStatsPanel } from "./StreamStatsPanel";
import { AnnouncementPanel } from "./AnnouncementPanel";
import { PartnerAdsPanel } from "./PartnerAdsPanel";
import { AdsterraPanel } from "./AdsterraPanel";
import { GrantPremiumPanel } from "./GrantPremiumPanel";
import { GiftPanel } from "./GiftPanel";
import { AccountFlagsPanel } from "./AccountFlagsPanel";
import { AccountPointsPanel } from "./AccountPointsPanel";
import { AutoFlagsPanel } from "./AutoFlagsPanel";
import { AntiSpamPanel } from "./AntiSpamPanel";
import { BannedWordsPanel } from "./BannedWordsPanel";
import { BansPanel } from "./BansPanel";
import { ThemeModerationPanel } from "./ThemeModerationPanel";
import { SupportersPanel } from "./SupportersPanel";
import { DesktopUpdatePanel } from "./DesktopUpdatePanel";
import { EvalPanel } from "./EvalPanel";

// The admin area, in sections.
//
// It was one column of thirteen panels, which meant every visit began by
// scrolling past twelve things to reach the one you came for — and the panels
// that get used weekly sat below the ones nobody touches for months.
//
// Grouped by the question being asked rather than by what the panel talks to:
// "I need to deal with a person" and "I need to change what the site says"
// are different errands, and they were interleaved.
//
// The list is exported so the page's tabs are generated from it. A new panel
// is one entry in one group here, and the tab bar follows on its own.

function Group({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col gap-6">{children}</div>;
}

export interface AdminSection {
  id: string;
  label: string;
  Panel: () => React.ReactElement;
}

export const ADMIN_SECTIONS: AdminSection[] = [
  {
    id: "visao",
    label: "Visão geral",
    Panel: () => (
      <Group>
        <StatsOverview />
      </Group>
    ),
  },
  {
    id: "transmissao",
    label: "Transmissão",
    Panel: () => (
      <Group>
        <StreamStatsPanel />
      </Group>
    ),
  },
  {
    id: "usuarios",
    label: "Usuários",
    Panel: () => (
      <Group>
        {/* Ordered by how often they are reached for: comping a plan and
            editing flags are the errands, the rules panel is the one you set
            up once and revisit rarely. */}
        <GrantPremiumPanel />
        {/* Directly under it: the same decision — which plan, how long —
            asked when there is nobody to aim it at yet. */}
        <GiftPanel />
        <AccountFlagsPanel />
        <AccountPointsPanel />
        <AutoFlagsPanel />
      </Group>
    ),
  },
  {
    id: "moderacao",
    label: "Moderação",
    Panel: () => (
      <Group>
        <BansPanel />
        {/* Under the bans, because it is one: content taken down and a person
            stopped from posting more, just scoped to themes. */}
        <ThemeModerationPanel />
        <BannedWordsPanel />
        <AntiSpamPanel />
        <EvalPanel />
      </Group>
    ),
  },
  {
    id: "site",
    label: "Site",
    Panel: () => (
      <Group>
        <AnnouncementPanel />
        <SupportersPanel />
        <DesktopUpdatePanel />
      </Group>
    ),
  },
  {
    id: "anuncios",
    label: "Anúncios",
    Panel: () => (
      <Group>
        <PartnerAdsPanel />
        <AdsterraPanel />
      </Group>
    ),
  },
];
