"use client";

import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { MdClose, MdMovie, MdScreenShare, MdVideocam } from "react-icons/md";
import { PipIcon } from "@/components/icons";
import { Tooltip } from "@/components/Tooltip";
import { callPathFor, useCallSession } from "@/lib/callSession";
import { useGroupNavigation } from "@/lib/groupNavigation";
import { qualityNegotiator, type QualityChannel } from "@/lib/qualityNegotiation";
import { speakingDetector } from "@/lib/speakingDetector";
import { useT } from "@/lib/useI18n";

// A transmission of the call in the bottom-left corner, while somebody reads
// another page — the room docked (see components/RoomCallHost) is connected and
// audible but a pixel wide, so without this the picture is simply gone.
//
// Bottom right, and draggable anywhere else on the screen.
//
// A box of the page's own rather than the browser's picture-in-picture: that
// one needs a click to open, and this opens by itself the moment the room
// leaves the screen. The button in the corner still hands it to the browser's,
// for somebody who wants it outside the tab.
//
// It plays streams the call is already receiving — nothing is connected on its
// behalf — muted, since the room's own tiles are still what carries the sound.

/** One transmission it could show. Built by the room, which knows them all. */
export interface DockedPipSource {
  /** The room's tile id — what "Focar" and "Hiperfoco" name. */
  id: string;
  stream: MediaStream;
  label: ReactNode;
  /**
   * Whose it is: a peer connection id, or null for this viewer's own — which
   * is also what puts it last.
   */
  peerId: string | null;
  /** Their microphone, for telling who is speaking. */
  micStream: MediaStream | null;
  /** Which channel it arrives on, to ask for a picture the size of this box. Remote only. */
  channel?: QualityChannel;
}

// How far a press has to travel before it is a drag rather than a click.
const DRAG_THRESHOLD_PX = 5;
// The least gap kept between the box and the edges of the window while it is
// dragged or resized. It opens further in than this (3rem from its corner),
// but can be taken closer to the edge than it starts.
const EDGE_GAP_PX = 16;

// Where the box was last dragged to, for as long as the tab is open: every
// time the room leaves the screen it opens a new box, and moving it out of the
// way once should be enough.
let savedOffset = { x: 0, y: 0 };
// And the width it was last resized to — null until somebody does.
let savedWidth: number | null = null;

const MIN_WIDTH_PX = 192;
const MAX_WIDTH_PX = 960;

function defaultWidth(): number {
  // Phones get a box that still leaves most of the page readable.
  return typeof window !== "undefined" && window.innerWidth < 640 ? 256 : 384;
}

/**
 * The offset that moves a box at `rect` (drawn at `offset`) by `dx`/`dy`, as
 * far as it can go without coming closer than EDGE_GAP_PX to any edge.
 */
function clampOffset(
  offset: { x: number; y: number },
  rect: { left: number; top: number; right: number; bottom: number },
  dx: number,
  dy: number
): { x: number; y: number } {
  const minDx = EDGE_GAP_PX - rect.left;
  const maxDx = window.innerWidth - EDGE_GAP_PX - rect.right;
  const minDy = EDGE_GAP_PX - rect.top;
  const maxDy = window.innerHeight - EDGE_GAP_PX - rect.bottom;
  return {
    x: offset.x + Math.min(Math.max(dx, minDx), Math.max(minDx, maxDx)),
    y: offset.y + Math.min(Math.max(dy, minDy), Math.max(minDy, maxDy)),
  };
}

/**
 * Which of `sources` to show, in order: what the room has focused or
 * hyperfocused; whoever spoke last, and on until somebody else does; anybody
 * else's; this viewer's own. `sources` is expected in the room's own order of
 * preference for a person's several tiles (screen, file, camera), so the first
 * match for a person is the one worth showing.
 */
// The kind half of a room tile id (see WatchRoom's tileId), as a sort order.
function kindRank(id: string): number {
  if (id.startsWith("screen:")) return 0;
  if (id.startsWith("file:")) return 1;
  return 2;
}

function KindIcon({ id, className }: { id: string; className: string }) {
  if (id.startsWith("screen:")) return <MdScreenShare className={className} />;
  if (id.startsWith("file:")) return <MdMovie className={className} />;
  return <MdVideocam className={className} />;
}

function pickSource(
  sources: DockedPipSource[],
  focusedId: string | null,
  lastSpeakerPeerId: string | null
): DockedPipSource | null {
  return (
    (focusedId ? sources.find((s) => s.id === focusedId) : undefined) ??
    (lastSpeakerPeerId ? sources.find((s) => s.peerId === lastSpeakerPeerId) : undefined) ??
    sources.find((s) => s.peerId !== null) ??
    sources[0] ??
    null
  );
}

