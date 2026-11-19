// errorText: a request that never reached the server reads as such, in the
// person's language, instead of the browser's own English ("Failed to fetch").
import assert from "node:assert/strict";
import test from "node:test";
import { setLocalePreference, translate } from "@/lib/i18n";
import { errorText, isNetworkFailure } from "@/lib/errorText";

test("each engine's wording for a request that got no answer is a network failure", () => {
  // Chromium, Firefox, Safari, React Native / older WebViews.
  for (const message of [
    "Failed to fetch",
    "NetworkError when attempting to fetch resource.",
    "Load failed",
    "Network request failed",
  ]) {
    assert.equal(isNetworkFailure(new TypeError(message)), true, message);
  }
});

test("a refusal from the server keeps its own message", () => {
  setLocalePreference("pt");
  assert.equal(errorText(new Error("Usuário ou senha inválidos."), "fallback"), "Usuário ou senha inválidos.");
  // A TypeError that is a bug, not the network, is not dressed up as one.
  assert.equal(isNetworkFailure(new TypeError("x is not a function")), false);
  assert.equal(errorText(null, "fallback"), "fallback");
});

test("a network failure becomes the translated text", () => {
  setLocalePreference("pt");
  const text = errorText(new TypeError("Failed to fetch"), "fallback");
  assert.equal(text, translate("common.serverUnreachable"));
  assert.notEqual(text, "common.serverUnreachable");
  assert.match(text, /servidor/);
});
