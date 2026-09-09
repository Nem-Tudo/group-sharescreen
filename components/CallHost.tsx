"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { MdCall, MdCallEnd } from "react-icons/md";
import { useAuth } from "@/lib/AuthContext";
import { useSignaling } from "@/lib/useSignaling";
import { signalingClient } from "@/lib/signalingClient";
import { acceptCall, endCall, fetchPendingCalls } from "@/lib/callsApi";
import { showNotification } from "@/lib/notifications";
import { upsertNotification } from "@/lib/notificationInbox";
import { getDesktopBridge } from "@/lib/desktop";
import { startRingtone, stopRingtone } from "@/lib/soundEffects";
import { DEFAULT_AVATAR_PATH, UserAvatar } from "@/components/UserAvatar";
import { isCallRoomHandle } from "@/lib/roomsApi";
import { recentRoomPresentation } from "@/lib/recentRooms";

// The ringing screen — both directions of it.
//
// Mounted once at the layout root, like DirectMessagesHost and for the same
// reason squared: a call arrives whenever it arrives, and it has to be
// answerable from wherever the person happens to be — the home page, a room,
// the friends list. A ring that only appeared on one page would be a phone
// that only rings while you are looking at it.
//
// What it deliberately does *not* do is any calling. Answering is one request;
// everything after it is an ordinary private room (see the API's callStore),
// so this component's whole job ends at router.push. There is no media here,
// no peer connection, nothing to tear down — which is why "the call dropped
// but the room stayed up" cannot happen.

/** How the ring is announced on a device that is open but not being watched. */
const CALL_NOTIFICATION_TAG = "call";

/**
 * The caller's picture as a URL that works outside this page.
 *
 * The shell's ringing window loads from `file://`, so anything site-relative —
 * including the default avatar every account without one falls back to — has
 * to be resolved against this origin first.
 */
function absoluteAvatar(avatarUrl: string | null): string | null {
  if (typeof window === "undefined") return avatarUrl;
  try {
    return new URL(avatarUrl || DEFAULT_AVATAR_PATH, window.location.origin).href;
  } catch {
    return avatarUrl;
  }
}

/**
 * What to say about a call that stopped ringing.
 *
 * Only two of the four reasons say anything. A "cancelled" is the caller's own
 * doing and a "declined" is the callee's, so each of them is told nothing they
 * did not just do — what is left is the caller learning their call was refused,
 * and the caller learning nobody picked up.
 */
function noticeFor(reason: string | null): string | null {
  if (reason === "declined") return "Chamada recusada.";
  if (reason === "timeout") return "Ninguém atendeu.";
  return null;
}

