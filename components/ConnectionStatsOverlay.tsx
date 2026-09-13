"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useT } from "@/lib/useI18n";
import {
  diagnose,
  isRelayed,
  type Cause,
  type PcSnapshot,
  type RouteInfo,
  type RouteKind,
} from "@/lib/connectionDiagnostics";
import { connectionRegistry, createStatsSampler } from "@/lib/connectionRegistry";
import { connectionDiagLink, type RemoteDiag } from "@/lib/connectionDiagLink";
import type { QualityChannel } from "@/lib/qualityNegotiation";

// How often the panel re-reads the connection. Two seconds is short enough to
// watch a problem happen and long enough that a delta covers a few keyframes
// rather than whichever one happened to land in the window.
const POLL_MS = 2000;
// How long without a word from the sender before saying so, rather than
// "waiting" forever at somebody whose app predates this panel.
const SENDER_SILENCE_MS = 8000;

const ROUTE_KEYS: Record<RouteKind, string> = {
  direct: "connectionStats.routeDirect",
  "relay-local": "connectionStats.routeRelayLocal",
  "relay-remote": "connectionStats.routeRelayRemote",
  "relay-both": "connectionStats.routeRelayBoth",
  unknown: "connectionStats.routeUnknown",
};

function mbps(kbps: number) {
  return (kbps / 1000).toFixed(1);
}

function pct(share: number) {
  return Math.round(share * 100);
}

/**
 * The route as both ends see it. Ours says which candidate types the pair is
 * using; only the sender's own report knows how *it* reaches its TURN server,
 * which is the half that decides whether a relay is running over TCP.
 */
function mergeRoute(local: RouteInfo | null, remote: RouteInfo | null): RouteInfo | null {
  if (!local) return remote;
  if (!remote?.relayProtocol || local.relayProtocol) return local;
  return { ...local, relayProtocol: remote.relayProtocol };
}

/**
 * "Estatísticas da conexão" for one remote tile: both halves of the connection
 * carrying `originId`'s picture, and what they add up to.
 *
 * Polls only while mounted — the tile mounts it when the person opens it — so
 * a room full of tiles costs nothing until somebody actually looks.
 */
