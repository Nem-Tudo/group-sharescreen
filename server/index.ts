import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import websocketPlugin from "@fastify/websocket";
import cors from "@fastify/cors";
import { registerSignalingRoutes } from "./signaling.js";

const PORT = Number(process.env.SIGNALING_PORT || 4000);
const HOST = process.env.SIGNALING_HOST || "0.0.0.0";

async function main() {
  const app = Fastify({ logger: true });

  // DELETE is required by the announcement administration endpoint.
  await app.register(cors, { origin: true, methods: ["GET", "HEAD", "POST", "DELETE"] });
  await app.register(websocketPlugin, {
    options: { maxPayload: 64 * 1024 },
  });

  app.get("/health", async () => ({ ok: true }));

  await app.register(async (instance) => {
    registerSignalingRoutes(instance, randomUUID);
  });

  try {
    await app.listen({ port: PORT, host: HOST });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main();
