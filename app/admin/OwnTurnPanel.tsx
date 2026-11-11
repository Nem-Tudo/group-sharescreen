"use client";

import { useEffect, useState } from "react";
import { fetchOwnTurn, saveOwnTurn, type OwnTurnServer } from "@/lib/adminApi";
import { useT } from "@/lib/useI18n";

// Editor for the own (VPS) TURN servers, stored in the database and pushed to
// every open tab the moment it is saved (see the API's ownTurn.ts). A JSON
// textarea rather than a field-by-field form on purpose: this is an infra tool
// used rarely by an admin who knows the shape, and the server validates and
// drops anything malformed before it can reach a client, so the plain list is
// the honest, low-ceremony surface. The credentials here are handed to every
// client — public, exactly like the build's NEXT_PUBLIC_TURN_* — so this is for
// changing the list live, not for secrets (those stay in OWN_TURN_SECRET).

const PLACEHOLDER = `[
  {
    "label": "crystal",
    "urls": ["turn:turn.crystal.lat:3478?transport=udp", "turn:turn.crystal.lat:3478?transport=tcp"],
    "username": "crystal",
    "credential": "senha",
    "enabled": true
  }
]`;

function format(servers: OwnTurnServer[]): string {
  return servers.length === 0 ? "[]" : JSON.stringify(servers, null, 2);
}

export function OwnTurnPanel() {
  const t = useT();
  const [text, setText] = useState<string>("");
  const [loaded, setLoaded] = useState(false);
  const [envConfigured, setEnvConfigured] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchOwnTurn()
      .then((value) => {
        if (cancelled) return;
        setText(format(value.servers));
        setEnvConfigured(value.envConfigured);
        setLoaded(true);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : t("common.couldNotUpdate"));
      });
    return () => {
      cancelled = true;
    };
  }, [t]);

  async function handleSave() {
    if (saving) return;
    setError(null);
    setNotice(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text || "[]");
    } catch {
      setError(t("admin.ownTurnPanel.invalidJson"));
      return;
    }
    if (!Array.isArray(parsed)) {
      setError(t("admin.ownTurnPanel.mustBeArray"));
      return;
    }
    setSaving(true);
    try {
      const result = await saveOwnTurn(parsed as OwnTurnServer[]);
      setText(format(result.servers));
      setEnvConfigured(result.envConfigured);
      setNotice(
        result.dropped > 0
          ? t("admin.ownTurnPanel.savedWithDropped", {
              count: String(result.servers.length),
              dropped: String(result.dropped),
            })
          : t("admin.ownTurnPanel.saved", { count: String(result.servers.length) })
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.couldNotUpdate"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">{t("admin.ownTurnPanel.title")}</h2>
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{t("admin.ownTurnPanel.description")}</p>

      <textarea
        value={loaded ? text : ""}
        onChange={(event) => setText(event.target.value)}
        placeholder={loaded ? PLACEHOLDER : t("common.loading2")}
        disabled={!loaded || saving}
        spellCheck={false}
        rows={12}
        className="mt-3 w-full resize-y rounded-lg border border-zinc-200 bg-zinc-50 p-2.5 font-mono text-xs text-zinc-800 outline-none focus:border-zinc-400 disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200"
      />

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={!loaded || saving}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? t("common.saving") : t("admin.ownTurnPanel.save")}
        </button>
        {notice && <span className="text-sm text-emerald-600 dark:text-emerald-500">{notice}</span>}
        {error && <span className="text-sm text-red-500">{error}</span>}
      </div>

      {envConfigured && (
        <p className="mt-3 text-[11px] text-zinc-400 dark:text-zinc-500">{t("admin.ownTurnPanel.envNote")}</p>
      )}
      <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-500">{t("admin.ownTurnPanel.publicWarning")}</p>
    </div>
  );
}
