// ============================================================
// REST API Types: Server <-> UI
// ============================================================

import type { AgentStatus, SessionStatus, EventType } from "./protocol.js";

// --- Entity types (mirror DB shape for frontend consumption) ---

export interface AgentDTO {
  id: string;
  name: string;
  status: AgentStatus;
  workingDir: string | null;
  connectedAt: string | null;
  lastHeartbeat: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SessionDTO {
  id: string;
  agentId: string | null;
  prompt: string;
  status: SessionStatus;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  updatedAt: string;
}

export interface EventDTO {
  id: string;
  sessionId: string;
  type: EventType;
  data: Record<string, unknown>;
  sequence: number;
  createdAt: string;
}

// --- Request / Response types ---

export interface CreateSessionRequest {
  prompt: string;
}

export interface CreateSessionResponse {
  session: SessionDTO;
}

export interface ListSessionsResponse {
  sessions: SessionDTO[];
}

export interface GetSessionResponse {
  session: SessionDTO;
}

export interface ListAgentsResponse {
  agents: AgentDTO[];
}

export interface StopSessionResponse {
  session: SessionDTO;
}

export interface GetSessionEventsResponse {
  events: EventDTO[];
}

export interface SendMessageRequest {
  message: string;
}

export interface SendMessageResponse {
  session: SessionDTO;
}

export interface EndSessionResponse {
  session: SessionDTO;
}
