import { spawn } from "node:child_process";

const gatewayPort = process.env.GATEWAY_PORT?.trim() || "8080";
const parsedGatewayPort = Number(gatewayPort);
if (!Number.isInteger(parsedGatewayPort) || parsedGatewayPort < 1 || parsedGatewayPort > 65535) {
  console.error(`[cloudflare] GATEWAY_PORT inválida: "${gatewayPort}". Use uma porta entre 1 e 65535.`);
  process.exit(1);
}

console.log(`[cloudflare] Iniciando Quick Tunnel para http://localhost:${parsedGatewayPort}`);

const tunnel = spawn(
  "cloudflared",
  ["tunnel", "--url", `http://localhost:${parsedGatewayPort}`, "--no-autoupdate"],
  { stdio: ["inherit", "pipe", "pipe"], windowsHide: true }
);

let printedPublicUrl = false;
function forwardAndInspect(chunk, destination) {
  const text = chunk.toString();
  destination.write(chunk);
  if (printedPublicUrl) return;
  const url = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i)?.[0];
  if (!url) return;
  printedPublicUrl = true;
  process.stdout.write(
    `\n============================================\n ShareScreen disponível publicamente\n ${url}\n============================================\n\n`
  );
}

tunnel.stdout.on("data", (chunk) => forwardAndInspect(chunk, process.stdout));
tunnel.stderr.on("data", (chunk) => forwardAndInspect(chunk, process.stderr));

tunnel.on("error", (error) => {
  if (error.code === "ENOENT") {
    console.error(
      "\n[cloudflare] cloudflared não foi encontrado. Instale-o e confirme que o comando `cloudflared --version` funciona no terminal.\nGuia: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/\n"
    );
  } else {
    console.error("[cloudflare] Não foi possível iniciar o Quick Tunnel:", error.message);
  }
  process.exit(1);
});

tunnel.on("exit", (code, signal) => {
  if (signal) process.exit(0);
  process.exit(code ?? 1);
});

function stopTunnel() {
  if (!tunnel.killed) tunnel.kill();
}

process.on("SIGINT", stopTunnel);
process.on("SIGTERM", stopTunnel);
