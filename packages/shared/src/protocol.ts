// ============================================================
// WebSocket Protocol: Agent <-> Server
// ============================================================

// --- Enums ---

export type AgentStatus = "online" | "offline";

export type SessionStatus =
  | "pending"
  | "running"
  | "completed"
  | "stopped"
  | "failed"
  | "waiting_for_user";

export type EventType =
  | "thinking"
  | "text"
  | "tool_call"
  | "tool_result"
  | "error"
  | "session_complete"
  | "user_message";

// --- Agent -> Server Messages ---

export interface AgentRegisterMessage {
  type: "agent:register";
  agentId: string;
  name: string;
  workingDir: string;
}

export interface AgentHeartbeatMessage {
  type: "agent:heartbeat";
  agentId: string;
  timestamp: string;
}

export interface AgentSessionAckMessage {
  type: "agent:session:ack";
  sessionId: string;
  agentId: string;
}

export interface AgentEventMessage {
  type: "agent:event";
  sessionId: string;
  event: SessionEvent;
}

export type AgentMessage =
  | AgentRegisterMessage
  | AgentHeartbeatMessage
  | AgentSessionAckMessage
  | AgentEventMessage;

// --- Server -> Agent Messages ---

export interface ServerSessionAssignMessage {
  type: "server:session:assign";
  sessionId: string;
  prompt: string;
}

export interface ServerSessionStopMessage {
  type: "server:session:stop";
  sessionId: string;
}

export interface ServerSessionContinueMessage {
  type: "server:session:continue";
  sessionId: string;
  followUpMessage: string;
  /** The original session prompt, needed to reconstruct valid message history. */
  sessionPrompt: string;
  history: Array<{ type: string; data: Record<string, unknown> }>;
}

export interface ServerPongMessage {
  type: "server:pong";
  timestamp: string;
}

export type ServerMessage =
  | ServerSessionAssignMessage
  | ServerSessionStopMessage
  | ServerSessionContinueMessage
  | ServerPongMessage;

// --- Session Events (streamed from agent) ---

export interface ThinkingEvent {
  type: "thinking";
  content: string;
}

export interface TextEvent {
  type: "text";
  content: string;
}

export interface ToolCallEvent {
  type: "tool_call";
  toolName: string;
  toolCallId: string;
  input: Record<string, unknown>;
}

export interface ToolResultEvent {
  type: "tool_result";
  toolCallId: string;
  output: string;
  isError: boolean;
}

export interface ErrorEvent {
  type: "error";
  message: string;
}

export interface SessionCompleteEvent {
  type: "session_complete";
  status: "completed" | "stopped" | "failed" | "waiting_for_user";
  summary?: string;
}

export interface UserMessageEvent {
  type: "user_message";
  content: string;
}

export type SessionEvent =
  | ThinkingEvent
  | TextEvent
  | ToolCallEvent
  | ToolResultEvent
  | ErrorEvent
  | SessionCompleteEvent
  | UserMessageEvent;
