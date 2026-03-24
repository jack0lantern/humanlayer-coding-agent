import { useState, useEffect, useRef } from "react";
import type { EventDTO } from "@codingagent/shared";

interface UseSessionStreamReturn {
  events: EventDTO[];
  sessionStatus: string | null;
  stoppedBy: string | null;
  isConnected: boolean;
}

export function useSessionStream(
  sessionId: string | null
): UseSessionStreamReturn {
  const [events, setEvents] = useState<EventDTO[]>([]);
  const [sessionStatus, setSessionStatus] = useState<string | null>(null);
  const [stoppedBy, setStoppedBy] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const lastSequenceRef = useRef<number>(0);

  useEffect(() => {
    if (!sessionId) {
      setEvents([]);
      setSessionStatus(null);
      setStoppedBy(null);
      setIsConnected(false);
      lastSequenceRef.current = 0;
      return;
    }

    // Reset state for new session
    setEvents([]);
    setSessionStatus(null);
    setStoppedBy(null);
    lastSequenceRef.current = 0;

    let cancelled = false;

    function connect(afterSequence: number) {
      if (cancelled) return;

      const url =
        afterSequence > 0
          ? `/api/sessions/${sessionId}/stream?after=${afterSequence}`
          : `/api/sessions/${sessionId}/stream`;

      const es = new EventSource(url);
      eventSourceRef.current = es;

      es.onopen = () => {
        setIsConnected(true);
      };

      es.addEventListener("event", (e) => {
        try {
          const data = JSON.parse(e.data);
          const event: EventDTO = data.event;
          // Track highest sequence seen
          if (event.sequence > lastSequenceRef.current) {
            lastSequenceRef.current = event.sequence;
          }
          setEvents((prev) => {
            if (prev.some((ev) => ev.id === event.id)) return prev;
            return [...prev, event];
          });
        } catch {
          // ignore parse errors
        }
      });

      es.addEventListener("backfill_done", (e) => {
        try {
          const data = JSON.parse(e.data);
          if (data.hasMore) {
            // More historical events to fetch — reconnect from where we left off
            es.close();
            connect(data.lastSequence);
          }
        } catch {
          // ignore
        }
      });

      es.addEventListener("session_update", (e) => {
        try {
          const data = JSON.parse(e.data);
          setSessionStatus(data.status);
          if (data.stoppedBy) setStoppedBy(data.stoppedBy);

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
    }

    connect(0);

    return () => {
      cancelled = true;
      eventSourceRef.current?.close();
      setIsConnected(false);
    };
  }, [sessionId]);

  return { events, sessionStatus, stoppedBy, isConnected };
}
