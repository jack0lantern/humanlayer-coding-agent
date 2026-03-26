import type {
  CreateSessionResponse,
  ListSessionsResponse,
  GetSessionResponse,
  StopSessionResponse,
  SendMessageResponse,
  EndSessionResponse,
  ListAgentsResponse,
  GetSessionEventsResponse,
} from "@codingagent/shared";

const BASE = "/api";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(error.error || res.statusText);
  }
  return res.json();
}

export const api = {
  sessions: {
    list: () => request<ListSessionsResponse>("/sessions"),
    get: (id: string) => request<GetSessionResponse>(`/sessions/${id}`),
    create: (prompt: string, repoUrl?: string) =>
      request<CreateSessionResponse>("/sessions", {
        method: "POST",
        body: JSON.stringify({ prompt, ...(repoUrl && { repoUrl }) }),
      }),
    stop: (id: string) =>
      request<StopSessionResponse>(`/sessions/${id}/stop`, {
        method: "POST",
      }),
    events: (id: string) =>
      request<GetSessionEventsResponse>(`/sessions/${id}/events`),
    sendMessage: (id: string, message: string) =>
      request<SendMessageResponse>(`/sessions/${id}/message`, {
        method: "POST",
        body: JSON.stringify({ message }),
      }),
    end: (id: string) =>
      request<EndSessionResponse>(`/sessions/${id}/end`, {
        method: "POST",
      }),
    download: async (id: string) => {
      const res = await fetch(`${BASE}/sessions/${id}/download`);
      if (!res.ok) {
        const error = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(error.error || res.statusText);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `session-${id.slice(0, 8)}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      // Delay revocation so the browser has time to start the download
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
  },
  agents: {
    list: () => request<ListAgentsResponse>("/agents"),
  },
};
