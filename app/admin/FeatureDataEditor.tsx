"use client";

import { MdAdd, MdClose } from "react-icons/md";
import { useT } from "@/lib/useI18n";

// The admin's editor for a feature's data (the API's FeatureDataConfig): one
// JSON box for everybody in the experiment, one per treatment, and a list of
// options drawn by percentage. Boxes hold text, so a half-typed value survives
// until it parses; buildFeatureData is what turns them into what gets saved.

export interface FeatureDataDraft {
  general: string;
  variants: Record<string, string>;
  split: { name: string; weight: string; data: string }[];
  public: string;
}

const pretty = (value: unknown) => (value ? JSON.stringify(value, null, 2) : "");

export function featureDataDraft(data: Record<string, unknown> | undefined): FeatureDataDraft {
  const variants = (data?.variants ?? {}) as Record<string, unknown>;
  const split = (data?.split ?? []) as { name: string; weight: number; data: unknown }[];
  return {
    general: pretty(data?.general),
    variants: Object.fromEntries(Object.entries(variants).map(([name, value]) => [name, pretty(value)])),
    split: split.map((option) => ({ name: option.name, weight: String(option.weight), data: pretty(option.data) })),
    public: pretty(data?.public),
  };
}

/** A box's object, {} when empty, or null when it does not hold an object. */
function parseBox(text: string): Record<string, unknown> | null {
  if (!text.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const parseWeight = (text: string) => {
  const value = Number(text.replace(",", "."));
  return text.trim() && Number.isFinite(value) && value >= 0 ? value : null;
};

/**
 * What gets saved, or null while something is invalid. Only the treatments that
 * exist: the API refuses data for one that was renamed or removed.
 */
export function buildFeatureData(draft: FeatureDataDraft, variants: string[]): Record<string, unknown> | null {
  const general = parseBox(draft.general);
  const publicData = parseBox(draft.public);
  if (!publicData) return null;
  const byVariant = variants.map((name) => [name, parseBox(draft.variants[name] ?? "")] as const);
  const split = draft.split.map((option) => ({
    name: option.name.trim(),
    weight: parseWeight(option.weight),
    data: parseBox(option.data),
  }));
  if (!general || byVariant.some(([, value]) => !value)) return null;
  if (split.some((option) => !option.name || option.weight === null || !option.data)) return null;
  if (split.length > 0 && !split.some((option) => (option.weight ?? 0) > 0)) return null;
  const filled = byVariant.filter(([, value]) => Object.keys(value ?? {}).length > 0);
  return {
    ...(Object.keys(general).length > 0 ? { general } : {}),
    ...(filled.length > 0 ? { variants: Object.fromEntries(filled) } : {}),
    ...(split.length > 0 ? { split } : {}),
    ...(Object.keys(publicData).length > 0 ? { public: publicData } : {}),
  };
}

function JsonBox({ value, onChange, placeholder }: { value: string; onChange: (next: string) => void; placeholder: string }) {
  const t = useT();
  return (
    <>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={Math.min(8, Math.max(2, value.split("\n").length))}
        spellCheck={false}
        placeholder={placeholder}
        className="w-full rounded-lg border border-zinc-300 bg-white px-2 py-1.5 font-mono text-xs dark:border-zinc-700 dark:bg-zinc-900"
      />
      {!parseBox(value) && <span className="text-xs text-red-500">{t("admin.features.dataInvalid")}</span>}
    </>
  );
}

export function FeatureDataEditor({
  draft,
  onChange,
  variants,
}: {
  draft: FeatureDataDraft;
  onChange: (next: FeatureDataDraft) => void;
  variants: string[];
}) {
  const t = useT();
  const placeholder = '{ "priceCents": 699 }';
  const total = draft.split.reduce((sum, option) => sum + (parseWeight(option.weight) ?? 0), 0);
  const setOption = (index: number, patch: Partial<FeatureDataDraft["split"][number]>) =>
    onChange({ ...draft, split: draft.split.map((option, i) => (i === index ? { ...option, ...patch } : option)) });
  const heading = "text-xs font-medium text-zinc-700 dark:text-zinc-300";
  const hint = "text-xs text-zinc-500 dark:text-zinc-400";

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
      <div>
        <p className={heading}>{t("admin.features.data")}</p>
        <p className={hint}>{t("admin.features.dataHint")}</p>
      </div>

      <div className="flex flex-col gap-1">
        <p className={heading}>{t("admin.features.dataGeneral")}</p>
        <JsonBox value={draft.general} placeholder={placeholder} onChange={(general) => onChange({ ...draft, general })} />
      </div>

      {variants.map((name) => (
        <div key={name} className="flex flex-col gap-1">
          <p className={heading}>
            {t("admin.features.dataVariant")} <code>{name}</code>
          </p>
          <JsonBox
            value={draft.variants[name] ?? ""}
            placeholder={placeholder}
            onChange={(text) => onChange({ ...draft, variants: { ...draft.variants, [name]: text } })}
          />
        </div>
      ))}

      <div className="flex flex-col gap-1">
        <p className={heading}>{t("admin.features.dataPublic")}</p>
        <p className={hint}>{t("admin.features.dataPublicHint")}</p>
        <JsonBox value={draft.public} placeholder='{ "minMinutes": 10 }' onChange={(text) => onChange({ ...draft, public: text })} />
      </div>

      <div className="flex flex-col gap-2">
        <div>
          <p className={heading}>{t("admin.features.dataSplit")}</p>
          <p className={hint}>{t("admin.features.dataSplitHint")}</p>
        </div>
        {draft.split.map((option, index) => {
          const weight = parseWeight(option.weight);
          return (
            <div key={index} className="flex flex-col gap-1 rounded-lg bg-zinc-50 p-2 dark:bg-zinc-900/50">
              <div className="flex items-center gap-2">
                <input
                  value={option.name}
                  onChange={(e) => setOption(index, { name: e.target.value })}
                  aria-label={t("admin.features.dataSplitName")}
                  placeholder={t("admin.features.dataSplitName")}
                  className="min-w-0 flex-1 rounded-lg border border-zinc-300 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900"
                />
                <input
                  value={option.weight}
                  onChange={(e) => setOption(index, { weight: e.target.value })}
                  inputMode="decimal"
                  aria-label={t("admin.features.dataSplitShare")}
                  className={`w-16 rounded-lg border bg-white px-2 py-1 text-right text-xs dark:bg-zinc-900 ${
                    weight === null ? "border-red-500" : "border-zinc-300 dark:border-zinc-700"
                  }`}
                />
                <span className={hint}>%</span>
                <button
                  type="button"
                  onClick={() => onChange({ ...draft, split: draft.split.filter((_, i) => i !== index) })}
                  aria-label={t("admin.features.dataSplitRemove")}
                  className="cursor-pointer rounded p-1 text-zinc-400 hover:text-red-500"
                >
                  <MdClose className="h-4 w-4" />
                </button>
              </div>
              <JsonBox value={option.data} placeholder={placeholder} onChange={(data) => setOption(index, { data })} />
            </div>
          );
        })}
        {draft.split.length > 0 && Math.abs(total - 100) > 0.01 && (
          <p className="text-xs text-amber-600">{t("admin.features.dataSplitTotal", { total: String(total) })}</p>
        )}
        <button
          type="button"
          onClick={() =>
            onChange({
              ...draft,
              split: [
                ...draft.split,
                { name: `${t("admin.features.dataSplitName")} ${draft.split.length + 1}`, weight: String(Math.max(0, 100 - Math.round(total))), data: "" },
              ],
            })
          }
          className="flex w-fit cursor-pointer items-center gap-1 rounded-lg border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          <MdAdd className="h-4 w-4" />
          {t("admin.features.dataSplitAdd")}
        </button>
      </div>
    </div>
  );
}
