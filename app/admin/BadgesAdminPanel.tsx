"use client";

import { useEffect, useState, type FormEvent } from "react";
import { MdArrowDownward, MdArrowUpward, MdDelete, MdEdit } from "react-icons/md";
import {
  createAdminBadge,
  deleteAdminBadge,
  fetchAdminBadges,
  reorderAdminBadges,
  updateAdminBadge,
  type AdminBadgeInput,
} from "@/lib/adminApi";
import { DEFAULT_BADGES, fetchBadgesCatalog, type BadgeDefinition } from "@/lib/badges";
import { useT } from "@/lib/useI18n";

// Profile badges: creating new ones and choosing the order a profile shows
// them in (see the API's adminBadgeRoutes.ts). Who has a badge is decided by
// its flag (given in the flags panel) or its plan.
//
// Colours are presets rather than free class names: Tailwind only generates
// classes it finds written in the site's source, so each preset is spelled
// out in full below — a class typed into a box would render as nothing.

const COLOR_PRESETS = {
  rose: {
    chipClass: "border-rose-500/30 bg-rose-500/10 text-rose-600 hover:bg-rose-500/20 dark:border-rose-500/40 dark:bg-rose-500/15 dark:text-rose-400",
    bgClass: "bg-rose-500/15",
    textClass: "text-rose-500",
    borderClass: "border-rose-500/30",
  },
  orange: {
    chipClass: "border-orange-500/30 bg-orange-500/10 text-orange-600 hover:bg-orange-500/20 dark:border-orange-500/40 dark:bg-orange-500/15 dark:text-orange-400",
    bgClass: "bg-orange-500/15",
    textClass: "text-orange-500",
    borderClass: "border-orange-500/30",
  },
  amber: {
    chipClass: "border-amber-500/30 bg-amber-500/10 text-amber-600 hover:bg-amber-500/20 dark:border-amber-500/40 dark:bg-amber-500/15 dark:text-amber-400",
    bgClass: "bg-amber-500/15",
    textClass: "text-amber-500",
    borderClass: "border-amber-500/30",
  },
  lime: {
    chipClass: "border-lime-500/30 bg-lime-500/10 text-lime-600 hover:bg-lime-500/20 dark:border-lime-500/40 dark:bg-lime-500/15 dark:text-lime-400",
    bgClass: "bg-lime-500/15",
    textClass: "text-lime-500",
    borderClass: "border-lime-500/30",
  },
  emerald: {
    chipClass: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 dark:border-emerald-500/40 dark:bg-emerald-500/15 dark:text-emerald-400",
    bgClass: "bg-emerald-500/15",
    textClass: "text-emerald-500",
    borderClass: "border-emerald-500/30",
  },
  teal: {
    chipClass: "border-teal-500/30 bg-teal-500/10 text-teal-600 hover:bg-teal-500/20 dark:border-teal-500/40 dark:bg-teal-500/15 dark:text-teal-400",
    bgClass: "bg-teal-500/15",
    textClass: "text-teal-500",
    borderClass: "border-teal-500/30",
  },
  sky: {
    chipClass: "border-sky-500/30 bg-sky-500/10 text-sky-600 hover:bg-sky-500/20 dark:border-sky-500/40 dark:bg-sky-500/15 dark:text-sky-400",
    bgClass: "bg-sky-500/15",
    textClass: "text-sky-500",
    borderClass: "border-sky-500/30",
  },
  indigo: {
    chipClass: "border-indigo-500/30 bg-indigo-500/10 text-indigo-600 hover:bg-indigo-500/20 dark:border-indigo-500/40 dark:bg-indigo-500/15 dark:text-indigo-400",
    bgClass: "bg-indigo-500/15",
    textClass: "text-indigo-500",
    borderClass: "border-indigo-500/30",
  },
  purple: {
    chipClass: "border-purple-500/30 bg-purple-500/10 text-purple-600 hover:bg-purple-500/20 dark:border-purple-500/40 dark:bg-purple-500/15 dark:text-purple-400",
    bgClass: "bg-purple-500/15",
    textClass: "text-purple-500",
    borderClass: "border-purple-500/30",
  },
  pink: {
    chipClass: "border-pink-500/30 bg-pink-500/10 text-pink-600 hover:bg-pink-500/20 dark:border-pink-500/40 dark:bg-pink-500/15 dark:text-pink-400",
    bgClass: "bg-pink-500/15",
    textClass: "text-pink-500",
    borderClass: "border-pink-500/30",
  },
  zinc: {
    chipClass: "border-zinc-500/30 bg-zinc-500/10 text-zinc-600 hover:bg-zinc-500/20 dark:border-zinc-500/40 dark:bg-zinc-500/15 dark:text-zinc-400",
    bgClass: "bg-zinc-500/15",
    textClass: "text-zinc-500",
    borderClass: "border-zinc-500/30",
  },
} as const;

