"use client";

import { useEffect, useState } from "react";
import { FaDiscord } from "react-icons/fa";
import { DiscordRpcSettingsModal } from "@/components/DiscordRpcSettingsModal";
import { isDesktopApp, isMobileApp } from "@/lib/desktop";
import {
  DISCORD_RPC_EVENTS,
  DISCORD_RPC_FEATURE,
  discordRpcIntroDue,
  isDiscordRunning,
  markDiscordRpcIntroSeen,
} from "@/lib/discordRpc";
import { trackFeatureEvent, useFeature } from "@/lib/features";
import { useT } from "@/lib/useI18n";

// Tells people who were using the app before Rich Presence existed that their
// Discord status now shows GoLive. Once, in any PC shell: the check is on the
// site's side, so no version of the shell has to be updated for it.
export function DiscordRpcIntroDialog() {
  const t = useT();
  const { enabled, ready } = useFeature(DISCORD_RPC_FEATURE, { track: false });
  const [open, setOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    if (!ready || !enabled) return;
    if (!isDesktopApp() || isMobileApp() || !discordRpcIntroDue()) return;
    // Discord closed: nothing is marked, so the next opening asks again.
    let cancelled = false;
    void isDiscordRunning().then((running) => {
      if (cancelled || !running) return;
      setOpen(true);
      trackFeatureEvent(DISCORD_RPC_EVENTS.introShown, { feature: DISCORD_RPC_FEATURE });
    });
    return () => {
      cancelled = true;
    };
  }, [ready, enabled]);

  function close(event: string) {
    markDiscordRpcIntroSeen();
    trackFeatureEvent(event, { feature: DISCORD_RPC_FEATURE });
    setOpen(false);
  }

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="discord-rpc-intro-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) close(DISCORD_RPC_EVENTS.introOk);
          }}
        >
          <div className="max-h-full w-full max-w-md overflow-y-auto rounded-2xl border border-white/10 bg-neutral-900 text-white shadow-2xl">
            {/* Drawn rather than a screenshot: it stays sharp and translated. */}
            <div
              aria-hidden
              className="flex justify-center bg-gradient-to-br from-[#5865F2] to-[#8b5cf6] px-6 pb-0 pt-7"
            >
              <div className="w-full max-w-xs rounded-t-2xl bg-[#232428] p-4 pb-5 shadow-2xl">
                <div className="flex items-center gap-3">
                  <div className="relative h-11 w-11 shrink-0 rounded-full bg-gradient-to-br from-sky-400 to-emerald-400">
                    <span className="absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-[3px] border-[#232428] bg-emerald-500" />
                  </div>
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="h-2.5 w-24 rounded-full bg-white/70" />
                    <div className="h-2 w-16 rounded-full bg-white/20" />
                  </div>
                  <FaDiscord className="h-5 w-5 shrink-0 text-white/40" />
                </div>
                <div className="mt-3 flex items-center gap-3 rounded-xl bg-[#111214] p-2.5">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/icon.png" alt="" className="h-12 w-12 shrink-0 rounded-lg" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">Go Live</div>
                    <div className="truncate text-xs text-neutral-300">{t("discordRpcIntro.artStatus")}</div>
                    <div className="text-xs font-medium text-emerald-400">12:34</div>
                  </div>
                </div>
              </div>
            </div>
            <div className="p-6">
              <span className="rounded-full bg-[#5865F2]/20 px-2.5 py-1 text-xs font-semibold text-[#aab2ff]">
                {t("discordRpcIntro.tag")}
              </span>
              <h2 id="discord-rpc-intro-title" className="mt-3 text-xl font-bold">
                {t("discordRpcIntro.title")}
              </h2>
              <p className="mt-2 text-sm text-neutral-300">{t("discordRpcIntro.body")}</p>
              <div className="mt-6 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    close(DISCORD_RPC_EVENTS.introConfigure);
                    setSettingsOpen(true);
                  }}
                  className="rounded-xl px-4 py-2 text-sm font-medium text-neutral-400 transition hover:bg-white/5 hover:text-white"
                >
                  {t("discordRpcIntro.configure")}
                </button>
                <button
                  type="button"
                  autoFocus
                  onClick={() => close(DISCORD_RPC_EVENTS.introOk)}
                  className="rounded-xl bg-[#5865F2] px-6 py-2 text-sm font-semibold text-white transition hover:bg-[#4752c4]"
                >
                  {t("discordRpcIntro.ok")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {settingsOpen && <DiscordRpcSettingsModal open onClose={() => setSettingsOpen(false)} />}
    </>
  );
}
