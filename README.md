# Coding Agent

A sync-based headless coding agent with a real-time web interface. The system consists of three components: a server, a headless agent daemon, and a reactive web UI.

## Architecture

```
┌──────────────┐        SSE (events)        ┌──────────────┐
│              │◄───────────────────────────│              │
│   Web UI     │        REST (CRUD)         │   Server     │
│  (React+Vite)│───────────────────────────►│  (Hono)      │
│  :5173       │                            │  :3000       │
└──────────────┘                            └──────┬───────┘
                                                   │
                                            ┌──────┴───────┐
                                            │  PostgreSQL  │
                                            │  :5432       │
                                            └──────────────┘
                                                   ▲
                                                   │ Prisma
                                                   │
┌──────────────┐     WebSocket (outbound)   ┌──────┴───────┐
│   Agent      │───────────────────────────►│   Server     │
│  (Node+tsx)  │     (agent initiates)      │   :3000      │
│  no ports    │◄───────────────────────────│              │
│              │     (session assign/stop)  │              │
└──────────────┘                            └──────────────┘
```

## Stack

| Component | Technology |
|---|---|
| Server | Hono (Node.js), Prisma ORM |
| Database | PostgreSQL 16 |
| Agent | Node.js + tsx, Anthropic SDK |
| Frontend | React 19, Vite, TanStack Query, Tailwind CSS |
| Monorepo | npm workspaces |
| Containerization | Docker Compose |

## Design Decisions

- **Agent connects outbound via WebSocket** — the agent initiates the connection to the server, so it can run inside private networks or sandboxes with no inbound ports
- **SSE for UI streaming** — Server-Sent Events are simpler than WebSocket for the read-heavy UI, and work through nginx proxying naturally
- **Delta event streaming** — every LLM token, tool call, and result is streamed as a discrete event, persisted to PostgreSQL, and relayed to the UI in real-time
- **JSONB for events** — heterogeneous event types (thinking, text, tool_call, tool_result) are stored in a single table with JSONB data, avoiding rigid schema migrations
- **Prisma ORM** — type-safe database access with auto-generated types and simple migration management
- **No authentication** — single-user local development system; auth is documented as a future item

## Quick Start

### Prerequisites

- Docker and Docker Compose
- An Anthropic API key

### Setup

1. Clone the repository
2. Copy `.env.example` to `.env` and add your API key:

```bash
cp .env.example .env
# Edit .env and set ANTHROPIC_API_KEY
```

3. Start the system:

```bash
docker compose up
```

4. Open the web UI at [http://localhost:5173](http://localhost:5173)

That's it. The server will run database migrations automatically on startup.

### Port Conflicts

If the default ports (5432, 3000, 5173) are in use, override them in `.env`:

```bash
DB_PORT=5434
SERVER_PORT=3001
WEB_PORT=5174
```

## Agent Tools

The coding agent has four tools:

| Tool | Description |
|---|---|
| `read_file` | Read file contents |
| `write_file` | Write/create files (creates parent directories) |
| `execute_command` | Run shell commands with timeout |
| `list_directory` | List files and directories |

## Project Structure

```
packages/
├── shared/     # Shared types, protocol definitions, API types
├── server/     # Hono web server, REST API, WebSocket, SSE, Prisma
├── agent/      # Headless agent daemon, CLI, Anthropic API integration
└── web/        # React SPA, session management, live event stream
```

## Local Development (without Docker)

```bash
# Install dependencies
npm install

# Start PostgreSQL (or use an existing instance)
# Set DATABASE_URL in your environment

# Generate Prisma client and push schema
npm run db:generate -w packages/server
npm run db:push -w packages/server

# Start all services
npm run dev
```

## Future Items

- **Multi-session support** — allow the agent to handle multiple sessions concurrently
- **Additional agent tools** — git operations, web search, code search/grep, file patching
- **Authentication** — user accounts, API keys, session ownership
- **Conversation history** — multi-turn conversations within a session
- **Human-in-the-loop** — approval gates for dangerous operations (rm, git push, etc.)
- **Agent pool** — multiple agents with load balancing
- **File diff view** — show file changes made by the agent
- **Session resume** — continue a completed session with follow-up prompts

## Golden Path Evals

The `packages/evals` package contains 18 golden path evaluation tests that run the agent against real prompts and validate actual LLM output. Each test:

1. Creates an isolated temp workspace (with optional setup files)
2. Runs the agent via `runAgentLoop` with a specific prompt
3. Asserts on session completion, tool usage, file contents, and text output
4. Cleans up the temp directory

**Requirements:** `ANTHROPIC_API_KEY` must be set. Tests are skipped if it's missing.

```bash
# Run all golden path evals (builds first)
npm run evals

# Watch mode for iterative development
npm run evals:watch

# Run a single test by name
cd packages/evals && npx vitest run -t "1. Creates"
```

Tests are slow (~30s–2min each) since they invoke the real Claude API. Use `evals:watch` to run a subset during development.

## Coding Agent Usage

This project was built with the assistance of Claude Code (Anthropic's CLI coding agent). The `.claude/` directory contains the configuration used during development.
