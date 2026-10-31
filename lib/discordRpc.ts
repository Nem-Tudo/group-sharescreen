"use client";

import { useEffect, useSyncExternalStore } from "react";
import { getDesktopBridge } from "./desktop";
import { useAuth } from "./AuthContext";
import type { SignalingState } from "./signalingClient";
import { useSignalingSelector } from "./useSignalingSelector";
import { useCallSession } from "./callSession";
import { isPrivateRoomHandle } from "./roomsApi";
import { groupPath } from "./groupLinks";
import { recentRoomPresentation } from "./recentRooms";
import { useRoomToolsSelector, type ToolKind } from "./roomTools";
import { useGroupDetail } from "./useGroups";
import { trackFeatureEvent, useFeature } from "./features";
import { arrivedBefore } from "./newcomer";

// Discord Rich Presence Integration for PC (Desktop/Electron), Web/Browser & Mobile.
//
// In Desktop App: Uses native Named Pipes IPC bridge.
// In Web Browser: Connects to local Discord client via Discord Local WebSocket RPC (127.0.0.1:6463..6472).
//
// Configurable Discord Client ID via:
// 1. process.env.NEXT_PUBLIC_DISCORD_CLIENT_ID
// 2. Custom override in localStorage ("sharescreen:discordRpc:settings")
// 3. Fallback to default registered GoLive application ID: "1540460243270635600"

export const DISCORD_RPC_FEATURE = "discord-rich-presence";

export const DISCORD_RPC_EVENTS = {
  enabled: "discord_rpc_enabled",
  disabled: "discord_rpc_disabled",
  privacyToggled: "discord_rpc_privacy_toggle",
  update: "discord_rpc_update",
  publicNameToggled: "discord_rpc_public_name",
  groupNameToggled: "discord_rpc_group_name",
  joinButtonToggled: "discord_rpc_join_button",
  privateCounterToggled: "discord_rpc_private_count",
  /** Discord accepted the connection (READY); once per page load, per route. */
  connectedApp: "discord_rpc_connected.app",
  connectedBrowser: "discord_rpc_connected.browser",
  introShown: "discord_rpc_intro_shown",
  introOk: "discord_rpc_intro_ok",
  introConfigure: "discord_rpc_intro_configure",
} as const;

const SETTINGS_KEY = "sharescreen:discordRpc:settings";

export interface DiscordRpcSettings {
  enabled: boolean;
  hidePrivateDetails: boolean;
  showAccountInfo: boolean;
  showActivityStats: boolean;
  showPublicRoomName: boolean;
  showGroupName: boolean;
  showJoinButton: boolean;
  showPrivateCounter: boolean;
  customClientId?: string;
}

const DEFAULT_SETTINGS: DiscordRpcSettings = {
  enabled: true,
  hidePrivateDetails: true,
  showAccountInfo: true,
  showActivityStats: true,
  showPublicRoomName: true,
  showGroupName: false,
  showJoinButton: true,
  showPrivateCounter: true,
};

let memorySettings: DiscordRpcSettings = DEFAULT_SETTINGS;
const listeners = new Set<() => void>();

function readSettings(): DiscordRpcSettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function writeSettings(next: DiscordRpcSettings) {
  memorySettings = next;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
    } catch {}
  }
  for (const listener of listeners) listener();
}

export function getDiscordRpcSettings(): DiscordRpcSettings {
  if (typeof window !== "undefined" && memorySettings === DEFAULT_SETTINGS) {
    memorySettings = readSettings();
  }
  return memorySettings;
}

