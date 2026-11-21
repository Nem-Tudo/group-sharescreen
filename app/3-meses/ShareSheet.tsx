"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { FaDiscord, FaFacebookF, FaInstagram, FaTelegram, FaThreads, FaWhatsapp, FaXTwitter } from "react-icons/fa6";
import { MdContentCopy, MdDownload, MdIosShare, MdLink } from "react-icons/md";
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

export type ShareTarget = "native" | "x" | "whatsapp" | "instagram" | "discord" | "telegram" | "facebook" | "threads" | "copy" | "image" | "download";

export function ShareSheet({
  text,
  xText,
  url,
  card,
  cardName = "go-live-3-meses.png",
  onShare,
  tone = "dark",
  compact = false,
}: {
  /** The words; the hashtag is added if they lack it. */
  text: string;
  /** X's own version of the words, if it differs (the hashtag goes on its own paragraph). */
  xText?: string;
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
  const [canCopyImage, setCanCopyImage] = useState(false);
  // A text written in lines (the recap's) keeps them: hashtag and link each
  // get a paragraph of their own. A one-line text stays one line.
  // The hashtag ends the last line; a text written in lines (the recap's)
  // gets the link a paragraph below. X may have its own version (`xText`), with
  // the hashtag on a paragraph of its own too.
  const NL = String.fromCharCode(10);
  const multiline = text.includes(NL);
  const words = text.includes(ANNIVERSARY_HASHTAG) ? text : `${text} ${ANNIVERSARY_HASHTAG}`;
  const full = `${words}${multiline ? NL + NL : " "}${url}`;
  const xFull = xText ? `${xText}${NL}${NL}${ANNIVERSARY_HASHTAG}${NL}${NL}${url}` : null;

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
    setCanCopyImage(typeof ClipboardItem !== "undefined" && Boolean(navigator.clipboard?.write));
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

  /**
   * The picture onto the clipboard, inside the click (a browser only allows it
   * there): handed over as a promise, so the drawing may still be finishing.
   */
  const copyPicture = (): Promise<boolean> => {
    if (!card || typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) return Promise.resolve(false);
    try {
      const png = getPicture().then((blob) => {
        if (!blob) throw new Error("no picture");
        return blob;
      });
      return navigator.clipboard.write([new ClipboardItem({ "image/png": png })]).then(
        () => true,
        () => false
      );
    } catch {
      return Promise.resolve(false);
    }
  };

  /**
   * X takes no picture through a link. On a phone the picture goes through the
   * share sheet (X is in it); on a computer it goes onto the clipboard and the
   * post opens, ready for a paste.
   */
  const shareOnX = async () => {
    // With lines, the link goes inside the text (X's own `url` would join it to the hashtag's line).
    const intent =
      xFull || multiline
        ? `https://x.com/intent/post?text=${encodeURIComponent(xFull ?? full)}`
        : `https://x.com/intent/post?text=${encodeURIComponent(words)}&url=${encodeURIComponent(url)}`;
    if (card) {
      const blob = await Promise.race([getPicture(), new Promise<null>((r) => setTimeout(() => r(null), 50))]);
      const file = blob ? new File([blob], cardName, { type: "image/png" }) : null;
      if (file && navigator.canShare?.({ files: [file] }) && window.matchMedia("(pointer: coarse)").matches) {
        try {
          await navigator.share({ files: [file], text: xFull ?? full });
          done("x");
          return;
        } catch (err) {
          if ((err as Error).name === "AbortError") return;
        }
      }
      const copied = copyPicture();
      window.open(intent, "_blank", "noopener,noreferrer");
      done("x", (await copied) ? t("anniversary.shareSheet.xImage") : undefined);
      return;
    }
    window.open(intent, "_blank", "noopener,noreferrer");
    done("x");
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
    { target: "x", label: "X", icon: <FaXTwitter />, color: "#000000", run: () => void shareOnX() },
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
    {
      target: "image",
      label: t("anniversary.shareSheet.copyImage"),
      icon: <MdContentCopy />,
      color: "#3f4250",
      run: async () => {
        if (await copyPicture()) done("image", t("anniversary.shareSheet.imageCopied"));
        else setStatus(t("anniversary.shareSheet.imageCopyFailed"));
      },
      show: Boolean(card) && canCopyImage,
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
