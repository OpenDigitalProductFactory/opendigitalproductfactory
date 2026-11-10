"use client";

import { useCallback, useMemo, useRef, type ReactNode } from "react";
import { useResilientEventSource } from "@/lib/hooks/useResilientEventSource";
import {
  SystemEventContext,
  type SystemEvent,
  type SystemEventSubscriber,
} from "@/lib/hooks/system-events";

/**
 * Owns the authenticated shell's single system EventSource connection.
 * Consumers subscribe in-process instead of opening another scarce HTTP/1.1
 * connection for the same stream. The context and the consumer hooks
 * (`useSystemEvent`, `useSystemEventConnectionStatus`) live in
 * lib/hooks/system-events.ts.
 */
export function SystemEventProvider({ children }: { children: ReactNode }) {
  const subscribersRef = useRef(new Set<SystemEventSubscriber>());

  const subscribe = useCallback((subscriber: SystemEventSubscriber) => {
    subscribersRef.current.add(subscriber);
    return () => subscribersRef.current.delete(subscriber);
  }, []);

  const { status } = useResilientEventSource("/api/agent/system-stream", {
    onMessage: (message) => {
      const event = parseSystemEvent(message.data);
      if (!event) return;
      for (const subscriber of subscribersRef.current) {
        try {
          subscriber(event);
        } catch (error) {
          // One page observer must never break delivery to the shell or peers.
          console.error("[system-events] subscriber failed", error);
        }
      }
    },
  });

  const value = useMemo(() => ({ status, subscribe }), [status, subscribe]);
  return <SystemEventContext.Provider value={value}>{children}</SystemEventContext.Provider>;
}

function parseSystemEvent(data: unknown): SystemEvent | null {
  if (typeof data !== "string") return null;
  try {
    const value = JSON.parse(data) as { type?: unknown };
    if (typeof value.type !== "string" || !value.type.startsWith("system:")) return null;
    return value as SystemEvent;
  } catch {
    return null;
  }
}
