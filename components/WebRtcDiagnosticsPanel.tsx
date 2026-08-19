"use client";

import { ICE_SERVER_DIAGNOSTICS } from "@/lib/iceConfig";
import { useWebRtcDiagnostics, WEBRTC_DIAGNOSTICS_ENABLED } from "@/lib/webrtcDiagnostics";
import type { PeerInfo } from "@/lib/signalingClient";

function yesNo(value: boolean) {
  return value ? "sim" : "não";
}

function Tracks({ title, tracks }: { title: string; tracks: { kind: string; label?: string; enabled: boolean; readyState: MediaStreamTrackState }[] }) {
  if (tracks.length === 0) return null;
  return (
    <div>
      <dt>{title}:</dt>
      <dd>
        {tracks.map((track, index) => (
          <span key={`${track.kind}-${index}`} className="block break-all">
            {track.kind}{track.label ? ` · ${track.label}` : ""} · {track.readyState} · enabled={yesNo(track.enabled)}
          </span>
        ))}
      </dd>
    </div>
  );
}

export function WebRtcDiagnosticsPanel({ selfId, peers }: { selfId: string | null; peers: PeerInfo[] }) {
  const diagnostics = useWebRtcDiagnostics();
  if (!WEBRTC_DIAGNOSTICS_ENABLED) return null;

  return (
    <details className="mt-4 rounded-lg border border-dashed border-amber-400/60 bg-amber-50/50 p-2 text-xs text-zinc-700 dark:border-amber-700/60 dark:bg-amber-950/20 dark:text-zinc-300">
      <summary className="cursor-pointer select-none font-semibold">Diagnóstico WebRTC (dev)</summary>
      <div className="mt-2 space-y-2">
        <dl className="grid grid-cols-[max-content_1fr] gap-x-2 break-all">
          <dt>selfId:</dt><dd>{selfId ?? "ainda não recebido"}</dd>
          <dt>STUN:</dt><dd>{ICE_SERVER_DIAGNOSTICS.stun.join(", ")}</dd>
          <dt>TURN:</dt><dd>{ICE_SERVER_DIAGNOSTICS.turn.length ? ICE_SERVER_DIAGNOSTICS.turn.join(", ") : "não configurado"}</dd>
        </dl>

        {diagnostics.length === 0 ? (
          <p className="text-zinc-500">Nenhuma conexão de mídia criada nesta sessão.</p>
        ) : diagnostics.map((item) => {
          const peerName = peers.find((peer) => peer.id === item.peerId)?.name;
          return (
            <details key={item.key} className="rounded border border-black/10 bg-white/70 p-2 dark:border-white/10 dark:bg-black/20">
              <summary className="cursor-pointer break-all font-medium">
                {item.channel} · {item.direction === "send" ? "envio" : "recepção"} · {peerName ? `${peerName} · ` : ""}{item.peerId}
              </summary>
              <dl className="mt-2 grid grid-cols-[max-content_1fr] gap-x-2 gap-y-0.5 break-all">
                <dt>offer enviada/recebida:</dt><dd>{yesNo(item.offerSent)} / {yesNo(item.offerReceived)}</dd>
                <dt>answer enviada/recebida:</dt><dd>{yesNo(item.answerSent)} / {yesNo(item.answerReceived)}</dd>
                {item.signalingState && <><dt>signalingState:</dt><dd>{item.signalingState}</dd></>}
                {item.iceGatheringState && <><dt>iceGatheringState:</dt><dd>{item.iceGatheringState}</dd></>}
                {item.iceConnectionState && <><dt>iceConnectionState:</dt><dd>{item.iceConnectionState}</dd></>}
                {item.connectionState && <><dt>connectionState:</dt><dd>{item.connectionState}</dd></>}
                {item.localDescriptionType && <><dt>localDescription:</dt><dd>{item.localDescriptionType}</dd></>}
                {item.remoteDescriptionType && <><dt>remoteDescription:</dt><dd>{item.remoteDescriptionType}</dd></>}
                <dt>stream remoto:</dt><dd>{yesNo(item.remoteStreamReceived)}</dd>
                {item.candidatePair && <>
                  <dt>par ICE:</dt>
                  <dd>{item.candidatePair.localType ?? "?"} → {item.candidatePair.remoteType ?? "?"}{item.candidatePair.protocol ? ` · ${item.candidatePair.protocol}` : ""} · TURN={yesNo(item.candidatePair.relayUsed)}</dd>
                </>}
                {item.lastError && <><dt>último erro:</dt><dd className="text-red-600 dark:text-red-400">{item.lastError}</dd></>}
              </dl>
              <dl className="mt-2 space-y-1">
                <Tracks title="Tracks locais" tracks={item.localTracks} />
                <Tracks title="Senders" tracks={item.senders} />
                <Tracks title="Receivers" tracks={item.receivers} />
              </dl>
              {item.events.length > 0 && (
                <details className="mt-2">
                  <summary className="cursor-pointer">Eventos ({item.events.length})</summary>
                  <ol className="mt-1 space-y-0.5 font-mono text-[10px]">
                    {item.events.map((event, index) => (
                      <li key={`${event.at}-${index}`}>{new Date(event.at).toLocaleTimeString()} · {event.message}</li>
                    ))}
                  </ol>
                </details>
              )}
            </details>
          );
        })}
      </div>
    </details>
  );
}