export function updateDiscordRpcSettings(patch: Partial<DiscordRpcSettings>) {
  const current = getDiscordRpcSettings();
  const next = { ...current, ...patch };
  if (patch.enabled !== undefined && patch.enabled !== current.enabled) {
    trackFeatureEvent(patch.enabled ? DISCORD_RPC_EVENTS.enabled : DISCORD_RPC_EVENTS.disabled);
  }
  if (patch.hidePrivateDetails !== undefined && patch.hidePrivateDetails !== current.hidePrivateDetails) {
    trackFeatureEvent(DISCORD_RPC_EVENTS.privacyToggled, { value: patch.hidePrivateDetails ? 1 : 0 });
  }
  if (patch.showPublicRoomName !== undefined && patch.showPublicRoomName !== current.showPublicRoomName) {
    trackFeatureEvent(DISCORD_RPC_EVENTS.publicNameToggled, { value: patch.showPublicRoomName ? 1 : 0 });
  }
  if (patch.showGroupName !== undefined && patch.showGroupName !== current.showGroupName) {
    trackFeatureEvent(DISCORD_RPC_EVENTS.groupNameToggled, { value: patch.showGroupName ? 1 : 0 });
  }
  if (patch.showJoinButton !== undefined && patch.showJoinButton !== current.showJoinButton) {
    trackFeatureEvent(DISCORD_RPC_EVENTS.joinButtonToggled, { value: patch.showJoinButton ? 1 : 0 });
  }
  if (patch.showPrivateCounter !== undefined && patch.showPrivateCounter !== current.showPrivateCounter) {
    trackFeatureEvent(DISCORD_RPC_EVENTS.privateCounterToggled, { value: patch.showPrivateCounter ? 1 : 0 });
  }
  writeSettings(next);
}

export function useDiscordRpcSettings(): [DiscordRpcSettings, (patch: Partial<DiscordRpcSettings>) => void] {
  const settings = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    () => getDiscordRpcSettings(),
    () => DEFAULT_SETTINGS
  );
  return [settings, updateDiscordRpcSettings];
}

const INTRO_SEEN_KEY = "sharescreen:discordRpc:introSeen";
// When Rich Presence went out to everybody (rollout 100%, 2026-10-31).
const RELEASED_AT = 1793436498211;

/**
 * Whether the announcement is still owed: this browser was here before the
 * release, has not seen it, and has not already been in the settings.
 */
export function discordRpcIntroDue(): boolean {
  try {
    const storage = window.localStorage;
    return (
      arrivedBefore(RELEASED_AT) &&
      storage.getItem(INTRO_SEEN_KEY) === null &&
      storage.getItem(SETTINGS_KEY) === null
    );
  } catch {
    return false;
  }
}

/**
 * Whether Discord is running on this computer: something answers on one of its
 * local RPC ports. Says nothing about a Discord that is installed but closed.
 */
export function isDiscordRunning(): Promise<boolean> {
  return new Promise((resolve) => {
    let pending = 10;
    for (let port = 6463; port <= 6472; port++) {
      let settled = false;
      const settle = (found: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket?.close();
        pending--;
        if (found) resolve(true);
        else if (pending === 0) resolve(false);
      };
      const timer = setTimeout(() => settle(false), 3000);
      let socket: WebSocket | null = null;
      try {
        socket = new WebSocket(`ws://127.0.0.1:${port}/?v=1&client_id=${getEffectiveDiscordClientId()}`);
        socket.onopen = () => settle(true);
        socket.onerror = () => settle(false);
      } catch {
        settle(false);
      }
    }
  });
}

export function markDiscordRpcIntroSeen() {
  try {
    window.localStorage.setItem(INTRO_SEEN_KEY, "1");
  } catch {}
}

export function getEffectiveDiscordClientId(settings?: DiscordRpcSettings): string {
  const current = settings || getDiscordRpcSettings();
  if (current.customClientId && current.customClientId.trim()) {
    return current.customClientId.trim();
  }
  return (
    process.env.NEXT_PUBLIC_DISCORD_CLIENT_ID ||
    process.env.DISCORD_CLIENT_ID ||
    "1540460243270635600"
  );
}

// Session start timestamp for "tempo decorrido"
let sessionStartTime: number | null = null;
if (typeof window !== "undefined") {
  sessionStartTime = Math.floor(Date.now() / 1000);
}

export interface DiscordActivityPayload {
  state?: string;
  details?: string;
  timestamps?: {
    start?: number;
    end?: number;
  };
  assets?: {
    large_image?: string;
    large_text?: string;
    small_image?: string;
    small_text?: string;
  };
  party?: {
    id?: string;
    size?: [number, number];
  };
  buttons?: Array<{
    label: string;
    url: string;
  }>;
  instance?: boolean;
}

const reportedConnections = new Set<string>();
function trackDiscordRpcConnected(event: string) {
  if (reportedConnections.has(event)) return;
  reportedConnections.add(event);
  trackFeatureEvent(event, { feature: DISCORD_RPC_FEATURE });
}

/**
 * Browser WebSocket client for Discord Local RPC Server.
 * Discord desktop app runs a WebSocket server on 127.0.0.1 (ports 6463 - 6472)
 * with an origin allowlist or handshake validation.
 */
