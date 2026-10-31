"use client";

import { useEffect, useState } from "react";
import { FaDiscord } from "react-icons/fa";
import { DiscordRpcSettingsModal } from "@/components/DiscordRpcSettingsModal";
import { isDesktopApp, isMobileApp } from "@/lib/desktop";
import {
  DISCORD_RPC_EVENTS,
  DISCORD_RPC_FEATURE,
  discordRpcIntroDue,
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
    setOpen(true);
    trackFeatureEvent(DISCORD_RPC_EVENTS.introShown, { feature: DISCORD_RPC_FEATURE });
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
          <div className="max-h-full w-full max-w-md overflow-y-auto rounded-2xl border border-white/10 bg-neutral-900 p-6 text-white shadow-2xl">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#5865F2]/20 text-[#5865F2]">
              <FaDiscord className="h-7 w-7" />
            </div>
            <h2 id="discord-rpc-intro-title" className="mt-4 text-lg font-bold">
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
      )}
      {settingsOpen && <DiscordRpcSettingsModal open onClose={() => setSettingsOpen(false)} />}
    </>
  );
}
