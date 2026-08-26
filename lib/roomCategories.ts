// The room categories, with the labels people actually read. The ids here
// must stay in step with ROOM_CATEGORIES in server/roomStore.ts — that list
// is what the server validates against, and a category it doesn't recognise
// is stored as "no category" rather than kept.
//
// Each carries a Tailwind class pair for its chip, so a category is
// recognisable at a glance in a long room list rather than being ten
// identically grey pills.
export type RoomCategory =
  | "gameplay"
  | "conversa"
  | "musica"
  | "filmes"
  | "estudos"
  | "trabalho"
  | "esportes"
  | "programacao"
  | "arte"
  | "outros";

export const ROOM_CATEGORIES: { id: RoomCategory; label: string; className: string }[] = [
  {
    id: "gameplay",
    label: "Gameplay",
    className: "bg-violet-100 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300",
  },
  {
    id: "conversa",
    label: "Conversa",
    className: "bg-sky-100 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300",
  },
  {
    id: "musica",
    label: "Música",
    className: "bg-pink-100 text-pink-700 dark:bg-pink-950/60 dark:text-pink-300",
  },
  {
    id: "filmes",
    label: "Filmes e séries",
    className: "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300",
  },
  {
    id: "estudos",
    label: "Estudos",
    className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300",
  },
  {
    id: "trabalho",
    label: "Trabalho",
    className: "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  },
  {
    id: "esportes",
    label: "Esportes",
    className: "bg-lime-100 text-lime-700 dark:bg-lime-950/60 dark:text-lime-300",
  },
  {
    id: "programacao",
    label: "Programação",
    className: "bg-cyan-100 text-cyan-700 dark:bg-cyan-950/60 dark:text-cyan-300",
  },
  {
    id: "arte",
    label: "Arte e desenho",
    className: "bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-950/60 dark:text-fuchsia-300",
  },
  {
    id: "outros",
    label: "Outros",
    className: "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  },
];

// Mirrors server/roomStore.ts's MAX_ROOM_DESCRIPTION_LENGTH — the server
// truncates to this regardless, so a mismatch here would only mean an input
// that lets someone type text that silently disappears on save.
export const MAX_ROOM_DESCRIPTION_LENGTH = 120;

const BY_ID = new Map(ROOM_CATEGORIES.map((c) => [c.id, c]));

// Null for "no category" and for an id this client doesn't know (a category
// added server-side before this build shipped) — both render as no chip at
// all, which is the honest answer for a label we can't write.
export function roomCategory(id: string | null | undefined) {
  return id ? (BY_ID.get(id as RoomCategory) ?? null) : null;
}
