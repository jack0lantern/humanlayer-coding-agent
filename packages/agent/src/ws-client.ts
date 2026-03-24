import WebSocket from "ws";
import Anthropic from "@anthropic-ai/sdk";
import { randomUUID } from "crypto";
import { runAgentLoop } from "./agent-loop.js";
import type {
  AgentMessage,
  ServerMessage,
  SessionEvent,
} from "@codingagent/shared";

/** Maximum WebSocket message size (1 MB). Larger payloads are truncated. */
const MAX_WS_MESSAGE_SIZE = 1024 * 1024;

/**
 * Truncate an event payload if the serialized message would exceed WS limits.
 * Replaces large string fields with a truncation notice.
 */
function truncateEventForWS(event: SessionEvent): SessionEvent {
  const serialized = JSON.stringify(event);
  if (serialized.length <= MAX_WS_MESSAGE_SIZE) return event;

  // For tool_result events, truncate the output field
  if (event.type === "tool_result") {
    const maxOutput = MAX_WS_MESSAGE_SIZE - 500; // leave room for envelope
    return {
      ...event,
      output:
        event.output.slice(0, maxOutput) +
        `\n... [truncated, original size: ${event.output.length} chars]`,
    };
  }

  // For text events, truncate content
  if (event.type === "text") {
    const maxContent = MAX_WS_MESSAGE_SIZE - 500;
    return {
      ...event,
      content:
        event.content.slice(0, maxContent) +
        `\n... [truncated, original size: ${event.content.length} chars]`,
    };
  }

  return event;
}

/**
 * Reconstruct Claude API message history from persisted event records.
 * This enables multi-turn continuation by rebuilding the conversation state.
 *
 * @param sessionPrompt - The original session prompt (not in events), used as
 *   the first user message so the history starts with role:user as required.
 */
function reconstructMessages(
  history: Array<{ type: string; data: Record<string, unknown> }>,
  sessionPrompt: string
): Anthropic.MessageParam[] {
  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: sessionPrompt },
  ];
  let currentAssistantBlocks: Array<
    Anthropic.TextBlock | Anthropic.ToolUseBlock
  > = [];

  function flushAssistant() {
    if (currentAssistantBlocks.length > 0) {
      messages.push({ role: "assistant", content: currentAssistantBlocks });
      currentAssistantBlocks = [];
    }
  }

  for (const event of history) {
    const d = event.data;
    switch (event.type) {
      case "user_message": {
        flushAssistant();
        messages.push({ role: "user", content: d.content as string });
        break;
      }
      case "text": {
        currentAssistantBlocks.push({
          type: "text",
          text: d.content as string,
        } as Anthropic.TextBlock);
        break;
      }
      case "tool_call": {
        currentAssistantBlocks.push({
          type: "tool_use",
          id: d.toolCallId as string,
          name: d.toolName as string,
          input: d.input as Record<string, unknown>,
        } as Anthropic.ToolUseBlock);
        break;
      }
      case "tool_result": {
        // Tool results go in a user message; flush assistant first
        flushAssistant();
        const toolResultBlock: Anthropic.ToolResultBlockParam = {
          type: "tool_result",
          tool_use_id: d.toolCallId as string,
          content: d.output as string,
          is_error: d.isError as boolean,
        };
        // Group consecutive tool results into the same user message
        const lastMsg = messages[messages.length - 1];
        if (lastMsg?.role === "user" && Array.isArray(lastMsg.content)) {
          (lastMsg.content as Anthropic.ToolResultBlockParam[]).push(
            toolResultBlock
          );
        } else {
          messages.push({ role: "user", content: [toolResultBlock] });
        }
        break;
      }
      case "session_complete":
      case "error":
      case "thinking":
        // Flush assistant blocks on turn boundaries
        if (event.type === "session_complete" || event.type === "error") {
          flushAssistant();
        }
        break;
    }
  }

  flushAssistant();

  // --- Safety: merge consecutive same-role messages ---
  // Event ordering issues (e.g. DB race conditions) can produce adjacent
  // messages with the same role, which the Anthropic API rejects. Merge them.
  for (let i = messages.length - 1; i > 0; i--) {
    if (messages[i].role === messages[i - 1].role) {
      const prev = messages[i - 1];
      const curr = messages[i];
      // Normalise both to arrays of blocks
      const toBlocks = (
        c: string | Array<Anthropic.TextBlock | Anthropic.ToolUseBlock | Anthropic.ToolResultBlockParam>
      ) => (typeof c === "string" ? [{ type: "text" as const, text: c }] : c);
      const merged = [
        ...toBlocks(prev.content as any),
        ...toBlocks(curr.content as any),
      ];
      messages[i - 1] = { role: prev.role, content: merged as any };
      messages.splice(i, 1);
    }
  }

  return messages;
}

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
                  event: truncateEventForWS(event),
                });
              },
              shouldStop: () => stopFlag,
            });

            console.log(`Session ${message.sessionId} finished`);
            break;
          }

          case "server:session:continue": {
            console.log(`Session continue: ${message.sessionId}`);
            stopFlag = false;

            // Acknowledge
            send({
              type: "agent:session:ack",
              sessionId: message.sessionId,
              agentId,
            });

            // Reconstruct message history from events
            const previousMessages = reconstructMessages(
              message.history,
              message.sessionPrompt
            );

            // Run agent loop with history
            await runAgentLoop({
              prompt: message.followUpMessage,
              workingDir,
              apiKey,
              onEvent: (event: SessionEvent) => {
                send({
                  type: "agent:event",
                  sessionId: message.sessionId,
                  event: truncateEventForWS(event),
                });
              },
              shouldStop: () => stopFlag,
              previousMessages,
            });

            console.log(`Session ${message.sessionId} turn finished`);
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
