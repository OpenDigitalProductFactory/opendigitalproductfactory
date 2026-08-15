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
