# Personas & Use Cases
## HumanLayer Coding Agent Platform

_Derived from the HumanLayer Take-Home Assessment brief. Authored from a senior UX design perspective._

---

## Overview

The system consists of three components: a **server** (API + database), a **headless coding agent daemon** (runs anywhere, polls the server), and a **reactive web UI** (session management + live event streaming). The personas below reflect the distinct humans who interact with each layer.

**Architecture note:** Your agent runs in a Docker container. Files are written to the agent's workspace, not your local machine.

---

## Persona 1 — The Individual Developer ("The Operator")

**Name:** Maya, 29
**Role:** Full-stack engineer, individual contributor
**Context:** Works at a startup or as a freelancer. Wants to offload rote coding tasks to an AI agent while she focuses on architecture or design.

**Technical profile:**
- Comfortable with CLI, Docker, and `.env` configs
- Familiar with LLM APIs (has an Anthropic or OpenAI key)
- Runs her own workstation and occasionally spins up containers for isolation

**Goals:**
- Start a coding session with a clear task prompt and let the agent work autonomously
- Watch the agent's live output (tool calls, reasoning tokens, file edits) to verify it's on track
- Kill the session quickly if the agent goes off-rails
- Keep her local machine uncluttered — prefer the agent to run in a container

**Pain points:**
- Agents that silently fail or produce no output feedback
- Long setup processes before she can start a session
- No way to interrupt or redirect a runaway agent

**Use cases:**
| # | Use Case | Description |
|---|----------|-------------|
| 1.1 | Create a session | Submit a task prompt via the UI; the daemon picks it up and starts the agent loop |
| 1.2 | Monitor live output | Watch streaming tool calls, thinking tokens, and assistant messages in real-time |
| 1.3 | Stop a session | Immediately halt the agent mid-task if the output looks wrong |
| 1.4 | Run agent in a container | Start the daemon inside Docker so it doesn't touch her host filesystem |
| 1.5 | Configure LLM API key | Set `ANTHROPIC_API_KEY` (or equivalent) in `.env` before running `docker compose up` |

---

## Persona 2 — The Tech Lead / Engineering Manager ("The Overseer")

**Name:** Daniel, 38
**Role:** Engineering manager, team of 6 engineers
**Context:** Evaluating whether to integrate a coding agent platform into the team's workflow. Cares about visibility, auditability, and control — not just raw output.

**Technical profile:**
- Strong engineering background, now mostly in architecture and code review
- Comfortable reading code but not writing it daily
- Skeptical of "black box" AI — wants to see what the agent is actually doing

**Goals:**
- Review a historical log of what an agent did during a session
- Understand whether the agent used safe, reversible operations
- Ensure the agent can be stopped at any point by any authorized team member
- Assess whether the system is production-ready for the team

**Pain points:**
- No audit trail of agent actions
- Agents that make irreversible changes without confirmation
- Unclear system architecture that's hard to explain to leadership

**Use cases:**
| # | Use Case | Description |
|---|----------|-------------|
| 2.1 | View session history | Browse past sessions, their prompts, and the full event log |
| 2.2 | Inspect tool calls | See exactly which files were read/written, commands run, etc. |
| 2.3 | Stop a running session | Halt an agent that another team member started |
| 2.4 | Evaluate architecture fit | Review the server/daemon separation model for security posture |
| 2.5 | Assess live-streaming reliability | Verify that events are saved to the DB even if the UI is closed |

---

## Persona 3 — The DevOps / Platform Engineer ("The Deployer")

**Name:** Priya, 33
**Role:** Platform/infrastructure engineer
**Context:** Responsible for deploying and maintaining internal tooling. Gets handed the project and is asked to make it run reliably.

**Technical profile:**
- Expert in Docker, Compose, Kubernetes, CI/CD
- Comfortable with Postgres, environment variable management, networking
- Does not write application code; cares about reliability, ports, secrets, and restartability

**Goals:**
- Get the entire system running with a single `docker compose up`
- Understand which ports are exposed and which are intentionally internal
- Ensure the agent container has no inbound ports (security requirement)
- Configure secrets via `.env` without modifying Compose files

**Pain points:**
- Compose files that require manual pre-build steps
- Containers that expose unnecessary ports
- Hardcoded secrets or missing environment variable documentation

**Use cases:**
| # | Use Case | Description |
|---|----------|-------------|
| 3.1 | Deploy via Compose | Run `docker compose up` and have server, DB, and agent container all start correctly |
| 3.2 | Configure API keys | Place `ANTHROPIC_API_KEY` and DB credentials in `.env`; no other config required |
| 3.3 | Verify port exposure | Confirm server/UI ports are open; agent container has no exposed ports |
| 3.4 | Inspect container networking | Validate agent can poll server outbound; server cannot initiate inbound to agent |
| 3.5 | Restart agent daemon | Restart the agent container independently without losing server or DB state |
| 3.6 | Scale or swap agent container | Replace the Ubuntu agent container with a different sandbox image |

