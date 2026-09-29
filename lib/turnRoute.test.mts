// node --import ./lib/ts-resolve.mjs --experimental-strip-types lib/turnRoute.test.mts
//
// Which connections get the relay cap: only one whose *selected* pair has our
// own end on a relay candidate — from any TURN server.
import assert from "node:assert/strict";
import { relayedViaTurn, relayRouteOf } from "./turnRoute";

function report(local: Record<string, unknown>, remote: Record<string, unknown> = { candidateType: "host" }) {
  return [
    { id: "T", type: "transport", selectedCandidatePairId: "P" },
    { id: "P", type: "candidate-pair", localCandidateId: "L", remoteCandidateId: "R", state: "succeeded" },
    { id: "L", type: "local-candidate", ...local },
    { id: "R", type: "remote-candidate", ...remote },
    // A pair that is not the selected one must not decide anything.
    { id: "X", type: "candidate-pair", localCandidateId: "XL", state: "succeeded", nominated: true },
    { id: "XL", type: "local-candidate", candidateType: "relay", url: "turn:turn.cloudflare.com:3478" },
  ];
}

// Direct connections are never capped, whatever else was gathered.
assert.equal(relayedViaTurn(report({ candidateType: "host" })), false);
assert.equal(relayedViaTurn(report({ candidateType: "srflx" })), false);

// Our end on any relay: capped — Cloudflare's, the VPS, or unreported (Firefox).
assert.equal(relayedViaTurn(report({ candidateType: "relay", url: "turn:turn.cloudflare.com:3478?transport=udp" })), true);
assert.equal(relayedViaTurn(report({ candidateType: "relay", url: "turn:vps.example.com:3478" })), true);
assert.equal(relayedViaTurn(report({ candidateType: "relay" })), true);

// Only the remote end relaying is invisible from here — the viewer reports it.
assert.equal(relayedViaTurn(report({ candidateType: "host" }, { candidateType: "relay" })), false);

// Firefox's shape: no transport pointer, the pair itself is marked selected.
assert.equal(
  relayedViaTurn([
    { id: "P", type: "candidate-pair", selected: true, localCandidateId: "L" },
    { id: "L", type: "local-candidate", candidateType: "relay", url: "turns:turn.cloudflare.com:443" },
  ]),
  true
);

// Not connected yet: no selected pair, nothing to cap.
assert.equal(relayedViaTurn([]), false);

// Whose server it is travels with the answer (experiment "own-turn" caps the
// VPS alone); an unnamed or unknown server has no provider.
assert.deepEqual(relayRouteOf(report({ candidateType: "relay", url: "turn:turn.cloudflare.com:3478?transport=udp" })), {
  via: true,
  provider: "cloudflare",
});
assert.deepEqual(relayRouteOf(report({ candidateType: "relay" })), { via: true, provider: null });
assert.deepEqual(relayRouteOf(report({ candidateType: "srflx" })), { via: false, provider: null });

console.log("turnRoute: ok");
