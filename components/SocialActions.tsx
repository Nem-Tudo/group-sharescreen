"use client";

import { useState } from "react";
import {
  MdBlock,
  MdCall,
  MdChatBubbleOutline,
  MdCheck,
  MdClose,
  MdPersonAdd,
  MdPersonRemove,
} from "react-icons/md";
import { useAuth } from "@/lib/AuthContext";
import {
  acceptFriend,
  addFriend,
  blockUser,
  removeFriend,
  unblockUser,
} from "@/lib/socialApi";
import { openDirectMessages } from "@/lib/dmWindow";
import { startCall } from "@/lib/callsApi";
import { AccountModal, type AccountModalMode } from "@/components/AccountModal";
import { Tooltip } from "@/components/Tooltip";

const BUTTON_BASE =
  "flex cursor-pointer items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50";

/**
 * The three actions shown when none of them can be used.
 *
 * Deliberately only three of the five: "bloquear" and "desfazer amizade" are
 * about a relationship that cannot exist here, so offering them greyed out
 * would be describing a state nobody is in. These three are the ones somebody
 * came to the profile wanting.
 */
const DISABLED_ACTIONS = [
  { get label() { return translate("common.message"); }, Icon: MdChatBubbleOutline },
  { get label() { return translate("common.turnOn"); }, Icon: MdCall },
  { get label() { return translate("common.add"); }, Icon: MdPersonAdd },
] as const;
import { relationshipWith, useSocialGraph } from "@/lib/useSocialGraph";
import { useT } from "@/lib/useI18n";
import { translate } from "@/lib/i18n";

// The friend/block controls for one person, wherever that person is shown.
//
// One component rather than a button per surface, because the interesting part
// is not the button — it is that there are five states and each one offers a
// different thing. A profile that shows "adicionar" to somebody who already
// sent *you* a request is a profile that makes you send a second request for a
// friendship you could have accepted.
//
// Renders nothing at all for your own card. For everything else it renders
// the same three buttons — and that is the point of `unavailable`: when the
// actions cannot be used, they are shown disabled and explaining themselves
// rather than removed.
//
// Removing them was what this did before, in the two cases where an account is
// missing on one side or the other, and it left the same hole both times:
// somebody with no account saw a profile with nothing to do on it and no hint
// that there was ever anything to do, so "why can't I message this person" had
// no answer anywhere on screen. A disabled button with a reason on it is the
// answer, in the place the question is asked.

