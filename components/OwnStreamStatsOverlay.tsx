"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useT } from "@/lib/useI18n";
import { diagnose, isRelayed, type PcSnapshot } from "@/lib/connectionDiagnostics";
import { connectionRegistry, createStatsSampler } from "@/lib/connectionRegistry";
import { signalingClient } from "@/lib/signalingClient";
import { turnProvider } from "@/lib/iceConfig";
import { nativeSinkPaused } from "@/lib/nativeVideoCapture";
import { senderQualityState } from "@/lib/peerQualityController";
import type { QualityChannel } from "@/lib/qualityNegotiation";

// Same cadence as the remote tile's panel (see ConnectionStatsOverlay).
const POLL_MS = 2000;

interface ViewerRow {
  peerId: string;
  name: string;
  snapshot: PcSnapshot;
  /** They are not looking at it, so nothing is being sent (see lib/qualityNegotiation). */
  paused: boolean;
}

interface Capture {
  width: number | null;
  height: number | null;
  fps: number | null;
}

function mbps(kbps: number) {
  return (kbps / 1000).toFixed(1);
}

function pct(share: number) {
  return Math.round(share * 100);
}

function readCapture(stream: MediaStream | null): Capture | null {
  const track = stream?.getVideoTracks()[0];
  if (!track || track.readyState === "ended") return null;
  const settings = track.getSettings();
  return {
    width: settings.width ?? null,
    height: settings.height ?? null,
    fps: settings.frameRate != null ? Math.round(settings.frameRate) : null,
  };
}

/**
 * "Sua transmissão": the broadcaster's own tile, seen from the sending side —
 * what is being captured, what actually leaves for each viewer of this
 * channel, and what holds it back.
 *
 * The remote tile's panel answers "why does *this* picture look bad to me";
 * this one answers "how is what I am sending doing", which until now only
 * lived folded inside the quality settings ("Por espectador"). Polls only
 * while mounted, and only this channel's own send connections — relaying
 * somebody else's picture is not our transmission.
 */
