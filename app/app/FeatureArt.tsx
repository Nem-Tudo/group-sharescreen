import { FaDiscord } from "react-icons/fa";
import { FcGoogle } from "react-icons/fc";

// The small drawings at the top of each card on /app, and the screen/faces
// inside the app-window mock in the hero.
//
// Drawn with elements and CSS rather than shipped as images, for the same
// reason the window frame around them is: they stay sharp at any size, they
// follow the visitor's theme instead of carrying a baked-in background, they
// cost no request, and nothing has to be re-exported when a label changes.
//
// Each one shows the *mechanism* the card is about — two memory bars of very
// different lengths, a list with two apps ticked out, a big tile and small
// tiles — so someone skimming the grid gets the point before reading a word.
// None of them is a screenshot of a real screen, and none pretends to be.

const frameClass =
  "relative h-24 overflow-hidden rounded-xl border border-black/5 bg-zinc-100/70 dark:border-white/5 dark:bg-zinc-900/60";

function Frame({ children }: { children: React.ReactNode }) {
  return <div className={frameClass}>{children}</div>;
}

// Caption inside a drawing. Small and quiet: it labels the shapes, it is not
// a second copy of the card's title.
function Caption({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[9px] font-semibold tracking-widest text-zinc-400 uppercase dark:text-zinc-600">
      {children}
    </p>
  );
}

/** Two memory bars: ours short, the heavy client's running off the edge. */
function WeightArt() {
  return (
    <Frame>
      <div className="flex h-full flex-col justify-center gap-2.5 px-4">
        <Caption>memória em uso</Caption>
        {[
          { name: "GoLive", width: "22%", fill: "bg-emerald-500" },
          // Clearly darker than the track behind it in both themes — a bar
          // you cannot see is not a comparison.
          { name: "De sempre", width: "88%", fill: "bg-zinc-400 dark:bg-zinc-500" },
        ].map(({ name, width, fill }) => (
          <div key={name} className="flex items-center gap-2">
            <span className="w-14 shrink-0 text-[10px] font-medium text-zinc-500 dark:text-zinc-400">
              {name}
            </span>
            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
              <span className={`block h-full rounded-full ${fill}`} style={{ width }} />
            </span>
          </div>
        ))}
      </div>
    </Frame>
  );
}

/** The picker's mute list, in miniature: two apps ticked out, one left in. */
function AudioPickArt() {
  const rows = [
    { name: "Spotify", out: true },
    { name: "WhatsApp", out: true },
    { name: "Jogo", out: false },
  ];
  return (
    <Frame>
      <div className="flex h-full flex-col justify-center gap-1 px-3">
        {rows.map(({ name, out }) => (
          <div
            key={name}
            className={`flex items-center gap-2 rounded-md px-2 py-1 text-[11px] ${
              out
                ? "bg-white text-zinc-700 dark:bg-zinc-950 dark:text-zinc-300"
                : "text-zinc-400 dark:text-zinc-600"
            }`}
          >
            <span
              className={`flex h-3 w-3 shrink-0 items-center justify-center rounded-[3px] border ${
                out
                  ? "border-emerald-500 bg-emerald-500 text-white"
                  : "border-zinc-300 dark:border-zinc-700"
              }`}
            >
              {out && (
                <svg viewBox="0 0 10 10" className="h-2 w-2" fill="none" aria-hidden>
                  <path
                    d="M1.5 5.2 4 7.5 8.5 2.5"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
            </span>
            <span className="flex-1 font-medium">{name}</span>
            {out && (
              <span className="text-[9px] text-emerald-600 dark:text-emerald-400">fora</span>
            )}
          </div>
        ))}
      </div>
    </Frame>
  );
}

/** One tile watched big, the rest in a grid — each with its own resolution. */
function QualityArt() {
  return (
    <Frame>
      <div className="flex h-full items-center gap-2 px-4">
        <div className="relative flex h-14 flex-1 items-end rounded-md bg-gradient-to-br from-zinc-300 to-zinc-200 p-1.5 dark:from-zinc-700 dark:to-zinc-800">
          <span className="rounded bg-black/40 px-1 text-[9px] font-semibold text-white">1080p</span>
        </div>
        <div className="grid flex-1 grid-cols-2 gap-1.5">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="flex h-[26px] items-end justify-start rounded-[4px] bg-zinc-200 p-1 dark:bg-zinc-800"
            >
              <span className="text-[8px] font-semibold text-zinc-500 dark:text-zinc-500">576p</span>
            </div>
          ))}
        </div>
      </div>
    </Frame>
  );
}

