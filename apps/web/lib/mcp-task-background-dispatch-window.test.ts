import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  update: vi.fn(),
  updateMany: vi.fn(),
  findMany: vi.fn(),
  findUnique: vi.fn(),
  findOperation: vi.fn(),
  findWriter: vi.fn(),
  findEnvelope: vi.fn(),
}));
const queue = vi.hoisted(() => ({ send: vi.fn() }));
const notify = vi.hoisted(() => ({ publish: vi.fn() }));
const asyncRuntime = vi.hoisted(() => ({ cancel: vi.fn(), enqueue: vi.fn() }));
const recipeRuntime = vi.hoisted(() => ({ ensure: vi.fn() }));

vi.mock("@dpf/db", () => ({
  prisma: {
    toolExecution: { findFirst: (...args: unknown[]) => db.findWriter(...args) },
    coworkerActionEnvelope: { findFirst: (...args: unknown[]) => db.findEnvelope(...args) },
    asyncInferenceOp: {
      findFirst: (...args: unknown[]) => db.findOperation(...args),
    },
    taskRun: {
      update: (...args: unknown[]) => db.update(...args),
      updateMany: (...args: unknown[]) => db.updateMany(...args),
      findMany: (...args: unknown[]) => db.findMany(...args),
      findUnique: (...args: unknown[]) => db.findUnique(...args),
    },
  },
}));
vi.mock("./mcp-task-notification-bus", () => ({
  mcpTaskNotificationBus: { publish: (...args: unknown[]) => notify.publish(...args) },
}));
vi.mock("@/lib/queue/mcp-task-run-events", () => ({
  REMOTE_TASK_EXECUTION_EVENT: "mcp/task-run.execute",
  sendMcpTaskRunExecutionEvent: (...args: unknown[]) => queue.send(...args),
}));
vi.mock("@/lib/inference/async-operation-runtime", () => ({
  requestPrismaAuthorizedAsyncOperationCancellation: (...args: unknown[]) =>
    asyncRuntime.cancel(...args),
  enqueuePrismaAsyncOperationWake: (...args: unknown[]) => asyncRuntime.enqueue(...args),
}));
vi.mock("./mcp-task-durable-inference-runtime", () => ({
  ensureDurableInferenceTaskRecipes: (...args: unknown[]) => recipeRuntime.ensure(...args),
}));

import { reconcilePersistedRemoteTaskDispatches } from "./mcp-task-background-dispatch";

beforeEach(() => {
  vi.clearAllMocks();
  db.update.mockResolvedValue({});
  db.updateMany.mockResolvedValue({ count: 1 });
  db.findMany.mockResolvedValue([]);
  db.findUnique.mockResolvedValue(null);
  db.findOperation.mockResolvedValue(null);
  db.findWriter.mockResolvedValue(null);
  db.findEnvelope.mockResolvedValue(null);
  queue.send.mockResolvedValue({ ids: ["event-1"] });
  asyncRuntime.cancel.mockResolvedValue({ operationId: "async-op-1" });
  asyncRuntime.enqueue.mockResolvedValue(undefined);
  recipeRuntime.ensure.mockResolvedValue({
    seeded: 0,
    validated: 1,
    recipeIds: ["closed-recipe-1"],
    recipes: [{ id: "closed-recipe-1", modelId: "gemini-3.1-pro-preview" }],
  });
});

describe("dispatch reconciler category windows (BI-AF428359)", () => {
  it("BI-AF428359: stale never-acted rows in one category cannot starve a due capacity wait", async () => {
    const now = new Date("2026-11-03T21:00:00.000Z");
    // 30 old reviewer-receipt waits that the loop will not act on (attempt
    // exhausted), older than everything else, as found on the dev install.
    const stale = Array.from({ length: 30 }, (_, i) => ({
      id: `row-stale-${i}`, taskRunId: `TR-STALE-${i}`, status: "input-required",
      updatedAt: new Date(Date.UTC(2026, 8, 7, 0, i)),
      progressPayload: { terminalWriterWait: { schemaVersion: 1, kind: "missing-terminal-writer",
        writerToolName: "record_initiative_design_review", noncompliance: "prose-without-required-writer",
        resumeMode: "same-taskrun", attempt: 3, observedAt: "2026-09-07T00:00:00.000Z" } },
      a2aMetadata: { trigger: "external-mcp" },
    }));
    const capacity = {
      id: "row-capacity", taskRunId: "TR-CAPACITY", status: "submitted",
      updatedAt: new Date("2026-10-28T20:54:14.988Z"),
      progressPayload: { resourceWait: { schemaVersion: 1, kind: "provider-capacity", attempt: 1,
        failureKind: "capacity", resumeMode: "same-taskrun",
        observedAt: "2026-10-28T20:54:14.988Z", nextAttemptAt: "2026-10-28T20:55:14.988Z" } },
      a2aMetadata: { trigger: "external-mcp" },
    };
    const rows = [...stale, capacity];
    const matches = (row: (typeof rows)[number], clause: Record<string, unknown>) => {
      const progress = clause.progressPayload as { path?: string[] } | undefined;
      const and = clause.AND as Array<{ progressPayload: { path: string[] } }> | undefined;
      const status = clause.status;
      const statusOk = typeof status === "string" ? row.status === status
        : (status as { in: string[] }).in.includes(row.status);
      if (!statusOk) return false;
      if (progress?.path?.[0] === "resourceWait") return "resourceWait" in row.progressPayload;
      if (and?.[0]?.progressPayload.path[0] === "terminalWriterWait") return "terminalWriterWait" in row.progressPayload;
      const meta = clause.a2aMetadata as { path: string[] };
      return meta.path[0] === "trigger";
    };
    db.findMany.mockImplementation(async ({ where, take }) => rows
      .filter((row) => (where.OR as Array<Record<string, unknown>>).some((clause) => matches(row, clause)))
      .sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime())
      .slice(0, take));
    db.updateMany.mockImplementation(async ({ data }) => {
      db.findUnique.mockResolvedValue({ ...capacity, ...data });
      return { count: 1 };
    });

    await reconcilePersistedRemoteTaskDispatches({ now, includeOrdinary: false });

    expect(queue.send).toHaveBeenCalledWith("TR-CAPACITY", "mcp-task-run:TR-CAPACITY:execute:1");
    // Within its own category, reviewer-receipt waits are read newest first, so
    // old unrecoverable rows cannot hold that window either.
    const receiptRead = db.findMany.mock.calls.find((call) =>
      (call[0].where.OR as Array<{ AND?: unknown }>)[0]?.AND !== undefined);
    expect(receiptRead?.[0].orderBy).toEqual({ updatedAt: "desc" });
  });
});