export function OwnStreamStatsOverlay({
  channel,
  stream,
  onClose,
}: {
  channel: QualityChannel;
  stream: MediaStream | null;
  onClose: () => void;
}) {
  const t = useT();
  const [rows, setRows] = useState<ViewerRow[] | null>(null);
  const [capture, setCapture] = useState<Capture | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const sample = createStatsSampler();
    let cancelled = false;
    const tick = async () => {
      const peers = signalingClient.state.peers;
      const names = new Map(peers.map((p) => [p.id, p.name]));
      // A site moderator receives the share like anybody else but is
      // invisible to the room — same rule as ViewerConnectionList.
      const moderators = new Set(peers.filter((p) => p.role === "moderator").map((p) => p.id));
      const next: ViewerRow[] = [];
      // Sequential: these contend for the main thread of the machine doing
      // all the encoding.
      for (const entry of connectionRegistry.list()) {
        if (entry.direction !== "send" || entry.channel !== channel || entry.originId !== null) continue;
        if (moderators.has(entry.peerId)) continue;
        const snapshot = await sample(entry.pc);
        if (cancelled) return;
        if (!snapshot) continue;
        next.push({
          peerId: entry.peerId,
          name: names.get(entry.peerId) ?? entry.peerId.slice(0, 6),
          snapshot,
          paused: senderQualityState(entry.pc)?.paused === true || nativeSinkPaused(entry.pc),
        });
      }
      if (cancelled) return;
      next.sort((a, b) => a.name.localeCompare(b.name));
      setRows(next);
      setCapture(readCapture(stream));
    };
    // One tick at a time: a slow getStats must not have the next one start
    // on top of it.
    let busy = false;
    const run = () => {
      if (busy) return;
      busy = true;
      void tick().finally(() => {
        busy = false;
      });
    };
    run();
    const timer = setInterval(run, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [channel, stream]);

  const sends = (rows ?? []).flatMap((row) => (row.snapshot.send ? [row.snapshot.send] : []));
  const totalKbps = sends.reduce((sum, send) => sum + send.kbps, 0);
  // The encoder is per connection, but in practice they all agree; the first
  // one that reports a codec stands for the lot.
  const encoderOf = sends.find((send) => send.codec) ?? sends[0] ?? null;
  const cpuShare = sends.reduce((max, send) => Math.max(max, send.cpuLimitedShare), 0);
  const bandwidthShare = sends.reduce((max, send) => Math.max(max, send.bandwidthLimitedShare), 0);
  const limitation =
    cpuShare >= bandwidthShare && cpuShare > 0
      ? t("connectionStats.limitedByCpu", { value: pct(cpuShare) })
      : bandwidthShare > 0
        ? t("connectionStats.limitedByBandwidth", { value: pct(bandwidthShare) })
        : null;
  const availableKbps = (rows ?? []).reduce<number | null>((max, row) => {
    const value = row.snapshot.route.availableOutgoingKbps;
    return value == null ? max : Math.max(max ?? 0, value);
  }, null);

  async function copy() {
    const report = {
      at: new Date().toISOString(),
      channel,
      capture,
      totalKbps,
      viewers: (rows ?? []).map((row) => ({
        peerId: row.peerId,
        route: row.snapshot.route,
        sending: row.snapshot.send,
        causes: diagnose({ route: row.snapshot.route, send: row.snapshot.send, recv: null }).map((c) => c.id),
      })),
      cores: typeof navigator !== "undefined" ? (navigator.hardwareConcurrency ?? null) : null,
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

  return (
    <div
      // A double click anywhere on a tile means "focar"; inside this panel it
      // means selecting a number to read it.
      onDoubleClick={(e) => e.stopPropagation()}
      // Same placement as ConnectionStatsOverlay: below the left button row,
      // so the toggle that closes it stays reachable.
      className="absolute left-2 top-13 z-20 max-h-[calc(100%-3.75rem)] w-[min(24rem,calc(100%-1rem))] overflow-auto rounded-lg bg-black/85 p-2.5 font-mono text-[11px] leading-snug text-zinc-100 shadow-lg backdrop-blur-sm"
    >
      <div className="mb-1.5 flex items-center justify-between gap-2 font-sans">
        <span className="text-xs font-semibold text-white">{t("ownStreamStats.title")}</span>
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

      <Row label={t("ownStreamStats.capture")}>
        {capture && capture.width && capture.height ? (
          <>
            {capture.width}×{capture.height}
            {capture.fps != null && ` · ${capture.fps} fps`}
          </>
        ) : (
          <span className="text-zinc-400">{t("connectionStats.waiting")}</span>
        )}
      </Row>

      <Row label={t("ownStreamStats.sending")}>
        {rows === null ? (
          <span className="text-zinc-400">{t("connectionStats.waiting")}</span>
        ) : (
          <>
            {t("ownStreamStats.viewers", { value: rows.length })} · {mbps(totalKbps)} Mbps
            {availableKbps != null && availableKbps > 0 && (
              <span className="text-zinc-400">
                {" "}
                {t("ownStreamStats.ofAvailable", { value: mbps(availableKbps) })}
              </span>
            )}
          </>
        )}
      </Row>

      {encoderOf && (
        <Row label={t("connectionStats.encoder")}>
          {encoderOf.codec ?? "?"}
          {" · "}
          {encoderOf.hardware === null
            ? (encoderOf.encoder ?? "?")
            : encoderOf.hardware
              ? t("connectionStats.hardware")
              : t("connectionStats.software")}
          {typeof navigator !== "undefined" && navigator.hardwareConcurrency
            ? ` · ${t("connectionStats.cores", { value: navigator.hardwareConcurrency })}`
            : ""}
          {limitation && <span className="block text-amber-300">{limitation}</span>}
        </Row>
      )}

      <div className="mt-1.5 border-t border-white/10 pt-1.5">
        <span className="font-sans text-zinc-400">{t("connectionStats.perViewer")}</span>
        {rows !== null && rows.length === 0 ? (
          <p className="font-sans text-zinc-400">{t("connectionStats.noViewers")}</p>
        ) : (
          <ul className="mt-1 space-y-1">
            {(rows ?? []).map((row) => {
              const { route, send } = row.snapshot;
              const worst = row.paused ? undefined : diagnose({ route, send, recv: null })[0];
              const provider = route.localType === "relay" ? turnProvider(route.relayUrl) : null;
              return (
                <li key={row.peerId}>
                  <span className="font-sans font-medium text-white">{row.name}</span>
                  <span className={isRelayed(route.kind) ? "text-amber-300" : "text-zinc-400"}>
                    {" · "}
                    {isRelayed(route.kind) ? "TURN" : t("connectionStats.routeDirect")}
                    {provider &&
                      ` · ${t(provider === "cloudflare" ? "connectionStats.turnCloudflare" : "connectionStats.turnOwn")}`}
                  </span>
                  {row.paused ? (
                    <span className="block font-sans text-zinc-400">{t("connectionStats.viewerNotLooking")}</span>
                  ) : (
                    send && (
                      <span className="block tabular-nums text-zinc-300">
                        {send.width}×{send.height} · {send.fps} fps · {mbps(send.kbps)} Mbps
                        {route.rttMs != null && ` · RTT ${route.rttMs} ms`}
                      </span>
                    )
                  )}
                  {worst && (
                    <span
                      className={`block font-sans ${worst.severity === "high" ? "text-red-300" : "text-amber-200"}`}
                    >
                      {t(`connectionStats.cause.${worst.id}`)}
                    </span>
                  )}
                </li>
              );
            })}
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
