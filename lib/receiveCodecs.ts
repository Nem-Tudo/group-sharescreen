// What a viewer would rather not decode.
//
// A share can go out in AV1 (see lib/videoCodecPreferences), and hardly anyone has that
// in hardware: on a Ryzen 5 3500 one tile costs a third of a core at 1080p30, where H264
// in software costs .07 and in hardware nothing. A desktop with cores to spare can pay
// that; it was paying the same for VP9. A phone or a dual-core laptop is another matter,
// so unless they have the hardware for it they answer without AV1 and the sender stays
// on what they do have.

import { isMobileDevice } from "./announcement";
import { trackFeatureEvent } from "./features";

const SHARP_CODEC = "video/AV1";
// Up to this many logical cores, a software decode per tile is real money.
const WEAK_CORES = 4;

// Experiment "sq-av1-hw-only": every machine, not only the weak ones, answers without
// AV1 unless it decodes it in hardware. "Cores to spare" was a guess about the viewer
// made on the viewer's behalf, and a third of a core per tile is spent on every tile
// watched, for the whole call, on a machine that may be running a game too — the cost
// nobody on the sending side sees. What it trades away is AV1's sharper picture on a
// short link, which is why it is an experiment: the receive reports carry it in
// `experiments` as "sq-av1-hw-only=on", next to their decode drops and frame rate.
export const AV1_HW_ONLY_FEATURE = "sq-av1-hw-only";

export const AV1_HW_ONLY_EVENTS = {
  /** Once per page, in both groups: this machine has no AV1 decoder in hardware. */
  noHardware: "sq_av1_no_hw",
  /** A connection answered without AV1 because of the experiment. */
  declined: "sq_av1_declined",
} as const;

let hwOnly = false;

/** Set from the room (see useRoomMedia), like the send experiments. */
export function setAv1HwOnly(value: boolean) {
  hwOnly = value;
}

export function isAv1HwOnly(): boolean {
  return hwOnly;
}

let hardware: Promise<boolean> | null = null;

// Whether this machine decodes AV1 in hardware, as the browser answers it.
function av1InHardware(): Promise<boolean> {
  hardware ??= (async () => {
    try {
      const info = await navigator.mediaCapabilities.decodingInfo({
        type: "webrtc",
        video: { contentType: SHARP_CODEC, width: 1920, height: 1080, bitrate: 6_000_000, framerate: 30 },
      });
      return info.supported && info.powerEfficient;
    } catch {
      return false;
    }
  })();
  return hardware;
}

function weakMachine(): boolean {
  return isMobileDevice() || (navigator.hardwareConcurrency || WEAK_CORES) <= WEAK_CORES;
}

let reportedNoHardware = false;

/** Call between the offer and the answer. */
export async function declineCostlyCodecs(pc: RTCPeerConnection) {
  if (typeof RTCRtpReceiver === "undefined" || typeof RTCRtpReceiver.getCapabilities !== "function") return;
  const transceiver = pc.getTransceivers().find((t) => t.receiver.track.kind === "video");
  if (!transceiver) return;
  const inHardware = await av1InHardware();
  if (!inHardware && !reportedNoHardware) {
    reportedNoHardware = true;
    trackFeatureEvent(AV1_HW_ONLY_EVENTS.noHardware, { feature: AV1_HW_ONLY_FEATURE });
  }
  if (inHardware) return;
  const weak = weakMachine();
  if (!weak && !hwOnly) return;
  if (!weak) trackFeatureEvent(AV1_HW_ONLY_EVENTS.declined, { feature: AV1_HW_ONLY_FEATURE });
  const codecs = RTCRtpReceiver.getCapabilities("video")?.codecs ?? [];
  try {
    transceiver.setCodecPreferences(codecs.filter((c) => c.mimeType !== SHARP_CODEC));
  } catch {
    // Ignored - some older browser versions reject the call entirely.
  }
}
