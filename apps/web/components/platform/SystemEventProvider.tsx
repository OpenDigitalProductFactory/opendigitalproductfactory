"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import {
  useResilientEventSource,
  type ResilientEventSourceStatus,
} from "@/lib/hooks/useResilientEventSource";
import type {
  SystemQuiescenceEvent,
  SystemLocalModelEvent,
  SystemSelfUpgradeEvent,
} from "@/lib/tak/agent-event-bus";

type SystemEventMap = {
  "system:quiescence": SystemQuiescenceEvent;
  "system:self-upgrade": SystemSelfUpgradeEvent;
  "system:local-model": SystemLocalModelEvent;
};

export type SystemEventType = keyof SystemEventMap;
export type SystemEvent = SystemEventMap[SystemEventType];

type Subscriber = (event: SystemEvent) => void;

type SystemEventContextValue = {
  status: ResilientEventSourceStatus;
  subscribe: (subscriber: Subscriber) => () => void;
};

const SystemEventContext = createContext<SystemEventContextValue | null>(null);

/**
 * Owns the authenticated shell's single system EventSource connection.
 * Consumers subscribe in-process instead of opening another scarce HTTP/1.1
 * connection for the same stream.
 */
export function SystemEventProvider({ children }: { children: ReactNode }) {
  const subscribersRef = useRef(new Set<Subscriber>());

  const subscribe = useCallback((subscriber: Subscriber) => {
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

export function useSystemEvent<TType extends SystemEventType>(
  type: TType,
  handler: (event: SystemEventMap[TType]) => void,
): void {
  const context = useSystemEventContext();
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(
    () =>
      context.subscribe((event) => {
        if (event.type !== type) return;
        handlerRef.current(event as SystemEventMap[TType]);
      }),
    [context, type],
  );
}

export function useSystemEventConnectionStatus(): ResilientEventSourceStatus {
  return useSystemEventContext().status;
}

function useSystemEventContext(): SystemEventContextValue {
  const context = useContext(SystemEventContext);
  if (!context) {
    throw new Error("System event consumers must be rendered inside SystemEventProvider.");
  }
  return context;
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
