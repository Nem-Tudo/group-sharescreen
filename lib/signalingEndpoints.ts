const CONFIGURED_SIGNALING_URL = process.env.NEXT_PUBLIC_SIGNALING_URL?.trim();

function normalizeWebSocketUrl(url: string): string {
  return url.endsWith("/ws") || url.endsWith("/ws/")
    ? url.replace(/\/$/, "")
    : `${url.replace(/\/$/, "")}/ws`;
}

export function getSignalingWebSocketUrl(): string {
  if (CONFIGURED_SIGNALING_URL) return normalizeWebSocketUrl(CONFIGURED_SIGNALING_URL);

  if (typeof window !== "undefined") {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${window.location.host}/ws`;
  }

  return "ws://localhost:4000/ws";
}

export function getSignalingHttpBase(): string {
  if (CONFIGURED_SIGNALING_URL) {
    return normalizeWebSocketUrl(CONFIGURED_SIGNALING_URL)
      .replace(/^wss:/, "https:")
      .replace(/^ws:/, "http:")
      .replace(/\/ws$/, "");
  }

  if (typeof window !== "undefined") return `${window.location.origin}/signaling`;
  return "http://localhost:4000";
}
