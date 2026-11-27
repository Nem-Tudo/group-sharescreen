"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  MdAdd,
  MdArrowDownward,
  MdArrowUpward,
  MdCheck,
  MdContentCopy,
  MdDelete,
  MdEdit,
  MdHistory,
  MdRefresh,
} from "react-icons/md";
import {
  createLiteModification,
  deleteLiteModification,
  fetchLiteConfig,
  fetchLiteMetrics,
  publishLiteRelease,
  setLiteSetupUrl,
  unpublishLiteRelease,
  updateLiteModification,
  type LiteConfig,
  type LiteMetrics,
  type LiteModification,
  type LiteModificationStatus,
  type LiteRelease,
  type LiteReleaseInput,
} from "@/lib/adminApi";
import { useT } from "@/lib/useI18n";
import { formatLocale } from "@/lib/i18n";
import { getSignalingHttpBase } from "@/lib/roomsApi";
import { LiteMetricsPanel } from "./LiteMetricsPanel";

// Go Live - Lite (the native Rust client, goliveRust), its own admin tab:
//   - Visão geral: the metrics (LiteMetricsPanel).
//   - Atualizações: publish a version as optional, forced below a minimum
//     version, or forced for everybody — with how many installs each choice
//     reaches — and the history of what was published before.
//   - Modificações: the catalogue the setup reads each time it runs.
//   - Instalador: where the setup is hosted (GET /lite/download counts and
//     redirects there).
// A published version reaches every open Lite client right away
// ("lite-update-check"); the catalogue reaches the next setup run.

const input =
  "w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm outline-none transition focus:border-emerald-500 dark:border-zinc-700 dark:bg-zinc-900";
const inputError = "border-red-400 dark:border-red-700";
const label = "flex flex-col gap-1 text-xs font-medium text-zinc-600 dark:text-zinc-400";
const smallButton =
  "flex items-center gap-1 rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-700 transition hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800";
const primaryButton =
  "rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:opacity-50";
const dangerButton =
  "rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700 transition hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950/40";
const card = "rounded-lg border border-zinc-200 p-3 dark:border-zinc-800";
const sectionTitle = "text-xs font-semibold uppercase tracking-wide text-zinc-500";

const STATUSES: LiteModificationStatus[] = ["active", "coming-soon", "disabled"];
const TABS = ["overview", "updates", "mods", "setup"] as const;
type Tab = (typeof TABS)[number];
const TAB_KEY = "admin:lite:tab";

/** How a version is offered — maps onto the manifest's `mandatory` / `minVersion`. */
type UpdateKind = "optional" | "below-min" | "everyone";

const VERSION_RE = /^\d{1,4}\.\d{1,4}\.\d{1,6}$/;
const SHA_RE = /^[a-f0-9]{64}$/i;

function kindOf(r: Pick<LiteRelease, "mandatory" | "minVersion">): UpdateKind {
  if (r.mandatory) return "everyone";
  return r.minVersion ? "below-min" : "optional";
}

function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i += 1) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  return 0;
}

type ReleaseForm = {
  kind: UpdateKind;
  version: string;
  minVersion: string;
  downloadUrl: string;
  sha256: string;
  modsDownloadUrl: string;
  modsSha256: string;
  releasePageUrl: string;
  notes: string;
};

const EMPTY_FORM: ReleaseForm = {
  kind: "optional",
  version: "",
  minVersion: "",
  downloadUrl: "",
  sha256: "",
  modsDownloadUrl: "",
  modsSha256: "",
  releasePageUrl: "",
  notes: "",
};

function formOf(r: LiteRelease): ReleaseForm {
  return {
    kind: kindOf(r),
    version: r.version,
    minVersion: r.minVersion ?? "",
    downloadUrl: r.downloadUrl,
    sha256: r.sha256 ?? "",
    modsDownloadUrl: r.modsDownloadUrl ?? "",
    modsSha256: r.modsSha256 ?? "",
    releasePageUrl: r.releasePageUrl ?? "",
    notes: r.notes ?? "",
  };
}

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

