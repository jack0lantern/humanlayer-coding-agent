# Tech Context

## Technologies

| Layer | Stack |
|-------|-------|
| Server | Hono (Node.js), Prisma ORM |
| Database | PostgreSQL 16 |
| Agent | Node.js, tsx, Anthropic SDK |
| Frontend | React 19, Vite, TanStack Query, Tailwind CSS |
| Monorepo | npm workspaces |
| Containers | Docker Compose |

## Development Setup

### Docker (recommended)

```bash
cp .env.example .env   # set ANTHROPIC_API_KEY
docker compose up
# Web UI at http://localhost:5173
```

### Local (no Docker)

```bash
npm install
# Start PostgreSQL, set DATABASE_URL
npm run db:generate -w packages/server
npm run db:push -w packages/server
npm run dev
```

## Technical Constraints

- Agent requires `ANTHROPIC_API_KEY` for Claude
- `AGENT_SERVER_URL` points agent to server (e.g. `http://server:3000` in Docker)
- Ports: 5432 (DB), 3000 (server), 5173 (web)—all overridable via `.env`

## Dependencies

- **shared**: No runtime deps; pure types
- **server**: hono, prisma, ws, @hono/node-ws
- **agent**: @anthropic-ai/sdk
- **web**: react, @tanstack/react-query, tailwindcss
- **evals**: vitest, run against `runAgentLoop`

## Agent Tools

| Tool | Purpose |
|------|---------|
| read_file | Read file contents |
| write_file | Create/overwrite files (creates parent dirs) |
| execute_command | Run shell commands with timeout |
| list_directory | List files and directories |
