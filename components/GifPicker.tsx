"use client";

import { useEffect, useState } from "react";
import type { GifResult } from "@/app/api/giphy/search/route";
import { useT } from "@/lib/useI18n";

// Debounce delay between keystrokes and firing a search — short enough to
// feel live, long enough that a fast typist doesn't fire a request per
// character.
const SEARCH_DEBOUNCE_MS = 350;

// The panel inside the chat's "GIF" popover — see ChatPanel, which mounts it
// as a <Popover> content. Where it goes on screen (above the button, flipped
// or shifted when there's no room, escaping the chat box's own overflow) and
// when it closes (click outside, Escape) are Tippy's job, so all that's left
// here is searching and picking.
export function GifPicker({ onSelect }: { onSelect: (gif: GifResult) => void }) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GifResult[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error" | "unavailable">("loading");

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

  return (
    <div className="flex h-80 w-72 max-w-[calc(100vw-1rem)] flex-col overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-lg dark:border-zinc-800 dark:bg-zinc-900">
      <div className="border-b border-zinc-200 p-2 dark:border-zinc-800">
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("gifPicker.searchGifs")}
          maxLength={100}
          className="w-full rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-sm text-zinc-950 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {status === "unavailable" && (
          <p className="my-auto text-center text-sm text-zinc-500 dark:text-zinc-500">
            {t("gifPicker.gifSearchUnavailable")}
          </p>
        )}
        {status === "error" && (
          <p className="my-auto text-center text-sm text-zinc-500 dark:text-zinc-500">
            {t("gifPicker.couldNotSearchGifsTryAgain")}
          </p>
        )}
        {status === "loading" && results.length === 0 && (
          <p className="my-auto text-center text-sm text-zinc-500 dark:text-zinc-500">{t("gifPicker.searching")}</p>
        )}
        {(status === "ready" || status === "loading") && results.length > 0 && (
          <div className="grid grid-cols-3 gap-1.5">
            {results.map((gif) => (
              <button
                key={gif.id}
                type="button"
                onClick={() => onSelect(gif)}
                className="aspect-square overflow-hidden rounded-md bg-zinc-100 outline-none hover:ring-2 hover:ring-zinc-400 focus-visible:ring-2 focus-visible:ring-zinc-500 dark:bg-zinc-800"
              >
                {/* Giphy renditions are already-compressed GIFs — next/image
                    would need a remote-pattern allowlist for every Giphy CDN
                    subdomain and re-encoding risks breaking the animation. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
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
        {status === "ready" && results.length === 0 && (
          <p className="my-auto text-center text-sm text-zinc-500 dark:text-zinc-500">
            {t("gifPicker.noGifFound")}
          </p>
        )}
      </div>

      <div className="border-t border-zinc-200 px-2 py-1 text-right text-[10px] text-zinc-400 dark:border-zinc-800 dark:text-zinc-600">
        {t("gifPicker.poweredByGiphy")}
      </div>
    </div>
  );
}
