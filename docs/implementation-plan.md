# Implementation Plan: Sync-Based Headless Coding Agent

## Overview

A three-tier system that allows users to submit prompts to an AI coding agent and watch it execute tasks live — reading/writing files, running commands — with full streaming visibility through a real-time web interface.

## Architecture

```
Web UI (React)  ←→  SSE  ←→  Server (Hono)  ←→  WebSocket  ←→  Agent (Node)
                                  ↓ (Prisma)
                            PostgreSQL 16
```

## Key Design Decisions

1. **Outbound agent WebSocket** — Agent initiates connection to server (enables deployment in private networks/sandboxes without inbound ports)
2. **SSE for UI streaming** — Server-Sent Events are simpler than WebSocket for read-heavy UI and work through nginx
3. **Delta event streaming** — Every LLM token, tool call, and result streams as a discrete event
4. **JSONB for events** — Heterogeneous event types (thinking, text, tool_call, tool_result) stored in a single table
5. **Prisma ORM** — Type-safe DB access with auto-generated types
6. **No authentication** — Single-user local development tool (auth is a documented future item)

## Monorepo Structure

```
humanlayer-coding-agent/
├── packages/
│   ├── shared/    — Shared types & protocol definitions
│   ├── server/    — REST + WebSocket server (Hono + Prisma)
│   ├── agent/     — Headless AI agent daemon
│   ├── web/       — React SPA frontend
│   └── evals/     — Golden path integration tests
├── docker-compose.yml
├── .env.example
├── package.json   — npm workspaces root
└── tsconfig.base.json
```

## Technology Stack

| Layer | Technology |
|-------|-----------|
| Server | Hono 4.7, Node.js, Prisma 6.4 |
| Database | PostgreSQL 16 |
| Agent | Node.js, tsx, @anthropic-ai/sdk 0.39 |
| Frontend | React 19, Vite 6.2, TanStack Query 5.67, Tailwind CSS 4.1 |
| Monorepo | npm workspaces |
| Containers | Docker Compose |
| WebSocket | ws 8.18, @hono/node-ws 1.1 |

---

## Implementation Steps

### Step 1: Project Scaffolding

- Initialize npm workspaces monorepo with `packages/shared`, `packages/server`, `packages/agent`, `packages/web`, `packages/evals`
- Create `tsconfig.base.json` with shared TypeScript config (ES2022, strict mode, path aliases)
- Set up `docker-compose.yml` with PostgreSQL 16, server, agent, and web containers
- Create `.env.example` with `DATABASE_URL`, `ANTHROPIC_API_KEY`, `SERVER_URL`, `AGENT_WORKING_DIR`

### Step 2: Shared Types Package (`packages/shared`)

Define the protocol contract between all components:

- **`protocol.ts`** — WebSocket message types (Agent ↔ Server)
  - Agent → Server: `agent:register`, `agent:heartbeat`, `agent:session:ack`, `agent:event`
  - Server → Agent: `server:session:assign`, `server:session:stop`, `server:pong`
  - Session event types: `thinking`, `text`, `tool_call`, `tool_result`, `error`, `session_complete`
- **`events.ts`** — SSE event definitions (Server → UI)
  - `SSE_EVENT_NEW`, `SSE_EVENT_SESSION_UPDATE`, `SSE_EVENT_CONNECTED`
- **`api.ts`** — REST API types (Server ↔ Web UI)
  - DTOs: `AgentDTO`, `SessionDTO`, `EventDTO`
  - Request/Response interfaces for all endpoints

### Step 3: Database Schema (`packages/server/prisma`)

Define three models in `schema.prisma`:

- **Agent** — `id`, `name`, `status` (online/offline), `workingDir`, timestamps
- **Session** — `id`, `agentId` (FK), `prompt`, `status` (pending/running/completed/stopped/failed), timestamps
- **Event** — `id`, `sessionId` (FK), `type`, `data` (JSON), `sequence`, `timestamp`
- Add indexes on `sessionId+sequence` and `status`

### Step 4: Server (`packages/server`)

Build the central hub that connects agents and the web UI:

- **`index.ts`** — Hono web server on port 3000
  - WebSocket endpoint at `/ws/agent`
  - REST routes mounted at `/api/sessions` and `/api/agents`
  - CORS enabled, logger middleware

- **`ws/agent-handler.ts`** — WebSocket connection handler
  - Handle agent registration (store in memory + DB)
  - Heartbeat/pong keep-alive
  - Session acknowledgment handling
  - Stream events from agent to DB + SSE subscribers
  - Auto-assign pending sessions to newly connected agents

- **`routes/sessions.ts`** — Session REST API
  - `POST /api/sessions` — Create session, auto-assign if agent available
  - `GET /api/sessions` — List all sessions (ordered by creation date desc)
  - `GET /api/sessions/:id` — Get session detail with events
  - `POST /api/sessions/:id/stop` — Stop a running session
  - `GET /api/sessions/:id/events` — SSE endpoint for real-time event streaming

- **`routes/agents.ts`** — Agent status endpoints

