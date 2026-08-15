"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  useSystemEvent,
  useSystemEventConnectionStatus,
  type SystemEventType,
} from "@/components/platform/SystemEventProvider";

export type BackgroundOperationObserverOptions<TSnapshot> = {
  endpoint: string;
  eventType: SystemEventType;
  initialSnapshot: TSnapshot;
  isActive: (snapshot: TSnapshot) => boolean;
  /** A bounded reconciliation need that is not represented by lifecycle events. */
  shouldReconcile?: (snapshot: TSnapshot) => boolean;
  fallbackBaseMs?: number;
  fallbackMaxMs?: number;
  reconcileMs?: number;
  jitterMs?: number;
};

export type BackgroundOperationObserver<TSnapshot> = {
  snapshot: TSnapshot;
  refresh: () => Promise<void>;
  pending: boolean;
  error: string | null;
};

const DEFAULT_FALLBACK_BASE_MS = 5_000;
const DEFAULT_FALLBACK_MAX_MS = 30_000;
const DEFAULT_RECONCILE_MS = 15_000;
const DEFAULT_JITTER_MS = 1_000;

/**
 * Observes durable background work without refreshing the current route.
 * System events are invalidation hints; every hint rehydrates a narrow,
 * authoritative snapshot. Reads are single-flight, abortable, visibility-aware,
 * and fall back to bounded polling only while push is unavailable (or a caller
 * declares a separate reconciliation signal such as job-engine recovery).
 */
export function useBackgroundOperationObserver<TSnapshot>(
  options: BackgroundOperationObserverOptions<TSnapshot>,
): BackgroundOperationObserver<TSnapshot> {
  const [snapshot, setSnapshot] = useState(options.initialSnapshot);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryAttempt, setRetryAttempt] = useState(0);
  const [visible, setVisible] = useState(
    () => typeof document === "undefined" || document.visibilityState !== "hidden",
  );
  const mountedRef = useRef(true);
  const controllerRef = useRef<AbortController | null>(null);
  const inFlightRef = useRef<Promise<void> | null>(null);
  const refreshQueuedRef = useRef(false);
  const priorTransportStatusRef = useRef<string | null>(null);
  const transportStatus = useSystemEventConnectionStatus();

  const refresh = useCallback((): Promise<void> => {
    if (inFlightRef.current) {
      // The current response may have been read before this invalidation.
      // Coalesce any number of overlapping hints into one follow-up read.
      refreshQueuedRef.current = true;
      return inFlightRef.current;
    }

    const controller = new AbortController();
    controllerRef.current = controller;
    if (mountedRef.current) setPending(true);

    const request = fetch(options.endpoint, {
      cache: "no-store",
      signal: controller.signal,
      headers: { Accept: "application/json" },
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Status refresh failed (${response.status})`);
        const next = (await response.json()) as TSnapshot;
        if (!controller.signal.aborted && mountedRef.current) {
          setSnapshot(next);
          setError(null);
          setRetryAttempt(0);
        }
      })
      .catch((caught: unknown) => {
        if (controller.signal.aborted || !mountedRef.current) return;
        setError(caught instanceof Error ? caught.message : "Status refresh failed");
        setRetryAttempt((attempt) => attempt + 1);
      })
      .finally(() => {
        if (controllerRef.current === controller) controllerRef.current = null;
        if (inFlightRef.current === request) inFlightRef.current = null;
        if (mountedRef.current) setPending(false);
        const refreshQueued = refreshQueuedRef.current;
        refreshQueuedRef.current = false;
        if (refreshQueued && mountedRef.current) void refresh();
      });

    inFlightRef.current = request;
    return request;
  }, [options.endpoint]);

  useSystemEvent(options.eventType, () => {
    void refresh();
  });

  useEffect(() => {
    const previous = priorTransportStatusRef.current;
    priorTransportStatusRef.current = transportStatus;
    if (transportStatus === "open" && previous && previous !== "open") {
      void refresh();
    }
  }, [refresh, transportStatus]);

  useEffect(() => {
    const onVisibilityChange = () => {
      const isVisible = document.visibilityState !== "hidden";
      setVisible(isVisible);
      if (isVisible) void refresh();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [refresh]);

  const active = options.isActive(snapshot);
  const reconcile = options.shouldReconcile?.(snapshot) ?? false;

  useEffect(() => {
    if (!visible) return;
    const transportUnavailable = transportStatus !== "open" && active;
    const projectionUnavailable = error !== null && active;
    if (!transportUnavailable && !projectionUnavailable && !reconcile) return;

    const fallbackBase = options.fallbackBaseMs ?? DEFAULT_FALLBACK_BASE_MS;
    const fallbackMax = options.fallbackMaxMs ?? DEFAULT_FALLBACK_MAX_MS;
    const jitterMax = options.jitterMs ?? DEFAULT_JITTER_MS;
    const delay = reconcile
      ? options.reconcileMs ?? DEFAULT_RECONCILE_MS
      : Math.min(fallbackMax, fallbackBase * 2 ** Math.min(retryAttempt, 6));
    const jitter = jitterMax > 0 ? Math.floor(Math.random() * jitterMax) : 0;
    const timer = setTimeout(() => void refresh(), delay + jitter);
    return () => clearTimeout(timer);
  }, [
    active,
    error,
    options.fallbackBaseMs,
    options.fallbackMaxMs,
    options.jitterMs,
    options.reconcileMs,
    reconcile,
    refresh,
    retryAttempt,
    transportStatus,
    visible,
  ]);

  useEffect(() => {
    mountedRef.current = true;
    if (document.visibilityState !== "hidden") void refresh();
    return () => {
      mountedRef.current = false;
      refreshQueuedRef.current = false;
      controllerRef.current?.abort();
    };
  }, [refresh]);

  return { snapshot, refresh, pending, error };
}
