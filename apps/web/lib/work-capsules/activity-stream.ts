import { presentAgentSession, type AgentSessionEntry } from "./agent-activity-presenter";

export const WORK_CAPSULE_ACTIVITY_EVENT = "capsule-activity";

export type WorkCapsuleActivityStreamEntry = Omit<AgentSessionEntry, "recordedAt"> & {
  recordedAt: string;
};

type ActivityRow = {
  id: string;
  kind: string;
  summary: string;
  recordedAt: Date;
  recordedByAgentId?: string | null;
  recordedById?: string | null;
};

type ActivityStreamDb = {
  workroom: {
    findUnique(args: unknown): Promise<{ id: string } | null>;
  };
  workroomActivity: {
    findMany(args: unknown): Promise<ActivityRow[]>;
    findFirst(args: unknown): Promise<ActivityRow | null>;
  };
};

export type BufferedActivityEvent = {
  workroomId: string;
  providerChildId: string;
  sequence: number;
  kind: "progress" | "approval" | "failure" | "ownership" | "lifecycle" | "terminal";
  payload: unknown;
};

export type ActivityDrainResult = {
  events: BufferedActivityEvent[];
  deferredEvents: BufferedActivityEvent[];
  metrics: { coalescedProgressCount: number; fairnessPartitions: number };
};

function activityPartition(event: BufferedActivityEvent): string {
  return `${event.workroomId}\u0000${event.providerChildId}`;
}

export function drainFairActivityEvents(
  events: BufferedActivityEvent[],
  maxEvents: number,
): ActivityDrainResult {
  if (!Number.isInteger(maxEvents) || maxEvents < 0) {
    throw new RangeError("maxEvents must be a non-negative integer");
  }
  const latestProgressIndex = new Map<string, number>();
  events.forEach((event, index) => {
    if (event.kind === "progress") {
      latestProgressIndex.set(activityPartition(event), index);
    }
  });
  const retained = events
    .map((event, index) => ({ event, index }))
    .filter(({ event, index }) => event.kind !== "progress"
      || latestProgressIndex.get(activityPartition(event)) === index);
  const partitionQueues = new Map<string, typeof retained>();
  for (const candidate of retained) {
    const partition = activityPartition(candidate.event);
    const queue = partitionQueues.get(partition) ?? [];
    queue.push(candidate);
    partitionQueues.set(partition, queue);
  }
  const partitions = [...partitionQueues.keys()];
  const selected: typeof retained = [];
  let lastServedPartition = -1;
  while (selected.length < maxEvents) {
    let madeProgress = false;
    for (const [partitionIndex, partition] of partitions.entries()) {
      const queue = partitionQueues.get(partition)!;
      const candidate = queue.shift();
      if (!candidate) continue;
      selected.push(candidate);
      lastServedPartition = partitionIndex;
      madeProgress = true;
      if (selected.length === maxEvents) break;
    }
    if (!madeProgress) break;
  }
  const deferred: typeof retained = [];
  if (selected.length === 0) {
    deferred.push(...retained);
  } else {
    while (true) {
      let madeProgress = false;
      for (let offset = 1; offset <= partitions.length; offset += 1) {
        const partitionIndex = (lastServedPartition + offset) % partitions.length;
        const candidate = partitionQueues.get(partitions[partitionIndex]!)!.shift();
        if (!candidate) continue;
        deferred.push(candidate);
        madeProgress = true;
      }
      if (!madeProgress) break;
    }
  }
  return {
    events: selected.map(({ event }) => event),
    deferredEvents: deferred.map(({ event }) => event),
    metrics: {
      coalescedProgressCount: events.filter((event) => event.kind === "progress").length
        - latestProgressIndex.size,
      fairnessPartitions: new Set(retained.map(({ event }) => activityPartition(event))).size,
    },
  };
}

export type CursorRecoveryResult = {
  mode: "continuous" | "snapshot" | "refused";
  cursor: number;
  entries: Array<{ cursor: number; value: unknown }>;
  reason: string | null;
  metrics: { snapshotRecoveryCount: number };
};

export function recoverActivityCursor(args: {
  cursor: number;
  nextCursor: number;
  snapshot: Array<{ cursor: number; value: unknown }>;
  maxSnapshotEntries: number;
  recoveryAlreadyAttempted?: boolean;
}): CursorRecoveryResult {
  if (args.nextCursor === args.cursor + 1) {
    return {
      mode: "continuous",
      cursor: args.nextCursor,
      entries: [],
      reason: null,
      metrics: { snapshotRecoveryCount: 0 },
    };
  }
  if (args.nextCursor <= args.cursor) {
    return {
      mode: "refused",
      cursor: args.cursor,
      entries: [],
      reason: "The incoming cursor is not monotonic.",
      metrics: { snapshotRecoveryCount: 0 },
    };
  }
  if (args.recoveryAlreadyAttempted) {
    return {
      mode: "refused",
      cursor: args.cursor,
      entries: [],
      reason: "A cursor gap remained after the single permitted snapshot recovery.",
      metrics: { snapshotRecoveryCount: 0 },
    };
  }
  const bounded = args.snapshot.length <= Math.max(0, args.maxSnapshotEntries);
  const contiguous = bounded
    && args.snapshot.length === args.nextCursor - args.cursor
    && args.snapshot.every((entry, index) => entry.cursor === args.cursor + index + 1);
  if (contiguous) {
    return {
      mode: "snapshot",
      cursor: args.nextCursor,
      entries: args.snapshot,
      reason: null,
      metrics: { snapshotRecoveryCount: 1 },
    };
  }
  return {
    mode: "refused",
    cursor: args.cursor,
    entries: [],
    reason: "The bounded snapshot could not prove continuous event history.",
    metrics: { snapshotRecoveryCount: 1 },
  };
}

export function serializeAgentSessionEntry(entry: AgentSessionEntry): WorkCapsuleActivityStreamEntry {
  return {
    ...entry,
    recordedAt: entry.recordedAt.toISOString(),
  };
}

export async function loadInitialAgentSessionEntries(args: {
  db: ActivityStreamDb;
  capsuleId: string;
  limit?: number;
}): Promise<{ workCapsuleId: string; entries: WorkCapsuleActivityStreamEntry[] } | null> {
  const capsule = await args.db.workroom.findUnique({
    where: { capsuleId: args.capsuleId },
    select: { id: true },
  });
  if (!capsule) return null;

  const rows = await args.db.workroomActivity.findMany({
    where: { workCapsuleId: capsule.id },
    orderBy: { recordedAt: "desc" },
    take: args.limit ?? 25,
  });

  return {
    workCapsuleId: capsule.id,
    entries: presentAgentSession(rows).map(serializeAgentSessionEntry),
  };
}

export async function loadAgentSessionEntryByActivityId(args: {
  db: ActivityStreamDb;
  workCapsuleId: string;
  activityId: string;
}): Promise<WorkCapsuleActivityStreamEntry | null> {
  const row = await args.db.workroomActivity.findFirst({
    where: { id: args.activityId, workCapsuleId: args.workCapsuleId },
  });
  if (!row) return null;
  return serializeAgentSessionEntry(presentAgentSession([row])[0]!);
}
