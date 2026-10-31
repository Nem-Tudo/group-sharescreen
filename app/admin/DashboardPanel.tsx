"use client";

import { StatsOverview } from "./StatsOverview";
import { StreamStatsPanel } from "./StreamStatsPanel";
import { ConnectionQualityPanel } from "./ConnectionQualityPanel";
import { CloudflareTurnPanel } from "./CloudflareTurnPanel";
import { AnnouncementPanel } from "./AnnouncementPanel";
import { PartnerAdsPanel } from "./PartnerAdsPanel";
import { AffiliateProductsPanel } from "./AffiliateProductsPanel";
import { PartnerOrdersPanel } from "./PartnerOrdersPanel";
import { MonetagPanel } from "./MonetagPanel";
import { GrantPremiumPanel } from "./GrantPremiumPanel";
import { GiftPanel } from "./GiftPanel";
import { CancellationsPanel } from "./CancellationsPanel";
import { AccountFlagsPanel } from "./AccountFlagsPanel";
import { AccountUsernamePanel } from "./AccountUsernamePanel";
import { BadgesAdminPanel } from "./BadgesAdminPanel";
import { AccountPointsPanel } from "./AccountPointsPanel";
import { AutoFlagsPanel } from "./AutoFlagsPanel";
import { AntiSpamPanel } from "./AntiSpamPanel";
import { BannedWordsPanel } from "./BannedWordsPanel";
import { BansPanel } from "./BansPanel";
import { ThemeModerationPanel } from "./ThemeModerationPanel";
import { SupportersPanel } from "./SupportersPanel";
import { DesktopUpdatePanel } from "./DesktopUpdatePanel";
import { EvalPanel } from "./EvalPanel";
import { GroupsPanel } from "./GroupsPanel";
import { BotsPanel } from "./BotsPanel";
import { ReservedInvitesPanel } from "./ReservedInvitesPanel";
import { FeaturesPanel } from "./FeaturesPanel";
import { EventPromosPanel } from "./EventPromosPanel";
import { translate } from "@/lib/i18n";
import type { AdminPermission } from "@/lib/adminPermissions";

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
//
// Each panel is drawn only for an admin holding its permission (see
// lib/adminPermissions.ts), and a tab with nothing to draw is left out of the
// bar — `needs` is the union of what its panels ask for. The API enforces the
// same permissions; this only avoids drawing panels that would be refused.

