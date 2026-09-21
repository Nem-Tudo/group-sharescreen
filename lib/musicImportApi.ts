"use client";

import { getAccountToken } from "./accountApi";
import { getSignalingHttpBase } from "./roomsApi";

// Importar uma playlist do Spotify para a fila da sala.
//
// O que isto *não* é: tocar Spotify. O embed deles dá 30 segundos para quem
// não estiver com Premium logado naquele navegador, e o Web Playback SDK dá a
// faixa inteira só para conta Premium, um login OAuth por ouvinte — uma sala
// onde metade das pessoas não ouve nada é pior que uma sala sem música. Ver
// lib/musicSource.ts.
//
// O que isto é: ler a lista de faixas e achar cada música no YouTube, que
// todo mundo já consegue ouvir. O link é um jeito de dizer "estas músicas,
// nesta ordem"; quem toca é o player de sempre.
//
// A resolução acontece no servidor (ver server/musicImport.ts): são dezenas de
// buscas por importação, e nada disso pode depender do navegador de quem colou
// o link.

export type ImportedTrack = { videoId: string; title: string };

export type SpotifyImport = {
  name: string;
  tracks: ImportedTrack[];
  /** As músicas que não foram achadas no YouTube — mostradas, não escondidas. */
  missing: string[];
};

export type SpotifyImportError =
  | "not-configured"
  | "account-required"
  | "bad-url"
  | "not-found"
  | "empty"
  | "upstream"
  | "rate-limited";

export function looksLikeSpotifyUrl(raw: string): boolean {
  return /spotify\.(com|link)|^spotify:/i.test(raw.trim());
}

/** Se o servidor está configurado para importar (client id/secret do Spotify). */
export async function spotifyImportAvailable(signal?: AbortSignal): Promise<boolean> {
  try {
    const res = await fetch(`${getSignalingHttpBase()}/music/import/status`, { signal });
    if (!res.ok) return false;
    const data = (await res.json()) as { spotify?: boolean };
    return Boolean(data.spotify);
  } catch {
    return false;
  }
}

export async function importSpotifyPlaylist(
  url: string,
  signal?: AbortSignal
): Promise<SpotifyImport | { error: SpotifyImportError }> {
  const token = getAccountToken();
  if (!token) return { error: "account-required" };
  try {
    const res = await fetch(`${getSignalingHttpBase()}/music/import/spotify`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ url }),
      signal,
    });
    if (res.status === 429) return { error: "rate-limited" };
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      return { error: (data?.error as SpotifyImportError) ?? "upstream" };
    }
    return (await res.json()) as SpotifyImport;
  } catch {
    return { error: "upstream" };
  }
}
