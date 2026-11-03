// What a viewer would rather not decode.
//
// A share can go out in AV1 (see lib/videoCodecPreferences), and hardly anyone has that
// in hardware: on a Ryzen 5 3500 one tile costs a third of a core at 1080p30, where H264
// in software costs .07 and in hardware nothing. A desktop with cores to spare can pay
// that; it was paying the same for VP9. A phone or a dual-core laptop is another matter,
// so unless they have the hardware for it they answer without AV1 and the sender stays
// on what they do have.

import { isMobileDevice } from "./announcement";

const SHARP_CODEC = "video/AV1";
// Up to this many logical cores, a software decode per tile is real money.
const WEAK_CORES = 4;

let costly: Promise<boolean> | null = null;

function av1IsCostly(): Promise<boolean> {
  costly ??= (async () => {
    if (!isMobileDevice() && (navigator.hardwareConcurrency || WEAK_CORES) > WEAK_CORES) return false;
    try {
      const info = await navigator.mediaCapabilities.decodingInfo({
        type: "webrtc",
        video: { contentType: SHARP_CODEC, width: 1920, height: 1080, bitrate: 6_000_000, framerate: 30 },
      });
      return !info.powerEfficient;
    } catch {
      return true;
    }
  })();
  return costly;
}

/** Call between the offer and the answer. */
export async function declineCostlyCodecs(pc: RTCPeerConnection) {
  if (typeof RTCRtpReceiver === "undefined" || typeof RTCRtpReceiver.getCapabilities !== "function") return;
  const transceiver = pc.getTransceivers().find((t) => t.receiver.track.kind === "video");
  if (!transceiver || !(await av1IsCostly())) return;
  const codecs = RTCRtpReceiver.getCapabilities("video")?.codecs ?? [];
  try {
    transceiver.setCodecPreferences(codecs.filter((c) => c.mimeType !== SHARP_CODEC));
  } catch {
    // Ignored - some older browser versions reject the call entirely.
  }
}