function Group({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col gap-6">{children}</div>;
}

/** Whether the viewer holds any of these permissions. */
export type AdminCan = (...permissions: AdminPermission[]) => boolean;

export interface AdminSection {
  id: string;
  label: string;
  /** The tab shows when the viewer holds any of these. */
  needs: AdminPermission[];
  Panel: (props: { can: AdminCan }) => React.ReactElement;
}

export const ADMIN_SECTIONS: AdminSection[] = [
  {
    id: "overview",
    get label() { return translate("common.overview"); },
    needs: ["stats"],
    Panel: () => (
      <Group>
        <StatsOverview />
      </Group>
    ),
  },
  {
    id: "broadcast",
    get label() { return translate("common.broadcast"); },
    needs: ["stats"],
    Panel: () => (
      <Group>
        <StreamStatsPanel />
      </Group>
    ),
  },
  {
    id: "quality",
    get label() { return translate("admin.dashboardPanel.connectionQuality"); },
    needs: ["turn", "stats"],
    Panel: ({ can }) => (
      <Group>
        {/* Above the numbers: when the numbers say Cloudflare's network is
            the problem (or its bill is), this is what gets reached for. */}
        {can("turn") && <CloudflareTurnPanel />}
        {can("stats") && <ConnectionQualityPanel />}
      </Group>
    ),
  },
  {
    id: "users",
    get label() { return translate("admin.dashboardPanel.users"); },
    needs: [
      "premium_grant",
      "gifts",
      "test_gifts",
      "cancellations",
      "account_flags",
      "badges",
      "usernames",
      "points",
      "auto_flags",
    ],
    Panel: ({ can }) => (
      <Group>
        {/* Ordered by how often they are reached for: comping a plan and
            editing flags are the errands, the rules panel is the one you set
            up once and revisit rarely. */}
        {can("premium_grant") && <GrantPremiumPanel />}
        {/* Directly under it: the same decision — which plan, how long —
            asked when there is nobody to aim it at yet. Normal and test gifts
            are separate permissions; the panel draws what the viewer may do. */}
        {can("gifts", "test_gifts") && (
          <GiftPanel canGifts={can("gifts")} canTestGifts={can("test_gifts")} />
        )}
        {/* Still about paying accounts, and the one panel here that is read
            rather than used: what the people who stopped paying said on their
            way out. */}
        {can("cancellations") && <CancellationsPanel />}
        {can("account_flags") && <AccountFlagsPanel />}
        {/* Next to the flags: most badges are given by one. */}
        {can("badges") && <BadgesAdminPanel />}
        {can("usernames") && <AccountUsernamePanel />}
        {can("points") && <AccountPointsPanel />}
        {can("auto_flags") && <AutoFlagsPanel />}
      </Group>
    ),
  },
  {
    id: "groups",
    get label() { return translate("common.groups"); },
    needs: ["groups"],
    Panel: () => (
      <div className="flex flex-col gap-4">
        <GroupsPanel />
        {/* The names no group may take as its link — edited once in a while,
            so under the day-to-day work on groups. */}
        <ReservedInvitesPanel />
      </div>
    ),
  },
  {
    id: "bots",
    get label() { return translate("admin.dashboardPanel.bots"); },
    needs: ["bots"],
    Panel: () => (
      <Group>
        <BotsPanel />
      </Group>
    ),
  },
  {
    id: "moderation",
    get label() { return translate("admin.dashboardPanel.moderation"); },
    needs: ["bans", "themes", "banned_words", "antispam", "eval"],
    Panel: ({ can }) => (
      <Group>
        {can("bans") && <BansPanel />}
        {/* Under the bans, because it is one: content taken down and a person
            stopped from posting more, just scoped to themes. */}
        {can("themes") && <ThemeModerationPanel />}
        {can("banned_words") && <BannedWordsPanel />}
        {can("antispam") && <AntiSpamPanel />}
        {can("eval") && <EvalPanel />}
      </Group>
    ),
  },
  {
    // Rollouts and A/B tests. Its own tab rather than under "Site": it is
    // aimed at users, rooms and groups alike, and it is where a launch is
    // watched day by day.
    id: "features",
    get label() { return translate("admin.dashboardPanel.features"); },
    needs: ["features"],
    Panel: () => (
      <Group>
        <FeaturesPanel />
      </Group>
    ),
  },
  {
    id: "site",
    get label() { return translate("admin.dashboardPanel.site"); },
    needs: ["announcement", "supporters", "desktop_update"],
    Panel: ({ can }) => (
      <Group>
        {can("announcement") && <AnnouncementPanel />}
        {can("supporters") && <SupportersPanel />}
        {can("desktop_update") && <DesktopUpdatePanel />}
      </Group>
    ),
  },
  {
    // The "acontecendo agora" card in a corner of every page. Its own tab:
    // it is touched on the day of an event, often several times, and goes
    // live the moment it is saved.
    id: "events",
    get label() { return translate("admin.dashboardPanel.events"); },
    needs: ["event_promos"],
    Panel: () => (
      <Group>
        <EventPromosPanel />
      </Group>
    ),
  },
  {
    id: "ads",
    get label() { return translate("admin.dashboardPanel.ads"); },
    needs: ["ads"],
    Panel: () => (
      <Group>
        <PartnerOrdersPanel />
        <PartnerAdsPanel />
        <AffiliateProductsPanel />
        <MonetagPanel />
      </Group>
    ),
  },
];
