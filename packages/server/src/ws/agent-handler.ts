import type { WebSocket } from "ws";
import { prisma } from "../db.js";
import {
  setConnectedAgent,
  getConnectedAgent,
  broadcastSSE,
} from "../state.js";
import type { AgentMessage, EventType } from "@codingagent/shared";

export function handleAgentConnection(ws: WebSocket) {
  console.log("Agent WebSocket connected");

  let agentId: string | null = null;

  ws.on("message", async (raw) => {
    try {
      const message: AgentMessage = JSON.parse(raw.toString());

      switch (message.type) {
        case "agent:register": {
          agentId = message.agentId;

          // Upsert agent record
          await prisma.agent.upsert({
            where: { id: message.agentId },
            create: {
              id: message.agentId,
              name: message.name,
              status: "online",
              workingDir: message.workingDir,
              connectedAt: new Date(),
              lastHeartbeat: new Date(),
            },
            update: {
              name: message.name,
              status: "online",
              workingDir: message.workingDir,
              connectedAt: new Date(),
              lastHeartbeat: new Date(),
            },
          });

          setConnectedAgent({
            agentId: message.agentId,
            ws,
            name: message.name,
            workingDir: message.workingDir,
          });

          console.log(`Agent registered: ${message.name} (${message.agentId})`);

          // Check for pending sessions and assign
          const pendingSession = await prisma.session.findFirst({
            where: { status: "pending" },
            orderBy: { createdAt: "asc" },
          });

          if (pendingSession) {
            await prisma.session.update({
              where: { id: pendingSession.id },
              data: {
                agentId: message.agentId,
                status: "running",
                startedAt: new Date(),
              },
            });

            ws.send(
              JSON.stringify({
                type: "server:session:assign",
                sessionId: pendingSession.id,
                prompt: pendingSession.prompt,
              })
            );

            console.log(`Assigned pending session ${pendingSession.id} to agent`);
          }

          // Send pong as ack
          ws.send(
            JSON.stringify({
              type: "server:pong",
              timestamp: new Date().toISOString(),
            })
          );
          break;
        }

        case "agent:heartbeat": {
          if (agentId) {
            await prisma.agent.update({
              where: { id: agentId },
              data: { lastHeartbeat: new Date() },
            });
          }
          ws.send(
            JSON.stringify({
              type: "server:pong",
              timestamp: new Date().toISOString(),
            })
          );
          break;
        }

        case "agent:session:ack": {
          console.log(`Agent acknowledged session ${message.sessionId}`);
          break;
        }

        case "agent:event": {
          const { sessionId, event } = message;

          // Get next sequence number
          const lastEvent = await prisma.event.findFirst({
            where: { sessionId },
            orderBy: { sequence: "desc" },
          });
          const sequence = (lastEvent?.sequence ?? -1) + 1;

          // Persist event
          const dbEvent = await prisma.event.create({
            data: {
              sessionId,
              type: event.type as EventType,
              data: event as any,
              sequence,
            },
          });

          // Broadcast to SSE subscribers
          broadcastSSE(sessionId, "event", {
            event: {
              id: dbEvent.id,
              sessionId: dbEvent.sessionId,
              type: dbEvent.type,
              data: dbEvent.data,
              sequence: dbEvent.sequence,
              createdAt: dbEvent.createdAt.toISOString(),
            },
          });

          // If session complete, update session status
          if (event.type === "session_complete") {
            const finalStatus = event.status;
            await prisma.session.update({
              where: { id: sessionId },
              data: {
                status: finalStatus,
                finishedAt: new Date(),
              },
            });

            broadcastSSE(sessionId, "session_update", {
              sessionId,
              status: finalStatus,
            });
          }

          break;
        }
      }
    } catch (error) {
      console.error("Error handling agent message:", error);
    }
  });

  ws.on("close", async () => {
    console.log("Agent WebSocket disconnected");
    if (agentId) {
      await prisma.agent
        .update({
          where: { id: agentId },
          data: { status: "offline" },
        })
        .catch(() => {});
    }

    // Clear connected agent if it's this one
    const current = getConnectedAgent();
    if (current && current.agentId === agentId) {
      setConnectedAgent(null);
    }
  });

  ws.on("error", (error) => {
    console.error("Agent WebSocket error:", error);
  });
}