/** Sound leaving the machine, with GoLive's own audio held back. */
function EchoArt() {
  // Uneven heights and delays, so the bars read as a level meter rather than
  // a row of identical blinkers.
  const bars = [0.4, 0.75, 1, 0.55, 0.9, 0.45, 0.7, 1, 0.6, 0.35, 0.8, 0.5];
  return (
    <Frame>
      <div className="flex h-full flex-col justify-center gap-2 px-4">
        <div className="flex h-8 items-end gap-[3px]">
          {bars.map((h, i) => (
            <span
              key={i}
              className="golive-eq-bar w-1 flex-1 rounded-full bg-emerald-500/80"
              style={{ height: `${h * 100}%`, animationDelay: `${i * 90}ms` }}
            />
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <span className="rounded bg-white px-1.5 py-0.5 text-[9px] font-semibold text-zinc-500 line-through dark:bg-zinc-950 dark:text-zinc-500">
            GoLive
          </span>
          <span className="text-[9px] text-zinc-400 dark:text-zinc-600">nunca sai junto</span>
        </div>
      </div>
    </Frame>
  );
}

/** The screen chooser: two sources, one picked. */
function PickerArt() {
  return (
    <Frame>
      <div className="flex h-full flex-col justify-center gap-2 px-4">
        <div className="flex gap-1">
          <span className="rounded bg-white px-1.5 py-0.5 text-[9px] font-semibold text-zinc-700 dark:bg-zinc-950 dark:text-zinc-200">
            Telas
          </span>
          <span className="rounded px-1.5 py-0.5 text-[9px] font-medium text-zinc-400 dark:text-zinc-600">
            Janelas
          </span>
        </div>
        <div className="flex gap-2">
          <div className="h-10 flex-1 rounded-md bg-gradient-to-br from-zinc-300 to-zinc-200 ring-2 ring-emerald-500 dark:from-zinc-700 dark:to-zinc-800" />
          <div className="h-10 flex-1 rounded-md bg-zinc-200 dark:bg-zinc-800" />
        </div>
      </div>
    </Frame>
  );
}

/** The two providers, as the buttons the visitor already knows. */
function OAuthArt() {
  return (
    <Frame>
      <div className="flex h-full flex-col justify-center gap-1.5 px-4">
        <span className="flex items-center gap-2 rounded-md bg-[#5865F2] px-2.5 py-1.5 text-[10px] font-semibold text-white">
          <FaDiscord className="h-3 w-3" />
          Entrar com Discord
        </span>
        <span className="flex items-center gap-2 rounded-md bg-white px-2.5 py-1.5 text-[10px] font-semibold text-zinc-700 shadow-sm dark:bg-zinc-950 dark:text-zinc-200">
          <FcGoogle className="h-3 w-3" />
          Entrar com Google
        </span>
      </div>
    </Frame>
  );
}

/** A window of its own, instead of one tab among many. */
function WindowArt() {
  return (
    <Frame>
      <div className="flex h-full flex-col justify-center gap-2 px-4">
        {/* The tab strip it replaces, deliberately faded. */}
        <div className="flex gap-1 opacity-40">
          {[0, 1, 2, 3, 4].map((i) => (
            <span key={i} className="h-2 flex-1 rounded-t-[3px] bg-zinc-300 dark:bg-zinc-700" />
          ))}
        </div>
        <div className="overflow-hidden rounded-md border border-black/10 bg-white dark:border-white/10 dark:bg-zinc-950">
          <div className="flex items-center gap-1 border-b border-black/10 bg-zinc-100 px-2 py-1 dark:border-white/10 dark:bg-zinc-900">
            <span className="h-1.5 w-1.5 rounded-full bg-red-400" />
            <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            <span className="ml-1 text-[9px] font-medium text-zinc-500 dark:text-zinc-400">
              GoLive
            </span>
          </div>
          <div className="h-5" />
        </div>
      </div>
    </Frame>
  );
}

/** The background download, which fills the rest of the way on hover. */
function UpdateArt() {
  return (
    <Frame>
      <div className="flex h-full flex-col justify-center gap-2 px-4">
        <div className="flex items-baseline justify-between">
          <Caption>baixando</Caption>
          <span className="font-mono text-[9px] text-zinc-400 dark:text-zinc-600">
            em segundo plano
          </span>
        </div>
        <span className="h-1.5 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
          {/* Rests part-filled and completes when the card is hovered — the
              motion is the point being made, so it happens on attention
              rather than on a loop nobody asked for. */}
          <span className="block h-full w-1/3 rounded-full bg-emerald-500 transition-[width] duration-[1200ms] ease-out group-hover:w-full" />
        </span>
        <p className="text-[9px] text-zinc-400 dark:text-zinc-600">
          aplica quando você fecha a janela
        </p>
      </div>
    </Frame>
  );
}

export type FeatureArtId =
  | "weight"
  | "audio-pick"
  | "quality"
  | "echo"
  | "picker"
  | "oauth"
  | "window"
  | "update";

const ART: Record<FeatureArtId, () => React.ReactElement> = {
  weight: WeightArt,
  "audio-pick": AudioPickArt,
  quality: QualityArt,
  echo: EchoArt,
  picker: PickerArt,
  oauth: OAuthArt,
  window: WindowArt,
  update: UpdateArt,
};

export function FeatureArt({ id }: { id: FeatureArtId }) {
  const Art = ART[id];
  return <Art />;
}

// ---------------------------------------------------------------------------
// The hero's app window
// ---------------------------------------------------------------------------

/** What the big tile in the hero mock is showing: a desktop being shared. */
export function SharedScreenArt() {
  return (
    <div className="relative aspect-video overflow-hidden rounded-xl bg-gradient-to-br from-indigo-950 via-zinc-900 to-zinc-950">
      {/* A window on that desktop, with a media block and a couple of lines
          of something — enough shape to read as "a screen", abstract enough
          not to claim to be any particular program. */}
      <div className="absolute inset-x-[12%] top-[14%] bottom-[18%] rounded-lg border border-white/10 bg-white/5 backdrop-blur-[1px]">
        <div className="flex items-center gap-1 border-b border-white/10 px-2 py-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-white/30" />
          <span className="h-1.5 w-1.5 rounded-full bg-white/30" />
          <span className="h-1.5 w-1.5 rounded-full bg-white/30" />
        </div>
        <div className="flex gap-2 p-2">
          <div className="h-12 flex-[2] rounded bg-gradient-to-br from-sky-500/40 to-indigo-500/30" />
          <div className="flex flex-1 flex-col gap-1.5 pt-1">
            <span className="h-1.5 w-full rounded-full bg-white/20" />
            <span className="h-1.5 w-4/5 rounded-full bg-white/15" />
            <span className="h-1.5 w-3/5 rounded-full bg-white/10" />
          </div>
        </div>
        {/* A second row of smaller blocks, so the window has a bottom half
            instead of trailing off into empty glass. */}
        <div className="flex gap-1.5 px-2">
          {[0, 1, 2].map((i) => (
            <span key={i} className="h-4 flex-1 rounded-sm bg-white/10" />
          ))}
        </div>
      </div>
      <span className="absolute bottom-2 left-2 inline-flex items-center gap-1.5 rounded-full bg-black/50 px-2 py-0.5 text-[10px] font-semibold text-white">
        <span className="golive-live-dot h-1.5 w-1.5 rounded-full bg-red-500" />
        ao vivo
      </span>
    </div>
  );
}

/**
 * A participant tile: a camera-ish gradient with the person's initial, and a
 * level meter on whoever is talking. Initials rather than faces on purpose —
 * a stock portrait in a product mock is a stranger's face pretending to be a
 * user.
 */
export function ParticipantArt({
  name,
  gradient,
  speaking = false,
}: {
  name: string;
  gradient: string;
  speaking?: boolean;
}) {
  return (
    <div
      className={`relative flex aspect-video items-center justify-center overflow-hidden rounded-lg bg-gradient-to-br ${gradient} ${
        speaking ? "ring-2 ring-emerald-400" : ""
      }`}
    >
      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white/20 text-[11px] font-semibold text-white">
        {name.slice(0, 1)}
      </span>
      <span className="absolute bottom-1 left-1.5 text-[10px] font-medium text-white/90">
        {name}
      </span>
      {speaking && (
        <span className="absolute right-1.5 bottom-1.5 flex h-3 items-end gap-[2px]">
          {[0.5, 1, 0.7].map((h, i) => (
            <span
              key={i}
              className="golive-eq-bar w-[3px] rounded-full bg-emerald-300"
              style={{ height: `${h * 100}%`, animationDelay: `${i * 140}ms` }}
            />
          ))}
        </span>
      )}
    </div>
  );
}
