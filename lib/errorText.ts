import { translate } from "@/lib/i18n";

// A fetch that never got an answer — no network, the API down or restarting,
// a firewall, antivirus or DNS filter in the way, an upload the server cut off
// halfway — rejects with a TypeError worded by the browser itself, in English,
// and differently in each engine. Shown as it is, that was "Failed to fetch"
// in red under a Portuguese form (tickets 1404, 1450), which tells nobody
// whether to retry, fix their connection or give up.
const NETWORK_FAILURE = /failed to fetch|networkerror when attempting|load failed|network request failed/i;

/** Whether `err` is a request that never reached the server, rather than a refusal from it. */
export function isNetworkFailure(err: unknown): boolean {
  return err instanceof TypeError && NETWORK_FAILURE.test(err.message);
}

/**
 * What to show for a failed request: the server's own message when it sent
 * one, a translated "could not reach the server" when nothing came back at
 * all, and `fallback` for anything without a message.
 */
export function errorText(err: unknown, fallback: string): string {
  if (isNetworkFailure(err)) return translate("common.serverUnreachable");
  return err instanceof Error && err.message ? err.message : fallback;
}
