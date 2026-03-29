import { existsSync, readdirSync } from "fs";
import { resolve } from "path";
import archiver from "archiver";
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
  SendMessageRequest,
  SessionDTO,
  EventDTO,
} from "@codingagent/shared";

const sessions = new Hono();

function toSessionDTO(session: any): SessionDTO {
  return {
    id: session.id,
    agentId: session.agentId,
    prompt: session.prompt,
    repoUrl: session.repoUrl ?? null,
    status: session.status,
    createdAt: session.createdAt.toISOString(),
    startedAt: session.startedAt?.toISOString() ?? null,
    finishedAt: session.finishedAt?.toISOString() ?? null,
    stoppedBy: session.stoppedBy ?? null,
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

  // Validate repoUrl if provided (git URL or absolute local path)
  const repoUrl = body.repoUrl?.trim() || undefined;
  if (repoUrl && !/^(https:\/\/|git@|\/)/.test(repoUrl)) {
    return c.json(
      { error: "repoUrl must be a git URL (https:// or git@) or an absolute path" },
      400
    );
  }

  const session = await prisma.session.create({
    data: {
      prompt: body.prompt.trim(),
      ...(repoUrl && { repoUrl }),
    },
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
      ...(repoUrl && { repoUrl }),
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
    data: { status: "stopped", finishedAt: new Date(), stoppedBy: "user" },
  });

  broadcastSSE(session.id, "session_update", {
    sessionId: session.id,
    status: "stopped",
    stoppedBy: "user",
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
    orderBy: [{ sequence: "asc" }, { createdAt: "asc" }],
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
      orderBy: [{ sequence: "asc" }, { createdAt: "asc" }],
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

// POST /api/sessions/:id/message - Send a follow-up message to a waiting session
sessions.post("/:id/message", async (c) => {
  const body = await c.req.json<SendMessageRequest>();
  const session = await prisma.session.findUnique({
    where: { id: c.req.param("id") },
  });

  if (!session) return c.json({ error: "Session not found" }, 404);
  if (session.status !== "waiting_for_user") {
    return c.json({ error: "Session is not waiting for user input" }, 400);
  }
  if (!body.message || body.message.trim() === "") {
    return c.json({ error: "message is required" }, 400);
  }

  // Persist the user message as an event
  const lastEvent = await prisma.event.findFirst({
    where: { sessionId: session.id },
    orderBy: { sequence: "desc" },
  });
  const sequence = (lastEvent?.sequence ?? -1) + 1;

  const userMsgEvent = await prisma.event.create({
    data: {
      sessionId: session.id,
      type: "user_message",
      data: { type: "user_message", content: body.message.trim() },
      sequence,
    },
  });

  // Broadcast the user_message event via SSE
  broadcastSSE(session.id, "event", {
    event: toEventDTO(userMsgEvent),
  });

  // Update session to running
  const updated = await prisma.session.update({
    where: { id: session.id },
    data: { status: "running" },
  });

  // Load all events for history reconstruction, excluding the follow-up
  // user_message we just added (it's passed separately as followUpMessage).
  const allEvents = await prisma.event.findMany({
    where: { sessionId: session.id, NOT: { id: userMsgEvent.id } },
    orderBy: [{ sequence: "asc" }, { createdAt: "asc" }],
  });

  // Send continue message to agent with event history
  const agent = getConnectedAgent();
  if (agent) {
    sendToAgent({
      type: "server:session:continue",
      sessionId: session.id,
      followUpMessage: body.message.trim(),
      sessionPrompt: session.prompt,
      history: allEvents.map((e) => ({
        type: e.type,
        data: e.data as Record<string, unknown>,
      })),
      ...(session.repoUrl && { repoUrl: session.repoUrl }),
    });
  }

  broadcastSSE(session.id, "session_update", {
    sessionId: session.id,
    status: "running",
  });

  return c.json({ session: toSessionDTO(updated) });
});

// POST /api/sessions/:id/end - Explicitly end a waiting session
sessions.post("/:id/end", async (c) => {
  const session = await prisma.session.findUnique({
    where: { id: c.req.param("id") },
  });
  if (!session) return c.json({ error: "Session not found" }, 404);
  if (session.status !== "waiting_for_user") {
    return c.json({ error: "Session is not waiting for user input" }, 400);
  }

  const updated = await prisma.session.update({
    where: { id: session.id },
    data: { status: "completed", finishedAt: new Date(), stoppedBy: "user" },
  });

  broadcastSSE(session.id, "session_update", {
    sessionId: session.id,
    status: "completed",
    stoppedBy: "user",
  });

  return c.json({ session: toSessionDTO(updated) });
});

function sessionWorkspaceHasFiles(absDir: string): boolean {
  try {
    return existsSync(absDir) && readdirSync(absDir).length > 0;
  } catch {
    return false;
  }
}

/**
 * Prefer WORKSPACE_DIR (Docker volume) but fall back to the agent's registered base
 * so local dev still works when only one path has content.
 */
function resolveDownloadableSessionDir(
  sessionId: string,
  agentWorkingDir: string | null
): string | null {
  const candidates: string[] = [];
  const envRoot = process.env.WORKSPACE_DIR?.trim();
  if (envRoot) candidates.push(resolve(envRoot, sessionId));
  if (agentWorkingDir)
    candidates.push(resolve(agentWorkingDir, sessionId));

  const seen = new Set<string>();
  for (const dir of candidates) {
    const abs = resolve(dir);
    if (seen.has(abs)) continue;
    seen.add(abs);
    if (sessionWorkspaceHasFiles(abs)) return abs;
  }
  return null;
}

// GET /api/sessions/:id/download - Download session workspace as zip
sessions.get("/:id/download", async (c) => {
  const sessionId = c.req.param("id");

  // Validate UUID format to prevent path traversal
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(sessionId)) {
    return c.json({ error: "Invalid session ID" }, 400);
  }

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
  });
  if (!session) return c.json({ error: "Session not found" }, 404);

  // Block download while agent is actively running
  if (session.status === "running" || session.status === "pending") {
    return c.json({ error: "Session is still running. Wait for it to finish before downloading." }, 400);
  }

  const agent = session.agentId
    ? await prisma.agent.findUnique({ where: { id: session.agentId } })
    : null;

  if (!process.env.WORKSPACE_DIR?.trim() && !agent?.workingDir) {
    return c.json({ error: "Workspace directory not configured" }, 500);
  }

  const sessionDir = resolveDownloadableSessionDir(
    sessionId,
    agent?.workingDir ?? null
  );
  if (!sessionDir) {
    return c.json({ error: "No files found for this session" }, 404);
  }

  return streamZip(c, sessionDir, sessionId);
});

function streamZip(c: any, directory: string, sessionId: string) {
  const archive = archiver("zip", { zlib: { level: 6 } });

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();

  archive.on("data", (chunk: Buffer) => writer.write(chunk).catch(() => {}));
  archive.on("end", () => writer.close().catch(() => {}));
  archive.on("error", () => writer.close().catch(() => {}));

  archive.directory(directory, false);
  archive.finalize();

  return new Response(readable, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="session-${sessionId.slice(0, 8)}.zip"`,
    },
  });
}

export default sessions;
