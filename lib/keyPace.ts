// Experiment "sq-key-pace": how often the desktop app's GPU capture (lib/nativeVideoCapture)
// makes its one encoder start over from a keyframe, with more than one viewer.
//
// One encoder serves every viewer of a GPU share, so a viewer who lost the picture and asks
// for a keyframe gets one for everybody, several times the size of a normal frame. Without
// this, requests go through one a second whoever makes them. In the reports (2026-11-17..25)
// a share with 3-4 viewers had one viewer making 58% of the requests (median), and shares
// with 10 or more made about one a second, for everybody, all the time.
//
// With it (see KeyPacer in lib/nativeVideoSink), and only while two or more viewers are
// being sent to:
//   - a viewer who asks again soon after being served waits longer (2 s, then 4); a keyframe
//     anyone else asked for in the meantime serves them too;
//   - the shortest gap between two keyframes grows past three viewers, up to 2.5 s;
//   - a viewer who has no picture at all yet (just connected, or back from a pause) is never
//     held back by their own history.
//
// Reports carry "sq-key-pace=on" in `experiments`, and every GPU send report says how many
// keyframes reached that viewer (nativeKeys) and how long they waited for one (nativeKeyWaitS).

import { experimentFlag } from "./experimentFlag";

export const KEY_PACE_FEATURE = "sq-key-pace";

const flag = experimentFlag();
export const setKeyPace = flag.set;
export const isKeyPace = flag.get;
export const onKeyPaceChange = flag.onChange;
