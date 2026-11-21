"use client";

import { useEffect, useState } from "react";
import {
  createAdminCosmeticGift,
  createAdminGift,
  parseUsernameList,
  fetchAdminPlans,
  type AdminGift,
  type AdminPlanOption,
} from "@/lib/adminApi";
import { downloadGiftCard, downloadGiftCardsPdf } from "@/lib/giftCardImage";
import { useI18n } from "@/lib/useI18n";
import { fetchCosmeticsCatalog, type CosmeticProduct } from "@/lib/cosmetics";
import { withAvatarDecoration } from "@/lib/avatarShape";
import { UserAvatar } from "@/components/UserAvatar";
import { useAuth } from "@/lib/AuthContext";
import { fromDateInput, giftDurationLabel, GiftListPanel } from "./GiftListPanel";

// Minting a gift link nobody paid for.
//
// Deliberately next to "Conceder plano" and deliberately not merged with it,
// because they answer different questions. That one is "give Fulano thirty
// days" — one step, nothing to send, and it needs an account to aim at. This
// one is "produce something I can hand out": a prize, a giveaway, an apology,
// where who ends up with it is decided afterwards and may not be on the site
// at all yet.
//
// The link that comes back is an ordinary present. It goes through the same
// claim screen, the same redemption and the same ladder check as one somebody
// bought — the only difference is that no money moved, and nothing downstream
// knows or cares.
//
// Codes made here are listed for the rest of the visit and nowhere else. That
// is a real limit and worth stating: leave the page and the link is gone. It
// is also not much of one — nothing was spent, and making another takes a
// second — and the alternative is a permanent ledger of comped codes that
// somebody would have to go and prune.

const DEFAULT_DAYS = 30;
/** The same handful "Conceder plano" offers, so the two read as one idea. */
const DAY_PRESETS = [7, 15, 30, 90, 365];
/** The same idea for a gift measured in hours. */
const HOUR_PRESETS = [1, 2, 5, 12, 24, 48];
const DEFAULT_HOURS = 5;
/** What the API caps an hourly gift at (a month of hours). */
const MAX_HOURS = 720;

function giftLink(code: string): string {
  if (typeof window === "undefined") return `/gift/${code}`;
  return `${window.location.origin}/gift/${code}`;
}

