"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import useNtPopups from "ntpopups";
import { BsCoin } from "react-icons/bs";
import { MdContentCopy, MdOpenInNew } from "react-icons/md";
import {
  createAffiliateProduct,
  deleteAffiliateProduct,
  editAffiliateProduct,
  fetchAffiliateProducts,
  importAffiliateProduct,
  patchAffiliateProduct,
  setAffiliateAdsPercent,
  type AffiliateProduct,
  type AffiliateProductInput,
  type AffiliateProductList,
} from "@/lib/adminApi";
import { AffiliateProductCard } from "@/components/AffiliateProductCard";
import { partnerRewardPopupSize, type PartnerRewardPopupData } from "@/components/PartnerRewardModal";
import { AFFILIATE_PRODUCTS_FEATURE, formatProductPrice } from "@/lib/affiliateProducts";
import { formatLocale } from "@/lib/i18n";
import { useT } from "@/lib/useI18n";
import { PartnerMediaDrop } from "./PartnerMediaDrop";

const STATS_POLL_INTERVAL_MS = 3000;

const inputClass =
  "mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50";
const labelClass = "text-xs font-medium text-zinc-600 dark:text-zinc-400";

type Mode = "closed" | "create" | "edit";

// Every field as the text in its input; prices become numbers on submit.
const emptyForm = {
  url: "",
  title: "",
  description: "",
  imageUrl: "",
  store: "",
  price: "",
  originalPrice: "",
  currency: "BRL",
  badge: "",
  note: "",
  shipping: "",
  buttonLabel: "",
  rewardVideoUrl: "",
  rewardPoints: "",
};

function priceText(value: number | null): string {
  return value === null ? "" : String(value);
}

/** "868,97" and "868.97" alike. Empty, or anything unreadable, is no price. */
function parsePrice(text: string): number | null {
  const value = Number(text.trim().replace(",", "."));
  return text.trim() && Number.isFinite(value) && value >= 0 ? value : null;
}

