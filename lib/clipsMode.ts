"use client";

import { useEffect, useSyncExternalStore } from "react";
import { trackFeatureEvent, useFeature } from "./features";
import { useProtectedRoom } from "./captureProtection";
import { isNewcomer } from "./newcomer";

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
  | "callRecording"
  | "callTranscript"
  | "roomTools"
  | "vscodeEditor"
  | "univerSheet"
  | "fullscreenChat"
  | "stereoMic"
  | "multiMic"
  | "cameraEffects"
  | "phoneCamera";

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
  // "Transcrição" (ver lib/useCallTranscript). Como o callRecording: aqui só
  // pela dica azul, que fica no "⋯" (é lá que o botão está).
  callTranscript: {
    feature: "room-call-transcript",
    modeKey: "sharescreen:callTranscriptMode",
    tipKey: "sharescreen:callTranscriptTipSeen",
    defaultOn: true,
  },
  // "Ferramentas" (ver lib/roomTools). Como o callRecording: aqui só pela dica
  // azul, que fica no próprio botão "Ferramentas" do cabeçalho — sem
  // interruptor, o botão já é a entrada.
  roomTools: {
    feature: "room-tools",
    modeKey: "sharescreen:roomToolsMode",
    tipKey: "sharescreen:roomToolsTipSeen",
    defaultOn: true,
  },
  // "Editor VS Code" (ver components/roomTools/VsCodeEditor): o editor de
  // código das Ferramentas desenhado pelo Monaco. Desligado por padrão — são
  // alguns MB baixados e bem mais memória que o textarea. O interruptor fica
  // na barra do próprio editor de código, que é onde ele é usado.
  vscodeEditor: {
    feature: "room-code-vscode",
    modeKey: "sharescreen:vscodeEditorMode",
    tipKey: "sharescreen:vscodeEditorTipSeen",
  },
  // "Excel" (ver components/roomTools/UniverSheet): a planilha das
  // Ferramentas desenhada pelo Univer. Desligado por padrão pelo mesmo motivo
  // do vscodeEditor; o interruptor fica na barra da própria planilha.
  univerSheet: {
    feature: "room-sheet-univer",
    modeKey: "sharescreen:univerSheetMode",
    tipKey: "sharescreen:univerSheetTipSeen",
  },
  // "Chat na tela cheia" (ver lib/fullscreenChat): o chat da sala numa coluna
  // à direita de um tile em tela cheia. Sem interruptor no "⋯": o botão de
  // chat que aparece na própria tela cheia é o interruptor, desligado por
  // padrão — com ele aberto o vídeo perde a faixa da direita.
  fullscreenChat: {
    feature: "fullscreen-chat",
    modeKey: "sharescreen:fullscreenChatMode",
    tipKey: "sharescreen:fullscreenChatTipSeen",
  },
  // "Microfone estéreo" (ver lib/opusStereo e captureNoiseSuppressedMic): o
  // microfone capturado e enviado em dois canais. Desligado por padrão — sem
  // cancelamento de eco nem supressão de ruído, quem não usa fone ecoa a sala
  // de volta. O interruptor fica no painel do microfone.
  stereoMic: {
    feature: "stereo-mic",
    modeKey: "sharescreen:stereoMicMode",
    tipKey: "sharescreen:stereoMicTipSeen",
  },
  // "Várias entradas de áudio" (ver captureNoiseSuppressedMic): outras
  // entradas misturadas no mesmo microfone. Desligado por padrão — cada
  // entrada extra é mais uma captura aberta. O interruptor fica no painel do
  // microfone.
  multiMic: {
    feature: "multi-mic",
    modeKey: "sharescreen:multiMicMode",
    tipKey: "sharescreen:multiMicTipSeen",
  },
  // "Efeitos de câmera" (ver lib/cameraEffects): fundo desfocado, filtros de
  // cor e máscaras no rosto, desenhados na câmera antes de sair. Desligado por
  // padrão — é um modelo rodando em cada quadro da câmera. O interruptor fica
  // no painel da câmera (setinha ao lado do botão da câmera).
  cameraEffects: {
    feature: "camera-effects",
    modeKey: "sharescreen:cameraEffectsMode",
    tipKey: "sharescreen:cameraEffectsTipSeen",
  },
  // "Celular como câmera" (ver lib/phoneCamera): um celular que abre o link
  // do QR code vira a câmera deste computador, sem entrar na sala. Desligado
  // por padrão — ligado, a sala mantém um socket a mais aberto, esperando o
  // celular. O interruptor fica no painel da câmera.
  phoneCamera: {
    feature: "phone-camera",
    modeKey: "sharescreen:phoneCameraMode",
    tipKey: "sharescreen:phoneCameraTipSeen",
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
  callTranscript: {
    modeOn: "transcript_mode_on",
    modeOff: "transcript_mode_off",
  },
  // Sem interruptor, como o callRecording: nunca enviados. As estatísticas das
  // ferramentas estão em lib/roomTools (ROOM_TOOLS_EVENTS).
  roomTools: {
    modeOn: "room_tools_mode_on",
    modeOff: "room_tools_mode_off",
  },
  vscodeEditor: {
    modeOn: "vscode_editor_on",
    modeOff: "vscode_editor_off",
  },
  univerSheet: {
    modeOn: "univer_sheet_on",
    modeOff: "univer_sheet_off",
  },
  fullscreenChat: {
    modeOn: "fullscreen_chat_on",
    modeOff: "fullscreen_chat_off",
  },
  stereoMic: {
    modeOn: "stereo_mic_on",
    modeOff: "stereo_mic_off",
  },
  multiMic: {
    modeOn: "multi_mic_on",
    modeOff: "multi_mic_off",
    add: "multi_mic_add", // uma entrada extra foi marcada
    start: "multi_mic_start", // value: quantas entradas o mic abriu juntas
  },
  cameraEffects: {
    modeOn: "camera_effects_on",
    modeOff: "camera_effects_off",
    pick: "camera_effects_pick", // um efeito escolhido (qualquer um que não seja "nenhum")
    start: "camera_effects_start", // uma câmera começou a passar pelos efeitos
    error: "camera_effects_error", // um modelo não carregou, ou o desenho falhou
    slow: "camera_effects_slow", // value: ms por quadro (uma vez por sessão, acima de 30)
    bgUpload: "camera_effects_bg_upload", // enviou uma imagem de fundo própria
    bgLocked: "camera_effects_bg_locked", // tocou em "Seu fundo" sem o plano (abriu os planos)
  },
  // O resto das estatísticas está em PHONE_CAMERA_EVENTS (lib/phoneCamera).
  phoneCamera: {
    modeOn: "phone_camera_on",
    modeOff: "phone_camera_off",
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
export const VSCODE_EDITOR_FEATURE = "room-code-vscode";
export const UNIVER_SHEET_FEATURE = "room-sheet-univer";

export const TIP_CLICK_EVENT = "new_feature_tip_click";

export function trackTileExperiment(name: string, value?: number) {
  trackFeatureEvent(name, value ? { value: Math.max(1, Math.round(value)) } : {});
}

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
// Which of clips/recording the current room's management turned off for this
// person (the room's "clips" and "recording" switches — see WatchRoom, which
// is what sets this, managers never being subject to it). Module state like
// the protected room above, so every tile reads it without a prop.
let roomBlocked: { clips: boolean; recording: boolean } = { clips: false, recording: false };
const roomBlockedListeners = new Set<() => void>();

export function setRoomBlockedTileExperiments(next: { clips: boolean; recording: boolean }) {
  if (next.clips === roomBlocked.clips && next.recording === roomBlocked.recording) return;
  roomBlocked = next;
  roomBlockedListeners.forEach((listener) => listener());
}

function subscribeRoomBlocked(listener: () => void) {
  roomBlockedListeners.add(listener);
  return () => {
    roomBlockedListeners.delete(listener);
  };
}

function useRoomBlocked(experiment: TileExperiment): boolean {
  return useSyncExternalStore(
    subscribeRoomBlocked,
    () => (experiment === "clips" || experiment === "recording" ? roomBlocked[experiment] : false),
    () => false
  );
}

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
  // Clips and recordings save the room to disk — the one thing a protected
  // room exists to prevent (see lib/captureProtection.ts).
  const blocked = useProtectedRoom() && (experiment === "clips" || experiment === "recording");
  // Turned off by the room for this person: the switch in "⋯" is greyed out
  // and the tiles stop offering it (and stop a recording already running).
  const blockedByRoom = useRoomBlocked(experiment);
  return { available, on, blockedByRoom, active: available && on && !blocked && !blockedByRoom };
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
  // New to GoLive (see lib/newcomer): nothing here is news yet.
  const newcomer = useSyncExternalStore(subscribe, isNewcomer, () => false);
  useEffect(() => {
    if (available && !seen && newcomer && !everyone) write(tipKey, "1");
  }, [available, seen, newcomer, tipKey, everyone]);
  return {
    show: available && !seen && (!newcomer || everyone),
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