function KindBadge({ kind }: { kind: UpdateKind }) {
  const t = useT();
  const tone =
    kind === "everyone"
      ? "bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300"
      : kind === "below-min"
        ? "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
        : "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300";
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${tone}`}>
      {t(`admin.litePanel.kind.${kind}`)}
    </span>
  );
}

function StatusBadge({ status }: { status: LiteModificationStatus }) {
  const t = useT();
  const tone =
    status === "active"
      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
      : status === "coming-soon"
        ? "bg-sky-100 text-sky-800 dark:bg-sky-950/60 dark:text-sky-300"
        : "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300";
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${tone}`}>
      {t(`admin.litePanel.status.${status}`)}
    </span>
  );
}

export function LitePanel() {
  const t = useT();
  // The admin renders after sign-in, never at hydration, so reading storage here is safe.
  const [tab, setTab] = useState<Tab>(() => {
    try {
      const saved = window.localStorage.getItem(TAB_KEY) as Tab | null;
      return saved && TABS.includes(saved) ? saved : "overview";
    } catch {
      return "overview";
    }
  });
  const [config, setConfig] = useState<LiteConfig | null>(null);
  const [metrics, setMetrics] = useState<LiteMetrics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<ReleaseForm>(EMPTY_FORM);
  const [showModsBuild, setShowModsBuild] = useState(false);
  // The modification open in the editor: an id, "new", or nothing.
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<ModDraft>(draftOf());
  const [modFilter, setModFilter] = useState<LiteModificationStatus | "all">("all");
  const [setupUrl, setSetupUrl] = useState("");
  const [copied, setCopied] = useState(false);

  function chooseTab(next: Tab) {
    setTab(next);
    setNotice(null);
    setError(null);
    try {
      window.localStorage.setItem(TAB_KEY, next);
    } catch {
      // Per-viewer convenience only.
    }
  }

  // State is only set once requests settle, so the mount effect never sets it synchronously.
  const fetchAll = useCallback(() => {
    // Only for the "who does this reach" numbers; the panel works without them.
    fetchLiteMetrics(30)
      .then(setMetrics)
      .catch(() => setMetrics(null));
    return fetchLiteConfig()
      .then((cfg) => {
        setConfig(cfg);
        setError(null);
        setSetupUrl(cfg.setupUrl ?? "");
        // The form starts from what is published, so a new version is "change the
        // number and the links" rather than typing everything again.
        if (cfg.release) {
          setForm(formOf(cfg.release));
          setShowModsBuild(Boolean(cfg.release.modsDownloadUrl));
        }
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  const load = () => {
    setNotice(null);
    void fetchAll();
  };

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

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

  const nullable = (v: string) => (v.trim() ? v.trim() : null);
  const setF = <K extends keyof ReleaseForm>(key: K, value: ReleaseForm[K]) => setForm((f) => ({ ...f, [key]: value }));

  const published = config?.release ?? null;
  const history = config?.history ?? [];

  // --- Release form validation + reach ----------------------------------------
  const v = form.version.trim();
  const minV = form.minVersion.trim();
  const httpsOk = (s: string) => !s.trim() || /^https:\/\/\S+$/i.test(s.trim());
  const errors = {
    version: v && !VERSION_RE.test(v) ? t("admin.litePanel.err.version") : null,
    minVersion:
      form.kind === "below-min"
        ? !minV
          ? t("admin.litePanel.err.minRequired")
          : !VERSION_RE.test(minV)
            ? t("admin.litePanel.err.version")
            : VERSION_RE.test(v) && compareVersions(minV, v) > 0
              ? t("admin.litePanel.err.minAbove")
              : null
        : null,
    downloadUrl: form.downloadUrl && !httpsOk(form.downloadUrl) ? t("admin.litePanel.err.https") : null,
    sha256: form.sha256.trim() && !SHA_RE.test(form.sha256.trim()) ? t("admin.litePanel.err.sha") : null,
    modsDownloadUrl: !httpsOk(form.modsDownloadUrl) ? t("admin.litePanel.err.https") : null,
    modsSha256: form.modsSha256.trim() && !SHA_RE.test(form.modsSha256.trim()) ? t("admin.litePanel.err.sha") : null,
    releasePageUrl: !httpsOk(form.releasePageUrl) ? t("admin.litePanel.err.https") : null,
  };
  const formValid = Boolean(v && form.downloadUrl.trim()) && Object.values(errors).every((e) => e === null);
  const notNewer = Boolean(published && VERSION_RE.test(v) && compareVersions(v, published.version) <= 0);

  // Who the choice reaches, from the installs seen in the last 30 days.
  const reach = useMemo(() => {
    if (!metrics || !VERSION_RE.test(v)) return null;
    const older = metrics.versions.filter((x) => VERSION_RE.test(x.version) && compareVersions(x.version, v) < 0);
    const behind = older.reduce((a, x) => a + x.installs, 0);
    const belowMin = VERSION_RE.test(minV)
      ? older.filter((x) => compareVersions(x.version, minV) < 0).reduce((a, x) => a + x.installs, 0)
      : 0;
    return { behind, belowMin };
  }, [metrics, v, minV]);

  function publish() {
    if (!formValid) return;
    if (form.kind !== "optional" && !window.confirm(t(`admin.litePanel.confirm.${form.kind}`, { version: v }))) return;
    const payload: LiteReleaseInput = {
      version: v,
      minVersion: form.kind === "below-min" ? minV : null,
      mandatory: form.kind === "everyone",
      downloadUrl: form.downloadUrl.trim(),
      sha256: nullable(form.sha256)?.toLowerCase() ?? null,
      modsDownloadUrl: showModsBuild ? nullable(form.modsDownloadUrl) : null,
      modsSha256: showModsBuild ? (nullable(form.modsSha256)?.toLowerCase() ?? null) : null,
      releasePageUrl: nullable(form.releasePageUrl),
      notes: nullable(form.notes),
    };
    void run(() => publishLiteRelease(payload), t("admin.litePanel.publishedOk"));
  }

  // --- Modifications ------------------------------------------------------------
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

  const mods = config?.modifications ?? [];
  const shownMods = modFilter === "all" ? mods : mods.filter((m) => m.status === modFilter);
  const modInstalls = (id: string) => metrics?.mods.find((m) => m.id === id)?.installs ?? null;

  /** Swaps the order of two neighbours (two PATCHes; the list re-sorts on the server). */
  function move(mod: LiteModification, dir: -1 | 1) {
    const i = mods.findIndex((m) => m.id === mod.id);
    const other = mods[i + dir];
    if (!other) return;
    const a = mod.order === other.order ? other.order + dir : other.order;
    const b = mod.order;
    void run(async () => {
      await updateLiteModification(mod.id, { order: a });
      return updateLiteModification(other.id, { order: b });
    }, t("admin.litePanel.modSaved"));
  }

  const downloadLink = `${getSignalingHttpBase()}/lite/download`;
  const fmtDate = (iso: string) => new Date(iso).toLocaleString(formatLocale());

  const field = (key: keyof typeof errors) => (errors[key] ? `${input} ${inputError}` : input);
  const fieldError = (key: keyof typeof errors) =>
    errors[key] ? <span className="text-[11px] font-normal text-red-600 dark:text-red-400">{errors[key]}</span> : null;

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      {/* --- Cabeçalho ------------------------------------------------------- */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">{t("admin.litePanel.title")}</h2>
          <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-zinc-500">
            {published ? (
              <>
                <span>{t("admin.litePanel.currentShort", { version: published.version })}</span>
                <KindBadge kind={kindOf(published)} />
              </>
            ) : (
              <span>{t("admin.litePanel.nothingPublished")}</span>
            )}
            {metrics && <span>· {t("admin.litePanel.onlineShort", { n: metrics.live.online })}</span>}
          </p>
        </div>
        <button type="button" onClick={() => void load()} className={smallButton} title={t("admin.litePanel.reload")}>
          <MdRefresh className="h-4 w-4" />
        </button>
      </div>

      <nav className="flex gap-1 overflow-x-auto rounded-lg bg-zinc-100 p-1 dark:bg-zinc-900" role="tablist">
        {TABS.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => chooseTab(id)}
            className={`whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-semibold transition ${
              tab === id
                ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-50"
                : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
            }`}
          >
            {t(`admin.litePanel.tab.${id}`)}
          </button>
        ))}
      </nav>

      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p>}
      {notice && <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">{notice}</p>}

      {/* --- Visão geral ----------------------------------------------------- */}
      {tab === "overview" && (
        <>
          <p className="text-xs text-zinc-500">{t("admin.litePanel.intro")}</p>
          <LiteMetricsPanel config={config} />
        </>
      )}

      {/* --- Atualizações ---------------------------------------------------- */}
      {tab === "updates" && (
        <div className="flex flex-col gap-4">
          {/* Agora */}
          <section className={`${card} flex flex-col gap-2`}>
            <h3 className={sectionTitle}>{t("admin.litePanel.liveTitle")}</h3>
            {published ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-lg font-semibold text-zinc-900 dark:text-zinc-50">v{published.version}</span>
                  <KindBadge kind={kindOf(published)} />
                  {published.minVersion && (
                    <span className="text-xs text-zinc-500">{t("admin.litePanel.minShort", { version: published.minVersion })}</span>
                  )}
                </div>
                <p className="text-xs text-zinc-500">{t("admin.litePanel.publishedAt", { date: fmtDate(published.publishedAt) })}</p>
                <p className="text-xs text-zinc-600 dark:text-zinc-400">{t(`admin.litePanel.kindExplain.${kindOf(published)}`)}</p>
                {published.notes && (
                  <p className="whitespace-pre-wrap rounded-md bg-zinc-50 px-2 py-1.5 text-xs text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
                    {published.notes}
                  </p>
                )}
                <div>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      if (window.confirm(t("admin.litePanel.unpublishConfirm"))) {
                        void run(() => unpublishLiteRelease(), t("admin.litePanel.unpublishedOk"));
                      }
                    }}
                    className={dangerButton}
                  >
                    {t("admin.litePanel.unpublish")}
                  </button>
                </div>
              </>
            ) : (
              <p className="text-sm text-zinc-600 dark:text-zinc-400">{t("admin.litePanel.nothingPublishedLong")}</p>
            )}
          </section>

          {/* Publicar */}
          <section className="flex flex-col gap-3">
            <h3 className={sectionTitle}>{t("admin.litePanel.publishTitle")}</h3>

            <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label={t("admin.litePanel.kindLabel")}>
              {(["optional", "below-min", "everyone"] as UpdateKind[]).map((k) => (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={form.kind === k}
                  onClick={() => setF("kind", k)}
                  className={`flex flex-col gap-1 rounded-lg border p-3 text-left transition ${
                    form.kind === k
                      ? "border-emerald-500 bg-emerald-50/60 ring-1 ring-emerald-500 dark:bg-emerald-950/30"
                      : "border-zinc-200 hover:border-zinc-300 dark:border-zinc-800 dark:hover:border-zinc-700"
                  }`}
                >
                  <span className="flex items-center gap-1.5 text-sm font-semibold text-zinc-800 dark:text-zinc-100">
                    {form.kind === k && <MdCheck className="h-4 w-4 text-emerald-600" />}
                    {t(`admin.litePanel.kind.${k}`)}
                  </span>
                  <span className="text-xs text-zinc-500">{t(`admin.litePanel.kindExplain.${k}`)}</span>
                </button>
              ))}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className={label}>
                {t("admin.litePanel.version")}
                <input className={field("version")} value={form.version} placeholder="0.2.0" onChange={(e) => setF("version", e.target.value)} />
                {fieldError("version")}
                {notNewer && published && (
                  <span className="text-[11px] font-normal text-amber-700 dark:text-amber-400">
                    {t("admin.litePanel.warnNotNewer", { version: published.version })}
                  </span>
                )}
              </label>
              {form.kind === "below-min" && (
                <label className={label}>
                  {t("admin.litePanel.minVersion")}
                  <input
                    className={field("minVersion")}
                    value={form.minVersion}
                    placeholder="0.1.0"
                    onChange={(e) => setF("minVersion", e.target.value)}
                  />
                  {fieldError("minVersion")}
                </label>
              )}
              <label className={`${label} sm:col-span-2`}>
                {t("admin.litePanel.coreUrl")}
                <input
                  className={field("downloadUrl")}
                  value={form.downloadUrl}
                  placeholder="https://…/golive-lite-core.exe"
                  onChange={(e) => setF("downloadUrl", e.target.value)}
                />
                {fieldError("downloadUrl")}
              </label>
              <label className={`${label} sm:col-span-2`}>
                {t("admin.litePanel.coreSha")}
                <input className={`${field("sha256")} font-mono`} value={form.sha256} onChange={(e) => setF("sha256", e.target.value)} />
                {fieldError("sha256")}
              </label>
            </div>

            <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
              <input type="checkbox" checked={showModsBuild} onChange={(e) => setShowModsBuild(e.target.checked)} />
              {t("admin.litePanel.modsBuildToggle")}
            </label>
            {showModsBuild && (
              <div className="grid gap-3 sm:grid-cols-2">
                <label className={`${label} sm:col-span-2`}>
                  {t("admin.litePanel.modsUrl")}
                  <input
                    className={field("modsDownloadUrl")}
                    value={form.modsDownloadUrl}
                    placeholder="https://…/golive-lite-mods.exe"
                    onChange={(e) => setF("modsDownloadUrl", e.target.value)}
                  />
                  {fieldError("modsDownloadUrl")}
                </label>
                <label className={`${label} sm:col-span-2`}>
                  {t("admin.litePanel.modsSha")}
                  <input className={`${field("modsSha256")} font-mono`} value={form.modsSha256} onChange={(e) => setF("modsSha256", e.target.value)} />
                  {fieldError("modsSha256")}
                </label>
              </div>
            )}

            <div className="grid gap-3">
              <label className={label}>
                {t("admin.litePanel.releasePage")}
                <input className={field("releasePageUrl")} value={form.releasePageUrl} onChange={(e) => setF("releasePageUrl", e.target.value)} />
                {fieldError("releasePageUrl")}
              </label>
              <label className={label}>
                {t("admin.litePanel.notesUser")}
                <textarea className={input} rows={3} maxLength={2000} value={form.notes} onChange={(e) => setF("notes", e.target.value)} />
              </label>
            </div>

            {/* Quem recebe */}
            <div className="rounded-md bg-zinc-50 px-3 py-2 text-xs text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
              {!reach
                ? t("admin.litePanel.reachUnknown")
                : form.kind === "optional"
                  ? t("admin.litePanel.reach.optional", { n: reach.behind })
                  : form.kind === "everyone"
                    ? t("admin.litePanel.reach.everyone", { n: reach.behind })
                    : t("admin.litePanel.reach.below-min", { n: reach.belowMin, rest: Math.max(0, reach.behind - reach.belowMin) })}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button type="button" disabled={busy || !formValid} onClick={publish} className={primaryButton}>
                {t(`admin.litePanel.publishAs.${form.kind}`)}
              </button>
              {published && (
                <button type="button" onClick={() => setForm(formOf(published))} className={smallButton}>
                  {t("admin.litePanel.resetForm")}
                </button>
              )}
            </div>
          </section>

          {/* Histórico */}
          <section className="flex flex-col gap-2">
            <h3 className={`${sectionTitle} flex items-center gap-1`}>
              <MdHistory className="h-4 w-4" />
              {t("admin.litePanel.historyTitle")}
            </h3>
            {history.length === 0 ? (
              <p className="text-xs text-zinc-500">{t("admin.litePanel.historyEmpty")}</p>
            ) : (
              <ul className="flex flex-col divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
                {history.map((h) => (
                  <li key={`${h.version}-${h.publishedAt}`} className="flex flex-wrap items-center gap-2 px-3 py-2 text-xs">
                    <span className="font-mono font-semibold text-zinc-800 dark:text-zinc-100">v{h.version}</span>
                    <KindBadge kind={kindOf(h)} />
                    <span className="flex-1 text-zinc-500">
                      {t(`admin.litePanel.historyLine.${h.reason}`, { from: fmtDate(h.publishedAt), to: fmtDate(h.replacedAt) })}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setForm(formOf(h));
                        setShowModsBuild(Boolean(h.modsDownloadUrl));
                        setNotice(t("admin.litePanel.historyLoaded", { version: h.version }));
                      }}
                      className={smallButton}
                    >
                      {t("admin.litePanel.historyUse")}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}

      {/* --- Modificações ---------------------------------------------------- */}
      {tab === "mods" && (
        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-1 flex-wrap gap-1">
              {(["all", ...STATUSES] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setModFilter(s)}
                  className={`rounded-full border px-2.5 py-0.5 text-xs font-medium transition ${
                    modFilter === s
                      ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                      : "border-zinc-300 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                  }`}
                >
                  {s === "all" ? t("admin.litePanel.filterAll") : t(`admin.litePanel.status.${s}`)} (
                  {s === "all" ? mods.length : mods.filter((m) => m.status === s).length})
                </button>
              ))}
            </div>
            <button type="button" onClick={() => openEditor()} className={smallButton}>
              <MdAdd className="h-4 w-4" />
              {t("admin.litePanel.newMod")}
            </button>
          </div>
          <p className="text-xs text-zinc-500">{t("admin.litePanel.modsHint")}</p>

          {editing === "new" && renderEditor()}

          <ul className="flex flex-col divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            {shownMods.map((m) => (
              <li key={m.id} className="flex flex-col gap-2 px-3 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium text-zinc-800 dark:text-zinc-100">
                      {m.name}
                      <StatusBadge status={m.status} />
                      {m.downloadUrl && <span className="text-[11px] font-normal text-zinc-500">· {t("admin.litePanel.hasFile")}</span>}
                    </p>
                    <p className="truncate text-xs text-zinc-500">
                      <span className="font-mono">
                        {m.id} · v{m.version}
                      </span>
                      {m.description ? ` · ${m.description}` : ""}
                    </p>
                  </div>
                  {modInstalls(m.id) !== null && (
                    <span className="text-xs text-zinc-500" title={t("admin.liteMetrics.colInstalledHint")}>
                      {t("admin.litePanel.modInstalls", { n: modInstalls(m.id) ?? 0 })}
                    </span>
                  )}
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
                  {modFilter === "all" && (
                    <>
                      <button
                        type="button"
                        disabled={busy || mods[0]?.id === m.id}
                        onClick={() => move(m, -1)}
                        className={smallButton}
                        title={t("admin.litePanel.moveUp")}
                      >
                        <MdArrowUpward className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        disabled={busy || mods[mods.length - 1]?.id === m.id}
                        onClick={() => move(m, 1)}
                        className={smallButton}
                        title={t("admin.litePanel.moveDown")}
                      >
                        <MdArrowDownward className="h-4 w-4" />
                      </button>
                    </>
                  )}
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
                </div>
                {editing === m.id && renderEditor()}
              </li>
            ))}
            {config && shownMods.length === 0 && <li className="px-3 py-2 text-sm text-zinc-500">{t("admin.litePanel.noMods")}</li>}
          </ul>
        </section>
      )}

      {/* --- Instalador ------------------------------------------------------ */}
      {tab === "setup" && (
        <section className="flex flex-col gap-3">
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
          {config?.setupUrl ? (
            <div className={`${card} flex flex-wrap items-center gap-2`}>
              <span className="text-xs text-zinc-600 dark:text-zinc-400">{t("admin.litePanel.setupShare")}</span>
              <code className="min-w-0 flex-1 select-all truncate rounded bg-zinc-100 px-1.5 py-0.5 text-xs dark:bg-zinc-900">{downloadLink}</code>
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard?.writeText(downloadLink).then(() => {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  });
                }}
                className={smallButton}
              >
                {copied ? <MdCheck className="h-4 w-4" /> : <MdContentCopy className="h-4 w-4" />}
                {copied ? t("admin.litePanel.copied") : t("admin.litePanel.copy")}
              </button>
            </div>
          ) : (
            <p className="text-xs text-amber-700 dark:text-amber-400">{t("admin.litePanel.setupMissing")}</p>
          )}
          <p className="text-xs text-zinc-500">{t("admin.litePanel.setupCatalogNote")}</p>
        </section>
      )}
    </div>
  );

  function renderEditor() {
    return (
      <div className="flex flex-col gap-3 rounded-lg border border-emerald-300 bg-emerald-50/40 p-3 dark:border-emerald-900 dark:bg-emerald-950/20">
        <h4 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
          {editing === "new" ? t("admin.litePanel.newMod") : t("admin.litePanel.editMod", { id: editing ?? "" })}
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
    );
  }
}
