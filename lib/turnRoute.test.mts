// node --import ./lib/ts-resolve.mjs --experimental-strip-types lib/turnRoute.test.mts
//
// Which connections get the Cloudflare cap: only one whose *selected* pair has
// our own end on a relay candidate from Cloudflare.
import assert from "node:assert/strict";
import { relayedViaCloudflare } from "./turnRoute.ts";

const isCf = (url: string) => url.includes("cloudflare.com");

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
assert.equal(relayedViaCloudflare(report({ candidateType: "host" }), isCf, true), false);
assert.equal(relayedViaCloudflare(report({ candidateType: "srflx" }), isCf, true), false);

// Our end on Cloudflare's relay: capped.
assert.equal(
  relayedViaCloudflare(report({ candidateType: "relay", url: "turn:turn.cloudflare.com:3478?transport=udp" }), isCf, true),
  true
);

// Our end on the VPS relay: not Cloudflare, not capped.
assert.equal(
  relayedViaCloudflare(report({ candidateType: "relay", url: "turn:vps.example.com:3478" }), isCf, true),
  false
);

// A relay whose URL the browser does not report (Firefox) counts as Cloudflare
// only while Cloudflare's servers are in use at all.
assert.equal(relayedViaCloudflare(report({ candidateType: "relay" }), isCf, true), true);
assert.equal(relayedViaCloudflare(report({ candidateType: "relay" }), isCf, false), false);

// Only the remote end relaying is invisible from here — the viewer reports it.
assert.equal(relayedViaCloudflare(report({ candidateType: "host" }, { candidateType: "relay" }), isCf, true), false);

// Firefox's shape: no transport pointer, the pair itself is marked selected.
assert.equal(
  relayedViaCloudflare(
    [
      { id: "P", type: "candidate-pair", selected: true, localCandidateId: "L" },
      { id: "L", type: "local-candidate", candidateType: "relay", url: "turns:turn.cloudflare.com:443" },
    ],
    isCf,
    true
  ),
  true
);

// Not connected yet: no selected pair, nothing to cap.
assert.equal(relayedViaCloudflare([], isCf, true), false);

console.log("turnRoute: ok");
