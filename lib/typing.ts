
import { translate } from "@/lib/i18n";// "Fulano está digitando..." — the pieces a chat needs on both ends of it.

/**
 * The line itself, shared by a room's chat (components/ChatPanel) and a
 * group's text rooms (components/groups/TextChannelView), so the two say it
 * the same way.
 */
export function formatTypingLabel(names: string[]): string {
  if (names.length === 1) return translate("typing.valueIsTyping", { value: names[0] });
  if (names.length === 2) return translate("typing.valueAndValue2AreTyping", { value: names[0], value2: names[1] });
  return translate("typing.lengthPeopleAreTyping", { length: names.length });
}

/**
 * The sending end: turns keystrokes into the few "typing"/"stopped" signals
 * the other screens actually need.
 *
 * True on the first keystroke of a burst and again every `refreshMs` while the
 * keys keep coming — so the receiving end, which expires somebody it has not
 * heard from, keeps a long message's writer on the line the whole way through.
 * False once the keys stop for `idleMs` or the box is emptied.
 *
 * Timers rather than timestamps: nothing here reads the clock, which is what
 * lets a component hold one without React's purity rules objecting.
 */
export interface TypingAnnouncer {
  /** The box's text after a change. */
  input(value: string): void;
  /**
   * The message was sent. Ends the burst without saying so: the message
   * arriving is what clears the line elsewhere, and saying "stopped" as well
   * would be one more request for nothing.
   */
  sent(): void;
  /**
   * The box is going away. Says "stopped" if a burst was announced, so nobody
   * waits out an expiry. Leaves the announcer usable — React's development
   * mode tears effects down and sets them up again on purpose.
   */
  dispose(): void;
}

export const TYPING_IDLE_MS = 3000;
export const TYPING_REFRESH_MS = 5000;

export function createTypingAnnouncer(
  announce: (typing: boolean) => void,
  { idleMs = TYPING_IDLE_MS, refreshMs = TYPING_REFRESH_MS }: { idleMs?: number; refreshMs?: number } = {}
): TypingAnnouncer {
  let active = false;
  // Set when refreshMs has passed since the last "true": the next keystroke
  // says it again.
  let due = false;
  let idle: ReturnType<typeof setTimeout> | null = null;
  let refresh: ReturnType<typeof setTimeout> | null = null;

  function stop(say: boolean) {
    if (idle) clearTimeout(idle);
    if (refresh) clearTimeout(refresh);
    idle = null;
    refresh = null;
    due = false;
    if (!active) return;
    active = false;
    if (say) announce(false);
  }

  return {
    input(value) {
      if (!value.trim()) {
        stop(true);
        return;
      }
      if (!active || due) {
        active = true;
        due = false;
        refresh = setTimeout(() => {
          due = true;
        }, refreshMs);
        announce(true);
      }
      if (idle) clearTimeout(idle);
      idle = setTimeout(() => stop(true), idleMs);
    },
    sent() {
      stop(false);
    },
    dispose() {
      stop(true);
    },
  };
}
