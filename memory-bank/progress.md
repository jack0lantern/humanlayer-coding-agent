# Progress

## What Works

- Server: REST API for sessions/agents, WebSocket handler, SSE streaming, Prisma + PostgreSQL
- Agent: WebSocket registration, session assignment, LLM loop with four tools, event streaming
- Web: Session creation, live event stream, status display
- Evals: 18 golden path tests; run with `npm run evals` (requires `ANTHROPIC_API_KEY`)
- Docker Compose: Full stack with postgres, server, web, agent

## What's Left to Build (Future Items)

- Multi-session support
- Additional agent tools (git, web search, code search, file patching)
- Authentication
- Conversation history (multi-turn)
- Human-in-the-loop (approval gates for risky ops)
- Agent pool / load balancing
- File diff view
- Session resume

## Current Status

- Memory bank initialized
- Core system functional per README

## Known Issues

- No auth; single-user only
- Single agent processes one session at a time
- Evals are slow (real API calls)
