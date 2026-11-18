// Loading placeholders for the home page, each drawn to the exact size of what
// replaces it.
//
// That is the whole job. The page centres its row of cards vertically and caps
// the side panels at the form's height (see app/page.tsx's --home-form-h), so a
// placeholder that is the wrong height does not just look different — it moves
// every card on the page when the real content lands, and a short one under the
// form let the friends panel spill out of its own card. Same row height, same
// faces, same gaps as the real rows; only the text is swapped for bars.

// Widths for the name bars, varied so the list reads as names and not as a
// table of identical blocks.
const NAME_WIDTHS = ["62%", "48%", "71%", "55%", "40%", "66%"];

/**
 * Rows shaped like the friends and groups lists: a bordered card, a 32px face
 * and two lines of text in a 36px column, which is what sets the real rows'
 * height too (20px name + 16px handle).
 */
export function SkeletonRows({
  count = 4,
  face = "round",
  trailing = "none",
  className = "",
}: {
  count?: number;
  face?: "round" | "square";
  /** What sits at the row's right edge: the friends' two icon buttons, or a group's "Abrir". */
  trailing?: "none" | "icons" | "button";
  className?: string;
}) {
  return (
    <ul
      aria-hidden="true"
      className={`skeleton-late mt-3 flex min-h-0 flex-col gap-1.5 overflow-hidden lg:flex-1 ${className}`}
    >
      {Array.from({ length: count }, (_, i) => (
        <li
          key={i}
          className="flex items-center gap-2.5 rounded-lg border border-zinc-200 bg-white px-2.5 py-2 dark:border-zinc-800 dark:bg-zinc-950"
        >
          <span
            className={`skeleton-block h-8 w-8 shrink-0 ${face === "round" ? "rounded-full" : "rounded-lg"}`}
          />
          <span className="flex h-9 min-w-0 flex-1 flex-col justify-center gap-2">
            <span
              className="skeleton-block h-3 rounded"
              style={{ width: NAME_WIDTHS[i % NAME_WIDTHS.length] }}
            />
            <span className="skeleton-block h-2.5 w-1/3 rounded" />
          </span>
          {trailing === "icons" && (
            <span className="flex shrink-0 gap-1.5">
              <span className="skeleton-block h-8 w-8 rounded-lg" />
              <span className="skeleton-block h-8 w-8 rounded-lg" />
            </span>
          )}
          {trailing === "button" && <span className="skeleton-block h-7 w-14 shrink-0 rounded-lg" />}
        </li>
      ))}
    </ul>
  );
}

/**
 * The room form's outline: type tabs, a field, a hint and the button, each at
 * its real height (see the room form in app/page.tsx). Drawn while the page
 * does not yet know whether this visitor gets that form or the name form —
 * which is also the server-rendered state — so the card already has roughly
 * the height it will settle on.
 */
export function RoomFormSkeleton({ v2 }: { v2: boolean }) {
  const pill = v2 ? "rounded-full" : "rounded-lg";
  return (
    <div aria-hidden="true" className={`${v2 ? "mt-6" : "mt-8"} flex flex-col gap-3`}>
      {!v2 && <span className="skeleton-block h-5 w-28 rounded" />}
      <div className="grid grid-cols-2 gap-2">
        <span className={`skeleton-block ${v2 ? "h-11" : "h-[38px]"} ${pill}`} />
        <span className={`skeleton-block ${v2 ? "h-11" : "h-[38px]"} ${pill}`} />
      </div>
      <span className="skeleton-block h-5 w-24 rounded" />
      <span className={`skeleton-block ${v2 ? "h-12 rounded-xl" : "h-[46px] rounded-lg"}`} />
      <span className="skeleton-block h-4 w-4/5 rounded" />
      <span className={`skeleton-block mt-2 ${v2 ? "h-12 rounded-full" : "h-11 rounded-lg"}`} />
    </div>
  );
}
