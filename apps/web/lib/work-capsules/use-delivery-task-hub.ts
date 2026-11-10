"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useResilientEventSource } from "@/lib/hooks/useResilientEventSource";
import {
  DELIVERY_TASK_HUB_EVENT,
  mergeDeliveryTaskHubEvent,
  type DeliveryTaskHubClientState,
  type DeliveryTaskHubEvent,
} from "./delivery-task-stream";
import type { DeliveryTaskHubPage } from "./delivery-task-hub-store";
import type { DeliveryTaskHubRow } from "./delivery-task-hub";

function parseEvent(event: MessageEvent): DeliveryTaskHubEvent | null {
  try {
    const value = JSON.parse(String(event.data)) as { type?: unknown };
    return ["snapshot", "upsert", "remove", "error"].includes(String(value.type))
      ? value as DeliveryTaskHubEvent
      : null;
  } catch {
    return null;
  }
}

export function useDeliveryTaskHub(initialPage: DeliveryTaskHubPage) {
  const [live, setLive] = useState<DeliveryTaskHubClientState>({ ...initialPage, error: null });
  const [olderRows, setOlderRows] = useState<DeliveryTaskHubRow[]>([]);
  const [olderCursor, setOlderCursor] = useState(initialPage.nextCursor);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [olderError, setOlderError] = useState<string | null>(null);
  const pagingGenerationRef = useRef(0);
  const pagingAbortRef = useRef<AbortController | null>(null);

  useEffect(() => () => pagingAbortRef.current?.abort(), []);

  const onStreamEvent = useCallback((message: MessageEvent) => {
    const event = parseEvent(message);
    if (!event) return;
    setLive((current) => mergeDeliveryTaskHubEvent(current, event));
    if (event.type === "snapshot") {
      pagingGenerationRef.current += 1;
      pagingAbortRef.current?.abort();
      pagingAbortRef.current = null;
      setLoadingOlder(false);
      setOlderError(null);
      setOlderCursor(event.nextCursor);
      setOlderRows([]);
    }
    if (event.type === "upsert" || event.type === "remove") {
      const capsuleId = event.type === "upsert" ? event.row.capsuleId : event.capsuleId;
      setOlderRows((rows) => rows.filter((row) => row.capsuleId !== capsuleId));
    }
  }, []);
  const { status: streamStatus } = useResilientEventSource("/api/work-capsules/delivery-stream", {
    onMessage: () => {},
    onNamed: { [DELIVERY_TASK_HUB_EVENT]: onStreamEvent },
  });

  const rows = useMemo(() => {
    const liveIds = new Set(live.rows.map((row) => row.capsuleId));
    return [...live.rows, ...olderRows.filter((row) => !liveIds.has(row.capsuleId))];
  }, [live.rows, olderRows]);

  const loadOlder = async () => {
    if (!olderCursor || loadingOlder || pagingAbortRef.current) return;
    const generation = pagingGenerationRef.current;
    const controller = new AbortController();
    pagingAbortRef.current = controller;
    setLoadingOlder(true);
    setOlderError(null);
    try {
      const response = await fetch(`/api/work-capsules/delivery-page?cursor=${encodeURIComponent(olderCursor)}`, {
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("page_failed");
      const page = await response.json() as DeliveryTaskHubPage;
      if (controller.signal.aborted || generation !== pagingGenerationRef.current) return;
      setOlderRows((current) => {
        const existing = new Set(current.map((row) => row.capsuleId));
        return [...current, ...page.rows.filter((row) => !existing.has(row.capsuleId))];
      });
      setOlderCursor(page.nextCursor);
    } catch {
      if (!controller.signal.aborted && generation === pagingGenerationRef.current) {
        setOlderError("Older delivery tasks could not be loaded.");
      }
    } finally {
      if (pagingAbortRef.current === controller) {
        pagingAbortRef.current = null;
        setLoadingOlder(false);
      }
    }
  };

  return { rows, observedAt: live.observedAt, liveError: live.error, streamStatus, olderCursor, loadingOlder, olderError, loadOlder };
}
