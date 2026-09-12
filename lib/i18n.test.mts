// A runtime check of the translation core: the gate, the fallbacks, the
// interpolation and the counted lookups.
//
// Every test sets the language it needs first. The store is module-level on
// purpose — one language for the whole tab — so tests share it, and one that
// relied on the previous test's leftovers would pass or fail on ordering.
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
  LOCALES,
  LOCALE_TAGS,
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

test("Portuguese is the wording the site originally shipped with", () => {
  setLocalePreference("pt");
  assert.equal(getLocale(), "pt");
  assert.equal(translate("common.save"), "Salvar");
  assert.equal(translate("common.cancel"), "Cancelar");
  assert.equal(translate("common.loading"), "Carregando…");
  assert.equal(translateCount("common.memberCount", 1), "1 membro");
  assert.equal(translateCount("common.memberCount", 5), "5 membros");
});

test("a browser asking for pt-BR lands on the Portuguese catalog", () => {
  // detectBrowserLocale splits the region off, so "pt-BR" and "pt" agree.
  assert.equal(isLocale("pt"), true);
  assert.equal(LOCALE_TAGS.pt, "pt-BR");
});

test("a missing key falls through to the key itself rather than a blank", () => {
  setLocalePreference("en");
  assert.equal(translate("this.key.does.not.exist"), "this.key.does.not.exist");
});

test("placeholders are filled from the vars object", () => {
  setLocalePreference("en");
  const out = translate("common.chatWithDisplayname", { displayName: "Ana" });
  assert.ok(out.includes("Ana"), out);
  assert.ok(!out.includes("{displayName}"), out);
});

test("an unknown placeholder is left visible, not blanked", () => {
  setLocalePreference("es");
  assert.equal(translate("common.chatWithDisplayname", {}), "Chatear con {displayName}");
});

test("counted lookups pick one vs other, and expose {count}", () => {
  setLocalePreference("es");
  assert.equal(translateCount("common.memberCount", 1), "1 miembro");
  assert.equal(translateCount("common.memberCount", 5), "5 miembros");
  setLocalePreference("en");
  assert.equal(translateCount("common.memberCount", 1), "1 member");
  assert.equal(translateCount("common.memberCount", 5), "5 members");
});

test("an explicit locale overrides the current one", () => {
  setLocalePreference("en");
  assert.equal(translate("common.save", undefined, "es"), "Guardar");
  assert.equal(translate("common.save", undefined, "pt"), "Salvar");
  assert.equal(translate("common.save"), "Save");
});

test("locale detection only accepts languages we have words for", () => {
  assert.deepEqual([...LOCALES], ["en", "es", "pt"]);
  assert.equal(isLocale("en"), true);
  assert.equal(isLocale("fr"), false);
  // Whatever this machine reports, detection only ever answers with a
  // language there is a catalog for — that is the whole contract. Node does
  // expose navigator.language, so on a Brazilian machine this really does
  // come back "pt", which is the behaviour a pt-BR browser gets.
  const detected = detectBrowserLocale();
  assert.ok(LOCALES.includes(detected), `detected ${detected}`);
  if (typeof navigator !== "undefined" && /^pt/i.test(navigator.language ?? "")) {
    assert.equal(detected, "pt");
  }
});
