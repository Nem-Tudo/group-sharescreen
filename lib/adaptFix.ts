// Experiment "sq-adapt-fix": four repairs to the send path's adapters (lib/sendAdaptation),
// found reading the code on 2026-11-25. None of them shows in the reports' session
// averages, so they are measured against a control group instead of shipped blind. Only
// means anything to those in sq-new-send (see lib/classicSend). With it:
//
//   - A viewer back from a pause keeps what their link taught. Without it the link
//     adapter starts over with the height it was holding but not the bits it was short
//     at, so "the link has doubled" is true at once and the hold goes ~14 s later, on a
//     link that is as short as it was.
//   - A connection that changes codec keeps it too, and one that loses the costly codec on
//     a short link starts H264 at a height the link carries, instead of at the top for the
//     12 s it takes to notice (SEND_GRACE_MS + LINK_HOLD_MS) with frames lost all along.
//   - The link adapter's and the machine governor's waits before trying more again shrink
//     when a try holds, and stop going back to the start while tries keep failing. Without
//     it the 5-minute ceiling is never reached for long: the wait went back to 15 s (20 s
//     for the governor) on the very step up that found the ceiling.
//   - When one connection tries the costly codec's camera mode and it comes out worse, the
//     others do not try it on the same picture for the same 5 minutes (each did, in turn).
//
// Reports carry "sq-adapt-fix=on" in `experiments`, and every send report now counts the
// steps (linkDowns, linkUps, linkFailedUps, codecSwitches, cameraTries).

import { experimentFlag } from "./experimentFlag";

export const ADAPT_FIX_FEATURE = "sq-adapt-fix";

const flag = experimentFlag();
export const setAdaptFix = flag.set;
export const isAdaptFix = flag.get;
export const onAdaptFixChange = flag.onChange;
