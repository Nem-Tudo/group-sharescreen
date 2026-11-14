// npm test (or: node --import ./lib/ts-resolve.mjs --experimental-strip-types --test lib/shareInterest.test.mts)
//
// Shared window title → interest category, for the personalised affiliate
// products. What these pin: real titles land where a person would expect,
// the specific beats the general, and titles that say nothing say nothing.
import test from "node:test";
import assert from "node:assert/strict";
import { classifyShareTitle } from "./shareInterest.ts";

test("games, launchers and emulators are gameplay", () => {
  for (const title of [
    "VALORANT  ",
    "League of Legends (TM) Client",
    "Counter-Strike 2",
    "Minecraft 1.21.4 - Multiplayer (3rd-party Server)",
    "Roblox",
    "Grand Theft Auto V",
    "BlueStacks App Player",
    "Steam",
    "Twitch - Google Chrome",
  ]) {
    assert.equal(classifyShareTitle(title), "gameplay", title);
  }
});

test("the specific beats the general", () => {
  assert.equal(classifyShareTitle("EA SPORTS FC 25"), "esportes");
  assert.equal(classifyShareTitle("YouTube Music - Google Chrome"), "musica");
  assert.equal(classifyShareTitle("lofi beats - YouTube - Google Chrome"), "filmes");
  assert.equal(classifyShareTitle("Netflix - Microsoft Edge"), "filmes");
  assert.equal(classifyShareTitle("Spotify Premium"), "musica");
});

test("work, code and art apps", () => {
  assert.equal(classifyShareTitle("index.ts - golive - Visual Studio Code"), "programacao");
  assert.equal(classifyShareTitle("Untitled-1 @ 100% (RGB/8) - Adobe Photoshop 2025"), "arte");
  assert.equal(classifyShareTitle("Blender [C:\\scene.blend]"), "arte");
  assert.equal(classifyShareTitle("3ds Max 2024"), "arte");
  assert.equal(classifyShareTitle("Planilha1.xlsx - Excel"), "trabalho");
  assert.equal(classifyShareTitle("Anki - Usuário 1"), "estudos");
  assert.equal(classifyShareTitle("#geral - Discord"), "conversa");
});

test("titles that say nothing are null", () => {
  for (const title of ["", null, undefined, "screen:0:0", "window:1234:0", "Tela inteira", "Screen 1", "Documento sem título", "Bloco de notas"]) {
    assert.equal(classifyShareTitle(title), null, String(title));
  }
});
