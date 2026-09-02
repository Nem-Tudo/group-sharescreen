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
  unlinkOAuthProvider as unlinkOAuthProviderRequest,
  logoutAccount,
} from "./accountApi";
import { signalingClient, getStoredName } from "./signalingClient";
import { useGuestToken, getStoredGuestToken } from "./guestToken";
import { fetchGuestPoints } from "./guestPoints";

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
  register: (username: string, displayName: string, password: string) => Promise<Account>;
  // Finishes a Discord/Google *signup* (see lib/oauthApi.ts): the ticket
  // stands in for the password here — the provider identity behind it was
  // already verified server-side — and the result is an ordinary account,
  // indistinguishable from a registered one from this point on. A plain
  // social *login* needs nothing from this context beyond refresh(), since
  // its token arrives through accountApi's store on its own.
  completeOAuthSignup: (ticket: string, username: string, displayName: string) => Promise<Account>;
  // Detaches a provider, then re-resolves so the panel reflects it. Rejects
  // (with the API's message) when it would leave the account with no way in.
  unlinkProvider: (provider: string) => Promise<void>;
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
};

const AuthContext = createContext<AuthContextValue | null>(null);

// How long after an unanswered /auth/me before trying once more — see the
// resolve effect below. Long enough to outlast the blip that caused it, short
// enough that a signed-in session comes back while the person is still looking
// at the page.
const ME_RETRY_DELAY_MS = 4000;

export function AuthProvider({ children }: { children: ReactNode }) {
  const accountToken = useAccountToken();
  const guestToken = useGuestToken();
  const [account, setAccount] = useState<Account | null>(null);
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
    // fetchMe's own ceiling), a dropped connection, a captive portal. It says
    // nothing about the token, so the account is not discarded; but the app
    // cannot wait on it either, because every page gates its start-up on this
    // resolving and a page that never resolves is one the user cannot use.
    //
    // So: unblock immediately, then try once more in the background. A blip on
    // a slow link resolves into a signed-in session a few seconds late instead
    // of a session silently demoted to guest until the next reload.
    const failed = () => {
      setResolvedToken(accountToken);
      retryTimer = setTimeout(() => {
        retryTimer = null;
        fetchMe()
          .then((me) => {
            // Only worth applying if it actually found the account: by now the
            // UI has already settled into its signed-out shape, and replacing
            // that with another "no account" would be a re-render saying
            // nothing.
            if (!cancelled && me) apply(me);
          })
          .catch(() => {
            // Two failures is enough to stop asking. The user still has a
            // working page, and any deliberate action — a reload, a login —
            // starts this over.
          });
      }, ME_RETRY_DELAY_MS);
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
    async (username: string, displayName: string, password: string) => {
      const { account: acc } = await registerAccount(username, displayName, password);
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
    if (registeredForTokenRef.current === accountToken) return;
    registeredForTokenRef.current = accountToken;
    if (resolvedAccount) {
      signalingClient.register(resolvedAccount.displayName, accountToken);
    } else {
      const storedName = getStoredName();
      if (storedName) signalingClient.register(storedName);
    }
  }, [accountToken, loading, resolvedAccount]);

  const value = useMemo<AuthContextValue>(
    () => ({
      account: resolvedAccount,
      connections: resolvedAccount ? connections : null,
      loading,
      points: resolvedAccount ? resolvedAccount.points ?? 0 : guestPoints,
      login,
      register,
      completeOAuthSignup,
      unlinkProvider,
      logout,
      refresh,
    }),
    [
      resolvedAccount,
      connections,
      loading,
      guestPoints,
      login,
      register,
      completeOAuthSignup,
      unlinkProvider,
      logout,
      refresh,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// The logged-in account (or null) plus auth actions — read from anywhere
// under <AuthProvider> instead of calling accountApi directly, so the
// /auth/me lookup only ever happens once per app load.
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
