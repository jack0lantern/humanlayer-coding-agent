import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { prisma } from "../db.js";
import {
  getConnectedAgent,
  sendToAgent,
  addSSESubscriber,
  removeSSESubscriber,
  broadcastSSE,
} from "../state.js";
import type {
  CreateSessionRequest,
  SessionDTO,
  EventDTO,
} from "@codingagent/shared";

const sessions = new Hono();

function toSessionDTO(session: any): SessionDTO {
  return {
    id: session.id,
    agentId: session.agentId,
    prompt: session.prompt,
    status: session.status,
    createdAt: session.createdAt.toISOString(),
    startedAt: session.startedAt?.toISOString() ?? null,
    finishedAt: session.finishedAt?.toISOString() ?? null,
    updatedAt: session.updatedAt.toISOString(),
  };
}

function toEventDTO(event: any): EventDTO {
  return {
    id: event.id,
    sessionId: event.sessionId,
    type: event.type,
    data: event.data as Record<string, unknown>,
    sequence: event.sequence,
    createdAt: event.createdAt.toISOString(),
  };
}

// POST /api/sessions - Create a new session
sessions.post("/", async (c) => {
  const body = await c.req.json<CreateSessionRequest>();

  if (!body.prompt || body.prompt.trim() === "") {
    return c.json({ error: "prompt is required" }, 400);
  }

  // Reject prompts that are too large (100k tokens ≈ 300k chars)
  const MAX_PROMPT_CHARS = 300_000;
  if (body.prompt.length > MAX_PROMPT_CHARS) {
    return c.json(
      {
        error: `Prompt is too large (${body.prompt.length} characters, max ${MAX_PROMPT_CHARS}). Please shorten your request.`,
      },
      400
    );
  }

  const session = await prisma.session.create({
    data: { prompt: body.prompt.trim() },
  });

  const dto = toSessionDTO(session);

  // If an agent is connected, assign the session immediately
  const agent = getConnectedAgent();
  if (agent) {
    await prisma.session.update({
      where: { id: session.id },
      data: { agentId: agent.agentId, status: "running", startedAt: new Date() },
    });
    dto.agentId = agent.agentId;
    dto.status = "running";
    dto.startedAt = new Date().toISOString();

    sendToAgent({
      type: "server:session:assign",
      sessionId: session.id,
      prompt: body.prompt.trim(),
    });
  }

  return c.json({ session: dto }, 201);
});

// GET /api/sessions - List all sessions
sessions.get("/", async (c) => {
  const list = await prisma.session.findMany({
    orderBy: { createdAt: "desc" },
  });
  return c.json({ sessions: list.map(toSessionDTO) });
});

// GET /api/sessions/:id - Get session detail
sessions.get("/:id", async (c) => {
  const session = await prisma.session.findUnique({
    where: { id: c.req.param("id") },
  });
  if (!session) return c.json({ error: "Session not found" }, 404);
  return c.json({ session: toSessionDTO(session) });
});

// POST /api/sessions/:id/stop - Stop a running session
sessions.post("/:id/stop", async (c) => {
  const session = await prisma.session.findUnique({
    where: { id: c.req.param("id") },
  });
  if (!session) return c.json({ error: "Session not found" }, 404);
  if (session.status !== "running") {
    return c.json({ error: "Session is not running" }, 400);
  }

  sendToAgent({
    type: "server:session:stop",
    sessionId: session.id,
  });

  const updated = await prisma.session.update({
    where: { id: session.id },
    data: { status: "stopped", finishedAt: new Date() },
  });

  broadcastSSE(session.id, "session_update", {
    sessionId: session.id,
    status: "stopped",
  });

  return c.json({ session: toSessionDTO(updated) });
});

// GET /api/sessions/:id/events - Get all events for a session
sessions.get("/:id/events", async (c) => {
  const session = await prisma.session.findUnique({
    where: { id: c.req.param("id") },
  });
  if (!session) return c.json({ error: "Session not found" }, 404);

  const events = await prisma.event.findMany({
    where: { sessionId: session.id },
    orderBy: { sequence: "asc" },
  });

  return c.json({ events: events.map(toEventDTO) });
});

// GET /api/sessions/:id/stream - SSE endpoint for live events
// Supports ?after=<sequence> to paginate backfill (only events with sequence > after are sent).
sessions.get("/:id/stream", async (c) => {
  const sessionId = c.req.param("id");
  const afterParam = c.req.query("after");
  const afterSequence = afterParam ? parseInt(afterParam, 10) : 0;

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
  });
  if (!session) return c.json({ error: "Session not found" }, 404);

  /** Max events to backfill per connection to avoid oversized responses. */
  const BACKFILL_LIMIT = 200;

  return streamSSE(c, async (stream) => {
    // Send existing events as backfill, paginated
    const existingEvents = await prisma.event.findMany({
      where: {
        sessionId,
        ...(afterSequence > 0 ? { sequence: { gt: afterSequence } } : {}),
      },
      orderBy: { sequence: "asc" },
      take: BACKFILL_LIMIT,
    });

    for (const event of existingEvents) {
      await stream.writeSSE({
        event: "event",
        data: JSON.stringify({ event: toEventDTO(event) }),
        id: String(event.sequence),
      });
    }

    // Tell the client if there are more events to fetch
    const lastSequence = existingEvents.length > 0
      ? existingEvents[existingEvents.length - 1].sequence
      : afterSequence;
    const hasMore = existingEvents.length === BACKFILL_LIMIT;
    await stream.writeSSE({
      event: "backfill_done",
      data: JSON.stringify({ lastSequence, hasMore }),
    });

    // Send current session status
    await stream.writeSSE({
      event: "session_update",
      data: JSON.stringify({ sessionId, status: session.status }),
    });

    // If session is already terminal, close
    if (["completed", "stopped", "failed"].includes(session.status)) {
      await stream.writeSSE({
        event: "connected",
        data: JSON.stringify({ message: "Session already finished" }),
      });
      return;
    }

    // Register for live events
    const writer = (event: string, data: string) => {
      stream.writeSSE({ event, data }).catch(() => {});
    };

    addSSESubscriber({ sessionId, write: writer, close: () => {} });

    // Keep connection alive
    const keepAlive = setInterval(() => {
      stream.writeSSE({ event: "ping", data: "{}" }).catch(() => {
        clearInterval(keepAlive);
      });
    }, 15000);

    stream.onAbort(() => {
      clearInterval(keepAlive);
      removeSSESubscriber(sessionId, writer);
    });

    // Block until stream is aborted
    await new Promise<void>((resolve) => {
      stream.onAbort(resolve);
    });
  });
});

export default sessions;
