"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { MdArrowBack, MdArrowForward, MdCheck } from "react-icons/md";
import { creativeProblem, PartnerCreativeForm } from "@/components/partnerOrders/PartnerCreativeForm";
import {
  PartnerAudienceStats,
  PartnerAccountSuggestion,
  PartnerDiscordFloating,
  PartnerPackagePicker,
  PartnerPreviewPanel,
} from "@/components/partnerOrders/PartnerOrderParts";
import { PartnerCheckout } from "@/components/partnerOrders/PartnerCheckout";
import { useAuth } from "@/lib/AuthContext";
import { useFeature } from "@/lib/features";
import { useT } from "@/lib/useI18n";
import {
  SELF_SERVE_PARTNER_EVENTS,
  SELF_SERVE_PARTNER_FEATURE,
  blankCreative,
  createPartnerOrder,
  creativeOf,
  fetchPartnerOrder,
  fetchPartnerOrderConfig,
  packageDurationLabel,
  trackPartnerOrderEvent,
  updatePartnerOrder,
  type PartnerCreative,
  type PartnerOrder,
  type PartnerOrderConfig,
} from "@/lib/partnerOrders";

// "Criar anúncio", in four steps: how long, the card, the extras, pay (in the
// order the experiment's variant picks — see STEP_ORDERS). The
// draft is kept in this browser while it is being written, so a closed tab or
// a trip to the bank app does not lose it.

const DRAFT_KEY = "golive:partner-order-draft";

type StepKey = "plan" | "card" | "extras" | "pay";

/**
 * The experiment's variant that builds the card before showing the price. Any
 * other variant (and the default "on") keeps the price first. Payment is
 * always last.
 */
const CREATIVE_FIRST_VARIANT = "creative-first";
const STEP_ORDERS: Record<"planFirst" | "creativeFirst", StepKey[]> = {
  planFirst: ["plan", "card", "extras", "pay"],
  creativeFirst: ["card", "extras", "plan", "pay"],
};

type Draft = { packageId: string | null; creative: PartnerCreative; orderId: string | null };

function readDraft(): Draft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Draft;
    return parsed && parsed.creative ? { ...parsed, creative: creativeOf(parsed.creative) } : null;
  } catch {
    return null;
  }
}

function writeDraft(draft: Draft | null) {
  try {
    if (draft) localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    else localStorage.removeItem(DRAFT_KEY);
  } catch {
    // Private window: the draft just lives as long as the tab.
  }
}

