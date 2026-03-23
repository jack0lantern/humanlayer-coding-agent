import { useState, useEffect, useCallback, useRef } from "react";
import type { EventDTO } from "@codingagent/shared";

interface UseSessionStreamReturn {
  events: EventDTO[];
  sessionStatus: string | null;
  isConnected: boolean;
}

export function useSessionStream(
  sessionId: string | null
): UseSessionStreamReturn {
  const [events, setEvents] = useState<EventDTO[]>([]);
  const [sessionStatus, setSessionStatus] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!sessionId) {
      setEvents([]);
      setSessionStatus(null);
      setIsConnected(false);
      return;
    }

    // Reset state for new session
    setEvents([]);
    setSessionStatus(null);

    const es = new EventSource(`/api/sessions/${sessionId}/stream`);
    eventSourceRef.current = es;

    es.onopen = () => {
      setIsConnected(true);
    };

    es.addEventListener("event", (e) => {
      try {
        const data = JSON.parse(e.data);
        setEvents((prev) => {
          // Deduplicate by event ID
          if (prev.some((ev) => ev.id === data.event.id)) return prev;
          return [...prev, data.event];
        });
      } catch {
        // ignore parse errors
      }
    });

    es.addEventListener("session_update", (e) => {
      try {
        const data = JSON.parse(e.data);
        setSessionStatus(data.status);

        // Close connection if session is terminal
        if (["completed", "stopped", "failed"].includes(data.status)) {
          es.close();
          setIsConnected(false);
        }
      } catch {
        // ignore
      }
    });

    es.addEventListener("ping", () => {
      // keepalive, no action needed
    });

    es.onerror = () => {
      setIsConnected(false);
    };

    return () => {
      es.close();
      setIsConnected(false);
    };
  }, [sessionId]);

  return { events, sessionStatus, isConnected };
}
