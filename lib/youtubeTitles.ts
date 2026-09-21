"use client";

import { useEffect, useState } from "react";

// O nome de um vídeo do YouTube a partir do id, para a lista da playlist (ver
// components/MusicQueuePanel).
//
// Por que oEmbed e não a Data API: a Data API pede chave, cota e uma rota no
// servidor para não expor a chave — muito peso para um rótulo. O oEmbed é
// público, tem CORS, e responde com o título e o canal. Quando ele falha (rede,
// vídeo privado, limite), a lista mostra "Faixa N" e segue funcionando: o nome
// é enfeite, o que toca é o índice.
//
// Cache em memória por id, compartilhado por toda a página — a mesma playlist
// aberta duas vezes não pede duas vezes. Não vai para o localStorage de
// propósito: título de vídeo muda, e uma playlist de 200 itens não tem por que
// ocupar armazenamento do navegador de ninguém.

export type TrackInfo = { title: string; author?: string };

const cache = new Map<string, TrackInfo | null>();
const pending = new Map<string, Promise<TrackInfo | null>>();
const listeners = new Set<() => void>();

// Quantos pedidos ao mesmo tempo. Uma playlist tem dezenas de itens e disparar
// todos de uma vez é a forma mais rápida de tomar 429 e ficar sem nenhum nome.
const MAX_PARALLEL = 3;
let running = 0;
const queue: (() => void)[] = [];

function pump() {
  while (running < MAX_PARALLEL && queue.length > 0) {
    const job = queue.shift();
    running++;
    job?.();
  }
}

function emit() {
  for (const listener of listeners) listener();
}

async function fetchTitle(videoId: string): Promise<TrackInfo | null> {
  const url = `https://www.youtube.com/oembed?url=${encodeURIComponent(
    `https://www.youtube.com/watch?v=${videoId}`
  )}&format=json`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = (await res.json()) as { title?: string; author_name?: string };
    if (!data?.title) return null;
    return { title: data.title, author: data.author_name };
  } catch {
    return null;
  }
}

function load(videoId: string): Promise<TrackInfo | null> {
  const existing = pending.get(videoId);
  if (existing) return existing;
  const promise = new Promise<TrackInfo | null>((resolve) => {
    queue.push(() => {
      fetchTitle(videoId)
        .then((info) => {
          cache.set(videoId, info);
          resolve(info);
        })
        .catch(() => {
          cache.set(videoId, null);
          resolve(null);
        })
        .finally(() => {
          running--;
          pending.delete(videoId);
          emit();
          pump();
        });
    });
    pump();
  });
  pending.set(videoId, promise);
  return promise;
}

/**
 * Os nomes dos vídeos passados, na ordem em que foram pedidos. Um id ainda sem
 * resposta (ou que falhou) vem como `undefined` — quem chama decide o rótulo
 * provisório.
 */
export function useYouTubeTitles(videoIds: string[]): Map<string, TrackInfo> {
  const key = videoIds.join(",");
  const [, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const bump = () => {
      if (!cancelled) setVersion((v) => v + 1);
    };
    listeners.add(bump);
    for (const id of videoIds) {
      if (!id || cache.has(id)) continue;
      void load(id).then(bump);
    }
    return () => {
      cancelled = true;
      listeners.delete(bump);
    };
    // `key` é a identidade da lista; o array em si muda de referência a cada
    // render do painel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const out = new Map<string, TrackInfo>();
  for (const id of videoIds) {
    const info = cache.get(id);
    if (info) out.set(id, info);
  }
  return out;
}

/** A miniatura do vídeo. Serve para reconhecer a faixa antes do nome chegar. */
export function youtubeThumbnail(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/default.jpg`;
}