export function SocialActions({
  userId,
  displayName,
  className = "",
  onLeave,
  unavailable,
}: {
  userId: string;
  displayName: string;
  className?: string;
  /**
   * Called when something here replaces this card with another surface.
   *
   * Only "mensagem" does that today: it opens the conversation window, and
   * inside a room that window would otherwise land *behind* the profile
   * dialog that launched it. The dialog closing is part of the action, not a
   * detail the caller should have to arrange.
   */
  onLeave?: () => void;
  /**
   * Why none of this can be used, when it cannot — e.g. the person being
   * looked at is a guest and has no account to attach a friendship to.
   *
   * The viewer having no account is *not* passed in: this component already
   * knows who is looking, and every caller would otherwise have to remember
   * to ask.
   */
  unavailable?: string;
}) {
  const t = useT();
  const { account } = useAuth();
  const { graph, refresh } = useSocialGraph();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accountModal, setAccountModal] = useState<AccountModalMode | null>(null);

  // Your own card is the one case with genuinely nothing to show: there is no
  // version of "adicionar" that means anything pointed at yourself.
  if (account && account.id === userId) return null;

  // Two ways for these to be unusable, and they are not the same sentence.
  // The caller's reason is about the *other* person; a missing account here is
  // about you, and is the one of the two that can be fixed from this screen.
  const guestViewer = !account;
  const blocked = unavailable ?? (guestViewer ? t("socialActions.youNeedToCreateAnAccount") : null);

  if (blocked) {
    return (
      <div className={`flex flex-col gap-1.5 ${className}`}>
        <div className="flex flex-wrap items-center gap-2">
          {DISABLED_ACTIONS.map(({ label, Icon }) => (
            <Tooltip key={label} content={blocked} wrapperClassName="inline-flex">
              <button
                type="button"
                disabled
                className={`${BUTTON_BASE} border border-zinc-300 text-zinc-700 dark:border-zinc-700 dark:text-zinc-300`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {label}
              </button>
            </Tooltip>
          ))}
        </div>
        {guestViewer && (
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {t("socialActions.youNeedToCreateAnAccount2")}{" "}
            <button
              type="button"
              onClick={() => setAccountModal("create")}
              className="font-medium underline underline-offset-2"
            >
              {t("common.createAccount")}
            </button>
          </p>
        )}
        <AccountModal mode={accountModal} onModeChange={setAccountModal} />
      </div>
    );
  }

  const relationship = relationshipWith(graph, userId);

  async function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    const result = await action();
    if (!result.ok) setError(result.error ?? t("common.couldNotComplete"));
    // Re-read either way. A failure is often a failure *because* the graph
    // moved — they accepted while this button was being pressed — and the
    // screen showing the old state is what made the button wrong.
    refresh();
    setBusy(false);
  }

  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <div className="flex flex-wrap items-center gap-2">
        {relationship === "blocked" ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => run(() => unblockUser(userId))}
            className={`${BUTTON_BASE} border border-zinc-300 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900`}
          >
            <MdBlock className="h-4 w-4 shrink-0" />
            {t("common.unblock")}
          </button>
        ) : (
          <>
            {/* Messaging does not wait on a friendship — blocking is what
                says "not from you" (see the API's dmRoutes). Opens the window
                rather than navigating, so this works from inside a room. */}
            <button
              type="button"
              onClick={() => {
                onLeave?.();
                openDirectMessages(userId);
              }}
              className={`${BUTTON_BASE} border border-zinc-300 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900`}
            >
              <MdChatBubbleOutline className="h-4 w-4 shrink-0" />
              {t("common.message")}
            </button>

            {/* Calling is gated exactly like messaging: a block refuses it and
                a friendship is not required (see the API's callRoutes). The
                ring itself is not this component's business — the request
                either starts one or says why it could not, and CallHost at the
                layout root draws everything after that. */}
            <button
              type="button"
              disabled={busy}
              // Deliberately without onLeave: unlike "mensagem", this opens
              // nothing that the profile card would be in front of, and
              // closing the card would take the error message with it on the
              // one path where there is something to say.
              onClick={() =>
                void run(async () => {
                  const result = await startCall(userId);
                  return result.ok ? { ok: true } : { ok: false, error: result.error };
                })
              }
              className={`${BUTTON_BASE} border border-emerald-600/40 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-500/40 dark:text-emerald-400 dark:hover:bg-emerald-950/40`}
            >
              <MdCall className="h-4 w-4 shrink-0" />
              {t("common.turnOn")}
            </button>

            {relationship === "none" && (
              <button
                type="button"
                disabled={busy}
                onClick={() => run(() => addFriend(userId))}
                className={`${BUTTON_BASE} bg-zinc-950 text-white hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200`}
              >
                <MdPersonAdd className="h-4 w-4 shrink-0" />
                {t("common.add")}
              </button>
            )}

            {relationship === "incoming" && (
              <>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => run(() => acceptFriend(userId))}
                  className={`${BUTTON_BASE} bg-emerald-600 text-white hover:bg-emerald-700`}
                >
                  <MdCheck className="h-4 w-4 shrink-0" />
                  {t("common.accept")}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => run(() => removeFriend(userId))}
                  className={`${BUTTON_BASE} border border-zinc-300 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900`}
                >
                  <MdClose className="h-4 w-4 shrink-0" />
                  {t("common.decline")}
                </button>
              </>
            )}

            {relationship === "outgoing" && (
              <button
                type="button"
                disabled={busy}
                onClick={() => run(() => removeFriend(userId))}
                className={`${BUTTON_BASE} border border-zinc-300 text-zinc-500 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-900`}
              >
                <MdClose className="h-4 w-4 shrink-0" />
                {t("socialActions.cancelRequest")}
              </button>
            )}

            {relationship === "friends" && (
              <button
                type="button"
                disabled={busy}
                onClick={() => run(() => removeFriend(userId))}
                className={`${BUTTON_BASE} border border-zinc-300 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900`}
              >
                <MdPersonRemove className="h-4 w-4 shrink-0" />
                {t("socialActions.unfriend")}
              </button>
            )}

            <button
              type="button"
              disabled={busy}
              // Confirmed, because it is the one action here that also throws
              // away an existing friendship (see the API's blockAccount) and
              // there is no undo that gets it back.
              onClick={() => {
                if (!window.confirm(t("socialActions.blockDisplayname", { displayName }))) return;
                void run(() => blockUser(userId));
              }}
              className={`${BUTTON_BASE} text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40`}
            >
              <MdBlock className="h-4 w-4 shrink-0" />
              {t("socialActions.block")}
            </button>
          </>
        )}
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}
