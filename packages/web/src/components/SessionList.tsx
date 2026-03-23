import type { SessionDTO } from "@codingagent/shared";

interface SessionListProps {
  sessions: SessionDTO[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

const statusColors: Record<string, string> = {
  pending: "bg-yellow-500",
  running: "bg-blue-500 animate-pulse",
  completed: "bg-green-500",
  stopped: "bg-zinc-500",
  failed: "bg-red-500",
};

export function SessionList({
  sessions,
  selectedId,
  onSelect,
}: SessionListProps) {
  if (sessions.length === 0) {
    return (
      <div className="p-4 text-zinc-500 text-sm">
        No sessions yet. Create one to get started.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1 p-2">
      {sessions.map((session) => (
        <button
          key={session.id}
          onClick={() => onSelect(session.id)}
          className={`text-left p-3 rounded-lg transition-colors ${
            selectedId === session.id
              ? "bg-zinc-700 border border-zinc-600"
              : "hover:bg-zinc-800 border border-transparent"
          }`}
        >
          <div className="flex items-center gap-2 mb-1">
            <span
              className={`w-2 h-2 rounded-full ${statusColors[session.status] || "bg-zinc-500"}`}
            />
            <span className="text-xs text-zinc-400 font-mono">
              {session.status}
            </span>
          </div>
          <p className="text-sm text-zinc-200 line-clamp-2">
            {session.prompt}
          </p>
          <p className="text-xs text-zinc-500 mt-1">
            {new Date(session.createdAt).toLocaleTimeString()}
          </p>
        </button>
      ))}
    </div>
  );
}
