"use client";

import { useEffect, useSyncExternalStore } from "react";
import { getDesktopBridge } from "./desktop";
import { useAuth } from "./AuthContext";
import type { SignalingState } from "./signalingClient";
import { useSignalingSelector } from "./useSignalingSelector";
import { useCallSession } from "./callSession";
import { isPrivateRoomHandle } from "./roomsApi";
import { trackFeatureEvent, useFeature } from "./features";

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
} as const;

const SETTINGS_KEY = "sharescreen:discordRpc:settings";

export interface DiscordRpcSettings {
  enabled: boolean;
  hidePrivateDetails: boolean;
  showAccountInfo: boolean;
  showActivityStats: boolean;
  customClientId?: string;
}

const DEFAULT_SETTINGS: DiscordRpcSettings = {
  enabled: true,
  hidePrivateDetails: true,
  showAccountInfo: true,
  showActivityStats: true,
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

    socket.onopen = () => {
      resolved = true;
      this.ws = socket;
      this.connected = true;
      this.connecting = false;
      if (this.lastActivity) {
        this.setActivity(this.lastActivity);
      }
    };

    socket.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.cmd === "DISPATCH" && msg.evt === "READY") {
          this.connected = true;
          this.connecting = false;
          if (this.lastActivity) {
            this.setActivity(this.lastActivity);
          }
        }
      } catch {}
    };

    socket.onerror = () => {
      if (!resolved) {
        resolved = true;
        try {
          socket.close();
        } catch {}
        this.tryNextPort(index + 1);
      }
    };

    socket.onclose = () => {
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

  public disconnect() {
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
const selectPeers = (state: SignalingState) => state.peers;

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
  const peers = useSignalingSelector(selectPeers);
  const { enabled: featureAllowed } = useFeature(DISCORD_RPC_FEATURE, { track: true });

  const clientId = getEffectiveDiscordClientId(settings);
  const bridge = getDesktopBridge();
  const isDesktopApp = Boolean(bridge?.discordRpcUpdate);

  useEffect(() => {
    if (!featureAllowed || !settings.enabled) {
      if (isDesktopApp) {
        bridge?.discordRpcClear?.();
      } else {
        getBrowserRpcClient().clearActivity();
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
    const username = account?.displayName || account?.username || "Usuário GoLive";
    const avatarUrl = account?.avatarUrl || undefined;

    const inCall = Boolean(callSession?.handle);
    const isPrivate = inCall && (Boolean(callSession?.dm) || isPrivateRoomHandle(callSession!.handle));

    let details = "Navegando no GoLive";
    let state = settings.showAccountInfo ? `@${account?.username || username}` : "Online";
    let largeImage = "golive_logo";
    let largeText = "GoLive";
    let smallImage: string | undefined = undefined;
    let smallText: string | undefined = undefined;
    let party: { id?: string; size?: [number, number] } | undefined = undefined;
    let buttons: Array<{ label: string; url: string }> | undefined = undefined;

    if (inCall) {
      const peerCount = peers.length + 1; // peers + self

      if (isPrivate && settings.hidePrivateDetails) {
        // Privacy mode for private room / DM
        details = callSession?.dm ? "Em chamada direta (DM)" : "Em uma sala privada";
        state = isSharingScreen
          ? "Transmitindo tela 🔴"
          : isSharingCamera
          ? "Em vídeo 📹"
          : `${peerCount} ${peerCount === 1 ? "participante" : "participantes"}`;
        smallImage = isSharingScreen ? "screen_share" : "voice_call";
        smallText = isSharingScreen ? "Compartilhando tela" : "Em chamada";
      } else {
        // Public room or explicit details allowed
        const roomName = callSession?.group
          ? `${callSession.group.groupName} #${callSession.group.channelName}`
          : callSession?.handle || "Sala GoLive";

        details = `Em chamada: ${roomName}`;

        const statusFlags: string[] = [];
        if (isSharingScreen) statusFlags.push("Transmitindo tela 🔴");
        if (isSharingCamera) statusFlags.push("Câmera 📹");
        if (statusFlags.length === 0) {
          statusFlags.push(`${peerCount} ${peerCount === 1 ? "pessoa" : "pessoas"}`);
        }

        state = statusFlags.join(" • ");
        smallImage = isSharingScreen ? "screen_share" : "voice_call";
        smallText = isSharingScreen ? "Compartilhando tela" : "Em chamada";

        if (callSession?.handle && !isPrivate) {
          party = {
            id: `golive-${callSession.handle}`,
            size: [peerCount, 50],
          };
          buttons = [
            {
              label: "Entrar na Sala",
              url: `https://golive.nemtudo.me/watch/${encodeURIComponent(callSession.handle)}`,
            },
          ];
        }
      }
    } else {
      if (account?.username && settings.showAccountInfo) {
        buttons = [
          {
            label: "Ver Perfil no GoLive",
            url: `https://golive.nemtudo.me/user/${encodeURIComponent(account.username)}`,
          },
        ];
      }
    }

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
      buttons,
      instance: false,
    };

    if (isDesktopApp) {
      bridge?.discordRpcUpdate?.(payload);
    } else {
      getBrowserRpcClient().setActivity(payload);
    }

    trackFeatureEvent(DISCORD_RPC_EVENTS.update);
  }, [
    featureAllowed,
    settings,
    account,
    callSession,
    isSharingScreen,
    isSharingCamera,
    peers,
    clientId,
    bridge,
    isDesktopApp,
  ]);

  return null;
}