export function AffiliateProductsPanel() {
  const t = useT();
  const { openPopup } = useNtPopups();
  const [products, setProducts] = useState<AffiliateProduct[] | undefined>(undefined);
  const [stats, setStats] = useState<AffiliateProductList["stats"]>({});
  const [adsPercent, setAdsPercent] = useState(100);
  // The slider's own position, apart from what is saved: polling must not drag
  // it back while somebody is moving it.
  const [adsInput, setAdsInput] = useState(100);
  const [savingPercent, setSavingPercent] = useState(false);
  const [percentError, setPercentError] = useState<string | null>(null);

  const [mode, setMode] = useState<Mode>("closed");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [weight, setWeight] = useState(1);
  const [enabled, setEnabled] = useState(true);
  const [autoUpdatePrice, setAutoUpdatePrice] = useState(false);
  // Which product's report link was just copied, for the button to say so.
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  const mountedRef = useRef(true);
  const initialLoadDone = useRef(false);

  function applyList(data: AffiliateProductList) {
    if (!mountedRef.current) return;
    setProducts(data.products);
    setStats(data.stats);
    setAdsPercent(data.adsPercent);
    if (!initialLoadDone.current) {
      setAdsInput(data.adsPercent);
      initialLoadDone.current = true;
    }
  }

  useEffect(() => {
    mountedRef.current = true;
    fetchAffiliateProducts()
      .then(applyList)
      .catch(() => {
        if (mountedRef.current) setProducts([]);
      });
    const interval = setInterval(() => {
      fetchAffiliateProducts()
        .then(applyList)
        .catch(() => {
          // Transient poll failure: keep the last known numbers.
        });
    }, STATS_POLL_INTERVAL_MS);
    return () => {
      mountedRef.current = false;
      clearInterval(interval);
    };
  }, []);

  function update(key: keyof typeof emptyForm, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function resetForm() {
    setMode("closed");
    setEditingId(null);
    setForm(emptyForm);
    setWeight(1);
    setEnabled(true);
    setAutoUpdatePrice(false);
    setError(null);
    setImportError(null);
  }

  function startEditing(p: AffiliateProduct) {
    setMode("edit");
    setEditingId(p.id);
    setForm({
      url: p.url,
      title: p.title,
      description: p.description,
      imageUrl: p.imageUrl ?? "",
      store: p.store,
      price: priceText(p.price),
      originalPrice: priceText(p.originalPrice),
      currency: p.currency,
      badge: p.badge,
      note: p.note,
      shipping: p.shipping,
      buttonLabel: p.buttonLabel,
      rewardVideoUrl: p.rewardVideoUrl ?? "",
      rewardPoints: p.rewardPoints != null ? String(p.rewardPoints) : "",
    });
    setWeight(p.weight);
    setEnabled(p.enabled);
    setAutoUpdatePrice(Boolean(p.autoUpdatePrice));
    setError(null);
    setImportError(null);
  }

  // Fills the form from the link; nothing is saved until the admin saves. Also
  // how a saved product's price gets brought up to date: edit, import, save.
  async function handleImport() {
    setImportError(null);
    setImporting(true);
    try {
      const found = await importAffiliateProduct(form.url.trim());
      if (!mountedRef.current) return;
      setForm((prev) => ({
        ...prev,
        title: found.title,
        description: found.description,
        imageUrl: found.imageUrl ?? "",
        store: found.store,
        price: priceText(found.price),
        originalPrice: priceText(found.originalPrice),
        currency: found.currency,
        badge: found.badge,
        note: found.note,
        shipping: found.shipping,
      }));
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Não consegui ler esse link.");
    } finally {
      setImporting(false);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const videoUrl = form.rewardVideoUrl.trim();
    if (videoUrl && !form.rewardPoints.trim()) {
      setError("Diga quantos pontos o vídeo dá.");
      return;
    }
    setSending(true);
    try {
      const input: AffiliateProductInput = {
        url: form.url.trim(),
        title: form.title.trim(),
        description: form.description.trim(),
        imageUrl: form.imageUrl.trim() || null,
        store: form.store.trim(),
        price: parsePrice(form.price),
        originalPrice: parsePrice(form.originalPrice),
        currency: form.currency,
        badge: form.badge.trim(),
        note: form.note.trim(),
        shipping: form.shipping.trim(),
        buttonLabel: form.buttonLabel.trim(),
        weight,
        enabled,
        autoUpdatePrice,
        rewardVideoUrl: videoUrl || null,
        rewardPoints: videoUrl ? Number(form.rewardPoints) : null,
      };
      const fresh =
        mode === "edit" && editingId
          ? await editAffiliateProduct(editingId, input)
          : await createAffiliateProduct(input);
      applyList(fresh);
      resetForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não consegui salvar o produto.");
    } finally {
      setSending(false);
    }
  }

  async function handleSwitch(p: AffiliateProduct, patch: { enabled?: boolean; autoUpdatePrice?: boolean }) {
    setError(null);
    try {
      applyList(await patchAffiliateProduct(p.id, patch));
    } catch {
      setError("Não consegui mudar o produto.");
    }
  }

  async function handleDelete(id: string) {
    setError(null);
    try {
      applyList(await deleteAffiliateProduct(id));
      if (editingId === id) resetForm();
    } catch {
      setError("Não consegui remover o produto.");
    }
  }

  // The public report lives on this same site (see app/ad/[token]), like an ad's.
  function reportUrl(token: string): string {
    if (typeof window === "undefined") return "";
    return `${window.location.origin}/ad/${encodeURIComponent(token)}`;
  }

  async function copyReportLink(p: AffiliateProduct) {
    if (!p.reportToken) return;
    try {
      await navigator.clipboard.writeText(reportUrl(p.reportToken));
      setCopiedId(p.id);
      setTimeout(() => {
        if (mountedRef.current) setCopiedId((current) => (current === p.id ? null : current));
      }, 2000);
    } catch {
      // No clipboard: the link beside this button still opens the report.
    }
  }

  // The real reward popup, filled from the form, in preview mode: nothing it
  // does is counted or paid.
  function openRewardPreview() {
    const videoUrl = form.rewardVideoUrl.trim();
    if (!videoUrl) return;
    const data: PartnerRewardPopupData = {
      partnerId: editingId ?? "admin-preview",
      videoUrl,
      points: Number(form.rewardPoints.trim()) || 0,
      title: form.title.trim() || "Título do produto",
      description: form.description.trim(),
      extendedDescription: null,
      imageUrl: form.imageUrl.trim() || null,
      buttonLabel: form.buttonLabel.trim(),
      buttonUrl: form.url.trim() || "#",
      isProduct: true,
      preview: true,
    };
    openPopup("partner_reward", {
      ...partnerRewardPopupSize(false),
      closeOnEscape: false,
      closeOnClickOutside: false,
      requireAction: true,
      data,
    });
  }

  async function handleSavePercent() {
    setPercentError(null);
    setSavingPercent(true);
    try {
      const saved = await setAffiliateAdsPercent(adsInput);
      setAdsPercent(saved);
      setAdsInput(saved);
    } catch {
      setPercentError("Não consegui salvar a proporção.");
    } finally {
      setSavingPercent(false);
    }
  }

  const enabledWeight = (products ?? []).filter((p) => p.enabled).reduce((sum, p) => sum + p.weight, 0);

  return (
    <div className="mb-8 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Produtos de afiliados</h2>
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
        Entram em rotação no mesmo espaço dos anúncios acima. Só aparecem para quem está no experiment{" "}
        <code>{AFFILIATE_PRODUCTS_FEATURE}</code> (aba Features).
      </p>

      <div className="mt-4 rounded-lg border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900/40">
        <div className="flex items-center justify-between gap-2 text-xs font-semibold text-zinc-700 dark:text-zinc-300">
          <span>Anúncios {adsInput}%</span>
          <span>Produtos {100 - adsInput}%</span>
        </div>
        <input
          type="range"
          min={0}
          max={100}
          value={adsInput}
          onChange={(e) => setAdsInput(Number(e.target.value))}
          aria-label="Chance de vir um anúncio em vez de um produto"
          className="mt-2 w-full cursor-pointer"
        />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleSavePercent}
            disabled={savingPercent || adsInput === adsPercent}
            className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            {savingPercent ? "Salvando..." : "Salvar"}
          </button>
          {percentError && <span className="text-xs text-red-500">{percentError}</span>}
        </div>
        <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
          Primeiro sorteia o tipo; depois os pesos dividem só dentro dele. Se um lado não tem nada ativo, o outro
          fica com o espaço inteiro. O &quot;% de respostas vazias&quot; lá de cima continua valendo antes disso.
        </p>
      </div>

      {products === undefined ? (
        <p className="mt-4 text-sm text-zinc-500 dark:text-zinc-400">Carregando produtos...</p>
      ) : products.length === 0 && mode === "closed" ? (
        <p className="mt-4 text-sm text-zinc-500 dark:text-zinc-400">Nenhum produto cadastrado.</p>
      ) : (
        <div className="mt-4 flex flex-col gap-2">
          {products.map((p) => {
            const s = stats[p.id] ?? { views: 0, clicks: 0 };
            // Against unique people rather than impressions, like an ad's: the
            // same person is served again on every rotation.
            const clicksByVideo = s.clicksByVideo ?? 0;
            const totalClicks = s.clicks + clicksByVideo;
            const ctr =
              s.uniqueViews && s.uniqueViews > 0 ? `${((totalClicks / s.uniqueViews) * 100).toFixed(1)}%` : null;
            const share = p.enabled && enabledWeight > 0 ? ((100 - adsPercent) * p.weight) / enabledWeight : 0;
            return (
              <div
                key={p.id}
                className={`rounded-lg border border-zinc-200 px-3 py-2 text-xs dark:border-zinc-800 ${
                  p.enabled ? "" : "bg-zinc-50 opacity-60 dark:bg-zinc-900/40"
                }`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  {p.imageUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.imageUrl} alt="" className="h-8 w-8 shrink-0 rounded bg-white object-contain" />
                  )}
                  {/* A whole line of its own: product titles are long, and sharing one
                      with the controls below left a single letter of it. */}
                  <span className="min-w-0 grow basis-[calc(100%-2.5rem)] truncate font-medium text-zinc-800 dark:text-zinc-200">
                    {p.title}
                  </span>
                  {p.price !== null && (
                    <span className="shrink-0 font-semibold text-zinc-700 dark:text-zinc-300">
                      {formatProductPrice(p.price, p.currency)}
                    </span>
                  )}
                  {p.rewardVideoUrl && p.rewardPoints && (
                    <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-900/40 dark:text-amber-400">
                      +{p.rewardPoints} pts por vídeo
                    </span>
                  )}
                  <span className="shrink-0 text-zinc-500 dark:text-zinc-400">peso {p.weight}</span>
                  <label className="flex shrink-0 cursor-pointer items-center gap-1 font-semibold text-zinc-700 dark:text-zinc-300">
                    <input
                      type="checkbox"
                      checked={p.enabled}
                      onChange={() => handleSwitch(p, { enabled: !p.enabled })}
                      className="h-3.5 w-3.5 rounded border-zinc-300 dark:border-zinc-700"
                    />
                    Ativo
                  </label>
                  <label className="flex shrink-0 cursor-pointer items-center gap-1 font-semibold text-zinc-700 dark:text-zinc-300">
                    <input
                      type="checkbox"
                      checked={Boolean(p.autoUpdatePrice)}
                      onChange={() => handleSwitch(p, { autoUpdatePrice: !p.autoUpdatePrice })}
                      className="h-3.5 w-3.5 rounded border-zinc-300 dark:border-zinc-700"
                    />
                    Preço automático
                  </label>
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
                  {p.reportToken && (
                    <span className="flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        onClick={() => copyReportLink(p)}
                        className="flex items-center gap-1 font-semibold text-emerald-700 underline underline-offset-2 dark:text-emerald-400"
                      >
                        <MdContentCopy className="h-3 w-3" />
                        {copiedId === p.id ? t("common.linkCopied") : t("admin.partnerAdsPanel.copyReport")}
                      </button>
                      <a
                        href={reportUrl(p.reportToken)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-zinc-500 underline underline-offset-2 dark:text-zinc-400"
                      >
                        <MdOpenInNew className="h-3 w-3" />
                        abrir
                      </a>
                    </span>
                  )}
                </div>
                <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-zinc-500 dark:text-zinc-400">
                  <span>
                    Chance com anúncios ativos: <strong>{share.toFixed(1)}%</strong>
                  </span>
                  <span>
                    {t("admin.partnerAdsPanel.impressions")} <strong>{s.views}</strong>
                  </span>
                  <span>
                    {t("admin.partnerAdsPanel.sessions")} <strong>{s.sessionViews ?? 0}</strong>
                  </span>
                  <span>
                    {t("admin.partnerAdsPanel.uniquePeople")} <strong>{s.uniqueViews ?? 0}</strong>
                  </span>
                  <span>
                    {t("admin.partnerAdsPanel.clicksOnTheCard")} <strong>{s.clicks}</strong>
                  </span>
                  <span>
                    {t("admin.partnerAdsPanel.clicksOnTheVideo")} <strong>{clicksByVideo}</strong>
                  </span>
                  <span>
                    {t("admin.partnerAdsPanel.totalClicks")} <strong>{totalClicks}</strong>
                    {ctr ? ` (${ctr})` : ""}
                  </span>
                  <span>
                    {t("admin.partnerAdsPanel.minimises")} <strong>{s.minimizes ?? 0}</strong>
                  </span>
                  {p.rewardVideoUrl && p.rewardPoints && (
                    <>
                      <span>
                        {t("admin.partnerAdsPanel.pressesToWatchTheVideo")} <strong>{s.rewardVideoOpens ?? 0}</strong>
                      </span>
                      <span>
                        {t("admin.partnerAdsPanel.watchedItFully")} <strong>{s.rewardVideoCompletions ?? 0}</strong>
                      </span>
                      <span>
                        {t("admin.partnerAdsPanel.redeemedThePoints")} <strong>{s.rewardClaims ?? 0}</strong>
                      </span>
                    </>
                  )}
                </div>
                {p.autoUpdatePrice && (
                  <p className={`mt-1 ${p.priceCheckError ? "text-amber-600 dark:text-amber-400" : "text-zinc-500 dark:text-zinc-400"}`}>
                    {p.priceCheckError
                      ? `Preço não atualizado: ${p.priceCheckError}`
                      : p.priceCheckedAt
                        ? `Preço conferido em ${new Date(p.priceCheckedAt).toLocaleString(formatLocale())}`
                        : "Primeira conferência do preço em até 10 minutos."}
                  </p>
                )}
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
          Novo produto
        </button>
      ) : (
        <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-3 border-t border-zinc-200 pt-4 dark:border-zinc-800">
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
            {mode === "edit" ? "Editando produto" : "Novo produto"}
          </p>

          <div>
            <label htmlFor="affiliate-url" className={labelClass}>
              Link de afiliado
            </label>
            <div className="flex items-start gap-2">
              <input
                id="affiliate-url"
                value={form.url}
                onChange={(e) => update("url", e.target.value)}
                placeholder="https://meli.la/..."
                className={inputClass}
              />
              <button
                type="button"
                onClick={handleImport}
                disabled={importing || !form.url.trim()}
                className="mt-1 shrink-0 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {importing ? "Lendo..." : "Importar"}
              </button>
            </div>
            {importError && <p className="mt-1 text-xs text-red-500">{importError}</p>}
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              Lê o título, a foto e os preços da página do link e preenche abaixo. Confira antes de salvar.
            </p>
          </div>

          <div>
            <label htmlFor="affiliate-title" className={labelClass}>
              Título
            </label>
            <input
              id="affiliate-title"
              value={form.title}
              onChange={(e) => update("title", e.target.value)}
              maxLength={160}
              className={inputClass}
            />
          </div>

          <div>
            <label htmlFor="affiliate-image" className={labelClass}>
              URL da imagem
            </label>
            <input
              id="affiliate-image"
              value={form.imageUrl}
              onChange={(e) => update("imageUrl", e.target.value)}
              placeholder="https://..."
              className={inputClass}
            />
            <PartnerMediaDrop kind="image" compact onUploaded={(url) => update("imageUrl", url)} />
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <label htmlFor="affiliate-price" className={labelClass}>
                Preço
              </label>
              <input
                id="affiliate-price"
                inputMode="decimal"
                value={form.price}
                onChange={(e) => update("price", e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="affiliate-original-price" className={labelClass}>
                Preço original (riscado)
              </label>
              <input
                id="affiliate-original-price"
                inputMode="decimal"
                value={form.originalPrice}
                onChange={(e) => update("originalPrice", e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="affiliate-currency" className={labelClass}>
                Moeda
              </label>
              <input
                id="affiliate-currency"
                value={form.currency}
                onChange={(e) => update("currency", e.target.value.toUpperCase())}
                maxLength={3}
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="affiliate-store" className={labelClass}>
                Loja
              </label>
              <input
                id="affiliate-store"
                value={form.store}
                onChange={(e) => update("store", e.target.value)}
                maxLength={40}
                className={inputClass}
              />
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
            <input
              type="checkbox"
              checked={autoUpdatePrice}
              onChange={(e) => setAutoUpdatePrice(e.target.checked)}
              className="h-4 w-4 rounded border-zinc-300 dark:border-zinc-700"
            />
            Atualizar o preço automaticamente
          </label>
          {autoUpdatePrice && (
            <p className="-mt-2 text-xs text-zinc-500 dark:text-zinc-400">
              A cada 6 horas lê o link e troca preço, preço original, selo, parcelamento e frete, por cima do que
              estiver aqui. Título e foto ficam como estão. Se a página mostrar outro produto ou der erro, mantém o
              preço atual e avisa na lista.
            </p>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="affiliate-badge" className={labelClass}>
                Selo de desconto (vazio = calcula pelos preços)
              </label>
              <input
                id="affiliate-badge"
                value={form.badge}
                onChange={(e) => update("badge", e.target.value)}
                maxLength={40}
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="affiliate-shipping" className={labelClass}>
                Frete
              </label>
              <input
                id="affiliate-shipping"
                value={form.shipping}
                onChange={(e) => update("shipping", e.target.value)}
                maxLength={60}
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="affiliate-note" className={labelClass}>
                Parcelamento / observação
              </label>
              <input
                id="affiliate-note"
                value={form.note}
                onChange={(e) => update("note", e.target.value)}
                maxLength={120}
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="affiliate-button-label" className={labelClass}>
                Texto do botão (vazio = &quot;Ver oferta&quot;)
              </label>
              <input
                id="affiliate-button-label"
                value={form.buttonLabel}
                onChange={(e) => update("buttonLabel", e.target.value)}
                maxLength={40}
                className={inputClass}
              />
            </div>
          </div>

          <div>
            <label htmlFor="affiliate-description" className={labelClass}>
              Descrição (opcional)
            </label>
            <textarea
              id="affiliate-description"
              value={form.description}
              onChange={(e) => update("description", e.target.value)}
              maxLength={300}
              rows={2}
              className={inputClass}
            />
          </div>

          <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900/40">
            <p className={labelClass}>{t("admin.partnerAdsPanel.videoRewardOptional")}</p>
            <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto]">
              <div>
                <label htmlFor="affiliate-reward-video" className={labelClass}>
                  {t("admin.partnerAdsPanel.videoLinkMp4")}
                </label>
                <input
                  id="affiliate-reward-video"
                  value={form.rewardVideoUrl}
                  onChange={(e) => update("rewardVideoUrl", e.target.value)}
                  placeholder="https://cdn.../video.mp4"
                  className={inputClass}
                />
                <PartnerMediaDrop kind="video" onUploaded={(url) => update("rewardVideoUrl", url)} />
              </div>
              <div>
                <label htmlFor="affiliate-reward-points" className={labelClass}>
                  {t("admin.partnerAdsPanel.pointsForWatching")}
                </label>
                <input
                  id="affiliate-reward-points"
                  type="number"
                  min={1}
                  max={100000}
                  value={form.rewardPoints}
                  onChange={(e) => update("rewardPoints", e.target.value)}
                  disabled={!form.rewardVideoUrl.trim()}
                  className={`${inputClass} sm:w-32 disabled:cursor-not-allowed disabled:opacity-50`}
                />
              </div>
            </div>
            <button
              type="button"
              onClick={openRewardPreview}
              disabled={!form.rewardVideoUrl.trim()}
              className="mt-3 rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              {t("admin.partnerAdsPanel.previewRewardVideo")}
            </button>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:items-end">
            <div>
              <label htmlFor="affiliate-weight" className={labelClass}>
                Peso (dividido entre os produtos ativos)
              </label>
              <input
                id="affiliate-weight"
                type="number"
                min={1}
                max={100}
                value={weight}
                onChange={(e) => setWeight(Math.max(1, Number(e.target.value) || 1))}
                className={inputClass}
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
                className="h-4 w-4 rounded border-zinc-300 dark:border-zinc-700"
              />
              Ativo
            </label>
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}

          <div className="mt-1 flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={sending || !form.title.trim() || !form.url.trim()}
              className="rounded-lg bg-zinc-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
            >
              {sending ? "Salvando..." : mode === "edit" ? "Salvar alterações" : "Criar produto"}
            </button>
            <button
              type="button"
              onClick={resetForm}
              className="rounded-lg px-4 py-2 text-sm font-medium text-zinc-500 transition hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
            >
              Cancelar
            </button>
          </div>

          <div>
            <p className={labelClass}>Prévia</p>
            <div className="mt-1 w-64 max-w-full">
              <AffiliateProductCard
                title={form.title || "Título do produto"}
                description={form.description}
                imageUrl={form.imageUrl.trim() || null}
                buttonLabel={form.buttonLabel}
                footer={
                  form.rewardVideoUrl.trim() && form.rewardPoints.trim() ? (
                    <div className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-current px-3 py-1.5 text-xs font-semibold opacity-90">
                      <span className="truncate">{t("common.redeem")}</span>
                      <BsCoin className="h-3.5 w-3.5 shrink-0" />
                      <span className="shrink-0 tabular-nums">{form.rewardPoints.trim()}</span>
                    </div>
                  ) : null
                }
                product={{
                  store: form.store,
                  price: parsePrice(form.price),
                  originalPrice: parsePrice(form.originalPrice),
                  currency: form.currency,
                  badge: form.badge,
                  note: form.note,
                  shipping: form.shipping,
                }}
              />
            </div>
          </div>
        </form>
      )}
    </div>
  );
}
