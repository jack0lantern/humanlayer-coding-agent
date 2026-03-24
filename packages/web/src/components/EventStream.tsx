import { useState, useEffect, useRef } from "react";
import type { EventDTO } from "@codingagent/shared";
import Markdown from "react-markdown";

interface EventStreamProps {
  events: EventDTO[];
  sessionStatus: string | null;
  onStop: () => void;
  onSendMessage: (message: string) => void;
  onEndSession: () => void;
}

export function EventStream({
  events,
  sessionStatus,
  onStop,
  onSendMessage,
  onEndSession,
}: EventStreamProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events]);

  if (events.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-zinc-500">
        {sessionStatus === "pending"
          ? "Waiting for agent..."
          : sessionStatus === "running"
            ? "Agent is starting..."
            : "Select a session to view events"}
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {sessionStatus === "running" && (
        <div className="flex items-center justify-between px-4 py-2 bg-zinc-900 border-b border-zinc-800">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
            <span className="text-xs text-zinc-400">Running</span>
          </div>
          <button
            onClick={onStop}
            className="text-xs bg-red-600/20 text-red-400 hover:bg-red-600/30 px-3 py-1 rounded-md transition-colors"
          >
            Stop
          </button>
        </div>
      )}

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
        {events.map((event) => (
          <EventBlock key={event.id} event={event} />
        ))}

        {sessionStatus && ["completed", "stopped", "failed"].includes(sessionStatus) && (
          <div className="text-center py-4">
            <span
              className={`text-xs px-3 py-1 rounded-full ${
                sessionStatus === "completed"
                  ? "bg-green-900/30 text-green-400"
                  : sessionStatus === "stopped"
                    ? "bg-zinc-800 text-zinc-400"
                    : "bg-red-900/30 text-red-400"
              }`}
            >
              Session {sessionStatus}
            </span>
          </div>
        )}
      </div>

      {sessionStatus === "waiting_for_user" && (
        <FollowUpInput onSend={onSendMessage} onEnd={onEndSession} />
      )}
    </div>
  );
}

function FollowUpInput({
  onSend,
  onEnd,
}: {
  onSend: (message: string) => void;
  onEnd: () => void;
}) {
  const [message, setMessage] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (message.trim()) {
      onSend(message.trim());
      setMessage("");
    }
  };

  return (
    <div className="border-t border-zinc-800 p-4">
      <div className="flex items-center gap-2 mb-2">
        <span className="w-2 h-2 rounded-full bg-amber-500" />
        <span className="text-xs text-zinc-400">Waiting for your input</span>
      </div>
      <form onSubmit={handleSubmit} className="flex gap-2">
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Send a follow-up message..."
          className="flex-1 bg-zinc-800 text-zinc-100 rounded-lg p-3 text-sm resize-none border border-zinc-700 focus:border-zinc-500 focus:outline-none placeholder-zinc-500"
          rows={2}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              handleSubmit(e);
            }
          }}
        />
        <div className="flex flex-col gap-2">
          <button
            type="submit"
            disabled={!message.trim()}
            className="bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white text-sm font-medium py-2 px-4 rounded-lg transition-colors"
          >
            Send
          </button>
          <button
            type="button"
            onClick={onEnd}
            className="bg-zinc-700 hover:bg-zinc-600 text-zinc-300 text-sm font-medium py-2 px-4 rounded-lg transition-colors"
          >
            End
          </button>
        </div>
      </form>
    </div>
  );
}

function EventBlock({ event }: { event: EventDTO }) {
  const data = event.data as Record<string, any>;

  switch (event.type) {
    case "thinking":
      return (
        <div className="text-zinc-500 text-xs italic border-l-2 border-zinc-700 pl-3 py-1">
          <span className="text-zinc-600 font-medium">thinking</span>
          <p className="mt-1 whitespace-pre-wrap">{data.content}</p>
        </div>
      );

    case "text":
      return (
        <div className="prose prose-invert prose-sm max-w-none">
          <Markdown>{data.content}</Markdown>
        </div>
      );

    case "tool_call":
      return (
        <div className="bg-zinc-900 rounded-lg border border-zinc-800 overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 bg-zinc-800/50 border-b border-zinc-800">
            <span className="text-xs font-mono text-blue-400">
              {data.toolName}
            </span>
          </div>
          <pre className="p-3 text-xs text-zinc-300 overflow-x-auto">
            {typeof data.input === "object"
              ? JSON.stringify(data.input, null, 2)
              : String(data.input)}
          </pre>
        </div>
      );

    case "tool_result":
      return (
        <div
          className={`bg-zinc-900 rounded-lg border overflow-hidden ${
            data.isError ? "border-red-800/50" : "border-zinc-800"
          }`}
        >
          <div className="flex items-center gap-2 px-3 py-2 bg-zinc-800/50 border-b border-zinc-800">
            <span
              className={`text-xs font-mono ${data.isError ? "text-red-400" : "text-green-400"}`}
            >
              {data.isError ? "error" : "result"}
            </span>
          </div>
          <pre className="p-3 text-xs text-zinc-300 overflow-x-auto max-h-64 overflow-y-auto whitespace-pre-wrap">
            {data.output}
          </pre>
        </div>
      );

    case "user_message":
      return (
        <div className="bg-blue-950/20 border border-blue-800/30 rounded-lg p-3">
          <span className="text-xs text-blue-400 font-medium">You</span>
          <div className="prose prose-invert prose-sm max-w-none mt-1">
            <Markdown>{data.content}</Markdown>
          </div>
        </div>
      );

    case "error":
      return (
        <div className="bg-red-950/30 border border-red-800/50 rounded-lg p-3">
          <span className="text-xs text-red-400 font-medium">Error</span>
          <p className="text-sm text-red-300 mt-1">{data.message}</p>
        </div>
      );

    case "session_complete":
      return null; // Handled by the parent component's status badge

    default:
      return (
        <div className="text-xs text-zinc-500">
          Unknown event: {event.type}
        </div>
      );
  }
}
