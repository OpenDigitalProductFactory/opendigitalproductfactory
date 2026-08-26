import { createHash } from "node:crypto";
import { markTaskRunWorking } from "@/lib/observability/heartbeat";

export type SemanticReviewRunStatus =
  | "submitted"
  | "working"
  | "input-required"
  | "auth-required"
  | "completed"
  | "failed"
  | "canceled"
  | "rejected"
  | "archived";
const WORKING_STATUS: SemanticReviewRunStatus = "working";

export type SemanticReviewRunCreate = {
  taskRunId: string;
  repeatedPatternKey: string;
  userId: string;
  gateKey: string;
  capsuleId: string;
  attempt: number;
  title: string;
  objective: string;
};

export type SemanticReviewRunRow = SemanticReviewRunCreate & {
  status: SemanticReviewRunStatus;
  progressPayload: unknown;
  createdAt: Date;
};

export type SemanticReviewRunUpdate = Pick<SemanticReviewRunRow, "status" | "progressPayload">;

export interface SemanticReviewSingleFlightStore {
  list(repeatedPatternKey: string): Promise<SemanticReviewRunRow[]>;
  find(taskRunId: string): Promise<SemanticReviewRunRow | null>;
  create(input: SemanticReviewRunCreate): Promise<SemanticReviewRunRow>;
  update(taskRunId: string, update: SemanticReviewRunUpdate): Promise<SemanticReviewRunRow>;
}

type TaskRunRecord = {
  taskRunId: string;
  repeatedPatternKey: string | null;
  userId: string;
  title: string;
  objective: string;
  status: string;
  progressPayload: unknown;
  a2aMetadata: unknown;
  createdAt: Date;
};

type SemanticReviewTaskRunDb = {
  taskRun: {
    findMany(input: unknown): Promise<TaskRunRecord[]>;
    findUnique(input: unknown): Promise<TaskRunRecord | null>;
    create(input: unknown): Promise<TaskRunRecord>;
    update(input: unknown): Promise<TaskRunRecord>;
  };
};

