// Discord IPC Rich Presence client using pure Node.js sockets / named pipes.
//
// Does not require any external npm packages (no discord-rpc, @discordjs, etc.)
// Works directly on Windows (named pipes: \\.\pipe\discord-ipc-0..9)
// and macOS/Linux (domain sockets in /tmp/discord-ipc-0..9 or $XDG_RUNTIME_DIR).

import net from "node:net";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

export interface DiscordActivity {
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
  secrets?: {
    join?: string;
    spectate?: string;
    match?: string;
  };
  buttons?: Array<{
    label: string;
    url: string;
  }>;
  instance?: boolean;
}

const OPCODES = {
  HANDSHAKE: 0,
  FRAME: 1,
  CLOSE: 2,
  PING: 3,
  PONG: 4,
} as const;

function getPipePath(id: number): string {
  if (process.platform === "win32") {
    return `\\\\?\\pipe\\discord-ipc-${id}`;
  }
  const xdg = process.env.XDG_RUNTIME_DIR;
  const tmp = process.env.TMPDIR || process.env.TMP || process.env.TEMP || "/tmp";
  const base = xdg || tmp;
  return path.join(base, `discord-ipc-${id}`);
}

export class DiscordRpcClient {
  private socket: net.Socket | null = null;
  private clientId: string;
  private connected = false;
  private connecting = false;
  private retryTimer: NodeJS.Timeout | null = null;
  private lastActivity: DiscordActivity | null = null;
  private currentPipeIndex = 0;
  /** Discord accepted the handshake (READY), which a socket opening does not prove. */
  public onReady: (() => void) | null = null;

  constructor(clientId: string) {
    this.clientId = clientId;
  }

  public setClientId(clientId: string) {
    if (this.clientId === clientId) return;
    this.clientId = clientId;
    if (this.connected || this.connecting) {
      this.disconnect();
      this.connect();
    }
  }

  public connect(): void {
    if (this.connected || this.connecting) return;
    if (!this.clientId) return;

    this.connecting = true;
    this.tryNextPipe(0);
  }

  private tryNextPipe(pipeIndex: number): void {
    if (pipeIndex > 9) {
      this.connecting = false;
      this.scheduleReconnect(15000);
      return;
    }

    this.currentPipeIndex = pipeIndex;
    const pipePath = getPipePath(pipeIndex);

    const sock = net.createConnection(pipePath);
    let handled = false;

    const onFail = () => {
      if (handled) return;
      handled = true;
      sock.destroy();
      this.tryNextPipe(pipeIndex + 1);
    };

    sock.once("error", onFail);
    sock.once("connect", () => {
      if (handled) return;
      handled = true;
      this.socket = sock;
      this.setupSocket(sock);
    });
  }

  private setupSocket(sock: net.Socket): void {
    let readBuffer = Buffer.alloc(0);

    sock.on("data", (chunk) => {
      readBuffer = Buffer.concat([readBuffer, chunk]);

      while (readBuffer.length >= 8) {
        const opcode = readBuffer.readInt32LE(0);
        const length = readBuffer.readInt32LE(4);

        if (readBuffer.length < 8 + length) {
          break;
        }

        const payloadBuf = readBuffer.subarray(8, 8 + length);
        readBuffer = readBuffer.subarray(8 + length);

        try {
          const json = JSON.parse(payloadBuf.toString("utf8"));
          this.handleMessage(opcode, json);
        } catch {
          // ignore malformed frame
        }
      }
    });

    sock.once("close", () => {
      this.handleDisconnect();
    });

    sock.once("error", () => {
      this.handleDisconnect();
    });

    this.sendHandshake();
  }

  private handleDisconnect(): void {
    this.connected = false;
    this.connecting = false;
    if (this.socket) {
      try {
        this.socket.destroy();
      } catch {}
      this.socket = null;
    }
    this.scheduleReconnect(10000);
  }

  private scheduleReconnect(delayMs: number): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (!this.connected && !this.connecting && this.clientId) {
        this.connect();
      }
    }, delayMs);
  }

  private sendHandshake(): void {
    const payload = JSON.stringify({
      v: 1,
      client_id: this.clientId,
    });
    this.write(OPCODES.HANDSHAKE, payload);
  }

  private write(op: number, payloadStr: string): void {
    if (!this.socket || this.socket.destroyed) return;
    const body = Buffer.from(payloadStr, "utf8");
    const header = Buffer.alloc(8);
    header.writeInt32LE(op, 0);
    header.writeInt32LE(body.length, 4);

    try {
      this.socket.write(Buffer.concat([header, body]));
    } catch {
      this.handleDisconnect();
    }
  }

  private handleMessage(op: number, msg: any): void {
    if (op === OPCODES.FRAME) {
      if (msg.cmd === "DISPATCH" && msg.evt === "READY") {
        this.connected = true;
        this.connecting = false;
        this.onReady?.();
        if (this.lastActivity) {
          this.setActivity(this.lastActivity);
        }
      } else if (msg.cmd === "DISPATCH" && msg.evt === "ERROR") {
        console.warn("[DiscordRPC] Discord error dispatch:", msg);
      }
    } else if (op === OPCODES.PING) {
      this.write(OPCODES.PONG, JSON.stringify(msg));
    } else if (op === OPCODES.CLOSE) {
      this.handleDisconnect();
    }
  }

  public setActivity(activity: DiscordActivity | null): void {
    this.lastActivity = activity;
    if (!this.connected) {
      if (!this.connecting) this.connect();
      return;
    }

    const nonce = Math.random().toString(36).substring(2, 15);
    const payload = JSON.stringify({
      cmd: "SET_ACTIVITY",
      args: {
        pid: process.pid,
        activity: activity || undefined,
      },
      nonce,
    });

    this.write(OPCODES.FRAME, payload);
  }

  public clearActivity(): void {
    this.lastActivity = null;
    if (!this.connected) return;
    this.setActivity(null);
  }

  public disconnect(): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.connected = false;
    this.connecting = false;
    if (this.socket) {
      try {
        this.write(OPCODES.CLOSE, "{}");
        this.socket.destroy();
      } catch {}
      this.socket = null;
    }
  }
}

let instance: DiscordRpcClient | null = null;

export function getDiscordRpc(defaultClientId?: string): DiscordRpcClient {
  if (!instance) {
    const id = defaultClientId || process.env.DISCORD_CLIENT_ID || process.env.NEXT_PUBLIC_DISCORD_CLIENT_ID || "1540460243270635600";
    instance = new DiscordRpcClient(id);
  }
  return instance;
}

