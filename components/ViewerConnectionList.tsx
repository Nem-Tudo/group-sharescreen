"use client";

import { useEffect, useState } from "react";
import { useT } from "@/lib/useI18n";
import { diagnose, isRelayed, type PcSnapshot } from "@/lib/connectionDiagnostics";
import { connectionRegistry, createStatsSampler } from "@/lib/connectionRegistry";
import { signalingClient } from "@/lib/signalingClient";
import { turnProvider } from "@/lib/iceConfig";

const POLL_MS = 2000;

interface Row {
  key: string;
  name: string;
  channel: string;
  snapshot: PcSnapshot;
}

/**
 * "Por espectador": the broadcaster's side of every connection it is sending
 * its own share over — route, what is going out, and what holds it back.
 *
 * The mirror of the tile's stats panel. A viewer sees one connection in depth;
 * the broadcaster is the one person who can see all of them side by side,
 * which is what tells "everyone gets a bad picture" (this machine) apart from
 * "one person does" (their route or their machine). Polls only while
 * expanded — each row is a getStats() pass on the busiest machine in the room.
 */
export function ViewerConnectionList() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);

  useEffect(() => {
    if (!open) return;
    const sample = createStatsSampler();
    let cancelled = false;
    const tick = async () => {
      const names = new Map(signalingClient.state.peers.map((p) => [p.id, p.name]));
      const next: Row[] = [];
      // Sequential, like the stats pump: these contend for the main thread of
      // the machine doing all the encoding.
      for (const entry of connectionRegistry.list()) {
        if (entry.direction !== "send" || entry.originId !== null) continue;
        const snapshot = await sample(entry.pc);
        if (cancelled) return;
        if (!snapshot) continue;
        next.push({
          key: `${entry.channel} ${entry.peerId}`,
          name: names.get(entry.peerId) ?? entry.peerId.slice(0, 6),
          channel: entry.channel,
          snapshot,
        });
      }
      if (!cancelled) setRows(next);
    };
    void tick();
    const timer = setInterval(() => void tick(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [open]);

  return (
    <details
      className="mt-1.5 border-t border-zinc-200 pt-1.5 dark:border-zinc-700"
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary className="cursor-pointer select-none text-zinc-700 dark:text-zinc-300">
        {t("connectionStats.perViewer")}
      </summary>
      {open && (
        <ul className="mt-1 max-h-48 space-y-1 overflow-auto">
          {rows.length === 0 && <li className="text-zinc-500">{t("connectionStats.noViewers")}</li>}
          {rows.map((row) => {
            const { route, send } = row.snapshot;
            const causes = diagnose({ route, send, recv: null });
            const worst = causes[0];
            const provider = route.localType === "relay" ? turnProvider(route.relayUrl) : null;
            return (
              <li key={row.key} className="leading-snug">
                <span className="font-medium text-zinc-900 dark:text-zinc-100">{row.name}</span>
                {row.channel !== "screen" && <span className="text-zinc-500"> · {row.channel}</span>}
                <span className={isRelayed(route.kind) ? "text-amber-600 dark:text-amber-500" : ""}>
                  {" · "}
                  {isRelayed(route.kind) ? "TURN" : t("connectionStats.routeDirect")}
                  {/* Only our own side is knowable from here (see
                      ConnectionStatsOverlay) — a viewer's relay is theirs. */}
                  {provider && ` · ${t(provider === "cloudflare" ? "connectionStats.turnCloudflare" : "connectionStats.turnOwn")}`}
                </span>
                {send && (
                  <span className="block font-mono text-[11px] text-zinc-500 tabular-nums">
                    {send.height}p · {send.fps} fps · {(send.kbps / 1000).toFixed(1)} Mbps
                    {route.rttMs != null && ` · ${route.rttMs} ms`}
                  </span>
                )}
                {worst && (
                  <span
                    className={`block ${worst.severity === "high" ? "text-red-600 dark:text-red-400" : "text-amber-600 dark:text-amber-500"}`}
                  >
                    {t(`connectionStats.cause.${worst.id}`)}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </details>
  );
}
