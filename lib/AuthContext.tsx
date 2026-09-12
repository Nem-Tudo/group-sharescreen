"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  type Account,
  type AccountConnections,
  useAccountToken,
  getAccountToken,
  fetchMe,
  loginAccount,
  registerAccount,
  completeOAuthSignup as completeOAuthSignupRequest,
  linkOAuthToExistingAccount as linkOAuthToExistingAccountRequest,
  unlinkOAuthProvider as unlinkOAuthProviderRequest,
  updateProfile as updateProfileRequest,
  type UpdateProfileInput,
  logoutAccount,
} from "./accountApi";
import { signalingClient, getStoredName } from "./signalingClient";
import { useGuestToken, getStoredGuestToken } from "./guestToken";
import { fetchGuestPoints } from "./guestPoints";
import { useT } from "@/lib/useI18n";

type AuthContextValue = {
  // The logged-in account, or null once resolved to "no account" (guest, no
  // token, or an expired/invalid token).
  account: Account | null;
  // Which social providers the account is linked to (and whether it still
  // has a password), for the connections panel. Null whenever `account` is —
  // it comes from the same /auth/me response.
  connections: AccountConnections | null;
  // True while the stored token (if any) is still being resolved against
  // /auth/me — the one request this context makes on app open.
  loading: boolean;
  // None of these take a captcha argument: the token is minted inside
  // accountApi, immediately before the request, and Cloudflare handles showing
  // a challenge on its own when it wants one (see lib/turnstile.ts). What a
  // caller sees is a call that occasionally takes a few seconds longer.
  login: (username: string, password: string) => Promise<Account>;
  register: (
    username: string,
    displayName: string,
    password: string,
    email: string
  ) => Promise<Account>;
  // Finishes a Discord/Google *signup* (see lib/oauthApi.ts): the ticket
  // stands in for the password here — the provider identity behind it was
  // already verified server-side — and the result is an ordinary account,
  // indistinguishable from a registered one from this point on. A plain
  // social *login* needs nothing from this context beyond refresh(), since
  // its token arrives through accountApi's store on its own.
  completeOAuthSignup: (ticket: string, username: string, displayName: string) => Promise<Account>;
  // The other half of that step, for somebody the automatic match could not
  // recognise: an account that already exists here, claimed with its own
  // password, with the provider linked to it on the way in. Ends in exactly
  // the same place — a session for that account.
  linkOAuthToExisting: (ticket: string, username: string, password: string) => Promise<Account>;
  // Detaches a provider, then re-resolves so the panel reflects it. Rejects
  // (with the API's message) when it would leave the account with no way in.
  unlinkProvider: (provider: string) => Promise<void>;
  updateProfile: (input: UpdateProfileInput) => Promise<Account>;
  logout: () => void;
  // The current identity's points, whichever kind of identity that is: the
  // account's own when signed in, this browser's guest total otherwise (see
  // lib/guestPoints.ts). Readers get one number and don't have to care —
  // which matters because both kinds can now earn them (see lib/partner.ts).
  // Reads 0 for a visitor who hasn't chosen a name yet, since there is no
  // identity holding any.
  points: number;
  // Re-resolves the current identity — /auth/me for an account, /guest/points
  // for a guest — e.g. after an action that changes it server-side (a rename,
  // a claimed reward) or outside this tab.
  refresh: () => Promise<void>;
  // Sends the signaling registration for the current account again, after a
  // refusal or a lookup that failed — see the callback for why a browser
  // never needs this and the installed app does.
  retryIdentity: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

// When to re-ask after an unanswered /auth/me — see the resolve effect below.
//
// A schedule rather than a single delay, and it climbs: the first entries
// catch an ordinary network blip while the person is still looking at the
// page, and the later ones are there to outlast an API restart, which takes
// tens of seconds to open its port because it loads every store first. Adds up
// to about a minute, after which the page settles into a guest session rather
// than retrying forever.
const ME_RETRY_DELAYS_MS = [2000, 4000, 8000, 15000, 30000];

export function AuthProvider({ children }: { children: ReactNode }) {
  const accountToken = useAccountToken();
  const guestToken = useGuestToken();
  const [account, setAccount] = useState<Account | null>(null);
  // Whether a /auth/me that failed for a reason unrelated to the token is
  // still going to be tried again. See the resolve effect and the register
  // effect below, which are the only two things that care.
  const [meRetrying, setMeRetrying] = useState(false);
  // Guest points, tagged with the identity they were fetched for. Only ever
  // meaningful while signed out — an account's points come from /auth/me with
  // the rest of it. Kept here rather than in whatever component shows it so a
  // claim made in one place updates the readout in another, exactly as it
  // already does for an account.
  //
  // Tagged rather than stored bare because the guest token *is* the identity
  // holding them: a total fetched under a previous token belongs to a
  // different person, so pairing the two makes "whose number is this" a
  // derivation instead of something the effect below has to remember to
  // clear. Same pattern as resolvedToken/resolvedAccount above.
  const [guestPointsEntry, setGuestPointsEntry] = useState<{
    token: string;
    points: number;
  } | null>(null);
  // Travels with `account` — same source (/auth/me), same lifetime, so it's
  // set and cleared everywhere that one is.
  const [connections, setConnections] = useState<AccountConnections | null>(null);
  // Tracks which token the effect below has already resolved (via
  // accountApi.fetchMe) — while it's behind the current accountToken, we
  // don't yet know whether there's an account behind it, hence `loading`.
  const [resolvedToken, setResolvedToken] = useState<string | null>(null);

  // Skips the fetch entirely once resolvedToken already matches (e.g. right
  // after login()/register() below set both in the same tick) — the actual
  // "no token" / "not yet resolved" cases are handled by the `account`
  // derivation beneath, not by clearing state here.
  useEffect(() => {
    if (!accountToken || resolvedToken === accountToken) return;
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const apply = (me: Awaited<ReturnType<typeof fetchMe>>) => {
      setAccount(me?.account ?? null);
      setConnections(me?.connections ?? null);
      setResolvedToken(accountToken);
    };

    // A rejection here is a request that never got an answer — a timeout (see
    // fetchMe's own ceiling), a dropped connection, a captive portal, or an
    // API that is not listening yet. It says nothing about the token, so the
    // account is not discarded; but the app cannot wait on it either, because
    // every page gates its start-up on this resolving and a page that never
    // resolves is one the user cannot use.
    //
    // So: unblock immediately, then keep asking in the background until the
    // answer arrives or the schedule runs out.
    //
    // It used to ask exactly once more, four seconds later, and that is the
    // bug this now exists to fix. A restarting API is unreachable for far
    // longer than four seconds — it does not open its port until every store
    // has loaded, which is tens of seconds with a real account list — so both
    // attempts landed while it was still starting, the retry gave up, and the
    // session sat demoted until somebody reloaded the page. Reloading during
    // that window just repeated the same two failures, which is exactly what
    // it looked like from the outside: signed in, then suddenly a guest
    // wearing your last name, then signed in again once the server came up.
    //
    // The schedule below outlasts an ordinary restart. It is bounded rather
    // than endless because a genuinely unreachable API is a page the person
    // should be allowed to use as a guest, eventually.
    let attempt = 0;
    const scheduleRetry = () => {
      if (cancelled) return;
      if (attempt >= ME_RETRY_DELAYS_MS.length) {
        // Out of attempts: stop claiming the account might still resolve, so
        // the register effect can fall back to a guest identity.
        setMeRetrying(false);
        return;
      }
      const delay = ME_RETRY_DELAYS_MS[attempt]!;
      attempt += 1;
      retryTimer = setTimeout(() => {
        retryTimer = null;
        fetchMe()
          .then((me) => {
            if (cancelled) return;
            if (me) {
              // Found it. Applying also ends the hold below.
              setMeRetrying(false);
              apply(me);
              return;
            }
            // A definite "no account" (fetchMe only returns null for a 401 or
            // 403, which is the server saying the token itself is bad). No
            // point asking again.
            setMeRetrying(false);
          })
          .catch(() => {
            // Still no answer — same class of failure as the first one.
            scheduleRetry();
          });
      }, delay);
    };

    const failed = () => {
      // Unblocks the page: `loading` is derived from this, and everything
      // gates on it.
      setResolvedToken(accountToken);
      // Says "this token has not been ruled out yet". The register effect
      // below reads it to hold off on announcing a guest identity while an
      // account is still on the table — see the comment there.
      setMeRetrying(true);
      scheduleRetry();
    };

    fetchMe()
      .then((me) => {
        if (!cancelled) apply(me);
      })
      .catch(() => {
        if (!cancelled) failed();
      });

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [accountToken, resolvedToken]);

  const refresh = useCallback(async () => {
    // A guest has no /auth/me to re-resolve; its points are the only thing
    // about it the server holds. Handled here rather than at the call sites
    // so everything that already refreshes after a reward (PartnerCard,
    // PartnerRewardModal) keeps working untouched now that guests earn too.
    if (!getAccountToken()) {
      const token = getStoredGuestToken();
      if (!token) return;
      const points = await fetchGuestPoints();
      if (points !== null) setGuestPointsEntry({ token, points });
      return;
    }
    const me = await fetchMe();
    setAccount(me?.account ?? null);
    setConnections(me?.connections ?? null);
    setResolvedToken(getAccountToken());
  }, []);

  const unlinkProvider = useCallback(
    async (provider: string) => {
      await unlinkOAuthProviderRequest(provider);
      // The account object itself doesn't change, but its connections do —
      // re-resolving is the simplest way to keep them honest, and it's the
      // same request the panel would have made anyway.
      await refresh();
    },
    [refresh]
  );

  const login = useCallback(async (username: string, password: string) => {
    const { account: acc } = await loginAccount(username, password);
    setAccount(acc);
    setResolvedToken(getAccountToken());
    return acc;
  }, []);

  const register = useCallback(
    async (username: string, displayName: string, password: string, email: string) => {
      const { account: acc } = await registerAccount(username, displayName, password, email);
      setAccount(acc);
      setResolvedToken(getAccountToken());
      return acc;
    },
    []
  );

  const completeOAuthSignup = useCallback(
    async (ticket: string, username: string, displayName: string) => {
      const { account: acc } = await completeOAuthSignupRequest(ticket, username, displayName);
      setAccount(acc);
      setResolvedToken(getAccountToken());
      return acc;
    },
    []
  );

  const linkOAuthToExisting = useCallback(
    async (ticket: string, username: string, password: string) => {
      const { account: acc } = await linkOAuthToExistingAccountRequest(ticket, username, password);
      setAccount(acc);
      setResolvedToken(getAccountToken());
      return acc;
    },
    []
  );

  const updateProfile = useCallback(async (input: UpdateProfileInput) => {
    const updated = await updateProfileRequest(input);
    setAccount(updated);
    return updated;
  }, []);

  // Turns a stored (or freshly obtained, via login()/register() above)
  // account token into an actual signaling registration — lives here rather
  // than in any one page so it also fires on a direct link straight into a
  // room, or a reload of one, not just when the home page happens to mount
  // first (it used to live only there, which left a logged-in account stuck
  // on "Reconectando..." forever on any other route: signalingClient's own
  // constructor deliberately skips auto-registering when an account token
  // is present, expecting something else to resolve it — see its comment).
  // Also reset on logout so a later login re-registers instead of being
  // skipped as "already done" for a token that's no longer current.
  const registeredForTokenRef = useRef<string | null>(null);

  const logout = useCallback(() => {
    logoutAccount();
    setAccount(null);
    setConnections(null);
    setResolvedToken(null);
    registeredForTokenRef.current = null;
    signalingClient.logoutIdentity();
  }, []);

  // Only trust `account` once it was resolved for the token currently on
  // disk — otherwise it's either empty or leftover from a prior token.
  const resolvedAccount = accountToken && resolvedToken === accountToken ? account : null;
  const loading = Boolean(accountToken) && resolvedToken !== accountToken;

  // Guest points follow the guest token, because that token *is* the guest
  // identity holding them (see lib/guestPoints.ts). Re-running when it
  // changes is therefore not a refresh but a change of person — which the
  // derivation below handles by reading 0 for any token this hasn't answered
  // for yet, so the previous guest's total never shows through while the new
  // one is in flight. Skipped entirely while signed in: an account's points
  // come from /auth/me, and a stale guest number must never surface under it.
  useEffect(() => {
    if (accountToken || !guestToken) return;
    let cancelled = false;
    void fetchGuestPoints().then((points) => {
      if (!cancelled && points !== null) setGuestPointsEntry({ token: guestToken, points });
    });
    return () => {
      cancelled = true;
    };
  }, [accountToken, guestToken]);

  const guestPoints =
    !accountToken && guestToken && guestPointsEntry?.token === guestToken
      ? guestPointsEntry.points
      : 0;

  // Falls back to any stored guest name if the token turned out to be
  // invalid/expired, mirroring what signalingClient's own constructor does
  // when there's no token at all. Guarded by the ref above (not just the
  // effect deps) so a later account refresh doesn't re-trigger a register()
  // call for a token already connected with.
  useEffect(() => {
    if (!accountToken || loading) return;
    if (resolvedAccount) {
      const key = `${accountToken}:account`;
      if (registeredForTokenRef.current === key) return;
      registeredForTokenRef.current = key;
      signalingClient.register(resolvedAccount.displayName, accountToken);
      return;
    }
    // An account token that has not resolved *yet* is not a guest.
    //
    // Registering the stored name here while the retry is still in flight is
    // what put somebody's own last-used name on screen as a guest during an
    // API restart: the token was fine, the lookup had simply not succeeded
    // yet. Waiting costs a few seconds of no identity — the page is already
    // unblocked — and the retry either resolves the account or clears this,
    // at which point the fallback below runs exactly as it used to.
    if (meRetrying) return;
    const storedName = getStoredName();
    // Nothing to register *with*: a token that didn't resolve to an account
    // (a /auth/me that timed out — see the retry in the resolve effect) and
    // no guest name to fall back on. Returning without touching the ref is
    // the whole point: marking the token as done here used to strand the
    // installed app permanently, since it is the one shell that never has a
    // stored guest name. The register never went out, the retry a few
    // seconds later found the token "already registered" and skipped it, and
    // logging in again changed nothing — leaving the account-required screen
    // as the only thing the person could ever see.
    if (!storedName) return;
    const key = `${accountToken}:guest`;
    if (registeredForTokenRef.current === key) return;
    registeredForTokenRef.current = key;
    signalingClient.register(storedName);
  }, [accountToken, loading, resolvedAccount, meRetrying]);

  // Ask for the signaling identity again, from scratch.
  //
  // Everything above is fire-and-once: a register that the server refuses
  // (a rename budget spent, a name collision, a restart mid-handshake) sets
  // signalingClient's nameError and stops there, and the ref means the same
  // token never asks twice on its own. In a browser that is invisible —
  // whoever is looking already has a guest name — but the app has no such
  // fallback, so a single refusal is the difference between using the app
  // and not. This is what the "tentar novamente" on those screens calls.
  const retryIdentity = useCallback(async () => {
    const token = getAccountToken();
    if (!token) return;
    registeredForTokenRef.current = null;
    // Re-resolve first: the likeliest reason there is no account behind a
    // stored token is that the lookup failed, not that the token is bad.
    let current = resolvedAccount;
    if (!current) {
      const me = await fetchMe().catch(() => null);
      if (me) {
        setAccount(me.account);
        setConnections(me.connections);
        setResolvedToken(getAccountToken());
        current = me.account;
      }
    }
    // Throw away whatever reconnect backoff is pending too — a person
    // pressing a button is not going to wait out ten seconds of it.
    signalingClient.retryNow();
    if (current) {
      registeredForTokenRef.current = `${token}:account`;
      signalingClient.register(current.displayName, token);
      return;
    }
    const storedName = getStoredName();
    if (storedName) {
      registeredForTokenRef.current = `${token}:guest`;
      signalingClient.register(storedName);
    }
  }, [resolvedAccount]);

  const value = useMemo<AuthContextValue>(
    () => ({
      account: resolvedAccount,
      connections: resolvedAccount ? connections : null,
      loading,
      points: resolvedAccount ? resolvedAccount.points ?? 0 : guestPoints,
      login,
      register,
      completeOAuthSignup,
      linkOAuthToExisting,
      unlinkProvider,
      updateProfile,
      logout,
      refresh,
      retryIdentity,
    }),
    [
      resolvedAccount,
      connections,
      loading,
      guestPoints,
      login,
      register,
      completeOAuthSignup,
      linkOAuthToExisting,
      unlinkProvider,
      updateProfile,
      logout,
      refresh,
      retryIdentity,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// The logged-in account (or null) plus auth actions — read from anywhere
// under <AuthProvider> instead of calling accountApi directly, so the
// /auth/me lookup only ever happens once per app load.
export function useAuth(): AuthContextValue {
  const t = useT();
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
