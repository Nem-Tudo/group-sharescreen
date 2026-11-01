// Experiment "stereo-audio": the audio of a share (system/tab audio, a file
// being played) arrives in stereo instead of folded down to mono.
//
// The capture was already stereo all the way to the sender — what flattened
// it is Opus in WebRTC, which encodes mono unless the *other* side's SDP says
// `stereo=1`. Nothing here said it, so every share went out as one channel.
//
// The sharer decides: its offer asks for stereo (stereo=1;sprop-stereo=1)
// on every channel but the microphone, which is one voice and would only
// spend twice the bits on two identical channels. The viewer, whatever its
// own side of the experiment, mirrors that in its answer — the answer is
// what the sender's encoder is configured from. A viewer without this code
// answers as before and simply keeps getting mono.

export const STEREO_AUDIO_FEATURE = "stereo-audio";
/** Counted on both sides, so the two can be compared on shares that carried audio. */
export const STEREO_AUDIO_SHARE_EVENT = "share_audio_start";

let enabled = false;
// "Microfone estéreo" (experiment "stereo-mic"): the one case the mic asks
// for stereo too — the capture is two channels then (see rnnoise.ts).
let micStereo = false;

/** Set from useRoomMedia, which is where the experiment is read. */
export function setStereoAudioEnabled(value: boolean) {
  enabled = value;
}

/** Set from useRoomMedia along with restarting the mic, so new offers go out. */
export function setMicStereoEnabled(value: boolean) {
  micStereo = value;
}

const STEREO_PARAMS = ["stereo=1", "sprop-stereo=1"];

function opusPayloadTypes(lines: string[]): string[] {
  const types: string[] = [];
  for (const line of lines) {
    const match = /^a=rtpmap:(\d+) opus\/48000/i.exec(line);
    if (match) types.push(match[1]);
  }
  return types;
}

/** The SDP with every Opus payload marked stereo, sending and receiving. */
export function withStereoOpus(sdp: string): string {
  const lines = sdp.split("\r\n");
  for (const pt of opusPayloadTypes(lines)) {
    const fmtp = lines.findIndex((line) => line.startsWith(`a=fmtp:${pt} `));
    if (fmtp === -1) {
      const rtpmap = lines.findIndex((line) => line.startsWith(`a=rtpmap:${pt} `));
      lines.splice(rtpmap + 1, 0, `a=fmtp:${pt} ${STEREO_PARAMS.join(";")}`);
      continue;
    }
    const params = lines[fmtp]
      .slice(`a=fmtp:${pt} `.length)
      .split(";")
      .map((param) => param.trim())
      .filter((param) => param && !/^(sprop-)?stereo=/i.test(param));
    lines[fmtp] = `a=fmtp:${pt} ${[...params, ...STEREO_PARAMS].join(";")}`;
  }
  return lines.join("\r\n");
}

function asksForStereo(sdp: string): boolean {
  const lines = sdp.split("\r\n");
  return opusPayloadTypes(lines).some((pt) =>
    lines.some((line) => line.startsWith(`a=fmtp:${pt} `) && /[; ]stereo=1/i.test(line))
  );
}

/**
 * The offer as it goes out on `channel`: asking for stereo when this person
 * is in the experiment and the channel is not the microphone — or it is, and
 * "Microfone estéreo" is on. Only what is sent changes — the local
 * description stays the browser's own.
 */
export function offerToSend(
  description: RTCSessionDescription | null,
  channel: string
): RTCSessionDescriptionInit | null {
  const stereo = channel === "mic" ? micStereo : enabled;
  if (!description?.sdp || !stereo) return description;
  return { type: description.type, sdp: withStereoOpus(description.sdp) };
}

/** The answer to set locally: stereo exactly when the offer asked for it. */
export function answerMirroringStereo(
  offer: RTCSessionDescriptionInit | undefined,
  answer: RTCSessionDescriptionInit
): RTCSessionDescriptionInit {
  if (!offer?.sdp || !answer.sdp || !asksForStereo(offer.sdp)) return answer;
  return { type: answer.type, sdp: withStereoOpus(answer.sdp) };
}

/**
 * A relay's offer to its children: stereo when the offer it is being fed
 * by asked for it — the sharer's choice, carried down the tree, not the
 * relay's own side of the experiment.
 */
export function relayOfferToSend(
  description: RTCSessionDescription | null,
  upstream: RTCSessionDescription | null
): RTCSessionDescriptionInit | null {
  if (!description?.sdp || !upstream?.sdp || !asksForStereo(upstream.sdp)) return description;
  return { type: description.type, sdp: withStereoOpus(description.sdp) };
}
