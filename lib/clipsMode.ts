"use client";

import { useEffect, useSyncExternalStore } from "react";
import { trackFeatureEvent, useFeature } from "./features";

// The tile experiments switched on from the room's "Mais opções":
//   - "Modo clipes": the clip-the-last-30s button (see lib/clipBuffer);
//   - "Gravação": the start/stop record button (see TileRecorder).
// Each has two gates:
//   - its feature (user target, created in the admin panel's "Features" tab —
//     no API change), which decides who gets to see the switch at all;
//   - the person's own switch in "Mais opções", off by default.

export type TileExperiment =
  | "clips"
  | "recording"
  | "multiScreen"
  | "dualCamera"
  | "pushToTalk"
  | "musicQueue"
  | "orientation"
  | "callRecording";

// `defaultOn`: the switch starts on for whoever never touched it.
const CONFIG: Record<
  TileExperiment,
  { feature: string; modeKey: string; tipKey: string; defaultOn?: boolean }
> = {
  clips: { feature: "room-clips", modeKey: "sharescreen:clipsMode", tipKey: "sharescreen:clipsTipSeen" },
  recording: {
    feature: "room-recording",
    modeKey: "sharescreen:recordingMode",
    tipKey: "sharescreen:recordingTipSeen",
  },
  // "Várias telas" (see lib/multiScreen).
  multiScreen: {
    feature: "multi-screen-share",
    modeKey: "sharescreen:multiScreenMode",
    tipKey: "sharescreen:multiScreenTipSeen",
    defaultOn: true,
  },
  // The phone's side of "Várias telas" (front and rear cameras at once): the
  // same feature and switch, but a tip of its own, so seeing the computer's
  // tip does not use up the phone's.
  dualCamera: {
    feature: "multi-screen-share",
    modeKey: "sharescreen:multiScreenMode",
    tipKey: "sharescreen:dualCameraTipSeen",
    defaultOn: true,
  },
  // "Apertar para falar" (see lib/pushToTalk): the mic stays open and silent,
  // and only the key lets it through. Off by default — it changes what the
  // mic button means, and somebody who never asked for it should never have
  // to find out why nobody hears them.
  pushToTalk: {
    feature: "push-to-talk",
    modeKey: "sharescreen:pushToTalkMode",
    tipKey: "sharescreen:pushToTalkTipSeen",
  },
  // A aba da playlist e a ordem aleatória da música da sala (ver
  // components/MusicQueuePanel e lib/musicShuffle). Sem interruptor no "⋯":
  // ela mora na própria barra de música, que é onde quem está ouvindo procura.
  // `defaultOn` porque o que o experimento decide aqui é só se o botão da aba
  // existe — a ordem aleatória continua desligada até alguém ligar.
  // "Girar/inverter" (ver lib/tileOrientation): o botão no canto de cada
  // tile. `defaultOn` porque não custa nada — é um `transform` no vídeo, e
  // quem não usa só tem um botão a mais no hover; o interruptor no "⋯" está
  // lá para quem prefere o canto limpo.
  orientation: {
    feature: "tile-orientation",
    modeKey: "sharescreen:orientationMode",
    tipKey: "sharescreen:orientationTipSeen",
    defaultOn: true,
  },
  // "Gravar chamada" (ver lib/callRecording). Está aqui só pela dica azul de
  // "novo" (useTileExperimentTip): não tem interruptor — o botão já é o
  // interruptor, e nada roda até a pessoa clicar em começar. Por isso
  // `defaultOn` e um `modeKey` que ninguém escreve.
  callRecording: {
    feature: "room-call-recording",
    modeKey: "sharescreen:callRecordingMode",
    tipKey: "sharescreen:callRecordingTipSeen",
    defaultOn: true,
  },
  musicQueue: {
    feature: "room-music-queue",
    modeKey: "sharescreen:musicQueueMode",
    tipKey: "sharescreen:musicQueueTipSeen",
    defaultOn: true,
  },
};

