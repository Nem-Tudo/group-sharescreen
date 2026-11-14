"use client";

import { useEffect, useState } from "react";
import {
  saveShopeeSync,
  startShopeeSync,
  type AffiliateProductList,
  type ShopeeSyncConfig,
} from "@/lib/adminApi";
import { formatLocale } from "@/lib/i18n";
import { AFFILIATE_INTEREST_IDS, interestLabel } from "./AffiliateInterestChips";

// The Shopee sync (the API's affiliateShopee.ts): search terms per interest,
// products made from the best offers of each, prices refreshed every 6 hours.
// Lives inside the affiliate products panel and shares its polling.

const inputClass =
  "mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50";
const labelClass = "text-xs font-medium text-zinc-600 dark:text-zinc-400";

function keywordsText(keywords: Record<string, string[]>): Record<string, string> {
  return Object.fromEntries(AFFILIATE_INTEREST_IDS.map((id) => [id, (keywords[id] ?? []).join("\n")]));
}

export function AffiliateShopeePanel({
  shopee,
  configured,
  onList,
}: {
  shopee: ShopeeSyncConfig | undefined;
  configured: boolean;
  onList: (list: AffiliateProductList) => void;
}) {
  const [open, setOpen] = useState(false);
  const [perKeyword, setPerKeyword] = useState(3);
  const [words, setWords] = useState<Record<string, string>>({});
  const [loadedForm, setLoadedForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The form is filled once from the server, then left to the admin: polling
  // must not overwrite what somebody is typing.
  useEffect(() => {
    if (!shopee || loadedForm) return;
    const timer = setTimeout(() => {
      setPerKeyword(shopee.perKeyword);
      setWords(keywordsText(shopee.keywords));
      setLoadedForm(true);
    }, 0);
    return () => clearTimeout(timer);
  }, [shopee, loadedForm]);

  if (!shopee) return null;

  // The API answers null for a round that died mid-way (older than its lock).
  const running = shopee.runningSince !== null;

  async function save(patch: Parameters<typeof saveShopeeSync>[0]) {
    setError(null);
    setSaving(true);
    try {
      onList(await saveShopeeSync(patch));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não consegui salvar.");
    } finally {
      setSaving(false);
    }
  }

  function saveForm() {
    const keywords = Object.fromEntries(
      AFFILIATE_INTEREST_IDS.map((id) => [
        id,
        (words[id] ?? "")
          .split("\n")
          .map((w) => w.trim())
          .filter(Boolean),
      ])
    );
    void save({ perKeyword, keywords });
  }

  async function syncNow() {
    setError(null);
    setStarting(true);
    try {
      await startShopeeSync();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não consegui começar.");
    } finally {
      setStarting(false);
    }
  }

  return (
    <div className="mt-4 rounded-lg border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900/40">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">Catálogo automático da Shopee</span>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="text-xs font-semibold text-zinc-700 underline underline-offset-2 dark:text-zinc-300"
        >
          {open ? "Fechar" : "Configurar"}
        </button>
      </div>

      {!configured ? (
        <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
          Desligado: faltam <code>SHOPEE_AFFILIATE_APP_ID</code> e <code>SHOPEE_AFFILIATE_SECRET</code> no .env da
          API (portal de afiliados da Shopee → Open API).
        </p>
      ) : (
        <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-zinc-600 dark:text-zinc-400">
          <label className="flex cursor-pointer items-center gap-1 font-semibold">
            <input
              type="checkbox"
              checked={shopee.enabled}
              disabled={saving}
              onChange={() => void save({ enabled: !shopee.enabled })}
              className="h-3.5 w-3.5 rounded border-zinc-300 dark:border-zinc-700"
            />
            Sincronizar a cada 6 horas
          </label>
          <label className="flex cursor-pointer items-center gap-1 font-semibold">
            <input
              type="checkbox"
              checked={shopee.autoEnable}
              disabled={saving}
              onChange={() => void save({ autoEnable: !shopee.autoEnable })}
              className="h-3.5 w-3.5 rounded border-zinc-300 dark:border-zinc-700"
            />
            Produtos novos já entram ativos
          </label>
          <button
            type="button"
            onClick={syncNow}
            disabled={starting || running}
            className="rounded-lg border border-zinc-300 px-3 py-1 font-medium text-zinc-700 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            {running ? "Sincronizando..." : "Sincronizar agora"}
          </button>
        </div>
      )}

      {(shopee.lastSyncAt || shopee.lastSyncError) && (
        <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
          {shopee.lastSyncAt && `Última: ${new Date(shopee.lastSyncAt).toLocaleString(formatLocale())}. `}
          {shopee.lastSyncSummary}
        </p>
      )}
      {shopee.lastSyncError && (
        <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">Erros: {shopee.lastSyncError}</p>
      )}
      {error && <p className="mt-1 text-xs text-red-500">{error}</p>}

      {open && (
        <div className="mt-3 flex flex-col gap-3 border-t border-zinc-200 pt-3 dark:border-zinc-800">
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Para cada interesse, as buscas feitas na Shopee (uma por linha). De cada busca entram as ofertas com nota
            4,5 ou mais, ordenadas por desconto e vendas. Cada produto já vem marcado com o interesse da busca, e o
            link sai com o sub id <code>golive</code> (e <code>golive</code> + <code>p13n</code> para o lado
            personalizado do experiment). O título, os interesses, o peso e o &quot;Ativo&quot; ficam com você; a
            sincronização só atualiza preço e foto. Um produto que some das buscas por 7 dias é removido. Para um
            produto não voltar, desligue em vez de remover.
          </p>
          <div className="w-40">
            <label htmlFor="shopee-per-keyword" className={labelClass}>
              Produtos por busca
            </label>
            <input
              id="shopee-per-keyword"
              type="number"
              min={1}
              max={10}
              value={perKeyword}
              onChange={(e) => setPerKeyword(Math.min(10, Math.max(1, Number(e.target.value) || 1)))}
              className={inputClass}
            />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {AFFILIATE_INTEREST_IDS.map((id) => (
              <div key={id}>
                <label htmlFor={`shopee-words-${id}`} className={labelClass}>
                  {interestLabel(id)}
                </label>
                <textarea
                  id={`shopee-words-${id}`}
                  value={words[id] ?? ""}
                  onChange={(e) => setWords((prev) => ({ ...prev, [id]: e.target.value }))}
                  rows={3}
                  className={inputClass}
                />
              </div>
            ))}
          </div>
          <div>
            <button
              type="button"
              onClick={saveForm}
              disabled={saving}
              className="rounded-lg bg-zinc-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
            >
              {saving ? "Salvando..." : "Salvar buscas"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
