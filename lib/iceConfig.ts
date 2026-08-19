const STUN_URL = "stun:stun.l.google.com:19302";
const TURN_URLS = (process.env.NEXT_PUBLIC_TURN_URLS || "")
  .split(",")
  .map((url) => url.trim())
  .filter(Boolean);
const TURN_USERNAME = process.env.NEXT_PUBLIC_TURN_USERNAME || "";
const TURN_CREDENTIAL = process.env.NEXT_PUBLIC_TURN_CREDENTIAL || "";

export const ICE_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: STUN_URL },
    ...(TURN_URLS.length > 0
      ? [{ urls: TURN_URLS, username: TURN_USERNAME, credential: TURN_CREDENTIAL }]
      : []),
  ],
};

// Safe to expose in the development-only diagnostics UI: endpoints are
// useful when debugging ICE, while TURN credentials and SDP are not.
export const ICE_SERVER_DIAGNOSTICS = {
  stun: [STUN_URL],
  turn: TURN_URLS,
};
