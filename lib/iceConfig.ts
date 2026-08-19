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
