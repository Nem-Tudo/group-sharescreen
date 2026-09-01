"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import {
  adminLogin,
  adminLogout,
  useAdminToken,
  CaptchaChallengeRequiredError,
} from "@/lib/adminApi";
import { CaptchaChallengeModal } from "@/components/CaptchaChallengeModal";
import { DashboardPanel } from "./DashboardPanel";

// Site administration: statistics, announcements, partners, supporters, the
// desktop update nudge, anti-spam, banned words and bans.
//
// Live moderation — the room list, the invisible moderation viewer and the
// camera wall — is deliberately not here any more. It lives in its own app
// (../sharescreen-admin), against this same API, because it is a different
// job done by a different person at a different time: this page is about the
// service's configuration, that one is about who is on it right now. There is
// no tab bar left because there is only one thing on this page again.
export default function AdminPage() {
  const token = useAdminToken();
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loggingIn, setLoggingIn] = useState(false);
  // Open when the server refused the invisible reCAPTCHA check but offered a
  // challenge instead of just saying no — see CaptchaChallengeRequiredError.
  // Without this the refusal reached the form as a bare "Usuário ou senha
  // inválidos.", which is both wrong and unactionable: the password was fine,
  // and there was nothing on screen to do about the thing that actually failed.
  const [challenge, setChallenge] = useState(false);
  const [challengeError, setChallengeError] = useState<string | null>(null);

  // `challengeToken` is present only on the retry that follows a solved
  // challenge; the first attempt always goes through the invisible check.
  async function submitLogin(challengeToken?: string) {
    setLoggingIn(true);
    setLoginError(null);
    // Cleared before every attempt so the modal can tell a fresh refusal from
    // the one it is already showing (it compares `error` by value).
    setChallengeError(null);
    try {
      await adminLogin(user, password, challengeToken);
      setPassword("");
      setChallenge(false);
    } catch (err) {
      if (err instanceof CaptchaChallengeRequiredError) {
        setChallenge(true);
        // Nothing to say on the way in — the challenge itself explains what to
        // do, and the reason only means anything once an answer was refused.
        if (challengeToken) setChallengeError(err.message);
        return;
      }
      setChallenge(false);
      setLoginError(err instanceof Error ? err.message : "Usuário ou senha inválidos.");
    } finally {
      setLoggingIn(false);
    }
  }

  function handleLogin(e: FormEvent) {
    e.preventDefault();
    void submitLogin();
  }

  // Giving up on the challenge. The login has genuinely failed at this point,
  // so it says so under the form rather than leaving a form that looks
  // untouched next to a password that was never accepted.
  function cancelChallenge() {
    setChallenge(false);
    setChallengeError(null);
    setLoginError("Verificação de segurança não concluída. Tente entrar de novo.");
  }

  function handleLogout() {
    adminLogout();
  }

  if (!token) {
    return (
      <div className="flex flex-1 items-center justify-center bg-zinc-50 px-4 py-16 dark:bg-black">
        <main className="w-full max-w-md rounded-2xl border border-black/10 bg-white p-8 shadow-sm dark:border-white/10 dark:bg-zinc-950">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
            Administração
          </h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Acesso restrito. Entre com as credenciais de administrador.
          </p>
          <form onSubmit={handleLogin} className="mt-8 flex flex-col gap-3">
            <label htmlFor="user" className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Usuário
            </label>
            <input
              id="user"
              autoFocus
              autoComplete="username"
              value={user}
              onChange={(e) => setUser(e.target.value)}
              className="rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-zinc-950 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
            />
            <label htmlFor="password" className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Senha
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-zinc-950 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
            />
            {loginError && <p className="text-sm text-red-500">{loginError}</p>}
            <button
              type="submit"
              disabled={!user.trim() || !password || loggingIn}
              className="mt-2 rounded-lg bg-zinc-950 px-4 py-2.5 font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
            >
              {loggingIn ? "Entrando..." : "Entrar"}
            </button>
          </form>
        </main>
        {challenge && (
          <CaptchaChallengeModal
            error={challengeError}
            action="login"
            submittingLabel="Entrando..."
            onToken={(token) => void submitLogin(token)}
            onCancel={cancelChallenge}
          />
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col bg-zinc-50 px-4 py-10 dark:bg-black">
      <div className="mx-auto w-full max-w-3xl">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
              Admin
            </h1>
          </div>
          <div className="flex shrink-0 gap-2">
            <Link
              href="/"
              className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
            >
              Início
            </Link>
            <button
              type="button"
              onClick={handleLogout}
              className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
            >
              Sair
            </button>
          </div>
        </div>

        <div className="mt-6">
          <DashboardPanel />
        </div>
      </div>
    </div>
  );
}
