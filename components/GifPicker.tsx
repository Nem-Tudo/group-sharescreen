"use client";

import { useEffect, useState } from "react";
import type { GifResult } from "@/lib/gif";
import { getRecentGifs, addRecentGif } from "@/lib/gif";
import { StarIcon, FireIcon } from "@/components/icons";

const SEARCH_DEBOUNCE_MS = 350;

export function GifPicker({ onSelect }: { onSelect: (gif: GifResult) => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GifResult[]>([]);
  const [trending, setTrending] = useState<GifResult[]>([]);
  const [recent, setRecent] = useState<GifResult[]>(() => {
    if (typeof window === "undefined") return [];
    return getRecentGifs();
  });
  const [status, setStatus] = useState<"loading" | "ready" | "error" | "unavailable">("loading");
  const [activeTab, setActiveTab] = useState<"recent" | "trending">("trending");

  useEffect(() => {
    const timer = setTimeout(async () => {
      setStatus("loading");
      try {
        const res = await fetch(`/api/giphy/search?q=${encodeURIComponent(query)}`);
        if (res.status === 404) {
          setStatus("unavailable");
          return;
        }
        if (!res.ok) {
          setStatus("error");
          return;
        }
        const body = (await res.json()) as { results: GifResult[] };
        setResults(body.results);
        setStatus("ready");
      } catch {
        setStatus("error");
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (query !== "" || trending.length > 0) return;
    const loadTrending = async () => {
      try {
        const res = await fetch("/api/giphy/search?q=");
        if (res.ok) {
          const body = (await res.json()) as { results: GifResult[] };
          setTrending(body.results);
        }
      } catch {}
    };
    loadTrending();
  }, [query, trending.length]);

  const handleSelect = (gif: GifResult) => {
    addRecentGif(gif);
    setRecent(getRecentGifs());
    onSelect(gif);
  };

  const isSearching = query !== "";
  const showRecent = !isSearching && activeTab === "recent" && recent.length > 0;
  const showTrending = !isSearching && activeTab === "trending" && trending.length > 0;

  return (
    <div className="flex h-80 w-72 max-w-[calc(100vw-1rem)] flex-col overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-lg dark:border-zinc-800 dark:bg-zinc-900">
      <div className="border-b border-zinc-200 p-2 dark:border-zinc-800">
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar GIFs..."
          maxLength={100}
          className="w-full rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-sm text-zinc-950 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
        />
      </div>

      {!isSearching && (recent.length > 0 || trending.length > 0) && (
        <div className="flex border-b border-zinc-200 dark:border-zinc-800">
          {recent.length > 0 && (
            <button
              type="button"
              onClick={() => setActiveTab("recent")}
              className={`flex flex-1 items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium transition ${
                activeTab === "recent"
                  ? "border-b-2 border-yellow-500 text-yellow-600 dark:text-yellow-400"
                  : "text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
              }`}
            >
              <StarIcon className="h-3.5 w-3.5" />
              Recentes
            </button>
          )}
          <button
            type="button"
            onClick={() => setActiveTab("trending")}
            className={`flex flex-1 items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium transition ${
              activeTab === "trending"
                ? "border-b-2 border-orange-500 text-orange-600 dark:text-orange-400"
                : "text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
            }`}
          >
            <FireIcon className="h-3.5 w-3.5" />
            Em alta
          </button>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {status === "unavailable" && (
          <p className="my-auto text-center text-sm text-zinc-500 dark:text-zinc-500">
            Busca de GIFs indisponível.
          </p>
        )}
        {status === "error" && (
          <p className="my-auto text-center text-sm text-zinc-500 dark:text-zinc-500">
            Falha ao buscar GIFs. Tente novamente.
          </p>
        )}
        {status === "loading" && results.length === 0 && !isSearching && (
          <p className="my-auto text-center text-sm text-zinc-500 dark:text-zinc-500">Buscando...</p>
        )}

        {showRecent && (
          <div className="grid grid-cols-3 gap-1.5">
            {recent.map((gif) => (
              <button
                key={`recent-${gif.id}`}
                type="button"
                onClick={() => handleSelect(gif)}
                className="aspect-square overflow-hidden rounded-md bg-zinc-100 outline-none hover:ring-2 hover:ring-zinc-400 focus-visible:ring-2 focus-visible:ring-zinc-500 dark:bg-zinc-800"
              >
                <img
                  src={gif.previewUrl}
                  alt={gif.title}
                  loading="lazy"
                  className="h-full w-full object-cover"
                />
              </button>
            ))}
          </div>
        )}

        {showTrending && (
          <div className="grid grid-cols-3 gap-1.5">
            {trending.map((gif) => (
              <button
                key={`trending-${gif.id}`}
                type="button"
                onClick={() => handleSelect(gif)}
                className="aspect-square overflow-hidden rounded-md bg-zinc-100 outline-none hover:ring-2 hover:ring-zinc-400 focus-visible:ring-2 focus-visible:ring-zinc-500 dark:bg-zinc-800"
              >
                <img
                  src={gif.previewUrl}
                  alt={gif.title}
                  loading="lazy"
                  className="h-full w-full object-cover"
                />
              </button>
            ))}
          </div>
        )}

        {!isSearching && !showRecent && !showTrending && status === "loading" && (
          <p className="my-auto text-center text-sm text-zinc-500 dark:text-zinc-500">Buscando...</p>
        )}

        {(status === "ready" || status === "loading") && isSearching && results.length > 0 && (
          <div className="grid grid-cols-3 gap-1.5">
            {results.map((gif) => (
              <button
                key={gif.id}
                type="button"
                onClick={() => handleSelect(gif)}
                className="aspect-square overflow-hidden rounded-md bg-zinc-100 outline-none hover:ring-2 hover:ring-zinc-400 focus-visible:ring-2 focus-visible:ring-zinc-500 dark:bg-zinc-800"
              >
                <img
                  src={gif.previewUrl}
                  alt={gif.title}
                  loading="lazy"
                  className="h-full w-full object-cover"
                />
              </button>
            ))}
          </div>
        )}

        {status === "ready" && isSearching && results.length === 0 && (
          <p className="my-auto text-center text-sm text-zinc-500 dark:text-zinc-500">
            Nenhum GIF encontrado.
          </p>
        )}

        {!isSearching && !showRecent && !showTrending && recent.length === 0 && (
          <p className="my-auto text-center text-sm text-zinc-500 dark:text-zinc-500">
            Nenhum GIF usado ainda.
          </p>
        )}
      </div>

      <div className="border-t border-zinc-200 px-2 py-1 text-right text-[10px] text-zinc-400 dark:border-zinc-800 dark:text-zinc-600">
        Powered by GIPHY
      </div>
    </div>
  );
}
