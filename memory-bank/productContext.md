# Product Context

## Why This Project Exists

Enables developers to run an AI coding agent (Claude) against a workspace and observe its actions in real time. The agent can read/write files and run commands; the UI streams every step.

## Problems It Solves

- **Visibility**: Developers see exactly what the agent is doing instead of waiting for final output
- **Observability**: All events are persisted to PostgreSQL for replay and debugging
- **Flexibility**: Agent connects outbound, so it can run in restrictive environments (CI, sandboxes, private networks)
- **Eval loop**: Golden path evals validate agent behavior against real prompts

## How It Should Work

1. User creates a session with a prompt.
2. Server stores session in DB; agent connects via WebSocket and fetches pending sessions.
3. Agent runs LLM loop with tools; each token/tool event is streamed to server, persisted, and relayed to UI via SSE.
4. User watches live output; session completes when agent signals `session_complete`.

## User Experience Goals

- Simple setup (Docker Compose + `.env` with API key)
- Responsive, real-time UI with no manual refresh
- Clear event types (thinking, text, tool_call, tool_result)
- Evals that catch regressions quickly
