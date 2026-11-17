"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import useNtPopups from "ntpopups";
import {
  MdAdd,
  MdAutoAwesome,
  MdCheck,
  MdChevronRight,
  MdClose,
  MdGroups,
  MdPerson,
  MdScreenShare,
} from "react-icons/md";
import type { IconType } from "react-icons";
import { PlanBand, planTone, PLAN_TONE_BUTTON } from "@/components/PlanBand";
import { planIcon } from "@/components/planIcons";
import { useAuth } from "@/lib/AuthContext";
import { accountTierOf, planTierOf, tierAbove, type FeatureTier } from "@/lib/entitlements";
import { useFeature } from "@/lib/features";
import { planUnlocks, usePerkGates, PERK_GROUPS, type Perk, type PerkGroup, type PlanUnlocks } from "@/lib/planPerks";
import {
  PLAN_UNLOCK_EVENTS,
  PLAN_UNLOCK_FEATURE,
  guideHostOpen,
  readSeenTier,
  subscribeGuideHosts,
  trackUnlockGuide,
  writeSeenTier,
} from "@/lib/planUnlockGuide";
import { fetchPremiumPlans, type PremiumPlan } from "@/lib/premiumApi";
import { useOpenPro } from "@/lib/proModal";
import { useSellsHere } from "@/lib/storePolicy";
import { useT } from "@/lib/useI18n";

// "O que você desbloqueou": the guide that follows a plan landing.
//
// A confirmation screen says the money arrived; it does not say what that
// money *bought*, and the things a plan opens are scattered across the whole
// site — a quality picker, the room's ⋯ menu, the profile editor. Each line
// here is the perk in the words the /pro page sold it with, and one line
// under it saying where it lives.
//
// Only what is *new*: an upgrade from Pro to Pro Max lists what Max adds,
// not the Pro perks somebody has been using for months. Under it, when there
// is a rung above, what that rung would still add — the same "diff" again,
// one rung at a time, so nothing is listed twice.
//
// See lib/planUnlockGuide for how the inline copy and the popup avoid both
// appearing for the same plan.

/** Rows shown before "ver tudo". Enough to read as a list, short enough not to bury the button. */
const COLLAPSED_ROWS = 5;
/** Perks quoted per higher plan before "e mais N". */
const BEYOND_ROWS = 3;

const GROUP_ICONS: Record<PerkGroup, IconType> = {
  broadcast: MdScreenShare,
  profile: MdPerson,
  room: MdGroups,
  extras: MdAutoAwesome,
};

// The plans, fetched once per page load: the guide can render in two places
// within seconds of each other and the list does not change between them.
let plansPromise: Promise<PremiumPlan[]> | null = null;

function loadPlans(): Promise<PremiumPlan[]> {
  if (!plansPromise) {
    plansPromise = fetchPremiumPlans().then((plans) => {
      // A failed read is not cached: the next guide gets to try again.
      if (plans.length === 0) plansPromise = null;
      return plans;
    });
  }
  return plansPromise;
}

/** The guide's contents, or `undefined` while the plans load. Null when there is nothing to say. */
function usePlanUnlocks(tier: FeatureTier, previousTier: FeatureTier): PlanUnlocks | null | undefined {
  const [plans, setPlans] = useState<PremiumPlan[] | null>(null);
  const gates = usePerkGates();
  useEffect(() => {
    let live = true;
    void loadPlans().then((list) => {
      if (live) setPlans(list);
    });
    return () => {
      live = false;
    };
  }, []);
  return useMemo(() => {
    if (!plans) return undefined;
    const result = planUnlocks(plans, tier, previousTier, gates);
    return result && result.unlocked.length > 0 ? result : null;
  }, [plans, tier, previousTier, gates]);
}

