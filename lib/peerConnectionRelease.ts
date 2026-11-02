// Closing a peer connection for good.
//
// Chromium and Firefox keep a closed RTCPeerConnection's native objects, jitter
// buffers and closures alive for as long as its event handlers stay attached,
// and in a long call with people coming and going those add up. Dropping the
// handlers before closing breaks the cycle; it also makes sure nothing of ours
// runs on behalf of a connection that no longer exists.

export function releasePeerConnection(pc: RTCPeerConnection, cleanups?: Array<(() => void) | undefined>) {
  for (const cleanup of cleanups ?? []) {
    try {
      cleanup?.();
    } catch {
      // One failing cleanup must not stop the connection being closed.
    }
  }
  pc.onicecandidate = null;
  pc.onconnectionstatechange = null;
  pc.ontrack = null;
  pc.oniceconnectionstatechange = null;
  pc.onnegotiationneeded = null;
  pc.onsignalingstatechange = null;
  try {
    pc.close();
  } catch {
    // Already closed.
  }
}