class BrowserDiscordRpcClient {
  private ws: WebSocket | null = null;
  private clientId: string = "";
  private portIndex: number = 0;
  private connected: boolean = false;
  private connecting: boolean = false;
  private lastActivity: DiscordActivityPayload | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  // Bumped by disconnect(), so a socket from before it can't revive the client
  // (a port probe still in flight, or the close event of the one just closed).
  private attempt: number = 0;

  constructor() {}

  public configure(clientId: string) {
    if (this.clientId === clientId) return;
    this.clientId = clientId;
    if (this.connected || this.connecting) {
      this.disconnect();
      this.connect();
    }
  }

  public connect() {
    if (typeof window === "undefined") return;
    if (this.connected || this.connecting) return;
    if (!this.clientId) return;

    this.connecting = true;
    this.tryNextPort(0);
  }

  private tryNextPort(index: number) {
    if (index > 9) {
      this.connecting = false;
      this.scheduleReconnect(20000);
      return;
    }

    this.portIndex = index;
    const port = 6463 + index;
    // Discord local RPC WS endpoint:
    const url = `ws://127.0.0.1:${port}/?v=1&client_id=${encodeURIComponent(this.clientId)}`;

    let socket: WebSocket;
    try {
      socket = new WebSocket(url);
    } catch {
      this.tryNextPort(index + 1);
      return;
    }

    let resolved = false;
    const attempt = this.attempt;

    socket.onopen = () => {
      if (attempt !== this.attempt) {
        socket.close();
        return;
      }
      resolved = true;
      this.ws = socket;
      this.connected = true;
      this.connecting = false;
      if (this.lastActivity) {
        this.setActivity(this.lastActivity);
      }
    };

    socket.onmessage = (event) => {
      if (attempt !== this.attempt) return;
      try {
        const msg = JSON.parse(event.data);
        if (msg.cmd === "DISPATCH" && msg.evt === "READY") {
          this.connected = true;
          this.connecting = false;
          trackDiscordRpcConnected(DISCORD_RPC_EVENTS.connectedBrowser);
          if (this.lastActivity) {
            this.setActivity(this.lastActivity);
          }
        }
      } catch {}
    };

    socket.onerror = () => {
      if (attempt !== this.attempt) return;
      if (!resolved) {
        resolved = true;
        try {
          socket.close();
        } catch {}
        this.tryNextPort(index + 1);
      }
    };

    socket.onclose = () => {
      if (attempt !== this.attempt) return;
      this.connected = false;
      this.connecting = false;
      this.ws = null;
      if (resolved) {
        this.scheduleReconnect(15000);
      }
    };
  }

  private scheduleReconnect(delayMs: number) {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.connected && !this.connecting && this.clientId) {
        this.connect();
      }
    }, delayMs);
  }

  public setActivity(activity: DiscordActivityPayload | null) {
    this.lastActivity = activity;
    if (!this.connected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      if (!this.connecting) this.connect();
      return;
    }

    const nonce = Math.random().toString(36).substring(2, 15);
    const payload = JSON.stringify({
      cmd: "SET_ACTIVITY",
      args: {
        pid: 0,
        activity: activity || undefined,
      },
      nonce,
    });

    try {
      this.ws.send(payload);
    } catch {
      this.connected = false;
    }
  }

  public clearActivity() {
    this.lastActivity = null;
    this.setActivity(null);
  }

  // Turned off: closing the socket is also what makes Discord drop the activity,
  // and nothing reconnects until the next setActivity.
  public stop() {
    this.lastActivity = null;
    this.disconnect();
  }

  public disconnect() {
    this.attempt++;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.connected = false;
    this.connecting = false;
    if (this.ws) {
      try {
        this.ws.close();
      } catch {}
      this.ws = null;
    }
  }
}

let browserClient: BrowserDiscordRpcClient | null = null;
function getBrowserRpcClient(): BrowserDiscordRpcClient {
  if (!browserClient) {
    browserClient = new BrowserDiscordRpcClient();
  }
  return browserClient;
}

const selectSelfScreen = (state: SignalingState) => state.selfScreen;
const selectSelfCamera = (state: SignalingState) => state.selfCamera;
const selectMusicPlaying = (state: SignalingState) => state.music?.playing ?? false;
const selectHasVideoSource = (state: SignalingState) => state.videoSources.length > 0;
const selectMemberLimit = (state: SignalingState) => state.roomMemberLimit;
const NO_LIMIT_PARTY_MAX = 100;
const DM_PARTY_MAX = 2;

