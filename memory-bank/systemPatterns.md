# System Patterns

## Architecture

```
Web UI (React)  ←── SSE ──→  Server (Hono)  ←── WebSocket ──→  Agent (Node+tsx)
                     │              │
                     │         PostgreSQL (Prisma)
                     │              │
                     └──────────────┘
```

- **Web → Server**: REST for CRUD, SSE for event streaming (read-heavy, proxy-friendly)
- **Agent → Server**: Outbound WebSocket; agent pulls pending sessions, streams events back
- **Server → DB**: Prisma ORM, PostgreSQL 16

## Key Technical Decisions

| Decision | Rationale |
|----------|------------|
| Agent connects outbound | Runs in sandboxes/private networks with no inbound ports |
| SSE for UI | Simpler than WebSocket for one-way streaming; works through nginx |
| JSONB for events | Heterogeneous event types (thinking, text, tool_call, tool_result) in one table |
| Delta streaming | Every token and tool result is a discrete event, persisted and relayed |
| Prisma | Type-safe DB access, easy migrations |

## Design Patterns

- **Event sourcing style**: Events append to `events` table; session state derived from event stream
- **Single-agent model**: One connected agent processes one session at a time (multi-session is future)
- **Monorepo**: npm workspaces with `shared`, `server`, `agent`, `web`, `evals`

## Component Relationships

- `shared`: Types, protocol, API shapes; used by server, agent, and web
- `server`: REST routes, WebSocket handler, SSE broadcaster, Prisma models
- `agent`: Registers via WebSocket, receives session assignments, runs `runAgentLoop` with Anthropic SDK
- `web`: TanStack Query for API, custom hook for SSE stream, React 19 + Vite
