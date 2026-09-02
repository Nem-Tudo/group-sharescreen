"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  createPartner,
  deletePartner,
  editPartner,
  fetchAdminPartners,
  setPartnerEmptyPercent,
  type AdminPartner,
  type PartnerInput,
  type PartnerStats,
} from "@/lib/adminApi";
import type { PartnerClickRewardPlacement } from "@/lib/partner";
import { useVideoDurationLabel } from "@/lib/useVideoDuration";
import { BsCoin } from "react-icons/bs";

const STATS_POLL_INTERVAL_MS = 3000;

// One wording for the click-reward placement, shared by the form's select and
// the badge on each ad in the list.
const CLICK_REWARD_PLACEMENT_LABELS: Record<PartnerClickRewardPlacement, string> = {
  both: "card e vídeo",
  video: "só no popup do vídeo",
  card: "só no card",
};

const inputClass =
  "mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50";
const colorInputClass =
  "mt-1 h-9 w-full cursor-pointer rounded-md border border-zinc-300 bg-white p-1 dark:border-zinc-700 dark:bg-zinc-900";
const labelClass = "text-xs font-medium text-zinc-600 dark:text-zinc-400";

type Mode = "closed" | "create" | "edit";

const emptyFormDefaults = {
  title: "",
  description: "",
  imageUrl: "",
  buttonLabel: "",
  buttonUrl: "",
  backgroundColor: "#111827",
  textColor: "#f4f4f5",
  buttonBackgroundColor: "#10b981",
  buttonTextColor: "#ffffff",
};