---

## Persona 4 — The Security-Conscious Enterprise Evaluator ("The Gatekeeper")

**Name:** Ravi, 45
**Role:** Security architect at a mid-size enterprise
**Context:** Evaluating whether to allow the coding agent to run inside their air-gapped or VPC-restricted network. The agent must not create inbound attack surface.

**Technical profile:**
- Deep security background (network, AppSec, cloud)
- Not a daily coder; reads architecture diagrams and threat models
- Has hard requirements around outbound-only connections, audit logs, and secrets management

**Goals:**
- Confirm the agent container never accepts inbound connections
- Understand the data flow: what leaves the private network and when
- Verify that LLM API calls (outbound) are the only external traffic
- Ensure session events are persisted so nothing is lost if the network blips

**Pain points:**
- Systems where the server "calls back" into the agent (requires inbound ports)
- Unclear data retention policies for session logs
- LLM prompt data that includes sensitive source code leaving the network

**Use cases:**
| # | Use Case | Description |
|---|----------|-------------|
| 4.1 | Run agent in private network | Agent polls server outbound; server never initiates connection to agent |
| 4.2 | Audit event persistence | Confirm all tool calls and messages are written to DB before any UI displays them |
| 4.3 | Restrict agent container networking | Agent container has no exposed ports; only outbound traffic to server |
| 4.4 | Review LLM data flow | Understand what is sent to the LLM API and whether source code is included |
| 4.5 | Stop a session remotely | Terminate an agent session from the web UI without direct agent access |

---

## Persona 5 — The AI Product Builder ("The Integrator")

**Name:** Sofi, 27
**Role:** Developer advocate / AI product engineer at a tools startup
**Context:** Building a product on top of or alongside HumanLayer's platform. Wants to understand the API surface, extensibility, and session event schema.

**Technical profile:**
- Strong TypeScript skills; comfortable with REST and streaming APIs
- Evaluating whether to use this as a backend for their own coding agent product
- Will read source code to understand the architecture

**Goals:**
- Understand the API for session creation and event retrieval
- Inspect the sync/streaming mechanism to know what events are emitted
- Evaluate whether the agent loop is extensible (new tools, different LLM providers)
- Assess the quality and structure of the TypeScript codebase

**Pain points:**
- Opaque or undocumented APIs
- Tight coupling between agent logic and server that makes extension hard
- Sessions that can't be queried after the fact (ephemeral-only)

**Use cases:**
| # | Use Case | Description |
|---|----------|-------------|
| 5.1 | Create a session via API | `POST /sessions` with a task prompt; observe the response schema |
| 5.2 | Stream session events | Subscribe to live session events (SSE or WebSocket) from the server |
| 5.3 | Query historical events | `GET /sessions/:id/events` to retrieve the full event log after completion |
| 5.4 | Swap the LLM provider | Replace Anthropic SDK calls with OpenAI or a local model |
| 5.5 | Add a custom agent tool | Extend the agent loop with a new tool (e.g. database query, web search) |

---

## Cross-Persona Feature Priority Matrix

| Feature | Maya (Operator) | Daniel (Overseer) | Priya (Deployer) | Ravi (Gatekeeper) | Sofi (Integrator) |
|---------|:-:|:-:|:-:|:-:|:-:|
| Create session (UI) | ★★★ | ★★ | ★ | ★ | ★★ |
| Live event streaming | ★★★ | ★★★ | ★ | ★★ | ★★★ |
| Stop session | ★★★ | ★★★ | ★ | ★★★ | ★★ |
| Session history / audit log | ★★ | ★★★ | ★ | ★★★ | ★★★ |
| docker compose up (zero config) | ★★★ | ★ | ★★★ | ★★ | ★★ |
| Outbound-only agent networking | ★ | ★ | ★★★ | ★★★ | ★ |
| REST API access | ★ | ★ | ★ | ★ | ★★★ |
| LLM provider swappability | ★★ | ★ | ★ | ★★ | ★★★ |

_★★★ = critical &nbsp; ★★ = important &nbsp; ★ = nice-to-have_

---

## Key Design Principles (derived from personas)

1. **Outbound-only agent connectivity** — the daemon polls the server; the server never reaches into the agent. This is the single most critical architectural constraint, driven by Priya and Ravi.

2. **Streaming-first event model** — events must be visible live in the UI and persisted to the DB atomically. Maya and Daniel both need this; Sofi needs to query it after.

3. **Zero-step startup** — `docker compose up` is the entire setup. Priya requires this; Maya benefits from it.

4. **Session as the primary object** — all personas reason in terms of sessions (create, monitor, stop, query). The UI and API should be session-centric.

5. **Hard stop control** — every persona except the Deployer has "stop a session" as a top-3 need. It must be instant and reliable.
