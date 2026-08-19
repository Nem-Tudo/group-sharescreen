import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { connect, type Socket } from "node:net";
import type { Duplex } from "node:stream";
import httpProxy from "http-proxy";

const configuredPort = process.env.GATEWAY_PORT?.trim() || "8080";
const PORT = Number(configuredPort);
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  throw new Error(`GATEWAY_PORT inválida: "${configuredPort}". Use uma porta entre 1 e 65535.`);
}
const HOST = process.env.GATEWAY_HOST || "0.0.0.0";
const NEXT_TARGET = process.env.GATEWAY_NEXT_TARGET || "http://127.0.0.1:3000";
const SIGNALING_TARGET = process.env.GATEWAY_SIGNALING_TARGET || "http://127.0.0.1:4000";

const proxy = httpProxy.createProxyServer({ xfwd: true, ws: true });
const sockets = new Set<Socket>();

function isSignalingWebSocket(url: string | undefined): boolean {
  if (!url) return false;
  try {
    return new URL(url, "http://gateway.local").pathname === "/ws";
  } catch {
    return false;
  }
}

function isSignalingHttp(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const pathname = new URL(url, "http://gateway.local").pathname;
    return pathname === "/signaling" || pathname.startsWith("/signaling/");
  } catch {
    return false;
  }
}

function tunnelUpgrade(
  request: IncomingMessage,
  clientSocket: Duplex,
  head: Buffer,
  target: string
) {
  const targetUrl = new URL(target);
  const upstreamSocket = connect(Number(targetUrl.port), targetUrl.hostname);
  upstreamSocket.once("connect", () => {
    const requestLine = `${request.method ?? "GET"} ${request.url ?? "/"} HTTP/${request.httpVersion}\r\n`;
    const headers: string[] = [];
    for (let index = 0; index < request.rawHeaders.length; index += 2) {
      const name = request.rawHeaders[index];
      const value = name.toLowerCase() === "host" ? targetUrl.host : request.rawHeaders[index + 1];
      headers.push(`${name}: ${value}`);
    }
    upstreamSocket.write(`${requestLine}${headers.join("\r\n")}\r\n\r\n`);
    if (head.length > 0) upstreamSocket.write(head);
    clientSocket.pipe(upstreamSocket).pipe(clientSocket);
  });
  upstreamSocket.once("error", (error) => {
    console.error(`[gateway] Falha no tunnel WebSocket ${request.url}:`, error.message);
    clientSocket.destroy();
  });
  clientSocket.once("error", () => upstreamSocket.destroy());
}

const server = createServer((request, response) => {
  const signalingRequest = isSignalingHttp(request.url);
  const target = signalingRequest ? SIGNALING_TARGET : NEXT_TARGET;
  if (signalingRequest && request.url) {
    request.url = request.url.slice("/signaling".length) || "/";
  }
  proxy.web(request, response, { target }, (error) => {
    console.error(`[gateway] Falha ao encaminhar ${request.method} ${request.url}:`, error.message);
    if (!response.headersSent) response.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
    if (!(response as ServerResponse).writableEnded) response.end("Serviço local indisponível.");
  });
});

server.on("upgrade", (request, socket, head) => {
  // /ws belongs to Fastify signaling. Every other upgrade (notably Next 16's
  // /_next/hmr) stays with Next, preserving Fast Refresh through the gateway.
  const signalingSocket = isSignalingWebSocket(request.url);
  if (!signalingSocket) {
    tunnelUpgrade(request, socket, head, NEXT_TARGET);
    return;
  }
  proxy.ws(request, socket, head, { target: SIGNALING_TARGET }, (error) => {
    console.error(`[gateway] Falha no upgrade WebSocket ${request.url}:`, error.message);
    socket.destroy();
  });
});

server.on("connection", (socket) => {
  sockets.add(socket);
  socket.once("close", () => sockets.delete(socket));
});

server.listen(PORT, HOST, () => {
  console.log(
    `[gateway] http://${HOST}:${PORT} -> Next ${NEXT_TARGET}; /ws e /signaling/* -> ${SIGNALING_TARGET}`
  );
});

let shuttingDown = false;
function shutdown(signal: NodeJS.Signals) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[gateway] ${signal} recebido; encerrando conexões...`);

  server.close(() => process.exit(0));
  const forceCloseTimer = setTimeout(() => {
    for (const socket of sockets) socket.destroy();
    process.exit(0);
  }, 2_000);
  forceCloseTimer.unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
