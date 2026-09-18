"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  MdArrowUpward,
  MdCardGiftcard,
  MdCheck,
  MdClose,
  MdExpandMore,
  MdLock,
  MdAttachFile,
  MdOpenInNew,
} from "react-icons/md";
import Link from "next/link";
import { BsCoin, BsStars } from "react-icons/bs";
// No wrapperClassName: Tippy then attaches straight to the <li>, keeping the
// list a plain <ul><li> instead of nesting a <span> between them.
import { Tooltip } from "@/components/Tooltip";
import { PixIcon } from "@/components/icons";
import { planIcon } from "@/components/planIcons";
import { EARLY_SUPPORTER_CUTOFF_MS } from "@/lib/badges";
import type { BillingCycle } from "@/lib/premiumApi";
import { useAuth } from "@/lib/AuthContext";
import { AccountModal, type AccountModalMode } from "@/components/AccountModal";
import { CancelSurveyDialog } from "@/components/CancelSurveyDialog";
import { PixChargeModal } from "@/components/PixChargeModal";
import useNtPopups from "ntpopups";
import { isIosDevice, isStandaloneDisplay } from "@/lib/browserEnv";
import { getDesktopBridge } from "@/lib/desktop";
import { accountTierOf, planTierOf, tierAbove, tierAtLeast, type Feature } from "@/lib/entitlements";
import { PUBLISHED_THEME_LIMITS } from "@/lib/roomThemes";
import {
  cancelPremium,
  type CancelSurvey,
  fetchPremiumPlans,
  fetchPremiumStatus,
  fetchUpgradeQuote,
  isPremiumActive,
  startPixPayment,
  startPremiumCheckout,
  startUpgradePix,
  startUpgradeSchedule,
  type PixCharge,
  type PremiumPlan,
  type UpgradeQuote,
  RECOMMENDED_PLAN_ID,
} from "@/lib/premiumApi";
import { useT } from "@/lib/useI18n";
import { trackFeatureEvent, useFeature } from "@/lib/features";
import { PlanComparison, PRO_COMPARE_BUY_TOP, PRO_COMPARE_FEATURE, type ComparisonRow } from "./PlanComparison";
import { translate } from "@/lib/i18n";
import { formatLocale } from "@/lib/i18n";

// The Pro subscription page: what it costs, what it unlocks, and the one
// button that starts or stops it.
//
// The product is called "Pro" on screen and "premium" in storage — the plan
// id, the account field, the feature tiers and the API routes all still say
// premium. That split is deliberate: a name shown to people is a marketing
// decision that can change again, while those others are a document in a
// database, a column other rows point at, and a URL Mercado Pago has on file
// for every existing subscription. Renaming them would be a migration, not a
// rename.
//
// Everything shown here is read from the API. In particular the price is not
// written anywhere in this file — it comes from the plan document in the
// database (see the API's premiumPlan.ts), which is the whole point of that
// document: changing what premium costs is an edit to one row, and every
// surface that quotes a price follows.

/** An upload limit in MiB, as people say it: "100 MB", or "1 GB" from 1024 up. */
function formatUploadLimit(mb: number): string {
  if (mb >= 1024 && mb % 1024 === 0) return `${mb / 1024} GB`;
  return `${mb} MB`;
}

// What each entitlement is called in front of a person. Keys come from
// lib/entitlements.ts; a feature with no entry here still counts and is
// simply not listed, which is the right behaviour for a client that predates
// a perk the server already grants.
// Every gated feature needs a line here, and the failure when one is missing
// is silent: the row below drops anything it cannot name, so a perk the plan
// really grants simply never appears on the page selling it. That is what
// happened to the two avatar features — added to the ladder, never given a
// sentence.
const FEATURE_LABELS: Partial<Record<Feature, string>> = {
  get verified_badge() { return translate("pro.proPanel.beVerifiedAndGetAnAuthenticity"); },
  get quality_2160p() { return translate("pro.proPanel.broadcastInUpTo4k2160p"); },
  get quality_1440p() { return translate("pro.proPanel.broadcastIn2k1440p"); },
  get fps_120() { return translate("pro.proPanel.upTo240FramesPerSecond"); },
  get bitrate_maximo() { return translate("pro.proPanel.bitrateOfUpTo32Mbps"); },
  get no_ads() { return translate("pro.proPanel.browseWithNoAds"); },
  get avatar_gallery() { return translate("pro.proPanel.exclusiveAvatarsForYourProfilePicture"); },
  get avatar_upload() { return translate("pro.proPanel.useAnyImageOfYoursAs"); },
  get avatar_shape() { return translate("pro.proPanel.chooseYourAvatarShape"); },
  get banner_upload() { return translate("pro.proPanel.uploadYourOwnProfileBanner"); },
  get profile_gradient() { return translate("pro.proPanel.chooseYourProfileSBackgroundColours"); },
  get profile_song() { return translate("pro.proPanel.putASongOnYourProfile"); },
  get profile_group() { return translate("pro.proPanel.showAGroupOnYourProfile"); },
  get profile_links() { return translate("pro.proPanel.linkYourSocialNetworksOnYour"); },
  get room_theme() { return translate("pro.proPanel.createThemesAndGiveRoomsYour"); },
  get room_theme_publish() { return translate("pro.proPanel.publishYourThemesOnDiscoverFor"); },
  get room_theme_set() { return translate("pro.proPanel.changeTheThemeOfAnyRoom"); },
  get uncapped_relay() { return translate("pro.proPanel.noQualityLimitOnRelayedConnections"); },
  get force_relay() { return translate("pro.proPanel.hideYourIpFromEveryoneInA"); },
  get room_theme_gradient() { return translate("pro.proPanel.useAGradientInYourThemes"); },
};

// The perks about the broadcast itself — what GoLive is for — which the
// comparison table lists before everything else.
const BROADCAST_FEATURES = new Set<Feature>([
  "quality_2160p",
  "quality_1440p",
  "fps_120",
  "bitrate_maximo",
  "uncapped_relay",
  "force_relay",
]);

function periodEndLabel(timestamp: number): string {
  try {
    return new Date(timestamp).toLocaleDateString(formatLocale(), {
      day: "2-digit",
      month: "long",
      year: "numeric",
    });
  } catch {
    return "—";
  }
}

/**
 * Whether the checkout has to replace this page instead of opening beside it.
 *
 * True on iOS and in any installed PWA, and the reason is not a preference:
 * on those the second window is where the payment goes to die.
 *
 *   - iOS Safari switches to a new tab the moment it is created, so the blank
 *     placeholder this used to open became the *foreground* tab while the
 *     checkout URL was still being fetched. Assigning a cross-origin URL to
 *     that backgrounded opener-owned tab afterwards is unreliable there, and
 *     iOS discards background tabs under memory pressure — which is exactly
 *     what somebody sees as "the button did nothing and the page reloaded":
 *     the blank tab never navigated, and coming back reloaded this one.
 *   - a standalone PWA has no tab strip at all. `window.open` hands the URL to
 *     the default browser as a separate app, and returning to the installed
 *     window restarts it from its start URL — the same reload, for the same
 *     reason.
 *
 * Navigating in place costs nothing here: the checkout is a full-page flow at
 * Mercado Pago and its back_url points at this very page (see the API's
 * premiumRoutes.ts), so the person lands back on /pro either way — and the
 * status sync on mount is what turns that arrival into an active subscription.
 */
function checkoutMustReplacePage(): boolean {
  return isIosDevice() || isStandaloneDisplay();
}

/**
 * Points an already-open tab at `url`, reporting whether it took.
 *
 * Guarded because this is the one step that can fail silently: a browser that
 * decides the placeholder is no longer ours to steer throws a SecurityError,
 * and an unguarded throw here would leave the button spun down with nothing
 * open and nothing said. The caller falls back to navigating in place.
 */
function navigateTab(tab: Window, url: string): boolean {
  try {
    tab.location.href = url;
    return true;
  } catch {
    return false;
  }
}

/**
 * How much more Pix costs than subscribing, for one cycle — the whole percent,
 * rounded, or 0 when Pix is not dearer. Per cycle because both sides scale
 * together (a year is ten months of each), so this is the same number somebody
 * would get dividing the two labels on the buttons.
 */
function pixSurcharge(pricing: { priceCents: number; pixPriceCents: number } | null): number {
  if (!pricing || pricing.priceCents <= 0 || pricing.pixPriceCents <= pricing.priceCents) return 0;
  return Math.round(((pricing.pixPriceCents - pricing.priceCents) / pricing.priceCents) * 100);
}

/** The nudge towards subscribing, shown only when Pix is priced above it. */
function PixSurchargeNotice({
  percent,
  priceLabel,
  pixPriceLabel,
  yearly,
}: {
  percent: number;
  priceLabel: string;
  pixPriceLabel: string;
  yearly: boolean;
}) {
  const t = useT();
  return (
    <p className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs text-emerald-900 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-200">
      {t("pro.proPanel.subscriptionIsCheaperThanPix", {
        percent,
        price: `${priceLabel}${yearly ? "/ano" : t("pro.proPanel.month2")}`,
        pix: pixPriceLabel,
      })}
    </p>
  );
}

