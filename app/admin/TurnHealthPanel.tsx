"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { subscribeIceServers, turnHealthTargets, type TurnHealthTarget } from "@/lib/iceConfig";
import { ensureIceServers } from "@/lib/iceServers";
import { useT } from "@/lib/useI18n";

// A health check for the TURN servers, run from the admin's own browser with
// real WebRTC — the same thing a call does, so it tells the truth the API
// cannot: the static servers (n1, crystal, ...) live in the frontend build's
// env (NEXT_PUBLIC_TURN_*), which the API never sees. For each server it opens
// a relay-only RTCPeerConnection holding that one server and watches for a
// `typ relay` candidate: one means the TURN allocation succeeded (server up,
// credentials good); none, by the time gathering ends or the timeout hits,
// means it is not relaying. Latency is the time to that first relay candidate.

type Status =
  | { state: "pending" }
  | { state: "ok"; ms: number; url: string }
  | { state: "fail"; detail: string };

const PROBE_TIMEOUT_MS = 8000;

function isRelay(candidate: string): boolean {
  return / typ relay( |$)/.test(candidate);
}

// One server → does it hand back a relay candidate? Relay-only transport policy
// means host/srflx candidates never gather, so the only candidate that can
// appear is a TURN one; its absence at end-of-gathering is a clean failure,
// faster than waiting out the timeout.
function probeTurn(server: RTCIceServer): Promise<Status> {
  let pc: RTCPeerConnection;
  try {
    pc = new RTCPeerConnection({ iceServers: [server], iceTransportPolicy: "relay" });
  } catch {
    return Promise.resolve({ state: "fail", detail: "config inválida" });
  }
  const start = performance.now();
  return new Promise<Status>((resolve) => {
    let settled = false;
    let lastError = "";
    const finish = (status: Status) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        pc.onicecandidate = null;
        pc.onicecandidateerror = null;
        pc.close();
      } catch {
        /* already gone */
      }
      resolve(status);
    };
    const timer = setTimeout(() => finish({ state: "fail", detail: lastError || "timeout" }), PROBE_TIMEOUT_MS);
    pc.onicecandidate = (event) => {
      const candidate = event.candidate?.candidate;
      if (!candidate) {
        // null/empty = gathering finished. No relay seen → down.
        finish({ state: "fail", detail: lastError || "sem candidato relay" });
        return;
      }
      if (isRelay(candidate)) {
        finish({ state: "ok", ms: Math.round(performance.now() - start), url: candidate });
      }
    };
    pc.onicecandidateerror = (event) => {
      // 401 (bad credentials), 701 (allocate failed), DNS/timeout — keep the
      // last one as the reason a probe that gathers nothing failed.
      const code = event.errorCode;
      const text = event.errorText || "";
      if (code) lastError = `${code} ${text}`.trim();
    };
    pc.createDataChannel("probe");
    pc.createOffer()
      .then((offer) => pc.setLocalDescription(offer))
      .catch(() => finish({ state: "fail", detail: "falha ao iniciar" }));
  });
}

export function TurnHealthPanel() {
  const t = useT();
  const [targets, setTargets] = useState<TurnHealthTarget[]>([]);
  const [results, setResults] = useState<Record<string, Status>>({});
  const [running, setRunning] = useState(false);
  const ranOnce = useRef(false);

  // Load Cloudflare's / the API's own set so they show up too (no-op if already
  // started, or if this account cannot relay), and re-read the list as it lands.
  useEffect(() => {
    ensureIceServers();
    const update = () => setTargets(turnHealthTargets());
    update();
    return subscribeIceServers(update);
  }, []);

  const runAll = useCallback(async () => {
    const list = turnHealthTargets();
    setTargets(list);
    if (list.length === 0) return;
    setRunning(true);
    setResults(Object.fromEntries(list.map((item) => [item.label, { state: "pending" as const }])));
    await Promise.all(
      list.map(async (item) => {
        const status = await probeTurn(item.server);
        setResults((prev) => ({ ...prev, [item.label]: status }));
      })
    );
    setRunning(false);
  }, []);

  // Run once automatically when the panel opens.
  useEffect(() => {
    if (ranOnce.current) return;
    ranOnce.current = true;
    const id = setTimeout(() => void runAll(), 300);
    return () => clearTimeout(id);
  }, [runAll]);

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
            {t("admin.turnHealthPanel.title")}
          </h2>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{t("admin.turnHealthPanel.description")}</p>
        </div>
        <button
          type="button"
          onClick={() => void runAll()}
          disabled={running}
          className="shrink-0 rounded-lg bg-zinc-800 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-200 dark:text-zinc-900 dark:hover:bg-white"
        >
          {running ? t("admin.turnHealthPanel.testing") : t("admin.turnHealthPanel.retest")}
        </button>
      </div>

      {targets.length === 0 ? (
        <p className="mt-3 text-xs text-amber-600 dark:text-amber-500">{t("admin.turnHealthPanel.none")}</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-1.5">
          {targets.map((item) => {
            const status = results[item.label];
            const dot =
              !status || status.state === "pending"
                ? "bg-zinc-300 dark:bg-zinc-600 animate-pulse"
                : status.state === "ok"
                  ? "bg-emerald-500"
                  : "bg-red-500";
            return (
              <li
                key={item.label}
                className="flex items-center gap-2.5 rounded-lg border border-zinc-100 px-2.5 py-1.5 text-sm dark:border-zinc-900"
              >
                <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${dot}`} aria-hidden />
                <span className="font-mono text-xs text-zinc-700 dark:text-zinc-300">{item.label}</span>
                <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                  {item.provider === "cloudflare" ? "Cloudflare" : t("admin.turnHealthPanel.own")}
                </span>
                <span className="ml-auto text-xs">
                  {!status || status.state === "pending" ? (
                    <span className="text-zinc-400">{t("admin.turnHealthPanel.probing")}</span>
                  ) : status.state === "ok" ? (
                    <span className="font-medium text-emerald-600 dark:text-emerald-500">
                      {t("admin.turnHealthPanel.ok", { ms: String(status.ms) })}
                    </span>
                  ) : (
                    <span className="font-medium text-red-600 dark:text-red-500" title={status.detail}>
                      {t("admin.turnHealthPanel.fail")} · {status.detail}
                    </span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-2 text-[11px] text-zinc-400 dark:text-zinc-500">{t("admin.turnHealthPanel.caveat")}</p>
    </div>
  );
}
