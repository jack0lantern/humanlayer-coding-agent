import { Hono } from "hono";
import { prisma } from "../db.js";
import type { AgentDTO } from "@codingagent/shared";

const agents = new Hono();

function toAgentDTO(agent: any): AgentDTO {
  return {
    id: agent.id,
    name: agent.name,
    status: agent.status,
    workingDir: agent.workingDir,
    connectedAt: agent.connectedAt?.toISOString() ?? null,
    lastHeartbeat: agent.lastHeartbeat?.toISOString() ?? null,
    createdAt: agent.createdAt.toISOString(),
    updatedAt: agent.updatedAt.toISOString(),
  };
}

// GET /api/agents - List all agents
agents.get("/", async (c) => {
  const list = await prisma.agent.findMany({
    orderBy: { createdAt: "desc" },
  });
  return c.json({ agents: list.map(toAgentDTO) });
});

export default agents;