// The party id of a call whose name is hidden: random rather than a hash of the
// handle, which anyone could match against the public rooms' handles.
let hiddenParty: { handle: string; id: string } | null = null;
function hiddenPartyId(handle: string): string {
  if (hiddenParty?.handle !== handle) {
    hiddenParty = { handle, id: `golive-${Math.random().toString(36).slice(2)}` };
  }
  return hiddenParty.id;
}

const SITE_URL = "https://golive.nemtudo.me";
// Discord draws two buttons at most and drops the activity's extras past that.
const MAX_BUTTONS = 2;

const TOOL_LABELS: Partial<Record<ToolKind, string>> = {
  whiteboard: "quadro branco",
  notepad: "bloco de notas",
  annotate: "anotações",
  poll: "enquete",
  code: "editor de código",
  tasks: "tarefas",
  sheet: "planilha",
  doc: "documento",
  wheel: "roleta",
  calc: "calculadora",
};
// Moderator "ghost" peers ride the same list, and this count is shown publicly
// on the Discord profile: including them would reveal that one is in the room.
const selectVisiblePeerCount = (state: SignalingState) =>
  state.peers.filter((peer) => peer.role !== "moderator").length;

// What the last discord_rpc_update counted. Leaves out the peer count, so people
// coming and going in a room don't each count as a use of the feature.
let lastTrackedActivity: string | null = null;

/**
 * Global component that reports app presence to Discord RPC:
 * - Uses native bridge in PC / Electron app.
 * - Uses browser WebSocket RPC in Web Browser when Discord desktop is running on the computer.
 */