function metadata(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function mapTaskRun(row: TaskRunRecord): SemanticReviewRunRow {
  const runMetadata = metadata(row.a2aMetadata);
  const gateKey = typeof runMetadata.gateKey === "string" ? runMetadata.gateKey : "";
  const capsuleId = typeof runMetadata.capsuleId === "string" ? runMetadata.capsuleId : "";
  const attempt = typeof runMetadata.attempt === "number" ? runMetadata.attempt : 0;
  if (!row.repeatedPatternKey || !SHA256.test(gateKey) || !capsuleId || attempt < 1) {
    throw new Error(`Invalid semantic-review TaskRun projection: ${row.taskRunId}`);
  }
  return {
    taskRunId: row.taskRunId,
    repeatedPatternKey: row.repeatedPatternKey,
    userId: row.userId,
    gateKey,
    capsuleId,
    attempt,
    title: row.title,
    objective: row.objective,
    status: row.status as SemanticReviewRunStatus,
    progressPayload: row.progressPayload,
    createdAt: row.createdAt,
  };
}

export function createPrismaSemanticReviewSingleFlightStore(
  db: SemanticReviewTaskRunDb,
): SemanticReviewSingleFlightStore {
  return {
    async list(repeatedPatternKey) {
      const rows = await db.taskRun.findMany({
        where: { repeatedPatternKey },
        orderBy: { createdAt: "desc" },
        take: 10,
        select: {
          taskRunId: true,
          repeatedPatternKey: true,
          userId: true,
          title: true,
          objective: true,
          status: true,
          progressPayload: true,
          a2aMetadata: true,
          createdAt: true,
        },
      });
      return rows.map(mapTaskRun);
    },
    async find(taskRunId) {
      const row = await db.taskRun.findUnique({
        where: { taskRunId },
        select: {
          taskRunId: true,
          repeatedPatternKey: true,
          userId: true,
          title: true,
          objective: true,
          status: true,
          progressPayload: true,
          a2aMetadata: true,
          createdAt: true,
        },
      });
      return row ? mapTaskRun(row) : null;
    },
    async create(input) {
      const row = await db.taskRun.create({
        data: {
          taskRunId: input.taskRunId,
          userId: input.userId,
          currentAgentId: "change-reviewer",
          routeContext: "change-review",
          title: input.title,
          objective: input.objective,
          source: "build",
          status: "submitted",
          repeatedPatternKey: input.repeatedPatternKey,
          a2aMetadata: {
            gateKind: "semantic-review",
            gateKey: input.gateKey,
            capsuleId: input.capsuleId,
            attempt: input.attempt,
          },
          lastHeartbeatAt: new Date(),
        },
        select: {
          taskRunId: true,
          repeatedPatternKey: true,
          userId: true,
          title: true,
          objective: true,
          status: true,
          progressPayload: true,
          a2aMetadata: true,
          createdAt: true,
        },
      });
      await markTaskRunWorking(row.taskRunId);
      return mapTaskRun({ ...row, status: WORKING_STATUS });
    },
    async update(taskRunId, update) {
      const terminal = ["completed", "failed", "canceled", "rejected", "archived"]
        .includes(update.status);
      const row = await db.taskRun.update({
        where: { taskRunId },
        data: {
          status: update.status,
          progressPayload: update.progressPayload,
          lastHeartbeatAt: new Date(),
          ...(terminal ? { completedAt: new Date() } : {}),
        },
        select: {
          taskRunId: true,
          repeatedPatternKey: true,
          userId: true,
          title: true,
          objective: true,
          status: true,
          progressPayload: true,
          a2aMetadata: true,
          createdAt: true,
        },
      });
      return mapTaskRun(row);
    },
  };
}

export type SemanticReviewSingleFlightClaim =
  | { disposition: "admitted"; taskRunId: string; gateKey: string; attempt: number }
  | { disposition: "subscribed"; taskRunId: string; gateKey: string; attempt: number }
  | {
    disposition: "reused";
    taskRunId: string;
    gateKey: string;
    attempt: number;
    evidenceRecordId: string;
    resultClass: "pass" | "fail";
  };

const SHA256 = /^[0-9a-f]{64}$/;
const NONTERMINAL = new Set<SemanticReviewRunStatus>([
  "submitted",
  "working",
  "input-required",
  "auth-required",
]);

function deterministicTaskRunId(gateKey: string, attempt: number): string {
  const digest = createHash("sha256")
    .update(`semantic-review\0${gateKey}\0${attempt}`)
    .digest("hex")
    .slice(0, 24)
    .toUpperCase();
  return `TR-GATE-${digest}`;
}

function evidenceRecordId(progressPayload: unknown): string | null {
  if (!progressPayload || typeof progressPayload !== "object") return null;
  const value = (progressPayload as Record<string, unknown>)["evidenceRecordId"];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function uniqueConflict(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "P2002");
}

async function projectExisting(
  row: SemanticReviewRunRow,
  gateKey: string,
  isReusableEvidence: (evidenceRecordId: string) => Promise<boolean>,
): Promise<SemanticReviewSingleFlightClaim | null> {
  if (NONTERMINAL.has(row.status)) {
    return {
      disposition: "subscribed",
      taskRunId: row.taskRunId,
      gateKey,
      attempt: row.attempt,
    };
  }
  if (row.status !== "completed") return null;
  const evidenceId = evidenceRecordId(row.progressPayload);
  const payload = metadata(row.progressPayload);
  const resultClass = payload.resultClass === "pass" || payload.resultClass === "fail"
    ? payload.resultClass
    : null;
  if (!evidenceId || !resultClass || !(await isReusableEvidence(evidenceId))) return null;
  return {
    disposition: "reused",
    taskRunId: row.taskRunId,
    gateKey,
    attempt: row.attempt,
    evidenceRecordId: evidenceId,
    resultClass,
  };
}

export async function claimSemanticReviewSingleFlight(
  input: {
    gateKey: string;
    userId: string;
    capsuleId: string;
    title: string;
    objective: string;
  },
  store: SemanticReviewSingleFlightStore,
  isReusableEvidence: (evidenceRecordId: string) => Promise<boolean>,
): Promise<SemanticReviewSingleFlightClaim> {
  const gateKey = input.gateKey.trim().toLowerCase();
  if (!SHA256.test(gateKey)) throw new TypeError("Invalid semantic-review gate key.");
  const repeatedPatternKey = `gate:${gateKey}`;
  const existing = await store.list(repeatedPatternKey);

  for (const row of existing) {
    const projected = await projectExisting(row, gateKey, isReusableEvidence);
    if (projected) return projected;
  }

  const attempt = existing.reduce((max, row) => Math.max(max, row.attempt), 0) + 1;
  const taskRunId = deterministicTaskRunId(gateKey, attempt);
  try {
    await store.create({
      taskRunId,
      repeatedPatternKey,
      userId: input.userId,
      gateKey,
      capsuleId: input.capsuleId,
      attempt,
      title: input.title,
      objective: input.objective,
    });
    return { disposition: "admitted", taskRunId, gateKey, attempt };
  } catch (error) {
    if (!uniqueConflict(error)) throw error;
    const winner = await store.find(taskRunId);
    if (!winner) throw error;
    const projected = await projectExisting(winner, gateKey, isReusableEvidence);
    if (projected) return projected;
    return claimSemanticReviewSingleFlight(input, store, isReusableEvidence);
  }
}

export async function completeSemanticReviewSingleFlight(
  input: {
    taskRunId: string;
    evidenceRecordId: string;
    resultClass: "pass" | "fail";
  },
  store: SemanticReviewSingleFlightStore,
): Promise<SemanticReviewRunRow> {
  if (!input.evidenceRecordId.trim()) {
    throw new TypeError("Semantic-review completion requires an evidence record id.");
  }
  return store.update(input.taskRunId, {
    status: "completed",
    progressPayload: {
      evidenceRecordId: input.evidenceRecordId,
      resultClass: input.resultClass,
    },
  });
}

export async function failSemanticReviewSingleFlight(
  input: { taskRunId: string; reason: string },
  store: SemanticReviewSingleFlightStore,
): Promise<SemanticReviewRunRow> {
  return store.update(input.taskRunId, {
    status: "failed",
    progressPayload: { reason: input.reason },
  });
}
