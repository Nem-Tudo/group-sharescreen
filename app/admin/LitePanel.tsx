"use client";

import { useCallback, useEffect, useState } from "react";
import { MdAdd, MdDelete, MdEdit, MdRefresh } from "react-icons/md";
import {
  createLiteModification,
  deleteLiteModification,
  fetchLiteConfig,
  publishLiteRelease,
  setLiteSetupUrl,
  unpublishLiteRelease,
  updateLiteModification,
  type LiteConfig,
  type LiteModification,
  type LiteModificationStatus,
  type LiteReleaseInput,
} from "@/lib/adminApi";
import { useT } from "@/lib/useI18n";
import { formatLocale } from "@/lib/i18n";
import { getSignalingHttpBase } from "@/lib/roomsApi";
import { LiteMetricsPanel } from "./LiteMetricsPanel";

// Go Live - Lite (the native Rust client, goliveRust): what version it updates
// to, and the catalogue of "modificações" its setup offers. The setup reads the
// catalogue from the API each time it runs, so a modification created, renamed
// or switched off here reaches the next install without a new setup; a
// published version reaches every open Lite client right away.

const input =
  "w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900";
const label = "flex flex-col gap-1 text-xs font-medium text-zinc-600 dark:text-zinc-400";
const smallButton =
  "flex items-center gap-1 rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-700 transition hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800";
const primaryButton =
  "rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:opacity-50";

const STATUSES: LiteModificationStatus[] = ["active", "coming-soon", "disabled"];

const EMPTY_RELEASE: LiteReleaseInput = {
  version: "",
  minVersion: null,
  mandatory: false,
  downloadUrl: "",
  sha256: null,
  modsDownloadUrl: null,
  modsSha256: null,
  releasePageUrl: null,
  notes: null,
};

type ModDraft = {
  id: string;
  name: string;
  description: string;
  status: LiteModificationStatus;
  version: string;
  downloadUrl: string;
  fileName: string;
  sha256: string;
  order: string;
};

function draftOf(m?: LiteModification): ModDraft {
  return {
    id: m?.id ?? "",
    name: m?.name ?? "",
    description: m?.description ?? "",
    status: m?.status ?? "active",
    version: m?.version ?? "0.1.0",
    downloadUrl: m?.downloadUrl ?? "",
    fileName: m?.fileName ?? "",
    sha256: m?.sha256 ?? "",
    order: m ? String(m.order) : "",
  };
}

