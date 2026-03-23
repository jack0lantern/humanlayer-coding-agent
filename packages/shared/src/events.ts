// ============================================================
// SSE Event Types: Server -> UI
// ============================================================

import type { EventDTO } from "./api.js";

// SSE event names
export const SSE_EVENT_NEW = "event" as const;
export const SSE_EVENT_SESSION_UPDATE = "session_update" as const;
export const SSE_EVENT_CONNECTED = "connected" as const;

// SSE data payloads
export interface SSENewEvent {
  event: EventDTO;
}

export interface SSESessionUpdate {
  sessionId: string;
  status: string;
}
