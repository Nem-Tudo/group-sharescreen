// Experiment "sq-new-send": the way into the send path of lib/sendAdaptation.
//
// Everybody sends the way they did before: the profile's own degradation preference
// left to WebRTC's quality scaler, the first codec by profile and experiment screen-codec
// (see lib/screenCodec), and every viewer encoded for all the time. This feature, at 0%
// unless somebody turns it up, puts a
// share on the new way of sending: maintain-resolution with our own recoverable
// adapters, encoders stopped for viewers who are not looking, and a codec per
// connection (see lib/videoCodecPreferences).
//
// That makes two things possible without a deploy: bringing the change in little by
// little or rolling it back, and comparing the two side by side in
// connection_quality_reports, where the group shows up in `experiments` as
// "sq-new-send=on".

export const NEW_SEND_FEATURE = "sq-new-send";

// Until the feature says otherwise: nobody is on the new path without being in it.
let classic = true;
const listeners = new Set<() => void>();

export function setClassicSend(value: boolean) {
  if (classic === value) return;
  classic = value;
  listeners.forEach((listener) => listener());
}

export function isClassicSend(): boolean {
  return classic;
}

export function onClassicSendChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
