import { Pool } from "pg";

export const WORK_CAPSULE_ACTIVITY_CHANNEL = "dpf_work_capsule_activity";

export type WorkCapsuleActivityEvent = {
  workCapsuleId: string;
  activityId: string;
};

type Queryable = {
  query(sql: string, values?: unknown[]): Promise<unknown>;
};

type ListenerClient = Queryable & {
  on(event: "notification", listener: (message: { channel?: string; payload?: string }) => void): void;
  off?(event: "notification", listener: (message: { channel?: string; payload?: string }) => void): void;
  removeListener?(event: "notification", listener: (message: { channel?: string; payload?: string }) => void): void;
  release(): void;
};

type ListenPool = {
  connect(): Promise<ListenerClient>;
};

let publishPool: Pool | null = null;
let listenPool: Pool | null = null;

function databaseUrl(): string | null {
  // Unit tests inject fake pools. Never let pure tests open real Postgres
  // sockets just because .env provided DATABASE_URL.
  if (process.env.NODE_ENV === "test" || process.env.VITEST) return null;
  const url = process.env.DATABASE_URL?.trim();
  return url ? url : null;
}

function getPublishPool(): Pool | null {
  const connectionString = databaseUrl();
  if (!connectionString) return null;
  publishPool ??= new Pool({ connectionString });
  return publishPool;
}

function getListenPool(): Pool | null {
  const connectionString = databaseUrl();
  if (!connectionString) return null;
  listenPool ??= new Pool({ connectionString });
  return listenPool;
}

export function serializeWorkCapsuleActivityEvent(event: WorkCapsuleActivityEvent): string {
  return JSON.stringify(event);
}

export function parseWorkCapsuleActivityEvent(payload: unknown): WorkCapsuleActivityEvent | null {
  if (typeof payload !== "string" || payload.length === 0) return null;
  try {
    const parsed = JSON.parse(payload) as Record<string, unknown>;
    const workCapsuleId = parsed.workCapsuleId;
    const activityId = parsed.activityId;
    if (typeof workCapsuleId !== "string" || workCapsuleId.length === 0) return null;
    if (typeof activityId !== "string" || activityId.length === 0) return null;
    return { workCapsuleId, activityId };
  } catch {
    return null;
  }
}

/**
 * Publish a best-effort wake-up after a WorkroomActivity write.
 *
 * The activity table remains the source of truth; this notification only tells
 * subscribed browser streams to fetch the committed row. Failure is fail-open so
 * progress persistence never depends on the push transport.
 */
export async function publishWorkCapsuleActivityEvent(
  event: WorkCapsuleActivityEvent,
  pool: Queryable | null = getPublishPool(),
): Promise<boolean> {
  if (!pool) return false;
  try {
    await pool.query("SELECT pg_notify($1, $2)", [
      WORK_CAPSULE_ACTIVITY_CHANNEL,
      serializeWorkCapsuleActivityEvent(event),
    ]);
    return true;
  } catch {
    return false;
  }
}

export function publishRecordedWorkCapsuleActivity(workCapsuleId: string, activityId?: string | null): void {
  if (!activityId) return;
  void publishWorkCapsuleActivityEvent({ workCapsuleId, activityId });
}

export async function subscribeToWorkCapsuleActivityEvents(
  onEvent: (event: WorkCapsuleActivityEvent) => void,
  pool: ListenPool | null = getListenPool(),
): Promise<() => void> {
  if (!pool) return () => {};

  const client = await pool.connect();
  let released = false;
  const listener = (message: { channel?: string; payload?: string }) => {
    if (message.channel !== WORK_CAPSULE_ACTIVITY_CHANNEL) return;
    const event = parseWorkCapsuleActivityEvent(message.payload);
    if (event) onEvent(event);
  };

  client.on("notification", listener);
  await client.query(`LISTEN ${WORK_CAPSULE_ACTIVITY_CHANNEL}`);

  return () => {
    if (released) return;
    released = true;
    try {
      client.off?.("notification", listener);
      client.removeListener?.("notification", listener);
    } catch {
      /* cleanup is best effort */
    }
    void client.query(`UNLISTEN ${WORK_CAPSULE_ACTIVITY_CHANNEL}`).catch(() => {});
    client.release();
  };
}
