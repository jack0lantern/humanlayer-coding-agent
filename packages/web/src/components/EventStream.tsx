import { useState, useEffect, useRef, useCallback } from "react";
import type { EventDTO } from "@codingagent/shared";
import Markdown from "react-markdown";

function ConfirmDialog({
  title,
  message,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-6 max-w-sm w-full mx-4 shadow-2xl">
        <h3 className="text-sm font-semibold text-zinc-100">{title}</h3>
        <p className="text-sm text-zinc-400 mt-2">{message}</p>
        <div className="flex justify-end gap-2 mt-5">
          <button
            onClick={onCancel}
            className="text-sm px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="text-sm px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white font-medium transition-colors"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

interface EventStreamProps {
  events: EventDTO[];
  sessionStatus: string | null;
  stoppedBy?: string | null;
  onStop: () => void;
  onSendMessage: (message: string) => void;
  onEndSession: () => void;
  onDownload: () => void;
}

/** Latest `loop_step` message from the agent loop, if any (search newest first). */
function getLatestLoopStepMessage(events: EventDTO[]): string | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i];
    if (ev.type !== "loop_step") continue;
    const msg = ev.data?.message;
    if (typeof msg === "string" && msg.length > 0) return msg;
  }
  return undefined;
}

export function EventStream({
  events,
  sessionStatus,
  stoppedBy,
  onStop,
  onSendMessage,
  onEndSession,
  onDownload,
}: EventStreamProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [confirmAction, setConfirmAction] = useState<"stop" | "end" | null>(null);
  const loopStepMessage = getLatestLoopStepMessage(events);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events, sessionStatus]);

  const handleConfirmedStop = useCallback(() => {
    setConfirmAction(null);
    onStop();
  }, [onStop]);

  const handleConfirmedEnd = useCallback(() => {
    setConfirmAction(null);
    onEndSession();
  }, [onEndSession]);

  if (events.length === 0) {
    const showLoading =
      sessionStatus === "pending" || sessionStatus === "running";
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex-1 flex flex-col items-center justify-center gap-3 p-6 text-zinc-500">
          {showLoading ? (
            <>
              <div className="flex items-center gap-2 text-zinc-400">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-40" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-blue-500" />
                </span>
                <span className="text-sm text-center max-w-md">
                  {sessionStatus === "pending"
                    ? "Waiting for an agent to pick up this session…"
                    : loopStepMessage ?? "Agent is starting…"}
                </span>
              </div>
            </>
          ) : (
            <p>Select a session to view events</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {confirmAction === "stop" && (
        <ConfirmDialog
          title="Stop Agent"
          message="This will interrupt the agent mid-task. The session will be marked as stopped and cannot be resumed."
          confirmLabel="Stop Agent"
          onConfirm={handleConfirmedStop}
          onCancel={() => setConfirmAction(null)}
        />
      )}
      {confirmAction === "end" && (
        <ConfirmDialog
          title="End Session"
          message="This will mark the session as completed. You won't be able to send further messages."
          confirmLabel="End Session"
          onConfirm={handleConfirmedEnd}
          onCancel={() => setConfirmAction(null)}
        />
      )}

      {sessionStatus === "running" && (
        <div className="flex items-center justify-between px-4 py-2 bg-zinc-900 border-b border-zinc-800 gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <span className="w-2 h-2 shrink-0 rounded-full bg-blue-500 animate-pulse" />
            <div className="min-w-0 flex flex-col gap-0.5">
              <span className="text-xs text-zinc-400">Running</span>
              {loopStepMessage ? (
                <span className="text-xs text-zinc-500 truncate" title={loopStepMessage}>
                  {loopStepMessage}
                </span>
              ) : null}
            </div>
          </div>
          <button
            onClick={() => setConfirmAction("stop")}
            className="text-xs bg-red-600/20 text-red-400 hover:bg-red-600/30 px-3 py-1 rounded-md transition-colors"
            title="Interrupt the agent mid-task and stop the session"
          >
            Stop Agent
          </button>
        </div>
      )}

      <div ref={scrollRef} className="flex-1 overflow-y-auto overflow-x-hidden p-4 space-y-3">
        {events.map((event) => (
          <EventBlock key={event.id} event={event} />
        ))}

        {sessionStatus === "running" && (
          <div
            className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/80 px-3 py-2.5 text-sm text-zinc-400"
            aria-live="polite"
            aria-busy="true"
          >
            <span className="relative flex h-2 w-2 shrink-0">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-40" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-blue-500" />
            </span>
            <span className="min-w-0">{loopStepMessage ?? "Agent is working…"}</span>
          </div>
        )}

        {sessionStatus && ["completed", "stopped", "failed"].includes(sessionStatus) && (
          <div className="text-center py-4 flex items-center justify-center gap-3">
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
              {stoppedBy && ` by ${stoppedBy}`}
            </span>
            <button
              onClick={onDownload}
              className="text-xs px-3 py-1 rounded-full bg-blue-600/20 text-blue-400 hover:bg-blue-600/30 transition-colors"
              title="Download project files as zip"
            >
              Download Project
            </button>
          </div>
        )}
      </div>

      {sessionStatus === "waiting_for_user" && (
        <FollowUpInput onSend={onSendMessage} onEnd={() => setConfirmAction("end")} onDownload={onDownload} />
      )}
    </div>
  );
}

function FollowUpInput({
  onSend,
  onEnd,
  onDownload,
}: {
  onSend: (message: string) => void;
  onEnd: () => void;
  onDownload: () => void;
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
    <div className="border-t border-zinc-800 p-4 min-w-0 shrink-0">
      <div className="flex items-center gap-2 mb-2">
        <span className="w-2 h-2 rounded-full bg-amber-500" />
        <span className="text-xs text-zinc-400">Waiting for your input</span>
      </div>
      <form onSubmit={handleSubmit} className="flex gap-2 min-w-0 max-w-full">
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Send a follow-up message..."
          className="min-w-0 flex-1 max-w-full bg-zinc-800 text-zinc-100 rounded-lg p-3 text-sm resize-none border border-zinc-700 focus:border-zinc-500 focus:outline-none placeholder-zinc-500"
          rows={2}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              handleSubmit(e);
            }
          }}
        />
        <div className="flex shrink-0 flex-col gap-2">
          <button
            type="submit"
            disabled={!message.trim()}
            className="bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white text-sm font-medium py-2 px-4 rounded-lg transition-colors"
          >
            Send
          </button>
          <button
            type="button"
            onClick={onDownload}
            className="bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 text-sm font-medium py-2 px-4 rounded-lg transition-colors border border-blue-600/30"
            title="Download project files as zip"
          >
            Download
          </button>
          <button
            type="button"
            onClick={onEnd}
            className="bg-red-600/20 hover:bg-red-600/30 text-red-400 text-sm font-medium py-2 px-4 rounded-lg transition-colors border border-red-600/30"
            title="End session — no further messages can be sent"
          >
            End Session
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

    case "loop_step":
      return null;

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
          <pre className="p-3 text-xs text-zinc-300 overflow-x-auto whitespace-pre-wrap break-words">
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