export function LitePanel() {
  const t = useT();
  const [config, setConfig] = useState<LiteConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [release, setRelease] = useState<LiteReleaseInput>(EMPTY_RELEASE);
  // The modification open in the editor: an id, "new", or nothing.
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<ModDraft>(draftOf());
  const [setupUrl, setSetupUrl] = useState("");

  const load = useCallback(async () => {
    setError(null);
    try {
      const cfg = await fetchLiteConfig();
      setConfig(cfg);
      setSetupUrl(cfg.setupUrl ?? "");
      // The form starts from what is published, so a new version is "change the
      // number and the links" rather than typing everything again.
      if (cfg.release) {
        const { publishedAt: _published, ...rest } = cfg.release;
        setRelease(rest);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(action: () => Promise<LiteConfig>, done: string): Promise<boolean> {
    if (busy) return false;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      setConfig(await action());
      setNotice(done);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setBusy(false);
    }
  }

  const setRel = <K extends keyof LiteReleaseInput>(key: K, value: LiteReleaseInput[K]) =>
    setRelease((r) => ({ ...r, [key]: value }));
  const nullable = (v: string) => (v.trim() ? v.trim() : null);

  function openEditor(mod?: LiteModification) {
    setEditing(mod ? mod.id : "new");
    setDraft(draftOf(mod));
  }

  function saveDraft() {
    const fields = {
      name: draft.name,
      description: draft.description,
      status: draft.status,
      version: draft.version,
      downloadUrl: nullable(draft.downloadUrl),
      fileName: nullable(draft.fileName),
      sha256: nullable(draft.sha256),
      ...(draft.order.trim() ? { order: Number(draft.order) } : {}),
    };
    if (editing === "new") {
      void run(() => createLiteModification({ id: draft.id.trim().toLowerCase(), ...fields }), t("admin.litePanel.modCreated")).then(
        (ok) => ok && setEditing(null)
      );
    } else if (editing) {
      void run(() => updateLiteModification(editing, fields), t("admin.litePanel.modSaved")).then((ok) => ok && setEditing(null));
    }
  }

  const published = config?.release ?? null;

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex items-center gap-2">
        <h2 className="flex-1 text-sm font-semibold text-zinc-700 dark:text-zinc-300">{t("admin.litePanel.title")}</h2>
        <button type="button" onClick={() => void load()} className={smallButton} title={t("admin.litePanel.reload")}>
          <MdRefresh className="h-4 w-4" />
        </button>
      </div>
      <p className="text-xs text-zinc-500">{t("admin.litePanel.intro")}</p>

      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p>}
      {notice && <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">{notice}</p>}

      {/* --- Métricas -------------------------------------------------------- */}
      <LiteMetricsPanel config={config} />

      {/* --- Download do setup (conta downloads) ------------------------------ */}
      <section className="flex flex-col gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{t("admin.litePanel.setupTitle")}</h3>
        <p className="text-xs text-zinc-500">{t("admin.litePanel.setupHint")}</p>
        <div className="flex flex-wrap items-end gap-2">
          <label className={`${label} min-w-0 flex-1`}>
            {t("admin.litePanel.setupUrl")}
            <input
              className={input}
              value={setupUrl}
              placeholder="https://…/Go-Live-Lite-Setup.exe"
              onChange={(e) => setSetupUrl(e.target.value)}
            />
          </label>
          <button
            type="button"
            disabled={busy || setupUrl.trim() === (config?.setupUrl ?? "")}
            onClick={() => void run(() => setLiteSetupUrl(nullable(setupUrl)), t("admin.litePanel.setupSaved"))}
            className={primaryButton}
          >
            {t("admin.litePanel.save")}
          </button>
        </div>
        {config?.setupUrl && (
          <p className="text-xs text-zinc-600 dark:text-zinc-400">
            {t("admin.litePanel.setupShare")}{" "}
            <code className="select-all rounded bg-zinc-100 px-1 py-0.5 dark:bg-zinc-900">{`${getSignalingHttpBase()}/lite/download`}</code>
          </p>
        )}
      </section>

      {/* --- Atualização ------------------------------------------------------ */}
      <section className="flex flex-col gap-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{t("admin.litePanel.updateTitle")}</h3>
        <p className="text-sm text-zinc-700 dark:text-zinc-300">
          {published
            ? t("admin.litePanel.publishedNow", {
                version: published.version,
                date: new Date(published.publishedAt).toLocaleString(formatLocale()),
              })
            : t("admin.litePanel.nothingPublished")}
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={label}>
            {t("admin.litePanel.version")}
            <input className={input} value={release.version} placeholder="0.2.0" onChange={(e) => setRel("version", e.target.value)} />
          </label>
          <label className={label}>
            {t("admin.litePanel.minVersion")}
            <input
              className={input}
              value={release.minVersion ?? ""}
              placeholder="0.1.0"
              onChange={(e) => setRel("minVersion", nullable(e.target.value))}
            />
          </label>
          <label className={label}>
            {t("admin.litePanel.coreUrl")}
            <input className={input} value={release.downloadUrl} placeholder="https://…/golive-lite-core.exe" onChange={(e) => setRel("downloadUrl", e.target.value)} />
          </label>
          <label className={label}>
            {t("admin.litePanel.coreSha")}
            <input className={`${input} font-mono`} value={release.sha256 ?? ""} onChange={(e) => setRel("sha256", nullable(e.target.value))} />
          </label>
          <label className={label}>
            {t("admin.litePanel.modsUrl")}
            <input
              className={input}
              value={release.modsDownloadUrl ?? ""}
              placeholder="https://…/golive-lite-mods.exe"
              onChange={(e) => setRel("modsDownloadUrl", nullable(e.target.value))}
            />
          </label>
          <label className={label}>
            {t("admin.litePanel.modsSha")}
            <input className={`${input} font-mono`} value={release.modsSha256 ?? ""} onChange={(e) => setRel("modsSha256", nullable(e.target.value))} />
          </label>
          <label className={`${label} sm:col-span-2`}>
            {t("admin.litePanel.releasePage")}
            <input className={input} value={release.releasePageUrl ?? ""} onChange={(e) => setRel("releasePageUrl", nullable(e.target.value))} />
          </label>
          <label className={`${label} sm:col-span-2`}>
            {t("admin.litePanel.notes")}
            <textarea className={input} rows={3} value={release.notes ?? ""} onChange={(e) => setRel("notes", nullable(e.target.value))} />
          </label>
        </div>
        <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
          <input type="checkbox" checked={release.mandatory} onChange={(e) => setRel("mandatory", e.target.checked)} />
          {t("admin.litePanel.mandatory")}
        </label>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy || !release.version.trim() || !release.downloadUrl.trim()}
            onClick={() => void run(() => publishLiteRelease(release), t("admin.litePanel.publishedOk"))}
            className={primaryButton}
          >
            {t("admin.litePanel.publish")}
          </button>
          {published && (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (window.confirm(t("admin.litePanel.unpublishConfirm"))) {
                  void run(() => unpublishLiteRelease(), t("admin.litePanel.unpublishedOk"));
                }
              }}
              className={smallButton}
            >
              {t("admin.litePanel.unpublish")}
            </button>
          )}
        </div>
      </section>

      {/* --- Modificações ----------------------------------------------------- */}
      <section className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <h3 className="flex-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">{t("admin.litePanel.modsTitle")}</h3>
          <button type="button" onClick={() => openEditor()} className={smallButton}>
            <MdAdd className="h-4 w-4" />
            {t("admin.litePanel.newMod")}
          </button>
        </div>
        <p className="text-xs text-zinc-500">{t("admin.litePanel.modsHint")}</p>

        <ul className="flex flex-col divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {(config?.modifications ?? []).map((m) => (
            <li key={m.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-zinc-800 dark:text-zinc-100">
                  {m.name} <span className="font-mono text-xs font-normal text-zinc-500">{m.id} · v{m.version}</span>
                </p>
                {m.description && <p className="truncate text-xs text-zinc-500">{m.description}</p>}
              </div>
              <select
                value={m.status}
                disabled={busy}
                onChange={(e) =>
                  void run(
                    () => updateLiteModification(m.id, { status: e.target.value as LiteModificationStatus }),
                    t("admin.litePanel.modSaved")
                  )
                }
                className="rounded-md border border-zinc-300 bg-white px-1.5 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900"
                aria-label={t("admin.litePanel.status")}
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {t(`admin.litePanel.status.${s}`)}
                  </option>
                ))}
              </select>
              <button type="button" onClick={() => openEditor(m)} className={smallButton} title={t("admin.litePanel.edit")}>
                <MdEdit className="h-4 w-4" />
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  if (window.confirm(t("admin.litePanel.deleteConfirm", { name: m.name }))) {
                    void run(() => deleteLiteModification(m.id), t("admin.litePanel.modDeleted"));
                  }
                }}
                className={`${smallButton} text-red-600 dark:text-red-400`}
                title={t("admin.litePanel.delete")}
              >
                <MdDelete className="h-4 w-4" />
              </button>
            </li>
          ))}
          {config && config.modifications.length === 0 && (
            <li className="px-3 py-2 text-sm text-zinc-500">{t("admin.litePanel.noMods")}</li>
          )}
        </ul>

        {editing && (
          <div className="flex flex-col gap-3 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
            <h4 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
              {editing === "new" ? t("admin.litePanel.newMod") : t("admin.litePanel.editMod", { id: editing })}
            </h4>
            <div className="grid gap-3 sm:grid-cols-2">
              {editing === "new" && (
                <label className={label}>
                  {t("admin.litePanel.modId")}
                  <input className={`${input} font-mono`} value={draft.id} placeholder="minha_modificacao" onChange={(e) => setDraft({ ...draft, id: e.target.value })} />
                </label>
              )}
              <label className={label}>
                {t("admin.litePanel.modName")}
                <input className={input} maxLength={40} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              </label>
              <label className={`${label} sm:col-span-2`}>
                {t("admin.litePanel.modDescription")}
                <input className={input} maxLength={140} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
              </label>
              <label className={label}>
                {t("admin.litePanel.status")}
                <select className={input} value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value as LiteModificationStatus })}>
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {t(`admin.litePanel.status.${s}`)}
                    </option>
                  ))}
                </select>
              </label>
              <label className={label}>
                {t("admin.litePanel.version")}
                <input className={input} value={draft.version} onChange={(e) => setDraft({ ...draft, version: e.target.value })} />
              </label>
              <label className={label}>
                {t("admin.litePanel.modFileUrl")}
                <input className={input} value={draft.downloadUrl} placeholder="https://…" onChange={(e) => setDraft({ ...draft, downloadUrl: e.target.value })} />
              </label>
              <label className={label}>
                {t("admin.litePanel.modFileName")}
                <input className={input} value={draft.fileName} placeholder="plugin.bin" onChange={(e) => setDraft({ ...draft, fileName: e.target.value })} />
              </label>
              <label className={label}>
                SHA-256
                <input className={`${input} font-mono`} value={draft.sha256} onChange={(e) => setDraft({ ...draft, sha256: e.target.value })} />
              </label>
              <label className={label}>
                {t("admin.litePanel.order")}
                <input className={input} inputMode="numeric" value={draft.order} onChange={(e) => setDraft({ ...draft, order: e.target.value })} />
              </label>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={busy || !draft.name.trim() || (editing === "new" && !draft.id.trim())}
                onClick={saveDraft}
                className={primaryButton}
              >
                {t("admin.litePanel.save")}
              </button>
              <button type="button" onClick={() => setEditing(null)} className={smallButton}>
                {t("admin.litePanel.cancel")}
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
