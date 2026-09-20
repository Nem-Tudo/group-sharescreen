"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { MdAdd, MdClose, MdDelete, MdDownload, MdExpandLess, MdExpandMore, MdRefresh, MdStar, MdStarBorder } from "react-icons/md";
import {
  checkFeature,
  createFeature,
  deleteFeature,
  fetchFeatureStats,
  fetchFeatures,
  resetFeatureStats,
  searchAdminAccounts,
  updateFeature,
  type AdminFeature,
  type FeatureCheck,
  type FeatureOverride,
  type FeaturePlatform,
  type FeatureStats,
  type FeatureTarget,
  type FeatureWrite,
} from "@/lib/adminApi";
import { getLocalFeatureOverrides, setLocalFeatureOverride } from "@/lib/features";
import { useT } from "@/lib/useI18n";
import { TIP_CLICK_EVENT } from "@/lib/clipsMode";
import { PARTNER_EVENTS } from "@/lib/partnerExperiment";
import { formatLocale } from "@/lib/i18n";

// Feature rollouts, Discord-experiment style.
//
// A feature is aimed at users, rooms or groups; a percentage of them gets it,
// decided by a hash of the id (no lookups — see lib/featureHash.ts), and some
// ids can be forced in or out. Everybody outside the rollout is "control",
// which is what the stats compare against: the code reports exposures and
// events (lib/features.ts, the API's featureStatsStore), and the table below
// puts each treatment next to control.

const inputClass =
  "w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50";
const labelClass = "flex flex-col gap-1 text-xs font-medium text-zinc-600 dark:text-zinc-400";
const buttonClass =
  "rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900";
const primaryClass =
  "rounded-lg bg-zinc-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200";
const cardClass = "rounded-lg border border-zinc-200 p-3 dark:border-zinc-800";

const PLATFORMS: FeaturePlatform[] = ["desktop-browser", "desktop-app", "mobile-browser", "mobile-app"];
const STAGES = [0, 1, 5, 10, 25, 50, 100];

function percent(bp: number): string {
  return `${(bp / 100).toLocaleString(formatLocale(), { maximumFractionDigits: 2 })}%`;
}

function number(value: number): string {
  return value.toLocaleString(formatLocale());
}

