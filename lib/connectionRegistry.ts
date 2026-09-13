// Every live video peer connection this client holds, in one place.
//
// The connections themselves live in refs deep inside useBroadcastChannel
// (sendPCs/recvPCs) and RelayLink (a relay's children), which is right for
// the code that drives them and useless for anything that only wants to *look*
// at them: the connection-stats panel on a tile, the per-viewer list a
// broadcaster sees, and quality telemetry. Threading the maps out as props
// would re-render every tile each time a connection opened. This is the same
// answer mediaStats already gives for sender telemetry: a module-level
// singleton the owners write to and everyone else reads.
//
// Mic connections are never registered — this is about video quality, and a
// room's mic mesh would otherwise double the size of everything below.

import { readPcStats, type PcSnapshot, type StatsCounters } from "./connectionDiagnostics";
import type { QualityChannel } from "./qualityNegotiation";

export type ConnectionDirection = "send" | "recv";

export interface RegisteredConnection {
  channel: QualityChannel;
  direction: ConnectionDirection;
  /** The other end of this pc: who we send to, or who sends to us. */
  peerId: string;
  /**
   * Whose picture this is.
   *
   * On a recv pc, the person sharing — different from `peerId` when the stream
   * reaches us through a relay. On a send pc, null for our own share and the
   * origin's id when we are relaying for them. Part of the identity on the
   * send side because a relay can be sending the same viewer two different
   * pictures on one channel at once: its own share, and someone else's
   * re-encoded.
   */
  originId: string | null;
  /**
   * Whether a relay's re-encode sits on this path: we are re-encoding someone
   * else's stream (send), or the stream reaches us from a relay (recv).
   */
  viaRelay: boolean;
  pc: RTCPeerConnection;
  openedAt: number;
}

export type ConnectionEvent = "open" | "close";
type Listener = (event: ConnectionEvent, connection: RegisteredConnection) => void;

function keyOf(
  channel: QualityChannel,
  direction: ConnectionDirection,
  peerId: string,
  originId: string | null
) {
  return `${channel} ${direction} ${peerId} ${originId ?? ""}`;
}

class ConnectionRegistry {
  private entries = new Map<string, RegisteredConnection>();
  private listeners = new Set<Listener>();

  register(input: Omit<RegisteredConnection, "openedAt">) {
    const key = keyOf(input.channel, input.direction, input.peerId, input.originId);
    const existing = this.entries.get(key);
    if (existing?.pc === input.pc) return;
    // A rebuilt connection replaces the old one under the same key; whoever
    // is watching the old one has to hear that it ended.
    if (existing) this.drop(key, existing);
    const connection: RegisteredConnection = { ...input, openedAt: Date.now() };
    this.entries.set(key, connection);
    this.emit("open", connection);
  }

  /**
   * Removes a connection by identity rather than by key, so a close that
   * arrives after a rebuild can never remove the connection that replaced it.
   */
  unregister(pc: RTCPeerConnection) {
    for (const [key, entry] of this.entries) {
      if (entry.pc !== pc) continue;
      this.drop(key, entry);
      return;
    }
  }

  /** The pc sending `originId`'s picture (null: our own) to `peerId`. */
  findSend(channel: QualityChannel, peerId: string, originId: string | null) {
    return this.live(keyOf(channel, "send", peerId, originId));
  }

  /** The recv connection carrying `originId`'s picture — what a tile is keyed by. */
  findRecvByOrigin(channel: QualityChannel, originId: string): RegisteredConnection | undefined {
    for (const entry of this.list()) {
      if (entry.channel === channel && entry.direction === "recv" && entry.originId === originId) {
        return entry;
      }
    }
    return undefined;
  }

  /**
   * Everything currently registered.
   *
   * Prunes as it goes: `pc.close()` fires no event at all, so an owner that
   * closes a connection on a path that forgot to unregister it would
   * otherwise leave a corpse here forever. A closed pc says so synchronously,
   * which makes the check free.
   */
  list(): RegisteredConnection[] {
    const out: RegisteredConnection[] = [];
    for (const [key, entry] of [...this.entries]) {
      if (entry.pc.connectionState === "closed") {
        this.drop(key, entry);
        continue;
      }
      out.push(entry);
    }
    return out;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private live(key: string): RegisteredConnection | undefined {
    const entry = this.entries.get(key);
    if (entry && entry.pc.connectionState === "closed") {
      this.drop(key, entry);
      return undefined;
    }
    return entry;
  }

  private drop(key: string, entry: RegisteredConnection) {
    this.entries.delete(key);
    this.emit("close", entry);
  }

  private emit(event: ConnectionEvent, connection: RegisteredConnection) {
    for (const listener of this.listeners) {
      try {
        listener(event, connection);
      } catch {
        // One broken consumer must not stop the others hearing about it.
      }
    }
  }
}

export const connectionRegistry = new ConnectionRegistry();

/**
 * A getStats reader with its own memory of the previous sample per pc.
 *
 * Its own, not shared: every rate in a snapshot is a delta since the last
 * sample, so the panel polling every two seconds and telemetry polling every
 * ten must not overwrite each other's baseline.
 */
export function createStatsSampler() {
  const previous = new WeakMap<RTCPeerConnection, StatsCounters>();
  return async function sample(pc: RTCPeerConnection): Promise<PcSnapshot | null> {
    if (pc.connectionState === "closed") return null;
    let report: RTCStatsReport;
    try {
      report = await pc.getStats();
    } catch {
      return null;
    }
    const records: Record<string, unknown>[] = [];
    report.forEach((value) => records.push(value as Record<string, unknown>));
    const { snapshot, counters } = readPcStats(records, previous.get(pc) ?? null, Date.now());
    previous.set(pc, counters);
    return snapshot;
  };
}
