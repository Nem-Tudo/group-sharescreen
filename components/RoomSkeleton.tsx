// What a room looks like while it is still arriving.
//
// It replaced a centred spinner with the word "Entrando na sala..." under it.
// The spinner was honest but it said nothing about *what* was coming, so the
// room appeared to be built twice: an empty page with a dot spinning in the
// middle, then, all at once, a header, three columns and a grid. This traces
// that final shape from the first frame, so the only thing that changes when
// the room lands is that the grey blocks become content — the layout itself
// never moves.
//
// Deliberately a mirror of WatchRoom's own structure rather than a generic
// placeholder: the same shell classes, the same header, the same
// `lg:flex-row` three-column body with the same widths. Those values are
// duplicated here on purpose (a shared constant for `w-64` would be worse
// than the duplication) but they are the thing to check if the room's layout
// is ever reworked — a skeleton that no longer matches is a shape that jumps
// when it resolves, which is worse than no skeleton at all.
//
// Breakpoints are pure CSS here (`hidden lg:flex`) where WatchRoom uses a JS
// media query (`isWideLayout`). Same result, and it means the skeleton is
// correct in its very first paint instead of after the query has resolved —
// which matters most on exactly the slow first load this exists for.

// The one thing every block here shares: a neutral fill and the shared pulse.
// Kept as a constant because the alternative is repeating a two-tone
// dark-mode background thirty times and getting one of them wrong.
const BLOCK = "animate-pulse rounded-md bg-zinc-200/80 dark:bg-zinc-800/80";

function Block({ className }: { className: string }) {
  return <div className={`${BLOCK} ${className}`} />;
}

/** One participant row: an avatar dot and a name of a plausible length. */
function ParticipantRow({ width }: { width: string }) {
  return (
    <div className="flex items-center gap-2 px-1.5 py-1.5">
      <Block className="h-7 w-7 shrink-0 rounded-full" />
      <Block className={`h-3 ${width}`} />
    </div>
  );
}

/** One chat line: a short name above a message of a plausible length. */
function ChatRow({ width }: { width: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Block className="h-2.5 w-20" />
      <Block className={`h-3 ${width}`} />
    </div>
  );
}

export function RoomSkeleton() {
  return (
    <div
      // The same marker the real room carries, because globals.css pins the
      // app shell to the viewport through it below lg. Without this the
      // skeleton would scroll the page while the room it stands in for does
      // not — the one difference a user would actually feel.
      data-room-shell
      className="flex min-h-0 flex-1 flex-col bg-zinc-50 dark:bg-black"
      // Nothing here carries meaning to read out, so it is hidden from
      // assistive tech entirely and the status is announced instead — a
      // screen reader user gets the sentence the spinner used to show, and
      // none of the thirty grey rectangles standing in for it.
      aria-hidden="true"
    >
      <header className="shrink-0 border-b border-black/10 bg-white px-3 py-2 dark:border-white/10 dark:bg-zinc-950 sm:px-4">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-2.5 lg:grid lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] lg:flex-nowrap lg:gap-3">
          {/* Where you are: home, the room's name, its public/private badge. */}
          <div className="flex min-w-0 flex-1 items-center gap-2 lg:flex-none">
            <Block className="h-8 w-8 shrink-0" />
            <span className="hidden h-6 w-px shrink-0 bg-zinc-200 lg:block dark:bg-zinc-800" />
            <Block className="h-5 w-32 shrink-0 sm:w-44" />
            <Block className="h-5 w-16 shrink-0 rounded-full" />
          </div>

          {/* The mid-call controls, which only live in the header from lg up
              — below that they are the bottom bar, exactly as in the room. */}
          <div className="hidden items-center gap-2 lg:flex">
            <Block className="h-9 w-28 rounded-lg" />
            <Block className="h-9 w-9 rounded-lg" />
            <Block className="h-9 w-9 rounded-lg" />
            <Block className="h-9 w-9 rounded-lg" />
          </div>

          {/* Who you are, and the page's own controls. */}
          <div className="flex items-center justify-end gap-2 lg:flex-none">
            <Block className="hidden h-8 w-8 rounded-lg sm:block" />
            <Block className="h-8 w-24 rounded-lg" />
          </div>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row lg:gap-3 lg:p-3">
        {/* Participants, then the partner card under it. */}
        <aside className="hidden h-full w-64 shrink-0 flex-col gap-3 lg:flex 2xl:w-72">
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
            <div className="shrink-0 border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
              <Block className="h-4 w-28" />
            </div>
            <div className="min-h-0 flex-1 space-y-0.5 overflow-hidden px-1.5 py-2">
              {/* Varying widths on purpose: a column of identical bars reads
                  as a broken table, not as names still loading. */}
              <ParticipantRow width="w-28" />
              <ParticipantRow width="w-20" />
              <ParticipantRow width="w-32" />
              <ParticipantRow width="w-24" />
            </div>
          </div>
          <Block className="h-36 w-full shrink-0 rounded-xl" />
        </aside>

        {/* What the room is looking at. One block filling the area rather
            than a grid of tiles: the overwhelmingly common room is a single
            screen share, so a 2x2 placeholder would be a promise the room is
            usually about to break. */}
        <main className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden p-2 lg:p-0">
          <Block className="min-h-0 w-full flex-1 rounded-xl" />
        </main>

        {/* Chat. The width matches WatchRoom's DEFAULT_CHAT_WIDTH — a person
            who has dragged theirs wider will see it settle once the room
            lands, which is a far smaller movement than the column appearing
            from nothing. */}
        <aside className="hidden h-full w-80 shrink-0 flex-col lg:flex">
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
            <div className="shrink-0 border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
              <Block className="h-4 w-20" />
            </div>
            {/* Bottom-anchored, because a chat is read from its newest
                message up — filling from the top would put the skeleton's
                weight where the room's is not. */}
            <div className="flex min-h-0 flex-1 flex-col justify-end gap-4 overflow-hidden px-3 py-3">
              <ChatRow width="w-40" />
              <ChatRow width="w-56" />
              <ChatRow width="w-32" />
              <ChatRow width="w-48" />
            </div>
            <div className="shrink-0 border-t border-zinc-200 p-2 dark:border-zinc-800">
              <Block className="h-9 w-full rounded-lg" />
            </div>
          </div>
        </aside>

        {/* The bottom bar, which below lg is where the mid-call controls
            live. Same border, same padding, same safe-area inset as the real
            one, so the grid above it is the same height in both. */}
        <nav className="flex shrink-0 items-center gap-1 border-t border-zinc-200 bg-white px-2 py-1.5 pb-[max(0.375rem,env(safe-area-inset-bottom))] lg:hidden dark:border-zinc-800 dark:bg-zinc-950">
          <Block className="h-9 flex-1 rounded-lg" />
          <Block className="h-9 flex-1 rounded-lg" />
          <Block className="h-9 flex-1 rounded-lg" />
          <Block className="h-9 flex-1 rounded-lg" />
        </nav>
      </div>
    </div>
  );
}