export function PartnerWizard() {
  const t = useT();
  const router = useRouter();
  const search = useSearchParams();
  const { account, loading } = useAuth();
  // Counted here: the builder and the dashboard are where the experiment's
  // feature actually is (see SELF_SERVE_PARTNER_FEATURE).
  //
  // Its variant is also the order of the steps (see STEP_ORDERS): whether the
  // price comes first or only once the advertiser has built their card.
  const { variant } = useFeature(SELF_SERVE_PARTNER_FEATURE, { track: true });
  const stepOrder = variant === CREATIVE_FIRST_VARIANT ? STEP_ORDERS.creativeFirst : STEP_ORDERS.planFirst;
  const [config, setConfig] = useState<PartnerOrderConfig | null>(null);
  const [step, setStep] = useState(0);
  const [packageId, setPackageId] = useState<string | null>(null);
  const [creative, setCreative] = useState<PartnerCreative>(blankCreative);
  const [order, setOrder] = useState<PartnerOrder | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const restored = useRef(false);

  const stepLabels: Record<StepKey, string> = {
    plan: t("partnerOrders.wizard.stepPlan"),
    card: t("partnerOrders.wizard.stepCard"),
    extras: t("partnerOrders.wizard.stepExtras"),
    pay: t("partnerOrders.wizard.stepPay"),
  };
  const steps = stepOrder.map((key) => stepLabels[key]);
  const stepKey = stepOrder[step];
  const lastStep = stepOrder.length - 1;

  useEffect(() => {
    fetchPartnerOrderConfig()
      .then(setConfig)
      .catch(() => setConfig({ packages: [], methods: { pix: false, card: false } }));
  }, []);

  // Starting point: a renewal copies an earlier order; otherwise the draft
  // this browser kept; otherwise a blank card.
  useEffect(() => {
    if (restored.current || loading) return;
    restored.current = true;
    const from = search.get("from");
    const pkg = search.get("package");
    if (from) {
      fetchPartnerOrder(from)
        .then((source) => {
          setCreative(creativeOf(source.creative));
          setPackageId(pkg ?? source.packageId);
          trackPartnerOrderEvent(SELF_SERVE_PARTNER_EVENTS.renew);
        })
        .catch(() => undefined);
      return;
    }
    const draft = readDraft();
    // Applied a tick later: localStorage is not there during the server render,
    // so the first client render has to match it before the draft comes in.
    void Promise.resolve().then(() => {
      if (draft) {
        setCreative(draft.creative);
        setPackageId(pkg ?? draft.packageId);
        if (draft.orderId) {
          fetchPartnerOrder(draft.orderId)
            .then((existing) => {
              if (existing.status === "awaiting_payment") setOrder(existing);
              else writeDraft({ ...draft, orderId: null });
            })
            .catch(() => undefined);
        }
      } else if (pkg) {
        setPackageId(pkg);
      }
    });
  }, [account, loading, search]);

  useEffect(() => {
    if (!restored.current) return;
    writeDraft({ packageId, creative, orderId: order?.id ?? null });
  }, [packageId, creative, order]);

  useEffect(() => {
    // By name, not position: the two orders put each step in a different
    // place, and the funnel is compared step by step.
    trackPartnerOrderEvent(`${SELF_SERVE_PARTNER_EVENTS.wizardStep}_${stepKey}`);
  }, [stepKey]);

  const pkg = config?.packages.find((p) => p.id === packageId) ?? null;
  // Without an account, where the order's link and news go (see the API's
  // PartnerOrderDoc.contactEmail). Asked on the payment step.
  const [email, setEmail] = useState("");
  const needsEmail = !loading && !account;

  function canLeave(from: number): string | null {
    const key = stepOrder[from];
    if (key === "plan") return pkg ? null : t("partnerOrders.wizard.choosePlan");
    if (key === "card" || key === "extras") return creativeProblem(creative, t);
    return null;
  }

  function go(to: number) {
    if (to > step) {
      for (let s = step; s < to; s++) {
        const why = canLeave(s);
        if (why) {
          setProblem(why);
          setStep(s);
          return;
        }
      }
    }
    setProblem(null);
    setStep(to);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  /** Creates the order (or saves the edits on the one already created) right before paying. */
  async function prepare(): Promise<PartnerOrder | null> {
    if (!pkg) return null;
    const why = creativeProblem(creative, t);
    if (why) {
      setProblem(why);
      return null;
    }
    if (needsEmail && !order && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setProblem(t("partnerOrders.wizard.needEmail"));
      return null;
    }
    setProblem(null);
    const saved = order
      ? await updatePartnerOrder(order.id, creative, pkg.id)
      : await createPartnerOrder(pkg.id, creative, needsEmail ? email.trim() : undefined);
    if (!order) trackPartnerOrderEvent(SELF_SERVE_PARTNER_EVENTS.created, saved.amountCents);
    setOrder(saved);
    return saved;
  }

  return (
    <main className="mx-auto w-full max-w-7xl grow px-4 pb-24 pt-6 sm:px-6">
      <div className="flex items-center justify-between gap-3">
        <Link
          href="/partner"
          className="flex items-center gap-1 text-sm text-zinc-500 transition hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
        >
          <MdArrowBack className="h-4 w-4" />
          {t("partnerOrders.myAds")}
        </Link>
      </div>
      <h1 className="mt-3 text-2xl font-bold tracking-tight text-zinc-950 dark:text-zinc-50">
        {t("partnerOrders.wizard.title")}
      </h1>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{t("partnerOrders.wizard.subtitle")}</p>

      {/* The steps, clickable backwards and (when the current one is done) forwards. */}
      <ol className="mt-5 grid grid-cols-4 gap-2">
        {steps.map((label, index) => {
          const done = index < step;
          const current = index === step;
          return (
            <li key={label}>
              <button
                type="button"
                onClick={() => go(index)}
                className={`flex w-full flex-col items-start gap-1 border-t-4 pt-2 text-left text-xs font-semibold transition sm:text-sm ${
                  current
                    ? "border-emerald-500 text-zinc-950 dark:text-zinc-50"
                    : done
                      ? "border-emerald-300 text-zinc-600 dark:border-emerald-800 dark:text-zinc-300"
                      : "border-zinc-200 text-zinc-400 dark:border-zinc-800 dark:text-zinc-500"
                }`}
              >
                <span className="flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide opacity-80">
                  {done ? <MdCheck className="h-3.5 w-3.5 text-emerald-600" /> : null}
                  {t("partnerOrders.wizard.stepN", { n: index + 1 })}
                </span>
                <span className="truncate">{label}</span>
              </button>
            </li>
          );
        })}
      </ol>

      {/* Two halves: the settings on the left, the previews on the right —
          wide enough for the horizontal card at its real size. */}
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div className="min-w-0">
          {stepKey === "plan" && (
            <div className="flex flex-col gap-5">
              <section>
                <h2 className="mb-2 text-lg font-semibold text-zinc-950 dark:text-zinc-50">
                  {t("partnerOrders.wizard.planTitle")}
                </h2>
                {config === null ? (
                  <p className="text-sm text-zinc-500">{t("common.loading")}</p>
                ) : (
                  <PartnerPackagePicker packages={config.packages} value={packageId} onChange={setPackageId} />
                )}
              </section>
              <PartnerAudienceStats />
            </div>
          )}
          {stepKey === "card" && <PartnerCreativeForm section="card" value={creative} onChange={setCreative} />}
          {stepKey === "extras" && <PartnerCreativeForm section="extras" value={creative} onChange={setCreative} />}
          {stepKey === "pay" && (
            <div className="flex flex-col gap-4">
              <section className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
                <h2 className="text-lg font-semibold text-zinc-950 dark:text-zinc-50">{t("partnerOrders.wizard.reviewTitle")}</h2>
                <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                  <SummaryRow label={t("partnerOrders.wizard.summaryDuration")} value={pkg ? packageDurationLabel(pkg.hours) : "—"} />
                  <SummaryRow label={t("partnerOrders.wizard.summaryPrice")} value={pkg?.priceLabel ?? "—"} strong />
                  <SummaryRow label={t("common.title")} value={creative.title} />
                  <SummaryRow label={t("common.buttonLink")} value={creative.buttonUrl} />
                  <SummaryRow
                    label={t("partnerOrders.wizard.summaryVideo")}
                    value={creative.rewardVideoUrl && creative.rewardPoints ? t("partnerOrders.wizard.pointsEach", { points: creative.rewardPoints }) : t("partnerOrders.wizard.none")}
                  />
                  <SummaryRow
                    label={t("partnerOrders.wizard.summarySchedules")}
                    value={String((creative.schedules ?? []).length || t("partnerOrders.wizard.none"))}
                  />
                </dl>
              </section>
              {config && pkg && (
                <section className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
                  <h2 className="mb-3 text-lg font-semibold text-zinc-950 dark:text-zinc-50">{t("partnerOrders.wizard.payTitle")}</h2>
                  {/* No account: suggested, never required — the email below is
                      enough, and is how they get back to the ad. */}
                  {needsEmail && (
                    <div className="mb-4">
                      <PartnerAccountSuggestion />
                    </div>
                  )}
                  {needsEmail && !order && (
                    <div className="mb-4">
                      <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300" htmlFor="po-contact-email">
                        {t("partnerOrders.wizard.emailLabel")}
                      </label>
                      <input
                        id="po-contact-email"
                        type="email"
                        autoComplete="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="voce@exemplo.com"
                        className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-emerald-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
                      />
                      <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">{t("partnerOrders.wizard.emailHint")}</p>
                    </div>
                  )}
                  <PartnerCheckout
                    order={order}
                    amountLabel={pkg.priceLabel}
                    methods={config.methods}
                    prepare={prepare}
                    onPaid={(paidOrder) => {
                      writeDraft(null);
                      router.push(`/partner/${encodeURIComponent(paidOrder.id)}?paid=1`);
                    }}
                  />
                </section>
              )}
            </div>
          )}

          {problem && <p className="mt-4 text-sm font-medium text-red-500">{problem}</p>}

          {step < lastStep && (
            <div className="mt-6 flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => go(step - 1)}
                disabled={step === 0}
                className="flex items-center gap-1 rounded-xl px-4 py-2.5 text-sm font-semibold text-zinc-600 transition hover:bg-zinc-100 disabled:invisible dark:text-zinc-300 dark:hover:bg-zinc-900"
              >
                <MdArrowBack className="h-4 w-4" />
                {t("common.back")}
              </button>
              <button
                type="button"
                onClick={() => go(step + 1)}
                className="flex items-center gap-1 rounded-xl bg-zinc-950 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
              >
                {step === lastStep - 1 ? t("partnerOrders.wizard.toPayment") : t("partnerOrders.wizard.next")}
                <MdArrowForward className="h-4 w-4" />
              </button>
            </div>
          )}
          {step === lastStep && (
            <button
              type="button"
              onClick={() => go(lastStep - 1)}
              className="mt-4 flex items-center gap-1 text-sm font-semibold text-zinc-600 dark:text-zinc-300"
            >
              <MdArrowBack className="h-4 w-4" />
              {t("common.back")}
            </button>
          )}
        </div>

        {/* Always in view: the card being built, and the way to a human. */}
        <aside className="flex flex-col gap-4 lg:sticky lg:top-4 lg:self-start">
          {/* Not beside the price when that is the very first screen — there
              is no card yet. Creative-first reaches the price with one. */}
          {!(stepKey === "plan" && step === 0) && <PartnerPreviewPanel creative={creative} />}
          {/* The chosen period, only once it has been chosen on its own step. */}
          {pkg && step > stepOrder.indexOf("plan") && (
            <div className="rounded-xl border border-zinc-200 bg-white p-3 text-sm dark:border-zinc-800 dark:bg-zinc-950">
              <p className="text-xs text-zinc-500 dark:text-zinc-400">{t("partnerOrders.wizard.summaryDuration")}</p>
              <p className="flex items-baseline justify-between gap-2 font-semibold text-zinc-950 dark:text-zinc-50">
                {packageDurationLabel(pkg.hours)}
                <span className="text-lg tabular-nums">{pkg.priceLabel}</span>
              </p>
            </div>
          )}
        </aside>
      </div>
      <PartnerDiscordFloating source="wizard" />
    </main>
  );
}

function SummaryRow({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex min-w-0 justify-between gap-3 border-b border-zinc-100 py-1.5 dark:border-zinc-900">
      <dt className="shrink-0 text-zinc-500 dark:text-zinc-400">{label}</dt>
      <dd className={`min-w-0 truncate text-right ${strong ? "font-bold text-zinc-950 dark:text-zinc-50" : "text-zinc-800 dark:text-zinc-200"}`}>
        {value}
      </dd>
    </div>
  );
}
