// The frame clock of "Gravar chamada" (see lib/callRecording.ts). A timer in
// the page is throttled to once a second — or once a minute — when the tab is
// in the background, which is exactly when a recording of a call tends to be
// left running. A worker's timer is not.
let timer = null;
self.onmessage = (event) => {
  if (timer) clearInterval(timer);
  timer = null;
  const fps = event.data && event.data.fps;
  if (fps) timer = setInterval(() => self.postMessage(0), 1000 / fps);
};
