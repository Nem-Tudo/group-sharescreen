// A runtime check of the translation core: the gate, the fallbacks, the
// interpolation and the counted lookups.
import assert from "node:assert/strict";
import test from "node:test";
import {
  translate,
  translateCount,
  getLocale,
  setLocalePreference,
  activateLocale,
  detectBrowserLocale,
  isLocale,
  DEFAULT_LOCALE,
} from "@/lib/i18n";

test("before activation everything answers in English, whatever is stored", () => {
  // This is what keeps the hydrating render identical to the server's HTML.
  assert.equal(getLocale(), DEFAULT_LOCALE);
  assert.equal(translate("common.save"), "Save");
});

test("activation hands over the real language", () => {
  activateLocale();
  setLocalePreference("es");
  assert.equal(getLocale(), "es");
  assert.equal(translate("common.save"), "Guardar");
  assert.equal(translate("common.cancel"), "Cancelar");
});

test("a missing key falls through to the key itself rather than a blank", () => {
  assert.equal(translate("this.key.does.not.exist"), "this.key.does.not.exist");
});

test("placeholders are filled from the vars object", () => {
  const out = translate("common.chatWithDisplayname", { displayName: "Ana" });
  assert.ok(out.includes("Ana"), out);
  assert.ok(!out.includes("{displayName}"), out);
});

test("an unknown placeholder is left visible, not blanked", () => {
  assert.equal(translate("common.chatWithDisplayname", {}), "Chatear con {displayName}");
});

test("counted lookups pick one vs other, and expose {count}", () => {
  assert.equal(translateCount("common.memberCount", 1), "1 miembro");
  assert.equal(translateCount("common.memberCount", 5), "5 miembros");
  setLocalePreference("en");
  assert.equal(translateCount("common.memberCount", 1), "1 member");
  assert.equal(translateCount("common.memberCount", 5), "5 members");
});

test("an explicit locale overrides the current one", () => {
  setLocalePreference("en");
  assert.equal(translate("common.save", undefined, "es"), "Guardar");
  assert.equal(translate("common.save"), "Save");
});

test("locale detection only accepts languages we have words for", () => {
  assert.equal(isLocale("en"), true);
  assert.equal(isLocale("es"), true);
  assert.equal(isLocale("pt"), false);
  // No navigator in this process, so it falls back to the default.
  assert.equal(detectBrowserLocale(), DEFAULT_LOCALE);
});
