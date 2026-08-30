"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchPublicRooms, type PublicRoom } from "@/lib/roomsApi";
import { Tooltip } from "@/components/Tooltip";
import { ThemeMenuButton } from "@/components/ThemeToggle";
import { roomCategory } from "@/lib/roomCategories";

const POLL_INTERVAL_MS = 8000;

function formatActiveFor(createdAt: number): string {
  const seconds = Math.max(0, Math.floor((Date.now() - createdAt) / 1000));
  if (seconds < 60) return "há poucos segundos";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `há ${minutes} ${minutes === 1 ? "minuto" : "minutos"}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours} ${hours === 1 ? "hora" : "horas"}`;
  const days = Math.floor(hours / 24);
  return `há ${days} ${days === 1 ? "dia" : "dias"}`;
}

export function RoomsPageClient() {
  const [rooms, setRooms] = useState<PublicRoom[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    async function load() {
      try {
        const data = await fetchPublicRooms(controller.signal);
        if (cancelled) return;
        setRooms(data);
        setError(null);
      } catch {
        if (!cancelled) setError("Não foi possível carregar as salas públicas.");
      }
    }

    load();
    const interval = setInterval(load, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      controller.abort();
      clearInterval(interval);
    };
  }, []);

  const filtered = (rooms ?? []).filter((r) =>
    r.handle.toLowerCase().includes(search.trim().toLowerCase())
  );

  return (
    <div className="flex flex-1 flex-col bg-zinc-50 px-4 py-10 dark:bg-black">
      <div className="mx-auto w-full max-w-3xl">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
              Salas públicas
            </h1>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              Salas com pelo menos uma pessoa conectada agora.
            </p>
          </div>
          {/* This page has no SiteHeader to hang the theme switch off, and
              it's a page people leave open — so it gets its own copy next to
              the way out. The setting itself is one global preference (see
              lib/theme.ts); this is just another place to reach it. */}
          <div className="flex shrink-0 items-center gap-1.5">
            <ThemeMenuButton />
            <Link
              href="/"
              className="shrink-0 rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
            >
              Início
            </Link>
          </div>
        </div>

        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Pesquisar sala por nome..."
          className="mt-6 w-full rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-zinc-950 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
        />

        <div className="mt-6">
          {error && (
            <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600 dark:bg-red-950/40 dark:text-red-400">
              {error}
            </p>
          )}

          {!error && rooms === null && (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">Carregando...</p>
          )}

          {!error && rooms !== null && filtered.length === 0 && (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              {rooms.length === 0
                ? "Nenhuma sala pública ativa no momento."
                : "Nenhuma sala encontrada para essa pesquisa."}
            </p>
          )}

          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {filtered.map((room) => {
              const category = roomCategory(room.category);
              return (
              <li
                key={room.handle}
                className="flex items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950"
              >
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-2">
                    {/* The name is truncated to keep the card one line wide —
                        the tooltip is what makes a long one readable at all. */}
                    <Tooltip content={room.handle}>
                      <p className="truncate font-semibold text-zinc-900 dark:text-zinc-100">
                        {room.handle}
                      </p>
                    </Tooltip>
                    {category && (
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${category.className}`}
                      >
                        {category.label}
                      </span>
                    )}
                  </div>
                  {/* Only when there is one — an empty line here would push
                      every other card's layout around for nothing. */}
                  {room.description && (
                    <p className="mt-1 line-clamp-2 text-xs text-zinc-600 dark:text-zinc-300">
                      {room.description}
                    </p>
                  )}
                  <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                    {room.peopleCount} {room.peopleCount === 1 ? "pessoa" : "pessoas"} · ativa{" "}
                    {formatActiveFor(room.createdAt)}
                  </p>
                </div>
                <Link
                  href={`/watch/${room.handle}`}
                  className="shrink-0 rounded-lg bg-zinc-950 px-3 py-2 text-sm font-medium text-white transition hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
                >
                  Entrar
                </Link>
              </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}
