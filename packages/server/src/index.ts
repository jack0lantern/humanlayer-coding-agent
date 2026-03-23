import { serve } from "@hono/node-server";
import { createNodeWebSocket } from "@hono/node-ws";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { ensureConnection } from "./db.js";
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

const port = parseInt(process.env.SERVER_PORT || "3000", 10);

async function start() {
  await ensureConnection();

  const server = serve({
    fetch: app.fetch,
    port,
  });

  injectWebSocket(server);

  console.log(`Server running on port ${port}`);
}

start().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