function GuideBody({
  unlocks,
  scroll,
  onNavigate,
}: {
  unlocks: PlanUnlocks;
  /** Caps the height and scrolls inside, for the narrow confirmation dialogs. */
  scroll?: boolean;
  /** Called before a higher plan is opened, so the dialog around this can close. */
  onNavigate?: () => void;
}) {
  const t = useT();
  const sells = useSellsHere();
  const openPro = useOpenPro();
  const [expanded, setExpanded] = useState(false);
  const { unlocked, beyond } = unlocks;
  const visible = expanded ? unlocked : unlocked.slice(0, COLLAPSED_ROWS);
  const groups = PERK_GROUPS.map((group) => ({
    group,
    perks: visible.filter((perk) => perk.group === group),
  })).filter((entry) => entry.perks.length > 0);

  return (
    <div className={`text-left ${scroll ? "max-h-[45vh] overflow-y-auto pr-1" : ""}`}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-400 dark:text-zinc-500">
        {t("planUnlocks.title")}
      </p>
      <div className="mt-2 divide-y divide-zinc-200 overflow-hidden rounded-2xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
        {groups.map(({ group, perks }) => {
          const GroupIcon = GROUP_ICONS[group];
          return (
            <div key={group} className="px-3 py-2.5">
              <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                <GroupIcon className="h-3.5 w-3.5" />
                {t(`planUnlocks.group.${group}`)}
              </p>
              <ul className="mt-1.5 space-y-2">
                {perks.map((perk) => (
                  <PerkRow key={perk.key} perk={perk} />
                ))}
              </ul>
            </div>
          );
        })}
      </div>
      {unlocked.length > COLLAPSED_ROWS && (
        <button
          type="button"
          onClick={() => {
            if (!expanded) trackUnlockGuide(PLAN_UNLOCK_EVENTS.expand);
            setExpanded(!expanded);
          }}
          className="mt-1.5 w-full rounded-lg px-3 py-1.5 text-xs font-medium text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-200"
        >
          {expanded ? t("planUnlocks.showLess") : t("planUnlocks.showAll", { count: unlocked.length })}
        </button>
      )}

      {/* Selling inside a store app is not allowed (lib/storePolicy). */}
      {sells && beyond.length > 0 && (
        <div className="mt-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-400 dark:text-zinc-500">
            {t("planUnlocks.beyondTitle")}
          </p>
          <div className="mt-2 flex flex-col gap-2">
            {beyond.map(({ plan, perks }) => {
              const mark = planIcon(plan.iconId);
              return (
                <button
                  key={plan.id}
                  type="button"
                  onClick={() => {
                    trackUnlockGuide(PLAN_UNLOCK_EVENTS.upsell);
                    onNavigate?.();
                    openPro("unlock_guide", plan.id);
                  }}
                  className="group w-full rounded-2xl border border-zinc-200 px-3 py-2.5 text-left transition hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:border-zinc-700 dark:hover:bg-zinc-900/60"
                >
                  <span className="flex items-center gap-1.5 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    {plan.title}
                    <mark.Icon className={`h-4 w-4 shrink-0 ${mark.className}`} />
                    <MdChevronRight className="ml-auto h-4 w-4 text-zinc-400 transition group-hover:translate-x-0.5" />
                  </span>
                  <ul className="mt-1 space-y-0.5">
                    {perks.slice(0, BEYOND_ROWS).map((perk) => (
                      <li key={perk.key} className="flex items-start gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
                        <MdAdd className="mt-0.5 h-3 w-3 shrink-0" />
                        {perk.label}
                      </li>
                    ))}
                  </ul>
                  {perks.length > BEYOND_ROWS && (
                    <span className="mt-0.5 block pl-[1.125rem] text-xs text-zinc-400 dark:text-zinc-500">
                      {t("planUnlocks.andMore", { count: perks.length - BEYOND_ROWS })}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function PerkRow({ perk }: { perk: Perk }) {
  return (
    <li className="flex items-start gap-2">
      <MdCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-500" />
      <span className="min-w-0">
        <span className="block text-sm leading-snug text-zinc-800 dark:text-zinc-200">{perk.label}</span>
        {perk.hint && (
          <span className="mt-0.5 block text-xs leading-snug text-zinc-500 dark:text-zinc-400">{perk.hint}</span>
        )}
      </span>
    </li>
  );
}

/**
 * The guide inside a confirmation screen (the Pix/card "pago", the present's
 * "resgatado"). Renders nothing outside the experiment, for a renewal of the
 * same plan, or for a plan below the one already held.
 *
 * Where it stood before is the watcher's record (lib/planUnlockGuide), read
 * once on the way in: by the time the money lands the account may already
 * have been refreshed, so the account itself no longer knows.
 */
export function PlanUnlockInline({ planId, onNavigate }: { planId: string; onNavigate?: () => void }) {
  const { account } = useAuth();
  const tier = planTierOf(planId);
  const [previousTier] = useState<FeatureTier>(() => {
    const seen = account ? readSeenTier(account.id) : null;
    if (seen) return seen;
    // No record (storage refused): the account, if it has not caught up yet.
    const now = accountTierOf(account?.flags);
    return tierAbove(tier, now) ? now : "account";
  });
  const accountId = account?.id ?? null;
  const feature = useFeature(PLAN_UNLOCK_FEATURE);
  const unlocks = usePlanUnlocks(tier, previousTier);

  // Moved forward whatever the experiment says, so the watcher does not
  // announce this same plan again once the dialog closes. Only ever upward: a
  // lower plan bought for later (a deferred downgrade) is not where the
  // account stands now.
  useEffect(() => {
    if (!accountId) return;
    const seen = readSeenTier(accountId);
    if (!seen || tierAbove(tier, seen)) writeSeenTier(accountId, tier);
  }, [accountId, tier]);

  const showing = feature.enabled && Boolean(unlocks);
  useEffect(() => {
    if (showing) trackUnlockGuide(PLAN_UNLOCK_EVENTS.inline);
  }, [showing]);

  if (!feature.enabled || !unlocks) return null;
  return (
    <div className="mt-5">
      <GuideBody unlocks={unlocks} scroll onNavigate={onNavigate} />
    </div>
  );
}

export type PlanUnlockPopupData = { tier: FeatureTier; previousTier: FeatureTier };

/**
 * The guide on its own, for a plan that arrived with no confirmation screen
 * to put it in. Registered as "plan_unlocks" in NtPopups, opened by
 * PlanUnlockWatcher.
 */
export function PlanUnlockPopup({
  closePopup,
  data,
}: {
  closePopup: (hasAction?: boolean) => void;
  data?: PlanUnlockPopupData;
}) {
  const t = useT();
  const tier = data?.tier ?? "premium";
  const unlocks = usePlanUnlocks(tier, data?.previousTier ?? "account");
  const tone = planTone(tier);
  const mark = planIcon(unlocks?.plan.iconId);

  // Nothing worth a popup after all (the plans could not be read, or every
  // perk is hidden by an experiment): gone before anybody reads an empty box.
  useEffect(() => {
    if (unlocks === null) closePopup(false);
  }, [unlocks, closePopup]);

  return (
    <div className="relative flex w-[26rem] max-w-[calc(100vw-1rem)] flex-col bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-50">
      <button
        type="button"
        onClick={() => closePopup(false)}
        aria-label={t("common.close")}
        className="absolute right-3 top-3 z-10 rounded-full bg-black/20 p-1.5 text-white/90 transition hover:bg-black/35 hover:text-white"
      >
        <MdClose className="h-4 w-4" />
      </button>
      <PlanBand tone={tone}>
        <mark.Icon className="h-8 w-8 text-white drop-shadow-sm" />
      </PlanBand>
      <div className="px-6 pb-6 pt-5">
        <p className="text-center text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-400 dark:text-zinc-500">
          {t("planUnlocks.popupEyebrow")}
        </p>
        {unlocks ? (
          <>
            <h2 className="mt-1.5 flex items-center justify-center gap-1.5 text-center text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
              {unlocks.plan.title}
              <mark.Icon className={`h-5 w-5 shrink-0 ${mark.className}`} />
            </h2>
            <p className="mt-2 text-center text-sm text-zinc-600 dark:text-zinc-400">
              {t("planUnlocks.popupBody", { plan: unlocks.plan.title })}
            </p>
            <div className="mt-5">
              <GuideBody unlocks={unlocks} scroll onNavigate={() => closePopup(true)} />
            </div>
            <button
              type="button"
              onClick={() => closePopup(true)}
              className={`mt-5 w-full rounded-xl px-4 py-3 text-sm font-semibold text-white shadow-sm transition ${PLAN_TONE_BUTTON[tone]}`}
            >
              {t("planUnlocks.startUsing")}
            </button>
          </>
        ) : (
          <div className="flex h-40 items-center justify-center">
            <span
              aria-hidden
              className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-300 border-t-transparent dark:border-zinc-700"
            />
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Notices a plan arriving with no confirmation screen to announce it — the
 * hosted checkout in another tab, a present given by name, a trial started at
 * Stripe — and opens the guide as a popup. Mounted once at the layout root.
 *
 * Waits outside a room: a dialog over a call somebody is in the middle of is
 * not the moment. The record is left alone there, so the guide is still owed
 * when they leave.
 */
export function PlanUnlockWatcher() {
  const { account } = useAuth();
  const pathname = usePathname();
  const [pending, setPending] = useState<PlanUnlockPopupData | null>(null);
  const hostsOpen = useSyncExternalStore(subscribeGuideHosts, guideHostOpen, () => false);
  const accountId = account?.id ?? null;
  const tier = account ? accountTierOf(account.flags) : null;
  const inRoom = Boolean(pathname?.startsWith("/watch/"));

  useEffect(() => {
    if (!accountId || !tier || inRoom || hostsOpen) return;
    const seen = readSeenTier(accountId);
    if (seen === tier) return;
    writeSeenTier(accountId, tier);
    // No record is a first sight (a new browser, or before this shipped):
    // whatever the account holds is not news.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reacting to the account changing under the page
    if (seen && tierAbove(tier, seen)) setPending({ tier, previousTier: seen });
  }, [accountId, tier, inRoom, hostsOpen]);

  if (!pending) return null;
  return <UnlockPopupOpener {...pending} onDone={() => setPending(null)} />;
}

/**
 * Asks the experiment — counting the exposure on both sides, at the same
 * moment the inline copy counts its own — and opens the popup for the side
 * that has it.
 */
function UnlockPopupOpener({
  tier,
  previousTier,
  onDone,
}: PlanUnlockPopupData & { onDone: () => void }) {
  const feature = useFeature(PLAN_UNLOCK_FEATURE);
  const { openPopup } = useNtPopups();
  useEffect(() => {
    if (!feature.ready) return;
    onDone();
    if (!feature.enabled) return;
    trackUnlockGuide(PLAN_UNLOCK_EVENTS.popup);
    void openPopup("plan_unlocks", { data: { tier, previousTier } });
    // Once, when the decision is known.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feature.ready]);
  return null;
}
