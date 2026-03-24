import { config } from "dotenv";
import { writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, "../../../.env") });
import { createAdaptorServer } from "@hono/node-server";
import { createNodeWebSocket } from "@hono/node-ws";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { ensureConnection, prisma } from "./db.js";
import sessionsRoute from "./routes/sessions.js";
import agentsRoute from "./routes/agents.js";
import { handleAgentConnection } from "./ws/agent-handler.js";

const app = new Hono();
const { upgradeWebSocket, injectWebSocket } = createNodeWebSocket({ app });

app.use("*", logger());
app.use("*", cors());

// Health check
app.get("/api/health", (c) => {
  return c.json({ status: "ok", timestamp: new Date().toISOString() });
});

// REST routes
app.route("/api/sessions", sessionsRoute);
app.route("/api/agents", agentsRoute);

// WebSocket endpoint for agent connections
app.get(
  "/ws/agent",
  upgradeWebSocket(() => ({
    onOpen(evt, ws) {
      const raw = ws.raw as any;
      handleAgentConnection(raw);
    },
  }))
);

const basePort = parseInt(process.env.SERVER_PORT ?? "3000", 10);

function listenOnPort(server: ReturnType<typeof createAdaptorServer>, port: number) {
  return new Promise<number>((resolve, reject) => {
    server.once("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") reject(err);
      else reject(err);
    });
    server.once("listening", () => {
      const addr = server.address();
      const actualPort = typeof addr === "object" && addr?.port ? addr.port : port;
      resolve(actualPort);
    });
    server.listen(port);
  });
}

async function start() {
  await ensureConnection();

  const serverOptions = {
    maxHeaderSize: 32768,
  };

  let boundPort = basePort;
  for (let attempt = 0; attempt < 100; attempt++) {
    const server = createAdaptorServer({
      fetch: app.fetch,
      serverOptions,
    });

    try {
      boundPort = await listenOnPort(server, boundPort);
      injectWebSocket(server);

      const portFile = path.resolve(__dirname, "../../../.server-port");
      writeFileSync(portFile, JSON.stringify({ port: boundPort }), "utf8");

      console.log(
        boundPort !== basePort
          ? `Server running on port ${boundPort} (${basePort} was occupied)`
          : `Server running on port ${boundPort}`
      );

      // Graceful shutdown
      const shutdown = async () => {
        console.log("\nShutting down...");
        server.close();
        await prisma.$disconnect();
        process.exit(0);
      };
      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);

      return;
    } catch (err) {
      const nodeErr = err as NodeJS.ErrnoException;
      if (nodeErr?.code === "EADDRINUSE") {
        boundPort++;
        continue;
      }
      throw err;
    }
  }

  throw new Error(`No available port in range ${basePort}-${basePort + 99}`);
}

start().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
