import assert from "node:assert/strict";
import { keepMusicPlayback, type MusicSource, type MusicTrack } from "./musicSource";

const track = (id: string, videoId: string): MusicTrack => ({
  id,
  videoId,
  addedById: "u1",
  addedByName: "Ana",
});

const base: MusicSource = {
  id: "m1",
  kind: "youtube",
  videoId: "aaaaaaaaaaa",
  addedById: "u1",
  addedByName: "Ana",
  queue: [track("t1", "aaaaaaaaaaa"), track("t2", "bbbbbbbbbbb")],
  queueIndex: 0,
  playing: true,
  playbackRate: 1,
  positionSeconds: 152,
  updatedAt: 1_000,
};

// Adicionar uma faixa com o registro do servidor trazendo um tempo velho: a
// faixa no ar continua de onde estava.
{
  const next: MusicSource = {
    ...base,
    queue: [...base.queue!, track("t3", "ccccccccccc")],
    positionSeconds: 0,
    updatedAt: 5_000,
  };
  const kept = keepMusicPlayback(base, next)!;
  assert.equal(kept.positionSeconds, 152);
  assert.equal(kept.updatedAt, 1_000);
  assert.equal(kept.queue!.length, 3);
}

// Arrastar: a faixa no ar mudou de lugar na fila, o índice acompanhou.
{
  const next: MusicSource = {
    ...base,
    queue: [base.queue![1], base.queue![0]],
    queueIndex: 1,
    positionSeconds: 0,
    updatedAt: 5_000,
  };
  assert.equal(keepMusicPlayback(base, next)!.positionSeconds, 152);
}

// Outra faixa no ar: o registro do servidor vale inteiro.
{
  const next: MusicSource = { ...base, queueIndex: 1, positionSeconds: 0, updatedAt: 5_000 };
  assert.equal(keepMusicPlayback(base, next)!.positionSeconds, 0);
}

// A mesma faixa pedida de novo, sem mexer na fila: recomeça, como pedido.
{
  const next: MusicSource = { ...base, positionSeconds: 0, updatedAt: 5_000 };
  assert.equal(keepMusicPlayback(base, next)!.positionSeconds, 0);
}

// Outra música (substituída): nada é herdado.
{
  const next: MusicSource = { ...base, id: "m2", positionSeconds: 0 };
  assert.equal(keepMusicPlayback(base, next)!.positionSeconds, 0);
}

// Um vídeo só virando fila ao ganhar uma faixa: mesmo vídeo, mesmo tempo.
{
  const single: MusicSource = { ...base, queue: [], queueIndex: undefined };
  const next: MusicSource = { ...base, positionSeconds: 0, updatedAt: 5_000 };
  assert.equal(keepMusicPlayback(single, next)!.positionSeconds, 152);
}

// Sem música antes, ou música tirada: passa direto.
assert.equal(keepMusicPlayback(null, base), base);
assert.equal(keepMusicPlayback(base, null), null);