export function ProPanel({
  isModal = false,
  initialPlanId,
  onClose,
  onCheckoutLockChange,
}: {
  isModal?: boolean;
  /**
   * Which plan to open on, when whatever opened this knows. Beats the URL,
   * and it has to: inside a room the address bar is the room's, so a modal
   * has no query string of its own to read.
   */
  initialPlanId?: string;
  onClose?: () => void;
  /**
   * Told while a payment is being created, for the dialog around this panel
   * (see ProModal): `locked` means it must not close, `shake` that it should
   * tremble. Two answers because they differ in one case — a new Pix code
   * requested from inside the Pix dialog, which shakes itself, and which sits
   * inside the dialog around this panel: shaking that one too would move the
   * Pix dialog out from under the person (see ProModal).
   */
  onCheckoutLockChange?: (lock: { locked: boolean; shake: boolean }) => void;
} = {}) {
  const t = useT();
  const { account, loading: resolvingAccount, refresh } = useAuth();
  // Read once, in an initializer: Date.now() during render is an impure call
  // and React 19 rejects it. A deadline this far out does not need to tick —
  // a page open across midnight on the 18th is not the case worth the extra
  // machinery.
  const [earlySupporterOpen] = useState(() => Date.now() < EARLY_SUPPORTER_CUTOFF_MS);
  const [cycle, setCycle] = useState<BillingCycle>("monthly");
  const [plans, setPlans] = useState<PremiumPlan[]>([]);
  // Which plan the page opens on, when whatever linked here named one:
  // /pro?plan=premium_max is where the header sends somebody who already has
  // Pro, and landing them on the cheapest plan would be answering "what is
  // above what I pay for?" with the thing they already bought.
  //
  // Read from the URL once, in an initializer, rather than through
  // useSearchParams: this component also renders inside a dialog (see
  // ProModal) where there is no route to read, and that hook would pull a
  // Suspense boundary into a page with no other reason for one. It costs
  // nothing at hydration because `plans` is empty on the first render either
  // way — the markup below is the "Carregando o plano…" line until the list
  // lands, so the server and the client agree about what is on screen.
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(() => {
    if (initialPlanId) return initialPlanId;
    if (typeof window === "undefined") return null;
    const params = new URLSearchParams(window.location.search);
    // "plano" is the name this parameter had while the site was Portuguese
    // only. It is read here rather than redirected in next.config because a
    // redirect forwards the original query along with the rewritten one, so
    // the rule would keep matching its own output and loop. Links carrying it
    // are still in the wild — the header's "Pro Max" entry point used it.
    return params.get("plan") ?? params.get("plano");
  });
  // "Presentear" is a popup owned by the library rather than markup on this
  // page, which is what lets it be offered from every state below — and what
  // keeps it working when this panel is itself inside a dialog (see ProModal,
  // whose blur would otherwise trap a dialog rendered in here).
  const { openPopup } = useNtPopups();
  // Derived, not stored. Keeping a second copy of the chosen plan in state
  // would need an effect to follow the list, and the whole page below reads
  // `plan` — one of the two would eventually be a render behind the other.
  const plan =
    plans.find((entry) => entry.id === selectedPlanId) ?? plans[0] ?? null;
  /**
   * The prices for the cycle on screen, from the API.
   *
   * Falls back to the plan's own monthly figures when the API predates
   * cycles, so an older deployment renders exactly as it did before rather
   * than showing nothing.
   */
  const pricing =
    plan?.cycles?.find((entry) => entry.cycle === cycle) ??
    (plan
      ? {
          cycle: "monthly" as BillingCycle,
          priceCents: plan.priceCents,
          priceLabel: plan.priceLabel,
          pixPriceCents: plan.pixPriceCents,
          pixPriceLabel: plan.pixPriceLabel,
          fullPriceCents: null,
          fullPriceLabel: null,
          discountPercent: 0,
          monthlyEquivalentLabel: plan.priceLabel,
          periodDays: 30,
        }
      : null);
  const pixSurchargePercent = pixSurcharge(pricing);
  const [loadingPlan, setLoadingPlan] = useState(true);
  // The comparison-table experiment (see PlanComparison). Nothing plan-shaped
  // is drawn until it is decided, so nobody sees one layout flip to the other.
  const compare = useFeature(PRO_COMPARE_FEATURE);
  const compareLayout = compare.enabled && plans.length > 1;
  // The "buy-top" treatment: the price and checkout card above the table.
  const buyOnTop = compare.variant === PRO_COMPARE_BUY_TOP;
  const selectPlan = useCallback((planId: string) => {
    setSelectedPlanId(planId);
    trackFeatureEvent("pro_plan_click");
  }, []);
  // Where the table's "Assinar" buttons send the person: the price and the
  // checkout for the plan they just picked.
  const checkoutCardRef = useRef<HTMLDivElement>(null);
  const buyPlan = useCallback(
    (planId: string) => {
      selectPlan(planId);
      requestAnimationFrame(() =>
        checkoutCardRef.current?.scrollIntoView({ behavior: "smooth", block: "center" })
      );
    },
    [selectPlan]
  );
  // The plan to steer toward: Pro Max, unless the account already has it —
  // then the one above it, and nothing once they are at the top.
  const accountTier = accountTierOf(account?.flags);
  const recommendedPlanId = tierAtLeast(accountTier, "pro_ultra")
    ? null
    : tierAtLeast(accountTier, "premium_max")
      ? plans.find((entry) => planTierOf(entry.id) === "pro_ultra")?.id ?? null
      : RECOMMENDED_PLAN_ID;
  const [busy, setBusy] = useState(false);
  // A payment is being created right now — the card checkout or a Pix code.
  // Narrower than `busy`, which also covers cancelling: that one is not a
  // charge in flight, and nothing about it needs the dialog held open.
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Only ever shown after the API asks for it — an account created through
  // Discord or Google already has an address on file, which is most of them,
  // and putting a form in front of everybody to serve the minority would be a
  // step added to the common path for nothing.
  const [needsEmail, setNeedsEmail] = useState(false);
  const [email, setEmail] = useState("");
  // The payer's CPF or CNPJ, on exactly the same terms as the address above
  // and for the same reason: some Pix charges need one and most do not (it
  // depends on the provider and on the seller's own account — see the API's
  // pixFailure), so it appears when a charge has actually been refused for
  // want of it, and never before.
  const [needsTaxId, setNeedsTaxId] = useState(false);
  const [taxId, setTaxId] = useState("");
  // Cancelling is a dialog now, not a button: four questions, all required,
  // and then the confirmation — see CancelSurveyDialog for why the friction is
  // deliberate and why it is not a retention wall.
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  // The checkout that is open somewhere else right now, or null. Holding the
  // URL rather than a boolean is what lets the indicator offer to reopen it:
  // the window is easy to lose behind this one, and starting over would mint
  // a second preapproval for a subscription already waiting to be paid.
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);
  // The tab handle, when there is one — a browser gives us one, a shell
  // handing the URL to an external browser does not. Its only use is noticing
  // that the window was closed; see the poll below.
  const checkoutTabRef = useRef<Window | null>(null);
  // The sign-in dialog, opened from the gate below. A dialog rather than a
  // link home: somebody who got here, read the price and decided to buy has
  // already chosen — sending them to another page to find a form is asking
  // them to choose again, on a screen that no longer mentions premium.
  const [accountModal, setAccountModal] = useState<AccountModalMode | null>(null);
  // The Pix charge waiting to be paid, or null. Held in state rather than
  // navigated to, because unlike the card checkout this one is paid in
  // another app entirely — the page's job is to show a code and notice when
  // the money lands.
  const [pix, setPix] = useState<PixCharge | null>(null);
  // Where the paid period ended at the moment the code above was created.
  // This is what tells a *paid* charge from an account that simply already
  // had access: renewing is bought by somebody for whom `active` is true
  // before, during and after the payment, so `active` alone would call every
  // renewal confirmed the instant its QR appeared — which is precisely how
  // the old inline block managed to render nothing at all for a renewal.
  const [pixBaselineEnd, setPixBaselineEnd] = useState(0);

  // What moving to the plan on screen would cost right now, mid-cycle — a
  // prorated top-up, not the plan's own price. Fetched fresh whenever the
  // plan on screen changes, since it depends on both plans and on how many
  // days are left, none of which this component may assume are still what
  // they were the last time it asked.
  const [upgradeQuote, setUpgradeQuote] = useState<UpgradeQuote | null>(null);
  // Whether the collapsed upgrade header has been opened. Closed by default:
  // most people opening this page are not mid-upgrade, and a card of price
  // breakdowns nobody asked to see yet is exactly the clutter a one-line
  // header avoids.
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  // A future-dated mandate is being scheduled right now — see
  // handleScheduleUpgrade. Its own flag rather than reusing `busy`: that one
  // drives the Pix dialog's shake behaviour (see onCheckoutLockChange), which
  // has nothing to do with this button.
  const [scheduling, setScheduling] = useState(false);
  // The Pix charge for an upgrade top-up, held apart from `pix` above: the
  // two settle completely differently (see the API's syncUpgradePayment),
  // and `pixPaid`'s test — `currentPeriodEnd` moving — is never true for an
  // upgrade, since the whole point of a top-up is that it does not move.
  const [upgradePix, setUpgradePix] = useState<(PixCharge & { remainingDays: number }) | null>(null);

  // Resolved before the plan loads too — planIcon falls back to the default
  // mark, so the heading never renders a hole while the request is in flight.
  //
  // The component comes straight off the registry rather than being wrapped
  // in one declared here: a component built during render is a new type on
  // every render, which throws away whatever state it held.
  const mark = planIcon(plan?.iconId);
  const PlanMark = mark.Icon;

  const premium = account?.premium ?? null;
  const active = isPremiumActive(premium);
  const cancelled = premium?.status === "cancelled";
  const viaPix = premium?.method === "pix";
  // Subscribed *to the plan currently on screen*. The page used to ask only
  // "is this person premium", which meant opening the other plan showed the
  // "you already have this" panel — with a renew button quoting a price for
  // something they had never bought.
  const activeHere = active && premium?.plan === plan?.id;
  // A card mandate that is still charging. Used for one thing only: there is
  // nothing to sell somebody on the plan they are already subscribed to by
  // card, so that state shows the status and the way out instead of two
  // payment buttons. Switching *to another plan* is offered freely — the API
  // ends the old mandate when the new payment lands.
  const liveCardSub = active && !viaPix && !cancelled;

  // Whether the plan on screen is a genuine step up from the one this account
  // already has time left on. Never true for a downgrade or a same-tier
  // switch — those already take effect at the next renewal without a charge,
  // through the ordinary "assinar"/"pix" buttons below, and topping them up
  // would be charging for nothing.
  const canUpgrade = Boolean(
    active && !activeHere && premium && plan && tierAbove(planTierOf(plan.id), planTierOf(premium.plan))
  );
  /** The upgrade charge on screen has not been paid yet. */
  const upgradePending = Boolean(upgradePix) && premium?.lastPaymentId !== upgradePix?.paymentId;
  /** The money for the upgrade charge on screen has landed. */
  const upgradePaid = Boolean(upgradePix) && premium?.lastPaymentId === upgradePix?.paymentId;

  // Every benefit any plan sells, in one fixed order — FEATURE_LABELS's.
  //
  // Not grouped into "included" then "missing", which was tried and was
  // wrong: how many rows land in each group depends on the plan, so every row
  // after them moved when you switched plans, and the points rows moved most
  // of all. A single order means a benefit sits at the same height on every
  // card, which is what makes two cards comparable at a glance.
  const sellableFeatures = (Object.keys(FEATURE_LABELS) as Feature[]).filter((feature) =>
    plans.some((entry) => entry.features.includes(feature))
  );

  // Where the points rows sit: directly under this benefit, on every plan.
  //
  // Anchored to a benefit rather than to a position, because a position moves
  // the moment the label table is reordered — and pinning them to the end
  // moved them whenever a plan included a different number of perks.
  const POINTS_AFTER: Feature = "avatar_gallery";

  /**
   * The benefit's sentence on this particular card.
   *
   * Almost every perk reads the same on every plan, so FEATURE_LABELS is one
   * fixed table. Publishing themes is the exception: both paying rungs have
   * it and they differ by a number (ten against a hundred), and a row that
   * only said "publique seus temas" would hide the very difference somebody
   * comparing the two cards is looking for. Only the plans that include it
   * get the number — on a card where the row is a ✕ it would read as an offer.
   */
  const featureLabel = (feature: Feature, entry: PremiumPlan | null, included: boolean): string | undefined => {
    if (feature === "room_theme_publish" && entry && included) {
      const limit = PUBLISHED_THEME_LIMITS[planTierOf(entry.id) as keyof typeof PUBLISHED_THEME_LIMITS];
      if (limit) return t("pro.proPanel.publishThemesWithLimit", { limit });
    }
    return FEATURE_LABELS[feature];
  };

  // One row of the benefits list.
  const featureRow = (feature: Feature, included: boolean, entry: PremiumPlan | null = null) => {
    const label = featureLabel(feature, entry, included);
    if (!label) return null;
    const row = (
      <li
        key={feature}
        className={`flex items-center gap-2 text-sm ${
          included ? "text-zinc-700 dark:text-zinc-300" : "text-zinc-400 dark:text-zinc-600"
        }`}
      >
        {included ? (
          <MdCheck className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-500" />
        ) : (
          <MdClose className="h-4 w-4 shrink-0" />
        )}
        {/* The badge perk shows the badge. Between the tick and the words
            rather than replacing the tick: the tick is the list's bullet and
            every row keeps one. */}
        {feature === "verified_badge" && included && (
          <PlanMark className={`-mr-0.5 h-4 w-4 shrink-0 ${mark.className}`} />
        )}
        {label}
      </li>
    );
    // Only the missing rows carry the tooltip: on an included one it would be
    // a hover target that says nothing. The key sits on whichever element
    // ends up in the array — the row, or the Tooltip around it.
    //
    // The whole row is the hover target, but "top-start" aligns the balloon
    // with the row's leading edge — which is where the ✕ sits, since it is
    // the list's bullet. So it reads as belonging to the mark that raised the
    // question, while still being findable by pointing anywhere at the line.
    return included ? (
      row
    ) : (
      <Tooltip key={feature} content={t("pro.proPanel.availableOnAnotherPlan")} placement="top-start">
        {row}
      </Tooltip>
    );
  };

  // The points, which are not features and deliberately not in the table
  // above: `features` is the entitlement list — what the server decides an
  // account may *do* — and points are not a permission, they are a payout.
  // The numbers come from the API (see the plan route), so they cannot drift
  // from what is actually credited.
  const pointsRows = (entry: PremiumPlan) =>
    [
      entry.purchasePoints > 0 ? (
        <li
          key="purchase-points"
          className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300"
        >
          <MdCheck className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-500" />
          {/* The coin, in the same place the verified perk shows its badge —
              between the tick and the words, so the tick stays the bullet
              every row has. Same mark the profile page uses for a balance. */}
          <BsCoin className="-mr-0.5 h-4 w-4 shrink-0 text-amber-500" />
          {entry.purchasePoints} pontos na hora, a cada pagamento
        </li>
      ) : null,
      entry.dailyPoints > 0 ? (
        <li
          key="daily-points"
          className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300"
        >
          <MdCheck className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-500" />
          <BsCoin className="-mr-0.5 h-4 w-4 shrink-0 text-amber-500" />
          {t("pro.proPanel.more")} {entry.dailyPoints} pontos por dia de assinatura
        </li>
      ) : null,
    ].filter(Boolean);

  // The upload limit, which is not a feature for the same reason the points
  // are not: `features` says what an account may *do*, and this is a number
  // on the plan's document (uploadLimitMb). Quoted from the API, so editing
  // the document changes the page with no deploy.
  const uploadRow = (entry: PremiumPlan) =>
    typeof entry.uploadLimitMb === "number" && entry.uploadLimitMb > 0 ? (
      <li key="upload-limit" className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
        <MdCheck className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-500" />
        <MdAttachFile className="-mr-0.5 h-4 w-4 shrink-0 text-zinc-500 dark:text-zinc-400" />
        {t("pro.proPanel.sendFilesOfUpToValue", { value: formatUploadLimit(entry.uploadLimitMb) })}
      </li>
    ) : null;

  /** The whole list, in order, with the points and the upload limit slotted in at their anchor. */
  /**
   * The same benefits as featureRows, one row per benefit with a cell per
   * plan — for the comparison table experiment (PlanComparison).
   */
  const comparisonRows = (): ComparisonRow[] => {
    const cyclePrice = (entry: PremiumPlan) =>
      `${entry.cycles?.find((c) => c.cycle === cycle)?.priceLabel ?? entry.priceLabel}${
        cycle === "yearly" ? " / ano" : t("pro.proPanel.month")
      }`;
    const amount = (value: number, label = String(value), icon?: ReactNode) => ({ amount: value, label, icon });
    // The same coin the benefit list and the profile use for a balance.
    const points = (value: number) =>
      amount(value, String(value), <BsCoin className="h-3.5 w-3.5 shrink-0 text-amber-500" />);
    const rows: ComparisonRow[] = [
      {
        key: "price",
        label: t("pro.compare.price"),
        pinned: true,
        cells: plans.map((entry) => amount(entry.priceCents, cyclePrice(entry))),
      },
    ];
    const extras = (): ComparisonRow[] => [
      {
        key: "purchase-points",
        label: t("pro.compare.pointsOnPurchase"),
        cells: plans.map((entry) => (entry.purchasePoints > 0 ? points(entry.purchasePoints) : false)),
      },
      {
        key: "daily-points",
        after: "purchase-points",
        label: t("pro.compare.pointsPerDay"),
        cells: plans.map((entry) => (entry.dailyPoints > 0 ? points(entry.dailyPoints) : false)),
      },
      {
        key: "upload-limit",
        label: t("pro.compare.uploadLimit"),
        cells: plans.map((entry) =>
          typeof entry.uploadLimitMb === "number" && entry.uploadLimitMb > 0
            ? amount(entry.uploadLimitMb, formatUploadLimit(entry.uploadLimitMb))
            : false
        ),
      },
    ];
    for (const feature of sellableFeatures) {
      const label = FEATURE_LABELS[feature];
      // "Up to 4K" already says 2K; the 2K row only earns its place on a plan
      // that has 2K without 4K.
      const redundant =
        feature === "quality_1440p" &&
        plans.every((entry) => !entry.features.includes("quality_1440p") || entry.features.includes("quality_2160p"));
      if (label && !redundant) {
        rows.push({
          key: feature,
          label,
          priority: BROADCAST_FEATURES.has(feature) ? 0 : 1,
          cells: plans.map((entry) => {
            const included = entry.features.includes(feature);
            // The one perk that differs by a number between paying rungs.
            if (feature === "room_theme_publish" && included) {
              const limit = PUBLISHED_THEME_LIMITS[planTierOf(entry.id) as keyof typeof PUBLISHED_THEME_LIMITS];
              if (limit) return amount(limit);
            }
            return included;
          }),
        });
      }
      if (feature === POINTS_AFTER) rows.push(...extras());
    }
    if (!sellableFeatures.includes(POINTS_AFTER)) rows.push(...extras());
    // A row every plan leaves empty says nothing in a comparison.
    return rows.filter((row) => row.cells.some((cell) => cell !== false));
  };

  const featureRows = (entry: PremiumPlan) => {
    const rows: ReactNode[] = [];
    for (const feature of sellableFeatures) {
      rows.push(featureRow(feature, entry.features.includes(feature), entry));
      if (feature === POINTS_AFTER) rows.push(...pointsRows(entry), uploadRow(entry));
    }
    // No plan sells the anchor benefit — these still have to appear.
    if (!sellableFeatures.includes(POINTS_AFTER)) rows.push(...pointsRows(entry), uploadRow(entry));
    return rows;
  };
  /** The money for the code on screen has landed and bought time. */
  const pixPaid = Boolean(pix) && active && (premium?.currentPeriodEnd ?? 0) > pixBaselineEnd;
  /** A Pix code on screen that has not been paid yet. */
  const pixPending = Boolean(pix) && !pixPaid;

  useEffect(() => {
    const controller = new AbortController();
    void fetchPremiumPlans(controller.signal).then((loaded) => {
      setPlans(loaded);
      setLoadingPlan(false);
    });
    return () => controller.abort();
  }, []);

  // Re-reads the subscription from its provider (through the API) and pulls
  // the account down again, so `features` and the copy below reflect it.
  //
  // Throttled, because the caller below is a focus handler: /premium/status
  // is not a cheap read — it makes the API ask the provider — and somebody
  // alt-tabbing between this page and the checkout would otherwise send a
  // request per switch. Five seconds is far shorter than any payment takes
  // and long enough that a burst of focus events costs one call.
  const lastSyncRef = useRef(0);
  const syncStatus = useCallback(
    // `force` is for the button somebody presses *because* they believe
    // something changed. Making them wait out a throttle they cannot see
    // would make the button look broken, which is the opposite of what a
    // "verificar agora" is for.
    async (force = false) => {
      if (!force && Date.now() - lastSyncRef.current < 5_000) return;
      lastSyncRef.current = Date.now();
      const status = await fetchPremiumStatus();
      if (status) await refresh();
    },
    [refresh]
  );

  // Two moments need this, and the second one is what makes the checkout
  // opening in its own tab work at all.
  //
  //   - on mount, because the browser may return to /premium before the
  //     Pago's webhook has landed; the page then corrects itself in a second
  //     instead of insisting the person is not subscribed.
  //   - when this tab is looked at again. The payment now happens somewhere
  //     else — another tab, or the system browser for the desktop and Android
  //     shells — and nothing here would otherwise ever hear that it worked.
  //     Coming back to this tab is the person asking "did it go through?",
  //     and it is the only signal available: there is no message from a tab on
  //     another origin, and none at all from an external browser.
  useEffect(() => {
    if (resolvingAccount || !account) return;
    void syncStatus();
    const onVisible = () => {
      if (document.visibilityState === "visible") void syncStatus();
    };
    document.addEventListener("visibilitychange", onVisible);
    // Both, because they are not the same event and each misses a case this
    // needs: switching back to a background tab fires visibilitychange and
    // not always focus, while returning from another *application* (the
    // system browser the shells use) fires focus with the tab already
    // visible.
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvingAccount, account?.id, syncStatus]);

  const handleSubscribe = useCallback(async () => {
    setBusy(true);
    setGenerating(true);
    setError(null);

    // The checkout leaves this page standing, and getting there is different
    // in each of the three places this app runs:
    //
    //   - in a shell (desktop or Android), `openExternal` hands the URL to the
    //     system browser or an in-app tab. It is what the OAuth login already
    //     does, and it is not optional: Electron *denies* window.open and
    //     redirects it (see electron/main.ts's setWindowOpenHandler), so the
    //     browser path below would open nothing at all there.
    //   - on iOS, or in an installed PWA, this page itself — a second window
    //     there is a window the payment never reaches; see
    //     checkoutMustReplacePage above for what that looks like to the person
    //     pressing the button.
    //   - in every other browser, a new tab.
    //
    // The tab is opened *now*, empty, while the click is still the reason
    // anything is happening. Opening it after the await instead would put it
    // outside the user gesture, which is exactly what a popup blocker exists
    // to stop — the request takes a round trip to the provider, so that window
    // is wide. Decided before the await for the same reason: on the platforms
    // above there must be no placeholder tab at all, and asking afterwards
    // would already have opened one.
    const bridge = getDesktopBridge();
    const replacePage = !bridge && checkoutMustReplacePage();
    const tab = bridge || replacePage ? null : window.open("", "_blank");

    const result = await startPremiumCheckout(email.trim() || undefined, plan?.id, cycle);
    if (!result.ok) {
      // The placeholder has no reason to exist any more, and leaving a blank
      // tab behind after a failure reads as a second thing having gone wrong.
      if (tab && !tab.closed) tab.close();
      setError(result.error);
      // Latched rather than toggled: once the API has said it needs an
      // address, the field stays on screen through a failed retry — hiding it
      // again would take away the very thing being corrected.
      if (result.needsEmail) setNeedsEmail(true);
      setBusy(false);
      setGenerating(false);
      return;
    }

    if (bridge?.openExternal) {
      void bridge.openExternal(result.checkoutUrl);
      setCheckoutUrl(result.checkoutUrl);
    } else if (tab && !tab.closed && navigateTab(tab, result.checkoutUrl)) {
      checkoutTabRef.current = tab;
      setCheckoutUrl(result.checkoutUrl);
    } else {
      // The placeholder was never opened (iOS, a PWA), was blocked, was closed
      // while the request was in flight, or refused the assignment. Navigating
      // in place is worse than a tab but far better than a button that did
      // nothing — and it is what this did before there was a tab at all.
      // No indicator here on purpose: this page is being replaced, so there
      // is nothing left to indicate anything to.
      if (tab && !tab.closed) tab.close();
      window.location.href = result.checkoutUrl;
      return;
    }

    // Not left spinning: this page is staying, and the button has to be
    // usable again — the checkout can be abandoned, and the "assinar" they
    // press next must not find a disabled control.
    setBusy(false);
    setGenerating(false);
    // plan?.id and not just `email`: this callback carries which plan to buy,
    // so a stale copy would open the checkout for whichever one was selected
    // when it was last created — i.e. switching plans and pressing subscribe
    // would charge for the previous one.
  }, [email, plan?.id, cycle]);

  // A closed checkout window is the clearest "they are done with it" signal
  // available — either they paid or they gave up, and both mean this page
  // should stop claiming a window is open. Polled because a cross-origin
  // window fires no event we can hear; `closed` is the one property still
  // readable across origins.
  //
  // Only ever runs in a browser: a shell handed the URL to an external
  // browser and has no handle, so there its indicator stays until the
  // subscription activates or the person dismisses it.
  useEffect(() => {
    if (!checkoutUrl) return;
    const tab = checkoutTabRef.current;
    if (!tab) return;
    const timer = setInterval(() => {
      if (!tab.closed) return;
      clearInterval(timer);
      checkoutTabRef.current = null;
      setCheckoutUrl(null);
      // They may well have paid in the seconds before closing it, and this is
      // the moment that is worth spending a check on.
      void syncStatus(true);
    }, 1000);
    return () => clearInterval(timer);
  }, [checkoutUrl, syncStatus]);

  const handleReopenCheckout = useCallback(() => {
    if (!checkoutUrl) return;
    const bridge = getDesktopBridge();
    if (bridge?.openExternal) {
      void bridge.openExternal(checkoutUrl);
      return;
    }
    // Straight from the click with the URL already in hand, so there is no
    // await between the gesture and the open and nothing for a popup blocker
    // to object to.
    const tab = window.open(checkoutUrl, "_blank");
    if (tab) checkoutTabRef.current = tab;
    // Blocked. The URL is the same one already minted, so going there in place
    // costs nothing and is better than a button that looks broken.
    else window.location.href = checkoutUrl;
  }, [checkoutUrl]);

  const handlePix = useCallback(async () => {
    setBusy(true);
    setGenerating(true);
    setError(null);
    const result = await startPixPayment(
      email.trim() || undefined,
      plan?.id,
      cycle,
      taxId.trim() || undefined
    );
    if (!result.ok) {
      setError(result.error);
      if (result.needsEmail) setNeedsEmail(true);
      if (result.needsTaxId) setNeedsTaxId(true);
      setBusy(false);
      setGenerating(false);
      return;
    }
    // Read from the account as it stands *before* the money could possibly
    // arrive, so the confirmation below has something to compare against.
    setPixBaselineEnd(premium?.currentPeriodEnd ?? 0);
    setPix(result.charge);
    setBusy(false);
    setGenerating(false);
    // See handleSubscribe: plan?.id is what this buys.
  }, [email, taxId, plan?.id, cycle, premium?.currentPeriodEnd]);

  // Pix is paid in a banking app, which tells this page nothing. Polling is
  // the only way it learns — the focus listener above does not fire, because
  // the person never left this tab; they left this *device's* screen for
  // another app, or just their phone. Every four seconds while a code is on
  // screen, and only then.
  //
  // Stops the moment the money lands, and `pix` is deliberately *not* cleared
  // when it does: the dialog stays open on a confirmation, which is what
  // somebody who just paid in another app came back to see. Closing it is
  // theirs to do.
  //
  // Also covers an upgrade top-up in flight — same reasoning, same silence
  // from the payment side.
  useEffect(() => {
    if (!pixPending && !upgradePending) return;
    const timer = setInterval(() => void syncStatus(true), 4000);
    return () => clearInterval(timer);
  }, [pixPending, upgradePending, syncStatus]);

  // Priced fresh whenever the plan on screen changes — the quote depends on
  // how many days are left and on both plans' prices, and none of those are
  // this component's to assume are still what they were a render ago.
  useEffect(() => {
    if (!canUpgrade || !plan) {
      setUpgradeQuote(null);
      return;
    }
    let cancelled = false;
    void fetchUpgradeQuote(plan.id).then((quote) => {
      if (!cancelled) setUpgradeQuote(quote);
    });
    return () => {
      cancelled = true;
    };
  }, [canUpgrade, plan]);

  const handleUpgrade = useCallback(async () => {
    if (!plan) return;
    setBusy(true);
    setGenerating(true);
    setError(null);
    const result = await startUpgradePix(
      plan.id,
      email.trim() || undefined,
      taxId.trim() || undefined
    );
    if (!result.ok) {
      setError(result.error);
      if (result.needsEmail) setNeedsEmail(true);
      if (result.needsTaxId) setNeedsTaxId(true);
      setBusy(false);
      setGenerating(false);
      return;
    }
    setUpgradePix(result.charge);
    setBusy(false);
    setGenerating(false);
  }, [email, taxId, plan]);

  // Schedules the mandate that takes over billing, at the new plan's full
  // price, the moment the current cycle runs out — see startUpgradeSchedule.
  // Opens the provider's checkout the same way handleSubscribe does: a blank
  // tab first, while the click is still a user gesture, so a popup blocker
  // has nothing to object to once the request comes back.
  const handleScheduleUpgrade = useCallback(async () => {
    if (!plan) return;
    setScheduling(true);
    setError(null);
    const bridge = getDesktopBridge();
    const replacePage = !bridge && checkoutMustReplacePage();
    const tab = bridge || replacePage ? null : window.open("", "_blank");
    const result = await startUpgradeSchedule(plan.id, email.trim() || undefined);
    if (!result.ok) {
      if (tab && !tab.closed) tab.close();
      setError(result.error);
      if (result.needsEmail) setNeedsEmail(true);
      setScheduling(false);
      return;
    }
    if (bridge?.openExternal) {
      void bridge.openExternal(result.checkoutUrl);
    } else if (tab && !tab.closed && navigateTab(tab, result.checkoutUrl)) {
      // Left open for the person to approve there — nothing here polls it:
      // approving costs the payer nothing (see the endpoint), so there is no
      // "did it work" moment to catch the way a real charge has one.
    } else {
      if (tab && !tab.closed) tab.close();
      window.location.href = result.checkoutUrl;
      return;
    }
    setScheduling(false);
    // Picks up `premium.scheduledUpgradeRef`, which is what turns the button
    // below into the "already scheduled" note.
    await refresh();
  }, [email, plan, refresh]);

  /**
   * The "Assinatura" upgrade option: today's top-up plus tomorrow's renewal,
   * as one button. Neither half alone is the whole product — paying the
   * top-up without scheduling the mandate leaves this exactly where "Pix"
   * already does (bought again by hand once the days run out), and
   * scheduling the mandate without paying today's top-up leaves the current
   * plan exactly as it is until the mandate takes over — so both run every
   * time this is pressed.
   *
   * The Pix charge goes first: it only ever opens an in-page dialog, while
   * scheduling can — on iOS or an installed PWA — replace this page outright
   * (see checkoutMustReplacePage), and doing that first would risk leaving
   * before the Pix code ever appears.
   */
  const handleUpgradeSubscription = useCallback(async () => {
    await handleUpgrade();
    await handleScheduleUpgrade();
  }, [handleUpgrade, handleScheduleUpgrade]);

  // See onCheckoutLockChange. `pix` is what tells the two cases apart: with a
  // code already on screen, a charge being created is a *new* code, requested
  // from inside the Pix dialog, and that dialog shakes itself.
  useEffect(() => {
    onCheckoutLockChange?.({
      locked: generating,
      shake: generating && !pix && !upgradePix,
    });
  }, [generating, pix, upgradePix, onCheckoutLockChange]);

  const handleCancel = useCallback(
    async (survey: CancelSurvey) => {
      setBusy(true);
      setCancelError(null);
      const result = await cancelPremium(survey);
      if (!result.ok) {
        // Kept inside the dialog rather than raised to the page behind it: the
        // person is looking at the dialog, and an error that appears somewhere
        // they cannot see reads as a button that did nothing.
        setCancelError(result.error ?? t("common.couldNotCancelRightNow"));
        setBusy(false);
        return;
      }
      setCancelOpen(false);
      await refresh();
      setBusy(false);
    },
    [refresh, t]
  );




  return (
    <div className={isModal ? "w-full p-5 sm:p-7" : `mx-auto w-full ${compareLayout ? "max-w-3xl" : "max-w-2xl"} px-4 py-10`}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-1.5 text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
            {plan?.title ?? t("common.golivePro")}
            {/* The plan's own mark, chosen by its `iconId` in the database (see
                components/planIcons.tsx). Rendered from the plan rather than
                hardcoded here for the same reason the price is read from it: the
                product's identity is a row, not a literal in a page. */}
            <PlanMark className={`h-6 w-6 shrink-0 ${mark.className}`} />
          </h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            {plan?.description ?? t("pro.proPanel.moreQualityInYourBroadcast")}
          </p>
        </div>
        {onClose && (
          <div className="flex shrink-0 items-center gap-1">
          {/* The whole page, from the popup. A new tab rather than a
              navigation: this popup is opened inside rooms precisely so that
              looking at plans does not leave the call (see lib/proModal).
              Opened on the plan on screen, so it continues rather than
              starts over. */}
          {isModal && (
            <Link
              href={plan ? `/pro?plan=${encodeURIComponent(plan.id)}` : "/pro"}
              target="_blank"
              rel="noopener"
              aria-disabled={generating || undefined}
              className={`inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-zinc-500 transition hover:bg-zinc-200 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100 ${
                generating ? "pointer-events-none opacity-40" : ""
              }`}
            >
              <MdOpenInNew className="h-4 w-4" />
              <span className="hidden sm:inline">{t("pro.proPanel.openFullPage")}</span>
            </Link>
          )}
          <button
            type="button"
            onClick={onClose}
            // Not while a payment is being created — see onCheckoutLockChange.
            disabled={generating}
            aria-label={t("common.close")}
            className="rounded-lg p-1.5 text-zinc-400 transition hover:bg-zinc-200 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200 cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
          >
            <MdClose className="h-5 w-5" />
          </button>
          </div>
        )}
      </div>

      {/* The Apoiador Inicial deadline, on the page and in the modal at once —
          both render this panel. It disappears on its own once the date is
          past (see EARLY_SUPPORTER_CUTOFF_MS): an offer that outlives its
          deadline is a promise the site cannot keep. */}
      {earlySupporterOpen && (
        <div className="relative mt-5 flex items-start gap-3 overflow-hidden rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-3.5">
          {/* The sweep. Behind the text rather than over it — a highlight that
              passes across words makes them harder to read for the moment it
              is there, which is the opposite of what a notice wants. */}
          <span
            aria-hidden
            className="golive-shine pointer-events-none absolute inset-y-0 left-0 w-1/4 bg-gradient-to-r from-transparent via-emerald-300/25 to-transparent"
          />
          <BsStars className="relative mt-0.5 h-5 w-5 shrink-0 text-emerald-500" />
          <p className="relative text-sm leading-relaxed text-emerald-900 dark:text-emerald-200">
            <span className="font-semibold">{t("pro.proPanel.earlySupporter")}</span> {t("pro.proPanel.whoeverSubscribesToAnyPlanUntil")} <span className="font-semibold">18 de outubro</span> {t("pro.proPanel.getsTheEarlySupporterBadgeOn")}{" "}
            <Link href="/badges" target="_blank" className="underline underline-offset-2">
              {t("pro.proPanel.seeTheBadges")}
            </Link>
          </p>
        </div>
      )}

      {/* Only with something to choose between. A single plan needs no picker,
          and drawing one would make the page look like it is withholding an
          option that does not exist. */}
      {compare.ready && !compareLayout && plans.length > 1 && (
        // Extra top room and row gap for the "Recomendado" tag, which sits
        // half above its card and would otherwise touch the row above.
        <div className="mt-7 flex flex-wrap gap-x-2 gap-y-5">
          {plans.map((entry) => {
            const entryMark = planIcon(entry.iconId);
            const active = entry.id === plan?.id;
            // The plan the page steers people toward. By id rather than a
            // flag on the plan document: it is a merchandising choice made
            // here, not a property of what the plan sells.
            const recommended = entry.id === recommendedPlanId;
            return (
              <button
                key={entry.id}
                type="button"
                onClick={() => selectPlan(entry.id)}
                aria-pressed={active}
                className={`relative flex flex-1 items-center gap-2 rounded-xl border px-4 py-3 text-left transition ${
                  active
                    ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                    : "border-zinc-200 bg-white text-zinc-700 hover:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300"
                }`}
              >
                {recommended && (
                  <span className="absolute -top-2.5 left-3 rounded-full bg-amber-500 px-2 py-0.5 text-[11px] leading-4 font-semibold text-white shadow-sm">
                    {t("pro.proPanel.recommended")}
                  </span>
                )}
                <entryMark.Icon className={`h-5 w-5 shrink-0 ${active ? "" : entryMark.className}`} />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold">{entry.title}</span>
                  {/* The price for the cycle on screen, not always the
                      monthly one: with "Anual" selected, a card still quoting
                      a month would be comparing two different things. */}
                  <span className="block text-xs opacity-80">
                    {(entry.cycles?.find((c) => c.cycle === cycle)?.priceLabel ?? entry.priceLabel)}{" "}
                    {cycle === "yearly" ? "/ ano" : t("pro.proPanel.month")}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}

      {compare.ready && compareLayout && !buyOnTop && (
        <PlanComparison
          plans={plans}
          rows={comparisonRows()}
          selectedId={plan?.id ?? null}
          recommendedId={recommendedPlanId}
          onSelect={selectPlan}
          onBuy={buyPlan}
        />
      )}
      <div ref={checkoutCardRef} className="mt-6 scroll-mt-20 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
        {loadingPlan ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">{t("pro.proPanel.loadingThePlan")}</p>
        ) : !plan ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            {t("pro.proPanel.couldNotLoadThePlanRight")}
          </p>
        ) : (
          <>
            {/* Monthly / yearly. Only when the API offers the choice — an
                older one sends no cycles and the page stays as it was. */}
            {plan.cycles && plan.cycles.length > 1 && (
              <div className="mb-4 inline-flex rounded-xl border border-zinc-200 p-1 dark:border-zinc-800">
                {plan.cycles.map((entry) => {
                  const active = entry.cycle === cycle;
                  return (
                    <button
                      key={entry.cycle}
                      type="button"
                      onClick={() => setCycle(entry.cycle)}
                      aria-pressed={active}
                      className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                        active
                          ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                          : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                      }`}
                    >
                      {entry.cycle === "yearly" ? t("pro.proPanel.yearly") : t("pro.proPanel.monthly")}
                      {/* The saving on the tab itself, so the reason to look
                          at the yearly option is visible before opening it. */}
                      {entry.cycle === "yearly" && entry.discountPercent > 0 && (
                        <span
                          className={`rounded-full px-1.5 py-0.5 text-[11px] font-semibold ${
                            active
                              ? "bg-white/20 text-white dark:bg-zinc-900/15 dark:text-zinc-900"
                              : "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                          }`}
                        >
                          -{entry.discountPercent}%
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}

            {/* The comparison experiment's plan picker: under the cycle, in the
                card that holds the price and the buttons it drives. One line
                of pills; the price is the big figure right below. */}
            {compareLayout && (
              <div className="mb-4 flex flex-wrap gap-1.5" role="radiogroup" aria-label={t("pro.compare.choosePlan")}>
                {plans.map((entry) => {
                  const entryMark = planIcon(entry.iconId);
                  const chosen = entry.id === plan.id;
                  return (
                    <button
                      key={entry.id}
                      type="button"
                      role="radio"
                      aria-checked={chosen}
                      onClick={() => selectPlan(entry.id)}
                      className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition ${
                        chosen
                          ? "border-zinc-900 dark:border-zinc-100"
                          : "border-zinc-200 hover:border-zinc-400 dark:border-zinc-800 dark:hover:border-zinc-600"
                      }`}
                    >
                      <span
                        aria-hidden
                        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                          chosen
                            ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                            : "border-zinc-400 dark:border-zinc-600"
                        }`}
                      >
                        {chosen && <MdCheck className="h-3 w-3" />}
                      </span>
                      <entryMark.Icon className={`h-4 w-4 shrink-0 ${entryMark.className}`} />
                      <span className={`whitespace-nowrap ${chosen ? "font-semibold text-zinc-950 dark:text-zinc-50" : "text-zinc-700 dark:text-zinc-300"}`}>
                        {entry.title}
                      </span>
                      {entry.id === recommendedPlanId && (
                        <span className="shrink-0 rounded-full bg-amber-500 px-1.5 text-[10px] leading-4 font-semibold text-white">
                          {t("pro.proPanel.recommended")}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}

            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              {/* The old price first and struck through, then the real one:
                  read left to right that is "was this, is now this", which is
                  the order the sentence is spoken in. */}
              {pricing?.fullPriceLabel && (
                <span className="text-lg font-medium text-zinc-400 line-through dark:text-zinc-600">
                  {pricing.fullPriceLabel}
                </span>
              )}
              <span className="text-3xl font-semibold text-zinc-950 dark:text-zinc-50">
                {pricing?.priceLabel ?? plan.priceLabel}
              </span>
              <span className="text-sm text-zinc-500 dark:text-zinc-400">
                {cycle === "yearly" ? "/ ano" : t("pro.proPanel.month")}
              </span>
              {pricing && pricing.discountPercent > 0 && (
                <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                  {pricing.discountPercent}% de desconto
                </span>
              )}
            </div>
            {cycle === "yearly" && pricing && (
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                {/* The per-month figure, because a yearly total and a monthly
                    one cannot be compared as they stand. */}
                {t("pro.proPanel.equivalentTo")} {pricing.monthlyEquivalentLabel} {t("pro.proPanel.perMonth")}
              </p>
            )}

            {/* The table above already lists every benefit, per plan. */}
            {!compareLayout && (
              <ul className="mt-4 flex flex-col gap-2">
                {featureRows(plan)}
              </ul>
            )}

            <div className="mt-6">
              {/* A refusal, said plainly and with a way forward. Mercado
                  Pago's reason codes are for us, not for the buyer — the one
                  distinction worth passing on is "your card was declined" vs
                  "something went wrong", and in either case Pix is the answer
                  that works right now. */}
              {premium?.lastRefusal && !active && (
                <div className="mb-4 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-200">
                  <p className="font-medium">
                    {premium.lastRefusal.reason.startsWith("cc_rejected")
                      ? t("pro.proPanel.theCardPaymentWasDeclined")
                      : t("pro.proPanel.theLastPaymentWasNotCompleted")}
                  </p>
                  <p className="mt-1 text-red-700 dark:text-red-300/90">
                    {t("pro.proPanel.nothingWasChargedYouCanTry")}
                  </p>
                </div>
              )}
              {resolvingAccount ? (
                <p className="text-sm text-zinc-500 dark:text-zinc-400">{t("common.loading")}</p>
              ) : !account ? (
                <div className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
                  <MdLock className="h-4 w-4 shrink-0" />
                  {/* A subscription has to attach to something that survives
                      clearing the browser, and a guest identity deliberately
                      does not. */}
                  <span>
                    {t("pro.proPanel.youNeedAnAccountToSubscribe")}{" "}
                    <button
                      type="button"
                      onClick={() => setAccountModal("create")}
                      className="font-medium underline underline-offset-2"
                    >
                      {t("common.createAccount")}
                    </button>
                  </span>
                </div>
              ) : activeHere && liveCardSub ? (
                // The one state with nothing to sell: the card is already
                // charging monthly for this exact plan, so both ways to pay
                // would be wrong — a second mandate, or Pix days on top of a
                // period already paid for.
                <div className="flex flex-col gap-3">
                  <p className="text-sm text-zinc-700 dark:text-zinc-300">
                    {t("pro.proPanel.activeSubscriptionRenewsOnValue", { value: periodEndLabel(premium!.currentPeriodEnd) })}
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setCancelError(null);
                      setCancelOpen(true);
                    }}
                    disabled={busy}
                    className="self-start rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
                  >
                    {busy ? t("pro.proPanel.cancelling") : t("pro.proPanel.cancelSubscription")}
                  </button>
                </div>
              ) : !plan.available ? (
                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                  {t("pro.proPanel.subscriptionsAreUnavailableAtTheMoment")}
                </p>
              ) : (
                <div className="flex flex-col gap-3">
                  {activeHere && (
                    <p className="text-sm text-zinc-700 dark:text-zinc-300">
                      {viaPix
                        ? // No renewal to mention: this ends, and saying
                          // "renova em" would promise a charge that is never
                          // coming.
                          t("pro.proPanel.accessActiveUntilValuePaidWith", { value: periodEndLabel(premium!.currentPeriodEnd) })
                        : t("pro.proPanel.subscriptionCancelledYourAccessContinues", { value: periodEndLabel(premium!.currentPeriodEnd) })}
                    </p>
                  )}
                  {checkoutUrl && (
                    <div
                      role="status"
                      className="flex flex-col gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200"
                    >
                      <div className="flex items-center gap-2 font-medium">
                        {/* A spinner rather than an icon: something *is* in
                            progress somewhere else, and a static mark would
                            read as a finished state. */}
                        <span
                          aria-hidden
                          className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent"
                        />
                        {t("pro.proPanel.paymentOpenedInAnotherWindow")}
                      </div>
                      <p className="text-amber-800 dark:text-amber-300/90">
                        {t("pro.proPanel.completeThePaymentOverThereThis")}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={handleReopenCheckout}
                          className="rounded-lg border border-amber-400 px-3 py-1.5 text-xs font-medium transition hover:bg-amber-100 dark:border-amber-500/50 dark:hover:bg-amber-500/15"
                        >
                          {t("pro.proPanel.reopenWindow")}
                        </button>
                        <button
                          type="button"
                          onClick={() => void syncStatus(true)}
                          className="rounded-lg border border-amber-400 px-3 py-1.5 text-xs font-medium transition hover:bg-amber-100 dark:border-amber-500/50 dark:hover:bg-amber-500/15"
                        >
                          {t("common.iAlreadyPaidCheck")}
                        </button>
                        {/* An escape hatch, because this state can otherwise
                            only be left by paying: a person who changed their
                            mind in a window this page cannot see would be
                            stuck looking at a spinner about a payment that is
                            never coming. */}
                        <button
                          type="button"
                          onClick={() => {
                            checkoutTabRef.current = null;
                            setCheckoutUrl(null);
                          }}
                          className="rounded-lg px-3 py-1.5 text-xs font-medium underline-offset-2 transition hover:underline"
                        >
                          {t("common.cancel")}
                        </button>
                      </div>
                    </div>
                  )}
                  {needsEmail && (
                    <label className="flex flex-col gap-1 text-sm text-zinc-700 dark:text-zinc-300">
                      <span>{t("common.emailForThePayment")}</span>
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        autoComplete="email"
                        placeholder="voce@exemplo.com"
                        className="w-full max-w-sm rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
                      />
                      <span className="text-xs text-zinc-500 dark:text-zinc-400">
                        {/* Said plainly because an email box on a payment page
                            invites the question, and the answer is short. */}
                        {t("common.usedOnlyForTheChargeOn")}
                      </span>
                    </label>
                  )}
                  {/* Shown on the same terms as the address above: only once a
                      charge has been refused for want of it. `inputMode` and
                      not `type="number"`, because a CPF is a string of digits
                      that people type with dots and dashes, not a quantity. */}
                  {needsTaxId && (
                    <label className="flex flex-col gap-1 text-sm text-zinc-700 dark:text-zinc-300">
                      <span>{t("common.taxIdForThePayment")}</span>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={taxId}
                        onChange={(e) => setTaxId(e.target.value)}
                        placeholder="000.000.000-00"
                        className="w-full max-w-sm rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
                      />
                      <span className="text-xs text-zinc-500 dark:text-zinc-400">
                        {t("common.taxIdUsedOnlyForTheCharge")}
                      </span>
                    </label>
                  )}
                  {/* Offered only to somebody already paying for a lower
                      plan: it swaps them onto this one for just the top-up
                      the remaining days are worth, instead of a fresh
                      purchase at the full price. Sits above the ordinary
                      "assinar"/"pix" pair rather than replacing it — both
                      stay, since a subscriber can still choose to buy this
                      plan outright instead (a fresh cycle, at the full
                      price) if that suits them better. */}
                  {canUpgrade && !checkoutUrl && !pixPending && !upgradePending && (
                    <div className="overflow-hidden rounded-xl border border-zinc-200 shadow-sm dark:border-zinc-800">
                      <button
                        type="button"
                        onClick={() => setUpgradeOpen((open) => !open)}
                        aria-expanded={upgradeOpen}
                        className="flex w-full items-center gap-3 px-3.5 py-3 text-left transition hover:bg-zinc-50 dark:hover:bg-zinc-900"
                      >
                        {/* The arrow, not the plan being left behind: this
                            header is about the move, not about what somebody
                            already has — that plan's own mark is on screen
                            everywhere else on this page. */}
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                          <MdArrowUpward className="h-4 w-4" />
                        </span>
                        <span className="inline-flex min-w-0 flex-1 flex-wrap items-center gap-1.5 text-sm font-medium text-zinc-800 dark:text-zinc-200">
                          {t("pro.proPanel.upgradeTo")}
                          <PlanMark className={`h-4 w-4 shrink-0 ${mark.className}`} />
                          <span className="truncate">{plan.title}</span>
                        </span>
                        {upgradeQuote && (
                          <span className="shrink-0 text-sm text-zinc-500 dark:text-zinc-400">
                            {upgradeQuote.amountLabel}
                          </span>
                        )}
                        <MdExpandMore
                          className={`h-4 w-4 shrink-0 text-zinc-400 transition-transform ${
                            upgradeOpen ? "rotate-180" : ""
                          }`}
                        />
                      </button>
                      {upgradeOpen && (
                        <div className="flex flex-col gap-3 border-t border-zinc-200 bg-zinc-50/70 px-3.5 py-3.5 dark:border-zinc-800 dark:bg-zinc-900/40">
                          <p className="text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                            {t("pro.proPanel.upgradeNow")}
                          </p>
                          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-zinc-200 bg-white px-3.5 py-3 dark:border-zinc-800 dark:bg-zinc-950">
                            <div>
                              <p className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                                {upgradeQuote ? upgradeQuote.amountLabel : "—"}
                              </p>
                              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                                {upgradeQuote
                                  ? t("pro.proPanel.upgradeRemainingDays", { days: upgradeQuote.remainingDays })
                                  : t("pro.proPanel.calculatingTheUpgrade")}
                              </p>
                            </div>
                          </div>

                          {/* Two complete ways to pay the same amount above —
                              same pairing as the ordinary purchase buttons
                              below, and for the same reason: they are two
                              products, not a default and an alternative.
                              "Assinatura" is the one that keeps working after
                              today: it charges this same top-up now *and*
                              schedules the mandate that takes over billing —
                              at the new plan's full price — the moment the
                              current cycle ends, so nobody has to come back
                              and buy the upgrade again next month. "Pix" is
                              just today: the plan changes now, and renewing
                              it again later is a manual purchase, same as any
                              other Pix plan. */}
                          {premium?.scheduledUpgradeRef ? (
                            <p className="text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
                              {t("pro.proPanel.upgradeScheduled", {
                                value: periodEndLabel(premium.currentPeriodEnd),
                              })}
                            </p>
                          ) : (
                            <p className="text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
                              {t("pro.proPanel.upgradeSubscriptionHint", {
                                value: pricing?.priceLabel ?? plan.priceLabel,
                                date: premium ? periodEndLabel(premium.currentPeriodEnd) : "",
                              })}
                            </p>
                          )}
                          <div className="flex flex-wrap gap-2">
                            {!premium?.scheduledUpgradeRef && (
                              <button
                                type="button"
                                onClick={handleUpgradeSubscription}
                                disabled={
                                  busy || scheduling || !upgradeQuote || (needsEmail && !email.trim()) || (needsTaxId && !taxId.trim())
                                }
                                className="rounded-lg bg-zinc-950 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:opacity-60 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
                              >
                                {scheduling || busy
                                  ? t("pro.proPanel.openingThePayment")
                                  : `${t("pro.proPanel.upgradeViaSubscription")} por ${
                                      upgradeQuote?.amountLabel ?? "—"
                                    }`}
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={handleUpgrade}
                              disabled={busy || !upgradeQuote || (needsEmail && !email.trim()) || (needsTaxId && !taxId.trim())}
                              className="flex items-center gap-2 rounded-lg bg-[#32BCAD] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[#2ba99b] disabled:opacity-60"
                            >
                              <PixIcon className="h-4 w-4 shrink-0" />
                              {busy
                                ? t("common.generating")
                                : `${upgradeQuote?.amountLabel ?? "—"} por ${
                                    upgradeQuote ? Math.ceil(upgradeQuote.remainingDays) : 30
                                  } dias`}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                  {/* Both ways to pay, side by side and equal in weight —
                      they are two products, not a default and an alternative:
                      one starts a renewal, the other buys days. Wrapping
                      rather than a fixed row, because the two labels carry
                      prices and stop fitting one line on a phone.

                      Hidden while a checkout is open rather than disabled:
                      pressing "assinar" again would create a *second*
                      second mandate at the provider for a subscription already
                      waiting to be paid, and "reabrir janela" above is what
                      somebody who lost the window actually wants. */}
                  {/* Only when the plan document actually prices Pix above
                      the subscription (see the API's pixPriceCents) — with
                      the two equal there is nothing to recommend, and a nudge
                      with no reason behind it is just noise. Both prices are
                      already on the two buttons below; this says what the
                      difference means, which is also what the law asks of a
                      price that depends on how somebody pays. */}
                  {!checkoutUrl &&
                    !pixPending &&
                    !liveCardSub &&
                    pixSurchargePercent > 0 && (
                      <PixSurchargeNotice
                        percent={pixSurchargePercent}
                        priceLabel={pricing?.priceLabel ?? plan.priceLabel}
                        pixPriceLabel={pricing?.pixPriceLabel ?? plan.pixPriceLabel}
                        yearly={cycle === "yearly"}
                      />
                    )}
                  {!checkoutUrl && !pixPending && (
                    <div className="flex flex-wrap gap-2">
                      {/* Offered on every plan, with no "cancel first". The
                          API ends the mandate being replaced at the moment
                          the new payment confirms (see
                          endReplacedSubscription), so switching is one
                          purchase rather than a cancellation somebody has to
                          remember to undo — and a checkout abandoned halfway
                          leaves the current plan exactly as it was. */}
                      <button
                        type="button"
                        onClick={handleSubscribe}
                        disabled={busy || (needsEmail && !email.trim()) || (needsTaxId && !taxId.trim())}
                        className="rounded-lg bg-zinc-950 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:opacity-60 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
                      >
                        {busy
                          ? t("pro.proPanel.openingThePayment")
                          : `${activeHere ? t("pro.proPanel.renew") : active ? t("common.change") : t("pro.proPanel.subscribe")} por ${
                              pricing?.priceLabel ?? plan.priceLabel
                            }${cycle === "yearly" ? "/ano" : t("pro.proPanel.month2")}`}
                      </button>
                      {/* Pix's own teal rather than the page's neutral: it is
                          the colour people recognise the method by, and it is
                          doing the work the word alone would otherwise have to.
                          Labelled with days, not with "Pix" alone — a button
                          that said only "Pix" would be promising a
                          subscription Pix cannot hold. */}
                      <button
                        type="button"
                        onClick={handlePix}
                        disabled={busy || (needsEmail && !email.trim()) || (needsTaxId && !taxId.trim())}
                        className="flex items-center gap-2 rounded-lg bg-[#32BCAD] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[#2ba99b] disabled:opacity-60"
                      >
                        <PixIcon className="h-4 w-4 shrink-0" />
                        {busy
                          ? t("common.generating")
                          : `${pricing?.pixPriceLabel ?? plan.pixPriceLabel} por ${
                              pricing?.periodDays ?? 30
                            } dias`}
                      </button>
                    </div>
                  )}
                  {/* What "trocar" actually does, said before the money
                      moves rather than discovered after it. */}
                  {active && !activeHere && !checkoutUrl && !pixPending && (
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                      {t("pro.proPanel.onCompletionThisPlanReplacesThe")}
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Outside the branches above, and deliberately: buying this for
                somebody else is possible whether the reader has no plan, this
                plan, or the other one — and the one state that has nothing
                else to offer (a card already charging for this exact plan) is
                the state where it is the only purchase left. */}
            {account && (
              <button
                type="button"
                onClick={() =>
                  void openPopup("gift_plan", { data: { initialPlanId: plan?.id } })
                }
                className="mt-4 flex cursor-pointer items-center gap-2 text-sm font-medium text-zinc-600 underline-offset-2 transition hover:underline dark:text-zinc-400"
              >
                <MdCardGiftcard className="h-4 w-4 shrink-0 text-emerald-500" />
                {t("pro.proPanel.giftSomeoneAPlan")}
              </button>
            )}

            {error && (
              <p className="mt-3 text-sm text-red-600 dark:text-red-400" role="alert">
                {error}
              </p>
            )}
          </>
        )}
      </div>
      {compare.ready && compareLayout && buyOnTop && (
        <PlanComparison
          plans={plans}
          rows={comparisonRows()}
          selectedId={plan?.id ?? null}
          recommendedId={recommendedPlanId}
          onSelect={selectPlan}
          onBuy={buyPlan}
        />
      )}

      {/* Rendered here rather than beside the button: it is fixed to the
          viewport, so where it sits in the tree only decides who owns its
          state — and that is this panel, which is what reacts to the account
          appearing. */}
      <AccountModal mode={accountModal} onModeChange={setAccountModal} />

      {/* Top level for the same reason, plus one of its own: a Pix charge can
          be created from either branch above — a first purchase and a renewal
          — and a dialog rendered inside one of them would be a dialog the
          other could not open. */}
      <CancelSurveyDialog
        open={cancelOpen}
        accessUntilLabel={periodEndLabel(premium?.currentPeriodEnd ?? 0)}
        planTitle={plan?.title ?? ""}
        busy={busy}
        error={cancelError}
        onCancelSubscription={handleCancel}
        onClose={() => {
          if (!busy) setCancelOpen(false);
        }}
      />
      <PixChargeModal
        charge={pix}
        paid={pixPaid}
        paidUntilLabel={premium ? periodEndLabel(premium.currentPeriodEnd) : null}
        confirmation={
          plan
            ? {
                planId: plan.id,
                planTitle: plan.title,
                planIconId: plan.iconId,
                // Their own plan, so their own face in the confetti.
                face: account
                  ? { name: account.displayName, avatarUrl: account.avatarUrl }
                  : null,
              }
            : null
        }
        busy={busy}
        onRegenerate={handlePix}
        onCheckNow={() => void syncStatus(true)}
        onClose={() => setPix(null)}
      />

      {/* The upgrade top-up's own dialog, apart from the one above: `upgradePaid`
          is decided by `lastPaymentId`, not by `currentPeriodEnd` moving — an
          upgrade settles without ever touching that date (see the API's
          syncUpgradePayment), so the ordinary Pix dialog's own test for "did
          this land" would never fire for one. */}
      <PixChargeModal
        charge={upgradePix}
        paid={upgradePaid}
        paidUntilLabel={premium ? periodEndLabel(premium.currentPeriodEnd) : null}
        confirmation={
          plan
            ? {
                planId: plan.id,
                planTitle: plan.title,
                planIconId: plan.iconId,
                face: account
                  ? { name: account.displayName, avatarUrl: account.avatarUrl }
                  : null,
              }
            : null
        }
        busy={busy}
        onRegenerate={handleUpgrade}
        onCheckNow={() => void syncStatus(true)}
        onClose={() => setUpgradePix(null)}
      />

      <p className="mt-4 text-xs text-zinc-400 dark:text-zinc-500">
        {t("pro.proPanel.thePaymentIsProcessedByMercado")}
      </p>
    </div>
  );
}