export function DiscordRpcReporter() {
  const [settings] = useDiscordRpcSettings();
  const { account } = useAuth();
  const callSession = useCallSession();
  const isSharingScreen = useSignalingSelector(selectSelfScreen);
  const isSharingCamera = useSignalingSelector(selectSelfCamera);
  const visiblePeerCount = useSignalingSelector(selectVisiblePeerCount);
  const musicPlaying = useSignalingSelector(selectMusicPlaying);
  const hasVideoSource = useSignalingSelector(selectHasVideoSource);
  const memberLimit = useSignalingSelector(selectMemberLimit);
  const toolLabel = useRoomToolsSelector((s) => {
    for (const tool of s.tools) {
      const label = TOOL_LABELS[tool.kind];
      if (label) return label;
    }
    return null;
  });
  const { enabled: featureAllowed } = useFeature(DISCORD_RPC_FEATURE, { track: true });
  const callGroupId = callSession?.group?.groupId ?? null;
  const callGroup = useGroupDetail(featureAllowed && settings.enabled ? callGroupId : null).detail?.group ?? null;
  const groupLinkAllowed = callGroup?.visibility === "public" && callGroup.richPresenceLink !== false;

  const clientId = getEffectiveDiscordClientId(settings);
  const bridge = getDesktopBridge();
  const isDesktopApp = Boolean(bridge?.discordRpcUpdate);

  // Before the effect below: its first update is what starts the connection.
  useEffect(
    () => bridge?.onDiscordRpcReady?.(() => trackDiscordRpcConnected(DISCORD_RPC_EVENTS.connectedApp)),
    [bridge]
  );

  useEffect(() => {
    if (!featureAllowed || !settings.enabled) {
      if (isDesktopApp) {
        bridge?.discordRpcClear?.();
      } else {
        getBrowserRpcClient().stop();
      }
      return;
    }

    if (isDesktopApp) {
      bridge?.discordRpcConfigure?.({
        clientId,
        enabled: settings.enabled,
      });
    } else {
      getBrowserRpcClient().configure(clientId);
    }

    // Determine current user state
    const username = account?.displayName || account?.username || "Usuário Go Live";

    const inCall = Boolean(callSession?.handle);
    const isPrivate = inCall && (Boolean(callSession?.dm) || isPrivateRoomHandle(callSession!.handle));

    let details = "Navegando no Go Live";
    let state = settings.showAccountInfo ? `@${account?.username || username}` : "Online";
    const largeImage = "golive_logo";
    const largeText = "Go Live";
    let smallImage: string | undefined = undefined;
    let smallText: string | undefined = undefined;
    let party: { id?: string; size?: [number, number] } | undefined = undefined;
    const buttons: Array<{ label: string; url: string }> = [];

    if (inCall) {
      const peerCount = visiblePeerCount + 1; // peers + self

      const activity: string[] = [];
      if (settings.showActivityStats) {
        if (isSharingScreen) activity.push("Transmitindo tela");
        if (isSharingCamera) activity.push("Câmera 📹");
        if (musicPlaying) activity.push("Ouvindo música");
        if (hasVideoSource) activity.push("Assistindo a um vídeo");
        if (toolLabel) activity.push(`Usando ${toolLabel}`);
      }
      // Discord's own "(1 of 10)" needs a maximum, so a room without a limit
      // shows NO_LIMIT_PARTY_MAX. It is drawn beside the state and only when
      // there is one, which is why the state is never left empty.
      const hasCounter = !isPrivate || settings.showPrivateCounter;
      state = activity.length > 0
        ? activity.join(" • ")
        : hasCounter
        ? "Em chamada"
        : `${peerCount} ${peerCount === 1 ? "pessoa" : "pessoas"}`;
      smallImage = isSharingScreen ? "screen_share" : "voice_call";
      smallText = activity[0] ?? "Em chamada";

      // Which kind of call, and whether it may be named. A button leads to what
      // it names, so a hidden name takes the button with it.
      let named = false;
      if (callSession?.group) {
        named = settings.showGroupName;
        details = named
          ? `Em chamada em grupo: ${callSession.group.groupName} #${callSession.group.channelName}`
          : "Em uma chamada em grupo";
        if (named && settings.showJoinButton && groupLinkAllowed) {
          buttons.push({ label: "Ir para o grupo", url: `${SITE_URL}${groupPath(callSession.group.groupId)}` });
        }
      } else if (isPrivate) {
        named = !settings.hidePrivateDetails;
        if (named) details = `Em chamada: ${callSession?.dm?.displayName ?? callSession!.handle}`;
        else details = callSession?.dm ? "Em chamada direta (DM)" : "Em uma sala privada";
      } else {
        named = settings.showPublicRoomName;
        details = named
          ? `Em chamada pública: ${recentRoomPresentation(callSession!.handle).name}`
          : "Em uma chamada pública";
        if (named && settings.showJoinButton) {
          buttons.push({
            label: "Entrar na sala",
            url: `${SITE_URL}/watch/${encodeURIComponent(callSession!.handle)}`,
          });
        }
      }

      if (hasCounter) {
        party = {
          // A private handle is what lets someone in, so it never leaves here.
          id: named && !isPrivate ? `golive-${callSession!.handle}` : hiddenPartyId(callSession!.handle),
          // Staff can be let in past the limit, and Discord refuses a party
          // bigger than its maximum.
          size: [peerCount, Math.max(memberLimit ?? (callSession?.dm ? DM_PARTY_MAX : NO_LIMIT_PARTY_MAX), peerCount)],
        };
      }
    }

    if (account?.username && settings.showAccountInfo) {
      buttons.push({
        label: "Ver perfil",
        url: `${SITE_URL}/user/${encodeURIComponent(account.username)}`,
      });
    }
    buttons.push({ label: "Abrir o Go Live", url: SITE_URL });

    const payload: DiscordActivityPayload = {
      details,
      state,
      timestamps: sessionStartTime ? { start: sessionStartTime } : undefined,
      assets: {
        large_image: largeImage,
        large_text: largeText,
        small_image: smallImage,
        small_text: smallText,
      },
      party,
      buttons: buttons.slice(0, MAX_BUTTONS),
      instance: false,
    };

    if (isDesktopApp) {
      bridge?.discordRpcUpdate?.(payload);
    } else {
      getBrowserRpcClient().setActivity(payload);
    }

    const trackedActivity = JSON.stringify([callSession?.handle ?? null, isSharingScreen, isSharingCamera]);
    if (trackedActivity !== lastTrackedActivity) {
      lastTrackedActivity = trackedActivity;
      trackFeatureEvent(DISCORD_RPC_EVENTS.update);
    }
  }, [
    featureAllowed,
    settings,
    account,
    callSession,
    isSharingScreen,
    isSharingCamera,
    visiblePeerCount,
    musicPlaying,
    hasVideoSource,
    toolLabel,
    memberLimit,
    groupLinkAllowed,
    clientId,
    bridge,
    isDesktopApp,
  ]);

  return null;
}
