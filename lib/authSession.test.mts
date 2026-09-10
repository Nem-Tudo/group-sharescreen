// node --experimental-strip-types lib/authSession.test.mts
//
// The regression this file exists for: an API that is restarting used to log
// everybody out.
//
// /auth/me is how every client resolves its session, and fetchMe used to
// discard the account token on *any* non-OK response. A server still starting
// up answers 503, a proxy in front of one answers 502, a busy one answers 429
// — none of which know anything about the token — and throwing it away for
// those turned a restart into a logout that came back wearing the person's
// last guest name.
//
// The rule these assertions pin down: only an answer that is *about the token*
// (401, 403) may discard it. Everything else has to reach the caller as a
// failure, which is the path that keeps the token and retries.
import assert from "node:assert/strict";
import { fetchMe, getAccountToken, setAccountToken } from "./accountApi";

const realFetch = globalThis.fetch;
function stubStatus(status: number, body: unknown = { error: "x" }) {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    })) as typeof globalThis.fetch;
}

// Statuses that say nothing about the token: the session must survive them,
// and the caller must be told the lookup failed rather than "no account".
for (const status of [500, 502, 503, 504, 429]) {
  setAccountToken("token-abc");
  stubStatus(status);
  await assert.rejects(
    () => fetchMe(),
    `HTTP ${status} must reach the caller as a failure, not as "no account"`
  );
  assert.equal(
    getAccountToken(),
    "token-abc",
    `HTTP ${status} says nothing about the token and must not discard it`
  );
}

// The two that *are* about the token still end the session.
for (const status of [401, 403]) {
  setAccountToken("token-abc");
  stubStatus(status);
  assert.equal(await fetchMe(), null, `HTTP ${status} resolves to no account`);
  assert.equal(
    getAccountToken(),
    null,
    `HTTP ${status} is the server rejecting this token, so it must be discarded`
  );
}

// A good answer resolves and keeps the token.
setAccountToken("token-abc");
globalThis.fetch = (async () =>
  new Response(
    JSON.stringify({ account: { id: "a", username: "u", displayName: "U", flags: [] } }),
    { status: 200, headers: { "content-type": "application/json" } }
  )) as typeof globalThis.fetch;
const me = await fetchMe();
assert.ok(me, "a 200 resolves to an account");
assert.equal(me!.account.username, "u");
assert.equal(getAccountToken(), "token-abc", "a successful lookup keeps the token");

// No token at all: nothing is asked of the network.
setAccountToken(null);
let called = false;
globalThis.fetch = (async () => {
  called = true;
  return new Response("{}", { status: 200 });
}) as typeof globalThis.fetch;
assert.equal(await fetchMe(), null, "no token resolves to no account");
assert.equal(called, false, "no token means no request");

globalThis.fetch = realFetch;