function toDatetimeLocalValue(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function PartnerAdsPanel() {
  // undefined = still loading.
  const [partners, setPartners] = useState<AdminPartner[] | undefined>(undefined);
  const [stats, setStats] = useState<Record<string, PartnerStats>>({});
  // Wall-clock time as of the last successful load/poll — used for the
  // "Expirado" badge below. Captured here (inside applyList, only ever
  // called from a fetch's `.then()`) rather than calling Date.now() during
  // render, which would make the render itself impure/non-deterministic.
  const [asOf, setAsOf] = useState(0);
  const [emptyPercent, setEmptyPercent] = useState(0);
  const [emptyPercentInput, setEmptyPercentInput] = useState("0");
  const [savingPercent, setSavingPercent] = useState(false);
  const [percentError, setPercentError] = useState<string | null>(null);

  const [mode, setMode] = useState<Mode>("closed");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyFormDefaults);
  const [weight, setWeight] = useState(1);
  const [neverExpires, setNeverExpires] = useState(true);
  const [expiresInput, setExpiresInput] = useState("");
  // Watch-to-earn reward — kept out of `form` (which is all plain strings
  // fed straight into controlled text inputs) since rewardPoints needs to
  // travel as a number on submit, same reasoning as `weight` above.
  const [rewardVideoUrl, setRewardVideoUrl] = useState("");
  const [rewardPointsInput, setRewardPointsInput] = useState("");
  // Click-to-earn reward — same "kept out of `form`" reasoning as the video
  // reward above. Empty amount means the ad has none, in which case the
  // placement below is never sent.
  const [clickRewardPointsInput, setClickRewardPointsInput] = useState("");
  const [clickRewardPlacement, setClickRewardPlacement] =
    useState<PartnerClickRewardPlacement>("both");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // What the preview's two buttons should show, from the form as it stands
  // right now. The duration badge is measured off the video the same way the
  // real card measures it, so a bad URL simply shows no badge here either.
  const previewRewardVideo = Boolean(rewardVideoUrl.trim() && rewardPointsInput.trim());
  const previewRewardDuration = useVideoDurationLabel(
    previewRewardVideo ? rewardVideoUrl.trim() : null
  );
  const previewCardClickReward =
    Boolean(clickRewardPointsInput.trim()) && clickRewardPlacement !== "video";

  const mountedRef = useRef(true);
  const initialLoadDone = useRef(false);

  function applyList(data: { partners: AdminPartner[]; emptyPercent: number; stats: Record<string, PartnerStats> }) {
    if (!mountedRef.current) return;
    setPartners(data.partners);
    setStats(data.stats);
    setEmptyPercent(data.emptyPercent);
    setAsOf(Date.now());
    if (!initialLoadDone.current) {
      setEmptyPercentInput(String(data.emptyPercent));
      initialLoadDone.current = true;
    }
  }

  useEffect(() => {
    mountedRef.current = true;
    fetchAdminPartners()
      .then(applyList)
      .catch(() => {
        if (mountedRef.current) setPartners([]);
      });
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Polls live engagement numbers — deliberately only refreshes the list/
  // stats/current-percent display, never emptyPercentInput or the create/
  // edit form fields, so it doesn't clobber whatever the admin is mid-typing.
  useEffect(() => {
    const interval = setInterval(() => {
      fetchAdminPartners()
        .then(applyList)
        .catch(() => {
          // Transient poll failure — keep showing the last known numbers.
        });
    }, STATS_POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  function update<K extends keyof typeof emptyFormDefaults>(key: K, value: (typeof emptyFormDefaults)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function resetForm() {
    setMode("closed");
    setEditingId(null);
    setForm(emptyFormDefaults);
    setWeight(1);
    setNeverExpires(true);
    setExpiresInput("");
    setRewardVideoUrl("");
    setRewardPointsInput("");
    setClickRewardPointsInput("");
    setClickRewardPlacement("both");
    setError(null);
  }

  function startEditing(p: AdminPartner) {
    setMode("edit");
    setEditingId(p.id);
    setForm({
      title: p.title,
      description: p.description,
      imageUrl: p.imageUrl ?? "",
      buttonLabel: p.buttonLabel,
      buttonUrl: p.buttonUrl,
      backgroundColor: p.backgroundColor ?? "#111827",
      textColor: p.textColor ?? "#f4f4f5",
      buttonBackgroundColor: p.buttonBackgroundColor ?? "#10b981",
      buttonTextColor: p.buttonTextColor ?? "#ffffff",
    });
    setWeight(p.weight);
    setNeverExpires(p.expiresAt === null);
    setExpiresInput(p.expiresAt ? toDatetimeLocalValue(p.expiresAt) : "");
    setRewardVideoUrl(p.rewardVideoUrl ?? "");
    setRewardPointsInput(p.rewardPoints != null ? String(p.rewardPoints) : "");
    setClickRewardPointsInput(p.clickRewardPoints != null ? String(p.clickRewardPoints) : "");
    setClickRewardPlacement(p.clickRewardPlacement ?? "both");
    setError(null);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const trimmedRewardVideoUrl = rewardVideoUrl.trim();
    const trimmedClickRewardPoints = clickRewardPointsInput.trim();
    if (trimmedRewardVideoUrl && !rewardPointsInput.trim()) {
      setError("Defina quantos pontos a recompensa em vídeo dá.");
      return;
    }
    setSending(true);
    try {
      const input: PartnerInput = {
        title: form.title.trim(),
        description: form.description.trim(),
        imageUrl: form.imageUrl.trim() || undefined,
        buttonLabel: form.buttonLabel.trim(),
        buttonUrl: form.buttonUrl.trim(),
        backgroundColor: form.backgroundColor.trim() || undefined,
        textColor: form.textColor.trim() || undefined,
        buttonBackgroundColor: form.buttonBackgroundColor.trim() || undefined,
        buttonTextColor: form.buttonTextColor.trim() || undefined,
        weight,
        expiresAt: neverExpires || !expiresInput ? null : new Date(expiresInput).getTime(),
        rewardVideoUrl: trimmedRewardVideoUrl || undefined,
        rewardPoints: trimmedRewardVideoUrl && rewardPointsInput.trim() ? Number(rewardPointsInput) : undefined,
        clickRewardPoints: trimmedClickRewardPoints ? Number(trimmedClickRewardPoints) : undefined,
        clickRewardPlacement: trimmedClickRewardPoints ? clickRewardPlacement : undefined,
      };
      if (mode === "edit" && editingId) {
        await editPartner(editingId, input);
      } else {
        await createPartner(input);
      }
      const fresh = await fetchAdminPartners();
      applyList(fresh);
      resetForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao salvar anúncio.");
    } finally {
      setSending(false);
    }
  }

  async function handleDelete(id: string) {
    setError(null);
    try {
      await deletePartner(id);
      const fresh = await fetchAdminPartners();
      applyList(fresh);
      if (editingId === id) resetForm();
    } catch {
      setError("Falha ao remover anúncio.");
    }
  }

  async function handleSavePercent() {
    setPercentError(null);
    const value = Number(emptyPercentInput);
    if (!Number.isFinite(value) || value < 0 || value > 100) {
      setPercentError("Use um número entre 0 e 100.");
      return;
    }
    setSavingPercent(true);
    try {
      const saved = await setPartnerEmptyPercent(value);
      setEmptyPercent(saved);
      setEmptyPercentInput(String(saved));
    } catch {
      setPercentError("Falha ao salvar a porcentagem.");
    } finally {
      setSavingPercent(false);
    }
  }

  const needsSave = String(emptyPercent) !== emptyPercentInput.trim();

  return (
    <div className="mb-8 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Anúncios de parceiros</h2>
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
        Gerencia os anúncios exibidos no card lateral das salas. Atualiza ao vivo via socket para quem já
        está com a sala aberta; quem abre/recarrega a página busca via HTTP.
      </p>

      <div className="mt-4 rounded-lg border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900/40">
        <label htmlFor="partner-empty-percent" className={labelClass}>
          Porcentagem de requests que retornam vazio (mostra o &quot;anuncie aqui&quot;)
        </label>
        <div className="mt-1 flex items-center gap-2">
          <input
            id="partner-empty-percent"
            type="number"
            min={0}
            max={100}
            value={emptyPercentInput}
            onChange={(e) => setEmptyPercentInput(e.target.value)}
            className="w-24 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-950 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
          />
          <span className="text-sm text-zinc-500 dark:text-zinc-400">%</span>
          <button
            type="button"
            onClick={handleSavePercent}
            disabled={savingPercent || !needsSave}
            className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            {savingPercent ? "Salvando..." : "Salvar"}
          </button>
        </div>
        {percentError && <p className="mt-1 text-xs text-red-500">{percentError}</p>}
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          Só afeta quem abre/recarrega a página (busca via HTTP) — quem já está online nunca recebe vazio
          por causa dessa regra quando um anúncio é criado, editado ou removido.
        </p>
      </div>

      {partners === undefined ? (
        <p className="mt-4 text-sm text-zinc-500 dark:text-zinc-400">Carregando anúncios...</p>
      ) : partners.length === 0 && mode === "closed" ? (
        <p className="mt-4 text-sm text-zinc-500 dark:text-zinc-400">Nenhum anúncio cadastrado.</p>
      ) : (
        <div className="mt-4 flex flex-col gap-2">
          {partners.map((p) => {
            const expired = p.expiresAt !== null && p.expiresAt <= asOf;
            const s = stats[p.id] ?? { views: 0, clicks: 0 };
            // Click-through rate against unique people, not against total
            // impressions: with rotation the same person can be served the
            // same ad several times in one session, and a ratio whose
            // denominator grows every five minutes while nobody new arrives
            // is a number that only ever falls.
            const clicksByVideo = s.clicksByVideo ?? 0;
            const totalClicks = s.clicks + clicksByVideo;
            const ctr =
              s.uniqueViews && s.uniqueViews > 0
                ? `${((totalClicks / s.uniqueViews) * 100).toFixed(1)}%`
                : null;
            return (
              <div
                key={p.id}
                className={`rounded-lg border px-3 py-2 text-xs ${
                  expired
                    ? "border-zinc-200 bg-zinc-50 opacity-60 dark:border-zinc-800 dark:bg-zinc-900/40"
                    : "border-zinc-200 dark:border-zinc-800"
                }`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 flex-1 truncate font-medium text-zinc-800 dark:text-zinc-200">
                    {p.title}
                  </span>
                  {expired && (
                    <span className="shrink-0 rounded-full bg-zinc-200 px-2 py-0.5 text-[10px] font-semibold uppercase text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                      Expirado
                    </span>
                  )}
                  {p.rewardVideoUrl && p.rewardPoints && (
                    <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-900/40 dark:text-amber-400">
                      +{p.rewardPoints} pts por vídeo
                    </span>
                  )}
                  {p.clickRewardPoints && (
                    <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-900/40 dark:text-amber-400">
                      +{p.clickRewardPoints} pts por clique (
                      {CLICK_REWARD_PLACEMENT_LABELS[p.clickRewardPlacement ?? "both"]})
                    </span>
                  )}
                  <span className="shrink-0 text-zinc-500 dark:text-zinc-400">peso {p.weight}</span>
                  <button
                    type="button"
                    onClick={() => startEditing(p)}
                    className="shrink-0 font-semibold text-zinc-700 underline underline-offset-2 dark:text-zinc-300"
                  >
                    Editar
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(p.id)}
                    className="shrink-0 font-semibold text-red-600 underline underline-offset-2 dark:text-red-400"
                  >
                    Remover
                  </button>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-zinc-500 dark:text-zinc-400">
                  <span>Expira: {p.expiresAt ? new Date(p.expiresAt).toLocaleString("pt-BR") : "nunca"}</span>
                  <span>
                    Impressões: <strong>{s.views}</strong>
                  </span>
                  <span>
                    Sessões: <strong>{s.sessionViews ?? "—"}</strong>
                  </span>
                  <span>
                    Pessoas únicas:{" "}
                    <strong>{s.uniqueViews ?? "—"}</strong>
                  </span>
                  <span>
                    Cliques no card: <strong>{s.clicks}</strong>
                  </span>
                  <span>
                    Cliques no vídeo: <strong>{clicksByVideo}</strong>
                  </span>
                  <span>
                    Cliques totais: <strong>{totalClicks}</strong>
                    {ctr ? ` (${ctr})` : ""}
                  </span>
                  <span>
                    Minimizações: <strong>{s.minimizes ?? 0}</strong>
                  </span>
                  {p.rewardVideoUrl && p.rewardPoints && (
                    <>
                      <span>
                        Apertos pra ver o vídeo: <strong>{s.rewardVideoOpens ?? 0}</strong>
                      </span>
                      <span>
                        Assistiram inteiro: <strong>{s.rewardVideoCompletions ?? 0}</strong>
                      </span>
                      <span>
                        Resgataram os pontos: <strong>{s.rewardClaims ?? 0}</strong>
                      </span>
                    </>
                  )}
                  {p.clickRewardPoints && (
                    <span>
                      Resgataram os pontos por clique:{" "}
                      <strong>{s.clickRewardClaims ?? 0}</strong>
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {mode === "closed" ? (
        <button
          type="button"
          onClick={() => setMode("create")}
          className="mt-4 rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
        >
          + Novo anúncio
        </button>
      ) : (
        <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-3 border-t border-zinc-200 pt-4 dark:border-zinc-800">
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-500">
            {mode === "edit" ? "Editando anúncio" : "Novo anúncio"}
          </p>

          <div>
            <label htmlFor="partner-title" className={labelClass}>
              Título
            </label>
            <input
              id="partner-title"
              value={form.title}
              onChange={(e) => update("title", e.target.value)}
              maxLength={80}
              className={inputClass}
            />
          </div>

          <div>
            <label htmlFor="partner-description" className={labelClass}>
              Descrição
            </label>
            <textarea
              id="partner-description"
              value={form.description}
              onChange={(e) => update("description", e.target.value)}
              maxLength={400}
              rows={2}
              className={inputClass}
            />
          </div>

          <div>
            <label htmlFor="partner-image" className={labelClass}>
              URL da imagem (opcional)
            </label>
            <input
              id="partner-image"
              value={form.imageUrl}
              onChange={(e) => update("imageUrl", e.target.value)}
              placeholder="https://..."
              className={inputClass}
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="partner-button-label" className={labelClass}>
                Label do botão
              </label>
              <input
                id="partner-button-label"
                value={form.buttonLabel}
                onChange={(e) => update("buttonLabel", e.target.value)}
                maxLength={40}
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="partner-button-url" className={labelClass}>
                Link do botão
              </label>
              <input
                id="partner-button-url"
                value={form.buttonUrl}
                onChange={(e) => update("buttonUrl", e.target.value)}
                placeholder="https://..."
                className={inputClass}
              />
            </div>
          </div>

          <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900/40">
            <p className={labelClass}>Recompensa em vídeo (opcional)</p>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              Se preenchido, o card mostra um botão &quot;Ganhar X Pontos&quot; que abre esse vídeo em um
              popup. Sem como avançar — só libera a recompensa quando o vídeo termina, e cada conta só
              recebe uma vez.
            </p>
            <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto]">
              <div>
                <label htmlFor="partner-reward-video" className={labelClass}>
                  Link do vídeo (mp4)
                </label>
                <input
                  id="partner-reward-video"
                  value={rewardVideoUrl}
                  onChange={(e) => setRewardVideoUrl(e.target.value)}
                  placeholder="https://cdn.../video.mp4"
                  className={inputClass}
                />
              </div>
              <div>
                <label htmlFor="partner-reward-points" className={labelClass}>
                  Pontos ao assistir
                </label>
                <input
                  id="partner-reward-points"
                  type="number"
                  min={1}
                  max={100000}
                  value={rewardPointsInput}
                  onChange={(e) => setRewardPointsInput(e.target.value)}
                  disabled={!rewardVideoUrl.trim()}
                  className={`${inputClass} sm:w-32 disabled:cursor-not-allowed disabled:opacity-50`}
                />
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900/40">
            <p className={labelClass}>Pontos por clique (opcional)</p>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              Se preenchido, o botão principal do anúncio vira &quot;[moeda] X {"{label}"}&quot; e dá
              esses pontos na primeira vez que a pessoa clicar. O link abre normalmente de qualquer
              jeito — cada conta recebe uma vez só, e isso é independente da recompensa em vídeo.
            </p>
            <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-[auto_1fr]">
              <div>
                <label htmlFor="partner-click-reward-points" className={labelClass}>
                  Pontos ao clicar
                </label>
                <input
                  id="partner-click-reward-points"
                  type="number"
                  min={1}
                  max={100000}
                  value={clickRewardPointsInput}
                  onChange={(e) => setClickRewardPointsInput(e.target.value)}
                  className={`${inputClass} sm:w-32`}
                />
              </div>
              <div>
                <label htmlFor="partner-click-reward-placement" className={labelClass}>
                  Onde vale
                </label>
                <select
                  id="partner-click-reward-placement"
                  value={clickRewardPlacement}
                  onChange={(e) =>
                    setClickRewardPlacement(e.target.value as PartnerClickRewardPlacement)
                  }
                  disabled={!clickRewardPointsInput.trim()}
                  className={`${inputClass} disabled:cursor-not-allowed disabled:opacity-50`}
                >
                  <option value="both">{CLICK_REWARD_PLACEMENT_LABELS.both}</option>
                  <option value="video">{CLICK_REWARD_PLACEMENT_LABELS.video}</option>
                  <option value="card">{CLICK_REWARD_PLACEMENT_LABELS.card}</option>
                </select>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <label htmlFor="partner-bg" className={labelClass}>
                Fundo
              </label>
              <input
                id="partner-bg"
                type="color"
                value={form.backgroundColor}
                onChange={(e) => update("backgroundColor", e.target.value)}
                className={colorInputClass}
              />
            </div>
            <div>
              <label htmlFor="partner-text" className={labelClass}>
                Texto
              </label>
              <input
                id="partner-text"
                type="color"
                value={form.textColor}
                onChange={(e) => update("textColor", e.target.value)}
                className={colorInputClass}
              />
            </div>
            <div>
              <label htmlFor="partner-btn-bg" className={labelClass}>
                Fundo do botão
              </label>
              <input
                id="partner-btn-bg"
                type="color"
                value={form.buttonBackgroundColor}
                onChange={(e) => update("buttonBackgroundColor", e.target.value)}
                className={colorInputClass}
              />
            </div>
            <div>
              <label htmlFor="partner-btn-text" className={labelClass}>
                Texto do botão
              </label>
              <input
                id="partner-btn-text"
                type="color"
                value={form.buttonTextColor}
                onChange={(e) => update("buttonTextColor", e.target.value)}
                className={colorInputClass}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:items-end">
            <div>
              <label htmlFor="partner-weight" className={labelClass}>
                Peso (distribuição entre anúncios ativos)
              </label>
              <input
                id="partner-weight"
                type="number"
                min={1}
                max={100}
                value={weight}
                onChange={(e) => setWeight(Math.max(1, Number(e.target.value) || 1))}
                className={inputClass}
              />
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                1 = mesma chance que os outros, 2 = o dobro, etc.
              </p>
            </div>
            <label className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
              <input
                type="checkbox"
                checked={neverExpires}
                onChange={(e) => setNeverExpires(e.target.checked)}
                className="h-4 w-4 rounded border-zinc-300 dark:border-zinc-700"
              />
              Nunca expira
            </label>
          </div>

          {!neverExpires && (
            <div>
              <label htmlFor="partner-expires" className={labelClass}>
                Expira em
              </label>
              <input
                id="partner-expires"
                type="datetime-local"
                value={expiresInput}
                onChange={(e) => setExpiresInput(e.target.value)}
                className={inputClass}
              />
            </div>
          )}

          {error && <p className="text-sm text-red-500">{error}</p>}

          <div className="mt-1 flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={sending || !form.title.trim() || !form.buttonLabel.trim() || !form.buttonUrl.trim()}
              className="rounded-lg bg-zinc-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
            >
              {sending ? "Salvando..." : mode === "edit" ? "Salvar edição" : "Criar anúncio"}
            </button>
            <button
              type="button"
              onClick={resetForm}
              className="rounded-lg px-4 py-2 text-sm font-medium text-zinc-500 transition hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
            >
              Cancelar
            </button>
          </div>

          {/* Always on. It costs one narrow column and answers the question
              the form otherwise leaves open — what the two reward buttons
              actually end up saying — so there is nothing here worth hiding
              behind a toggle. Mirrors PartnerCard's real markup; when the two
              drift, that one is the original. */}
          <div>
            <p className={labelClass}>Preview</p>
            <div
              className="mt-1 w-72 max-w-full overflow-hidden rounded-lg border border-zinc-200 p-4 dark:border-zinc-800"
              style={{ backgroundColor: form.backgroundColor, color: form.textColor }}
            >
              <div className="mb-2 flex items-center">
                <span className="rounded-full bg-black/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide opacity-70 dark:bg-white/10">
                  Patrocinado
                </span>
              </div>
              {form.imageUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={form.imageUrl} alt="" className="mb-2 max-h-32 w-full rounded-lg object-cover" />
              )}
              <p className="text-sm font-semibold">{form.title || "Título do anúncio"}</p>
              <p className="mt-1 whitespace-pre-line text-xs opacity-80">
                {form.description || "Descrição do anúncio"}
              </p>
              <div
                className="mt-3 flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-center text-sm font-semibold"
                style={{ backgroundColor: form.buttonBackgroundColor, color: form.buttonTextColor }}
              >
                {previewCardClickReward && (
                  <>
                    <BsCoin className="h-4 w-4 shrink-0" />
                    <span className="shrink-0 tabular-nums">{clickRewardPointsInput.trim()}</span>
                  </>
                )}
                <span className="truncate">{form.buttonLabel || "Botão"}</span>
              </div>
              {previewRewardVideo && (
                <div
                  className={`mt-2 flex w-full items-center ${
                    previewRewardDuration ? "justify-between" : "justify-center"
                  } gap-2 rounded-lg border border-current px-3 py-1.5 text-xs font-semibold opacity-90`}
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    Resgatar
                    <BsCoin className="h-3.5 w-3.5 shrink-0" />
                    {rewardPointsInput.trim()}
                  </span>
                  {previewRewardDuration && (
                    <span className="shrink-0 rounded-full bg-black/10 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums dark:bg-white/10">
                      {previewRewardDuration}
                    </span>
                  )}
                </div>
              )}
            </div>
            {clickRewardPointsInput.trim() && clickRewardPlacement === "video" && (
              <p className="mt-1.5 w-72 max-w-full text-xs text-zinc-500 dark:text-zinc-400">
                Os pontos por clique não aparecem aqui porque estão configurados só para o popup do
                vídeo.
              </p>
            )}
          </div>
        </form>
      )}
    </div>
  );
}
