// Experiment "sq-classic-send": the way out of the send path of lib/sendAdaptation.
//
// Everybody gets the new way of sending: maintain-resolution with our own
// recoverable adapters, encoders stopped for viewers who are not looking, and a codec
// per connection (see lib/videoCodecPreferences). This feature, at 0% unless somebody
// turns it up, puts a share back on what most of them did before: the profile's own
// degradation preference left to WebRTC's quality scaler, VP9 first except for
// "motion", and every viewer encoded for all the time.
//
// That makes two things possible without a deploy: rolling the change back, and
// comparing the two side by side in connection_quality_reports, where the group
// shows up in `experiments` as "sq-classic-send=on".

export const CLASSIC_SEND_FEATURE = "sq-classic-send";

let classic = false;
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
