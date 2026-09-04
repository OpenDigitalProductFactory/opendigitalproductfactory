import type { WorkCapsuleActivityEvent } from "./activity-events";
import type { DeliveryTaskHubPage } from "./delivery-task-hub-store";
import type { DeliveryTaskHubRow } from "./delivery-task-hub";

export const DELIVERY_TASK_HUB_EVENT = "delivery-task-hub";

export type DeliveryTaskHubEvent =
  | ({ type: "snapshot" } & DeliveryTaskHubPage)
  | { type: "upsert"; row: DeliveryTaskHubRow; observedAt: string }
  | { type: "remove"; capsuleId: string; observedAt: string }
  | { type: "error"; error: string; observedAt: string };

export type DeliveryTaskHubClientState = DeliveryTaskHubPage & { error: string | null };

export function mergeDeliveryTaskHubEvent(
  state: DeliveryTaskHubClientState,
  event: DeliveryTaskHubEvent,
): DeliveryTaskHubClientState {
  if (event.type === "snapshot") return { ...event, error: null };
  if (event.type === "error") return { ...state, observedAt: event.observedAt, error: event.error };
  if (event.type === "remove") {
    return { ...state, rows: state.rows.filter((row) => row.capsuleId !== event.capsuleId), observedAt: event.observedAt, error: null };
  }
  const current = state.rows.find((row) => row.capsuleId === event.row.capsuleId);
  if (current && current.observedAt >= event.row.observedAt) return state;
  return {
    ...state,
    rows: current
      ? state.rows.map((row) => row.capsuleId === event.row.capsuleId ? event.row : row)
      : [event.row, ...state.rows],
    observedAt: event.observedAt,
    error: null,
  };
}

export async function startDeliveryTaskHubSession(input: {
  send: (event: DeliveryTaskHubEvent) => void;
  loadSnapshot: () => Promise<DeliveryTaskHubPage>;
  loadRow: (workroomId: string) => Promise<{ capsuleId: string; row: DeliveryTaskHubRow | null } | null>;
  subscribe: (listener: (event: WorkCapsuleActivityEvent) => void | Promise<void>) => Promise<() => void>;
}): Promise<() => void> {
  let active = true;
  let snapshotSent = false;
  const pendingWorkroomIds = new Set<string>();
  let drainPromise: Promise<void> | null = null;

  const reload = async (workroomId: string) => {
    if (!active) return;
    try {
      const result = await input.loadRow(workroomId);
      if (!active || !result) return;
      const observedAt = new Date().toISOString();
      input.send(result.row
        ? { type: "upsert", row: result.row, observedAt }
        : { type: "remove", capsuleId: result.capsuleId, observedAt });
    } catch {
      if (active) input.send({ type: "error", error: "workroom_reload_failed", observedAt: new Date().toISOString() });
    }
  };

  const drainPendingWorkrooms = (): Promise<void> => {
    if (drainPromise) return drainPromise;
    drainPromise = (async () => {
      while (active && snapshotSent && pendingWorkroomIds.size > 0) {
        const workroomId = pendingWorkroomIds.values().next().value;
        if (typeof workroomId !== "string") break;
        pendingWorkroomIds.delete(workroomId);
        await reload(workroomId);
      }
    })().finally(() => {
      drainPromise = null;
      if (active && snapshotSent && pendingWorkroomIds.size > 0) void drainPendingWorkrooms();
    });
    return drainPromise;
  };

  const unsubscribe = await input.subscribe((event) => {
    if (!active) return;
    pendingWorkroomIds.add(event.workCapsuleId);
    if (!snapshotSent) {
      return;
    }
    return drainPendingWorkrooms();
  });

  try {
    const snapshot = await input.loadSnapshot();
    if (active) {
      input.send({ type: "snapshot", ...snapshot });
      snapshotSent = true;
      void drainPendingWorkrooms();
    }
  } catch {
    if (active) {
      input.send({ type: "error", error: "snapshot_failed", observedAt: new Date().toISOString() });
      snapshotSent = true;
      void drainPendingWorkrooms();
    }
  }

  return () => {
    if (!active) return;
    active = false;
    pendingWorkroomIds.clear();
    unsubscribe();
  };
}