type ColorPreset = keyof typeof COLOR_PRESETS;
type BadgeClasses = Pick<AdminBadgeInput, "chipClass" | "bgClass" | "textClass" | "borderClass">;

// A badge whose colours match no preset (one made straight in the database)
// keeps its own classes on edit until another colour is picked.
const KEEP = "keep";

const BUILT_IN_IDS = new Set(DEFAULT_BADGES.map((badge) => badge.id));

const input =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50";

const EMPTY_FORM = { id: "", name: "", description: "", iconUrl: "", requiredFlag: "", requiredPlan: "" };

export function BadgesAdminPanel() {
  const t = useT();
  const [badges, setBadges] = useState<BadgeDefinition[] | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [color, setColor] = useState<ColorPreset | typeof KEEP>("sky");
  // The badge being edited, or null when the form creates a new one.
  const [editing, setEditing] = useState<BadgeDefinition | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchAdminBadges()
      .then((list) => {
        if (!cancelled) setBadges(list);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function run(action: () => Promise<BadgeDefinition[]>, message: string): Promise<boolean> {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      setBadges(await action());
      setDone(message);
      // This page's own profiles pick up the change without a reload.
      void fetchBadgesCatalog();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setBusy(false);
    }
  }

  function move(index: number, delta: -1 | 1) {
    if (!badges) return;
    const target = index + delta;
    if (target < 0 || target >= badges.length) return;
    const ids = badges.map((badge) => badge.id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    // Moved on screen at once; the server's answer then replaces it.
    const byId = new Map(badges.map((badge) => [badge.id, badge]));
    setBadges(ids.map((id) => byId.get(id)!));
    void run(() => reorderAdminBadges(ids), t("admin.badgesPanel.orderSaved"));
  }

  function remove(badge: BadgeDefinition) {
    if (!window.confirm(t("admin.badgesPanel.confirmDelete", { name: badge.name }))) return;
    void run(() => deleteAdminBadge(badge.id), t("admin.badgesPanel.deleted"));
  }

  function startEdit(badge: BadgeDefinition) {
    setEditing(badge);
    setForm({
      id: badge.id,
      name: badge.name,
      description: badge.description ?? "",
      iconUrl: badge.iconUrl,
      requiredFlag: badge.requiredFlag ?? badge.flagTag ?? "",
      requiredPlan: badge.requiredPlan ?? "",
    });
    const preset = (Object.keys(COLOR_PRESETS) as ColorPreset[]).find(
      (key) => COLOR_PRESETS[key].chipClass === badge.chipClass
    );
    setColor(preset ?? KEEP);
    setError(null);
    setDone(null);
  }

  function cancelEdit() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setColor("sky");
  }

  const classes: BadgeClasses =
    color === KEEP
      ? {
          chipClass: editing?.chipClass,
          bgClass: editing?.bgClass,
          textClass: editing?.textClass,
          borderClass: editing?.borderClass,
        }
      : COLOR_PRESETS[color];

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const payload: AdminBadgeInput = {
      ...form,
      requiredFlag: form.requiredFlag.trim().toUpperCase() || undefined,
      requiredPlan: form.requiredPlan || undefined,
      ...classes,
    };
    const target = editing;
    const ok = await run(
      () => (target ? updateAdminBadge(target.id, payload) : createAdminBadge(payload)),
      t(target ? "admin.badgesPanel.updated" : "admin.badgesPanel.created")
    );
    if (ok) cancelEdit();
  }

  const preview = classes;

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">{t("admin.badgesPanel.title")}</h2>
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{t("admin.badgesPanel.orderHint")}</p>

      <ul className="mt-3 flex flex-col divide-y divide-zinc-100 rounded-lg border border-zinc-200 dark:divide-zinc-900 dark:border-zinc-800">
        {badges === null && <li className="px-3 py-2 text-sm text-zinc-500">{t("common.loading")}</li>}
        {badges?.map((badge, index) => (
          <li key={badge.id} className="flex items-center gap-2 px-3 py-2">
            {/* eslint-disable-next-line @next/next/no-img-element -- a badge icon from any host or a data URL */}
            <img src={badge.iconUrl} alt="" className="h-5 w-5 shrink-0" />
            <span
              className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-xs font-medium ${badge.chipClass ?? ""}`}
            >
              {badge.name}
            </span>
            <span className="min-w-0 flex-1 truncate text-xs text-zinc-500 dark:text-zinc-400">
              {badge.id}
              {badge.requiredFlag ? ` · ${badge.requiredFlag}` : ""}
              {badge.requiredPlan ? ` · ${badge.requiredPlan}` : ""}
            </span>
            <button
              type="button"
              disabled={busy}
              onClick={() => startEdit(badge)}
              aria-label={t("admin.badgesPanel.edit")}
              className="rounded p-1 text-zinc-500 hover:bg-zinc-100 disabled:opacity-30 dark:hover:bg-zinc-900"
            >
              <MdEdit className="h-4 w-4" />
            </button>
            <button
              type="button"
              disabled={busy || index === 0}
              onClick={() => move(index, -1)}
              aria-label={t("admin.badgesPanel.moveUp")}
              className="rounded p-1 text-zinc-500 hover:bg-zinc-100 disabled:opacity-30 dark:hover:bg-zinc-900"
            >
              <MdArrowUpward className="h-4 w-4" />
            </button>
            <button
              type="button"
              disabled={busy || index === badges.length - 1}
              onClick={() => move(index, 1)}
              aria-label={t("admin.badgesPanel.moveDown")}
              className="rounded p-1 text-zinc-500 hover:bg-zinc-100 disabled:opacity-30 dark:hover:bg-zinc-900"
            >
              <MdArrowDownward className="h-4 w-4" />
            </button>
            {/* Built-in badges are put back on every API boot, so deleting one would not last. */}
            <button
              type="button"
              disabled={busy || BUILT_IN_IDS.has(badge.id)}
              onClick={() => remove(badge)}
              aria-label={t("admin.badgesPanel.delete")}
              className="rounded p-1 text-red-500 hover:bg-red-500/10 disabled:invisible"
            >
              <MdDelete className="h-4 w-4" />
            </button>
          </li>
        ))}
      </ul>

      <h3 className="mt-5 text-sm font-semibold text-zinc-700 dark:text-zinc-300">
        {editing ? t("admin.badgesPanel.editBadge", { name: editing.name }) : t("admin.badgesPanel.newBadge")}
      </h3>
      <form onSubmit={handleSubmit} className="mt-2 grid gap-2 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs text-zinc-500">
          {t("admin.badgesPanel.id")}
          <input
            required
            disabled={editing !== null}
            value={form.id}
            onChange={(e) => setForm({ ...form, id: e.target.value.toLowerCase() })}
            pattern="[a-z0-9_]{2,32}"
            placeholder="early_supporter"
            className={input}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-zinc-500">
          {t("admin.badgesPanel.name")}
          <input required maxLength={40} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={input} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-zinc-500 sm:col-span-2">
          {t("admin.badgesPanel.description")}
          <input maxLength={200} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className={input} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-zinc-500 sm:col-span-2">
          {t("admin.badgesPanel.iconUrl")}
          <input
            required
            value={form.iconUrl}
            onChange={(e) => setForm({ ...form, iconUrl: e.target.value })}
            placeholder="https://… / data:image/svg+xml,…"
            className={input}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-zinc-500">
          {t("admin.badgesPanel.flag")}
          <input
            value={form.requiredFlag}
            onChange={(e) => setForm({ ...form, requiredFlag: e.target.value.toUpperCase() })}
            pattern="[A-Za-z0-9_]{1,32}"
            placeholder="EARLY_SUPPORTER"
            className={`${input} font-mono`}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-zinc-500">
          {t("admin.badgesPanel.plan")}
          <select value={form.requiredPlan} onChange={(e) => setForm({ ...form, requiredPlan: e.target.value })} className={input}>
            <option value="">{t("admin.badgesPanel.noPlan")}</option>
            <option value="pro">Pro</option>
          </select>
        </label>
        <div className="flex flex-col gap-1 text-xs text-zinc-500 sm:col-span-2">
          {t("admin.badgesPanel.color")}
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(COLOR_PRESETS) as ColorPreset[]).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setColor(key)}
                aria-pressed={color === key}
                className={`rounded-full border px-2 py-0.5 text-xs font-medium ${COLOR_PRESETS[key].chipClass} ${
                  color === key ? "ring-2 ring-zinc-500" : ""
                }`}
              >
                {key}
              </button>
            ))}
            {color === KEEP && (
              <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ring-2 ring-zinc-500 ${editing?.chipClass ?? ""}`}>
                {t("admin.badgesPanel.currentColor")}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 sm:col-span-2">
          <span className="text-xs text-zinc-500">{t("admin.badgesPanel.preview")}</span>
          <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${preview.chipClass}`}>
            {form.iconUrl && (
              // eslint-disable-next-line @next/next/no-img-element -- previewing whatever URL was typed
              <img src={form.iconUrl} alt="" className="h-3.5 w-3.5" />
            )}
            {form.name || t("admin.badgesPanel.name")}
          </span>
        </div>
        {error && <p className="text-sm text-red-500 sm:col-span-2">{error}</p>}
        {done && <p className="text-sm text-emerald-600 dark:text-emerald-400 sm:col-span-2">{done}</p>}
        <button
          type="submit"
          disabled={busy || (!form.requiredFlag && !form.requiredPlan)}
          className="self-start rounded-lg bg-zinc-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
        >
          {busy ? t("common.saving") : editing ? t("admin.badgesPanel.save") : t("admin.badgesPanel.create")}
        </button>
        {editing && (
          <button
            type="button"
            onClick={cancelEdit}
            className="self-start rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            {t("admin.badgesPanel.cancel")}
          </button>
        )}
      </form>
    </div>
  );
}
