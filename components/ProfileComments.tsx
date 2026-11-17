"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import Link from "next/link";
import useNtPopups from "ntpopups";
import { MdBlock, MdChatBubbleOutline, MdClose, MdDeleteOutline, MdMoreHoriz, MdSend, MdSettings } from "react-icons/md";
import { useAuth } from "@/lib/AuthContext";
import { useFeature, trackFeatureEvent } from "@/lib/features";
import { useI18n } from "@/lib/useI18n";
import { formatLocale } from "@/lib/i18n";
import { nameStyleOf } from "@/lib/nameStyle";
import {
  PROFILE_COMMENT_EVENTS,
  PROFILE_COMMENT_MAX_LENGTH,
  PROFILE_COMMENTS_FEATURE,
  blockProfileCommenter,
  deleteProfileComment,
  fetchProfileCommentSettings,
  fetchProfileComments,
  postProfileComment,
  setProfileCommentsDisabled,
  unblockProfileCommenter,
  type ProfileComment,
  type ProfileCommentBlockReason,
  type ProfileCommentGif,
  type ProfileCommentUser,
} from "@/lib/profileComments";
import type { GifResult } from "@/app/api/giphy/search/route";
import { UserAvatar } from "@/components/UserAvatar";
import { VerifiedBadge } from "@/components/VerifiedBadge";
import { BotTag } from "@/components/BotTag";
import { Popover } from "@/components/Tooltip";
import { GifPicker } from "@/components/GifPicker";
import { EmojiPickerButton } from "@/components/EmojiPicker";
import { AccountModal, type AccountModalMode } from "@/components/AccountModal";
import { NewBadge, markFeatureUsed } from "@/components/NewBadge";

// Comments on a profile (experiment "profile-comments"), as a card of its own
// under the profile card — on the /user page and in the room's profile popup.
//
// Its own card rather than a section inside UserProfileCard: that one wears
// the owner's theme, and a list of other people's words in somebody's chosen
// gradient is a legibility problem for no gain. Below it, it still reads as
// part of the profile.
//
// The two places differ only in how much they show at first:
//  - the page shows a full page of comments and pages further back;
//  - the popup (`compact`) shows the newest few — somebody there is checking
//    who a person is, not reading their wall — and expands in place on
//    "ver mais", inside the dialog's own scroll, so nobody leaves the room.
//    An author's name there opens their profile in a new tab for the same
//    reason.
//
// Nothing renders for a profile outside the experiment: the API answers
// `available: false` (it decides per profile owner, see its
// profileCommentRoutes.ts).

const COMPACT_VISIBLE = 3;

function isCoarsePointer(): boolean {
  return typeof window !== "undefined" && Boolean(window.matchMedia?.("(pointer: coarse)").matches);
}
const CARD = "rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950";

