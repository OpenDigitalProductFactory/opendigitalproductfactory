"use client";

import { createContext, useContext, useEffect, useRef } from "react";
import type { ResilientEventSourceStatus } from "@/lib/hooks/useResilientEventSource";
import type {
  SystemQuiescenceEvent,
  SystemLocalModelEvent,
  SystemSelfUpgradeEvent,
} from "@/lib/tak/agent-event-bus";

// The shell's system-event fan-out contract: the context that
// components/platform/SystemEventProvider.tsx fills from its one EventSource
// connection, and the hooks consumers subscribe through. Kept in lib so lib
// hooks (usePlatformReady, useBackgroundOperationObserver) never import
// components/** (M11 lib/ui layering).

export type SystemEventMap = {
  "system:quiescence": SystemQuiescenceEvent;
  "system:self-upgrade": SystemSelfUpgradeEvent;
  "system:local-model": SystemLocalModelEvent;
};

export type SystemEventType = keyof SystemEventMap;
export type SystemEvent = SystemEventMap[SystemEventType];

export type SystemEventSubscriber = (event: SystemEvent) => void;

export type SystemEventContextValue = {
  status: ResilientEventSourceStatus;
  subscribe: (subscriber: SystemEventSubscriber) => () => void;
};

export const SystemEventContext = createContext<SystemEventContextValue | null>(null);

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
