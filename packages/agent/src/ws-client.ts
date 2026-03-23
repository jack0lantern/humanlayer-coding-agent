import WebSocket from "ws";
import { randomUUID } from "crypto";
import { runAgentLoop } from "./agent-loop.js";
import type {
  AgentMessage,
  ServerMessage,
  SessionEvent,
} from "@codingagent/shared";

interface WSClientOptions {
  serverUrl: string;
  workingDir: string;
  apiKey: string;
}

export function startWSClient(options: WSClientOptions) {
  const { serverUrl, workingDir, apiKey } = options;
  const agentId = randomUUID();
  const agentName = `agent-${agentId.slice(0, 8)}`;

  let ws: WebSocket;
  let heartbeatInterval: ReturnType<typeof setInterval>;
  let stopFlag = false;
  let reconnectTimeout: ReturnType<typeof setTimeout>;

  function connect() {
    const wsUrl = serverUrl.replace(/^http/, "ws") + "/ws/agent";
    console.log(`Connecting to ${wsUrl}...`);

    ws = new WebSocket(wsUrl);

    ws.on("open", () => {
      console.log("Connected to server");

      // Register
      send({
        type: "agent:register",
        agentId,
        name: agentName,
        workingDir,
      });

      // Start heartbeat
      heartbeatInterval = setInterval(() => {
        send({
          type: "agent:heartbeat",
          agentId,
          timestamp: new Date().toISOString(),
        });
      }, 10000);
    });

    ws.on("message", async (raw) => {
      try {
        const message: ServerMessage = JSON.parse(raw.toString());

        switch (message.type) {
          case "server:session:assign": {
            console.log(`Session assigned: ${message.sessionId}`);
            stopFlag = false;

            // Acknowledge
            send({
              type: "agent:session:ack",
              sessionId: message.sessionId,
              agentId,
            });

            // Run agent loop
            await runAgentLoop({
              prompt: message.prompt,
              workingDir,
              apiKey,
              onEvent: (event: SessionEvent) => {
                send({
                  type: "agent:event",
                  sessionId: message.sessionId,
                  event,
                });
              },
              shouldStop: () => stopFlag,
            });

            console.log(`Session ${message.sessionId} finished`);
            break;
          }

          case "server:session:stop": {
            console.log(`Stop requested for session ${message.sessionId}`);
            stopFlag = true;
            break;
          }

          case "server:pong": {
            // Heartbeat acknowledged
            break;
          }
        }
      } catch (error) {
        console.error("Error handling server message:", error);
      }
    });

    ws.on("close", () => {
      console.log("Disconnected from server");
      clearInterval(heartbeatInterval);

      // Reconnect after delay
      reconnectTimeout = setTimeout(() => {
        console.log("Reconnecting...");
        connect();
      }, 3000);
    });

    ws.on("error", (error) => {
      console.error("WebSocket error:", error.message);
    });
  }

  function send(message: AgentMessage) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  function shutdown() {
    clearInterval(heartbeatInterval);
    clearTimeout(reconnectTimeout);
    stopFlag = true;
    if (ws) ws.close();
  }

  connect();

  // Graceful shutdown
  process.on("SIGINT", () => {
    console.log("\nShutting down...");
    shutdown();
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    console.log("\nShutting down...");
    shutdown();
    process.exit(0);
  });
}
