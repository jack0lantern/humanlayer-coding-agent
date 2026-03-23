import type { WebSocket } from "ws";
import type { ServerMessage } from "@codingagent/shared";

// In-memory state for connected agents and SSE subscribers

interface ConnectedAgent {
  agentId: string;
  ws: WebSocket;
  name: string;
  workingDir: string;
}

type SSEWriter = (event: string, data: string) => void;

interface SSESubscriber {
  sessionId: string;
  write: SSEWriter;
  close: () => void;
}

// Single connected agent (single-session design)
let connectedAgent: ConnectedAgent | null = null;

// SSE subscribers per session
const sseSubscribers = new Map<string, SSESubscriber[]>();

export function getConnectedAgent(): ConnectedAgent | null {
  return connectedAgent;
}

export function setConnectedAgent(agent: ConnectedAgent | null) {
  connectedAgent = agent;
}

export function sendToAgent(message: ServerMessage) {
  if (connectedAgent && connectedAgent.ws.readyState === 1) {
    connectedAgent.ws.send(JSON.stringify(message));
  }
}

export function addSSESubscriber(subscriber: SSESubscriber) {
  const list = sseSubscribers.get(subscriber.sessionId) || [];
  list.push(subscriber);
  sseSubscribers.set(subscriber.sessionId, list);
}

export function removeSSESubscriber(sessionId: string, write: SSEWriter) {
  const list = sseSubscribers.get(sessionId) || [];
  const filtered = list.filter((s) => s.write !== write);
  if (filtered.length === 0) {
    sseSubscribers.delete(sessionId);
  } else {
    sseSubscribers.set(sessionId, filtered);
  }
}

export function broadcastSSE(sessionId: string, event: string, data: unknown) {
  const list = sseSubscribers.get(sessionId) || [];
  const json = JSON.stringify(data);
  for (const subscriber of list) {
    subscriber.write(event, json);
  }
}
