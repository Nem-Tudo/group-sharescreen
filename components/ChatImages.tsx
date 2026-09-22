"use client";

// The pictures a message carries, as they are drawn in a conversation. Shared
// by the room chat, DMs and group rooms, so a picture looks the same wherever
// it was sent.
//
// Every picture is shown whole, at its own shape, and never cropped: a
// screenshot of a phone or a panorama is sent to be seen, and a square crop
// out of the middle of it is usually the one part that says nothing. What
// keeps a tall one from taking over the conversation is a height cap instead,
// lower when there are several side by side; a wide one is capped by the
// width of the column. Clicking opens it full size (see ChatImageModal).
//
// An extreme shape — a 1:15 strip either way — would come out a sliver under
// those caps, so each picture also has a floor of a few rem in both
// directions. Past that it is fitted inside the box (object-contain) on a
// faint backdrop rather than stretched to fill it.

export function ChatImages({
  images,
  onOpen,
  onLoad,
  alt,
  label,
  className = "",
  bordered = false,
  compact = false,
}: {
  images: string[];
  onOpen: (index: number) => void;
  /** Fired as each picture arrives — the conversation re-pins its scroll on it. */
  onLoad?: () => void;
  alt: string;
  /** The button's accessible name, e.g. "Ampliar a imagem". */
  label: string;
  className?: string;
  /** A hairline around each picture, for conversations drawn without bubbles. */
  bordered?: boolean;
  /** Lower caps, for the room chat's narrow sidebar. */
  compact?: boolean;
}) {
  if (images.length === 0) return null;
  const single = images.length === 1;
  const maxHeight = single ? (compact ? "max-h-56" : "max-h-72") : compact ? "max-h-32" : "max-h-40";
  return (
    <div className={`flex max-w-full flex-wrap gap-1 ${className}`}>
      {images.map((url, index) => (
        <button
          key={`${index}:${url.slice(-24)}`}
          type="button"
          onClick={(e) => {
            // Opening the picture is all this click means — not also whatever
            // the message around it does when clicked (the room chat opens
            // its menu).
            e.stopPropagation();
            onOpen(index);
          }}
          aria-label={label}
          title={label}
          className="block max-w-full cursor-zoom-in rounded-lg text-left transition hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt={alt}
            decoding="async"
            onLoad={onLoad}
            draggable={false}
            className={`block h-auto w-auto min-h-12 min-w-12 max-w-full ${maxHeight} rounded-lg bg-black/5 object-contain dark:bg-white/5 ${
              bordered ? "border border-zinc-200 dark:border-zinc-800" : ""
            }`}
          />
        </button>
      ))}
    </div>
  );
}