export function ConnectionStatsOverlay({
  channel,
  originId,
  onClose,
}: {
  channel: QualityChannel;
  originId: string;
  onClose: () => void;
}) {
  const t = useT();
  const [local, setLocal] = useState<{ snapshot: PcSnapshot; viaRelay: boolean } | null>(null);
  const [sender, setSender] = useState<{ id: string; since: number } | null>(null);
  const [remote, setRemote] = useState<{ senderId: string; diag: RemoteDiag } | null>(null);
  const [now, setNow] = useState(0);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const sample = createStatsSampler();
    let cancelled = false;
    let lastSender: string | null = null;
    const tick = async () => {
      const entry = connectionRegistry.findRecvByOrigin(channel, originId);
      if (!entry) {
        if (cancelled) return;
        lastSender = null;
        setSender(null);
        setLocal(null);
        setNow(Date.now());
        return;
      }
      const snapshot = await sample(entry.pc);
      if (cancelled) return;
      if (entry.peerId !== lastSender) {
        lastSender = entry.peerId;
        setSender({ id: entry.peerId, since: Date.now() });
      }
      if (snapshot) setLocal({ snapshot, viaRelay: entry.viaRelay });
      setNow(Date.now());
    };
    void tick();
    const timer = setInterval(() => void tick(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [channel, originId]);

  const senderId = sender?.id ?? null;
  useEffect(() => {
    if (!senderId) return;
    return connectionDiagLink.watch(channel, senderId, originId, (diag) => {
      setRemote({ senderId, diag });
    });
  }, [channel, senderId, originId]);

  // Only a reply about the sender we are currently connected to, and only a
  // recent one: a relay handover must not leave the old sender's numbers up.
  const diag =
    remote && remote.senderId === senderId && now - remote.diag.receivedAt < SENDER_SILENCE_MS
      ? remote.diag
      : null;
  const senderSilent = !diag && sender !== null && now - sender.since > SENDER_SILENCE_MS;

  const snapshot = local?.snapshot ?? null;
  const route = mergeRoute(snapshot?.route ?? null, diag?.route ?? null);
  const recv = snapshot?.recv ?? null;
  const send = diag?.send ?? null;
  const causes: Cause[] = snapshot ? diagnose({ route, send, recv }) : [];

  async function copy() {
    const report = {
      at: new Date().toISOString(),
      channel,
      originId,
      viaCascade: local?.viaRelay ?? false,
      route,
      receiving: recv,
      sender: diag,
      causes: causes.map((c) => c.id),
      userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
    };
    try {
      await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard refused (insecure context, permissions) — nothing to do.
    }
  }

  const limitation = send
    ? send.cpuLimitedShare >= send.bandwidthLimitedShare && send.cpuLimitedShare > 0
      ? t("connectionStats.limitedByCpu", { value: pct(send.cpuLimitedShare) })
      : send.bandwidthLimitedShare > 0
        ? t("connectionStats.limitedByBandwidth", { value: pct(send.bandwidthLimitedShare) })
        : null
    : null;

  return (
    <div
      // A double click anywhere on a tile means "focar"; inside this panel it
      // means selecting a number to read it.
      onDoubleClick={(e) => e.stopPropagation()}
      // Below the tile's left button row (36px buttons at top-2), not over it:
      // the stats toggle lives there and has to stay reachable to close this.
      className="absolute left-2 top-13 z-20 max-h-[calc(100%-3.75rem)] w-[min(24rem,calc(100%-1rem))] overflow-auto rounded-lg bg-black/85 p-2.5 font-mono text-[11px] leading-snug text-zinc-100 shadow-lg backdrop-blur-sm"
    >
      <div className="mb-1.5 flex items-center justify-between gap-2 font-sans">
        <span className="text-xs font-semibold text-white">{t("connectionStats.title")}</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => void copy()}
            className="rounded bg-white/10 px-2 py-0.5 text-[11px] text-white hover:bg-white/20"
          >
            {copied ? t("connectionStats.copied") : t("connectionStats.copy")}
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("connectionStats.close")}
            className="rounded bg-white/10 px-2 py-0.5 text-[11px] text-white hover:bg-white/20"
          >
            ×
          </button>
        </div>
      </div>

      <Row label={t("connectionStats.route")}>
        <span className={route && isRelayed(route.kind) ? "text-amber-300" : undefined}>
          {t(ROUTE_KEYS[route?.kind ?? "unknown"])}
        </span>
        {route?.relayProtocol && ` (${route.relayProtocol.toUpperCase()})`}
        {route?.rttMs != null && ` · RTT ${route.rttMs} ms`}
        {local?.viaRelay && (
          <span className="block text-zinc-400">{t("connectionStats.viaCascade")}</span>
        )}
      </Row>

      <Row label={t("connectionStats.receiving")}>
        {recv ? (
          <>
            {recv.width}×{recv.height} · {recv.fps} fps · {mbps(recv.kbps)} Mbps
            {recv.codec && ` · ${recv.codec}`}
            <span className="block text-zinc-400">
              {t("connectionStats.lossDropsFreezes", {
                loss: pct(recv.loss),
                dropped: pct(recv.dropShare),
                freezes: recv.freezes,
              })}
              {recv.hardware !== null &&
                ` · ${t("connectionStats.decoder")} ${recv.hardware ? t("connectionStats.hardware") : t("connectionStats.software")}`}
            </span>
          </>
        ) : (
          <span className="text-zinc-400">{t("connectionStats.waiting")}</span>
        )}
      </Row>

      <Row label={t("connectionStats.sender")}>
        {send ? (
          <>
            {send.width}×{send.height} · {send.fps} fps · {mbps(send.kbps)} Mbps
            {send.codec && ` · ${send.codec}`}
            <span className="block text-zinc-400">
              {t("connectionStats.encoder")}{" "}
              {send.hardware === null
                ? (send.encoder ?? "?")
                : send.hardware
                  ? t("connectionStats.hardware")
                  : t("connectionStats.software")}
              {diag?.cores ? ` · ${t("connectionStats.cores", { value: diag.cores })}` : ""}
              {diag?.tier ? ` · ${diag.tier}` : ""}
            </span>
            {limitation && <span className="block text-amber-300">{limitation}</span>}
            {diag?.relayed && (
              <span className="block text-zinc-400">{t("connectionStats.senderIsRelay")}</span>
            )}
          </>
        ) : (
          <span className="text-zinc-400">
            {senderSilent ? t("connectionStats.senderSilent") : t("connectionStats.waiting")}
          </span>
        )}
      </Row>

      <div className="mt-1.5 border-t border-white/10 pt-1.5 font-sans">
        {causes.length === 0 ? (
          <span className="text-zinc-400">
            {snapshot ? t("connectionStats.noCauses") : t("connectionStats.waiting")}
          </span>
        ) : (
          <ul className="space-y-0.5">
            {causes.map((cause) => (
              <li
                key={cause.id}
                className={cause.severity === "high" ? "text-red-300" : "text-amber-200"}
              >
                • {t(`connectionStats.cause.${cause.id}`)}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mb-1">
      <span className="font-sans text-zinc-400">{label}: </span>
      {children}
    </div>
  );
}
