"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { FaDiscord, FaFacebookF, FaInstagram, FaTelegram, FaThreads, FaWhatsapp, FaXTwitter } from "react-icons/fa6";
import { MdDownload, MdIosShare, MdLink } from "react-icons/md";
import { useT } from "@/lib/useI18n";
import { ANNIVERSARY_HASHTAG, trackAnniversary } from "@/lib/anniversary";

// Every way out of the "3 meses" page: the phone's own share sheet, the
// networks that take a link (X, WhatsApp, Telegram, Facebook, Threads), the
// ones that do not (Instagram Stories takes a picture, Discord a pasted
// message), a copied link, and the picture itself. Each one is counted as
// anniv_share.<target>, and `onShare` hears about it (the gift is given on a
// share).
//
// Nothing here can tell whether a post was really made: a network's page
// opening, a picture saved or a message copied is the share.

export type ShareTarget = "native" | "x" | "whatsapp" | "instagram" | "discord" | "telegram" | "facebook" | "threads" | "copy" | "download";

export function ShareSheet({
  text,
  url,
  card,
  cardName = "go-live-3-meses.png",
  onShare,
  tone = "dark",
  compact = false,
}: {
  /** The words; the hashtag is added if they lack it. */
  text: string;
  url: string;
  /** The story picture (1080×1920) for Instagram and the download button. */
  card?: () => Promise<Blob | null>;
  cardName?: string;
  onShare?: (target: ShareTarget) => void;
  /** "dark" on the page's dark scenes, "light" on a light card. */
  tone?: "dark" | "light";
  /** Icons only, smaller — for tight spots like the recap's last story card. */
  compact?: boolean;
}) {
  const t = useT();
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [canNative, setCanNative] = useState(false);
  const words = text.includes(ANNIVERSARY_HASHTAG) ? text : `${text} ${ANNIVERSARY_HASHTAG}`;
  const full = `${words} ${url}`;

  // The picture is drawn ahead of the click: a phone only opens its share
  // sheet while the tap is fresh, and drawing (fonts, avatar) takes a moment.
  const picture = useRef<Promise<Blob | null> | null>(null);
  const getPicture = () => (picture.current ??= card ? card() : Promise.resolve(null));
  useEffect(() => {
    if (!card) return;
    const timer = window.setTimeout(() => void getPicture(), 1200);
    return () => window.clearTimeout(timer);
    // Drawn once per sheet; a new card means a new sheet (keyed by the caller).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // After hydration: the server cannot know.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCanNative(typeof navigator !== "undefined" && typeof navigator.share === "function");
  }, []);

  const done = (target: ShareTarget, message?: string) => {
    trackAnniversary(`anniv_share.${target}`);
    onShare?.(target);
    if (message) {
      setStatus(message);
      window.setTimeout(() => setStatus((s) => (s === message ? null : s)), 4000);
    }
  };

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      return false;
    }
  };

  /** The picture: into the share sheet when the device takes files, else saved. */
  const givePicture = async (target: "instagram" | "download") => {
    if (!card || busy) return;
    setBusy(true);
    try {
      const blob = await getPicture();
      if (!blob) {
        setStatus(t("anniversary.shareSheet.cardFailed"));
        return;
      }
      const file = new File([blob], cardName, { type: "image/png" });
      if (target === "instagram" && navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file], text: words });
          done(target, t("anniversary.shareSheet.storyShared"));
          return;
        } catch (err) {
          if ((err as Error).name === "AbortError") return;
        }
      }
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = cardName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(href), 10_000);
      await copy(full);
      done(target, target === "instagram" ? t("anniversary.shareSheet.storySaved") : t("anniversary.shareSheet.saved"));
    } finally {
      setBusy(false);
    }
  };

  const native = async () => {
    try {
      await navigator.share({ title: "Go Live", text: words, url });
      done("native");
    } catch {
      // Cancelled: nothing was shared.
    }
  };

  const open = (target: ShareTarget, href: string) => {
    window.open(href, "_blank", "noopener,noreferrer");
    done(target);
  };

  const enc = encodeURIComponent;
  const buttons: { target: ShareTarget; label: string; icon: ReactNode; color: string; run: () => void; show?: boolean }[] = [
    { target: "native", label: t("anniversary.shareSheet.native"), icon: <MdIosShare />, color: "#ece9e2", run: native, show: canNative },
    { target: "x", label: "X", icon: <FaXTwitter />, color: "#000000", run: () => open("x", `https://x.com/intent/post?text=${enc(words)}&url=${enc(url)}`) },
    { target: "whatsapp", label: "WhatsApp", icon: <FaWhatsapp />, color: "#25d366", run: () => open("whatsapp", `https://wa.me/?text=${enc(full)}`) },
    { target: "instagram", label: t("anniversary.shareSheet.stories"), icon: <FaInstagram />, color: "#e1306c", run: () => void givePicture("instagram"), show: Boolean(card) },
    {
      target: "discord",
      label: "Discord",
      icon: <FaDiscord />,
      color: "#5865f2",
      run: async () => {
        const ok = await copy(full);
        window.open("https://discord.com/channels/@me", "_blank", "noopener,noreferrer");
        done("discord", ok ? t("anniversary.shareSheet.discordCopied") : undefined);
      },
    },
    { target: "telegram", label: "Telegram", icon: <FaTelegram />, color: "#229ed9", run: () => open("telegram", `https://t.me/share/url?url=${enc(url)}&text=${enc(words)}`) },
    { target: "facebook", label: "Facebook", icon: <FaFacebookF />, color: "#1877f2", run: () => open("facebook", `https://www.facebook.com/sharer/sharer.php?u=${enc(url)}`) },
    { target: "threads", label: "Threads", icon: <FaThreads />, color: "#000000", run: () => open("threads", `https://www.threads.net/intent/post?text=${enc(full)}`) },
    {
      target: "copy",
      label: t("anniversary.shareSheet.copy"),
      icon: <MdLink />,
      color: "#3f4250",
      run: async () => {
        const ok = await copy(full);
        if (ok) done("copy", t("anniversary.shareSheet.copied"));
      },
    },
    { target: "download", label: t("anniversary.shareSheet.download"), icon: <MdDownload />, color: "#3f4250", run: () => void givePicture("download"), show: Boolean(card) },
  ];

  const ink = tone === "dark" ? "text-[var(--a-ink)]" : "text-zinc-900";
  return (
    <div className="flex flex-col gap-2">
      <ul className={`flex flex-wrap ${compact ? "gap-1.5" : "gap-2"}`}>
        {buttons
          .filter((b) => b.show !== false)
          .map((b) => (
            <li key={b.target}>
              <button
                type="button"
                onClick={b.run}
                disabled={busy && (b.target === "instagram" || b.target === "download")}
                title={b.label}
                className={`group flex flex-col items-center gap-1 ${ink} disabled:opacity-50`}
              >
                <span
                  className={`flex items-center justify-center rounded-full text-white ring-1 ring-white/15 transition group-hover:scale-105 group-active:scale-95 ${compact ? "h-9 w-9 text-base" : "h-11 w-11 text-xl"}`}
                  style={{ background: b.target === "native" ? "#ece9e2" : b.color, color: b.target === "native" ? "#111215" : undefined }}
                >
                  {b.icon}
                </span>
                {compact ? (
                  <span className="sr-only">{b.label}</span>
                ) : (
                  <span className="anniv-mono max-w-[4.5rem] truncate text-[9px] uppercase opacity-75">{b.label}</span>
                )}
              </button>
            </li>
          ))}
      </ul>
      <p className={`min-h-[1.25rem] text-xs font-semibold ${tone === "dark" ? "text-[var(--a-amber)]" : "text-zinc-700"}`} role="status">
        {status}
      </p>
    </div>
  );
}