function relativeTime(ts: number): string {
  const seconds = Math.round((ts - Date.now()) / 1000);
  const rtf = new Intl.RelativeTimeFormat(formatLocale(), { numeric: "auto", style: "short" });
  const abs = Math.abs(seconds);
  if (abs < 60) return rtf.format(0, "second");
  if (abs < 3600) return rtf.format(Math.round(seconds / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(seconds / 3600), "hour");
  if (abs < 86400 * 30) return rtf.format(Math.round(seconds / 86400), "day");
  return new Date(ts).toLocaleDateString(formatLocale(), { day: "numeric", month: "short", year: "numeric" });
}

function sameProfile(account: { id: string; username: string } | null, profileId: string): boolean {
  if (!account) return false;
  return account.id === profileId || account.username.toLowerCase() === profileId.toLowerCase();
}

export function ProfileComments({
  profileId,
  compact = false,
  className = "",
}: {
  /** The profile's account id or username — whatever /user/[id] was opened with. */
  profileId: string;
  /** The room's popup: the newest few, expanding in place. */
  compact?: boolean;
  className?: string;
}) {
  const { t, tc } = useI18n();
  const { account } = useAuth();
  const { openPopup } = useNtPopups();

  // Only to count the owner's exposure, on their own profile — control and
  // treatment alike. Whether this profile *has* comments is the API's answer.
  const viewingOwn = sameProfile(account, profileId);
  useFeature(PROFILE_COMMENTS_FEATURE, { track: viewingOwn });

  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "hidden" }
    | { status: "error" }
    | {
        status: "ready";
        enabled: boolean;
        isOwner: boolean;
        canModerate: boolean;
        canComment: boolean;
        reason: ProfileCommentBlockReason;
        total: number;
        comments: ProfileComment[];
        hasMore: boolean;
      }
  >({ status: "loading" });
  const [expanded, setExpanded] = useState(!compact);
  const [loadingMore, setLoadingMore] = useState(false);
  const [accountModal, setAccountModal] = useState<AccountModalMode | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const sectionRef = useRef<HTMLElement>(null);

  const load = useCallback(
    (signal?: AbortSignal) =>
      fetchProfileComments(profileId, undefined, signal)
        .then((page) => {
          if (!page.available) {
            setState({ status: "hidden" });
            return;
          }
          setState({
            status: "ready",
            enabled: page.enabled,
            isOwner: page.isOwner,
            canModerate: page.canModerate,
            canComment: page.canComment,
            reason: page.reason,
            total: page.total ?? page.comments.length,
            comments: page.comments,
            hasMore: page.hasMore,
          });
        })
        .catch((err) => {
          if (err instanceof DOMException && err.name === "AbortError") return;
          setState((previous) => (previous.status === "ready" ? previous : { status: "error" }));
        }),
    [profileId]
  );

  // Re-read when the signed-in account changes: what this viewer may do
  // (comment, delete, moderate) is part of the answer.
  const accountId = account?.id ?? null;
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load, accountId]);

  // A link to "#comments" (the push notification's) lands here once loaded.
  const ready = state.status === "ready";
  useEffect(() => {
    if (!ready || compact || typeof window === "undefined") return;
    if (window.location.hash === "#comments") {
      sectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [ready, compact]);

  if (state.status === "hidden" || state.status === "loading") return null;
  if (state.status === "error") return null;

  const { comments, total, hasMore, isOwner, canModerate, enabled, canComment, reason } = state;
  const visible = expanded ? comments : comments.slice(0, COMPACT_VISIBLE);
  const canShowMore = (!expanded && comments.length > COMPACT_VISIBLE) || (expanded && hasMore);

  async function showMore() {
    if (state.status !== "ready") return;
    trackFeatureEvent(PROFILE_COMMENT_EVENTS.more, { feature: PROFILE_COMMENTS_FEATURE, value: compact ? 1 : 2 });
    if (!expanded) {
      setExpanded(true);
      return;
    }
    const oldest = state.comments[state.comments.length - 1];
    if (!oldest) return;
    setLoadingMore(true);
    try {
      const page = await fetchProfileComments(profileId, oldest.ts);
      if (!page.available) return;
      setState((previous) =>
        previous.status === "ready"
          ? {
              ...previous,
              comments: [
                ...previous.comments,
                ...page.comments.filter((c) => !previous.comments.some((p) => p.id === c.id)),
              ],
              hasMore: page.hasMore,
            }
          : previous
      );
    } catch {
      // Leaves the button there to try again.
    } finally {
      setLoadingMore(false);
    }
  }

  function removeLocally(predicate: (comment: ProfileComment) => boolean) {
    setState((previous) => {
      if (previous.status !== "ready") return previous;
      const kept = previous.comments.filter((c) => !predicate(c));
      return { ...previous, comments: kept, total: Math.max(0, previous.total - (previous.comments.length - kept.length)) };
    });
  }

  function confirmDelete(comment: ProfileComment) {
    const own = comment.author.id === account?.id;
    void openPopup("confirm", {
      data: {
        title: t("profileComments.deleteTitle"),
        message: own ? t("profileComments.deleteOwnMessage") : t("profileComments.deleteMessage"),
        cancelLabel: t("common.cancel"),
        confirmLabel: t("common.delete"),
        confirmStyle: "Danger",
        onChoose: async (confirmed: boolean) => {
          if (!confirmed) return;
          const result = await deleteProfileComment(profileId, comment.id);
          if (!result.ok) return;
          trackFeatureEvent(PROFILE_COMMENT_EVENTS.delete, {
            feature: PROFILE_COMMENTS_FEATURE,
            value: own ? 1 : isOwner ? 2 : 3,
          });
          removeLocally((c) => c.id === comment.id);
        },
      },
    });
  }

  function confirmBlock(user: ProfileCommentUser) {
    void openPopup("confirm", {
      data: {
        title: t("profileComments.blockTitle", { name: user.displayName }),
        message: t("profileComments.blockMessage"),
        cancelLabel: t("common.cancel"),
        confirmLabel: t("profileComments.block"),
        confirmStyle: "Danger",
        onChoose: async (confirmed: boolean) => {
          if (!confirmed) return;
          const result = await blockProfileCommenter(user.id);
          if (!result.ok) return;
          trackFeatureEvent(PROFILE_COMMENT_EVENTS.block, { feature: PROFILE_COMMENTS_FEATURE });
          markFeatureUsed(PROFILE_COMMENTS_FEATURE);
          removeLocally((c) => c.author.id === user.id);
        },
      },
    });
  }

  return (
    <section
      ref={sectionRef}
      id={compact ? undefined : "comments"}
      aria-label={t("profileComments.title")}
      className={`${CARD} scroll-mt-4 p-4 sm:p-5 ${className}`}
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          <MdChatBubbleOutline className="h-4 w-4 text-zinc-500" />
          {t("profileComments.title")}
          {enabled && total > 0 && (
            <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium tabular-nums text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
              {total}
            </span>
          )}
          {isOwner && <NewBadge id={PROFILE_COMMENTS_FEATURE} />}
        </h2>
        {isOwner && (
          <Popover
            open={settingsOpen}
            onClose={() => setSettingsOpen(false)}
            placement="bottom-end"
            tooltip={t("profileComments.settings")}
            content={
              <OwnerSettings
                onChanged={(disabled) => {
                  markFeatureUsed(PROFILE_COMMENTS_FEATURE);
                  setState((previous) =>
                    previous.status === "ready"
                      ? { ...previous, enabled: !disabled, canComment: !disabled, reason: disabled ? "disabled" : null }
                      : previous
                  );
                }}
                onUnblocked={() => void load()}
              />
            }
          >
            <button
              type="button"
              onClick={() => setSettingsOpen((open) => !open)}
              aria-label={t("profileComments.settings")}
              aria-expanded={settingsOpen}
              className="flex cursor-pointer rounded-lg p-1.5 text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-800 dark:hover:bg-zinc-900 dark:hover:text-zinc-200"
            >
              <MdSettings className="h-4 w-4" />
            </button>
          </Popover>
        )}
      </div>

      {isOwner && !enabled && (
        <p className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
          {t("profileComments.disabledOwner")}
        </p>
      )}

      {canComment ? (
        <Composer
          profileId={profileId}
          compact={compact}
          onPosted={(comment) => {
            markFeatureUsed(PROFILE_COMMENTS_FEATURE);
            setState((previous) =>
              previous.status === "ready"
                ? { ...previous, comments: [comment, ...previous.comments], total: previous.total + 1 }
                : previous
            );
          }}
        />
      ) : (
        <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
          {reason === "login" ? (
            <>
              {t("profileComments.loginToComment")}{" "}
              <button
                type="button"
                onClick={() => setAccountModal("login")}
                className="cursor-pointer font-medium text-zinc-800 underline underline-offset-2 dark:text-zinc-200"
              >
                {t("common.signIn")}
              </button>
            </>
          ) : reason === "disabled" ? (
            isOwner ? null : t("profileComments.disabledVisitor")
          ) : reason === "blocked" ? (
            t("profileComments.cannotComment")
          ) : reason === "bot" ? (
            t("profileComments.botsCannotComment")
          ) : null}
        </p>
      )}

      {visible.length > 0 ? (
        <ul className="mt-4 flex flex-col gap-4">
          {visible.map((comment) => (
            <CommentItem
              key={comment.id}
              comment={comment}
              compact={compact}
              canDelete={canModerate || comment.author.id === account?.id}
              canBlock={isOwner && comment.author.id !== account?.id}
              onDelete={() => confirmDelete(comment)}
              onBlock={() => confirmBlock(comment.author)}
            />
          ))}
        </ul>
      ) : (
        (enabled || isOwner) && (
          <p className="mt-4 text-center text-xs text-zinc-400 dark:text-zinc-600">
            {isOwner ? t("profileComments.emptyOwner") : t("profileComments.empty")}
          </p>
        )
      )}

      {canShowMore && (
        <button
          type="button"
          onClick={() => void showMore()}
          disabled={loadingMore}
          className="mt-4 w-full cursor-pointer rounded-lg border border-zinc-200 py-2 text-xs font-medium text-zinc-600 transition hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-900"
        >
          {loadingMore
            ? t("common.loading")
            : !expanded
              ? tc("profileComments.showAll", total)
              : t("profileComments.loadOlder")}
        </button>
      )}

      <AccountModal mode={accountModal} onModeChange={setAccountModal} />
    </section>
  );
}

// ---------------------------------------------------------------------------

function Composer({
  profileId,
  compact,
  onPosted,
}: {
  profileId: string;
  compact: boolean;
  onPosted: (comment: ProfileComment) => void;
}) {
  const { t } = useI18n();
  const [text, setText] = useState("");
  const [gif, setGif] = useState<ProfileCommentGif | null>(null);
  const [gifOpen, setGifOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const trimmed = text.trim();
  const canSend = !sending && (trimmed.length > 0 || gif !== null) && trimmed.length <= PROFILE_COMMENT_MAX_LENGTH;
  const nearLimit = text.length > PROFILE_COMMENT_MAX_LENGTH - 80;

  function insertEmoji(emoji: string) {
    const field = textareaRef.current;
    if (!field) {
      setText((current) => (current + emoji).slice(0, PROFILE_COMMENT_MAX_LENGTH));
      return;
    }
    const start = field.selectionStart ?? text.length;
    const end = field.selectionEnd ?? text.length;
    const next = (text.slice(0, start) + emoji + text.slice(end)).slice(0, PROFILE_COMMENT_MAX_LENGTH);
    setText(next);
    requestAnimationFrame(() => {
      field.focus();
      const caret = Math.min(start + emoji.length, next.length);
      field.setSelectionRange(caret, caret);
    });
  }

  function pickGif(result: GifResult) {
    setGifOpen(false);
    setGif({ url: result.url, width: result.width, height: result.height });
  }

  async function send() {
    if (!canSend) return;
    setSending(true);
    setError(null);
    const result = await postProfileComment(profileId, { text: trimmed, gif });
    setSending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    trackFeatureEvent(PROFILE_COMMENT_EVENTS.post, {
      feature: PROFILE_COMMENTS_FEATURE,
      value: (trimmed ? 1 : 0) + (gif ? 2 : 0),
    });
    setText("");
    setGif(null);
    onPosted(result.comment);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends, Shift+Enter breaks the line — the chat's rule. Not on a
    // touch keyboard, whose Enter is the only way to get a new line.
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && !isCoarsePointer()) {
      e.preventDefault();
      void send();
    }
  }

  return (
    <div className="mt-3">
      <div className="rounded-xl border border-zinc-300 bg-white transition focus-within:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => {
            setText(e.target.value.slice(0, PROFILE_COMMENT_MAX_LENGTH));
            if (error) setError(null);
          }}
          onKeyDown={onKeyDown}
          rows={compact ? 1 : 2}
          maxLength={PROFILE_COMMENT_MAX_LENGTH}
          placeholder={t("profileComments.placeholder")}
          aria-label={t("profileComments.placeholder")}
          className="block max-h-40 min-h-9 w-full resize-none bg-transparent px-3 py-2 text-base text-zinc-950 outline-none [field-sizing:content] placeholder:text-zinc-400 sm:text-sm dark:text-zinc-50 dark:placeholder:text-zinc-500"
        />
        {gif && (
          <div className="px-3 pb-2">
            <div className="relative inline-block">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={gif.url} alt="GIF" className="max-h-32 rounded-lg" />
              <button
                type="button"
                onClick={() => setGif(null)}
                aria-label={t("profileComments.removeGif")}
                className="absolute right-1 top-1 flex cursor-pointer rounded-full bg-black/60 p-1 text-white transition hover:bg-black/80"
              >
                <MdClose className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}
        <div className="flex items-center gap-1 border-t border-zinc-200 px-1.5 py-1 dark:border-zinc-800">
          <Popover
            open={gifOpen}
            onClose={() => setGifOpen(false)}
            placement="bottom-start"
            tooltip={t("chatPanel.addGif")}
            content={<GifPicker onSelect={pickGif} />}
          >
            <button
              type="button"
              onClick={() => {
                if (!gifOpen) trackFeatureEvent(PROFILE_COMMENT_EVENTS.gifOpen, { feature: PROFILE_COMMENTS_FEATURE });
                setGifOpen(!gifOpen);
              }}
              aria-label={t("chatPanel.addGif")}
              className="inline-flex h-8 cursor-pointer items-center justify-center rounded-lg px-2 text-xs font-bold text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            >
              GIF
            </button>
          </Popover>
          <EmojiPickerButton
            onPick={insertEmoji}
            iconSize={18}
            className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-zinc-500 transition hover:bg-zinc-100 dark:hover:bg-zinc-800"
          />
          <span className="ml-auto" />
          {nearLimit && (
            <span className="px-1 text-[11px] tabular-nums text-zinc-400">
              {text.length}/{PROFILE_COMMENT_MAX_LENGTH}
            </span>
          )}
          <button
            type="button"
            onClick={() => void send()}
            disabled={!canSend}
            aria-label={t("common.send")}
            className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg bg-zinc-950 px-3 text-xs font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
          >
            <MdSend className="h-3.5 w-3.5" />
            {t("profileComments.post")}
          </button>
        </div>
      </div>
      {error && <p className="mt-1.5 text-xs font-medium text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------

function CommentItem({
  comment,
  compact,
  canDelete,
  canBlock,
  onDelete,
  onBlock,
}: {
  comment: ProfileComment;
  compact: boolean;
  canDelete: boolean;
  canBlock: boolean;
  onDelete: () => void;
  onBlock: () => void;
}) {
  const { t } = useI18n();
  const [menuOpen, setMenuOpen] = useState(false);
  const { author } = comment;
  const nameStyle = nameStyleOf(author.nameColor);
  const href = `/user/${encodeURIComponent(author.username)}`;
  // In the room's popup a profile link opens a tab: following it in place
  // would take somebody out of the call they are in.
  const linkProps = compact ? { target: "_blank" as const, rel: "noopener" } : {};
  const gifRatio = comment.gif && comment.gif.width > 0 && comment.gif.height > 0
    ? `${comment.gif.width} / ${comment.gif.height}`
    : undefined;

  return (
    <li className="group/comment flex gap-3">
      <Link href={href} {...linkProps} className="shrink-0">
        <UserAvatar src={author.avatarUrl} name={author.displayName} size={36} />
      </Link>
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-sm">
            <Link
              href={href}
              {...linkProps}
              className="flex min-w-0 items-center gap-1 font-semibold text-zinc-900 hover:underline dark:text-zinc-100"
            >
              <span className={`truncate ${nameStyle.className ?? ""}`} style={nameStyle.style}>
                {author.displayName}
              </span>
              <VerifiedBadge flags={author.flags} className="h-3.5 w-3.5 shrink-0" />
            </Link>
            {author.bot && <BotTag />}
            <span className="truncate text-xs text-zinc-500 dark:text-zinc-400">@{author.username}</span>
            <span aria-hidden className="text-xs text-zinc-400 dark:text-zinc-600">·</span>
            <time
              dateTime={new Date(comment.ts).toISOString()}
              title={new Date(comment.ts).toLocaleString(formatLocale())}
              className="text-xs text-zinc-400 dark:text-zinc-500"
            >
              {relativeTime(comment.ts)}
            </time>
          </div>
          {(canDelete || canBlock) && (
            <Popover
              open={menuOpen}
              onClose={() => setMenuOpen(false)}
              placement="bottom-end"
              content={
                <div className="flex w-56 flex-col gap-0.5 rounded-xl border border-zinc-200 bg-white p-1.5 shadow-lg dark:border-zinc-800 dark:bg-zinc-950">
                  {canDelete && (
                    <button
                      type="button"
                      onClick={() => {
                        setMenuOpen(false);
                        onDelete();
                      }}
                      className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs font-medium text-red-600 transition hover:bg-red-500/10 dark:text-red-400"
                    >
                      <MdDeleteOutline className="h-4 w-4 shrink-0" />
                      {t("profileComments.delete")}
                    </button>
                  )}
                  {canBlock && (
                    <button
                      type="button"
                      onClick={() => {
                        setMenuOpen(false);
                        onBlock();
                      }}
                      className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs font-medium text-zinc-700 transition hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-900"
                    >
                      <MdBlock className="h-4 w-4 shrink-0" />
                      {t("profileComments.blockFromCommenting")}
                    </button>
                  )}
                </div>
              }
            >
              <button
                type="button"
                onClick={() => setMenuOpen((open) => !open)}
                aria-label={t("profileComments.options")}
                aria-expanded={menuOpen}
                // Dimmed until the row is hovered, never hidden: a control that
                // only exists on hover cannot be found on a phone.
                className="-mr-1 flex shrink-0 cursor-pointer rounded-lg p-1 text-zinc-400 opacity-60 transition hover:bg-zinc-100 hover:text-zinc-700 group-hover/comment:opacity-100 dark:hover:bg-zinc-900 dark:hover:text-zinc-200"
              >
                <MdMoreHoriz className="h-4 w-4" />
              </button>
            </Popover>
          )}
        </div>
        {comment.text && (
          <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-zinc-800 dark:text-zinc-200">
            {comment.text}
          </p>
        )}
        {comment.gif && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={comment.gif.url}
            alt="GIF"
            loading="lazy"
            className="mt-1.5 max-h-56 max-w-full rounded-lg bg-zinc-100 dark:bg-zinc-900"
            style={gifRatio ? { aspectRatio: gifRatio, height: "auto" } : undefined}
          />
        )}
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------

function OwnerSettings({
  onChanged,
  onUnblocked,
}: {
  onChanged: (disabled: boolean) => void;
  onUnblocked: () => void;
}) {
  const { t } = useI18n();
  const [settings, setSettings] = useState<{ disabled: boolean; blocked: ProfileCommentUser[] } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetchProfileCommentSettings().then((result) => {
      if (!cancelled) setSettings(result ?? { disabled: false, blocked: [] });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function toggle() {
    if (!settings || saving) return;
    const disabled = !settings.disabled;
    setSaving(true);
    const ok = await setProfileCommentsDisabled(disabled);
    setSaving(false);
    if (!ok) return;
    setSettings({ ...settings, disabled });
    trackFeatureEvent(disabled ? PROFILE_COMMENT_EVENTS.toggleOff : PROFILE_COMMENT_EVENTS.toggleOn, {
      feature: PROFILE_COMMENTS_FEATURE,
    });
    onChanged(disabled);
  }

  async function unblock(user: ProfileCommentUser) {
    if (!settings) return;
    const ok = await unblockProfileCommenter(user.id);
    if (!ok) return;
    setSettings({ ...settings, blocked: settings.blocked.filter((u) => u.id !== user.id) });
    onUnblocked();
  }

  const on = settings ? !settings.disabled : true;

  return (
    <div className="flex w-72 max-w-[calc(100vw-1rem)] flex-col gap-2 rounded-xl border border-zinc-200 bg-white p-3 shadow-lg dark:border-zinc-800 dark:bg-zinc-950">
      <button
        type="button"
        role="switch"
        aria-checked={on}
        disabled={!settings || saving}
        onClick={() => void toggle()}
        className="flex cursor-pointer items-start justify-between gap-3 rounded-lg p-1 text-left disabled:cursor-wait disabled:opacity-60"
      >
        <span className="min-w-0">
          <span className="block text-sm font-medium text-zinc-900 dark:text-zinc-100">
            {t("profileComments.allowComments")}
          </span>
          <span className="mt-0.5 block text-xs text-zinc-500 dark:text-zinc-400">
            {t("profileComments.allowCommentsHint")}
          </span>
        </span>
        <span
          aria-hidden
          className={`relative mt-0.5 inline-flex h-5 w-9 shrink-0 rounded-full transition ${
            on ? "bg-emerald-500" : "bg-zinc-300 dark:bg-zinc-700"
          }`}
        >
          <span
            className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${on ? "left-[1.125rem]" : "left-0.5"}`}
          />
        </span>
      </button>

      <div className="border-t border-zinc-200 pt-2 dark:border-zinc-800">
        <p className="px-1 text-xs font-medium text-zinc-700 dark:text-zinc-300">
          {t("profileComments.blockedTitle")}
        </p>
        {!settings ? (
          <p className="px-1 pt-1.5 text-xs text-zinc-400">{t("common.loading")}</p>
        ) : settings.blocked.length === 0 ? (
          <p className="px-1 pt-1.5 text-xs text-zinc-400 dark:text-zinc-500">{t("profileComments.blockedEmpty")}</p>
        ) : (
          <ul className="mt-1.5 flex max-h-48 flex-col gap-1 overflow-y-auto">
            {settings.blocked.map((user) => (
              <li key={user.id} className="flex items-center gap-2 rounded-lg px-1 py-1">
                <UserAvatar src={user.avatarUrl} name={user.displayName} size={24} />
                <span className="min-w-0 flex-1 truncate text-xs text-zinc-800 dark:text-zinc-200">
                  {user.displayName}
                  <span className="ml-1 text-zinc-400">@{user.username}</span>
                </span>
                <button
                  type="button"
                  onClick={() => void unblock(user)}
                  className="shrink-0 cursor-pointer rounded-md px-2 py-1 text-[11px] font-medium text-zinc-600 transition hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-900"
                >
                  {t("common.unblock")}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
