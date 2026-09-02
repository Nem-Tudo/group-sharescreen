"use client";

import { useEffect, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { UserProfileCard } from "./UserProfileCard";
import { MdClose, MdOpenInNew } from "react-icons/md";
import { Tooltip } from "./Tooltip";

// Somebody's profile, shown over the room instead of in place of it.
//
// Opening a profile used to be a link to /user/[id] with target="_blank" —
// a whole new tab to answer "who is this?" about a person you are currently
// in a call with, and one you then have to find and close again. The page is
// unchanged and still where that link points from anywhere outside a room;
// this is what the room itself opens.
//
// Portalled to the body, and not optionally: the participant list sits inside
// a column with its own scroll container and the chat inside another, so a
// dialog rendered where it is called from would be clipped by whichever of
// them it happened to be in.

const subscribeNothing = () => () => {};

export function UserProfileDialog({
  userId,
  onClose,
}: {
  userId: string;
  onClose: () => void;
}) {
  const onClient = useSyncExternalStore(subscribeNothing, () => true, () => false);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  if (!onClient) return null;

  return createPortal(
    // Two elements, not one, and that is the difference between a modal that
    // scrolls and one that cuts its own top off. Centring with `items-center`
    // on the scroller itself works only while the card fits: once it is taller
    // than the viewport — which on a phone it always is, banner plus bio plus
    // three stat cards — a centred flex item overflows in *both* directions
    // and the part above the fold becomes unreachable, because scrolling
    // cannot go past the container's start. The scroll lives on the outer one
    // and the centring on an inner box with `min-h-full`, so a short card is
    // centred and a tall one simply scrolls from its top.
    <div
      className="golive-dialog-backdrop fixed inset-0 z-50 overflow-y-auto bg-black/60 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Perfil"
    >
      <div className="flex min-h-full items-center justify-center">
      <div
        // The backdrop closes on click; the card must not, or every click
        // inside it — including selecting the bio text — would dismiss it.
        onClick={(e) => e.stopPropagation()}
        className="golive-dialog-card relative w-full max-w-2xl"
      >
        {/* Both window controls together, over the banner rather than
            above the card: the banner is decorative and full-bleed, so there
            is no header row to put them in without inventing one. Their own
            dark discs so they stay legible against whatever image somebody
            set.

            "Open in a new tab" used to be a line of underlined white text
            floating on the backdrop under the card, which read as a stray
            caption rather than a control — it belonged to nothing, and the
            backdrop it sat on is the click target that closes the dialog. As
            an icon beside the close button it is the same kind of thing in
            the same place: something you do to this window. */}
        <div className="absolute right-3 top-3 z-10 flex items-center gap-1.5">
          <Tooltip content="Abrir perfil em uma nova aba">
            <Link
              href={`/user/${userId}`}
              target="_blank"
              aria-label="Abrir perfil em uma nova aba"
              className="flex rounded-full bg-black/50 p-2 text-white transition hover:bg-black/70"
            >
              <MdOpenInNew className="h-4 w-4" />
            </Link>
          </Tooltip>
          <Tooltip content="Fechar">
            <button
              type="button"
              onClick={onClose}
              aria-label="Fechar perfil"
              className="flex rounded-full bg-black/50 p-2 text-white transition hover:bg-black/70"
            >
              <MdClose className="h-4 w-4" />
            </button>
          </Tooltip>
        </div>

        <UserProfileCard id={userId} onNavigate={onClose} />

      </div>
      </div>
    </div>,
    document.body
  );
}
