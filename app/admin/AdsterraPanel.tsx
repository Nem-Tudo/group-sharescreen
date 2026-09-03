"use client";

import { useEffect, useState } from "react";
import { fetchAdsterraEnabled, setAdsterraEnabled } from "@/lib/adminApi";

// The Adsterra kill switch.
//
// Live in both directions: the API pushes the new value down every open
// socket before it answers this request (see broadcastAdsConfig), so slots
// empty or appear on tabs that are already open, and it stores the value in
// the database, so a restart does not quietly turn advertising back on.
//
// What it deliberately does *not* touch is the partner ad above. Those are
// two different advertisers sharing one square in the room, and switching off
// the network that pays per impression should hand the slot back to the ad
// the room sold itself — not leave the room with no ad at all.
export function AdsterraPanel() {
  // undefined = still loading the current state from the server.
  const [enabled, setEnabled] = useState<boolean | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchAdsterraEnabled()
      .then((value) => {
        if (!cancelled) setEnabled(value);
      })
      .catch(() => {
        // Matches what the site itself assumes when the config cannot be
        // read (see lib/useAdsterraEnabled.ts): on. A panel that showed
        // "Desativado" after a failed read would be reporting a state the
        // visitors are not in.
        if (!cancelled) setEnabled(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleToggle() {
    if (enabled === undefined || saving) return;
    setSaving(true);
    setError(null);
    try {
      setEnabled(await setAdsterraEnabled(!enabled));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao atualizar.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
        Anúncios da Adsterra
      </h2>
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
        Liga e desliga os anúncios da rede em todo o site — home, salas públicas, perfis e o slot
        da sala. Vale na hora: as abas que já estão abertas somem com o anúncio sem precisar
        recarregar. Fica salvo no banco, então sobrevive a reinícios da API.
      </p>
      <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
        Não mexe nos anúncios de parceiro acima. Com a Adsterra desligada, o slot da sala volta a
        ser só do parceiro, como era antes dela existir. Quem assina o Pro continua sem ver
        anúncio nenhum de qualquer forma.
      </p>

      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          onClick={handleToggle}
          disabled={enabled === undefined || saving}
          aria-pressed={enabled === true}
          className={`rounded-lg px-4 py-2 text-sm font-medium text-white transition disabled:cursor-not-allowed disabled:opacity-50 ${
            enabled ? "bg-emerald-600 hover:bg-emerald-700" : "bg-red-600 hover:bg-red-700"
          }`}
        >
          {enabled === undefined
            ? "Carregando..."
            : saving
              ? "Salvando..."
              : enabled
                ? "Ativados"
                : "Desativados"}
        </button>
        {error && <span className="text-sm text-red-500">{error}</span>}
      </div>
    </div>
  );
}
