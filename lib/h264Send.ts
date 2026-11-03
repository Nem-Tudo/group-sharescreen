// Experiment "sq-h264-send": every share in H264, with no connection in the costly
// codec (see lib/videoCodecPreferences). At 0% unless somebody turns it up.
//
// That makes two things possible without a deploy: giving up AV1 if it turns out badly
// on machines the lab never saw, and comparing the two side by side in
// connection_quality_reports, where the group shows up in `experiments` as
// "sq-h264-send=on".

export const H264_SEND_FEATURE = "sq-h264-send";

let h264Only = false;
const listeners = new Set<() => void>();

export function setH264Send(value: boolean) {
  if (h264Only === value) return;
  h264Only = value;
  listeners.forEach((listener) => listener());
}

export function isH264Send(): boolean {
  return h264Only;
}

export function onH264SendChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