- **`state.ts`** — In-memory state management
  - Single connected agent registry (WebSocket reference)
  - SSE subscriber management per session (Set of WritableStream references)
  - Broadcast utility to fan out events to all subscribers

### Step 5: Agent (`packages/agent`)

Build the headless coding agent that connects to the server:

- **`index.ts`** — CLI entry point using Commander.js
  - Options: `--server-url`, `--working-dir`
  - Requires `ANTHROPIC_API_KEY` env var

- **`ws-client.ts`** — WebSocket client
  - Connect to server, send `agent:register` with name + working dir
  - Send heartbeats every 30s
  - Receive `server:session:assign`, run agent loop, stream events back
  - Auto-reconnect on disconnect

- **`agent-loop.ts`** — Core LLM reasoning loop
  - Use Claude Sonnet 4 via Anthropic SDK
  - System prompt that guides file/command operations
  - Loop: call Claude → emit events → execute tools (parallel) → emit results → continue
  - Stop when `stop_reason !== "tool_use"`
  - Emit `session_complete` event on finish

- **`tools/definitions.ts`** — Tool schema definitions
  - `read_file` — Read file contents at a path
  - `write_file` — Write/create files (auto-create parent dirs)
  - `execute_command` — Run shell commands (30s timeout default)
  - `list_directory` — List files and directories

- **`tools/executor.ts`** — Tool implementations
  - File I/O using Node `fs/promises`
  - Shell execution via `child_process.exec` (10MB max buffer)
  - Error handling with `isError` flag for graceful LLM recovery

### Step 6: Web UI (`packages/web`)

Build the real-time monitoring interface:

- **`App.tsx`** — Two-column layout
  - Left sidebar: agent status indicator, session list, create session form
  - Right side: selected session's event stream + stop button
  - TanStack Query for API calls (3s refetch for sessions, 5s for agents)

- **`components/SessionList.tsx`** — Clickable list of all sessions with status badges
- **`components/CreateSession.tsx`** — Prompt input form (disabled when no agent online)
- **`components/EventStream.tsx`** — Event display
  - Auto-scroll to latest event
  - Color-coded by event type (thinking/text/tool_call/tool_result/error)
  - Status indicators for session state
  - Markdown rendering for text events

- **`hooks/useSessionStream.ts`** — SSE hook
  - `EventSource` for real-time streaming from `/api/sessions/:id/events`
  - Accumulate events in React state

- **`lib/api.ts`** — REST API client (fetch wrapper)

- **Stack**: React 19, Vite, Tailwind CSS, react-markdown

### Step 7: Docker & Deployment

- **`docker-compose.yml`** — 4 services:
  - `postgres` — PostgreSQL 16 with volume persistence
  - `server` — Hono server (depends on postgres)
  - `agent` — Agent daemon (depends on server)
  - `web` — Nginx serving Vite build (depends on server)
- **`packages/web/nginx.conf`** — Reverse proxy config for API + SSE + WebSocket pass-through

### Step 8: Golden Path Evals (`packages/evals`)

Build integration tests that validate the full agent loop:

- **`harness.ts`** — Test infrastructure
  - `runEval()` — Create isolated temp dir, run agent loop directly, collect results
  - `readEvalFile()` — Read generated files from temp workspace
  - Cleanup after each test

- **`golden-path.eval.ts`** — 18 test cases using Vitest
  1. Create simple text file
  2. List directory contents
  3. Read existing file
  4. Create directory structure + README
  5. Run shell command
  6. Create Python script
  7. Create package.json
  8. Multi-step: create file then read it back
  9. Create HTML page
  10. Create and run script
  11. Create config file (JSON)
  12. Create nested directory structure
  13. Create multiple related files
  14. Read non-existent file (error handling)
  15. Create file with specific encoding
  16. Execute command and use output
  17. Create .gitignore
  18. Multi-tool orchestration

---

## Key Workflows

### Session Creation & Assignment
1. UI submits prompt via `POST /api/sessions`
2. Server creates session in DB (status: `pending`)
3. If agent connected, immediately assign & transition to `running`
4. Send `server:session:assign` message to agent via WebSocket
5. Agent acknowledges with `agent:session:ack`

### Agent Processing
1. Agent receives session assignment with prompt
2. Runs `runAgentLoop`: call Claude → emit events → execute tools → loop
3. Emits events: `thinking`, `text`, `tool_call`, `tool_result`
4. When model returns `stop_reason !== "tool_use"`, emit `session_complete`

### Event Streaming
1. Agent emits event via WebSocket as `agent:event`
2. Server persists to DB with incrementing sequence number
3. Server broadcasts to all SSE subscribers for that session
4. UI receives via EventSource, accumulates and renders in real-time

---

## Future Items

- Multi-session support (currently single agent → single session)
- Additional agent tools (git operations, web search, code search, file patching)
- Authentication (user accounts, API keys)
- Conversation history (multi-turn conversations within session)
- Human-in-the-loop (approval gates for dangerous operations)
- Agent pool with load balancing
- File diff view in UI
- Session resume/continuation
