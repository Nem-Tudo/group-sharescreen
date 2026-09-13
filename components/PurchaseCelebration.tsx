"use client";

import { useEffect, useState, useSyncExternalStore, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { UserAvatar } from "@/components/UserAvatar";
import { planIcon } from "@/components/planIcons";
import { playPurchaseSound } from "@/lib/soundEffects";

// The moment a payment lands: a sound, and confetti falling over the whole
// screen.
//
// The confetti is made of the purchase itself rather than of coloured paper.
// Half of it is the plan's own mark — the badge that is about to sit beside a
// name — and half is the face of whoever it is for: the buyer for their own
// plan or for a link, the recipient for a present given to somebody by name.
// Alternating, so the split is exactly half and half whatever the count.
//
// Fires once, on mount, which is the whole contract: the callers render this
// inside the "paid" state of a charge, and a charge is paid once. Unmounts its
// own pieces when the last one has landed.
//
// Portalled to <body>, because the dialogs it celebrates inside are
// transformed (the popup library animates them in), and a transformed
// ancestor turns "fixed" into "fixed to that box" — confetti falling inside a
// 384-pixel card is not what anybody meant.

const PIECES = 64;
const MAX_DELAY_S = 1.2;
const MAX_DURATION_S = 5;

type Piece = { face: boolean; size: number; style: CSSProperties };

const subscribeNothing = () => () => {};

function makePieces(withFace: boolean): Piece[] {
  return Array.from({ length: PIECES }, (_, index) => {
    const duration = 2.8 + Math.random() * (MAX_DURATION_S - 2.8);
    const direction = Math.random() < 0.5 ? -1 : 1;
    return {
      face: withFace && index % 2 === 1,
      size: 18 + Math.round(Math.random() * 18),
      // Custom properties, read by .golive-confetti-piece in globals.css.
      style: {
        left: `${Math.random() * 100}%`,
        "--confetti-duration": `${duration.toFixed(2)}s`,
        "--confetti-delay": `${(Math.random() * MAX_DELAY_S).toFixed(2)}s`,
        "--confetti-drift": `${Math.round((Math.random() - 0.5) * 240)}px`,
        "--confetti-spin": `${direction * (240 + Math.round(Math.random() * 480))}deg`,
        "--confetti-sway": `${8 + Math.round(Math.random() * 18)}px`,
        "--confetti-sway-duration": `${(0.8 + Math.random() * 0.8).toFixed(2)}s`,
      } as CSSProperties,
    };
  });
}

export type CelebrationFace = {
  name: string;
  avatarUrl?: string | null;
};

export function PurchaseCelebration({
  planIconId,
  face,
}: {
  /** The plan's mark, by id (see planIcons). */
  planIconId?: string | null;
  /** Whose face is the other half. Null leaves the plan's mark alone. */
  face: CelebrationFace | null;
}) {
  // Decided once, in initialisers: the pieces are random, and a render that
  // re-rolled them would teleport every one of them mid-fall.
  const [pieces] = useState<Piece[] | null>(() => {
    if (typeof window === "undefined") return null;
    // The sound still plays for somebody who asked for less motion; sixty
    // things tumbling across the screen is exactly what they asked not to get.
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return null;
    return makePieces(Boolean(face));
  });
  const [landed, setLanded] = useState(false);
  // False on the server and through hydration, true after: a portal and a
  // screenful of random positions are the two things a server render cannot
  // agree with the client about.
  const onClient = useSyncExternalStore(subscribeNothing, () => true, () => false);
  const mark = planIcon(planIconId);

  useEffect(() => {
    // Deduplicated inside soundEffects, which is also what keeps a dev-mode
    // double mount from playing it twice.
    playPurchaseSound();
    const timer = setTimeout(
      () => setLanded(true),
      (MAX_DELAY_S + MAX_DURATION_S) * 1000 + 300
    );
    return () => clearTimeout(timer);
  }, []);

  if (!onClient || !pieces || landed) return null;

  return createPortal(
    // Above every dialog (ProModal is 70), below the incoming-call ring at
    // 100, and never in the way of a click: it is decoration over a screen
    // somebody is about to use.
    <div aria-hidden className="pointer-events-none fixed inset-0 z-[95] overflow-hidden">
      {pieces.map((piece, index) => (
        <span key={index} className="golive-confetti-piece" style={piece.style}>
          {piece.face && face ? (
            <UserAvatar
              src={face.avatarUrl}
              name={face.name}
              size={piece.size}
              className="shadow-md ring-2 ring-white dark:ring-zinc-900"
            />
          ) : (
            // Sized by a wrapper: the marks take a class and nothing else.
            <span className="block" style={{ width: piece.size, height: piece.size }}>
              <mark.Icon className={`h-full w-full drop-shadow ${mark.className}`} />
            </span>
          )}
        </span>
      ))}
    </div>,
    document.body
  );
}