/** One minted code, with the button that matters. */
function GiftRow({ gift }: { gift: AdminGift }) {
  const { t, tc } = useI18n();
  const [copied, setCopied] = useState(false);
  const [drawing, setDrawing] = useState(false);

  // The printable card (public/gift-cards), with this code in its box.
  async function downloadImage() {
    setDrawing(true);
    try {
      await downloadGiftCard(gift.planId, gift.code);
    } catch {
      // Nothing to recover: the link above still works, and trying again is
      // the same button.
    } finally {
      setDrawing(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(giftLink(gift.code));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard refused. The link is on screen and selectable either way —
      // which is why it is rendered whole rather than truncated to the code.
    }
  }

  return (
    <li className="flex flex-col gap-1.5 rounded-lg border border-zinc-200 p-2.5 dark:border-zinc-800">
      <span className="text-xs text-zinc-500 dark:text-zinc-400">
        {gift.cosmetic ? `${gift.planTitle} · ${t("admin.giftPanel.frameBadge")}` : `${gift.planTitle} · ${giftDurationLabel(gift, tc)}`}
        {gift.trialOnly ? ` · ${t("admin.giftPanel.trialBadge")}` : ""}
        {gift.testGift ? ` · ${t("admin.giftPanel.testBadge")}` : ""}
      </span>
      <div className="flex items-center gap-2">
        {/* Selectable and wrapped rather than truncated: if the clipboard is
            unavailable, reading it off the screen has to still be possible —
            and at this length that means it has to be all there. */}
        <code className="min-w-0 flex-1 break-all rounded-md bg-zinc-50 px-2 py-1.5 text-[11px] leading-snug text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
          {giftLink(gift.code)}
        </code>
        <button
          type="button"
          onClick={() => void copy()}
          className="shrink-0 rounded-lg bg-zinc-950 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
        >
          {copied ? t("common.copied") : t("common.copy")}
        </button>
        {!gift.cosmetic && (
        <button
          type="button"
          onClick={() => void downloadImage()}
          disabled={drawing}
          className="shrink-0 rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 transition hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
        >
          {t("admin.giftPanel.downloadImage")}
        </button>
        )}
      </div>
    </li>
  );
}

// Two permissions meet here: `gifts` draws the whole form, `test_gifts` only
// the "gift de experimentar" button (2h, once per account — the API fixes
// both, whatever is on screen). An admin with only the second sees the plan
// picker and that button.
export function GiftPanel({
  canGifts = true,
  canTestGifts = true,
}: {
  canGifts?: boolean;
  canTestGifts?: boolean;
}) {
  const { t, tc } = useI18n();
  const [plans, setPlans] = useState<AdminPlanOption[]>([]);
  const [planId, setPlanId] = useState("");
  // What the link gives: plan time, or an avatar frame (any of them, sold or not).
  const [kind, setKind] = useState<"plan" | "frame">("plan");
  const [frames, setFrames] = useState<CosmeticProduct[]>([]);
  const [frameId, setFrameId] = useState("");
  const { account } = useAuth();
  const [days, setDays] = useState(DEFAULT_DAYS);
  // Days or hours: a prize is a month, a taste is an afternoon.
  const [unit, setUnit] = useState<"days" | "hours">("days");
  const [hours, setHours] = useState(DEFAULT_HOURS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Newest first: the one just made is the one being copied.
  const [minted, setMinted] = useState<AdminGift[]>([]);
  const [buildingPdf, setBuildingPdf] = useState(false);
  // Optional: the day the code stops working, empty for never.
  const [expiry, setExpiry] = useState("");
  // Usernames, free text: who alone may redeem, and who may not.
  const [allowed, setAllowed] = useState("");
  const [blocked, setBlocked] = useState("");
  // Free trial: the redeemer registers a card at Stripe and is billed after.
  const [trialOnly, setTrialOnly] = useState(false);
  // Bumped after each new gift so the full list below picks it up.
  const [listKey, setListKey] = useState(0);

  // Every card made this visit, 8 to a landscape A4 (see giftCardImage).
  // Oldest first, so the sheet reads in the order they were made.
  async function downloadAllPdf() {
    setBuildingPdf(true);
    try {
      // Plan gifts only: the printed card is drawn per plan.
      await downloadGiftCardsPdf([...minted].filter((g) => !g.cosmetic).reverse());
    } catch {
      setError(t("admin.giftPanel.couldNotBuildPdf"));
    } finally {
      setBuildingPdf(false);
    }
  }

  // The frames, for the "Moldura" kind: the public catalog has all of them,
  // gift-only ones included, so no other permission is needed here.
  useEffect(() => {
    if (!canGifts) return;
    let cancelled = false;
    fetchCosmeticsCatalog()
      .then((data) => {
        if (cancelled) return;
        const list = data.catalog.filter((p) => p.type === "avatar_decoration");
        setFrames(list);
        setFrameId((current) => current || list[0]?.id || "");
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [canGifts]);

  useEffect(() => {
    let cancelled = false;
    fetchAdminPlans()
      .then((loaded) => {
        if (cancelled) return;
        setPlans(loaded);
        setPlanId((current) => current || loaded[0]?.id || "");
      })
      .catch(() => {
        if (!cancelled) setError(t("common.couldNotLoadThePlans"));
      });
    return () => {
      cancelled = true;
    };
  }, [t]);

  const amount = unit === "hours" ? hours : days;
  const amountValid = unit === "hours" ? hours >= 1 && hours <= MAX_HOURS : days >= 1;

  async function handleGenerate(testGift = false) {
    const frameGift = kind === "frame" && !testGift;
    if (busy) return;
    if (frameGift ? !frameId : !planId || (!testGift && !amountValid)) return;
    setBusy(true);
    setError(null);
    try {
      const gift = frameGift
        ? await createAdminCosmeticGift(frameId, fromDateInput(expiry), {
            allowedUsernames: parseUsernameList(allowed),
            blockedUsernames: parseUsernameList(blocked),
          })
        : await createAdminGift(
        planId,
        // Ignored by the API for a test gift, which is always 2h.
        unit === "hours" || testGift ? { hours: testGift ? 2 : hours } : { days },
        fromDateInput(expiry),
        {
          allowedUsernames: parseUsernameList(allowed),
          blockedUsernames: parseUsernameList(blocked),
        },
        testGift ? false : trialOnly && unit === "days",
        testGift
      );
      setMinted((current) => [gift, ...current]);
      setListKey((k) => k + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("admin.giftPanel.couldNotGenerate"));
    } finally {
      setBusy(false);
    }
  }

  const inputClass =
    "w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50";

  return (
    <>
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">{t("admin.giftPanel.generateGift")}</h2>
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
        {canGifts ? t("admin.giftPanel.createsAGiftLinkWithNo") : t("admin.giftPanel.testOnlyIntro")}
      </p>

      {canGifts && (
        <div className="mt-3 flex gap-2" role="radiogroup" aria-label={t("admin.giftPanel.kind")}>
          {(["plan", "frame"] as const).map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={kind === option}
              onClick={() => setKind(option)}
              className={`rounded-lg border-2 px-3 py-1.5 text-xs font-semibold transition ${
                kind === option
                  ? "border-emerald-500 text-zinc-900 dark:text-zinc-50"
                  : "border-zinc-200 text-zinc-600 hover:border-zinc-300 dark:border-zinc-800 dark:text-zinc-300 dark:hover:border-zinc-600"
              }`}
            >
              {option === "plan" ? t("admin.giftPanel.kindPlan") : t("admin.giftPanel.kindFrame")}
            </button>
          ))}
        </div>
      )}

      {kind === "frame" && canGifts ? (
        <div className="mt-3 flex items-end gap-3">
          <div className="min-w-40 flex-1">
            <label htmlFor="gift-frame" className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
              {t("admin.giftPanel.frame")}
            </label>
            <select id="gift-frame" value={frameId} onChange={(e) => setFrameId(e.target.value)} className={inputClass}>
              {frames.map((frame) => (
                <option key={frame.id} value={frame.id}>
                  {frame.label}
                  {frame.forSale === false ? ` (${t("admin.giftPanel.frameGiftOnly")})` : ""}
                </option>
              ))}
            </select>
          </div>
          {frames.find((f) => f.id === frameId) && (
            <UserAvatar
              src={withAvatarDecoration(account?.avatarUrl ?? null, frames.find((f) => f.id === frameId)!.value)}
              name={account?.displayName ?? "Go Live"}
              size={40}
              className="mb-0.5 shrink-0"
            />
          )}
        </div>
      ) : (
      <div className="mt-3 flex flex-wrap gap-3">
        <div className="min-w-40 flex-1">
          <label
            htmlFor="gift-plan"
            className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400"
          >
            {t("common.plan")}
          </label>
          <select
            id="gift-plan"
            value={planId}
            onChange={(e) => setPlanId(e.target.value)}
            className={inputClass}
          >
            {plans.map((plan) => (
              <option key={plan.id} value={plan.id}>
                {plan.title} ({plan.priceLabel}){plan.active ? "" : t("common.notForSale")}
              </option>
            ))}
          </select>
        </div>

        {canGifts && (
        <div className="min-w-40 flex-1">
          <label
            htmlFor="gift-days"
            className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400"
          >
            {t("common.duration")}
          </label>
          {/* The preset and the number are one control in two halves, exactly
              as in "Conceder plano": the list is what is picked nine times out
              of ten, and the box beside it is the tenth without a mode to
              switch into. The unit picker beside them switches the whole
              control between days and hours. */}
          <div className="flex gap-2">
            <select
              id="gift-days"
              value={
                (unit === "hours" ? HOUR_PRESETS : DAY_PRESETS).includes(amount) ? String(amount) : "custom"
              }
              onChange={(e) => {
                if (e.target.value === "custom") return;
                if (unit === "hours") setHours(Number(e.target.value));
                else setDays(Number(e.target.value));
              }}
              className={inputClass}
            >
              {(unit === "hours" ? HOUR_PRESETS : DAY_PRESETS).map((preset) => (
                <option key={preset} value={preset}>
                  {tc(unit === "hours" ? "common.hourCount" : "common.dayCount", preset)}
                </option>
              ))}
              <option value="custom">{t("common.other")}</option>
            </select>
            <input
              type="number"
              min={1}
              max={unit === "hours" ? MAX_HOURS : 3650}
              value={amount}
              onChange={(e) => {
                if (unit === "hours") setHours(Number(e.target.value));
                else setDays(Number(e.target.value));
              }}
              aria-label={unit === "hours" ? t("admin.giftPanel.hours") : t("common.days")}
              className={`${inputClass} w-20`}
            />
            <select
              value={unit}
              onChange={(e) => setUnit(e.target.value === "hours" ? "hours" : "days")}
              aria-label={t("admin.giftPanel.unit")}
              className={`${inputClass} w-24`}
            >
              <option value="days">{t("common.days")}</option>
              <option value="hours">{t("admin.giftPanel.hours")}</option>
            </select>
          </div>
        </div>
        )}
      </div>
      )}

      <div className="mt-3 flex flex-wrap gap-3">
        <div className="min-w-40 flex-1">
          <label htmlFor="gift-allowed" className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
            {t("admin.giftList.allowedLabel")}
          </label>
          <input
            id="gift-allowed"
            value={allowed}
            onChange={(e) => setAllowed(e.target.value)}
            placeholder={t("admin.giftList.usernamesPlaceholder")}
            className={inputClass}
          />
        </div>
        <div className="min-w-40 flex-1">
          <label htmlFor="gift-blocked" className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
            {t("admin.giftList.blockedLabel")}
          </label>
          <input
            id="gift-blocked"
            value={blocked}
            onChange={(e) => setBlocked(e.target.value)}
            placeholder={t("admin.giftList.usernamesPlaceholder")}
            className={inputClass}
          />
        </div>
      </div>

      {canGifts && kind === "plan" && unit === "days" && (
      <label className="mt-3 flex items-start gap-2 text-sm text-zinc-700 dark:text-zinc-300">
        <input
          type="checkbox"
          checked={trialOnly}
          onChange={(e) => setTrialOnly(e.target.checked)}
          className="mt-0.5"
        />
        <span>
          {t("admin.giftPanel.trialOnly")}
          <span className="block text-xs text-zinc-500 dark:text-zinc-400">
            {t("admin.giftPanel.trialOnlyHint")}
          </span>
        </span>
      </label>
      )}

      <div className="mt-3 max-w-xs">
        <label
          htmlFor="gift-expiry"
          className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400"
        >
          {t("admin.giftList.expiresOnOptional")}
        </label>
        <input
          id="gift-expiry"
          type="date"
          value={expiry}
          onChange={(e) => setExpiry(e.target.value)}
          className={inputClass}
        />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        {canGifts && (
          <button
            type="button"
            onClick={() => void handleGenerate()}
            disabled={busy || (kind === "frame" ? !frameId : !planId || !amountValid)}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? t("admin.giftPanel.generating") : t("admin.giftPanel.generateLink")}
          </button>
        )}
        {canTestGifts && kind === "plan" && (
          // Its own button rather than a checkbox on the form above: it is a
          // different thing with fixed rules (2h, once per account), and it
          // sits under its own permission.
          <button
            type="button"
            onClick={() => void handleGenerate(true)}
            disabled={!planId || busy}
            title={t("admin.giftPanel.testGiftHint")}
            className="rounded-lg border border-sky-500 px-4 py-2 text-sm font-medium text-sky-700 transition hover:bg-sky-50 disabled:cursor-not-allowed disabled:opacity-50 dark:text-sky-300 dark:hover:bg-sky-950/40"
          >
            {t("admin.giftPanel.generateTestGift")}
          </button>
        )}
        {error && <span className="text-sm text-red-500">{error}</span>}
      </div>
      {canTestGifts && (
        <p className="mt-1.5 text-xs text-zinc-500 dark:text-zinc-400">{t("admin.giftPanel.testGiftHint")}</p>
      )}

      {minted.length > 0 && (
        <div className="mt-4 border-t border-zinc-200 pt-3 dark:border-zinc-800">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
              {t("admin.giftPanel.generatedNowCopyThemBeforeLeaving")}
            </p>
            <button
              type="button"
              onClick={() => void downloadAllPdf()}
              disabled={buildingPdf}
              className="shrink-0 rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 transition hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
            >
              {buildingPdf ? t("admin.giftPanel.buildingPdf") : t("admin.giftPanel.downloadAllPdf")}
            </button>
          </div>
          <ul className="mt-2 flex flex-col gap-2">
            {minted.map((gift) => (
              <GiftRow key={gift.giftId} gift={gift} />
            ))}
          </ul>
        </div>
      )}
    </div>
    <GiftListPanel refreshKey={listKey} />
    </>
  );
}
