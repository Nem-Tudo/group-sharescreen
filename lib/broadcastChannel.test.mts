import assert from "node:assert/strict";
import test from "node:test";
import { createSendRetryScheduler, manageRecvPeerConnection, manageSendPeerConnection } from "./peerConnectionManager";

// The channel's signaling boundary: these messages have the same shape as
// signalingClient.sendSignal, without opening a socket or mounting React.
function fixture(count: number) {
  const signals: { to: string; data: { kind: string; iceRestart?: boolean } }[] = [];
  const signalingClient = {
    sendSignal(to: string, data: { kind: string; iceRestart?: boolean }) {
      signals.push({ to, data });
    },
  };
  const peers = new Map<string, FakePC>();
  const failures: string[] = [];
  const managers = Array.from({ length: count }, (_, i) => {
    const peerId = `viewer-${i}`;
    const pc = new FakePC();
    peers.set(peerId, pc);
    const manager = manageSendPeerConnection({
      pc: pc as unknown as RTCPeerConnection,
      isCurrent: () => peers.get(peerId) === pc,
      sendOffer: async (offer, iceRestart) => {
        if (peers.get(peerId) !== pc) return;
        await pc.setLocalDescription(offer);
        if (peers.get(peerId) !== pc) return;
        signalingClient.sendSignal(peerId, { kind: "offer", ...(iceRestart ? { iceRestart } : {}) });
      },
      onFailure: () => { failures.push(peerId); peers.delete(peerId); },
      onClosed: () => peers.delete(peerId),
      onConnected: () => {},
      onPeerFailure: () => {},
      connectTimeoutMs: 15_000,
      restartTimeoutMs: 6_000,
    });
    return { peerId, pc, manager };
  });
  return { peers, signals, failures, managers };
}

class FakePC {
  connectionState: RTCPeerConnectionState = "new";
  signalingState: RTCSignalingState = "stable";
  onconnectionstatechange: (() => void) | null = null;
  localDescription: RTCSessionDescriptionInit | null = null;
  offers: RTCOfferOptions[] = [];
  restarts = 0;
  createOffer(options: RTCOfferOptions = {}) {
    this.offers.push(options);
    return Promise.resolve({ type: "offer" as const, sdp: `offer-${this.offers.length}` });
  }
  async setLocalDescription(offer: RTCSessionDescriptionInit) { this.localDescription = offer; }
  restartIce() { this.restarts += 1; }
  change(state: RTCPeerConnectionState) {
    this.connectionState = state;
    this.onconnectionstatechange?.();
  }
}

test("1:1: a lost connection restarts ICE on the same PC and signals the viewer", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture(1);
  const { pc, manager } = f.managers[0];
  pc.change("connected");
  pc.change("failed");
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(pc.restarts, 1);
  assert.deepEqual(pc.offers, [{ iceRestart: true }]);
  assert.deepEqual(f.signals, [{ to: "viewer-0", data: { kind: "offer", iceRestart: true } }]);
  assert.equal(f.failures.length, 0);
  pc.change("connected");
  t.mock.timers.tick(6000);
  assert.equal(f.failures.length, 0);
  manager.dispose();
});

test("3+ peers: a failed viewer does not tear down healthy peers", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture(4);
  f.managers.forEach(({ pc }) => pc.change("connected"));
  const failed = f.managers[2];
  failed.pc.change("failed");
  failed.pc.change("failed"); // restart already attempted; rebuild only this peer
  assert.deepEqual(f.failures, ["viewer-2"]);
  assert.equal(f.peers.size, 3);
  assert.equal(f.managers[0].pc.restarts, 0);
  assert.equal(f.managers[3].pc.restarts, 0);
  f.managers.forEach(({ manager }) => manager.dispose());
});

test("stale offer and timeout cannot signal or retry after the peer leaves", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture(1);
  const { pc, manager, peerId } = f.managers[0];
  pc.change("failed");
  f.peers.delete(peerId);
  manager.dispose();
  await Promise.resolve();
  await Promise.resolve();
  t.mock.timers.tick(30_000);
  assert.deepEqual(f.signals, []);
  assert.deepEqual(f.failures, []);
});

test("an offer that never connects times out; successful peers keep their timers independent", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture(3);
  f.managers[0].pc.change("connected");
  f.managers[2].pc.change("connected");
  t.mock.timers.tick(15_000);
  assert.deepEqual(f.failures, ["viewer-1"]);
  f.managers.forEach(({ manager }) => manager.dispose());
});

test("retries back off per viewer and stop when the share ends", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const opened: string[] = [];
  const queue = createSendRetryScheduler(
    (id) => id !== "left", (id) => opened.push(id), 2000, 30_000
  );
  queue.schedule("viewer");
  queue.schedule("left");
  t.mock.timers.tick(1999);
  assert.deepEqual(opened, []);
  t.mock.timers.tick(1);
  assert.deepEqual(opened, ["viewer"]);
  queue.schedule("viewer"); // second failure: 4 seconds
  t.mock.timers.tick(3999);
  assert.deepEqual(opened, ["viewer"]);
  queue.reset("viewer");
  queue.schedule("viewer"); // a recovered connection gets the first delay again
  queue.clearAll();
  t.mock.timers.tick(30_000);
  assert.deepEqual(opened, ["viewer"]);
});

test("viewer keeps the same PC for ICE recovery, then rebuilds if the sender never answers", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const pc = new FakePC();
  const actions: string[] = [];
  const manager = manageRecvPeerConnection({
    pc: pc as unknown as RTCPeerConnection,
    isCurrent: () => true,
    onState: (state) => actions.push(state),
    onClosed: () => actions.push("closed-handler"),
    requestReconnect: () => actions.push("request"),
    rebuild: () => actions.push("rebuild"),
    recoveryTimeoutMs: 9000,
  });
  pc.change("disconnected");
  t.mock.timers.tick(3999);
  assert.deepEqual(actions, ["disconnected"]);
  t.mock.timers.tick(1);
  assert.deepEqual(actions, ["disconnected", "request"]);
  t.mock.timers.tick(9000);
  assert.deepEqual(actions, ["disconnected", "request", "rebuild"]);
  manager.dispose();
});

test("viewer recovery cancels its rebuild if ICE reconnects or the peer leaves", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const pc = new FakePC();
  const actions: string[] = [];
  const manager = manageRecvPeerConnection({
    pc: pc as unknown as RTCPeerConnection,
    isCurrent: () => true,
    onState: () => {},
    onClosed: () => {},
    requestReconnect: () => actions.push("request"),
    rebuild: () => actions.push("rebuild"),
    recoveryTimeoutMs: 9000,
  });
  pc.change("failed");
  pc.change("connected");
  t.mock.timers.tick(9000);
  assert.deepEqual(actions, ["request"]);
  pc.change("failed");
  manager.dispose();
  t.mock.timers.tick(9000);
  assert.deepEqual(actions, ["request", "request"]);
});