/**
 * The peer who most recently started speaking, among those with something to
 * show. Sticky on purpose: a pause for breath is not a reason to cut away, only
 * somebody else starting to talk is.
 */
function useLastSpeaker(sources: DockedPipSource[]): string | null {
  const [lastSpeaker, setLastSpeaker] = useState<string | null>(null);
  const mics = new Map<string, MediaStream>();
  for (const s of sources) if (s.peerId && s.micStream) mics.set(s.peerId, s.micStream);
  // What the subscriptions depend on, as a string, so a new array from the
  // room's every render does not resubscribe every detector entry.
  const micsKey = [...mics].map(([peerId, mic]) => `${peerId}:${mic.id}`).join("|");
  useEffect(() => {
    const releases = [...mics].map(([peerId, mic]) => {
      let speaking = speakingDetector.isSpeaking(mic.id);
      // Already mid-sentence when the box opened: that counts as starting.
      if (speaking) queueMicrotask(() => setLastSpeaker(peerId));
      return speakingDetector.acquire(mic, () => {
        const now = speakingDetector.isSpeaking(mic.id);
        if (now && !speaking) setLastSpeaker(peerId);
        speaking = now;
      });
    });
    return () => releases.forEach((release) => release());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [micsKey]);
  return lastSpeaker;
}

export function DockedPip({
  sources,
  focusedId,
  onOpen,
}: {
  sources: DockedPipSource[];
  focusedId: string | null;
  /** Going back to the call from the picture: the room puts that transmission in focus. */
  onOpen: (sourceId: string) => void;
}) {
  const t = useT();
  const session = useCallSession();
  const navigation = useGroupNavigation();
  const videoRef = useRef<HTMLVideoElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  // Dragged around by the picture, as an offset from its corner. Remembered for
  // the tab (see savedOffset), so the box opens again where it was left.
  const [offset, setOffset] = useState(() => savedOffset);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    startOffset: { x: number; y: number };
    startRect: DOMRect;
    moved: boolean;
  } | null>(null);
  // A drag ends in a click on the video, which would take somebody back to
  // the call they were only moving out of the way.
  const suppressClickRef = useRef(false);

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (e.button !== 0 || (e.target as HTMLElement).closest("button, [data-pip-list]")) return;
    const box = boxRef.current;
    if (!box) return;
    // With the pointer captured, a drag's click may land on the box rather
    // than the video and never clear the flag — so every new press does.
    suppressClickRef.current = false;
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      startOffset: offset,
      startRect: box.getBoundingClientRect(),
      moved: false,
    };
  }

  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (!drag.moved) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      drag.moved = true;
      boxRef.current?.setPointerCapture(e.pointerId);
    }
    setOffset(clampOffset(drag.startOffset, drag.startRect, dx, dy));
  }

  function onPointerUp(e: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    dragRef.current = null;
    if (drag.moved) suppressClickRef.current = true;
  }

  // Its width, from the handle in the top-left corner; the height follows at
  // 16:9. The corner it is anchored to stays put, so it grows up and to the
  // left, towards the handle. Remembered for the tab like the position.
  const [width, setWidth] = useState(() => savedWidth ?? defaultWidth());
  const widthRef = useRef(width);
  const resizeRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    startWidth: number;
    startRect: DOMRect;
  } | null>(null);

  function onResizeDown(e: PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    const box = boxRef.current;
    if (!box) return;
    // The box's own drag must not start under it.
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    resizeRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      startWidth: width,
      startRect: box.getBoundingClientRect(),
    };
  }

  function onResizeMove(e: PointerEvent<HTMLDivElement>) {
    const resize = resizeRef.current;
    if (!resize || resize.pointerId !== e.pointerId) return;
    e.stopPropagation();
    // Whichever way the pointer went further, measured in width.
    const grow = Math.max(resize.startX - e.clientX, ((resize.startY - e.clientY) * 16) / 9);
    // No bigger than the room there is above and to the left of the anchored
    // corner, keeping the same gap from the edges the drag keeps.
    const max = Math.min(
      MAX_WIDTH_PX,
      resize.startRect.right - EDGE_GAP_PX,
      ((resize.startRect.bottom - EDGE_GAP_PX) * 16) / 9
    );
    setWidth(Math.round(Math.max(MIN_WIDTH_PX, Math.min(resize.startWidth + grow, max))));
  }

  function onResizeUp(e: PointerEvent<HTMLDivElement>) {
    if (resizeRef.current?.pointerId !== e.pointerId) return;
    e.stopPropagation();
    resizeRef.current = null;
  }

  useEffect(() => {
    savedOffset = offset;
  }, [offset]);
  useEffect(() => {
    savedWidth = width;
    widthRef.current = width;
  }, [width]);

  // A window made smaller (or a phone turned round) must not strand the box
  // off screen: shrunk to fit if it has to be, then pulled back inside, by as
  // little as it takes.
  useEffect(() => {
    function onResize() {
      const box = boxRef.current;
      if (!box) return;
      const rect = box.getBoundingClientRect();
      const current = widthRef.current;
      const fitted = Math.max(
        MIN_WIDTH_PX,
        Math.min(
          current,
          window.innerWidth - 2 * EDGE_GAP_PX,
          ((window.innerHeight - 2 * EDGE_GAP_PX) * 16) / 9
        )
      );
      // Shrinking gives way on the top and left, the sides away from the anchor.
      const shrunk = current - fitted;
      const fittedRect = {
        left: rect.left + shrunk,
        top: rect.top + (shrunk * 9) / 16,
        right: rect.right,
        bottom: rect.bottom,
      };
      if (fitted !== current) setWidth(Math.round(fitted));
      setOffset((offsetNow) => clampOffset(offsetNow, fittedRect, 0, 0));
    }
    // Also once on opening: the spot remembered from a bigger window may not
    // fit this one. A frame later, so the box has been laid out to measure.
    const frame = requestAnimationFrame(onResize);
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", onResize);
    };
  }, []);
  // Closed with the ×, for as long as the room stays off screen. The box is
  // unmounted whenever the room is shown again, so the next page opens it anew.
  const [dismissed, setDismissed] = useState(false);
  const [nativePip, setNativePip] = useState(false);
  const lastSpeaker = useLastSpeaker(sources);
  // Picked by hand from the list along the bottom. Wins over every automatic
  // rule for as long as that transmission exists; once it ends, the automatic
  // choice takes over again.
  const [pickedId, setPickedId] = useState<string | null>(null);
  const picked = pickedId ? sources.find((s) => s.id === pickedId) : undefined;
  const source = dismissed ? null : (picked ?? pickSource(sources, focusedId, lastSpeaker));
  // The list itself: screens first, the way a person's tiles are preferred
  // everywhere else, and then everything else going out.
  const listed = [...sources].sort((a, b) => kindRank(a.id) - kindRank(b.id));
  const stream = source?.stream ?? null;

  useEffect(() => {
    const video = videoRef.current;
    if (video && video.srcObject !== stream) video.srcObject = stream;
  }, [stream]);

  // The room's tile for this transmission is in the parked room and so reports
  // itself hidden, which asks the sender for their smallest picture. This box
  // is on screen, so it asks for its own size instead — and gives the request
  // back when it stops showing that transmission.
  const channel = source?.channel;
  const peerId = source?.peerId ?? null;
  // Set by the first cleanup to run on unmount (cleanups run in declaration
  // order), for the one below: unmounting means the room is back on screen,
  // and its tiles say for themselves whether they are seen — walking the
  // request back here could leave a visible tile asking for the smallest
  // picture.
  const unmountingRef = useRef(false);
  useEffect(() => {
    unmountingRef.current = false;
    return () => {
      unmountingRef.current = true;
    };
  }, []);
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !channel || !peerId) return;
    qualityNegotiator.setHidden(channel, peerId, false);
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (box) qualityNegotiator.report(channel, peerId, Math.round(box.width), Math.round(box.height));
    });
    observer.observe(video);
    return () => {
      observer.disconnect();
      if (!unmountingRef.current) qualityNegotiator.setHidden(channel, peerId, true);
    };
  }, [channel, peerId, nativePip]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onEnter = () => setNativePip(true);
    const onLeave = () => setNativePip(false);
    video.addEventListener("enterpictureinpicture", onEnter);
    video.addEventListener("leavepictureinpicture", onLeave);
    return () => {
      video.removeEventListener("enterpictureinpicture", onEnter);
      video.removeEventListener("leavepictureinpicture", onLeave);
      // Back in the room: the browser's window was this box's, and the room's
      // own tiles are what is showing now.
      if (document.pictureInPictureElement === video) void document.exitPictureInPicture().catch(() => {});
    };
  }, []);

  if (typeof document === "undefined") return null;

  const hidden = !source || nativePip;
  const nativePipSupported = Boolean(document.pictureInPictureEnabled);

  return createPortal(
    <div
      ref={boxRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      // The opposite corner from the call bar (see RoomCallHost's CallDock),
      // on the same layer, and clear of the phone's tab bar. Moved from there
      // by a transform, so dragging never touches layout. `touch-action: none`
      // is what lets a finger drag it instead of scrolling the page under it.
      style={{
        transform: `translate(${offset.x}px, ${offset.y}px)`,
        width,
        maxWidth: `calc(100vw - ${2 * EDGE_GAP_PX}px)`,
        touchAction: "none",
      }}
      className={`group fixed bottom-[calc(var(--app-tabbar-h)+3rem)] right-12 z-[60] cursor-grab select-none overflow-hidden rounded-xl border border-white/10 bg-black shadow-2xl transition-opacity active:cursor-grabbing ${
        hidden ? "pointer-events-none opacity-0" : "opacity-100"
      }`}
      aria-hidden={hidden || undefined}
    >
      {/* Kept mounted even with nothing to show, so a browser picture-in-picture
          opened from it survives the source changing underneath. */}
      <div className="relative aspect-video">
        {/* The resize handle: the corner opposite the anchored one, which is
            the corner that moves. Shown on hover like the buttons, and always
            on a touchscreen, which has no hover to reveal it with. */}
        <div
          onPointerDown={onResizeDown}
          onPointerMove={onResizeMove}
          onPointerUp={onResizeUp}
          onPointerCancel={onResizeUp}
          aria-hidden
          className="absolute left-0 top-0 z-10 h-6 w-6 cursor-nwse-resize transition-opacity [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100"
        >
          <span className="absolute left-1 top-1 h-2.5 w-2.5 rounded-tl-sm border-l-2 border-t-2 border-white/80" />
        </div>
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          onClick={() => {
            if (suppressClickRef.current) {
              suppressClickRef.current = false;
              return;
            }
            if (!session) return;
            // Whatever was being watched here is what the room opens on.
            if (source) onOpen(source.id);
            navigation.push(callPathFor(session));
          }}
          title={t("common.backToTheCall")}
          // A drag started on the picture must not turn into the browser
          // dragging the video element out as a file.
          draggable={false}
          className="h-full w-full object-contain"
        />
        {/* Whose it is — until the pointer is over the box, when the list
            below takes its place and says the same thing among the rest. */}
        <div
          className={`pointer-events-none absolute inset-x-0 bottom-0 truncate bg-linear-to-t from-black/85 to-transparent px-2 py-1 text-xs font-medium text-white transition-opacity ${
            listed.length > 1 ? "[@media(hover:hover)]:group-hover:opacity-0" : ""
          }`}
        >
          {source?.label}
        </div>
        {/* Everything going out in the call, to switch the picture to by hand.
            Only when there is something to switch to. Revealed on hover like
            the buttons; a touchscreen has no hover, so it gets the label above
            instead and switching stays with the room itself. Scrolls sideways
            when it does not fit, which is why a finger gets pan-x back here
            from the box's touch-action. */}
        {listed.length > 1 && (
          <div
            data-pip-list
            style={{ touchAction: "pan-x" }}
            className="absolute inset-x-0 bottom-0 hidden gap-1 overflow-x-auto bg-linear-to-t from-black/90 via-black/70 to-transparent px-1.5 pb-1.5 pt-4 opacity-0 transition-opacity [@media(hover:hover)]:flex [@media(hover:hover)]:group-hover:opacity-100"
          >
            {listed.map((s) => {
              const current = s.id === source?.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setPickedId(s.id)}
                  aria-pressed={current}
                  className={`flex max-w-[10rem] shrink-0 cursor-pointer items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium text-white transition ${
                    current ? "bg-emerald-600 hover:bg-emerald-700" : "bg-white/15 hover:bg-white/25"
                  }`}
                >
                  <KindIcon id={s.id} className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{s.label}</span>
                </button>
              );
            })}
          </div>
        )}
        <div className="absolute right-1 top-1 flex gap-1 transition-opacity [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100">
          {nativePipSupported && (
            <Tooltip content={t("videoTile.pictureInPicture")}>
              <button
                type="button"
                onClick={() => void videoRef.current?.requestPictureInPicture().catch(() => {})}
                aria-label={t("videoTile.pictureInPicture")}
                className="cursor-pointer rounded-full bg-black/60 p-1.5 text-white hover:bg-black/80"
              >
                <PipIcon className="h-4 w-4" />
              </button>
            </Tooltip>
          )}
          <Tooltip content={t("common.close")}>
            <button
              type="button"
              onClick={() => setDismissed(true)}
              aria-label={t("common.close")}
              className="cursor-pointer rounded-full bg-black/60 p-1.5 text-white hover:bg-black/80"
            >
              <MdClose className="h-4 w-4" />
            </button>
          </Tooltip>
        </div>
      </div>
    </div>,
    document.body
  );
}