export function CallHost() {
  const { account } = useAuth();
  const router = useRouter();
  const {
    incomingCalls,
    outgoingCall,
    callAccepted,
    callAcceptedSeq,
    callEnded,
    callEndedSeq,
  } = useSignaling();
  // The one on screen, and how many are behind it. Only the front is
  // answerable: two "atender" buttons under a ringtone is a choice nobody
  // makes correctly, and the queue is oldest-first precisely so this never
  // changes under a hand already reaching for it (see SignalingState).
  const incomingCall = incomingCalls[0] ?? null;
  const waiting = Math.max(0, incomingCalls.length - 1);

  const [busy, setBusy] = useState(false);
  // The refusal being typed, and which call it belongs to.
  //
  // Tagged with the call id rather than cleared by an effect: a second call
  // arriving while somebody is mid-sentence must not inherit the sentence, and
  // comparing ids answers that during render instead of one paint later.
  const [reason, setReason] = useState<{ callId: string; text: string } | null>(null);

  // ─── The passing remark under the ring ──────────────────────────────────
  //
  // "Chamada recusada", "ninguém atendeu" — a sentence about a call that just
  // stopped, shown for a few seconds and then gone.
  //
  // Derived while rendering rather than assigned from an effect, which is
  // React's own answer for state that is a function of something that
  // arrived: the two counters are what say "this is a *new* event and not the
  // one already on screen", so comparing them here is the whole computation.
  // Doing it in an effect would render once with the stale sentence and then
  // again with the right one, which for a banner that appears for four
  // seconds is a visible flash of the previous call's outcome.
  const [notice, setNotice] = useState<{
    endedSeq: number;
    acceptedSeq: number;
    text: string | null;
    /**
     * The call this device hung up on itself, either end of it.
     *
     * Carried in the same state as the sentence it suppresses rather than in a
     * ref, because it is read while deciding what to render — which is exactly
     * what a ref must not be used for. Only the last one is kept: you can only
     * hang up on one call at a time, and the notice is always about the most
     * recent thing that happened.
     */
    selfEnded: string | null;
    /**
     * A refusal that came with an explanation, kept until it is dismissed.
     *
     * Its own field rather than a longer `text`, because it has a different
     * lifetime and a different shape. The sentence above is a remark that
     * takes itself down after four seconds; this is something another person
     * wrote *to you*, and taking it off the screen before it has been read —
     * or truncating it into a toast — is losing it.
     */
    declined: { name: string; avatarUrl: string | null; note: string } | null;
  }>({ endedSeq: 0, acceptedSeq: 0, text: null, selfEnded: null, declined: null });

  if (notice.endedSeq !== callEndedSeq || notice.acceptedSeq !== callAcceptedSeq) {
    // "call-ended" goes to both people, so the one who pressed "recusar" would
    // otherwise be told "Chamada recusada." about their own press. Both of the
    // screens below exist for the *other* end, which has no idea why the
    // ringing stopped.
    const mine = Boolean(callEnded && callEnded.callId === notice.selfEnded);
    // A call that was answered leaves nothing to say — both people are on their
    // way into the room — and it also clears whatever the previous call left
    // behind, so "chamada recusada" does not follow somebody into a call that
    // is starting perfectly well.
    const answered = notice.acceptedSeq !== callAcceptedSeq;
    // A refusal somebody bothered to explain is the one outcome that gets a
    // screen of its own: it is a message, and a message deserves better than
    // four seconds in a corner.
    const explained =
      !mine && !answered && callEnded?.reason === "declined" && callEnded.note
        ? {
            name: callEnded.by?.displayName ?? "Alguém",
            avatarUrl: callEnded.by?.avatarUrl ?? null,
            note: callEnded.note,
          }
        : null;

    setNotice({
      endedSeq: callEndedSeq,
      acceptedSeq: callAcceptedSeq,
      text: mine || answered || explained ? null : noticeFor(callEnded?.reason ?? null),
      selfEnded: notice.selfEnded,
      // Kept across an unrelated event so a "ninguém atendeu" from the next
      // call does not wipe a refusal still sitting unread. Answering a call is
      // the one thing that does clear it: you are walking into a room.
      declined: explained ?? (answered ? null : notice.declined),
    });
  }
  const noticeText = notice.text;
  const declined = notice.declined;

  // ─── Cold start ─────────────────────────────────────────────────────────
  //
  // The half that makes "with the app closed" mean anything: a notification is
  // tapped, the app starts with no socket and nothing on screen, and this asks
  // the API what is still ringing. Also covers the ordinary case of a socket
  // that reconnected across the ring — the live message went to a connection
  // that no longer exists, and only this finds the call again.
  useEffect(() => {
    if (!account) return;
    const controller = new AbortController();
    void (async () => {
      const pending = await fetchPendingCalls(controller.signal);
      if (!pending) return;
      signalingClient.adoptCalls(pending.incoming, pending.outgoing[0] ?? null);
    })();
    return () => controller.abort();
  }, [account]);

  // Re-asked whenever the app comes back to the front. A phone that was in a
  // pocket for the whole ring has a socket that heard everything and a page
  // that heard none of it.
  useEffect(() => {
    if (!account) return;
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      void fetchPendingCalls().then((pending) => {
        if (!pending) return;
        signalingClient.adoptCalls(pending.incoming, pending.outgoing[0] ?? null);
      });
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [account]);

  // ─── Ringing ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (incomingCall) startRingtone("incoming");
    else if (outgoingCall) startRingtone("outgoing");
    else stopRingtone();

    // And the desktop shell, whose window may be sitting in the tray with
    // nothing on screen at all — see electron/main.ts's setCallRinging. Only
    // for an *incoming* call: the person placing one is looking at the app by
    // definition, and a window that flashes at somebody who just pressed
    // "ligar" is flashing at them about their own action.
    // Who, not just whether: with the window closed to the tray the shell
    // draws the ring itself, and it cannot do that without a name and a face
    // (see electron/main.ts's openCallWindow).
    getDesktopBridge()?.setCallRinging?.(
      incomingCall
        ? {
            id: incomingCall.id,
            name: incomingCall.from.displayName,
            // Resolved here rather than passed through raw, and absolute
            // rather than site-relative. Two different bugs in one line:
            //
            // Most accounts have no avatar of their own, and UserAvatar quietly
            // falls back to the default picture — so the ring inside the app
            // always showed a face while the shell's window, handed a bare
            // null, showed nothing at all. Doing the same fallback here is what
            // makes the two windows agree.
            //
            // And the shell's window is a local file: a site-relative path
            // there resolves against `file://`, not against the site, so even
            // a real avatar would have to be absolute to load.
            avatarUrl: absoluteAvatar(incomingCall.from.avatarUrl),
          }
        : null
    );

    // Not only on unmount: this component never unmounts, so the cleanup that
    // matters is the one that runs when the call it was ringing for is gone.
    return () => {
      stopRingtone();
      getDesktopBridge()?.setCallRinging?.(null);
    };
  }, [incomingCall, outgoingCall]);

  // A device that is open but behind something else still deserves a system
  // notification — the push was skipped precisely *because* this device is
  // online (see the API's isAccountDeviceOnline), so this is the alert that
  // stands in for it. showNotification stays quiet when the page is focused,
  // which is exactly when the screen below is already on top of everything.
  const announcedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const call of incomingCalls) {
      // Every call, not only the one on screen: somebody ringing behind a call
      // already showing is exactly the person who would otherwise go
      // unannounced, and they are the reason the queue exists.
      if (announcedRef.current.has(call.id)) continue;
      announcedRef.current.add(call.id);
      void showNotification({
        title: `${call.from.displayName} está te ligando`,
        body: "Toque para atender.",
        // Per call, so a second caller does not silently replace the first
        // one's notification the way a shared tag would.
        tag: `${CALL_NOTIFICATION_TAG}:${call.id}`,
        icon: call.from.avatarUrl ?? undefined,
        requireInteraction: true,
        // A ring is the one alert in this app that outranks the local mute: a
        // person who silenced chat notifications did not thereby say they never
        // want to know somebody is calling them.
        ignoreMutePreference: true,
        onClick: () => window.focus(),
      });
    }
  }, [incomingCalls]);

  // ─── Walking into the room ──────────────────────────────────────────────
  //
  // Both sides receive "call-accepted", so both sides run this — which is what
  // makes "we end up in the same room" one message rather than a negotiation.
  const lastAcceptedRef = useRef(0);
  useEffect(() => {
    if (callAcceptedSeq === lastAcceptedRef.current) return;
    lastAcceptedRef.current = callAcceptedSeq;
    if (!callAccepted) return;
    stopRingtone();
    router.push(`/watch/${callAccepted.roomHandle}`);
  }, [callAccepted, callAcceptedSeq, router]);

  // A notice is a passing remark, not a state: it takes itself down so there
  // is never a stale "ninguém atendeu" sitting over the next call. The
  // setState is inside the timer rather than in the effect body, which is
  // both what the rule wants and what this actually means — the change
  // happens four seconds later, not now.
  useEffect(() => {
    if (!noticeText) return;
    const timer = setTimeout(
      () => setNotice((current) => ({ ...current, text: null })),
      4000
    );
    return () => clearTimeout(timer);
  }, [noticeText]);

  const onAccept = useCallback(async () => {
    if (!incomingCall || busy) return;
    setBusy(true);
    stopRingtone();
    const result = await acceptCall(incomingCall.id);
    setBusy(false);
    if (!result.ok) {
      // Taken off screen either way: whatever the reason, this call is not
      // ringing any more, and leaving the buttons up would offer to answer
      // something that no longer exists.
      signalingClient.clearCall(incomingCall.id);
      setNotice((current) => ({ ...current, text: result.error }));
      return;
    }
    signalingClient.clearCall(incomingCall.id);
    // Navigated here as well as from the socket message above: on a cold start
    // the socket may not even be connected yet, and the person who pressed
    // "atender" must not be left looking at a button that did nothing.
    router.push(`/watch/${result.roomHandle}`);
  }, [busy, incomingCall, router]);

  const onDecline = useCallback(
    (reason?: string) => {
      if (!incomingCall) return;
      stopRingtone();
      setNotice((current) => ({ ...current, selfEnded: incomingCall.id }));
      signalingClient.clearCall(incomingCall.id);
      void endCall(incomingCall.id, "decline", reason).then((result) => {
        // The refusal went through either way — only the sentence did not.
        // Said out loud rather than swallowed: somebody who typed an
        // explanation should not be left believing it was delivered.
        if (!result.noteDropped) return;
        setNotice((current) => ({
          ...current,
          text: "Recusada, mas seu motivo não pôde ser enviado.",
        }));
      });
    },
    [incomingCall]
  );

  const onCancel = useCallback(() => {
    if (!outgoingCall) return;
    stopRingtone();
    setNotice((current) => ({ ...current, selfEnded: outgoingCall.id }));
    signalingClient.clearCall(outgoingCall.id);
    void endCall(outgoingCall.id, "cancel");
  }, [outgoingCall]);

  // ─── A call that rang out ───────────────────────────────────────────────
  //
  // The bell is for things that happened while you were not looking, and a
  // call nobody answered is the clearest example there is: the ringing screen
  // took itself down when it timed out, so without this the only trace of
  // somebody trying to reach you would be a sound you may not have been near.
  //
  // Only the *callee*, and only on a timeout. "Recusada" and "cancelada" are
  // things one of the two people did on purpose and already know about, and
  // the caller learning nobody picked up is told so on screen at the time.
  // Which end this client was is the one thing the message has to say, because
  // by the time it lands the call it describes is already gone from state.
  const lastMissedRef = useRef(0);
  useEffect(() => {
    if (callEndedSeq === lastMissedRef.current) return;
    lastMissedRef.current = callEndedSeq;
    if (!account || !callEnded || callEnded.reason !== "timeout") return;
    if (callEnded.calleeId !== account.id) return;
    const caller = callEnded.caller;
    if (!caller) return;
    // Keyed by the caller rather than by the call, and upserted: three missed
    // calls from one person is one row carrying the newest of them, the same
    // way a burst of messages is (see DmNotifier). No sound — the phone was
    // already ringing, which was the announcement.
    upsertNotification({
      id: `call-missed:${caller.id}`,
      kind: "call-missed",
      title: "Chamada perdida",
      body: `${caller.displayName} te ligou.`,
      userId: caller.id,
    });
  }, [account, callEnded, callEndedSeq]);

  // ─── Answered from the shell's own window ───────────────────────────────
  //
  // With the desktop app closed to the tray there is nothing of ours on
  // screen, so the shell draws the ring in a small window of its own — and
  // that window has no session to answer with. It reports the press here, and
  // this page, which never stopped running, does the actual accepting.
  useEffect(() => {
    const bridge = getDesktopBridge();
    if (!bridge?.onCallAction) return;
    return bridge.onCallAction((action) => {
      if (action.action === "accept") void onAccept();
      else onDecline(action.reason);
    });
  }, [onAccept, onDecline]);

  if (!account) return null;

  // Incoming wins over outgoing when somehow both exist: being asked something
  // outranks waiting for an answer.
  const call = incomingCall ?? outgoingCall;
  if (!call && !noticeText && !declined) return null;

  const isIncoming = incomingCall !== null;
  // Whether this ring ends in a room that already exists — somebody pulling
  // you into where they are — rather than in one minted for the two of you.
  //
  // Derived from the handle instead of a flag on the wire: a generated call
  // room has a shape nothing else has (see the API's makeCallRoomHandle and
  // isCallRoomHandle), so anything that is *not* one is a real room with a
  // name somebody chose. Worth saying out loud on the card, because walking
  // into a room with five people in it is a different decision from answering
  // a call.
  const invitedRoom =
    call && !isCallRoomHandle(call.roomHandle)
      ? recentRoomPresentation(call.roomHandle).name
      : null;
  // Narrowed rather than asserted. The guard above lets `call` through as null
  // whenever there is a notice to show — which is every decline, every
  // "ninguém atendeu", every refusal — and the non-null assertion that used to
  // stand here turned exactly those moments into a crash.
  const other = call ? (isIncoming ? call.from : call.to) : null;

  // What is typed in the refusal box, but only if it belongs to the call on
  // screen — a second call arriving must not inherit the previous one's text.
  const reasonText = call && reason?.callId === call.id ? reason.text : "";

  return (
    <div
      // Centred, and above every dialog in the app including the room's own:
      // a call is the one thing that may interrupt anything.
      //
      // The wrapper itself lets clicks through, so the app behind stays usable
      // while *you* are the one calling — waiting for an answer is not a
      // reason to freeze somebody's screen. Being asked is: the incoming ring
      // lays a backdrop over everything, because there is a question on screen
      // and it wants answering.
      className="pointer-events-none fixed inset-0 z-[100] flex items-center justify-center p-4"
      role="alert"
      aria-live="assertive"
    >
      {/* A backdrop for the two things that are asking something of you: a
          ring waiting to be answered, and a message waiting to be read.
          Never for "chamando…", where freezing the app would punish somebody
          for the crime of calling. */}
      {(isIncoming || (!call && declined)) && (
        <div
          aria-hidden
          className="pointer-events-auto absolute inset-0 bg-black/50 backdrop-blur-[2px]"
        />
      )}
      {call && other ? (
        <div className="pointer-events-auto relative w-full max-w-sm overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-900">
          <div className="flex flex-col items-center gap-3 px-6 pb-5 pt-7 text-center">
            <UserAvatar
              src={other.avatarUrl}
              name={other.displayName}
              size={80}
              userId={other.id}
              presenceSurface="dialog"
              // Only the incoming ring pulses. The caller's own screen is a
              // status, not a summons.
              className={isIncoming ? "animate-pulse" : ""}
            />
            <div className="w-full min-w-0">
              <p className="truncate text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                {other.displayName}
              </p>
              <p className="truncate text-sm text-zinc-500 dark:text-zinc-400">
                {isIncoming
                  ? invitedRoom
                    ? `está te chamando para a sala ${invitedRoom}`
                    : "está te ligando…"
                  : "chamando…"}
              </p>
              {/* Only ever shown while somebody really is waiting behind this
                  one. Not a control: the call in front has to be answered or
                  refused first, and offering a way to skip the queue would be
                  offering a way to answer the wrong person. */}
              {waiting > 0 && (
                <p className="mt-1 text-xs font-medium text-amber-600 dark:text-amber-500">
                  {waiting === 1
                    ? "+1 chamada esperando"
                    : `+${waiting} chamadas esperando`}
                </p>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-2 border-t border-zinc-100 p-3 dark:border-zinc-800">
            {isIncoming ? (
              <>
                {/* Always here, and doing nothing until it is typed in.
                    "Recusar" reads whatever is in it — empty means a refusal
                    with no explanation, which is the ordinary case and needs
                    no extra press to reach.

                    Enter refuses too, so a typed sentence does not then have
                    to hunt for a button. Shift+Enter breaks a line, which is
                    why this is a textarea and not an input: five hundred
                    characters on one scrolling line is a field nobody can
                    read back. */}
                <textarea
                  rows={2}
                  value={reasonText}
                  onChange={(event) =>
                    setReason({ callId: call.id, text: event.target.value.slice(0, 500) })
                  }
                  // The ringtone stops at the first keystroke, not on focus: a
                  // field that is always on screen collects stray focus, and
                  // silencing the ring because a tab landed there would be a
                  // call quietly going quiet on its own.
                  onKeyDown={(event) => {
                    stopRingtone();
                    if (event.key !== "Enter" || event.shiftKey) return;
                    event.preventDefault();
                    onDecline(reasonText.trim() || undefined);
                  }}
                  maxLength={500}
                  placeholder="Motivo da recusa (opcional)"
                  aria-label="Motivo da recusa (opcional)"
                  className="w-full resize-none rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:placeholder:text-zinc-500 dark:focus:border-zinc-500"
                />

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => onDecline(reasonText.trim() || undefined)}
                    className="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl bg-zinc-100 px-4 py-2.5 font-medium text-zinc-700 transition hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
                  >
                    <MdCallEnd className="h-5 w-5" />
                    Recusar
                  </button>
                  <button
                    type="button"
                    onClick={onAccept}
                    disabled={busy}
                    className="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 font-medium text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <MdCall className="h-5 w-5" />
                    Atender
                  </button>
                </div>

              </>
            ) : (
              <button
                type="button"
                onClick={onCancel}
                className="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl bg-red-600 px-4 py-2.5 font-medium text-white transition hover:bg-red-500"
              >
                <MdCallEnd className="h-5 w-5" />
                Cancelar
              </button>
            )}
          </div>
        </div>
      ) : declined ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`${declined.name} recusou sua chamada`}
          className="pointer-events-auto relative w-full max-w-sm overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-900"
        >
          <div className="flex flex-col items-center gap-3 px-6 pb-4 pt-7 text-center">
            <UserAvatar src={declined.avatarUrl} name={declined.name} size={64} />
            <div className="w-full min-w-0">
              <p className="truncate text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                {declined.name}
              </p>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">recusou sua chamada</p>
            </div>
          </div>

          {/* The sentence itself, quoted rather than run into the line above:
              it is the other person's words and not the app's. `whitespace-
              pre-wrap` keeps the line breaks they typed, and the scroll cap
              keeps five hundred characters from pushing the button off a
              phone screen. */}
          <p className="mx-6 max-h-48 overflow-y-auto whitespace-pre-wrap break-words rounded-xl bg-zinc-100 px-4 py-3 text-sm text-zinc-800 dark:bg-zinc-800/70 dark:text-zinc-100">
            {declined.note}
          </p>

          <div className="p-3">
            <button
              type="button"
              autoFocus
              onClick={() => setNotice((current) => ({ ...current, declined: null }))}
              className="w-full cursor-pointer rounded-xl bg-zinc-900 px-4 py-2.5 font-medium text-white transition hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
            >
              Entendi
            </button>
          </div>
        </div>
      ) : (
        <div className="pointer-events-auto max-w-sm rounded-xl border border-zinc-200 bg-white px-4 py-2.5 text-center text-sm text-zinc-600 shadow-lg dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
          {noticeText}
        </div>
      )}
    </div>
  );
}
