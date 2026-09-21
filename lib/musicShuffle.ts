"use client";

// Ordem aleatória da playlist da sala.
//
// O ponto difícil: a sala inteira tem que tocar a *mesma* faixa, e nada disso
// passa pelo servidor (o registro da música é o que existe, e ele só carrega
// `playlistIndex` — ver lib/musicSource.ts). Então a ordem não é sorteada: ela
// é *derivada* de uma semente que todo mundo já tem, o id da música da sala.
// Dois navegadores com a mesma semente e o mesmo tamanho de playlist chegam na
// mesma permutação, sem combinar nada com ninguém.
//
// Quem está dirigindo (ver MusicBar) é quem escolhe o próximo índice por essa
// ordem e manda o índice pelo caminho de sempre; os outros seguem o índice,
// como sempre seguiram. Ou seja: ninguém precisa saber que o modo aleatório
// está ligado para tocar junto — e é por isso que ele pode ser uma preferência
// local sem virar campo novo no servidor.

// Hash de string para inteiro de 32 bits (FNV-1a). Precisa ser estável entre
// navegadores, então nada de hash da plataforma.
function hashSeed(seed: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

// Gerador determinístico (mulberry32). Math.random não serve aqui por motivo
// óbvio: a ordem tem que ser a mesma em todo mundo.
function makeRandom(seed: number): () => number {
  let state = seed || 1;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A permutação dos índices 0..length-1 dessa semente. Fisher-Yates com o
 * gerador acima — mesma semente, mesma ordem, em qualquer navegador.
 */
export function shuffledOrder(seed: string, length: number): number[] {
  const order = Array.from({ length }, (_, i) => i);
  if (length < 2) return order;
  const random = makeRandom(hashSeed(seed));
  for (let i = length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

/**
 * O índice seguinte (ou anterior) na ordem aleatória, dando a volta no fim.
 * Um índice atual que não está na ordem (playlist que mudou de tamanho debaixo
 * da gente) cai no começo dela, que é melhor que parar a música.
 */
export function shuffledNeighbour(order: number[], current: number, direction: 1 | -1): number {
  if (order.length === 0) return 0;
  const at = order.indexOf(current);
  if (at < 0) return order[0];
  const next = (at + direction + order.length) % order.length;
  return order[next];
}

/** A ordem em que as faixas vão tocar, para a aba da direita mostrar. */
export function playbackOrder(order: number[], count: number, shuffle: boolean): number[] {
  if (!shuffle) return Array.from({ length: count }, (_, i) => i);
  return order;
}