function dateTime(ms: number): string {
  try {
    return new Date(ms).toLocaleString(formatLocale(), {
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

// Account ids are UUIDs, and a username can never contain a hyphen
// (USERNAME_RE on the API), so the two never get mixed up.
const ACCOUNT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Turns what was typed into a user override into account ids: ids pass
 * through, usernames (with or without @) are looked up and must match
 * exactly. Whatever could not be found comes back in `missing`.
 */
async function resolveAccountIds(
  tokens: string[]
): Promise<{ resolved: { id: string; username?: string }[]; missing: string[] }> {
  const resolved: { id: string; username?: string }[] = [];
  const missing: string[] = [];
  await Promise.all(
    tokens.map(async (token) => {
      if (ACCOUNT_ID_RE.test(token)) {
        resolved.push({ id: token.toLowerCase() });
        return;
      }
      const username = token.replace(/^@/, "");
      try {
        const { accounts } = await searchAdminAccounts(username);
        const hit = accounts.find((account) => account.username.toLowerCase() === username.toLowerCase());
        if (hit) resolved.push({ id: hit.id, username: hit.username });
        else missing.push(token);
      } catch {
        missing.push(token);
      }
    })
  );
  return { resolved, missing };
}

function splitList(text: string): string[] {
  return text
    .split(/[\s,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/**
 * Each treatment's share of the rollout, in percent: from the stored weights
 * (any scale), or an even split when there are none.
 */
function variantShares(variants: string[], weights: number[] | undefined): number[] {
  const usable = weights && weights.length === variants.length && weights.some((w) => w > 0) ? weights : null;
  if (!usable) return variants.map(() => 100 / Math.max(1, variants.length));
  const total = usable.reduce((sum, weight) => sum + weight, 0);
  return usable.map((weight) => (weight / total) * 100);
}

function roundShare(value: number): string {
  return String(Math.round(value * 100) / 100);
}

function Pill({ children, tone = "zinc" }: { children: React.ReactNode; tone?: "zinc" | "green" | "amber" | "red" | "blue" }) {
  const tones = {
    zinc: "bg-zinc-100 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400",
    green: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400",
    amber: "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-400",
    red: "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-400",
    blue: "bg-sky-100 text-sky-700 dark:bg-sky-950/50 dark:text-sky-400",
  };
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${tones[tone]}`}>{children}</span>;
}

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Export
//
// The numbers as JSON, for reading outside this panel — one feature, or every
// one of them in a single file. Built here from the same API the tables use
// (no export endpoint), so what lands in the file is exactly what is on
// screen, over the same number of days.

async function exportFeatureStats(features: AdminFeature[], days: number): Promise<void> {
  const entries = await Promise.all(
    features.map(async (feature) => ({
      key: feature.key,
      target: feature.target,
      enabled: feature.enabled,
      archived: feature.archived === true,
      rolloutBp: feature.rolloutBp,
      variants: feature.variants,
      stats: await fetchFeatureStats(feature.key, days),
    }))
  );
  const payload = {
    exportedAt: new Date().toISOString(),
    days,
    features: entries,
  };
  const stamp = new Date().toISOString().slice(0, 10);
  const name = features.length === 1 ? features[0].key : "features";
  download(`golive-${name}-stats-${stamp}.json`, JSON.stringify(payload, null, 2));
}

function download(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  // Straight away would race the download in Safari; a tick later it is safe.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function FeaturesPanel() {
  const t = useT();
  const [features, setFeatures] = useState<AdminFeature[]>([]);
  const [builtInEvents, setBuiltInEvents] = useState<string[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    void fetchFeatures()
      .then((data) => {
        setFeatures(data.features);
        setBuiltInEvents(data.builtInClientEvents ?? data.clientEvents);
        setError(null);
      })
      .catch((err: Error) => setError(err.message));
  }, []);

  useEffect(load, [load]);

  // Worked out here rather than kept from the last load, so saving a
  // feature's site events updates the list straight away.
  const clientEvents = useMemo(() => {
    const names = new Set(builtInEvents);
    for (const feature of features) {
      if (!feature.archived) for (const name of feature.clientEvents ?? []) names.add(name);
    }
    return [...names];
  }, [builtInEvents, features]);

  const replace = (next: AdminFeature) =>
    setFeatures((current) => current.map((feature) => (feature.key === next.key ? next : feature)));

  const visible = features.filter((feature) => showArchived || !feature.archived);
  const archivedCount = features.filter((feature) => feature.archived).length;

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">{t("admin.features.title")}</h2>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{t("admin.features.intro")}</p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button type="button" onClick={load} className={buttonClass} aria-label={t("admin.features.reload")}>
            <MdRefresh className="h-4 w-4" />
          </button>
          {/* Every feature's numbers in one file — the archived ones too when
              they are on screen, so what is exported is the list being read. */}
          <button
            type="button"
            disabled={exporting || visible.length === 0}
            onClick={() => {
              setExporting(true);
              exportFeatureStats(visible, EXPORT_DAYS)
                .then(() => setError(null))
                .catch((err: Error) => setError(err.message))
                .finally(() => setExporting(false));
            }}
            className={`${buttonClass} flex items-center gap-1 disabled:opacity-50`}
          >
            <MdDownload className="h-4 w-4" />
            {exporting ? t("admin.features.exporting") : t("admin.features.exportAll")}
          </button>
          <button
            type="button"
            onClick={() => setCreating((value) => !value)}
            className={`${buttonClass} flex items-center gap-1`}
          >
            {creating ? <MdClose className="h-4 w-4" /> : <MdAdd className="h-4 w-4" />}
            {creating ? t("common.cancel") : t("admin.features.new")}
          </button>
        </div>
      </div>

      {creating && (
        <CreateFeatureForm
          onCreated={(feature) => {
            setFeatures((current) => [feature, ...current]);
            setCreating(false);
            setOpen(feature.key);
          }}
        />
      )}

      {error && <p className="mt-3 text-sm text-red-500">{error}</p>}

      {visible.length === 0 ? (
        <p className="mt-4 text-sm text-zinc-500 dark:text-zinc-400">{t("admin.features.empty")}</p>
      ) : (
        <ul className="mt-4 flex flex-col gap-2">
          {visible.map((feature) => (
            <li key={feature.key} className="rounded-lg border border-zinc-200 dark:border-zinc-800">
              <button
                type="button"
                onClick={() => setOpen((current) => (current === feature.key ? null : feature.key))}
                className="flex w-full items-start gap-3 px-3 py-2.5 text-left text-xs"
                aria-expanded={open === feature.key}
              >
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{feature.name}</span>
                    <span className="font-mono text-zinc-500">{feature.key}</span>
                  </span>
                  <span className="mt-1 flex flex-wrap items-center gap-1.5">
                    <Pill tone="blue">{t(`admin.features.target.${feature.target}`)}</Pill>
                    {feature.archived ? (
                      <Pill>{t("admin.features.archived")}</Pill>
                    ) : !feature.enabled ? (
                      <Pill tone="red">{t("admin.features.killed")}</Pill>
                    ) : feature.rolloutBp >= 10_000 ? (
                      <Pill tone="green">{t("admin.features.fullyLaunched")}</Pill>
                    ) : (
                      <Pill tone="amber">{percent(feature.rolloutBp)}</Pill>
                    )}
                    {feature.variants.length > 1 && (
                      <Pill>{t("admin.features.variantsCount", { count: feature.variants.length })}</Pill>
                    )}
                    {feature.overrides.length > 0 && (
                      <Pill>{t("admin.features.overridesCount", { count: feature.overrides.length })}</Pill>
                    )}
                    {feature.serverOnly && <Pill>{t("admin.features.serverOnly")}</Pill>}
                  </span>
                </span>
                {/* The rollout as a bar, readable at a glance down the list. */}
                <span className="mt-1 hidden h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-zinc-200 sm:block dark:bg-zinc-800">
                  <span
                    className={`block h-full ${feature.enabled ? "bg-emerald-500" : "bg-zinc-400"}`}
                    style={{ width: `${feature.rolloutBp / 100}%` }}
                  />
                </span>
                {open === feature.key ? (
                  <MdExpandLess className="h-5 w-5 shrink-0 text-zinc-500" />
                ) : (
                  <MdExpandMore className="h-5 w-5 shrink-0 text-zinc-500" />
                )}
              </button>
              {open === feature.key && (
                <FeatureEditor
                  feature={feature}
                  clientEvents={clientEvents}
                  onChange={replace}
                  onDeleted={() => {
                    setFeatures((current) => current.filter((entry) => entry.key !== feature.key));
                    setOpen(null);
                  }}
                />
              )}
            </li>
          ))}
        </ul>
      )}

      {archivedCount > 0 && (
        <button
          type="button"
          onClick={() => setShowArchived((value) => !value)}
          className="mt-3 text-xs text-zinc-500 underline underline-offset-2 hover:text-zinc-800 dark:hover:text-zinc-200"
        >
          {showArchived
            ? t("admin.features.hideArchived")
            : t("admin.features.showArchived", { count: archivedCount })}
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function CreateFeatureForm({ onCreated }: { onCreated: (feature: AdminFeature) => void }) {
  const t = useT();
  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [target, setTarget] = useState<FeatureTarget>("user");
  const [variants, setVariants] = useState("on");
  const [rollout, setRollout] = useState("0");
  // Marcada por padrão: quase todo experimento do site roda em tela que um
  // visitante também vê, e deixar a caixa desmarcada fazia a métrica sair
  // pela metade sem ninguém perceber — o jeito de descobrir era estranhar um
  // número baixo depois. Quem não quiser visitante desmarca aqui, que é o
  // momento em que se está pensando no público do experimento.
  const [includeGuests, setIncludeGuests] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      onCreated(
        await createFeature({
          key: key.trim().toLowerCase(),
          name: name.trim(),
          description: description.trim(),
          target,
          variants: splitList(variants.toLowerCase()),
          rollout: Number(rollout.replace(",", ".")) || 0,
          // Só faz sentido para o alvo "user": uma sala e um grupo não têm
          // visitante para incluir, e a API ignora o campo nos dois casos.
          includeGuests: target === "user" && includeGuests,
        })
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`mt-4 flex flex-col gap-3 ${cardClass}`}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className={labelClass}>
          {t("admin.features.key")}
          <input
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="pro-page-redesign"
            spellCheck={false}
            className={`${inputClass} font-mono`}
          />
          <span className="font-normal text-zinc-500">{t("admin.features.keyHint")}</span>
        </label>
        <label className={labelClass}>
          {t("admin.features.name")}
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("admin.features.namePlaceholder")} className={inputClass} />
        </label>
      </div>
      <label className={labelClass}>
        {t("admin.features.description")}
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className={inputClass} />
      </label>
      <div>
        <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">{t("admin.features.targetLabel")}</span>
        <div className="mt-1 flex flex-wrap gap-2">
          {(["user", "room", "group"] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setTarget(option)}
              aria-pressed={target === option}
              className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
                target === option
                  ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                  : "border-zinc-300 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              }`}
            >
              {t(`admin.features.target.${option}`)}
            </button>
          ))}
        </div>
        <p className="mt-1 text-xs text-zinc-500">{t(`admin.features.targetHint.${target}`)}</p>
        {/* Só aparece para "user", como no editor: uma sala e um grupo não
            têm visitante para incluir. */}
        {target === "user" && (
          <label className="mt-2 flex items-center gap-2 text-xs text-zinc-700 dark:text-zinc-300">
            <input
              type="checkbox"
              checked={includeGuests}
              onChange={(e) => setIncludeGuests(e.target.checked)}
            />
            {t("admin.features.includeGuests")}
          </label>
        )}
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className={labelClass}>
          {t("admin.features.variants")}
          <input value={variants} onChange={(e) => setVariants(e.target.value)} placeholder="on" spellCheck={false} className={`${inputClass} font-mono`} />
          <span className="font-normal text-zinc-500">{t("admin.features.variantsHint")}</span>
        </label>
        <label className={labelClass}>
          {t("admin.features.initialRollout")}
          <input value={rollout} onChange={(e) => setRollout(e.target.value)} inputMode="decimal" className={inputClass} />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={submit} disabled={busy || !key.trim()} className={primaryClass}>
          {busy ? t("common.saving") : t("admin.features.create")}
        </button>
        {error && <span className="text-sm text-red-500">{error}</span>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function FeatureEditor({
  feature,
  clientEvents,
  onChange,
  onDeleted,
}: {
  feature: AdminFeature;
  clientEvents: string[];
  onChange: (feature: AdminFeature) => void;
  onDeleted: () => void;
}) {
  const t = useT();
  const [section, setSection] = useState<"rollout" | "targeting" | "stats" | "tools">("rollout");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const save = useCallback(
    async (patch: FeatureWrite, message?: string) => {
      setBusy(true);
      setError(null);
      setDone(null);
      try {
        onChange(await updateFeature(feature.key, patch));
        setDone(message ?? t("admin.features.saved"));
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [feature.key, onChange, t]
  );

  const sections = [
    { id: "rollout", label: t("admin.features.section.rollout") },
    { id: "targeting", label: t("admin.features.section.targeting") },
    { id: "stats", label: t("admin.features.section.stats") },
    { id: "tools", label: t("admin.features.section.tools") },
  ] as const;

  return (
    <div className="border-t border-zinc-200 px-3 pt-3 pb-3 dark:border-zinc-800">
      {feature.description && <p className="mb-3 text-xs text-zinc-600 dark:text-zinc-400">{feature.description}</p>}
      <div className="mb-3 flex gap-1 overflow-x-auto">
        {sections.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => setSection(entry.id)}
            aria-pressed={section === entry.id}
            className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
              section === entry.id
                ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900"
            }`}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {/* Keyed on the saved rollout so the input starts over from it after a save. */}
      {section === "rollout" && <RolloutSection key={feature.rolloutBp} feature={feature} busy={busy} save={save} onDeleted={onDeleted} />}
      {section === "targeting" && <TargetingSection feature={feature} busy={busy} save={save} />}
      {section === "stats" && <StatsSection feature={feature} clientEvents={clientEvents} onChange={onChange} />}
      {section === "tools" && <ToolsSection feature={feature} />}

      {(done || error) && (
        <p className={`mt-3 text-sm ${error ? "text-red-500" : "text-emerald-600 dark:text-emerald-500"}`}>{error ?? done}</p>
      )}
    </div>
  );
}

type SaveFn = (patch: FeatureWrite, message?: string) => Promise<void>;

function RolloutSection({
  feature,
  busy,
  save,
  onDeleted,
}: {
  feature: AdminFeature;
  busy: boolean;
  save: SaveFn;
  onDeleted: () => void;
}) {
  const t = useT();
  const [value, setValue] = useState(String(feature.rolloutBp / 100));
  const parsed = Number(value.replace(",", "."));
  const valid = Number.isFinite(parsed) && parsed >= 0 && parsed <= 100;
  const changed = valid && Math.round(parsed * 100) !== feature.rolloutBp;

  return (
    <div className="flex flex-col gap-3">
      <div className={cardClass}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">{t("admin.features.rolloutLabel")}</span>
          <span className="text-2xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
            {valid ? percent(Math.round(parsed * 100)) : "—"}
          </span>
        </div>
        <input
          type="range"
          min={0}
          max={100}
          step={0.5}
          value={valid ? parsed : 0}
          onChange={(e) => setValue(e.target.value)}
          className="mt-2 w-full accent-emerald-600"
        />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {STAGES.map((stage) => (
            <button key={stage} type="button" onClick={() => setValue(String(stage))} className={buttonClass}>
              {stage}%
            </button>
          ))}
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            inputMode="decimal"
            className={`${inputClass} w-24`}
            aria-label={t("admin.features.rolloutLabel")}
          />
        </div>
        <p className="mt-2 text-xs text-zinc-500">{t("admin.features.rolloutHint")}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={busy || !changed}
            onClick={() => {
              if (parsed < feature.rolloutBp / 100 && !window.confirm(t("admin.features.confirmLower"))) return;
              void save({ rollout: parsed });
            }}
            className={primaryClass}
          >
            {t("admin.features.applyRollout")}
          </button>
        </div>
      </div>

      <div className={`${cardClass} flex flex-wrap items-center gap-2`}>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            if (feature.enabled && !window.confirm(t("admin.features.confirmKill"))) return;
            void save({ enabled: !feature.enabled });
          }}
          className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition disabled:opacity-50 ${
            feature.enabled
              ? "bg-red-600 text-white hover:bg-red-700"
              : "bg-emerald-600 text-white hover:bg-emerald-700"
          }`}
        >
          {feature.enabled ? t("admin.features.kill") : t("admin.features.revive")}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            if (!window.confirm(t("admin.features.confirmReshuffle"))) return;
            void save({ reshuffle: true }, t("admin.features.reshuffled"));
          }}
          className={buttonClass}
        >
          {t("admin.features.reshuffle")}
        </button>
        <button type="button" disabled={busy} onClick={() => void save({ archived: !feature.archived })} className={buttonClass}>
          {feature.archived ? t("admin.features.unarchive") : t("admin.features.archive")}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            if (!window.confirm(t("admin.features.confirmDelete", { key: feature.key }))) return;
            void deleteFeature(feature.key).then(onDeleted).catch((err: Error) => window.alert(err.message));
          }}
          className="ml-auto flex items-center gap-1 rounded-lg p-1.5 text-xs font-semibold text-red-600 transition hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
        >
          <MdDelete className="h-4 w-4" />
          {t("admin.features.delete")}
        </button>
      </div>

      <div className={cardClass}>
        <h3 className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">{t("admin.features.history")}</h3>
        <ul className="mt-2 flex max-h-48 flex-col gap-1 overflow-y-auto text-xs">
          {[...feature.history].reverse().map((entry, index) => (
            <li key={`${entry.at}-${index}`} className="flex flex-wrap gap-x-3 text-zinc-600 dark:text-zinc-400">
              <span className="tabular-nums">{dateTime(entry.at)}</span>
              <span className="font-medium text-zinc-900 dark:text-zinc-100">
                {entry.enabled ? percent(entry.rolloutBp) : t("admin.features.killed")}
              </span>
              <span>{entry.by}</span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[11px] text-zinc-500">
          {t("admin.features.createdBy", { by: feature.createdBy || "—", when: dateTime(feature.createdAt) })}
        </p>
      </div>
    </div>
  );
}

function TargetingSection({ feature, busy, save }: { feature: AdminFeature; busy: boolean; save: SaveFn }) {
  const t = useT();
  const [name, setName] = useState(feature.name);
  const [description, setDescription] = useState(feature.description);
  const [variants, setVariants] = useState(feature.variants.join(", "));
  const [flags, setFlags] = useState(feature.requiredFlags.join(", "));
  const [platforms, setPlatforms] = useState<FeaturePlatform[]>(feature.platforms);
  const [includeGuests, setIncludeGuests] = useState(feature.includeGuests);
  const [serverOnly, setServerOnly] = useState(feature.serverOnly);
  const [siteEvents, setSiteEvents] = useState((feature.clientEvents ?? []).join(", "));
  const [overrides, setOverrides] = useState<FeatureOverride[]>(feature.overrides);
  const [newId, setNewId] = useState("");
  const [newVariant, setNewVariant] = useState(feature.variants[0] ?? "on");
  const [newNote, setNewNote] = useState("");
  const [resolving, setResolving] = useState(false);
  const [missingIds, setMissingIds] = useState<string[]>([]);

  const variantList = splitList(variants.toLowerCase());
  const variantsChanged = variantList.join(",") !== feature.variants.join(",");
  // Typed shares per treatment name, so editing the list keeps what was typed
  // for the names that stayed.
  const [shares, setShares] = useState<Record<string, string>>(() => {
    const initial = variantShares(feature.variants, feature.weights);
    return Object.fromEntries(feature.variants.map((variant, i) => [variant, roundShare(initial[i])]));
  });
  const evenShare = roundShare(100 / Math.max(1, variantList.length));
  const typedShares = variantList.map((variant) => {
    const value = Number((shares[variant] ?? evenShare).replace(",", "."));
    return Number.isFinite(value) && value >= 0 ? value : 0;
  });
  const sharesTotal = typedShares.reduce((sum, value) => sum + value, 0);
  const savedShares = variantShares(feature.variants, feature.weights);
  const weightsChanged =
    !variantsChanged &&
    typedShares.some((value, i) => Math.abs((value / (sharesTotal || 1)) * 100 - savedShares[i]) > 0.01);

  async function addOverrides() {
    // Several ids at once: pasted from a spreadsheet, a chat, anywhere.
    const tokens = splitList(newId);
    if (tokens.length === 0 || resolving) return;
    const note = newNote.trim();
    let entries: FeatureOverride[] = tokens.map((id) => ({ id, variant: newVariant, note }));
    let missing: string[] = [];
    if (feature.target === "user") {
      // Usernames are welcome here, but what gets stored is the account id:
      // a username can change, the id cannot.
      setResolving(true);
      try {
        const result = await resolveAccountIds(tokens);
        missing = result.missing;
        entries = result.resolved.map(({ id, username }) => ({
          id,
          variant: newVariant,
          note: note || (username ? `@${username}` : ""),
        }));
      } finally {
        setResolving(false);
      }
    }
    const ids = entries.map((entry) => entry.id);
    setOverrides((current) => [...current.filter((entry) => !ids.includes(entry.id)), ...entries]);
    setMissingIds(missing);
    // What could not be found stays in the box to be fixed.
    setNewId(missing.join(" "));
    if (missing.length === 0) setNewNote("");
  }

  return (
    <div className="flex flex-col gap-3">
      <div className={`${cardClass} flex flex-col gap-3`}>
        <label className={labelClass}>
          {t("admin.features.name")}
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
        </label>
        <label className={labelClass}>
          {t("admin.features.description")}
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className={inputClass} />
        </label>
        <label className={labelClass}>
          {t("admin.features.variants")}
          <input value={variants} onChange={(e) => setVariants(e.target.value)} spellCheck={false} className={`${inputClass} font-mono`} />
          <span className="font-normal text-zinc-500">{t("admin.features.variantsHint")}</span>
          {variantsChanged && <span className="font-normal text-amber-600">{t("admin.features.variantsWarning")}</span>}
        </label>

        {variantList.length > 1 && (
          <div>
            <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">{t("admin.features.weights")}</span>
            <div className="mt-1 flex flex-col gap-1.5">
              {variantList.map((variant, i) => {
                const share = sharesTotal ? typedShares[i] / sharesTotal : 0;
                return (
                  <div key={variant} className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="w-24 truncate font-mono font-semibold text-zinc-900 dark:text-zinc-100">{variant}</span>
                    <input
                      value={shares[variant] ?? evenShare}
                      onChange={(e) => setShares((current) => ({ ...current, [variant]: e.target.value }))}
                      inputMode="decimal"
                      className={`${inputClass} w-20 py-1`}
                      aria-label={t("admin.features.weightFor", { variant })}
                    />
                    <span className="text-zinc-500">%</span>
                    <span className="h-1.5 w-24 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
                      <span className="block h-full bg-emerald-500" style={{ width: `${share * 100}%` }} />
                    </span>
                    <span className="text-zinc-500 tabular-nums">
                      {t("admin.features.shareOfTotal", { value: percent(Math.round(share * feature.rolloutBp)) })}
                    </span>
                  </div>
                );
              })}
            </div>
            <p className={`mt-1 text-xs ${Math.abs(sharesTotal - 100) > 0.01 ? "text-amber-600" : "text-zinc-500"}`}>
              {Math.abs(sharesTotal - 100) > 0.01
                ? t("admin.features.weightsNormalized", { total: roundShare(sharesTotal) })
                : t("admin.features.weightsHint")}
            </p>
            <button
              type="button"
              onClick={() => setShares(Object.fromEntries(variantList.map((variant) => [variant, evenShare])))}
              className="mt-1 text-xs text-zinc-500 underline underline-offset-2 hover:text-zinc-800 dark:hover:text-zinc-200"
            >
              {t("admin.features.evenSplit")}
            </button>
          </div>
        )}

        {feature.target === "user" && (
          <>
            <label className={labelClass}>
              {t("admin.features.requiredFlags")}
              <input value={flags} onChange={(e) => setFlags(e.target.value)} placeholder="PRO, BETA_TESTER" spellCheck={false} className={`${inputClass} font-mono`} />
              <span className="font-normal text-zinc-500">{t("admin.features.requiredFlagsHint")}</span>
            </label>
            <label className="flex items-center gap-2 text-xs text-zinc-700 dark:text-zinc-300">
              <input type="checkbox" checked={includeGuests} onChange={(e) => setIncludeGuests(e.target.checked)} />
              {t("admin.features.includeGuests")}
            </label>
          </>
        )}

        <div>
          <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">{t("admin.features.platforms")}</span>
          <div className="mt-1 flex flex-wrap gap-3">
            {PLATFORMS.map((platform) => (
              <label key={platform} className="flex items-center gap-1.5 text-xs text-zinc-700 dark:text-zinc-300">
                <input
                  type="checkbox"
                  checked={platforms.includes(platform)}
                  onChange={(e) =>
                    setPlatforms((current) =>
                      e.target.checked ? [...current, platform] : current.filter((entry) => entry !== platform)
                    )
                  }
                />
                {t(`admin.features.platform.${platform}`)}
              </label>
            ))}
          </div>
          <p className="mt-1 text-xs text-zinc-500">{t("admin.features.platformsHint")}</p>
        </div>

        <label className="flex items-center gap-2 text-xs text-zinc-700 dark:text-zinc-300">
          <input type="checkbox" checked={serverOnly} onChange={(e) => setServerOnly(e.target.checked)} />
          {t("admin.features.serverOnlyLabel")}
        </label>

        {!serverOnly && (
          <label className={labelClass}>
            {t("admin.features.siteEvents")}
            <input
              value={siteEvents}
              onChange={(e) => setSiteEvents(e.target.value)}
              placeholder="theme_toggle, sidebar_open"
              spellCheck={false}
              className={`${inputClass} font-mono`}
            />
            <span className="font-normal text-zinc-500">{t("admin.features.siteEventsHint")}</span>
          </label>
        )}
      </div>

      <div className={cardClass}>
        <h3 className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">{t("admin.features.overrides")}</h3>
        <p className="mt-1 text-xs text-zinc-500">{t(`admin.features.overridesHint.${feature.target}`)}</p>
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto_1fr_auto]">
          <input
            value={newId}
            onChange={(e) => setNewId(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void addOverrides()}
            placeholder={t(feature.target === "user" ? "admin.features.overrideUsers" : "admin.features.overrideIds")}
            spellCheck={false}
            className={`${inputClass} font-mono`}
          />
          <select value={newVariant} onChange={(e) => setNewVariant(e.target.value)} className={inputClass}>
            {variantList.map((variant) => (
              <option key={variant} value={variant}>
                {variant}
              </option>
            ))}
            <option value="off">{t("admin.features.forceOff")}</option>
          </select>
          <input value={newNote} onChange={(e) => setNewNote(e.target.value)} placeholder={t("admin.features.overrideNote")} className={inputClass} />
          <button type="button" onClick={() => void addOverrides()} disabled={!newId.trim() || resolving} className={buttonClass}>
            {resolving ? t("admin.features.resolving") : t("admin.features.add")}
          </button>
        </div>
        {missingIds.length > 0 && (
          <p className="mt-1 text-xs text-red-600">{t("admin.features.overrideNotFound", { names: missingIds.join(", ") })}</p>
        )}
        {overrides.length > 0 && (
          <ul className="mt-2 flex max-h-64 flex-col gap-1 overflow-y-auto">
            {overrides.map((entry) => (
              <li key={entry.id} className="flex items-center gap-2 rounded-md bg-zinc-50 px-2 py-1 text-xs dark:bg-zinc-900">
                <span className="min-w-0 flex-1 truncate font-mono">{entry.id}</span>
                <Pill tone={entry.variant === "off" ? "red" : "green"}>{entry.variant}</Pill>
                {entry.note && <span className="hidden max-w-[40%] truncate text-zinc-500 sm:inline">{entry.note}</span>}
                <button
                  type="button"
                  onClick={() => setOverrides((current) => current.filter((item) => item.id !== entry.id))}
                  aria-label={t("admin.features.remove")}
                  className="rounded p-0.5 text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-800"
                >
                  <MdClose className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            if (variantsChanged && !window.confirm(t("admin.features.variantsWarning"))) return;
            if (weightsChanged && !window.confirm(t("admin.features.weightsWarning"))) return;
            if (variantList.length > 1 && sharesTotal <= 0) return;
            const nextSiteEvents = splitList(siteEvents.toLowerCase());
            const addedSiteEvents = nextSiteEvents.filter(
              (event) => !(feature.clientEvents ?? []).includes(event) && !(feature.pinnedEvents ?? []).includes(event)
            );
            void save({
              name: name.trim(),
              description: description.trim(),
              variants: variantList,
              weights: variantList.length > 1 ? typedShares : [],
              requiredFlags: splitList(flags.toUpperCase()),
              platforms,
              includeGuests,
              serverOnly,
              clientEvents: nextSiteEvents,
              // A site event added here is one this feature exists to measure,
              // so it starts pinned in its stats. Only the newly added ones:
              // an event somebody already unpinned stays unpinned.
              ...(addedSiteEvents.length > 0 && (feature.pinnedEvents ?? []).length > 0
                ? { pinnedEvents: [...(feature.pinnedEvents ?? []), ...addedSiteEvents] }
                : {}),
              // Overrides naming a treatment that no longer exists fall back
              // to the first one rather than failing the whole save.
              overrides: overrides.map((entry) =>
                entry.variant === "off" || variantList.includes(entry.variant)
                  ? entry
                  : { ...entry, variant: variantList[0] ?? "on" }
              ),
            });
          }}
          className={primaryClass}
        >
          {busy ? t("common.saving") : t("admin.features.saveTargeting")}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stats

/** Standard normal CDF (Abramowitz–Stegun 7.1.26). */
function normalCdf(z: number): number {
  const x = Math.abs(z) / Math.SQRT2;
  const tt = 1 / (1 + 0.3275911 * x);
  const erf =
    1 - ((((1.061405429 * tt - 1.453152027) * tt + 1.421413741) * tt - 0.284496736) * tt + 0.254829592) * tt * Math.exp(-x * x);
  return z >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}

/**
 * How sure we can be that two conversion rates really differ — a
 * two-proportion z-test. Null when there is too little data to say.
 */
function confidence(hitsA: number, sizeA: number, hitsB: number, sizeB: number): number | null {
  if (sizeA < 30 || sizeB < 30) return null;
  const pooled = (hitsA + hitsB) / (sizeA + sizeB);
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / sizeA + 1 / sizeB));
  if (!se) return null;
  const z = (hitsA / sizeA - hitsB / sizeB) / se;
  return 2 * normalCdf(Math.abs(z)) - 1;
}

// How far back an export reaches, whatever the panel is showing: a file is
// read later and elsewhere, so it carries the long view rather than whichever
// range happened to be selected.
const EXPORT_DAYS = 90;

function isMoney(event: string): boolean {
  return event.includes("purchase");
}

function StatsSection({
  feature,
  clientEvents,
  onChange,
}: {
  feature: AdminFeature;
  clientEvents: string[];
  onChange: (feature: AdminFeature) => void;
}) {
  const t = useT();
  const [pinning, setPinning] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [stats, setStats] = useState<FeatureStats | null>(null);
  const [days, setDays] = useState(14);
  const [dailyEvent, setDailyEvent] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    void fetchFeatureStats(feature.key, days)
      .then((data) => {
        setStats(data);
        setError(null);
      })
      .catch((err: Error) => setError(err.message));
  }, [feature.key, days]);

  useEffect(load, [load]);

  // Control first, then the treatments in their configured order, then any
  // group that only exists in old numbers (a treatment since removed).
  const groups = useMemo(() => {
    if (!stats) return [];
    const ordered = ["control", ...feature.variants, ...Object.keys(stats.groups)];
    return ordered.filter((name, index) => ordered.indexOf(name) === index);
  }, [stats, feature.variants]);

  // Pinned events are what the experiment is about (purchases on the /pro
  // page), so they come first — even before any traffic, as an empty table.
  // Everything else still counts; it is just folded away below them.
  //
  // A feature with nothing pinned yet shows its own site events as pinned:
  // they are what it was set up to measure. The first star clicked then saves
  // that list for real (see togglePin), and from there it is what is stored.
  const pinned = useMemo(() => {
    const stored = feature.pinnedEvents ?? [];
    return (stored.length > 0 ? stored : feature.clientEvents ?? []).filter((event) => event !== TIP_CLICK_EVENT);
  }, [feature.pinnedEvents, feature.clientEvents]);
  // The "recurso novo" tooltip's click (see lib/clipsMode) is shown as a count
  // beside "Exposições" rather than as a table: whether the tip worked is a
  // question every feature has. Still offered in the daily chart below.
  const tipClicks = Boolean(stats?.events[TIP_CLICK_EVENT]);
  const tipClickCount = Object.values(stats?.events[TIP_CLICK_EVENT] ?? {}).reduce(
    (sum, entry) => sum + (entry?.count ?? 0),
    0
  );
  const others = stats
    ? Object.keys(stats.events).filter((event) => !pinned.includes(event) && event !== TIP_CLICK_EVENT)
    : [];
  const events = [...(tipClicks ? [TIP_CLICK_EVENT] : []), ...pinned, ...others];

  const togglePin = (event: string) => {
    if (pinning) return;
    const next = pinned.includes(event) ? pinned.filter((name) => name !== event) : [...pinned, event];
    setPinning(true);
    void updateFeature(feature.key, { pinnedEvents: next })
      .then(onChange)
      .catch((err: Error) => setError(err.message))
      .finally(() => setPinning(false));
  };
  const eventTable = (event: string, data: FeatureStats) => (
    <EventTable
      key={event}
      event={event}
      groups={groups}
      stats={data}
      pinned={pinned.includes(event)}
      onTogglePin={pinning ? undefined : () => togglePin(event)}
    />
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={load} className={`${buttonClass} flex items-center gap-1`}>
          <MdRefresh className="h-4 w-4" />
          {t("admin.features.refresh")}
        </button>
        <button
          type="button"
          disabled={exporting}
          onClick={() => {
            setExporting(true);
            exportFeatureStats([feature], EXPORT_DAYS)
              .then(() => setError(null))
              .catch((err: Error) => setError(err.message))
              .finally(() => setExporting(false));
          }}
          className={`${buttonClass} flex items-center gap-1 disabled:opacity-50`}
        >
          <MdDownload className="h-4 w-4" />
          {exporting ? t("admin.features.exporting") : t("admin.features.exportStats")}
        </button>
        <button
          type="button"
          onClick={() => {
            if (!window.confirm(t("admin.features.confirmResetStats"))) return;
            void resetFeatureStats(feature.key).then(load).catch((err: Error) => setError(err.message));
          }}
          className={buttonClass}
        >
          {t("admin.features.resetStats")}
        </button>
        {error && <span className="text-sm text-red-500">{error}</span>}
      </div>

      {stats && (
        <>
          <div className={`${cardClass} overflow-x-auto`}>
            <div className="flex items-center gap-2">
              <h3 className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">{t("admin.features.exposures")}</h3>
              {/* The "recurso novo" tooltip's clicks (see lib/clipsMode), all
                  groups together. Every feature gets it: the event is built in
                  on the API, so none has to list it in its site events. */}
              <span
                title={t("admin.features.tipClickHint")}
                aria-label={`${t("admin.features.tipClickBadge")}: ${number(tipClickCount)}`}
                className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-blue-600 px-1.5 text-[11px] font-semibold tabular-nums text-white"
              >
                {number(tipClickCount)}
              </span>
            </div>
            <table className="mt-2 w-full text-xs tabular-nums">
              <thead>
                <tr className="text-left text-zinc-500">
                  <th className="py-1 pr-3 font-medium">{t("admin.features.group")}</th>
                  <th className="py-1 pr-3 text-right font-medium">{t("admin.features.uniqueExposed")}</th>
                  <th className="py-1 pr-3 text-right font-medium">{t("admin.features.totalExposures")}</th>
                  <th className="py-1 text-right font-medium">{t("admin.features.share")}</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((group) => {
                  const entry = stats.groups[group] ?? { exposures: 0, uniqueExposures: 0 };
                  const total = groups.reduce((sum, name) => sum + (stats.groups[name]?.uniqueExposures ?? 0), 0);
                  return (
                    <tr key={group} className="border-t border-zinc-100 dark:border-zinc-900">
                      <td className="py-1 pr-3">
                        <GroupName group={group} />
                      </td>
                      <td className="py-1 pr-3 text-right">{number(entry.uniqueExposures)}</td>
                      <td className="py-1 pr-3 text-right">{number(entry.exposures)}</td>
                      <td className="py-1 text-right">
                        {total ? `${((entry.uniqueExposures / total) * 100).toFixed(1)}%` : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="mt-2 text-[11px] text-zinc-500">{t("admin.features.exposuresHint")}</p>
          </div>

          {stats.events[PARTNER_EVENTS.impression] && <PartnerCtrTable groups={groups} stats={stats} />}

          {stats.skipped && Object.keys(stats.skipped).length > 0 && (
            <div className={`${cardClass} text-xs`}>
              <h3 className="font-semibold text-zinc-700 dark:text-zinc-300">{t("admin.features.skippedTitle")}</h3>
              <p className="mt-1 text-zinc-500">{t("admin.features.skippedHint")}</p>
              <ul className="mt-2 flex flex-col gap-0.5">
                {Object.entries(stats.skipped).map(([event, reasons]) => (
                  <li key={event} className="flex flex-wrap gap-x-3">
                    <span className="font-mono font-semibold text-zinc-900 dark:text-zinc-100">{event}</span>
                    {Object.entries(reasons).map(([reason, count]) => (
                      <span key={reason} className="text-zinc-600 dark:text-zinc-400">
                        {t(`admin.features.reason.${reason}`)}: {number(count)}
                      </span>
                    ))}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {events.length === 0 ? (
            <p className={`${cardClass} text-xs text-zinc-500`}>{t("admin.features.noEvents")}</p>
          ) : pinned.length === 0 && others.length === 0 ? null : pinned.length === 0 ? (
            <>
              <p className="text-[11px] text-zinc-500">{t("admin.features.pinHint")}</p>
              {others.map((event) => eventTable(event, stats))}
            </>
          ) : (
            <>
              {pinned.map((event) => eventTable(event, stats))}
              {others.length > 0 && (
                <details>
                  <summary className="cursor-pointer text-xs font-semibold text-zinc-600 dark:text-zinc-400">
                    {t("admin.features.otherEvents", { count: others.length })}
                  </summary>
                  <div className="mt-3 flex flex-col gap-3">{others.map((event) => eventTable(event, stats))}</div>
                </details>
              )}
            </>
          )}

          <div className={`${cardClass} overflow-x-auto`}>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">{t("admin.features.daily")}</h3>
              <select value={days} onChange={(e) => setDays(Number(e.target.value))} className={`${inputClass} w-auto py-1 text-xs`}>
                {[7, 14, 30, 90].map((value) => (
                  <option key={value} value={value}>
                    {t("admin.features.lastDays", { count: value })}
                  </option>
                ))}
              </select>
              <select value={dailyEvent} onChange={(e) => setDailyEvent(e.target.value)} className={`${inputClass} w-auto py-1 text-xs`}>
                <option value="">{t("admin.features.exposures")}</option>
                {events.map((event) => (
                  <option key={event} value={event}>
                    {event}
                  </option>
                ))}
              </select>
            </div>
            <DailyChart stats={stats} groups={groups} event={dailyEvent || null} />
          </div>
        </>
      )}

      <details className={cardClass}>
        <summary className="cursor-pointer text-xs font-semibold text-zinc-700 dark:text-zinc-300">
          {t("admin.features.howToMeasure")}
        </summary>
        <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">{t("admin.features.howToMeasureBody")}</p>
        <pre className="mt-2 overflow-x-auto rounded-md bg-zinc-100 p-2 text-[11px] dark:bg-zinc-900">{codeSample(feature)}</pre>
        <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">
          {t("admin.features.builtInEvents")} <code>pro_checkout</code>, <code>pro_purchase</code>, <code>pro_first_purchase</code>.
        </p>
        <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
          {t("admin.features.clientEvents")} {clientEvents.map((event) => <code key={event} className="mr-1">{event}</code>)}
        </p>
      </details>
    </div>
  );
}

function GroupName({ group }: { group: string }) {
  const t = useT();
  return group === "control" ? (
    <span className="text-zinc-500">{t("admin.features.control")}</span>
  ) : (
    <span className="font-mono font-semibold text-zinc-900 dark:text-zinc-100">{group}</span>
  );
}

function EventTable({
  event,
  groups,
  stats,
  pinned,
  onTogglePin,
}: {
  event: string;
  groups: string[];
  stats: FeatureStats;
  pinned: boolean;
  onTogglePin?: () => void;
}) {
  const t = useT();
  const control = stats.groups.control?.uniqueExposures ?? 0;
  const controlHits = stats.events[event]?.control?.unique ?? 0;
  const controlRate = control ? controlHits / control : null;

  return (
    <div
      className={`${cardClass} overflow-x-auto ${pinned ? "ring-1 ring-amber-400/60" : ""}`}
    >
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={onTogglePin}
          disabled={!onTogglePin}
          aria-pressed={pinned}
          title={t(pinned ? "admin.features.unpinEvent" : "admin.features.pinEvent")}
          aria-label={t(pinned ? "admin.features.unpinEvent" : "admin.features.pinEvent")}
          className="rounded p-0.5 text-amber-500 transition hover:bg-zinc-100 disabled:opacity-50 dark:hover:bg-zinc-800"
        >
          {pinned ? <MdStar className="h-4 w-4" /> : <MdStarBorder className="h-4 w-4 text-zinc-400" />}
        </button>
        <h3 className="font-mono text-xs font-semibold text-zinc-700 dark:text-zinc-300">{event}</h3>
      </div>
      <table className="mt-2 w-full text-xs tabular-nums">
        <thead>
          <tr className="text-left text-zinc-500">
            <th className="py-1 pr-3 font-medium">{t("admin.features.group")}</th>
            <th className="py-1 pr-3 text-right font-medium">{t("admin.features.uniqueWithEvent")}</th>
            <th className="py-1 pr-3 text-right font-medium">{t("admin.features.rate")}</th>
            <th className="py-1 pr-3 text-right font-medium">{t("admin.features.vsControl")}</th>
            <th className="py-1 pr-3 text-right font-medium">{t("admin.features.confidence")}</th>
            <th className="py-1 pr-3 text-right font-medium">{t("admin.features.count")}</th>
            <th className="py-1 text-right font-medium">{t("admin.features.value")}</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => {
            const entry = stats.events[event]?.[group] ?? { count: 0, unique: 0, value: 0 };
            const exposed = stats.groups[group]?.uniqueExposures ?? 0;
            const rate = exposed ? entry.unique / exposed : null;
            const lift = group !== "control" && rate !== null && controlRate ? rate / controlRate - 1 : null;
            const conf = group !== "control" ? confidence(entry.unique, exposed, controlHits, control) : null;
            return (
              <tr key={group} className="border-t border-zinc-100 dark:border-zinc-900">
                <td className="py-1 pr-3">
                  <GroupName group={group} />
                </td>
                <td className="py-1 pr-3 text-right">{number(entry.unique)}</td>
                <td className="py-1 pr-3 text-right">{rate === null ? "—" : `${(rate * 100).toFixed(2)}%`}</td>
                <td
                  className={`py-1 pr-3 text-right font-semibold ${
                    lift === null ? "" : lift > 0 ? "text-emerald-600 dark:text-emerald-400" : lift < 0 ? "text-red-600 dark:text-red-400" : ""
                  }`}
                >
                  {lift === null ? "—" : `${lift > 0 ? "+" : ""}${(lift * 100).toFixed(1)}%`}
                </td>
                <td className="py-1 pr-3 text-right" title={t("admin.features.confidenceHint")}>
                  {conf === null ? "—" : (
                    <span className={conf >= 0.95 ? "font-semibold text-emerald-600 dark:text-emerald-400" : "text-zinc-500"}>
                      {(conf * 100).toFixed(0)}%
                    </span>
                  )}
                </td>
                <td className="py-1 pr-3 text-right">{number(entry.count)}</td>
                <td className="py-1 text-right">
                  {isMoney(event)
                    ? (entry.value / 100).toLocaleString(formatLocale(), { style: "currency", currency: "BRL" })
                    : number(entry.value)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-2 text-[11px] text-zinc-500">{t("admin.features.rateHint")}</p>
    </div>
  );
}

// Click-through for the partner ads (see lib/partnerExperiment), per group.
// The event tables above divide by *people* exposed; an ad's CTR divides by
// times shown, which needs two events' counts put side by side — and the
// confidence is the same two-proportion test, run on impressions instead.
function PartnerCtrTable({ groups, stats }: { groups: string[]; stats: FeatureStats }) {
  const t = useT();
  const count = (event: string, group: string) => stats.events[event]?.[group]?.count ?? 0;
  const controlClicks = count(PARTNER_EVENTS.click, "control");
  const controlImpressions = count(PARTNER_EVENTS.impression, "control");
  const controlCtr = controlImpressions ? controlClicks / controlImpressions : null;
  const pct = (value: number | null, digits = 2) => (value === null ? "—" : `${(value * 100).toFixed(digits)}%`);

  return (
    <div className={`${cardClass} overflow-x-auto ring-1 ring-emerald-500/40`}>
      <h3 className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">{t("admin.features.partnerCtrTitle")}</h3>
      <table className="mt-2 w-full text-xs tabular-nums">
        <thead>
          <tr className="text-left text-zinc-500">
            <th className="py-1 pr-3 font-medium">{t("admin.features.group")}</th>
            <th className="py-1 pr-3 text-right font-medium">{t("admin.features.partnerImpressions")}</th>
            <th className="py-1 pr-3 text-right font-medium">{t("admin.features.partnerSessionViews")}</th>
            <th className="py-1 pr-3 text-right font-medium">{t("admin.features.partnerClicks")}</th>
            <th className="py-1 pr-3 text-right font-medium">{t("admin.features.partnerCtr")}</th>
            <th className="py-1 pr-3 text-right font-medium">{t("admin.features.partnerCtrPerView")}</th>
            <th className="py-1 pr-3 text-right font-medium">{t("admin.features.vsControl")}</th>
            <th className="py-1 text-right font-medium">{t("admin.features.confidence")}</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => {
            const impressions = count(PARTNER_EVENTS.impression, group);
            const views = count(PARTNER_EVENTS.sessionView, group);
            const clicks = count(PARTNER_EVENTS.click, group);
            const ctr = impressions ? clicks / impressions : null;
            const perView = views ? clicks / views : null;
            const lift = group !== "control" && ctr !== null && controlCtr ? ctr / controlCtr - 1 : null;
            const conf = group !== "control" ? confidence(clicks, impressions, controlClicks, controlImpressions) : null;
            return (
              <tr key={group} className="border-t border-zinc-100 dark:border-zinc-900">
                <td className="py-1 pr-3">
                  <GroupName group={group} />
                </td>
                <td className="py-1 pr-3 text-right">{number(impressions)}</td>
                <td className="py-1 pr-3 text-right">{number(views)}</td>
                <td className="py-1 pr-3 text-right">{number(clicks)}</td>
                <td className="py-1 pr-3 text-right font-semibold">{pct(ctr)}</td>
                <td className="py-1 pr-3 text-right">{pct(perView)}</td>
                <td
                  className={`py-1 pr-3 text-right font-semibold ${
                    lift === null ? "" : lift > 0 ? "text-emerald-600 dark:text-emerald-400" : lift < 0 ? "text-red-600 dark:text-red-400" : ""
                  }`}
                >
                  {lift === null ? "—" : `${lift > 0 ? "+" : ""}${(lift * 100).toFixed(1)}%`}
                </td>
                <td className="py-1 text-right" title={t("admin.features.confidenceHint")}>
                  {conf === null ? "—" : (
                    <span className={conf >= 0.95 ? "font-semibold text-emerald-600 dark:text-emerald-400" : "text-zinc-500"}>
                      {(conf * 100).toFixed(0)}%
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-2 text-[11px] text-zinc-500">{t("admin.features.partnerCtrHint")}</p>
    </div>
  );
}

const GROUP_COLORS = ["#71717a", "#10b981", "#3b82f6", "#f59e0b", "#ec4899", "#8b5cf6", "#14b8a6", "#ef4444", "#84cc16"];

function DailyChart({ stats, groups, event }: { stats: FeatureStats; groups: string[]; event: string | null }) {
  const t = useT();
  const series = groups.map((group) =>
    stats.daily.map((day) => (event ? day.events[event]?.[group] ?? 0 : day.exposures[group] ?? 0))
  );
  const max = Math.max(1, ...series.flat());
  const width = 600;
  const height = 140;
  const step = stats.daily.length > 1 ? width / (stats.daily.length - 1) : width;
  const y = (value: number) => height - (value / max) * (height - 8) - 4;

  return (
    <div className="mt-3">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-36 w-full" preserveAspectRatio="none" role="img" aria-label={t("admin.features.daily")}>
        {[0.25, 0.5, 0.75].map((fraction) => (
          <line key={fraction} x1={0} x2={width} y1={y(max * fraction)} y2={y(max * fraction)} stroke="currentColor" className="text-zinc-200 dark:text-zinc-800" strokeWidth={1} />
        ))}
        {series.map((points, index) => (
          <polyline
            key={groups[index]}
            fill="none"
            stroke={GROUP_COLORS[index % GROUP_COLORS.length]}
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
            points={points.map((value, i) => `${i * step},${y(value)}`).join(" ")}
          />
        ))}
      </svg>
      <div className="mt-1 flex justify-between text-[10px] text-zinc-500 tabular-nums">
        <span>{stats.daily[0]?.day.slice(5)}</span>
        <span>{t("admin.features.max", { value: number(max) })}</span>
        <span>{stats.daily[stats.daily.length - 1]?.day.slice(5)}</span>
      </div>
      <div className="mt-2 flex flex-wrap gap-3 text-xs">
        {groups.map((group, index) => (
          <span key={group} className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ background: GROUP_COLORS[index % GROUP_COLORS.length] }} />
            <GroupName group={group} />
            <span className="text-zinc-500 tabular-nums">{number(series[index].reduce((a, b) => a + b, 0))}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function codeSample(feature: AdminFeature): string {
  const option = feature.target === "room" ? ", { room: roomHandle }" : feature.target === "group" ? ", { group: groupId }" : "";
  const id = feature.target === "user" ? "accountId" : feature.target === "room" ? "roomHandle" : "groupId";
  const multi = feature.variants.length > 1;
  return [
    "// Site (React)",
    `const { ${multi ? "variant" : "enabled"}, ready } = useFeature("${feature.key}"${option});`,
    feature.target === "user" ? `trackFeatureEvent("pro_plan_click");` : `trackFeatureEvent("share_start"${option});`,
    "",
    "// API",
    `${multi ? `featureVariant` : `featureEnabled`}("${feature.key}", ${id});`,
    `trackFeatureEvent("my_event", { ${feature.target}: ${id} }, { value: 1 });`,
  ].join("\n");
}

// ---------------------------------------------------------------------------

function ToolsSection({ feature }: { feature: AdminFeature }) {
  const t = useT();
  const [id, setId] = useState("");
  const [platform, setPlatform] = useState("");
  const [guest, setGuest] = useState(false);
  const [result, setResult] = useState<FeatureCheck | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [local, setLocal] = useState<string>(() => getLocalFeatureOverrides()[feature.key] ?? "");

  return (
    <div className="flex flex-col gap-3">
      <div className={cardClass}>
        <h3 className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">{t("admin.features.checkTitle")}</h3>
        <p className="mt-1 text-xs text-zinc-500">{t(`admin.features.overridesHint.${feature.target}`)}</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input value={id} onChange={(e) => setId(e.target.value)} placeholder="id" spellCheck={false} className={`${inputClass} w-64 max-w-full font-mono`} />
          <select value={platform} onChange={(e) => setPlatform(e.target.value)} className={`${inputClass} w-auto`}>
            <option value="">{t("admin.features.anyPlatform")}</option>
            {PLATFORMS.map((entry) => (
              <option key={entry} value={entry}>
                {t(`admin.features.platform.${entry}`)}
              </option>
            ))}
          </select>
          {feature.target === "user" && (
            <label className="flex items-center gap-1.5 text-xs text-zinc-700 dark:text-zinc-300">
              <input type="checkbox" checked={guest} onChange={(e) => setGuest(e.target.checked)} />
              {t("admin.features.isGuest")}
            </label>
          )}
          <button
            type="button"
            disabled={!id.trim()}
            onClick={() => {
              setError(null);
              void checkFeature(feature.key, id.trim(), platform || undefined, guest)
                .then(setResult)
                .catch((err: Error) => setError(err.message));
            }}
            className={buttonClass}
          >
            {t("admin.features.check")}
          </button>
        </div>
        {error && <p className="mt-2 text-sm text-red-500">{error}</p>}
        {result && (
          <p className="mt-2 text-sm">
            {result.variant ? (
              <Pill tone="green">{result.variant}</Pill>
            ) : (
              <Pill>{t("admin.features.doesNotHave")}</Pill>
            )}{" "}
            <span className="text-xs text-zinc-500">{t(`admin.features.reason.${result.reason}`)}</span>
          </p>
        )}
      </div>

      <div className={cardClass}>
        <h3 className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">{t("admin.features.localTitle")}</h3>
        <p className="mt-1 text-xs text-zinc-500">{t("admin.features.localHint")}</p>
        <select
          value={local}
          onChange={(e) => {
            setLocal(e.target.value);
            setLocalFeatureOverride(feature.key, e.target.value || null);
          }}
          className={`${inputClass} mt-2 w-auto`}
        >
          <option value="">{t("admin.features.localDefault")}</option>
          {feature.variants.map((variant) => (
            <option key={variant} value={variant}>
              {variant}
            </option>
          ))}
          <option value="off">{t("admin.features.forceOff")}</option>
        </select>
        {feature.serverOnly && <p className="mt-1 text-xs text-amber-600">{t("admin.features.localServerOnly")}</p>}
      </div>

      <div className={cardClass}>
        <h3 className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">{t("admin.features.technical")}</h3>
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
          <dt className="text-zinc-500">salt</dt>
          <dd className="font-mono break-all">{feature.salt}</dd>
          <dt className="text-zinc-500">{t("admin.features.updated")}</dt>
          <dd>{dateTime(feature.updatedAt)}</dd>
        </dl>
      </div>
    </div>
  );
}
