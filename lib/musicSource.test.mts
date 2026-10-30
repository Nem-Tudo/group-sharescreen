// node --experimental-strip-types lib/musicSource.test.mts
//
// Colar um link na fila: só o link da playlist em si vira a playlist inteira.
// Um vídeo aberto dentro de um mix (watch?v=…&list=RD…) é o que se copia do
// navegador ouvindo música, e quem cola ele quer aquela música.

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseMusicUrl } from "./musicSource";

test("a playlist link is the whole playlist", () => {
  const parsed = parseMusicUrl("https://www.youtube.com/playlist?list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf");
  assert.equal(parsed?.playlistOnly, true);
  assert.equal(parsed?.playlistId, "PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf");
});

test("a video opened inside a playlist or mix is just that video", () => {
  const parsed = parseMusicUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=RDdQw4w9WgXcQ&start_radio=1");
  assert.equal(parsed?.playlistOnly, false);
  assert.equal(parsed?.videoId, "dQw4w9WgXcQ");
});

test("a plain video link has no playlist", () => {
  const parsed = parseMusicUrl("https://youtu.be/dQw4w9WgXcQ");
  assert.equal(parsed?.playlistOnly, false);
  assert.equal(parsed?.playlistId, null);
});
