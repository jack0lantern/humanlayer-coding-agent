import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "./lib/api";
import { SessionList } from "./components/SessionList";
import { CreateSession } from "./components/CreateSession";
import { EventStream } from "./components/EventStream";
import { useSessionStream } from "./hooks/useSessionStream";

export default function App() {
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
    null
  );
  const queryClient = useQueryClient();

  // Fetch sessions
  const { data: sessionsData } = useQuery({
    queryKey: ["sessions"],
    queryFn: () => api.sessions.list(),
    refetchInterval: 3000,
  });

  // Fetch agents
  const { data: agentsData } = useQuery({
    queryKey: ["agents"],
    queryFn: () => api.agents.list(),
    refetchInterval: 5000,
  });

  // Create session mutation
  const createSession = useMutation({
    mutationFn: (prompt: string) => api.sessions.create(prompt),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
      setSelectedSessionId(data.session.id);
    },
  });

  // Stop session mutation
  const stopSession = useMutation({
    mutationFn: (id: string) => api.sessions.stop(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
    },
  });

  // Send follow-up message mutation
  const sendMessage = useMutation({
    mutationFn: ({ id, message }: { id: string; message: string }) =>
      api.sessions.sendMessage(id, message),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
    },
  });

  // End session mutation
  const endSession = useMutation({
    mutationFn: (id: string) => api.sessions.end(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
    },
  });

  // Stream events for selected session
  const { events, sessionStatus, stoppedBy } = useSessionStream(selectedSessionId);

  const sessions = sessionsData?.sessions || [];
  const agents = agentsData?.agents || [];
  const hasOnlineAgent = agents.some((a) => a.status === "online");

  // Get selected session's current status (prefer streamed status if available)
  const selectedSession = sessions.find((s) => s.id === selectedSessionId);
  const currentStatus = sessionStatus || selectedSession?.status || null;

  return (
    <div className="h-screen bg-zinc-950 text-zinc-100 flex">
      {/* Sidebar */}
      <div className="w-80 border-r border-zinc-800 flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-zinc-800">
          <h1 className="text-lg font-bold">Coding Agent</h1>
          <div className="flex items-center gap-2 mt-2">
            <span
              className={`w-2 h-2 rounded-full ${hasOnlineAgent ? "bg-green-500" : "bg-zinc-600"}`}
            />
            <span className="text-xs text-zinc-400">
              {hasOnlineAgent ? "Agent online" : "Agent offline"}
            </span>
          </div>
        </div>

        {/* Session list */}
        <div className="flex-1 overflow-y-auto">
          <SessionList
            sessions={sessions}
            selectedId={selectedSessionId}
            onSelect={setSelectedSessionId}
          />
        </div>

        {/* Create session */}
        <CreateSession
          onSubmit={(prompt) => createSession.mutate(prompt)}
          isDisabled={!hasOnlineAgent || createSession.isPending}
        />
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-h-0">
        {selectedSessionId ? (
          <>
            {/* Session header */}
            <div className="px-4 py-3 border-b border-zinc-800 bg-zinc-900/50">
              <p className="text-sm text-zinc-300 line-clamp-1">
                {selectedSession?.prompt || "Loading..."}
              </p>
              <p className="text-xs text-zinc-500 mt-1 font-mono">
                {selectedSessionId}
              </p>
            </div>

            {/* Event stream */}
            <EventStream
              events={events}
              sessionStatus={currentStatus}
              stoppedBy={stoppedBy}
              onStop={() => stopSession.mutate(selectedSessionId)}
              onSendMessage={(message) =>
                sendMessage.mutate({ id: selectedSessionId!, message })
              }
              onEndSession={() => endSession.mutate(selectedSessionId!)}
            />
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-zinc-600">
            <div className="text-center">
              <p className="text-lg">No session selected</p>
              <p className="text-sm mt-1">
                Create a session or select one from the sidebar
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
