// Who, besides a tile on screen, is using a received stream right now.
//
// A viewer who is not looking at a transmission stops receiving it (see
// qualityNegotiation's idle request). "Not looking" is not the whole question,
// though: a clip buffer with the page minimised, a recording of a tile scrolled
// out of view, or the room recorder all need the frames to keep coming. Each of
// them retains the stream for as long as it uses it, and the negotiator asks
// here before giving a stream up.

const retained = new Map<MediaStream, number>();
const listeners = new Set<() => void>();

/** Marks `stream` as in use until the returned function is called. */
export function retainStream(stream: MediaStream): () => void {
  retained.set(stream, (retained.get(stream) ?? 0) + 1);
  listeners.forEach((listener) => listener());
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const left = (retained.get(stream) ?? 1) - 1;
    if (left > 0) retained.set(stream, left);
    else retained.delete(stream);
    listeners.forEach((listener) => listener());
  };
}

export function isStreamRetained(stream: MediaStream | null | undefined): boolean {
  return Boolean(stream && retained.has(stream));
}

/** Called whenever a stream starts or stops being retained. */
export function onStreamUseChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
