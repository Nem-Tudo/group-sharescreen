// Which build of the site this browser is running.
//
// `<versão do package>-<commit>`, e.g. "0.1.17-e6681e8" — resolved once at
// build time by next.config.ts (see the reasoning for both halves there) and
// inlined into the bundle, so it describes the code the browser actually
// downloaded rather than whatever the server is running now. That difference
// is the entire point: what this exists to measure is people still on the
// *previous* bundle after a deploy, held there by a service worker, a cached
// page, or a tab nobody has reloaded in two days.
//
// Sent to the signaling server on register and counted there as
// sharescreen_clients_by_version (see the API's server/metrics.ts). Nothing
// in the app behaves differently because of it — it is a label, not a
// feature flag.
//
// Written as a full `process.env.X` reference on purpose: Next replaces that
// exact expression textually, so destructuring or aliasing it would leave an
// undefined lookup at runtime.
export const BUILD_VERSION = process.env.NEXT_PUBLIC_BUILD_VERSION || "unknown";