// Usage stats, compared between the sides of each experiment. Every name has
// to be listed in its feature's "site events" in the admin panel to count.
export const TILE_EXPERIMENT_EVENTS = {
  clips: {
    modeOn: "clips_mode_on",
    modeOff: "clips_mode_off",
    create: "clip_create", // value: seconds in the clip
    download: "clip_download", // value: seconds downloaded
    trim: "clip_trim", // downloaded after cutting
  },
  recording: {
    modeOn: "recording_mode_on",
    modeOff: "recording_mode_off",
    start: "recording_start",
    stop: "recording_stop", // value: seconds recorded
    download: "recording_download", // value: seconds downloaded
    trim: "recording_trim", // downloaded after cutting
  },
  multiScreen: {
    modeOn: "multi_screen_mode_on",
    modeOff: "multi_screen_mode_off",
  },
  dualCamera: {
    modeOn: "multi_screen_mode_on",
    modeOff: "multi_screen_mode_off",
  },
  pushToTalk: {
    modeOn: "push_to_talk_mode_on",
    modeOff: "push_to_talk_mode_off",
    keySet: "push_to_talk_key_set", // a key was recorded for it
    talk: "push_to_talk_talk", // value: seconds the key was held
  },
  orientation: {
    modeOn: "orientation_mode_on",
    modeOff: "orientation_mode_off",
  },
  // Sem interruptor (ver CONFIG): estes dois nunca são enviados. Os eventos
  // de verdade estão em CALL_RECORDING_EVENTS (lib/useCallRecording).
  callRecording: {
    modeOn: "call_recording_mode_on",
    modeOff: "call_recording_mode_off",
  },
  musicQueue: {
    // Nomes de "modo" aqui são a aba, não a ordem aleatória: o interruptor
    // desse experimento é o botão que abre a lista.
    modeOn: "music_queue_open",
    modeOff: "music_queue_close",
    shuffleOn: "music_shuffle_on",
    shuffleOff: "music_shuffle_off",
    pick: "music_track_pick", // uma faixa escolhida na lista
    advance: "music_shuffle_advance", // a fila pulou para um sorteado
    add: "music_queue_add", // um link pôs uma música na fila
    remove: "music_queue_remove",
    move: "music_queue_move", // uma faixa foi arrastada
    spotify: "music_spotify_import", // value: quantas faixas vieram
  },
} as const;

// One event for every "recurso novo" tip, whatever the feature: the person
// clicked what the tip points at while it was on screen. Built in on the API
// (BUILTIN_CLIENT_FEATURE_EVENTS), so it counts for every experiment they are
// in without being listed in any feature's "site events"; the admin panel
// shows it as the blue count beside "Exposições".
export const TIP_CLICK_EVENT = "new_feature_tip_click";

export function trackTileExperiment(name: string, value?: number) {
  trackFeatureEvent(name, value ? { value: Math.max(1, Math.round(value)) } : {});
}

// Whether this browser had used GoLive before this page load. Read at module
// evaluation, before anything on the page mints a device id or caches the
// feature list, so a first visit cannot count itself as a returning one.
const wasReturning = (() => {
  if (typeof window === "undefined") return false;
  try {
    return (
      window.localStorage.getItem("sharescreen:deviceId") !== null ||
      window.localStorage.getItem("sharescreen:features") !== null
    );
  } catch {
    return false;
  }
})();

const listeners = new Set<() => void>();
function emit() {
  for (const listener of listeners) listener();
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key?.startsWith("sharescreen:")) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage refused — the switch just won't survive a reload.
  }
  emit();
}

export function setTileExperimentMode(experiment: TileExperiment, on: boolean) {
  write(CONFIG[experiment].modeKey, on ? "1" : "0");
  const events = TILE_EXPERIMENT_EVENTS[experiment];
  trackTileExperiment(on ? events.modeOn : events.modeOff);
}

/** The experiment and the person's switch together — what tiles check. */
export function useTileExperiment(experiment: TileExperiment, options: { track?: boolean } = {}) {
  const { feature, modeKey, defaultOn = false } = CONFIG[experiment];
  const { enabled: available } = useFeature(feature, { track: options.track ?? false });
  const on = useSyncExternalStore(
    subscribe,
    () => {
      const stored = read(modeKey);
      return stored === null ? defaultOn : stored === "1";
    },
    () => false
  );
  return { available, on, active: available && on };
}

/**
 * The blue "novo" tip on the "Mais opções" button: once per experiment, for
 * people who already used GoLive before getting it. Somebody new has nothing
 * "new" to be told about, so their first sight of it marks it as seen.
 */
//
// `everyone`: for a tip that points at something only reachable by using the
// feature (the "+" of "Várias telas" only exists mid-share), so it is news to
// a first-time visitor as much as to anyone.
export function useTileExperimentTip(
  experiment: TileExperiment,
  available: boolean,
  options: { everyone?: boolean } = {}
) {
  const { tipKey, feature } = CONFIG[experiment];
  const everyone = options.everyone ?? false;
  const seen = useSyncExternalStore(subscribe, () => read(tipKey) === "1", () => true);
  useEffect(() => {
    if (available && !seen && !wasReturning && !everyone) write(tipKey, "1");
  }, [available, seen, tipKey, everyone]);
  return {
    show: available && !seen && (wasReturning || everyone),
    dismiss: () => write(tipKey, "1"),
    /** The tip's target was clicked while it showed: counted, then gone. */
    clicked: () => {
      // Only this tip's feature: a click on another experiment's tip must not
      // show up in this one's count just because the person is in both.
      trackFeatureEvent(TIP_CLICK_EVENT, { feature });
      write(tipKey, "1");
    },
  };
}
